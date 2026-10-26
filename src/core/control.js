// Emergency control. In an emergency (a fire near the camp, someone down or bleeding, a flood, someone freezing,
// someone in danger from an illness) the Seed can take direct charge of one person and tell them where to go,
// which flames to beat at and whom to help. Obedience runs on trust: people who barely trust the Seed refuse
// outright, the wary hesitate before each order, and someone the fire has already hurt may freeze when sent back
// to it. Every order costs a little trust. When the emergency has been over for an hour they go back to their crew.
import { HOUR, ACT, MAP, hidden } from './consts.js';
import { rnd } from './rng.js';
import { remember } from './life.js';
import { dropCarry } from './work.js';
import { sendToHelp, endCare } from './care.js';
import { fightSpot } from './hazards.js';
import { ailing, danger, laidUp } from './body.js';

export const EM_TXT = { fire: 'a fire near the camp', down: 'someone is down', bleed: 'someone is bleeding', flood: 'the river is in flood', cold: 'someone is dangerously cold', crisis: 'someone is in danger' };
// what makes it an emergency right now, or ''
export function emergency(sim) {
  const S = sim.S, H = S.hz;
  if (S.mode !== 'landfall') return '';
  if (H && (H.alarm || S.projects.some(p => !p.gone && p.fire))) return 'fire';
  let bleed = false, cold = false, crisis = false;
  for (const c of S.cols) {
    if (c.dead) continue;
    if (c.down) return 'down';
    if (!bleed && c.bd.w.some(w => w.kn && w.bl > .02 && !w.aid)) bleed = true;
    if (c.chill >= 65 && !hidden(c.act)) cold = true;
    if (!crisis && danger(c) > .45) crisis = true;
  }
  return bleed ? 'bleed' : H && H.fl.lv >= .5 ? 'flood' : cold ? 'cold' : crisis ? 'crisis' : '';
}
const able = c => !c.dead && !(c.life < 3) && !c.down && c.carried < 0 && !(c.cap && laidUp(c)) && c.act !== ACT.WAKE && !(c.alone > 0);
const say = (sim, c, m, k = '', e) => sim.log(m, k, e ? { who: c.id, e } : { who: c.id });

export function take(sim, id) {
  const S = sim.S, c = S.cols[id];
  if (!c || !able(c)) return { ok: false, why: `${c ? c.name : 'They'} can't be directed right now.` };
  const em = emergency(sim);
  if (!em) return { ok: false, why: 'Direct orders are only for emergencies: a fire near the camp, someone down or bleeding, a flood, or someone freezing.' };
  if (c.tru < 25) { say(sim, c, `${c.name} won't take direct orders from the Seed: they don't trust it enough.`, 'bad'); remember(sim, c, 'Refused to take orders from the Seed.'); return { ok: false, why: `${c.name} refused: their trust in the Seed is too low.` }; }
  if (S.ctl >= 0 && S.ctl !== id && S.cols[S.ctl]) release(sim, S.cols[S.ctl], '');
  if (c.care) endCare(sim, c);
  dropCarry(sim, c);
  c.ctl = true; c.ord = { k: 'hold', t: c.tile, who: -1 }; c.ordWait = 0; c.ctlEnd = 0; c.fight = -1; c.plan = ''; c.job = ''; c.where = -1; S.ctl = id; S.rv++;
  say(sim, c, `The Seed took direct charge of ${c.name}: ${EM_TXT[em]}.`, '', 'ctl');
  return { ok: true };
}
export function release(sim, c, why) {
  const S = sim.S;
  c.ctl = false; c.ord = null; c.ordWait = 0;
  if (c.plan === 'ctl') { c.plan = ''; c.job = ''; }
  if (S.ctl === c.id) S.ctl = -1;
  S.rv++;
  if (why) say(sim, c, why);
}
// the nearest burning tile or building to where the player pointed
function flamesNear(sim, t, r) {
  const S = sim.S, H = S.hz, x = t % MAP, y = t / MAP | 0;
  let best = -1, bd = r + .5;
  for (const k in H.fire) { const d = Math.hypot((k % MAP) - x, (k / MAP | 0) - y); if (d < bd) { bd = d; best = +k; } }
  for (const p of S.projects) if (!p.gone && p.fire && x >= p.x - r && x < p.x + p.w + r && y >= p.y - r && y < p.y + p.h + r) return sim.doorOf(p);
  return best;
}
export function order(sim, id, o) {
  const S = sim.S, c = S.cols[id];
  if (!c || !c.ctl) return { ok: false, why: 'Nobody is under direct orders.' };
  if (!able(c)) { release(sim, c, `${c.name} can't take orders any more.`); return { ok: false, why: `${c.name} can't take orders any more.` }; }
  if (o.k === 'fire') {
    const f = flamesNear(sim, o.t, 4); if (f < 0) return { ok: false, why: 'There is no fire there.' };
    const fear = (c.tr || []).find(t => t.k === 'fire' && t.w > 45);
    if (fear && rnd() < .5) { say(sim, c, `${c.name} froze: they can't bring themselves to go near the flames again.`, 'bad'); c.str = Math.min(100, c.str + 4); return { ok: false, why: `${c.name} can't face the fire.` }; }
    o = { k: 'fire', t: f };
  }
  if (o.k === 'help') {
    const p = S.cols[o.who];
    if (!p || p.dead || p === c || !ailing(p.bd)) return { ok: false, why: 'Nobody there needs help.' };
    if (p.aidBy >= 0 && p.aidBy !== c.id && S.cols[p.aidBy]) endCare(sim, S.cols[p.aidBy]);
    if (p.medBy >= 0 && p.medBy !== c.id && S.cols[p.medBy] && !p.down) return { ok: false, why: `${p.name} is already being seen to.` };
  }
  if (o.k === 'go') {   // somewhere they can stand: the nearest open ground to where the player pointed
    const W = sim.W, x0 = o.t % MAP, y0 = o.t / MAP | 0; let best = -1, bd = 9;
    for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const t = (y0 + dy) * MAP + x0 + dx, d = dx * dx + dy * dy; if (W.reach[t] && W.cost[t] && d < bd) { bd = d; best = t; } }
    if (best < 0) return { ok: false, why: `${c.name} can't get there.` };
    o = { k: 'go', t: best };
  }
  // the wary hesitate; every order costs a little trust
  c.ordWait = 0;
  if (c.tru < 50 && rnd() < (50 - c.tru) / 50) { c.ordWait = S.tick + Math.round((.15 + rnd() * .3) * HOUR); say(sim, c, `${c.name} hesitated before doing as the Seed said.`); }
  c.tru = Math.max(0, c.tru - (c.traits.includes('stubborn') ? .6 : .3));
  c.ord = { k: o.k, t: o.t ?? c.tile, who: o.who ?? -1 };
  if (c.care) endCare(sim, c);
  c.plan = ''; c.job = ''; c.timer = 0; S.rv++;
  return { ok: true };
}
// what a person under orders does next: called when they start, arrive, or finish a step
export function ctlStart(sim, c) {
  const S = sim.S, o = c.ord || (c.ord = { k: 'hold', t: c.tile, who: -1 });
  c.where = -1;
  if (c.ordWait > S.tick) { c.job = 'ctl'; c.act = ACT.IDLE; c.mv = 0; c.timer = c.ordWait - S.tick; return; }
  if (o.k === 'help') {
    const p = S.cols[o.who]; o.k = 'hold'; o.t = c.tile;
    if (p && !p.dead && ailing(p.bd)) { sendToHelp(sim, c, p); return; }
  }
  if (o.k === 'fire') {
    const f = flamesNear(sim, o.t, 3);
    if (f >= 0) { o.t = f; c.job = 'fire'; sim.goTo(c, fightSpot(sim, f), ACT.FIGHT, ACT.WALK); return; }
    o.k = 'hold'; o.t = c.tile; say(sim, c, `The flames ${c.name} was sent to are out.`);
  }
  if (o.k === 'go' && c.tile !== o.t) { c.job = 'ctl'; sim.goTo(c, o.t, ACT.IDLE, ACT.WALK); return; }
  o.k = 'hold'; c.job = 'ctl'; c.act = ACT.IDLE; c.mv = 0; c.timer = Math.round(HOUR / 4);   // waiting for orders
}
// once an hour: hand them back an hour after the emergency, or when they can no longer act
export function ctlHour(sim) {
  const S = sim.S; if (S.ctl < 0) return;
  const c = S.cols[S.ctl];
  if (!c || !able(c)) { if (c) release(sim, c, `${c.name} can't take orders any more.`); else S.ctl = -1; return; }
  if (emergency(sim)) { c.ctlEnd = 0; return; }
  if (!c.ctlEnd) c.ctlEnd = S.tick + HOUR;
  else if (S.tick >= c.ctlEnd) release(sim, c, `The emergency is over: ${c.name} goes back to their crew.`);
}

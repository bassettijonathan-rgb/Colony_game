// Raids. A settlement that is going hungry, that has come to hate the colony, or that can't bear what its scanner
// does, may come in force: a handful of people with poles and blades, walking fast for the larder, the yard or the
// scanner. Every raid has a reason the player could have seen coming: the traders said the winter was hard on them,
// they saw the scanner and went quiet, trust fell and kept falling. Feeding a hungry settlement, or winning its trust
// back, takes the reason away.
// Who meets them is the player's call: the guard (people marked for it, and the watch crew), everyone who can fight,
// or nobody, and everyone stays inside while they take what they came for. Raiders want what they came for, not
// blood: they fight whoever stands in their way, and run when the fight turns against them. Those left behind, hurt,
// are the colony's to treat and send home, or to turn away. Deaths on either side are remembered.
import { DAY_TICKS, HOUR, MAP, ACT } from './consts.js';
import { rnd, lcg, clamp } from './rng.js';
import { KINDS, DIRS, entry, nearFree, nameFor, newGuest, endParty, takeGood, haveOf, hungry, yearOf, list, trustWord } from './nb.js';
import { seasonOf, doyOf, DEEP, dayWeather } from './year.js';
import { flareNear } from './sky.js';
import { injure, woundText, laidUp } from './body.js';
import { damage } from './hazards.js';
import { spend } from './director.js';
import { remember } from './life.js';
import { scar } from './trauma.js';

export const MUSTER = 1000;              // a defender's mark while they wait for the raiders to come close
const RANGE = 40;                        // how far from the camp, or from what they came for, the defenders go out to meet them
const CARRY = { meals: 12, loads: 8 };   // what one raider carries away
const LOOT_H = 2.5;                      // hours they spend taking it before they leave, whatever they have
const GAP = 30;                          // days at least between raids from one settlement
const LOOT = ['salvage', 'ore', 'rare', 'timber'];
const watchman = (S, c) => c.crew >= 0 && S.crews[c.crew] && !S.crews[c.crew].gone && S.crews[c.crew].work === 'watch';
export const raidOn = S => { const P = S.nb && S.nb.party; return !!P && P.kind === 'raid' && (P.st === 'come' || P.st === 'loot'); };
// someone who can stand in the way: a grown, able adult not under the player's orders
export const fighter = c => !c.dead && c.life >= 4 && !c.retired && !c.down && c.carried < 0 && !(c.cap && laidUp(c)) && c.act !== ACT.WAKE && !c.ctl && !(c.alone > 0);
const guardOf = S => S.cols.filter(c => !c.dead && (c.grd || watchman(S, c)));

// ---------- each morning: does anyone have a reason to come, and does the world let them ----------
export function raidMorning(sim) {
  const S = sim.S, N = S.nb; if (!N || !N.list.length || S.mode !== 'landfall') return;
  newYear(sim);
  if (N.party || sim.day < 45) return;
  const s = seasonOf(doyOf(sim.cal));
  if (s === DEEP || dayWeather(sim.W.seed, sim.cal).out || flareNear(S)) return;
  const D = S.dir; if (D && (sim.day < D.calm || D.spent + 4 > D.budget * 1.1)) return;   // the director paces raids like any other danger
  const scanner = S.projects.some(p => !p.gone && p.done && p.type === 'scanner'), opts = [];
  N.list.forEach((q, i) => {
    if (!q.met || sim.day - (q.raided ?? -99) < GAP) return;
    const K = KINDS[q.k], a = K.raid ?? .5;
    if (hungry(sim, q) && s <= 1 && q.trust < 30) opts.push([i, 'hunger', a * (1 - q.trust / 40)]);   // the hungry weeks are the spring, when the winter stores run out
    if (K.noScan && scanner && q.sawScan && q.trust < 15) opts.push([i, 'scan', a * 1.2]);
    if (q.trust < -40) opts.push([i, 'grudge', a + (-40 - q.trust) / 60]);
  });
  const tot = opts.reduce((x, o) => x + o[2], 0);
  if (!opts.length || rnd() > Math.min(.3, .07 * tot)) return;
  let r = rnd() * tot, o = opts[0]; for (const e of opts) { r -= e[2]; if (r <= 0) { o = e; break; } }
  startRaid(sim, o[0], o[1]);
}
// a new year: which settlements had a hard winter
function newYear(sim) {
  const N = sim.S.nb, y = yearOf(sim); if (N.ly === y) return; N.ly = y;
  for (const q of N.list) { q.fed = 0; q.lean = rnd() < (KINDS[q.k].lean || 0) ? y : -1; }
}
// where they are going, and what the letter calls it
function target(sim, why) {
  const S = sim.S;
  if (why === 'scan') { const p = S.projects.find(p => !p.gone && p.done && p.type === 'scanner'); if (p) return { t: sim.doorOf(p), pid: p.id, name: 'the scanner' }; }
  if (why === 'hunger') { const p = S.projects.find(p => !p.gone && p.done && p.type === 'cellar'); return p ? { t: sim.doorOf(p), pid: p.id, name: p.name } : { t: sim.doorTile, pid: 0, name: 'the shelter, where the larder is' }; }
  return { t: sim.yardTile, pid: -1, name: 'the yard' };
}
const WHY = {
  hunger: (q, fed) => `${q.place}’s traders said their winter stores were low${fed ? ', and what the colony sent was not enough' : ''}: they have come for food.`,
  scan: q => `The people from ${q.place} have not forgotten the scanner: they have come to break it.`,
  grudge: q => `The people from ${q.place} have been ${trustWord(q.trust)} for a long time: they have come to take what they can.`,
};
export function startRaid(sim, i, why) {
  const S = sim.S, N = S.nb, q = N.list[i], K = KINDS[q.k], r = lcg(sim.W.seed * 13 + S.tick % 100019);
  const fit = S.cols.filter(fighter).length, n = clamp(Math.round(2 + fit / 6 + r() * 2), 3, Math.max(3, Math.min(9, Math.floor(q.pop / 8))));
  const at = entry(sim, q.dir), used = new Set(S.cols.map(c => c.name)), tg = target(sim, why);
  N.g = [];
  for (let k = 0; k < n; k++) {
    const t = k ? nearFree(sim, at, 3) : at, g = newGuest(r, K, i, k, t, nameFor(sim, K, r, used), 18 + Math.floor(r() * 24)); used.add(g.name);
    Object.assign(g, { raider: true, hp: 1, load: 0, down: 0, eng: 0, spd: .15 + r() * .02, wait: k * 15 });
    N.g.push(g);
  }
  const mode = guardOf(S).some(fighter) ? 'guard' : 'hide';
  N.party = { nb: i, kind: 'raid', why, st: 'come', seq: ++N.seq, goods: {}, ask: -1, asked: 0, traded: 0, at: S.tick, until: -1, n, mode, tgt: tg.t, pid: tg.pid, tname: tg.name, took: {}, smash: 0, lootAt: -1, how: '', hurt: [], fought: 0, home: 0 };
  for (const g of N.g) { g.spot = nearFree(sim, tg.t, 2); sim.goTo(g, g.spot, ACT.GATHER); }
  q.raided = sim.day; q.raids = (q.raids || 0) + 1; S.stats.raids = (S.stats.raids || 0) + 1;
  spend(sim, 4, 'raid');
  const x = at % MAP + .5, y = (at / MAP | 0) + .5, who = mode === 'guard' ? 'The guard will meet them unless you choose otherwise' : 'The colony has no guard, so nobody will stand in their way unless you call everyone out';
  sim.log(`${n} people from ${q.place} are coming in fast from the ${DIRS[q.dir]}, carrying poles and blades, and making for ${tg.name}. ${WHY[why](q, q.fed > 0)} ${who}: in the Neighbours window (V), send the guard, call out everyone who can fight, or keep everyone inside and let them take it.`, 'bad', { e: 'raid', lvl: 2, x, y, title: `Raiders from ${q.place}`, act: 'nb' });
  S.rv++;
}

// ---------- the player's calls ----------
export function raidMode(sim, m) {
  const P = sim.S.nb && sim.S.nb.party; if (!P || P.kind !== 'raid' || !['guard', 'all', 'hide'].includes(m)) return { ok: false };
  if (P.mode === m) return { ok: true };
  P.mode = m; sim.log(m === 'hide' ? 'Everyone is to stay inside and let the raiders take what they came for.' : m === 'all' ? 'Everyone who can fight is going out to meet the raiders.' : 'The guard is going out to meet the raiders; everyone else stays inside.');
  sim.S.rv++; return { ok: true };
}
export function setGuard(sim, id, on) { const c = sim.S.cols[id]; if (!c || c.dead) return { ok: false }; c.grd = !!on; sim.S.rv++; return { ok: true }; }
// the Seed picks a guard: about one in six of the able adults, the fit and the bold first, never the anxious or the careful unless there's nobody else
export function autoGuard(sim) {
  const S = sim.S, ok = S.cols.filter(c => fighter(c) || (!c.dead && c.life >= 4 && !c.retired));
  for (const c of S.cols) c.grd = false;
  const want = clamp(Math.round(ok.length / 6), 2, 8);
  const score = c => (c.cap ? (c.cap.move + c.cap.manip) / 2 : 1) * 100 - (c.traits.includes('anxious') ? 40 : 0) - (c.traits.includes('careful') ? 25 : 0) + (c.traits.includes('reckless') ? 15 : 0) + (c.traits.includes('steady') ? 15 : 0) - c.fat / 5 - (c.bd.ill.length ? 30 : 0);
  for (const c of ok.sort((a, b) => score(b) - score(a)).slice(0, want)) c.grd = true;
  S.rv++; return { ok: true };
}
// the hurt left behind: treated and sent home when they can walk, or turned away now
export function captives(sim, treat) {
  const S = sim.S, N = S.nb, P = N.party; if (!P || P.kind !== 'raid' || P.st !== 'held') return { ok: false };
  const q = N.list[P.nb], hurt = N.g.filter(g => g.down && !g.dead), names = list(hurt.map(g => g.name));
  if (treat) {
    const d = Math.min(hurt.length * 2, Math.floor(S.med.dress || 0)); S.med.dress -= d;
    q.trust = clamp(q.trust + 6 * hurt.length, -100, 100);
    sim.log(`The colony treated ${names}${d ? ` (${d} dressings)` : ''}, fed them, and let them go home. The people from ${q.place} will hear of it.`, 'good');
    for (const c of S.cols) if (!c.dead && c.life >= 4) remember(sim, c, `Saw the hurt raiders from ${q.place} treated and sent home.`);
  } else {
    q.trust = clamp(q.trust - 2 * hurt.length, -100, 100);
    sim.log(`${names} ${hurt.length === 1 ? 'was' : 'were'} sent away, limping, without help.`, 'bad');
  }
  goHome(sim, P, q, true);
  return { ok: true };
}

// ---------- what happens: every few seconds ----------
export function raidThink(sim) {
  const S = sim.S, N = S.nb, P = N.party, q = N.list[P.nb], K = KINDS[q.k], G = N.g;
  if (P.st === 'held') { for (const g of G) if (g.down) { g.act = ACT.DOWN; g.mv = 0; } if (S.tick >= P.until) { sim.log('Nobody decided what to do with the hurt raiders. They got up when they could and limped home.'); goHome(sim, P, q, true); } return; }
  if (P.st === 'go') { for (const c of S.cols) c.def = -1; return; }
  assign(sim, P);
  // blows: everyone standing next to a raider they were sent against
  const weak = hungry(sim, q) ? .85 : 1;
  for (const g of G) {
    if (g.down || g.out) continue;
    const foes = S.cols.filter(c => c.def === g.id && !c.dead && !c.down && Math.hypot(c.x - g.x, c.y - g.y) < 1.7);
    if (!foes.length) { if (g.eng && S.tick - g.eng > 60) { g.eng = 0; sim.goTo(g, g.spot, ACT.GATHER); } continue; }
    if (!g.eng) { const c0 = foes[0]; if (!P.fought) sim.log(`${c0.name} and ${g.name} of ${q.place} came to blows${P.st === 'come' ? ' before the raiders reached ' + P.tname : ''}.`, 'bad', { who: c0.id }); P.fought = 1; }
    g.eng = S.tick; g.mv = 0; g.wps = []; g.act = ACT.BRAWL; g.ang = Math.atan2(foes[0].y - g.y, foes[0].x - g.x);
    for (const c of foes) {
      c.mv = 0; c.wps = []; c.act = ACT.BRAWL; c.ang = Math.atan2(g.y - c.y, g.x - c.x); c.timer = Math.max(c.timer, 30);
      if (!g.down && rnd() < .3 * power(S, c)) { g.hp -= .12 + rnd() * .18; if (g.hp <= 0) fall(sim, P, q, g, c); }
    }
    if (g.down) continue;
    const c = foes[Math.floor(rnd() * foes.length)];
    if (rnd() < .26 * (K.raidPow ?? 1) * weak) hit(sim, c, g, q, P);
  }
  const up = G.filter(g => !g.down && !g.out);
  if (!up.length) { finish(sim, P, q); return; }
  // when the fight turns, they run
  const downN = G.filter(g => g.down).length, near = S.cols.filter(c => c.def >= 0 && !c.dead && !c.down && up.some(g => Math.hypot(c.x - g.x, c.y - g.y) < 6)).length;
  if (downN * 2 >= P.n || (near >= up.length * 2 && downN) || (near >= up.length * 3 && up.some(g => g.hp < .8))) { flee(sim, P, q, 'beaten'); return; }
  // taking what they came for
  if (P.st !== 'loot') return;
  let busy = 0;
  for (const g of up) {
    if (g.eng || g.mv || Math.hypot(g.x - (g.spot % MAP + .5), g.y - ((g.spot / MAP | 0) + .5)) > 3) { busy++; continue; }
    if (P.why === 'scan') {
      const p = S.projects.find(o => o.id === P.pid && !o.gone && o.done); if (!p) continue;
      g.act = ACT.BUILD; g.fx = p.x + p.w / 2; g.fy = p.y + p.h / 2; P.smash += .035; busy++;
      if (P.smash >= 1) { damage(sim, p, .7, 'raid'); sim.log(`The raiders from ${q.place} smashed the scanner.`, 'bad', { e: 'raidscan', lvl: 1, pid: p.id, title: 'The scanner smashed' }); flee(sim, P, q, 'done'); return; }
      continue;
    }
    if (P.why === 'hunger') {
      const n = Math.min(1.5, CARRY.meals - g.load, haveOf(sim, 'meals')); if (n > 0) { takeGood(sim, 'meals', n); g.load += n; P.took.meals = (P.took.meals || 0) + n; busy++; }
    } else {
      const k = LOOT.find(k => haveOf(sim, k) > 0), n = k ? Math.min(2, CARRY.loads - g.load, haveOf(sim, k)) : 0;
      if (n > 0) { takeGood(sim, k, n); g.load += n; P.took[k] = (P.took[k] || 0) + n; busy++; }
    }
    g.act = g.load >= (P.why === 'hunger' ? CARRY.meals : CARRY.loads) ? ACT.SACK : ACT.GATHER;
  }
  if (!busy || S.tick - P.lootAt > LOOT_H * HOUR) flee(sim, P, q, 'done');
}
// who goes out to meet them, and which raider each takes on: the nearest, spread so nobody faces three alone
function assign(sim, P) {
  const S = sim.S, up = S.nb.g.filter(g => !g.down && !g.out), F = sim.W.site.fire;
  const D = P.mode === 'hide' ? [] : S.cols.filter(c => fighter(c) && (P.mode === 'all' || c.grd || watchman(S, c)) && Math.hypot(c.x - F.x, c.y - F.y) < 140);
  // they meet the raiders near the camp, not out on the plain: until then they wait by what the raiders came for
  const tx = P.tgt % MAP, ty = P.tgt / MAP | 0, close = up.filter(g => Math.hypot(g.x - F.x, g.y - F.y) < RANGE || Math.hypot(g.x - tx, g.y - ty) < RANGE);
  const on = new Set(D);
  for (const c of S.cols) if (c.def >= 0 && (!on.has(c) || (c.def !== MUSTER && !close.some(g => g.id === c.def)))) c.def = -1;
  const n = {}; for (const c of D) if (c.def >= 0 && c.def !== MUSTER) n[c.def] = (n[c.def] || 0) + 1;
  for (const c of D) {
    if (c.def >= 0 && (c.def !== MUSTER || !close.length)) continue;
    if (c.def < 0) { c.plan = ''; c.job = ''; }   // drop what they were doing
    if (!close.length) { c.def = MUSTER; continue; }
    let best = close[0], bd = 1e9;
    for (const g of close) { const d = Math.hypot(g.x - c.x, g.y - c.y) + (n[g.id] || 0) * 15; if (d < bd) { bd = d; best = g; } }
    c.def = best.id; n[best.id] = (n[best.id] || 0) + 1; c.plan = ''; c.job = '';
  }
}
// how hard someone fights: their body first, then training in the watch, then temper
function power(S, c) {
  let p = c.cap ? (c.cap.move + c.cap.manip) / 2 : 1;
  if (watchman(S, c)) p *= 1.25; if (c.traits.includes('reckless')) p *= 1.15; if (c.traits.includes('careful')) p *= .85; if (c.fat > 75) p *= .85;
  return p;
}
function hit(sim, c, g, q, P) {
  const ws = injure(sim, c, 'raid', .06 + rnd() * .24, `fighting off the raiders from ${q.place}`);
  if (!ws.length) return;
  if (!P.hurt.includes(c.id)) P.hurt.push(c.id);
  sim.log(`${g.name} hurt ${c.name}: ${ws.map(w => woundText(w).toLowerCase()).join(', and ')}.`, 'bad', { who: c.id });
  scar(sim, c, 'raid', 18, `Was hurt fighting off the raiders from ${q.place}.`);
}
function fall(sim, P, q, g, c) {
  const S = sim.S;
  g.down = 1; g.mv = 0; g.wps = []; g.act = ACT.DOWN; g.eng = 0;
  if (rnd() < .08 + (c.traits.includes('reckless') ? .06 : 0) + Math.max(0, -g.hp) * .5) {
    g.dead = true; q.lost = (q.lost || 0) + 1; q.trust = clamp(q.trust - 12, -100, 100); S.stats.raidDead = (S.stats.raidDead || 0) + 1;
    sim.log(`${c.name} struck ${g.name} of ${q.place} down, and ${g.name} did not get up again.`, 'bad', { e: 'raidkill', lvl: 2, who: c.id, title: 'A raider killed' });
    scar(sim, c, 'kill', 40, `Killed ${g.name} of ${q.place} in the raid.`); remember(sim, c, `Killed ${g.name} of ${q.place} in the raid.`);
    for (const o of S.cols) if (!o.dead && o !== c && o.life >= 3 && Math.hypot(o.x - g.x, o.y - g.y) < 12) scar(sim, o, 'death', 15, `Saw ${g.name} of ${q.place} killed in the raid.`);
  } else sim.log(`${c.name} knocked ${g.name} of ${q.place} to the ground.`, '', { who: c.id });
}
function flee(sim, P, q, how) {
  const S = sim.S; P.st = 'go'; P.how = how;
  const at = entry(sim, q.dir);
  for (const g of S.nb.g) if (!g.down && !g.out) { g.eng = 0; g.spd = .16; sim.goTo(g, nearFree(sim, at, 3), ACT.IDLE, g.load ? ACT.SACK : ACT.WALK); }
  for (const c of S.cols) c.def = -1;
  const took = tookText(P);
  sim.log(how === 'beaten' ? `The raiders from ${q.place} broke and ran${took ? `, with ${took}` : ''}.` : P.why === 'scan' ? `The raiders from ${q.place} are leaving.` : `The raiders from ${q.place} are leaving with ${took || 'nothing'}.`, how === 'beaten' ? 'good' : 'bad');
  S.rv++;
}
const tookText = P => list(Object.entries(P.took).filter(([, n]) => n > 0).map(([k, n]) => k === 'meals' ? `${Math.round(n)} meals` : `${Math.round(n)} loads of ${k === 'rare' ? 'rare earths' : k}`));
// a raider got where they were going: the target, or the map's edge on the way home
export function raidArrive(sim, g) {
  const S = sim.S, P = S.nb.party; if (!P) return;
  if (P.st === 'go') { g.out = 1; g.act = ACT.IDLE; if (P.home) raidOut(sim); else if (S.nb.g.every(o => o.out || o.down)) finish(sim, P, S.nb.list[P.nb]); return; }
  if (g.down) return;
  // no way through from the edge: they find their own way in
  const tx = g.spot % MAP + .5, ty = (g.spot / MAP | 0) + .5;
  if (Math.hypot(g.x - tx, g.y - ty) > 25) { g.x = tx; g.y = ty; g.tile = g.spot; }
  g.act = ACT.GATHER;
  if (P.st === 'come') { P.st = 'loot'; P.lootAt = S.tick; sim.log(`The raiders from ${S.nb.list[P.nb].place} have reached ${P.tname}.`, 'bad', { x: g.x, y: g.y }); }
}
// the raid is over: what it cost, and what each side will remember
function finish(sim, P, q) {
  const S = sim.S, N = S.nb, hurt = N.g.filter(g => g.down && !g.dead), dead = N.g.filter(g => g.dead), took = tookText(P);
  for (const c of S.cols) c.def = -1;
  if (P.why === 'hunger' && (P.took.meals || 0) >= q.pop * .15) q.lean = -1;   // what they took sees them through
  if (P.how === 'done' && !P.fought) q.trust = clamp(q.trust + 4, -100, 100);
  else if (P.how === 'beaten' || !N.g.some(g => !g.down)) q.trust = clamp(q.trust - 5, -100, 100);
  const parts = [took ? `They took ${took}.` : 'They took nothing.', P.hurt.length ? `${P.hurt.length === 1 ? 'One person was' : P.hurt.length + ' people were'} hurt fighting them.` : '', dead.length ? `${dead.length === 1 ? 'One of them' : dead.length + ' of them'} died here.` : ''].filter(Boolean);
  sim.log(`The raid from ${q.place} is over. ${parts.join(' ')}`, P.how === 'beaten' ? 'good' : 'bad', { e: 'raidend', lvl: 1, title: 'The raid is over' });
  for (const c of S.cols) if (!c.dead && c.life >= 3) remember(sim, c, `Raiders from ${q.place} came for ${P.why === 'hunger' ? 'the food' : P.why === 'scan' ? 'the scanner' : 'what they could take'}.`);
  if (dead.length) sim.log(`The colony buried ${list(dead.map(g => g.name))} beyond the fields, where ${q.place} can find ${dead.length === 1 ? 'the grave' : 'the graves'}.`);
  N.g = N.g.filter(g => !g.dead);
  if (hurt.length) {
    P.st = 'held'; P.until = S.tick + DAY_TICKS; N.g = hurt; N.g.forEach((g, k) => { g.id = k; });
    sim.log(`${hurt.length === 1 ? `${hurt[0].name} was left behind, hurt.` : `${hurt.length} of the raiders were left behind, hurt: ${list(hurt.map(g => g.name))}.`} In the Neighbours window (V), treat them and send them home, or send them away now.`, '', { e: 'raidheld', lvl: 2, x: hurt[0].x, y: hurt[0].y, title: 'Raiders left behind', act: 'nb' });
    S.rv++; return;
  }
  endParty(sim);
}
function goHome(sim, P, q, slow) {
  const at = entry(sim, q.dir); P.st = 'go'; P.home = 1; P.how = P.how || 'done';
  for (const g of sim.S.nb.g) { g.down = 0; g.spd = slow ? .07 : .15; sim.goTo(g, nearFree(sim, at, 3), ACT.IDLE); }
  sim.S.rv++;
}
// once everyone has walked off the map after the captives were sent home, the party ends with no second report
export function raidOut(sim) { const P = sim.S.nb.party; if (P && P.kind === 'raid' && P.home && sim.S.nb.g.every(g => g.out)) endParty(sim); }

// Medicine: first aid where someone fell, carrying the downed to a bed, and treatment by whoever has the most
// medicine skill to hand. Diagnosis is a belief: a medic finds hidden injuries only with skill and luck, and the
// page shows what the colony knows, never the truth. Supplies come from the lander's kit and the fabricator;
// when there are more patients than medics, the clinic's triage rule decides who goes first.
import { MAP, HOUR, ACT, hidden } from './consts.js';
import { rnd, clamp } from './rng.js';
import { ailing, danger, downed, laidUp, needs, capOf, woundText, PART } from './body.js';
import { byId, built, capOf as bCap } from './build.js';
import { remember } from './life.js';
import { dropCarry } from './work.js';
import { diagnose, illMeal } from './illness.js';
import { eat } from './food.js';
import { spend } from './director.js';

export const MED_KIT = { dress: 24, pk: 16, abx: 8, blood: 6 };          // what the lander carried down
export const MED_MADE = { dress: 8, pk: 4, abx: 2, blood: 2 };           // one batch from the fabricator
export const MED_NAME = { dress: 'dressings', pk: 'painkillers', abx: 'antibiotic courses', blood: 'units of blood substitute' };
export const TRIAGE = { worst: 'Worst first', likely: 'Most likely to live first', leads: 'Crew leads first' };
const DUR = { exam: .2, close: .5, dress: .5, set: .8, surgery: 2, abx: .15, shock: .4, pk: .1, dx: .3, nurse: .6 };   // hours, for a practised medic
const TEXT = {
  close: (o, c, w) => `${o} cleaned and closed ${c}'s ${w}`, dress: (o, c, w) => `${o} cleaned and dressed ${c}'s ${w}`, set: (o, c, w) => `${o} set ${c}'s ${w}`,
  surgery: (o, c, w) => `${o} operated on ${c}: ${w}`, abx: (o, c) => `${o} started ${c} on a course of antibiotics`, shock: (o, c) => `${o} treated ${c} for shock`, pk: (o, c) => `${o} gave ${c} painkillers`,
  nurse: (o, c) => `${o} sat with ${c} through the worst of the fever, with water and cool cloths`, dx: (o, c) => `${o} examined ${c} again`,
};
export const MEDIC = 1.5;                                               // the medicine skill to treat anyone

const live = S => S.cols.filter(c => !c.dead);
const medEff = o => (.5 + o.skills.medicine * .06) * (o.fat > 75 ? .8 : 1) * (.4 + .6 * capOf(o, 'manip'));
const inside = c => c.where >= 0 && (c.act === ACT.INDOORS || c.act === ACT.INSIDE);
const atClinic = (S, c) => { const p = inside(c) ? byId(S, c.where) : null; return !!p && p.type === 'clinic'; };
// can this person help someone else right now? emergency: wake them if they are asleep
function free(c, emergency) {
  if (c.dead || c.down || c.care || c.carried >= 0 || c.alone > 0 || c.act === ACT.WAKE || c.plan === 'ward') return false;
  if (c.cap && (laidUp(c) || c.cap.consc < .6)) return false;
  if ((c.act === ACT.BED || c.act === ACT.INSIDE) && !emergency) return false;
  return true;
}
const near = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

// ---------- every couple of minutes: who is hurt, who goes to them ----------
export function careThink(sim) {
  const S = sim.S, all = live(S), C = S.care;
  C.medics = all.filter(o => o.skills.medicine >= MEDIC && !(o.cap && laidUp(o))).length;
  const scene = [], beds = [];
  for (const c of all) {
    if (!ailing(c.bd)) { if (c.down) getUp(sim, c); c.waitSince = 0; c.passed = false; continue; }
    const d = downed(c);
    if (d && !c.down) fallDown(sim, c); else if (!d && c.down && c.carried < 0) getUp(sim, c);
    const out = !hidden(c.act) && c.act !== ACT.BED;
    if (out && c.aidBy < 0 && c.carried < 0 && (c.down || c.bd.w.some(w => w.kn && w.bl > .02 && !w.aid))) scene.push(c);
    else if (c.medBy < 0 && c.carried < 0 && !c.mv && (c.job === 'ward' || c.down) && needs(c, sim).length) beds.push(c);
    else if (c.medBy < 0) c.waitSince = 0;
  }
  // first aid: the nearest pair of hands, a medic's if there is one close
  scene.sort((a, b) => danger(b) - danger(a));
  for (const c of scene) {
    const em = c.down || danger(c) > .35;
    let best = null, bs = 1e9;
    for (const o of all) { if (o === c || !free(o, em)) continue; const d = near(o, c); if (d > 200) continue; const s = d - o.skills.medicine * 8; if (s < bs) { bs = s; best = o; } }
    if (best) begin(sim, best, 'aid', c);
  }
  // treatment, in the order the triage rule says
  const key = c => C.triage === 'leads' ? (S.crews.some(k => k.lead === c.id) ? 2 : 0) + danger(c) : C.triage === 'likely' ? (danger(c) > .85 ? -1 : danger(c)) : danger(c);
  beds.sort((a, b) => key(b) - key(a));
  for (const c of beds) {
    const urgent = danger(c) > .3;
    let best = null, bs = -1e9;
    for (const o of all) {
      if (o === c || !free(o, urgent) || (o.skills.medicine < MEDIC && !urgent)) continue;
      const cr = o.crew >= 0 ? S.crews[o.crew] : null, s = o.skills.medicine * 10 - near(o, c) / 15 + (cr && cr.work === 'clinic' ? 25 : 0) - (o.act === ACT.BED || o.act === ACT.INSIDE ? 15 : 0);
      if (s > bs) { bs = s; best = o; }
    }
    if (best) begin(sim, best, 'treat', c);
    else if (!c.passed && c.waitSince && S.tick - c.waitSince > 3 * HOUR && beds.some(o => o.medBy >= 0)) {
      c.passed = true; c.str = Math.min(100, c.str + 5);
      remember(sim, c, 'Lay waiting for a medic while others were seen first.');
      for (const id in c.ties) { const o = S.cols[id]; if (c.ties[id].k === 'friend' && o && !o.dead) { o.str = Math.min(100, o.str + 2); remember(sim, o, `Watched ${c.name} wait a long time for a medic.`); } }
    }
    if (!c.waitSince) c.waitSince = S.tick;
  }
}
function fallDown(sim, c) {
  c.down = true; dropCarry(sim, c); spend(sim, 1, 'down');
  if (c.care) endCare(sim, c);
  const asleep = c.act === ACT.BED || hidden(c.act);
  c.plan = 'down'; c.job = 'down'; c.mv = 0; c.timer = 0; c.wps = []; c.leg = [];
  if (!asleep) c.act = ACT.DOWN;
  const how = c.cap.consc < .3 ? 'unconscious' : c.bd.pain > 1.25 ? 'in too much pain to stand' : 'unable to walk';
  if (!asleep) sim.log(`${c.name} is down, ${how}.`, 'bad', { e: 'down', lvl: 1, who: c.id, title: `${c.name} is down` });
}
function getUp(sim, c) { c.down = false; if (c.plan === 'down') { c.plan = ''; c.job = ''; } if (c.act === ACT.DOWN) c.act = ACT.IDLE; }

// ---------- a helper's job ----------
function begin(sim, o, k, c) {
  const S = sim.S;
  if ((o.act === ACT.BED || o.act === ACT.INSIDE) && o.woke !== c.id + ':' + sim.day) { o.woke = c.id + ':' + sim.day; sim.log(`${o.name} was woken to help ${c.name}.`, '', { who: o.id }); }
  dropCarry(sim, o);
  o.care = { k, who: c.id }; o.plan = 'care'; o.job = ''; o.where = -1;
  if (k === 'aid') c.aidBy = o.id; else c.medBy = o.id;
  goToPatient(sim, o, c);
  S.rv++;
}
export function goToPatient(sim, o, c) {
  o.job = o.care.k;
  if (inside(c)) { const p = byId(sim.S, c.where); if (p) { o.ws = p.id; sim.goTo(o, sim.doorOf(p), ACT.INDOORS); return; } }
  sim.goTo(o, besideTile(sim, c), ACT.TEND);
}
function besideTile(sim, c) {
  const W = sim.W, x = Math.floor(c.x), y = Math.floor(c.y);
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, -1]]) { const t = (y + dy) * MAP + x + dx; if (W.reach[t] && W.cost[t]) return t; }
  return y * MAP + x;
}
export function endCare(sim, o) {
  const S = sim.S, k = o.care; if (!k) return;
  const c = S.cols[k.who];
  if (c) { if (c.aidBy === o.id) c.aidBy = -1; if (c.medBy === o.id) c.medBy = -1; if (c.carried === o.id) { c.carried = -1; if (!c.dead) c.act = ACT.DOWN; } }
  o.care = null; o.plan = ''; o.job = ''; o.where = -1; o.ws = -1; o.timer = 0; S.rv++;
}
const gone = (S, o) => { const c = S.cols[o.care.who]; return !c || c.dead ? null : c; };
export function careArrive(sim, o) {
  const S = sim.S, c = o.care && gone(S, o);
  if (!c) { endCare(sim, o); return; }
  if (o.job === 'carry') { deliver(sim, o, c); return; }
  if (inside(c) && o.act === ACT.INDOORS) o.where = c.where;
  else if (near(o, c) > 2.5) { goToPatient(sim, o, c); return; }   // they moved: follow
  if (o.act === ACT.TEND) sim.face(o, c.x, c.y);
  o.timer = Math.max(30, Math.round((o.job === 'aid' ? .3 : DUR.exam) * HOUR / medEff(o)));
  o.care.step = o.job === 'aid' ? 'aid' : 'exam';
}
export function careTimer(sim, o) {
  const S = sim.S, c = o.care && gone(S, o);
  if (!c) { endCare(sim, o); return; }
  if (o.job === 'aid') { firstAid(sim, o, c); return; }
  if (o.care.step === 'exam') exam(sim, o, c);
  else treat(sim, o, c, o.care.step);
  // the next thing that needs doing, while the medic is here
  // surgery away from a clinic is a last resort: only when there is no clinic to take them to
  const n = needs(c, sim).find(q => q.k !== 'surgery' || atClinic(S, c) || (!restFor(sim, c).ward && danger(c) > .4));
  if (!n || (!c.down && c.job !== 'ward')) {
    if (needs(c, sim).some(q => q.k === 'surgery') && !atClinic(S, c)) note(sim, c, 'surgery', `${o.name} thinks ${c.name} is bleeding inside and needs surgery, which goes far better in a clinic.`);
    endCare(sim, o); return;
  }
  o.care.step = n.k; o.care.w = n.w;
  o.timer = Math.max(30, Math.round(DUR[n.k] * HOUR / medEff(o)));
}
// once per person per kind, so the log isn't flooded
function note(sim, c, k, m) { c.said = c.said || {}; if (c.said[k] === c.bd.wid) return; c.said[k] = c.bd.wid; sim.log(m, 'bad', { who: c.id }); }

// pressure on the bleeding, a splint, and then a bed
function firstAid(sim, o, c) {
  const S = sim.S, f = clamp(.5 + o.skills.medicine * .04, .5, .9) * (.5 + .5 * capOf(o, 'manip'));
  for (const w of c.bd.w) if (w.kn) { if (w.bl > 0) w.bl *= 1 - f; w.aid = true; }
  grow(o, .03);
  if (c.down && !hidden(c.act) && c.act !== ACT.BED) {
    const dest = restFor(sim, c);
    o.care.k = 'carry'; o.job = 'carry'; o.care.dest = dest; c.carried = o.id; c.aidBy = -1;
    sim.log(`${o.name} gave ${c.name} first aid and is carrying them to ${dest.p ? dest.p.name : 'their bedroll'}.`, '', { who: c.id });
    sim.goTo(o, dest.p ? sim.doorOf(dest.p) : c.slot, ACT.IDLE, ACT.DRAG);
    return;
  }
  sim.log(`${o.name} gave ${c.name} first aid.`, '', { who: c.id });
  c.plan = ''; endCare(sim, o);
}
// where someone hurt should lie: a clinic bed with power, else their own bunk, else their bedroll
export function restFor(sim, c) {
  const S = sim.S;
  for (const p of built(S)) {
    if (p.type !== 'clinic' || !p.powered) continue;
    let used = 0; for (const o of S.cols) if (o !== c && !o.dead && o.ward === p.id) used++;
    if (used < bCap(p).beds) return { p, ward: true };
  }
  const h = c.home >= 0 ? byId(S, c.home) : null;
  return h && h.done && h.powered ? { p: h, ward: false } : { p: null, ward: false };
}
function deliver(sim, o, c) {
  const d = o.care.dest || restFor(sim, c);
  c.carried = -1;
  if (d.p) { const t = sim.doorOf(d.p); c.x = t % MAP + .5; c.y = (t / MAP | 0) + .5; c.tile = t; c.where = d.p.id; c.act = d.ward ? ACT.INDOORS : ACT.INSIDE; if (d.ward) c.ward = d.p.id; }
  else { const t = c.slot; c.x = t % MAP + .5; c.y = (t / MAP | 0) + .5; c.tile = t; c.act = ACT.BED; }
  c.job = c.down ? 'down' : 'ward'; c.mv = 0;
  endCare(sim, o);
}
// a medic looks someone over and may find what they hadn't seen
function exam(sim, o, c) {
  const S = sim.S, pf = clamp(.3 + o.skills.medicine * .07, .3, .95) * (atClinic(S, c) ? 1 : .7) * (o.fat > 75 ? .8 : 1);
  c.bd.ex = { by: o.name, t: S.tick, conf: Math.round(pf * 100) };
  for (const w of c.bd.w) {
    const hid = !w.kn ? 'kn' : w.ib && !w.ikn ? 'ikn' : '';
    if (!hid || rnd() >= pf) continue;
    w[hid] = true;
    sim.log(`${o.name} examined ${c.name} and found what nobody had seen: ${woundText(w, hid === 'ikn').toLowerCase()}.`, 'bad', { e: 'hidden', lvl: 1, who: c.id, title: 'A hidden injury' });
  }
  diagnose(sim, o, c, pf, atClinic(S, c));
  grow(o, .02);
}
function treat(sim, o, c, k) {
  const S = sim.S, M = S.med, b = c.bd, w = b.w.find(q => q.id === o.care.w), clinic = atClinic(S, c);
  const night = (sim.hour >= sim.dusk || sim.hour < sim.dawn) && !inside(c);
  let p = (.45 + o.skills.medicine * .055) * (clinic ? 1 : .8) * (o.fat > 75 ? .85 : 1) * (.4 + .6 * capOf(o, 'manip')) * (night ? .8 : 1);
  const use = s => { if (M[s] > 0) { M[s]--; S.rv++; return true; } return false; };
  let ok = true, m = '';
  switch (k) {
    case 'close': case 'dress': {
      if (!w) return;
      const kit = use('dress'); if (!kit) p *= .85;
      ok = rnd() < p + .2 + (w.tr || 0) * .15;   // a second go goes better: they know what went wrong
      if (ok) { w.closed = true; w.bl = 0; w.dirt = kit ? .04 : .15; w.inf *= .8; }
      else { w.bl *= .5; w.tr = (w.tr || 0) + 1; m = w.tr > 1 ? ` It still didn't hold.` : ` It didn't hold well: it will need doing again.`; }
      if (!kit) m += ' There were no dressings left, so it was done with whatever was clean.';
      break;
    }
    case 'set':
      if (!w) return;
      ok = rnd() < p; w.set = ok ? 1 : -1;
      if (!ok) m = ' It was hard to get straight, and may heal crooked.';
      break;
    case 'surgery':
      if (!w) return;
      ok = rnd() < p * (clinic ? .75 : .3);
      if (ok) w.ib = 0; else { if (w.p === PART.head) w.pr = Math.min(1, (w.pr || 0) + .03); else { w.s = Math.min(1, w.s + .1); b.blood -= .06; } m = ' The bleeding isn’t stopped yet.'; }
      break;
    case 'abx':
      if (!use('abx')) { note(sim, c, 'abx', `${c.name} has an infection and there are no antibiotics left.`); return; }
      b.abx = 4; for (const q of b.ill) if (q.st) q.tried = true;
      break;
    case 'dx': exam(sim, o, c); return;
    case 'nurse': b.nu = 5; if (b.nuSaid === b.ill.length + ':' + c.bd.hx.length) { grow(o, .03); return; } b.nuSaid = b.ill.length + ':' + c.bd.hx.length; break;
    case 'shock':
      if (use('blood')) { b.blood = Math.min(1, b.blood + .22); b.st = 6; }
      else { b.st = 3; m = ' There was no blood substitute, only warmth and fluids.'; }
      break;
    case 'pk':
      if (!use('pk')) return;
      b.pk = 8; break;
  }
  grow(o, k === 'surgery' ? .12 : .05);
  S.stats.treated = (S.stats.treated || 0) + 1;
  const what = w ? woundText(w, k === 'surgery').toLowerCase() : '', first = !S.care.first; S.care.first = 1;
  sim.log(`${TEXT[k](o.name, c.name, what)}${!clinic && (k === 'surgery' || k === 'set') ? ', without a clinic' : ''}.${m}`, ok ? '' : 'bad', first ? { e: 'treated', lvl: 1, who: c.id, title: 'The first treatment' } : { who: c.id });
  if (k === 'set') remember(sim, c, ok ? `${o.name} set a broken bone for them.` : `${o.name} set a broken bone for them, but it didn't go straight.`);
  if (k === 'surgery' && ok) remember(sim, c, `${o.name} operated on them and stopped a bleed inside.`);
}
const grow = (o, v) => { o.skills.medicine = Math.min(10, Math.round((o.skills.medicine + v) * 1000) / 1000); };

// ---------- supper for the bedridden: brought to them where they lie ----------
export function feedPatients(sim) {
  const S = sim.S;
  for (const c of S.cols) {
    if (c.dead || c.carried >= 0 || c.ate === sim.day || !(c.plan === 'ward' || c.down)) continue;
    c.ate = sim.day;
    const got = eat(sim, c);
    if (got) { c.meal = got; c.hungry = false; if (got !== 'ration') S.stats.meals++; illMeal(sim, c, 'w' + (c.ward >= 0 ? c.ward : c.home), got); }
    else c.hungry = true;
  }
}

// ---------- a carried person goes where their carrier goes, just behind them ----------
export function follow(sim, c) {
  const h = sim.S.cols[c.carried];
  if (!h || h.dead || !h.care || h.care.k !== 'carry') { c.carried = -1; c.act = ACT.DOWN; return; }
  c.x = h.x - Math.cos(h.ang) * .75; c.y = h.y - Math.sin(h.ang) * .75; c.ang = h.ang;
  const t = Math.floor(c.y) * MAP + Math.floor(c.x); if (t >= 0 && t < MAP * MAP) c.tile = t;
  c.act = ACT.DOWN; c.moving = 0;
}

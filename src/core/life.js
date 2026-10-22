// How a person lives a day: when they sleep, work, eat and rest, and the three states of mind that rise and
// fall for reasons you can trace (fatigue, strain, trust in the Seed), the ties they form, and what breaks.
import { MAP, HOUR, DAY_TICKS, ACT, SHIFTS, DUSK, DAWN } from './consts.js';
import { rnd, ri, clamp } from './rng.js';
import { shelterNext, surveyJoin } from './work.js';

const WORKING = a => a === ACT.BUILD || a === ACT.CARRY || a === ACT.SURVEY || a === ACT.PLANT;
const CLASH = [['stubborn', 'stubborn'], ['reckless', 'careful'], ['sociable', 'solitary'], ['restless', 'patient']];
export const remember = (sim, c, m) => { c.mem.push({ d: sim.day, m }); if (c.mem.length > 24) c.mem.splice(2, 1); };

// ---------- what someone wants to be doing right now ----------
export function want(sim, c) {
  const S = sim.S, h = sim.hour, cr = c.crew >= 0 ? S.crews[c.crew] : null, sh = cr ? SHIFTS[cr.shift] : SHIFTS[1];
  if (c.act === ACT.WAKE && c.timer > 0) return 'wake';
  if (c.alone > 0) return 'alone';
  if (h >= c.bed || h < sh.a - .7) return 'sleep';
  if (cr && cr.work !== 'rest' && h >= sh.a && h < endOf(c, sh)) {
    const off = h >= 16.5 ? 'eat' : 'idle';
    if (c.fat >= 90 && cr.rules.rest) return off;
    if (cr.work === 'survey' && (cr.recalled || c.escort === sim.day)) return off;
    if (cr.work === 'shelter' && S.shelter.done) return 'idle';
    return 'work';
  }
  return h >= 17 ? 'eat' : 'idle';
}
// people who no longer trust the Seed go home at the end of a normal day, whatever the shift says
const endOf = (c, sh) => c.tru < 35 && sh.b > 18 ? 18 : sh.b;

export function think(sim, c) {
  if (c.dead) return;
  const w = want(sim, c);
  if (w === c.plan) {
    // a job that ran out of steps starts its next one
    if (w === 'work' && c.mv === 0 && c.timer <= 0 && !c.job) start(sim, c, w);
    else if (w === 'idle' && c.mv === 0 && c.act === ACT.IDLE && rnd() < .04) idleAt(sim, c);
    return;
  }
  start(sim, c, w);
}
function start(sim, c, w) {
  const S = sim.S, W = sim.W;
  if (c.job === 'plant') S.seedc.stakes++;   // a stake that never got planted goes back to the lander
  c.plan = w; c.job = ''; c.timer = 0;
  if (w === 'wake') return;
  if (w === 'sleep') {
    const inside = S.shelter.done && S.shelter.beds.includes(c.id);
    c.job = 'sleep';
    if (inside) sim.goTo(c, sim.doorTile, ACT.INSIDE, ACT.WALK); else sim.goTo(c, c.slot, ACT.BED, ACT.WALK);
    if (c.mv) c.act = ACT.TOBED;
  } else if (w === 'eat') { c.job = 'eat'; sim.goTo(c, c.seat, ACT.EAT); }
  else if (w === 'idle') idleAt(sim, c);
  else if (w === 'alone') {
    const L = W.land;
    for (let k = 0; k < 30; k++) { const a = rnd() * 6.283, r = 14 + rnd() * 6, x = Math.floor(L.x + Math.cos(a) * r), y = Math.floor(L.y + Math.sin(a) * r), t = y * MAP + x; if (W.reach[t] && W.cost[t] && W.cost[t] < 15) { c.job = 'alone'; sim.goTo(c, t, ACT.ALONE); return; } }
    c.act = ACT.ALONE;
  } else if (w === 'work') {
    const cr = S.crews[c.crew];
    const ok = cr.work === 'shelter' ? shelterNext(sim, c) : cr.work === 'survey' ? surveyJoin(sim, c, cr) : false;
    if (!ok) { c.plan = 'idle'; idleAt(sim, c); }
  }
}
function idleAt(sim, c) {
  const W = sim.W, L = W.land;
  for (let k = 0; k < 20; k++) {
    const a = rnd() * 6.283, r = 5 + rnd() * 6, x = Math.floor(L.x + Math.cos(a) * r), y = Math.floor(L.y + Math.sin(a) * r), t = y * MAP + x;
    if (W.reach[t] && W.cost[t] && W.cost[t] < 15 && !sim.nearPlot(x, y, 0)) { c.job = 'idle'; sim.goTo(c, t, ACT.IDLE); return; }
  }
  c.act = ACT.IDLE;
}

// ---------- the mind, every couple of game minutes ----------
export function mindTick(sim, c) {
  if (c.dead) return;
  const S = sim.S, dt = 30 / HOUR, h = sim.hour, has = t => c.traits.includes(t), a = c.act;
  const asleep = a === ACT.BED || a === ACT.INSIDE, working = WORKING(a);
  const cr = c.crew >= 0 ? S.crews[c.crew] : null, lead = cr && cr.lead >= 0 && cr.lead !== c.id ? S.cols[cr.lead] : null;
  const L = sim.W.land, dCamp = Math.hypot(c.x - L.x, c.y - L.y), night = h >= DUSK || h < DAWN;
  // what they see: everyone outside reports to the Seed; a surveyor looks harder
  if (!asleep) sim.reveal(c.x, c.y, a === ACT.SURVEY || a === ACT.PLANT ? 10 : 6);
  // fatigue: work and walking tire, sleep restores, a bed restores more than the ground
  let f = asleep ? (a === ACT.INSIDE ? -9.5 : -6.5) : a === ACT.BUILD ? 3.6 : a === ACT.CARRY ? 3.3 : working ? 2.8 : c.moving ? 2.4 : a === ACT.EAT ? .3 : .8;
  if (f > 0) { if (c.fresh > 0) f *= 1.6; if (has('patient')) f *= .9; if (c.hurt > 0) f *= 1.2; if (c.hungry) f += 1; }
  c.fat = clamp(c.fat + f * dt, 0, 100);
  // strain: gains and reliefs per hour
  let g = 0, rel = .15;
  if (a === ACT.BED) g += 1.7;                                  // a bedroll on open ground, on a strange world
  if (c.fresh > 0 && !asleep) g += .35;                          // a body that doesn't feel like theirs yet
  if (a === ACT.INSIDE) rel += .6;
  if (working && c.fat > 70) g += .3 + 1.2 * (c.fat - 70) / 30;
  if (working && c.worked > 11 * HOUR) g += 1.5;
  if (night && !asleep && dCamp > 25) { g += has('anxious') ? 4.5 : has('reckless') ? 1.5 : 3; c.dark = 1; }
  if (!asleep && dCamp > 20 && !anyoneNear(S, c, 8)) g += has('sociable') ? 1.6 : has('solitary') ? .25 : .8;
  if (a === ACT.EAT) { const n = countNear(S, c, 4.5); if (n >= 2) rel += has('sociable') ? 2.4 : has('solitary') ? 1 : 1.6; if (n > 14 && has('solitary')) g += .8; }
  for (const id in c.ties) {
    const t = c.ties[id], o = S.cols[id]; if (!t.k || !o || o.dead || asleep) continue;
    if (Math.abs(o.x - c.x) > 6 || Math.abs(o.y - c.y) > 6) continue;
    if (t.k === 'friend') rel += .5; else if (t.k === 'rival') g += .5;
  }
  if (c.hungry) g += 2; if (c.hurt > 0) g += .3;
  if (has('anxious')) g *= 1.3; if (has('steady')) g *= .75; if (has('cheerful')) rel *= 1.4;
  if (lead && working) g *= 1.1 - lead.skills.leadership * .03;
  c.str = clamp(c.str + (g - rel) * dt, 0, 100);
  bonds(sim, c, dt, working);
  // breaking down: at the far end of strain, people stop and walk off to be alone for a while
  if (c.alone > 0) { c.alone -= 30; if (c.alone <= 0) { c.alone = 0; c.str = Math.max(0, c.str - 20); sim.log(`${c.name} came back to camp.`); } }
  else if (c.str >= 85 && !asleep && rnd() < .15 * dt) {
    c.alone = ri(4, 7) * HOUR; c.tru = Math.max(0, c.tru - 3); S.stats.breakdowns++;
    sim.log(`${c.name} broke down and walked off to be alone.`, 'bad'); remember(sim, c, 'Broke down and walked away from everyone for a few hours.');
  }
  // the body
  if (c.fresh > 0) { c.fresh -= 30; if (c.fresh <= 0) remember(sim, c, 'Stopped feeling like a stranger in this body.'); }
  if (c.hurt > 0) c.hurt -= 30;
  if (c.hungry) { c.hp -= 3 / 24 * dt; if (c.hp <= 0) die(sim, c, 'starved'); }
  else if (c.hp < 100) c.hp = Math.min(100, c.hp + 6 / 24 * dt);
  // practice
  if (working) c.worked += 30;
  if (a === ACT.BUILD) { grow(c, 'building', .02 * dt); grow(c, 'engineering', .01 * dt); }
  if (a === ACT.SURVEY) grow(c, 'fieldcraft', .02 * dt);
  if (working && cr && cr.lead === c.id) grow(c, 'leadership', .006 * dt);
  // accidents: exhausted or careless hands on a building site
  if (a === ACT.BUILD) {
    let p = c.fat > 85 ? .03 : .002; if (has('reckless')) p += .01; if (has('careful')) p *= .3; if (c.fresh > 0) p *= 1.5;
    if (rnd() < p * dt) {
      c.hurt = 2 * DAY_TICKS; c.hp = Math.max(5, c.hp - 15); c.str = Math.min(100, c.str + 6); S.stats.accidents++;
      sim.log(`${c.name} was hurt on the building site${c.fat > 85 ? ', working while exhausted' : ''}.`, 'bad'); remember(sim, c, 'Got hurt putting up the shelter.');
    }
  }
}
function anyoneNear(S, c, r) { for (const o of S.cols) if (o !== c && !o.dead && o.act !== ACT.INSIDE && Math.abs(o.x - c.x) < r && Math.abs(o.y - c.y) < r) return true; return false; }
function countNear(S, c, r) { let n = 0; for (const o of S.cols) if (o !== c && o.act === ACT.EAT && Math.abs(o.x - c.x) < r && Math.abs(o.y - c.y) < r) n++; return n; }
const grow = (c, k, v) => { c.skills[k] = Math.min(10, Math.round((c.skills[k] + v) * 1000) / 1000); };

// ---------- ties: working and eating together makes people familiar; temperament decides the rest ----------
function bonds(sim, c, dt, working) {
  const S = sim.S;
  let near = null;
  if (working && c.crew >= 0) near = S.crews[c.crew].members.map(i => S.cols[i]).filter(o => o !== c && !o.dead && Math.hypot(o.x - c.x, o.y - c.y) < 6);
  else if (c.act === ACT.EAT) { near = []; for (const o of S.cols) if (o !== c && o.act === ACT.EAT && Math.hypot(o.x - c.x, o.y - c.y) < 4) near.push(o); }
  if (!near || !near.length) return;
  const rate = working ? 1 : .6;
  for (const o of near) {
    const t = c.ties[o.id] || (c.ties[o.id] = { f: 0, a: 0, k: null });
    t.f = Math.min(100, t.f + rate * dt);
    let da = .5;
    for (const [x, y] of CLASH) if ((c.traits.includes(x) && o.traits.includes(y)) || (c.traits.includes(y) && o.traits.includes(x))) da -= 1.3;
    if (c.traits.some(k => o.traits.includes(k)) && !c.traits.includes('stubborn')) da += .5;
    if (c.traits.includes('cheerful') || o.traits.includes('cheerful')) da += .3;
    if (c.str > 60 || o.str > 60) da -= 1.2;   // tempers fray
    t.a = clamp(t.a + da * dt, -100, 100);
    const k = t.a >= 25 && t.f >= 30 ? 'friend' : t.a <= -25 && t.f >= 15 ? 'rival' : t.k === 'friend' && t.a > 10 ? 'friend' : t.k === 'rival' && t.a < -10 ? 'rival' : null;
    if (k !== t.k) {
      t.k = k;
      if (k && c.id < o.id) {
        S.stats[k === 'friend' ? 'friends' : 'rivals']++;
        sim.log(k === 'friend' ? `${c.name} and ${o.name} have become friends.` : `${c.name} and ${o.name} can't stand each other.`, k === 'friend' ? 'good' : 'bad');
        remember(sim, c, k === 'friend' ? `Became friends with ${o.name}.` : `Fell out with ${o.name}.`); remember(sim, o, k === 'friend' ? `Became friends with ${c.name}.` : `Fell out with ${c.name}.`);
      }
    }
  }
}

// ---------- once a day, before dawn: how the day went, and what it did to trust ----------
export function daily(sim, c) {
  if (c.dead) return;
  const S = sim.S, has = t => c.traits.includes(t), k = has('stubborn') ? .6 : 1;
  let d = 0;
  if (c.act === ACT.BED && sim.day >= 3) d -= has('steady') ? .4 : .8;          // still sleeping on the ground
  if (c.worked > 12 * HOUR) d -= has('patient') ? 1.2 : 2.5; else if (c.worked > 0 && c.worked <= 8 * HOUR) d += .3;
  if (c.dark) { d -= 3; S.stats.darkReturns++; }
  if (c.hungry) d -= 2;
  c.tru = clamp(c.tru + d * k, 0, 100);
  c.worked = 0; c.dark = 0;
  // keep only the ties that matter
  const ids = Object.keys(c.ties);
  if (ids.length > 10) { ids.sort((a, b) => (c.ties[b].k ? 200 : 0) + c.ties[b].f - (c.ties[a].k ? 200 : 0) - c.ties[a].f); for (const id of ids.slice(10)) delete c.ties[id]; }
}
// trust moves for the whole colony at once when something the Seed planned works out
export function trustAll(sim, v, why) {
  for (const c of sim.S.cols) if (!c.dead) { c.tru = clamp(c.tru + v * (c.traits.includes('stubborn') ? .6 : 1), 0, 100); if (why) remember(sim, c, why); }
}
function die(sim, c, why) {
  c.dead = true; c.act = ACT.IDLE; c.mv = 0; sim.S.stats.deaths++;
  sim.log(`${c.name} died${why === 'starved' ? ' of hunger' : ''}.`, 'bad');
  for (const o of sim.S.cols) if (!o.dead) { const t = o.ties[c.id]; o.str = Math.min(100, o.str + (t && t.k === 'friend' ? 25 : 8)); if (t && t.k) remember(sim, o, `Lost ${c.name}.`); }
  const cr = c.crew >= 0 ? sim.S.crews[c.crew] : null;
  if (cr) { cr.members = cr.members.filter(i => i !== c.id); if (cr.lead === c.id) cr.lead = cr.members[0] ?? -1; }
  sim.S.rv++;
}

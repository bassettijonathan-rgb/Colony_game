// A lifetime in the body (bodies, layer 2). Slow damage piles up for years in running totals: radiation from time
// under this sun, the diet load of food not yet fully understood, sleep debt, wear on joints and back, and dust and
// smoke in the lungs. Chronic illness comes out of those totals together with age and family history, never from a
// plain roll: a quarrier's lungs give out sooner than a cook's. The body peaks around thirty and slows after, a
// printed body can carry small flaws from the fabricator, and check-ups at the clinic find what is coming before it
// shows. A chronic condition is a lasting mark on a part, so the capacities and pain already count it.
import { YEAR_DAYS, DAY_TICKS, ACT, hidden } from './consts.js';
import { rnd, clamp, lcg } from './rng.js';
import { PART, PARTS, laidUp } from './body.js';
import { remember, die } from './life.js';
import { built } from './build.js';

const yrs = (sim, c) => (sim.S.tick / DAY_TICKS - c.born) / YEAR_DAYS;
export const SLOW = ['rad', 'diet', 'sleep', 'joint', 'lung'];
export const SLOW_NAME = { rad: 'Radiation dose', diet: 'Diet load', sleep: 'Sleep debt', joint: 'Wear on joints and back', lung: 'Dust and smoke in the lungs' };
export const GENES = ['heart', 'lungs', 'joints', 'kidney', 'growth'];

// ---------- what a body starts with ----------
// family risks, from the stored genome (no draw from the main stream), and how much it takes before each condition shows
function seedBody(c, gn) {
  const b = c.bd, r = lcg((c.look || 1) * 7 + 3);
  b.sl = { rad: 0, diet: 0, sleep: 0, joint: 0, lung: 0 };
  b.gn = gn || Object.fromEntries(GENES.map(k => [k, Math.round(((r() + r()) / 2 - .4) * 50) / 100]));   // mostly near zero, some a real risk
  b.th = Object.fromEntries(Object.keys(COND).map(k => [k, Math.round((k === 'growth' ? .9 + r() * .9 : .8 + r() * .5) * 100) / 100]));
  b.fl = []; b.cu = -1; b.seen = null; b.slept = 0;
}
// a founder's printed body: sometimes a small flaw from the print, recorded by the Seed but not looked for
const FLAWS = {
  valve: { name: 'A weak heart valve', note: 'from the print: it raises the risk of heart trouble later' },
  eyes: { name: 'Poor eyesight', note: 'from the print', shown: true },
  immune: { name: 'A weak immune response', note: 'from the print: infections take hold more easily' },
  joints: { name: 'Soft cartilage', note: 'from the print: the joints wear sooner' },
  kidney: { name: 'Small kidneys', note: 'from the print: they cope less well with a hard diet' },
};
export function printBody(sim, c) {
  seedBody(c);
  const r = lcg((c.look || 1) * 13 + 5), b = c.bd, keys = Object.keys(FLAWS);
  for (let n = r() < .3 ? (r() < .25 ? 2 : 1) : 0; n > 0; n--) { const k = keys[Math.floor(r() * keys.length)]; if (!b.fl.some(f => f.k === k)) b.fl.push({ k, kn: !!FLAWS[k].shown }); }
  if (b.fl.some(f => f.k === 'eyes')) for (const p of [PART.eyeL, PART.eyeR]) b.marks.push({ p, k: 'flaw', loss: .2, pain: 0, what: 'Poor eyesight', how: 'printed that way', d: sim.day });
  // a mind stored at sixty and printed into a body of thirty feels it
  const y = yrs(sim, c), gap = Math.round((c.age || y) - y);
  c.gap = gap;
  if (Math.abs(gap) >= 15) remember(sim, c, gap > 0 ? `Woke at ${c.age}, in a body of ${Math.round(y)}.` : `Woke in a body older than the mind in it, ${Math.round(y)} to their ${c.age}.`);
}
// a child grown in the tanks: a mix of both parents' family risks, with something from a parent's radiation dose
export function childBody(c, a, b) {
  const mix = k => clamp((a.bd.gn[k] + b.bd.gn[k]) / 2 + (rnd() - .5) * .2, -.3, .6);
  const gn = Object.fromEntries(GENES.map(k => [k, Math.round(mix(k) * 100) / 100]));
  gn.growth = Math.round(Math.min(.8, gn.growth + (a.bd.sl.rad + b.bd.sl.rad) * .15) * 100) / 100;
  seedBody(c, gn);
}
// saves from before: everyone gets the totals their years so far would have left, roughly
export function migrateAging(sim) {
  for (const c of sim.S.cols) if (!c.bd.sl) { seedBody(c); if (!c.native) c.gap = Math.round((c.age || 30) - yrs(sim, c)); }
}
const flaw = (b, k) => b.fl.some(f => f.k === k) ? 1 : 0;

// ---------- every few game minutes (from the mind tick): what the day's work does to the body ----------
const HEAVY = new Set([ACT.QUARRY, ACT.FELL, ACT.CARRY, ACT.STONE, ACT.LOG, ACT.DIG, ACT.BUILD, ACT.DRAG]);
const DUST = new Set([ACT.QUARRY, ACT.DIG]);
export function exposeTick(sim, c, a, dt) {
  const s = c.bd.sl; if (!s) return;
  if (HEAVY.has(a)) s.joint += dt / 8000 * (1 + flaw(c.bd, 'joints') * .5);    // a lifetime of hauling and cutting, most of each day
  if (DUST.has(a)) s.lung += dt / 6000;                                        // rock dust, with nothing over the mouth
  else if (a === ACT.COOK) s.lung += dt / 40000;                                // smoke from the cooking fire
  else if (a === ACT.FIGHT) s.lung += dt / 500;                                 // a fire's smoke, up close
  if (!hidden(a)) s.rad += dt / 60000;   // in sieverts: this sun is harder than Earth's, about 12 mSv a year outdoors (flares in sky.js)
  if (a === ACT.BED) c.bd.slept += dt * .75; else if (a === ACT.INSIDE) c.bd.slept += dt;   // a bedroll on the ground rests less than a bunk
}
// what a diet the colony hasn't fully worked out leaves in the liver and kidneys, per meal
export const dietLoad = (c, slow) => { if (c.bd.sl) c.bd.sl.diet += slow * .004 * (1 + flaw(c.bd, 'kidney') * .6); };
// sleep debt: how it weakens the body against infection, and slows healing
export const sleepHit = c => { const d = c.bd.sl ? c.bd.sl.sleep : 0; return { weak: 1 + Math.min(.5, d / 60), heal: 1 - Math.min(.4, d / 80) }; };
// age: healing slows from thirty-five, and elders tire sooner
export const ageHeal = y => y < 35 ? 1 : Math.max(.5, 1 - (y - 35) * .012);
export const ageTire = y => y < 55 ? 1 : 1 + (y - 55) * .02;

// ---------- conditions: each grows out of a score, and shows once the score passes the person's own threshold ----------
const old = (y, from, per) => Math.max(0, y - from) / per;
export const COND = {
  joints: { part: 'spine', more: ['legL', 'legR'], name: 'Worn joints', sym: 'Stiff and aching in the back and knees, worse in the cold',
    score: (b, y) => b.sl.joint * 1.4 + old(y, 40, 40) + b.gn.joints + flaw(b, 'joints') * .3, loss: s => .06 + .26 * s, pain: s => .03 + .1 * s },
  lungs: { part: 'chest', name: 'Scarred lungs', sym: 'A cough that never clears, and short of breath on any slope',
    score: (b, y) => b.sl.lung * 1.2 + old(y, 50, 60) + b.gn.lungs, loss: s => .05 + .35 * s, pain: s => .02 + .04 * s },
  kidney: { part: 'gut', name: 'Failing kidneys', sym: 'Always tired, swollen ankles, no appetite',
    score: (b, y) => b.sl.diet * 1.5 + old(y, 55, 50) + b.gn.kidney + flaw(b, 'kidney') * .35, loss: s => .1 + .6 * s, pain: s => .03 + .06 * s, fatal: true },
  heart: { part: 'chest', name: 'A weak heart', sym: 'Breathless, and a heartbeat that stumbles',
    score: (b, y) => old(y, 50, 35) + b.gn.heart + flaw(b, 'valve') * .45 + b.sl.rad * .15 + b.sl.lung * .2, loss: s => .05 + .3 * s, pain: () => .02 },
  growth: { part: 'gut', name: 'A growth', sym: 'Losing weight, and a deep pain that comes and goes',
    score: (b, y) => b.sl.rad * .6 + old(y, 45, 40) + b.gn.growth, loss: s => .05 + .5 * s, pain: s => .02 + .3 * s, fatal: true, grows: true },
};
export const condOf = (b, k) => b.marks.find(m => m.k === 'chronic' && m.ck === k);
// the body slowing with the years: a little off the legs, hands, heart and lungs and eyes, from thirty-five on
const AGE_PARTS = [['legL', 1], ['legR', 1], ['handL', .8], ['handR', .8], ['chest', .8], ['eyeL', .7], ['eyeR', .7]];
export const ageLoss = y => y < 35 ? 0 : (y - 35) * .005 + Math.max(0, y - 60) * .012;

// every ten days for each person (spread over the days): age, and the conditions their totals have earned
export function bodyYears(sim, c) {
  const b = c.bd; if (!b.sl || c.life < 3) return;
  const y = yrs(sim, c), al = Math.round(ageLoss(y) * 100) / 100;
  for (const [k, f] of AGE_PARTS) {
    const p = PART[k]; let m = b.marks.find(q => q.k === 'age' && q.p === p);
    if (!al) { if (m) b.marks.splice(b.marks.indexOf(m), 1); continue; }
    if (!m) b.marks.push(m = { p, k: 'age', loss: 0, pain: 0, what: 'Age', d: sim.day });
    m.loss = Math.round(al * f * 100) / 100;
  }
  for (const k in COND) {
    const K = COND[k], sc = K.score(b, y), th = b.th[k]; let m = condOf(b, k);
    if (!m) {
      if (sc < th || (b.cured && b.cured[k] > sim.day - 3 * YEAR_DAYS)) continue;
      m = { p: PART[K.part], k: 'chronic', ck: k, s: .05, loss: 0, pain: 0, what: K.name, how: '', d: sim.day, kn: false };
      b.marks.push(m);
      if (K.more) for (const q of K.more) b.marks.push({ p: PART[q], k: 'chronic', ck: k, sub: 1, loss: 0, pain: 0, what: K.name, d: sim.day, kn: false });
    }
    // a growth keeps growing once it has started; the rest follow the score
    m.s = K.grows ? Math.min(1, m.s + .02 * (1 + y / 100)) : Math.max(m.s, clamp((sc - th) / .6, .05, 1));
    for (const q of b.marks) if (q.k === 'chronic' && q.ck === k) { q.loss = Math.round(K.loss(m.s) * (q.sub ? .5 : 1) * 100) / 100; q.pain = q.sub ? 0 : Math.round(K.pain(m.s) * 100) / 100; }
    // the person knows something is wrong long before anyone names it
    if (m.s >= .3 && !m.felt) { m.felt = 1; remember(sim, c, `${K.sym}.`); sim.log(`${c.name} isn't well: ${K.sym[0].toLowerCase() + K.sym.slice(1)}.${m.kn ? '' : ' A check-up at the clinic may find why.'}`, 'bad', { e: 'chronic', lvl: 1, who: c.id, title: 'Something wrong' }); }
  }
  c.cap = null;   // recounted on the next body tick
}
// once a day for anyone with something serious: a heart that fails, kidneys that stop, a growth that has won
export function chronicDay(sim, c) {
  const b = c.bd; if (!b.sl) return false;
  for (const m of b.marks) {
    if (m.k !== 'chronic' || m.sub) continue;
    const K = COND[m.ck];
    if (m.ck === 'heart' && m.s > .35 && rnd() < .0025 * m.s * m.s) {
      if (rnd() < .45) { die(sim, c, 'heart'); return true; }
      m.s = Math.min(1, m.s + .15); remember(sim, c, 'Had a heart attack, and lived.');
      sim.log(`${c.name} had a heart attack and lived through it. ${m.kn ? 'Their heart is weaker for it.' : 'Nobody had known their heart was weak.'}`, 'bad', { e: 'heartattack', lvl: 2, who: c.id, title: 'A heart attack' });
      m.kn = true;
    }
    if (K.fatal && m.s >= 1) { die(sim, c, m.ck); return true; }
  }
  // the old body simply gives out, more often the older it is: about once in sixty years at seventy, every few at ninety
  const y = yrs(sim, c);
  if (y >= 60 && rnd() < .00002 * Math.exp(.095 * y) / YEAR_DAYS) { die(sim, c, 'old'); return true; }
  return false;
}
// each morning: last night's sleep against what a body needs
export function sleepDay(c) {
  const b = c.bd; if (!b.sl) return;
  if (c.life <= 1) { b.slept = 0; return; }   // the smallest sleep when they need to, in the nursery or by a carer
  const need = c.life <= 3 ? 9 : 7, got = b.slept;
  b.sl.sleep = Math.round(clamp(b.sl.sleep + need - got - (got > need ? Math.min(3, got - need) : 0), 0, 60) * 10) / 10;
  b.slept = 0;
}

// ---------- check-ups: the clinic calls people in, and a medic finds what they can ----------
const CU_EVERY = 40;
export function checkups(sim) {
  const S = sim.S, clinic = built(S).find(p => p.type === 'clinic' && p.powered); if (!clinic) return;
  const meds = S.cols.filter(o => !o.dead && o.crew >= 0 && S.crews[o.crew].work === 'clinic' && o.life >= 4 && !(o.cap && laidUp(o)) && !o.down);
  if (!meds.length) return;
  const md = meds.reduce((a, o) => o.skills.medicine > a.skills.medicine ? o : a), lab = built(S).some(p => p.type === 'lab' && p.powered);
  const conf = clamp(.4 + md.skills.medicine * .05 + (lab ? .1 : 0), .3, .95);
  const due = S.cols.filter(c => !c.dead && c.bd.sl && c !== md && sim.day - c.bd.cu >= CU_EVERY)
    .sort((a, z) => (felt(z) - felt(a)) || (a.bd.cu - z.bd.cu) || (a.born - z.born));
  for (const c of due.slice(0, 2 + Math.floor(md.skills.medicine / 3))) {
    const b = c.bd; b.cu = sim.day; b.seen = { d: sim.day, by: md.name, conf: Math.round(conf * 100), sl: { ...b.sl } };
    const found = [];
    for (const m of b.marks) if (m.k === 'chronic' && !m.sub && !m.kn && rnd() < conf * (m.s > .3 ? 1.2 : .6 + m.s)) { m.kn = true; for (const q of b.marks) if (q.ck === m.ck) q.kn = true; found.push(COND[m.ck].name.toLowerCase()); }
    for (const f of b.fl) if (!f.kn && rnd() < conf * .7) { f.kn = true; found.push(FLAWS[f.k].name.toLowerCase()); }
    if (md.skills.medicine < 10) md.skills.medicine = Math.round((md.skills.medicine + .004) * 1000) / 1000;
    if (found.length) {
      remember(sim, c, `Was told at a check-up: ${found.join(', ')}.`);
      sim.log(`At a check-up, ${md.name} found ${c.name} has ${found.join(' and ')}.`, 'bad', { e: 'checkup', lvl: 1, who: c.id, title: 'Found at a check-up' });
    }
    // a growth found early enough can be cut out
    const g = condOf(b, 'growth');
    if (g && g.kn && g.s < .6 && !g.op) operate(sim, c, md, g);
  }
}
const felt = c => c.bd.marks.some(m => m.k === 'chronic' && m.felt && !m.kn) ? 1 : 0;
function operate(sim, c, md, g) {
  g.op = 1;
  const p = clamp(.35 + md.skills.medicine * .06 - g.s * .6, .05, .9), r = rnd();
  if (r < p) {
    c.bd.marks = c.bd.marks.filter(m => m.ck !== 'growth'); (c.bd.cured || (c.bd.cured = {})).growth = sim.day;
    remember(sim, c, `Had a growth cut out by ${md.name}.`);
    sim.log(`${md.name} cut the growth out of ${c.name}, and got all of it.`, 'good', { e: 'operated', lvl: 1, who: c.id, title: 'An operation worked' });
  } else if (r < p + .12) { die(sim, c, 'operation'); }
  else { g.s = Math.min(1, g.s + .1); sim.log(`${md.name} operated on ${c.name}'s growth but could not get all of it.`, 'bad', { who: c.id }); }
  c.cap = null;
}

// ---------- printed replacement parts: a lost eye or hand, failing kidneys, a worn-out heart ----------
// It takes a working clinic and lab (to scan what is there), a medic, and a body's worth of feedstock.
export const REPLACE = { lost: 'a printed replacement', kidney: 'printed kidneys', heart: 'a printed heart' };
export function canReplace(sim) {
  const S = sim.S;
  if (!built(S).some(p => p.type === 'clinic' && p.powered) || !built(S).some(p => p.type === 'lab' && p.powered)) return 'It needs a working clinic and a lab to scan what is there';
  if (!(S.seedc.feed > 0)) return 'It needs a body’s worth of feedstock in the fabricator';
  if (!S.cols.some(o => !o.dead && o.skills.medicine >= 3 && o.life >= 4)) return 'Nobody has the medicine to fit it';
  return '';
}
export function replacePart(sim, c, mi) {
  const S = sim.S, b = c.bd, m = b.marks[mi]; if (!m || canReplace(sim)) return false;
  const what = m.k === 'lost' ? 'lost' : m.k === 'chronic' && (m.ck === 'kidney' || m.ck === 'heart') && m.kn ? m.ck : '';
  if (!what) return false;
  S.seedc.feed--; S.rv++;
  b.marks = b.marks.filter(q => what === 'lost' ? q !== m : q.ck !== what);
  if (what !== 'lost') { (b.cured || (b.cured = {}))[what] = sim.day; }
  b.adj = { p: m.p, until: sim.day + 12 };
  b.marks.push({ p: m.p, k: 'printed', loss: .25, pain: .05, what: `${cap1(REPLACE[what])} for the ${PARTS[m.p].name}`, how: 'printed and fitted at the clinic', d: sim.day });
  remember(sim, c, `Was fitted with ${REPLACE[what]}.`);
  sim.log(`The Seed printed ${REPLACE[what]} for ${c.name}, and the clinic fitted it. It will take a while before it feels like theirs.`, 'good', { e: 'printpart', lvl: 1, who: c.id, title: 'A printed part' });
  c.cap = null; return true;
}
// a printed part settles in: stiff and strange at first, then theirs
export function adjustDay(sim, c) {
  const b = c.bd; if (!b.adj) return;
  const m = b.marks.find(q => q.k === 'printed' && q.p === b.adj.p); if (!m) { b.adj = null; return; }
  const left = b.adj.until - sim.day;
  m.loss = Math.max(0, Math.round(.25 * left / 12 * 100) / 100); m.pain = left > 6 ? .05 : 0;
  if (left <= 0) { b.adj = null; m.loss = 0; remember(sim, c, 'The printed part feels like their own now.'); }
  c.cap = null;
}
const cap1 = s => s[0].toUpperCase() + s.slice(1);

// what the page shows: the totals as last measured, known flaws, and the conditions as the colony knows them
export function agingUI(sim, c) {
  const b = c.bd; if (!b.sl) return null;
  const al = ageLoss(yrs(sim, c));
  return {
    age: al ? Math.round(al * 100) : 0, seen: b.seen, fl: b.fl.filter(f => f.kn).map(f => ({ name: FLAWS[f.k].name, note: FLAWS[f.k].note })),
    ch: b.marks.map((m, i) => [m, i]).filter(([m]) => m.k === 'chronic' && !m.sub && (m.kn || m.felt)).map(([m, i]) => ({ i, name: m.kn ? COND[m.ck].name : '', sym: COND[m.ck].sym, s: Math.round(m.s * 100) / 100, d: m.d, kn: !!m.kn, ck: m.ck })),
    sleep: Math.round(b.sl.sleep), adj: b.adj ? b.adj.until - sim.day : 0, cu: b.cu,
  };
}

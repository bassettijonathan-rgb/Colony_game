// Illness, from two directions. What came down with the colonists: the microbes in the Seed's own starter
// cultures, which every printed body is given so it can digest and breathe, and which the databank knows. And
// whatever lives here, which nobody knows: the sealed texts hold those, and the colony learns them only by
// watching cases and examining the sick. An illness runs a course (hidden incubation, the sick days, for the
// worst cases a crisis, then recovery) and leaves resistance behind, or for some, the opposite. Some pass from
// person to person: at shared meals, and between people who sleep or work in the same room. A new printed body
// has no resistance at all and catches everything in its first season.
import { HOUR, ACT, T, hidden } from './consts.js';
import { rnd, clamp } from './rng.js';
import { SEALED } from '../sealed/texts.js';
import { doyOf, seasonOf, dayWeather } from './year.js';
import { spend } from './director.js';
import { YEAR_DAYS, DAY_TICKS } from './consts.js';
const bodyYears = (sim, c) => c.born == null ? 30 : (sim.S.tick / DAY_TICKS - c.born) / YEAR_DAYS;   // the body's age, not the mind's

// Each kind: what it is called, the symptoms anyone can see, how new cases start (src) and how it spreads from
// the sick (spread, chances per hour of company or per shared meal), hours of incubation, sickness and crisis,
// how bad it can get and how bad a case has to be to reach a crisis, which capacities it takes, the fever, the
// chance an untreated crisis kills, whether antibiotics work, and what it leaves (immune, sensitise or none).
export const BROUGHT = [
  {
    id: 'gut', name: 'Gut fever', brought: true, sym: 'Cramps, vomiting and a fever',
    src: { meal: .002 }, spread: { meal: .045, air: .0015 }, incub: [12, 36], sick: [36, 90], crisis: [10, 24],
    sev: 1, crisisAt: .8, hits: { digest: .7, carry: .2, move: .1 }, fever: .5, kill: .3, abx: true, after: 'immune', imm: .7,
    text: 'A gut infection from one of the Seed’s own starter cultures, the microbes every printed body is given so it can digest. Clean hands and clean water keep it in check; in a crowded camp it passes from hand to mouth and through shared food, and a cook who has it spreads it to everyone they feed. Antibiotics shorten it. The danger is the water it costs the body: with a clinic bed and someone to keep them drinking, almost everyone lives.',
  },
  {
    id: 'chest', name: 'Chest infection', brought: true, sym: 'A wet cough, a high fever and fast, shallow breathing',
    src: { chill: .002, tired: .001 }, spread: { air: .004 }, incub: [24, 48], sick: [60, 130], crisis: [20, 44],
    sev: 1, crisisAt: .74, hits: { breath: .6, carry: .25, consc: .1 }, fever: .7, kill: .35, abx: true, after: 'immune', imm: .5,
    text: 'A pneumonia from a bacterium that lives harmlessly in the throat of most printed bodies: it came down with the Seed’s starter cultures. Cold, exhaustion and a new body’s untrained defences let it into the lungs, and it passes between people who sleep close together. Antibiotics work well against it.',
  },
];
export const ILLS = [...BROUGHT, ...(SEALED.ill || [])];
export const ILL = Object.fromEntries(ILLS.map(k => [k.id, k]));
const STM = [0, 1, 1.6, .25];                  // how much each stage shows: incubating, sick, crisis, recovering
const TERR = Object.fromEntries(Object.entries(T).map(([k, v]) => [v, k.toLowerCase()]));
const ACTS = { [ACT.GATHER]: 'gather', [ACT.SAMPLE]: 'gather', [ACT.FARM]: 'farm', [ACT.QUARRY]: 'quarry', [ACT.FELL]: 'fell', [ACT.BUILD]: 'build', [ACT.SURVEY]: 'survey', [ACT.PLANT]: 'survey', [ACT.WALK]: 'walk', [ACT.HOME]: 'walk', [ACT.CARRY]: 'walk', [ACT.STONE]: 'walk', [ACT.LOG]: 'walk', [ACT.SACK]: 'walk' };
const span = ([a, b]) => a + rnd() * (b - a);
export const newIll = () => ({ k: Object.fromEntries(ILLS.map(K => [K.id, { cases: 0, deaths: 0, seen: 0, id: !!K.brought, named: false }])), meal: { d: -1, at: {} }, cook: [] });
const know = (S, k) => S.ill.k[k] || (S.ill.k[k] = { cases: 0, deaths: 0, seen: 0, id: !!(ILL[k] && ILL[k].brought), named: false });

// ---------- what an illness does to a body (body.js asks) ----------
export const sickNow = b => b.ill.some(q => q.st >= 1);
export function illHits(b, o) {
  for (const q of b.ill) {
    if (q.st < 1) continue;
    const K = ILL[q.k], m = STM[q.st] * q.sev;
    for (const k in K.hits) o[k] -= K.hits[k] * m;
    if (q.st === 2) o.consc -= .35 * q.sev;
  }
}
export const illPain = b => b.ill.reduce((a, q) => a + (q.st ? ILL[q.k].fever * STM[q.st] * q.sev * .7 : 0), 0);
export const illDanger = b => b.ill.reduce((a, q) => Math.max(a, q.st === 2 ? .45 + q.sev * .4 : q.st === 1 ? .1 + q.sev * .25 : 0), 0);
// too sick to work: a crisis, or anything more than a mild case
export const illLaid = b => b.ill.some(q => q.st === 2 || (q.st === 1 && q.sev >= .3));
export const catching = q => !!ILL[q.k].spread && (q.st === 1 || q.st === 2 || (q.st === 0 && q.t < q.T * .3));
// someone the clinic's isolation rule keeps apart: a named illness that spreads, while it shows
export const toIsolate = c => c.bd.ill.some(q => q.kn && ILL[q.k].spread && (q.st === 1 || q.st === 2));
export const label = q => q.kn ? ILL[q.k].name.toLowerCase() : 'an illness nobody has named';

// what a medic can do for the sick, most urgent first (body.js adds them to a person's needs)
export function illNeeds(sim, b, out) {
  for (const q of b.ill) {
    if (q.st !== 1 && q.st !== 2) continue;
    const K = ILL[q.k];
    if (!q.kn && (!q.dx || sim.S.tick - q.dx > 24 * HOUR)) out.push({ k: 'dx', u: 4 + q.st });
    // antibiotics: when they are known to work, or once on a guess for a fever nobody has named
    if (b.abx <= 0 && ((q.kn && K.abx) || (!q.kn && q.dx && !q.tried && K.fever * q.sev >= .3))) out.push({ k: 'abx', u: 6 + q.st * 2 });
    if (q.st === 2 && b.nu <= 0) out.push({ k: 'nurse', u: 8 });
  }
}

// ---------- catching something ----------
const newBody = (sim, c) => sim.day - (c.bday || 0) < 20;
// how likely this person is to catch it, compared with a seasoned body
function sus(sim, c, K) {
  const imm = c.bd.imm[K.id] || 0;
  return (K.after === 'immune' ? 1 - Math.max(0, imm) : 1) * (newBody(sim, c) ? 2 : 1) * (c.hungry ? 1.4 : 1) * (c.unwell ? 1.2 : 1) * (c.fat > 80 ? 1.2 : 1) * (c.chill > 50 ? 1.2 : 1);
}
// catching it from the world (from -1) is damped by the director when the colony has had enough; from each other, never
const tryCatch = (sim, c, K, p, from) => { if (!c.bd.ill.some(q => q.k === K.id) && rnd() < p * sus(sim, c, K) * (from < 0 && sim.S.dir ? sim.S.dir.damp : 1)) catchIt(sim, c, K, from); };
export function catchIt(sim, c, K, from) {
  const b = c.bd, imm = b.imm[K.id] || 0;
  const sev = clamp(K.sev * (.2 + .8 * Math.pow(rnd(), 1.3)) * (newBody(sim, c) ? 1.25 : 1) * (c.hungry ? 1.2 : 1) * (bodyYears(sim, c) > 55 ? 1.15 + (bodyYears(sim, c) - 55) * .01 : 1) * (imm < 0 ? 1 - imm : 1), .05, 1);
  const t = span(K.incub) * (imm < 0 ? .5 : 1);   // a sensitised body reacts faster
  b.ill.push({ k: K.id, st: 0, t, T: t, sev, kn: false, dx: 0, tried: false, d: sim.day, d1: 0, from });
  const S = sim.S; know(S, K.id).cases++; S.stats.ill = (S.stats.ill || 0) + 1;
  c.cap = null;
}

// ---------- hour by hour, for someone who has something (from bodyTick) ----------
// ctx: lying, hungry, chill, ward. Returns why they died, or ''.
export function illTick(sim, c, dt, ctx) {
  const b = c.bd;
  if (b.nu > 0) b.nu -= dt;
  for (const q of b.ill.slice()) {
    const K = ILL[q.k]; if (!K) { b.ill.splice(b.ill.indexOf(q), 1); continue; }
    const abx = b.abx > 0 && K.abx;
    q.t -= dt * (abx && q.st === 1 ? 1.8 : 1) * (q.st === 3 && ctx.lying ? 1.5 : 1);
    if (q.st === 2) {
      // the crisis: whether they pull through depends a lot on care
      const f = (ctx.ward ? .7 : 1) * (b.nu > 0 ? .5 : 1) * (abx ? .35 : 1) * (ctx.hungry ? 1.5 : 1) * (ctx.chill > 35 ? 1.3 : 1) * (ctx.lying ? 1 : 1.4);
      const p = Math.min(.95, K.kill * q.sev * f);
      if (rnd() < -Math.log(1 - p) / q.T * dt) { end(sim, c, q, 'died'); return 'ill:' + q.k + ':' + (q.kn ? 1 : 0); }
    }
    if (q.t <= 0) next(sim, c, q, K);
  }
  return '';
}
function next(sim, c, q, K) {
  const S = sim.S, b = c.bd;
  if (q.st === 0) {
    q.st = 1; q.d1 = sim.day; q.t = span(K.sick) * (.6 + .6 * q.sev);
    const kn = know(S, q.k), first = !kn.shown; kn.shown = true;
    const m = `${c.name} is sick: ${K.sym.toLowerCase()}.${first ? ` Nobody here has had this before.` : ''}`;
    sim.log(m, 'bad', { e: first ? 'sickfirst' : 'sick', lvl: first ? 2 : 1, who: c.id, title: first ? 'Illness in the camp' : `${c.name} is sick` });
  } else if (q.st === 1 && q.sev >= K.crisisAt) {
    q.st = 2; q.T = q.t = span(K.crisis);
    spend(sim, 1, 'crisis');
    sim.log(`${c.name}'s illness has taken a turn for the worse. The next day or so decides it.`, 'bad', { e: 'crisis', lvl: 2, who: c.id, title: `${c.name} is gravely ill` });
  } else if (q.st < 3) {
    if (q.st === 2) sim.log(`${c.name} is through the worst of ${label(q)}.`, 'good', { who: c.id });
    q.st = 3; q.t = 24 + rnd() * 24;
  } else {
    end(sim, c, q, 'recovered');
    if (K.after === 'immune') b.imm[q.k] = Math.max(b.imm[q.k] || 0, K.imm);
    else if (K.after === 'sensitise') b.imm[q.k] = Math.max(-1.5, (b.imm[q.k] || 0) - .5);
    sim.log(`${c.name} has got over ${label(q)}.`, 'good', { who: c.id });
  }
  c.cap = null; S.rv++;
}
// a case that has run its course, one way or the other: it goes in their records, and what the colony saw of it
// adds to what it knows
function end(sim, c, q, out) {
  const S = sim.S, b = c.bd, kn = know(S, q.k);
  b.ill.splice(b.ill.indexOf(q), 1);
  if (q.st >= 1) b.hx.push({ k: q.k, kn: q.kn, d: q.d1 || q.d, e: sim.day, out });
  if (b.hx.length > 12) b.hx.shift();
  if (out === 'died') { kn.deaths++; S.stats.illDeaths = (S.stats.illDeaths || 0) + 1; }
  if (q.st >= 1 && !kn.id) learn(sim, q.k, .12);
}

// ---------- the doctor's view: naming an illness ----------
// A medic examines someone sick. An illness from the databank they can name, if they are good enough; one from
// here, every examination adds to what is known, faster in a clinic and faster still with a lab.
export function diagnose(sim, o, c, pf, clinic) {
  const S = sim.S;
  for (const q of c.bd.ill) {
    if (q.st < 1 || q.st > 2 || q.kn) continue;
    q.dx = S.tick;
    const K = ILL[q.k], kn = know(S, q.k);
    if (kn.id) {
      if (rnd() >= Math.min(.95, pf + .15)) continue;
      q.kn = true;
      const first = !kn.named; kn.named = true;
      sim.log(`${o.name} examined ${c.name}: it is ${K.name.toLowerCase()}.${first ? ` ${K.text}` : ''}`, 'bad', first ? { e: 'illknown', lvl: 2, who: c.id, title: K.name } : { who: c.id });
    } else {
      const lab = S.projects.some(p => p.type === 'lab' && p.done && p.powered);
      learn(sim, q.k, pf * .15 * (clinic ? 1 : .6) * (lab ? 1.6 : 1));
    }
  }
}
function learn(sim, k, v) {
  const S = sim.S, kn = know(S, k), K = ILL[k];
  kn.seen = Math.min(1, kn.seen + v);
  if (kn.seen < 1 || kn.id) return;
  kn.id = kn.named = true;
  for (const c of S.cols) if (!c.dead) for (const q of c.bd.ill) if (q.k === k) q.kn = true;
  sim.log(`The colony’s medics have worked out what the illness is: ${K.name.toLowerCase()}. ${K.text}`, 'good', { e: 'illfound', lvl: 2, title: K.name });
  S.rv++;
}

// ---------- every hour: who catches what, from the world and from each other ----------
export function illHour(sim) {
  const S = sim.S, live = S.cols.filter(c => !c.dead && c.act !== ACT.WAKE), wx = dayWeather(sim.W.seed, sim.cal), season = seasonOf(doyOf(sim.cal));
  const where = c => hidden(c.act) && c.where >= 0 ? 'b' + c.where : 'o' + ((c.y / 5) | 0) * 200 + ((c.x / 5) | 0);
  const rooms = new Map(), cook = [];
  for (const c of live) {
    const q = c.bd.ill.filter(q => catching(q) && ILL[q.k].spread.air);
    if (q.length) { const w = where(c); if (!rooms.has(w)) rooms.set(w, []); rooms.get(w).push([c, q]); }
    // a sick cook, still at work, spreads what they have to the meals
    if (c.crew >= 0 && S.crews[c.crew].work === 'kitchen' && c.plan === 'work') for (const q of c.bd.ill) if (catching(q) && ILL[q.k].spread.meal) cook.push([c.id, q.k]);
  }
  S.ill.cook = cook;
  for (const c of live) {
    const w = where(c), here = rooms.get(w);
    if (here) {
      const p = S.projects.find(p => 'b' + p.id === w), f = !p ? (c.act === ACT.BED ? .6 : .25) : p.type === 'clinic' ? .4 : 1;
      for (const [o, qs] of here) if (o !== c) for (const q of qs) tryCatch(sim, c, ILL[q.k], ILL[q.k].spread.air * f, o.id);
    }
    // new cases from the world: the cold and exhaustion let in what the body already carries, and the land has its own
    for (const K of ILLS) {
      const s = K.src;
      if (s.chill && c.chill > 50) tryCatch(sim, c, K, s.chill, -1);
      if (s.tired && c.fat > 85) tryCatch(sim, c, K, s.tired, -1);
      if (s.out && !hidden(c.act) && c.act !== ACT.BED) {
        const o = s.out, a = ACTS[c.act];
        if (!o.season[season] || (o.act && !o.act.includes(a)) || (o.terr && !o.terr.includes(TERR[sim.W.type[c.tile]])) || (o.dry && (wx.rain > .3 || wx.snow > .3))) continue;
        tryCatch(sim, c, K, o.p * (o.wind ? .5 + wx.wind : 1), -1);
      }
    }
    // shut away from everyone: it wears on them, and on their trust in the Seed that ordered it
    c.iso = !!S.care.iso && c.plan === 'ward' && toIsolate(c);
    if (c.iso) {
      c.str = Math.min(100, c.str + (c.traits.includes('solitary') ? .15 : .5)); c.isoD = 1;
      if (c.isoSaid !== c.bd.ill[0].d) { c.isoSaid = c.bd.ill[0].d; c.mem.push({ d: sim.day, m: 'Was kept apart from everyone while sick.' }); if (c.mem.length > 24) c.mem.splice(2, 1); }
    }
  }
}
// a meal: food handled carelessly, someone sick at the same table, or a sick cook. place is where they ate.
export function illMeal(sim, c, place, got) {
  const S = sim.S, M = S.ill.meal;
  if (got === 'ration' || !got) return;   // the lander's rations are sealed packs
  if (M.d !== sim.day) { M.d = sim.day; M.at = {}; }
  const list = M.at[place] || (M.at[place] = []);
  for (const K of ILLS) if (K.src.meal) tryCatch(sim, c, K, K.src.meal * (place[0] === 'm' ? .5 : 1), -1);
  for (const id of list) for (const q of S.cols[id].bd.ill) if (catching(q) && ILL[q.k].spread.meal) tryCatch(sim, c, ILL[q.k], ILL[q.k].spread.meal, id);
  for (const [id, k] of S.ill.cook) if (id !== c.id) tryCatch(sim, c, ILL[k], ILL[k].spread.meal * .6, id);
  if (c.bd.ill.some(q => catching(q) && ILL[q.k].spread.meal)) list.push(c.id);
}
// once a day: resistance fades slowly, and being shut away costs trust
export function illDay(sim, c) {
  const b = c.bd;
  for (const k in b.imm) { if (b.imm[k] > 0) b.imm[k] = Math.max(0, b.imm[k] - .006); }
  if (c.isoD) { c.tru = Math.max(0, c.tru - 1.5); c.isoD = 0; }
}
// what the colony knows about illness, for the clinic's card
export function illUI(S) {
  return {
    iso: !!S.care.iso,
    kinds: ILLS.map(K => { const k = S.ill.k[K.id]; return k && k.cases && k.shown ? { id: K.id, name: k.named ? K.name : '', sym: K.sym, text: k.named ? K.text : '', cases: k.cases, deaths: k.deaths, seen: k.id ? 1 : Math.round(k.seen * 100) / 100, catching: k.named && !!K.spread, abx: k.named ? K.abx : null } : null; }).filter(Boolean),
  };
}

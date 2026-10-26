// Lives: every body ages a year each planetary year (eighty days). Founders wake in printed bodies of about thirty,
// whatever age their minds were when they were stored; the children born here grow up through the Seed's nursery,
// play by the fire, learn from their parents, join the crews as apprentices at thirteen and count as adults at
// sixteen. Couples form out of close friendships, and a couple can ask the Seed to grow their child in one of its two
// growth tanks: sixty days, from one body's worth of feedstock and the genes of both. The old die of age, slowly
// more likely each year past sixty.
import { DAY_TICKS, YEAR_DAYS, HOUR, ACT, MAP, SKILLS, hidden } from './consts.js';
import { rnd, ri, clamp, lcg } from './rng.js';
import { GIVEN, TRAITS, OPP } from './founders.js';
import { remember, die } from './life.js';
import { mealsInStore, eat } from './food.js';
import { planCrews, autoCrew } from './work.js';

// stages of a life: 0 in the nursery, 1 small, 2 a child, 3 an apprentice, 4 an adult, 5 an elder
export const NURSERY = 2, SMALL = 6, APPRENTICE = 13, ADULT = 16, ELDER = 65, RETIRE = 72, COUPLE = 18;
export const TANKS = 2, GROW_DAYS = 60;
const stageAt = y => y < NURSERY ? 0 : y < SMALL ? 1 : y < APPRENTICE ? 2 : y < ADULT ? 3 : y < ELDER ? 4 : 5;
export const now = sim => sim.S.tick / DAY_TICKS;
export const yearsOf = (sim, c) => (now(sim) - c.born) / YEAR_DAYS;
export const mindAge = (sim, c) => c.age + (sim.day - c.bday) / YEAR_DAYS;
export const kid = c => c.life < 3;
export const worker = c => !c.dead && c.life >= 3 && !c.retired;
export const FAMILY = new Set(['partner', 'parent', 'child', 'sibling']);
// a tie that holds someone up: a friend, or family
export const close = t => t && (t.k === 'friend' || FAMILY.has(t.k));
// close family, who never pair up: anyone sharing a parent or grandparent, or descended from the other within two generations
const anc = (S, c) => { const out = new Set(c.par); for (const p of c.par) for (const g of (S.cols[p] || {}).par || []) out.add(g); return out; };
const kin = (S, a, b) => { const x = anc(S, a), y = anc(S, b); return x.has(b.id) || y.has(a.id) || [...x].some(i => y.has(i)); };
const first = n => n.split(' ')[0], family = n => n.split(' ').slice(1).join(' ');

export const newGen = () => ({ rule: 'fed', womb: [], asks: [], firsts: {}, born: 0 });
// founders: the body is printed at about thirty, from the person's own look (no draw from the main stream)
export function printedBody(sim, c) {
  const y = 26 + (c.look % 997) / 997 * 8;
  c.born = now(sim) - y * YEAR_DAYS; c.life = stageAt(y);
  Object.assign(c, { native: false, gen: 0, par: [], kids: [], partner: -1, owe: 0, retired: false, pr: 0 });
}
// saves from before lives: everyone was printed at about thirty when they woke
export function migrateLives(sim) {
  const S = sim.S;
  if (!S.gen) S.gen = newGen();
  for (const c of S.cols) if (c.born == null) { const y = 26 + (c.look % 997) / 997 * 8; c.born = (c.bday ?? 1) - 1 - y * YEAR_DAYS; c.life = 4; Object.assign(c, { native: false, gen: 0, par: [], kids: [], partner: -1, owe: 0, retired: false, pr: 0 }); }
}

// ---------- once a day, at four in the morning ----------
export function livesDay(sim) {
  const S = sim.S, G = S.gen, live = S.cols.filter(c => !c.dead);
  for (const c of live) {
    const y = yearsOf(sim, c), was = c.life, st = stageAt(y);
    if (st !== was) { c.life = st; grewUp(sim, c, was, st, y); }
    if (c.dead) continue;
    if (!c.retired && c.life >= 4 && y >= RETIRE) retire(sim, c);
    // the old: a chance of dying of age that doubles about every seven years, from fifty on
    if (y >= 50 && rnd() < .00004 * Math.exp(.095 * y) / YEAR_DAYS) { die(sim, c, 'old'); continue; }
    skillsDay(sim, c);
    if (c.life === 0) feedInfant(sim, c);
  }
  couples(sim, live.filter(c => !c.dead));
  tanks(sim);
  milestones(sim);
}
function grewUp(sim, c, was, st, y) {
  const S = sim.S;
  if (st === 1) sim.log(`${c.name} is two: out of the nursery, and running about the camp.`, 'good', { e: 'toddler', lvl: 0, who: c.id });
  if (st === 3) {
    c.bed = 21.3 + rnd() * .9;   // a grown-up's bedtime from now on
    remember(sim, c, 'Joined the crews as an apprentice.');
    sim.log(`${c.name} is thirteen and joins the crews as an apprentice, learning from whoever is best at the work.`, 'good', { e: 'apprentice', lvl: 1, who: c.id, title: 'An apprentice' });
    if (S.crewPlan) planCrews(sim, 'grew'); else if (S.autoCrews) autoCrew(sim, c); else sim.log(`${c.name} is waiting to be put in a crew.`, '', { e: 'nocrew', lvl: 1, who: c.id, title: 'Waiting for a crew' });
  }
  if (st === 4 && c.native) {
    remember(sim, c, 'Came of age.');
    const firstOne = !S.gen.firsts.adult; S.gen.firsts.adult = S.gen.firsts.adult || sim.day;
    sim.log(firstOne ? `${c.name} is sixteen: the first person born on this world to come of age.` : `${c.name} is sixteen and counts as an adult now.`, 'good', { e: firstOne ? 'firstadult' : 'adult', lvl: firstOne ? 2 : 1, who: c.id, title: firstOne ? 'The first native adult' : 'Of age' });
  }
  if (st === 5) sim.log(`${c.name} is ${Math.floor(y)}: the body is starting to slow down.`, '', { who: c.id });
}
function retire(sim, c) {
  c.retired = true;
  remember(sim, c, 'Stopped working in the crews.');
  if (c.crew >= 0) sim.addTo(c, -1);
  sim.log(`${c.name} is ${RETIRE} and has stopped working in the crews. Put them back in one if the colony needs them.`, '', { e: 'retired', lvl: 1, who: c.id, title: 'Retired' });
}

// ---------- skills: practice keeps them, disuse fades them; children learn from their parents, apprentices from the best ----------
export const BIT = Object.fromEntries(SKILLS.map((k, i) => [k, 1 << i]));
const learn = (c, k, v) => { c.skills[k] = Math.min(10, Math.round((c.skills[k] + v) * 1000) / 1000); };
function skillsDay(sim, c) {
  const S = sim.S;
  // a skill nobody uses fades, slowly, down to what anyone keeps of something they once knew
  for (const k of SKILLS) if (!(c.pr & BIT[k]) && c.skills[k] > 3) c.skills[k] = Math.round((c.skills[k] - .002) * 1000) / 1000;
  c.pr = 0;
  if (c.life === 1 || c.life === 2) {
    const ps = c.par.map(i => S.cols[i]).filter(p => p && !p.dead);
    if (!ps.length) return;
    const t = Math.max(...ps.map(p => p.skills.teaching)), pace = (c.life === 1 ? .002 : .005) * (1 + t / 10);
    for (const k of SKILLS) { const aim = Math.max(...ps.map(p => p.skills[k])) * .5; if (c.skills[k] < aim) learn(c, k, pace * (aim - c.skills[k]) / 2); }
    for (const p of ps) if (rnd() < .3) { learn(p, 'teaching', .003); p.pr |= BIT.teaching; }
  } else if (c.life === 3 && c.crew >= 0) {
    const cr = S.crews[c.crew], mates = cr.members.map(i => S.cols[i]).filter(o => o !== c && !o.dead && o.life >= 4);
    if (!mates.length) return;
    for (const k of SKILLS) {
      let best = null; for (const o of mates) if (!best || o.skills[k] > best.skills[k]) best = o;
      const gap = best.skills[k] - c.skills[k];
      if (gap > .5) { learn(c, k, .012 * (1 + best.skills.teaching / 10) * gap / 10); if (rnd() < .1) { learn(best, 'teaching', .002); best.pr |= BIT.teaching; } }
    }
  }
}
// infants are fed in the nursery, a little at a time
function feedInfant(sim, c) {
  c.owe = (c.owe || 0) + .35;
  if (c.owe < 1) return;
  c.owe -= 1; const got = eat(sim, c);
  c.hungry = !got; if (got) c.meal = got;
}
// how much of a meal a child eats at supper
export const portion = c => c.life === 0 ? .35 : c.life === 1 ? .5 : c.life === 2 ? .75 : 1;

// ---------- couples ----------
const tieOf = (a, b) => a.ties[b.id];
export function pair(a, b, k) { const t = a.ties[b.id] || (a.ties[b.id] = { f: 60, a: 40, k: null }); t.k = k; }
function couples(sim, live) {
  const S = sim.S, G = S.gen;
  // a couple that has come apart
  for (const a of live) {
    if (a.partner < 0) continue;
    const b = S.cols[a.partner];
    if (!b || b.dead) { a.partner = -1; continue; }
    const t = tieOf(a, b);
    if (a.id < b.id && t && t.a <= -10) {
      a.partner = b.partner = -1; for (const [x, y] of [[a, b], [b, a]]) { const q = tieOf(x, y); if (q) q.k = q.a <= -25 ? 'rival' : null; remember(sim, x, `Split up with ${y.name}.`); x.str = Math.min(100, x.str + 15); }
      sim.log(`${a.name} and ${b.name} have split up.`, 'bad', { e: 'split', lvl: 1, who: a.id, title: 'A couple split up' });
    }
  }
  // close friends who are both free can become a couple
  const free = live.filter(c => c.partner < 0 && c.life >= 4 && yearsOf(sim, c) >= COUPLE);
  for (const a of free) {
    if (a.partner >= 0) continue;
    for (const id in a.ties) {
      const t = a.ties[id], b = S.cols[id];
      if (!b || b.dead || b === a || b.partner >= 0 || b.life < 4 || yearsOf(sim, b) < COUPLE || t.k !== 'friend' || t.a < 65 || t.f < 70 || Math.abs(yearsOf(sim, a) - yearsOf(sim, b)) > 15) continue;
      const u = tieOf(b, a); if (!u || u.k !== 'friend' || u.a < 65 || kin(S, a, b)) continue;
      // not everyone wants a partner, and it takes a while
      const shy = (a.traits.includes('solitary') ? .5 : 1) * (b.traits.includes('solitary') ? .5 : 1);
      if (rnd() >= .012 * shy) continue;
      a.partner = b.id; b.partner = a.id; pair(a, b, 'partner'); pair(b, a, 'partner');
      remember(sim, a, `Became a couple with ${b.name}.`); remember(sim, b, `Became a couple with ${a.name}.`);
      const firstOne = !G.firsts.couple; G.firsts.couple = G.firsts.couple || sim.day;
      S.stats.couples = (S.stats.couples || 0) + 1;
      sim.log(`${a.name} and ${b.name} are a couple now.`, 'good', { e: firstOne ? 'firstcouple' : 'couple', lvl: firstOne ? 2 : 1, who: a.id, title: firstOne ? 'The first couple' : 'A new couple' });
      break;
    }
  }
  // a couple settled enough may ask the Seed for a child: not while one is growing for them, and not too close together
  for (const a of live) {
    if (a.partner < 0 || a.partner < a.id) continue;
    const b = S.cols[a.partner]; if (!b || b.dead) continue;
    const key = a.id + ':' + b.id;
    if (G.asks.some(q => q.k === key) || G.womb.some(q => q.k === key)) continue;
    const kids = a.kids.filter(i => S.cols[i].par.includes(b.id)), youngest = kids.length ? Math.min(...kids.map(i => yearsOf(sim, S.cols[i]))) : 99;
    if (kids.length >= 4 || youngest < 2 || Math.max(yearsOf(sim, a), yearsOf(sim, b)) > 50 || a.str > 60 || b.str > 60) continue;
    if (rnd() >= .012) continue;
    G.asks.push({ k: key, a: a.id, b: b.id, d: sim.day });
    sim.log(`${a.name} and ${b.name} would like a child. ${ruleNote(sim)}`, '', { e: 'ask', lvl: 1, who: a.id, title: 'A couple would like a child' });
  }
}
// what the colony's rule on children means for a couple asking, right now
const FED_DAYS = 6;
export function ruleOk(sim) {
  const S = sim.S, r = S.gen.rule;
  if (r === 'no') return false;
  if (r === 'yes') return true;
  const live = S.cols.filter(c => !c.dead);
  return mealsInStore(sim, true) / Math.max(1, live.length) >= FED_DAYS && !live.some(c => c.hungry);
}
function ruleNote(sim) {
  const r = sim.S.gen.rule;
  if (r === 'no') return 'The colony’s rule is no children for now: change it in the Archive.';
  if (!ruleOk(sim)) return `The colony’s rule is children only while food is plentiful, and the larder holds less than ${FED_DAYS} days of food a person, or someone is going hungry: they wait.`;
  return 'The Seed grows the child in one of its tanks as soon as one is free and there is feedstock for a body.';
}
// ---------- the growth tanks ----------
function tanks(sim) {
  const S = sim.S, G = S.gen, sd = S.seedc;
  for (const e of G.womb.slice()) if (--e.left <= 0) { G.womb.splice(G.womb.indexOf(e), 1); birth(sim, e); }
  // a couple that split up, or lost one of them, is no longer waiting
  G.asks = G.asks.filter(q => { const a = S.cols[q.a], b = S.cols[q.b]; return a && b && !a.dead && !b.dead && a.partner === b.id; });
  // founders the player chose come first; a body of feedstock nobody chose goes to the couple who asked first
  while (G.asks.length && G.womb.length < TANKS && sd.feed > 0 && !sd.queue.length && ruleOk(sim)) {
    const q = G.asks.shift(), a = S.cols[q.a], b = S.cols[q.b];
    sd.feed--; G.womb.push({ k: q.k, a: a.id, b: b.id, left: GROW_DAYS, d: sim.day }); S.rv++;
    remember(sim, a, `The Seed started growing a child for us.`); remember(sim, b, `The Seed started growing a child for us.`);
    a.str = Math.max(0, a.str - 8); b.str = Math.max(0, b.str - 8);
    sim.log(`The Seed started growing a child for ${a.name} and ${b.name}, in one of its tanks. It will be born in ${GROW_DAYS} days.`, 'good', { e: 'tank', lvl: 1, who: a.id, title: 'A child on the way' });
  }
}
// a name nobody living has, a temperament from both sides, a face from both sides
const NEW_GIVEN = ['Arlo', 'Brin', 'Calla', 'Dov', 'Edda', 'Fen', 'Halo', 'Isa', 'Jori', 'Kai', 'Lumi', 'Miro', 'Nell', 'Oki', 'Pell', 'Rue', 'Sol', 'Tavi', 'Una', 'Vale', 'Wyn', 'Ziv', 'Ash', 'Bay', 'Cove', 'Dell', 'Elm', 'Fjord', 'Glen', 'Hollis'];
function nameFor(S, a, b, n) {
  const used = new Set(S.cols.filter(c => !c.dead).map(c => first(c.name))), fam = family((n % 2 ? b : a).name) || family(a.name);
  const pool = GIVEN.concat(NEW_GIVEN);
  for (let k = 0; k < 40; k++) { const g = pool[Math.floor(rnd() * pool.length)]; if (!used.has(g) && g !== first(a.name) && g !== first(b.name)) return g + ' ' + fam; }
  return pool[Math.floor(rnd() * pool.length)] + ' ' + fam;
}
function traitsFor(a, b) {
  const keys = Object.keys(TRAITS), out = [];
  const ok = t => t && !out.includes(t) && !out.some(o => OPP[o] === t);
  for (const from of [a, b]) {
    let t = rnd() < .45 ? from.traits[Math.floor(rnd() * from.traits.length)] : null;
    for (let k = 0; k < 30 && !ok(t); k++) t = keys[Math.floor(rnd() * keys.length)];
    out.push(t);
  }
  return out;
}
// the first two draws of a look are its skin and hair (as the renderer reads them): look for a face with one
// parent's skin, or between the two, and one parent's hair
const genes = look => { const r = lcg(look + 11); return [(r() * 8) | 0, (r() * 8) | 0]; };
function lookFor(a, b) {
  const [sa, ha] = genes(a.look), [sb, hb] = genes(b.look), skin = rnd() < .5 ? (rnd() < .5 ? sa : sb) : Math.round((sa + sb) / 2), hair = rnd() < .5 ? ha : hb;
  let look = Math.floor(rnd() * 1e6);
  for (let k = 0; k < 4000; k++, look = (look + 7919) % 1e6) { const [s, h] = genes(look); if (s === skin && h === hair) return look; }
  return look;
}
export function birth(sim, e) {
  const S = sim.S, G = S.gen, a = S.cols[e.a], b = S.cols[e.b];
  G.born++; S.stats.births = (S.stats.births || 0) + 1;
  const skills = Object.fromEntries(SKILLS.map(k => [k, 0]));
  const p = { fid: -1, name: nameFor(S, a, b, G.born), age: 0, trade: 'Born here', skills, traits: traitsFor(a, b), mem: [], look: lookFor(a, b), knew: [] };
  const c = sim.spawn(p, sim.cargoTile, ACT.INDOORS);
  Object.assign(c, { fresh: 0, born: now(sim), life: 0, native: true, gen: Math.max(a.gen, b.gen) + 1, par: [a.id, b.id], kids: [], partner: -1, owe: 0, retired: false, pr: 0, bed: 19.5 + rnd() * .5, tru: 70, str: 0, fat: 0, plan: 'nursery', job: 'nursery' });
  c.mem = [{ d: sim.day, m: 'Born on this world.' }];
  for (const q of [a, b]) {
    for (const i of q.kids) { const s = S.cols[i]; if (s && !s.dead && !c.ties[s.id]) { pair(c, s, 'sibling'); pair(s, c, 'sibling'); c.ties[s.id].f = s.ties[c.id].f = 50; } }
    q.kids.push(c.id); pair(c, q, 'parent'); pair(q, c, 'child'); c.ties[q.id].f = q.ties[c.id].f = 80; c.ties[q.id].a = q.ties[c.id].a = 60;
    if (!q.dead) { remember(sim, q, `${first(c.name)} was born.`); q.str = Math.max(0, q.str - 15); }
  }
  const firstOne = G.born === 1;
  sim.log(firstOne ? `${c.name} was born, the child of ${a.name} and ${b.name}: the first person born on this world.` : `${c.name} was born, the child of ${a.name} and ${b.name}.`, 'good', { e: firstOne ? 'firstborn' : 'born', lvl: firstOne ? 2 : 1, who: c.id, title: firstOne ? 'The first child born here' : 'A child is born' });
  S.rv++;
}

// ---------- the small ones need someone with them ----------
// a childcare crew looks after four small children each; without enough of them, a parent stays at camp instead of working
// (run each morning after the Seed plans the crews, so a new childcare crew counts the same day)
export function minders(sim) {
  const S = sim.S, small = S.cols.filter(c => !c.dead && c.life <= 1);
  for (const c of S.cols) c.minding = false;
  if (!small.length) return;
  const carers = S.crews.filter(k => !k.gone && k.work === 'care').reduce((n, k) => n + k.members.filter(i => !S.cols[i].dead).length, 0);
  let left = small.length - carers * 4;
  if (left <= 0) { S.gen.alone = 0; return; }
  const named = [];
  for (const c of small) {
    if (left <= 0) break;
    const ps = c.par.map(i => S.cols[i]).filter(p => p && !p.dead && worker(p));
    if (!ps.length) continue;
    const p = ps.find(q => q.minding) || ps.sort((x, y) => (x.skills.teaching + x.skills.medicine) - (y.skills.teaching + y.skills.medicine)).pop();
    if (!p.minding) { p.minding = true; named.push(p.name); }
    left--;
  }
  if (named.length && S.gen.alone !== sim.day - 1) sim.log(`Nobody is looking after the small children, so ${named.length > 1 ? named.slice(0, -1).join(', ') + ' and ' + named[named.length - 1] : named[0]} ${named.length === 1 ? 'stays' : 'stay'} at camp with them instead of working. ${S.crewPlan ? 'The Seed adds a childcare crew when it plans the crews.' : 'Make a childcare crew in Crews, or let the Seed plan the crews.'}`, 'bad', { e: 'nocare', lvl: 1, title: 'Nobody looking after the children' });
  S.gen.alone = sim.day;
}
// where the children play, and where their carers keep an eye on them: the open ground on the far side of the fire
export function playSpot(sim) {
  const W = sim.W, L = W.land, F = W.site.fire, dx = F.x - L.x, dy = F.y - L.y, d = Math.hypot(dx, dy) || 1;
  const cx = F.x + dx / d * 5, cy = F.y + dy / d * 5;
  for (let k = 0; k < 24; k++) {
    const a = rnd() * 6.283, r = rnd() * 4, x = Math.floor(cx + Math.cos(a) * r), y = Math.floor(cy + Math.sin(a) * r), t = y * MAP + x;
    if (W.reach[t] && W.cost[t] && W.cost[t] < 15 && !sim.nearPlot(x, y, 0)) return t;
  }
  return -1;
}

// ---------- the colony's firsts ----------
function milestones(sim) {
  const S = sim.S, F = S.gen.firsts;
  if (!F.lead) for (const k of S.crews) { const l = !k.gone && k.lead >= 0 ? S.cols[k.lead] : null; if (l && l.native && l.life >= 4) { F.lead = sim.day; sim.log(`${l.name}, born on this world, now leads the ${k.name} crew.`, 'good', { e: 'nativelead', lvl: 2, who: l.id, title: 'A native leads a crew' }); break; } }
}
// when a founder dies and none is left awake, an age has ended
export function lastFounder(sim, c) {
  const S = sim.S, F = S.gen.firsts;
  if (c.native || F.lastFounder || S.mode !== 'landfall') return;
  if (S.cols.some(o => !o.dead && !o.native)) return;
  if (!S.cols.some(o => !o.dead)) return;
  F.lastFounder = sim.day;
  sim.log(`${c.name} was the last of the founders who woke in printed bodies. Everyone in the colony now was born here.`, '', { e: 'lastfounder', lvl: 2, who: c.id, title: 'The last founder' });
}
// what the page shows of all this
export function genUI(sim) {
  const S = sim.S, G = S.gen, nm = i => S.cols[i] ? S.cols[i].name : '';
  return { rule: G.rule, womb: G.womb.map(e => ({ a: e.a, b: e.b, left: e.left, names: [nm(e.a), nm(e.b)] })), asks: G.asks.map(q => ({ a: q.a, b: q.b, names: [nm(q.a), nm(q.b)], d: q.d })), born: G.born, ok: ruleOk(sim), fedDays: FED_DAYS, tanks: TANKS };
}

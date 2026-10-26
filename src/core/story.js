// The hidden story's host. What the story is, and when and why anything in it happens, lives in the sealed texts
// (kept out of this public repository); this file only gives it ways to act on the colony and keeps the record of
// what the colony has found. A find is a thing someone brought back: an object, a sample, a reading, a record. The
// lab (or the Seed's own analyser, slowly) works on it like a sample of local life and says what it is. Readings
// are measurements kept day by day, drawn in the Stats window. A story can also open new things to build, put
// marks on the map, and write letters. Nothing here is told to the player as a quest: the Finds tab only lists
// what was found, when, by whom, and what the lab made of it.
// The story is advanced by its own rules (the same ones the bots play); in-game Claude may only pace it.
import { SEALED } from '../sealed/texts.js';
import { MAP, DAY_TICKS, HOUR, YEAR_DAYS, T, ACT, hidden } from './consts.js';
import { rnd, clamp } from './rng.js';
import { doyOf, seasonOf, dayWeather, tempAt } from './year.js';
import { built, TYPES } from './build.js';
import { remember, trustAll, die } from './life.js';
import { spend, happen } from './director.js';
import { scar } from './trauma.js';
import { injure } from './body.js';
import { mealsInStore } from './food.js';
import { KINDS } from './nb.js';
import { makePerson } from './founders.js';
import { lcg } from './rng.js';

const ST = SEALED.story || null;
export const storyOn = () => !!ST;
export const LAB_H = 8;                 // hours a find takes at the lab, unless the story says otherwise
const KEEP = 4000;                      // days of readings kept, about fifty years
export const M_PER = .8;                // metres of height for each step of the map's height field

export const newStory = () => ({ v: 1, st: {}, finds: [], facts: {}, rd: {}, marks: [], unlock: [], arch: [], notes: [], end: null, rv: 1, dbg: 0, ground: [] });

// ---------- the land's heights: metres above the lowest ground near the landing ----------
export function floorOf(sim) {
  if (sim.floor != null) return sim.floor;
  const W = sim.W, L = W.land; let lo = 255;
  for (let y = Math.max(0, L.y - 150); y < Math.min(MAP, L.y + 150); y += 2) for (let x = Math.max(0, L.x - 150); x < Math.min(MAP, L.x + 150); x += 2) { const e = W.elev[y * MAP + x]; if (e < lo) lo = e; }
  return (sim.floor = lo);
}
export const heightAt = (sim, t) => Math.max(0, Math.round((sim.W.elev[t] - floorOf(sim)) * M_PER));

// ---------- what the sealed story can do ----------
function api(sim) {
  const S = sim.S, Y = S.story, W = sim.W;
  const yr = (sim.day - 1) / YEAR_DAYS + (Y.dbg || 0);
  const G = {
    sim, S, W, st: Y.st, rnd, clamp, MAP, T, ACT, HOUR, DAY_TICKS, YEAR_DAYS,
    day: sim.day, year: yr, hour: sim.hour, cal: sim.cal, doy: doyOf(sim.cal), season: seasonOf(doyOf(sim.cal)),
    weather: d => dayWeather(W.seed, d ?? sim.cal), temp: h => tempAt(W.seed, sim.cal, h ?? sim.hour),
    // the record
    log: (m, k, ev) => sim.log(m, k, ev),
    letter: (title, m, o = {}) => sim.log(m, o.k || '', { e: o.e || 'story', lvl: o.lvl ?? 2, title, ...o.at }),
    find: (k, o = {}) => addFind(sim, k, o),
    found: k => Y.finds.some(f => f.k === k),
    know: k => !!Y.facts[k],
    learn: (k, text) => learn(sim, k, text),
    unlock: type => { if (TYPES[type] && !Y.unlock.includes(type)) { Y.unlock.push(type); Y.rv++; S.rv++; } },
    unlocked: type => Y.unlock.includes(type),
    note: m => { Y.notes.push({ d: sim.day, m }); Y.rv++; },
    open: (id, title, text) => { if (Y.arch.some(a => a.id === id)) return false; Y.arch.push({ id, d: sim.day, title, text }); Y.rv++; return true; },
    read: (key, v, name, unit) => reading(sim, key, v, name, unit),
    series: (key, name, unit, pts) => { Y.rd[key] = { name, unit, d0: 1, v: pts.slice(0, KEEP), fixed: true }; Y.rv++; },
    mark: (x, y, k = 'line') => { Y.marks.push([Math.round(x), Math.round(y), k]); Y.rv++; },
    unmark: k => { Y.marks = Y.marks.filter(m => m[2] !== k); Y.rv++; },
    ending: (k, title, text) => { if (Y.end) return; Y.end = { k, d: sim.day, title, text }; Y.rv++; },
    // the people
    people: () => S.cols.filter(c => !c.dead),
    asleep: c => c.act === ACT.BED || c.act === ACT.INSIDE,
    inside: c => (hidden(c.act) && c.where >= 0 ? S.projects.find(p => p.id === c.where) : null) || null,
    remember: (c, m) => remember(sim, c, m),
    scar: (c, k, n, m) => scar(sim, c, k, n, m),
    injure: (c, kind, s, how) => injure(sim, c, kind, s, how),
    strain: (c, n) => { c.str = clamp(c.str + n, 0, 100); },
    trust: (c, n) => { c.tru = clamp(c.tru + n, 0, 100); },
    trustAll: (n, m) => trustAll(sim, n, m),
    die: (c, why) => die(sim, c, why),
    // the colony
    built: type => built(S).filter(p => !type || p.type === type),
    projects: () => S.projects.filter(p => !p.gone),
    food: () => mealsInStore(sim, true) / Math.max(1, S.cols.filter(c => !c.dead).length),
    struggling: () => struggling(sim),
    spend: (n, why) => spend(sim, n, why),
    budgetLeft: () => S.dir ? S.dir.budget - S.dir.spent : 0,
    calm: () => !!S.dir && sim.day < S.dir.calm,
    happen: k => happen(sim, k),
    boost: (k, x) => { if (S.dir) { S.dir.boost = S.dir.boost || {}; S.dir.boost[k] = x; } },
    // the land
    floor: floorOf(sim), height: t => heightAt(sim, t), land: W.land, elev: t => W.elev[t], type: t => W.type[t],
    retype: (t, ty) => { if (W.type[t] === ty) return; Y.ground.push([t, ty]); W.type[t] = ty; sim.tnew.push(t, ty); },
    fell: t => { if (sim.W.gone.get(t) === undefined) sim.setGone(t, 0); },
    // the neighbours
    nb: () => (S.nb ? S.nb.list : []).map((q, i) => ({ i, id: KINDS[q.k] && KINDS[q.k].id, place: q.place, folk: q.folk, trust: q.trust, met: q.met, visits: q.visits, trades: q.trades, gave: q.gave || {}, dir: q.dir, km: q.km })),
    nbTrust: (i, n) => { const q = S.nb && S.nb.list[i]; if (q) { q.trust = clamp(q.trust + n, -100, 100); S.rv++; } },
    nbGuest: (i, g) => { const q = S.nb && S.nb.list[i]; if (q) { q.special = g; S.rv++; } },   // the next party from them brings this guest
    // the archive and the colony's rules
    newPerson: seed => makePerson(lcg(seed), S.archive.length, new Set(S.archive.map(p => p.name))),
    addArchive: p => { p.fid = S.archive.length; S.archive.push(p); S.rv++; },
    addRule: (k, v) => { if (!ST.rules || !ST.rules[k]) return; Y.rules = Y.rules || []; if (!Y.rules.includes(k)) { Y.rules.push(k); S.soc.rules[k] = v ?? ST.rules[k].opts[0][0]; S.rv++; } },
    nbNote: (i, k, v) => { const q = S.nb && S.nb.list[i]; if (q) { q.st = q.st || {}; q.st[k] = v; } },
  };
  return G;
}
function struggling(sim) {
  const S = sim.S, live = S.cols.filter(c => !c.dead), n = live.length;
  return n < 8 || mealsInStore(sim, true) / Math.max(1, n) < 5 || live.some(c => c.hungry) || (S.dir && sim.day < S.dir.calm);
}
function addFind(sim, k, o) {
  const Y = sim.S.story, def = ST.finds && ST.finds[k] || {}, i = Y.finds.length;
  const f = { i, k, d: sim.day, who: o.who != null && sim.S.cols[o.who] ? sim.S.cols[o.who].name : o.by || '', name: o.name || def.name || k, text: o.text || def.text || o.say || '', st: 0, h: o.h ?? def.h ?? LAB_H, work: 0, res: '', x: o.x, y: o.y };
  Y.finds.push(f); Y.rv++; sim.S.rv++;
  if (o.letter !== false) sim.log(`${o.say || `${f.who ? f.who + ' brought back' : 'The colony has'} something to look at: ${f.name.charAt(0).toLowerCase() + f.name.slice(1)}. ${f.text}`} The lab can work out what it is (Log, Finds).`, '', { e: 'find', lvl: o.lvl ?? 2, title: o.title || f.name, x: o.x, y: o.y, who: o.who });
  if (o.lab) analyseFind(sim, i);
  return f;
}
function learn(sim, k, text) {
  const Y = sim.S.story; if (Y.facts[k]) return false;
  Y.facts[k] = { d: sim.day, text: text || (ST.facts && ST.facts[k] && ST.facts[k].text) || '' }; Y.rv++; sim.S.rv++;
  const F = ST.facts && ST.facts[k]; if (F && F.unlock) for (const t of [].concat(F.unlock)) if (TYPES[t] && !Y.unlock.includes(t)) Y.unlock.push(t);
  return true;
}
// a measurement for today: the worst of the day is kept
function reading(sim, key, v, name, unit) {
  const Y = sim.S.story; let R = Y.rd[key];
  if (!R) { R = Y.rd[key] = { name, unit, d0: sim.day, v: [] }; }
  const i = sim.day - R.d0; if (i < 0) return;
  while (R.v.length < i) R.v.push(null);
  if (R.v[i] == null) Y.rv++;   // a new day's reading: the page gets the record again, once a day
  R.v[i] = R.v[i] == null ? +v.toFixed(3) : Math.max(R.v[i], +v.toFixed(3));
  if (R.v.length > KEEP) { const cut = R.v.length - KEEP; R.v.splice(0, cut); R.d0 += cut; }
}

// ---------- the lab ----------
export function analyseFind(sim, i) {
  const S = sim.S, f = S.story && S.story.finds[i], lab = S.F.lab;
  if (!f || f.st !== 0) return false;
  f.st = 1; lab.queue.push('f' + i); S.rv++; S.story.rv++;
  sim.log(`Queued ${f.name.charAt(0).toLowerCase() + f.name.slice(1)} for the lab.`);
  return true;
}
export const findOf = (S, q) => typeof q === 'string' && q[0] === 'f' && S.story ? S.story.finds[+q.slice(1)] : null;
export const findHours = (S, q) => { const f = findOf(S, q); return f ? f.h : LAB_H; };
// the lab finished with a find: what it is
export function findDone(sim, q) {
  const S = sim.S, f = findOf(S, q); if (!f) return;
  f.st = 2; f.dd = sim.day; S.story.rv++; S.rv++;
  const G = api(sim), r = ST && ST.lab ? ST.lab(G, f) : null;
  f.res = (r && r.text) || 'The lab found nothing out of the ordinary in it.';
  if (r && r.fact) learn(sim, r.fact, r.factText);
  sim.log(`${f.name}: ${f.res}`, 'good', { e: 'findres', lvl: 2, title: r && r.title || `What the lab made of ${f.name.charAt(0).toLowerCase() + f.name.slice(1)}` });
  if (r && r.then) r.then(G);
}

// ---------- the hooks the simulation calls ----------
const call = (sim, k, ...a) => { if (!ST || !ST[k] || !sim.S.story || sim.S.mode !== 'landfall') return; return ST[k](api(sim), ...a); };
export function storyInit(sim) { if (!sim.S.story) sim.S.story = newStory(); call(sim, 'init'); }
export const storyHour = sim => call(sim, 'hour');
export const storyMorning = sim => call(sim, 'morning');
export const storyVisit = (sim, i, P) => call(sim, 'visit', i, P);
export const storyTrade = (sim, i, give) => call(sim, 'trade', i, give);
export const storyBuilt = (sim, p) => call(sim, 'built', p);
export const storyRule = (sim, k, v) => call(sim, 'rule', k, v);
// how one person leans on a rule the story added: add(option, weight, why)
export const storyOpinion = (sim, c, k, add) => call(sim, 'opinion', c, k, add);
export const storyRuleOn = (S, k) => !!(S.story && S.story.rules && S.story.rules.includes(k));
export const STORY_RULES = (ST && ST.rules) || {};
// after loading a save: the world is made fresh from its seed, so the story's changes to the ground go back on
export function storyLoad(sim) {
  if (!sim.S.story) storyInit(sim);
  const W = sim.W; for (const [t, ty] of sim.S.story.ground) W.type[t] = ty;
}
// what a story building's card can do, and doing it
export function storyCard(sim, p) { const r = call(sim, 'card', p); return Array.isArray(r) ? r : []; }
export function storyAct(sim, m) {
  if (m.do === 'analyse') return analyseFind(sim, m.i);
  if (m.do === 'unanalyse') { const S = sim.S, lab = S.F.lab, f = S.story.finds[m.i]; if (f && f.st === 1 && lab.cur !== 'f' + m.i) { lab.queue = lab.queue.filter(q => q !== 'f' + m.i); f.st = 0; S.rv++; S.story.rv++; } return true; }
  const p = sim.S.projects.find(q => q.id === m.pid);
  if (p && storyCard(sim, p).some(a => a.id === m.id && !a.off)) { call(sim, 'act', p, m.id); sim.S.rv++; sim.S.story.rv++; return true; }
  return false;
}
// what the Seed would suggest building for the story's sake, with why
export function storyAdvice(sim) { const r = call(sim, 'advise'); return Array.isArray(r) ? r : []; }
// the ground a building would stand on, in words for the plan panel
export function storyPlot(sim, x, y, w, h) {
  const t = Math.floor(y + h / 2) * MAP + Math.floor(x + w / 2), m = heightAt(sim, t), r = call(sim, 'plot', x, y, w, h, m);
  return { m, note: typeof r === 'string' ? r : '' };
}

// ---------- for the page ----------
export function storyUI(sim) {
  const S = sim.S, Y = S.story; if (!Y) return null;
  return {
    rv: Y.rv, unlock: Y.unlock, marks: Y.marks, end: Y.end, facts: Object.values(Y.facts).filter(f => f.text).map(f => ({ d: f.d, text: f.text })),
    finds: Y.finds.map(f => ({ i: f.i, name: f.name, text: f.text, d: f.d, who: f.who, st: f.st, res: f.res, dd: f.dd || 0, h: f.h, left: f.st === 1 ? Math.max(0, f.h - (S.F.lab.cur === 'f' + f.i ? S.F.lab.work : 0)) : 0 })),
    arch: Y.arch, notes: Y.notes.slice(-60),
    rd: Object.entries(Y.rd).map(([k, R]) => ({ k, name: R.name, unit: R.unit, d0: R.d0, v: R.v, fixed: !!R.fixed })),
  };
}

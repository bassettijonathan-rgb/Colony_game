// In-game Claude, the narrator nobody sees. The page asks Claude (it alone can reach it); this side builds the
// questions from the colony and checks every answer before anything changes. Three jobs:
//  - the director: each season the rule-based director plans its events at once (director.js). Claude may send a
//    plan of its own for the same season, which replaces it only if every event is a known one, allowed in this
//    season, inside the season's days and within the share of the budget the rule-based plan had
//  - the writer: a few moments of colony life each season, about real people, each moving their strain a little
//    and leaving a memory, and at most one new custom a year, kept on its day every year like the others
//  - the chronicler: the chronicles of skips and of each year are written by rules at once; Claude may send the
//    same facts back in better words, and they replace the rule-based text
// When Claude can't be reached nothing waits on it: the rule-based plans and texts stand.
import { DAY_TICKS, YEAR_DAYS, SEASON_DAYS, SEASONS, WORK_NAME } from './consts.js';
import { doyOf, seasonOf } from './year.js';
import { EVENTS, PLAN_SHARE } from './director.js';
import { mealsInStore } from './food.js';
import { remember } from './life.js';
import { addCustom } from './society.js';

export const newNar = () => ({ n: 0, q: [], season: null, moments: [], custY: -1 });
// what each event the director can plan is, for Claude to choose from
const WHAT = {
  strike: 'dry lightning sets the scrub alight upwind of camp (needs a dry spell)',
  burst: 'a cloudburst in the hills: the river or lake comes up and may flood low buildings',
  wear: 'something the colony relies on wears out and breaks, and needs repairs',
  tremor: 'the ground shakes: buildings are damaged, some people inside hurt',
  blight: 'a mould through a growing field takes part of the crop',
  bug: 'one of the Seed’s own starter cultures gets loose and someone falls ill',
  flare: 'a flare on the sun: a particle storm a day later, everyone must shelter',
};
// the kinds of news the writer and chronicler never see: what the colony has found and is still working out
const QUIET = new Set(['find', 'findres', 'story', 'storybig', 'chronicle', 'moment']);
const MOOD = { lift: -6, weigh: 5, none: 0 };
const ageOf = (sim, c) => Math.max(0, Math.floor((sim.S.tick / DAY_TICKS - c.born) / YEAR_DAYS));
const clip = (s, n) => String(s == null ? '' : s).replace(/\s+/g, ' ').trim().slice(0, n);

function ask(sim, kind, body) {
  const N = sim.S.nar; if (!N) return 0;
  N.q.push({ id: ++N.n, kind, ...body }); if (N.q.length > 4) N.q.shift();
  return N.n;
}
// the page takes the questions as they come
export function narTake(S) { const N = S.nar; if (!N || !N.q.length) return null; const q = N.q; N.q = []; return q; }

// ---------- the season: a plan and a few moments ----------
// each morning: a new season has just been planned by the rules, so ask Claude for its own
export function narCheck(sim) {
  const S = sim.S, D = S.dir, N = S.nar; if (!N || S.mode !== 'landfall' || !D || D.s < 0) return;
  const key = Math.floor((sim.cal - 1) / YEAR_DAYS) * 4 + D.s; if (N.asked === key) return;
  N.asked = key; narSeason(sim);
}
function narSeason(sim) {
  const S = sim.S, D = S.dir, N = S.nar;
  const live = S.cols.filter(c => !c.dead), s = D.s, end = sim.day + SEASON_DAYS - (doyOf(sim.cal) % SEASON_DAYS) - 1;
  const people = live.filter(c => c.life >= 2).sort((a, b) => (b.str - a.str) || (a.id - b.id)).slice(0, 30).map(c => {
    const p = Object.entries(c.ties || {}).find(([, t]) => t.k === 'partner'), cr = c.crew >= 0 && S.crews[c.crew];
    return { id: c.id, name: c.name, age: ageOf(sim, c), born: c.native ? 'here' : 'a founder', traits: c.traits, work: cr ? WORK_NAME[cr.work] || cr.work : '', strain: Math.round(c.str), tired: Math.round(c.fat), partner: p && S.cols[p[0]] ? S.cols[p[0]].name : '', lately: (c.mem || []).slice(-2).map(m => m.m) };
  });
  const since = (sim.day - SEASON_DAYS) * DAY_TICKS;
  const recent = S.log.filter(e => e.t >= since && e.lvl >= 1 && e.e && !QUIET.has(e.e)).slice(-25).map(e => ({ day: Math.floor(e.t / DAY_TICKS) + 1, title: e.title || '', text: clip(e.m, 240) }));
  const brief = {
    season: SEASONS[s], year: Math.floor((sim.cal - 1) / YEAR_DAYS) + 1, today: sim.day, last: end, budget: D.budget, plannable: +(D.budget * PLAN_SHARE).toFixed(1),
    events: Object.entries(EVENTS).filter(([, e]) => e.seasons.includes(s)).map(([k, e]) => ({ k, cost: e.cost, what: WHAT[k] })),
    rulePlan: D.plan.map(p => ({ k: p.k, day: p.d })),
    colony: { people: live.length, bornHere: live.filter(c => c.native).length, children: live.filter(c => c.life <= 2).length, foodDays: Math.floor(mealsInStore(sim, true) / Math.max(1, live.length)), deathsSoFar: S.stats.deaths || 0, buildings: [...new Set(S.projects.filter(p => !p.gone && p.done && p.type !== 'test').map(p => p.name.replace(/ \d+$/, '')))], customs: (S.soc ? S.soc.cust : []).map(q => q.name), writeCustom: N.custY !== Math.floor((sim.cal - 1) / YEAR_DAYS) },
    people, recent,
  };
  N.season = { id: 0, s, end, budget: D.budget }; N.season.id = ask(sim, 'season', { brief });
}
// Claude's answer for the season, checked piece by piece; whatever fails a check is dropped, the rest stands
export function narApply(sim, m) {
  const S = sim.S, N = S.nar, D = S.dir, Q = N && N.season;
  if (!Q || m.id !== Q.id || !D || D.s !== Q.s) return { ok: false, why: 'stale' };
  N.season = null;
  const out = { plan: 0, moments: 0, custom: 0 };
  if (Array.isArray(m.plan) && m.plan.length <= 6) {
    let cost = 0, last = -9; const plan = [];
    for (const p of m.plan.slice().sort((a, b) => a.day - b.day)) {
      const e = EVENTS[p.k], d = Math.round(+p.day);
      if (!e || !e.seasons.includes(D.s) || !(d > sim.day && d <= Q.end) || d - last < 2 || cost + e.cost > Q.budget * PLAN_SHARE + .5) continue;
      plan.push({ d, k: p.k, tries: 0 }); cost += e.cost; last = d;
    }
    if (plan.length === m.plan.length) { D.plan = plan; D.by = 'claude'; out.plan = plan.length || -1; }
  }
  const alive = id => S.cols[id] && !S.cols[id].dead;
  for (const x of (Array.isArray(m.moments) ? m.moments : []).slice(0, 3)) {
    const d = Math.round(+x.day), who = [...new Set((Array.isArray(x.who) ? x.who : []).map(Number))].filter(alive).slice(0, 4);
    const title = clip(x.title, 60), text = clip(x.text, 700);
    if (!(d >= sim.day && d <= Q.end) || !who.length || !title || text.length < 20) continue;
    N.moments.push({ d, title, text, who, mood: MOOD[x.mood] != null ? x.mood : 'none', mem: clip(x.memory, 140) }); out.moments++;
  }
  const y = Math.floor((sim.cal - 1) / YEAR_DAYS), cu = m.custom;
  if (cu && N.custY !== y && (S.soc && S.soc.cust.length < 24)) {
    const d = Math.round(+cu.day), name = clip(cu.name, 40), text = clip(cu.text, 500);
    if (d >= sim.day && d <= Q.end && name && text.length >= 20 && !S.soc.cust.some(q => q.name.toLowerCase() === name.toLowerCase())) { N.moments.push({ d, title: name, text, who: [], mood: 'lift', custom: name }); N.custY = y; out.custom = 1; }
  }
  return { ok: true, ...out };
}
// each morning: the moments due today
export function narMorning(sim) {
  const S = sim.S, N = S.nar; if (!N || !N.moments.length) return;
  for (const x of N.moments) {
    if (x.d > sim.day) continue;
    x.done = true;
    const who = x.who.map(i => S.cols[i]).filter(c => c && !c.dead);
    if (x.custom) { addCustom(sim, { k: 'w', name: x.custom, doy: doyOf(sim.cal) }, x.text, x.custom); continue; }
    if (!who.length) continue;   // the people it was about are gone
    for (const c of who) { c.str = Math.max(0, Math.min(100, c.str + MOOD[x.mood])); if (x.mem) remember(sim, c, x.mem); }
    sim.log(x.text, x.mood === 'weigh' ? '' : 'good', { e: 'moment', lvl: 1, title: x.title, who: who[0].id });
  }
  N.moments = N.moments.filter(x => !x.done);
}

// ---------- the chronicle: the same facts, in better words ----------
export function narChron(sim, C) { if (C && sim.S.nar) ask(sim, 'chron', { i: C.id, title: C.title, text: C.text, year: !!C.year }); }
export function narChronText(sim, m) {
  const S = sim.S, C = S.chron && S.chron.find(q => q.id === m.i);
  if (!C || C.by || !Array.isArray(m.text)) return false;
  const text = m.text.map(t => clip(t, 1500)).filter(t => t.length > 0).slice(0, 12);
  if (!text.length || text.join(' ').length > 9000) return false;
  C.text = text; C.by = 'claude'; S.chronV = (S.chronV || 0) + 1; S.rv++;
  const e = S.log.find(q => q.e === 'chronicle' && q.ci === m.i); if (e) e.m = text.join('\n\n');
  return true;
}

// ---------- the year: what happened in it, kept for its chronicle ----------
const KEEP_TEXT = new Set(['moment', 'death', 'oldage', 'council', 'councilnew', 'rule', 'custom', 'protest', 'lost', 'nativelead', 'lastfounder', 'illfound', 'heartattack', 'storybig']);
export function yearNote(S, e) {
  if (!S.yev) return;
  S.yev.push({ n: e.n, t: e.t, e: e.e, m: KEEP_TEXT.has(e.e) ? clip(e.m, 600) : '', title: e.title || '', who: e.who });
  if (S.yev.length > 400) S.yev.splice(0, S.yev.length - 400);
}
export const yearMark = sim => { const S = sim.S, live = S.cols.filter(c => !c.dead); return { cal: sim.cal, day: sim.day, n: live.length, natives: live.filter(c => c.native).length, built: S.projects.filter(p => !p.gone && p.done).map(p => p.id) }; };

// Society: what a colony builds for itself once it is more than a camp. The school, where children learn from
// whoever teaches there and not only from their parents; the library, where keepers write down what the best people
// know so that it outlives them; the watch, who keep a lamp lit at night and step in when someone lashes out; and,
// from about fifty adults, a council the colony chooses for itself, which advises the Seed and can be asked before a
// rule changes. The colony lives by a few rules, and every rule has people for it and people against it: those who
// would rather have another carry it as a small weight, and enough of them, strained enough, stop work for a day.
// Customs grow out of what actually happens here: a day to remember a disaster by, children named for the dead, a
// supper at the first harvest after a hungry year, words for the seasons. In-game Claude will invent more of them.
import { DAY_TICKS, YEAR_DAYS, SEASON_DAYS, HOUR, SKILLS, SEASONS, SHIFTS } from './consts.js';
import { rnd, hash } from './rng.js';
import { remember } from './life.js';
import { built } from './build.js';
import { injure, woundText } from './body.js';
import { mealsInStore } from './food.js';
import { scar } from './trauma.js';
import { doyOf, seasonOf } from './year.js';

export const newSoc = () => ({ rules: { rations: 'equal', appr: 13, retire: 72, watch: 'calm', school: 'all' }, rec: {}, council: null, verdict: null, q: null, cust: [], deaths: [], alias: {}, night: -1, fear: 0, sch: -1, lib: -1, lean: 0, hv: 0, said: {}, view: null, lost: 0 });
const adultsOf = S => S.cols.filter(c => !c.dead && c.life >= 4);
const crewOf = (S, w) => S.crews.filter(k => !k.gone && k.work === w);
const membersOf = (S, w) => crewOf(S, w).flatMap(k => k.members).map(i => S.cols[i]).filter(c => c && !c.dead && !c.down && !(c.alone > 0));
const first = n => n.split(' ')[0];
export const SKILL_WORD = { building: 'building', engineering: 'engineering', fieldcraft: 'fieldcraft', medicine: 'medicine', botany: 'botany', cooking: 'cooking', leadership: 'leading people', teaching: 'teaching' };
const list = a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];

// ---------- the rules ----------
// each option is [value, label]; who prefers which, and why, comes from opinion() below
export const RULES = {
  children: { name: 'Children', opts: [['yes', 'Every couple'], ['fed', 'If food allows'], ['no', 'Not now']] },
  hours: { name: 'Working hours', opts: [[0, 'Short, 8 to 16'], [1, 'Day, 7 to 18'], [2, 'Long, 6 to 20']] },
  rations: { name: 'When food runs short', opts: [['equal', 'Equal shares'], ['work', 'Workers first'], ['young', 'Children first']] },
  appr: { name: 'Apprentices start at', opts: [[13, 'Thirteen'], [15, 'Fifteen']] },
  retire: { name: 'Elders stop working', opts: [[65, 'At 65'], [72, 'At 72'], [0, 'Never']] },
  school: { name: 'What the school teaches', opts: [['all', 'A little of everything'], ['trades', 'Building and making'], ['land', 'The land and food'], ['care', 'Healing and teaching']], need: 'school' },
  watch: { name: 'What the watch may do', opts: [['calm', 'Talk them down'], ['hold', 'Lock them up for a day']], need: 'watch' },
};
export const RULE_KEYS = Object.keys(RULES);
export function ruleNow(S, k) {
  if (k === 'children') return S.gen.rule;
  if (k === 'hours') return S.shift ?? 1;
  return S.soc.rules[k];
}
const optName = (k, v) => { const o = RULES[k].opts.find(q => q[0] === v); return o ? o[1] : String(v); };
const has = (S, t) => built(S).some(p => p.type === t && !p.shut);
const ruleLive = (S, k) => !RULES[k].need || has(S, RULES[k].need) || crewOf(S, RULES[k].need === 'school' ? 'teach' : 'watch').length > 0;

// what the colony looks like today, for everyone's opinions at once
function situation(sim) {
  const S = sim.S, live = S.cols.filter(c => !c.dead), days = mealsInStore(sim, true) / Math.max(1, live.length);
  return { short: days < 4 || live.some(c => c.hungry), school: has(S, 'school'), asking: new Set(S.gen.asks.flatMap(q => [q.a, q.b])), years: c => (sim.S.tick / DAY_TICKS - c.born) / YEAR_DAYS };
}
const HEAVY = new Set(['build', 'quarry', 'timber', 'mine', 'farm', 'forage']);
const TRADE = { build: 'trades', workshop: 'trades', mine: 'trades', quarry: 'trades', timber: 'trades', farm: 'land', forage: 'land', kitchen: 'land', lab: 'land', clinic: 'care', care: 'care', teach: 'care' };
// one person's view of one rule: a score for each option, and the main reason behind the best of them
export function opinion(sim, c, k, X) {
  const S = sim.S, y = X.years(c), out = {}, why = {};
  const kids = c.kids.map(i => S.cols[i]).filter(o => o && !o.dead), add = (v, d, w) => { out[v] = (out[v] || 0) + d; if (d > 0 && (!why[v] || d > why[v][0])) why[v] = [d, w]; };
  const ri = RULE_KEYS.indexOf(k);
  RULES[k].opts.forEach(([v], i) => add(v, hash(c.id, ri * 7 + i, 4441) * .24 - .12, ''));
  const work = c.crew >= 0 && S.crews[c.crew] ? S.crews[c.crew].work : '';
  switch (k) {
    case 'children':
      add('fed', .3, 'wants food put by before more mouths');
      if (X.asking.has(c.id)) add('yes', .7, 'is waiting for a child of their own');
      else if (c.partner >= 0 && y < 45 && kids.length < 2) add('yes', .35, 'hopes for a child one day');
      if (kids.some(o => o.life <= 1)) add('yes', .2, 'has small children and loves it');
      if (c.traits.includes('careful')) add('fed', .25, 'is careful by nature');
      if (c.traits.includes('anxious')) { add('fed', .15, 'worries there won’t be enough'); add('no', .15, 'worries there won’t be enough'); }
      if (X.short) { add('no', .5, 'says there isn’t enough food as it is'); add('fed', .2, 'says there isn’t enough food as it is'); }
      if (c.native) add('yes', .15, 'says this world needs people born to it');
      break;
    case 'hours':
      add(1, .3, 'thinks a normal day is right');
      if (c.fat > 55) add(0, .5, 'is worn out');
      if (c.traits.includes('patient')) add(2, .25, 'doesn’t mind long days');
      if (c.traits.includes('restless')) add(2, .15, 'would rather be busy');
      if (X.short) add(2, .35, 'wants more hands on food while it is short');
      if (c.life === 5) add(0, .3, 'is getting on');
      if (kids.some(o => o.life <= 2)) add(0, .25, 'wants time with their children');
      break;
    case 'rations':
      add('equal', .4, 'thinks everyone should get the same');
      if (kids.some(o => o.life < 3)) add('young', .6, 'has children of their own');
      if (HEAVY.has(work)) add('work', .35, 'does heavy work all day');
      if (c.retired || c.life === 5) add('young', .2, 'says the young matter more than the old');
      if (c.traits.includes('sociable')) add('equal', .1, 'cares about fairness');
      break;
    case 'appr':
      add(13, .2, 'thinks thirteen is old enough');
      if (kids.some(o => { const a = X.years(o); return a >= 6 && a < 16; })) { if (X.school) add(15, .35, 'wants their children schooled longer'); else add(13, .1, 'says there is no school to keep them in'); }
      if (X.short) add(13, .4, 'says the crews need the hands');
      if (c.native && c.gen && y < 30) add(13, .15, 'started at thirteen themselves');
      if (c.traits.includes('careful')) add(15, .15, 'is careful by nature');
      break;
    case 'retire':
      add(72, .3, 'thinks seventy-two is fair');
      if (y >= 58) add(65, .6, 'is getting on themselves');
      if (y < 40 && X.short) add(0, .3, 'says every pair of hands counts');
      if (c.traits.includes('stubborn') && y >= 55) add(0, .3, 'wants to keep working');
      if (c.traits.includes('patient')) add(72, .1, 'is patient');
      break;
    case 'school':
      add('all', .3, 'wants the children to learn a bit of everything');
      if (kids.length && TRADE[work]) add(TRADE[work], .3, 'wants the children to learn their trade');
      if (X.short) add('land', .3, 'says food comes first');
      if (!c.native) add('all', .15, 'remembers a broad schooling at home');
      break;
    case 'watch':
      add('calm', .4, 'says nobody should be locked up');
      if (c.hitBy != null) add('hold', .7, 'was hurt when someone lashed out');
      if (c.traits.includes('anxious')) add('hold', .3, 'would feel safer');
      if (c.traits.includes('careful')) add('hold', .1, 'would feel safer');
      if (c.traits.includes('solitary') || c.traits.includes('stubborn')) add('calm', .2, 'distrusts anyone with that much say');
      if (c.held) add('calm', .8, 'was locked up once');
      break;
  }
  const cur = ruleNow(S, k);
  if (c.traits.includes('stubborn')) add(cur, .15, 'is slow to change their mind');
  let best = null; for (const [v] of RULES[k].opts) if (best === null || out[v] > out[best]) best = v;
  return { s: out, best, why: why[best] ? why[best][1] : '' };
}

// ---------- once a day, at four in the morning ----------
export function socDay(sim) {
  const S = sim.S, Q = S.soc, d = sim.day, X = situation(sim), adults = adultsOf(S);
  // what everyone thinks of the rules, and what it costs them to live under ones they'd change
  const view = {};
  for (const k of RULE_KEYS) {
    if (!ruleLive(S, k)) continue;
    const cur = ruleNow(S, k), v = { for: 0, n: 0, pref: {}, why: {}, opp: [] };
    for (const c of adults) {
      const o = opinion(sim, c, k, X), gap = o.s[o.best] - o.s[cur];
      v.n++;
      if (o.best === cur || gap < .15) { v.for++; continue; }
      v.pref[o.best] = (v.pref[o.best] || 0) + 1; (v.why[o.best] = v.why[o.best] || {})[o.why] = (v.why[o.best][o.why] || 0) + 1;
      if (gap > .5) { c.str = Math.min(100, c.str + .4); v.opp.push(c.id); }   // the rule weighs on them
    }
    view[k] = v;
  }
  Q.view = { d, rules: view };
  protest(sim, view);
  council(sim, adults, view);
  // fear of a harsh watch fades, slowly, and while it lasts it weighs on everyone a little
  if (Q.fear > 0) { for (const c of adults) c.str = Math.min(100, c.str + Q.fear / 40); Q.fear = Math.max(0, Q.fear - .5); }
  customsDay(sim);
}
// enough people strained enough against a rule stop work for a day, together
function protest(sim, view) {
  const S = sim.S, Q = S.soc;
  if (Q.said.protest && sim.day - Q.said.protest < 30) return;
  for (const k in view) {
    const v = view[k]; if (v.n < 8 || v.opp.length / v.n < .6) continue;
    const opp = v.opp.map(i => S.cols[i]), str = opp.reduce((a, c) => a + c.str, 0) / opp.length;
    if (str < 55) continue;
    Q.said.protest = sim.day;
    for (const c of opp) { c.sit = sim.day; c.tru = Math.max(0, c.tru - 2); remember(sim, c, `Stopped work for a day over the rule on ${RULES[k].name.toLowerCase()}.`); }
    const alt = Object.entries(v.pref).sort((a, b) => b[1] - a[1])[0];
    sim.log(`${opp.length} people have stopped work for the day and sat down at the fire together, over the rule on ${RULES[k].name.toLowerCase()}. Most of them would rather have “${optName(k, isNaN(+alt[0]) ? alt[0] : +alt[0])}”. They go back to work tomorrow.`, 'bad', { e: 'protest', lvl: 2, title: 'A sit-down' });
    return;
  }
}

// ---------- the council ----------
export const COUNCIL_AT = 50;
const seatsFor = n => n >= 120 ? 7 : 5;
// who the colony would choose: the well liked, the experienced, the ones who already lead a crew
function standing(sim, c) {
  const S = sim.S, y = (S.tick / DAY_TICKS - c.born) / YEAR_DAYS, friends = Object.values(c.ties).filter(t => t.k === 'friend' || t.k === 'partner').length;
  return friends * 1.5 + c.skills.leadership + (y >= 30 && y < 75 ? 2 : 0) + (S.crews.some(k => !k.gone && k.lead === c.id) ? 2 : 0) + c.tru / 50 + hash(c.id, Math.floor(sim.cal / YEAR_DAYS), 77) * 2;
}
function choose(sim, adults) {
  const S = sim.S, n = seatsFor(adults.length);
  return adults.filter(c => !c.retired || (S.tick / DAY_TICKS - c.born) / YEAR_DAYS < 80).sort((a, b) => standing(sim, b) - standing(sim, a)).slice(0, n).map(c => c.id);
}
function council(sim, adults, view) {
  const S = sim.S, Q = S.soc, doy = doyOf(sim.cal);
  if (!Q.council) {
    if (adults.length < COUNCIL_AT) return;
    Q.council = { since: sim.day, members: choose(sim, adults), chose: sim.day };
    const names = Q.council.members.map(i => S.cols[i].name);
    for (const i of Q.council.members) remember(sim, S.cols[i], 'Was chosen for the first council.');
    sim.log(`The colony has chosen a council for the first time: ${list(names)}. It speaks for the colony and can be asked before a rule changes. It only advises: the Seed decides, but people notice whether it listens.`, 'good', { e: 'council', lvl: 2, title: 'The first council' });
    return;
  }
  const C = Q.council;
  // the dead and the departed are replaced; every Thaw the colony chooses again
  C.members = C.members.filter(i => S.cols[i] && !S.cols[i].dead);
  if ((doy === 0 && C.chose !== sim.day && sim.day - C.chose > 10) || C.members.length < seatsFor(adults.length) - 1) {
    const was = new Set(C.members); C.members = choose(sim, adults); C.chose = sim.day;
    const fresh = C.members.filter(i => !was.has(i)).map(i => S.cols[i].name);
    if (fresh.length) sim.log(`The colony chose its council again. New on it: ${list(fresh)}.`, '', { e: 'councilnew', lvl: 1, title: 'A new council' });
  }
  // a question the Seed put to it yesterday: the answer, this morning
  if (Q.q && Q.q.d < sim.day) {
    const { k, v } = Q.q, X = situation(sim), cur = ruleNow(S, k);
    const votes = C.members.map(i => { const c = S.cols[i], o = opinion(sim, c, k, X), yes = o.s[v] >= o.s[cur]; return { id: i, yes, why: yes ? (o.best === v ? o.why : '') : o.why }; });
    const yes = votes.filter(q => q.yes).length;
    Q.verdict = { k, v, d: sim.day, yes, no: votes.length - yes, votes };
    Q.q = null;
    const reasons = votes.filter(q => !q.yes && q.why).slice(0, 2).map(q => `${first(S.cols[q.id].name)} ${q.why}`);
    sim.log(`The council has answered the Seed: should the rule on ${RULES[k].name.toLowerCase()} be “${optName(k, v)}”? ${yes} of ${votes.length} say yes.${reasons.length ? ` Against: ${reasons.join('; ')}.` : ''} Change the rule in the Society window, or leave it.`, yes > votes.length / 2 ? 'good' : '', { e: 'verdict', lvl: 2, title: 'The council’s answer' });
  }
  // unasked: a rule most of the colony wants changed
  if (sim.day % 10 === 0) for (const k in view) {
    const v = view[k]; if (v.n < 10 || (v.n - v.for) / v.n < .5) continue;
    if (Q.said['c' + k] && sim.day - Q.said['c' + k] < 40) continue;
    Q.said['c' + k] = sim.day;
    const alt = Object.entries(v.pref).sort((a, b) => b[1] - a[1])[0], val = isNaN(+alt[0]) ? alt[0] : +alt[0];
    sim.log(`The council asks the Seed to change the rule on ${RULES[k].name.toLowerCase()}: ${v.n - v.for} of ${v.n} adults would rather have “${optName(k, val)}”.`, '', { e: 'councilask', lvl: 1, title: 'The council asks' });
    break;
  }
}
// the Seed changing a rule: with the council, against it, or without asking
export function setRule(sim, k, v) {
  const S = sim.S, Q = S.soc, cur = ruleNow(S, k);
  if (!RULES[k] || !RULES[k].opts.some(q => q[0] === v) || v === cur) return false;
  if (k === 'children') S.gen.rule = v;
  else if (k === 'hours') { S.shift = v; for (const cr of S.crews) if (!cr.gone) cr.shift = v; }
  else Q.rules[k] = v;
  if (k === 'retire') for (const c of S.cols) if (!c.dead && c.retired && (v === 0 || (S.tick / DAY_TICKS - c.born) / YEAR_DAYS < v)) { c.retired = false; remember(sim, c, 'Went back to work under the new rule.'); }
  let note = '';
  const C = Q.council, V = Q.verdict;
  if (C && C.members.length) {
    const asked = V && V.k === k && V.v === v && sim.day - V.d <= 10, members = C.members.map(i => S.cols[i]).filter(c => c && !c.dead);
    if (asked && V.yes > V.no) { for (const c of S.cols) if (!c.dead && c.life >= 4) c.tru = Math.min(100, c.tru + 1); for (const c of members) c.tru = Math.min(100, c.tru + 2); note = ' The council agreed, and people noticed the Seed listened.'; }
    else if (asked) { for (const q of V.votes) if (!q.yes && S.cols[q.id]) S.cols[q.id].tru = Math.max(0, S.cols[q.id].tru - 6); note = ' The council was against it, and its members won’t forget that the Seed went ahead anyway.'; }
    else { for (const c of members) c.tru = Math.max(0, c.tru - 2); note = ' The council was not asked.'; }
    Q.verdict = null;
  }
  S.rv++;
  sim.log(`The colony’s rule on ${RULES[k].name.toLowerCase()} is now: ${optName(k, v).toLowerCase()}.${note}`, '', { e: 'rule', lvl: 1, title: 'A rule changed' });
  return true;
}
export function askCouncil(sim, k, v) {
  const S = sim.S, Q = S.soc;
  if (!Q.council || !RULES[k] || v === ruleNow(S, k)) return false;
  Q.q = { k, v, d: sim.day }; Q.verdict = null; S.rv++;
  sim.log(`The Seed put a question to the council: should the rule on ${RULES[k].name.toLowerCase()} be “${optName(k, v)}”? It meets tonight and answers in the morning.`);
  return true;
}

// ---------- the school ----------
// what each choice of lessons teaches most of
const CURR = { all: [], trades: ['building', 'engineering', 'leadership'], land: ['fieldcraft', 'botany', 'cooking'], care: ['medicine', 'teaching', 'botany'] };
export const PUPILS = 8;   // one teacher for every eight children
export const pupilsOf = S => S.cols.filter(c => !c.dead && c.life === 2);
// each morning: what yesterday's lessons were worth, from who taught and what the library holds
export function lesson(sim) {
  const S = sim.S, Q = S.soc;
  if (Q.les && Q.les.d === sim.day) return Q.les;
  const T = S.cols.filter(o => !o.dead && o.taught === sim.day - 1), P = S.cols.filter(o => !o.dead && o.sch === sim.day - 1).length, focus = CURR[Q.rules.school] || [];
  const aim = {}, lib = Q.lib >= 0;
  for (const k of SKILLS) { const best = T.length ? Math.max(...T.map(o => o.skills[k])) : 0, w = !focus.length ? .75 : focus.includes(k) ? 1 : .45; aim[k] = Math.min(7, Math.max(best * .65, lib ? (Q.rec[k] || 0) * .6 : 0)) * w; }
  const tch = T.length ? Math.max(...T.map(o => o.skills.teaching)) : 0;
  return Q.les = { d: sim.day, aim, pace: T.length ? .02 * (1 + tch / 10) * Math.min(1, PUPILS * T.length / Math.max(1, P)) : 0 };
}
// the library's shelf for one skill: what an apprentice can still learn from it, with nobody better to teach them
export const shelf = (S, k) => S.soc && S.soc.lib >= 0 ? (S.soc.rec[k] || 0) * .8 : 0;

// ---------- the library ----------
// an hour of a keeper's work: writing down what the best of the colony knows, the biggest gap in the records first
export function keepHour(sim, c) {
  const S = sim.S, Q = S.soc, live = S.cols.filter(o => !o.dead && o.life >= 4);
  let bk = null, gap = .2;
  for (const k of SKILLS) { const best = Math.max(0, ...live.map(o => o.skills[k])), g = best - (Q.rec[k] || 0); if (g > gap) { gap = g; bk = k; } }
  if (!bk) return false;
  Q.rec[bk] = Math.round(((Q.rec[bk] || 0) + .004 * gap * (1 + c.skills.teaching / 10 + c.skills[bk] / 20)) * 1000) / 1000;
  return true;
}
export const libraryWork = S => { const live = S.cols.filter(o => !o.dead && o.life >= 4); return SKILLS.some(k => Math.max(0, ...live.map(o => o.skills[k])) - (S.soc.rec[k] || 0) > .2); };
// a fire in the library burns what was written
export function libraryBurned(sim, frac) {
  const Q = sim.S.soc; let n = 0;
  for (const k in Q.rec) { const was = Q.rec[k]; Q.rec[k] = Math.round(was * (1 - frac) * 1000) / 1000; if (was - Q.rec[k] > .5) n++; }
  if (n) sim.log(`Much of what the library had written down burned with it.`, 'bad', { e: 'libburn', lvl: 1, title: 'Records lost' });
}
// when someone dies who knew far more of something than anyone else, and it was never written down
export function lostWith(sim, c) {
  const S = sim.S, Q = S.soc; if (!Q || c.life < 4) return;
  const live = S.cols.filter(o => !o.dead && o !== c && o.life >= 3), gone = [];
  for (const k of SKILLS) {
    const v = c.skills[k]; if (v < 5) continue;
    const next = Math.max(0, ...live.map(o => o.skills[k])), rec = Q.lib >= 0 ? Q.rec[k] || 0 : 0;
    if (v - Math.max(next, rec) >= 2) gone.push(SKILL_WORD[k]);
  }
  if (!gone.length) return;
  Q.lost++;
  sim.log(`With ${c.name} went most of what the colony knew of ${list(gone)}. Nobody else comes close${Q.lib >= 0 ? ', and the library had only part of it written down' : ', and none of it was written down'}.`, 'bad', { e: 'lost', lvl: 2, who: c.id, title: 'Knowledge lost' });
}

// ---------- the watch ----------
// a watch house and someone in the watch crew to keep it: one of them stays up each night, by turns, and sleeps
// the next morning; the rest walk the camp by day
export function socHour(sim) {
  const S = sim.S, Q = S.soc, h = Math.round(sim.hour) % 24;
  const sc = built(S).find(p => p.type === 'school' && !p.shut), lib = built(S).find(p => p.type === 'library' && !p.shut);
  Q.sch = sc && membersOf(S, 'teach').some(c => { const sh = SHIFTS[S.crews[c.crew].shift]; return h >= sh.a && h < sh.b && !(c.sleepTill > S.tick); }) ? sc.id : -1;
  Q.lib = lib ? lib.id : -1;
  if (h === 20) {
    const post = built(S).find(p => p.type === 'watch' && !p.shut), able = membersOf(S, 'watch').filter(c => !(c.cap && c.cap.move < .5) && c.carried < 0);
    Q.night = -1;
    if (post && able.length) {
      const w = able.sort((a, b) => (a.lastNight || 0) - (b.lastNight || 0) || a.fat - b.fat)[0];
      w.lastNight = sim.day; w.nightEnd = S.tick + 10 * HOUR; w.sleepTill = w.nightEnd + 7 * HOUR; Q.night = w.id;
    }
  }
  if (h === 19) gather(sim);
}
// someone of the watch, awake and on duty, who could step in: tonight's watcher at night, any of them by day
export function watcher(sim) {
  const S = sim.S, Q = S.soc, night = sim.hour < sim.dawn || sim.hour >= sim.dusk;
  if (night) { const w = Q.night >= 0 ? S.cols[Q.night] : null; return w && !w.dead && w.nightEnd > S.tick && w.plan === 'watch' ? w : null; }
  return membersOf(S, 'watch').find(c => c.plan === 'work') || null;
}
// a breakdown that turns on someone: rare, and only against a rival close by. What came of it: 'held', 'calmed',
// 'hit', or null when it didn't happen
export function lashOut(sim, c) {
  const S = sim.S, Q = S.soc;
  // once a season at most for anyone, and rarer still when the colony has just seen one
  if (c.fought !== undefined && sim.day - c.fought < SEASON_DAYS) return null;
  let p = .03; if (c.traits.includes('reckless')) p += .04; if (c.traits.includes('stubborn')) p += .02; if (c.traits.includes('steady') || c.traits.includes('patient')) p -= .02;
  if (Q.fightD !== undefined && sim.day - Q.fightD < 5) p /= 3;
  if (rnd() >= p) return null;
  const r = Object.entries(c.ties).map(([id, t]) => t.k === 'rival' ? S.cols[id] : null).find(o => o && !o.dead && o.life >= 3 && !o.down && Math.hypot(o.x - c.x, o.y - c.y) < 40);
  if (!r) return null;
  S.stats.fights = (S.stats.fights || 0) + 1; c.fought = Q.fightD = sim.day;
  const w = watcher(sim), first2 = S.stats.fights === 1;
  for (const [x, y] of [[c, r], [r, c]]) { const t = x.ties[y.id]; if (t) t.a = Math.max(-100, t.a - 20); }
  if (w && w !== c && w !== r) {
    remember(sim, c, `Lashed out at ${r.name}. ${w.name} of the watch stopped it.`); remember(sim, r, `${c.name} went for them. ${w.name} of the watch stepped in.`);
    if (Q.rules.watch === 'hold') {
      c.held = S.tick + DAY_TICKS; c.str = Math.min(100, c.str + 10); c.tru = Math.max(0, c.tru - 5); Q.fear = Math.min(30, Q.fear + 4);
      for (const id in c.ties) { const o = S.cols[id]; if (o && !o.dead && (c.ties[id].k === 'friend' || c.ties[id].k === 'partner')) o.str = Math.min(100, o.str + 4); }
      sim.log(`${c.name} lashed out at ${r.name}. ${w.name} of the watch stepped in before anyone was hurt, and locked ${first(c.name)} in the watch house for a day.`, 'bad', { e: first2 ? 'firstfight' : 'fight', lvl: 2, who: c.id, title: 'A fight, stopped' });
      return 'held';
    }
    sim.log(`${c.name} lashed out at ${r.name}. ${w.name} of the watch stepped in and talked ${first(c.name)} down before anyone was hurt.`, 'bad', { e: first2 ? 'firstfight' : 'fight', lvl: 2, who: c.id, title: 'A fight, stopped' });
    return 'calmed';
  }
  const ws = injure(sim, r, 'fight', .1 + rnd() * .25, `when ${c.name} lashed out at them`);
  r.hitBy = c.id; scar(sim, r, 'hurt', 18, `${c.name} went for them.`);
  remember(sim, c, `Lashed out at ${r.name} and hurt them.`); remember(sim, r, `${c.name} went for them and hurt them.`);
  for (const o of S.cols) if (!o.dead && o.life >= 4 && o !== c) o.tru = Math.max(0, o.tru - .5);
  sim.log(`${c.name} broke down and went for ${r.name}: ${ws.map(q => woundText(q).toLowerCase()).join(', and ')}.${S.crews.some(k => !k.gone && k.work === 'watch') ? '' : ' Nobody was there to step in.'}`, 'bad', { e: first2 ? 'firstfight' : 'fight', lvl: 2, who: r.id, title: 'Someone got hurt in a fight' });
  return 'hit';
}

// ---------- rationing ----------
// supper when there isn't enough for everyone: whoever the rule puts first is fed first
const firstIn = (S, c) => S.soc.rules.rations === 'young' ? c.life < 3 : S.soc.rules.rations === 'work' ? c.crew >= 0 && S.crews[c.crew] && HEAVY.has(S.crews[c.crew].work) && c.life >= 3 : false;
export function giveWay(sim, c) {
  const S = sim.S; if (!S.soc || S.soc.rules.rations === 'equal' || firstIn(S, c)) return false;
  const left = mealsInStore(sim, true) + Math.floor(S.food);
  let owed = 0; for (const o of S.cols) if (!o.dead && o.ate !== sim.day && firstIn(S, o)) owed++;
  return owed > 0 && left < owed + 1;
}

// ---------- customs ----------
// remembered deaths, for the days of remembrance
export function noteDeath(sim, c, why) {
  const Q = sim.S.soc; if (!Q) return;
  Q.deaths.push({ d: sim.day, why, n: c.name }); if (Q.deaths.length > 40) Q.deaths.shift();
}
export const noteEvent = (sim, k) => {
  const Q = sim.S.soc; if (!Q) return;
  if (k === 'fire' && Q.lastfire !== sim.day) Q.fireDays = (Q.fireDays || []).filter(d => sim.day - d < SEASON_DAYS).concat(sim.day);
  Q['last' + k] = sim.day;
};
const REM = {
  fire: ['Ash Day', 'in the fire'], flood: ['High Water', 'in the flood'], cold: ['the Long Night', 'in the cold'], hunger: ['the Lean Day', 'of hunger'],
  sick: ['the Quiet Day', 'of the sickness'], other: ['the Day of Names', 'in those few days'],
};
const kindOf = (Q, ds, day) => {
  if (Q.lastfire && day - Q.lastfire <= 10) return 'fire';
  if (Q.lastflood && day - Q.lastflood <= 10) return 'flood';
  const n = w => ds.filter(q => w(q.why)).length;
  return n(w => w === 'froze') * 2 >= ds.length ? 'cold' : n(w => w === 'starved') * 2 >= ds.length ? 'hunger' : n(w => w.startsWith('ill:')) * 2 >= ds.length ? 'sick' : 'other';
};
const SNAME = SEASONS.map(n => n === 'Storm' ? 'the storm season' : n);
const seasonDay = doy => `day ${doy % SEASON_DAYS + 1} of ${SNAME[seasonOf(doy)]}`;
function addCustom(sim, cu, text, title) {
  const S = sim.S; cu.d = sim.day; S.soc.cust.push(cu); S.rv++;
  sim.log(text, 'good', { e: 'custom', lvl: 2, title });
}
function customsDay(sim) {
  const S = sim.S, Q = S.soc, d = sim.day, doy = doyOf(sim.cal), C = Q.cust, hasC = k => C.find(q => q.k === k);
  // a day of remembrance, after three deaths in ten days or two in one
  const recent = Q.deaths.filter(q => d - q.d <= 10 && !q.rem), today = recent.filter(q => q.d >= d - 1);
  if (recent.length >= 3 || today.length >= 2) {
    const kind = kindOf(Q, recent, d), [name, how] = REM[kind];
    for (const q of recent) q.rem = true;
    if (!C.some(q => q.k === 'rem' && q.kind === kind)) {
      const at = doyOf(sim.cal - 1);
      addCustom(sim, { k: 'rem', kind, name, doy: at, names: recent.map(q => q.n) }, `${recent.length} people died ${how}: ${list(recent.map(q => q.n))}. The colony means to remember them. Every year on ${seasonDay(at)}, it will gather at the fire in the evening and say their names. People are calling it ${name}.`, 'A day to remember');
    } else { const cu = C.find(q => q.k === 'rem' && q.kind === kind); cu.names.push(...recent.map(q => q.n)); }
  }
  // landfall, a year on
  if (d === YEAR_DAYS + 1 && !hasC('landfall')) addCustom(sim, { k: 'landfall', name: 'Landfall Day', doy: doyOf(1 + (S.y0 || 0)) }, 'A year since the lander came down. The colony marked it at the fire tonight, and means to every year: Landfall Day.', 'Landfall Day');
  // the first harvest after a hungry year is a supper everyone shares
  if (S.cols.some(c => !c.dead && c.hungry)) Q.lean++;
  const hv = S.stats.harvests || 0, newYear = Math.floor(sim.cal / YEAR_DAYS);
  if (hv > Q.hv) {
    if (Q.hvYear !== newYear) {
      Q.hvYear = newYear;
      if (hasC('harvest')) Q.feast = d;
      else if (Q.lean >= 3) { Q.feast = d; addCustom(sim, { k: 'harvest', name: 'the Harvest Supper', doy: -1 }, 'After the hungry weeks, the first harvest of the year is in. Tonight everyone eats together at the fire, and the colony means to do it every year, at the first harvest: the Harvest Supper.', 'The Harvest Supper'); }
      Q.lean = 0;
    }
    Q.hv = hv;
  }
  // words for the seasons, from what they did to the colony
  if (doy % SEASON_DAYS === SEASON_DAYS - 1) {
    const s = seasonOf(doy), ds = Q.deaths.filter(q => d - q.d < SEASON_DAYS);
    let w = '';
    if (s === 3 && ds.filter(q => q.why === 'froze').length >= 2) w = 'the Long Night';
    else if (s === 0 && Q.lean >= 5) w = 'the Lean';
    else if (s === 1 && Q.lastfire && d - Q.lastfire < SEASON_DAYS && (Q.fireDays || []).filter(q => d - q < SEASON_DAYS).length >= 3) w = 'the Burning';
    else if (s === 2 && Q.lastflood && d - Q.lastflood < SEASON_DAYS) w = 'the Wet';
    if (w && !Q.alias[s]) { Q.alias[s] = w; addCustom(sim, { k: 'word', name: w, s, doy: -1 }, `People have started calling ${SNAME[s]} “${w}”, after this one.`, 'A new word'); }
  }
}
// the evening of a custom's day: everyone gathers at the fire
function gather(sim) {
  const S = sim.S, Q = S.soc, doy = doyOf(sim.cal);
  const today = Q.cust.filter(q => q.doy === doy && q.d < sim.day);
  if (Q.feast === sim.day) today.push(Q.cust.find(q => q.k === 'harvest'));
  if (!today.length) return;
  for (const c of S.cols) if (!c.dead && c.life >= 1) { c.str = Math.max(0, c.str - 8); for (const t of c.tr || []) if (t.k === 'grief' || t.k === 'death') t.w *= .9; }
  for (const cu of today) if (cu) sim.log(cu.k === 'rem' ? `${cu.name}: the colony gathered at the fire and said the names of ${list(cu.names)}.` : cu.k === 'harvest' ? 'The Harvest Supper: the colony ate together at the fire to mark the first harvest of the year.' : `${cu.name}: the colony gathered at the fire tonight.`, 'good', { e: 'gather', lvl: 1, title: cu.name.replace(/^the /, 'The ') });
}
// a child named for someone the parents lost
export function deadName(sim, a, b, used) {
  const S = sim.S, Q = S.soc; if (!Q) return null;
  const named = Q.cust.some(q => q.k === 'names');
  if (rnd() >= (named ? .45 : .2)) return null;
  for (const p of [a, b]) for (const id in p.ties) {
    const o = S.cols[id], t = p.ties[id];
    if (!o || !o.dead || !t.k || (t.k !== 'friend' && t.k !== 'partner' && t.k !== 'parent' && t.k !== 'sibling' && t.k !== 'child')) continue;
    const g = first(o.name); if (used.has(g)) continue;
    return { g, o, p, named };
  }
  return null;
}
export function namedFor(sim, c, dn) {
  remember(sim, dn.p, `Named their child ${first(c.name)}, after ${dn.o.name}.`);
  if (!dn.named) addCustom(sim, { k: 'names', name: 'Names of the dead', doy: -1 }, `${c.name} was named for ${dn.o.name}, whom ${dn.p.name} lost. Others are starting to do the same: a name kept alive in a child.`, 'Names of the dead');
}
// coming of age: the first native sixteen starts a custom every native sixteen after keeps
export function ofAge(sim, c) {
  const S = sim.S, Q = S.soc; if (!Q) return;
  if (!Q.cust.some(q => q.k === 'age')) addCustom(sim, { k: 'age', name: 'Coming of Age', doy: -1 }, `The colony sat up late at the fire for ${c.name}'s sixteenth. Every child born here will get the same night: Coming of Age.`, 'Coming of Age');
  c.str = Math.max(0, c.str - 10);
  for (const id in c.ties) { const t = c.ties[id]; if (t.k) t.a = Math.min(100, t.a + 5); }
}
export const seasonAlias = (S, s) => S.soc && S.soc.alias[s] || '';

// ---------- what the page shows ----------
export function socUI(sim) {
  const S = sim.S, Q = S.soc, V = Q.view ? Q.view.rules : {}, nm = i => S.cols[i] ? S.cols[i].name : '';
  const live = S.cols.filter(o => !o.dead), adults = live.filter(c => c.life >= 4);
  const rules = RULE_KEYS.map(k => {
    const v = V[k], cur = ruleNow(S, k), alt = v ? Object.entries(v.pref).sort((a, b) => b[1] - a[1]) : [];
    const top = alt.length ? alt[0] : null, why = top && v.why[top[0]] ? Object.entries(v.why[top[0]]).filter(([w]) => w).sort((a, b) => b[1] - a[1]).slice(0, 2).map(([w]) => w) : [];
    return { k, name: RULES[k].name, opts: RULES[k].opts, cur, live: ruleLive(S, k), need: RULES[k].need || '', n: v ? v.n : 0, for: v ? v.for : 0, alt: alt.map(([a, n]) => [optName(k, isNaN(+a) ? a : +a), n]), why, opp: v ? v.opp.length : 0 };
  });
  const C = Q.council, best = {};
  for (const k of SKILLS) { let b = null; for (const c of adults) if (!b || c.skills[k] > b.skills[k]) b = c; best[k] = b ? [Math.round(b.skills[k] * 10) / 10, b.name] : [0, '']; }
  const doyName = q => q.doy >= 0 ? seasonDay(q.doy) : q.k === 'harvest' ? 'the first harvest of each year' : q.k === 'names' ? 'at a naming' : q.k === 'age' ? 'each native’s sixteenth' : '';
  const L = lesson(sim);
  return {
    rules, adults: adults.length, councilAt: COUNCIL_AT,
    council: C && { since: C.since, chose: C.chose, members: C.members.map(i => ({ id: i, name: nm(i), native: !!S.cols[i].native, lead: S.crews.some(k => !k.gone && k.lead === i) })) },
    q: Q.q && { k: Q.q.k, v: Q.q.v, name: RULES[Q.q.k].name, opt: optName(Q.q.k, Q.q.v) },
    verdict: Q.verdict && { k: Q.verdict.k, v: Q.verdict.v, name: RULES[Q.verdict.k].name, opt: optName(Q.verdict.k, Q.verdict.v), yes: Q.verdict.yes, no: Q.verdict.no, d: Q.verdict.d, votes: Q.verdict.votes.map(q => ({ name: nm(q.id), yes: q.yes, why: q.why })) },
    school: { open: has(S, 'school'), on: Q.sch >= 0, pupils: pupilsOf(S).length, teachers: membersOf(S, 'teach').length, aim: L.aim, pace: L.pace, curr: Q.rules.school },
    library: { open: Q.lib >= 0, built: has(S, 'library'), rec: Object.fromEntries(SKILLS.map(k => [k, Math.round((Q.rec[k] || 0) * 10) / 10])), best, keepers: membersOf(S, 'keep').length, lost: Q.lost },
    watch: { post: has(S, 'watch'), crew: membersOf(S, 'watch').length, night: Q.night >= 0 && S.cols[Q.night] && S.cols[Q.night].nightEnd > S.tick ? nm(Q.night) : '', fear: Math.round(Q.fear), fights: S.stats.fights || 0, rule: Q.rules.watch },
    customs: Q.cust.map(q => ({ k: q.k, name: q.name, when: doyName(q), d: q.d, names: q.names || [] })), alias: Q.alias,
  };
}
// saves from before society
export function migrateSoc(sim) {
  const S = sim.S;
  if (!S.soc) S.soc = newSoc();
  const Q = S.soc;
  for (const k in newSoc()) if (Q[k] === undefined) Q[k] = newSoc()[k];
  for (const k in newSoc().rules) if (Q.rules[k] === undefined) Q.rules[k] = newSoc().rules[k];
  if (!Q.hv) Q.hv = S.stats.harvests || 0;
}

// Runs colonies with no page and no drawing, as fast as the machine allows, and measures them.
// The bot plays the opening the way a sensible player would: it lands on the most promising of the three
// sites, wakes the six founders the Seed suggests, keeps the Seed's crews, and lets the days run. Every morning it
// looks at the building list: it tests the local stone and timber, then plans a field, a workshop, a solar field,
// a feedstock plant, a root cellar, a commons, a second field, a clinic, dug quarters, a third field and a
// dormitory, two at a time, each on the nearest good plot; after that it keeps up with the colony as it grows, at the
// sizes the Seed suggests: solar when power runs short, then bunks, seats, fields, clinic beds and cool storage. It feeds the colony too: a forager once the shelter stands, a farmer once a field is made, a cook for every ten
// people once there is food that needs the kitchen (one more while people go hungry with food waiting for it), every sample tested as soon as it is ready, and the surveyors foraging once
// the stakes are out. Once the plant stands it puts someone on quarrying, and prints the Seed's pick whenever
// there is feedstock.
import { generateWorld, findSites, landAt } from '../core/world.js';
import { Pathfinder } from '../core/path.js';
import { Sim } from '../core/sim.js';
import { DAY_TICKS, HOUR, ACT } from '../core/consts.js';
import { findPlot, built, capacity, LANDER_KW, TYPES } from '../core/build.js';
import { laidUp } from '../core/body.js';
import { sizeFor, DEEP_SUN, stoneLeft } from '../core/work.js';
import { ruleOk } from '../core/lives.js';
import { mealsInStore, kitchenOnly } from '../core/food.js';
import { toIsolate } from '../core/illness.js';
import { doyOf, seasonOf, dayWeather } from '../core/year.js';
import { nbUI, valueOf, KINDS, GOODS } from '../core/nb.js';
import { storyAdvice, storyCard, storyRuleOn, STORY_RULES } from '../core/story.js';

const now = () => performance.now();
export const siteScore = s => s.open + (s.water != null ? 30 - Math.min(30, s.water / 4) : 0) + s.wood * .3 - s.marsh - s.stone * .5;

export function landColony(seed, mode = 'landfall', count = 300, season = +(globalThis.process?.env?.SEASON || 0)) {
  const t0 = now(), W = generateWorld(seed), sites = findSites(W), t1 = now();
  const site = sites.slice().sort((a, b) => siteScore(b) - siteScore(a))[0];
  landAt(W, site); W.siteId = site.id;
  const t2 = now(), P = new Pathfinder(W), t3 = now(), sim = new Sim(W, P), t4 = now();
  sim.newGame(mode, count, season);
  if (mode === 'landfall') sim.command({ op: 'print', ids: sim.command({ op: 'suggest' }) });
  return { W, P, sim, site, timing: { world: t1 - t0, land: t2 - t1, graph: t3 - t2, field: t4 - t3 } };
}

const PLAN = [['field', 8, 6], ['workshop', 6, 7], ['solar', 6, 6], ['plant', 5, 6], ['cellar', 5, 6], ['commons', 7, 8], ['field', 8, 7], ['clinic', 5, 6], ['burrow', 6, 8], ['field', 8, 6], ['dorm', 6, 8]];
export function botBuild(sim) {
  const S = sim.S;
  botFood(sim);
  botNb(sim);
  if (!S.projects[0].done) return;   // the shelter comes first
  botStory(sim);
  for (const m of ['stone', 'timber']) if (!S.mat[m].tested) sim.command({ op: 'test', mat: m });
  // new feedstock wakes the Seed's pick from the archive, unless a couple is waiting for a tank
  const sd = S.seedc;
  if (sd.feed > 0 && !sd.queue.length && !sd.printing && !(S.gen.asks.length && S.gen.womb.length < 2 && ruleOk(sim))) sim.command({ op: 'print', ids: sim.command({ op: 'suggest' }).slice(0, sd.feed) });
  // a catching illness going round: keep the sick apart, once there is a clinic; lift the rule when it has passed
  const ill = S.cols.filter(c => !c.dead && toIsolate(c)).length, clinic = S.projects.some(p => p.type === 'clinic' && p.done);
  if (clinic && ill >= 2 && !S.care.iso) sim.command({ op: 'iso', v: true }); else if (S.care.iso && !ill) sim.command({ op: 'iso', v: false });
  // short of power while someone is ill or hurt: the clinic goes up the list, ahead of everything else
  const patients = S.cols.some(c => !c.dead && ((c.cap && laidUp(c)) || c.bd.ill.some(q => q.st === 1 || q.st === 2)));
  if (patients) for (const p of S.projects.filter(q => !q.gone && q.done && q.type === 'clinic' && !q.powered && !q.shut)) {
    for (let k = 0; k < 12 && !p.powered; k++) { const i = S.projects.indexOf(p), up = S.projects.slice(0, i).filter(q => !q.gone); if (up.length <= 1 || ['clinic', 'shelter', 'solar'].includes(up[up.length - 1].type)) break; sim.command({ op: 'projMove', id: p.id, d: -1 }); }
  }
  // running low on metal with no mine left to work: a mine over the nearest seam goes in before anything else
  const Y = S.stores.yard, metal = Y.salvage + (Y.ore || 0) * 2 / 3, mines = S.projects.filter(p => !p.gone && p.type === 'mine' && p.seam > 20);
  if (metal < 40 && !mines.length && S.projects.some(p => p.type === 'workshop' && !p.gone)) {
    const z = sizeFor(sim, 'mine'); let spot = null;
    for (const lv of [1, 2, 3]) if (z && !spot) spot = findPlot(sim, 'mine', z.w, z.h, lv);   // the shallow seams first, then down the shaft
    if (spot) { sim.command({ op: 'place', type: 'mine', ...spot }); const q = S.projects[S.projects.length - 1]; for (let k = 0; k < 20; k++) { const i = S.projects.indexOf(q), up = S.projects.slice(0, i).filter(r => !r.gone && !r.done); if (!up.length) break; sim.command({ op: 'projMove', id: q.id, d: -1 }); } }
  }
  // the loose stone near camp running out: a stone pit, before the builders are left with nothing to cut
  if (!S.projects.some(p => !p.gone && p.type === 'pit' && !(p.done && !(p.rock > 0))) && stoneLeft(sim) < 120) {
    const z = sizeFor(sim, 'pit'), spot = z && findPlot(sim, 'pit', z.w, z.h);
    if (spot) sim.command({ op: 'place', type: 'pit', ...spot });
  }
  if (S.projects.filter(p => !p.gone && !p.done && p.type !== 'test').length >= 2) return;
  const n = {}; let next = PLAN.find(([t]) => { n[t] = (n[t] || 0) + 1; return S.projects.filter(p => !p.gone && p.type === t).length < n[t]; });
  // once the opening is built, the bot keeps up with a growing colony: power, bunks, seats, fields, clinic beds, cool storage
  let spot = next && findPlot(sim, next[0], next[1], next[2]);
  // a growing colony's wants in order; one with no room left on the map doesn't hold up the rest
  if (!next) for (const g of grow(sim)) { const [t, lv] = Array.isArray(g) ? g : [g], z = sizeFor(sim, t); spot = z && findPlot(sim, t, z.w, z.h, lv); if (spot) { next = [t, z.w, z.h]; break; } }
  if (spot) sim.command({ op: 'place', type: next[0], ...spot });
}
// the story: every find goes to the lab, whatever the Seed suggests for its sake is built, the cards on its buildings
// are answered the first way offered, and any new rule is set to its last option
function botStory(sim) {
  const S = sim.S, Y = S.story; if (!Y) return;
  for (const f of Y.finds) if (f.st === 0) sim.command({ op: 'story', do: 'analyse', i: f.i });
  for (const p of S.projects) if (!p.gone && p.done) { const a = storyCard(sim, p).find(q => !q.off); if (a) sim.command({ op: 'story', pid: p.id, id: a.id }); }
  for (const k in STORY_RULES) if (storyRuleOn(S, k)) { const o = STORY_RULES[k].opts, v = o[o.length - 1][0]; if (S.soc.rules[k] !== v) sim.command({ op: 'rule', k, v }); }
  for (const a of storyAdvice(sim)) {
    if (S.projects.some(p => !p.gone && !p.done && p.type === a.type)) continue;
    const z = sizeFor(sim, a.type) || (TYPES[a.type].size && { w: TYPES[a.type].size[0], h: TYPES[a.type].size[1] }), spot = z && findPlot(sim, a.type, z.w, z.h);
    if (spot) { sim.command({ op: 'place', type: a.type, ...spot }); break; }
  }
}
function grow(sim) {
  const out = [];
  const S = sim.S, mine = S.projects.filter(p => !p.gone && p.type !== 'test'), sum = (types, k) => mine.filter(p => types.includes(p.type)).reduce((a, p) => a + (capacity(p.type, p.w, p.h)[k] || 0), 0);
  const soon = S.cols.filter(c => !c.dead).length + (S.gen ? S.gen.womb.length : 0) + S.seedc.feed + S.seedc.queue.length + (S.seedc.printing ? 1 : 0);
  const draw = mine.filter(p => p.type !== 'solar').reduce((a, p) => a + (capacity(p.type, p.w, p.h).kw || 0), 0), supply = LANDER_KW + sum(['solar'], 'supply') * DEEP_SUN + sum(['geo'], 'supply');
  const shaft = mine.some(p => p.type === 'shaft' && p.done), none = t => !mine.some(p => p.type === t);
  // power: a heat tap in the deep once a shaft reaches it, as it runs through the winter; solar fields otherwise
  if (draw > supply - 1) out.push(...(shaft && mine.filter(p => p.type === 'geo').length < 3 ? [['geo', 3], 'solar'] : ['solar']));
  if (sum(['shelter', 'dorm', 'burrow'], 'beds') < soon + 2) out.push('dorm');
  if (sum(['commons'], 'seats') < soon) out.push('commons');
  if (mine.filter(p => p.type === 'field').length < Math.ceil(soon / 3.5)) out.push('field');
  if (sum(['clinic'], 'beds') < Math.ceil(soon / 6)) out.push('clinic');
  if (sum(['cellar'], 'store') < soon * 4) out.push('cellar');
  // the institutions, as the colony grows into them
  const kids = S.cols.filter(c => !c.dead && c.life >= 1 && c.life <= 2).length;
  if (none('school') && kids >= 3) out.push('school');
  if (none('watch') && (soon >= 30 || S.stats.fights)) out.push('watch');
  if (none('library') && soon >= 25) out.push('library');
  // down the shaft: a lift shaft once the colony is large, then a deep vault to shelter in on flare days
  if (none('shaft') && soon >= 30) out.push('shaft');
  if (shaft && sum(['vault'], 'places') < soon) out.push(['vault', 2]);
  // rare earths from a deep seam, then a scanner once there are enough for its magnets
  if (shaft && !mine.some(p => p.type === 'mine' && p.lvl === 3 && p.seam > 0)) out.push(['mine', 3]);
  if (none('scanner') && (S.stores.yard.rare || 0) >= 6) out.push('scanner');
  if (S.gen && S.gen.asks.length >= 3 && mine.filter(p => p.type === 'nursery').length < 2) out.push('nursery');
  return out;
}
// crews for food, and the tests: one person at a time moved out of the build crew, the best suited first
// visitors: anyone who asks to stay is welcome while there is food; traders get the colony's surplus for what they
// know, and for food when it is short
function botNb(sim) {
  const S = sim.S, P = S.nb && S.nb.party;
  // a raid: the guard goes out, everyone if the guard is outnumbered; the hurt left behind are treated if there are dressings
  if (P && P.kind === 'raid') {
    if ((P.st === 'come' || P.st === 'loot') && !P.bot) { P.bot = 1; if (!S.cols.some(c => !c.dead && c.grd)) sim.command({ op: 'guardAuto' }); const n = S.cols.filter(c => !c.dead && c.grd).length; sim.command({ op: 'raidMode', m: n >= P.n ? 'guard' : 'all' }); }
    if (P.st === 'held') sim.command({ op: 'captives', treat: (S.med.dress || 0) >= 4 });
    return;
  }
  if (!P || P.st !== 'stay') return;
  const live = S.cols.filter(c => !c.dead).length, days = mealsInStore(sim, true) / Math.max(1, live);
  if (P.ask >= 0) sim.command({ op: 'join', yes: days > 15 && live < 150 });
  if (P.kind !== 'trade' || P.traded) return;
  const U = nbUI(sim), K = KINDS[S.nb.list[P.nb].k], have = U.have, keep = { stone: 80, timber: 80, biomass: 40, ore: 40, rare: 12, salvage: 40, meals: live * 30, dress: 12, abx: 6, seal: 4, pipe: 6, power: 4, panel: 4 };
  const give = {}; for (const k in keep) { const n = (have[k] || 0) - keep[k]; if (n > 0 && (K.wants[k] ?? 1) >= .9) give[k] = n; }
  const get = {}, know = {}; for (const l of U.party.lessons) { get[l.id] = 1; know[l.id] = l.v; }
  if (days < 30 && P.goods.meals) get.meals = P.goods.meals;
  if ((S.stores.yard.rare || 0) < 6 && P.goods.rare) get.rare = P.goods.rare;
  // ask for less until they would take it, then give only as much as it needs
  for (let k = 0; k < 40 && Object.keys(get).length && !valueOf(K, S.nb.list[P.nb].trust, give, get, know).ok; k++) { const g = Object.keys(get).find(q => GOODS[q] && get[q] > 0); if (g) { get[g] = Math.floor(get[g] * .7); if (!get[g]) delete get[g]; } else { delete get[Object.keys(get).pop()]; delete know[Object.keys(know).pop()]; } }
  if (!Object.keys(get).length) return;
  for (const k of Object.keys(give)) for (let n = give[k]; n > 0; n = Math.floor(n * .8)) { const t = { ...give, [k]: Math.floor(n * .8) }; if (!t[k]) delete t[k]; if (!valueOf(K, S.nb.list[P.nb].trust, t, get, know).ok) break; give[k] = t[k] || 0; if (!give[k]) { delete give[k]; break; } }
  sim.command({ op: 'trade', give, get });
}
function botFood(sim) {
  const S = sim.S, F = S.F, live = S.crews.filter(c => !c.gone);
  for (let o = 0; o < F.life.length; o++) if (F.life[o].samples >= 3 && !F.life[o].tested && !F.life[o].queued) sim.command({ op: 'analyse', o });
  if (!S.projects[0].done || sim.policy === 'nofood') return;
  // 'plan' hands the crews to the Seed's own planner once the shelter is up
  if (sim.policy === 'plan') { if (!S.crewPlan && !sim.planAsked) { sim.planAsked = true; sim.command({ op: 'crewPlan' }); } return; }
  const crewOf = w => live.find(c => c.work === w), build = crewOf('build');
  // the Seed stops sorting new people into crews once the player has changed the crews: the bot puts them with the builders
  if (build && !S.autoCrews) for (const c of S.cols) if (!c.dead && c.crew < 0 && c.act !== ACT.WAKE && c.life >= 3 && !c.retired) sim.command({ op: 'move', person: c.id, crew: build.id });
  const want = (w, skill, n = 1) => {
    let cr = crewOf(w);
    if (cr && cr.members.length >= n) return;
    // from the build crew, or from the foragers if the builders are down to one
    const from = [build, crewOf('forage')].find(c => c && c !== cr && c.members.length >= 2);
    if (!from) return;
    if (!cr) { const id = sim.command({ op: 'crewNew', work: w }); cr = S.crews[id]; live.push(cr); }
    const who = from.members.map(i => S.cols[i]).filter(c => !c.dead).sort((a, b) => b.skills[skill] - a.skills[skill])[0];
    if (who) sim.command({ op: 'move', person: who.id, crew: cr.id });
  };
  want('forage', 'fieldcraft');
  if (sim.policy === 'lean') return;
  if (built(S).some(p => p.type === 'field')) want('farm', 'botany');
  if (built(S).some(p => p.type === 'plant')) want('quarry', 'building');
  if (built(S).some(p => p.type === 'mine' && p.powered && p.seam > 0) && (S.stores.yard.salvage < 30 || (S.stores.yard.rare || 0) < 10 && built(S).some(p => p.type === 'mine' && p.rare > 0))) want('mine', 'building');
  const tested = F.life.map((L, o) => L.tested && sim.kinds[o].food).filter(Boolean);
  // a cook for every ten or so people, more when food is waiting on the kitchen while people go hungry
  const eaters = S.cols.filter(c => !c.dead).length, behind = S.cols.some(c => !c.dead && c.hungry) && kitchenOnly(sim) > 4;
  if (tested.some(f => f.proc !== 'cook') || F.firstHarvest) want('kitchen', 'cooking', Math.max(1, Math.ceil(eaters / 10)) + (behind ? 1 : 0));
  const sv = crewOf('survey');
  if (sv && S.stakes.length >= 10 && sim.day > 12) sim.command({ op: 'crewSet', crew: sv.id, work: 'forage' });
}

// play `days` days and report what happened and what it cost
// policy 'careless' plays badly on purpose: long shifts and every safety rule off, to see what breaks;
// 'lean' feeds the colony with a single forager, 'nofood' never sets up food crews at all, and 'plan' lets the Seed plan them
export function runColony(seed, days = 1, mode = 'landfall', count = 300, onTick, policy = 'seed') {
  const run = landColony(seed, mode, count), { sim, P } = run, S = sim.S; sim.policy = policy;
  const careless = () => { for (const cr of S.crews) { sim.command({ op: 'crewSet', crew: cr.id, shift: 2 }); for (const k of ['dark', 'pairs', 'rest']) sim.command({ op: 'crewSet', crew: cr.id, rule: k, on: false }); } };
  let worst = 0, total = 0, peak = 0, foraged = 0;
  const nights = [], noons = [], daysOut = [];
  const end = S.tick + days * DAY_TICKS;
  while (S.tick < end) {
    const a = now(); sim.tick(); const d = now() - a; total += d; if (d > worst) worst = d;
    const t = S.tick % DAY_TICKS, live = S.cols.filter(c => !c.dead);
    if (t === Math.round(3 * HOUR)) nights.push(live.filter(c => c.act === ACT.BED || c.act === ACT.INSIDE || c.alone > 0 || (c.fid >= 0 && S.archive[c.fid].woke > S.tick - 2 * HOUR) || c.life === 0 || c.plan === 'ward' || c.plan === 'care').length + '/' + live.length);   // a medic may be up with a patient, someone who broke down may sit out the night, and someone just printed is still finding their bedroll
    if (t % HOUR === 0) { peak = Math.max(peak, ...live.map(c => c.chill)); }
    if (t === Math.round(12 * HOUR)) noons.push(live.filter(c => c.plan === 'work').length);
    if (t === Math.round(23 * HOUR)) {
      const avg = k => live.length ? Math.round(live.reduce((s, c) => s + c[k], 0) / live.length) : 0;
      const st = p => p.done ? (p.type === 'solar' || p.powered ? 'done' : 'dark') : `${p.stage + 1}/5${p.wait ? ' (' + p.wait + ')' : ''}`;
      daysOut.push({
        day: sim.day, people: live.length, kids: live.filter(c => c.life < 3).length, couples: live.filter(c => c.partner >= 0).length / 2, natives: live.filter(c => c.native).length, tanks: S.gen ? S.gen.womb.length : 0, fat: avg('fat'), str: avg('str'), tru: avg('tru'), known: +(S.knownN / 3600).toFixed(1), food: Math.round(S.food),
        builds: S.projects.filter(p => !p.gone && p.type !== 'test').map(p => `${p.name} ${st(p)}`).join(', '), yard: { ...S.stores.yard }, power: `${S.power.draw}/${S.power.supply} kW`,
        indoors: live.filter(c => c.home >= 0).length, tested: ['stone', 'timber'].filter(m => S.mat[m].tested).join('+') || 'none',
        season: seasonOf(doyOf(sim.cal)), wx: dayWeather(sim.W.seed, sim.cal).k, temp: S.F.temp.toFixed(0), meals: Math.round(mealsInStore(sim)), rations: Math.round(S.food),
        life: `${S.F.life.filter(l => l.seen).length} seen ${S.F.life.filter(l => l.tested).length} tested`, larder: JSON.stringify(Object.fromEntries(Object.entries({ ...S.F.larder.raw }).map(([k, v]) => [k, +v.toFixed(1)]))), cooked: Math.round(Object.values(S.F.larder.meals).reduce((a, b) => a + b, 0)),
        fields: built(S).filter(p => p.type === 'field').map(p => `${p.crop.st}${p.crop.k ? ':' + p.crop.k + ' ' + Math.round(p.crop.g * 100) + '%' : ''}`).join(' '), crews: S.crews.filter(c => !c.gone).map(c => c.work.slice(0, 2) + c.members.length).join(' '),
        chill: Math.round(peak), foraged: (S.stats.foraged || 0) - foraged, unwell: live.filter(c => c.unwell).length, sick: live.filter(c => c.bd.ill.some(q => q.st === 1 || q.st === 2)).length, dead: S.cols.length - live.length,
      });
      peak = 0; foraged = S.stats.foraged || 0;
    }
    if (policy === 'careless' && t === Math.round(5 * HOUR)) careless();
    if (mode === 'landfall' && t === Math.round(6 * HOUR)) botBuild(sim);
    else if (mode === 'landfall' && t % HOUR === 0 && S.nb && S.nb.party && S.nb.party.kind === 'raid') botNb(sim);   // a raid can't wait for the morning
    if (onTick) onTick(sim);
  }
  let worn = 0; for (const v of sim.wear) if (v > 60) worn++;
  const ticks = days * DAY_TICKS;
  return {
    seed, mode, days, site: run.site, timing: run.timing, nodes: P.nodes.length, reachable: run.W.reachable,
    tickMs: total / ticks, worstTickMs: worst, realtimeX: (1000 / 30) / (total / ticks),
    policy, paths: { ...P.stats }, nights, noons, daysOut, wornTiles: worn, stats: { ...S.stats }, stakes: S.stakes.length, people: S.cols.length,
    log: S.log, sim,
  };
}

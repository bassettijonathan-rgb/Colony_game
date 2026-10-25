// Runs colonies with no page and no drawing, as fast as the machine allows, and measures them.
// The bot plays the opening the way a sensible player would: it lands on the most promising of the three
// sites, wakes the six founders the Seed suggests, keeps the Seed's crews, and lets the days run. Every morning it
// looks at the building list: it tests the local stone and timber, then plans a field, a workshop, a solar field,
// a feedstock plant, a root cellar, a commons, a second field, a clinic, dug quarters, a third field and a
// dormitory, two at a time, each on the nearest good
// plot. It feeds the colony too: a forager once the shelter stands, a farmer once a field is made, a cook for every ten
// people once there is food that needs the kitchen (one more while people go hungry with food waiting for it), every sample tested as soon as it is ready, and the surveyors foraging once
// the stakes are out. Once the plant stands it puts someone on quarrying, and prints the Seed's pick whenever
// there is feedstock.
import { generateWorld, findSites, landAt } from '../core/world.js';
import { Pathfinder } from '../core/path.js';
import { Sim } from '../core/sim.js';
import { DAY_TICKS, HOUR, ACT } from '../core/consts.js';
import { findPlot, built } from '../core/build.js';
import { mealsInStore, kitchenOnly } from '../core/food.js';
import { toIsolate } from '../core/illness.js';
import { doyOf, seasonOf, dayWeather } from '../core/year.js';

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
  if (!S.projects[0].done) return;   // the shelter comes first
  for (const m of ['stone', 'timber']) if (!S.mat[m].tested) sim.command({ op: 'test', mat: m });
  // new feedstock wakes the Seed's pick from the archive
  const sd = S.seedc;
  if (sd.feed > 0 && !sd.queue.length && !sd.printing) sim.command({ op: 'print', ids: sim.command({ op: 'suggest' }).slice(0, sd.feed) });
  // a catching illness going round: keep the sick apart, once there is a clinic; lift the rule when it has passed
  const ill = S.cols.filter(c => !c.dead && toIsolate(c)).length, clinic = S.projects.some(p => p.type === 'clinic' && p.done);
  if (clinic && ill >= 2 && !S.care.iso) sim.command({ op: 'iso', v: true }); else if (S.care.iso && !ill) sim.command({ op: 'iso', v: false });
  // short of power while someone is ill or hurt: the clinic goes up the list, ahead of everything else
  const patients = S.cols.some(c => !c.dead && (c.cap || c.bd.ill.some(q => q.st === 1 || q.st === 2)));
  if (patients) for (const p of S.projects.filter(q => !q.gone && q.done && q.type === 'clinic' && !q.powered && !q.shut)) {
    for (let k = 0; k < 12 && !p.powered; k++) { const i = S.projects.indexOf(p), up = S.projects.slice(0, i).filter(q => !q.gone); if (up.length <= 1 || ['clinic', 'shelter', 'solar'].includes(up[up.length - 1].type)) break; sim.command({ op: 'projMove', id: p.id, d: -1 }); }
  }
  if (S.projects.filter(p => !p.gone && !p.done && p.type !== 'test').length >= 2) return;
  const n = {}, next = PLAN.find(([t]) => { n[t] = (n[t] || 0) + 1; return S.projects.filter(p => !p.gone && p.type === t).length < n[t]; });
  const spot = next && findPlot(sim, next[0], next[1], next[2]);
  if (spot) sim.command({ op: 'place', type: next[0], ...spot });
}
// crews for food, and the tests: one person at a time moved out of the build crew, the best suited first
function botFood(sim) {
  const S = sim.S, F = S.F, live = S.crews.filter(c => !c.gone);
  for (let o = 0; o < F.life.length; o++) if (F.life[o].samples >= 3 && !F.life[o].tested && !F.life[o].queued) sim.command({ op: 'analyse', o });
  if (!S.projects[0].done || sim.policy === 'nofood') return;
  // 'plan' hands the crews to the Seed's own planner once the shelter is up
  if (sim.policy === 'plan') { if (!S.crewPlan && !sim.planAsked) { sim.planAsked = true; sim.command({ op: 'crewPlan' }); } return; }
  const crewOf = w => live.find(c => c.work === w), build = crewOf('build');
  // the Seed stops sorting new people into crews once the player has changed the crews: the bot puts them with the builders
  if (build && !S.autoCrews) for (const c of S.cols) if (!c.dead && c.crew < 0 && c.act !== ACT.WAKE) sim.command({ op: 'move', person: c.id, crew: build.id });
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
    if (t === Math.round(3 * HOUR)) nights.push(live.filter(c => c.act === ACT.BED || c.act === ACT.INSIDE || c.alone > 0 || S.archive[c.fid].woke > S.tick - 2 * HOUR).length + '/' + live.length);   // someone who broke down may sit out the night, and someone just printed is still finding their bedroll
    if (t % HOUR === 0) { peak = Math.max(peak, ...live.map(c => c.chill)); }
    if (t === Math.round(12 * HOUR)) noons.push(live.filter(c => c.plan === 'work').length);
    if (t === Math.round(23 * HOUR)) {
      const avg = k => live.length ? Math.round(live.reduce((s, c) => s + c[k], 0) / live.length) : 0;
      const st = p => p.done ? (p.type === 'solar' || p.powered ? 'done' : 'dark') : `${p.stage + 1}/5${p.wait ? ' (' + p.wait + ')' : ''}`;
      daysOut.push({
        day: sim.day, people: live.length, fat: avg('fat'), str: avg('str'), tru: avg('tru'), known: +(S.knownN / 3600).toFixed(1), food: Math.round(S.food),
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

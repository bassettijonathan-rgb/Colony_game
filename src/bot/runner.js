// Runs colonies with no page and no drawing, as fast as the machine allows, and measures them.
// The bot plays the opening the way a sensible player would: it lands on the most promising of the three
// sites, wakes the six founders the Seed suggests, keeps the Seed's crews, and lets the days run. Every morning it
// looks at the building list: it tests the local stone and timber, then plans a workshop, a solar field, a commons,
// a clinic and a dormitory, two at a time, each on the nearest good plot. Once the workshop stands, the surveyors
// move to its benches.
import { generateWorld, findSites, landAt } from '../core/world.js';
import { Pathfinder } from '../core/path.js';
import { Sim } from '../core/sim.js';
import { DAY_TICKS, HOUR, ACT } from '../core/consts.js';
import { findPlot } from '../core/build.js';

const now = () => performance.now();
export const siteScore = s => s.open + (s.water != null ? 30 - Math.min(30, s.water / 4) : 0) + s.wood * .3 - s.marsh - s.stone * .5;

export function landColony(seed, mode = 'landfall', count = 300) {
  const t0 = now(), W = generateWorld(seed), sites = findSites(W), t1 = now();
  const site = sites.slice().sort((a, b) => siteScore(b) - siteScore(a))[0];
  landAt(W, site); W.siteId = site.id;
  const t2 = now(), P = new Pathfinder(W), t3 = now(), sim = new Sim(W, P), t4 = now();
  sim.newGame(mode, count);
  if (mode === 'landfall') sim.command({ op: 'print', ids: sim.command({ op: 'suggest' }) });
  return { W, P, sim, site, timing: { world: t1 - t0, land: t2 - t1, graph: t3 - t2, field: t4 - t3 } };
}

const PLAN = [['workshop', 6, 7], ['solar', 6, 6], ['commons', 7, 8], ['clinic', 5, 6], ['dorm', 6, 8]];
export function botBuild(sim) {
  const S = sim.S;
  if (!S.projects[0].done) return;   // the shelter comes first
  for (const m of ['stone', 'timber']) if (!S.mat[m].tested) sim.command({ op: 'test', mat: m });
  const ws = S.projects.find(p => !p.gone && p.done && p.type === 'workshop'), sv = S.crews.find(c => !c.gone && c.work === 'survey');
  if (ws && sv) sim.command({ op: 'crewSet', crew: sv.id, work: 'workshop' });
  if (S.projects.filter(p => !p.gone && !p.done && p.type !== 'test').length >= 2) return;
  const have = new Set(S.projects.filter(p => !p.gone).map(p => p.type)), next = PLAN.find(([t]) => !have.has(t));
  const spot = next && findPlot(sim, next[0], next[1], next[2]);
  if (spot) sim.command({ op: 'place', type: next[0], ...spot });
}

// play `days` days and report what happened and what it cost
// policy 'careless' plays badly on purpose: long shifts and every safety rule off, to see what breaks
export function runColony(seed, days = 1, mode = 'landfall', count = 300, onTick, policy = 'seed') {
  const run = landColony(seed, mode, count), { sim, P } = run, S = sim.S;
  const careless = () => { for (const cr of S.crews) { sim.command({ op: 'crewSet', crew: cr.id, shift: 2 }); for (const k of ['dark', 'pairs', 'rest']) sim.command({ op: 'crewSet', crew: cr.id, rule: k, on: false }); } };
  let worst = 0, total = 0;
  const nights = [], noons = [], daysOut = [];
  const end = S.tick + days * DAY_TICKS;
  while (S.tick < end) {
    const a = now(); sim.tick(); const d = now() - a; total += d; if (d > worst) worst = d;
    const t = S.tick % DAY_TICKS, live = S.cols.filter(c => !c.dead);
    if (t === Math.round(3 * HOUR)) nights.push(live.filter(c => c.act === ACT.BED || c.act === ACT.INSIDE || c.alone > 0 || S.archive[c.fid].woke > S.tick - 2 * HOUR).length + '/' + live.length);   // someone who broke down may sit out the night, and someone just printed is still finding their bedroll
    if (t === Math.round(12 * HOUR)) noons.push(live.filter(c => c.plan === 'work').length);
    if (t === Math.round(23 * HOUR)) {
      const avg = k => live.length ? Math.round(live.reduce((s, c) => s + c[k], 0) / live.length) : 0;
      const st = p => p.done ? (p.type === 'solar' || p.powered ? 'done' : 'dark') : `${p.stage + 1}/5${p.wait ? ' (' + p.wait + ')' : ''}`;
      daysOut.push({
        day: sim.day, people: live.length, fat: avg('fat'), str: avg('str'), tru: avg('tru'), known: +(S.knownN / 3600).toFixed(1), food: Math.round(S.food),
        builds: S.projects.filter(p => !p.gone && p.type !== 'test').map(p => `${p.name} ${st(p)}`).join(', '), yard: { ...S.stores.yard }, power: `${S.power.draw}/${S.power.supply} kW`,
        indoors: live.filter(c => c.home >= 0).length, tested: ['stone', 'timber'].filter(m => S.mat[m].tested).join('+') || 'none',
      });
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
    log: S.log,
  };
}

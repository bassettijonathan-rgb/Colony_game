// Runs colonies with no page and no drawing, as fast as the machine allows, and measures them.
// Milestone 1 has no decisions for a bot to make yet, so the "bot" lands a colony and lets its crews go
// about their days; later milestones plug real players in here, and the numbers grow with them.
import { generateWorld } from '../core/world.js';
import { Pathfinder } from '../core/path.js';
import { Sim, MODE } from '../core/sim.js';
import { DAY_TICKS } from '../core/consts.js';

const now = () => performance.now();

export function landColony(seed, count) {
  const t0 = now(), W = generateWorld(seed), t1 = now(), P = new Pathfinder(W), t2 = now(), sim = new Sim(W, P), t3 = now();
  sim.newGame(count);
  return { W, P, sim, timing: { world: t1 - t0, graph: t2 - t1, field: t3 - t2 } };
}

// play `days` days and report what happened and what it cost
export function runColony(seed, count, days = 1, onTick) {
  const run = landColony(seed, count), { sim, P } = run, S = sim.S;
  let worst = 0, total = 0, homeAt3 = [], workingAt12 = [];
  const end = S.tick + days * DAY_TICKS;
  while (S.tick < end) {
    const a = now(); sim.tick(); const d = now() - a; total += d; if (d > worst) worst = d;
    const h = sim.hour;
    if (Math.abs(h - 3) < 1e-9 || (S.tick % DAY_TICKS) === Math.round(DAY_TICKS * 3 / 24)) homeAt3.push(S.cols.filter(c => c.mode === MODE.REST).length);
    if ((S.tick % DAY_TICKS) === Math.round(DAY_TICKS * 12 / 24)) workingAt12.push(S.cols.filter(c => c.mode === MODE.WORK || c.mode === MODE.ROUTE).length);
    if (onTick) onTick(sim);
  }
  let worn = 0; for (const v of sim.wear) if (v > 60) worn++;
  const ticks = days * DAY_TICKS;
  return {
    seed, count, days, timing: run.timing, nodes: P.nodes.length, reachable: run.W.reachable,
    tickMs: total / ticks, worstTickMs: worst, realtimeX: (1000 / 30) / (total / ticks),
    trips: S.crews.reduce((t, c) => t + c.trips, 0), paths: { ...P.stats }, homeAt3, workingAt12, wornTiles: worn,
  };
}

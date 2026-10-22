// The simulation's side of the conversation with the page. It runs inside a Web Worker when the
// browser allows one, or on the page itself otherwise; either way it only talks through messages.
//   page -> sim: init {seed, count, save}, speed {v}, save {id}
//   sim -> page: ready {world, people, clock, timing}, snap {tick, pos, clock, perf}, wear {chunks}, saved {id, data}
import { generateWorld } from '../core/world.js';
import { Pathfinder } from '../core/path.js';
import { Sim } from '../core/sim.js';
import { TPS, SPEEDS } from '../core/consts.js';

const now = () => performance.now();

export function createSimCore(post) {
  let W = null, P = null, sim = null, speed = 1, last = 0, acc = 0, timer = null, lastWear = 0;
  const perf = { ticks: 0, tickMs: 0, tps: 0, window: now(), worst: 0 };

  function step() {
    const t = now(), dt = Math.min(250, t - last); last = t;
    acc += dt / 1000 * TPS * SPEEDS[speed];
    let n = Math.min(60, Math.floor(acc)); acc -= n; if (acc > 60) acc = 0;   // never fall into a spiral
    if (n > 0) {
      const t0 = now();
      for (let i = 0; i < n; i++) sim.tick();
      const ms = now() - t0; perf.ticks += n; perf.tickMs += ms; perf.worst = Math.max(perf.worst, ms / n);
      const pos = sim.snapshot(new Float32Array(sim.S.cols.length * 4));
      post({ t: 'snap', tick: sim.S.tick, pos, clock: sim.clock(), perf: perfOut() }, [pos.buffer]);
    }
    if (t - lastWear > 500 && sim.dirty.size) {
      lastWear = t; const chunks = [];
      for (const k of sim.dirty) chunks.push([k, sim.wearChunk(k)]);
      sim.dirty.clear();
      post({ t: 'wear', chunks }, chunks.map(c => c[1].buffer));
    }
    timer = setTimeout(step, 8);
  }
  function perfOut() {
    const t = now(), span = t - perf.window;
    if (span > 1000) { perf.tps = perf.ticks / span * 1000; perf.avg = perf.ticks ? perf.tickMs / perf.ticks : 0; perf.load = perf.tickMs / span; perf.ticks = 0; perf.tickMs = 0; perf.window = t; perf.lastWorst = perf.worst; perf.worst = 0; }
    return { tps: perf.tps, tickMs: perf.avg || 0, worst: perf.lastWorst || 0, load: perf.load || 0, paths: { ...P.stats } };
  }

  function handle(m) {
    if (m.t === 'init') {
      clearTimeout(timer);
      const t0 = now(); W = generateWorld(m.seed); const t1 = now(); P = new Pathfinder(W); const t2 = now(); sim = new Sim(W, P); const t3 = now();
      if (m.save) sim.load(m.save); else sim.newGame(m.count);
      const S = sim.S;
      post({
        t: 'ready', seed: W.seed, land: W.land, rock: W.rock,
        world: { type: W.type, elev: W.elev, moist: W.moist },
        people: S.cols.map(c => ({ name: c.name, crew: c.crew, look: c.look })), crews: S.crews.map(c => ({ name: c.name, lead: c.members[0], members: c.members })),
        pos: sim.snapshot(new Float32Array(S.cols.length * 4)), clock: sim.clock(), count: S.count,
        timing: { world: t1 - t0, graph: t2 - t1, field: t3 - t2, nodes: P.nodes.length }
      });
      // the trodden ground of a loaded colony goes out at once
      if (m.save) { const chunks = []; for (const k of sim.dirty) chunks.push([k, sim.wearChunk(k)]); sim.dirty.clear(); post({ t: 'wear', chunks }); }
      last = now(); acc = 0; timer = setTimeout(step, 8);
    } else if (m.t === 'speed') { speed = m.v; }
    else if (m.t === 'save') { post({ t: 'saved', id: m.id, data: sim ? sim.serialize() : null }); }
    else if (m.t === 'stop') { clearTimeout(timer); }
  }
  return { handle };
}

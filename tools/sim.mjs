// Headless runs of the real simulation: determinism, saving, and bot colonies with timings.
// node tools/sim.mjs [worlds] [days] [colonists]
import { registerSealed } from './sealed.mjs';
registerSealed();
const { landColony, runColony } = await import('../src/bot/runner.js');
const { Sim } = await import('../src/core/sim.js');
import { createHash } from 'node:crypto';

const worlds = +(process.argv[2] || 3), days = +(process.argv[3] || 1), count = +(process.argv[4] || 300);
const hashOf = sim => createHash('sha1').update(JSON.stringify(sim.serialize())).digest('hex').slice(0, 12);
const ms = v => v.toFixed(v < 10 ? 2 : 0);

// 1. the same seed plays out the same way
{
  const a = landColony(12345, count); for (let i = 0; i < 6000; i++) a.sim.tick();
  const b = landColony(12345, count); for (let i = 0; i < 6000; i++) b.sim.tick();
  const ha = hashOf(a.sim), hb = hashOf(b.sim);
  console.log(`determinism: ${ha === hb ? 'ok' : 'FAILED'} (${ha} vs ${hb})`); if (ha !== hb) process.exitCode = 1;
}
// 2. a saved colony continues exactly as the original does
{
  const a = landColony(999, count); for (let i = 0; i < 4000; i++) a.sim.tick();
  const snap = JSON.stringify(a.sim.serialize());
  const b = new Sim(a.W, a.P); b.load(JSON.parse(snap));
  const same = hashOf(a.sim) === hashOf(b);
  // the rng is shared, so reload just before b runs to give it the state a had at the save
  for (let i = 0; i < 9000; i++) a.sim.tick();
  const h1 = hashOf(a.sim);
  b.load(JSON.parse(snap));
  for (let i = 0; i < 9000; i++) b.tick();
  const h2 = hashOf(b);
  console.log(`save round trip: at once ${same ? 'ok' : 'FAILED'}, 9000 ticks later ${h1 === h2 ? 'ok' : 'FAILED'} (${h1} vs ${h2}) · save ${(snap.length / 1024).toFixed(0)} KB`);
  if (!same || h1 !== h2) process.exitCode = 1;
}
// 3. bot colonies on different worlds
for (let k = 0; k < worlds; k++) {
  const seed = 1000 + k * 7919, r = runColony(seed, count, days);
  console.log(`world ${seed}: generated in ${ms(r.timing.world)} ms, path graph ${ms(r.timing.graph)} ms (${r.nodes} nodes), home field ${ms(r.timing.field)} ms, ${(r.reachable / 3600).toFixed(0)}% walkable`);
  console.log(`  ${count} colonists, ${days} day(s): ${ms(r.tickMs)} ms per tick, worst ${ms(r.worstTickMs)} ms, ${r.realtimeX.toFixed(0)}x faster than normal speed`);
  console.log(`  ${r.trips} crew trips, ${r.paths.coarse + r.paths.local} path searches (${r.paths.coarse} long), ${ms(r.paths.ms)} ms of searching, ${r.paths.fail} failed`);
  console.log(`  out working at noon: ${r.workingAt12.join(', ')} · home by 3 am: ${r.homeAt3.join(', ')} of ${count} · trodden tiles: ${r.wornTiles}`);
  if (r.homeAt3.some(n => n < count)) { console.log('  NOT EVERYONE GOT HOME'); process.exitCode = 1; }
}

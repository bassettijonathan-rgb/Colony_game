// Headless runs of the real simulation: determinism, saving, and bot colonies with timings.
// node tools/sim.mjs [worlds] [days] [mode: landfall|stress] [colonists]
import { registerSealed } from './sealed.mjs';
registerSealed();
const { landColony, runColony, botBuild } = await import('../src/bot/runner.js');
const { DAY_TICKS, HOUR } = await import('../src/core/consts.js');
const { Sim } = await import('../src/core/sim.js');
import { createHash } from 'node:crypto';

const worlds = +(process.argv[2] || 3), days = +(process.argv[3] || 3), mode = process.argv[4] || 'landfall', count = +(process.argv[5] || 300);
const hashOf = sim => createHash('sha1').update(JSON.stringify(sim.serialize())).digest('hex').slice(0, 12);
const ms = v => v.toFixed(v < 10 ? 2 : 0);

// 1. the same seed plays out the same way
{
  const a = landColony(12345, mode, count); for (let i = 0; i < 30000; i++) a.sim.tick();
  const b = landColony(12345, mode, count); for (let i = 0; i < 30000; i++) b.sim.tick();
  const ha = hashOf(a.sim), hb = hashOf(b.sim);
  console.log(`determinism: ${ha === hb ? 'ok' : 'FAILED'} (${ha} vs ${hb})`); if (ha !== hb) process.exitCode = 1;
}
// 2. a saved colony continues exactly as the original does: saved mid-build, with plots fenced off and trees down
{
  const a = landColony(999, mode, count), play = (sim, n) => { for (let i = 0; i < n; i++) { sim.tick(); if (mode === 'landfall' && sim.S.tick % DAY_TICKS === Math.round(6 * HOUR)) botBuild(sim); } };
  play(a.sim, 7 * DAY_TICKS);
  const snap = JSON.stringify(a.sim.serialize());
  const b = new Sim(a.W, a.P); b.load(JSON.parse(snap));
  const same = hashOf(a.sim) === hashOf(b);
  // the rng is shared, so reload just before b runs to give it the state a had at the save
  play(a.sim, 40000);
  const h1 = hashOf(a.sim);
  b.load(JSON.parse(snap));
  play(b, 40000);
  const h2 = hashOf(b);
  const builds = b.S.projects.filter(p => !p.gone).map(p => p.name + (p.done ? '' : ' ' + (p.stage + 1) + '/5')).join(', ');
  console.log(`save round trip: at once ${same ? 'ok' : 'FAILED'}, 40000 ticks later ${h1 === h2 ? 'ok' : 'FAILED'} (${h1} vs ${h2}) · save ${(snap.length / 1024).toFixed(0)} KB · ${builds}`);
  if (!same || h1 !== h2) process.exitCode = 1;
}
// 3. bot colonies on different worlds; POLICY=careless plays with long shifts and no safety rules
for (let k = 0; k < worlds; k++) {
  const seed = 1000 + k * 7919, r = runColony(seed, days, mode, count, null, process.env.POLICY || 'seed');
  console.log(`world ${seed}: landed at "${r.site.tag}", generated in ${ms(r.timing.world)} ms, path graph ${ms(r.timing.graph)} ms (${r.nodes} nodes), ${(r.reachable / 3600).toFixed(0)}% walkable`);
  console.log(`  ${r.people} people, ${days} day(s): ${ms(r.tickMs)} ms per tick, worst ${ms(r.worstTickMs)} ms, ${r.realtimeX.toFixed(0)}x faster than normal speed; ${r.paths.coarse + r.paths.local} path searches, ${r.paths.fail} failed`);
  console.log(`  asleep at 3 am: ${r.nights.join(', ')} · working at noon: ${r.noons.join(', ')} · stakes ${r.stakes}`);
  for (const d of r.daysOut) console.log(`  day ${d.day} (${['thaw', 'light', 'storm', 'cold'][d.season]} ${d.wx} ${d.temp}°): ${d.people} people (${d.natives} born here, ${d.kids} children, ${d.couples} couples, ${d.tanks} growing), fatigue ${d.fat}, strain ${d.str}, trust ${d.tru}, chill ${d.chill}, foraged ${d.foraged}, unwell ${d.unwell}, sick ${d.sick}, dead ${d.dead}, surveyed ${d.known}%, food ${d.meals} meals (rations ${d.rations}, cooked ${d.cooked}, raw ${d.larder}), life ${d.life}, fields ${d.fields || 'none'}, crews ${d.crews}, power ${d.power}, yard ${Object.entries(d.yard).map(([k, v]) => k + ' ' + v).join(' ')}${process.env.SHORT ? '' : '\n    ' + d.builds}`);
  console.log(`  ${Object.entries(r.stats).map(([k, v]) => k + ' ' + v).join(', ')}`);
  if (process.env.LOG) for (const e of r.log) console.log(`    [${(e.t / 21600 + 1).toFixed(2)}] ${e.m}`);
  // with sensible play everyone is in bed by 3 am; a careless player can leave people walking home all night
  if (r.nights.some(n => { const [a, b] = n.split('/'); return +a < +b; })) { console.log('  NOT EVERYONE WAS IN BED'); if (r.policy === 'seed') process.exitCode = 1; }
}

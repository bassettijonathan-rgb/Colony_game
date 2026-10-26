// Flares. This sun is more restless than Earth's, and the planet's magnetic field is weak, so after a big flare the
// particles thrown off with it reach the ground in numbers. The Seed sees the flare itself at once, and the cloud
// that follows it arrives most of a day later: a particle storm that lasts several hours. Out in the open it adds
// as much dose in a day as years of ordinary sunlight; a timber roof halves it, the lander's hull cuts more, a room
// dug under the ground keeps out nearly all of it, and the middle and the deep keep out everything. The dose is not
// enough to make anyone sick that day: it adds to the lifetime total in the body (aging.js), which raises the risk
// of growths and of a weak heart years later, and a parent's dose is in their children's genes.
// The director plans flares like its other events; while one is overhead everyone gets under cover.
import { HOUR, hidden } from './consts.js';
import { rnd } from './rng.js';
import { byId } from './build.js';

// what each kind of roof keeps out
const SHIELD = { shelter: .8, vault: 1 };
export function shieldOf(S, c) {
  if (!hidden(c.act)) return 0;
  const p = c.where >= 0 ? byId(S, c.where) : null;
  if (!p) return c.job === 'nursery' ? SHIELD.shelter : .5;
  if (p.type === 'shaft' || (p.lvl || 1) > 1) return 1;
  return SHIELD[p.type] ?? (p.below ? .95 : .55);
}
export const flareOn = S => { const f = S.hz.flare; return !!f && S.tick >= f.on && S.tick < f.off; };
// soon enough before it arrives that people should be heading for cover
export const flareNear = S => { const f = S.hz.flare; return !!f && S.tick >= f.on - HOUR && S.tick < f.off; };
// the dose rate outdoors just now, in millisieverts an hour: it rises fast, peaks early and tails off
export function flareRate(S) {
  const f = S.hz.flare; if (!f || S.tick < f.on || S.tick >= f.off) return 0;
  const x = (S.tick - f.on) / (f.off - f.on);
  return f.r * Math.min(1, x * 6) * Math.pow(1 - x, 1.2);
}
// every hour: the dose each person takes, and the storm's arrival and end
export function flareHour(sim) {
  const S = sim.S, f = S.hz.flare; if (!f || f.over) return;
  if (!f.said && S.tick >= f.on) { f.said = 1; sim.log('The particle storm has arrived. Everyone is under cover until it passes; work outside has stopped.', 'bad', { e: 'flare', lvl: 1, title: 'The particle storm' }); }
  const r = flareRate(S);
  if (r > 0) for (const c of S.cols) if (!c.dead) {
    const d = r * (1 - shieldOf(S, c));
    if (d <= 0) continue;
    f.got[c.id] = (f.got[c.id] || 0) + d;
    if (c.bd.sl) c.bd.sl.rad += d / 1000;   // the lifetime total is kept in sieverts
  }
  if (S.tick >= f.off) {
    f.over = 1; S.stats.flares = (S.stats.flares || 0) + 1;
    const got = Object.entries(f.got).filter(([, v]) => v >= .5).sort((a, b) => b[1] - a[1]), top = got[0];
    const open = Math.round(f.r * (f.off - f.on) / HOUR * .38);
    sim.log(`The particle storm has passed. ${got.length ? `${top ? `${S.cols[top[0]].name} took the most, about ${Math.round(top[1])} mSv` : ''}${got.length > 1 ? `; ${got.length - 1} other${got.length > 2 ? 's' : ''} took more than a trace` : ''}. Anyone out in the open all through it would have taken about ${open} mSv.` : `Nobody took more than a trace: everyone was under good cover. Out in the open it would have been about ${open} mSv.`} Work goes on as usual.`, got.length ? '' : 'good', { e: 'flareend', lvl: 1, title: 'The storm has passed' });
    S.rv++;
  }
}
// the director's flare: seen now, overhead in most of a day
export function startFlare(sim) {
  const S = sim.S, f = S.hz.flare;
  if (f && !f.over) return false;
  const r = 2 + rnd() * rnd() * 10, on = S.tick + Math.round((16 + rnd() * 10) * HOUR), off = on + Math.round((7 + rnd() * 10) * HOUR);
  S.hz.flare = { r: +r.toFixed(2), on, off, got: {}, said: 0, over: 0 };
  const P = S.projects.filter(p => !p.gone && p.done && !p.shut), vault = P.some(p => p.type === 'vault'), below = P.some(p => p.below);
  const h = Math.round((on - S.tick) / HOUR), open = Math.round(r * (off - on) / HOUR * .38);
  sim.log(`The Seed saw a large flare on the sun this morning, and a cloud of particles thrown off with it, headed this way. It arrives in about ${h} hours and lasts ${Math.round((off - on) / HOUR)} or so. Out in the open it would add about ${open} mSv, as much as ${Math.max(1, Math.round(open / 12))} year${open < 18 ? '' : 's'} of ordinary sunlight here. ${vault ? 'Everyone will shelter in the deep vault.' : below ? 'Everyone will shelter in the rooms below ground, which keep out nearly all of it; whoever doesn’t fit goes indoors.' : 'Everyone will go indoors, which halves it; rooms dug below ground would keep out nearly all of it.'}`, 'bad', { e: 'flarewarn', lvl: 2, title: 'A flare' });
  return true;
}
// for the page: is one coming, or overhead
export function flareUI(S) {
  const f = S.hz.flare; if (!f || f.over) return null;
  return { on: S.tick >= f.on, in: Math.max(0, Math.round((f.on - S.tick) / HOUR)), left: Math.max(0, Math.round((f.off - S.tick) / HOUR)), rate: +flareRate(S).toFixed(1) };
}

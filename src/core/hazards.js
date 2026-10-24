// Fire and floods. Fire needs fuel and dry weather: lightning in a storm, or sparks blown from the campfire,
// catches in grass and woodland and spreads with the wind, faster the drier the ground; rain and snow put it out.
// It leaves scorched ground that grows back over a season, and it can catch buildings, which burn until they are
// put out or gutted. People nearby drop what they are doing to beat it out. Floods come from snowmelt in Thaw and
// from days of heavy rain: the water rises over the low ground by the river or lake, a little each hour, and
// falls slowly. Buildings under water are out of use and need repairs once it goes down; crops drown.
// The lander and its shelter, sealed modules on legs, neither burn nor flood.
import { MAP, T, HOUR, ACT, hidden } from './consts.js';
import { rnd, clamp, hash } from './rng.js';
import { dayWeather, fireOn, seasonOf, doyOf } from './year.js';
import { floodPlain, propsIn } from './world.js';
import { stageLoads, loadsOf, powerCheck, byId } from './build.js';
import { injure, laidUp, woundText } from './body.js';
import { assignHomes, dropCarry } from './work.js';
import { remember } from './life.js';
import { spend } from './director.js';
import { scar, relive } from './trauma.js';

export const FIRE_STEP = HOUR / 6;                          // the fire moves on every ten game minutes
// how readily each ground burns, and for how many steps; water, sand, rock and scorched ground don't
export const FUEL = { [T.MEADOW]: .5, [T.DIRT]: .06, [T.SCREE]: .03, [T.MARSH]: .15, [T.FOREST]: .8 };
const BURN_STEPS = { [T.MEADOW]: 9, [T.DIRT]: 4, [T.SCREE]: 3, [T.MARSH]: 6, [T.FOREST]: 14 };
const MAX_FIRE = 700, NEAR = 30, REGROW = 30;
const N8 = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];
export const newHz = () => ({ dry: .3, fire: {}, scorch: [], wa: 0, alarm: 0, fl: { lv: 0, to: 0, rain: 0, melt: 0, snow: 0, said: 0, peak: 0, ap: 0, hit: 0 } });
const fuelOf = (W, t) => FUEL[W.type[t]] || 0;
const dirName = (dx, dy) => ['east', 'south-east', 'south', 'south-west', 'west', 'north-west', 'north', 'north-east'][(Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) + 8) % 8];
const where = (sim, x, y) => { const L = sim.W.land, d = Math.hypot(x - L.x, y - L.y); return d < 14 ? 'in the camp' : `${Math.round(d * 2 / 10) * 10} metres ${dirName(x - L.x, y - L.y)} of the camp`; };
// a building's fuel: timber frames burn, the shelter's modules and bare soil hardly at all
function fuelB(p) {
  if (p.type === 'shelter' || p.type === 'test' || p.below) return 0;   // nothing to burn under the ground
  if (p.type === 'field') return p.crop && (p.crop.st === 'grow' || p.crop.st === 'ripe') ? .5 : .08;
  if (p.type === 'solar') return .2;
  return p.done ? .7 : p.stage >= 2 ? .5 : .1;
}
const inRect = (p, x, y, m = 0) => x >= p.x - m && x < p.x + p.w + m && y >= p.y - m && y < p.y + p.h + m;

// ---------- every hour: how dry it is, lightning, sparks, the water level ----------
// a storm's rain comes in the afternoon: the lightning before it falls on whatever dry ground there is
export const wetNow = (wx, h) => wx.k === 'storm' && h < 13 ? 0 : wx.rain + wx.snow;
export function hzHour(sim) {
  const S = sim.S, H = S.hz, F = S.F, wx = dayWeather(sim.W.seed, sim.cal), h = Math.round(sim.hour) % 24, wet = wetNow(wx, h);
  // the ground dries in warm sun and wind, and soaks up rain and snow; snow on the ground keeps it damp
  if (wet > .2) H.dry = Math.max(0, H.dry - .035 * wet);
  else if (F.snow > .15) H.dry = Math.max(0, H.dry - .01);
  else if (F.temp > 3 && h >= sim.dawn && h < sim.dusk) H.dry = Math.min(1, H.dry + .0035 * (1 + wx.wind) * (F.temp > 15 ? 1.6 : F.temp > 9 ? 1.2 : .8));
  // lightning: on storm days it strikes somewhere around the camp now and then
  // and on a hot, dry afternoon in Long light a dry thunderstorm can build with no rain at all
  const dryStorm = wx.k === 'clear' && seasonOf(doyOf(sim.cal)) === 1 && H.dry > .7 && h >= 13 && h < 19 && hash(sim.W.seed, sim.cal, 813) < .25;
  if ((wx.k === 'storm' && h >= 6 && h < 15 || dryStorm) && rnd() < (dryStorm ? .08 : .14)) {
    const L = sim.W.land, a = rnd() * 6.283, r = 10 + rnd() * 110, x = Math.floor(L.x + Math.cos(a) * r), y = Math.floor(L.y + Math.sin(a) * r), t = y * MAP + x;
    if (x > 1 && y > 1 && x < MAP - 2 && y < MAP - 2 && fuelOf(sim.W, t) && rnd() < (.3 + .6 * H.dry) * (S.dir ? S.dir.damp : 1)) ignite(sim, t, 'lightning');
  }
  // sparks from the campfire, blown downwind onto dry grass
  if (fireOn(h) > .3 && wx.wind > .3 && H.dry > .55 && rnd() < .012 * wx.wind * (H.dry - .5) * 2) {
    const f = sim.W.site.fire, d = 2 + rnd() * 3, t = Math.floor(f.y + Math.sin(H.wa) * d) * MAP + Math.floor(f.x + Math.cos(H.wa) * d);
    if (fuelOf(sim.W, t)) ignite(sim, t, 'campfire');
  }
  floodHour(sim, wx);
}
// each morning: the day's wind, how much rain and melt are on their way to the river, and burnt ground growing back
export function hzMorning(sim) {
  const S = sim.S, H = S.hz, F = S.F, G = H.fl, wx = dayWeather(sim.W.seed, sim.cal);
  H.wa = hash(sim.W.seed, sim.cal, 811) * 6.283;
  const melt = Math.max(0, G.snow - F.snow); G.snow = F.snow;
  G.rain = G.rain * .5 + wx.rain * (wx.k === 'storm' ? 1.4 : 1);
  G.melt = G.melt * .7 + melt;
  const amp = .7 + hash(sim.W.seed, 3, 907) * .8;
  const D = S.dir, dm = D ? .5 + .5 * D.damp : 1;   // the director can spare a colony a flood it can't take
  G.burst = (G.burst || 0) * .5;
  G.to = Math.max(0, (G.rain - 1.6) * 3 + Math.max(0, G.melt - .15) * 12) * amp * dm + G.burst;   // a wet week or a fast thaw; ordinary rain soaks in
  // the Seed's sensors upstream see the water coming
  if (G.to > G.lv + 1.5 && G.said !== sim.day) {
    const thr = floodPlain(sim.W), risk = S.projects.filter(p => !p.gone && p.type !== 'shelter' && p.type !== 'test' && wetShare(thr, p, G.to) >= .3);
    if (risk.length && sim.day - G.said > 4) { G.said = sim.day; sim.log(`The river is rising: ${G.melt > .03 ? 'the snow is melting upstream' : 'days of rain are running off the hills'}. The Seed expects the water over the low ground by tomorrow, and into ${risk.map(p => p.name).join(', ')}.`, 'bad', { e: 'floodwarn', lvl: 2, pid: risk[0].id, title: 'Flood warning' }); }
  }
  // scorched ground greens over again after a season: woodland comes back as meadow first
  if (H.scorch.length && H.scorch[0][2] <= sim.day - REGROW) {
    const keep = [];
    for (const s of H.scorch) { if (s[2] <= sim.day - REGROW) { const t = s[0]; if (sim.W.type[t] === T.SCORCH) { sim.W.type[t] = T.MEADOW; sim.tnew.push(t, T.MEADOW); } } else keep.push(s); }
    H.scorch = keep;
  }
}

// ---------- fire ----------
export function ignite(sim, t, why) {
  const S = sim.S, H = S.hz, W = sim.W;
  if (H.fire[t] || !fuelOf(W, t) || !W.cost[t] || Object.keys(H.fire).length >= MAX_FIRE) return false;   // not under a building
  H.fire[t] = BURN_STEPS[W.type[t]] || 6;
  if (why) {
    const x = t % MAP, y = t / MAP | 0, L = W.land, d = Math.hypot(x - L.x, y - L.y), near = d < 70 || S.projects.some(p => !p.gone && p.done && inRect(p, x, y, 40));
    S.stats.fires = (S.stats.fires || 0) + 1;
    if (why === 'lightning') sim.log(near ? `Lightning set the ground alight ${where(sim, x, y)}.${H.dry > .6 ? ' Everything is dry: it will spread fast.' : ''}` : `Lightning started a fire far out, ${where(sim, x, y)}. The Seed is watching the smoke.`, 'bad', { e: near ? 'wildfire' : 'farfire', lvl: near ? 2 : 1, x: x + .5, y: y + .5, title: near ? 'Fire' : 'Smoke on the horizon' });
    else if (why === 'campfire') sim.log('Sparks from the campfire blew into the dry grass and caught.', 'bad', { e: 'wildfire', lvl: 2, x: x + .5, y: y + .5, title: 'Fire in the camp' });
  }
  return true;
}
// a tile that has burned through: scorched ground, the trees on it gone, and any local life with them
function burnt(sim, t) {
  const S = sim.S, W = sim.W;
  if (W.type[t] === T.FOREST || W.type[t] === T.MEADOW || W.type[t] === T.MARSH) {
    const x = t % MAP, y = t / MAP | 0;
    if (S.gone[t] === undefined && propsIn(W, x, y, x + 1, y + 1).length) sim.setGone(t, 0);
    W.type[t] = T.SCORCH; sim.tnew.push(t, T.SCORCH); S.hz.scorch.push([t, 0, sim.day]);
    const i = sim.patchAt(t); if (i >= 0 && S.F.patch) S.F.patch[i] = { n: 0, back: sim.day + REGROW };
  }
}
export function fireStep(sim) {
  const S = sim.S, H = S.hz, W = sim.W, keys = Object.keys(H.fire), bs = S.projects.filter(p => !p.gone && p.fire);
  if (!keys.length && !bs.length) { if (H.alarm) endAlarm(sim); return; }
  const wx = dayWeather(W.seed, sim.cal), h = sim.hour, night = h < sim.dawn || h >= sim.dusk, ww = wetNow(wx, Math.floor(h));
  const wet = Math.min(1.5, ww - wx.snow * .4 + S.F.snow), sp = Math.max(.002, H.dry - .3) * .2 * Math.max(.05, 1 - .8 * wet) * (night ? .5 : 1);   // dew slows it at night
  const cw = Math.cos(H.wa), sw = Math.sin(H.wa), lit = new Set(keys.map(Number));
  for (const k of keys) {
    const t = +k, x = t % MAP, y = t / MAP | 0;
    if (rnd() < wet * .12) { delete H.fire[k]; continue; }
    for (const [dx, dy] of N8) {
      const n = t + dy * MAP + dx; if (H.fire[n] || !fuelOf(W, n)) continue;
      const along = (dx * cw + dy * sw) / Math.hypot(dx, dy), p = sp * fuelOf(W, n) * (1 + wx.wind * 1.6 * along) * (dx && dy ? .7 : 1);
      if (p > 0 && rnd() < p) ignite(sim, n);
    }
    const f = H.fire[k] - 1;
    if (f <= 0) { delete H.fire[k]; burnt(sim, t); } else H.fire[k] = f;
  }
  // buildings beside the flames catch; burning buildings spread it back out
  for (const p of S.projects) {
    if (p.gone || p.fire || !fuelB(p)) continue;
    let hot = false;
    for (let x = p.x - 1; x <= p.x + p.w && !hot; x++) for (let y = p.y - 1; y <= p.y + p.h; y++) if (lit.has(y * MAP + x)) { hot = true; break; }
    if (hot && rnd() < .2 * fuelB(p) * (1 - .6 * Math.min(1, wet))) catchFire(sim, p);
  }
  for (const p of bs) {
    p.burn = Math.min(1, (p.burn || 0) + .03 * fuelB(p) / .7 * (wet > .4 ? .5 : 1));
    if (rnd() < .25) { const [dx, dy] = N8[Math.floor(rnd() * 8)], x = dx > 0 ? p.x + p.w : dx < 0 ? p.x - 1 : p.x + Math.floor(rnd() * p.w), y = dy > 0 ? p.y + p.h : dy < 0 ? p.y - 1 : p.y + Math.floor(rnd() * p.h); ignite(sim, y * MAP + x); }
    if (rnd() < wet * .08) putOut(sim, p, 'the rain put it out');
    else if (p.burn >= 1) putOut(sim, p, '');
  }
  fireCrews(sim);
  // people caught in it
  for (const c of S.cols) {
    if (c.dead || hidden(c.act) || !H.fire[c.tile] || c.burnT > S.tick) continue;
    c.burnT = S.tick + HOUR;
    const ws = injure(sim, c, 'fire', .15 + rnd() * .45, 'in a fire');
    sim.log(`${c.name} was caught by the flames: ${ws.map(w => woundText(w).toLowerCase()).join(', and ')}.`, 'bad', { e: 'hurt', lvl: 1, who: c.id, title: 'Burned' });
    remember(sim, c, 'Got burned in a fire.');
  }
}
function catchFire(sim, p) {
  const S = sim.S; p.fire = true; p.burn = p.burn || 0; S.rv++; spend(sim, 2, 'bfire');
  sim.log(`${p.name} is on fire!`, 'bad', { e: 'bfire', lvl: 2, pid: p.id, title: `${p.name} is burning` });
  // everyone inside gets out, some of them hurt on the way
  for (const c of S.cols) if (!c.dead && c.where === p.id && hidden(c.act)) {
    const t = sim.doorOf(p); c.x = t % MAP + .5; c.y = (t / MAP | 0) + .5; c.tile = t; c.act = ACT.IDLE; c.where = -1; c.plan = ''; c.job = ''; c.mv = 0; if (c.ward === p.id) c.ward = -1;
    if (rnd() < .25) { const ws = injure(sim, c, 'fire', .1 + rnd() * .35, `getting out of ${p.name}`); sim.log(`${c.name} got out of ${p.name} with ${ws.map(w => woundText(w).toLowerCase()).join(' and ')}.`, 'bad', { who: c.id }); }
    remember(sim, c, `Got out of ${p.name} when it caught fire.`); scar(sim, c, 'fire', 14, `Got out of ${p.name} as it burned.`);
  }
  if (p.done) { p.shut = 'fire'; powerCheck(sim); assignHomes(sim); }
}
function putOut(sim, p, how) {
  const S = sim.S, b = p.burn; p.fire = false; S.rv++;
  if (b >= 1) sim.log(`${p.name} burned out. Only the footings are left.`, 'bad', { e: 'gutted', lvl: 2, pid: p.id, title: `${p.name} burned out` });
  else sim.log(`The fire in ${p.name} is out${how ? `: ${how}` : ''}. About ${Math.round(b * 100)}% of it burned.`, b > .3 ? 'bad' : '', { e: 'bfireout', lvl: 1, pid: p.id, title: 'The fire is out' });
  damage(sim, p, b, 'fire');
}
// ---------- damage and repairs ----------
// A building that burned or stood in water goes back to an earlier stage, and the build crews repair it like any
// other project; it is out of use until they finish. A field loses its crop, and its soil if the water stood long.
export function damage(sim, p, frac, why) {
  const S = sim.S;
  if (p.type === 'field' && p.crop && frac > .05) { if (p.crop.st === 'grow' || p.crop.st === 'ripe') sim.log(`The crop in ${p.name} is lost${why === 'flood' ? ': it drowned' : ' to the fire'}.`, 'bad', { pid: p.id }); p.crop.st = 'bare'; p.crop.g = 0; p.crop.k = ''; }
  if (frac < .15 || (p.type === 'field' && why === 'fire')) { if (p.shut === why) p.shut = ''; powerCheck(sim); return; }
  if (!p.done) { p.got = {}; p.shut = ''; return; }
  const st = frac >= .9 ? 2 : frac >= .5 ? 3 : 4;
  p.done = false; p.shut = ''; p.dmg = why; p.rep = Math.min(1, frac); p.stage = p.type === 'field' ? Math.min(st, 2) : st; p.got = {};
  p.need = loadsOf(S, p, p.stage);
  if (p.type === 'field') p.crop = null;
  S.rv++; powerCheck(sim); assignHomes(sim);
  sim.log(`${p.name} needs repairs before it can be used again. The build crews will see to it.`, 'bad', { pid: p.id });
}

// ---------- beating it out ----------
// Anyone close by and able comes when a fire threatens the camp, the fields or a building, woken if need be.
function fireCrews(sim) {
  const S = sim.S, H = S.hz, W = sim.W, L = W.land, keys = Object.keys(H.fire).map(Number);
  const homeish = S.projects.filter(p => !p.gone && p.type !== 'test');
  const near = t => { const x = t % MAP, y = t / MAP | 0; return Math.hypot(x - L.x, y - L.y) < NEAR || homeish.some(p => inRect(p, x, y, 12)); };
  const targets = keys.filter(near), bs = S.projects.filter(p => !p.gone && p.fire);
  if (!targets.length && !bs.length) { if (H.alarm) endAlarm(sim); return; }
  if (!H.alarm) { H.alarm = S.tick; spend(sim, 2, 'fire'); relive(sim, ['fire']); sim.log('Fire near the camp: everyone who can is going to beat it out.', 'bad', { e: 'alarm', lvl: 1, title: 'All hands to the fire' }); }
  const want = Math.min(12, 2 + Math.ceil((targets.length + bs.length * 6) / 4));
  const able = c => !c.dead && !c.down && !c.care && !c.ctl && c.carried < 0 && !(c.cap && laidUp(c)) && c.act !== ACT.WAKE && !(c.alone > 0) && !c.iso;
  const spots = [...bs.map(p => sim.doorOf(p)), ...targets];
  const dist = (c, t) => Math.hypot(c.x - (t % MAP), c.y - (t / MAP | 0));
  let on = S.cols.filter(c => c.fight >= 0 && able(c));
  for (const c of S.cols) if (c.fight >= 0 && !able(c)) c.fight = -1;
  if (on.length < want) {
    const free = S.cols.filter(c => able(c) && !(c.fight >= 0)).map(c => [c, Math.min(...spots.map(t => dist(c, t)))]).filter(([, d]) => d < 90).sort((a, b) => a[1] - b[1]);
    for (const [c] of free.slice(0, want - on.length)) { dropCarry(sim, c); c.fight = 0; c.plan = ''; on.push(c); if (c.act === ACT.BED || c.act === ACT.INSIDE) sim.log(`${c.name} was woken to fight the fire.`, '', { who: c.id }); }
  }
  // each goes to the nearest flames nobody else has taken, burning buildings first
  const taken = new Set();
  for (const c of on) {
    const cur = c.fight > 0 && (H.fire[c.fight] || bs.some(p => sim.doorOf(p) === c.fight)) ? c.fight : 0;
    if (cur) { taken.add(cur); continue; }
    let best = 0, bd = 1e9; for (const t of spots) { if (taken.has(t)) continue; const d = dist(c, t) - (bs.some(p => sim.doorOf(p) === t) ? 20 : 0); if (d < bd) { bd = d; best = t; } }
    if (!best) best = spots[0];
    c.fight = best; taken.add(best); if (c.plan === 'fire') c.plan = '';
  }
}
function endAlarm(sim) {
  const S = sim.S; S.hz.alarm = 0;
  let n = 0; for (const c of S.cols) if (c.fight >= 0) { c.fight = -1; if (c.plan === 'fire') { c.plan = ''; c.job = ''; } n++; }
  if (n) sim.log('The fire near the camp is out. Everyone is going back to what they were doing.', 'good', { e: 'fireout', lvl: 1, title: 'The fire is out' });
}
// where a firefighter stands: beside the flames, not in them
export function fightSpot(sim, t) {
  const W = sim.W, H = sim.S.hz;
  for (const [dx, dy] of N8) { const n = t + dy * MAP + dx; if (W.reach[n] && W.cost[n] && !H.fire[n]) return n; }
  return t;
}
// ten minutes of beating at the flames: each burning tile within reach may go out; a building takes longer
export function beat(sim, c) {
  const S = sim.S, H = S.hz, x = Math.floor(c.x), y = Math.floor(c.y), skill = (.6 + .4 * (c.cap ? c.cap.manip : 1)) * (1 - H.dry * .3) * (c.fat > 80 ? .8 : 1);
  for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) { const t = (y + dy) * MAP + x + dx; if (H.fire[t] && rnd() < .3 * skill) { const left = H.fire[t]; delete H.fire[t]; if (left < 4) burnt(sim, t); } }
  for (const p of S.projects) if (!p.gone && p.fire && inRect(p, x, y, 2) && rnd() < .12 * skill) putOut(sim, p, `${c.name} and the others beat it out`);
  c.fat = Math.min(100, c.fat + 1.5);
  if (rnd() < (c.traits.includes('reckless') ? .03 : .012)) { const ws = injure(sim, c, 'fire', .1 + rnd() * .3, 'fighting a fire'); sim.log(`${c.name} was burned fighting the fire: ${ws.map(w => woundText(w).toLowerCase()).join(', and ')}.`, 'bad', { who: c.id }); scar(sim, c, 'fire', 25, 'Was burned fighting a fire.'); }
}

// ---------- floods ----------
// a room below ground floods when the water reaches its stairs, and then all of it does
const wetShare = (thr, p, lv) => { if (p.below) return p.door && thr[p.door.y * MAP + p.door.x] <= lv ? 1 : 0; let n = 0; for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) if (thr[y * MAP + x] <= lv) n++; return n / (p.w * p.h); };
function floodHour(sim, wx) {
  const S = sim.S, G = S.hz.fl, W = sim.W;
  if (G.to <= 0 && G.lv <= .05) return;
  G.lv = Math.max(0, G.lv + (G.to - G.lv) * (G.to > G.lv ? .08 : .025));
  if (G.to > 0 && Math.round(sim.hour) % 24 === 18) G.to = Math.max(0, G.to - .4);   // the rise passes if no more rain comes
  if (G.lv < .5 && !S.projects.some(p => p.shut === 'flood')) return;
  const thr = floodPlain(W);
  if (G.lv >= .5 && G.peak < .5) S.stats.floods = (S.stats.floods || 0) + 1;
  G.peak = Math.max(G.peak, G.lv);
  // buildings and fields under water
  for (const p of S.projects) {
    if (p.gone || p.type === 'shelter' || p.type === 'test') continue;
    const wet = wetShare(thr, p, G.lv) >= .3;
    if (wet) {
      if (p.shut !== 'flood' && !p.wetH && !S.projects.some(q => q.wetH)) relive(sim, ['water']);
      if (p.shut !== 'flood' && !p.wetH) { sim.log(`Flood water is in ${p.name}.${p.done && p.type !== 'field' ? ' It is out of use until the water goes down.' : ''}`, 'bad', { e: 'flood', lvl: 2, pid: p.id, title: 'Flooding' }); if (p.fire) { p.fire = false; } }
      if (!p.wetH && p.done) spend(sim, 1, 'flood');
      p.wetH = (p.wetH || 0) + 1; if (p.done || p.type === 'field') { if (p.shut !== 'flood') { p.shut = 'flood'; S.rv++; powerCheck(sim); assignHomes(sim); } }
      for (const c of S.cols) if (!c.dead && c.where === p.id && hidden(c.act)) { const t = sim.doorOf(p); c.x = t % MAP + .5; c.y = (t / MAP | 0) + .5; c.tile = t; c.act = ACT.IDLE; c.where = -1; c.plan = ''; c.mv = 0; if (c.ward === p.id) c.ward = -1; }
    } else if (p.wetH) {
      const h = p.wetH; p.wetH = 0; if (p.shut === 'flood') p.shut = '';
      const frac = p.type === 'field' ? (h > 6 ? (h > 60 ? .5 : .2) : 0) : clamp(h / 48, .15, .8) * (p.type === 'solar' ? .5 : 1);
      sim.log(`The water has gone down from ${p.name}.`, '', { pid: p.id });
      damage(sim, p, frac, 'flood');
    }
  }
  // the yard: loose biomass washes away
  const Y = W.site.yard.pick;
  if (thr[Y.y * MAP + Y.x] <= G.lv && G.hit !== G.said) { G.hit = G.said; const lost = Math.floor(S.stores.yard.biomass / 2); if (lost) { S.stores.yard.biomass -= lost; sim.log(`The flood washed ${lost} loads of biomass out of the yard.`, 'bad', { x: Y.x + .5, y: Y.y + .5 }); } }
  // people wading: cold, and in deep water, swept off their feet
  for (const c of S.cols) {
    if (c.dead || hidden(c.act)) continue;
    const d = G.lv - thr[c.tile]; if (d < 0) continue;
    if (d > .5) c.chill = Math.min(100, c.chill + (S.F.temp < 8 ? 3 : 1));
    if (d > 5 && c.moving && rnd() < .03) { const ws = injure(sim, c, 'fall', .25 + rnd() * .45, 'swept off their feet by the flood'); sim.log(`${c.name} was swept off their feet by the flood: ${ws.map(w => woundText(w).toLowerCase()).join(', and ')}.`, 'bad', { e: 'hurt', lvl: 1, who: c.id, title: 'Swept away' }); scar(sim, c, 'water', 30, 'Was swept off their feet by the flood.'); }
  }
  if (G.lv < .5 && G.peak >= .5) { sim.log('The flood has gone down.', 'good', { e: 'floodgone', lvl: 1, title: 'The water is down' }); G.peak = 0; }
}
// is this tile under water now (for walking and the page)
export const flooded = (sim, t) => sim.S.hz.fl.lv > .3 && floodPlain(sim.W)[t] <= sim.S.hz.fl.lv;

// what the page needs: the flames, the water level and how dry it is
export function hzUI(S) {
  const H = S.hz;
  return { fire: Object.keys(H.fire).map(Number), lv: +H.fl.lv.toFixed(2), dry: +H.dry.toFixed(2), wa: +H.wa.toFixed(2), alarm: !!H.alarm, warn: H.fl.to > H.fl.lv + 1 };
}

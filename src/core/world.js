// The planet's surface, generated from a seed. Everything here is a pure function of the seed, so the
// simulation thread and the renderer can each hold the same world without sending it back and forth.
import { MAP, T, T_COST } from './consts.js';
import { fbm, vnoise, hash, clamp } from './rng.js';

const N = MAP * MAP;

// the value at fraction q of a sorted sample of the field, so thresholds mean "this share of the map"
function quantile(f, q) {
  const s = []; for (let i = 0; i < N; i += 37) s.push(f[i]);
  s.sort((a, b) => a - b); return s[Math.floor(clamp(q, 0, 1) * (s.length - 1))];
}

// Version 2 has one or two rivers and a few lakes; version 1 (colonies landed before it) had many of both, and
// a saved colony keeps the land it landed on.
export const WORLD_V = 2;
export function generateWorld(seed, wv = WORLD_V) {
  const s = seed | 0, v1 = wv < 2;
  const elev = new Float32Array(N), moist = new Float32Array(N), river = new Float32Array(N), basin = new Float32Array(N);
  for (let y = 0; y < MAP; y++) for (let x = 0; x < MAP; x++) {
    const i = y * MAP + x;
    const wx = x + (vnoise(x / 60, y / 60, s + 11) - .5) * 40, wy = y + (vnoise(x / 60, y / 60, s + 12) - .5) * 40;
    const base = fbm(wx / 170, wy / 170, s + 1, 5);
    const r = 1 - Math.abs(2 * fbm(wx / 95, wy / 95, s + 2, 4) - 1);       // ridges become ranges
    elev[i] = base * .62 + r * r * .5 * (.4 + base);
    moist[i] = fbm(x / 120, y / 120, s + 3, 4) * .8 + vnoise(x / 18, y / 18, s + 4) * .2;
    // one or two long rivers rather than a web of them: the contour of a broad, smooth field
    river[i] = v1 ? Math.abs(fbm(wx / 150, wy / 150, s + 5, 3) - .5) : Math.abs(fbm(wx / 330, wy / 330, s + 5, 2) - .5);
    // lakes sit in a few broad basins, not in every dip of the ground
    basin[i] = v1 ? elev[i] : fbm(wx / 210, wy / 210, s + 9, 2) * .7 + base * .3;
  }
  const eRock = quantile(elev, .9), eScree = quantile(elev, .875), bLake = quantile(basin, v1 ? .035 : .012), bShore = quantile(basin, v1 ? .055 : .02), bSand = quantile(basin, v1 ? .07 : .027), eLow = quantile(elev, .22);
  const mWet = quantile(moist, .7), mWood = quantile(moist, .55), mDry = quantile(moist, .12);
  const type = new Uint8Array(N);
  for (let y = 0; y < MAP; y++) for (let x = 0; x < MAP; x++) {
    const i = y * MAP + x, e = elev[i], m = moist[i];
    let t = T.MEADOW;
    if (m > mWood) t = T.FOREST;
    if (m < mDry) t = T.DIRT;
    if (m > mWet && e < eLow) t = T.MARSH;
    const rw = (v1 ? .006 : .0035) * (1 + vnoise(x / 40, y / 40, s + 6));              // river half-width, in noise units
    if (e < eScree - .02) {
      if (river[i] < rw * 1.9) t = T.SAND;
      if (river[i] < rw) t = vnoise(x / 30, y / 30, s + 7) > .62 && river[i] < rw * .5 ? T.DEEP : T.SHALLOW;
    }
    const b = basin[i];
    if (b < bSand) t = T.SAND;
    if (b < bShore) t = T.SHALLOW;
    if (b < bLake) t = T.DEEP;
    if (e > eScree) t = T.SCREE;
    if (e > eRock) t = T.ROCK;
    type[i] = t;
  }
  const cost = new Uint8Array(N);
  for (let i = 0; i < N; i++) cost[i] = T_COST[type[i]];
  // the fields the painter wants, as bytes
  const lo = quantile(elev, .01), hi = quantile(elev, .999);
  const e8 = new Uint8Array(N), m8 = new Uint8Array(N);
  for (let i = 0; i < N; i++) { e8[i] = clamp((elev[i] - lo) / (hi - lo), 0, 1) * 255; m8[i] = clamp(moist[i] * 255, 0, 255); }
  return { seed: s, wv, type, cost, reach: null, elev: e8, moist: m8, land: null, rock: clamp((eRock - lo) / (hi - lo), 0, 1), reachable: 0 };
}

// ---------- choosing where to land ----------
const OPEN = t => t === T.MEADOW || t === T.DIRT || t === T.SAND || t === T.SCORCH;
function badness(type, cx, cy, r) {
  let b = 0;
  for (let y = cy - r; y <= cy + r; y += 2) for (let x = cx - r; x <= cx + r; x += 2) { const t = type[y * MAP + x]; if (t === T.ROCK || t === T.DEEP || t === T.SHALLOW) b += 3; else if (t === T.MARSH || t === T.SCREE || t === T.FOREST) b += 1; }
  return b;
}
// Three candidate sites from the orbital survey: good places to put a lander down, far enough apart to be
// different, each with what the orbit can tell and what it can't.
export function findSites(W) {
  const type = W.type, cand = [];
  for (let cy = 90; cy <= 510; cy += 6) for (let cx = 90; cx <= 510; cx += 6) {
    const near = badness(type, cx, cy, 12); if (near > 40) continue;   // the lander needs clear ground to come down on
    cand.push({ x: cx, y: cy, score: near * 4 + badness(type, cx, cy, 26) * .5 + Math.hypot(cx - 300, cy - 300) * .08 });
  }
  cand.sort((a, b) => a.score - b.score);
  const pool = [];
  for (const c of cand) { if (pool.every(s => Math.hypot(s.x - c.x, s.y - c.y) > 60)) pool.push(c); if (pool.length >= 40) break; }
  for (const c of pool) Object.assign(c, siteFacts(W, c.x, c.y));
  // three different kinds of place if the planet has them, so the choice means something
  const sites = [];
  for (const gap of [150, 100, 60]) {
    while (sites.length < 3) {
      let best = null, bs = 1e9;
      for (const c of pool) { if (sites.includes(c) || sites.some(s => Math.hypot(s.x - c.x, s.y - c.y) < gap)) continue; const v = c.score + (sites.some(s => s.tag === c.tag) ? 400 : 0); if (v < bs) { bs = v; best = c; } }
      if (!best) break; sites.push(best);
    }
  }
  return sites.map((c, i) => ({ id: i, x: c.x, y: c.y, tag: c.tag, open: c.open, wood: c.wood, stone: c.stone, marsh: c.marsh, wet: c.wet, water: c.water }));
}
function siteFacts(W, cx, cy) {
  const type = W.type, n = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]; let tot = 0;
  for (let y = cy - 40; y <= cy + 40; y++) for (let x = cx - 40; x <= cx + 40; x++) { if (x < 0 || y < 0 || x >= MAP || y >= MAP || Math.hypot(x - cx, y - cy) > 40) continue; n[type[y * MAP + x]]++; tot++; }
  const pc = v => Math.round(v / tot * 100);
  let water = 999, deepOnly = true;
  for (let r = 1; r < 120 && water > 900; r++) for (let a = 0; a < 64; a++) { const x = Math.round(cx + Math.cos(a / 64 * 6.2832) * r), y = Math.round(cy + Math.sin(a / 64 * 6.2832) * r); if (x < 0 || y < 0 || x >= MAP || y >= MAP) continue; const t = type[y * MAP + x]; if (t === T.SHALLOW || t === T.DEEP) { water = r; deepOnly = t === T.DEEP; break; } }
  const open = pc(n[T.MEADOW] + n[T.DIRT] + n[T.SAND]), wood = pc(n[T.FOREST]), stone = pc(n[T.ROCK] + n[T.SCREE]), marsh = pc(n[T.MARSH]), wet = pc(n[T.SHALLOW] + n[T.DEEP]);
  const tag = water < 16 ? (deepOnly ? 'Lake shore' : 'River meadow') : wood > 38 ? 'Woodland clearing' : stone > 12 ? 'Under the ridge' : marsh > 14 ? 'Marsh edge' : 'Open plain';
  return { tag, open, wood, stone, marsh, wet, water: water > 900 ? null : water * 2 };
}

// ---------- landfall ----------
// The lander comes down on the site: it burns a ring of ground, clears a field around it, and the Seed's
// own footprint, the shelter's staked plot and the cook fire are laid out. Returns the area that changed.
export function landAt(W, site) {
  const s = W.seed, type = W.type, cost = W.cost, land = { x: site.x, y: site.y };
  for (let y = land.y - 16; y <= land.y + 16; y++) for (let x = land.x - 16; x <= land.x + 16; x++) {
    const d = Math.hypot(x + .5 - land.x, y + .5 - land.y) + (hash(x, y, s + 8) - .5) * 1.6, i = y * MAP + x;
    if (type[i] === T.ROCK || type[i] === T.DEEP) continue;
    if (d < 6.5) type[i] = T.SCORCH; else if (d < 12 && type[i] !== T.SHALLOW) type[i] = T.MEADOW;
    cost[i] = T_COST[type[i]];
  }
  for (let y = land.y - 2; y < land.y + 2; y++) for (let x = land.x - 2; x < land.x + 2; x++) cost[y * MAP + x] = 0;
  // the shelter's plot sits beside the lander, on the side with the best ground; the fire on the far side
  const dirs = [[1, 0], [0, 1], [-1, 0], [0, -1]];
  let shelter = null, best = 1e9;
  for (const [dx, dy] of dirs) {
    const w = dx ? 5 : 8, h = dx ? 8 : 5, cx = land.x + dx * 9, cy = land.y + dy * 9, x0 = Math.round(cx - w / 2), y0 = Math.round(cy - h / 2);
    let bad = 0;
    for (let y = y0 - 1; y <= y0 + h; y++) for (let x = x0 - 1; x <= x0 + w; x++) { const t = type[y * MAP + x]; bad += t === T.SHALLOW || t === T.DEEP || t === T.ROCK ? 50 : t === T.MARSH || t === T.SCREE ? 3 : 0; }
    if (bad < best) { best = bad; shelter = { x: x0, y: y0, w, h, dx, dy }; }
  }
  const sh = shelter;
  for (let y = sh.y; y < sh.y + sh.h; y++) for (let x = sh.x; x < sh.x + sh.w; x++) { const i = y * MAP + x; if (type[i] === T.SHALLOW || type[i] === T.ROCK) type[i] = T.DIRT; cost[i] = 0; }
  // the doorstep faces the lander; the cargo door is on the lander's side facing the shelter
  sh.door = { x: Math.floor(sh.dx ? (sh.dx > 0 ? sh.x - 1 : sh.x + sh.w) : sh.x + sh.w / 2), y: Math.floor(sh.dy ? (sh.dy > 0 ? sh.y - 1 : sh.y + sh.h) : sh.y + sh.h / 2) };
  const cargo = { x: land.x + sh.dx * 3 - (sh.dx < 0 ? 1 : 0), y: land.y + sh.dy * 3 - (sh.dy < 0 ? 1 : 0) };
  if (!sh.dx) cargo.x = land.x; if (!sh.dy) cargo.y = land.y;
  const fire = { x: land.x - sh.dx * 8 + .5, y: land.y - sh.dy * 8 + .5 };
  for (const p of [sh.door, cargo, { x: Math.floor(fire.x), y: Math.floor(fire.y) }]) { const i = p.y * MAP + p.x; if (!cost[i]) { type[i] = T.DIRT; cost[i] = T_COST[T.DIRT]; } }
  // the yard, where stone, timber and salvage are piled, on one of the two free sides; the load-test rig at its far end
  let yard = null; best = 1e9;
  for (const [px, py] of sh.dx ? [[0, 1], [0, -1]] : [[1, 0], [-1, 0]]) {
    const w = px ? 4 : 6, h = px ? 6 : 4, x0 = Math.round(land.x + px * 9 - w / 2), y0 = Math.round(land.y + py * 9 - h / 2);
    let bad = 0;
    for (let y = y0; y < y0 + h; y++) for (let x = x0; x < x0 + w; x++) { const t = type[y * MAP + x]; bad += t === T.SHALLOW || t === T.DEEP || t === T.ROCK ? 50 : t === T.MARSH ? 3 : 0; }
    if (bad < best) { best = bad; yard = { x: x0, y: y0, w, h, px, py }; }
  }
  for (let y = yard.y; y < yard.y + yard.h; y++) for (let x = yard.x; x < yard.x + yard.w; x++) { const i = y * MAP + x; if (!cost[i] || type[i] === T.SHALLOW || type[i] === T.MARSH) { type[i] = T.DIRT; cost[i] = T_COST[T.DIRT]; } }
  yard.pick = { x: yard.x + (yard.w >> 1), y: yard.y + (yard.h >> 1) };
  yard.rig = { x: yard.px ? yard.x + (yard.px > 0 ? yard.w - 1 : 0) : yard.x + yard.w - 1, y: yard.py ? yard.y + (yard.py > 0 ? yard.h - 1 : 0) : yard.y + yard.h - 1 };
  // what can be reached on foot from the landing
  const reach = new Uint8Array(N), q = new Int32Array(N); let h = 0, tl = 0;
  const s0 = sh.door.y * MAP + sh.door.x; reach[s0] = 1; q[tl++] = s0;
  while (h < tl) {
    const i = q[h++], x = i % MAP, y = (i / MAP) | 0;
    if (x > 0 && !reach[i - 1] && cost[i - 1]) { reach[i - 1] = 1; q[tl++] = i - 1; }
    if (x < MAP - 1 && !reach[i + 1] && cost[i + 1]) { reach[i + 1] = 1; q[tl++] = i + 1; }
    if (y > 0 && !reach[i - MAP] && cost[i - MAP]) { reach[i - MAP] = 1; q[tl++] = i - MAP; }
    if (y < MAP - 1 && !reach[i + MAP] && cost[i + MAP]) { reach[i + MAP] = 1; q[tl++] = i + MAP; }
  }
  W.land = land; W.reach = reach; W.reachable = tl; W.site = { shelter: sh, cargo, fire, yard };
  return [land.x - 18, land.y - 18, land.x + 18, land.y + 18];
}

// Trees, bushes and boulders inside a tile rectangle: placed by hashes, so any part of the map can be
// asked for at any time and always gets the same answer.
export const TREE_KINDS = ['oak', 'pine', 'birch', 'bloom'];
export function propsIn(W, x0, y0, x1, y1) {
  const out = [], s = W.seed, L = W.land;
  for (let y = Math.max(0, y0); y < Math.min(MAP, y1); y++) for (let x = Math.max(0, x0); x < Math.min(MAP, x1); x++) {
    const t = W.type[y * MAP + x], h = hash(x, y, s + 21);
    if (L && Math.hypot(x + .5 - L.x, y + .5 - L.y) < 13.5) continue;
    if (W.gone && W.gone.has(y * MAP + x)) continue;   // felled, quarried away, or cleared for a building
    const m = W.moist[y * MAP + x] / 255, e = W.elev[y * MAP + x] / 255;
    let p = 0;
    if (t === T.FOREST) p = .22 + m * .28; else if (t === T.MEADOW) p = .018 + vnoise(x / 9, y / 9, s + 22) * .03; else if (t === T.MARSH) p = .05;
    if (h < p) {
      const k = hash(x, y, s + 23);
      const kind = e > .62 || (t === T.FOREST && m > .72 && k < .55) ? (k < .75 ? 'pine' : 'birch') : t === T.MARSH ? (k < .6 ? 'bloom' : 'birch') : (k < .5 ? 'oak' : k < .78 ? 'birch' : k < .93 ? 'pine' : 'bloom');
      out.push({ k: 'tree', kind, v: (hash(x, y, s + 24) * 3) | 0, x: x + .2 + hash(x, y, s + 25) * .6, y: y + .2 + hash(x, y, s + 26) * .6, sc: .8 + hash(x, y, s + 27) * .4 });
      continue;
    }
    const b = hash(x, y, s + 28);
    if ((t === T.SCREE && b < .2) || ((t === T.MEADOW || t === T.SAND || t === T.DIRT) && b < .006)) out.push({ k: 'boulder', x: x + .25 + hash(x, y, s + 29) * .5, y: y + .25 + hash(x, y, s + 30) * .5, r: .2 + hash(x, y, s + 31) * .3, seed: (hash(x, y, s + 32) * 1e6) | 0 });
    else if ((t === T.MEADOW || t === T.FOREST) && b > .985) out.push({ k: 'bush', x: x + .25 + hash(x, y, s + 33) * .5, y: y + .25 + hash(x, y, s + 34) * .5, r: .26 + hash(x, y, s + 35) * .2, berry: hash(x, y, s + 36) < .3, seed: (hash(x, y, s + 37) * 1e6) | 0 });
  }
  return out;
}
// what stood on one tile before anything was felled or cleared there
export function propAt(W, x, y) { const g = W.gone; W.gone = null; const p = propsIn(W, x, y, x + 1, y + 1)[0] || null; W.gone = g; return p; }

// ---------- floods ----------
// How high the water has to rise, in the painter's height units, before each tile near the landing goes under:
// its height above the nearest river or lake, plus a little for every tile of distance from it. 255 is never.
// A pure function of the land, so both threads can work it out.
export const FLOOD_LINE = 5;   // how high the Seed reckons the water comes in a wet year, for planning
export const FLOOD_R = 150;
export function floodPlain(W) {
  if (W.flood) return W.flood;
  const L = W.land, thr = new Uint8Array(MAP * MAP).fill(255), src = new Float32Array(MAP * MAP), d = new Float32Array(MAP * MAP).fill(1e9);
  const x0 = Math.max(1, L.x - FLOOD_R), x1 = Math.min(MAP - 2, L.x + FLOOD_R), y0 = Math.max(1, L.y - FLOOD_R), y1 = Math.min(MAP - 2, L.y + FLOOD_R);
  let q = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) { const i = y * MAP + x, t = W.type[i]; if (t === T.SHALLOW || t === T.DEEP) { d[i] = 0; src[i] = W.elev[i]; q.push(i); } }
  // breadth first out from the water, up to 40 tiles; each tile remembers the water level it is measured from
  for (let r = 0; r < 40 && q.length; r++) {
    const nq = [];
    for (const i of q) for (const n of [i - 1, i + 1, i - MAP, i + MAP]) {
      const x = n % MAP, y = n / MAP | 0; if (x < x0 || x > x1 || y < y0 || y > y1 || d[n] <= r + 1) continue;
      const t = W.type[n]; if (t === T.SHALLOW || t === T.DEEP || t === T.ROCK) continue;
      d[n] = r + 1; src[n] = Math.min(src[i], W.elev[n]); nq.push(n);
      thr[n] = Math.min(254, Math.max(1, Math.round(W.elev[n] - src[n] + (r + 1) * .35)));
    }
    q = nq;
  }
  W.flood = thr;
  return thr;
}

// ---------- the ground below: three levels ----------
// What a dug room would cut through, tile by tile: soil, clay, stone or hard rock, ground too wet to dig by water,
// and seams of ore in the stone. Only the ground around the landing is worked out; further out it is solid.
// Level 1 is a couple of storeys down, reached by stairs. Level 2, the middle, is about thirty metres down in the
// bedrock: stone and hard rock, richer seams, and water where the rock is broken. Level 3, the deep, is more than a
// hundred metres down: hard rock, pockets of hot rock the colony can draw heat from, and thin veins of rare earths
// in the seams. The middle and the deep are reached by a lift shaft.
export const UG = { SOIL: 0, CLAY: 1, STONE: 2, HARD: 3, WET: 4, SOLID: 5, HOT: 6 }, ORE = 8, RARE = 16, LEVELS = 3;
export const U_NAME = ['soil', 'clay', 'stone', 'hard rock', 'wet ground', 'solid rock', 'hot rock'];
export const LEVEL_NAME = ['the surface', 'level 1, a few metres down', 'level 2, the middle, thirty metres down', 'level 3, the deep, over a hundred metres down'];
export function underOf(W, lvl = 1) {
  if (lvl > 1) return deepOf(W, lvl);
  if (W.under) return W.under;
  const L = W.land, s = W.seed, out = new Uint8Array(MAP * MAP).fill(UG.SOLID), thr = floodPlain(W);
  const x0 = Math.max(1, L.x - FLOOD_R), x1 = Math.min(MAP - 2, L.x + FLOOD_R), y0 = Math.max(1, L.y - FLOOD_R), y1 = Math.min(MAP - 2, L.y + FLOOD_R);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * MAP + x, t = W.type[i], e = W.elev[i] / 255, m = W.moist[i] / 255, n = vnoise(x / 14, y / 14, s + 41), up = W.rock - e;
    let u;
    if (t === T.SHALLOW || t === T.DEEP || t === T.MARSH || thr[i] <= 2) u = UG.WET;
    else if (t === T.ROCK || up < .03) u = UG.HARD;
    else if (up < .1 || n > .58) u = UG.STONE;
    else if (m > .55 && n < .4) u = UG.CLAY;
    else u = UG.SOIL;
    if ((u === UG.STONE || u === UG.HARD) && vnoise(x / 6, y / 6, s + 43) > .74 && hash(x, y, s + 44) < .85) u |= ORE;
    out[i] = u;
  }
  W.under = out;
  return out;
}
function deepOf(W, lvl) {
  W.deep = W.deep || [];
  if (W.deep[lvl]) return W.deep[lvl];
  const L = W.land, s = W.seed + lvl * 101, out = new Uint8Array(MAP * MAP).fill(UG.SOLID), R = FLOOD_R * (lvl === 2 ? .8 : .6);
  const x0 = Math.max(1, L.x - R | 0), x1 = Math.min(MAP - 2, L.x + R | 0), y0 = Math.max(1, L.y - R | 0), y1 = Math.min(MAP - 2, L.y + R | 0);
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
    const i = y * MAP + x, up = W.rock - W.elev[i] / 255, n = vnoise(x / 16, y / 16, s + 41);
    let u;
    if (lvl === 2) {
      if (vnoise(x / 22, y / 22, s + 47) > .7) u = UG.WET;                       // broken rock full of water
      else u = up < .08 || n > .62 ? UG.HARD : UG.STONE;
      if (vnoise(x / 7, y / 7, s + 43) > .66 && hash(x, y, s + 44) < .9) u |= ORE;
    } else {
      u = vnoise(x / 18, y / 18, s + 49) > .64 ? UG.HOT : UG.HARD;
      if (u === UG.HARD && vnoise(x / 6, y / 6, s + 43) > .72 && hash(x, y, s + 44) < .9) { u |= ORE; if (vnoise(x / 4, y / 4, s + 53) > .66) u |= RARE; }
    }
    out[i] = u;
  }
  W.deep[lvl] = out;
  return out;
}

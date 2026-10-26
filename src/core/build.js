// Building: what can be built, what each building costs stage by stage, whether a plan fits where it is drawn
// and carries its loads, and what finished buildings do once they have power. This file keeps the books; the
// people who cut, carry and fit are in work.js.
import { MAP, T } from './consts.js';
import { hash, clamp } from './rng.js';
import { propsIn, floodPlain, FLOOD_LINE, underOf, UG, ORE, U_NAME } from './world.js';

// ---------- materials ----------
export const MAT = {
  stone: ['load of stone', 'loads of stone'], timber: ['load of timber', 'loads of timber'], salvage: ['load of salvage', 'loads of salvage'], biomass: ['load of biomass', 'loads of biomass'],
  module: ['lander module', 'lander modules'], seal: ['airlock seal', 'airlock seals'], pipe: ['pipe run', 'pipe runs'], power: ['power unit', 'power units'], panel: ['solar panel', 'solar panels'],
  meds: ['batch of medical supplies', 'batches of medical supplies'], ore: ['load of ore', 'loads of ore'],
  dig: ['barrow of earth dug out', 'barrows of earth dug out'],
};
export const matName = (k, n) => MAT[k] ? `${n} ${MAT[k][n === 1 ? 0 : 1]}` : '';
export const RAW = ['stone', 'timber', 'biomass'], PRECISE = ['seal', 'pipe', 'power', 'panel'];
// precise modules are made from salvage at a workshop bench (or, three times slower, by the fabricator)
export const RECIPE = { seal: { salvage: 2, h: 3 }, pipe: { salvage: 1, h: 1.5 }, power: { salvage: 3, h: 4 }, panel: { salvage: 2, h: 2.5 } };
// hours to fit one load into a building, for an average builder; mark, test and dig are work without a load
export const FIT_H = { mark: .5, test: 1, dig: .6, module: 1.25, stone: .5, timber: .45, biomass: .35, seal: 1.2, pipe: .8, power: 1.2, panel: .5 };
export const LABOUR = new Set(['mark', 'test', 'dig']);
export const LANDER_KW = 8, PANEL_KW = .5, SALVAGE = 60, KIT = { seal: 2, pipe: 4, power: 3, panel: 0 }, FAB_SLOW = 3;
export const STAGE_NAMES = ['Marking out', 'Foundations', 'Frame', 'Systems', 'Fit-out'];
export const TEST_STAGES = ['Taking samples', 'Testing'];
export const FIELD_STAGES = ['Marking out', 'Breaking ground', 'Making soil', 'Drains', 'Raised beds'];
export const DIG_STAGES = ['Marking out', 'Digging', 'Shoring', 'Venting', 'Fit-out'];
export const PIT_STAGES = ['Marking out', 'Stripping the soil', 'Cutting benches', 'The hoist', 'Opening the face'];
export const stagesOf = type => type === 'test' ? TEST_STAGES : type === 'field' ? FIELD_STAGES : type === 'pit' ? PIT_STAGES : TYPES[type] && TYPES[type].below ? DIG_STAGES : STAGE_NAMES;
const SHELTER_STAGES = [['mark', 4], ['module', 8], ['module', 12], ['module', 12], ['module', 10]];
export const SHELTER_FITS = SHELTER_STAGES.reduce((t, s) => t + s[1], 0), CARGO = SHELTER_STAGES.reduce((t, s) => t + (s[0] === 'module' ? s[1] : 0), 0);

// ---------- what can be built ----------
export const TYPES = {
  shelter: { name: 'Shelter', fixed: true },
  dorm: { name: 'Dormitory', min: 5, max: 12, size: [6, 8], use: 'Bunks for people who sleep outside' },
  commons: { name: 'Commons', min: 6, max: 14, size: [7, 9], use: 'Evening meals indoors, which ease strain more than the fire does' },
  workshop: { name: 'Workshop', min: 5, max: 10, size: [6, 7], use: 'Makes airlock seals, pipe runs, power units and solar panels from salvage' },
  clinic: { name: 'Clinic', min: 5, max: 8, size: [5, 6], use: 'Beds for the hurt: they heal faster here, medics find and treat more, and operations go far better. Needs power' },
  solar: { name: 'Solar field', min: 3, max: 10, size: [6, 6], open: true, use: "Power, stored in the lander's batteries for the night. Panels make less in the short days of Deep cold" },
  field: { name: 'Field', min: 3, max: 12, size: [8, 6], open: true, use: 'Made soil for the crops in the seed bank: local soil broken up, mixed with biomass and drained' },
  lab: { name: 'Lab', min: 5, max: 8, size: [5, 6], use: 'Benches where a lab crew tests samples of local life, far faster than the Seed’s own analyser' },
  plant: { name: 'Feedstock plant', min: 5, max: 9, size: [5, 6], use: 'Tanks that turn biomass and crushed stone into feedstock, which the fabricator prints new people from. They take their loads from the yard and need power' },
  cellar: { name: 'Root cellar', min: 4, max: 10, size: [5, 6], below: true, use: 'A cool room dug under the ground, where the larder keeps far longer. Needs no power' },
  mine: { name: 'Mine', min: 4, max: 10, size: [5, 6], below: true, use: 'Galleries dug along a seam of metal ore. A mining crew brings the ore up, and the workshop smelts it into metal for parts. It is dug and shored with stone and timber alone, and needs a little power for its lamps, which it takes before any other building' },
  pit: { name: 'Stone pit', min: 4, max: 10, size: [6, 6], open: true, ground: true, use: 'An open pit cut down into stony ground. Once the boulders and outcrops near camp are used up, the quarry crew cuts stone here, for years' },
  burrow: { name: 'Dug quarters', min: 5, max: 12, size: [6, 8], below: true, use: 'Bunks dug into the ground: the earth keeps them warm in Deep cold, and fire and storms can’t reach them. A little power for light' },
  school: { name: 'School', min: 5, max: 10, size: [6, 7], use: 'Desks where the children aged six to twelve learn from a school crew, instead of only from their parents. What they learn most of is a rule you set. Needs no power' },
  library: { name: 'Library', min: 4, max: 9, size: [5, 6], use: 'Shelves and the Seed’s terminals, where a library crew writes down what the best people know, so it outlives them and apprentices can learn it. Needs no power' },
  watch: { name: 'Watch house', min: 3, max: 5, size: [4, 4], use: 'A post at the edge of camp with a lamp: one of the watch crew stays up here each night, by turns, to raise the alarm and to step in when someone lashes out. Needs no power' },
  nursery: { name: 'Growth tanks', min: 4, max: 9, size: [5, 6], use: 'More tanks like the Seed’s own two, where it grows children for the couples who ask, each from a body’s worth of feedstock. Needs power' },
  test: { name: 'Load test', fixed: true },
};
export const PLANNABLE = ['field', 'workshop', 'plant', 'commons', 'clinic', 'dorm', 'solar', 'lab', 'cellar', 'burrow', 'mine', 'pit', 'school', 'library', 'watch', 'nursery'];
const inner = (w, h) => Math.max(0, (w - 2) * (h - 2));
// what a building of this size holds, and the power it draws (kW) or makes
export function capacity(type, w, h) {
  const a = inner(w, h);
  switch (type) {
    case 'shelter': return { beds: 12, kw: 1 };
    case 'dorm': { const beds = Math.floor(a / 3); return { beds, kw: +(.4 + beds * .1).toFixed(1) }; }
    case 'commons': { const seats = Math.floor(a / 2); return { seats, kw: +(1 + seats * .05).toFixed(1) }; }
    case 'workshop': { const benches = clamp(Math.floor(a / 6), 1, 4); return { benches, kw: 1 + benches }; }
    case 'clinic': { const beds = Math.floor(a / 3); return { beds, kw: +(1.5 + beds * .1).toFixed(1) }; }
    case 'solar': { const panels = Math.floor(w * h / 4); return { panels, kw: 0, supply: panels * PANEL_KW }; }
    case 'field': return { tiles: w * h, kw: 0 };
    case 'lab': { const benches = clamp(Math.floor(a / 6), 1, 3); return { benches, kw: +(1.5 + benches * .5).toFixed(1) }; }
    case 'plant': { const tanks = clamp(Math.floor(a / 6), 1, 3); return { tanks, kw: 1 + tanks * 1.5 }; }
    case 'cellar': return { store: a * 4, kw: 0 };
    case 'burrow': { const beds = Math.floor(a / 3); return { beds, kw: +(.2 + beds * .03).toFixed(1) }; }
    case 'mine': return { faces: clamp(Math.floor(a / 6), 1, 4), kw: .5 };
    case 'pit': return { faces: clamp(Math.floor(w * h / 9), 1, 4), kw: 0 };
    case 'school': return { desks: Math.floor(a / 1.5), kw: 0 };
    case 'library': return { shelves: clamp(Math.floor(a / 3), 1, 8), kw: 0 };
    case 'watch': return { posts: 1, kw: 0 };
    case 'nursery': { const tanks = clamp(Math.floor(a / 6), 1, 3); return { tanks, kw: 1 + tanks }; }
  }
  return { kw: 0 };
}

// ---------- load checks ----------
// how strong this planet's stone and timber really are, against the databank's standard; only a load test tells
export const strength = (seed, m) => +(m === 'stone' ? .75 + hash(seed, 1, 991) * .6 : .8 + hash(seed, 2, 991) * .5).toFixed(2);
// untested material is designed with a safety margin, paid for in extra loads
export const margin = (S, m) => S.mat[m].tested ? clamp(Math.round(100 / S.mat[m].f) / 100, .75, 1.3) : 1.4;
// the widest a roof can span on timber beams before it needs a row of posts
export const spanLimit = S => S.mat.timber.tested ? Math.floor(3 + 3 * S.mat.timber.f) : 4;
export function loadCheck(S, type, w, h) {
  const span = Math.min(w, h) - 2, limit = spanLimit(S), open = TYPES[type].open;
  return { span, limit, posts: !open && span > limit ? Math.ceil(Math.max(w, h) / 4) : 0, ms: margin(S, 'stone'), mt: margin(S, 'timber'), stone: S.mat.stone.tested, timber: S.mat.timber.tested };
}

// ---------- the bill: what each stage needs, in loads ----------
// what a stage takes: a repair reuses what survived, so it takes only part of the loads, more the worse the damage
export function loadsOf(S, p, st) {
  const L = stageLoads(S, p.type, p.w, p.h, st, p.mat, p.ug);
  if (!p.dmg || p.rep == null) return L;
  const r = .25 + .75 * p.rep, out = {};
  for (const k in L) out[k] = k === 'mark' ? L[k] : Math.max(1, Math.ceil(L[k] * r));
  return out;
}
export function stageLoads(S, type, w, h, st, mat, ground) {
  if (type === 'shelter') { const [k, n] = SHELTER_STAGES[st]; return { [k]: n }; }
  if (type === 'test') return st === 0 ? { [mat]: 3 } : { test: 3 };
  const a = w * h, per = 2 * (w + h) - 4, ms = margin(S, 'stone'), mt = margin(S, 'timber'), cap = capacity(type, w, h), L = {};
  const add = (k, n) => { n = Math.ceil(n - 1e-9); if (n > 0) L[k] = (L[k] || 0) + n; };
  if (type === 'field') {   // break the ground, dig in biomass for soil, lay drains, then edge the beds
    if (st === 0) add('mark', per / 8);
    if (st === 1) add('dig', a / 8);
    if (st === 2) add('biomass', a / 5);
    if (st === 3) add('stone', a / 14);
    if (st === 4) { add('dig', a / 16); add('timber', per / 8); }
    return L;
  }
  if (TYPES[type].below) {   // dig it out, shore the walls and roof, run air down, then fit it
    const g = ground || { dig: 1, shore: 1 }, fixtures = (cap.beds || 0) / 4 + (cap.store || 0) / 24;
    if (st === 0) add('mark', per / 8);
    if (st === 1) add('dig', a / 1.5 * g.dig);
    if (st === 2) { add('timber', (per / 5 + a / 12) * mt * g.shore); add('stone', a / 14 * ms * g.shore); }
    // a mine has to be dug without metal, since metal is what it is for: its air shafts are lined with timber and
    // its lamps run on a cable from the camp
    if (st === 3) { if (type === 'mine') add('timber', 2 + a / 10); else { add('pipe', 1 + a / 30); if (cap.kw) add('power', 1); } }
    if (st === 4) { add('stone', a / 12); add('timber', fixtures); }
    return L;
  }
  if (type === 'pit') {   // strip the soil, cut ramps and benches down into the stone, and a timber hoist at the edge
    if (st === 0) add('mark', per / 8);
    if (st === 1) add('dig', a / 3);
    if (st === 2) add('dig', a / 4);
    if (st === 3) add('timber', 2 + a / 12);
    if (st === 4) add('dig', a / 6);
    return L;
  }
  if (TYPES[type].open) {   // footings, racks, cable runs, then the panels
    if (st === 0) add('mark', per / 8);
    if (st === 1) add('stone', a / 12 * ms);
    if (st === 2) add('timber', a / 10 * mt);
    if (st === 3) { add('pipe', a / 18); add('power', 1); }
    if (st === 4) add('panel', cap.panels);
    return L;
  }
  const posts = loadCheck(S, type, w, h).posts, fixtures = (cap.beds || 0) / 4 + (cap.seats || 0) / 8 + (cap.benches || 0) + (cap.tanks || 0) + (cap.desks || 0) / 8 + (cap.shelves || 0) / 2;
  if (st === 0) add('mark', per / 6);
  if (st === 1) { add('stone', a / 10 * ms); add('stone', posts); }
  if (st === 2) { add('timber', (per / 6 + a / 16) * mt); add('timber', posts); }
  if (st === 3) { add('seal', 1); add('pipe', a / 24); add('power', cap.kw / 2); }
  if (st === 4) { add('stone', per / 4 * ms); add('timber', a / 16 * mt + fixtures); }
  return L;
}
export function billOf(S, type, w, h, ground) {
  const stages = [], total = {};
  for (let st = 0; st < 5; st++) { const L = stageLoads(S, type, w, h, st, undefined, ground); stages.push(L); for (const k in L) if (k !== 'mark') total[k] = (total[k] || 0) + L[k]; }
  return { stages, total };
}

// ---------- where a building can go ----------
export const doorOf = (x, y, w, h, side) => side === 0 ? { x: x + (w >> 1), y: y - 1 } : side === 1 ? { x: x + w, y: y + (h >> 1) } : side === 2 ? { x: x + (w >> 1), y: y + h } : { x: x - 1, y: y + (h >> 1) };
export function facing(W, x, y, w, h) { const dx = W.land.x - (x + w / 2), dy = W.land.y - (y + h / 2); return Math.abs(dx) > Math.abs(dy) ? (dx > 0 ? 1 : 3) : (dy > 0 ? 2 : 0); }
const inRect = (x, y, r, m) => x >= r.x - m && x < r.x + r.w + m && y >= r.y - m && y < r.y + r.h + m;
// what a tile is too close to, if anything: the camp keeps its own ground
export function reservedAt(sim, x, y, m = 1, skip = -1, below = false) {
  const W = sim.W, L = W.land, s = W.site;
  if (below) { for (const p of sim.S.projects) if (!p.gone && p.below && p.id !== skip && inRect(x, y, p, m)) return p.name; return ''; }
  for (const p of sim.S.projects) if (!p.gone && p.below && p.id !== skip && p.door && Math.abs(x - p.door.x) <= m && Math.abs(y - p.door.y) <= m) return `the way down to ${p.name}`;
  if (Math.hypot(x + .5 - L.x, y + .5 - L.y) < 6 + m) return 'the Seed';
  if (Math.hypot(x + .5 - s.fire.x, y + .5 - s.fire.y) < 3 + m) return 'the cook fire';
  if (Math.hypot(x + .5 - s.cargo.x - .5, y + .5 - s.cargo.y - .5) < 1.5 + m) return "the Seed's cargo door";
  if (inRect(x, y, s.yard, m)) return 'the yard';
  for (const p of sim.S.projects) if (!p.gone && !p.below && p.id !== skip && p.w && inRect(x, y, p, m)) return p.type === 'shelter' ? 'the shelter' : p.name;
  return '';
}
export function checkPlot(sim, type, x, y, w, h, side) {
  const W = sim.W, Ty = TYPES[type], bad = [], out = { ok: false, why: '', bad, door: null };
  if (!Ty || Ty.fixed) { out.why = 'That is not something the colony can plan.'; return out; }
  const sh = Math.min(w, h), lg = Math.max(w, h);
  if (sh < Ty.min) { out.why = `Too small: a ${Ty.name.toLowerCase()} needs at least ${Ty.min} by ${Ty.min} tiles.`; return out; }
  if (lg > Ty.max) { out.why = `Too big: a ${Ty.name.toLowerCase()} can be at most ${Ty.max} tiles long.`; return out; }
  if (x < 2 || y < 2 || x + w > MAP - 2 || y + h > MAP - 2) { out.why = 'Too close to the edge of the map.'; return out; }
  const why = new Map(), note = (t, s) => { bad.push(t); if (!why.has(s)) why.set(s, 1); };
  if (Ty.below) return checkBelow(sim, type, x, y, w, h, side, out, note, why);
  for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) {
    const t = ty * MAP + tx, k = W.type[t];
    if (!sim.known[t]) note(t, "The Seed hasn't surveyed all of this ground yet.");
    else if (k === T.SHALLOW || k === T.DEEP) note(t, 'Part of it is in the water.');
    else if (k === T.ROCK) note(t, 'Part of it is on bare rock.');
    else { const r = reservedAt(sim, tx, ty, 1); if (r) note(t, `Too close to ${r}.`); else if (!W.cost[t] || !W.reach[t]) note(t, "Part of it can't be reached on foot."); }
  }
  const L = W.land;
  if (!bad.length && Math.hypot(x + w / 2 - L.x, y + h / 2 - L.y) > 70) { out.why = 'Too far from camp: keep it within 140 m of the Seed.'; return out; }
  if (!bad.length && type === 'pit') { const g = groundOf(W, x, y, w, h); if (g.stone < .5) { out.why = 'The ground here is too deep in soil and clay for a pit: the view below ground (U) shows where the stone lies near the surface.'; return out; } out.ground = g; }
  if (!Ty.open) {
    const d = doorOf(x, y, w, h, side), t = d.y * MAP + d.x; out.door = d;
    if (!bad.length && (!W.cost[t] || !W.reach[t] || reservedAt(sim, d.x, d.y, 0))) { bad.push(t); why.set('The door would open onto blocked ground. Turn it to another side.', 1); }
  }
  if (bad.length) { out.why = [...why.keys()][0]; out.bad = bad.slice(0, 400); return out; }
  // low ground by the water: allowed, but the Seed says so
  { const thr = floodPlain(W); let n = 0; for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) if (thr[ty * MAP + tx] <= FLOOD_LINE) n++; if (n >= w * h * .3) out.warn = 'Low ground by the water: a flood could reach it. The Seed would build higher up.'; }
  out.ok = true; return out;
}
// a room below ground: the Seed's sounding of the ground under the plot decides it. Waterlogged ground and solid
// rock can't be dug; anything else can, slower the harder it is. The stairs come up on open ground.
function checkBelow(sim, type, x, y, w, h, side, out, note, why) {
  const W = sim.W, U = underOf(W), bad = out.bad;
  for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) {
    const t = ty * MAP + tx, u = U[t] & 7;
    if (!sim.known[t]) note(t, "The Seed hasn't surveyed all of this ground yet.");
    else if (u === UG.WET) note(t, 'The ground under part of it is waterlogged: it would flood.');
    else if (u === UG.SOLID) note(t, 'Part of it runs into solid rock nobody could dig.');
    else { const r = reservedAt(sim, tx, ty, 1, -1, true); if (r) note(t, `Too close to ${r}, under the ground.`); }
  }
  const L = W.land;
  if (!bad.length && Math.hypot(x + w / 2 - L.x, y + h / 2 - L.y) > 70) { out.why = 'Too far from camp: keep it within 140 m of the Seed.'; return out; }
  const d = doorOf(x, y, w, h, side), t = d.y * MAP + d.x; out.door = d;
  if (!bad.length && (!W.cost[t] || !W.reach[t] || reservedAt(sim, d.x, d.y, 0))) { bad.push(t); why.set('The stairs would come up on blocked ground. Turn them to another side.', 1); }
  if (bad.length) { out.why = [...why.keys()][0]; out.bad = bad.slice(0, 400); return out; }
  out.ground = groundOf(W, x, y, w, h);
  if (type === 'mine' && seamOf(out.ground, w, h) < SEAM * 3) { out.why = 'There is no seam of ore under enough of this ground. Press U to see where the seams run, and draw the mine over them.'; return out; }
  if (floodPlain(W)[t] <= FLOOD_LINE) out.warn = 'The stairs come up on low ground by the water: a flood would pour down them. The Seed would dig higher up.';
  out.ok = true; return out;
}
// the ore a mine can bring up: a share of each tile of seam it is dug along
export const SEAM = 40, PIT_ROCK = 40;   // loads of stone a pit holds, per tile
export const seamOf = (g, w, h) => Math.round((g ? g.ore : 0) * w * h) * SEAM;
// what is under a plot: how much harder than soil it is to dig, how much more shoring it needs, and the ore in it
const DIG = [1, 1.25, 2, 3], SHORE = [1.3, 1, .5, .3];
export function groundOf(W, x, y, w, h) {
  const U = underOf(W), n = [0, 0, 0, 0]; let ore = 0, dig = 0, shore = 0, k = 0;
  for (let ty = y; ty < y + h; ty++) for (let tx = x; tx < x + w; tx++) { const u = U[ty * MAP + tx], b = u & 7; if (b > 3) continue; n[b]++; dig += DIG[b]; shore += SHORE[b]; k++; if (u & ORE) ore++; }
  k = Math.max(1, k); const main = n.indexOf(Math.max(...n));
  return { dig: +(dig / k).toFixed(2), shore: +(shore / k).toFixed(2), kind: main, name: U_NAME[main], ore: +(ore / k).toFixed(2), stone: +((n[2] + n[3]) / k).toFixed(2) };
}
// the nearest good place for a building of this size, facing the camp: for the bot, and for the Seed's own suggestions
export function findPlot(sim, type, w, h) {
  const L = sim.W.land;
  for (const wet of [false, true]) for (let r = 9; r <= 48; r += 1.5) {
    const n = Math.max(8, Math.floor(r * 2.2));
    for (let k = 0; k < n; k++) {
      const a = k / n * 6.2832 + r * .37;
      for (const [ww, hh] of w === h ? [[w, h]] : [[w, h], [h, w]]) {
        const x = Math.round(L.x + Math.cos(a) * r - ww / 2), y = Math.round(L.y + Math.sin(a) * r - hh / 2), side = facing(sim.W, x, y, ww, hh);
        const c = checkPlot(sim, type, x, y, ww, hh, side); if (c.ok && (!c.warn || wet)) return { x, y, w: ww, h: hh, side };
      }
    }
  }
  return null;
}

// ---------- the colony's projects ----------
export function shelterProject(W, stage = 0, fits = 0) {
  const s = W.site.shelter, side = s.dx > 0 ? 3 : s.dx < 0 ? 1 : s.dy > 0 ? 0 : 2;
  const p = { id: 0, type: 'shelter', name: 'Shelter', x: s.x, y: s.y, w: s.w, h: s.h, side, door: { x: s.door.x, y: s.door.y }, stage: 0, need: { mark: 4 }, got: {}, done: false, powered: false, paused: false, gone: false, blocked: true, wait: '', stall: 0, since: 0, out: {}, used: {} };
  // a shelter from an older save: the fittings it had, stage by stage
  let left = fits; p.stage = stage;
  for (let st = 0; st < stage; st++) left -= SHELTER_STAGES[st][1];
  if (stage < 5) { const [k, n] = SHELTER_STAGES[stage]; p.need = { [k]: n }; if (left > 0) p.got = { [k]: Math.min(n, left) }; }
  return p;
}
export function addProject(sim, type, x, y, w, h, side, mat) {
  const S = sim.S, Ty = TYPES[type], id = S.pid++;
  const n = S.projects.filter(p => p.type === type).length + 1;
  const p = {
    id, type, name: type === 'test' ? `Load test: ${mat}` : `${Ty.name} ${n}`, x, y, w, h, side, door: Ty.open || type === 'test' ? null : doorOf(x, y, w, h, side),
    below: !!Ty.below, ug: Ty.below ? groundOf(sim.W, x, y, w, h) : undefined,
    stage: 0, need: stageLoads(S, type, w, h, 0, mat), got: {}, done: false, powered: false, paused: false, gone: false, blocked: false, wait: '', stall: 0, since: S.tick, out: {}, used: {}, mat,
  };
  if (type === 'mine') p.seam = seamOf(p.ug, w, h);
  if (type === 'pit') p.rock = p.rock0 = PIT_ROCK * w * h;
  if (type === 'test') S.projects.unshift(p); else S.projects.push(p);
  S.rv++;
  return p;
}
export const active = S => S.projects.filter(p => !p.gone && !p.done);
export const built = S => S.projects.filter(p => !p.gone && p.done && p.type !== 'test');
export const byId = (S, id) => S.projects.find(p => p.id === id && !p.gone) || null;
export const capOf = p => capacity(p.type, p.w, p.h);

// ---------- power ----------
// The lander's core and any solar fields make power; finished buildings take it in the order of the project
// list, and whatever doesn't fit stays dark until there is more.
export function powerCheck(sim) {
  const S = sim.S; let supply = LANDER_KW, draw = 0; const changed = [];
  const sun = S.F ? S.F.sun : 1;
  // a building on fire or under water is out of use: it makes and takes nothing
  for (const p of built(S)) if (p.type === 'solar') { const on = !p.shut; if (on) supply += capOf(p).supply * sun; if (p.powered !== on) { p.powered = on; changed.push(p); } }
  // a mine's lamps come first: without its metal there are no more panels, so it never waits for power behind the rest
  const order = built(S).filter(p => p.type !== 'solar').sort((a, b) => (b.type === 'mine') - (a.type === 'mine'));
  for (const p of order) {
    const kw = capOf(p).kw, on = !p.shut && draw + kw <= supply + 1e-9;
    if (on) draw += kw;
    if (on !== p.powered) { p.powered = on; changed.push(p); }
  }
  S.power = { supply: +supply.toFixed(1), draw: +draw.toFixed(1) };
  return changed;
}
export function shortOf(S, p) { const kw = capOf(p).kw; return +Math.max(0, S.power.draw + kw - S.power.supply).toFixed(1); }

// ---------- stock ----------
export function stockOf(S, k) {
  if (k in S.stores.yard) return S.stores.yard[k];
  let n = S.stores.cargo[k] || 0;
  for (const p of S.projects) if (!p.gone && p.out[k]) n += p.out[k];
  return n;
}
// everywhere a builder could fetch a load of k from, with what's there
export function sources(sim, k) {
  const S = sim.S, out = [];
  if (k in S.stores.yard) { if (S.stores.yard[k] > 0) out.push({ key: 'yard', tile: sim.yardTile }); return out; }
  if (S.stores.cargo[k] > 0) out.push({ key: 'cargo', tile: sim.cargoTile });
  for (const p of built(S)) if (p.type === 'workshop' && p.out[k] > 0) out.push({ key: 'w' + p.id, tile: p.door.y * MAP + p.door.x });
  return out;
}
export function takeFrom(S, key, k) {
  const st = key === 'yard' ? S.stores.yard : key === 'cargo' ? S.stores.cargo : (byId(S, +key.slice(1)) || {}).out;
  if (!st || !(st[k] > 0)) return false;
  st[k]--; return true;
}
// things carried home from an interrupted job go back where they came from
export function putBack(S, k) { if (k in S.stores.yard) S.stores.yard[k]++; else if (k in S.stores.cargo || PRECISE.includes(k)) S.stores.cargo[k] = (S.stores.cargo[k] || 0) + 1; }

// what a workshop bench (or the fabricator) should make next: the first precise module the project list will
// run short of, counting what is in stock and already being made
export function nextOrder(sim) {
  const S = sim.S, have = {}, need = {};
  for (const k of PRECISE) have[k] = stockOf(S, k);
  if (S.fab.job) have[S.fab.job.k]++;
  for (const c of S.cols) if (!c.dead && c.make && (c.job === 'salv' || c.job === 'bench')) have[c.make]++;
  for (const c of S.cols) if (!c.dead && PRECISE.includes(c.carry)) have[c.carry]++;   // on the way to a site
  for (const p of active(S)) {
    if (p.paused || p.type === 'test') continue;
    for (let st = p.stage; st < 5; st++) {
      const L = st === p.stage ? p.need : loadsOf(S, p, st);
      for (const k of PRECISE) {
        const n = (L[k] || 0) - (st === p.stage ? (p.got[k] || 0) : 0); if (n <= 0) continue;
        need[k] = (need[k] || 0) + n;
        if (need[k] > have[k]) return k;
      }
    }
  }
  return null;
}
// ---------- feedstock ----------
// One batch in one tank of a feedstock plant: loads from the yard, hours with power, and the share of a body it
// makes. The plant stops while the fabricator already holds feedstock for FEED.max bodies, or for everyone left
// in the archive and every couple waiting for a child.
export const FEED = { biomass: 3, stone: 1, h: 12, per: 8, max: 4 };
export function plantStop(S) {
  const sd = S.seedc, asleep = S.archive.filter(p => p.woke == null).length - sd.queue.length - (sd.printing ? 1 : 0);
  let run = 0; for (const p of built(S)) if (p.type === 'plant' && p.tanks) for (const t of p.tanks) if (t > 0) run++;
  const have = sd.feed + ((sd.fb || 0) + run) / FEED.per;
  const asks = S.gen && S.gen.rule !== 'no' ? S.gen.asks.length : 0, want = asleep + asks;   // couples waiting for a child need a body's worth each too
  if (want <= 0) return 'Everyone in the archive is awake and no couple is waiting for a child, so nobody needs a body.';
  if (have >= Math.min(FEED.max, want)) return `The fabricator already holds feedstock for ${have >= want ? (asks ? (asleep > 0 ? 'everyone left in the archive and every couple waiting for a child' : 'every couple waiting for a child') : 'everyone left in the archive') : `${FEED.max} bodies`}. The tanks wait until some is used.`;
  return '';
}
// raw material the colony wants piled in the yard: everything the project list still needs, plus a little, plus
// two batches ahead for each working tank (unless only the projects count)
export function rawWanted(S, k, plants = true) {
  let n = 6;
  if (plants && FEED[k] && S.seedc && !plantStop(S)) for (const p of built(S)) if (p.type === 'plant' && p.powered) n += capOf(p).tanks * FEED[k] * 2;
  for (const p of active(S)) {
    if (p.paused) continue;
    for (let st = p.stage; st < (p.type === 'test' ? 1 : 5); st++) {
      const L = st === p.stage ? p.need : loadsOf(S, p, st);
      n += Math.max(0, (L[k] || 0) - (st === p.stage ? (p.got[k] || 0) : 0));
    }
  }
  return Math.min(60, n);
}

// ---------- clearing a plot ----------
// trees and boulders on the plot come down when it is marked out: logs and stone go to the yard
export function clearPlot(sim, p) {
  const S = sim.S, W = sim.W; let logs = 0, stones = 0, bio = 0;
  for (const q of propsIn(W, p.x, p.y, p.x + p.w, p.y + p.h)) {
    const t = Math.floor(q.y) * MAP + Math.floor(q.x);
    if (q.k === 'tree') { const left = S.gone[t] ?? 2; logs += left; sim.setGone(t, 0); }
    else if (q.k === 'boulder') { stones++; sim.setGone(t, 0); }
    else if (q.k === 'bush') { bio++; sim.setGone(t, 0); }
  }
  S.stores.yard.timber += logs; S.stores.yard.stone += stones; S.stores.yard.biomass = (S.stores.yard.biomass || 0) + bio;
  if (logs || stones || bio) sim.log(`Clearing the plot for ${p.name} gave ${[logs ? matName('timber', logs) : '', stones ? matName('stone', stones) : '', bio ? matName('biomass', bio) : ''].filter(Boolean).join(' and ')}.`);
}

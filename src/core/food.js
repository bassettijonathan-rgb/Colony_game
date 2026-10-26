// Food: the planet's local life (drawn for each world from the sealed pool), finding it, taking samples and
// testing them, the crops in the Seed's seed bank and the fields of made soil they grow in, the larder and the
// kitchen (cooking, leaching, fermenting), and what people eat, with the slow harm a narrow diet can do.
// Rations from the lander last a season; everything after that has to come from here.
import { MAP, CH, NCH, T, HOUR, DAY_TICKS } from './consts.js';
import { hash, vnoise, clamp } from './rng.js';
import { SEALED } from '../sealed/texts.js';
import { normalTemp, dayWeather, doyOf, seasonOf, DEEP } from './year.js';
import { dietLoad } from './aging.js';

export const POOL = SEALED.life || [];
const TERR = { meadow: T.MEADOW, dirt: T.DIRT, sand: T.SAND, shallow: T.SHALLOW, marsh: T.MARSH, forest: T.FOREST, scree: T.SCREE };
export const WILD_REGROW = 2, SAMPLES = 3, TEST_H = 12, SEED_LAB = .5, VATS = 4, MAX_PER_KIND = 900;
export const PROC_DAYS = { leach: 1, ferment: 4 }, FERMENT_KEEP = 40, COOKED_KEEP = 4, CROP_LOAD = 4;
export const PROC_NAME = { cook: 'cooking', leach: 'leaching in running water for a day, then cooking', ferment: 'fermenting for four days' };

// ---------- the crops in the seed bank: from home, so their needs are known ----------
// days to ripen at a good temperature, the coldest it grows in, the warmth it likes, the frost that kills it,
// meals per tile of field, days a harvested load keeps
export const CROPS = {
  potato: { name: 'Potatoes', days: 17, min: 5, opt: 16, frost: -1.5, yield: 2, keep: 45, note: 'The surest crop: a good yield, and they keep for weeks.' },
  kale: { name: 'Kale', days: 12, min: 1, opt: 12, frost: -7, yield: .9, keep: 8, note: 'Quick and hardy, standing through light frosts, but a small yield that spoils fast.' },
  beans: { name: 'Beans', days: 22, min: 9, opt: 20, frost: 0, yield: 1.2, keep: 90, note: 'Need real warmth and take longest, but dried beans keep through any winter.' },
};
export const CROP_KEYS = Object.keys(CROPS);

// ---------- which life this world has, and where ----------
// one kind for each role first, then three more, all from the world's seed
export function drawLife(seed) {
  let n = 0; const r = () => hash(seed, n++, 77), out = [], left = POOL.slice();
  const take = k => { const i = left.indexOf(k); if (i >= 0) { left.splice(i, 1); out.push(k); } };
  for (const role of ['staple', 'leach', 'ferment', 'compost']) { const c = left.filter(k => k.role === role); if (c.length) take(c[Math.floor(r() * c.length)]); }
  for (let n = 0; n < 3 && left.length; n++) take(left[Math.floor(r() * left.length)]);
  return out;
}
// patches of each kind on the ground it likes, in drifts rather than scattered evenly; kept by chunk so a
// person can look around them quickly. The world's staple always grows somewhere within reach of the landing,
// if its ground is there at all.
export function placeLife(W, kinds) {
  const s = W.seed, L = W.land, list = [], by = Array.from({ length: NCH * NCH }, () => []), per = kinds.map(() => 0);
  const put = (o, x, y) => { list.push({ o, x: x + .2 + hash(x, y, s + 320) * .6, y: y + .2 + hash(x, y, s + 321) * .6, t: y * MAP + x, v: hash(x, y, s + 322) }); by[((y / CH) | 0) * NCH + ((x / CH) | 0)].push(list.length - 1); per[o]++; };
  const fits = (k, t) => k.where.some(w => TERR[w] === t), taken = new Uint8Array(MAP * MAP);
  const pass = (x0, y0, x1, y1, only, boost, floor) => {
    for (let y = Math.max(2, y0); y < Math.min(MAP - 2, y1); y++) for (let x = Math.max(2, x0); x < Math.min(MAP - 2, x1); x++) {
      const i = y * MAP + x, t = W.type[i];
      if (taken[i] || (L && Math.hypot(x + .5 - L.x, y + .5 - L.y) < 14)) continue;
      // look at the kinds in a different order on every tile, so no kind crowds out the others
      const n = kinds.length, o0 = Math.floor(hash(x, y, s + 305) * n);
      for (let j = 0; j < n; j++) {
        const o = (o0 + j) % n, k = kinds[o];
        if ((only >= 0 && o !== only) || per[o] >= MAX_PER_KIND || !fits(k, t)) continue;
        const drift = vnoise(x / 16, y / 16, s + 300 + o * 13);
        if (drift < floor || hash(x, y, s + 310 + o + boost) > k.dens * boost * (drift - floor) * 6) continue;
        put(o, x, y); taken[i] = 1; break;
      }
    }
  };
  pass(0, 0, MAP, MAP, -1, 1, .5);
  const st = kinds.findIndex(k => k.role === 'staple');
  if (st >= 0 && L) {
    let near = 0; for (const p of list) if (p.o === st && Math.abs(p.x - L.x) < 80 && Math.abs(p.y - L.y) < 80) near++;
    if (near < 12) pass(Math.floor(L.x - 80), Math.floor(L.y - 80), Math.ceil(L.x + 80), Math.ceil(L.y + 80), st, 4, .3);
  }
  return { list, by };
}
export const patchNear = (life, x, y, r, f) => {
  const cx0 = Math.max(0, ((x - r) / CH) | 0), cx1 = Math.min(NCH - 1, ((x + r) / CH) | 0), cy0 = Math.max(0, ((y - r) / CH) | 0), cy1 = Math.min(NCH - 1, ((y + r) / CH) | 0);
  for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) for (const i of life.by[cy * NCH + cx]) { const p = life.list[i]; if (Math.abs(p.x - x) <= r && Math.abs(p.y - y) <= r) f(p, i); }
};

// ---------- state ----------
export function newFood(nKinds) {
  return {
    life: Array.from({ length: nKinds }, () => ({ seen: false, day: 0, samples: 0, tested: false, queued: false })),
    patch: {}, sampled: {}, lab: { queue: [], cur: -1, work: 0 },
    larder: { raw: {}, prep: {}, meals: {} }, vats: [],
    snow: 0, ice: 0, temp: 0, seasonSaid: -1, warned: 0, firstHarvest: false,
  };
}
// a patch's loads left, growing back when its time comes
export function patchLeft(sim, i) {
  const F = sim.S.F, st = F.patch[i], k = sim.kinds[sim.life.list[i].o];
  if (!st) return k.yield;
  if (st.n <= 0 && sim.day >= st.back) { delete F.patch[i]; return k.yield; }
  return st.n;
}
export const inSeason = (sim, k) => !!k.season[seasonOf(doyOf(sim.cal))];
export function takePatch(sim, i) {
  const F = sim.S.F, k = sim.kinds[sim.life.list[i].o], n = patchLeft(sim, i) - 1;
  F.patch[i] = { n, back: n <= 0 ? sim.day + k.regrow * WILD_REGROW : 0 };
}
export const keyOf = o => 'L' + o;
export const isCrop = src => src in CROPS;
// what a larder entry is: a crop from home or a local kind, with its processing and properties
export function foodOf(sim, src) {
  if (isCrop(src)) { const c = CROPS[src]; return { name: c.name, meals: CROP_LOAD, proc: 'cook', keep: c.keep, slow: 0, lacks: false }; }
  const k = sim.kinds[+src.slice(1)]; return k && k.food ? { name: k.name, ...k.food } : null;
}

// ---------- seeing, sampling, testing ----------
// people outside notice the life around them; survey crews and foragers take a sample from each patch they
// pass, up to the three a test needs
export function lookAround(sim, c, taking) {
  const S = sim.S, F = S.F;
  patchNear(sim.life, c.x, c.y, 7, (p, i) => {
    const L = F.life[p.o], k = sim.kinds[p.o];
    if (!L.seen) {
      L.seen = true; L.day = sim.day; S.rv++;
      sim.log(`${c.name} found something new: ${k.seen} The Seed is calling it ${k.name.toLowerCase()} for now.`, 'good', { e: 'found', lvl: 1, x: p.x, y: p.y, title: 'Local life' });
    }
    if (taking && !L.tested && !L.queued && L.samples < SAMPLES && !F.sampled[i] && Math.hypot(p.x - c.x, p.y - c.y) < 4) {
      F.sampled[i] = 1; L.samples++; S.rv++;
      if (L.samples === SAMPLES) sim.log(`Samples of ${k.name.toLowerCase()} are ready to test: ${c.name} brought back the third.`, 'good', { e: 'samples', lvl: 1, who: c.id, title: 'Ready to test' });
    }
  });
}
export function analyse(sim, o) {
  const F = sim.S.F, L = F.life[o];
  if (!L || !L.seen || L.tested || L.queued || L.samples < SAMPLES) return false;
  L.queued = true; F.lab.queue.push(o); sim.S.rv++;
  sim.log(`Queued the samples of ${sim.kinds[o].name.toLowerCase()} for testing.`);
  return true;
}
// an hour of testing: the Seed's own analyser always works slowly; people at lab benches add their hours
export function labHour(sim, extra = 0) {
  const S = sim.S, F = S.F, lab = F.lab;
  if (lab.cur < 0) { if (!lab.queue.length) return; lab.cur = lab.queue.shift(); lab.work = 0; S.rv++; }
  lab.work += SEED_LAB + extra;
  if (lab.work >= TEST_H) {
    const o = lab.cur, k = sim.kinds[o], L = F.life[o];
    L.tested = true; L.queued = false; L.samples = 0; lab.cur = -1; lab.work = 0; S.rv++;
    sim.log(`${k.name}: ${k.result} ${verdict(k)}`, 'good', { e: 'lifetest', lvl: 2, title: `What ${k.name.toLowerCase()} is` });
  }
}
// the Seed's summary of a test, in one line
export function verdict(k) {
  const f = k.food;
  if (!f) return `Not food. As compost for made soil, a load is worth ${k.bio === 1 ? 'a load' : k.bio + ' loads'} of scrub.`;
  let s = `Food: ${f.meals} meals a load after ${PROC_NAME[f.proc]}.`;
  if (f.slow) s += ' No more than one meal in three.';
  if (f.lacks) s += ' Not enough on its own.';
  if (f.proc !== 'cook') s += ' Only a kitchen crew can do that.';
  return s;
}

// ---------- fields ----------
// what the Seed would plant in a field now: the best crop that can ripen before Deep cold, judged on this
// world's usual seasons, or nothing if no crop has time. It waits for the last usual frost a crop can't stand;
// an unusually cold night can still catch it.
export function cropPlan(sim, p) {
  if (p.crop.want && p.crop.want !== 'auto') return p.crop.want === 'fallow' ? null : (canGrow(sim, p.crop.want) ? p.crop.want : null);
  let best = null, bs = -1;
  for (const k of CROP_KEYS) { if (!canGrow(sim, k)) continue; const c = CROPS[k], s = c.yield * (1 + c.keep / 60); if (s > bs) { bs = s; best = k; } }
  return best;
}
// expected days to ripen from today at this world's usual temperatures; Infinity if Deep cold or a usual frost
// would get it first
export function daysToRipen(sim, k, g = 0) {
  const c = CROPS[k], seed = sim.W.seed; let d = sim.cal, left = 1 - g;
  for (let n = 0; n < 60; n++, d++) {
    if (seasonOf(doyOf(d)) === DEEP) return Infinity;
    let r = 0;
    for (let h = 0; h < 24; h += 3) { const t = normalTemp(seed, d, h); if (t < c.frost + 1) return Infinity; r += growRate(c, t) / 8; }
    left -= r / c.days; if (left <= 0) return n + 1;
  }
  return Infinity;
}
export const canGrow = (sim, k) => daysToRipen(sim, k) < Infinity;
const growRate = (c, t) => clamp((t - c.min) / (c.opt - c.min), 0, 1.1);
// an hour in a field: growing, frost, ripening, rotting
export function fieldHour(sim, p, temp, hour) {
  const S = sim.S, cr = p.crop, c = CROPS[cr.k];
  if (!c || cr.st === 'bare') return;
  if (cr.st === 'grow') {
    cr.g = Math.min(1, cr.g + growRate(c, temp) / (c.days * 24));
    if (cr.g >= 1) { cr.st = 'ripe'; cr.ripe = sim.day; S.rv++; sim.log(`The ${c.name.toLowerCase()} in ${p.name} are ripe. A farm crew can bring them in.`, 'good', { e: 'ripe', lvl: 1, pid: p.id, title: 'Ready to harvest' }); }
  }
  if (temp < c.frost && cr.st !== 'dead') {
    cr.h -= .25; S.rv++;
    if (cr.h <= 0) { cr.st = 'dead'; cr.h = 0; sim.log(`Frost killed the ${c.name.toLowerCase()} in ${p.name}.`, 'bad', { e: 'frost', lvl: 1, pid: p.id, title: 'Frost' }); }
  }
  if (cr.st === 'ripe' && hour === 12 && sim.day - cr.ripe > 8) { cr.h = Math.max(0, cr.h - .1); S.rv++; }
  if (hour === 13 && cr.st === 'grow' && dayWeather(sim.W.seed, sim.cal).k === 'storm' && hash(p.id, sim.day, 611) < .3) {
    cr.h = Math.max(.1, cr.h - .2); S.rv++;
    sim.log(`The storm flattened part of the ${c.name.toLowerCase()} in ${p.name}.`, 'bad', { pid: p.id });
  }
}
export const fieldTiles = p => p.w * p.h;
export const sowUnits = p => Math.max(2, Math.ceil(fieldTiles(p) / 12));
export const harvestLoads = p => { const c = CROPS[p.crop.k]; return c ? Math.max(1, Math.round(fieldTiles(p) * c.yield * p.crop.h / CROP_LOAD)) : 0; };

// ---------- the larder and the kitchen ----------
export const add = (o, k, n) => { o[k] = (o[k] || 0) + n; };
const sum = o => { let n = 0; for (const k in o) n += o[k]; return n; };
// everything that can be eaten, in meals: cooked and fermented meals, leached loads waiting to be cooked,
// raw loads, what is in the vats, and the rations
// (with `usable`, raw food that needs leaching or fermenting only counts while there is a kitchen crew to do it)
export function mealsInStore(sim, usable = false) {
  const S = sim.S, Ld = S.F.larder, cook = !usable || hasKitchen(sim); let n = sum(Ld.meals) + S.food;
  for (const k in Ld.prep) { const f = foodOf(sim, k); if (f) n += Ld.prep[k] * f.meals; }
  for (const k in Ld.raw) { const f = foodOf(sim, k); if (f && (cook || f.proc === 'cook')) n += Ld.raw[k] * f.meals; }
  for (const v of S.F.vats) { const f = foodOf(sim, v.src); if (f) n += v.n * f.meals; }
  return n;
}
// meals' worth that only the kitchen can make ready: leached loads, and raw food that has to be leached or fermented
export function kitchenOnly(sim) {
  const Ld = sim.S.F.larder; let n = 0;
  for (const k in Ld.prep) { const f = foodOf(sim, k); if (f) n += Ld.prep[k] * f.meals; }
  for (const k in Ld.raw) { const f = foodOf(sim, k); if (f && f.proc !== 'cook') n += Ld.raw[k] * f.meals; }
  return n;
}
// once a day: fresh food spoils, frozen food much more slowly; fermented meals and rations keep
export function spoil(sim) {
  const S = sim.S, Ld = S.F.larder, cool = cellarShare(S), cold = (S.F.temp < 0 ? .2 : 1) * (1 - .7 * cool);
  for (const k in Ld.raw) { const f = foodOf(sim, k); Ld.raw[k] -= Ld.raw[k] * cold / (f ? f.keep : 10); if (Ld.raw[k] < .05) delete Ld.raw[k]; }
  for (const k in Ld.prep) { Ld.prep[k] -= Ld.prep[k] * cold / 6; if (Ld.prep[k] < .05) delete Ld.prep[k]; }
  for (const k in Ld.meals) { const f = foodOf(sim, k), keep = f && f.proc === 'ferment' ? FERMENT_KEEP : COOKED_KEEP; Ld.meals[k] -= Ld.meals[k] * cold / keep; if (Ld.meals[k] < .05) delete Ld.meals[k]; }
}
// how much of the larder fits in the root cellars, where it keeps cool all year
export function cellarShare(S) {
  let room = 0; for (const p of S.projects) if (p.type === 'cellar' && p.done && !p.gone && !p.shut) room += Math.max(0, (p.w - 2) * (p.h - 2)) * 4;   // as capacity() counts it
  if (!room) return 0;
  const Ld = S.F.larder; let n = 0; for (const g of [Ld.raw, Ld.prep, Ld.meals]) for (const k in g) n += g[k];
  return n ? Math.min(1, room / n) : 1;
}
export const hasKitchen = sim => sim.S.crews.some(c => !c.gone && c.work === 'kitchen' && c.members.length);
// what the kitchen should do next: empty a finished vat, cook if few meals are ready, or start a vat
export function kitchenJob(sim, eaters) {
  const S = sim.S, F = S.F, Ld = F.larder;
  const v = F.vats.findIndex(q => q.ready <= S.tick && (!q.taken || q.taken < S.tick - 3 * HOUR));   // a cook called away mid-job leaves the claim behind
  if (v >= 0) return { k: 'unvat', v };
  const ready = sum(Ld.meals), want = Math.max(4, eaters * 2.2);
  if (ready < want) {
    // leached loads first (they spoil), then whatever raw food keeps worst
    let best = null, bk = 1e9;
    for (const k in Ld.prep) if (Ld.prep[k] >= 1) { best = { k: 'cook', src: k, from: 'prep' }; bk = -1; break; }
    if (!best) for (const k in Ld.raw) { const f = foodOf(sim, k); if (f && f.proc === 'cook' && Ld.raw[k] >= 1 && f.keep < bk) { bk = f.keep; best = { k: 'cook', src: k, from: 'raw' }; } }
    if (best) return best;
  }
  if (F.vats.length < VATS) for (const k in Ld.raw) { const f = foodOf(sim, k); if (f && (f.proc === 'leach' || f.proc === 'ferment') && Ld.raw[k] >= 1) return { k: 'vat', src: k }; }
  return null;
}
// a cook's meals from a load: better with skill, and a little worse when everyone just cooks their own
export const cookMeals = (f, skill, own) => f.meals * (own ? .8 : .85 + skill * .04);

// ---------- eating ----------
// one meal a day. The Seed plans the meals: food that spoils first, never more than one meal in three of
// anything with a slow harm or anything that isn't enough on its own while there is something else, and the
// rations last, since they keep forever. If nothing is cooked, people cook their own from the raw food.
export function eat(sim, c) {
  const S = sim.S, Ld = S.F.larder;
  const ok = f => !((f.slow && c.ds > .33) || (f.lacks && c.dl > .33));
  const pickMeal = strict => { let best = null, bk = 1e9; for (const k in Ld.meals) { if (Ld.meals[k] < 1) continue; const f = foodOf(sim, k); if (!f || (strict && !ok(f))) continue; const keep = f.proc === 'ferment' ? FERMENT_KEEP : COOKED_KEEP; if (keep < bk) { bk = keep; best = k; } } return best; };
  const cookOwn = strict => { for (const from of ['prep', 'raw']) for (const k in Ld[from]) { const f = foodOf(sim, k); if (!f || Ld[from][k] < 1 || (from === 'raw' && f.proc !== 'cook') || (strict && !ok(f))) continue; Ld[from][k]--; add(Ld.meals, k, cookMeals(f, c.skills.cooking, true)); return k; } return null; };
  let src = pickMeal(true) || cookOwn(true);
  if (!src && S.food >= 1) { S.food--; diet(c, null); return 'ration'; }
  if (!src) src = pickMeal(false) || cookOwn(false);
  if (!src) return '';
  Ld.meals[src]--; if (Ld.meals[src] < .05) delete Ld.meals[src];
  diet(c, foodOf(sim, src));
  return src;
}
// the running share of meals with a slow harm (ds) or that aren't enough on their own (dl), and the harm itself
function diet(c, f) {
  c.ds = c.ds * .85 + (f && f.slow ? .15 : 0); c.dl = c.dl * .85 + (f && f.lacks ? .15 : 0);
  if (f && f.slow) { c.tox += f.slow; dietLoad(c, f.slow); }
}
// once a day: the body clears a little of the slow harm, and a diet that has been short for long shows
export function dietDay(sim, c) {
  c.tox = Math.max(0, c.tox * .93 - .05);
  c.lack = c.dl > .45 ? c.lack + 1 : Math.max(0, c.lack - 1);
  const was = c.unwell, now = c.tox > 4 || c.lack > 10;
  c.unwell = now;
  if (now && !was) sim.log(`${c.name} feels unwell: ${c.tox > 4 ? 'aching joints, headaches and trouble sleeping' : 'tired all the time, slow to heal, bruising easily'}. Something in the diet.`, 'bad', { e: 'unwell', lvl: 1, who: c.id, title: 'Something in the diet' });
}
export { DAY_TICKS, HOUR };

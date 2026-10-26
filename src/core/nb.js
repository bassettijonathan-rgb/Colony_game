// Neighbours. Other people live on this world: settlements tens of kilometres off, beyond the edge of the map. They
// saw the Seed come down, and in time they walk in from their side of the map: a few at first, to see who has come,
// then caravans to trade, and now and then someone who asks to stay. Who they are, how many, what they want and
// what they know comes from the sealed pools, and each world draws two or three of them. They have lived here far
// longer than the colony, so they know things it doesn't, and what they know is traded like goods: how to use a
// plant the colony hasn't tested, what an illness is.
// A party is a handful of guests. They walk in, stay by the fire for most of a day and the night after, trade if
// they brought anything, and walk home. Guests aren't colonists: nobody has to feed them or look after them.
import { SEALED } from '../sealed/texts.js';
import { DAY_TICKS, HOUR, MAP, ACT, YEAR_DAYS } from './consts.js';
import { lcg, rnd, clamp } from './rng.js';
import { PRECISE, stockOf, built } from './build.js';
import { makePerson } from './founders.js';
import { remember } from './life.js';
import { seasonOf, doyOf, DEEP, dayWeather } from './year.js';
import { ILL, ILLS } from './illness.js';
import { add } from './food.js';
import { flareNear } from './sky.js';
import { seedBody } from './aging.js';
import { stageAt } from './lives.js';
import { planCrews, autoCrew } from './work.js';

export const KINDS = (SEALED.nb && SEALED.nb.kinds) || [];
// what can change hands, and what each is worth, in meals
export const GOODS = {
  meals: { name: 'Food', unit: 'meals', v: 1 }, stone: { name: 'Stone', unit: 'loads', v: .4 }, timber: { name: 'Timber', unit: 'loads', v: .6 },
  biomass: { name: 'Biomass', unit: 'loads', v: .25 }, ore: { name: 'Ore', unit: 'loads', v: 2 }, rare: { name: 'Rare earths', unit: 'loads', v: 6 },
  salvage: { name: 'Salvage', unit: 'loads', v: 3 }, seal: { name: 'Seals', unit: '', v: 8 }, pipe: { name: 'Pipe', unit: 'lengths', v: 6 },
  power: { name: 'Power units', unit: '', v: 10 }, panel: { name: 'Solar panels', unit: '', v: 12 }, dress: { name: 'Dressings', unit: '', v: 2 }, abx: { name: 'Antibiotics', unit: 'courses', v: 6 },
};
export const GOOD_KEYS = Object.keys(GOODS);
// a settlement can only want or bring goods the colony knows how to count
for (const K of KINDS) for (const o of ['offers', 'wants']) for (const k in K[o] || {}) if (!GOODS[k]) delete K[o][k];
const YARD = ['stone', 'timber', 'biomass', 'ore', 'rare', 'salvage'], MED = ['dress', 'abx'];
export const KNOW_V = { life: 14, unseen: 18, ill: 12 };
export const DIRS = ['north', 'north-east', 'east', 'south-east', 'south', 'south-west', 'west', 'north-west'];
const TRUST_VISIT = 6, FIRST = [16, 30], GAP = [14, 24], STAY = { meet: 10, trade: 18 };
const pick = (r, a) => a[Math.floor(r() * a.length)];
// some years a settlement goes hungry: its traders say so, it wants food above all, and if nobody helps, it may come for it
export const yearOf = sim => Math.floor((sim.cal - 1) / YEAR_DAYS);
export const hungry = (sim, q) => q.lean === yearOf(sim) && (q.fed || 0) < q.pop * .25;
export function wantsOf(sim, i) {
  const q = sim.S.nb.list[i], K = KINDS[q.k];
  return hungry(sim, q) ? { ...K.wants, meals: Math.max(1.4, (K.wants.meals ?? 1) * 1.6) } : K.wants;
}

// ---------- the world's neighbours, drawn once ----------
export function newNb(sim) {
  const r = lcg(sim.W.seed * 41 + 23), n = KINDS.length ? Math.min(KINDS.length, r() < .5 ? 2 : 3) : 0, ks = KINDS.map((_, i) => i);
  for (let i = ks.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [ks[i], ks[j]] = [ks[j], ks[i]]; }
  const dirs = [0, 1, 2, 3, 4, 5, 6, 7]; for (let i = 7; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [dirs[i], dirs[j]] = [dirs[j], dirs[i]]; }
  const local = ILLS.filter(K => !K.brought).map(K => K.id);
  const list = ks.slice(0, n).map((k, i) => {
    const K = KINDS[k], span = ([a, b]) => Math.round(a + r() * (b - a));
    return {
      k, place: K.place, folk: K.folk, dir: dirs[i], km: span(K.km), pop: span(K.pop), trust: K.trust, met: false, visits: 0, trades: 0, joined: 0, last: -1, taught: [],
      life: sim.kinds.map((_, o) => o).filter(() => r() < K.knows), ill: K.ills ? local.filter(() => r() < .7) : [],
    };
  });
  return { list, g: [], party: null, next: FIRST[0] + Math.floor(r() * (FIRST[1] - FIRST[0])), seq: 0 };
}
export const nbKind = (S, i) => KINDS[S.nb.list[i].k];
export const trustWord = t => t < -40 ? 'hostile' : t < -10 ? 'wary of the colony' : t < 15 ? 'polite but guarded' : t < 40 ? 'friendly' : t < 70 ? 'good friends' : 'close allies';
const fill = (s, o) => s.replace(/\{(\w+)\}/g, (_, k) => o[k] ?? '');

// ---------- what the colony has to give, and taking and putting goods ----------
const sum = o => { let n = 0; for (const k in o) n += o[k]; return n; };
export function haveOf(sim, k) {
  const S = sim.S;
  if (k === 'meals') return Math.floor(sum(S.F.larder.meals) + S.food);
  if (YARD.includes(k)) return Math.floor(S.stores.yard[k] || 0);
  if (MED.includes(k)) return Math.floor(S.med[k] || 0);
  if (PRECISE.includes(k)) return stockOf(S, k);
  return 0;
}
export function takeGood(sim, k, n) {
  const S = sim.S;
  if (k === 'meals') {
    const M = S.F.larder.meals;
    for (const s of Object.keys(M)) { const q = Math.min(n, M[s]); M[s] -= q; n -= q; if (M[s] < .05) delete M[s]; if (n < 1e-6) return; }
    S.food = Math.max(0, S.food - n); return;
  }
  if (YARD.includes(k)) { S.stores.yard[k] -= n; return; }
  if (MED.includes(k)) { S.med[k] -= n; return; }
  const c = Math.min(n, S.stores.cargo[k] || 0); S.stores.cargo[k] = (S.stores.cargo[k] || 0) - c; n -= c;
  for (const p of S.projects) if (n > 0 && !p.gone && p.out[k] > 0) { const q = Math.min(n, p.out[k]); p.out[k] -= q; n -= q; }
}
function put(sim, k, n, i) {
  const S = sim.S;
  if (k === 'meals') add(S.F.larder.meals, 'T' + i, n);
  else if (YARD.includes(k)) S.stores.yard[k] = (S.stores.yard[k] || 0) + n;
  else if (MED.includes(k)) S.med[k] = (S.med[k] || 0) + n;
  else S.stores.cargo[k] = (S.stores.cargo[k] || 0) + n;
}

// ---------- knowledge: what a settlement can still teach the colony ----------
function lessons(sim, i) {
  const S = sim.S, N = S.nb.list[i], out = [];
  for (const o of N.life) { const L = S.F.life[o], k = sim.kinds[o]; if (L && !L.tested) out.push({ id: 'L' + o, name: L.seen ? `How to use ${k.name.toLowerCase()}` : 'A plant you haven’t found yet, and how to use it', v: L.seen ? KNOW_V.life : KNOW_V.unseen }); }
  for (const id of N.ill) { const kn = S.ill.k[id], K = ILL[id]; if (K && kn && !kn.id) out.push({ id: 'I' + id, name: kn.cases ? `What the illness is: ${K.sym.toLowerCase()}` : `An illness of this land: ${K.sym.toLowerCase()}`, v: KNOW_V.ill }); }
  return out;
}
function teach(sim, i, id, who) {
  const S = sim.S, N = S.nb.list[i];
  N.taught.push(id);
  if (id[0] === 'L') {
    const o = +id.slice(1), L = S.F.life[o], k = sim.kinds[o], lab = S.F.lab;
    if (!L || L.tested) return;
    const unseen = !L.seen;
    L.seen = true; L.day = L.day || sim.day; L.tested = true; L.queued = false; L.samples = 0; L.told = i;
    lab.queue = lab.queue.filter(q => q !== o); if (lab.cur === o) { lab.cur = -1; lab.work = 0; }
    sim.log(`The people from ${N.place} told ${who || 'the Seed'} about ${unseen ? 'something the colony hadn’t found yet, which the Seed now calls ' : ''}${k.name.toLowerCase()}. ${k.seen} ${k.result}`, 'good', { e: 'told', lvl: 2, title: `What ${k.name.toLowerCase()} is` });
  } else {
    const k = id.slice(1), kn = S.ill.k[k], K = ILL[k];
    if (!kn || kn.id) return;
    kn.id = kn.named = true; kn.told = i;
    for (const c of S.cols) if (!c.dead) for (const q of c.bd.ill) if (q.k === k) q.kn = true;
    sim.log(`The people from ${N.place} know an illness of this land: ${K.name.toLowerCase()}. ${K.text}`, 'good', { e: 'toldill', lvl: 2, title: K.name });
  }
  S.rv++;
}

// ---------- a bargain: what they think of it ----------
// what they will take for what they give: the worth of the colony's goods to them, against the worth of theirs
// with a margin that shrinks as they come to trust the colony. Giving with nothing asked back is a gift.
export function valueOf(K, trust, give, get, know) {
  let have = 0, ask = 0;
  for (const k in give) have += (give[k] || 0) * GOODS[k].v * (K.wants[k] ?? 1);
  for (const k in get) ask += (get[k] || 0) * (GOODS[k] ? GOODS[k].v : (know[k] || 0));
  const need = ask * (1.25 - clamp(trust, -100, 100) / 400) / (K.fair || 1);
  return { have: Math.round(have * 10) / 10, need: Math.round(need * 10) / 10, ok: ask > 0 ? have >= need : have > 0, gift: ask === 0 && have > 0 };
}
export function trade(sim, m) {
  const S = sim.S, P = S.nb.party;
  if (!P || P.st !== 'stay' || P.kind !== 'trade') return { ok: false, why: 'Nobody is here to trade with.' };
  const i = P.nb, N = S.nb.list[i], K = KINDS[N.k], give = {}, get = {}, know = {};
  for (const k in m.give || {}) { const n = Math.floor(m.give[k]); if (!GOODS[k] || n <= 0) continue; if (n > haveOf(sim, k)) return { ok: false, why: `The colony doesn’t have ${n} ${GOODS[k].name.toLowerCase()}.` }; give[k] = n; }
  const L = lessons(sim, i);
  for (const k in m.get || {}) {
    const n = Math.floor(m.get[k]); if (n <= 0) continue;
    if (GOODS[k]) { if (n > (P.goods[k] || 0)) return { ok: false, why: 'They don’t have that much.' }; get[k] = n; } else { const l = L.find(q => q.id === k); if (!l) return { ok: false, why: 'They can’t teach that.' }; get[k] = 1; know[k] = l.v; }
  }
  const v = valueOf({ wants: wantsOf(sim, i), fair: K.fair }, N.trust, give, get, know);
  if (!v.ok) return { ok: false, why: `${N.folk[0].toUpperCase() + N.folk.slice(1)} want more for that.`, ...v };
  for (const k in give) takeGood(sim, k, give[k]);
  for (const k in get) if (GOODS[k]) { put(sim, k, get[k], i); P.goods[k] -= get[k]; }
  const lead = S.nb.g.find(g => g.lead), who = S.cols.find(c => !c.dead && c.life >= 4 && Math.hypot(c.x - S.nb.g[0].x, c.y - S.nb.g[0].y) < 20);
  for (const k in know) teach(sim, i, k, who && who.name);
  if (give.meals && N.lean === yearOf(sim)) { const was = hungry(sim, N); N.fed = (N.fed || 0) + give.meals; if (was && !hungry(sim, N)) sim.log(`That will see the people of ${N.place} through to their harvest.`, 'good'); }
  const before = N.trust, ask = v.need || 1;
  // trust grows with what the deal is worth to them, and only so far in one visit: twenty small swaps buy no more than one good one
  const up = v.gift ? Math.min(6, v.have / 4) : Math.min(1, v.have / 20) * (1 + Math.min(4, (v.have - v.need) / ask * 4)), room = Math.max(0, TRUST_VISIT - (P.tg || 0));
  P.tg = (P.tg || 0) + Math.min(room, up); N.trust = clamp(N.trust + Math.min(room, up), -100, 100);
  N.trades++; P.traded = 1; S.stats.trades = (S.stats.trades || 0) + 1;
  const words = o => Object.entries(o).filter(([k]) => GOODS[k]).map(([k, n]) => `${n} ${GOODS[k].name.toLowerCase()}`);
  const g = words(give), t = [...words(get), ...Object.keys(know).map(k => L.find(q => q.id === k).name.toLowerCase())];
  sim.log(v.gift ? `The colony gave the people from ${N.place} ${g.join(', ')}. ${lead ? lead.name : 'They'} thanked the Seed for it.` : `Traded with the people from ${N.place}: ${g.length ? g.join(', ') : 'nothing'} for ${t.join(', ')}.`, 'good');
  if (trustWord(before) !== trustWord(N.trust)) sim.log(`The people from ${N.place} are ${trustWord(N.trust)} now.`, 'good', { e: 'nbtrust', lvl: 1, title: N.place });
  S.rv++;
  return { ok: true };
}

// ---------- visits ----------
// each morning: is a party due, and from where. Nobody walks in through Deep cold, a storm or a particle storm.
export function nbMorning(sim) {
  const S = sim.S, N = S.nb; if (!N || !N.list.length || N.party || sim.day < N.next) return;
  if (seasonOf(doyOf(sim.cal)) === DEEP || dayWeather(sim.W.seed, sim.cal).out || flareNear(S)) { N.next = sim.day + 1; return; }
  let i = N.list.findIndex(q => !q.met);
  if (i < 0) { const w = N.list.map(q => Math.max(5, q.trust + 60)), tot = w.reduce((a, b) => a + b, 0); let x = rnd() * tot; i = 0; while (i < w.length - 1 && (x -= w[i]) > 0) i++; }
  const q = N.list[i];
  if (q.met && q.trust < -50) { N.next = sim.day + 6; return; }   // hostile: they keep away (until raids)
  startParty(sim, i, q.met ? 'trade' : 'meet');
  const alive = S.cols.filter(c => !c.dead).length;
  N.next = sim.day + Math.max(8, Math.round((GAP[0] + rnd() * (GAP[1] - GAP[0])) / (1 + Math.max(0, q.trust) / 100) / (alive > 60 ? 1.3 : 1)));
}
// where a party comes in: the map's edge in their direction, on ground that leads to the camp
export function entry(sim, dir) {
  const W = sim.W, L = W.land, a = dir / 8 * Math.PI * 2 - Math.PI / 2, dx = Math.cos(a), dy = Math.sin(a);
  let t = 0; while (true) { const x = L.x + dx * (t + 1), y = L.y + dy * (t + 1); if (x < 6 || y < 6 || x > MAP - 7 || y > MAP - 7) break; t++; }
  const X = Math.round(L.x + dx * t), Y = Math.round(L.y + dy * t);
  for (let r = 0; r < 80; r++) for (let k = 0; k < Math.max(1, r * 6); k++) {
    const b = k / Math.max(1, r * 6) * 6.283, x = Math.round(X + Math.cos(b) * r), y = Math.round(Y + Math.sin(b) * r), i = y * MAP + x;
    if (x > 1 && y > 1 && x < MAP - 2 && y < MAP - 2 && W.reach[i] && W.cost[i]) return i;
  }
  return sim.yardTile;
}
export function nameFor(sim, K, r, used) {
  const A = sim.S.archive;
  if (r() < (K.namesake || 0) && A.length) { const f = pick(r, A); if (!used.has(f.name)) return f.name; }
  for (let n = 0; n < 30; n++) {
    let fam = pick(r, K.family);
    if (fam === '@') { fam = pick(r, A).name.split(' ').slice(1).join(' ').toLowerCase(); for (const [a, b] of K.drift || []) fam = fam.replace(new RegExp(a, 'g'), b); fam = fam[0].toUpperCase() + fam.slice(1); }
    const name = `${pick(r, K.given)} ${fam}`; if (!used.has(name)) return name;
  }
  return pick(r, K.given);
}
// one guest: someone from settlement i, the k-th of their party, standing at tile t
export function newGuest(r, K, i, k, t, name, age) {
  const tint = c => c.map(v => clamp(Math.round(v * (.85 + r() * .3)), 0, 255));
  return { id: k, guest: true, nb: i, name, look: Math.floor(r() * 1e6), coat: tint(K.coat), coat2: tint(K.coat2), lead: k === 0, age,
    x: t % MAP + .5, y: (t / MAP | 0) + .5, ang: 0, spd: .12 + r() * .02, tile: t, act: ACT.WALK, moving: 0, mv: 0, wps: [], wi: 0, leg: [], li: 0, goal: -1, then: ACT.IDLE, wait: k * 40, stuck: 0, timer: 0,
    fat: 0, cap: null, fresh: 0, dead: false, fx: 0, fy: 0, out: 0, spot: -1 };
}
function startParty(sim, i, kind) {
  const S = sim.S, N = S.nb, q = N.list[i], K = KINDS[q.k], r = lcg(sim.W.seed * 7 + S.tick % 100003);
  const n = kind === 'meet' ? 3 + Math.floor(r() * 2) : 3 + Math.floor(r() * 4), at = entry(sim, q.dir), used = new Set([...S.cols.map(c => c.name)]);
  N.g = [];
  for (let k = 0; k < n; k++) {
    const t = k ? nearFree(sim, at, 3) : at, name = nameFor(sim, K, r, used); used.add(name);
    N.g.push(newGuest(r, K, i, k, t, name, 20 + Math.floor(r() * 30)));
  }
  const goods = {};
  if (kind === 'trade') for (const k in K.offers) { const [a, b] = K.offers[k], v = Math.round(a + r() * (b - a)); if (v > 0) goods[k] = v; }
  N.party = { nb: i, kind, st: 'come', seq: ++N.seq, goods, ask: -1, asked: 0, traded: 0, at: -1, until: -1 };
  const x = at % MAP + .5, y = (at / MAP | 0) + .5;
  const known = N.list.filter(o => o.met).map(o => o.place);
  if (kind === 'meet') sim.log(`The Seed’s sensors have picked up ${n} people walking in from the ${DIRS[q.dir]}, toward the camp. ${known.length ? `They are not from the colony, and they don’t come from the direction of ${list(known)}.` : 'They are not from the colony. The Seed has no record of anyone else on this world, and the orbital survey saw no settlement within reach.'}`, 'bad', { e: 'nbsight', lvl: 2, x, y, title: 'People on the map' });
  else sim.log(`People from ${q.place} are walking in from the ${DIRS[q.dir]}, ${n} of them, with packs.`, '', { e: 'nbcome', lvl: 1, x, y, title: `A caravan from ${q.place}` });
  for (const g of N.g) { g.spot = campSpot(sim, g.id); sim.goTo(g, g.spot, ACT.IDLE); }
  S.rv++;
}
export function nearFree(sim, t, r0) {
  const W = sim.W, x0 = t % MAP, y0 = t / MAP | 0;
  for (let r = 1; r < 12; r++) for (let k = 0; k < r * 6; k++) { const b = rnd() * 6.283, x = Math.round(x0 + Math.cos(b) * r * r0 / 3), y = Math.round(y0 + Math.sin(b) * r * r0 / 3), i = y * MAP + x; if (x > 1 && y > 1 && x < MAP - 2 && y < MAP - 2 && W.reach[i] && W.cost[i]) return i; }
  return t;
}
// a place for each guest near the fire, on the side they came from
function campSpot(sim, k) {
  const W = sim.W, F = W.site.fire, q = sim.S.nb.list[sim.S.nb.party ? sim.S.nb.party.nb : 0], a0 = (q ? q.dir : 0) / 8 * 6.283 - Math.PI / 2;
  for (let r = 5; r < 16; r += .7) for (let j = 0; j < 9; j++) {
    const a = a0 + (k - 2) * .28 + (j % 2 ? 1 : -1) * Math.ceil(j / 2) * .2, x = Math.floor(F.x + Math.cos(a) * r), y = Math.floor(F.y + Math.sin(a) * r), t = y * MAP + x;
    if (W.reach[t] && W.cost[t] && !sim.nearPlot(x, y, .5) && !sim.S.nb.g.some(g => g.spot === t)) return t;
  }
  return sim.yardTile;
}
// a guest got where they were going
export function guestArrive(sim, g) {
  const S = sim.S, P = S.nb.party; if (!P) return;
  if (P.st === 'go') { g.out = 1; g.act = ACT.IDLE; if (S.nb.g.every(q => q.out)) endParty(sim); return; }
  g.act = ACT.IDLE; g.timer = 0;
  // no way through from where they stood: they find their own way in, as walkers do
  const F = sim.W.site.fire; if (Math.hypot(g.x - F.x, g.y - F.y) > 25) { g.x = g.spot % MAP + .5; g.y = (g.spot / MAP | 0) + .5; g.tile = g.spot; }
  if (P.st === 'come') arrive(sim);
}
function arrive(sim) {
  const S = sim.S, N = S.nb, P = N.party, q = N.list[P.nb], K = KINDS[q.k];
  // they stay the day and the night, and leave in the morning
  P.st = 'stay'; P.at = S.tick; P.until = Math.max(S.tick + STAY[P.kind] * HOUR, (Math.floor(S.tick / DAY_TICKS) + 1) * DAY_TICKS + Math.round((7 + rnd() * 3) * HOUR));
  const names = N.g.map(g => g.name), lead = N.g[0], first = !q.met, known = N.list.some(o => o.met), o = { place: q.place, pop: q.pop, km: q.km, dir: DIRS[q.dir], lead: lead.name };
  q.visits++; q.last = sim.day;
  const has = Object.entries(P.goods).map(([k, n]) => `${n} ${GOODS[k].name.toLowerCase()}`), L = lessons(sim, P.nb);
  const wants = Object.entries(wantsOf(sim, P.nb)).filter(([, v]) => v >= 1.3).sort((a, b) => b[1] - a[1]).map(([k]) => GOODS[k].name.toLowerCase());
  if (first) {
    q.met = sim.day;
    for (const c of S.cols) if (!c.dead && c.life >= 3) remember(sim, c, `Met the first people from ${q.place}.`);
    sim.log(`${fill(K.about, o)} Their names are ${list(names)}. They are ${trustWord(q.trust)}, and will stay until tomorrow morning.${known ? '' : ' Nobody here knew anyone else lived on this world.'}`, 'good', { e: 'nbmeet', lvl: 2, who: -1, x: lead.x, y: lead.y, title: `People from ${q.place}`, act: 'nb' });
    // a first gift, to show what they know: one thing about the land, if they can tell it and trust the colony enough
    if (L.length && q.trust >= 0) teach(sim, P.nb, L[0].id, '');
  } else {
    sim.log(`${fill(pick(rnd, K.greet), o)}${hungry(sim, q) ? ` They say the last winter was hard on ${q.place}, and their stores are low.` : ''} They brought ${has.length ? list(has) : 'little to trade'}${L.length ? `, and know ${L.length === 1 ? 'one thing' : L.length + ' things'} about this land the colony doesn’t` : ''}.${wants.length ? ` They want ${list(wants.slice(0, 4))} most.` : ''} Trade with them in the Neighbours window (V) before they leave tomorrow.`, 'good', { e: 'caravan', lvl: 2, x: lead.x, y: lead.y, title: `Traders from ${q.place}`, act: 'nb' });
  }
  // some can't bear what the scanner does, and see it the first time they come after it is built
  if (K.noScan && !q.sawScan && S.projects.some(p => !p.gone && p.done && p.type === 'scanner')) {
    q.sawScan = sim.day; q.trust = clamp(q.trust - 15, -100, 100);
    sim.log(`The people from ${q.place} saw the scanner and asked what it was for. When they were told, they went quiet, and ${lead.name} said they would not go near it.`, 'bad', { e: 'nbscan', lvl: 1, x: lead.x, y: lead.y, title: `${q.place} and the scanner` });
  }
  S.stats.visits = (S.stats.visits || 0) + 1;
  S.rv++;
}
export const list = a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
// every few seconds: guests by the fire potter about, sleep at night, and leave when their time is up
export function guestsThink(sim) {
  const S = sim.S, N = S.nb, P = N && N.party; if (!P) return;
  const h = sim.hour, night = h >= 22 || h < 6;
  if (P.st === 'stay') {
    if (P.kind === 'trade' && !P.asked && S.tick > P.at + 3 * HOUR) {
      P.asked = 1;
      const q = N.list[P.nb], K = KINDS[q.k], p = clamp((K.joins || 0) * (.5 + q.trust / 60), 0, .5), cand = N.g.filter(g => !g.lead);
      if (cand.length && rnd() < p && S.cols.some(c => !c.dead)) {
        const g = pick(rnd, cand); P.ask = g.id;
        sim.log(`${fill(pick(rnd, K.joinWhy), { name: g.name, place: q.place })} Answer in the Neighbours window (V) before the party leaves: if they stay, they join the colony as one of its own.`, '', { e: 'nbjoin', lvl: 2, x: g.x, y: g.y, title: `${g.name} asks to stay`, act: 'nb' });
      }
    }
    if (S.tick >= P.until && !night) { leave(sim); return; }
    for (const g of N.g) if (!g.mv && !g.out) g.act = night ? ACT.BED : ACT.IDLE;
  }
}
function leave(sim) {
  const S = sim.S, N = S.nb, P = N.party, q = N.list[P.nb];
  if (P.ask >= 0) { const g = N.g.find(x => x.id === P.ask); if (g) sim.log(`${g.name} went home with the others: nobody answered.`); P.ask = -1; }
  P.st = 'go';
  const at = entry(sim, q.dir);
  for (const g of N.g) if (!g.out) sim.goTo(g, nearFree(sim, at, 3), ACT.IDLE);
  sim.log(`The people from ${q.place} are walking home${P.kind === 'trade' && !P.traded ? ', without trading' : ''}.`);
  S.rv++;
}
export function endParty(sim) { const N = sim.S.nb; N.party = null; N.g = []; sim.S.rv++; }

// ---------- someone asks to stay ----------
export function answerJoin(sim, yes) {
  const S = sim.S, N = S.nb, P = N.party; if (!P || P.ask < 0) return { ok: false };
  const g = N.g.find(x => x.id === P.ask), q = N.list[P.nb]; P.ask = -1;
  if (!g) return { ok: false };
  if (!yes) { sim.log(`${g.name} will go home with the others.`); S.rv++; return { ok: true }; }
  const r = lcg(g.look + 5), p = makePerson(r, -1, new Set(S.cols.map(c => c.name)));
  Object.assign(p, { fid: -1, name: g.name, age: g.age, trade: `Grew up in ${q.place}`, look: g.look, knew: [], mem: [] });
  const c = sim.spawn(p, g.tile, ACT.IDLE);
  c.born = S.tick / DAY_TICKS - g.age * YEAR_DAYS; c.life = stageAt(g.age); c.gap = 0; c.fresh = 0; c.nbr = P.nb;
  seedBody(c); c.bd.sl.rad = +(g.age * .012).toFixed(3);   // a life under this sun
  c.bd.marks = c.bd.marks.filter(m => m.k !== 'flaw');   // born, not printed
  c.mem = [{ d: sim.day, m: `Grew up in ${q.place}.` }, { d: sim.day, m: 'Chose to stay with the colony.' }];
  N.g = N.g.filter(x => x !== g); q.joined++; q.trust = clamp(q.trust - 2, -100, 100); S.stats.joined = (S.stats.joined || 0) + 1;
  sim.log(`${c.name} from ${q.place} has joined the colony.`, 'good', { e: 'joined', lvl: 1, who: c.id, title: `${c.name} stays` });
  if (S.crewPlan) planCrews(sim, 'joined'); else if (S.autoCrews) autoCrew(sim, c);
  S.rv++;
  return { ok: true };
}

// ---------- for the page ----------
export function nbUI(sim) {
  const S = sim.S, N = S.nb; if (!N) return null;
  const P = N.party;
  return {
    list: N.list.filter(q => q.met).map(q => { const K = KINDS[q.k], i = N.list.indexOf(q); return { i, place: q.place, folk: q.folk, dir: DIRS[q.dir], km: q.km, pop: q.pop, trust: Math.round(q.trust), word: trustWord(q.trust), visits: q.visits, trades: q.trades, joined: q.joined, last: q.last, met: q.met, wants: Object.entries(wantsOf(sim, i)).filter(([, v]) => v >= 1.3).sort((a, b) => b[1] - a[1]).map(([k]) => k), hungry: hungry(sim, q), raids: q.raids || 0, offers: Object.keys(K.offers), fair: K.fair, taught: q.taught.length, left: lessons(sim, i).length }; }),
    party: P && { i: P.nb, kind: P.kind, st: P.st, seq: P.seq, goods: P.goods, lessons: P.kind === 'trade' ? lessons(sim, P.nb) : [], until: P.until, at: P.at, traded: P.traded,
      ask: P.ask >= 0 ? (N.g.find(g => g.id === P.ask) || {}).name || '' : '',
      people: N.g.map(g => ({ name: g.name, look: g.look, coat: g.coat, lead: g.lead, age: g.age, down: !!g.down, dead: !!g.dead, load: Math.round(g.load || 0) })), why: P.why || '', mode: P.mode || '', tname: P.tname || '', took: P.took || {}, how: P.how || '', home: P.home || 0, wants: wantsOf(sim, P.nb), fair: KINDS[N.list[P.nb].k].fair, trust: N.list[P.nb].trust },
    have: Object.fromEntries(GOOD_KEYS.map(k => [k, haveOf(sim, k)])),
    guard: S.cols.filter(c => !c.dead && c.grd).map(c => c.id), watch: S.cols.filter(c => !c.dead && c.crew >= 0 && S.crews[c.crew] && !S.crews[c.crew].gone && S.crews[c.crew].work === 'watch').map(c => c.id),
  };
}
// guests' positions for the page, four numbers each, like the colonists'
export function guestSnap(S, out) {
  const g = S.nb ? S.nb.g : [];
  for (let i = 0; i < g.length; i++) { const c = g[i], o = i * 4; out[o] = c.x; out[o + 1] = c.y; out[o + 2] = c.ang; out[o + 3] = (c.out ? ACT.INDOORS : c.act) * 2 + c.moving; }
  return out;
}
// saves from before neighbours
export function migrateNb(sim) { if (!sim.S.nb) sim.S.nb = newNb(sim); if (sim.S.nb.next < sim.day) sim.S.nb.next = sim.day + FIRST[0]; }

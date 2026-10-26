// The colony's simulation: the Seed, its people and crews, the day, and the ground they wear down. It never
// draws anything. The state is plain data (numbers, arrays, two byte arrays), so saving is JSON plus the
// trampled and the surveyed ground, and the same seed always plays out the same way.
// How people spend their days lives in life.js; crews, projects and the fabricator in work.js; the books for
// buildings in build.js.
import { MAP, CH, NCH, DAY_TICKS, YEAR_DAYS, SEASON_DAYS, T, T_COST, HOUR, ACT, hidden } from './consts.js';
import { R, srand, rnd, ri, lcg } from './rng.js';
import { makeArchive, makePerson } from './founders.js';
import { propsIn } from './world.js';
import { think, mindTick, daily, remember } from './life.js';
import { crewThink, seedTick, onArrive, onTimer, command, projectsThink, dropCarry, planCrews, refundOf, THAW_GAP } from './work.js';
import { shelterProject, strength, powerCheck, capOf, byId, stockOf, built, PRECISE, SALVAGE, KIT, CARGO, LANDER_KW, FEED } from './build.js';
import { drawLife, placeLife, newFood, labHour, fieldHour, spoil, cellarShare, mealsInStore, kitchenOnly, patchLeft, inSeason, cropPlan, daysToRipen, foodOf, CROPS, SEED_LAB, verdict, PROC_NAME } from './food.js';
import { newHist, histHour, histDay, histRow } from './history.js';
import { daylight, doyOf, seasonOf, dayWeather, tempAt, untilDeep, DEEP } from './year.js';
import { newBody, migrateBody, danger, woundText } from './body.js';
import { careThink, follow, feedPatients, MED_KIT } from './care.js';
import { illHour, newIll, illUI, ILL, toIsolate } from './illness.js';
import { newHz, hzHour, hzMorning, fireStep, hzUI, FIRE_STEP } from './hazards.js';
import { newDir, dirMorning } from './director.js';
import { traumaUI } from './trauma.js';
import { ctlHour, emergency } from './control.js';
import { agingUI, canReplace } from './aging.js';
import { printedBody, migrateLives, livesDay, minders, newGen, genUI, yearsOf, mindAge } from './lives.js';

export const CREW_NAMES = ['Basalt', 'Kestrel', 'Cedar', 'Drift', 'Ember', 'Fern', 'Gale', 'Heron', 'Iris', 'Juniper', 'Lichen', 'Moss', 'Nettle', 'Onyx', 'Pike', 'Quartz', 'Rowan', 'Sedge', 'Thistle', 'Umber', 'Vetch', 'Willow', 'Yarrow', 'Zinc', 'Alder', 'Bramble', 'Cobalt', 'Dune', 'Flint', 'Garnet', 'Hazel', 'Ivy', 'Jasper', 'Kelp', 'Larch', 'Marl'];
export const STAKES = 10, FOOD_DAYS = 40, FIRST_BODIES = 6;
const SOURCE_R = 70;   // how far from the Seed people go for stone and timber

export class Sim {
  constructor(W, P) {
    this.W = W; this.P = P;
    this.wear = new Uint8Array(MAP * MAP); this.dirty = new Set();     // trodden ground, and chunks changed since the last report
    this.known = new Uint8Array(MAP * MAP); this.kdirty = new Set();   // what the Seed's sensors and its people have seen
    this.grid = new Int32Array((MAP / 2) * (MAP / 2)).fill(-1); this.next = null;
    const L = W.land, site = W.site, ring = [];
    if (!W.cost0) W.cost0 = W.cost.slice();   // the ground as it was at landfall, before anything was built on it
    if (!W.gone) W.gone = new Map();
    // the camp: everyone walking back from far away follows this field down to the lander and the fire
    for (let y = L.y - 7; y <= L.y + 7; y++) for (let x = L.x - 7; x <= L.x + 7; x++) { const i = y * MAP + x; if (W.cost0[i] && W.reach[i]) ring.push(i); }
    this.ring = ring; this.home = P.field('home', ring);
    this.spots = this.shelterSpots(site.shelter); this.spotCache = new Map();
    this.cargoTile = site.cargo.y * MAP + site.cargo.x; this.doorTile = site.shelter.door.y * MAP + site.shelter.door.x; this.yardTile = site.yard.pick.y * MAP + site.yard.pick.x;
    this.gnew = []; this.qnew = []; this.tnew = []; this.ptile = null;
    this.sourcesNear();
    // the life this world has, and where it grows
    this.kinds = drawLife(W.seed); this.life = placeLife(W, this.kinds);
    const F = site.fire, dx = Math.sign(L.x - F.x) || 1, dy = Math.sign(L.y - F.y);
    // the kitchen by the fire: where the cooking is done, and where the vats stand
    this.cookTile = this.freeNear(F.x - dy * 1.6, F.y + dx * 1.6); this.vatTile = this.freeNear(F.x + dy * 2.6, F.y - dx * 2.6);
    this.dawn = 5.6; this.dusk = 19.3;
  }
  freeNear(x, y) {
    const W = this.W;
    for (let r = 0; r < 6; r += .5) for (let a = 0; a < 6.28; a += .5) { const t = Math.floor(y + Math.sin(a) * r) * MAP + Math.floor(x + Math.cos(a) * r); if (W.cost[t] && W.reach[t] && W.type[t] !== T.SHALLOW) return t; }
    return Math.floor(y) * MAP + Math.floor(x);
  }
  // every tree, boulder and rock face within reach of camp, nearest to the yard first
  sourcesNear() {
    const W = this.W, L = W.land, Y = W.site.yard.pick, g = W.gone, trees = [], rocks = [], scrub = [];
    W.gone = null;
    const x0 = L.x - SOURCE_R, y0 = L.y - SOURCE_R, x1 = L.x + SOURCE_R, y1 = L.y + SOURCE_R;
    const ok = t => W.cost0[t] && W.reach[t], d = t => Math.hypot(t % MAP - Y.x, (t / MAP | 0) - Y.y);
    for (const q of propsIn(W, x0, y0, x1, y1)) {
      const t = Math.floor(q.y) * MAP + Math.floor(q.x);
      if (q.k === 'tree' && ok(t)) trees.push({ src: t, work: t, kind: 0, d: d(t) });
      else if (q.k === 'boulder' && ok(t)) rocks.push({ src: t, work: t, kind: 1, d: d(t) });
      else if (q.k === 'bush' && ok(t)) scrub.push({ src: t, work: t, kind: 3, d: d(t) });
    }
    W.gone = g;
    for (let y = Math.max(1, y0); y < Math.min(MAP - 1, y1); y++) for (let x = Math.max(1, x0); x < Math.min(MAP - 1, x1); x++) {
      const t = y * MAP + x; if (W.type[t] !== T.ROCK) continue;
      for (const n of [t - 1, t + 1, t - MAP, t + MAP]) if (ok(n) && W.type[n] !== T.SHALLOW) { rocks.push({ src: t, work: n, kind: 2, d: d(t) }); break; }
    }
    const by = (a, b) => a.d - b.d || a.src - b.src;
    this.trees = trees.sort(by); this.rocks = rocks.sort(by); this.scrub = scrub.sort(by);
  }

  // ---------- a new landing ----------
  // 'landfall' is the real start: the Seed alone with its archive. 'stress' wakes a crowd at once to measure the engine.
  newGame(mode = 'landfall', count = 300, season = 0) {
    const W = this.W, L = W.land; srand(W.seed * 7919 + 17);
    this.S = {
      v: 7, mode, seed: W.seed, wv: W.wv, y0: (season | 0) % 4 * SEASON_DAYS, site: { x: L.x, y: L.y, id: W.siteId ?? 0 }, tick: Math.round(6 * HOUR),
      cols: [], crews: [], archive: makeArchive(W.seed), autoCrews: true, crewPlan: mode === 'landfall', shift: 1,
      seedc: { feed: mode === 'stress' ? 0 : FIRST_BODIES, queue: [], printing: null, stakes: STAKES },
      projects: [shelterProject(W)], pid: 1, blueprints: [], fab: { job: null }, power: { supply: LANDER_KW, draw: 0 },
      stores: { yard: { stone: 0, timber: 0, biomass: 0, salvage: SALVAGE, ore: 0 }, cargo: { module: CARGO, ...KIT } },
      mat: { stone: { tested: false, f: strength(W.seed, 'stone') }, timber: { tested: false, f: strength(W.seed, 'timber') } }, gone: {}, quarry: {},
      stakes: [], food: mode === 'stress' ? 1e9 : FOOD_DAYS * FIRST_BODIES,
      log: [], logN: 0, chunkLast: new Array(NCH * NCH).fill(0), rr: 0, walked: 0, knownN: 0, rv: 1,
      stats: { breakdowns: 0, accidents: 0, fits: 0, trips: 0, darkReturns: 0, friends: 0, rivals: 0, deaths: 0, felled: 0, quarried: 0, made: 0, harvests: 0, meals: 0, cold: 0, fires: 0 },
      F: newFood(this.kinds.length), gen: newGen(), hist: newHist(), med: { ...MED_KIT }, care: { triage: 'worst', medics: 0, iso: false }, ill: newIll(), hz: newHz(), dir: newDir(), ctl: -1,
    };
    this.S.F.sun = sunFactor(season); this.S.F.seasonSaid = season; this.S.F.temp = tempAt(W.seed, this.cal, 6);
    if (season === DEEP) { this.S.F.snow = .55; this.S.F.ice = .35; }   // landing into a winter already under way
    this.resetGround();
    this.wear.fill(0); this.dirty.clear(); this.known.fill(0); this.kdirty.clear(); this.used = new Set(); this.seats = new Set();
    this.reveal(L.x, L.y, 30);   // the lander's own instruments
    if (mode === 'stress') {
      const r = lcg(W.seed * 13 + 5), names = new Set(), nCrews = Math.max(1, Math.round(count / 10));
      for (let k = 0; k < nCrews; k++) this.S.crews.push(this.newCrew('survey'));
      for (let i = 0; i < count; i++) {
        const p = makePerson(r, 1000 + i, names), c = this.spawn(p, -1, ACT.BED);
        c.fresh = 0; this.addTo(c, i % nCrews);
      }
      this.log(`${count} colonists woke at once for the stress test.`);
    } else this.log('The Seed came down. Its archive holds 40 founders and the fabricator has feedstock for six bodies.');
    return this.S;
  }
  newCrew(work = 'rest') {
    const S = this.S, k = S.crews.length;
    return { id: k, name: CREW_NAMES[k % CREW_NAMES.length] + (k >= CREW_NAMES.length ? ' ' + (1 + (k / CREW_NAMES.length | 0)) : ''), gone: false, lead: -1, members: [], work, shift: S.shift ?? 1, rules: { dark: true, pairs: true, rest: true }, target: -1, dest: -1, wait: ri(0, 200), siteLeft: 0, recalled: false, trips: 0, proj: -1 };
  }
  addTo(c, k) {
    const S = this.S;
    if (c.crew >= 0) { const o = S.crews[c.crew]; o.members = o.members.filter(i => i !== c.id); if (o.lead === c.id) o.lead = bestLead(S, o); }
    if (c.job !== 'wake') { dropCarry(this, c); c.plan = ''; c.job = ''; c.noWork = 0; }
    c.crew = k;
    if (k >= 0) { const cr = S.crews[k]; cr.members.push(c.id); if (cr.lead < 0) cr.lead = c.id; }
    S.rv++;
  }
  // a person from the archive (or the stress test) gets a body; tile -1 means their own bedroll
  spawn(p, tile, act) {
    const S = this.S, id = S.cols.length, slot = this.restSlot(), t = tile < 0 ? slot : tile, has = k => p.traits.includes(k);
    const c = {
      id, fid: p.fid, name: p.name, look: p.look, age: p.age, trade: p.trade, skills: { ...p.skills }, traits: p.traits.slice(), mem: p.mem.map(m => ({ d: 0, m })), ties: {},
      x: t % MAP + .5, y: (t / MAP | 0) + .5, ang: rnd() * 6.283, spd: .125 + rnd() * .02, tile: t, act, moving: 0,
      mv: 0, wps: [], wi: 0, leg: [], li: 0, goal: -1, then: ACT.IDLE, wait: 0, stuck: 0, timer: 0,
      crew: -1, plan: '', job: '', carry: '', cn: 0, want: '', pj: -1, src: -1, srcKind: 0, srcKey: '', make: '', ws: -1, fx: 0, fy: 0, noWork: 0,
      home: -1, mess: -1, ward: -1, where: -1, spot: -1, slot, seat: this.seat(),
      fat: 18, str: 8, tru: Math.round(60 + (has('stubborn') ? -8 : 0) + (has('cheerful') ? 5 : 0) + (has('anxious') ? -3 : 0) + (rnd() - .5) * 12), hp: 100,
      fresh: 10 * DAY_TICKS, hurt: 0, alone: 0, worked: 0, dark: 0, ate: 0, hungry: false, dead: false, escort: 0, outside: 0, bed: 21.3 + rnd() * .9,
      chill: 0, tox: 0, lack: 0, ds: 0, dl: 0, unwell: false, meal: '', food: '', from: '', next: '', vat: 0,
      bd: newBody(), cap: null, down: false, care: null, carried: -1, aidBy: -1, medBy: -1, bday: this.day, iso: false, fight: -1, tr: [], ctl: false, ord: null,
    };
    printedBody(this, c);
    for (const k of p.knew || []) { const o = S.cols.find(q => q.fid === k.fid); if (o) { const a = k.k === 'friend' ? 50 : -50; c.ties[o.id] = { f: 60, a, k: k.k }; o.ties[id] = { f: 60, a, k: k.k }; } }
    S.cols.push(c); S.rv++;
    return c;
  }
  // ev says what kind of news it is for the page: e (the kind), lvl (0 the log only, 1 a card, 2 a letter that
  // pauses the game), title, and where to look: who (a person), pid (a project) or x, y
  log(m, k = '', ev) { const S = this.S; S.logN++; S.log.push(ev ? { n: S.logN, t: S.tick, m, k, ...ev } : { n: S.logN, t: S.tick, m, k }); if (S.log.length > 300) S.log.shift(); }

  // bedrolls in rings around the lander, clear of the shelter's plot, the fire and the cargo door
  restSlot() {
    const W = this.W, L = W.land, F = W.site.fire, C = W.site.cargo;
    for (let r = 5; r < 60; r += .5) {
      const n = Math.floor(r * 4.2);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * 6.2832 + r * .7, x = Math.floor(L.x + Math.cos(a) * r), y = Math.floor(L.y + Math.sin(a) * r), t = y * MAP + x;
        if (this.used.has(t) || !W.reach[t] || !W.cost[t] || W.type[t] === T.SHALLOW || W.type[t] === T.MARSH) continue;
        if (Math.hypot(x + .5 - F.x, y + .5 - F.y) < 4.5 || Math.hypot(x - C.x, y - C.y) < 2.5 || this.nearPlot(x, y, 1.5) || !this.W.cost[t]) continue;
        this.used.add(t); return t;
      }
    }
    return W.site.shelter.door.y * MAP + W.site.shelter.door.x;
  }
  // a place by the fire for the evening meal
  seat() {
    const W = this.W, F = W.site.fire;
    for (let r = 2.2; r < 30; r += .6) {
      const n = Math.floor(r * 4.2);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * 6.2832 + r, x = Math.floor(F.x + Math.cos(a) * r), y = Math.floor(F.y + Math.sin(a) * r), t = y * MAP + x;
        if (this.seats.has(t) || !W.reach[t] || !W.cost[t] || W.type[t] === T.SHALLOW || this.nearPlot(x, y, .5)) continue;
        this.seats.add(t); return t;
      }
    }
    return Math.floor(F.y) * MAP + Math.floor(F.x);
  }
  // on (or within m tiles of) the yard or a building's plot
  nearPlot(x, y, m) {
    const In = r => x >= r.x - m && x < r.x + r.w + m && y >= r.y - m && y < r.y + r.h + m;
    if (In(this.W.site.shelter) || In(this.W.site.yard)) return true;
    for (const p of this.S.projects) if (!p.gone && p.type !== 'test' && (p.below ? p.door && In({ x: p.door.x, y: p.door.y, w: 1, h: 1 }) : In(p))) return true;
    return false;
  }
  // where builders stand to work on a project: around its edge, or around the test rig
  spotsOf(p) {
    if (p.type === 'shelter') return this.spots;
    if (p.below) return [this.doorOf(p)];   // a room below ground is worked from its stairs
    const key = p.id * 2 + (p.blocked ? 1 : 0); let s = this.spotCache.get(key);
    if (s) return s;
    const W = this.W, ok = t => W.cost[t] && W.reach[t]; s = [];
    if (p.type === 'test') { for (let y = p.y - 1; y <= p.y + 1; y++) for (let x = p.x - 1; x <= p.x + 1; x++) if ((x !== p.x || y !== p.y) && ok(y * MAP + x)) s.push(y * MAP + x); }
    else for (let y = p.y - 1; y <= p.y + p.h; y++) for (let x = p.x - 1; x <= p.x + p.w; x++) if ((x === p.x - 1 || y === p.y - 1 || x === p.x + p.w || y === p.y + p.h) && ok(y * MAP + x)) s.push(y * MAP + x);
    if (!s.length) s.push(p.door ? p.door.y * MAP + p.door.x : this.yardTile);
    this.spotCache.set(key, s); return s;
  }
  // where to stand to reach a building: its door, or for an open plot (a field, a solar field) the middle of its near edge
  doorOf(p) { return p.type === 'shelter' ? this.doorTile : p.door ? p.door.y * MAP + p.door.x : Math.min(MAP - 1, p.y + p.h) * MAP + p.x + (p.w >> 1); }

  // ---------- the ground a building stands on ----------
  // once foundations start, a plot can't be walked across: the paths around it are searched again
  block(p) { if (p.below) return; p.blocked = true; this.reground(p); }
  unblock(p) { p.blocked = false; this.reground(p); }
  reground(p) {
    const W = this.W, S = this.S, on = p.blocked;
    for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) { const t = y * MAP + x; W.cost[t] = on ? 0 : W.cost0[t]; }
    this.P.update(p.x, p.y, p.x + p.w - 1, p.y + p.h - 1); this.home = this.P.field('home', this.ring);
    if (!on) return;
    const inR = (t, m) => { const x = t % MAP, y = t / MAP | 0; return x >= p.x - m && x < p.x + p.w + m && y >= p.y - m && y < p.y + p.h + m; }, spots = this.spotsOf(p);
    for (const c of S.cols) {
      if (c.dead) continue;
      if (inR(c.tile, 0)) {   // standing on the plot: step off it
        let best = spots[0], bd = 1e9; for (const t of spots) { const d = Math.hypot(t % MAP + .5 - c.x, (t / MAP | 0) + .5 - c.y); if (d < bd) { bd = d; best = t; } }
        c.x = best % MAP + .5; c.y = (best / MAP | 0) + .5; c.tile = best; c.leg = []; c.li = 0;
      }
      if (c.mv === 1) { const r = this.P.route(c.tile, c.goal); c.wps = r && r.length ? r : [c.goal]; c.wi = 0; c.leg = []; c.li = 0; }
      if (inR(c.slot, 1)) { this.used.delete(c.slot); c.slot = this.restSlot(); }
      if (inR(c.seat, 1)) { this.seats.delete(c.seat); c.seat = this.seat(); }
    }
  }
  // the ground as landfall left it, with every fenced-off plot of this colony on it (after loading a save)
  resetGround() {
    const W = this.W, C = W.cost, want = W.cost0.slice(), dirty = new Set();
    for (const p of this.S.projects) if (!p.gone && p.blocked && p.type !== 'shelter') for (let y = p.y; y < p.y + p.h; y++) want.fill(0, y * MAP + p.x, y * MAP + p.x + p.w);
    for (let i = 0; i < C.length; i++) if (C[i] !== want[i]) dirty.add(((i / MAP | 0) / CH | 0) * NCH + ((i % MAP) / CH | 0));
    if (dirty.size) { C.set(want); this.P.build(dirty); this.P.fields.clear(); this.home = this.P.field('home', this.ring); }
    this.spotCache.clear();
    W.gone.clear(); for (const k in this.S.gone) W.gone.set(+k, this.S.gone[k]);
  }
  // a tree felled (n logs still lying there), a boulder quarried away, a bush cleared
  setGone(t, n) { this.S.gone[t] = n; this.W.gone.set(t, n); this.gnew.push(t, n); }
  propBack(t) { delete this.S.gone[t]; this.W.gone.delete(t); this.gnew.push(t, -1); }   // -1 tells the page it is back
  setQuarry(t, n) { this.S.quarry[t] = n; this.qnew.push(t, n); }
  // the patch of local life growing on a tile, or -1
  patchAt(t) {
    if (!this.ptile) { this.ptile = new Map(); this.life.list.forEach((p, i) => this.ptile.set(Math.floor(p.y) * MAP + Math.floor(p.x), i)); }
    return this.ptile.has(t) ? this.ptile.get(t) : -1;
  }
  // burnt ground: scorched until it grows back (the world itself is made fresh from its seed on loading)
  scorchGround() { const W = this.W; for (const [t] of this.S.hz.scorch) W.type[t] = T.SCORCH; }
  shelterSpots(s) {
    const out = [];
    for (let y = s.y - 1; y <= s.y + s.h; y++) for (let x = s.x - 1; x <= s.x + s.w; x++) { const t = y * MAP + x; if (this.W.cost[t] && this.W.reach[t] && (x === s.x - 1 || y === s.y - 1 || x === s.x + s.w || y === s.y + s.h)) out.push(t); }
    return out;
  }

  // ---------- time ----------
  get hour() { return (this.S.tick % DAY_TICKS) / HOUR; }
  get day() { return Math.floor(this.S.tick / DAY_TICKS) + 1; }
  // the day of the calendar: the landing can come in any season, so the year runs ahead of the days since landing
  get cal() { return this.day + (this.S.y0 || 0); }
  clock() { const d = this.cal, h = this.hour; return { day: ((d - 1) % YEAR_DAYS) + 1, year: Math.floor((d - 1) / YEAR_DAYS) + 1, season: Math.floor(((d - 1) % YEAR_DAYS) / SEASON_DAYS), hour: h, tick: this.S.tick, abs: this.day, cal: d }; }

  // ---------- one tick ----------
  tick() {
    const S = this.S, cols = S.cols;
    S.tick++;
    seedTick(this);
    for (const cr of S.crews) crewThink(this, cr);
    if (S.tick % 120 === 0 && S.mode === 'landfall') projectsThink(this);
    for (let i = S.tick % 30; i < cols.length; i += 30) { mindTick(this, cols[i]); think(this, cols[i]); }
    if (S.tick % 60 === 0 && S.mode === 'landfall') careThink(this);
    if (S.tick % FIRE_STEP === 0 && S.mode === 'landfall') fireStep(this);
    for (let i = 0; i < cols.length; i++) this.move(cols[i]);
    for (let i = 0; i < cols.length; i++) if (cols[i].carried >= 0) follow(this, cols[i]);
    this.separate();
    this.groundTick();
    if (S.tick % HOUR === 0) this.hourly();
    if (S.tick % DAY_TICKS === Math.round(4 * HOUR)) { for (const c of cols) daily(this, c); if (S.mode === 'landfall') { livesDay(this); spoil(this); if (S.crewPlan) planCrews(this, 'morning'); minders(this); } }
  }
  // ---------- the hour: light, temperature, snow and ice, crops, the Seed's analyser, the seasons ----------
  hourly() {
    const S = this.S, F = S.F, d = this.day, h = Math.round(this.hour) % 24, doy = doyOf(this.cal), wx = dayWeather(this.W.seed, this.cal), t = tempAt(this.W.seed, this.cal, h);
    const dl = daylight(doy + h / 24); this.dawn = dl.dawn; this.dusk = dl.dusk;
    F.temp = t;
    if (t < 1 && wx.snow) F.snow = Math.min(1, F.snow + wx.snow * .045); else if (t > 1.5) F.snow = Math.max(0, F.snow - (t - 1.5) * .007 - wx.rain * .02);
    if (t < -3) F.ice = Math.min(1, F.ice + (-3 - t) * .0025); else if (t > 0) F.ice = Math.max(0, F.ice - t * .004);
    if (h === 0 && d > 1) histDay(this, d - 1);
    histHour(this, t);
    if (S.mode !== 'landfall') return;
    for (const p of built(S)) if (p.type === 'field' && p.crop) fieldHour(this, p, t, h);
    labHour(this, SEED_LAB);
    illHour(this);
    hzHour(this);
    ctlHour(this);
    if (h === 18) feedPatients(this);
    if (h === 6) this.morning(d, doy, wx);
  }
  // each morning: a new season, the warning before Deep cold, and bad weather
  morning(d, doy, wx) {
    const S = this.S, F = S.F, s = seasonOf(doy);
    hzMorning(this);
    dirMorning(this);
    if (F.seasonSaid !== s && doy % 20 === 0) {
      F.seasonSaid = s; F.sun = sunFactor(s); for (const p of powerCheck(this)) if (p.type !== 'solar') this.log(p.powered ? `${p.name} has power again.` : `${p.name} went dark: the solar panels make less now.`, p.powered ? 'good' : 'bad', p.powered ? { pid: p.id } : { e: 'dark', lvl: 1, pid: p.id, title: 'Not enough power' });
      if (d > 1) this.log(SEASON_TEXT[s] + (s === DEEP ? ` ${this.foodNote()}` : ''), s === DEEP ? 'bad' : '', { e: 'season' + s, lvl: 2, title: SEASON_TITLE[s] });
    }
    if (doy === 52 && F.warned !== d) { F.warned = d; this.log(`Deep cold starts in eight days and lasts twenty. Nothing grows then, and work outside gets hard and dangerous. ${this.foodNote()}${this.fieldNote()}`, 'bad', { e: 'deepwarn', lvl: 2, title: 'Deep cold is coming' }); }
    if (wx.out || wx.snap) this.log(wx.k === 'blizzard' ? 'A blizzard today. Nobody can work outside: the crews stay in camp.' : wx.k === 'storm' ? 'A storm today: high wind and lightning. Work outside is risky, and the survey crews stay in camp.' : 'A cold snap: far colder than usual for the next few days.', 'bad', { e: wx.out ? wx.k : 'snap', lvl: 1, title: wx.out ? WX_TITLE[wx.k] : 'A cold snap' });
  }
  // how long the food would last, in plain words
  foodNote() {
    const n = mealsInStore(this, true), all = mealsInStore(this), eaters = this.S.cols.filter(c => !c.dead).length || 1, days = Math.floor(n / eaters), deep = untilDeep(this.cal) + 20 + THAW_GAP;
    const locked = Math.floor((all - n) / eaters);
    return `The colony has food for about ${days} day${days === 1 ? '' : 's'} at ${eaters} meal${eaters === 1 ? '' : 's'} a day${days < deep ? `, and it needs about ${deep} to see the cold through and the thaw after it, until the first crops ripen` : ', enough to see the cold and the thaw through'}.${locked > 0 ? ` Another ${locked} day${locked === 1 ? '' : 's'} of it is raw food only a kitchen crew can make safe.` : ''}`;
  }
  fieldNote() {
    const late = built(this.S).filter(p => p.type === 'field' && p.crop && p.crop.st === 'grow' && daysToRipen(this, p.crop.k, p.crop.g) === Infinity);
    return late.length ? ` The crops in ${late.map(p => p.name).join(' and ')} won't ripen before the frost.` : '';
  }

  // ---------- walking ----------
  // send someone to a tile: `then` is what they do there, `walkAct` how they look on the way
  goTo(c, tile, then, walkAct = ACT.WALK) {
    c.goal = tile; c.then = then; c.act = walkAct; c.stuck = 0; c.timer = 0;
    if (tile === c.tile) { this.arrived(c); return; }
    if (this.home[c.tile] > 400 && this.home[tile] < 150) { c.mv = 2; c.leg = []; c.li = 0; if (walkAct === ACT.WALK) c.act = ACT.HOME; return; }
    const r = this.P.route(c.tile, tile);
    if (!r) { this.arrived(c); return; }   // no way there: do it where they stand
    c.wps = r.length ? r : [tile]; c.wi = 0; c.leg = []; c.li = 0; c.mv = 1;
  }
  arrived(c) { c.mv = 0; c.wps = []; c.leg = []; c.li = 0; c.wi = 0; c.act = c.then; onArrive(this, c); }
  move(c) {
    c.moving = 0;
    if (c.dead) return;
    if (c.wait > 0) { c.wait--; return; }
    if (c.mv === 1) {
      if (c.li >= c.leg.length) {
        if (c.wi >= c.wps.length) { this.arrived(c); return; }
        const leg = this.P.leg(c.tile, c.wps[c.wi]);
        if (!leg) { const r = this.P.route(c.tile, c.goal); if (!r) { this.arrived(c); return; } c.wps = r.length ? r : [c.goal]; c.wi = 0; c.leg = []; c.li = 0; c.wait = 10; return; }
        c.leg = leg; c.li = 0; c.wi++;
        this.skipAhead(c);
      }
      if (c.li < c.leg.length) {
        const t = c.leg[c.li], last = c.li === c.leg.length - 1 && c.wi >= c.wps.length;
        // someone standing on the spot, or a crowd: after a few seconds, take the next tile instead
        if (this.walk(c, t % MAP + .5, (t / MAP | 0) + .5, last) || ++c.stuck > 90) { c.li++; c.stuck = 0; this.skipAhead(c); }
      }
    } else if (c.mv === 2) {
      if (this.home[c.tile] < 140 || ++c.stuck > 300) { c.stuck = 0; const r = this.P.route(c.tile, c.goal); c.mv = 1; c.wps = r && r.length ? r : [c.goal]; c.wi = 0; c.leg = []; c.li = 0; return; }
      const t = this.P.downhill(this.home, c.tile);
      if (t < 0) { c.mv = 1; c.wps = [c.goal]; c.wi = 0; c.leg = []; c.li = 0; return; }
      this.walk(c, t % MAP + .5, (t / MAP | 0) + .5);
    } else {
      if (c.timer > 0 && --c.timer === 0) { onTimer(this, c); return; }
      const a = c.act;
      if (a === ACT.SURVEY || a === ACT.IDLE || a === ACT.PLAY || a === ACT.MIND) {
        // a little pottering about; children never stand still for long
        if (rnd() < .004) c.ang += (rnd() - .5) * 2;
        if (rnd() < (a === ACT.PLAY ? .006 : a === ACT.SURVEY ? .002 : .0008)) { const x = Math.floor(c.x + (rnd() - .5) * 4), y = Math.floor(c.y + (rnd() - .5) * 4), t = y * MAP + x; if (x > 0 && y > 0 && x < MAP && y < MAP && this.W.reach[t] && this.W.cost[t]) { c.leg = [t]; c.li = 0; } }
        if (c.li < c.leg.length) { const t = c.leg[c.li]; if (this.walk(c, t % MAP + .5, (t / MAP | 0) + .5)) c.li++; }
      } else if (a === ACT.BUILD || a === ACT.TEST || a === ACT.QUARRY || a === ACT.FELL || a === ACT.GATHER || a === ACT.FARM || a === ACT.SAMPLE) this.face(c, c.fx, c.fy); else if (a === ACT.EAT || a === ACT.COOK) {
        const F = this.W.site.fire; this.face(c, F.x, F.y);
      }
    }
  }
  face(c, x, y) { const a = Math.atan2(y - c.y, x - c.x); let d = a - c.ang; while (d > Math.PI) d -= 6.2832; while (d < -Math.PI) d += 6.2832; c.ang += d * .1; }
  // steps toward a point; true once there
  walk(c, tx, ty, last) {
    const W = this.W, dx = tx - c.x, dy = ty - c.y, d = Math.hypot(dx, dy);
    let sp = c.spd * 10 / (W.cost[c.tile] || 10);
    if (c.fat > 75) sp *= .85; if (c.cap) sp *= .25 + .75 * c.cap.move; if (c.fresh > 0) sp *= .88; if (c.act === ACT.CARRY) sp *= .85; else if (c.act === ACT.DRAG) sp *= .55;
    c.moving = 1;
    if (d > 1e-4) { const a = Math.atan2(dy, dx); let da = a - c.ang; while (da > Math.PI) da -= 6.2832; while (da < -Math.PI) da += 6.2832; c.ang += da * .35; }
    if (d <= sp) { c.x = tx; c.y = ty; this.enter(c); return true; }
    if (!last && d < .45) return true;   // passing through: close enough
    c.x += dx / d * sp; c.y += dy / d * sp; this.enter(c); return false;
  }
  enter(c) {
    const t = Math.floor(c.y) * MAP + Math.floor(c.x);
    if (t === c.tile) return;
    c.tile = t; c.stuck = 0;
    const ty = this.W.type[t];
    if (ty === T.MEADOW || ty === T.FOREST || ty === T.MARSH || ty === T.SAND || ty === T.SCORCH || ty === T.DIRT) {
      const w = this.wear[t]; if (w < 250) { this.wear[t] = Math.min(250, w + 3); if ((w >> 4) !== (this.wear[t] >> 4)) this.dirty.add(((t / MAP | 0) / CH | 0) * NCH + ((t % MAP) / CH | 0)); }
    }
  }
  // cut corners when the way is clear: look a few tiles ahead along the leg
  skipAhead(c) {
    for (let k = Math.min(c.leg.length - 1, c.li + 3); k > c.li; k--) {
      const t = c.leg[k];
      if (this.clear(c.x, c.y, t % MAP + .5, (t / MAP | 0) + .5)) { c.li = k; return; }
    }
  }
  clear(x0, y0, x1, y1) {
    const C = this.W.cost, d = Math.hypot(x1 - x0, y1 - y0), n = Math.ceil(d / .25), base = C[Math.floor(y0) * MAP + Math.floor(x0)];
    for (let i = 1; i <= n; i++) {
      const x = x0 + (x1 - x0) * i / n, y = y0 + (y1 - y0) * i / n;
      for (const [ox, oy] of [[.3, .3], [-.3, .3], [.3, -.3], [-.3, -.3]]) { const c = C[Math.floor(y + oy) * MAP + Math.floor(x + ox)]; if (!c || c > base + 4) return false; }
    }
    return true;
  }
  // people step aside for each other; the sleeping, the seated and the busy hold their place
  separate() {
    const cols = this.S.cols, n = cols.length, G = this.grid, GW = MAP / 2;
    if (!this.next || this.next.length < n) this.next = new Int32Array(n);
    const nx = this.next, cells = [], still = a => a === ACT.BED || a === ACT.EAT || a === ACT.WAKE || a === ACT.ALONE || a === ACT.BUILD || a === ACT.PLANT || a === ACT.QUARRY || a === ACT.FELL || a === ACT.TEST || a === ACT.GATHER || a === ACT.FARM || a === ACT.COOK || a === ACT.SAMPLE;
    for (let i = 0; i < n; i++) { const c = cols[i]; nx[i] = -2; if (c.dead || hidden(c.act)) continue; const g = (c.y / 2 | 0) * GW + (c.x / 2 | 0); nx[i] = G[g]; if (G[g] < 0) cells.push(g); G[g] = i; }
    const C = this.W.cost;
    for (let i = 0; i < n; i++) {
      if (nx[i] === -2) continue;
      const a = cols[i], gx = a.x / 2 | 0, gy = a.y / 2 | 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const x = gx + ox, y = gy + oy; if (x < 0 || y < 0 || x >= GW || y >= GW) continue;
        for (let j = G[y * GW + x]; j >= 0; j = nx[j]) {
          if (j <= i) continue;
          const b = cols[j], dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
          if (d2 > .3 || d2 < 1e-8) continue;
          const d = Math.sqrt(d2), push = (.55 - d) * .25 / d;
          if (a.act === ACT.BED || b.act === ACT.BED) continue;   // walkers step over the sleeping
          const am = still(a.act) && !a.moving ? 0 : 1, bm = still(b.act) && !b.moving ? 0 : 1; if (!am && !bm) continue;
          const ax = a.x - dx * push * am, ay = a.y - dy * push * am, bx = b.x + dx * push * bm, by = b.y + dy * push * bm;
          if (C[Math.floor(ay) * MAP + Math.floor(ax)]) { a.x = ax; a.y = ay; }
          if (C[Math.floor(by) * MAP + Math.floor(bx)]) { b.x = bx; b.y = by; }
        }
      }
    }
    for (const g of cells) G[g] = -1;
  }

  // ---------- what the Seed knows: everything its sensors and its people have seen ----------
  reveal(x, y, r) {
    const K = this.known, x0 = Math.max(0, Math.floor(x - r)), x1 = Math.min(MAP - 1, Math.ceil(x + r)), y0 = Math.max(0, Math.floor(y - r)), y1 = Math.min(MAP - 1, Math.ceil(y + r)), r2 = r * r;
    let n = 0;
    for (let ty = y0; ty <= y1; ty++) {
      const dy = ty + .5 - y;
      for (let tx = x0; tx <= x1; tx++) { const dx = tx + .5 - x, i = ty * MAP + tx; if (!K[i] && dx * dx + dy * dy <= r2) { K[i] = 255; n++; } }
    }
    if (n) { this.S.knownN += n; for (let cy = y0 / CH | 0; cy <= (y1 / CH | 0); cy++) for (let cx = x0 / CH | 0; cx <= (x1 / CH | 0); cx++) this.kdirty.add(cy * NCH + cx); }
    return n;
  }

  // ---------- the ground: full detail where people are, a catch-up pass everywhere else ----------
  groundTick() {
    const S = this.S;
    if (S.tick % 30 === 0) {
      const active = new Set();
      for (const c of S.cols) { const cx = (c.x / CH) | 0, cy = (c.y / CH) | 0; active.add(cy * NCH + cx); }
      for (const k of active) this.regrow(k);
    }
    // one far chunk per tick: the whole map is caught up every 361 ticks
    S.rr = (S.rr + 1) % (NCH * NCH); this.regrow(S.rr);
  }
  regrow(k) {
    const S = this.S, steps = Math.floor((S.tick - S.chunkLast[k]) / HOUR);   // grass recovers one step an hour
    if (steps <= 0) return;
    S.chunkLast[k] += steps * HOUR;
    const cx = k % NCH, cy = k / NCH | 0, x1 = Math.min(MAP, cx * CH + CH), y1 = Math.min(MAP, cy * CH + CH), w = this.wear;
    let changed = false;
    for (let y = cy * CH; y < y1; y++) for (let x = cx * CH; x < x1; x++) { const i = y * MAP + x, v = w[i]; if (v) { const nv = Math.max(0, v - steps); if ((nv >> 4) !== (v >> 4)) changed = true; w[i] = nv; } }
    if (changed) this.dirty.add(k);
  }

  // ---------- what the page needs ----------
  snapshot(out) {
    const cols = this.S.cols;
    for (let i = 0; i < cols.length; i++) { const c = cols[i], o = i * 4; out[o] = c.x; out[o + 1] = c.y; out[o + 2] = c.ang; out[o + 3] = (c.dead ? ACT.DEAD : c.act) * 2 + c.moving; }
    return out;
  }
  chunkOf(a, k) {
    const cx = k % NCH, cy = k / NCH | 0, out = new Uint8Array(CH * CH);
    for (let y = 0; y < CH; y++) for (let x = 0; x < CH; x++) { const X = cx * CH + x, Y = cy * CH + y; if (X < MAP && Y < MAP) out[y * CH + x] = a[Y * MAP + X]; }
    return out;
  }
  wearChunk(k) { return this.chunkOf(this.wear, k); }
  knownChunk(k) { return this.chunkOf(this.known, k); }
  roster() {
    const S = this.S;
    return {
      people: S.cols.map(c => ({ id: c.id, name: c.name, look: c.look, age: c.age, trade: c.trade, traits: c.traits, native: !!c.native, gen: c.gen || 0, par: c.par || [] })),
      archive: S.archive.map(p => ({ fid: p.fid, name: p.name, age: p.age, trade: p.trade, skills: p.skills, traits: p.traits, mem: p.mem, knew: p.knew, woke: p.woke ?? null })),
    };
  }
  // the clinic's records: everyone who ever lived here, what their days went on, and what their bodies came to
  recordsUI() {
    const S = this.S;
    return S.cols.map(c => {
      const b = c.bd, wk = c.wk ? Object.entries(c.wk).sort((x, y) => y[1] - x[1]).slice(0, 2).map(([k, d]) => [k, Math.round(d / YEAR_DAYS * 10) / 10]) : [];
      const ch = b.marks.filter(m => m.k === 'chronic' && !m.sub && m.kn).map(m => m.ck);
      return { id: c.id, age: Math.floor(((c.dead && c.dtick != null ? c.dtick : S.tick) / DAY_TICKS - c.born) / YEAR_DAYS), dead: !!c.dead, dday: c.dday || 0, why: c.why || '', wk, ch, hurt: b.marks.filter(m => m.k === 'lost' || m.k === 'crooked' || m.k === 'tight').length, ill: (b.hx || []).length, fam: c.name.split(' ').slice(1).join(' '), gen: c.gen || 0 };
    });
  }
  ui(watch) {
    const S = this.S, sd = S.seedc, sh = S.projects[0];
    const c = watch >= 0 ? S.cols[watch] : null;
    return {
      rv: S.rv, mode: S.mode, logN: S.logN, spots: { cook: this.cookTile, vat: this.vatTile },
      p: S.cols.map(c => [c.act, c.crew, Math.round(c.fat), Math.round(c.str), Math.round(c.tru), Math.round(Math.min(c.hp, 100 - danger(c) * 100)), (c.fresh > 0 ? 1 : 0) | (c.hurt > 0 ? 2 : 0) | (c.alone > 0 ? 4 : 0) | (c.hungry ? 8 : 0) | (c.dead ? 16 : 0) | (c.carry && c.mv ? 32 : 0) | (c.chill > 50 ? 64 : 0) | (c.unwell ? 128 : 0)
        | (c.bd.w.some(w => w.kn && w.bl > .01) ? 256 : 0) | (c.down ? 512 : 0) | (c.plan === 'ward' || c.medBy >= 0 || c.carried >= 0 ? 1024 : 0) | (c.bd.worse && !c.dead ? 2048 : 0) | (c.bd.ill.some(q => q.st === 1 || q.st === 2) ? 4096 : 0) | (c.iso ? 8192 : 0) | (c.bd.ill.some(q => q.st === 2) ? 16384 : 0) | (toIsolate(c) ? 32768 : 0) | (c.life < 3 ? 65536 : 0) | (c.retired ? 131072 : 0) | (c.minding ? 262144 : 0), Math.round(c.chill), Math.round(yearsOf(this, c) * 10) / 10, Math.floor(mindAge(this, c))]),
      crews: S.crews.map(cr => ({ id: cr.id, name: cr.name, gone: cr.gone, lead: cr.lead, members: cr.members, work: cr.work, shift: cr.shift, rules: cr.rules, target: cr.target, dest: cr.dest, recalled: cr.recalled, proj: cr.proj })),
      seed: { feed: sd.feed, fb: sd.fb || 0, stored: S.archive.filter(p => p.woke == null).length, per: FEED.per, queue: sd.queue, printing: sd.printing && { fid: sd.printing.fid, left: sd.printing.left }, stakes: sd.stakes, fab: S.fab.job && { k: S.fab.job.k, left: S.fab.job.left } },
      shelter: { stage: sh.stage, done: sh.done, beds: 12 },
      projects: S.projects.filter(p => !p.gone).map(p => ({ crop: p.crop && { ...p.crop, plan: p.crop.st === 'bare' ? cropPlan(this, p) : null, eta: p.crop.st === 'grow' ? daysToRipen(this, p.crop.k, p.crop.g) : null }, id: p.id, type: p.type, name: p.name, x: p.x, y: p.y, w: p.w, h: p.h, side: p.side, door: p.door, stage: p.stage, need: p.need, got: p.got, done: p.done, powered: p.powered, paused: p.paused, wait: p.wait, stall: p.stall, mat: p.mat, cap: capOf(p), tanks: p.tanks, why: p.why, crews: S.crews.filter(cr => !cr.gone && cr.work === 'build' && cr.proj === p.id).map(cr => cr.name), out: p.out, fire: !!p.fire, burn: p.fire ? +(p.burn || 0).toFixed(2) : 0, shut: p.shut || '', dmg: p.dmg || '', wet: !!p.wetH, below: !!p.below, ug: p.ug && p.ug.name, ore: p.ug ? p.ug.ore : 0, seam: p.seam, rock: p.rock, rock0: p.rock0, back: refundOf(p) })),
      stores: { yard: S.stores.yard, cargo: S.stores.cargo, precise: Object.fromEntries(PRECISE.map(k => [k, stockOf(S, k)])) }, power: S.power, blueprints: S.blueprints,
      mat: { stone: { tested: S.mat.stone.tested, f: S.mat.stone.tested ? S.mat.stone.f : null }, timber: { tested: S.mat.timber.tested, f: S.mat.timber.tested ? S.mat.timber.f : null } },
      med: S.med, care: { triage: S.care.triage, medics: S.care.medics, iso: !!S.care.iso, ward: S.cols.filter(c => !c.dead && c.ward >= 0).map(c => [c.id, c.ward]) }, food: S.food, alive: S.cols.filter(c => !c.dead).length, year: this.yearUI(), F: this.foodUI(), known: S.knownN, stakes: S.stakes, auto: S.autoCrews, plan: !!S.crewPlan, shift: S.shift ?? 1, stats: S.stats, today: histRow(this, this.day), y0: S.y0 || 0, ill: illUI(S), hz: hzUI(S), ctl: S.ctl ?? -1, ord: S.ctl >= 0 && S.cols[S.ctl] ? S.cols[S.ctl].ord : null, emerg: emergency(this), gen: genUI(this),
      detail: c && { id: c.id, meal: c.meal, tox: +c.tox.toFixed(1), lack: c.lack, skills: c.skills, mem: c.mem.slice(-6), tr: traumaUI(c), ties: Object.entries(c.ties).filter(([, t]) => t.k).map(([id, t]) => ({ id: +id, k: t.k, f: Math.round(t.f), a: Math.round(t.a) })), worked: c.worked, fresh: c.fresh, hurt: c.hurt, plan: c.plan, home: c.home >= 0 && byId(S, c.home) ? byId(S, c.home).name : '', carry: c.carry, body: this.bodyUI(c), partner: c.partner, kids: c.kids, par: c.par, gen: c.gen, life: c.life },
    };
  }
  // what the colony knows about someone's body: the medic's view, never the hidden truth
  bodyUI(c) {
    const S = this.S, b = c.bd, kn = b.w.filter(w => w.kn), r2 = v => Math.round(v * 100) / 100;
    const who = id => id >= 0 && S.cols[id] ? S.cols[id].name : '';
    return {
      blood: r2(b.blood), pain: r2(b.pain), shock: r2(b.shock), inf: r2(b.inf), pk: b.pk > 0, abx: b.abx > 0, danger: r2(danger(c)), worse: b.worse,
      caps: c.cap && Object.fromEntries(Object.entries(c.cap).map(([k, v]) => [k, r2(v)])),
      w: kn.map(w => ({ id: w.id, p: w.p, k: w.k, s: r2(w.s), text: woundText(w), heal: r2(w.heal), bl: w.bl > .005, closed: w.closed, set: w.set, inf: w.inf > .3 ? r2(w.inf) : 0, how: w.how, d: w.d })),
      inner: b.w.filter(w => w.ib && w.ikn).map(w => ({ id: w.id, p: w.p, text: woundText(w, true) })),
      unexplained: b.bleed > .01 && !b.w.some(w => (w.kn && w.bl > .005) || (w.ikn && w.ib)),
      marks: b.marks.map((m, i) => ({ ...m, i })).filter(m => m.k !== 'chronic' || m.kn || m.felt), ex: b.ex, by: who(c.medBy) || who(c.aidBy) || who(c.carried), down: c.down, laid: c.plan === 'ward', iso: c.iso, nu: b.nu > 0,
      ill: b.ill.filter(q => q.st >= 1).map(q => { const K = ILL[q.k]; return { name: q.kn ? K.name : '', sym: K.sym, st: q.st, d: q.d1, kn: q.kn, catching: q.kn && !!K.spread, abx: q.kn ? K.abx : null, tried: q.tried }; }),
      hx: b.hx.map(h => ({ name: h.kn || (S.ill.k[h.k] && S.ill.k[h.k].id && S.ill.k[h.k].named) ? ILL[h.k].name : '', sym: ILL[h.k].sym, d: h.d, e: h.e, out: h.out })),
      life: agingUI(this, c), repl: c.dead ? '' : canReplace(this),
      imm: Object.entries(b.imm).filter(([k, v]) => v && S.ill.k[k] && S.ill.k[k].named).map(([k, v]) => ({ name: ILL[k].name, v: Math.round(v * 100) / 100 })),
    };
  }
  yearUI() {
    const d = this.cal, doy = doyOf(d), wx = dayWeather(this.W.seed, d), F = this.S.F;
    return { doy, season: seasonOf(doy), wx: wx.k, snap: wx.snap, temp: +F.temp.toFixed(1), dawn: +this.dawn.toFixed(2), dusk: +this.dusk.toFixed(2), snow: +F.snow.toFixed(2), ice: +F.ice.toFixed(2), deepIn: untilDeep(d), sun: F.sun };
  }
  foodUI() {
    const S = this.S, F = S.F, Ld = F.larder, r1 = o => { const q = {}; for (const k in o) q[k] = Math.round(o[k] * 10) / 10; return q; };
    return {
      cool: +cellarShare(S).toFixed(2),
      life: F.life.map((L, o) => { const k = this.kinds[o]; return L.seen ? { o, name: k.name, seen: k.seen, where: k.where, season: k.season, samples: L.samples, queued: L.queued, tested: L.tested, day: L.day, food: L.tested ? k.food : undefined, bio: L.tested ? k.bio : undefined, result: L.tested ? k.result : undefined, verdict: L.tested ? verdict(k) : undefined, now: inSeason(this, k) } : null; }),
      lab: { queue: F.lab.queue, cur: F.lab.cur, work: +F.lab.work.toFixed(1) },
      raw: r1(Ld.raw), prep: r1(Ld.prep), meals: r1(Ld.meals), vats: F.vats.map(v => ({ src: v.src, n: v.n, left: Math.max(0, v.ready - S.tick), proc: v.proc })),
      names: Object.fromEntries([...new Set([...Object.keys(Ld.raw), ...Object.keys(Ld.prep), ...Object.keys(Ld.meals), ...F.vats.map(v => v.src)])].map(k => [k, (foodOf(this, k) || { name: k }).name])),
      total: Math.round(mealsInStore(this)), usable: Math.round(mealsInStore(this, true)), locked: Math.round(mealsInStore(this) - mealsInStore(this, true)), waiting: Math.round(kitchenOnly(this)), gone: Object.keys(F.patch).filter(i => patchLeft(this, +i) <= 0).map(Number),
    };
  }
  logSince(n) { return this.S.log.filter(e => e.n > n); }
  command(m) { return command(this, m); }

  // ---------- saving ----------
  serialize() {
    return { ...this.S, rng: R.s, wear: rle(this.wear), known: rle(this.known) };
  }
  load(d) {
    const { rng, wear, known, ...S } = d;
    this.S = JSON.parse(JSON.stringify(S)); srand(rng);
    const old = this.S.v === 2;
    if (old) this.migrate2();
    if (this.S.v === 3) this.migrate3();
    if (this.S.v === 4) this.migrate4();
    if (this.S.v === 5) this.migrate5();
    if (this.S.v === 6) this.migrate6();
    this.scorchGround();
    if (!this.S.hist) this.S.hist = newHist();
    if (!this.S.dir) this.S.dir = newDir();
    if (this.S.stores.yard.ore == null) this.S.stores.yard.ore = 0;
    for (const c of this.S.cols) { if (!c.tr) c.tr = []; if (c.ctl == null) { c.ctl = false; c.ord = null; } }
    if (this.S.ctl == null) this.S.ctl = -1;
    if (this.S.crewPlan == null) this.S.crewPlan = !!this.S.autoCrews;   // saves from before the Seed planned crews
    if (this.S.shift == null) this.S.shift = 1;
    migrateLives(this);
    this.resetGround(); this.gnew = []; this.qnew = [];
    if (old) projectsThink(this); // give the migrated crews their project now, not at the next check
    this.wear.set(unrle(wear, MAP * MAP)); this.known.set(unrle(known, MAP * MAP)); this.dirty.clear(); this.kdirty.clear();
    this.used = new Set(this.S.cols.map(c => c.slot)); this.seats = new Set(this.S.cols.map(c => c.seat));
    const dl = daylight(doyOf(this.cal) + this.hour / 24); this.dawn = dl.dawn; this.dusk = dl.dusk;
    for (let k = 0; k < NCH * NCH; k++) { this.dirty.add(k); this.kdirty.add(k); }
    return this.S;
  }
}
// ---------- older saves ----------
// version 2 (milestone 2) had one shelter and a pile of lander modules; it becomes the first project of many
Sim.prototype.migrate2 = function () {
  const S = this.S, W = this.W, sh = S.shelter, p = shelterProject(W, sh.done ? 0 : sh.stage, sh.done ? 0 : sh.fits);
  if (sh.done) { p.done = true; p.stage = 5; p.need = {}; p.got = {}; p.powered = true; }
  S.projects = [p]; S.pid = 1; S.blueprints = []; S.fab = { job: null }; S.power = { supply: LANDER_KW, draw: 0 };
  S.stores = { yard: { stone: 0, timber: 0, salvage: SALVAGE }, cargo: { module: S.seedc.cargo, ...KIT } };
  S.mat = { stone: { tested: false, f: strength(W.seed, 'stone') }, timber: { tested: false, f: strength(W.seed, 'timber') } }; S.gone = {}; S.quarry = {};
  Object.assign(S.stats, { felled: 0, quarried: 0, made: 0 });
  // the Seed sent the shelter crew to rest when the shelter was done; now there is more to build
  for (const cr of S.crews) { if (cr.work === 'shelter' || (sh.done && cr.work === 'rest' && S.autoCrews)) cr.work = 'build'; cr.proj = -1; }
  for (const c of S.cols) {
    const fit = c.job === 'fit', fetch = c.job === 'fetch' || c.job === 'pick';
    Object.assign(c, { carry: c.carry ? 'module' : '', cn: 0, want: fit ? (c.carry ? 'module' : 'mark') : fetch ? 'module' : '', pj: fit || fetch ? 0 : -1, src: -1, srcKind: 0, srcKey: fetch ? 'cargo' : '', make: '', ws: -1, fx: p.x + p.w / 2, fy: p.y + p.h / 2, noWork: 0, home: sh.beds.includes(c.id) ? 0 : -1, mess: -1, ward: -1, where: c.act === ACT.INSIDE ? 0 : -1 });
    if (c.dead) c.act = ACT.DEAD;
  }
  delete S.shelter; delete S.seedc.cargo; S.v = 3;
  powerCheck(this);
};
// version 4 (milestone 4, part 1) had a single "hurt" timer instead of bodies, and no medical supplies
Sim.prototype.migrate4 = function () {
  const S = this.S;
  for (const c of S.cols) { migrateBody(this, c); Object.assign(c, { down: false, care: null, carried: -1, aidBy: -1, medBy: -1 }); if (c.plan === 'ward') c.plan = ''; }
  S.med = { ...MED_KIT }; S.care = { triage: 'worst', medics: 0 }; S.v = 5;
};
// version 3 (milestone 3) had no year, no food but the rations, and no local life
// version 5 (milestone 4, bodies) had no illness: everyone starts healthy, and counts as a seasoned body
Sim.prototype.migrate5 = function () {
  const S = this.S;
  for (const c of S.cols) { Object.assign(c.bd, { ill: [], imm: {}, hx: [], nu: 0 }); c.bday = -99; c.iso = false; }
  S.care.iso = false; S.ill = newIll(); S.v = 6;
};
// version 6 (milestone 4, illness) had no fire or floods
Sim.prototype.migrate6 = function () {
  const S = this.S;
  for (const c of S.cols) c.fight = -1;
  S.hz = newHz(); S.stats.fires = 0; S.v = 7;
};
Sim.prototype.migrate3 = function () {
  const S = this.S;
  S.F = newFood(this.kinds.length); S.F.sun = sunFactor(seasonOf(doyOf(this.day))); S.F.seasonSaid = seasonOf(doyOf(this.day));
  S.stores.yard.biomass = 0; Object.assign(S.stats, { harvests: 0, meals: 0, cold: 0 });
  for (const c of S.cols) Object.assign(c, { chill: 0, tox: 0, lack: 0, ds: 0, dl: 0, unwell: false, meal: '', food: '', from: '', next: '', vat: 0 });
  S.v = 4;
  powerCheck(this);
};
const sunFactor = s => [1, 1.2, .85, .55][s];
const SEASON_TITLE = ['Thaw', 'Long light', 'The storm season', 'Deep cold'];
const WX_TITLE = { storm: 'A storm', blizzard: 'A blizzard' };
const SEASON_TEXT = [
  'Thaw: the ice is going and the ground is softening. Crops can go in once the nights stay above freezing.',
  'Long light: the warm season, with the longest days. The best time for crops, and the solar panels make the most.',
  'The storm season: cooler days, wind and storms. Storms flatten crops and make work outside risky. Bring in what is ripe.',
  'Deep cold: nothing grows for twenty days, the days are short and the nights far below freezing. Bunks indoors and stored food carry the colony through.',
];
export function bestLead(S, cr) {
  let best = -1, bs = -1;
  for (const i of cr.members) { const c = S.cols[i]; if (c.dead) continue; const s = c.skills.leadership + c.tru / 40; if (s > bs) { bs = s; best = i; } }
  return best;
}
export { remember };

// run-length text for the trodden and the surveyed ground: long runs of one value, so it stays small
function rle(a) {
  const out = []; let i = 0;
  while (i < a.length) { const v = a[i]; let n = 1; while (i + n < a.length && a[i + n] === v && n < 65535) n++; out.push(n === 1 ? v.toString(36) : v.toString(36) + '*' + n.toString(36)); i += n; }
  return out.join(',');
}
function unrle(s, n) {
  const a = new Uint8Array(n); let i = 0;
  for (const p of s.split(',')) { const [v, k] = p.split('*'); const val = parseInt(v, 36), cnt = k ? parseInt(k, 36) : 1; a.fill(val, i, i + cnt); i += cnt; }
  return a;
}

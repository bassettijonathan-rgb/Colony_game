// The colony's simulation: the Seed, its people and crews, the day, and the ground they wear down. It never
// draws anything. The state is plain data (numbers, arrays, two byte arrays), so saving is JSON plus the
// trampled and the surveyed ground, and the same seed always plays out the same way.
// How people spend their days lives in life.js; crews, the shelter and the fabricator in work.js.
import { MAP, CH, NCH, DAY_TICKS, YEAR_DAYS, SEASON_DAYS, T, HOUR, ACT } from './consts.js';
import { R, srand, rnd, ri, lcg } from './rng.js';
import { makeArchive, makePerson } from './founders.js';
import { think, mindTick, daily, remember } from './life.js';
import { crewThink, seedTick, onArrive, onTimer, command, STAGES } from './work.js';

export const CREW_NAMES = ['Basalt', 'Kestrel', 'Cedar', 'Drift', 'Ember', 'Fern', 'Gale', 'Heron', 'Iris', 'Juniper', 'Lichen', 'Moss', 'Nettle', 'Onyx', 'Pike', 'Quartz', 'Rowan', 'Sedge', 'Thistle', 'Umber', 'Vetch', 'Willow', 'Yarrow', 'Zinc', 'Alder', 'Bramble', 'Cobalt', 'Dune', 'Flint', 'Garnet', 'Hazel', 'Ivy', 'Jasper', 'Kelp', 'Larch', 'Marl'];
export const STAKES = 10, CARGO = STAGES.reduce((t, s) => t + (s[2] ? s[1] : 0), 0), FOOD_DAYS = 60, FIRST_BODIES = 6;

export class Sim {
  constructor(W, P) {
    this.W = W; this.P = P;
    this.wear = new Uint8Array(MAP * MAP); this.dirty = new Set();     // trodden ground, and chunks changed since the last report
    this.known = new Uint8Array(MAP * MAP); this.kdirty = new Set();   // what the Seed's sensors and its people have seen
    this.grid = new Int32Array((MAP / 2) * (MAP / 2)).fill(-1); this.next = null;
    const L = W.land, site = W.site, ring = [];
    // the camp: everyone walking back from far away follows this field down to the lander and the fire
    for (let y = L.y - 7; y <= L.y + 7; y++) for (let x = L.x - 7; x <= L.x + 7; x++) { const i = y * MAP + x; if (W.cost[i] && W.reach[i]) ring.push(i); }
    this.home = P.field('home', ring);
    this.spots = this.shelterSpots(site.shelter);
    this.cargoTile = site.cargo.y * MAP + site.cargo.x; this.doorTile = site.shelter.door.y * MAP + site.shelter.door.x;
  }

  // ---------- a new landing ----------
  // 'landfall' is the real start: the Seed alone with its archive. 'stress' wakes a crowd at once to measure the engine.
  newGame(mode = 'landfall', count = 300) {
    const W = this.W, L = W.land; srand(W.seed * 7919 + 17);
    this.S = {
      v: 2, mode, seed: W.seed, site: { x: L.x, y: L.y, id: W.siteId ?? 0 }, tick: Math.round(6 * HOUR),
      cols: [], crews: [], archive: makeArchive(W.seed), autoCrews: true,
      seedc: { feed: mode === 'stress' ? 0 : FIRST_BODIES, queue: [], printing: null, stakes: STAKES, cargo: CARGO },
      shelter: { stage: 0, fits: 0, done: false, beds: [] }, stakes: [], food: mode === 'stress' ? 1e9 : FOOD_DAYS * FIRST_BODIES,
      log: [], logN: 0, chunkLast: new Array(NCH * NCH).fill(0), rr: 0, walked: 0, knownN: 0, rv: 1,
      stats: { breakdowns: 0, accidents: 0, fits: 0, trips: 0, darkReturns: 0, friends: 0, rivals: 0, deaths: 0 },
    };
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
    return { id: k, name: CREW_NAMES[k % CREW_NAMES.length] + (k >= CREW_NAMES.length ? ' ' + (1 + (k / CREW_NAMES.length | 0)) : ''), gone: false, lead: -1, members: [], work, shift: 1, rules: { dark: true, pairs: true, rest: true }, target: -1, dest: -1, wait: ri(0, 200), siteLeft: 0, recalled: false, trips: 0 };
  }
  addTo(c, k) {
    const S = this.S;
    if (c.crew >= 0) { const o = S.crews[c.crew]; o.members = o.members.filter(i => i !== c.id); if (o.lead === c.id) o.lead = bestLead(S, o); }
    c.crew = k; c.plan = ''; c.job = '';
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
      crew: -1, plan: '', job: '', carry: 0, spot: -1, slot, seat: this.seat(),
      fat: 18, str: 8, tru: Math.round(60 + (has('stubborn') ? -8 : 0) + (has('cheerful') ? 5 : 0) + (has('anxious') ? -3 : 0) + (rnd() - .5) * 12), hp: 100,
      fresh: 10 * DAY_TICKS, hurt: 0, alone: 0, worked: 0, dark: 0, ate: 0, hungry: false, dead: false, escort: 0, outside: 0, bed: 21.3 + rnd() * .9,
    };
    for (const k of p.knew || []) { const o = S.cols.find(q => q.fid === k.fid); if (o) { const a = k.k === 'friend' ? 50 : -50; c.ties[o.id] = { f: 60, a, k: k.k }; o.ties[id] = { f: 60, a, k: k.k }; } }
    S.cols.push(c); S.rv++;
    return c;
  }
  log(m, k = '') { const S = this.S; S.logN++; S.log.push({ n: S.logN, t: S.tick, m, k }); if (S.log.length > 300) S.log.shift(); }

  // bedrolls in rings around the lander, clear of the shelter's plot, the fire and the cargo door
  restSlot() {
    const W = this.W, L = W.land, F = W.site.fire, C = W.site.cargo;
    for (let r = 5; r < 60; r += .5) {
      const n = Math.floor(r * 4.2);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * 6.2832 + r * .7, x = Math.floor(L.x + Math.cos(a) * r), y = Math.floor(L.y + Math.sin(a) * r), t = y * MAP + x;
        if (this.used.has(t) || !W.reach[t] || !W.cost[t] || W.type[t] === T.SHALLOW || W.type[t] === T.MARSH) continue;
        if (Math.hypot(x + .5 - F.x, y + .5 - F.y) < 4.5 || Math.hypot(x - C.x, y - C.y) < 2.5 || this.nearPlot(x, y, 1.5)) continue;
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
        if (this.seats.has(t) || !W.reach[t] || !W.cost[t] || W.type[t] === T.SHALLOW) continue;
        this.seats.add(t); return t;
      }
    }
    return Math.floor(F.y) * MAP + Math.floor(F.x);
  }
  nearPlot(x, y, m) { const s = this.W.site.shelter; return x >= s.x - m && x < s.x + s.w + m && y >= s.y - m && y < s.y + s.h + m; }
  shelterSpots(s) {
    const out = [];
    for (let y = s.y - 1; y <= s.y + s.h; y++) for (let x = s.x - 1; x <= s.x + s.w; x++) { const t = y * MAP + x; if (this.W.cost[t] && this.W.reach[t] && (x === s.x - 1 || y === s.y - 1 || x === s.x + s.w || y === s.y + s.h)) out.push(t); }
    return out;
  }

  // ---------- time ----------
  get hour() { return (this.S.tick % DAY_TICKS) / HOUR; }
  get day() { return Math.floor(this.S.tick / DAY_TICKS) + 1; }
  clock() { const d = this.day, h = this.hour; return { day: ((d - 1) % YEAR_DAYS) + 1, year: Math.floor((d - 1) / YEAR_DAYS) + 1, season: Math.floor(((d - 1) % YEAR_DAYS) / SEASON_DAYS), hour: h, tick: this.S.tick, abs: d }; }

  // ---------- one tick ----------
  tick() {
    const S = this.S, cols = S.cols;
    S.tick++;
    seedTick(this);
    for (const cr of S.crews) crewThink(this, cr);
    for (let i = S.tick % 30; i < cols.length; i += 30) { mindTick(this, cols[i]); think(this, cols[i]); }
    for (let i = 0; i < cols.length; i++) this.move(cols[i]);
    this.separate();
    this.groundTick();
    if (S.tick % DAY_TICKS === Math.round(4 * HOUR)) for (const c of cols) daily(this, c);
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
      if (a === ACT.SURVEY || a === ACT.IDLE) {
        // a little pottering about
        if (rnd() < .004) c.ang += (rnd() - .5) * 2;
        if (rnd() < (a === ACT.SURVEY ? .002 : .0008)) { const x = Math.floor(c.x + (rnd() - .5) * 4), y = Math.floor(c.y + (rnd() - .5) * 4), t = y * MAP + x; if (x > 0 && y > 0 && x < MAP && y < MAP && this.W.reach[t] && this.W.cost[t]) { c.leg = [t]; c.li = 0; } }
        if (c.li < c.leg.length) { const t = c.leg[c.li]; if (this.walk(c, t % MAP + .5, (t / MAP | 0) + .5)) c.li++; }
      } else if (a === ACT.BUILD) {
        const s = this.W.site.shelter; this.face(c, s.x + s.w / 2, s.y + s.h / 2);
      } else if (a === ACT.EAT) {
        const F = this.W.site.fire; this.face(c, F.x, F.y);
      }
    }
  }
  face(c, x, y) { const a = Math.atan2(y - c.y, x - c.x); let d = a - c.ang; while (d > Math.PI) d -= 6.2832; while (d < -Math.PI) d += 6.2832; c.ang += d * .1; }
  // steps toward a point; true once there
  walk(c, tx, ty, last) {
    const W = this.W, dx = tx - c.x, dy = ty - c.y, d = Math.hypot(dx, dy);
    let sp = c.spd * 10 / (W.cost[c.tile] || 10);
    if (c.fat > 75) sp *= .85; if (c.hurt > 0) sp *= .8; if (c.fresh > 0) sp *= .88; if (c.act === ACT.CARRY) sp *= .85;
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
    const nx = this.next, cells = [], still = a => a === ACT.BED || a === ACT.EAT || a === ACT.WAKE || a === ACT.ALONE || a === ACT.BUILD || a === ACT.PLANT;
    for (let i = 0; i < n; i++) { const c = cols[i]; nx[i] = -2; if (c.dead || c.act === ACT.INSIDE) continue; const g = (c.y / 2 | 0) * GW + (c.x / 2 | 0); nx[i] = G[g]; if (G[g] < 0) cells.push(g); G[g] = i; }
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
    for (let i = 0; i < cols.length; i++) { const c = cols[i], o = i * 4; out[o] = c.x; out[o + 1] = c.y; out[o + 2] = c.ang; out[o + 3] = (c.dead ? 15 : c.act) * 2 + c.moving; }
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
      people: S.cols.map(c => ({ id: c.id, name: c.name, look: c.look, age: c.age, trade: c.trade, traits: c.traits })),
      archive: S.archive.map(p => ({ fid: p.fid, name: p.name, age: p.age, trade: p.trade, skills: p.skills, traits: p.traits, mem: p.mem, knew: p.knew, woke: p.woke ?? null })),
    };
  }
  ui(watch) {
    const S = this.S, sd = S.seedc;
    const c = watch >= 0 ? S.cols[watch] : null;
    return {
      rv: S.rv, mode: S.mode, logN: S.logN,
      p: S.cols.map(c => [c.act, c.crew, Math.round(c.fat), Math.round(c.str), Math.round(c.tru), Math.round(c.hp), (c.fresh > 0 ? 1 : 0) | (c.hurt > 0 ? 2 : 0) | (c.alone > 0 ? 4 : 0) | (c.hungry ? 8 : 0) | (c.dead ? 16 : 0) | (c.carry && c.act === ACT.CARRY ? 32 : 0)]),
      crews: S.crews.map(cr => ({ id: cr.id, name: cr.name, gone: cr.gone, lead: cr.lead, members: cr.members, work: cr.work, shift: cr.shift, rules: cr.rules, target: cr.target, dest: cr.dest, recalled: cr.recalled })),
      seed: { feed: sd.feed, queue: sd.queue, printing: sd.printing && { fid: sd.printing.fid, left: sd.printing.left }, stakes: sd.stakes, cargo: sd.cargo, cargo0: CARGO },
      shelter: { stage: S.shelter.stage, fits: S.shelter.fits, done: S.shelter.done, beds: S.shelter.beds.length },
      food: S.food, alive: S.cols.filter(c => !c.dead).length, known: S.knownN, stakes: S.stakes, auto: S.autoCrews, stats: S.stats,
      detail: c && { id: c.id, skills: c.skills, mem: c.mem.slice(-6), ties: Object.entries(c.ties).filter(([, t]) => t.k).map(([id, t]) => ({ id: +id, k: t.k, f: Math.round(t.f), a: Math.round(t.a) })), worked: c.worked, fresh: c.fresh, hurt: c.hurt, plan: c.plan },
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
    this.wear.set(unrle(wear, MAP * MAP)); this.known.set(unrle(known, MAP * MAP)); this.dirty.clear(); this.kdirty.clear();
    this.used = new Set(this.S.cols.map(c => c.slot)); this.seats = new Set(this.S.cols.map(c => c.seat));
    for (let k = 0; k < NCH * NCH; k++) { this.dirty.add(k); this.kdirty.add(k); }
    return this.S;
  }
}
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

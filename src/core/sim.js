// The colony's simulation: people, crews, the day, and the ground they wear down. It never draws
// anything. The state is plain data (numbers, arrays, one byte array), so saving is JSON plus the
// trampled ground, and the same seed always plays out the same way.
import { MAP, CH, NCH, DAY_TICKS, YEAR_DAYS, SEASON_DAYS, T } from './consts.js';
import { R, srand, rnd, ri } from './rng.js';

const HOUR = DAY_TICKS / 24;
const SYL1 = ['A', 'Be', 'Ca', 'Da', 'E', 'Fa', 'Ga', 'Ha', 'I', 'Ja', 'Ka', 'La', 'Ma', 'Na', 'O', 'Pa', 'Ra', 'Sa', 'Ta', 'U', 'Va', 'Ya', 'Ze', 'Mi', 'Lo', 'Ri', 'Te', 'Ko', 'Su', 'Ny'];
const SYL2 = ['ren', 'lin', 'mar', 'dor', 'sha', 'vik', 'nel', 'tis', 'ra', 'lo', 'mei', 'dan', 'sol', 'kai', 'ro', 'via', 'th', 'n', 'x', 'ssa', 'el', 'is', 'ko', 'mir', 'ya'];
const CREW_NAMES = ['Basalt', 'Cedar', 'Drift', 'Ember', 'Fern', 'Gale', 'Heron', 'Iris', 'Juniper', 'Kestrel', 'Lichen', 'Moss', 'Nettle', 'Onyx', 'Pike', 'Quartz', 'Rowan', 'Sedge', 'Thistle', 'Umber', 'Vetch', 'Willow', 'Yarrow', 'Zinc', 'Alder', 'Bramble', 'Cobalt', 'Dune', 'Flint', 'Garnet', 'Hazel', 'Ivy', 'Jasper', 'Kelp', 'Larch', 'Marl'];
export const MODE = { REST: 0, ROUTE: 1, HOME: 2, WORK: 3, SLOT: 4 };
export const MODE_NAME = ['Resting by the Seed', 'Walking to a survey site', 'Walking back to the Seed', 'Surveying', 'Settling down for the night'];

export class Sim {
  constructor(W, P) {
    this.W = W; this.P = P;
    this.wear = new Uint8Array(MAP * MAP);
    this.dirty = new Set();                       // chunks whose trampled ground changed since the last report
    this.grid = new Int32Array((MAP / 2) * (MAP / 2)).fill(-1); this.next = null;
    const L = W.land; const ring = [];
    for (let y = L.y - 4; y <= L.y + 4; y++) for (let x = L.x - 4; x <= L.x + 4; x++) if (W.cost[y * MAP + x]) ring.push(y * MAP + x);
    this.home = P.field('home', ring);
  }
  // ---------- a new landing ----------
  newGame(count, seedOverride) {
    const W = this.W, L = W.land; srand((seedOverride ?? W.seed) * 7919 + 17);
    const cols = [], crews = [];
    const nCrews = Math.max(1, Math.round(count / 10));
    for (let k = 0; k < nCrews; k++) crews.push({ id: k, name: CREW_NAMES[k % CREW_NAMES.length] + (k >= CREW_NAMES.length ? ' ' + (1 + (k / CREW_NAMES.length | 0)) : ''), members: [], dest: -1, wps: null, wait: ri(0, 500), trips: 0 });
    const used = new Set();
    for (let i = 0; i < count; i++) {
      const crew = i % nCrews;
      const slot = this.restSlot(i, count, used);
      cols.push({ id: i, name: SYL1[ri(0, SYL1.length - 1)] + SYL2[ri(0, SYL2.length - 1)] + (rnd() < .3 ? SYL2[ri(0, SYL2.length - 1)] : ''), crew, look: ri(0, 1e6),
        x: slot % MAP + .5, y: (slot / MAP | 0) + .5, ang: rnd() * 6.283, spd: .125 + rnd() * .03, mode: MODE.REST, slot, wps: [], wi: 0, leg: [], li: 0, wait: 0, stuck: 0, tile: slot, moving: 0 });
      crews[crew].members.push(i);
    }
    this.S = { v: 1, seed: W.seed, count, tick: Math.round(6.2 * HOUR), cols, crews, chunkLast: new Array(NCH * NCH).fill(0), rr: 0, walked: 0 };
    this.wear.fill(0); this.dirty.clear();
    return this.S;
  }
  // sleeping places in rings around the Seed, nearest first
  restSlot(i, count, used) {
    const W = this.W, L = W.land;
    for (let r = 6; r < 40; r += .5) {
      const n = Math.floor(r * 4.2);
      for (let k = 0; k < n; k++) {
        const a = (k / n) * 6.2832 + r * .7, x = Math.floor(L.x + Math.cos(a) * r), y = Math.floor(L.y + Math.sin(a) * r), t = y * MAP + x;
        if (!used.has(t) && W.reach[t] && W.type[t] !== T.SHALLOW) { used.add(t); return t; }
      }
    }
    return (L.y + 5) * MAP + L.x;
  }

  // ---------- time ----------
  get hour() { return (this.S.tick % DAY_TICKS) / HOUR; }
  get day() { return Math.floor(this.S.tick / DAY_TICKS) + 1; }
  clock() { const d = this.day, h = this.hour; return { day: ((d - 1) % YEAR_DAYS) + 1, year: Math.floor((d - 1) / YEAR_DAYS) + 1, season: Math.floor(((d - 1) % YEAR_DAYS) / SEASON_DAYS), hour: h, tick: this.S.tick }; }
  workTime() { const h = this.hour; return h >= 6.5 && h < 18.3; }

  // ---------- one tick ----------
  tick() {
    const S = this.S, cols = S.cols;
    S.tick++;
    for (const cr of S.crews) this.crewThink(cr);
    for (let i = 0; i < cols.length; i++) this.move(cols[i]);
    this.separate();
    this.groundTick();
  }
  crewThink(cr) {
    const S = this.S, W = this.W, cols = S.cols;
    if (cr.wait > 0) { cr.wait--; return; }
    if (!this.workTime()) {   // evening: everyone out in the field turns for home
      for (const i of cr.members) { const c = cols[i]; if (c.mode === MODE.ROUTE || c.mode === MODE.WORK) { c.mode = MODE.HOME; c.wps = []; c.leg = []; c.li = 0; c.wait = ri(0, 40); } }
      cr.wait = 60; return;
    }
    if (cr.members.some(i => cols[i].mode !== MODE.REST && cols[i].mode !== MODE.WORK)) return;
    const atHome = cr.members.every(i => cols[i].mode === MODE.REST);
    // pick a survey site: far from the Seed on the first trip of the day, nearby after that
    const lead = cols[cr.members[0]], from = lead.tile, L = W.land;
    let dest = -1;
    for (let k = 0; k < 40 && dest < 0; k++) {
      let cx, cy;
      if (atHome) { const a = rnd() * 6.2832, r = 40 + rnd() * 190; cx = L.x + Math.cos(a) * r; cy = L.y + Math.sin(a) * r; }
      else { cx = lead.x + (rnd() - .5) * 120; cy = lead.y + (rnd() - .5) * 120; }
      const x = Math.floor(cx), y = Math.floor(cy); if (x < 2 || y < 2 || x >= MAP - 2 || y >= MAP - 2) continue;
      const t = y * MAP + x; if (W.reach[t] && W.type[t] !== T.SHALLOW && W.type[t] !== T.MARSH) dest = t;
    }
    if (dest < 0) { cr.wait = 120; return; }
    const wps = this.P.route(from, dest);
    if (!wps) { cr.wait = 120; return; }
    cr.dest = dest; cr.trips++; S.walked++;
    cr.members.forEach((i, k) => {
      const c = cols[i];
      // each member works a spot of its own around the site
      let mine = dest;
      if (k > 0) for (let tries = 0; tries < 12; tries++) { const a = k * 2.4 + tries, r = 1.5 + (k % 4) + tries * .3; const x = (dest % MAP) + Math.round(Math.cos(a) * r), y = (dest / MAP | 0) + Math.round(Math.sin(a) * r), t = y * MAP + x; if (x > 0 && y > 0 && x < MAP && y < MAP && W.reach[t]) { mine = t; break; } }
      c.wps = wps.length ? wps.slice(0, -1).concat([mine]) : [mine]; c.wi = 0; c.leg = []; c.li = 0; c.mode = MODE.ROUTE; c.wait = k * 6;
    });
  }

  // ---------- walking ----------
  move(c) {
    c.moving = 0;
    if (c.wait > 0) { c.wait--; return; }
    const W = this.W, P = this.P;
    if (c.mode === MODE.ROUTE || c.mode === MODE.SLOT) {
      if (c.li >= c.leg.length) {
        if (c.wi >= c.wps.length) { this.arrive(c); return; }
        const leg = P.leg(c.tile, c.wps[c.wi]);
        if (!leg) { const r = P.route(c.tile, c.wps[c.wps.length - 1]); if (!r) { this.arrive(c); return; } c.wps = r; c.wi = 0; c.leg = []; c.li = 0; c.wait = 10; return; }
        c.leg = leg; c.li = 0; c.wi++;
        this.skipAhead(c);
      }
      if (c.li < c.leg.length) {
        const t = c.leg[c.li], last = c.li === c.leg.length - 1 && c.wi >= c.wps.length;
        // someone standing on the spot, or a crowd: after a few seconds, take the next tile instead
        if (this.walk(c, t % MAP + .5, (t / MAP | 0) + .5, last) || ++c.stuck > 90) { c.li++; c.stuck = 0; this.skipAhead(c); }
      }
    } else if (c.mode === MODE.HOME) {
      if (this.home[c.tile] < 120 || ++c.stuck > 300) { c.stuck = 0; const r = P.route(c.tile, c.slot); c.mode = MODE.SLOT; c.wps = r || [c.slot]; c.wi = 0; c.leg = []; c.li = 0; return; }
      const t = P.downhill(this.home, c.tile);
      if (t < 0) { c.mode = MODE.SLOT; c.wps = [c.slot]; c.wi = 0; c.leg = []; c.li = 0; return; }
      this.walk(c, t % MAP + .5, (t / MAP | 0) + .5);
    } else if (c.mode === MODE.WORK) {
      // a little pottering about the site
      if (rnd() < .004) { c.ang += (rnd() - .5) * 2; }
      if (rnd() < .002) { const x = Math.floor(c.x + (rnd() - .5) * 4), y = Math.floor(c.y + (rnd() - .5) * 4), t = y * MAP + x; if (x > 0 && y > 0 && x < MAP && y < MAP && W.reach[t]) { c.leg = [t]; c.li = 0; } }
      if (c.li < c.leg.length) { const t = c.leg[c.li]; if (this.walk(c, t % MAP + .5, (t / MAP | 0) + .5)) c.li++; }
    }
  }
  arrive(c) {
    c.wps = []; c.leg = []; c.li = 0; c.wi = 0;
    if (c.mode === MODE.SLOT) { c.mode = MODE.REST; return; }
    c.mode = MODE.WORK;
    const cr = this.S.crews[c.crew];
    if (cr.members.every(i => this.S.cols[i].mode === MODE.WORK)) cr.wait = ri(Math.round(1.5 * HOUR), Math.round(3.5 * HOUR));
  }
  // steps toward a point; true once there
  walk(c, tx, ty, last) {
    const W = this.W, dx = tx - c.x, dy = ty - c.y, d = Math.hypot(dx, dy);
    const sp = c.spd * 10 / (W.cost[c.tile] || 10);
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
  // people step aside for each other
  separate() {
    const cols = this.S.cols, n = cols.length, G = this.grid, GW = MAP / 2;
    if (!this.next || this.next.length < n) this.next = new Int32Array(n);
    const nx = this.next, cells = [];
    for (let i = 0; i < n; i++) { const c = cols[i], g = (c.y / 2 | 0) * GW + (c.x / 2 | 0); nx[i] = G[g]; if (G[g] < 0) cells.push(g); G[g] = i; }
    const C = this.W.cost;
    for (let i = 0; i < n; i++) {
      const a = cols[i], gx = a.x / 2 | 0, gy = a.y / 2 | 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const x = gx + ox, y = gy + oy; if (x < 0 || y < 0 || x >= GW || y >= GW) continue;
        for (let j = G[y * GW + x]; j >= 0; j = nx[j]) {
          if (j <= i) continue;
          const b = cols[j], dx = b.x - a.x, dy = b.y - a.y, d2 = dx * dx + dy * dy;
          if (d2 > .3 || d2 < 1e-8) continue;
          const d = Math.sqrt(d2), push = (.55 - d) * .25 / d;
          const am = a.mode === MODE.REST ? 0 : 1, bm = b.mode === MODE.REST ? 0 : 1; if (!am && !bm) continue;
          const ax = a.x - dx * push * am, ay = a.y - dy * push * am, bx = b.x + dx * push * bm, by = b.y + dy * push * bm;
          if (C[Math.floor(ay) * MAP + Math.floor(ax)]) { a.x = ax; a.y = ay; }
          if (C[Math.floor(by) * MAP + Math.floor(bx)]) { b.x = bx; b.y = by; }
        }
      }
    }
    for (const g of cells) G[g] = -1;
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

  // ---------- what the renderer needs ----------
  snapshot(out) {
    const cols = this.S.cols;
    for (let i = 0; i < cols.length; i++) { const c = cols[i], o = i * 4; out[o] = c.x; out[o + 1] = c.y; out[o + 2] = c.ang; out[o + 3] = c.mode * 2 + c.moving; }
    return out;
  }
  wearChunk(k) {
    const cx = k % NCH, cy = k / NCH | 0, out = new Uint8Array(CH * CH);
    for (let y = 0; y < CH; y++) for (let x = 0; x < CH; x++) { const X = cx * CH + x, Y = cy * CH + y; if (X < MAP && Y < MAP) out[y * CH + x] = this.wear[Y * MAP + X]; }
    return out;
  }

  // ---------- saving ----------
  serialize() {
    return { ...this.S, rng: R.s, wear: rle(this.wear) };
  }
  load(d) {
    const { rng, wear, ...S } = d;
    this.S = JSON.parse(JSON.stringify(S)); srand(rng);
    this.wear.set(unrle(wear, MAP * MAP)); this.dirty.clear();
    for (let k = 0; k < NCH * NCH; k++) this.dirty.add(k);
    return this.S;
  }
}

// run-length text for the trampled ground: mostly zeros, so it stays small
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

// Finding the way across a 600 x 600 map for hundreds of people.
// Two levels: a coarse graph of the gaps between chunks (built once, a few thousand nodes), then short
// local searches inside one chunk at a time, done only when a walker reaches that stretch.
// Popular destinations get a flow field instead: one search from the destination, then any number of
// people find their way home by looking at the tiles around them.
import { MAP, CH, NCH } from './consts.js';

const SQ2 = Math.SQRT2, MINC = 9;
const DX = [1, -1, 0, 0, 1, 1, -1, -1], DY = [0, 0, 1, -1, 1, -1, 1, -1];

// a binary heap of (id, key) pairs; stale entries are skipped by the caller
class Heap {
  constructor(n) { this.id = new Int32Array(n); this.k = new Float64Array(n); this.n = 0; }
  push(id, k) {
    if (this.n === this.id.length) { const i2 = new Int32Array(this.n * 2), k2 = new Float64Array(this.n * 2); i2.set(this.id); k2.set(this.k); this.id = i2; this.k = k2; }
    let i = this.n++; const I = this.id, K = this.k;
    while (i > 0) { const p = (i - 1) >> 1; if (K[p] <= k) break; I[i] = I[p]; K[i] = K[p]; i = p; }
    I[i] = id; K[i] = k;
  }
  pop() {
    const I = this.id, K = this.k, top = I[0], n = --this.n; if (n === 0) return top;
    const id = I[n], k = K[n]; let i = 0;
    for (;;) { let c = 2 * i + 1; if (c >= n) break; if (c + 1 < n && K[c + 1] < K[c]) c++; if (K[c] >= k) break; I[i] = I[c]; K[i] = K[c]; i = c; }
    I[i] = id; K[i] = k; return top;
  }
  topKey() { return this.k[0]; }
}

const octile = (ax, ay, bx, by) => { const dx = Math.abs(ax - bx), dy = Math.abs(ay - by); return (dx > dy ? dx - dy + dy * SQ2 : dy - dx + dx * SQ2) * MINC; };

export class Pathfinder {
  constructor(W) {
    this.W = W; this.cost = W.cost;
    // scratch for local searches (up to 128 x 128 tiles)
    const S = 128 * 128; this.g = new Float64Array(S); this.from = new Int32Array(S); this.stamp = new Int32Array(S); this.closed = new Int32Array(S); this.gen = 1; this.heap = new Heap(4096);
    this.stats = { local: 0, coarse: 0, fields: 0, ms: 0, fail: 0 };
    this.fields = new Map();
    this.build();
  }
  passable(i) { return this.cost[i] > 0; }
  step(a, b, diag) { return (this.cost[a] + this.cost[b]) * .5 * (diag ? SQ2 : 1); }

  // Dijkstra or A* inside the rectangle [x0,x1) x [y0,y1). With a goal it returns the tile path
  // (start excluded, goal included) or null; without one it fills this.g for every reached tile.
  search(x0, y0, x1, y1, start, goal) {
    const C = this.cost, rw = x1 - x0, H = this.heap, G = this.g, F = this.from, st = this.stamp, cl = this.closed, gen = ++this.gen;
    const loc = i => ((i / MAP | 0) - y0) * rw + (i % MAP - x0);
    const gx = goal >= 0 ? goal % MAP : 0, gy = goal >= 0 ? goal / MAP | 0 : 0;
    H.n = 0; const s = loc(start); G[s] = 0; F[s] = -1; st[s] = gen; H.push(start, goal >= 0 ? octile(start % MAP, start / MAP | 0, gx, gy) : 0);
    while (H.n) {
      const i = H.pop(), li = loc(i); if (cl[li] === gen) continue; cl[li] = gen;
      if (i === goal) {
        const out = []; let k = i; while (k !== start) { out.push(k); k = F[loc(k)]; } return out.reverse();
      }
      const x = i % MAP, y = i / MAP | 0, gi = G[li];
      for (let d = 0; d < 8; d++) {
        const nx = x + DX[d], ny = y + DY[d]; if (nx < x0 || ny < y0 || nx >= x1 || ny >= y1) continue;
        const j = ny * MAP + nx; if (!C[j]) continue;
        if (d >= 4 && (!C[y * MAP + nx] || !C[ny * MAP + x])) continue;      // no cutting corners
        const lj = (ny - y0) * rw + (nx - x0); if (cl[lj] === gen) continue;
        const ng = gi + (C[i] + C[j]) * .5 * (d >= 4 ? SQ2 : 1);
        if (st[lj] !== gen || ng < G[lj]) { st[lj] = gen; G[lj] = ng; F[lj] = i; H.push(j, ng + (goal >= 0 ? octile(nx, ny, gx, gy) : 0)); }
      }
    }
    return goal >= 0 ? null : true;
  }
  costTo(x0, y0, x1, y1, i) { const l = ((i / MAP | 0) - y0) * (x1 - x0) + (i % MAP - x0); return this.closed[l] === this.gen ? this.g[l] : Infinity; }
  chunkRect(c) { const cx = c % NCH, cy = c / NCH | 0; return [cx * CH, cy * CH, Math.min(MAP, cx * CH + CH), Math.min(MAP, cy * CH + CH)]; }
  chunkOf(i) { return ((i / MAP | 0) / CH | 0) * NCH + ((i % MAP) / CH | 0); }

  // the coarse graph: a node on each side of every gap between neighbouring chunks
  build() {
    const t0 = now(), C = this.cost, nodes = [], byChunk = Array.from({ length: NCH * NCH }, () => []), edges = [];
    const add = (i) => { const n = nodes.length; nodes.push(i); byChunk[this.chunkOf(i)].push(n); edges.push([]); return n; };
    const link = (a, b, c) => { edges[a].push(b, c); edges[b].push(a, c); };
    const gap = (cells) => {   // cells: pairs [a, b] along one border
      let run = [];
      const flush = () => {
        if (!run.length) return;
        const picks = run.length <= 8 ? [run[run.length >> 1]] : [run[1], run[run.length - 2]];
        for (const [a, b] of picks) link(add(a), add(b), (C[a] + C[b]) * .5);
        run = [];
      };
      for (const p of cells) { if (C[p[0]] && C[p[1]]) run.push(p); else flush(); }
      flush();
    };
    for (let cy = 0; cy < NCH; cy++) for (let cx = 0; cx < NCH; cx++) {
      const x1 = Math.min(MAP, cx * CH + CH), y1 = Math.min(MAP, cy * CH + CH);
      if (x1 < MAP) { const cells = []; for (let y = cy * CH; y < y1; y++) cells.push([y * MAP + x1 - 1, y * MAP + x1]); gap(cells); }
      if (y1 < MAP) { const cells = []; for (let x = cx * CH; x < x1; x++) cells.push([(y1 - 1) * MAP + x, y1 * MAP + x]); gap(cells); }
    }
    // inside each chunk, how far every node is from every other
    for (let c = 0; c < byChunk.length; c++) {
      const L = byChunk[c], r = this.chunkRect(c);
      for (let a = 0; a < L.length; a++) {
        this.search(r[0], r[1], r[2], r[3], nodes[L[a]], -1);
        for (let b = a + 1; b < L.length; b++) { const d = this.costTo(r[0], r[1], r[2], r[3], nodes[L[b]]); if (d < Infinity) link(L[a], L[b], d); }
      }
    }
    this.nodes = Int32Array.from(nodes); this.byChunk = byChunk; this.edges = edges.map(e => Float64Array.from(e));
    this.ng = new Float64Array(nodes.length + 1); this.nfrom = new Int32Array(nodes.length + 1); this.nstamp = new Int32Array(nodes.length + 1); this.nclosed = new Int32Array(nodes.length + 1); this.ngen = 0;
    this.buildMs = now() - t0;
  }

  // A route from tile a to tile b: a list of waypoints, each reachable from the one before by a short
  // search inside one chunk (see leg). Nearby goals come back as the full list of tiles. Null when b
  // cannot be reached.
  route(a, b) {
    const t0 = now(); try { return this._route(a, b); } finally { this.stats.ms += now() - t0; }
  }
  _route(a, b) {
    const W = this.W; if (!W.reach[a] || !W.reach[b] || a === b) return a === b ? [] : null;
    const ax = a % MAP, ay = a / MAP | 0, bx = b % MAP, by = b / MAP | 0;
    // close by: one local search in a box around both ends
    if (Math.max(Math.abs(ax - bx), Math.abs(ay - by)) <= CH * 1.5) {
      const m = CH >> 1, x0 = Math.max(0, Math.min(ax, bx) - m), y0 = Math.max(0, Math.min(ay, by) - m), x1 = Math.min(MAP, Math.max(ax, bx) + m + 1), y1 = Math.min(MAP, Math.max(ay, by) + m + 1);
      this.stats.local++;
      const p = this.search(x0, y0, x1, y1, a, b); if (p) return p;
    }
    this.stats.coarse++;
    // attach both ends to the nodes of their own chunks
    const ca = this.chunkOf(a), cb = this.chunkOf(b), ra = this.chunkRect(ca), rb = this.chunkRect(cb);
    this.search(ra[0], ra[1], ra[2], ra[3], a, -1);
    const startC = this.byChunk[ca].map(n => [n, this.costTo(ra[0], ra[1], ra[2], ra[3], this.nodes[n])]).filter(p => p[1] < Infinity);
    this.search(rb[0], rb[1], rb[2], rb[3], b, -1);
    const goalC = new Map(this.byChunk[cb].map(n => [n, this.costTo(rb[0], rb[1], rb[2], rb[3], this.nodes[n])]).filter(p => p[1] < Infinity));
    if (!startC.length || !goalC.size) { this.stats.fail++; return null; }
    const N = this.nodes, E = this.edges, GL = N.length, g = this.ng, fr = this.nfrom, st = this.nstamp, cl = this.nclosed, gen = ++this.ngen, H = this.heap;
    const h = n => octile(N[n] % MAP, N[n] / MAP | 0, bx, by);
    H.n = 0;
    for (const [n, c] of startC) { st[n] = gen; g[n] = c; fr[n] = -1; H.push(n, c + h(n)); }
    let found = false;
    while (H.n) {
      const n = H.pop(); if (cl[n] === gen) continue; cl[n] = gen;
      if (n === GL) { found = true; break; }
      const gc = goalC.get(n);
      if (gc !== undefined && (st[GL] !== gen || g[n] + gc < g[GL])) { st[GL] = gen; g[GL] = g[n] + gc; fr[GL] = n; H.push(GL, g[GL]); }
      const e = E[n];
      for (let k = 0; k < e.length; k += 2) {
        const m = e[k]; if (cl[m] === gen) continue; const ng = g[n] + e[k + 1];
        if (st[m] !== gen || ng < g[m]) { st[m] = gen; g[m] = ng; fr[m] = n; H.push(m, ng + h(m)); }
      }
    }
    if (!found) { this.stats.fail++; return null; }
    const out = [b]; let n = fr[GL]; while (n >= 0) { out.push(N[n]); n = fr[n]; }
    return out.reverse();
  }
  // the tiles from a to the next waypoint b, when b lies in a's chunk or right across its edge
  leg(a, b) {
    const ax = a % MAP, ay = a / MAP | 0, bx = b % MAP, by = b / MAP | 0;
    if (Math.abs(ax - bx) <= 1 && Math.abs(ay - by) <= 1) return [b];
    let r = this.chunkRect(this.chunkOf(a));
    if (this.chunkOf(b) !== this.chunkOf(a)) {   // walker strayed: search a box around both
      r = [Math.max(0, Math.min(ax, bx) - 8), Math.max(0, Math.min(ay, by) - 8), Math.min(MAP, Math.max(ax, bx) + 9), Math.min(MAP, Math.max(ay, by) + 9)];
      if (r[2] - r[0] > 128 || r[3] - r[1] > 128) return null;
    }
    this.stats.local++;
    return this.search(r[0], r[1], r[2], r[3], a, b);
  }

  // A flow field toward a set of tiles: the cost of the way home from every reachable tile.
  field(key, goals) {
    if (this.fields.has(key)) return this.fields.get(key);
    const t0 = now(), C = this.cost, D = new Float64Array(MAP * MAP).fill(Infinity), H = new Heap(1 << 16);
    for (const i of goals) if (C[i]) { D[i] = 0; H.push(i, 0); }
    while (H.n) {
      const k = H.topKey(), i = H.pop(); if (k > D[i]) continue;
      const x = i % MAP, y = i / MAP | 0;
      for (let d = 0; d < 8; d++) {
        const nx = x + DX[d], ny = y + DY[d]; if (nx < 0 || ny < 0 || nx >= MAP || ny >= MAP) continue;
        const j = ny * MAP + nx; if (!C[j]) continue;
        if (d >= 4 && (!C[y * MAP + nx] || !C[ny * MAP + x])) continue;
        const nd = k + (C[i] + C[j]) * .5 * (d >= 4 ? SQ2 : 1);
        if (nd < D[j]) { D[j] = nd; H.push(j, nd); }
      }
    }
    this.stats.fields++; this.fieldMs = now() - t0;
    this.fields.set(key, D); return D;
  }
  // the next tile downhill on a flow field, or -1 at the bottom
  downhill(D, i) {
    const C = this.cost, x = i % MAP, y = i / MAP | 0; let best = -1, bv = D[i];
    for (let d = 0; d < 8; d++) {
      const nx = x + DX[d], ny = y + DY[d]; if (nx < 0 || ny < 0 || nx >= MAP || ny >= MAP) continue;
      const j = ny * MAP + nx; if (!C[j] || (d >= 4 && (!C[y * MAP + nx] || !C[ny * MAP + x]))) continue;
      if (D[j] < bv) { bv = D[j]; best = j; }
    }
    return best;
  }
}
const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now());

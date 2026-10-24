// The painted map. A whole-map overview is painted once at a low resolution; on top of it, chunks near
// the camera are painted in full detail into the layers of a texture array, nearest first, a couple per
// frame, and the least recently seen chunk gives its layer up when a new one is needed.
// When the trodden ground changes, the chunks it touches are painted again. After the landing, the ground the
// lander changed is painted again too. What the Seed has surveyed is kept in its own small texture.
import { MAP, CH, NCH, T } from '../core/consts.js';
import { propsIn } from '../core/world.js';
import { FS_PAINT_ALB, FS_PAINT_HM, VS_SPRITE, FS_SPRITE } from './shaders.js';
import { buildPropSheets, propQuads } from './props.js';

export const TP = 20;        // albedo pixels per tile in a detailed chunk
const HP = 8;                // height and material pixels per tile in a detailed chunk
export const LAYERS = 64;    // detailed chunks kept at once
const OV = 4, OVH = 2;       // overview pixels per tile: albedo, height and material

export class Terrain {
  constructor(G, W) {
    const gl = G.gl; this.G = G; this.W = W;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    const N = MAP * MAP;
    this.tType = G.tex2D(MAP, MAP, { internal: gl.R8, format: gl.RED, filter: gl.NEAREST, data: W.type });
    this.tField = G.tex2D(MAP, MAP, { data: fieldOf(W) });
    this.tWear = G.tex2D(MAP, MAP, { internal: gl.R8, format: gl.RED, data: new Uint8Array(N) });
    this.tKnown = G.tex2D(MAP, MAP, { internal: gl.R8, format: gl.RED, data: new Uint8Array(N) });
    this.albA = G.texArray(CH * TP, CH * TP, LAYERS, true);
    this.hmA = G.texArray(CH * HP, CH * HP, LAYERS, false);
    this.matA = G.texArray(CH * HP, CH * HP, LAYERS, false);
    this.albO = G.tex2D(MAP * OV, MAP * OV, { mip: true });
    this.hmO = G.tex2D(MAP * OVH, MAP * OVH);
    this.matO = G.tex2D(MAP * OVH, MAP * OVH, { mip: true });
    this.table = new Uint8Array(NCH * NCH * 4);
    this.tTable = G.tex2D(NCH, NCH, { filter: gl.NEAREST, data: this.table });
    this.slotChunk = new Int32Array(LAYERS).fill(-1); this.slotSeen = new Float64Array(LAYERS);
    this.chunkSlot = new Int32Array(NCH * NCH).fill(-1);
    this.stale = new Uint8Array(NCH * NCH); this.ovStale = new Set(); this.ovH = new Set(); this.lastOv = 0;
    this.pA = G.prog(FS_PAINT_ALB); this.pH = G.prog(FS_PAINT_HM); this.pS = G.prog(FS_SPRITE, VS_SPRITE);
    this.ok = !!(this.pA && this.pH && this.pS);
    this.fbA = gl.createFramebuffer(); this.fbH = gl.createFramebuffer();
    // the prop sheets and an instanced quad for stamping them
    const sh = buildPropSheets(); this.at = sh.at;
    this.tSprite = G.tex2D(sh.col.width, sh.col.height, { mip: true }); gl.bindTexture(gl.TEXTURE_2D, this.tSprite); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, gl.RGBA, gl.UNSIGNED_BYTE, sh.col); gl.generateMipmap(gl.TEXTURE_2D);
    this.tSpriteH = G.tex2D(sh.hgt.width, sh.hgt.height); gl.bindTexture(gl.TEXTURE_2D, this.tSpriteH); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, sh.hgt); gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, false);
    this.svao = gl.createVertexArray(); gl.bindVertexArray(this.svao);
    this.bP = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.bP); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 4, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(0, 1);
    this.bU = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, this.bU); gl.enableVertexAttribArray(1); gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0); gl.vertexAttribDivisor(1, 1);
    gl.bindVertexArray(null);
    this.ovSteps = this.overviewPlan(); this.ovDone = 0;
    this.stats = { painted: 0, repainted: 0, ms: 0 };
  }

  uniforms(p, ox, oy, span, size, detail) {
    const gl = this.G.gl, u = p.u, W = this.W;
    gl.useProgram(p.p);
    this.G.bind(u.uType, 0, this.tType); this.G.bind(u.uField, 1, this.tField); this.G.bind(u.uWear, 2, this.tWear);
    gl.uniform2f(u.uOrigin, ox, oy); gl.uniform1f(u.uSpan, span); gl.uniform1f(u.uSize, size);
    if (u.uDetail) gl.uniform1f(u.uDetail, detail);
    gl.uniform1f(u.uSeed, (W.seed % 997) * .731); gl.uniform1f(u.uMap, MAP); if (W.land) gl.uniform2f(u.uLand, W.land.x, W.land.y); else gl.uniform2f(u.uLand, -999, -999);
    if (u.uRock) gl.uniform1f(u.uRock, W.rock);
  }
  // stamps props into whatever is bound, over the tile square [ox, ox+span)
  stamp(list, ox, oy, span, height) {
    if (!list.length) return;
    const gl = this.G.gl, q = propQuads(list, this.at);
    gl.useProgram(this.pS.p); gl.uniform2f(this.pS.u.uOrigin, ox, oy); gl.uniform1f(this.pS.u.uSpan, span);
    this.G.bind(this.pS.u.uAtlas, 0, height ? this.tSpriteH : this.tSprite);
    gl.bindVertexArray(this.svao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bP); gl.bufferData(gl.ARRAY_BUFFER, q.P, gl.STREAM_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.bU); gl.bufferData(gl.ARRAY_BUFFER, q.U, gl.STREAM_DRAW);
    gl.enable(gl.BLEND);
    if (height) { gl.blendEquation(gl.MAX); gl.blendFunc(gl.ONE, gl.ONE); } else { gl.blendEquation(gl.FUNC_ADD); gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA); }
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, q.n);
    gl.disable(gl.BLEND); gl.blendEquation(gl.FUNC_ADD); gl.bindVertexArray(this.G.vao);
  }

  // ---------- the overview, painted in strips over the first frames ----------
  overviewPlan() {
    const s = [];
    for (let r = 0; r < MAP; r += 60) s.push(['alb', r, r + 60]);
    for (let r = 0; r < MAP; r += 150) s.push(['hm', r, r + 150]);
    for (let r = 0; r < MAP; r += 100) s.push(['props', r, r + 100]);
    s.push(['mips']);
    return s;
  }
  get ready() { return this.ovDone >= this.ovSteps.length; }
  get progress() { return this.ovDone / this.ovSteps.length; }
  paintOverviewStep() {
    if (this.ready) return;
    const gl = this.G.gl, st = this.ovSteps[this.ovDone++];
    gl.bindVertexArray(this.G.vao);
    if (st[0] === 'alb') {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbA); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.albO, 0); gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      gl.viewport(0, st[1] * OV, MAP * OV, (st[2] - st[1]) * OV);
      this.uniforms(this.pA, 0, 0, MAP, MAP * OV, 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
    } else if (st[0] === 'hm') {
      this.bindHM(this.hmO, this.matO, -1);
      gl.viewport(0, st[1] * OVH, MAP * OVH, (st[2] - st[1]) * OVH);
      this.uniforms(this.pH, 0, 0, MAP, MAP * OVH, 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
    } else if (st[0] === 'props') {
      const list = propsIn(this.W, 0, st[1], MAP, st[2]);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbA); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.albO, 0); gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
      gl.viewport(0, 0, MAP * OV, MAP * OV); this.stamp(list, 0, 0, MAP, false);
      this.bindHM(this.hmO, this.matO, -1); gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.NONE]);
      gl.viewport(0, 0, MAP * OVH, MAP * OVH); this.stamp(list, 0, 0, MAP, true);
    } else {
      gl.bindTexture(gl.TEXTURE_2D, this.albO); gl.generateMipmap(gl.TEXTURE_2D);
      gl.bindTexture(gl.TEXTURE_2D, this.matO); gl.generateMipmap(gl.TEXTURE_2D);
    }
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  bindHM(th, tm, layer) {
    const gl = this.G.gl; gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbH);
    if (layer < 0) { gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, th, 0); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, tm, 0); }
    else { gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, th, 0, layer); gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, tm, 0, layer); }
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
  }

  // ---------- detailed chunks ----------
  paintChunk(k, slot) {
    const gl = this.G.gl, cx = k % NCH, cy = k / NCH | 0, ox = cx * CH, oy = cy * CH;
    const list = propsIn(this.W, ox - 2, oy - 2, ox + CH + 2, oy + CH + 2);
    gl.bindVertexArray(this.G.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbA); gl.framebufferTextureLayer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, this.albA, 0, slot); gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.viewport(0, 0, CH * TP, CH * TP);
    this.uniforms(this.pA, ox, oy, CH, CH * TP, 1); gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.stamp(list.slice(), ox, oy, CH, false);
    this.bindHM(this.hmA, this.matA, slot); gl.viewport(0, 0, CH * HP, CH * HP);
    this.uniforms(this.pH, ox, oy, CH, CH * HP, 1); gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.NONE]); this.stamp(list, ox, oy, CH, true);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const old = this.slotChunk[slot]; if (old >= 0 && old !== k) { this.chunkSlot[old] = -1; this.setTable(old, 0); }
    this.slotChunk[slot] = k; this.chunkSlot[k] = slot; this.setTable(k, slot + 1); this.stale[k] = 0;
  }
  setTable(k, v) {
    const gl = this.G.gl; this.table[k * 4] = v;
    gl.bindTexture(gl.TEXTURE_2D, this.tTable); gl.texSubImage2D(gl.TEXTURE_2D, 0, k % NCH, k / NCH | 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, this.table.subarray(k * 4, k * 4 + 4));
  }
  // the overview's copy of one chunk, painted again (for trodden ground seen from far away)
  repaintOverview(k, heights = false) {
    const gl = this.G.gl, cx = k % NCH, cy = k / NCH | 0, ox = cx * CH, oy = cy * CH;
    gl.bindVertexArray(this.G.vao);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbA); gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.albO, 0); gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
    gl.enable(gl.SCISSOR_TEST); gl.scissor(ox * OV, oy * OV, CH * OV, CH * OV);
    gl.viewport(0, 0, MAP * OV, MAP * OV);
    this.uniforms(this.pA, 0, 0, MAP, MAP * OV, 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
    const list = propsIn(this.W, ox - 2, oy - 2, ox + CH + 2, oy + CH + 2);
    this.stamp(list.slice(), 0, 0, MAP, false);
    if (heights) {
      this.bindHM(this.hmO, this.matO, -1); gl.scissor(ox * OVH, oy * OVH, CH * OVH, CH * OVH); gl.viewport(0, 0, MAP * OVH, MAP * OVH);
      this.uniforms(this.pH, 0, 0, MAP, MAP * OVH, 0); gl.drawArrays(gl.TRIANGLES, 0, 3);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.NONE]); this.stamp(list, 0, 0, MAP, true);
    }
    gl.disable(gl.SCISSOR_TEST); gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  }
  // the lander came down: the ground it burned and cleared is painted again, near and far
  patch(W, rect) {
    const gl = this.G.gl; this.W = W;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.bindTexture(gl.TEXTURE_2D, this.tType); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, MAP, MAP, gl.RED, gl.UNSIGNED_BYTE, W.type);
    gl.bindTexture(gl.TEXTURE_2D, this.tField); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, MAP, MAP, gl.RGBA, gl.UNSIGNED_BYTE, fieldOf(W));
    const [x0, y0, x1, y1] = rect;
    for (let cy = Math.max(0, Math.floor(y0 / CH)); cy <= Math.min(NCH - 1, Math.floor(y1 / CH)); cy++) for (let cx = Math.max(0, Math.floor(x0 / CH)); cx <= Math.min(NCH - 1, Math.floor(x1 / CH)); cx++) {
      const k = cy * NCH + cx; if (this.chunkSlot[k] >= 0) this.stale[k] = 1; if (this.ready) this.repaintOverview(k, true);
    }
    if (this.ready) { gl.bindTexture(gl.TEXTURE_2D, this.albO); gl.generateMipmap(gl.TEXTURE_2D); gl.bindTexture(gl.TEXTURE_2D, this.matO); gl.generateMipmap(gl.TEXTURE_2D); }
  }
  // ground that changed kind (burnt, or grown back): the kind map goes up again and its chunks are repainted
  retype(W, tiles) {
    const gl = this.G.gl; this.W = W;
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.bindTexture(gl.TEXTURE_2D, this.tType); gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, MAP, MAP, gl.RED, gl.UNSIGNED_BYTE, W.type);
    const ks = new Set(); for (const t of tiles) ks.add(((t / MAP | 0) / CH | 0) * NCH + ((t % MAP) / CH | 0));
    for (const k of ks) { if (this.chunkSlot[k] >= 0) this.stale[k] = 1; this.ovStale.add(k); }
  }
  // what the Seed has seen, one chunk at a time (0 unseen, 255 seen)
  setKnown(k, data) { this.sub(this.tKnown, k, data); }

  // new trodden ground from the simulation, one chunk at a time
  setWear(k, data) {
    this.sub(this.tWear, k, data);
    if (this.chunkSlot[k] >= 0) this.stale[k] = 1;
    this.ovStale.add(k);
  }
  // trees felled and boulders broken up: the chunks around them are painted again without them, near and far
  propsGone(tiles) {
    const ks = new Set();
    for (const t of tiles) { const x = t % MAP, y = t / MAP | 0; for (const [ox, oy] of [[-2, -2], [2, -2], [-2, 2], [2, 2]]) { const X = Math.min(MAP - 1, Math.max(0, x + ox)), Y = Math.min(MAP - 1, Math.max(0, y + oy)); ks.add((Y / CH | 0) * NCH + (X / CH | 0)); } }
    for (const k of ks) { if (this.chunkSlot[k] >= 0) this.stale[k] = 1; this.ovStale.add(k); this.ovH.add(k); }
  }
  sub(tex, k, data) {
    const gl = this.G.gl, cx = k % NCH, cy = k / NCH | 0, x0 = cx * CH, y0 = cy * CH, w = Math.min(CH, MAP - x0), h = Math.min(CH, MAP - y0);
    let d = data; if (w < CH || h < CH) { d = new Uint8Array(w * h); for (let y = 0; y < h; y++) d.set(data.subarray(y * CH, y * CH + w), y * w); }
    gl.bindTexture(gl.TEXTURE_2D, tex); gl.texSubImage2D(gl.TEXTURE_2D, 0, x0, y0, w, h, gl.RED, gl.UNSIGNED_BYTE, d);
  }

  // called every frame with the visible tile rectangle and the zoom in device pixels per tile
  update(L, Tp, R, B, ppt, now, budget = 2) {
    if (!this.ready) { this.paintOverviewStep(); return; }
    const t0 = performance.now(); let painted = 0;
    if (ppt >= 9) {
      const cx0 = Math.max(0, Math.floor(L / CH) - 1), cy0 = Math.max(0, Math.floor(Tp / CH) - 1), cx1 = Math.min(NCH - 1, Math.floor(R / CH) + 1), cy1 = Math.min(NCH - 1, Math.floor(B / CH) + 1);
      const mx = (L + R) / 2, my = (Tp + B) / 2, want = [];
      for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
        const k = cy * NCH + cx, vis = (cx + 1) * CH > L && cx * CH < R && (cy + 1) * CH > Tp && cy * CH < B;
        const d = Math.hypot((cx + .5) * CH - mx, (cy + .5) * CH - my) + (vis ? 0 : 1000);
        want.push([d, k, vis]);
      }
      want.sort((a, b) => a[0] - b[0]);
      const keep = want.slice(0, LAYERS);
      for (const [, k] of keep) if (this.chunkSlot[k] >= 0) this.slotSeen[this.chunkSlot[k]] = now;
      for (const [, k, vis] of keep) {
        if (painted >= budget) break;
        const s = this.chunkSlot[k];
        if (s >= 0 && !(this.stale[k] && vis)) continue;
        const slot = s >= 0 ? s : this.freeSlot(now); if (slot < 0) break;
        this.paintChunk(k, slot); this.slotSeen[slot] = now; painted++;
        if (s >= 0) this.stats.repainted++; else this.stats.painted++;
      }
      if (painted) { const gl = this.G.gl; gl.bindTexture(gl.TEXTURE_2D_ARRAY, this.albA); gl.generateMipmap(gl.TEXTURE_2D_ARRAY); }
    }
    // far away, the overview catches up on trodden ground now and then
    if (this.ovStale.size && now - this.lastOv > 400 && painted < budget) {
      const k = this.ovStale.values().next().value; this.ovStale.delete(k); this.repaintOverview(k, this.ovH.delete(k)); this.lastOv = now; this.ovDirty = true;
    }
    if (this.ovDirty && now - (this.lastOvMip || 0) > 2500) { const gl = this.G.gl; gl.bindTexture(gl.TEXTURE_2D, this.albO); gl.generateMipmap(gl.TEXTURE_2D); this.ovDirty = false; this.lastOvMip = now; }
    this.stats.ms = performance.now() - t0;
  }
  freeSlot(now) {
    let best = -1, bt = Infinity;
    for (let s = 0; s < LAYERS; s++) { if (this.slotChunk[s] < 0) return s; if (this.slotSeen[s] < now && this.slotSeen[s] < bt) { bt = this.slotSeen[s]; best = s; } }
    return best;
  }
  dispose() {
    const gl = this.G.gl;
    for (const t of [this.tType, this.tField, this.tWear, this.tKnown, this.albA, this.hmA, this.matA, this.albO, this.hmO, this.matO, this.tTable, this.tSprite, this.tSpriteH]) gl.deleteTexture(t);
    gl.deleteFramebuffer(this.fbA); gl.deleteFramebuffer(this.fbH); gl.deleteBuffer(this.bP); gl.deleteBuffer(this.bU); gl.deleteVertexArray(this.svao);
  }
  get cached() { let n = 0; for (const c of this.slotChunk) if (c >= 0) n++; return n; }
}

// height, moisture, water depth and bare rock per tile, as the painters read them
function fieldOf(W) {
  const N = MAP * MAP, field = new Uint8Array(N * 4);
  for (let i = 0; i < N; i++) { const t = W.type[i]; field[i * 4] = W.elev[i]; field[i * 4 + 1] = W.moist[i]; field[i * 4 + 2] = t === T.DEEP ? 255 : t === T.SHALLOW ? 115 : 0; field[i * 4 + 3] = t === T.ROCK ? 255 : 0; }
  return field;
}

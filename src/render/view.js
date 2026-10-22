// One frame: people and the Seed go onto a screen-sized layer (with their heights on another), then the
// GPU composes the painted map, light, shadow and water. Also the camera and the minimap.
import { MAP, T } from '../core/consts.js';
import { clamp, sstep } from '../core/rng.js';
import { createGL } from './gl.js';
import { FS_H, FS_L, FS_C } from './shaders.js';
import { Terrain } from './terrain.js';
import { env, pickLights } from './env.js';
import { drawPerson, drawDot, makeSeed, crewColour } from './people.js';

const mul3 = (a, f) => [a[0] * f, a[1] * f, a[2] * f];
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0); return c; };
const hcol = (top, base) => `rgb(${Math.round(clamp(top / 4, 0, 1) * 255)},${Math.round(clamp(1 - base / 4, 0, 1) * 255)},0)`;
export const ZMIN = 1.2, ZMAX = 72;

export class View {
  constructor(app, W) {
    this.app = app; this.W = W;
    this.glc = app.querySelector('#gl'); this.uic = app.querySelector('#ui'); this.ui = this.uic.getContext('2d');
    this.dyn = mk(4, 4); this.dc = this.dyn.getContext('2d'); this.dynh = mk(4, 4); this.hc = this.dynh.getContext('2d');
    this.cam = { x: W.land.x + .5, y: W.land.y + 3, z: 30 };
    this.G = createGL(this.glc);
    if (this.G) {
      const G = this.G;
      this.P = { h: G.prog(FS_H), l: G.prog(FS_L), c: G.prog(FS_C) };
      this.terrain = new Terrain(G, W);
      this.ok = !!(this.P.h && this.P.l && this.P.c && this.terrain.ok);
      this.tDyn = G.tex2D(4, 4); this.tDH = G.tex2D(4, 4);
    }
    this.seed = makeSeed();
    this.posts = [];
    for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + .2; this.posts.push({ x: W.land.x + Math.cos(a) * 5.2, y: W.land.y + Math.sin(a) * 5.2 }); }
    this.LP = new Float32Array(96); this.LC = new Float32Array(96);
    this.labels = false; this.stats = { lights: 0, lightsInView: 0, people: 0 };
    this.mm = app.querySelector('#mm'); this.mmBase = this.minimapBase();
    this.resize();
  }
  // a new landing: new planet, same window
  setWorld(W) {
    this.W = W; this.terrain.dispose(); this.terrain = new Terrain(this.G, W);
    this.cam = { x: W.land.x + .5, y: W.land.y + 3, z: this.cam.z };
    this.posts = []; for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + .2; this.posts.push({ x: W.land.x + Math.cos(a) * 5.2, y: W.land.y + Math.sin(a) * 5.2 }); }
    this.mmBase = this.minimapBase(); this.clampCam();
  }
  resize() {
    const r = this.app.getBoundingClientRect(); this.VW = Math.max(1, r.width); this.VH = Math.max(1, r.height); this.DPR = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(this.VW * this.DPR), H = Math.round(this.VH * this.DPR);
    for (const c of [this.glc, this.uic, this.dyn]) { c.width = W; c.height = H; }
    this.LW = Math.max(1, Math.round(this.VW * .5)); this.LH = Math.max(1, Math.round(this.VH * .5)); this.dynh.width = this.LW; this.dynh.height = this.LH;
    if (this.G) { const G = this.G; G.free(this.rtH); G.free(this.rtL); this.rtH = G.rt(this.LW, this.LH, false); this.rtL = G.rt(this.LW, this.LH, G.float); if (!this.rtL.ok) { G.float = false; this.rtL = G.rt(this.LW, this.LH, false); } }
    this.clampCam();
  }
  clampCam() {
    const c = this.cam; c.z = clamp(c.z, Math.max(ZMIN, Math.min(this.VW, this.VH) / MAP * .8), ZMAX);
    const hw = this.VW / 2 / c.z, hh = this.VH / 2 / c.z, m = 8;
    c.x = hw * 2 > MAP + m * 2 ? MAP / 2 : clamp(c.x, hw - m, MAP - hw + m); c.y = hh * 2 > MAP + m * 2 ? MAP / 2 : clamp(c.y, hh - m, MAP - hh + m);
  }
  get rect() { const c = this.cam, L = c.x - this.VW / 2 / c.z, T = c.y - this.VH / 2 / c.z; return [L, T, L + this.VW / c.z, T + this.VH / c.z]; }
  toWorld(sx, sy) { const [L, T] = this.rect; return [L + sx / this.cam.z, T + sy / this.cam.z]; }
  zoomAt(f, sx, sy) { const [wx, wy] = this.toWorld(sx, sy); this.cam.z *= f; this.clampCam(); const [nx, ny] = this.toWorld(sx, sy); this.cam.x += wx - nx; this.cam.y += wy - ny; this.clampCam(); }

  // ---------- the frame ----------
  frame(F) {
    const G = this.G, gl = G.gl, now = performance.now(), [L, Tp, R, B] = this.rect, z = this.cam.z, ppt = z * this.DPR;
    this.terrain.update(L, Tp, R, B, ppt, now, F.budget || 2);
    const E = env(F.hour);
    this.drawDyn(F, L, Tp, R, B, E);
    const lights = this.lights(F, E);
    const { lit, inView } = pickLights(lights, this.cam.x, this.cam.y, [L - 6, Tp - 6, R + 6, B + 6]);
    this.stats.lights = lit.length; this.stats.lightsInView = inView;
    this.LP.fill(0); this.LC.fill(0); lit.forEach((l, i) => { this.LP.set([l.x, l.y, l.z, l.r], i * 4); this.LC.set([l.c[0], l.c[1], l.c[2], l.g || 0], i * 4); });
    G.upload(this.tDyn, this.dyn, true); G.upload(this.tDH, this.dynh, false);
    const cam4 = [L, Tp, this.VW / z, this.VH / z], T = this.terrain;
    gl.bindVertexArray(G.vao); gl.disable(gl.BLEND);
    const look = (u, base) => { G.bind(u.uTable, base, T.tTable); G.bind(u.uAlbO, base + 1, T.albO); G.bind(u.uHmO, base + 2, T.hmO); G.bind(u.uMatO, base + 3, T.matO); G.bind(u.uAlbA, base + 4, T.albA, gl.TEXTURE_2D_ARRAY); G.bind(u.uHmA, base + 5, T.hmA, gl.TEXTURE_2D_ARRAY); G.bind(u.uMatA, base + 6, T.matA, gl.TEXTURE_2D_ARRAY); gl.uniform1f(u.uMap, MAP); };
    // height
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.rtH.fb); gl.viewport(0, 0, this.LW, this.LH); gl.useProgram(this.P.h.p); let u = this.P.h.u;
    look(u, 0); G.bind(u.uDH, 7, this.tDH); gl.uniform2f(u.uRes, this.LW, this.LH); gl.uniform4fv(u.uCam, cam4); gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.bindTexture(gl.TEXTURE_2D, this.rtH.t); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR); gl.generateMipmap(gl.TEXTURE_2D);
    // light
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.rtL.fb); gl.useProgram(this.P.l.p); u = this.P.l.u;
    look(u, 0); G.bind(u.uH, 7, this.rtH.t); gl.uniform2f(u.uRes, this.LW, this.LH); gl.uniform4fv(u.uCam, cam4); gl.uniform2f(u.uWind, .016, .006);
    gl.uniform3fv(u.uKeyDir, E.key); gl.uniform3fv(u.uKeyCol, E.kc); gl.uniform3fv(u.uAmb, E.amb); gl.uniform1f(u.uNight, E.night); gl.uniform1f(u.uTime, F.time); gl.uniform1f(u.uCloud, E.cloud); gl.uniform1f(u.uEnc, G.float ? 0 : 1); gl.uniform1f(u.uPPT, this.LW / (this.VW / z));
    gl.uniform4fv(u.uLP, this.LP); gl.uniform4fv(u.uLC, this.LC); gl.uniform1i(u.uNL, lit.length); gl.drawArrays(gl.TRIANGLES, 0, 3);
    // composite
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); gl.viewport(0, 0, this.glc.width, this.glc.height); gl.useProgram(this.P.c.p); u = this.P.c.u;
    look(u, 0); G.bind(u.uDyn, 7, this.tDyn); G.bind(u.uLight, 8, this.rtL.t); G.bind(u.uH, 9, this.rtH.t);
    gl.uniform2f(u.uRes, this.glc.width, this.glc.height); gl.uniform4fv(u.uCam, cam4); gl.uniform1f(u.uTime, F.time); gl.uniform1f(u.uExposure, E.exp); gl.uniform1f(u.uSat, E.sat); gl.uniform1f(u.uMist, E.mist); gl.uniform1f(u.uNight, E.night); gl.uniform1f(u.uEnc, G.float ? 0 : 1); gl.uniform1f(u.uVig, .5);
    gl.uniform3fv(u.uKeyDir, E.key); gl.uniform3fv(u.uKeyCol, E.kc); gl.uniform3fv(u.uSky, E.sky); gl.uniform3fv(u.uFog, mul3(E.amb.map((v, i) => v + ([.9, .85, .8][i] - v) * .3), 1.1)); gl.uniform3fv(u.uLift, E.lift); gl.uniform3fv(u.uGain, E.gain);
    gl.uniform4fv(u.uLP, this.LP); gl.uniform4fv(u.uLC, this.LC); gl.uniform1i(u.uNL, lit.length); gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.drawUI(F, L, Tp);
    this.E = E;
  }

  drawDyn(F, L, Tp, R, B, E) {
    const dc = this.dc, hc = this.hc, z = this.cam.z, k = z * this.DPR, kh = z * this.LW / this.VW;
    dc.setTransform(1, 0, 0, 1, 0, 0); dc.clearRect(0, 0, this.dyn.width, this.dyn.height); dc.setTransform(k, 0, 0, k, -L * k, -Tp * k); dc.imageSmoothingQuality = 'high';
    hc.setTransform(1, 0, 0, 1, 0, 0); hc.globalCompositeOperation = 'source-over'; hc.fillStyle = '#000'; hc.fillRect(0, 0, this.LW, this.LH); hc.setTransform(kh, 0, 0, kh, -L * kh, -Tp * kh); hc.globalCompositeOperation = 'lighten';
    const vis = (x, y, m) => x > L - m && x < R + m && y > Tp - m && y < B + m;
    const hDisc = (x, y, r, top, base) => { hc.fillStyle = hcol(top, base || 0); hc.beginPath(); hc.arc(x, y, r, 0, 6.2832); hc.fill(); };
    const Ld = this.W.land;
    // the Seed and its lamp posts
    if (vis(Ld.x, Ld.y, 5)) {
      const s = this.seed.size; dc.drawImage(this.seed.cv, Ld.x - s / 2, Ld.y - s / 2, s, s);
      hDisc(Ld.x, Ld.y, 1.5, 1.6); hDisc(Ld.x, Ld.y, .75, 2.3);
      for (const p of this.posts) { dc.fillStyle = 'rgba(0,0,0,.3)'; dc.beginPath(); dc.arc(p.x + .05, p.y + .06, .16, 0, 6.3); dc.fill(); dc.fillStyle = '#6d7680'; dc.beginPath(); dc.arc(p.x, p.y, .14, 0, 6.3); dc.fill(); dc.fillStyle = E.night > .3 ? '#ffe2b0' : '#c9d2da'; dc.beginPath(); dc.arc(p.x, p.y, .08, 0, 6.3); dc.fill(); hDisc(p.x, p.y, .12, 1.3); }
    }
    // people, back to front
    const n = F.n, pos = F.pos, arts = F.arts, near = k >= 9, order = this.order || (this.order = []);
    order.length = 0;
    for (let i = 0; i < n; i++) { const x = pos[i * 4], y = pos[i * 4 + 1]; if (vis(x, y, 1.5)) order.push(i); }
    this.stats.people = order.length;
    if (near) {
      order.sort((a, b) => pos[a * 4 + 1] - pos[b * 4 + 1]);
      for (const i of order) { const o = i * 4, f = pos[o + 3], mode = f >> 1, mv = f & 1; drawPerson(dc, arts[i], pos[o], pos[o + 1], pos[o + 2], mv, mode, F.time); if (mode !== 0) hDisc(pos[o], pos[o + 1], .28, 1.2); else hDisc(pos[o], pos[o + 1], .3, .3); }
    } else {
      const r = Math.max(.35, 2.2 / k);
      for (const i of order) drawDot(dc, arts[i], pos[i * 4], pos[i * 4 + 1], r);
    }
    hc.globalCompositeOperation = 'source-over';
  }

  lights(F, E) {
    const out = [], on = sstep(.15, .55, E.night), Ld = this.W.land, t = F.time;
    const fl = (k, sp) => .88 + .08 * Math.sin(t * sp + k) + .05 * Math.sin(t * sp * 2.7 + k * 3.1);
    out.push({ x: Ld.x, y: Ld.y, z: 2.6, r: 8 + 3 * on, c: mul3([.42, .82, 1], .7 + 1.5 * on), g: .55 });
    if (on > .01) {
      this.posts.forEach((p, i) => out.push({ x: p.x, y: p.y, z: 1.35, r: 6.5, c: mul3([1, .66, .36], 2.2 * on * fl(i, 3)), g: .25 }));
      for (let i = 0; i < 4; i++) { const a = i * Math.PI / 2 + Math.PI / 4, blink = (Math.sin(t * 2.2 + i * 1.3) > .6) ? 1 : .15; out.push({ x: Ld.x + Math.cos(a) * 2.1, y: Ld.y + Math.sin(a) * 2.1, z: .6, r: 2.6, c: mul3([1, .25, .2], 1.4 * on * blink), g: .15 }); }
      // each crew's lead carries a lantern after dark
      for (const i of F.leads) { const o = i * 4, mode = F.pos[o + 3] >> 1; if (mode === 0) continue; out.push({ x: F.pos[o], y: F.pos[o + 1], z: 1.1, r: 6, c: mul3([1, .62, .3], 1.9 * on * fl(i, 7)), g: .3 }); }
    }
    this.stats.lightsAll = out.length;
    return out;
  }

  drawUI(F, L, Tp) {
    const ui = this.ui, z = this.cam.z, D = this.DPR;
    ui.setTransform(1, 0, 0, 1, 0, 0); ui.clearRect(0, 0, this.uic.width, this.uic.height); ui.setTransform(D, 0, 0, D, 0, 0);
    const sx = x => (x - L) * z, sy = y => (y - Tp) * z, fs = clamp(z * .36, 10, 12.5);
    ui.font = `700 ${fs}px Manrope,system-ui,sans-serif`; ui.textAlign = 'center'; ui.textBaseline = 'middle';
    const label = (i, strong) => {
      const o = i * 4, X = sx(F.pos[o]), Y = sy(F.pos[o + 1]); if (X < -60 || Y < -40 || X > this.VW + 60 || Y > this.VH + 40) return;
      const name = F.names[i], ly = Y + Math.max(10, z * .62) + fs * .2, tw = ui.measureText(name).width + 12;
      ui.fillStyle = strong ? 'rgba(243,182,92,.9)' : 'rgba(10,14,20,.58)'; ui.beginPath(); ui.roundRect(X - tw / 2, ly - fs * .65, tw, fs * 1.3, fs * .65); ui.fill();
      ui.fillStyle = strong ? '#1a1206' : '#f2f4f8'; ui.fillText(name, X, ly + .5);
    };
    if (this.labels && z >= 14) for (const i of this.order) if (i !== F.sel) label(i, false);
    if (F.hover >= 0 && F.hover !== F.sel) label(F.hover, false);
    if (F.sel >= 0) {
      const o = F.sel * 4, X = sx(F.pos[o]), Y = sy(F.pos[o + 1]), r = Math.max(9, z * .56) + Math.sin(F.time * 4) * 1.2, l = Math.max(5, z * .16);
      ui.strokeStyle = 'rgba(255,236,190,.95)'; ui.lineWidth = 1.6; ui.shadowColor = 'rgba(0,0,0,.6)'; ui.shadowBlur = 4; ui.beginPath();
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { ui.moveTo(X + a * r, Y + b * (r - l)); ui.lineTo(X + a * r, Y + b * r); ui.lineTo(X + a * (r - l), Y + b * r); }
      ui.stroke(); ui.shadowBlur = 0; label(F.sel, true);
    }
  }

  // ---------- the minimap ----------
  minimapBase() {
    const C = [[92, 118, 62], [128, 102, 72], [196, 178, 136], [64, 112, 120], [28, 54, 82], [86, 83, 80], [124, 118, 108], [74, 96, 74], [50, 82, 50], [60, 52, 44]];
    const cv = mk(MAP, MAP), g = cv.getContext('2d'), id = g.createImageData(MAP, MAP), W = this.W;
    for (let i = 0; i < MAP * MAP; i++) { const c = C[W.type[i]], e = .82 + W.elev[i] / 255 * .3, o = i * 4; id.data[o] = c[0] * e; id.data[o + 1] = c[1] * e; id.data[o + 2] = c[2] * e; id.data[o + 3] = 255; }
    g.putImageData(id, 0, 0); return cv;
  }
  drawMinimap(F) {
    const m = this.mm; if (!m) return; const D = this.DPR, S = m.clientWidth || 180;
    if (m.width !== Math.round(S * D)) { m.width = m.height = Math.round(S * D); }
    const g = m.getContext('2d'), k = m.width / MAP;
    g.setTransform(1, 0, 0, 1, 0, 0); g.imageSmoothingEnabled = true; g.drawImage(this.mmBase, 0, 0, m.width, m.height);
    g.fillStyle = 'rgba(8,12,18,.25)'; g.fillRect(0, 0, m.width, m.height);
    for (let i = 0; i < F.n; i++) { const c = F.arts[i].L.app; g.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`; g.fillRect(F.pos[i * 4] * k - D, F.pos[i * 4 + 1] * k - D, 2 * D, 2 * D); }
    const Ld = this.W.land; g.strokeStyle = '#8fe0ff'; g.lineWidth = 1.5 * D; g.beginPath(); g.arc(Ld.x * k, Ld.y * k, 4 * D, 0, 6.3); g.stroke();
    const [L, T, R, B] = this.rect; g.strokeStyle = 'rgba(255,236,190,.9)'; g.lineWidth = 1.2 * D; g.strokeRect(L * k, T * k, (R - L) * k, (B - T) * k);
  }
}
export { crewColour };

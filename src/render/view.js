// One frame: people, the Seed and the camp go onto a screen-sized layer (with their heights on another), then
// the GPU composes the painted map, light, shadow, water and the ground not yet surveyed. Also the camera,
// the view from orbit before the landing, the landing itself, and the minimap.
import { MAP, CH, ACT, hidden } from '../core/consts.js';
import { clamp, sstep, hash } from '../core/rng.js';
import { drawBuilding, drawYard, drawCargo, drawMarks, buildingLights, progress } from './buildings.js';
import { stagesOf, TYPES } from '../core/build.js';
import { createGL } from './gl.js';
import { FS_H, FS_L, FS_C } from './shaders.js';
import { Terrain } from './terrain.js';
import { env, pickLights } from './env.js';
import { fireOn, skyAt, doyOf, seasonOf } from '../core/year.js';
import { drawLife, placeLife } from '../core/food.js';
import { drawPatch, drawKitchen } from './life.js';
import { drawPerson, drawDot, makeSeed, crewColour } from './people.js';

const mul3 = (a, f) => [a[0] * f, a[1] * f, a[2] * f];
const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0); return c; };
const hcol = (top, base) => `rgb(${Math.round(clamp(top / 4, 0, 1) * 255)},${Math.round(clamp(1 - base / 4, 0, 1) * 255)},0)`;
const ease = t => 1 - Math.pow(1 - t, 3);
export const ZMIN = 1.2, ZMAX = 72;
export const LETTERS = 'ABC';
const LAND_MS = 2600;

export class View {
  constructor(app, W) {
    this.app = app; this.W = W;
    this.glc = app.querySelector('#gl'); this.uic = app.querySelector('#ui'); this.ui = this.uic.getContext('2d');
    this.dyn = mk(4, 4); this.dc = this.dyn.getContext('2d'); this.dynh = mk(4, 4); this.hc = this.dynh.getContext('2d');
    this.cam = W.land ? { x: W.land.x + .5, y: W.land.y + 3, z: 30 } : { x: MAP / 2, y: MAP / 2, z: 1 };
    this.G = createGL(this.glc);
    if (this.G) {
      const G = this.G;
      this.P = { h: G.prog(FS_H), l: G.prog(FS_L), c: G.prog(FS_C) };
      this.terrain = new Terrain(G, W);
      this.ok = !!(this.P.h && this.P.l && this.P.c && this.terrain.ok);
      this.tDyn = G.tex2D(4, 4); this.tDH = G.tex2D(4, 4);
    }
    this.seed = makeSeed();
    this.LP = new Float32Array(96); this.LC = new Float32Array(96);
    this.labels = false; this.stats = { lights: 0, lightsInView: 0, people: 0 }; this.order = [];
    this.fly = null; this.anim = null; this.fog = !!W.land;
    this.mm = app.querySelector('#mm'); this.mmBase = this.minimapBase(); this.mmFog = this.fogBase();
    this.resize();
  }
  // a new planet, same window
  setWorld(W) {
    this.W = W; this.life = null; this.terrain.dispose(); this.terrain = new Terrain(this.G, W);
    this.cam = W.land ? { x: W.land.x + .5, y: W.land.y + 3, z: Math.max(this.cam.z, 24) } : { x: MAP / 2, y: MAP / 2, z: 1 };
    this.fly = null; this.anim = null; this.fog = !!W.land;
    this.mmBase = this.minimapBase(); this.mmFog = this.fogBase(); this.clampCam();
  }
  // the lander comes down where the player chose: the ground it changed is painted again, and it descends
  land(W, rect) {
    this.W = W; this.life = null; this.terrain.patch(W, rect); this.fog = true;
    this.mmBase = this.minimapBase(); this.mmFog = this.fogBase();
    this.anim = { t0: performance.now() };
    this.flyTo(W.land.x + .5, W.land.y + 2, 26);
  }
  get landing() { return !!this.anim && performance.now() - this.anim.t0 < LAND_MS; }
  setKnown(k, data) {
    this.terrain.setKnown(k, data);
    const g = this.mmFog.getContext('2d'), x0 = (k % Math.ceil(MAP / CH)) * CH, y0 = Math.floor(k / Math.ceil(MAP / CH)) * CH, id = g.createImageData(CH, CH);
    for (let i = 0; i < CH * CH; i++) { id.data[i * 4] = 10; id.data[i * 4 + 1] = 14; id.data[i * 4 + 2] = 24; id.data[i * 4 + 3] = data[i] ? 0 : 150; }
    g.putImageData(id, x0, y0);
  }
  resize() {
    const r = this.app.getBoundingClientRect(); this.VW = Math.max(1, r.width); this.VH = Math.max(1, r.height); this.DPR = Math.min(2, window.devicePixelRatio || 1);
    const W = Math.round(this.VW * this.DPR), H = Math.round(this.VH * this.DPR);
    for (const c of [this.glc, this.uic, this.dyn]) { c.width = W; c.height = H; }
    this.LW = Math.max(1, Math.round(this.VW * .5)); this.LH = Math.max(1, Math.round(this.VH * .5)); this.dynh.width = this.LW; this.dynh.height = this.LH;
    if (this.G) { const G = this.G; G.free(this.rtH); G.free(this.rtL); this.rtH = G.rt(this.LW, this.LH, false); this.rtL = G.rt(this.LW, this.LH, G.float); if (!this.rtL.ok) { G.float = false; this.rtL = G.rt(this.LW, this.LH, false); } }
    this.clampCam();
  }
  get zFit() { return Math.max(ZMIN, Math.min(this.VW, this.VH) / MAP * .8); }
  clampCam() {
    const c = this.cam; c.z = clamp(c.z, this.zFit, ZMAX);
    const hw = this.VW / 2 / c.z, hh = this.VH / 2 / c.z, m = 8;
    c.x = hw * 2 > MAP + m * 2 ? MAP / 2 : clamp(c.x, hw - m, MAP - hw + m); c.y = hh * 2 > MAP + m * 2 ? MAP / 2 : clamp(c.y, hh - m, MAP - hh + m);
  }
  get rect() { const c = this.cam, L = c.x - this.VW / 2 / c.z, T = c.y - this.VH / 2 / c.z; return [L, T, L + this.VW / c.z, T + this.VH / c.z]; }
  toWorld(sx, sy) { const [L, T] = this.rect; return [L + sx / this.cam.z, T + sy / this.cam.z]; }
  toScreen(wx, wy) { const [L, T] = this.rect; return [(wx - L) * this.cam.z, (wy - T) * this.cam.z]; }
  zoomAt(f, sx, sy) { this.fly = null; const [wx, wy] = this.toWorld(sx, sy); this.cam.z *= f; this.clampCam(); const [nx, ny] = this.toWorld(sx, sy); this.cam.x += wx - nx; this.cam.y += wy - ny; this.clampCam(); }
  // a smooth camera move: zooms out a little on the way when the trip is long
  flyTo(x, y, z) { this.fly = { x, y, z, t0: performance.now(), from: { ...this.cam } }; }
  step(dt) {
    const f = this.fly; if (!f) return;
    const t = clamp((performance.now() - f.t0) / 1400, 0, 1), e = t * t * (3 - 2 * t), c = this.cam, A = f.from;
    const zl = Math.log(A.z) + (Math.log(f.z) - Math.log(A.z)) * e, dist = Math.hypot(f.x - A.x, f.y - A.y), dip = Math.min(1.2, dist / 120) * Math.sin(e * Math.PI);
    c.x = A.x + (f.x - A.x) * e; c.y = A.y + (f.y - A.y) * e; c.z = Math.exp(zl - dip);
    this.clampCam(); if (t >= 1) this.fly = null;
  }

  // ---------- the frame ----------
  frame(F) {
    const G = this.G, gl = G.gl, [L, Tp, R, B] = this.rect, z = this.cam.z, ppt = z * this.DPR;
    this.terrain.update(L, Tp, R, B, ppt, performance.now(), F.budget || 2);
    const X = this.sky(F), E = env(F.hour, X);
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
    look(u, 0); G.bind(u.uDyn, 7, this.tDyn); G.bind(u.uLight, 8, this.rtL.t); G.bind(u.uH, 9, this.rtH.t); G.bind(u.uKnown, 10, T.tKnown); gl.uniform1f(u.uFogOn, this.fog ? 1 : 0);
    gl.uniform2f(u.uRes, this.glc.width, this.glc.height); gl.uniform4fv(u.uCam, cam4); gl.uniform1f(u.uTime, F.time); gl.uniform1f(u.uExposure, E.exp); gl.uniform1f(u.uSat, E.sat); gl.uniform1f(u.uMist, E.mist); gl.uniform1f(u.uNight, E.night); gl.uniform1f(u.uEnc, G.float ? 0 : 1); gl.uniform1f(u.uVig, .5);
    gl.uniform3fv(u.uKeyDir, E.key); gl.uniform3fv(u.uKeyCol, E.kc); gl.uniform3fv(u.uSky, E.sky); gl.uniform3fv(u.uFog, mul3(E.amb.map((v, i) => v + ([.9, .85, .8][i] - v) * .3), 1.1)); gl.uniform3fv(u.uLift, E.lift); gl.uniform3fv(u.uGain, E.gain);
    gl.uniform1f(u.uSnowC, X ? X.cover : 0); gl.uniform1f(u.uIce, X ? X.ice : 0); gl.uniform1f(u.uWet, X ? X.wet : 0); gl.uniform2f(u.uSeas, X ? X.aut : 0, X ? X.wint : 0);
    gl.uniform4f(u.uPrec, X ? X.rain : 0, X ? X.snow : 0, X ? X.wind : 0, 0);
    { const k = .12 + .5 * (1 - E.night) * (X ? 1 - X.cloud * .4 : 1); gl.uniform3f(u.uPC, k * .9, k * .95, k * 1.05); }
    gl.uniform4fv(u.uLP, this.LP); gl.uniform4fv(u.uLC, this.LC); gl.uniform1i(u.uNL, lit.length); gl.drawArrays(gl.TRIANGLES, 0, 3);
    this.drawUI(F, L, Tp);
    this.E = E;
  }

  // the day's sky and ground for the drawing: weather eased in from yesterday's, the real dawn and dusk, snow
  // and ice from the simulation, the season's colour on the growth, and now and then lightning in a storm
  sky(F) {
    const C = F.colony; if (!C || !C.year) return null;
    const Y = C.year, d = C.day || 1, w = skyAt(this.W.seed, d, F.hour), doy = doyOf(d) + F.hour / 24;
    const aut = sstep(40, 52, doy) * (1 - sstep(58, 63, doy)), wint = doy >= 56 ? sstep(57, 64, doy) : 1 - sstep(2, 12, doy);
    let flash = 0;
    if (w.storm > .3) { const q = F.time * .45, n = Math.floor(q), f = q - n; if (hash(n, 7, 31) < .3 * w.storm) flash = Math.max(0, 1 - f / .05) * (f < .05 ? 1 : 0) + (f > .08 && f < .1 ? .6 : 0); }
    return { dawn: Y.dawn, dusk: Y.dusk, cloud: w.cloud, rain: w.rain, snow: w.snow, wind: w.wind, fog: w.fog, wet: Math.min(1, w.wet * (Y.temp > 0 ? 1 : .3)), cover: Y.snow, ice: Y.ice, aut, wint, flash };
  }

  drawDyn(F, L, Tp, R, B, E) {
    const dc = this.dc, hc = this.hc, z = this.cam.z, k = z * this.DPR, kh = z * this.LW / this.VW;
    dc.setTransform(1, 0, 0, 1, 0, 0); dc.clearRect(0, 0, this.dyn.width, this.dyn.height); dc.setTransform(k, 0, 0, k, -L * k, -Tp * k); dc.imageSmoothingQuality = 'high';
    hc.setTransform(1, 0, 0, 1, 0, 0); hc.globalCompositeOperation = 'source-over'; hc.fillStyle = '#000'; hc.fillRect(0, 0, this.LW, this.LH); hc.setTransform(kh, 0, 0, kh, -L * kh, -Tp * kh); hc.globalCompositeOperation = 'lighten';
    const vis = (x, y, m) => x > L - m && x < R + m && y > Tp - m && y < B + m;
    const hDisc = (x, y, r, top, base) => { hc.fillStyle = hcol(top, base || 0); hc.beginPath(); hc.arc(x, y, r, 0, 6.2832); hc.fill(); };
    const hRect = (x, y, w, h, top, base) => { hc.fillStyle = hcol(top, base || 0); hc.fillRect(x, y, w, h); };
    const Ld = this.W.land;
    this.stats.people = 0;
    if (!Ld) { hc.globalCompositeOperation = 'source-over'; return; }
    const C = F.colony, site = this.W.site;
    if (C) {
      drawMarks(dc, hRect, this.W, vis);
      this.drawLife(dc, hDisc, C, L, Tp, R, B, k, E, F.time);
      for (const p of C.projects) if (p.type !== 'test' && vis(p.x + p.w / 2, p.y + p.h / 2, Math.max(p.w, p.h))) drawBuilding(dc, hRect, p, E, F.time);
    }
    if (C && vis(Ld.x, Ld.y, 24)) {
      drawCargo(dc, hRect, site, C.stores);
      drawYard(dc, hRect, site.yard, C.stores, C.projects.filter(p => p.type === 'test'), F.time);
      this.drawFire(dc, hDisc, site.fire, F.hour, F.time);
      drawKitchen(dc, hRect, C.spots, C.F && C.F.vats, F.time);
    }
    if (C) for (const s of C.stakes) if (vis(s.x, s.y, 2)) {
      dc.fillStyle = 'rgba(0,0,0,.35)'; dc.beginPath(); dc.ellipse(s.x + .12, s.y + .1, .2, .14, 0, 0, 6.3); dc.fill();
      dc.fillStyle = '#7d8790'; dc.beginPath(); dc.arc(s.x, s.y, .13, 0, 6.3); dc.fill();
      const on = Math.sin(F.time * 2.6 + s.x) > .2; dc.fillStyle = on ? '#9ff0ff' : '#3c6070'; dc.beginPath(); dc.arc(s.x, s.y, .07, 0, 6.3); dc.fill();
      hDisc(s.x, s.y, .1, .9);
    }
    // the Seed, coming down if it's still landing
    if (vis(Ld.x, Ld.y, 8)) {
      const a = this.anim ? clamp((performance.now() - this.anim.t0) / LAND_MS, 0, 1) : 1, e = ease(a), up = (1 - e);
      const s = this.seed.size * (1 + up * 1.6);
      if (up > 0) {   // dust thrown out by the engines
        for (let i = 0; i < 46; i++) { const an = hash(i, 3, 7) * 6.283, r = 2.5 + e * (6 + hash(i, 5, 9) * 10), al = (1 - e) * .5 * sstep(.15, .5, e) + (a < 1 ? .05 : 0); dc.fillStyle = `rgba(150,128,100,${al})`; dc.beginPath(); dc.arc(Ld.x + Math.cos(an) * r, Ld.y + Math.sin(an) * r, .6 + e * 1.4 * hash(i, 1, 2), 0, 6.3); dc.fill(); }
      }
      dc.globalAlpha = .4 + .6 * e; dc.drawImage(this.seed.cv, Ld.x - s / 2, Ld.y - s / 2, s, s); dc.globalAlpha = 1;
      if (C && (C.seed.printing || C.seed.fab)) {   // the fabricator at work: the core pulses
        const p = .5 + .5 * Math.sin(F.time * 3); dc.strokeStyle = `rgba(150,240,255,${.35 + .4 * p})`; dc.lineWidth = .12; dc.beginPath(); dc.arc(Ld.x, Ld.y, .45 + p * .25, 0, 6.3); dc.stroke();
      }
      const base = up * 2.6; hDisc(Ld.x, Ld.y, 1.5 * (1 + up * 1.6), Math.min(4, base + 1.6), base); hDisc(Ld.x, Ld.y, .75, Math.min(4, base + 2.3), base);
    }
    // people, back to front; nobody is drawn inside the shelter
    const n = F.n, pos = F.pos, arts = F.arts, near = k >= 9, order = this.order;
    order.length = 0;
    for (let i = 0; i < n; i++) { const act = pos[i * 4 + 3] >> 1; if (hidden(act)) continue; if (vis(pos[i * 4], pos[i * 4 + 1], 1.5)) order.push(i); }
    this.stats.people = order.length;
    if (near) {
      order.sort((a, b) => pos[a * 4 + 1] - pos[b * 4 + 1]);
      for (const i of order) { const o = i * 4, f = pos[o + 3], act = f >> 1, mv = f & 1; drawPerson(dc, arts[i], pos[o], pos[o + 1], pos[o + 2], mv, act, F.time); if (act !== ACT.BED) hDisc(pos[o], pos[o + 1], .28, act === ACT.EAT || act === ACT.ALONE || act === ACT.PLANT || act === ACT.QUARRY ? .8 : 1.2); else hDisc(pos[o], pos[o + 1], .3, .3); }
    } else {
      const r = Math.max(.35, 2.2 / k);
      for (const i of order) drawDot(dc, arts[i], pos[i * 4], pos[i * 4 + 1], r);
    }
    hc.globalCompositeOperation = 'source-over';
  }

  // the local life the colony knows about, patch by patch; placed exactly as the simulation places it
  lifeList() {
    if (!this.life && this.W.land) { this.kinds = drawLife(this.W.seed); this.life = placeLife(this.W, this.kinds); this.goneSet = new Set(); this.goneKey = ''; }
    return this.life;
  }
  drawLife(g, hDisc, C, L, Tp, R, B, k, E, t) {
    const FD = C.F; this.lanterns = []; if (!FD || k < 2.5) return;
    const life = this.lifeList(); if (!life) return;
    const key = FD.gone.join(','); if (key !== this.goneKey) { this.goneKey = key; this.goneSet = new Set(FD.gone); }
    const s = seasonOf(doyOf(C.day || 1)), night = E.night > .4, CH0 = 32, NC = Math.ceil(MAP / CH0);
    const cx0 = Math.max(0, Math.floor((L - 1) / CH0)), cx1 = Math.min(NC - 1, Math.floor((R + 1) / CH0)), cy0 = Math.max(0, Math.floor((Tp - 1) / CH0)), cy1 = Math.min(NC - 1, Math.floor((B + 1) / CH0));
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) for (const i of life.by[cy * NC + cx]) {
      const p = life.list[i]; if (!FD.life[p.o] || p.x < L - 1 || p.x > R + 1 || p.y < Tp - 1 || p.y > B + 1) continue;
      const kd = this.kinds[p.o], bare = this.goneSet.has(i), dorm = !kd.season[s];
      if (kd.look.shape === 'lantern' && !bare && !dorm) this.lanterns.push([p, kd]);
      if (k < 6) { g.fillStyle = `rgba(${kd.look.a.join(',')},.8)`; g.fillRect(p.x - .2, p.y - .2, .4, .4); continue; }
      drawPatch(g, hDisc, kd, p, bare, dorm, night, t);
    }
  }
  drawFire(g, hDisc, f, hour, t) {
    for (let i = 0; i < 9; i++) { const a = i / 9 * 6.283; g.fillStyle = i % 2 ? '#6e6a64' : '#7f7a72'; g.beginPath(); g.arc(f.x + Math.cos(a) * .55, f.y + Math.sin(a) * .55, .14, 0, 6.3); g.fill(); hDisc(f.x + Math.cos(a) * .55, f.y + Math.sin(a) * .55, .12, .25); }
    g.strokeStyle = '#4a3527'; g.lineWidth = .12; g.lineCap = 'round'; for (let i = 0; i < 3; i++) { const a = i * 2.1 + .4; g.beginPath(); g.moveTo(f.x + Math.cos(a) * .35, f.y + Math.sin(a) * .35); g.lineTo(f.x - Math.cos(a) * .25, f.y - Math.sin(a) * .25); g.stroke(); }
    const b = fireOn(hour);
    if (b > .05) for (let i = 0; i < 5; i++) {
      const a = t * (2 + i * .7) + i * 1.3, r = (.32 - i * .05) * (.6 + .4 * b) * (1 + .15 * Math.sin(a * 2.3));
      g.fillStyle = ['rgba(255,110,40,.75)', 'rgba(255,150,60,.8)', 'rgba(255,190,90,.85)', 'rgba(255,225,150,.9)', 'rgba(255,245,210,.9)'][i];
      g.beginPath(); g.arc(f.x + Math.sin(a) * .05, f.y + Math.cos(a * 1.3) * .05, r, 0, 6.3); g.fill();
    } else { g.fillStyle = `rgba(255,90,40,${.4 + .2 * Math.sin(t * 2)})`; g.beginPath(); g.arc(f.x, f.y, .14, 0, 6.3); g.fill(); }
  }

  lights(F, E) {
    const out = [], on = sstep(.15, .55, E.night), Ld = this.W.land, t = F.time;
    if (!Ld) return out;
    const fl = (k, sp) => .88 + .08 * Math.sin(t * sp + k) + .05 * Math.sin(t * sp * 2.7 + k * 3.1);
    const a = this.anim ? clamp((performance.now() - this.anim.t0) / LAND_MS, 0, 1) : 1;
    if (a < 1) out.push({ x: Ld.x, y: Ld.y, z: 1.2, r: 16, c: mul3([1, .6, .3], 4 * (1 - a)), g: .6 * (1 - a) });
    const C = F.colony, printing = C && (C.seed.printing || C.seed.fab);
    out.push({ x: Ld.x, y: Ld.y, z: 2.6, r: 8 + 3 * on, c: mul3([.42, .82, 1], (.7 + 1.5 * on) * (printing ? 1.1 + .25 * Math.sin(t * 3) : 1)), g: .55 });
    if (!C) return out;
    const site = this.W.site, f = site.fire, b = fireOn(F.hour);
    if (b > .05) out.push({ x: f.x, y: f.y, z: .8, r: 4 + 7 * b, c: mul3([1, .55, .25], (.8 + 2.2 * Math.max(on, .25)) * b * fl(1, 9)), g: .35 * b });
    if (on > .01) {
      for (let i = 0; i < 4; i++) { const an = i * Math.PI / 2 + Math.PI / 4, blink = (Math.sin(t * 2.2 + i * 1.3) > .6) ? 1 : .15; out.push({ x: Ld.x + Math.cos(an) * 2.1, y: Ld.y + Math.sin(an) * 2.1, z: .6, r: 2.6, c: mul3([1, .25, .2], 1.4 * on * blink), g: .15 }); }
      buildingLights(out, C.projects, on, mul3);
      this.lanternLights(out, C, on);
      for (const s of C.stakes) out.push({ x: s.x, y: s.y, z: .9, r: 3, c: mul3([.5, .9, 1], 1.2 * on * (Math.sin(t * 2.6 + s.x) > .2 ? 1 : .3)), g: .2 });
      // a lantern for each crew lead, and anyone else out past the camp after dark
      for (let i = 0; i < F.n; i++) {
        const o = i * 4, act = F.pos[o + 3] >> 1; if (act === ACT.BED || hidden(act)) continue;
        const far = Math.hypot(F.pos[o] - Ld.x, F.pos[o + 1] - Ld.y) > 12; if (!far && !F.leads.has(i)) continue;
        out.push({ x: F.pos[o], y: F.pos[o + 1], z: 1.1, r: 6, c: mul3([1, .62, .3], 1.9 * on * fl(i, 7)), g: .3 });
      }
    }
    this.stats.lightsAll = out.length;
    return out;
  }

  // the glowing kind of local life lights its own patch at night (drawLife lists the ones in view)
  lanternLights(out, C, on) {
    if (!this.lanterns) return;
    for (const [p, kd] of this.lanterns.slice(0, 30)) out.push({ x: p.x, y: p.y, z: .5, r: 2.6, c: mul3(kd.look.a.map(v => v / 255), 1.3 * on), g: .25 });
  }
  drawUI(F, L, Tp) {
    const ui = this.ui, z = this.cam.z, D = this.DPR;
    ui.setTransform(1, 0, 0, 1, 0, 0); ui.clearRect(0, 0, this.uic.width, this.uic.height);
    ui.fillStyle = 'rgba(0,0,0,.004)'; ui.fillRect(0, 0, 1, 1);   // never leave the layer empty: some browsers then keep showing its last picture
    ui.setTransform(D, 0, 0, D, 0, 0);
    const sx = x => (x - L) * z, sy = y => (y - Tp) * z, fs = clamp(z * .36, 10, 12.5);
    ui.textAlign = 'center'; ui.textBaseline = 'middle';
    // from orbit: the three places the Seed could come down
    if (F.orbit) {
      F.orbit.sites.forEach((s, i) => {
        const X = sx(s.x), Y = sy(s.y), on = i === F.orbit.sel, r = 40 * z, p = .5 + .5 * Math.sin(F.time * 2.5);
        ui.setLineDash(on ? [] : [4, 5]); ui.lineWidth = on ? 2 : 1.3; ui.strokeStyle = on ? `rgba(143,224,255,${.7 + .3 * p})` : 'rgba(255,255,255,.55)';
        ui.beginPath(); ui.arc(X, Y, Math.max(14, r), 0, 6.3); ui.stroke(); ui.setLineDash([]);
        ui.fillStyle = on ? '#8fe0ff' : 'rgba(10,14,20,.75)'; ui.beginPath(); ui.arc(X, Y, 13, 0, 6.3); ui.fill(); ui.strokeStyle = on ? '#0b1a24' : 'rgba(255,255,255,.7)'; ui.lineWidth = 1.5; ui.stroke();
        ui.font = '800 13px Manrope,system-ui,sans-serif'; ui.fillStyle = on ? '#08131b' : '#fff'; ui.fillText(LETTERS[i], X, Y + .5);
        ui.font = '700 12px Manrope,system-ui,sans-serif'; const tw = ui.measureText(s.tag).width + 14;
        ui.fillStyle = 'rgba(10,14,20,.72)'; ui.beginPath(); ui.roundRect(X - tw / 2, Y + 20, tw, 20, 10); ui.fill(); ui.fillStyle = '#eef1f6'; ui.fillText(s.tag, X, Y + 30.5);
      });
      return;
    }
    // where survey crews have been sent
    if (F.colony) for (const cr of F.colony.crews) {
      if (cr.gone || cr.work !== 'survey' || cr.target < 0) continue;
      const tx = cr.target % MAP + .5, ty = (cr.target / MAP | 0) + .5, X = sx(tx), Y = sy(ty), col = crewColour(cr.id);
      ui.setLineDash([6, 6]); ui.lineDashOffset = -F.time * 8; ui.strokeStyle = rgb(col, .95); ui.lineWidth = 2; ui.beginPath(); ui.arc(X, Y, Math.max(10, 12 * z), 0, 6.3); ui.stroke(); ui.setLineDash([]);
      ui.font = '700 11.5px Manrope,system-ui,sans-serif'; const tw = ui.measureText(cr.name + ' crew').width + 12;
      ui.fillStyle = rgb(col, .85); ui.beginPath(); ui.roundRect(X - tw / 2, Y - 10, tw, 20, 10); ui.fill(); ui.fillStyle = '#fff'; ui.fillText(cr.name + ' crew', X, Y + .5);
    }
    if (F.pickAt) {
      const [wx, wy] = F.pickAt, X = sx(wx), Y = sy(wy);
      ui.strokeStyle = 'rgba(243,182,92,.95)'; ui.lineWidth = 2; ui.setLineDash([5, 5]); ui.beginPath(); ui.arc(X, Y, Math.max(10, 12 * z), 0, 6.3); ui.stroke(); ui.setLineDash([]);
    }
    if (F.colony) this.projectLabels(F, sx, sy, z);
    if (F.place) this.placePreview(F.place, sx, sy, z);
    ui.font = `700 ${fs}px Manrope,system-ui,sans-serif`;
    const label = (i, strong) => {
      const o = i * 4, X = sx(F.pos[o]), Y = sy(F.pos[o + 1]); if (X < -60 || Y < -40 || X > this.VW + 60 || Y > this.VH + 40) return;
      const name = F.names[i] || '', ly = Y + Math.max(10, z * .62) + fs * .2, tw = ui.measureText(name).width + 12;
      ui.fillStyle = strong ? 'rgba(243,182,92,.9)' : 'rgba(10,14,20,.58)'; ui.beginPath(); ui.roundRect(X - tw / 2, ly - fs * .65, tw, fs * 1.3, fs * .65); ui.fill();
      ui.fillStyle = strong ? '#1a1206' : '#f2f4f8'; ui.fillText(name, X, ly + .5);
    };
    if (this.labels && z >= 14) for (const i of this.order) if (i !== F.sel) label(i, false);
    if (F.hover >= 0 && F.hover !== F.sel) label(F.hover, false);
    if (F.sel >= 0 && F.sel < F.n) {
      const o = F.sel * 4, X = sx(F.pos[o]), Y = sy(F.pos[o + 1]), r = Math.max(9, z * .56) + Math.sin(F.time * 4) * 1.2, l = Math.max(5, z * .16);
      ui.strokeStyle = 'rgba(255,236,190,.95)'; ui.lineWidth = 1.6; ui.shadowColor = 'rgba(0,0,0,.6)'; ui.shadowBlur = 4; ui.beginPath();
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { ui.moveTo(X + a * r, Y + b * (r - l)); ui.lineTo(X + a * r, Y + b * r); ui.lineTo(X + a * (r - l), Y + b * r); }
      ui.stroke(); ui.shadowBlur = 0; label(F.sel, true);
    }
    // the brackets around a thing picked on the map: the Seed, the fire, a tree, a patch of local life
    if (F.thing) {
      const T = F.thing, X = sx(T.x), Y = sy(T.y), r = Math.max(9, T.r * z) + Math.sin(F.time * 4) * 1.2, l = Math.max(5, r * .3);
      ui.strokeStyle = 'rgba(243,182,92,.95)'; ui.lineWidth = 1.6; ui.shadowColor = 'rgba(0,0,0,.6)'; ui.shadowBlur = 4; ui.beginPath();
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { ui.moveTo(X + a * r, Y + b * (r - l)); ui.lineTo(X + a * r, Y + b * r); ui.lineTo(X + a * (r - l), Y + b * r); }
      ui.stroke(); ui.shadowBlur = 0;
    }
  }

  // names over building sites, with what they wait for; dark buildings say so
  projectLabels(F, sx, sy, z) {
    const ui = this.ui;
    for (const p of F.colony.projects) {
      if (p.type === 'test') continue;
      const stuck = !!p.stall || (p.done && p.type !== 'solar' && !p.powered), show = stuck || (!p.done && z >= 5) || (this.labels && z >= 8) || p.id === F.projSel;
      if (!show) continue;
      const X = sx(p.x + p.w / 2), Y = sy(p.y) - 10; if (X < -150 || X > this.VW + 150 || Y < -40 || Y > this.VH + 60) continue;
      const head = p.done ? p.name : `${p.name} · ${p.paused ? 'paused' : stagesOf(p.type)[p.stage].toLowerCase() + ' ' + Math.round(progress(p) * 100) + '%'}`;
      const sub = stuck ? p.wait : '';
      ui.font = '700 11.5px Manrope,system-ui,sans-serif';
      const tw = Math.max(ui.measureText(head).width, sub ? (ui.font = '600 11px Manrope,system-ui,sans-serif', ui.measureText(sub).width) : 0) + 14, hh = sub ? 34 : 20;
      ui.fillStyle = stuck ? 'rgba(60,34,10,.86)' : p.id === F.projSel ? 'rgba(243,182,92,.92)' : 'rgba(10,14,20,.66)'; ui.beginPath(); ui.roundRect(X - tw / 2, Y - hh, tw, hh, 9); ui.fill();
      if (stuck) { ui.strokeStyle = 'rgba(243,182,92,.8)'; ui.lineWidth = 1; ui.stroke(); }
      ui.font = '700 11.5px Manrope,system-ui,sans-serif'; ui.fillStyle = p.id === F.projSel && !stuck ? '#1a1206' : '#f2f4f8'; ui.fillText(head, X, Y - hh + 10.5);
      if (sub) { ui.font = '600 11px Manrope,system-ui,sans-serif'; ui.fillStyle = '#ffd79a'; ui.fillText(sub, X, Y - 10); }
    }
  }
  // the building being placed: green where it fits, red where it doesn't, the door marked
  placePreview(P, sx, sy, z) {
    if (P.x == null) return;
    const ui = this.ui, X = sx(P.x), Y = sy(P.y), Wd = P.w * z, Hd = P.h * z, ok = P.check ? P.check.ok : true;
    ui.fillStyle = ok ? 'rgba(127,211,143,.2)' : 'rgba(238,107,95,.2)'; ui.fillRect(X, Y, Wd, Hd);
    ui.strokeStyle = ok ? 'rgba(127,211,143,.95)' : 'rgba(238,107,95,.95)'; ui.lineWidth = 2; ui.setLineDash([6, 4]); ui.strokeRect(X, Y, Wd, Hd); ui.setLineDash([]);
    if (P.check && P.check.bad) { ui.fillStyle = 'rgba(238,107,95,.45)'; for (const t of P.check.bad) ui.fillRect(sx(t % MAP), sy(t / MAP | 0), z, z); }
    if (!TYPES[P.type].open) {
      const d = P.door; if (d) { const dx = sx(d.x + .5), dy = sy(d.y + .5), r = Math.max(5, z * .45); ui.fillStyle = '#ffd79a'; ui.beginPath(); ui.arc(dx, dy, r, 0, 6.3); ui.fill(); ui.fillStyle = '#1a1206'; ui.font = `800 ${Math.max(9, Math.min(12, z * .5))}px Manrope,system-ui,sans-serif`; ui.fillText('D', dx, dy + .5); }
    }
    ui.font = '700 12px Manrope,system-ui,sans-serif'; const t = `${TYPES[P.type].name} · ${P.w} × ${P.h}`, tw = ui.measureText(t).width + 14;
    ui.fillStyle = 'rgba(10,14,20,.8)'; ui.beginPath(); ui.roundRect(X + Wd / 2 - tw / 2, Y - 28, tw, 20, 10); ui.fill(); ui.fillStyle = '#f2f4f8'; ui.fillText(t, X + Wd / 2, Y - 17.5);
  }

  // ---------- the minimap ----------
  minimapBase() {
    const C = [[92, 118, 62], [128, 102, 72], [196, 178, 136], [64, 112, 120], [28, 54, 82], [86, 83, 80], [124, 118, 108], [74, 96, 74], [50, 82, 50], [60, 52, 44]];
    const cv = mk(MAP, MAP), g = cv.getContext('2d'), id = g.createImageData(MAP, MAP), W = this.W;
    for (let i = 0; i < MAP * MAP; i++) { const c = C[W.type[i]], e = .82 + W.elev[i] / 255 * .3, o = i * 4; id.data[o] = c[0] * e; id.data[o + 1] = c[1] * e; id.data[o + 2] = c[2] * e; id.data[o + 3] = 255; }
    g.putImageData(id, 0, 0); return cv;
  }
  fogBase() { const cv = mk(MAP, MAP), g = cv.getContext('2d'); g.fillStyle = 'rgba(10,14,24,.59)'; g.fillRect(0, 0, MAP, MAP); return cv; }
  drawMinimap(F) {
    const m = this.mm; if (!m) return; const D = this.DPR, S = m.clientWidth || 180;
    if (m.width !== Math.round(S * D)) { m.width = m.height = Math.round(S * D); }
    const g = m.getContext('2d'), k = m.width / MAP;
    g.setTransform(1, 0, 0, 1, 0, 0); g.imageSmoothingEnabled = true; g.drawImage(this.mmBase, 0, 0, m.width, m.height);
    if (this.fog) g.drawImage(this.mmFog, 0, 0, m.width, m.height);
    g.fillStyle = 'rgba(8,12,18,.18)'; g.fillRect(0, 0, m.width, m.height);
    if (F.orbit) F.orbit.sites.forEach((s, i) => { g.strokeStyle = i === F.orbit.sel ? '#8fe0ff' : 'rgba(255,255,255,.7)'; g.lineWidth = 1.5 * D; g.beginPath(); g.arc(s.x * k, s.y * k, 40 * k, 0, 6.3); g.stroke(); g.fillStyle = g.strokeStyle; g.font = `800 ${10 * D}px Manrope,system-ui,sans-serif`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(LETTERS[i], s.x * k, s.y * k); });
    if (F.colony) for (const s of F.colony.stakes) { g.fillStyle = '#9ff0ff'; g.fillRect(s.x * k - 1.5 * D, s.y * k - 1.5 * D, 3 * D, 3 * D); }
    if (F.colony) for (const p of F.colony.projects) if (p.type !== 'test') { g.fillStyle = p.done ? 'rgba(220,226,232,.95)' : 'rgba(243,182,92,.9)'; g.fillRect(p.x * k, p.y * k, Math.max(2 * D, p.w * k), Math.max(2 * D, p.h * k)); }
    for (let i = 0; i < F.n; i++) { const act = F.pos[i * 4 + 3] >> 1; if (hidden(act)) continue; const c = F.arts[i].L.app; g.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`; g.fillRect(F.pos[i * 4] * k - D, F.pos[i * 4 + 1] * k - D, 2 * D, 2 * D); }
    const Ld = this.W.land; if (Ld) { g.strokeStyle = '#8fe0ff'; g.lineWidth = 1.5 * D; g.beginPath(); g.arc(Ld.x * k, Ld.y * k, 4 * D, 0, 6.3); g.stroke(); }
    const [L, T, R, B] = this.rect; g.strokeStyle = 'rgba(255,236,190,.9)'; g.lineWidth = 1.2 * D; g.strokeRect(L * k, T * k, (R - L) * k, (B - T) * k);
  }
}
export { crewColour, fireOn };

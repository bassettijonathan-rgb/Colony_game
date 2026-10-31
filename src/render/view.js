// One frame: people, the Seed and the camp go onto a screen-sized layer (with their heights on another), then
// the GPU composes the painted map, light, shadow, water and the ground not yet surveyed. Also the camera,
// the view from orbit before the landing, the landing itself, and the minimap.
import { MAP, CH, ACT, hidden, inRoom } from '../core/consts.js';
import { clamp, sstep, hash } from '../core/rng.js';
import { drawBuilding, drawHatch, drawYard, drawCargo, drawMarks, buildingLights, progress, spotInside } from './buildings.js';
import { stagesOf, TYPES, doorless } from '../core/build.js';
import { createGL } from './gl.js';
import { FS_H, FS_L, FS_C } from './shaders.js';
import { Terrain } from './terrain.js';
import { env, pickLights } from './env.js';
import { fireOn, skyAt, doyOf, seasonOf } from '../core/year.js';
import { drawLife, placeLife } from '../core/food.js';
import { drawPatch, drawKitchen } from './life.js';
import { drawPerson, drawDot, makeSeed, crewColour } from './people.js';
import { floodPlain, underOf, ORE, RARE } from '../core/world.js';

const mul3 = (a, f) => [a[0] * f, a[1] * f, a[2] * f];
const rgb = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0); return c; };
const hcol = (top, base) => `rgb(${Math.round(clamp(top / 4, 0, 1) * 255)},${Math.round(clamp(1 - base / 4, 0, 1) * 255)},0)`;
const ease = t => 1 - Math.pow(1 - t, 3);
export const ZMIN = 1.2, ZMAX = 72;
export const LETTERS = 'ABC';
const LAND_MS = 2600;
// the ground below, as the Seed's soundings show it: soil, clay, stone, hard rock, waterlogged, solid, hot
const UGC = [[92, 70, 50], [124, 82, 56], [98, 95, 92], [66, 68, 76], [38, 54, 62], [26, 26, 30], [118, 58, 36]];

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
    this.labels = false; this.below = 0; this.inside = true; this.stats = { lights: 0, lightsInView: 0, people: 0 }; this.order = [];
    this.fly = null; this.anim = null; this.fog = !!W.land;
    this.mm = app.querySelector('#mm'); this.mmBase = this.minimapBase(); this.mmFog = this.fogBase();
    this.resize();
  }
  // a new planet, same window
  setWorld(W) {
    this.W = W; this.life = null; this.ugCv = null; this.terrain.dispose(); this.terrain = new Terrain(this.G, W);
    this.cam = W.land ? { x: W.land.x + .5, y: W.land.y + 3, z: Math.max(this.cam.z, 24) } : { x: MAP / 2, y: MAP / 2, z: 1 };
    this.fly = null; this.anim = null; this.fog = !!W.land;
    this.mmBase = this.minimapBase(); this.mmFog = this.fogBase(); this.clampCam();
  }
  // the lander comes down where the player chose: the ground it changed is painted again, and it descends
  land(W, rect) {
    this.W = W; this.life = null; this.ugCv = null; this.terrain.patch(W, rect); this.fog = true;
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
      // posts the Seed has asked for on the map: red-topped stakes, each casting a short shadow
      if (this.marks) for (const [x, y] of this.marks) if (vis(x, y, 2)) {
        dc.fillStyle = 'rgba(0,0,0,.3)'; dc.beginPath(); dc.ellipse(x + .6, y + .62, .22, .12, .5, 0, 6.3); dc.fill();
        dc.fillStyle = '#d8d2c4'; dc.fillRect(x + .4, y + .4, .2, .2); hRect(x + .4, y + .4, .2, .2, 1.4);
        dc.fillStyle = '#e0412c'; dc.beginPath(); dc.arc(x + .5, y + .5, .16, 0, 6.3); dc.fill();
        dc.strokeStyle = 'rgba(255,240,230,.7)'; dc.lineWidth = .04; dc.stroke();
      }
      this.drawLife(dc, hDisc, C, L, Tp, R, B, k, E, F.time);
      if (C.hz && C.hz.lv > .3) this.drawFlood(dc, C.hz.lv, F.time);
      for (const p of C.projects) if (p.below && p.via == null) { if (p.door && vis(p.door.x, p.door.y, 3)) drawHatch(dc, hRect, p, F.time); }
      else if (p.type !== 'test' && vis(p.x + p.w / 2, p.y + p.h / 2, Math.max(p.w, p.h))) {
        drawBuilding(dc, hRect, p, E, F.time, this.inside);
        if (p.wet) { dc.fillStyle = `rgba(66,78,80,${.42 + .04 * Math.sin(F.time * 1.3 + p.id)})`; dc.fillRect(p.x, p.y, p.w, p.h); }   // standing in the flood
        if (p.dmg && !p.fire && p.dmg === 'fire') { dc.fillStyle = 'rgba(20,14,10,.38)'; dc.fillRect(p.x, p.y, p.w, p.h); }      // charred, waiting for repairs
      }
    }
    if (C && vis(Ld.x, Ld.y, 24)) {
      drawCargo(dc, hRect, site, C.stores);
      drawYard(dc, hRect, site.yard, C.stores, C.projects.filter(p => p.type === 'test'), F.time);
      this.drawFire(dc, hDisc, site.fire, F.hour, F.time);
      drawKitchen(dc, hRect, C.spots, C.F && C.F.vats, F.time, C.F && C.F.vatN);
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
    // with the roofs off, whoever is indoors shows inside: asleep in a bunk, at a table, at a bench
    if (C && this.inside) {
      const doors = new Map(); for (const p of C.projects) if (p.done && !p.below && p.door && p.type !== 'solar' && p.type !== 'field') doors.set(p.door.y * MAP + p.door.x, p);
      const r = Math.max(.35, 2.2 / k);
      for (let i = 0; i < n; i++) {
        const o = i * 4, act = pos[o + 3] >> 1; if (!inRoom(act)) continue;
        const tx = Math.floor(pos[o]), ty = Math.floor(pos[o + 1]); let p = null;
        for (let dy = -1; dy <= 1 && !p; dy++) for (let dx = -1; dx <= 1 && !p; dx++) p = doors.get((ty + dy) * MAP + tx + dx) || null;
        if (!p || !vis(p.x + p.w / 2, p.y + p.h / 2, Math.max(p.w, p.h))) continue;
        const [X, Y, pose] = spotInside(p, act, i);
        if (!near) { drawDot(dc, arts[i], X, Y, r); continue; }
        dc.save(); dc.translate(X, Y); if (pose === 'sleep') dc.scale(.62, .62);   // sitting and working at full size, as outdoors; asleep, small enough to fit the bunk
        drawPerson(dc, arts[i], 0, 0, pose === 'sleep' ? (p.w >= p.h ? 0 : -Math.PI / 2) : -Math.PI / 2, 0, pose === 'sleep' ? ACT.BED : pose === 'sit' ? ACT.EAT : ACT.IDLE, F.time);
        dc.restore();
      }
    }
    if (near) {
      order.sort((a, b) => pos[a * 4 + 1] - pos[b * 4 + 1]);
      for (const i of order) { const o = i * 4, f = pos[o + 3], act = f >> 1, mv = f & 1; drawPerson(dc, arts[i], pos[o], pos[o + 1], pos[o + 2], mv, act, F.time); const z = arts[i].size || 1; if (act !== ACT.BED && act !== ACT.DOWN) hDisc(pos[o], pos[o + 1], .28 * z, (act === ACT.EAT || act === ACT.ALONE || act === ACT.PLANT || act === ACT.QUARRY ? .8 : 1.2) * z); else hDisc(pos[o], pos[o + 1], .3 * z, .3); }
    } else {
      const r = Math.max(.35, 2.2 / k);
      for (const i of order) drawDot(dc, arts[i], pos[i * 4], pos[i * 4 + 1], r);
    }
    // visitors from another settlement, in their own colours
    const G = F.G;
    if (G) for (let i = 0; i < G.n; i++) {
      const o = i * 4, f = G.pos[o + 3], act = f >> 1; if (hidden(act) || !vis(G.pos[o], G.pos[o + 1], 1.5)) continue;
      if (near) { drawPerson(dc, G.arts[i], G.pos[o], G.pos[o + 1], G.pos[o + 2], f & 1, act, F.time); if (act !== ACT.BED) hDisc(G.pos[o], G.pos[o + 1], .28, 1.2); }
      else drawDot(dc, G.arts[i], G.pos[o], G.pos[o + 1], Math.max(.35, 2.2 / k));
    }
    if (C && C.hz) this.drawFlames(dc, hDisc, C, vis, k, F.time);
    hc.globalCompositeOperation = 'source-over';
  }

  // flood water over the low ground: a map-sized picture of where it stands, made again when the level moves
  drawFlood(g, lv, t) {
    const key = Math.round(lv * 4) / 4;
    if (this.floodKey !== key) {
      this.floodKey = key; const thr = floodPlain(this.W), cv = this.floodCv || (this.floodCv = mk(MAP, MAP)), c = cv.getContext('2d'), id = c.createImageData(MAP, MAP), D = id.data;
      for (let i = 0; i < MAP * MAP; i++) { const d = key - thr[i]; if (d < 0) continue; const a = Math.min(.86, .5 + d * .08), o = i * 4; D[o] = 92 - Math.min(34, d * 6); D[o + 1] = 104 - Math.min(20, d * 4); D[o + 2] = 96 + Math.min(16, d * 3); D[o + 3] = a * 255; }   // muddy at the edge, darker and bluer where it is deep
      c.putImageData(id, 0, 0);
    }
    g.save(); g.imageSmoothingEnabled = true; g.globalAlpha = .92 + .05 * Math.sin(t * 1.3); g.drawImage(this.floodCv, 0, 0, MAP, MAP); g.restore();
  }
  // the fire: flames on each burning tile and on burning buildings, smoke blown downwind
  drawFlames(g, hDisc, C, vis, k, t) {
    const H = C.hz, wx = Math.cos(H.wa), wy = Math.sin(H.wa), spots = [];
    for (const tl of H.fire) { const x = tl % MAP + .5, y = (tl / MAP | 0) + .5; if (vis(x, y, 4)) spots.push([x, y, tl]); }
    for (const p of C.projects) if (p.fire && vis(p.x + p.w / 2, p.y + p.h / 2, Math.max(p.w, p.h))) for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) if (hash(x, y, 77) < .25 + p.burn * .6) spots.push([x + .5, y + .5, y * MAP + x]);
    if (!spots.length) return;
    if (k < 6) { for (const [x, y] of spots) { g.fillStyle = `rgba(255,${120 + 60 * Math.sin(t * 6 + x)},40,.9)`; g.fillRect(x - .5, y - .5, 1, 1); } return; }
    for (const [x, y, tl] of spots) {   // the ground under it, charred and glowing
      g.fillStyle = 'rgba(28,12,6,.5)'; g.beginPath(); g.ellipse(x, y + .1, .6, .5, 0, 0, 6.3); g.fill();
      g.fillStyle = `rgba(255,80,20,${.22 + .1 * Math.sin(t * 5 + tl)})`; g.beginPath(); g.ellipse(x, y + .1, .42, .34, 0, 0, 6.3); g.fill();
    }
    // tongues of flame: teardrops licking upward and leaning downwind, added up so the middle burns white
    g.save(); g.globalCompositeOperation = 'lighter';
    const tongue = (bx, by, w, h, lean) => { g.beginPath(); g.moveTo(bx - w, by); g.quadraticCurveTo(bx - w * .9, by - h * .55, bx + lean, by - h); g.quadraticCurveTo(bx + w * .9, by - h * .55, bx + w, by); g.quadraticCurveTo(bx, by + w * .6, bx - w, by); g.fill(); };
    for (const [x, y, tl] of spots) for (let i = 0; i < 3; i++) {
      const h1 = hash(tl, i, 5), h2 = hash(tl, i, 9), f = .5 + .5 * Math.sin(t * (8 + h1 * 6) + h2 * 6), f2 = .5 + .5 * Math.sin(t * (13 + h2 * 5) + h1 * 4);
      const bx = x + (h1 - .5) * .7, by = y + (h2 - .5) * .5 + .2, h = (.45 + h1 * .4) * (.75 + .4 * f), lean = wx * .25 * h + (f2 - .5) * .12;
      g.fillStyle = 'rgba(200,60,10,.55)'; tongue(bx, by, .2, h, lean);
      g.fillStyle = 'rgba(255,150,40,.5)'; tongue(bx, by, .13, h * .72, lean * .7);
      g.fillStyle = 'rgba(255,235,160,.45)'; tongue(bx, by, .07, h * .4, lean * .4);
      if (i === 0) hDisc(bx, by - h * .3, .2, 1.6);
    }
    g.restore();
    for (const [x, y, tl] of spots) {   // smoke rising and blown away downwind
      if (hash(tl, 2, 13) > .6) continue;
      for (let j = 0; j < 3; j++) { const ph = (t * .12 + hash(tl, j, 17)) % 1, d = ph * 6, r = .35 + ph * 2.2; g.fillStyle = `rgba(58,55,52,${.3 * (1 - ph) * sstep(0, .12, ph)})`; g.beginPath(); g.arc(x + wx * d + Math.sin(t * .7 + tl + j) * .4, y + wy * d - .6 - ph * 2.2, r, 0, 6.3); g.fill(); }
    }
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
    // wildfire and burning buildings: one light for each patch of flames, by day as well as by night
    if (C.hz && (C.hz.fire.length || C.projects.some(p => p.fire))) {
      const cells = new Map(), add = (x, y) => { const key = (y / 6 | 0) * 200 + (x / 6 | 0), c = cells.get(key) || [0, 0, 0]; c[0] += x; c[1] += y; c[2]++; cells.set(key, c); };
      for (const tl of C.hz.fire) add(tl % MAP + .5, (tl / MAP | 0) + .5);
      for (const p of C.projects) if (p.fire) for (let i = 0; i < 6; i++) add(p.x + p.w / 2, p.y + p.h / 2);
      let n = 0; for (const [key, c] of cells) { if (n++ > 40) break; out.push({ x: c[0] / c[2], y: c[1] / c[2], z: 1, r: 4 + Math.min(8, Math.sqrt(c[2]) * 2), c: mul3([1, .5, .2], (1.2 + 2 * Math.max(on, .2)) * fl(key, 8)), g: .4 }); }
    }
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
    if (this.below && F.colony) this.drawBelow(F, sx, sy, z);
    // where survey crews have been sent
    if (F.colony && !this.below) for (const cr of F.colony.crews) {
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
    // visitors' names, on a tag in their colours
    if (F.G && F.G.n && !this.below) for (let i = 0; i < F.G.n; i++) {
      if (!(i === F.ghover || F.G.raid || (this.labels && z >= 14))) continue;   // raiders are always named
      const o = i * 4; if (hidden(F.G.pos[o + 3] >> 1)) continue;
      const X = sx(F.G.pos[o]), Y = sy(F.G.pos[o + 1]); if (X < -60 || Y < -40 || X > this.VW + 60 || Y > this.VH + 40) continue;
      const name = F.G.names[i] || '', ly = Y + Math.max(10, z * .62) + fs * .2, tw = ui.measureText(name).width + 12, c = F.G.arts[i].L.app;
      ui.fillStyle = F.G.raid ? 'rgba(112,28,22,.9)' : `rgba(${c[0] * .5 | 0},${c[1] * .5 | 0},${c[2] * .5 | 0},.88)`; ui.beginPath(); ui.roundRect(X - tw / 2, ly - fs * .65, tw, fs * 1.3, fs * .65); ui.fill(); ui.strokeStyle = F.G.raid ? '#ff7a66' : `rgb(${Math.min(255, c[0] * 1.5) | 0},${Math.min(255, c[1] * 1.5) | 0},${Math.min(255, c[2] * 1.5) | 0})`; ui.lineWidth = 1.5; ui.stroke();
      ui.fillStyle = '#f2f4f8'; ui.fillText(name, X, ly + .5);
    }
    if (F.sel >= 0 && F.sel < F.n) {
      const o = F.sel * 4, X = sx(F.pos[o]), Y = sy(F.pos[o + 1]), r = Math.max(9, z * .56) + Math.sin(F.time * 4) * 1.2, l = Math.max(5, z * .16);
      ui.strokeStyle = 'rgba(255,236,190,.95)'; ui.lineWidth = 1.6; ui.shadowColor = 'rgba(0,0,0,.6)'; ui.shadowBlur = 4; ui.beginPath();
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { ui.moveTo(X + a * r, Y + b * (r - l)); ui.lineTo(X + a * r, Y + b * r); ui.lineTo(X + a * (r - l), Y + b * r); }
      ui.stroke(); ui.shadowBlur = 0; label(F.sel, true);
    }
    // the person under direct orders: a pulsing ring, and a line to where they were sent
    const C = F.colony;
    if (C && C.ctl >= 0 && C.ctl < F.n && !this.below) {
      const o = C.ctl * 4, X = sx(F.pos[o]), Y = sy(F.pos[o + 1]), r = Math.max(11, z * .7) + Math.sin(F.time * 5) * 1.5;
      if (C.ord && C.ord.k !== 'hold' && C.ord.t >= 0) {
        const tx = sx(C.ord.t % MAP + .5), ty = sy((C.ord.t / MAP | 0) + .5);
        ui.setLineDash([5, 5]); ui.lineDashOffset = -F.time * 10; ui.strokeStyle = C.ord.k === 'fire' ? 'rgba(255,150,80,.85)' : 'rgba(143,224,255,.8)'; ui.lineWidth = 1.6;
        ui.beginPath(); ui.moveTo(X, Y); ui.lineTo(tx, ty); ui.stroke(); ui.setLineDash([]);
        ui.beginPath(); ui.arc(tx, ty, Math.max(5, z * .35), 0, 6.3); ui.stroke();
      }
      ui.strokeStyle = 'rgba(143,224,255,.95)'; ui.lineWidth = 2.2; ui.shadowColor = 'rgba(0,0,0,.6)'; ui.shadowBlur = 5;
      ui.beginPath(); ui.arc(X, Y, r, 0, 6.3); ui.stroke(); ui.shadowBlur = 0;
    }
    // a right-click order lands with a ripple where it was given
    if (F.ctlMark && performance.now() - F.ctlMark.at < 700) {
      const M = F.ctlMark, a = (performance.now() - M.at) / 700, X = sx(M.x), Y = sy(M.y);
      ui.strokeStyle = M.k === 'fire' ? `rgba(255,150,80,${1 - a})` : M.k === 'help' ? `rgba(127,211,143,${1 - a})` : `rgba(143,224,255,${1 - a})`; ui.lineWidth = 2;
      ui.beginPath(); ui.arc(X, Y, 6 + a * 18, 0, 6.3); ui.stroke();
    }
    // the brackets around a thing picked on the map: the Seed, the fire, a tree, a patch of local life
    if (F.thing) {
      const T = F.thing, X = sx(T.x), Y = sy(T.y), r = Math.max(9, T.r * z) + Math.sin(F.time * 4) * 1.2, l = Math.max(5, r * .3);
      ui.strokeStyle = 'rgba(243,182,92,.95)'; ui.lineWidth = 1.6; ui.shadowColor = 'rgba(0,0,0,.6)'; ui.shadowBlur = 4; ui.beginPath();
      for (const [a, b] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) { ui.moveTo(X + a * r, Y + b * (r - l)); ui.lineTo(X + a * r, Y + b * r); ui.lineTo(X + a * (r - l), Y + b * r); }
      ui.stroke(); ui.shadowBlur = 0;
    }
  }

  // ---------- below ground ----------
  // a map of the ground under the surface, made once: the colour of what is there, with seams of ore glinting
  underBase(lv) {
    this.ugCv = this.ugCv || [];
    if (this.ugCv[lv]) return this.ugCv[lv];
    const U = underOf(this.W, lv), cv = mk(MAP, MAP), g = cv.getContext('2d'), id = g.createImageData(MAP, MAP), D = id.data;
    for (let i = 0; i < MAP * MAP; i++) {
      const u = U[i], c = UGC[u & 7], x = i % MAP, y = i / MAP | 0, n = .93 + hash(x, y, 5) * .12, o = i * 4;
      if (u & RARE && hash(x, y, 11) < .5) { D[o] = 120; D[o + 1] = 206; D[o + 2] = 188; }   // rare earths glint green-white in the ore
      else if (u & ORE && hash(x, y, 9) < .4) { D[o] = 172; D[o + 1] = 134; D[o + 2] = 80; } else { D[o] = c[0] * n; D[o + 1] = c[1] * n; D[o + 2] = c[2] * n; }
      D[o + 3] = 255;
    }
    g.putImageData(id, 0, 0); return (this.ugCv[lv] = cv);
  }
  // the view below ground: the soundings, the rooms dug into them, and whoever is down there
  drawBelow(F, sx, sy, z) {
    const ui = this.ui, C = F.colony, t = F.time, lv = this.below;
    ui.save(); ui.imageSmoothingEnabled = true; ui.imageSmoothingQuality = 'high';
    ui.drawImage(this.underBase(lv), sx(0), sy(0), MAP * z, MAP * z);
    if (this.fog) { ui.globalAlpha = .9; ui.drawImage(this.mmFog, sx(0), sy(0), MAP * z, MAP * z); ui.drawImage(this.mmFog, sx(0), sy(0), MAP * z, MAP * z); ui.globalAlpha = 1; }
    ui.imageSmoothingEnabled = true;
    ui.fillStyle = 'rgba(8,8,12,.4)'; ui.fillRect(0, 0, this.VW, this.VH);
    // what stands above, faintly, for bearings
    ui.strokeStyle = 'rgba(220,226,232,.28)'; ui.lineWidth = 1; ui.setLineDash([4, 4]);
    for (const p of C.projects) if (!p.below && p.type !== 'test') ui.strokeRect(sx(p.x), sy(p.y), p.w * z, p.h * z);
    const Ld = this.W.land; ui.beginPath(); ui.arc(sx(Ld.x), sy(Ld.y), 1.6 * z, 0, 6.3); ui.stroke(); ui.setLineDash([]);
    const rooms = C.projects.filter(p => p.below && (p.lvl || 1) === lv);
    for (const p of rooms) this.drawRoom(p, sx, sy, z, t);
    // the lift shafts going down through every level, and the cage in them
    for (const p of C.projects) if (p.type === 'shaft' && (p.done || p.stage >= (lv < 3 ? 1 : 2))) this.drawShaft(p, sx, sy, z, t);
    // people below: in the room the simulation has them in (or at its stairs), drawn spread through the room
    const r = Math.max(3, z * .32);
    for (let i = 0; i < F.n; i++) {
      const o = i * 4, act = F.pos[o + 3] >> 1; if (!hidden(act) || act === ACT.DEAD) continue;
      const px = F.pos[o], py = F.pos[o + 1], at = C.p && C.p[i] ? C.p[i][10] : undefined;
      const p = at != null ? rooms.find(q => q.id === at) : rooms.find(q => q.door && Math.abs(q.door.x + .5 - px) < .9 && Math.abs(q.door.y + .5 - py) < .9); if (!p) continue;
      const asleep = act === ACT.INSIDE, cols = Math.max(1, p.w - 2), k = asleep ? i % Math.max(1, p.cap.beds || 1) : (i * 7 + (t * .05 | 0)) % (cols * Math.max(1, p.h - 2));
      const X = sx(p.x + 1.5 + (k % cols)), Y = sy(p.y + 1.5 + ((k / cols | 0) % Math.max(1, p.h - 2))), c = F.arts[i].L.app;
      ui.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`; ui.strokeStyle = 'rgba(10,8,6,.9)'; ui.lineWidth = 1.2;
      ui.beginPath(); if (asleep) ui.ellipse(X, Y, r * 1.2, r * .7, 0, 0, 6.3); else ui.arc(X, Y, r, 0, 6.3); ui.fill(); ui.stroke();
      if (act === ACT.DIG && Math.sin(t * 6 + i) > .3) { ui.fillStyle = 'rgba(200,180,150,.6)'; ui.beginPath(); ui.arc(X + r, Y - r, r * .4, 0, 6.3); ui.fill(); }
    }
    ui.restore();
  }
  drawShaft(p, sx, sy, z, t) {
    const ui = this.ui, X = sx(p.x), Y = sy(p.y), Wd = p.w * z, Hd = p.h * z;
    if (X > this.VW + 40 || Y > this.VH + 40 || X + Wd < -40 || Y + Hd < -40) return;
    ui.fillStyle = '#0d0b0a'; ui.fillRect(X, Y, Wd, Hd);
    ui.strokeStyle = p.done ? 'rgba(200,190,170,.9)' : 'rgba(240,226,190,.6)'; ui.lineWidth = Math.max(1.5, z * .12); ui.setLineDash(p.done ? [] : [5, 4]); ui.strokeRect(X, Y, Wd, Hd); ui.setLineDash([]);
    if (p.stage >= 3 || p.done) {   // the guide rails, and the cage riding up and down between the levels
      ui.strokeStyle = 'rgba(150,146,138,.8)'; ui.lineWidth = Math.max(1, z * .06);
      ui.beginPath(); ui.moveTo(X + Wd * .2, Y + 2); ui.lineTo(X + Wd * .2, Y + Hd - 2); ui.moveTo(X + Wd * .8, Y + 2); ui.lineTo(X + Wd * .8, Y + Hd - 2); ui.stroke();
      if (p.done) { const k = .5 + .5 * Math.sin(t * .4 + p.id), lit = p.powered; ui.fillStyle = lit ? 'rgba(255,200,120,.9)' : 'rgba(120,110,100,.8)'; ui.fillRect(X + Wd * .25, Y + Hd * (.15 + .4 * k), Wd * .5, Hd * .3); }
    }
    ui.font = `800 ${Math.max(9, Math.min(13, z * .5))}px Manrope,system-ui,sans-serif`; ui.fillStyle = '#e9d6b4'; ui.textAlign = 'center'; ui.textBaseline = 'middle'; ui.fillText('LIFT', X + Wd / 2, Y + Hd + Math.max(8, z * .4));
  }
  drawRoom(p, sx, sy, z, t) {
    const ui = this.ui, X = sx(p.x), Y = sy(p.y), Wd = p.w * z, Hd = p.h * z, stage = p.done ? 5 : p.stage, f = progress(p), [nx, ny] = [[0, -1], [1, 0], [0, 1], [-1, 0]][p.side];
    if (X > this.VW + 40 || Y > this.VH + 40 || X + Wd < -40 || Y + Hd < -40) return;
    // how much is dug out, from the stairs inward
    const dug = stage === 0 ? 0 : stage === 1 ? f : 1;
    if (dug > 0) { ui.strokeStyle = 'rgba(12,8,4,.85)'; ui.lineWidth = Math.max(3, z * .3); ui.strokeRect(X, Y, Wd, Hd); }   // the cut face of the walls
    ui.setLineDash(stage ? [] : [5, 4]); ui.strokeStyle = 'rgba(240,226,190,.75)'; ui.lineWidth = 1.5; ui.strokeRect(X, Y, Wd, Hd); ui.setLineDash([]);
    if (dug > 0) {
      ui.fillStyle = p.wet ? '#2c3e46' : '#75604a';
      if (nx > 0) ui.fillRect(X + Wd * (1 - dug), Y, Wd * dug, Hd); else if (nx < 0) ui.fillRect(X, Y, Wd * dug, Hd); else if (ny > 0) ui.fillRect(X, Y + Hd * (1 - dug), Wd, Hd * dug); else ui.fillRect(X, Y, Wd, Hd * dug);
    }
    if (dug >= 1 && p.done && (p.powered || p.type === 'cellar')) {   // lamplight in a finished room
      const g = ui.createRadialGradient(X + Wd / 2, Y + Hd / 2, 0, X + Wd / 2, Y + Hd / 2, Math.max(Wd, Hd) * .7);
      g.addColorStop(0, p.type === 'cellar' ? 'rgba(150,190,210,.22)' : 'rgba(255,190,110,.32)'); g.addColorStop(1, 'rgba(255,190,110,0)');
      ui.fillStyle = g; ui.fillRect(X, Y, Wd, Hd);
    }
    if (p.wet) { ui.fillStyle = `rgba(70,110,130,${.35 + .08 * Math.sin(t * 1.4)})`; ui.fillRect(X, Y, Wd, Hd); }
    // shoring: posts along the walls and beams across
    if (stage >= 2) {
      const n = stage === 2 ? f : 1; ui.fillStyle = '#7d5d3e'; const ps = Math.max(2, z * .22);
      for (let i = 0; i <= p.w * n; i += 2) { ui.fillRect(X + i * z - ps / 2, Y - ps / 2, ps, ps); ui.fillRect(X + i * z - ps / 2, Y + Hd - ps / 2, ps, ps); }
      for (let j = 0; j <= p.h * n; j += 2) { ui.fillRect(X - ps / 2, Y + j * z - ps / 2, ps, ps); ui.fillRect(X + Wd - ps / 2, Y + j * z - ps / 2, ps, ps); }
      ui.strokeStyle = 'rgba(125,93,62,.55)'; ui.lineWidth = Math.max(1, z * .1);
      for (let i = 2; i < p.w * n; i += 2) { ui.beginPath(); ui.moveTo(X + i * z, Y); ui.lineTo(X + i * z, Y + Hd); ui.stroke(); }
    }
    // the fittings: bunks in quarters, shelves and bins in a cellar
    if (stage >= 4) {
      const n = stage === 4 ? f : 1, cols = Math.max(1, p.w - 2), rows = Math.max(1, p.h - 2), all = cols * rows;
      for (let k = 0; k < all * n; k++) {
        const cx = X + (1 + k % cols) * z, cy = Y + (1 + (k / cols | 0)) * z;
        if (p.type === 'mine') {   // a track down the middle of the gallery, and ore glinting in the faces at its edges
          const r = k / cols | 0, c0 = k % cols, mid = rows >> 1, edge = c0 === 0 || c0 === cols - 1 || r === 0 || r === rows - 1;
          if (r === mid) { ui.fillStyle = '#4a3d31'; ui.fillRect(cx, cy + z * .3, z, z * .4); ui.fillStyle = '#8f8a80'; ui.fillRect(cx, cy + z * .34, z, Math.max(1, z * .06)); ui.fillRect(cx, cy + z * .6, z, Math.max(1, z * .06)); if (c0 === (p.id % cols)) { ui.fillStyle = '#5b4a3a'; ui.fillRect(cx + z * .12, cy + z * .18, z * .76, z * .5); ui.fillStyle = '#ac8650'; ui.fillRect(cx + z * .2, cy + z * .12, z * .6, z * .22); } }
          else if (edge && hash(k, p.id, 5) < .45) { ui.fillStyle = '#ac8650'; ui.fillRect(cx + z * .25, cy + z * .25, z * .3, z * .3); ui.fillStyle = '#d8b878'; ui.fillRect(cx + z * .35, cy + z * .3, z * .12, z * .12); }
          continue;
        }
        if (p.type === 'burrow') { if ((k / cols | 0) % 3 === 2) continue; ui.fillStyle = '#6f5a44'; ui.fillRect(cx + z * .1, cy + z * .2, z * .8, z * .6); ui.fillStyle = '#b8ad98'; ui.fillRect(cx + z * .18, cy + z * .28, z * .64, z * .44); }
        else { const edge = k % cols === 0 || k % cols === cols - 1 || (k / cols | 0) === 0 || (k / cols | 0) === rows - 1; if (!edge) continue; ui.fillStyle = '#5d4632'; ui.fillRect(cx + z * .08, cy + z * .08, z * .84, z * .84); ui.fillStyle = hash(k, p.id, 3) < .5 ? '#9a7a4a' : '#7d8a52'; ui.fillRect(cx + z * .22, cy + z * .22, z * .56, z * .56); }
      }
    }
    // the stairs up
    const d = p.door; if (d) {
      const dx = sx(d.x), dy = sy(d.y);
      ui.fillStyle = '#5a4a3a'; ui.fillRect(dx, dy, z, z); ui.strokeStyle = '#c9b48f'; ui.lineWidth = Math.max(1, z * .06);
      for (let i = 1; i <= 3; i++) { const k = i / 4; ui.beginPath(); if (nx) { ui.moveTo(dx + k * z, dy + z * .15); ui.lineTo(dx + k * z, dy + z * .85); } else { ui.moveTo(dx + z * .15, dy + k * z); ui.lineTo(dx + z * .85, dy + k * z); } ui.stroke(); }
    }
  }

  // names over building sites, with what they wait for; dark buildings say so
  projectLabels(F, sx, sy, z) {
    const ui = this.ui;
    for (const p of F.colony.projects) {
      if (p.type === 'test') continue;
      if (this.below ? !(p.below && (p.lvl || 1) === this.below) && p.type !== 'shaft' : p.via != null && p.id !== F.projSel) continue;   // below ground, only the rooms on that level (and the shafts) are named
      const stuck = !!p.stall || p.fire || p.wet || (p.done && p.type !== 'solar' && !p.powered), show = stuck || (!p.done && z >= 5) || (this.labels && z >= 8) || p.id === F.projSel;
      if (!show) continue;
      const up = p.below && !this.below && p.door, X = up ? sx(p.door.x + .5) : sx(p.x + p.w / 2), Y = (up ? sy(p.door.y) : sy(p.y)) - 10; if (X < -150 || X > this.VW + 150 || Y < -40 || Y > this.VH + 60) continue;
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
    if (!doorless(TYPES[P.type])) {
      const d = P.door; if (d) { const dx = sx(d.x + .5), dy = sy(d.y + .5), r = Math.max(5, z * .45); ui.fillStyle = '#ffd79a'; ui.beginPath(); ui.arc(dx, dy, r, 0, 6.3); ui.fill(); ui.fillStyle = '#1a1206'; ui.font = `800 ${Math.max(9, Math.min(12, z * .5))}px Manrope,system-ui,sans-serif`; ui.fillText(TYPES[P.type].below ? 'S' : 'D', dx, dy + .5); }
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
    if (F.colony && this.marks) { g.fillStyle = '#ff5a40'; for (const [x, y] of this.marks) g.fillRect(x * k - D, y * k - D, 2 * D, 2 * D); }
    if (F.colony) for (const s of F.colony.stakes) { g.fillStyle = '#9ff0ff'; g.fillRect(s.x * k - 1.5 * D, s.y * k - 1.5 * D, 3 * D, 3 * D); }
    if (F.colony) for (const p of F.colony.projects) if (p.below) { if (p.door) { g.fillStyle = '#c9a26b'; g.fillRect(p.door.x * k - D, p.door.y * k - D, 2 * D, 2 * D); } } else if (p.type !== 'test') { g.fillStyle = p.done ? 'rgba(220,226,232,.95)' : 'rgba(243,182,92,.9)'; g.fillRect(p.x * k, p.y * k, Math.max(2 * D, p.w * k), Math.max(2 * D, p.h * k)); }
    if (F.colony && F.colony.hz) { g.fillStyle = '#ff7a2a'; for (const tl of F.colony.hz.fire) g.fillRect((tl % MAP) * k - D, (tl / MAP | 0) * k - D, 2 * D, 2 * D); }
    if (F.G) for (let i = 0; i < F.G.n; i++) { const o = i * 4; if (hidden(F.G.pos[o + 3] >> 1)) continue; const c = F.G.arts[i].L.app; g.fillStyle = '#fff'; g.fillRect(F.G.pos[o] * k - 2 * D, F.G.pos[o + 1] * k - 2 * D, 4 * D, 4 * D); g.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`; g.fillRect(F.G.pos[o] * k - D, F.G.pos[o + 1] * k - D, 2 * D, 2 * D); }
    for (let i = 0; i < F.n; i++) { const act = F.pos[i * 4 + 3] >> 1; if (hidden(act)) continue; const c = F.arts[i].L.app; g.fillStyle = `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})`; g.fillRect(F.pos[i * 4] * k - D, F.pos[i * 4 + 1] * k - D, 2 * D, 2 * D); }
    const Ld = this.W.land; if (Ld) { g.strokeStyle = '#8fe0ff'; g.lineWidth = 1.5 * D; g.beginPath(); g.arc(Ld.x * k, Ld.y * k, 4 * D, 0, 6.3); g.stroke(); }
    const [L, T, R, B] = this.rect; g.strokeStyle = 'rgba(255,236,190,.9)'; g.lineWidth = 1.2 * D; g.strokeRect(L * k, T * k, (R - L) * k, (B - T) * k);
  }
}
export { crewColour, fireOn };

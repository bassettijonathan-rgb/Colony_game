// Buildings as the camera sees them: each project stage by stage (plot, foundations, frame, systems, fit-out,
// finished), the yard's piles and the load-test rig, the lander's cargo, and the marks people leave on the land
// (stumps, logs, quarried rock). Everything is drawn on the dyn layer in tile units, with heights for the shadows.
import { MAP, T } from '../core/consts.js';
import { clamp, hash } from '../core/rng.js';
import { CARGO } from '../core/build.js';
import { propAt } from '../core/world.js';

// share of the current stage that is done
export function progress(p) { if (p.done) return 1; let a = 0, b = 0; for (const k in p.need) { b += p.need[k]; a += Math.min(p.need[k], p.got[k] || 0); } return b ? a / b : 0; }
const NORMAL = [[0, -1], [1, 0], [0, 1], [-1, 0]];
// what each kind of building is made of: the shelter from the lander's own hull, the rest from local stone and timber
const STYLE = {
  shelter: { slab: '#8c9094', joint: 'rgba(40,44,50,.25)', post: '#5d666f', beam: '#6b747d', wall: '#9aa3ab', roof: ['#c9ced3', '#8a939c'], done: ['#d6dade', '#a7afb7', '#7d8690'], seam: 'rgba(40,46,54,.45)' },
  dorm: { slab: '#8d877b', joint: 'rgba(50,44,36,.32)', post: '#6f5136', beam: '#7d5d3e', wall: '#a39a8b', roof: ['#9a7650', '#6b5036'], done: ['#a8825a', '#86643f', '#5f4630'], seam: 'rgba(40,28,18,.4)' },
  commons: { slab: '#8d877b', joint: 'rgba(50,44,36,.32)', post: '#6f5136', beam: '#7d5d3e', wall: '#a8a090', roof: ['#a07a4c', '#704f30'], done: ['#b38a58', '#8f6a42', '#664a2e'], seam: 'rgba(40,28,18,.4)' },
  workshop: { slab: '#8a8680', joint: 'rgba(40,40,40,.3)', post: '#5f554b', beam: '#6c5f50', wall: '#98928a', roof: ['#8d949c', '#646b73'], done: ['#a6adb5', '#7f878f', '#5c636b'], seam: 'rgba(30,34,40,.5)' },
  lab: { slab: '#8f8b84', joint: 'rgba(50,48,44,.3)', post: '#5f554b', beam: '#6c5f50', wall: '#aab4b4', roof: ['#b9c6c8', '#86969a'], done: ['#c9d6d8', '#9eb0b4', '#74878c'], seam: 'rgba(40,56,60,.4)' },
  plant: { slab: '#8a8780', joint: 'rgba(40,42,36,.3)', post: '#5a5a4c', beam: '#66654f', wall: '#9a9c8c', roof: ['#8f9886', '#646d5c'], done: ['#a3ab96', '#7b8570', '#58614e'], seam: 'rgba(30,36,28,.5)' },
  school: { slab: '#8d877b', joint: 'rgba(50,44,36,.32)', post: '#6f5136', beam: '#7d5d3e', wall: '#a8a090', roof: ['#8e6a4c', '#5f4630'], done: ['#9c7a5a', '#7c5c40', '#5a432e'], seam: 'rgba(40,28,18,.35)' },
  library: { slab: '#8a8680', joint: 'rgba(40,40,40,.3)', post: '#5f554b', beam: '#6c5f50', wall: '#a49c90', roof: ['#6e6a72', '#4c4850'], done: ['#7c7882', '#5f5b66', '#46424c'], seam: 'rgba(20,18,24,.35)' },
  watch: { slab: '#8a8680', joint: 'rgba(40,40,40,.3)', post: '#5a4a38', beam: '#6a5640', wall: '#968c7c', roof: ['#6f5a40', '#4f3f2c'], done: ['#7d6646', '#5f4c34', '#463826'], seam: 'rgba(30,22,14,.35)' },
  nursery: { slab: '#8f8b84', joint: 'rgba(50,48,44,.3)', post: '#5f554b', beam: '#6c5f50', wall: '#aab4b4', roof: ['#b9c6c8', '#86969a'], done: ['#cfd8d6', '#a5b6b2', '#7a8c88'], seam: 'rgba(40,56,60,.3)' },
  shaft: { slab: '#7e7a74', joint: 'rgba(40,40,40,.35)', post: '#4f555c', beam: '#5c636b', wall: '#8a8f94', roof: ['#7a8088', '#545a62'], done: ['#8c929a', '#6a7078', '#4c5258'], seam: 'rgba(20,24,30,.5)' },
  clinic: { slab: '#8f8b84', joint: 'rgba(50,48,44,.3)', post: '#6f5a44', beam: '#7a6450', wall: '#b4b0a6', roof: ['#d2d8d8', '#a5b0b2'], done: ['#e4e9ea', '#c3cccd', '#9aa6a8'], seam: 'rgba(50,60,64,.35)' },
};

export function drawBuilding(g, hRect, p, E, t, inside = false) {
  if (p.type === 'test') return;
  if (p.type === 'solar') return drawSolar(g, hRect, p);
  if (p.type === 'field') return drawField(g, hRect, p, t || 0);
  if (p.type === 'pit') return drawPit(g, hRect, p);
  const st = STYLE[p.type] || STYLE.dorm, stage = p.done ? 5 : p.stage, f = progress(p);
  const x = p.x, y = p.y, w = p.w, h = p.h, long = w >= h;
  const along = (fr, fn) => { const n = long ? w : h; for (let i = 0; i < n * fr; i++) fn(long ? x + i : x, long ? y : y + i, long ? 1 : w, long ? h : 1); };
  if (stage < 5) plot(g, hRect, x, y, w, h, stage, f);
  // foundations: a slab laid from one end
  if (stage >= 1 && stage < 5) {
    const fr = stage === 1 ? f : 1;
    along(fr, (a, b, c, d) => { g.fillStyle = st.slab; g.fillRect(a + .05, b + .05, c - .1 + (long ? .1 : 0), d - .1 + (long ? 0 : .1)); hRect(a, b, c, d, .14); });
    g.strokeStyle = st.joint; g.lineWidth = .03;
    for (let i = 1; i < (long ? w : h) * fr; i += p.type === 'shelter' ? 2 : 1) { g.beginPath(); if (long) { g.moveTo(x + i, y + .1); g.lineTo(x + i, y + h - .1); } else { g.moveTo(x + .1, y + i); g.lineTo(x + w - .1, y + i); } g.stroke(); }
    if (p.type !== 'shelter') for (let j = 1; j < (long ? h : w); j++) { g.beginPath(); if (long) { g.moveTo(x + .1, y + j); g.lineTo(x + Math.min(w, w * fr + .5) - .1, y + j); } else { g.moveTo(x + j, y + .1); g.lineTo(x + j, y + Math.min(h, h * fr + .5) - .1); } g.stroke(); }
  }
  if (stage === 4) {
    // fit-out: walls go up, the roof follows them
    const fr = f, n = long ? w : h;
    g.fillStyle = st.wall;
    along(fr, (a, b, c, d) => { if (long) { g.fillRect(a, b, c, .22); g.fillRect(a, b + d - .22, c, .22); hRect(a, b, c, .22, 1.5); hRect(a, b + d - .22, c, .22, 1.5); } else { g.fillRect(a, b, .22, d); g.fillRect(a + c - .22, b, .22, d); hRect(a, b, .22, d, 1.5); hRect(a + c - .22, b, .22, d, 1.5); } });
    const rf = Math.max(0, fr - .25) / .75, nr = Math.floor(n * rf);
    for (let i = 0; i < nr; i++) { const a = long ? x + i : x, b = long ? y : y + i; const gr = g.createLinearGradient(a, b, a + (long ? 1 : w), b + (long ? h : 1)); gr.addColorStop(0, st.roof[0]); gr.addColorStop(1, st.roof[1]); g.fillStyle = gr; g.fillRect(a, b, long ? 1 : w, long ? h : 1); hRect(a, b, long ? 1 : w, long ? h : 1, 1.65); }
  }
  if (stage >= 3 && stage < 5) {
    // systems: power, water and air runs across the slab
    const fr = stage === 3 ? f : 1;
    g.lineWidth = .08; g.lineCap = 'round';
    for (const [c, o] of [['#3fb6d6', .3], ['#d9853f', .55], ['#c8c8c0', .78]]) { g.strokeStyle = c; g.beginPath(); if (long) { g.moveTo(x + .2, y + h * o); g.lineTo(x + .2 + (w - .4) * fr, y + h * o); } else { g.moveTo(x + w * o, y + .2); g.lineTo(x + w * o, y + .2 + (h - .4) * fr); } g.stroke(); }
    const boxes = Math.floor(4 * fr); for (let i = 0; i < boxes; i++) { const a = long ? x + .6 + i * (w - 1.2) / 3 : x + w * .5, b = long ? y + h * .5 : y + .6 + i * (h - 1.2) / 3; g.fillStyle = '#6f7a84'; g.fillRect(a - .35, b - .3, .7, .6); g.fillStyle = 'rgba(120,230,255,.6)'; g.fillRect(a - .2, b - .12, .12, .08); hRect(a - .35, b - .3, .7, .6, .7); }
  }
  if (stage >= 2 && stage < 5) {
    // the frame: posts round the edge, then beams across
    const fr = stage === 2 ? f : 1, posts = [];
    for (let i = 0; i <= w; i += w / Math.round(w / 1.6)) { posts.push([x + i, y]); posts.push([x + i, y + h]); }
    for (let j = h / Math.round(h / 1.6); j < h - .01; j += h / Math.round(h / 1.6)) { posts.push([x, y + j]); posts.push([x + w, y + j]); }
    const np2 = Math.ceil(posts.length * Math.min(1, fr * 1.6));
    for (let i = 0; i < np2; i++) { const [a, b] = posts[i]; g.fillStyle = st.post; g.fillRect(a - .1, b - .1, .2, .2); hRect(a - .1, b - .1, .2, .2, 1.55); }
    if (fr > .5) {
      const bf = (fr - .5) / .5, n = Math.round((long ? w : h) / 1.6); g.strokeStyle = st.beam; g.lineWidth = .1;
      for (let i = 0; i <= n * bf; i++) { g.beginPath(); if (long) { g.moveTo(x + i * w / n, y); g.lineTo(x + i * w / n, y + h); } else { g.moveTo(x, y + i * h / n); g.lineTo(x + w, y + i * h / n); } g.stroke(); hRect(long ? x + i * w / n - .05 : x, long ? y : y + i * h / n - .05, long ? .1 : w, long ? h : .1, 1.6, 1.4); }
    }
  }
  if (stage < 5) return;
  if (inside && p.type !== 'solar' && p.type !== 'shaft') { drawInterior(g, hRect, p, E); crates(g, hRect, p); return; }
  // finished: a roof, a door, windows lit after dark when the building has power
  const gr = g.createLinearGradient(x, y, x + w, y + h); gr.addColorStop(0, st.done[0]); gr.addColorStop(.6, st.done[1]); gr.addColorStop(1, st.done[2]);
  g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(x + .12, y + .15, w, h);
  g.fillStyle = gr; g.beginPath(); g.roundRect(x, y, w, h, .25); g.fill();
  g.strokeStyle = st.seam; g.lineWidth = .03;
  const n = long ? w : h, step = p.type === 'shelter' || p.type === 'workshop' ? 1 : .5;
  for (let i = step; i < n - .01; i += step) { g.beginPath(); if (long) { g.moveTo(x + i, y + .1); g.lineTo(x + i, y + h - .1); } else { g.moveTo(x + .1, y + i); g.lineTo(x + w - .1, y + i); } g.stroke(); }
  g.strokeStyle = 'rgba(255,255,255,.3)'; g.lineWidth = .06; g.beginPath(); if (long) { g.moveTo(x + .2, y + h / 2); g.lineTo(x + w - .2, y + h / 2); } else { g.moveTo(x + w / 2, y + .2); g.lineTo(x + w / 2, y + h - .2); } g.stroke();
  const lit = E.night > .3 && p.powered, cx = x + w / 2, cy = y + h / 2;
  if (p.type === 'shelter') { g.fillStyle = '#28405a'; for (let i = 0; i < 3; i++) { if (long) g.fillRect(x + .7 + i * (w - 1.4) / 2.2, y + .3, .9, h * .3); else g.fillRect(x + .3, y + .7 + i * (h - 1.4) / 2.2, w * .3, .9); } }
  else if (p.type === 'commons') { g.fillStyle = lit ? 'rgba(255,214,140,.85)' : '#2b4258'; g.fillRect(cx - (long ? 1.2 : .6), cy - (long ? .6 : 1.2), long ? 2.4 : 1.2, long ? 1.2 : 2.4); g.fillStyle = '#5a5048'; g.fillRect(x + w - 1.2, y + .5, .5, .5); hRect(x + w - 1.2, y + .5, .5, .5, 2.2); }
  else if (p.type === 'workshop') { for (const k of [.3, .7]) { const a = long ? x + w * k : cx, b = long ? cy : y + h * k; g.fillStyle = '#454b52'; g.beginPath(); g.arc(a, b, .32, 0, 6.3); g.fill(); g.fillStyle = '#2a2f35'; g.beginPath(); g.arc(a, b, .18, 0, 6.3); g.fill(); hRect(a - .3, b - .3, .6, .6, 2); } }
  else if (p.type === 'clinic') { g.fillStyle = '#5fc7c0'; if (long) g.fillRect(x + .2, cy - .25, w - .4, .5); else g.fillRect(cx - .25, y + .2, .5, h - .4); }
  else if (p.type === 'lab') { const n2 = Math.max(1, Math.min(3, Math.round(w * h / 6))); for (let i = 0; i < n2; i++) { const k = (i + .5) / n2, a = long ? x + w * k : cx, b = long ? cy : y + h * k; g.fillStyle = '#56636a'; g.fillRect(a - .3, b - .22, .6, .44); g.fillStyle = 'rgba(120,230,200,.55)'; g.fillRect(a - .2, b - .1, .14, .2); hRect(a - .3, b - .22, .6, .44, 1.9); } }
  else if (p.type === 'plant') {   // round tanks along the roof, glowing faintly while they work
    const n2 = p.cap ? p.cap.tanks : Math.max(1, Math.min(3, Math.round(w * h / 12)));
    for (let i = 0; i < n2; i++) { const k = (i + .5) / n2, a = long ? x + w * k : cx, b = long ? cy : y + h * k, on = p.powered && p.tanks && p.tanks[i] > 0; g.fillStyle = '#4e5a4a'; g.beginPath(); g.arc(a, b, .55, 0, 6.3); g.fill(); g.fillStyle = on ? 'rgba(150,210,110,.75)' : '#34402f'; g.beginPath(); g.arc(a, b, .32, 0, 6.3); g.fill(); hRect(a - .55, b - .55, 1.1, 1.1, 2.2); }
  }
  else if (p.type === 'dorm') { g.fillStyle = '#4c4038'; g.fillRect(x + .6, y + .5, .35, .35); hRect(x + .6, y + .5, .35, .35, 2.1); }
  else if (p.type === 'school') {   // a wide lit window, and a little bell frame over the door end
    g.fillStyle = lit ? 'rgba(255,214,140,.85)' : '#2b4258'; g.fillRect(cx - (long ? 1.4 : .5), cy - (long ? .5 : 1.4), long ? 2.8 : 1, long ? 1 : 2.8);
    g.fillStyle = '#4a3a2a'; g.fillRect(x + .5, y + .5, .6, .6); g.fillStyle = '#b89a50'; g.beginPath(); g.arc(x + .8, y + .8, .18, 0, 6.3); g.fill(); hRect(x + .5, y + .5, .6, .6, 2.4);
  }
  else if (p.type === 'library') {   // a long skylight over the shelves
    g.fillStyle = lit ? 'rgba(255,220,160,.7)' : 'rgba(150,180,210,.45)'; if (long) g.fillRect(x + .5, cy - .2, w - 1, .4); else g.fillRect(cx - .2, y + .5, .4, h - 1);
  }
  else if (p.type === 'watch') {   // a raised lookout with its lamp, lit all night
    const r = Math.min(w, h) * .28; g.fillStyle = '#3e3226'; g.fillRect(cx - r, cy - r, r * 2, r * 2); hRect(cx - r, cy - r, r * 2, r * 2, 3.4);
    g.fillStyle = E.night > .3 ? 'rgba(255,200,110,.95)' : '#6a5a40'; g.beginPath(); g.arc(cx, cy, r * .45, 0, 6.3); g.fill();
  }
  else if (p.type === 'shaft') {   // the headframe over the shaft: steel legs, and the winding wheel turning while the cage runs
    const r = Math.min(w, h) * .36; g.strokeStyle = '#3a3f45'; g.lineWidth = .14;
    g.beginPath(); g.moveTo(cx - r, cy - r); g.lineTo(cx + r, cy + r); g.moveTo(cx + r, cy - r); g.lineTo(cx - r, cy + r); g.stroke();
    g.fillStyle = '#2c3036'; g.beginPath(); g.arc(cx, cy, r * .55, 0, 6.3); g.fill(); hRect(cx - r, cy - r, r * 2, r * 2, 4.2);
    const a = p.powered ? (t || 0) * 1.4 : 0; g.strokeStyle = p.powered ? '#c9b48f' : '#6a6458'; g.lineWidth = .08;
    for (let i = 0; i < 3; i++) { const b = a + i * 2.094; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(b) * r * .5, cy + Math.sin(b) * r * .5); g.stroke(); }
  }
  else if (p.type === 'nursery') {   // the tanks, glowing softly while a child grows in them
    const n2 = p.cap ? p.cap.tanks : 1;
    for (let i = 0; i < n2; i++) { const k = (i + .5) / n2, a = long ? x + w * k : cx, b = long ? cy : y + h * k; g.fillStyle = '#5a6866'; g.beginPath(); g.arc(a, b, .5, 0, 6.3); g.fill(); g.fillStyle = p.powered ? 'rgba(255,170,150,.55)' : '#3a4442'; g.beginPath(); g.arc(a, b, .3, 0, 6.3); g.fill(); hRect(a - .5, b - .5, 1, 1, 2.2); }
  }
  if (!p.powered && p.type !== 'shelter') { g.fillStyle = 'rgba(8,12,18,.22)'; g.beginPath(); g.roundRect(x, y, w, h, .25); g.fill(); }
  // the door, on the side the plan gave it
  const d = p.door, [nx, ny] = NORMAL[p.side];
  if (d) { g.fillStyle = lit ? '#ffd58a' : '#3a434c'; g.fillRect(d.x + .2 - nx * .45, d.y + .2 - ny * .45, .6, .6); }
  g.fillStyle = lit ? 'rgba(255,214,138,.9)' : 'rgba(40,60,80,.9)';
  for (let i = 0; i < 4; i++) { const k = (i + .5) / 4; if (long) { g.fillRect(x + w * k - .2, y - .04, .4, .1); g.fillRect(x + w * k - .2, y + h - .06, .4, .1); } else { g.fillRect(x - .04, y + h * k - .2, .1, .4); g.fillRect(x + w - .06, y + h * k - .2, .1, .4); } }
  hRect(x, y, w, h, 1.7);
  // the workshop's finished modules wait in crates by its door
  crates(g, hRect, p);
}
function crates(g, hRect, p) {
  const d = p.door, [nx, ny] = NORMAL[p.side];
  if (p.type === 'workshop' && d) { let k = 0; for (const m in p.out) for (let i = 0; i < Math.min(p.out[m], 3) && k < 6; i++, k++) crate(g, hRect, d.x + .5 + (ny ? (k - 2.5) * .45 : nx * .2), d.y + .5 + (nx ? (k - 2.5) * .45 : ny * .2), m); }
}
// a field: marked out, the ground broken in rows, made soil spread over it, drains dug round and across, then
// raised beds framed in timber; finished, it shows what grows in it and how far along it is
const CROPLOOK = { potato: { a: '#4f7a3a', b: '#3a5c2c', ripe: '#9a9a4a', dead: '#6b5a3c' }, kale: { a: '#5f8a86', b: '#3f6a68', ripe: '#6f9a92', dead: '#6a6050' }, beans: { a: '#5a8a3c', b: '#3c6a2c', ripe: '#b8b070', dead: '#6e5e40' } };
function drawField(g, hRect, p, t) {
  const stage = p.done ? 5 : p.stage, f = progress(p), x = p.x, y = p.y, w = p.w, h = p.h, long = w >= h, L = long ? w : h, S = long ? h : w;
  const at = (u, v, a, b) => long ? [x + u, y + v, a, b] : [x + v, y + u, b, a];
  const rect = (u, v, a, b, col) => { const [rx, ry, rw, rh] = at(u, v, a, b); g.fillStyle = col; g.fillRect(rx, ry, rw, rh); };
  if (stage < 5) plot(g, hRect, x, y, w, h, stage, f);
  const beds = Math.max(1, Math.floor((S - .3) / 1.25)), bw = (S - .3) / beds;
  // broken ground: furrows turned row by row
  if (stage >= 1) {
    const fr = stage === 1 ? f : 1;
    rect(0, 0, L * fr, S, stage >= 2 ? 'rgba(74,56,38,.55)' : 'rgba(96,74,50,.5)');
    g.strokeStyle = 'rgba(52,38,26,.5)'; g.lineWidth = .05;
    for (let j = 0; j < S * 3; j++) { const v = (j + .5) / 3; const [a, b] = at(0, v, 0, 0), [c, d] = at(L * fr, v, 0, 0); g.beginPath(); g.moveTo(a, b); g.lineTo(c, d); g.stroke(); }
  }
  // made soil: dark and rich, spreading from one end
  if (stage >= 2) {
    const fr = stage === 2 ? f : 1;
    rect(0, 0, L * fr, S, 'rgba(48,36,26,.7)');
    for (let i = 0; i < L * S * 4 * fr; i++) { const u = hash(i, 1, p.id) * L * fr, v = hash(i, 2, p.id) * S; const [a, b] = at(u, v, 0, 0); g.fillStyle = i % 3 ? 'rgba(110,90,60,.5)' : 'rgba(80,100,60,.45)'; g.fillRect(a, b, .06, .06); }
  }
  // drains round the edge and between the beds
  if (stage >= 3) {
    const fr = stage === 3 ? f : 1; g.strokeStyle = '#4a5a60'; g.lineWidth = .12; g.lineCap = 'butt';
    const line = (u0, v0, u1, v1) => { const [a, b] = at(u0, v0, 0, 0), [c, d] = at(u1, v1, 0, 0); g.beginPath(); g.moveTo(a, b); g.lineTo(c, d); g.stroke(); };
    line(0, .06, L * fr, .06); line(0, S - .06, L * fr, S - .06);
    for (let j = 1; j < beds; j++) line(0, .15 + j * bw, L * fr, .15 + j * bw);
    g.strokeStyle = 'rgba(150,190,210,.35)'; g.lineWidth = .04; line(0, .06, L * fr, .06); line(0, S - .06, L * fr, S - .06);
  }
  // raised beds in timber frames
  if (stage >= 4) {
    const fr = stage === 4 ? f : 1;
    for (let j = 0; j < beds; j++) {
      const v = .15 + j * bw + .1, bh = bw - .2, [a, b, c, d] = at(.2, v, (L - .4) * fr, bh);
      g.fillStyle = '#3a2a1e'; g.fillRect(a, b, c, d); g.strokeStyle = '#7d5d3e'; g.lineWidth = .07; g.strokeRect(a, b, c, d); hRect(a, b, c, d, .22);
    }
  }
  if (stage < 5 || !p.crop) return;
  // the crop
  const cr = p.crop, k = cr.k, look = CROPLOOK[k];
  if (!look || cr.st === 'bare') return;
  const gr = cr.st === 'ripe' ? 1 : cr.st === 'dead' ? .7 : Math.max(.08, cr.g), hp = cr.h == null ? 1 : cr.h;
  const col = cr.st === 'dead' ? look.dead : cr.st === 'ripe' ? look.ripe : look.a;
  const step = k === 'beans' ? .6 : .65;
  for (let j = 0; j < beds; j++) for (let u = .45; u < L - .3; u += step) {
    if (hash(u * 10 | 0, j, p.id + 7) > .25 + hp * .75) continue;   // gaps where the frost or a storm took plants
    const v = .15 + j * bw + bw / 2, [px, py] = at(u, v, 0, 0), r = (k === 'kale' ? .3 : k === 'beans' ? .22 : .28) * (.35 + gr * .75);
    const sway = cr.st === 'dead' ? 0 : Math.sin(t * 1.2 + u + j) * .02;
    if (k === 'beans') {   // poles with vines up them
      g.fillStyle = '#7d5d3e'; g.fillRect(px - .03, py - .03, .06, .06);
      g.fillStyle = col; g.beginPath(); g.arc(px + sway, py, r, 0, 6.3); g.fill();
      if (cr.st === 'ripe') { g.fillStyle = '#d8cf90'; for (let q = 0; q < 3; q++) g.fillRect(px - .1 + q * .08, py + .05, .03, .1); }
      hRect(px - r, py - r, r * 2, r * 2, .2 + gr * .9);
    } else if (k === 'kale') {
      for (let q = 0; q < 5; q++) { const a = q * 1.26 + u; g.fillStyle = q % 2 ? col : look.b; g.beginPath(); g.ellipse(px + Math.cos(a) * r * .4 + sway, py + Math.sin(a) * r * .4, r * .55, r * .3, a, 0, 6.3); g.fill(); }
      hRect(px - r, py - r, r * 2, r * 2, .1 + gr * .3);
    } else {
      g.fillStyle = look.b; g.beginPath(); g.arc(px + .03, py + .03, r, 0, 6.3); g.fill(); g.fillStyle = col; g.beginPath(); g.arc(px + sway, py, r * .85, 0, 6.3); g.fill();
      hRect(px - r, py - r, r * 2, r * 2, .1 + gr * .35);
    }
  }
  // harvested rows go back to bare soil as the crew works along the field
  if (cr.st === 'ripe' && cr.total) { const done = 1 - (cr.left || 0) / cr.total; if (done > 0) rect(.2, 0, (L - .4) * done, S, 'rgba(48,36,26,.85)'); }
}
// the plot, pegged and strung before anything is built on it
function plot(g, hRect, x, y, w, h, stage, f) {
  const pegs = [[x, y], [x + w, y], [x + w, y + h], [x, y + h]], np = stage > 0 ? 4 : Math.ceil(f * 4);
  if (stage === 0) { g.setLineDash([.3, .3]); g.strokeStyle = 'rgba(255,240,210,.35)'; g.lineWidth = .05; g.strokeRect(x, y, w, h); g.setLineDash([]); }
  g.strokeStyle = 'rgba(243,170,80,.75)'; g.lineWidth = .05; g.beginPath();
  for (let i = 0; i < np; i++) { const [a, b] = pegs[i], [c, d] = pegs[(i + 1) % 4]; if (i + 1 < np || np === 4) { g.moveTo(a, b); g.lineTo(c, d); } }
  g.stroke();
  for (let i = 0; i < np; i++) { g.fillStyle = '#c98a3e'; g.beginPath(); g.arc(pegs[i][0], pegs[i][1], .1, 0, 6.3); g.fill(); hRect(pegs[i][0] - .06, pegs[i][1] - .06, .12, .12, .5); }
}
// a stone pit: the soil stripped back to bare rock, benches stepping down into it, a timber hoist at the edge;
// it reads deeper as the stone is cut out
function drawPit(g, hRect, p) {
  const stage = p.done ? 5 : p.stage, f = progress(p), x = p.x, y = p.y, w = p.w, h = p.h;
  if (stage < 5) plot(g, hRect, x, y, w, h, stage, f);
  if (stage >= 1) {   // stripped: bare grey stone showing through, spreading from one side
    const fr = stage === 1 ? f : 1;
    g.fillStyle = 'rgba(128,122,112,.8)'; g.fillRect(x + .1, y + .1, (w - .2) * fr, h - .2);
    for (let i = 0; i < w * h * 2 * fr; i++) { g.fillStyle = i % 2 ? 'rgba(90,84,76,.5)' : 'rgba(160,154,142,.45)'; g.fillRect(x + .1 + hash(i, 3, p.id) * (w - .3) * fr, y + .1 + hash(i, 4, p.id) * (h - .3), .1, .08); }
  }
  const full = p.rock0 || 40 * w * h, dug = stage >= 5 ? 1 - (p.rock || 0) / full : 0;
  const steps = stage >= 2 ? Math.min(3, Math.floor((stage === 2 ? f : 1) * 3) + (stage >= 5 ? Math.min(2, Math.floor(dug * 3)) : 0)) : 0;
  for (let k = 1; k <= steps; k++) {   // each bench a step further in and darker, with its lit lip
    const m = k * Math.min(w, h) / 9;
    g.fillStyle = `rgba(${96 - k * 14},${90 - k * 13},${82 - k * 12},.9)`; g.fillRect(x + m, y + m, w - m * 2, h - m * 2);
    g.strokeStyle = 'rgba(200,192,176,.35)'; g.lineWidth = .05; g.strokeRect(x + m, y + m, w - m * 2, h - m * 2);
  }
  if (stage >= 2) {   // the ramp down one side
    g.fillStyle = 'rgba(150,140,124,.75)'; g.fillRect(x + w * .1, y + h - .6, w * .45, .45);
    g.strokeStyle = 'rgba(70,64,56,.5)'; g.lineWidth = .03; for (let i = 1; i < 5; i++) { g.beginPath(); g.moveTo(x + w * .1 + i * w * .09, y + h - .6); g.lineTo(x + w * .1 + i * w * .09, y + h - .15); g.stroke(); }
  }
  if (stage >= 3) {   // the hoist: a timber A-frame over the rim
    const fr = stage === 3 ? f : 1, hx = x + w - .9, hy = y + .5;
    g.strokeStyle = '#7d5d3e'; g.lineWidth = .14; g.lineCap = 'round';
    g.beginPath(); g.moveTo(hx - .4, hy + .6); g.lineTo(hx, hy - .1 + (1 - fr) * .7); g.lineTo(hx + .4, hy + .6); g.stroke();
    if (fr >= 1) { g.lineWidth = .1; g.beginPath(); g.moveTo(hx, hy - .1); g.lineTo(hx - .9, hy + .9); g.stroke(); g.strokeStyle = 'rgba(40,36,30,.7)'; g.lineWidth = .03; g.beginPath(); g.moveTo(hx - .9, hy + .9); g.lineTo(hx - .9, hy + 1.6); g.stroke(); }
    hRect(hx - .4, hy - .1, .8, .7, 1.6);
  }
  if (stage >= 4) {   // cut blocks stacked by the rim, waiting for the carriers
    const n = stage === 4 ? Math.floor(f * 4) : 4;
    for (let i = 0; i < n; i++) { const a = x + .3 + i * .45, b = y + .25; g.fillStyle = i % 2 ? '#b0a999' : '#9d968a'; g.fillRect(a, b, .38, .3); hRect(a, b, .38, .3, .3); }
  }
}
// a solar field: stone footings, timber racks, cable runs, then the panels, one every two tiles by two
function drawSolar(g, hRect, p) {
  const stage = p.done ? 5 : p.stage, f = progress(p), x = p.x, y = p.y, cols = Math.max(1, Math.floor(p.w / 2)), rows = Math.max(1, Math.floor(p.h / 2));
  const ox = x + (p.w - cols * 2) / 2, oy = y + (p.h - rows * 2) / 2, cells = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) cells.push([ox + i * 2, oy + j * 2]);
  if (stage < 5) plot(g, hRect, x, y, p.w, p.h, stage, f);
  const upTo = (s, n) => stage > s ? n : stage === s ? Math.floor(n * f) : 0;
  const nf = upTo(1, cells.length), nr = upTo(2, cells.length), np = stage >= 5 ? cells.length : upTo(4, cells.length);
  for (let k = 0; k < nf; k++) { const [a, b] = cells[k]; g.fillStyle = '#8a8478'; for (const [u, v] of [[.3, .5], [1.7, .5], [.3, 1.6], [1.7, 1.6]]) { g.fillRect(a + u - .12, b + v - .12, .24, .24); hRect(a + u - .12, b + v - .12, .24, .24, .2); } }
  for (let k = 0; k < nr; k++) { const [a, b] = cells[k]; g.strokeStyle = '#7d5d3e'; g.lineWidth = .08; g.strokeRect(a + .3, b + .5, 1.4, 1.1); hRect(a + .3, b + .5, 1.4, .08, .55); }
  if (stage >= 3) {
    const fr = stage === 3 ? f : 1; g.strokeStyle = '#2b2f35'; g.lineWidth = .06;
    for (let j = 0; j < rows; j++) { g.beginPath(); g.moveTo(ox + .2, oy + j * 2 + 1.75); g.lineTo(ox + .2 + (cols * 2 - .4) * fr, oy + j * 2 + 1.75); g.stroke(); }
    g.fillStyle = '#6f7a84'; g.fillRect(x - .1, y + p.h / 2 - .3, .5, .6); hRect(x - .1, y + p.h / 2 - .3, .5, .6, .8);
  }
  for (let k = 0; k < np; k++) {
    const [a, b] = cells[k], gr = g.createLinearGradient(a, b + .4, a + 1.8, b + 1.6); gr.addColorStop(0, '#2c4f7a'); gr.addColorStop(.5, '#1a3252'); gr.addColorStop(1, '#122338');
    g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(a + .25, b + .55, 1.6, 1.15);
    g.fillStyle = gr; g.fillRect(a + .15, b + .4, 1.7, 1.15);
    g.strokeStyle = 'rgba(150,190,230,.35)'; g.lineWidth = .02; for (let q = 1; q < 4; q++) { g.beginPath(); g.moveTo(a + .15 + q * .425, b + .4); g.lineTo(a + .15 + q * .425, b + 1.55); g.stroke(); } g.beginPath(); g.moveTo(a + .15, b + .97); g.lineTo(a + 1.85, b + .97); g.stroke();
    hRect(a + .15, b + .4, 1.7, 1.15, .75, .3);
  }
}
const CRATE = { seal: '#56c2cf', pipe: '#e08a42', power: '#e6c74e', panel: '#2c4f7a', module: '#e8924e' };
function crate(g, hRect, x, y, k) {
  g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(x - .17 + .06, y - .17 + .08, .34, .34);
  g.fillStyle = '#8f979f'; g.fillRect(x - .17, y - .17, .34, .34); g.fillStyle = CRATE[k] || '#e8924e'; g.fillRect(x - .17, y - .04, .34, .08);
  hRect(x - .17, y - .17, .34, .34, .4);
}

// the yard beside the lander: cut stone, stacked timber, the heap of salvage, and the load-test rig at its far end
export function drawYard(g, hRect, Y, stores, tests, t) {
  const long = Y.w >= Y.h, L = long ? Y.w : Y.h, S = long ? Y.h : Y.w;
  const at = (u, v) => long ? [Y.x + u, Y.y + v] : [Y.x + v, Y.y + u];
  g.strokeStyle = 'rgba(255,240,210,.13)'; g.lineWidth = .04; g.setLineDash([.25, .2]); g.strokeRect(Y.x + .05, Y.y + .05, Y.w - .1, Y.h - .1); g.setLineDash([]);
  const st = stores.yard;
  // stone: blocks in rows, two courses high when there are many
  for (let i = 0, n = Math.min(24, st.stone); i < n; i++) {
    const layer = i >= 12 ? 1 : 0, k = i % 12, u = .35 + (k % 3) * .52, v = .4 + (k / 3 | 0) * (S - .8) / 3.6, [a, b] = at(u + layer * .12, v - layer * .12);
    g.fillStyle = layer ? '#b0a999' : '#9d968a'; g.fillRect(a - .2, b - .17, .4, .34); g.strokeStyle = 'rgba(40,36,30,.35)'; g.lineWidth = .02; g.strokeRect(a - .2, b - .17, .4, .34);
    hRect(a - .2, b - .17, .4, .34, .3 + layer * .3);
  }
  // timber: logs stacked across the yard
  for (let i = 0, n = Math.min(14, st.timber); i < n; i++) {
    const layer = i >= 7 ? 1 : 0, k = i % 7, u = 2.2 + k * .26 + layer * .13, [a, b] = at(u, .5 + layer * .1), [c, d] = at(u, S - .5 - layer * .1);
    g.strokeStyle = layer ? '#8a6238' : '#7a5430'; g.lineWidth = .24; g.lineCap = 'round'; g.beginPath(); g.moveTo(a, b); g.lineTo(c, d); g.stroke();
    g.fillStyle = '#c9a273'; g.beginPath(); g.arc(a, b, .09, 0, 6.3); g.fill();
    hRect(Math.min(a, c) - .12, Math.min(b, d) - .12, Math.abs(c - a) + .24, Math.abs(d - b) + .24, .3 + layer * .25);
  }
  // salvage: hull plates and parts from the lander, a heap that shrinks as the workshops use it
  for (let i = 0, n = Math.ceil(st.salvage / 4); i < n; i++) {
    const u = 4.15 + hash(i, 1, 77) * 1.5, v = .3 + hash(i, 2, 77) * (S - 1.4), [a, b] = at(u, v), r = hash(i, 3, 77) * 3.14;
    g.save(); g.translate(a, b); g.rotate(r); g.fillStyle = i % 3 ? '#8b939b' : '#6f7780'; g.fillRect(-.22, -.12, .44, .24); if (i % 4 === 0) { g.fillStyle = '#e8924e'; g.fillRect(-.22, -.03, .44, .05); } g.restore();
    hRect(a - .2, b - .2, .4, .4, .25 + hash(i, 4, 77) * .25);
  }
  // the rig: a frame and a press; samples beside it while a test runs, a blinking light while it presses
  const R = Y.rig, rx = R.x + .5, ry = R.y + .5;
  g.fillStyle = '#4e555d'; g.fillRect(rx - .38, ry - .38, .1, .76); g.fillRect(rx + .28, ry - .38, .1, .76); g.fillStyle = '#6c747c'; g.fillRect(rx - .38, ry - .38, .76, .14);
  g.fillStyle = '#3c4249'; g.fillRect(rx - .18, ry - .1, .36, .26); hRect(rx - .38, ry - .38, .76, .76, 1.1, .2);
  for (const p of tests) {
    const n = p.stage === 0 ? p.got[p.mat] || 0 : 3 - (p.got.test || 0);
    for (let i = 0; i < n; i++) { const a = rx + .5 + (i % 2) * .3, b = ry - .3 + i * .28; if (p.mat === 'stone') { g.fillStyle = '#a49d90'; g.fillRect(a - .12, b - .1, .24, .2); } else { g.strokeStyle = '#7a5430'; g.lineWidth = .14; g.beginPath(); g.moveTo(a - .14, b); g.lineTo(a + .14, b); g.stroke(); } }
    if (p.stage === 1 && Math.sin(t * 5) > 0) { g.fillStyle = '#ff9c5a'; g.beginPath(); g.arc(rx, ry - .3, .07, 0, 6.3); g.fill(); }
  }
}
// what is still in the lander's hold, stacked by the cargo door: hull modules, then the precise kit
export function drawCargo(g, hRect, site, stores) {
  const c = site.cargo, sh = site.shelter, px = sh.dy ? 1 : 0, py = sh.dx ? 1 : 0, cg = stores.cargo;
  const n = Math.ceil(cg.module / CARGO * 8);
  for (let i = 0; i < n; i++) {
    const row = i % 4, col = i / 4 | 0, off = 1.4 + row * .7, side = col ? -1 : 1;
    const x = c.x + .5 + px * off * side + sh.dx * .2, y = c.y + .5 + py * off * side + sh.dy * .2;
    g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(x - .25 + .08, y - .25 + .1, .5, .5);
    g.fillStyle = '#8f979f'; g.fillRect(x - .25, y - .25, .5, .5); g.fillStyle = '#e8924e'; g.fillRect(x - .25, y - .04, .5, .08);
    hRect(x - .25, y - .25, .5, .5, .5);
  }
  let k = 0;
  for (const m of ['seal', 'pipe', 'power', 'panel']) for (let i = 0; i < Math.min(cg[m] || 0, 4) && k < 12; i++, k++) {
    const row = k % 6, col = k / 6 | 0, off = 1.3 + row * .42;
    crate(g, hRect, c.x + .5 + px * off * (col ? -1 : 1) + sh.dx * .75, c.y + .5 + py * off * (col ? -1 : 1) + sh.dy * .75, m);
  }
}
// stumps where trees were felled (with the logs still to be carried), chips where boulders were broken up, and
// fresh-cut faces where rock has been quarried
export function drawMarks(g, hRect, W, vis) {
  const info = W.goneInfo || (W.goneInfo = new Map());
  for (const [t, n] of W.gone) {
    const x = t % MAP, y = t / MAP | 0; if (!vis(x + .5, y + .5, 2)) continue;
    let q = info.get(t); if (q === undefined) { q = propAt(W, x, y); info.set(t, q); }
    if (!q) continue;
    if (q.k === 'tree') {
      const r = .13 * (q.sc || 1);
      for (let i = 0; i < n; i++) {   // logs lying where the tree fell
        const a = hash(x, y, 51) * 6.283 + i * .35, x0 = q.x + Math.cos(a) * .35 + i * .18, y0 = q.y + Math.sin(a) * .35 - i * .14, x1 = x0 + Math.cos(a) * 1.5, y1 = y0 + Math.sin(a) * 1.5;
        g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = .26; g.lineCap = 'round'; g.beginPath(); g.moveTo(x0 + .06, y0 + .08); g.lineTo(x1 + .06, y1 + .08); g.stroke();
        g.strokeStyle = '#7a5430'; g.lineWidth = .22; g.beginPath(); g.moveTo(x0, y0); g.lineTo(x1, y1); g.stroke();
        g.fillStyle = '#c9a273'; g.beginPath(); g.arc(x0, y0, .09, 0, 6.3); g.fill();
        hRect(Math.min(x0, x1) - .1, Math.min(y0, y1) - .1, Math.abs(x1 - x0) + .2, Math.abs(y1 - y0) + .2, .25);
      }
      g.fillStyle = '#5e432c'; g.beginPath(); g.arc(q.x, q.y, r + .04, 0, 6.3); g.fill();
      g.fillStyle = '#c4a072'; g.beginPath(); g.arc(q.x, q.y, r, 0, 6.3); g.fill();
      g.strokeStyle = 'rgba(110,76,44,.6)'; g.lineWidth = .015; g.beginPath(); g.arc(q.x, q.y, r * .55, 0, 6.3); g.stroke();
      hRect(q.x - r, q.y - r, r * 2, r * 2, .2);
    } else if (q.k === 'boulder') chips(g, q.x, q.y, 5, x, y);
  }
  if (!W.quarry) return;
  for (const [t, n] of W.quarry) {
    const x = t % MAP, y = t / MAP | 0; if (!vis(x + .5, y + .5, 2) || W.gone.has(t)) continue;
    if (W.type[t] === T.ROCK) {   // a cut face: lighter stone, chisel marks, growing as more is taken
      const k = clamp(n / 30, .15, 1);
      g.fillStyle = `rgba(196,188,172,${.35 + .45 * k})`; g.fillRect(x + .5 - .45 * k - .05, y + .5 - .45 * k - .05, .9 * k + .1, .9 * k + .1);
      g.strokeStyle = 'rgba(70,64,56,.45)'; g.lineWidth = .025; for (let i = 0; i < 3; i++) { const o = (i + 1) / 4; g.beginPath(); g.moveTo(x + .5 - .45 * k, y + .5 - .45 * k + .9 * k * o); g.lineTo(x + .5 + .45 * k, y + .5 - .45 * k + .9 * k * o - .1); g.stroke(); }
      chips(g, x + .5, y + .5, 3 + Math.min(5, n / 4 | 0), x, y);
    } else { const q = info.get(t) ?? propAt(W, x, y); if (q) chips(g, q.x, q.y, 4, x, y); }
  }
}
function chips(g, cx, cy, n, x, y) {
  for (let i = 0; i < n; i++) { const a = hash(x, y, 60 + i) * 6.283, r = .25 + hash(x, y, 70 + i) * .45; g.fillStyle = i % 2 ? '#a69e90' : '#8d867a'; g.beginPath(); g.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, .045 + hash(x, y, 80 + i) * .05, 0, 6.3); g.fill(); }
}

// a room below ground shows on the surface only as its way down: a timber-framed hatch with steps going into the
// dark, a spoil heap beside it while it is being dug, and a vent pipe once the air is run down
export function drawHatch(g, hRect, p, t) {
  const d = p.door; if (!d) return;
  const x = d.x, y = d.y, stage = p.done ? 5 : p.stage, f = progress(p), [nx, ny] = NORMAL[p.side];
  if (stage < 1) { g.strokeStyle = 'rgba(240,226,190,.7)'; g.lineWidth = .05; g.setLineDash([.15, .12]); g.strokeRect(x + .1, y + .1, .8, .8); g.setLineDash([]); return; }
  // the heap of dug earth to one side, growing as the digging goes on and carted off once it is done
  const heap = stage === 1 ? f : stage < 5 ? 1 - .2 * (stage - 1) : .2, hx = x + .5 - ny * 1.4 + nx * .3, hy = y + .5 + nx * 1.4 + ny * .3;
  if (heap > .05) {
    const r = .35 + heap * .55, col = p.ug && p.ug.kind >= 2 ? ['#8b867e', '#a39d93'] : p.ug && p.ug.kind === 1 ? ['#8a5a3c', '#a36d4a'] : ['#6b5139', '#83654a'];
    g.fillStyle = 'rgba(0,0,0,.25)'; g.beginPath(); g.ellipse(hx + .12, hy + .1, r * 1.1, r * .8, 0, 0, 6.3); g.fill();
    g.fillStyle = col[0]; g.beginPath(); g.ellipse(hx, hy, r, r * .75, 0, 0, 6.3); g.fill();
    g.fillStyle = col[1]; g.beginPath(); g.ellipse(hx - r * .2, hy - r * .2, r * .55, r * .4, 0, 0, 6.3); g.fill();
    hRect(hx - r * .6, hy - r * .5, r * 1.2, r, .3 + heap * .3);
  }
  // the opening: a dark shaft with steps going down away from the door side, in a rim of trodden stone
  g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(x - .12, y - .02, 1.36, 1.3);
  g.fillStyle = '#857d70'; g.fillRect(x - .18, y - .18, 1.36, 1.36); hRect(x - .18, y - .18, 1.36, 1.36, .12);
  g.fillStyle = '#3a2e22'; g.fillRect(x + .04, y + .04, .92, .92);
  g.fillStyle = '#0e0b09'; g.fillRect(x + .14, y + .14, .72, .72);
  g.strokeStyle = 'rgba(150,128,100,.55)'; g.lineWidth = .05;
  for (let i = 1; i <= 3; i++) { const k = i / 4.2; g.beginPath(); if (nx) { const sx = nx > 0 ? x + .86 - k * .72 : x + .14 + k * .72; g.moveTo(sx, y + .18); g.lineTo(sx, y + .82); } else { const sy = ny > 0 ? y + .86 - k * .72 : y + .14 + k * .72; g.moveTo(x + .18, sy); g.lineTo(x + .82, sy); } g.stroke(); }
  if (stage >= 2) {   // a timber frame round the hatch once the shoring starts
    g.strokeStyle = '#7d5d3e'; g.lineWidth = .1; g.strokeRect(x + .08, y + .08, .84, .84); hRect(x, y, 1, .12, .35); hRect(x, y + .88, 1, .12, .35);
  }
  if (stage >= 4 || p.done) {   // the vent stack beside it
    const vx = x + .5 + ny * .95, vy = y + .5 - nx * .95;
    g.fillStyle = '#6a737b'; g.beginPath(); g.arc(vx, vy, .16, 0, 6.3); g.fill(); g.fillStyle = '#2a2f34'; g.beginPath(); g.arc(vx, vy, .08, 0, 6.3); g.fill(); hRect(vx - .15, vy - .15, .3, .3, .9);
    if (p.done && p.powered && t) { const a = .5 + .5 * Math.sin(t * 1.5 + p.id); g.fillStyle = `rgba(210,210,215,${.12 * a})`; g.beginPath(); g.arc(vx + .2, vy - .4 - a * .3, .22 + a * .12, 0, 6.3); g.fill(); }
  }
  if (p.done && p.powered) { g.fillStyle = 'rgba(255,196,120,.35)'; g.fillRect(x + .2, y + .2, .6, .6); }   // lamplight coming up the stairs
}

// lights: windows and a lamp over the door of every lit building, and a work lamp over every site after dark
export function buildingLights(out, projects, on, mul3) {
  for (const p of projects) {
    if (p.type === 'test') continue;
    if (p.below) { if (p.via == null && p.door && (p.done ? p.powered : p.stage > 0 && !p.paused)) out.push({ x: p.door.x + .5, y: p.door.y + .5, z: .6, r: 3.2, c: mul3([1, .74, .45], 1.3 * on), g: .2 }); continue; }
    if (p.done && p.powered && p.type !== 'solar' && p.type !== 'field') {
      if (p.door) out.push({ x: p.door.x + .5, y: p.door.y + .5, z: 1.2, r: 5, c: mul3([1, .78, .5], 1.6 * on), g: .25 });
      const long = p.w >= p.h; for (const k of [.3, .7]) out.push({ x: long ? p.x + p.w * k : p.x - .6, y: long ? p.y - .6 : p.y + p.h * k, z: 1, r: 4, c: mul3([1, .8, .55], 1.1 * on), g: .1 }), out.push({ x: long ? p.x + p.w * k : p.x + p.w + .6, y: long ? p.y + p.h + .6 : p.y + p.h * k, z: 1, r: 4, c: mul3([1, .8, .55], 1.1 * on), g: .1 });
    } else if (!p.done && p.stage > 0 && !p.paused) out.push({ x: p.x + p.w / 2, y: p.y + p.h / 2, z: 2.2, r: 6, c: mul3([1, .88, .7], .6 * on), g: .1 });
  }
}

// ---------- inside a finished building ----------
// With the roofs off the camera sees the floor, the walls with their door, and what each building holds: bunks,
// tables and seats, benches, sickbeds, tanks. The same layout gives the people inside somewhere to be.
const LAYOUT = new Map();
export function layoutOf(p) {
  const key = `${p.type}|${p.x}|${p.y}|${p.w}|${p.h}|${p.side}`; let L = LAYOUT.get(key); if (L) return L;
  const long = p.w >= p.h, ix = p.x + 1, iy = p.y + 1, iw = Math.max(1, p.w - 2), ih = Math.max(1, p.h - 2);
  const U = long ? iw : ih, V = long ? ih : iw, at = (u, v) => long ? [ix + u, iy + v] : [ix + v, iy + u];
  const cap = p.cap || {}, beds = [], seats = [], tables = [], benches = [], work = [];
  if (p.type === 'shelter' || p.type === 'dorm' || p.type === 'clinic') {
    const want = cap.beds || 0, gap = p.type === 'clinic' ? 2 : 1;
    for (let v = 0; v < V && beds.length < want; v++) { if (V > 2 && v % 3 === 1 && p.type !== 'shelter') continue; for (let u = 0; u < U && beds.length < want; u += gap) beds.push(at(u, v)); }
  } else if (p.type === 'commons' || p.type === 'school') {
    for (let v = 1; v < V; v += 3) tables.push([at(0, v), at(U, v + 1)]);
    if (!tables.length) tables.push([at(0, 0), at(U, Math.min(1, V))]);
    const ns = cap.seats || cap.desks || 0;
    for (let v = 0; v < V && seats.length < ns; v++) { if (v % 3 === 1) continue; for (let u = 0; u < U && seats.length < ns; u++) seats.push(at(u + .5, v + .5)); }
    if (p.type === 'school') work.push(at(U / 2, 0));   // the teacher, at the front
  } else if (p.type === 'workshop' || p.type === 'lab' || p.type === 'library') {
    const n = cap.benches || (cap.shelves ? Math.min(cap.shelves, Math.max(1, Math.floor(U / 2))) : 1), span = Math.max(1, Math.floor(U / n));
    for (let i = 0; i < n; i++) { const u = i * span; benches.push([at(u + .1, 0), at(u + Math.min(span, 2) - .1, .8)]); work.push(at(u + Math.min(span, 2) / 2, Math.min(V - .3, 1.4))); }
  }
  L = { long, beds, seats, tables, benches, work }; LAYOUT.set(key, L); return L;
}
const FLOOR = { shelter: ['#6f767d', '#656c73'], clinic: ['#c8ccc6', '#bcc0ba'], lab: ['#a9b0ae', '#9ea5a3'] };
export function drawInterior(g, hRect, p, E) {
  const st = STYLE[p.type] || STYLE.dorm, x = p.x, y = p.y, w = p.w, h = p.h, L = layoutOf(p), lit = E.night > .3 && p.powered;
  // the floor: hull plates in the shelter, tiles in the clinic and lab, boards elsewhere
  const fl = FLOOR[p.type] || ['#8a6c4c', '#7e6244'];
  g.fillStyle = 'rgba(0,0,0,.3)'; g.fillRect(x + .12, y + .15, w, h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { g.fillStyle = fl[(i + j * (FLOOR[p.type] ? 1 : 0)) % 2 ? 1 : 0]; g.fillRect(x + i, y + j, 1, 1); }
  g.strokeStyle = 'rgba(30,22,14,.25)'; g.lineWidth = .03;
  if (!FLOOR[p.type]) for (let j = .5; j < (L.long ? h : w); j += .5) { g.beginPath(); if (L.long) { g.moveTo(x, y + j); g.lineTo(x + w, y + j); } else { g.moveTo(x + j, y); g.lineTo(x + j, y + h); } g.stroke(); }
  // what it holds
  for (const [a, b] of L.beds) {
    const sick = p.type === 'clinic';
    g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(a + .14, b + .16, .78, .76);
    g.fillStyle = sick ? '#9aa6a8' : '#6f5a44'; g.fillRect(a + .1, b + .1, .8, .8);
    g.fillStyle = sick ? '#f1f4f2' : '#b8ad98'; g.fillRect(a + .16, b + .16, .68, .68);
    g.fillStyle = sick ? '#ffffff' : '#ddd6c4'; g.fillRect(a + .2, b + .18, .6, .18);   // the pillow end
    hRect(a + .1, b + .1, .8, .8, .5);
  }
  for (const [[a, b], [c, d]] of L.tables) { g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(a + .25, b + .3, c - a - .3, d - b - .4); g.fillStyle = '#6b4f33'; g.fillRect(a + .2, b + .2, c - a - .4, d - b - .4); g.fillStyle = 'rgba(255,230,190,.12)'; g.fillRect(a + .2, b + .2, c - a - .4, .08); hRect(a + .2, b + .2, c - a - .4, d - b - .4, .8); }
  for (const [a, b] of L.seats) { g.fillStyle = '#5a4430'; g.fillRect(a - .16, b - .16, .32, .32); }
  for (const [[a, b], [c, d]] of L.benches) {
    g.fillStyle = 'rgba(0,0,0,.25)'; g.fillRect(a + .05, b + .08, c - a, d - b);
    if (p.type === 'library') {   // shelves of bound records, in a row of colours
      g.fillStyle = '#5a4430'; g.fillRect(a, b, c - a, d - b); hRect(a, b, c - a, d - b, 1.2);
      const BK = ['#8a3a30', '#3a5a7a', '#6a7a3a', '#8a6a30', '#5a3a6a'];
      for (let q = 0, u = a + .08; u < c - .12; q++, u += .14) { g.fillStyle = BK[q % 5]; g.fillRect(u, b + .08, .1, d - b - .16); }
      continue;
    }
    g.fillStyle = p.type === 'lab' ? '#56636a' : '#5c636b'; g.fillRect(a, b, c - a, d - b); hRect(a, b, c - a, d - b, 1);
    g.fillStyle = p.type === 'lab' ? 'rgba(120,230,200,.6)' : 'rgba(160,170,180,.7)'; g.fillRect(a + .15, b + .15, Math.min(.4, c - a - .3), .2);
    if (p.type === 'workshop') { g.fillStyle = '#3d434a'; g.beginPath(); g.arc(c - .3, (b + d) / 2, .18, 0, 6.3); g.fill(); }
  }
  if (p.type === 'plant' || p.type === 'nursery') {
    const n2 = p.cap ? p.cap.tanks : 1, long = L.long, cx = x + w / 2, cy = y + h / 2;
    for (let i = 0; i < n2; i++) { const k = (i + .5) / n2, a = long ? x + w * k : cx, b = long ? cy : y + h * k, on = p.powered && p.tanks && p.tanks[i] > 0; g.fillStyle = '#4e5a4a'; g.beginPath(); g.arc(a, b, .7, 0, 6.3); g.fill(); g.fillStyle = on ? 'rgba(150,210,110,.75)' : '#34402f'; g.beginPath(); g.arc(a, b, .45, 0, 6.3); g.fill(); hRect(a - .6, b - .6, 1.2, 1.2, 1.4); }
  }
  // lamplight, or the gloom of a building with no power
  if (lit) { const gr = g.createRadialGradient(x + w / 2, y + h / 2, 0, x + w / 2, y + h / 2, Math.max(w, h) * .7); gr.addColorStop(0, 'rgba(255,200,120,.22)'); gr.addColorStop(1, 'rgba(255,200,120,0)'); g.fillStyle = gr; g.fillRect(x, y, w, h); }
  if (!p.powered && p.type !== 'shelter') { g.fillStyle = 'rgba(8,12,18,.3)'; g.fillRect(x, y, w, h); }
  // walls round the edge, open at the door, with windows
  const T2 = .2, d = p.door, [nx, ny] = NORMAL[p.side];
  const gapAt = d ? (nx ? d.y + .5 : d.x + .5) : -9, side = p.side;
  g.fillStyle = st.wall;
  const wall = (s, a, b, c, e) => { if (side === s && d) { const lo = nx ? b : a, len = nx ? e : c, g0 = gapAt - .45 - lo, g1 = gapAt + .45 - lo; if (nx) { g.fillRect(a, b, c, Math.max(0, g0)); g.fillRect(a, b + g1, c, Math.max(0, e - g1)); } else { g.fillRect(a, b, Math.max(0, g0), e); g.fillRect(a + g1, b, Math.max(0, c - g1), e); } void len; } else g.fillRect(a, b, c, e); hRect(a, b, c, e, 2); };
  wall(0, x, y, w, T2); wall(2, x, y + h - T2, w, T2); wall(3, x, y, T2, h); wall(1, x + w - T2, y, T2, h);
  g.fillStyle = lit ? 'rgba(255,214,138,.9)' : 'rgba(120,170,210,.7)';
  for (let i = 0; i < 4; i++) { const k = (i + .5) / 4; if (L.long) { g.fillRect(x + w * k - .2, y + .04, .4, .1); g.fillRect(x + w * k - .2, y + h - .14, .4, .1); } else { g.fillRect(x + .04, y + h * k - .2, .1, .4); g.fillRect(x + w - .14, y + h * k - .2, .1, .4); } }
  g.strokeStyle = 'rgba(20,24,30,.55)'; g.lineWidth = .04; g.strokeRect(x, y, w, h);
}
// where someone inside sits, sleeps or works: their slot in the building's layout, picked steadily by their index
export function spotInside(p, act, i) {
  const L = layoutOf(p), pick = a => a.length ? a[i % a.length] : null, ctr = [p.x + p.w / 2, p.y + p.h / 2];
  if (act === 5) { const b = pick(L.beds); return b ? [b[0] + .5, b[1] + .55, 'sleep'] : [...ctr, 'sleep']; }   // asleep indoors
  if (act === 20 || act === 34 || act === 35) { const s = pick(L.work); return s ? [s[0], s[1], 'work'] : [...ctr, 'work']; }   // at a bench, teaching, at the shelves
  const s = pick(L.seats); if (s) return [s[0], s[1], 'sit'];
  const b = pick(L.beds); if (b) return [b[0] + .5, b[1] + .55, p.type === 'clinic' ? 'sleep' : 'sit'];
  const k = hash(i, p.id, 5); return [p.x + 1 + k * Math.max(.5, p.w - 2), p.y + 1 + hash(i, p.id, 6) * Math.max(.5, p.h - 2), 'sit'];
}

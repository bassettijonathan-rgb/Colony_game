// The planet's local life on the ground: each patch drawn by its kind's shape and colours, smaller and duller
// out of its season, cut down to stubble when it has been picked bare. Only kinds the colony has noticed are
// drawn. Also the kitchen by the fire: the cooking spot and the vats.
import { hash } from '../core/rng.js';
import { MAP } from '../core/consts.js';

const css = (c, a = 1) => `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mixc = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const DORMANT = [104, 86, 62];

export function drawPatch(g, hDisc, k, p, bare, dormant, night, t) {
  const L = k.look, v = p.v, s = L.size * 1.5 * (dormant ? .6 : 1) * (.8 + v * .4), x = p.x, y = p.y;
  let A = L.a, B = L.b;
  if (dormant) { A = mixc(A, DORMANT, .65); B = mixc(B, DORMANT, .6); }
  if (bare) {   // picked bare: a few cut stems and a scuffed patch of ground
    g.fillStyle = 'rgba(70,56,40,.28)'; g.beginPath(); g.ellipse(x, y, s * .5, s * .38, v * 3, 0, 6.3); g.fill();
    g.strokeStyle = css(B, .7); g.lineWidth = .025; g.beginPath();
    for (let i = 0; i < 5; i++) { const a = hash(i, v * 99 | 0, 3) * 6.3, r = s * .3 * hash(i, 5, v * 77 | 0); g.moveTo(x + Math.cos(a) * r, y + Math.sin(a) * r); g.lineTo(x + Math.cos(a) * r + .03, y + Math.sin(a) * r - .05); }
    g.stroke(); return;
  }
  const rot = v * 6.283;
  g.fillStyle = 'rgba(0,0,0,.2)'; g.beginPath(); g.ellipse(x + .06, y + .07, s * .5, s * .4, 0, 0, 6.3); g.fill();
  switch (L.shape) {
    case 'rosette': {
      const n = 7;
      for (let i = 0; i < n; i++) { const a = rot + i / n * 6.283, cx = x + Math.cos(a) * s * .22, cy = y + Math.sin(a) * s * .22; g.fillStyle = css(i % 2 ? A : mixc(A, B, .4)); g.beginPath(); g.ellipse(cx, cy, s * .26, s * .1, a, 0, 6.3); g.fill(); }
      g.fillStyle = css(B); g.beginPath(); g.arc(x, y, s * .1, 0, 6.3); g.fill();
      hDisc(x, y, s * .4, .18); break;
    }
    case 'cap': {
      for (let i = 0; i < 4; i++) { const a = rot + i * 1.9, r = i ? s * .24 : 0, cx = x + Math.cos(a) * r, cy = y + Math.sin(a) * r, cr = s * (i ? .14 : .2);
        g.fillStyle = css(B); g.beginPath(); g.arc(cx + cr * .15, cy + cr * .2, cr, 0, 6.3); g.fill();
        g.fillStyle = css(A); g.beginPath(); g.arc(cx, cy, cr * .9, 0, 6.3); g.fill();
        g.fillStyle = 'rgba(255,255,255,.22)'; g.beginPath(); g.arc(cx - cr * .3, cy - cr * .3, cr * .3, 0, 6.3); g.fill(); hDisc(cx, cy, cr, .14); }
      break;
    }
    case 'tuft': case 'reed': {
      const n = L.shape === 'reed' ? 6 : 10, len = s * (L.shape === 'reed' ? .55 : .42);
      g.lineCap = 'round'; g.lineWidth = L.shape === 'reed' ? .04 : .028;
      for (let i = 0; i < n; i++) { const a = rot + i / n * 6.283 + hash(i, 3, v * 50 | 0) * .5, r0 = s * .06, l = len * (.7 + .5 * hash(i, 7, v * 40 | 0));
        const sway = Math.sin(t * 1.4 + x * .7 + i) * .03;
        g.strokeStyle = css(i % 3 ? A : B); g.beginPath(); g.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0); g.quadraticCurveTo(x + Math.cos(a) * l * .6, y + Math.sin(a) * l * .6 - .04, x + Math.cos(a) * l + sway, y + Math.sin(a) * l - .06); g.stroke();
        if (L.shape === 'reed') { g.fillStyle = css(B); g.beginPath(); g.ellipse(x + Math.cos(a) * l + sway, y + Math.sin(a) * l - .06, .035, .06, a, 0, 6.3); g.fill(); } }
      hDisc(x, y, s * .3, L.shape === 'reed' ? .5 : .25); break;
    }
    case 'bulb': {
      for (let i = 0; i < 3; i++) { const a = rot + i * 2.1, cx = x + Math.cos(a) * s * .18, cy = y + Math.sin(a) * s * .18, r = s * (.13 + .04 * i);
        g.fillStyle = css(B); g.beginPath(); g.arc(cx, cy, r, 0, 6.3); g.fill(); g.fillStyle = css(A); g.beginPath(); g.arc(cx - r * .2, cy - r * .25, r * .7, 0, 6.3); g.fill(); hDisc(cx, cy, r, .12); }
      g.strokeStyle = css(mixc(A, [90, 120, 70], .5)); g.lineWidth = .03; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(rot) * s * .4, y + Math.sin(rot) * s * .4); g.stroke(); break;
    }
    case 'shell': {
      for (let i = 0; i < 5; i++) { const a = rot + i * 1.3, r = s * .28 * hash(i, 9, v * 30 | 0), cx = x + Math.cos(a) * r, cy = y + Math.sin(a) * r, w = s * .13, h = s * .09;
        g.fillStyle = css(i % 2 ? A : B); g.beginPath(); g.ellipse(cx, cy, w, h, a, 0, 6.3); g.fill();
        g.strokeStyle = css(mixc(B, [0, 0, 0], .3), .6); g.lineWidth = .012; g.beginPath(); g.moveTo(cx - Math.cos(a) * w * .7, cy - Math.sin(a) * w * .7); g.lineTo(cx + Math.cos(a) * w * .7, cy + Math.sin(a) * w * .7); g.stroke(); hDisc(cx, cy, w, .06); }
      break;
    }
    case 'mat': {
      for (let i = 0; i < 6; i++) { const a = rot + i * 1.05, r = i ? s * .22 : 0; g.fillStyle = css(i % 2 ? A : mixc(A, B, .5), .9); g.beginPath(); g.arc(x + Math.cos(a) * r, y + Math.sin(a) * r, s * (.16 + hash(i, 4, v * 20 | 0) * .1), 0, 6.3); g.fill(); }
      g.fillStyle = css(mixc(A, [255, 255, 255], .25), .5); for (let i = 0; i < 6; i++) { const a = rot + i * 2.4; g.beginPath(); g.arc(x + Math.cos(a) * s * .25, y + Math.sin(a) * s * .2, .02, 0, 6.3); g.fill(); }
      hDisc(x, y, s * .4, .05); break;
    }
    case 'frond': {
      for (let i = 0; i < 4; i++) { const a = rot + i * 1.6 + hash(i, 2, v * 10 | 0) * .4, l = s * .5, sway = Math.sin(t * 1.1 + x + i) * .04;
        const ex = x + Math.cos(a) * l + sway, ey = y + Math.sin(a) * l;
        g.fillStyle = css(i % 2 ? A : B); g.beginPath(); g.moveTo(x, y); g.quadraticCurveTo(x + Math.cos(a + .35) * l * .6, y + Math.sin(a + .35) * l * .6, ex, ey); g.quadraticCurveTo(x + Math.cos(a - .35) * l * .6, y + Math.sin(a - .35) * l * .6, x, y); g.fill();
        g.strokeStyle = css(mixc(B, [0, 0, 0], .25), .7); g.lineWidth = .015; g.beginPath(); g.moveTo(x, y); g.lineTo(ex, ey); g.stroke(); }
      hDisc(x, y, s * .4, .3); break;
    }
    case 'lantern': {
      const glow = night && !dormant;
      for (let i = 0; i < 3; i++) { const a = rot + i * 2.1, cx = x + Math.cos(a) * s * .2, cy = y + Math.sin(a) * s * .2, r = s * .1, pulse = .75 + .25 * Math.sin(t * 1.7 + i + x);
        g.strokeStyle = css(B); g.lineWidth = .025; g.beginPath(); g.moveTo(x, y); g.lineTo(cx, cy); g.stroke();
        if (glow) { const q = g.createRadialGradient(cx, cy, 0, cx, cy, r * 3); q.addColorStop(0, css(mixc(A, [255, 255, 255], .5), .9 * pulse)); q.addColorStop(1, css(A, 0)); g.fillStyle = q; g.beginPath(); g.arc(cx, cy, r * 3, 0, 6.3); g.fill(); }
        g.fillStyle = glow ? css(mixc(A, [255, 255, 255], .6)) : css(A); g.beginPath(); g.arc(cx, cy, r, 0, 6.3); g.fill(); hDisc(cx, cy, r, .35); }
      break;
    }
    default: g.fillStyle = css(A); g.beginPath(); g.arc(x, y, s * .3, 0, 6.3); g.fill();
  }
}

// the cooking spot by the fire, a pot on a stand, and the vats in a row, full ones capped and labelled by colour
export function drawKitchen(g, hRect, spots, vats, t) {
  if (!spots) return;
  const c = spots.cook, vt = spots.vat;
  if (c != null) {
    const x = c % MAP + .5, y = (c / MAP | 0) + .5;
    g.fillStyle = '#5a5048'; g.fillRect(x - .32, y - .32, .64, .64); hRect(x - .32, y - .32, .64, .64, .45);
    g.fillStyle = '#3d4248'; g.beginPath(); g.arc(x, y, .22, 0, 6.3); g.fill(); g.fillStyle = 'rgba(200,170,110,.8)'; g.beginPath(); g.arc(x, y, .16, 0, 6.3); g.fill();
    g.fillStyle = 'rgba(230,230,230,.18)'; for (let i = 0; i < 3; i++) { const k = (t * .4 + i / 3) % 1; g.beginPath(); g.arc(x + Math.sin(t + i) * .1, y - k * .6, .08 + k * .12, 0, 6.3); g.fill(); }
  }
  if (vt != null) {
    const x = vt % MAP + .5, y = (vt / MAP | 0) + .5;
    for (let i = 0; i < 4; i++) {
      const vx = x - .75 + i * .5, full = vats && vats[i];
      g.fillStyle = 'rgba(0,0,0,.28)'; g.beginPath(); g.arc(vx + .05, y + .06, .2, 0, 6.3); g.fill();
      g.fillStyle = '#7a5c40'; g.beginPath(); g.arc(vx, y, .2, 0, 6.3); g.fill();
      g.fillStyle = full ? (full.proc === 'leach' ? '#4f7a86' : '#8a6a3c') : '#2c241c'; g.beginPath(); g.arc(vx, y, .15, 0, 6.3); g.fill();
      if (full && full.left <= 0) { g.fillStyle = '#e8d08a'; g.beginPath(); g.arc(vx, y, .05, 0, 6.3); g.fill(); }
      g.strokeStyle = '#4a3527'; g.lineWidth = .03; g.beginPath(); g.arc(vx, y, .2, 0, 6.3); g.stroke(); hRect(vx - .2, y - .2, .4, .4, .4);
    }
  }
}

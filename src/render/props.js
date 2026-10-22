// Trees, bushes and boulders, painted once into a sprite sheet (colour) and a matching height sheet,
// then stamped into each chunk as it is painted. Same brushwork as the Lumen mockup.
import { lcg, clamp, sstep } from '../core/rng.js';

const SP = 48;   // sprite pixels per tile
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0); return c; };
const css = (c, a) => a === undefined ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul3 = (a, f) => [a[0] * f, a[1] * f, a[2] * f];
const jit = (c, f, r) => { const k = 1 + (r() - .5) * f; return [c[0] * k, c[1] * k, c[2] * k]; };
function ell(g, x, y, rx, ry, rot) { g.beginPath(); g.ellipse(x, y, Math.max(rx, .001), Math.max(ry, .001), rot || 0, 0, Math.PI * 2); }
function palette(a, b, n) { const p = []; for (let i = 0; i < n; i++) p.push(css(mix3(a, b, i / (n - 1)))); return p; }
function leafDabs(g, cx, cy, rad, n, pal, rr, bias, sz) { for (let i = 0; i < n; i++) { const an = rr() * 6.283, d = Math.sqrt(rr()) * rad; const x = cx + Math.cos(an) * d, y = cy + Math.sin(an) * d; const t = 1 - d / rad; const ci = clamp(Math.floor((t * bias + rr() * (1 - bias)) * pal.length), 0, pal.length - 1); g.fillStyle = pal[ci]; ell(g, x, y, sz * (.6 + rr() * .6), sz * (.35 + rr() * .3), rr() * 3.14); g.fill(); } }

// a height sprite: a dome of the given top, lifted off the ground by base (canopies cast shadows but you can walk under them)
function heightDome(S, R, top, base, pine) {
  const cv = mk(S, S), g = cv.getContext('2d'), c = S / 2, hR = R * SP, id = g.createImageData(S, S);
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const d = Math.hypot((x + .5 - c) / hR, (y + .5 - c) / hR); if (d >= 1) continue;
    const prof = pine ? (1 - d) * .75 + .25 * Math.sqrt(1 - d * d) : Math.sqrt(1 - d * d);
    const h = top * (.32 + .68 * prof), bs = base * sstep(.08, .3, d), o = (y * S + x) * 4;
    id.data[o] = Math.round(h / 4 * 255); id.data[o + 1] = Math.round((1 - bs / 4) * 255); id.data[o + 3] = Math.round(255 * sstep(1, .9, d));
  }
  g.putImageData(id, 0, 0); return cv;
}

function makeTree(kind, v) {
  const rr = lcg(1000 + v * 97 + kind.length * 13);
  const R = kind === 'pine' ? 1.25 + v * .12 : kind === 'birch' ? 1.0 + v * .1 : kind === 'bloom' ? 1.1 + v * .1 : 1.35 + v * .14;
  const S = Math.ceil((R * 2 + .5) * SP), c = S / 2, Rp = R * SP, cv = mk(S, S), g = cv.getContext('2d');
  let top = 3.2, base = 1.1;
  if (kind === 'pine') {
    top = 3.9; base = .5;
    const star = (rad, ri, n, rot, col) => { g.fillStyle = col; g.beginPath(); for (let i = 0; i < n * 2; i++) { const an = rot + i * Math.PI / n; const rd = i % 2 ? ri : rad * (.85 + rr() * .15); g.lineTo(c + Math.cos(an) * rd, c + Math.sin(an) * rd); } g.closePath(); g.fill(); };
    const needles = (rad, n, pal) => { g.lineCap = 'round'; for (let i = 0; i < n; i++) { const an = rr() * 6.283, d0 = rr() * rad * .9, len = SP * (.08 + rr() * .12); const x = c + Math.cos(an) * d0, y = c + Math.sin(an) * d0; g.strokeStyle = pal[Math.floor(rr() * pal.length)]; g.lineWidth = SP * .022; g.beginPath(); g.moveTo(x, y); g.lineTo(x + Math.cos(an + (rr() - .5) * .6) * len, y + Math.sin(an + (rr() - .5) * .6) * len); g.stroke(); } };
    star(Rp, Rp * .62, 11, rr(), '#1d3a30'); needles(Rp * .95, 900, palette([20, 44, 34], [52, 92, 66], 5));
    star(Rp * .74, Rp * .45, 9, rr(), '#2a5040'); needles(Rp * .7, 700, palette([34, 66, 50], [76, 120, 84], 5));
    star(Rp * .42, Rp * .25, 7, rr(), '#3d6a50'); needles(Rp * .4, 350, palette([56, 96, 68], [118, 156, 104], 5));
    g.fillStyle = 'rgba(170,200,140,.5)'; ell(g, c, c, SP * .07, SP * .07); g.fill();
  } else {
    const dk = kind === 'birch' ? [64, 96, 44] : [30, 58, 34], md = kind === 'birch' ? [104, 146, 64] : kind === 'bloom' ? [70, 112, 58] : [56, 96, 46], lt = kind === 'birch' ? [176, 196, 104] : kind === 'bloom' ? [130, 168, 96] : [122, 160, 76];
    if (kind === 'birch') { top = 2.8; base = 1.0; } if (kind === 'bloom') { top = 2.9; base = 1.0; }
    for (let i = 0; i < 16; i++) { const an = rr() * 6.283, d = rr() * Rp * .5; const rad = Rp * (.35 + rr() * .2); g.fillStyle = css(dk); ell(g, c + Math.cos(an) * d, c + Math.sin(an) * d, rad, rad); g.fill(); }
    leafDabs(g, c, c, Rp * .98, 1100, palette(mul3(dk, .8), md, 5), rr, .5, SP * .06);
    if (kind === 'birch') { g.strokeStyle = 'rgba(230,226,214,.85)'; g.lineCap = 'round'; for (let i = 0; i < 6; i++) { const an = rr() * 6.283; g.lineWidth = SP * .04; g.beginPath(); g.moveTo(c, c); g.lineTo(c + Math.cos(an) * Rp * .7, c + Math.sin(an) * Rp * .7); g.stroke(); } }
    const nC = kind === 'birch' ? 8 : 9;
    for (let i = 0; i < nC; i++) {
      const an = i / nC * 6.283 + rr() * .5, d = Rp * (.25 + rr() * .3); const x = c + Math.cos(an) * d, y = c + Math.sin(an) * d, rad = Rp * (.3 + rr() * .14);
      const gr = g.createRadialGradient(x, y - rad * .1, 0, x, y, rad); gr.addColorStop(0, css(mix3(md, lt, .35))); gr.addColorStop(.75, css(md)); gr.addColorStop(1, css(md, 0)); g.fillStyle = gr; ell(g, x, y, rad, rad); g.fill();
      leafDabs(g, x, y, rad * .95, 170, palette(mul3(md, .8), mix3(md, lt, .6), 6), rr, .7, SP * .05);
    }
    for (let i = 0; i < 6; i++) {
      const an = rr() * 6.283, d = Rp * rr() * .32; const x = c + Math.cos(an) * d, y = c + Math.sin(an) * d, rad = Rp * (.15 + rr() * .1);
      const gr = g.createRadialGradient(x, y, 0, x, y, rad); gr.addColorStop(0, css(lt)); gr.addColorStop(.7, css(mix3(md, lt, .6), .9)); gr.addColorStop(1, css(md, 0)); g.fillStyle = gr; ell(g, x, y, rad, rad); g.fill();
      leafDabs(g, x, y, rad, 70, palette(mix3(md, lt, .4), mix3(lt, [230, 230, 170], .3), 5), rr, .8, SP * .04);
    }
    if (kind === 'bloom') for (const k of [1, 2]) for (let i = 0; i < (k === 1 ? 260 : 120); i++) { const an = rr() * 6.283, d = Math.sqrt(rr()) * Rp * (k === 1 ? .85 : .4); g.fillStyle = rr() < .5 ? '#f6d6e2' : rr() < .5 ? '#ffffff' : '#eaa2bd'; ell(g, c + Math.cos(an) * d, c + Math.sin(an) * d, SP * .028, SP * .028); g.fill(); }
  }
  return { cv, h: heightDome(S, R, top, base, kind === 'pine'), size: S / SP };
}
function makeBush(berry, v) {
  const r = lcg(500 + v * 31 + (berry ? 7 : 0)), R = .5 * SP, S = Math.ceil(R * 2.6), cx = S / 2, cy = S / 2, cv = mk(S, S), a = cv.getContext('2d');
  for (let i = 0; i < 7; i++) { const an = r() * 6.28, d = r() * R * .5; a.fillStyle = css(jit([46, 78, 40], .2, r)); ell(a, cx + Math.cos(an) * d, cy + Math.sin(an) * d, R * (.5 + r() * .3), R * (.5 + r() * .3)); a.fill(); }
  for (let i = 0; i < 90; i++) { const an = r() * 6.28, d = Math.sqrt(r()) * R; const t = 1 - d / R; a.fillStyle = css(mix3([40, 70, 36], [120, 156, 74], t * .8 + r() * .2)); ell(a, cx + Math.cos(an) * d, cy + Math.sin(an) * d, R * .12, R * .07, r() * 3); a.fill(); }
  if (berry) for (let i = 0; i < 14; i++) { const an = r() * 6.28, d = r() * R * .85; a.fillStyle = r() < .5 ? '#c8324a' : '#e8506a'; ell(a, cx + Math.cos(an) * d, cy + Math.sin(an) * d, R * .06, R * .06); a.fill(); }
  return { cv, h: heightDome(S, R / SP * 1.05, .55, 0, false), size: S / SP };
}
function makeBoulder(v) {
  const r = lcg(900 + v * 53), R = .42 * SP, S = Math.ceil(R * 2.5), cx = S / 2, cy = S / 2, cv = mk(S, S), a = cv.getContext('2d');
  a.beginPath(); const n = 9; for (let i = 0; i < n; i++) { const an = i / n * 6.28, rr = R * (.8 + r() * .3); a.lineTo(cx + Math.cos(an) * rr, cy + Math.sin(an) * rr * .85); } a.closePath();
  const g = a.createRadialGradient(cx, cy, 0, cx, cy, R); g.addColorStop(0, '#a8a298'); g.addColorStop(1, '#6e6962'); a.fillStyle = g; a.fill(); a.strokeStyle = 'rgba(30,28,26,.45)'; a.lineWidth = 1.2; a.stroke();
  a.strokeStyle = 'rgba(40,36,32,.5)'; a.beginPath(); a.moveTo(cx - R * .3, cy - R * .1); a.lineTo(cx + R * .1, cy + R * .15); a.lineTo(cx + R * .4, cy + R * .05); a.stroke();
  for (let i = 0; i < 4; i++) { a.fillStyle = 'rgba(150,165,90,.5)'; ell(a, cx + (r() - .5) * R, cy + (r() - .5) * R, R * .12, R * .08); a.fill(); }
  return { cv, h: heightDome(S, R / SP, .42 * 2.2, 0, false), size: S / SP };
}

// everything on one sheet; returns the sheets and where each sprite sits on them
export function buildPropSheets() {
  const items = [];
  for (const k of ['oak', 'pine', 'birch', 'bloom']) for (let v = 0; v < 3; v++) items.push([k + v, makeTree(k, v)]);
  for (let v = 0; v < 4; v++) items.push(['bush' + (v & 1 ? 'b' : '') + (v >> 1), makeBush(v & 1, v)]);
  for (let v = 0; v < 6; v++) items.push(['boulder' + v, makeBoulder(v)]);
  const W = 1024; let x = 0, y = 0, rowH = 0; const at = {};
  for (const [, s] of items) { if (x + s.cv.width > W) { x = 0; y += rowH + 2; rowH = 0; } s.px = x; s.py = y; x += s.cv.width + 2; rowH = Math.max(rowH, s.cv.height); }
  const H = y + rowH, col = mk(W, H), hgt = mk(W, H), gc = col.getContext('2d'), gh = hgt.getContext('2d');
  for (const [key, s] of items) { gc.drawImage(s.cv, s.px, s.py); gh.drawImage(s.h, s.px, s.py); at[key] = { u0: s.px / W, v0: s.py / H, u1: (s.px + s.cv.width) / W, v1: (s.py + s.cv.height) / H, size: s.size }; }
  return { col, hgt, at };
}

// quads for a list of props: position, size, rotation; and the sprite's place on the sheet
export function propQuads(list, at) {
  const P = new Float32Array(list.length * 4), U = new Float32Array(list.length * 4);
  list.sort((a, b) => a.y - b.y);
  list.forEach((p, i) => {
    let key, sc = 1;
    if (p.k === 'tree') { key = p.kind + p.v; sc = p.sc; }
    else if (p.k === 'bush') { key = 'bush' + (p.berry ? 'b' : '') + (p.seed & 1); sc = p.r / .36; }
    else { key = 'boulder' + (p.seed % 6); sc = p.r / .34; }
    const a = at[key];
    P.set([p.x, p.y, a.size * sc, ((p.seed || (p.x * 7.13 + p.y * 3.7) * 1000) % 628) / 100], i * 4);
    U.set([a.u0, a.v0, a.u1, a.v1], i * 4);
  });
  return { P, U, n: list.length };
}

// Colonists drawn from above in the Lumen style: a body in the crew's colour, a head with its own skin,
// hair or headgear, hands that swing as they walk. Each person's sprites are made once, when first seen.
// Also the Seed itself, the lander everyone lives around.
import { lcg } from '../core/rng.js';

const SP = 64;
const mk = (w, h) => { const c = document.createElement('canvas'); c.width = Math.max(1, w | 0); c.height = Math.max(1, h | 0); return c; };
const css = (c, a) => a === undefined ? `rgb(${c[0] | 0},${c[1] | 0},${c[2] | 0})` : `rgba(${c[0] | 0},${c[1] | 0},${c[2] | 0},${a})`;
const mix3 = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];
const mul3 = (a, f) => [a[0] * f, a[1] * f, a[2] * f];
function ell(g, x, y, rx, ry, rot) { g.beginPath(); g.ellipse(x, y, Math.max(rx, .001), Math.max(ry, .001), rot || 0, 0, Math.PI * 2); }
function rrect(g, x, y, w, h, r) { g.beginPath(); g.moveTo(x + r, y); g.arcTo(x + w, y, x + w, y + h, r); g.arcTo(x + w, y + h, x, y + h, r); g.arcTo(x, y + h, x, y, r); g.arcTo(x, y, x + w, y, r); g.closePath(); }
function hsl(h, s, l) { const a = s * Math.min(l, 1 - l), f = n => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); }; return [f(0) * 255, f(8) * 255, f(4) * 255]; }

// a crew's colour: spread around the wheel, muted like work clothes
export const crewColour = k => hsl((k * 137.508 + 25) % 360, .42, .45);
const SKIN = [[238, 200, 170], [226, 180, 150], [214, 168, 130], [192, 138, 98], [160, 112, 78], [124, 84, 58], [98, 66, 46], [236, 196, 160]];
const HAIR = [[156, 64, 36], [58, 40, 28], [30, 28, 26], [28, 24, 30], [110, 96, 88], [222, 186, 110], [190, 190, 196], [120, 70, 40]];
const STYLES = ['bob', 'curly', 'short', 'bun', 'pony', 'cap', 'bald', 'bandana', 'helmet', 'beanie', 'short', 'bun'];

export function lookOf(c, crew) {
  const r = lcg(c.look + 11);
  const app = crewColour(crew);
  return { app, app2: mix3(app, [240, 230, 210], .55), skin: SKIN[(r() * SKIN.length) | 0], hair: HAIR[(r() * HAIR.length) | 0], style: STYLES[(r() * STYLES.length) | 0], capc: hsl(r() * 360, .35, .4), trim: r() };
}
function makeBody(L) {
  const cv = mk(SP, SP), g = cv.getContext('2d'); g.translate(SP / 2, SP / 2); g.scale(SP, SP);
  const gr = g.createRadialGradient(0, -.04, 0, 0, 0, .3); gr.addColorStop(0, css(mix3(L.app, [255, 255, 255], .18))); gr.addColorStop(.7, css(L.app)); gr.addColorStop(1, css(mul3(L.app, .72)));
  g.fillStyle = gr; ell(g, 0, .02, .27, .15); g.fill(); g.strokeStyle = css(mul3(L.app, .55), .7); g.lineWidth = .012; g.stroke();
  g.lineCap = 'round';
  // suit details: a pack, shoulder seams, or a strap
  if (L.trim < .35) { g.fillStyle = css(mul3(L.app, .62)); rrect(g, -.13, .03, .26, .11, .03); g.fill(); g.fillStyle = 'rgba(255,255,255,.18)'; g.fillRect(-.1, .05, .2, .015); }
  else if (L.trim < .7) { g.strokeStyle = css(L.app2, .85); g.lineWidth = .022; g.beginPath(); g.moveTo(-.2, -.02); g.quadraticCurveTo(0, .05, .2, -.02); g.stroke(); }
  else { g.strokeStyle = 'rgba(40,30,22,.85)'; g.lineWidth = .03; g.beginPath(); g.moveTo(-.2, -.06); g.lineTo(.18, .12); g.stroke(); }
  return cv;
}
function makeHead(L) {
  const cv = mk(SP, SP), g = cv.getContext('2d'); g.translate(SP / 2, SP / 2); g.scale(SP, SP);
  const sk = g.createRadialGradient(-.02, -.05, 0, 0, -.02, .14); sk.addColorStop(0, css(mix3(L.skin, [255, 255, 255], .15))); sk.addColorStop(1, css(mul3(L.skin, .85)));
  g.fillStyle = sk; ell(g, 0, -.02, .125, .125); g.fill(); g.fillStyle = css(mul3(L.skin, .9)); ell(g, 0, -.14, .03, .025); g.fill();
  g.fillStyle = css(mul3(L.skin, .85)); ell(g, -.125, -.02, .025, .04); g.fill(); ell(g, .125, -.02, .025, .04); g.fill();
  const H = L.hair, hg = (x, y, r) => { const q = g.createRadialGradient(x - .02, y - .02, 0, x, y, r); q.addColorStop(0, css(mix3(H, [255, 255, 255], .22))); q.addColorStop(1, css(mul3(H, .75))); return q; };
  switch (L.style) {
    case 'bob': g.fillStyle = hg(0, 0, .14); g.beginPath(); g.arc(0, 0, .138, -2.9, -.24, true); g.closePath(); g.fill(); ell(g, 0, .01, .138, .12); g.fill(); break;
    case 'curly': for (let i = 0; i < 14; i++) { const an = i / 14 * 6.283; g.fillStyle = hg(Math.cos(an) * .1, Math.sin(an) * .1 + .02, .05); ell(g, Math.cos(an) * .095, Math.sin(an) * .085 + .03, .05, .05); g.fill(); } g.fillStyle = hg(0, .02, .1); ell(g, 0, .02, .1, .09); g.fill(); break;
    case 'beanie': g.fillStyle = css(L.capc); ell(g, 0, 0, .135, .13); g.fill(); g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = .008; for (let i = -3; i <= 3; i++) { g.beginPath(); g.moveTo(i * .035, -.11); g.lineTo(i * .035, .12); g.stroke(); } g.fillStyle = css(mix3(L.capc, [255, 255, 255], .3)); ell(g, 0, .01, .035, .035); g.fill(); break;
    case 'pony': g.fillStyle = hg(0, 0, .14); ell(g, 0, .01, .132, .122); g.fill(); g.fillStyle = css(mul3(L.skin, .98)); g.beginPath(); g.ellipse(0, -.07, .09, .05, 0, Math.PI, 0); g.fill(); g.fillStyle = hg(0, .2, .06); ell(g, 0, .19, .045, .08); g.fill(); break;
    case 'short': g.fillStyle = hg(0, .01, .135); ell(g, 0, .012, .13, .122); g.fill(); g.fillStyle = css(mul3(L.skin, .97)); g.beginPath(); g.ellipse(0, -.078, .074, .04, 0, Math.PI, 0); g.fill(); break;
    case 'bun': g.fillStyle = hg(0, .01, .135); ell(g, 0, .012, .13, .122); g.fill(); g.fillStyle = css(mul3(L.skin, .97)); g.beginPath(); g.ellipse(0, -.078, .074, .04, 0, Math.PI, 0); g.fill(); g.fillStyle = hg(0, .12, .06); ell(g, 0, .11, .058, .052); g.fill(); break;
    case 'cap': { const k = L.capc; g.fillStyle = css(k); ell(g, 0, .012, .134, .128); g.fill(); g.fillStyle = css(mul3(k, .78)); ell(g, 0, -.125, .1, .06); g.fill(); g.fillStyle = 'rgba(255,255,255,.18)'; ell(g, -.03, -.01, .05, .04); g.fill(); break; }
    case 'bald': g.fillStyle = 'rgba(255,255,255,.2)'; ell(g, -.03, -.04, .05, .04); g.fill(); break;
    case 'bandana': { const k = L.capc; g.fillStyle = hg(0, .01, .135); ell(g, 0, .012, .13, .122); g.fill(); g.fillStyle = css(k); g.beginPath(); g.ellipse(0, 0, .134, .128, 0, Math.PI * 1.05, Math.PI * 1.95); g.lineTo(0, -.02); g.closePath(); g.fill(); ell(g, 0, .13, .035, .03); g.fill(); break; }
    case 'helmet': { const k = mix3(L.app, [200, 205, 210], .5), q = g.createRadialGradient(-.04, -.04, 0, 0, 0, .16); q.addColorStop(0, css(mix3(k, [255, 255, 255], .25))); q.addColorStop(1, css(mul3(k, .7))); g.fillStyle = css(mul3(k, .55)); ell(g, 0, 0, .16, .154); g.fill(); g.fillStyle = q; ell(g, 0, 0, .136, .13); g.fill(); g.fillStyle = 'rgba(140,220,255,.55)'; ell(g, 0, -.11, .07, .03); g.fill(); break; }
  }
  return cv;
}

// what the renderer keeps per person between frames
export class PersonArt {
  constructor(c, crew) { this.L = lookOf(c, crew); this.body = null; this.head = null; this.walk = Math.random() * 6; }
  ensure() { if (!this.body) { this.body = makeBody(this.L); this.head = makeHead(this.L); } }
}

// one person, at world position x,y, facing ang (radians), in world units on a canvas already scaled to tiles
export function drawPerson(g, a, x, y, ang, moving, mode, t) {
  a.ensure();
  if (mode === 0) {   // asleep in a bedroll by the Seed
    g.save(); g.translate(x, y); g.rotate(ang + Math.PI / 2);
    const gr = g.createRadialGradient(0, .15, 0, 0, .15, .5); gr.addColorStop(0, css(mix3(a.L.app, [255, 255, 255], .25))); gr.addColorStop(1, css(mul3(a.L.app, .7)));
    g.fillStyle = 'rgba(0,0,0,.25)'; ell(g, .03, .2, .3, .5); g.fill(); g.fillStyle = gr; ell(g, 0, .15, .28, .48); g.fill();
    g.strokeStyle = 'rgba(255,255,255,.15)'; g.lineWidth = .02; g.beginPath(); g.moveTo(-.22, -.05); g.lineTo(.22, -.05); g.stroke();
    g.translate(0, -.3); g.scale(1.45, 1.45); g.drawImage(a.head, -.5, -.5, 1, 1); g.restore(); return;
  }
  const ph = a.walk, bob = moving ? Math.abs(Math.sin(ph)) * .018 : 0, sw = moving ? Math.sin(ph) : 0, work = mode === 3 && !moving, act = work ? Math.sin(t * 3 + a.walk) : 0;
  g.save(); g.translate(x, y); g.rotate(ang + Math.PI / 2); const sc = (1 + bob) * 1.75; g.scale(sc, sc);
  const arm = css(mul3(a.L.app, .82)), skin = css(a.L.skin);
  const hand = (hx, hy) => { g.fillStyle = arm; ell(g, hx * .8, hy * .6 + .02, .06, .075); g.fill(); g.fillStyle = skin; ell(g, hx, hy, .05, .05); g.fill(); };
  let lh = [-.25, sw * .1], rh = [.25, -sw * .1];
  if (work) { lh = [-.12, -.22 + act * .02]; rh = [.12, -.22 - act * .02]; }
  hand(lh[0], lh[1]); hand(rh[0], rh[1]);
  if (work) { g.fillStyle = '#2a3038'; rrect(g, -.1, -.34, .2, .12, .02); g.fill(); g.fillStyle = `rgba(120,220,255,${.55 + .3 * Math.sin(t * 2 + a.walk)})`; rrect(g, -.085, -.33, .17, .09, .015); g.fill(); }
  g.drawImage(a.body, -.5, -.5, 1, 1); g.drawImage(a.head, -.5, -.5, 1, 1);
  g.restore();
}
// far away, people are dots in their crew's colour
export function drawDot(g, a, x, y, r) { g.fillStyle = css(a.L.app); g.beginPath(); g.arc(x, y, r, 0, 6.2832); g.fill(); }

// ---------- the Seed: an eight-sided lander on four struts, petals of collectors open around it ----------
export function makeSeed() {
  const R = 3.2, S = Math.ceil(R * 2 * SP), c = S / 2, cv = mk(S, S), g = cv.getContext('2d');
  g.translate(c, c); g.scale(SP, SP); g.lineJoin = 'round';
  // collector petals
  for (let i = 0; i < 6; i++) {
    g.save(); g.rotate(i * Math.PI / 3 + Math.PI / 6);
    g.fillStyle = 'rgba(0,0,0,.3)'; rrect(g, -.42, 1.25, .84, 1.75, .08); g.fill();
    const gr = g.createLinearGradient(0, 1.2, 0, 2.9); gr.addColorStop(0, '#1d2a3a'); gr.addColorStop(1, '#2c4058'); g.fillStyle = gr; rrect(g, -.4, 1.2, .8, 1.7, .07); g.fill();
    g.strokeStyle = 'rgba(150,190,230,.35)'; g.lineWidth = .02; for (let k = 1; k < 5; k++) { g.beginPath(); g.moveTo(-.4, 1.2 + k * .34); g.lineTo(.4, 1.2 + k * .34); g.stroke(); } g.beginPath(); g.moveTo(0, 1.2); g.lineTo(0, 2.9); g.stroke();
    g.fillStyle = '#9aa4ae'; g.fillRect(-.06, .9, .12, .35);
    g.restore();
  }
  // landing struts
  for (let i = 0; i < 4; i++) { g.save(); g.rotate(i * Math.PI / 2 + Math.PI / 4); g.strokeStyle = '#59626c'; g.lineWidth = .14; g.lineCap = 'round'; g.beginPath(); g.moveTo(0, 1.1); g.lineTo(0, 2.05); g.stroke(); g.fillStyle = '#7b848e'; ell(g, 0, 2.1, .22, .16); g.fill(); g.restore(); }
  // hull
  const oct = (r) => { g.beginPath(); for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + Math.PI / 8; g.lineTo(Math.cos(a) * r, Math.sin(a) * r); } g.closePath(); };
  g.fillStyle = 'rgba(0,0,0,.35)'; g.save(); g.translate(.08, .1); oct(1.55); g.fill(); g.restore();
  let gr = g.createRadialGradient(-.4, -.5, .2, 0, 0, 1.6); gr.addColorStop(0, '#e6e9ec'); gr.addColorStop(.7, '#a9b1b9'); gr.addColorStop(1, '#6f7881'); g.fillStyle = gr; oct(1.5); g.fill();
  g.strokeStyle = 'rgba(40,46,54,.6)'; g.lineWidth = .025; oct(1.5); g.stroke();
  for (let i = 0; i < 8; i++) { const a = i * Math.PI / 4 + Math.PI / 8; g.beginPath(); g.moveTo(Math.cos(a) * .75, Math.sin(a) * .75); g.lineTo(Math.cos(a) * 1.5, Math.sin(a) * 1.5); g.stroke(); }
  oct(.95); g.stroke();
  // vents and markings
  g.fillStyle = '#e8924e'; for (let i = 0; i < 4; i++) { g.save(); g.rotate(i * Math.PI / 2); g.fillRect(-.16, -1.38, .32, .07); g.restore(); }
  // the core: dark glass with the archive's glow
  gr = g.createRadialGradient(-.15, -.2, .05, 0, 0, .75); gr.addColorStop(0, '#3a5266'); gr.addColorStop(.8, '#0e1a26'); gr.addColorStop(1, '#05090e'); g.fillStyle = gr; ell(g, 0, 0, .72, .72); g.fill();
  g.strokeStyle = 'rgba(120,230,255,.85)'; g.lineWidth = .05; ell(g, 0, 0, .58, .58); g.stroke();
  g.fillStyle = 'rgba(255,255,255,.35)'; ell(g, -.25, -.3, .18, .1, -.6); g.fill();
  return { cv, size: S / SP };
}

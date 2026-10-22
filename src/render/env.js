// Sun, sky and grading through the day (the Lumen mockup's keys), and which lamps get one of the 24
// real-time lights this frame.
import { clamp, sstep } from '../core/rng.js';

const mul3 = (a, f) => [a[0] * f, a[1] * f, a[2] * f];
function keys(h, K) { h = ((h % 24) + 24) % 24; for (let i = 0; i < K.length - 1; i++) { const a = K[i], b = K[i + 1]; if (h >= a[0] && h <= b[0]) { const t = (h - a[0]) / (b[0] - a[0] || 1); const s = t * t * (3 - 2 * t); return a[1].map((v, j) => v + (b[1][j] - v) * s); } } return K[0][1].slice(); }
const K_SUN = [[0, [1, .5, .3]], [5.6, [1, .42, .28]], [6.4, [1, .6, .42]], [7.6, [1, .8, .62]], [10, [1, .93, .82]], [13, [1, .97, .9]], [16, [1, .9, .74]], [17.4, [1, .74, .5]], [18.4, [1, .56, .32]], [19.2, [.95, .42, .3]], [24, [1, .5, .3]]];
const K_AMB = [[0, [.03, .045, .1]], [4.8, [.035, .05, .11]], [5.6, [.15, .12, .2]], [6.4, [.3, .27, .34]], [7.6, [.36, .38, .46]], [13, [.38, .43, .52]], [17.2, [.44, .42, .5]], [18.4, [.32, .25, .32]], [19.2, [.16, .12, .2]], [20, [.06, .065, .14]], [21, [.035, .05, .11]], [24, [.03, .045, .1]]];
const K_SKY = [[0, [.02, .035, .09]], [5, [.04, .05, .12]], [6, [.6, .38, .42]], [7.5, [.5, .62, .85]], [13, [.45, .62, .9]], [17.5, [.7, .55, .5]], [18.8, [.75, .38, .35]], [19.8, [.1, .1, .22]], [21, [.02, .035, .09]], [24, [.02, .035, .09]]];
const K_GAIN = [[0, [.84, .95, 1.16]], [5, [.86, .95, 1.14]], [6.2, [1.06, .95, .96]], [8, [1.03, 1, .97]], [13, [1.02, 1.0, .98]], [16.5, [1.05, .99, .93]], [18, [1.1, .96, .86]], [19.2, [1.0, .9, 1.0]], [20.2, [.86, .95, 1.15]], [24, [.84, .95, 1.16]]];
const K_LIFT = [[0, [.004, .012, .035]], [5.5, [.02, .012, .03]], [7, [.012, .012, .02]], [13, [.01, .012, .02]], [18, [.03, .012, .02]], [19.5, [.02, .008, .04]], [21, [.004, .012, .035]], [24, [.004, .012, .035]]];
const K_MISC = [[0, [1.75, .72, .08]], [5, [1.7, .74, .12]], [6.3, [1.15, .95, .55]], [8, [1.0, 1.04, .18]], [9.5, [1.0, 1.0, 0]], [12, [.94, .98, 0]], [15, [.97, 1.0, 0]], [17, [1.02, 1.05, 0]], [19.5, [1.3, .92, 0]], [21, [1.75, .72, .06]], [24, [1.75, .72, .08]]];   // exposure, saturation, mist

export function env(h) {
  const SR = 5.8, SS = 18.9, p = (h - SR) / (SS - SR); let key = [0, 0, 1], kc = [0, 0, 0];
  const sunEl = Math.sin(clamp(p, 0, 1) * Math.PI) * (p > 0 && p < 1 ? 1 : 0) * 1.08;
  const night = clamp(1 - sstep(5.1, 6.6, h) + sstep(18.6, 20.1, h), 0, 1);
  if (p > 0 && p < 1) {
    const az = p * Math.PI, el = Math.max(.06, sunEl * .86), hx = Math.cos(az), hy = Math.sin(az) * .55 + .25, hl = Math.hypot(hx, hy), ce = Math.cos(el);
    key = [hx / hl * ce, hy / hl * ce, Math.sin(el)];
    const str = 2.35 / Math.pow(Math.max(key[2], .28), .75) * sstep(0, .14, sunEl); kc = mul3(keys(h, K_SUN), str);
  } else {
    const hn = h < 12 ? h + 24 : h, q = clamp((hn - 19.4) / (29.6 - 19.4), 0, 1), az = q * Math.PI, el = .25 + Math.sin(q * Math.PI) * .6, hx = Math.cos(az), hy = -.35, hl = Math.hypot(hx, hy);
    key = [hx / hl * Math.cos(el), hy / hl * Math.cos(el), Math.sin(el)]; kc = mul3([.42, .55, .95], .32 * sstep(0, .15, q) * sstep(1, .85, q) * night);
  }
  const m = keys(h, K_MISC);
  return { key, kc, amb: keys(h, K_AMB), sky: keys(h, K_SKY), gain: keys(h, K_GAIN), lift: keys(h, K_LIFT), exp: m[0], sat: m[1], mist: m[2], night, cloud: (1 - night) * .85 };
}

// all the lamps that could be lit, nearest to the middle of the view first; the first 24 get lit
export function pickLights(all, cx, cy, view) {
  const vis = [];
  for (const l of all) { if (l.x + l.r < view[0] || l.x - l.r > view[2] || l.y + l.r < view[1] || l.y - l.r > view[3]) continue; l.d = Math.hypot(l.x - cx, l.y - cy); vis.push(l); }
  vis.sort((a, b) => a.d - b.d);
  return { lit: vis.slice(0, 24), inView: vis.length };
}

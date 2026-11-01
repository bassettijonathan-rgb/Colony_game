// The land's heights as people talk about them: metres above or below the camp (where the Seed came down), and the
// hollows the ground makes, where anything heavier than air settles on a still night. The page uses these for the
// height view and the plan card, the simulation for the story.
import { MAP, T } from './consts.js';

export const M_PER = .8;   // metres for each step of the map's height field
export const campStep = W => W.land ? W.elev[W.land.y * MAP + W.land.x] : 0;
// metres above (+) or below (-) the camp
export const fromCamp = (W, t) => (W.elev[t] - campStep(W)) * M_PER;
// how much lower the ground here lies than the ground 9 tiles (about 18 m) out all round it, in metres
export function hollowAt(W, x, y) {
  x = Math.floor(x); y = Math.floor(y);
  if (x < 9 || y < 9 || x > MAP - 10 || y > MAP - 10) return 0;
  let m = 0;
  for (let k = 0; k < 8; k++) { const a = k * Math.PI / 4; m += W.elev[Math.round(y + Math.sin(a) * 9) * MAP + Math.round(x + Math.cos(a) * 9)]; }
  return Math.max(0, (m / 8 - W.elev[y * MAP + x]) * M_PER);
}
export const HOLLOW_M = 1.2;   // shallower than this, the ground is only uneven
// the ground at a tile, for a card or the pointer: "6 m below the camp", and "in a hollow about 3 m deep"
export function groundAt(W, x, y) {
  const t = Math.floor(y) * MAP + Math.floor(x), m = Math.round(fromCamp(W, t)), h = hollowAt(W, x, y), ty = W.type[t];
  return {
    m, wet: ty === T.SHALLOW || ty === T.DEEP, hollow: h >= HOLLOW_M ? Math.max(1, Math.round(h)) : 0,
    height: m === 0 ? 'level with the camp' : `${Math.abs(m)} m ${m < 0 ? 'below' : 'above'} the camp`,
  };
}
export const hollowWords = g => g.hollow ? `in a hollow about ${g.hollow} m deep` : '';

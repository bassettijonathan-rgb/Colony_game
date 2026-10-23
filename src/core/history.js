// The colony's record, one row a day, for the Stats window's charts. Running totals (deaths, loads foraged,
// meals cooked) are stored as totals; the page turns them into per-day amounts. Temperatures and cold are
// gathered hour by hour through the day.
import { MAP } from './consts.js';
import { mealsInStore } from './food.js';
import { built } from './build.js';

export const HIST_KEYS = ['day', 'alive', 'deaths', 'meals', 'rations', 'foraged', 'harvests', 'cooked', 'fat', 'str', 'tru', 'hp', 'chill', 'tmin', 'tmax', 'supply', 'draw', 'stone', 'timber', 'known', 'seen', 'tested', 'built', 'hungry', 'unwell', 'hurt', 'treated'];
export const newHist = () => ({ rows: [], acc: null });

// every hour: the day's coldest and warmest, and the colony's coldest average
export function histHour(sim, t) {
  const H = sim.S.hist, live = sim.S.cols.filter(c => !c.dead);
  const chill = live.length ? live.reduce((a, c) => a + c.chill, 0) / live.length : 0;
  if (!H.acc) H.acc = { tmin: t, tmax: t, chill };
  else { H.acc.tmin = Math.min(H.acc.tmin, t); H.acc.tmax = Math.max(H.acc.tmax, t); H.acc.chill = Math.max(H.acc.chill, chill); }
}
// one day's row; for today, the day so far
export function histRow(sim, day) {
  const S = sim.S, H = S.hist, live = S.cols.filter(c => !c.dead), n = live.length || 1, avg = k => Math.round(live.reduce((a, c) => a + c[k], 0) / n);
  const a = H.acc || { tmin: S.F.temp, tmax: S.F.temp, chill: 0 }, st = S.stats, F = S.F;
  const row = {
    day, alive: live.length, deaths: st.deaths || 0, meals: Math.round(mealsInStore(sim, true)), rations: Math.floor(S.food),
    foraged: st.foraged || 0, harvests: st.harvests || 0, cooked: st.meals || 0,
    fat: avg('fat'), str: avg('str'), tru: avg('tru'), hp: avg('hp'), chill: Math.round(a.chill),
    tmin: Math.round(a.tmin * 10) / 10, tmax: Math.round(a.tmax * 10) / 10, supply: S.power.supply, draw: S.power.draw,
    stone: S.stores.yard.stone, timber: S.stores.yard.timber, known: Math.round(S.knownN / (MAP * MAP) * 1000) / 10,
    seen: F.life.filter(l => l.seen).length, tested: F.life.filter(l => l.tested).length, built: built(S).length,
    hungry: live.filter(c => c.hungry).length, unwell: live.filter(c => c.unwell).length,
    hurt: live.filter(c => c.bd.w.length).length, treated: st.treated || 0,
  };
  return HIST_KEYS.map(k => row[k]);
}
// at midnight: the day just ended
export function histDay(sim, day) { const H = sim.S.hist; H.rows.push(histRow(sim, day)); H.acc = null; }

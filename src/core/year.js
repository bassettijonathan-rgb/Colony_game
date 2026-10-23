// The year: seasons, the length of the day, the temperature and the weather. All of it follows from the
// world's seed and the day, with nothing stored, so the simulation, the page and the Seed's own warnings
// always agree, and none of it disturbs the simulation's random numbers.
import { YEAR_DAYS, SEASON_DAYS } from './consts.js';
import { hash, clamp, sstep } from './rng.js';

export const doyOf = absDay => (absDay - 1) % YEAR_DAYS;          // 0 to 79
export const seasonOf = doy => Math.floor(doy / SEASON_DAYS) % 4;
export const DEEP = 3;

// The day is longest in the middle of Long light (day 30 of the year) and shortest in the middle of Deep cold
// (day 70). d may carry a fraction of a day.
export function daylight(d) {
  const a = Math.cos((d - 30) / YEAR_DAYS * 6.2832), len = 13.7 + 3.2 * a, mid = 12.45;
  return { dawn: mid - len / 2, dusk: mid + len / 2, len };
}

// what each kind of weather does: how overcast it is, rain and snow, wind, a change in temperature, the share
// of the sun the solar panels get, and whether work outside is risky (1) or stops (2)
export const WX = {
  clear: { name: 'Clear', cloud: .05, rain: 0, snow: 0, wind: .1, dT: 0, sun: 1, out: 0 },
  cloud: { name: 'Overcast', cloud: .7, rain: 0, snow: 0, wind: .25, dT: -1, sun: .6, out: 0 },
  fog: { name: 'Fog', cloud: .5, rain: 0, snow: 0, wind: 0, dT: -1, sun: .55, out: 0, fog: 1 },
  rain: { name: 'Rain', cloud: .85, rain: .7, snow: 0, wind: .35, dT: -2, sun: .4, out: 0 },
  storm: { name: 'Storm', cloud: 1, rain: 1, snow: 0, wind: 1, dT: -3, sun: .25, out: 1 },
  snow: { name: 'Snow', cloud: .85, rain: 0, snow: .6, wind: .3, dT: -2, sun: .4, out: 0 },
  blizzard: { name: 'Blizzard', cloud: 1, rain: 0, snow: 1, wind: 1, dT: -6, sun: .15, out: 2 },
};
// how often each kind comes, season by season
const ODDS = [
  [['clear', .25], ['cloud', .3], ['rain', .3], ['fog', .15]],
  [['clear', .5], ['cloud', .25], ['rain', .17], ['storm', .08]],
  [['clear', .25], ['cloud', .25], ['rain', .2], ['storm', .25], ['fog', .05]],
  [['clear', .3], ['cloud', .3], ['snow', .28], ['blizzard', .12]],
];

// each world's climate: a little warmer or colder, a wider or narrower swing between day and night
export const climate = seed => ({ off: (hash(seed, 7, 401) - .5) * 5, swing: 4 + hash(seed, 8, 401) * 3 });

// the season's mean temperature through the year: thawing from just below freezing, warm in Long light,
// cooling through Storm, and dropping hard into Deep cold
const KEYS = [[0, -3], [10, 4], [20, 11], [30, 16], [40, 15], [50, 8], [57, 2], [62, -7], [70, -14], [76, -15], [80, -3]];
function mean(seed, d) {
  d = ((d % YEAR_DAYS) + YEAR_DAYS) % YEAR_DAYS;
  let i = 0; while (KEYS[i + 1][0] < d) i++;
  const [a, va] = KEYS[i], [b, vb] = KEYS[i + 1], t = (d - a) / (b - a), s = t * t * (3 - 2 * t);
  return va + (vb - va) * s + climate(seed).off;
}
const draw = (seed, day) => {
  const s = seasonOf(doyOf(day)), r = hash(seed, day, 503); let acc = 0;
  for (const [k, p] of ODDS[s]) { acc += p; if (r < acc) return k; }
  return ODDS[s][0][0];
};
// a day's weather: often the same as the day before, sometimes a change
const cache = new Map();
export function dayWeather(seed, day) {
  const key = seed * 100000 + day; let w = cache.get(key);
  if (w) return w;
  let k = draw(seed, day);
  for (let back = 1; back <= 5 && day - back >= 1; back++) { if (hash(seed, day - back + 1, 509) >= .35) break; k = draw(seed, day - back); }
  const doy = doyOf(day), s = seasonOf(doy);
  // a cold snap in Deep cold: three days far colder than usual
  let snap = 0; for (let b = 0; b < 3; b++) if (day - b >= 1 && seasonOf(doyOf(day - b)) === DEEP && hash(seed, day - b, 521) < .07) snap = -7;
  const tm = mean(seed, doy + .5) + (hash(seed, day, 523) - .5) * 4 + snap;
  // rain falls as snow below freezing, and snow as rain above it
  if (tm < -.5 && k === 'rain') k = 'snow'; else if (tm < -.5 && k === 'storm') k = 'blizzard';
  else if (tm > 2 && k === 'snow') k = 'rain'; else if (tm > 2 && k === 'blizzard') k = 'storm';
  w = { k, ...WX[k], snap: snap < 0, tm, season: s };
  if (cache.size > 4000) cache.clear();
  cache.set(key, w);
  return w;
}
// the temperature at an hour of a day, in degrees: coldest before dawn, warmest mid-afternoon; clear skies
// swing further than cloudy ones
export function tempAt(seed, day, hour) {
  const w = dayWeather(seed, day), sw = climate(seed).swing * (1.25 - w.cloud * .7);
  return w.tm + w.dT + sw * Math.sin((hour - 10) / 24 * 6.2832);
}
// the usual temperature at an hour of a day of the year, without the day's weather: what the Seed plans by
export function normalTemp(seed, d, hour) {
  return mean(seed, doyOf(d) + hour / 24) + climate(seed).swing * .9 * Math.sin((hour - 10) / 24 * 6.2832);
}
// how many days until the next Deep cold starts, and how long the cold lasts
export function untilDeep(day) { const doy = doyOf(day), start = DEEP * SEASON_DAYS; return doy < start ? start - doy : 0; }
export const daysLeftInSeason = day => SEASON_DAYS - (doyOf(day) % SEASON_DAYS);
// how brightly the cook fire burns at this hour: lit for breakfast, roaring through the evening, embers overnight
export function fireOn(h) { return Math.max(sstep(5.3, 5.8, h) * (1 - sstep(7.2, 8, h)) * .6, sstep(16.8, 17.6, h) * (1 - sstep(22.5, 23.8, h))); }
// the sky as the page draws it: the day's weather, easing in from yesterday's over the small hours, and the
// ground still wet after rain
export function skyAt(seed, day, hour) {
  const a = dayWeather(seed, Math.max(1, day - 1)), b = dayWeather(seed, day), t = sstep(0, 3, hour), mix = k => (a[k] || 0) + ((b[k] || 0) - (a[k] || 0)) * t;
  const out = { k: t > .5 ? b.k : a.k, cloud: mix('cloud'), rain: mix('rain'), snow: mix('snow'), wind: mix('wind'), fog: mix('fog'), storm: (a.k === 'storm' ? 1 - t : 0) + (b.k === 'storm' ? t : 0) };
  out.wet = Math.max(out.rain, a.rain * clamp(1 - hour / 14, 0, 1) * .8);
  return out;
}

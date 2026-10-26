// Skips and the chronicle. A quiet stretch can be skipped: the colony lives through it at full speed with the Seed
// planning its crews as usual, and the skip stops early for anything that needs the player (a death that isn't of
// old age, a fire, a flood, a crisis, a council answer, hunger). Afterwards the chronicle says what happened, in
// a few paragraphs written from the events themselves. Rule-based for now; in-game Claude writes it later.
import { DAY_TICKS, HOUR, YEAR_DAYS, SEASON_DAYS, SEASONS } from './consts.js';
import { doyOf, seasonOf } from './year.js';
import { mealsInStore } from './food.js';
import { built } from './build.js';

// what stops a skip: the things the player would want to see happen, or has to answer
// (an illness at its crisis is left to the medics: the skip stops if it ends in a death)
export const STOP = new Set(['death', 'bfire', 'wildfire', 'flood', 'floodwarn', 'nofood', 'protest', 'verdict', 'lost', 'gutted', 'tremor', 'nosalvage', 'nostone',
  'firstfight', 'fight', 'unseen']);
const MAX_KEPT = 120;

const dateOf = cal => { const d = doyOf(cal); return `day ${d % SEASON_DAYS + 1} of ${SEASONS[seasonOf(d)]}, year ${Math.floor((cal - 1) / YEAR_DAYS) + 1}`; };
const list = a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
const some = (a, n = 6) => a.length <= n ? list(a) : `${a.slice(0, n).join(', ')} and ${a.length - n} more`;
const word = n => n < 13 ? ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'][n] : String(n);
const num = (n, one, many) => `${n < 13 ? ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten', 'eleven', 'twelve'][n] : n} ${n === 1 ? one : many}`;
const cap = s => s.charAt(0).toUpperCase() + s.slice(1);

// can the colony be left to itself just now? '' if so, or what is holding it
export function skipBlock(sim) {
  const S = sim.S, live = S.cols.filter(c => !c.dead);
  if (!S.projects[0] || !S.projects[0].done) return 'The shelter has to be finished first.';
  if (Object.keys(S.hz.fire).length) return 'Not while something is burning.';
  if (S.hz.fl.lv > .3) return 'Not while the water is up.';
  if (live.some(c => c.down)) return 'Not while someone is down and needs carrying.';
  if (live.some(c => c.hungry)) return 'Not while people are hungry.';
  if (S.soc && S.soc.verdict) return 'The council’s answer is waiting in the Society window.';
  return '';
}
// where a skip ends: dawn on the first day of the next season, or of the same season a year on
export function skipTarget(sim, kind) {
  const doy = doyOf(sim.cal), days = kind === 'year' ? YEAR_DAYS : SEASON_DAYS - doy % SEASON_DAYS;
  return (sim.day - 1 + days) * DAY_TICKS + 6 * HOUR;
}
// what the colony looked like when the skip began, to compare with at the end
export function skipMark(sim) {
  const S = sim.S, live = S.cols.filter(c => !c.dead);
  return { tick: S.tick, cal: sim.cal, day: sim.day, n: live.length, natives: live.filter(c => c.native).length, built: new Set(built(S).map(p => p.id)), ev: [] };
}

// the chronicle of a skip, from the events it collected; kept on the colony and logged as a letter
export function chronicle(sim, M, why) {
  const S = sim.S, live = S.cols.filter(c => !c.dead), ev = M.ev, of = (...k) => ev.filter(e => k.includes(e.e));
  const name = e => e.who != null && S.cols[e.who] ? S.cols[e.who].name : '';
  const days = sim.day - M.day, P = [];
  // the span and the people
  const born = of('born', 'firstborn'), died = of('death', 'oldage'), woke = of('woke');
  let p = `From ${dateOf(M.cal)} to ${dateOf(sim.cal)}: ${num(days, 'day', 'days')}.`;
  const dn = live.length - M.n;
  p += dn > 0 ? ` The colony grew from ${M.n} to ${live.length} people.` : dn < 0 ? ` The colony shrank from ${M.n} to ${live.length} people.` : ` The colony stayed at ${live.length} people.`;
  const parts = [born.length ? num(born.length, 'child was born', 'children were born') : '', woke.length ? `${num(woke.length, 'founder', 'founders')} woke in printed bodies` : '', died.length ? `${num(died.length, 'person', 'people')} died` : ''].filter(Boolean);
  if (parts.length) p += ` ${cap(list(parts))}.`;
  const nat = live.filter(c => c.native).length;
  if (nat && nat !== M.natives) p += ` ${nat === live.length ? 'Everyone' : `${cap(word(nat))} of them`} ${nat === 1 ? 'was' : 'were'} born here.`;
  P.push(p);
  // lives: births, growing up, getting old, dying
  p = '';
  if (born.length) p += `Born: ${some(born.map(name).filter(Boolean))}. `;
  const grown = of('adult', 'firstadult'), appr = of('apprentice'), ret = of('retired'), tank = of('tank');
  if (grown.length) p += `${list(grown.map(name).filter(Boolean))} came of age. `;
  if (appr.length) p += `${num(appr.length, 'child', 'children')} started as ${appr.length === 1 ? 'an apprentice' : 'apprentices'}. `;
  if (ret.length) p += `${some(ret.map(name).filter(Boolean))} stopped working. `;
  if (tank.length) p += `The Seed started ${num(tank.length, 'child', 'children')} in its tanks. `;
  for (const e of died) p += e.m + ' ';
  if (p) P.push(p.trim());
  // what got built, and the work
  p = '';
  const done = built(S).filter(q => !M.built.has(q.id) && q.type !== 'test').map(q => q.name);
  if (done.length) p += `Finished: ${some(done, 8)}. `;
  const har = of('harvested', 'harvest').length, hung = of('nofood').length, blight = of('blight', 'frost').length;
  if (har) p += `${cap(num(har, 'harvest', 'harvests'))} came in.${blight ? ` Frost or blight spoiled ${num(blight, 'field', 'fields')}.` : ''} `;
  else if (blight) p += `Frost or blight spoiled ${num(blight, 'field', 'fields')}. `;
  if (hung) p += 'There was a hungry spell. ';
  const fd = mealsInStore(sim, true) / Math.max(1, live.length);
  p += `The larder holds about ${Math.round(fd)} days of food.`;
  P.push(p.trim());
  // the colony as a society
  p = '';
  for (const e of of('council', 'councilnew', 'rule', 'custom', 'protest', 'lost', 'nativelead', 'lastfounder')) p += e.m + ' ';
  const fights = of('fight', 'firstfight').length, bd = of('breakdown').length;
  if (fights) p += `There ${fights === 1 ? 'was one fight' : `were ${fights} fights`}. `;
  if (bd) p += `${cap(num(bd, 'person', 'people'))} broke down under the strain. `;
  if (p) P.push(p.trim());
  // dangers and bodies
  const fires = of('bfire', 'wildfire').length, floods = of('flood').length, ill = of('unwell').length, crisis = of('crisis').length, hurt = of('hurt').length;
  const bits = [fires ? num(fires, 'fire', 'fires') : '', floods ? num(floods, 'flood', 'floods') : '', hurt ? num(hurt, 'injury', 'injuries') : ''].filter(Boolean);
  p = bits.length ? `There ${(fires || floods || hurt) === 1 && bits.length === 1 ? 'was' : 'were'} ${list(bits)}. ` : '';
  if (ill) p += `${cap(num(ill, 'person', 'people'))} fell ill${crisis ? `, ${crisis === 1 ? 'one' : word(crisis)} of them gravely` : ''}. `;
  for (const e of of('illfound', 'heartattack')) p += e.m + ' ';
  if (p) P.push(p.trim());
  // and why it ended
  P.push(why ? `The skip stopped early: ${why}` : 'Nothing needed you, so the skip ran its full length.');
  const C = { d0: M.cal, d1: sim.cal, title: `${cap(dateOf(M.cal))} to ${dateOf(sim.cal)}`, text: P };
  S.chron = (S.chron || []).concat(C).slice(-MAX_KEPT); S.rv++;
  sim.log(P.join('\n\n'), '', { e: 'chronicle', lvl: 2, title: 'The chronicle' });
  return C;
}

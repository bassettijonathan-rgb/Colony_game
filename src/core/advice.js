// What the Seed would build next, and why: the colony's most pressing shortfalls, one building each, worst first.
// It only advises. The Build window shows the first few, each with a button that starts planning it at the size
// the Seed suggests (sizeFor in work.js). A building already planned and not yet finished counts as on its way.
import { capacity, LANDER_KW, built, SHAFT_REACH } from './build.js';
import { underOf, UG, LEVELS } from './world.js';
import { MAP } from './consts.js';
import { DEEP_SUN, stoneLeft } from './work.js';
import { mealsInStore } from './food.js';
import { storyAdvice } from './story.js';

const n = (k, a, b) => `${k} ${k === 1 ? a : b}`;
export function buildAdvice(sim) {
  const S = sim.S, out = [];
  if (!S.projects[0].done) return { note: 'The shelter comes first: everything else waits until the lander is a place to sleep.', list: [] };
  const mine = S.projects.filter(p => !p.gone && p.type !== 'test'), sum = (types, k) => mine.filter(p => types.includes(p.type)).reduce((a, p) => a + (capacity(p.type, p.w, p.h)[k] || 0), 0);
  const count = t => mine.filter(p => p.type === t).length, none = t => !count(t), open = t => mine.some(p => p.type === t && !p.done);
  const alive = S.cols.filter(c => !c.dead).length, soon = alive + (S.gen ? S.gen.womb.length : 0) + Math.max(S.seedc.feed, S.seedc.queue.length) + (S.seedc.printing ? 1 : 0);
  const add = (type, why, lvl = 0) => { if (!open(type) && !out.some(o => o.type === type)) out.push({ type, why, lvl }); };
  const shafts = mine.filter(p => p.type === 'shaft' && p.done && !p.shut), shaft = shafts.length > 0, Y = S.stores.yard;
  // whatever the colony has learned it needs, ahead of the everyday list
  for (const a of storyAdvice(sim)) if (a.type && !a.soft) add(a.type, a.why, a.lvl || 0);   // soft: only where it goes, if it is built
  // power first: a dark building does nothing
  const draw = mine.filter(p => p.type !== 'solar').reduce((a, p) => a + (capacity(p.type, p.w, p.h).kw || 0), 0), supply = LANDER_KW + sum(['solar'], 'supply') * DEEP_SUN + sum(['geo'], 'supply');
  const dark = built(S).filter(p => p.type !== 'solar' && !p.powered && !p.shut).length;
  if (draw > supply - 1) {
    const why = `${dark ? `${n(dark, 'building is', 'buildings are')} dark now. ` : ''}What is built and planned would draw ${draw.toFixed(1)} kW, and the colony can count on ${supply.toFixed(1)} kW through Deep cold.`;
    if (count('geo') < 3 && hotNear(sim, shafts)) add('geo', why + ' A heat tap in the deep runs day and night, in any season.', 3); else add('solar', why);
  }
  // food
  const eaters = Math.max(1, soon), days = mealsInStore(sim, true) / eaters, fields = count('field');
  if (!fields) add('field', 'Nothing from the seed bank grows without made soil. A field is the colony’s first food it doesn’t have to find.');
  else if (fields < Math.ceil(soon / 3.5)) add('field', `${n(fields, 'field feeds', 'fields feed')} about ${Math.round(fields * 3.5)} people, and there will soon be ${soon}.${days < 20 ? ` There is food for about ${Math.floor(days)} days.` : ''}`);
  if (none('workshop')) add('workshop', 'Only the Seed’s slow fabricator makes seals, pipe, power units and panels now. Most buildings need them.');
  if (none('plant')) add('plant', `Once the Seed’s feedstock is used up, no more founders can wake${S.seedc.feed ? ` (it has enough for ${n(S.seedc.feed, 'more body', 'more bodies')})` : ''}. The plant makes feedstock from biomass and stone.`);
  // places to sleep, eat and heal
  const beds = mine.filter(p => ['shelter', 'dorm', 'burrow'].includes(p.type) && !p.closed).reduce((a, p) => a + (capacity(p.type, p.w, p.h).beds || 0), 0);
  if (beds < soon + 2) add('dorm', `${n(soon, 'person', 'people')} awake or on the way, and ${n(beds, 'bunk', 'bunks')}. Sleeping outside wears people down, and in Deep cold it is dangerous.`);
  const store = sum(['cellar'], 'store');
  if (store < soon * 4) add('cellar', store ? `The root cellars keep about ${store} loads cool, and the colony will soon store more than that.` : 'Food spoils in the open. A root cellar keeps the larder cool all year, and much longer.', 1);
  const seats = sum(['commons'], 'seats');
  if (seats < soon) add('commons', `${n(seats, 'seat', 'seats')} indoors for ${n(soon, 'person', 'people')}. An evening meal indoors eases strain more than the fire does.`);
  const cb = sum(['clinic'], 'beds');
  if (cb < Math.ceil(soon / 6)) add('clinic', cb ? `${n(cb, 'clinic bed', 'clinic beds')} for ${soon} people. The hurt heal faster in a clinic.` : 'There is nowhere to treat the hurt and the sick. In a clinic they heal faster, and operations go far better.');
  // metal and stone
  const metal = Y.salvage + (Y.ore || 0) * 2 / 3;
  if (metal < 40 && !mine.some(p => p.type === 'mine' && p.seam > 20) && !none('workshop')) add('mine', `The salvage from the lander is running out (${Math.floor(Y.salvage)} loads left). A mine over a seam of ore keeps the workshop going.`, 1);
  if (!mine.some(p => p.type === 'pit' && !(p.done && !(p.rock > 0))) && stoneLeft(sim) < 120) add('pit', 'The loose stone near camp is nearly used up. A stone pit gives the quarry crew stone for years.');
  // what a growing colony grows into
  const kids = S.cols.filter(c => !c.dead && c.life >= 1 && c.life <= 2).length;
  if (none('school') && kids >= 3) add('school', `${n(kids, 'child', 'children')} learn only from their parents, and only half of what they know.`);
  if (none('library') && soon >= 25) add('library', 'When someone dies, whatever they knew and never wrote down dies with them.');
  if (none('watch') && (soon >= 30 || S.stats.fights || S.stats.raids)) add('watch', S.stats.raids ? 'Raiders have come, and the colony has no watch crew trained to meet them.' : S.stats.fights ? 'There have been fights, and nobody to step in.' : 'A fire that starts at night burns until it wakes someone.');
  if (S.gen && S.gen.asks.length >= 3 && count('nursery') < 2) add('nursery', `${n(S.gen.asks.length, 'couple is', 'couples are')} waiting for one of the Seed’s two growth tanks.`);
  if (none('shaft') && soon >= 30) add('shaft', 'The middle and the deep levels hold heat, rare earths, and shelter from anything on the surface. A lift shaft reaches them.');
  if (shaft && sum(['vault'], 'places') < soon) add('vault', 'On a flare day, the rooms near the surface still let some of it through. A deep vault keeps out everything.', 2);
  if (shaft && none('scanner') && !mine.some(p => p.type === 'mine' && p.lvl === 3 && p.rare > 0)) add('mine', 'Rare earths only come from seams on the deep level. The scanner’s magnets need them.', 3);
  if (none('scanner') && (Y.rare || 0) >= 6) add('scanner', `There are ${Math.floor(Y.rare)} loads of rare earths in the yard, enough for a scanner. With it, the dead can be woken again from their last scan.`);
  return { note: '', list: out };
}
// is there hot rock on the deep level within reach of a working lift shaft, enough for a heat tap?
function hotNear(sim, shafts) {
  if (!shafts.length || LEVELS < 3) return false;
  const U = underOf(sim.W, 3);
  for (const p of shafts) {
    const cx = p.x + p.w / 2, cy = p.y + p.h / 2, R = SHAFT_REACH - 3;
    for (let y = Math.max(0, Math.floor(cy - R)); y < Math.min(MAP, cy + R); y += 2) for (let x = Math.max(0, Math.floor(cx - R)); x < Math.min(MAP, cx + R); x += 2) {
      if ((U[y * MAP + x] & 7) !== UG.HOT || Math.hypot(x - cx, y - cy) > R) continue;
      let n = 0; for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) if ((U[(y + j) * MAP + x + i] & 7) === UG.HOT) n++;
      if (n >= 8) return true;
    }
  }
  return false;
}

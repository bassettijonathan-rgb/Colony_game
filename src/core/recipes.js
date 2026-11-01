// What everything the colony makes is made from, where, by whom and how long it takes: the recipes, in words a
// player can act on. Built from the same numbers the simulation uses, so they can't drift apart. Nobody orders
// anything made: the crews and the fabricator make what the projects will run short of, so each recipe also says
// what has to be in place for it to happen. The Build window, the workshop's card and the Seed's answers show them.
import { RECIPE, FAB_SLOW, SALVAGE, CARGO, LANDER_KW, PANEL_KW, FEED, TYPES, stageLoads, matName } from './build.js';
import { PRINT_TICKS, SMELT, REFINE, MINE_H, MEDS_SALVAGE, MEDS_H } from './work.js';
import { MED_MADE } from './care.js';
import { SAMPLES, TEST_H, SEED_LAB } from './food.js';
import { HOUR } from './consts.js';

const hrs = h => { const r = Math.round(h * 2) / 2; return `${r % 1 ? r.toFixed(1) : r} hour${r === 1 ? '' : 's'}`; };
const part = (k, uses) => ({
  id: k, group: 'Parts', name: matName(k, 1).replace(/^1 /, ''), words: [k, ...matName(k, 2).replace(/^2 /, '').split(' ')],
  from: `${matName('salvage', RECIPE[k].salvage)}`,
  how: `About ${hrs(RECIPE[k].h)} at a workshop bench, by whoever is on Workshop work (less for a skilled hand), or ${hrs(RECIPE[k].h * FAB_SLOW)} in the Seed's fabricator when it is not printing a body.`,
  uses,
});
export const PART_NOTE = 'Nobody orders parts: whoever is on Workshop work makes the one the projects will run short of first, at the workshop benches, and the Seed’s fabricator does the same, three times slower, whenever it is free. What they need is salvage in the yard.';
export const RECIPES = [
  part('seal', 'Every roofed building above ground needs one for its airlock, and so do a few others.'),
  part('pipe', 'Most buildings need some, more the bigger they are.'),
  part('power', 'Buildings that draw power, about one for every 2 kW they draw.'),
  part('panel', 'Solar fields, one for each panel.'),
  { id: 'module', group: 'Parts', name: 'Lander module', words: ['module', 'modules', 'lander'], from: 'Nothing: it can’t be made here',
    how: `The lander brought ${CARGO} of its own modules down, and the Shelter is built from them.`, uses: 'The Shelter.' },
  { id: 'salvage', group: 'Metal', name: 'Salvage', words: ['salvage', 'metal', 'smelt', 'smelting', 'smelted'], from: `${matName('ore', SMELT.ore)}, smelted`,
    how: `The metal of the lander and its descent stage: ${SALVAGE} loads at the landing. Once it is used up, ${SMELT.ore} loads of ore smelt down into ${SMELT.out} of salvage, in about ${hrs(SMELT.h)} at a workshop bench (whoever is on Workshop work does it when there is nothing else to make), or ${hrs(REFINE.h)} in the fabricator’s furnace when it has nothing else to do.`,
    uses: 'Every part, and the fabricator’s batches of medical supplies.' },
  { id: 'ore', group: 'Metal', name: 'Ore', words: ['ore', 'mine', 'mines', 'mining', 'miner', 'miners', 'seam', 'seams'], from: 'A seam of ore under the ground',
    how: `A crew on Mine work cuts it at a finished mine with power, about ${hrs(MINE_H)} a load, and piles it in the yard. Plan the mine over a seam in the Build window: press U to see the seams below ground. A mine needs only stone and timber to build, no parts.`,
    uses: 'Smelted into salvage.' },
  { id: 'rare', group: 'Metal', name: 'Rare earths', words: ['rare', 'earth', 'earths'], from: 'Thin veins in the seams of the deep level',
    how: 'Miners in a mine on the deep level bring them up now and then, mixed in with the ore. The deep is reached through a lift shaft.', uses: 'The Scanner’s imaging magnets.' },
  { id: 'stone', group: 'Raw materials', name: 'Stone', words: ['stone', 'stones', 'quarry', 'rock', 'pit'], from: 'Boulders, rock faces, or a stone pit',
    how: 'A crew on Quarry work cuts it near camp and stacks it in the yard; build crews cut their own when the yard runs out. Once the boulders and rock faces near camp are used up, plan a stone pit on stony ground (press U to see where stone lies under shallow soil).',
    uses: 'Footings, walls and fittings of most buildings, field drains, and the feedstock plant.' },
  { id: 'timber', group: 'Raw materials', name: 'Timber', words: ['timber', 'wood', 'tree', 'trees', 'logs'], from: 'Trees',
    how: 'A crew on Timber work fells trees and carries the logs to the yard; build crews fell their own when the yard runs out.', uses: 'Frames, roofs, beams and fittings of most buildings.' },
  { id: 'biomass', group: 'Raw materials', name: 'Biomass', words: ['biomass', 'compost'], from: 'Plants around camp',
    how: 'A crew on Forage work gathers it and brings it to the yard.', uses: 'Made soil for new fields, and the feedstock plant’s tanks.' },
  { id: 'feedstock', group: 'People', name: 'Feedstock', words: ['feedstock', 'feed', 'plant', 'tanks'], from: `${matName('biomass', FEED.biomass)} and ${matName('stone', FEED.stone)} for each batch`,
    how: `A feedstock plant with power fills a tank from the yard and makes a batch in ${hrs(FEED.h)}; ${FEED.per} batches are one body’s worth. It stops while the fabricator holds enough.`, uses: 'New bodies, and children grown in the growth tanks.' },
  { id: 'body', group: 'People', name: 'A new body', words: ['body', 'bodies', 'print', 'printing', 'founder', 'founders', 'wake', 'archive'], from: 'A body’s worth of feedstock',
    how: `The Seed’s fabricator prints one in ${hrs(PRINT_TICKS / HOUR)} for whoever you choose in the Archive (Q).`, uses: 'Waking a founder from the archive.' },
  { id: 'meds', group: 'Medicine', name: 'Medical supplies', words: ['medical', 'medicine', 'meds', 'dressings', 'painkillers', 'antibiotics', 'blood', 'supplies', 'heal', 'healing', 'hurt', 'sick', 'wounds'], from: matName('salvage', MEDS_SALVAGE),
    how: `The fabricator makes a batch in ${hrs(MEDS_H * FAB_SLOW)} whenever the clinic runs low, before any parts: ${MED_MADE.dress} dressings, ${MED_MADE.pk} painkillers, ${MED_MADE.abx} antibiotic courses and ${MED_MADE.blood} units of blood substitute.`, uses: 'The medics, for the hurt and the sick.' },
  { id: 'meals', group: 'Food', name: 'Meals', words: ['meal', 'meals', 'cook', 'cooking', 'kitchen', 'food', 'leach', 'ferment', 'vats'], from: 'Crops, and local food the tests showed is safe',
    how: 'A crew on Kitchen work cooks them at the fire. Some kinds have to be leached in running water for a day, or fermented in the vats for four days, before cooking. Cooked food goes further than what people cook for themselves.', uses: 'Everyone eats.' },
  { id: 'crops', group: 'Food', name: 'Crops', words: ['crop', 'crops', 'field', 'fields', 'farm', 'sow', 'harvest', 'soil'], from: 'Seeds from the seed bank, in made soil',
    how: 'A crew on Farm work sows, harvests and clears the fields. A field is local ground broken up, mixed with biomass and drained. Each crop has its own seasons; the Seed picks a field’s crop unless you set one on its card.', uses: 'Meals.' },
  { id: 'tested', group: 'Food', name: 'Safe local food', words: ['test', 'tests', 'tested', 'testing', 'sample', 'samples', 'lab', 'analyser', 'wild', 'forage'],
    from: `${SAMPLES} samples of a kind of local life`,
    how: `Foragers take samples of what they find. Once there are ${SAMPLES}, press Test it in Food and local life (G), on the Local tab. The Seed’s own analyser takes about ${hrs(TEST_H / SEED_LAB)} on its own; a crew on Lab work at a finished lab is much faster. Until a kind is tested, nobody eats it.`, uses: 'Foraging, and meals.' },
  { id: 'kw', group: 'Power', name: 'Power', words: ['power', 'kw', 'electricity', 'solar', 'dark', 'energy', 'heat'], from: 'The lander, solar fields, heat taps',
    how: `The lander makes ${LANDER_KW} kW. A solar field makes ${PANEL_KW} kW for each panel in full sun, less on dull days and none at night. A heat tap on hot rock in the deep makes power day and night. Finished buildings take power in project-list order; any that don’t fit stay dark.`, uses: 'Most finished buildings.' },
];
export const RECIPE_GROUPS = ['Parts', 'Metal', 'Raw materials', 'People', 'Medicine', 'Food', 'Power'];

// which of these buildings need each part, at the size the Seed suggests: { seal: ['Workshop', ...], ... }
export function usedBy(mat, types) {
  const S = { mat }, out = {};
  for (const t of types) {
    const T = TYPES[t]; if (!T || !T.size || t === 'test' || t === 'shelter') continue;
    const [w, h] = T.size;
    for (let st = 0; st < 5; st++) {
      const L = stageLoads(S, t, w, h, st);
      for (const k in L) if (L[k] > 0 && (out[k] = out[k] || []).indexOf(T.name) < 0) out[k].push(T.name);
    }
  }
  return out;
}

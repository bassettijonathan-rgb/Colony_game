// Stand-ins for the sealed texts, so the code builds without them. The real ones are kept out of this
// repository (it is public): the planet's local life, the hidden story, its clues and the narrator's private
// notes live in the project's sealed folder and only reach the built page.
//
// Local life: each world draws a few kinds from this pool (one of each role first, then extras). A kind has a
// role, the ground it grows on, how thickly, the seasons it can be gathered in, what a patch yields and how fast
// it grows back, what it is as food (null if it isn't), its worth as compost, its look, what people notice when
// they first see it, and what a test of it shows.
//
// Local illness: what people can catch from the land itself, with the fields src/core/illness.js reads.
const plain = (id, name, role, where, food, bio, a, b, shape) => ({
  id, name, role, where, dens: .006, season: [1, 1, 1, 0], yield: 3, regrow: 8, food, bio,
  look: { a, b, shape, size: .5 }, seen: `A stand-in for local life (${name.toLowerCase()}).`, result: 'Stand-in test result.',
});
export const SEALED = {
  version: 0,
  life: [
    plain('s1', 'Stand-in tuber', 'staple', ['meadow', 'dirt'], { meals: 3, proc: 'cook', keep: 20, slow: 0, lacks: false }, 1, [96, 130, 120], [70, 96, 88], 'rosette'),
    plain('s2', 'Stand-in root', 'leach', ['marsh', 'meadow'], { meals: 4, proc: 'leach', keep: 30, slow: 0, lacks: false }, 1, [120, 110, 80], [90, 80, 60], 'reed'),
    plain('s3', 'Stand-in comb', 'ferment', ['shallow', 'sand'], { meals: 3, proc: 'ferment', keep: 6, slow: 0, lacks: false }, 1, [150, 140, 120], [110, 100, 90], 'shell'),
    plain('s4', 'Stand-in moss', 'compost', ['dirt', 'scree', 'meadow'], null, 3, [140, 80, 60], [100, 60, 50], 'mat'),
    plain('s5', 'Stand-in reed', 'lack', ['marsh', 'shallow'], { meals: 3, proc: 'cook', keep: 10, slow: 0, lacks: true }, 1, [170, 170, 140], [120, 120, 100], 'reed'),
    plain('s6', 'Stand-in burr', 'slow', ['meadow'], { meals: 3, proc: 'cook', keep: 25, slow: .35, lacks: false }, 1, [160, 120, 90], [120, 90, 70], 'tuft'),
    plain('s7', 'Stand-in cap', 'extra', ['forest'], { meals: 2, proc: 'cook', keep: 4, slow: 0, lacks: false }, 1, [180, 160, 130], [120, 100, 80], 'cap'),
  ],
  ill: [
    { id: 'sx1', name: 'Stand-in fever', sym: 'A stand-in fever after a day in the wet', src: { out: { terr: ['marsh', 'shallow'], season: [1, 1, 1, 0], p: .0016 } }, spread: null, incub: [48, 96], sick: [48, 96], crisis: [12, 24], sev: 1, crisisAt: .6, hits: { move: .3, consc: .1 }, fever: .8, kill: .3, abx: false, after: 'immune', imm: .8, text: 'Stand-in text for a local illness.' },
    { id: 'sx2', name: 'Stand-in rash', sym: 'A stand-in rash after gathering', src: { out: { act: ['gather'], season: [1, 1, 1, 0], p: .002 } }, spread: null, incub: [2, 6], sick: [24, 48], crisis: [1, 2], sev: .5, crisisAt: 2, hits: { manip: .4 }, fever: .1, kill: 0, abx: false, after: 'none', text: 'Stand-in text for a local illness.' },
  ],
  // Neighbours: each world draws two or three kinds of settlement from this pool; the fields are described in the
  // sealed file and read by src/core/nb.js.
  nb: {
    kinds: ['north', 'river', 'hill'].map((id, i) => ({
      id, place: `Stand-in ${id}`, folk: `the ${id} folk`, pop: [50, 150], km: [20, 40], coat: [[110, 100, 120], [120, 130, 90], [130, 100, 80]][i], coat2: [190, 180, 160],
      trust: [10, 20, 0][i], fair: 1, honest: 1, wants: { ore: 1.5, abx: 2, meals: 1.2 }, offers: { meals: [20, 60], timber: [5, 20], ore: [0, 10] },
      knows: .5, ills: true, joins: .15, namesake: 0, given: ['Ash', 'Bee', 'Cal', 'Dee', 'Eli', 'Fay'], family: ['Stand', 'In'], drift: [],
      about: 'Stand-in: people from {place}, {km} km to the {dir}, about {pop} of them.',
      greet: ['Stand-in: {lead} from {place} is in camp to trade.'], joinWhy: ['Stand-in: {name} asks to stay.'],
    })),
  },
};

// Stand-ins for the sealed texts, so the code builds without them. The real ones are kept out of this
// repository (it is public): the planet's local life, the hidden story, its clues and the narrator's private
// notes live in the project's sealed folder and only reach the built page.
//
// Local life: each world draws a few kinds from this pool (one of each role first, then extras). A kind has a
// role, the ground it grows on, how thickly, the seasons it can be gathered in, what a patch yields and how fast
// it grows back, what it is as food (null if it isn't), its worth as compost, its look, what people notice when
// they first see it, and what a test of it shows.
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
};

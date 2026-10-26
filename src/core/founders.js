// The archive: the stored minds of the founders, each a whole person with a former trade, skills, a
// temperament and a few memories of the life they left. Generated from the world's seed with its own
// generator, so the archive never disturbs the simulation's random stream.
import { SKILLS } from './consts.js';
import { lcg } from './rng.js';

export const GIVEN = ['Ada', 'Amara', 'Anders', 'Aiko', 'Bao', 'Bram', 'Cass', 'Chidi', 'Dalia', 'Dmitri', 'Eero', 'Elif', 'Esme', 'Farid', 'Freya', 'Gael', 'Hana', 'Idris', 'Ilse', 'Imani', 'Jonah', 'Juno', 'Kaito', 'Kesi', 'Lars', 'Leila', 'Lior', 'Mara', 'Mateo', 'Mei', 'Nadia', 'Niko', 'Noor', 'Oren', 'Orla', 'Pavel', 'Priya', 'Quinn', 'Rafael', 'Rhea', 'Rosa', 'Sami', 'Sanna', 'Selin', 'Tariq', 'Tomas', 'Uma', 'Vera', 'Wren', 'Yara', 'Yusuf', 'Zofia', 'Ines', 'Kofi', 'Liang', 'Maeve', 'Otto', 'Paz', 'Sofia', 'Teo'];
const FAMILY = ['Abara', 'Lindqvist', 'Okafor', 'Varga', 'Moreau', 'Tanaka', 'Haddad', 'Novak', 'Castell', 'Mensah', 'Koval', 'Ferreira', 'Brandt', 'Osei', 'Petrov', 'Rahimi', 'Sorensen', 'Duarte', 'Nakamura', 'Quist', 'Achterberg', 'Belov', 'Cruz', 'Delacroix', 'Eklund', 'Fontaine', 'Grieve', 'Halloran', 'Iwu', 'Jensen', 'Kaur', 'Lemaire', 'Murata', 'Nwosu', 'Oyelaran', 'Pires', 'Reyes', 'Sato', 'Tamm', 'Ueda', 'Vance', 'Wekesa', 'Yilmaz', 'Zamora', 'Arslan', 'Bergstrom', 'Coelho', 'Draper'];

// former trades and the skills they leave a person with
export const TRADES = [
  ['Structural engineer', { engineering: 7, building: 5 }], ['Builder', { building: 7, engineering: 3 }], ['Electrician', { engineering: 6, building: 3 }],
  ['Fabrication technician', { engineering: 6, building: 4 }], ['Carpenter', { building: 6, engineering: 2 }], ['Mechanic', { engineering: 5, building: 4 }],
  ['Surveyor', { fieldcraft: 7, engineering: 2 }], ['Geologist', { fieldcraft: 6, teaching: 2 }], ['Hydrologist', { fieldcraft: 5, botany: 3 }],
  ['Ecologist', { botany: 5, fieldcraft: 5 }], ['Agronomist', { botany: 7, cooking: 2 }], ['Chemist', { engineering: 3, medicine: 3, botany: 3 }],
  ['Field medic', { medicine: 6, fieldcraft: 3 }], ['Physician', { medicine: 8, teaching: 2 }], ['Nurse', { medicine: 6, cooking: 2 }], ['Midwife', { medicine: 5, teaching: 3 }],
  ['Cook', { cooking: 7, botany: 2 }], ['Teacher', { teaching: 7, leadership: 3 }], ['Logistics coordinator', { leadership: 5, building: 2 }], ['Expedition leader', { leadership: 6, fieldcraft: 4 }],
];
// temperament: two traits each, never both of an opposite pair
export const TRAITS = {
  patient: 'Takes long days without complaint', restless: 'Hates standing still; loves new ground', reckless: 'Fast, and careless with it', careful: 'Slow and safe',
  sociable: 'Needs company; suffers alone', solitary: 'Needs room; crowds wear on them', steady: 'Hard to shake', anxious: 'Takes worry to heart', cheerful: 'Bounces back quickly', stubborn: 'Slow to trust, slow to change their mind',
};
export const OPP = { patient: 'restless', restless: 'patient', reckless: 'careful', careful: 'reckless', sociable: 'solitary', solitary: 'sociable', steady: 'anxious', anxious: 'steady' };
const MEMORIES = [
  'Remembers teaching a nephew to ride a bicycle.', 'Remembers a kitchen that always smelled of bread.', 'Remembers an argument with a brother that was never settled.',
  'Remembers a night shift when everything went wrong, and fixing it by morning.', 'Remembers a garden left half planted.', 'Remembers singing in a choir.',
  'Remembers a dog called Pepper.', 'Remembers a long walk home in the snow.', "Remembers a mother's hands, always busy.", 'Remembers a bridge they helped build.',
  'Remembers the sea from a high window.', 'Remembers a rooftop at dawn, and someone beside them.', 'Remembers losing a patient and going back to work the next day.',
  'Remembers a library that stayed open late.', 'Remembers a wedding where it rained.', 'Remembers the smell of hot metal in a workshop.', 'Remembers a field of sunflowers.',
  'Remembers the last meal before leaving.', 'Remembers a child asleep on their shoulder.', 'Remembers a friend who promised to write.', 'Remembers learning to swim in a cold river.',
  'Remembers being afraid of the dark, and growing out of it.', 'Remembers a map pinned above a desk, with every trail marked.', 'Remembers a grandmother who never wasted anything.',
];

// relations that already existed before the archive: a few old friends and an old grudge or two
function oldTies(r, n) {
  const ties = [];
  const pair = () => { const a = Math.floor(r() * n); let b = Math.floor(r() * (n - 1)); if (b >= a) b++; return [a, b]; };
  for (let i = 0; i < 6; i++) ties.push([...pair(), 'friend']);
  for (let i = 0; i < 2; i++) ties.push([...pair(), 'rival']);
  return ties;
}

export function makePerson(r, i, used) {
  let name;
  for (let k = 0; k < 50; k++) { name = GIVEN[Math.floor(r() * GIVEN.length)] + ' ' + FAMILY[Math.floor(r() * FAMILY.length)]; if (!used.has(name)) break; }
  used.add(name);
  const [trade, base] = TRADES[Math.floor(r() * TRADES.length)];
  const skills = {};
  for (const k of SKILLS) skills[k] = Math.max(0, Math.min(10, Math.round(((base[k] || 1) + (r() - .4) * 3) * 10) / 10));
  skills.leadership = Math.min(10, Math.round(((base.leadership || 0) + r() * 4) * 10) / 10);
  const keys = Object.keys(TRAITS), a = keys[Math.floor(r() * keys.length)]; let b = a;
  while (b === a || OPP[a] === b) b = keys[Math.floor(r() * keys.length)];
  const m1 = MEMORIES[Math.floor(r() * MEMORIES.length)]; let m2 = m1; while (m2 === m1) m2 = MEMORIES[Math.floor(r() * MEMORIES.length)];
  return { fid: i, name, age: 24 + Math.floor(r() * 36), trade, skills, traits: [a, b], mem: [m1, m2], look: Math.floor(r() * 1e6), knew: [] };
}

export function makeArchive(seed, n = 40) {
  const r = lcg(seed * 31 + 7), used = new Set(), A = [];
  for (let i = 0; i < n; i++) A.push(makePerson(r, i, used));
  for (const [a, b, k] of oldTies(r, n)) {
    if (A[a].knew.some(t => t.fid === b)) continue;
    A[a].knew.push({ fid: b, k }); A[b].knew.push({ fid: a, k });
  }
  return A;
}

// the Seed's suggestion for the first six: two to build, one to scout, one to heal, one to lead, one for food
export function suggestFirst(A, n = 6) {
  const want = [['building', 'engineering'], ['engineering', 'building'], ['fieldcraft'], ['medicine'], ['leadership'], ['botany', 'cooking']];
  const picked = [];
  const score = (p, ks) => ks.reduce((t, k, i) => t + p.skills[k] * (i ? .5 : 1), 0) - (p.knew.some(t => t.k === 'rival' && picked.includes(t.fid)) ? 20 : 0) + (p.knew.some(t => t.k === 'friend' && picked.includes(t.fid)) ? 1.5 : 0);
  for (const ks of want.slice(0, n)) {
    let best = -1, bs = -1e9;
    for (const p of A) if (!picked.includes(p.fid) && p.woke == null) { const s = score(p, ks); if (s > bs) { bs = s; best = p.fid; } }
    if (best >= 0) picked.push(best);
  }
  return picked;
}

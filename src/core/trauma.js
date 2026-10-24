// Trauma: what people carry from the worst things that happen to them or in front of them. A death, a bad
// injury, a fire, the flood, the ground shaking, a night that nearly froze them. Each one weighs on them: strain
// builds a little faster, sleep restores less (the nightmares), they break sooner, and the same thing happening
// again brings it all back. It fades over weeks, faster with friends and for steady people, slower for anxious
// ones. Memories say what it was; the person card shows what they still carry.
import { remember } from './life.js';

export const TR_NAME = {
  grief: 'Grief', death: 'Saw someone die', hurt: 'Badly hurt', fire: 'The fire', water: 'The flood', quake: 'The tremor', cold: 'Nearly froze',
};
const FADE = {
  grief: 'Learned to live with the loss.', death: 'Stopped seeing it every time they closed their eyes.', hurt: 'Stopped flinching at the memory of the injury.',
  fire: 'Stopped dreaming about the fire.', water: 'Stopped dreaming about the flood.', quake: 'Stopped starting at every shiver of the ground.', cold: 'Stopped dreaming about the cold.',
};
const KEEP = 5;
export const weightOf = c => { let w = 0; for (const t of c.tr || []) w += t.w; return Math.min(150, w); };

// a new wound to the mind, or an old one deepened; who is the person it is about, if anyone
export function scar(sim, c, k, w, m, who = -1) {
  if (c.dead || sim.S.mode !== 'landfall') return;
  if (!c.tr) c.tr = [];
  if (c.traits.includes('steady')) w *= .75; if (c.traits.includes('anxious')) w *= 1.3;
  let t = c.tr.find(q => q.k === k && q.who === who);
  if (t) t.w = Math.min(100, t.w + w * .6);
  else { t = { k, w: Math.min(100, w), d: sim.day, who, m }; c.tr.push(t); if (c.tr.length > KEEP) { c.tr.sort((a, b) => b.w - a.w); c.tr.length = KEEP; } }
  c.str = Math.min(100, c.str + w * .15);
  sim.S.stats.traumas = (sim.S.stats.traumas || 0) + 1;
  if (sim.S.stats.traumas === 1) sim.log(`${c.name} will carry this with them for a while.`, '', { who: c.id, e: 'trauma' });
}
// the same thing happening again: everyone carrying it lives it again
export function relive(sim, ks, near) {
  for (const c of sim.S.cols) {
    if (c.dead || !c.tr || !c.tr.length || (near && !near(c))) continue;
    for (const t of c.tr) if (ks.includes(t.k) && t.w > 10) {
      c.str = Math.min(100, c.str + t.w * .2);
      if (t.w > 35 && t.said !== sim.day) { t.said = sim.day; remember(sim, c, `It all came back: ${t.m.charAt(0).toLowerCase() + t.m.slice(1).replace(/\.$/, '')}.`); }
    }
  }
}
// every half hour, from the mind's tick: how much extra strain it adds, and how much it takes off a night's sleep
export function traumaTick(c) {
  const W = weightOf(c); if (!W) return { g: 0, sleep: 1, brk: 0 };
  return { g: W / 100 * 1.1, sleep: 1 - .35 * Math.min(1, W / 100), brk: Math.min(12, W / 8) };
}
// once a day: it fades
export function traumaDay(sim, c) {
  if (!c.tr || !c.tr.length) return;
  const S = sim.S, friends = Object.entries(c.ties).some(([id, t]) => t.k === 'friend' && S.cols[id] && !S.cols[id].dead);
  let k = .035 * (friends ? 1.6 : 1) * (c.traits.includes('steady') ? 1.4 : 1) * (c.traits.includes('anxious') ? .6 : 1) * (c.traits.includes('cheerful') ? 1.2 : 1);
  if (c.str > 70) k *= .5; if (c.home >= 0) k *= 1.15;   // nobody heals while they are falling apart; a bunk indoors helps
  const left = [];
  for (const t of c.tr) {
    t.w = Math.max(0, t.w * (1 - k) - .4);
    if (t.w >= 4) left.push(t);
    else remember(sim, c, FADE[t.k]);
  }
  c.tr = left;
}
// for the person card: what they carry and how heavily
export const traumaUI = c => (c.tr || []).map(t => ({ k: t.k, w: Math.round(t.w), m: t.m, d: t.d }));

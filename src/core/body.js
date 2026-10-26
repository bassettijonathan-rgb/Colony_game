// The body: fourteen parts feeding eight capacities, wounds that bleed, hurt, get infected and heal, and the
// marks they leave. Blood, pain and shock come from the wounds, so one bad accident can kill without any single
// wound being deadly. Work speed, walking speed and accident risk come from the capacities, never from a single
// health number. Only people with something wrong are worked on, so a healthy colony costs nothing here.
import { rnd, clamp } from './rng.js';
import { sickNow, illHits, illPain, illDanger, illLaid, illNeeds, illTick } from './illness.js';

export const CAPS = ['consc', 'sight', 'breath', 'flow', 'digest', 'carry', 'manip', 'move'];
export const CAP_NAME = { consc: 'Consciousness', sight: 'Sight', breath: 'Breathing', flow: 'Blood flow', digest: 'Digestion', carry: 'Carrying', manip: 'Hands', move: 'Moving' };
// each part: the share of each capacity it carries, and how freely it bleeds
export const PARTS = [
  { k: 'head', name: 'head', caps: { consc: 1, sight: .2 }, bl: 1.2 },
  { k: 'eyeL', name: 'left eye', caps: { sight: .5 }, bl: .2 },
  { k: 'eyeR', name: 'right eye', caps: { sight: .5 }, bl: .2 },
  { k: 'torso', name: 'torso', caps: { breath: .35, flow: .25, carry: .2 }, bl: 1.3 },
  { k: 'chest', name: 'chest', label: 'Heart and lungs', caps: { breath: .65, flow: .75 }, bl: 1.5, inner: true },
  { k: 'gut', name: 'belly', label: 'Gut, liver and kidneys', caps: { digest: 1 }, bl: 1.2, inner: true },
  { k: 'armL', name: 'left arm', caps: { carry: .3 }, bl: 1 },
  { k: 'armR', name: 'right arm', caps: { carry: .3 }, bl: 1 },
  { k: 'handL', name: 'left hand', caps: { manip: .5 }, bl: .6 },
  { k: 'handR', name: 'right hand', caps: { manip: .5 }, bl: .6 },
  { k: 'legL', name: 'left leg', caps: { move: .4 }, bl: 1 },
  { k: 'legR', name: 'right leg', caps: { move: .4 }, bl: 1 },
  { k: 'spine', name: 'back', caps: { move: .2, carry: .2 }, bl: .5 },
  { k: 'skin', name: 'skin', caps: {}, bl: .4 },
];
export const PART = Object.fromEntries(PARTS.map((p, i) => [p.k, i]));
// what each kind of wound does: bleeding per hour at full size (a share of the blood), pain, how dirty it starts,
// and how much of it heals in a day
export const KINDS = {
  cut: { name: 'Cut', bleed: .3, pain: .5, dirt: .35, heal: .22 },
  crush: { name: 'Crush', bleed: .08, pain: .7, dirt: .12, heal: .12 },
  frac: { name: 'Broken bone', bleed: 0, pain: .9, dirt: 0, heal: .05 },
  burn: { name: 'Burn', bleed: 0, pain: 1, dirt: .6, heal: .08 },
  punct: { name: 'Puncture', bleed: .15, pain: .4, dirt: .7, heal: .18 },
  frost: { name: 'Frostbite', bleed: 0, pain: .5, dirt: .3, heal: .06 },
};
const INNER = new Set([PART.torso, PART.chest, PART.gut]);
const HANDS = new Set([PART.handL, PART.handR]);
const cap1 = s => s[0].toUpperCase() + s.slice(1);

export const newBody = () => ({ blood: 1, shock: 0, pain: 0, bleed: 0, inf: 0, w: [], marks: [], pk: 0, abx: 0, st: 0, wid: 0, ex: null, worse: 0, ill: [], imm: {}, hx: [], nu: 0 });
// anything to work on: wounds, lost blood, shock, a painkiller wearing off, an illness (even one not showing yet)
export const ailing = b => b.w.length > 0 || b.blood < 1 || b.shock > 0 || b.pk > 0 || b.ill.length > 0 || b.marks.some(m => m.pain);

// ---------- getting hurt ----------
// A new wound. Most are seen at once; a crush to the body can hide internal bleeding, and a small crush can hide
// a broken bone, until a medic finds them. Returns the wound.
export function wound(sim, c, p, k, s, how) {
  const b = c.bd, K = KINDS[k], P = PARTS[p];
  s = clamp(s, .05, 1);
  const w = { id: ++b.wid, p, k, s, bl: K.bleed * Math.pow(s, 1.5) * P.bl, ib: 0, ikn: false, heal: 0, dirt: K.dirt, inf: 0, closed: false, set: 0, kn: true, aid: false, d: sim.day, t: sim.S.tick, how };
  b.w.push(w);
  if (k === 'frac' && s <= .55) w.kn = false;   // a closed break under a bruise
  // a hard blow to the body can bleed inside, out of sight
  if ((k === 'crush' || k === 'punct') && INNER.has(p) && s > .45) w.ib = .07 * s * (P.inner ? 1.4 : 1);
  // a hard knock to the head can bleed under the skull: little blood, but the pressure builds until someone opens it up
  else if (k === 'crush' && p === PART.head && s > .55) w.ib = .02 * s;
  // some things are lost at once and never grow back
  if (p === PART.eyeL || p === PART.eyeR) { if ((k === 'punct' || k === 'cut' || k === 'burn') && s >= .6) lose(sim, c, p, 1, `Lost the ${P.name}`, how); }
  else if (HANDS.has(p) && k === 'crush' && s >= .85) lose(sim, c, p, .5, `Lost two fingers of the ${P.name}`, how);
  else if (HANDS.has(p) && k === 'frost' && s >= .85) lose(sim, c, p, .35, `Lost fingertips of the ${P.name} to frostbite`, how);
  c.cap = caps(c);
  return w;
}
function lose(sim, c, p, loss, what, how) { c.bd.marks.push({ p, k: 'lost', loss, pain: .04, what, how, d: sim.day }); }

// how badly hurt a part is, from 0 (fine) to 1 (no use at all); an unset break is no use until it is set
function partHarm(b, p) {
  let d = 0;
  for (const w of b.w) if (w.p === p) d += (w.pr || 0) + w.s * (1 - w.heal) * (w.k === 'frac' ? (w.set ? .6 : 1.6) : w.k === 'burn' || w.k === 'frost' ? .8 : .7);
  for (const m of b.marks) if (m.p === p) d += m.loss;
  return Math.min(1, d);
}
// the eight capacities, 0 to 1, with illness, blood loss, shock and pain on top of the wounds themselves
export function caps(c) {
  const b = c.bd; if (!b.w.length && !b.marks.length && b.blood >= 1 && b.shock <= 0 && !sickNow(b)) return null;
  const o = {}; for (const k of CAPS) o[k] = 1;
  for (let p = 0; p < PARTS.length; p++) { const h = partHarm(b, p); if (!h) continue; for (const k in PARTS[p].caps) o[k] -= PARTS[p].caps[k] * h; }
  illHits(b, o);
  const bf = b.blood < .8 ? clamp((b.blood - .45) / .35, 0, 1) : 1, pn = Math.min(1, b.pain);
  o.consc *= bf * (1 - .7 * Math.min(1, b.shock)) * (b.pain > 1 ? Math.max(0, 1 - (b.pain - 1) * .8) : 1) * (b.inf > 1 ? .7 : 1);
  o.flow = Math.min(o.flow, .3 + .7 * bf);
  const all = (.5 + .5 * clamp(o.consc, 0, 1)) * (1 - .35 * pn) * (b.blood < .8 ? .6 + .4 * clamp((b.blood - .5) / .3, 0, 1) : 1);
  for (const k of CAPS) o[k] = clamp(k === 'consc' ? o[k] : o[k] * all, 0, 1);
  return o;
}
export const capOf = (c, k) => c.cap ? c.cap[k] : 1;
// down where they are: unconscious, in too much pain to stand, or unable to walk
export const downed = c => !!c.cap && (c.cap.consc < .3 || c.bd.pain > 1.25 || c.cap.move < .15);
// too hurt to work: they should be resting in a bed until it passes
export const laidUp = c => { const b = c.bd; return !!c.cap && (illLaid(b) || b.blood < .8 || b.shock > .2 || b.pain > .6 || b.inf > .55 || c.cap.move < .35 || c.cap.consc < .6 || b.w.some(w => w.k === 'frac' && !w.set && w.kn)); };
// how close to death, 0 to 1: what triage sorts by
export function danger(c) {
  const b = c.bd; if (!ailing(b)) return 0;
  let ib = 0; for (const w of b.w) ib += w.bl + w.ib;
  return clamp(Math.max((1 - b.blood) * 2, b.shock, b.inf / 1.3, ib * 4, partHarm(b, PART.head) * .9, b.pain * .45, illDanger(b)), 0, 1);
}
// what the colony knows needs doing for someone, most urgent first
export function needs(c, sim) {
  const b = c.bd, out = [];
  if (sim) illNeeds(sim, b, out);
  for (const w of b.w) {
    if (w.ib && w.ikn) out.push({ k: 'surgery', w: w.id, u: 9 });
    if (!w.kn) continue;
    if ((w.k === 'cut' || w.k === 'punct' || w.k === 'crush') && !w.closed && (w.bl > .004 || w.s > .25)) out.push({ k: 'close', w: w.id, u: 6 + w.bl * 20 });
    else if ((w.k === 'burn' || w.k === 'frost') && !w.closed) out.push({ k: 'dress', w: w.id, u: 4 });
    if (w.k === 'frac' && !w.set) out.push({ k: 'set', w: w.id, u: 5 });
    if (w.inf > .3 && b.abx <= 0) out.push({ k: 'abx', w: w.id, u: 7 + w.inf });
  }
  if ((b.shock > .25 || b.blood < .72) && b.st <= 0) out.push({ k: 'shock', u: 8 + b.shock * 3 });
  if (b.pain > .6 && b.pk <= 0) out.push({ k: 'pk', u: 3 });
  return out.sort((a, z) => z.u - a.u);
}

// ---------- hour by hour ----------
// ctx: heal (how fast wounds mend now), weak (how easily they go bad), lying, hungry, chill, ward. Returns why
// they died, or ''.
export function bodyTick(sim, c, dt, ctx) {
  const b = c.bd;
  let bleed = 0, pain = 0, inf = 0;
  const done = [];
  for (const w of b.w) {
    if (w.bl > 0) { bleed += w.bl; w.bl *= Math.exp(-dt / (w.s > .7 ? 6 : w.s > .45 ? 3 : 1.2)); if (w.bl < .002) w.bl = 0; }   // the body clots what it can
    if (w.p === PART.head) { if (w.ib) w.pr = Math.min(1, (w.pr || 0) + w.ib * dt); else if (w.pr) w.pr = Math.max(0, w.pr - .25 * dt / 24); }
    else if (w.ib) bleed += w.ib;
    pain += KINDS[w.k].pain * w.s * (1 - w.heal * .8) * (w.k === 'frac' && w.set ? .5 : 1);
    if (w.dirt > 0 || w.inf > 0) w.inf = clamp(w.inf + (w.dirt * .6 * ctx.weak - (b.abx > 0 ? .7 : 0) - .05) * dt / 24, 0, 1.5);
    inf = Math.max(inf, w.inf);
    if (w.inf < .3 && !w.ib) w.heal += KINDS[w.k].heal * ctx.heal * (w.k === 'frac' && !w.set ? .5 : 1) * (!w.closed && (w.k === 'cut' || w.k === 'punct') ? .6 : 1) * dt / 24;
    if (w.heal >= 1) done.push(w);
  }
  for (const w of done) healed(sim, c, w);
  if (inf > .5) pain += (inf - .5) * .5;                                   // fever
  if (b.ill.length) { const why = illTick(sim, c, dt, ctx); if (why) return why; pain += illPain(b); }
  for (const m of b.marks) pain += m.pain || 0;
  if (b.pk > 0) { b.pk -= dt; pain *= .45; }
  if (b.abx > 0) b.abx -= dt / 24;
  if (b.st > 0) b.st -= dt;
  const was = danger(c);
  if (bleed > 0) b.blood -= bleed * dt; else if (b.blood < 1) b.blood = Math.min(1, b.blood + .06 * (ctx.hungry ? .3 : 1) * dt / 24);
  const up = Math.max(0, .8 - b.blood) * 1.2 + Math.max(0, pain - .7) * .35 + (ctx.chill > 50 ? .12 : 0) + (inf > 1 ? .05 + (inf - 1) * .2 : 0);
  const down = (ctx.lying ? .1 : .04) + (b.st > 0 ? .3 : 0);
  b.shock = clamp(b.shock + (up - down) * dt, 0, 1.2);
  b.pain = pain; b.bleed = bleed; b.inf = inf;
  c.cap = caps(c);
  b.worse = danger(c) > was + .002 ? 1 : 0;
  if (b.blood < .5) return 'bled';
  if (b.shock >= 1) return inf > 1 ? 'infection' : 'shock';
  if (partHarm(b, PART.head) >= .95) return 'head';
  return '';
}
// a wound that has run its course, and what it leaves behind
function healed(sim, c, w) {
  const b = c.bd, P = PARTS[w.p];
  b.w.splice(b.w.indexOf(w), 1);
  let m = null;
  if (w.k === 'frac' && w.set !== 1) m = { k: 'crooked', loss: .3, pain: w.p === PART.spine || w.p === PART.legL || w.p === PART.legR ? .12 : .06, what: `The ${P.name} healed crooked` };
  else if ((w.k === 'burn' || w.k === 'frost') && w.s >= .6) m = { k: 'tight', loss: HANDS.has(w.p) ? .25 : .08, pain: 0, what: w.k === 'frost' ? `Frost damage to the ${P.name}` : `Burn scars on the ${P.name}` };
  else if (w.s >= .45 && w.k !== 'frac') m = { k: 'scar', loss: 0, pain: 0, what: `A scar on the ${P.name}` };
  if (m) b.marks.push({ ...m, p: w.p, how: w.how, d: sim.day });
  if (m && m.loss) sim.log(`${c.name}'s ${KINDS[w.k].name.toLowerCase()} has healed, but left its mark: ${m.what[0].toLowerCase() + m.what.slice(1)}.`, 'bad', { who: c.id });
  return m;
}
// the injury someone has when they get hurt doing a thing; s is how bad, 0 to 1
export function injure(sim, c, kind, s, how) {
  const r = rnd(), side = rnd() < .5 ? 'L' : 'R', pick = list => { let a = 0; const t = rnd() * list.reduce((q, e) => q + e[2], 0); for (const e of list) { a += e[2]; if (t < a) return e; } return list[0]; };
  const list = HURT[kind] || HURT.build, [part, k] = pick(list), p = PART[part.endsWith('_') ? part.slice(0, -1) + side : part];
  const out = [wound(sim, c, p, k, s, how)];
  // a bad crush or fall often breaks the bone under it
  if (k === 'crush' && !INNER.has(p) && p !== PART.head && s > .4 && r < .55) out.push(wound(sim, c, p, 'frac', s * .9, how));
  return out;
}
// what goes wrong, doing what: [part (a trailing _ means either side), kind, weight]
const HURT = {
  quarry: [['hand_', 'crush', 3], ['hand_', 'cut', 2], ['leg_', 'crush', 2], ['arm_', 'cut', 1], ['eyeL', 'punct', .3], ['spine', 'crush', .6]],
  fell: [['leg_', 'crush', 3], ['torso', 'crush', 1.2], ['arm_', 'crush', 1], ['hand_', 'cut', 1.5], ['leg_', 'cut', 1], ['head', 'crush', .5]],
  build: [['hand_', 'cut', 3], ['arm_', 'frac', 1], ['leg_', 'frac', .8], ['head', 'crush', .7], ['hand_', 'crush', 1.2], ['spine', 'crush', .5]],
  bench: [['hand_', 'cut', 3], ['hand_', 'burn', 1.5], ['eyeR', 'punct', .3]],
  cook: [['hand_', 'burn', 3], ['arm_', 'burn', 1.5], ['hand_', 'cut', 1.5]],
  gather: [['hand_', 'punct', 3], ['hand_', 'cut', 2], ['leg_', 'punct', 1]],
  farm: [['hand_', 'cut', 2], ['leg_', 'cut', 1], ['hand_', 'punct', 1.5], ['spine', 'crush', .4]],
  fight: [['head', 'crush', 2], ['torso', 'crush', 1.2], ['arm_', 'crush', 1], ['hand_', 'frac', .5], ['leg_', 'crush', .6]],
  raid: [['arm_', 'cut', 3], ['hand_', 'cut', 2], ['head', 'crush', 1.2], ['torso', 'cut', 1.2], ['leg_', 'cut', 1], ['torso', 'punct', .6], ['arm_', 'frac', .5]],
  fall: [['arm_', 'frac', 2], ['hand_', 'frac', 1.2], ['head', 'crush', 1.2], ['leg_', 'frac', 1], ['spine', 'crush', 1], ['hand_', 'cut', 1]],
  frost: [['hand_', 'frost', 3], ['skin', 'frost', 1.5]],
  lightning: [['skin', 'burn', 3], ['chest', 'crush', 1]],
  fire: [['hand_', 'burn', 2], ['arm_', 'burn', 2], ['skin', 'burn', 1.5], ['leg_', 'burn', 1]],
};
// a short description of a wound, the way a medic would put it
export function woundText(w, inner) {
  const P = PARTS[w.p], n = P.name, size = w.s > .75 ? 'Severe ' : w.s > .45 ? 'Bad ' : w.s > .2 ? '' : 'Small ', Sz = t => size ? size + t : cap1(t);
  if (inner) return w.p === PART.head ? 'Bleeding under the skull' : `Bleeding inside the ${n}`;
  switch (w.k) {
    case 'frac': return w.p === PART.spine ? 'Cracked vertebra' : w.p === PART.handL || w.p === PART.handR ? `Broken bones in the ${n}` : `Broken ${n}`;
    case 'crush': return Sz(`crush injury to the ${n}`);
    case 'cut': return Sz(`cut on the ${n}`);
    case 'burn': return w.p === PART.skin ? Sz('burns across the skin') : Sz(`burn on the ${n}`);
    case 'punct': return Sz(`puncture wound in the ${n}`);
    case 'frost': return w.p === PART.skin ? 'Frostbite on the face and feet' : `Frostbite on the ${n}`;
  }
  return cap1(n);
}
// a fresh body after a save from milestone 4 part 1: someone who was "hurt" gets a healing bruise to match
export function migrateBody(sim, c) {
  c.bd = newBody(); c.cap = null;
  if (c.hurt > 0 && !c.dead) { const w = wound(sim, c, PART[rnd() < .5 ? 'legL' : 'armR'], 'crush', .3, 'in an accident before the clinic kept records'); w.closed = true; w.bl = 0; w.heal = .4; w.dirt = 0; }
}

// How a person lives a day: when they sleep, work, eat and rest, and the three states of mind that rise and
// fall for reasons you can trace (fatigue, strain, trust in the Seed), the ties they form, and what breaks.
import { MAP, HOUR, DAY_TICKS, YEAR_DAYS, ACT, SHIFTS, OUTDOOR, hidden } from './consts.js';
import { rnd, ri, clamp } from './rng.js';
import { workNext, dropCarry } from './work.js';
import { byId } from './build.js';
import { lookAround, dietDay } from './food.js';
import { dayWeather, fireOn } from './year.js';
import { ailing, bodyTick, laidUp, needs, injure, danger, downed, woundText } from './body.js';
import { endCare, restFor, goToPatient } from './care.js';
import { spend } from './director.js';
import { toIsolate, illDay, ILL } from './illness.js';
import { fightSpot } from './hazards.js';
import { scar, relive, traumaTick, traumaDay } from './trauma.js';
import { ctlStart } from './control.js';
import { close, FAMILY, BIT, playSpot, lastFounder } from './lives.js';

const WORKING = a => a === ACT.BUILD || a === ACT.CARRY || a === ACT.SURVEY || a === ACT.PLANT || a === ACT.QUARRY || a === ACT.FELL || a === ACT.STONE || a === ACT.LOG || a === ACT.TEST || a === ACT.BENCH || a === ACT.GATHER || a === ACT.FARM || a === ACT.COOK || a === ACT.SAMPLE || a === ACT.SACK || a === ACT.FIGHT;
// a finished building with its lights on
const usable = (S, id) => { const p = id >= 0 ? byId(S, id) : null; return p && p.done && p.powered ? p : null; };
// a bunkhouse with no power is still a roof: a dark, cold one, but out of the wind (not while it burns or stands in water)
const roofed = (S, id) => { const p = id >= 0 ? byId(S, id) : null; return p && p.done && !p.shut ? p : null; };
const coldOut = (S, c) => c.chill > 25 || (S.F && S.F.temp < -4);
const CLASH = [['stubborn', 'stubborn'], ['reckless', 'careful'], ['sociable', 'solitary'], ['restless', 'patient']];
export const remember = (sim, c, m) => { c.mem.push({ d: sim.day, m }); if (c.mem.length > 24) c.mem.splice(2, 1); };

// ---------- what someone wants to be doing right now ----------
export function want(sim, c) {
  const S = sim.S, h = sim.hour, cr = c.crew >= 0 ? S.crews[c.crew] : null, sh = cr ? SHIFTS[cr.shift] : SHIFTS[1];
  if (c.carried >= 0) return 'carried';
  if (c.down) return 'down';
  if (c.care) return 'care';
  if (c.ctl) return 'ctl';          // under the player's direct orders in an emergency
  if (c.fight > 0) return 'fire';   // all hands to a fire near the camp
  if (c.act === ACT.WAKE && c.timer > 0) return 'wake';
  if (c.alone > 0) return 'alone';
  // the clinic's rule: the sick with something catching stay apart until it has passed
  if (S.care && S.care.iso && toIsolate(c)) return 'ward';
  // the hurt rest in a clinic bed if there is one, or their own; so does anyone waiting to be treated
  if (c.cap && (laidUp(c) || (S.care && S.care.medics > 0 && needs(c, sim).some(n => TREAT.has(n.k))))) return 'ward';
  // children: the smallest in the Seed's nursery; the others play by the fire, eat early and go to bed early
  if (c.life < 3) return c.life === 0 ? 'nursery' : h >= c.bed || h < 7 ? 'sleep' : h >= 17 ? 'eat' : 'play';
  if (h >= c.bed || h < sh.a - .7) return 'sleep';
  if (c.minding && h >= 7 && h < 17) return 'mind';   // nobody else is looking after their small child today
  if (cr && cr.work !== 'rest' && h >= sh.a && h < endOf(c, sh)) {
    const off = h >= 16.5 ? 'eat' : 'idle';
    if (c.fat >= 90 && cr.rules.rest) return off;
    if (cr.work === 'survey' && (cr.recalled || c.escort === sim.day)) return off;
    if (OUTDOOR.has(cr.work) && dayWeather(sim.W.seed, sim.cal).out === 2) return off;   // a blizzard: nobody works outside
    if (c.noWork > S.tick) return off;   // nothing for this crew to do just now: look again in a while
    return 'work';
  }
  return h >= 17 ? 'eat' : 'idle';
}
const TREAT = new Set(['close', 'dress', 'set', 'surgery', 'abx', 'dx', 'nurse']);
// people who no longer trust the Seed go home at the end of a normal day, whatever the shift says
const endOf = (c, sh) => c.tru < 35 && sh.b > 18 ? 18 : sh.b;

export function think(sim, c) {
  if (c.dead) return;
  const w = want(sim, c);
  if (w === 'carried') return;
  if (w === c.plan) {
    // a job that ran out of steps starts its next one
    if ((w === 'work' || w === 'fire' || w === 'ctl') && c.mv === 0 && c.timer <= 0 && !c.job) start(sim, c, w);
    else if (w === 'idle' && c.mv === 0 && c.act === ACT.IDLE && (rnd() < .04 || (coldOut(sim.S, c) && indoorsFor(sim.S, c)))) idleAt(sim, c);
    else if ((w === 'play' || w === 'mind') && c.mv === 0 && (c.act === ACT.PLAY || c.act === ACT.MIND || c.act === ACT.IDLE) && (rnd() < (w === 'play' ? .12 : .03) || (coldOut(sim.S, c) && indoorsFor(sim.S, c)))) playAt(sim, c, w);
    return;
  }
  start(sim, c, w);
}
function start(sim, c, w) {
  const S = sim.S, W = sim.W;
  if (c.care && w !== 'care') endCare(sim, c);
  if (w === 'care') { c.plan = 'care'; c.timer = 0; c.where = -1; goToPatient(sim, c, S.cols[c.care.who]); return; }
  if (c.job === 'plant') S.seedc.stakes++;   // a stake that never got planted goes back to the lander
  if (c.carry || c.make) dropCarry(sim, c);
  c.plan = w; c.job = ''; c.timer = 0; c.where = -1; c.pj = -1;
  if (w === 'wake') return;
  if (w === 'ctl') { ctlStart(sim, c); return; }
  if (w === 'fire') { c.job = 'fire'; sim.goTo(c, fightSpot(sim, c.fight), ACT.FIGHT, ACT.WALK); return; }
  if (w === 'down') { c.job = 'down'; c.mv = 0; if (!hidden(c.act) && c.act !== ACT.BED) c.act = ACT.DOWN; return; }
  if (w === 'sleep' || w === 'ward') {
    // the hurt sleep where they rest: a clinic bed if there is one free
    const r = w === 'ward' || (c.ward >= 0 && ailing(c.bd)) ? restFor(sim, c) : null, home = roofed(S, c.home) || (S.mode === 'landfall' && coldOut(S, c) ? refuge(S, c) : null);
    c.warmAt = home ? home.id : -1;
    c.ward = r && r.ward ? r.p.id : -1;
    c.job = w === 'ward' ? 'ward' : 'sleep';
    if (r && r.ward) sim.goTo(c, sim.doorOf(r.p), w === 'sleep' ? ACT.INSIDE : ACT.INDOORS, ACT.WALK);
    else if (home) sim.goTo(c, sim.doorOf(home), ACT.INSIDE, ACT.WALK); else sim.goTo(c, c.slot, ACT.BED, ACT.WALK);
    if (c.mv && w === 'sleep') c.act = ACT.TOBED;
  } else if (w === 'eat') {
    const mess = usable(S, c.mess); c.job = 'eat';
    if (mess) sim.goTo(c, sim.doorOf(mess), ACT.INDOORS); else sim.goTo(c, c.seat, ACT.EAT);
  }
  else if (w === 'idle') idleAt(sim, c);
  else if (w === 'play' || w === 'mind') playAt(sim, c, w);
  else if (w === 'nursery') { c.job = 'nursery'; sim.goTo(c, sim.cargoTile, ACT.INDOORS); }
  else if (w === 'alone') {
    const L = W.land;
    for (let k = 0; k < 30; k++) { const a = rnd() * 6.283, r = 14 + rnd() * 6, x = Math.floor(L.x + Math.cos(a) * r), y = Math.floor(L.y + Math.sin(a) * r), t = y * MAP + x; if (W.reach[t] && W.cost[t] && W.cost[t] < 15) { c.job = 'alone'; sim.goTo(c, t, ACT.ALONE); return; } }
    c.act = ACT.ALONE;
  } else if (w === 'work') {
    if (!workNext(sim, c)) { c.noWork = S.tick + Math.round(HOUR / 2); c.plan = 'idle'; idleAt(sim, c); }
  }
}
// somewhere to sit out the cold between jobs: the commons, or their own bunk
const indoorsFor = (S, c) => usable(S, c.mess) || roofed(S, c.home) || refuge(S, c);
// with no bunk of their own, in a hard frost people crowd into whatever roof there is and sleep on the floor
const REFUGE = ['shelter', 'burrow', 'dorm', 'commons', 'clinic', 'workshop'];
function refuge(S, c) {
  let best = null, bd = 1e9;
  for (const p of S.projects) if (!p.gone && p.done && !p.shut && REFUGE.includes(p.type)) { const d = Math.hypot(p.x + p.w / 2 - c.x, p.y + p.h / 2 - c.y) - (p.type === 'burrow' ? 6 : 0); if (d < bd) { bd = d; best = p; } }
  return best;
}
// children play near the fire, where whoever minds them can see them; in the hard cold they all go indoors
export function playAt(sim, c, w) {
  const S = sim.S;
  if (S.mode === 'landfall' && coldOut(S, c)) { const p = indoorsFor(S, c); if (p) { c.job = 'warm'; c.warmAt = p.id; sim.goTo(c, sim.doorOf(p), ACT.INDOORS); return; } }
  const t = playSpot(sim);
  if (t < 0) { idleAt(sim, c); return; }
  c.job = w === 'play' ? 'play' : 'mind'; sim.goTo(c, t, w === 'play' ? ACT.PLAY : ACT.MIND);
}
function idleAt(sim, c) {
  const W = sim.W, L = W.land, S = sim.S;
  if (S.mode === 'landfall' && coldOut(S, c)) { const p = indoorsFor(S, c); if (p) { c.job = 'warm'; c.warmAt = p.id; sim.goTo(c, sim.doorOf(p), ACT.INDOORS); return; } }
  for (let k = 0; k < 20; k++) {
    const a = rnd() * 6.283, r = 5 + rnd() * 6, x = Math.floor(L.x + Math.cos(a) * r), y = Math.floor(L.y + Math.sin(a) * r), t = y * MAP + x;
    if (W.reach[t] && W.cost[t] && W.cost[t] < 15 && !sim.nearPlot(x, y, 0)) { c.job = 'idle'; sim.goTo(c, t, ACT.IDLE); return; }
  }
  c.act = ACT.IDLE;
}

// ---------- the mind, every couple of game minutes ----------
export function mindTick(sim, c) {
  if (c.dead) return;
  const S = sim.S, dt = 30 / HOUR, h = sim.hour, has = t => c.traits.includes(t), a = c.act;
  const asleep = a === ACT.BED || a === ACT.INSIDE, working = WORKING(a), at = c.where >= 0 && hidden(a) ? byId(S, c.where) : null, ward = at && at.type === 'clinic';
  const cr = c.crew >= 0 ? S.crews[c.crew] : null, lead = cr && cr.lead >= 0 && cr.lead !== c.id ? S.cols[cr.lead] : null;
  const L = sim.W.land, dCamp = Math.hypot(c.x - L.x, c.y - L.y), night = h >= sim.dusk || h < sim.dawn, land = S.mode === 'landfall';
  const wx = dayWeather(sim.W.seed, sim.cal), outside = !hidden(a);
  // what they see: everyone outside reports to the Seed; a surveyor looks harder, and fog hides a lot
  if (!asleep && outside) {
    sim.reveal(c.x, c.y, (a === ACT.SURVEY || a === ACT.PLANT ? 10 : 6) * (wx.fog ? .6 : 1));
    if (land) lookAround(sim, c, cr && (cr.work === 'survey' || cr.work === 'forage') && (a === ACT.SURVEY || a === ACT.PLANT || a === ACT.WALK || a === ACT.GATHER || a === ACT.SAMPLE));
  }
  // the cold: it builds up outside below freezing, faster in wind and much slower in a bedroll; the fire,
  // and any roof, warm people up again
  if (land) {
    const T = S.F.temp - wx.wind * 6, F = sim.W.site.fire, byFire = (a === ACT.EAT || a === ACT.COOK) && fireOn(h) > .3 && Math.hypot(c.x - F.x, c.y - F.y) < 6;
    const dark = !outside && at && !at.powered && at.type !== 'burrow' && at.type !== 'shelter';   // the earth keeps dug rooms warm; the lander's shelter has its own cells
    let ch = !outside ? (dark ? (T < 0 ? -T * .12 - 3 : -6) :  -12) : byFire ? -5 : a === ACT.BED ? Math.max(0, -6 - T) * .25 - (T > 0 ? 2 : 0) : T < 2 ? (2 - T) * .22 : -3;
    if (ch > 0 && c.traits.includes('restless')) ch *= .9;
    const was = c.chill; c.chill = clamp(c.chill + ch * dt, 0, 100);
    if (was < 65 && c.chill >= 65) { S.stats.cold++; sim.log(`${c.name} is dangerously cold${a === ACT.BED ? ', sleeping out in a bedroll' : ''}.`, 'bad', { e: 'cold', lvl: 1, who: c.id, title: 'Dangerously cold' }); remember(sim, c, 'Got so cold they could not stop shaking.'); scar(sim, c, 'cold', 15, 'Nearly froze to death.'); }
  }
  // fatigue: work and walking tire, sleep restores, a bed restores more than the ground
  let f = asleep ? (a === ACT.INSIDE ? -9.5 : -6.5) : a === ACT.QUARRY ? 4 : a === ACT.FELL || a === ACT.BUILD ? 3.6 : a === ACT.CARRY || a === ACT.STONE || a === ACT.LOG ? 3.3 : a === ACT.BENCH ? 2.2 : working ? 2.8 : c.moving ? 2.4 : a === ACT.EAT || a === ACT.INDOORS ? (ward ? -2 : .3) : .8;
  const tt = traumaTick(c);
  if (f < 0 && asleep) f *= tt.sleep;   // nightmares: what they carry follows them into sleep
  if (f > 0) { if (c.fresh > 0) f *= 1.6; if (has('patient')) f *= .9; if (c.bd.pain > .2) f *= 1 + c.bd.pain * .4; if (c.hungry) f += 1; if (c.chill > 35) f += 1; if (c.unwell) f += .7; }
  c.fat = clamp(c.fat + f * dt, 0, 100);
  // strain: gains and reliefs per hour
  let g = 0, rel = .15;
  if (a === ACT.BED) g += 1.7;                                  // a bedroll on open ground, on a strange world
  if (c.fresh > 0 && !asleep) g += .35;                          // a body that doesn't feel like theirs yet
  if (a === ACT.INSIDE) rel += .6;
  if (a === ACT.INDOORS && at) {
    if (at.type === 'commons') { const n = countNear(S, c, 1); rel += n >= 2 ? (has('sociable') ? 3.2 : has('solitary') ? 1.4 : 2.4) : 1; }   // a meal at a table, out of the wind
    else rel += .6;
  }
  if (working && c.fat > 70) g += .3 + 1.2 * (c.fat - 70) / 30;
  if (working && c.worked > 11 * HOUR) g += 1.5;
  if (night && !asleep && dCamp > 25) { g += has('anxious') ? 4.5 : has('reckless') ? 1.5 : 3; c.dark = 1; }
  if (!asleep && dCamp > 20 && !anyoneNear(S, c, 8)) g += has('sociable') ? 1.6 : has('solitary') ? .25 : .8;
  if (a === ACT.EAT) { const n = countNear(S, c, 4.5); if (n >= 2) rel += has('sociable') ? 2.4 : has('solitary') ? 1 : 1.6; if (n > 14 && has('solitary')) g += .8; }
  for (const id in c.ties) {
    const t = c.ties[id], o = S.cols[id]; if (!t.k || !o || o.dead || asleep) continue;
    if (Math.abs(o.x - c.x) > 6 || Math.abs(o.y - c.y) > 6) continue;
    if (t.k === 'partner') rel += .8; else if (close(t)) rel += .5; else if (t.k === 'rival') g += .5;
  }
  g += tt.g;                                                     // the weight of what they carry
  if (c.hungry) g += 2; g += Math.min(1.5, c.bd.pain) * 1.1; if (c.chill > 35) g += .8 + (c.chill - 35) / 40; if (c.unwell) g += .4;
  if (outside && !asleep && (wx.rain > .5 || wx.snow > .5) && dCamp > 8) g += .3;               // working in the rain or snow
  if (a === ACT.EAT && S.F && S.F.temp < -5) g += .6;                                       // supper outside at fifteen below
  if (has('anxious')) g *= 1.3; if (has('steady')) g *= .75; if (has('cheerful')) rel *= 1.4;
  if (lead && working) g *= 1.1 - lead.skills.leadership * .03;
  if (c.calm > 0) { c.calm -= 30; g *= .5; }   // spent: for a day after a breakdown strain comes on slowly, and they don't break again
  c.str = clamp(c.str + (g - rel) * dt, 0, 100);
  bonds(sim, c, dt, working);
  // breaking down: at the far end of strain, people stop and walk off to be alone for a while
  if (c.alone > 0) { c.alone -= 30; if (c.alone <= 0) { c.alone = 0; c.str = Math.max(0, c.str - 30); c.calm = DAY_TICKS; sim.log(`${c.name} came back to camp.`, '', { e: 'back', lvl: 1, who: c.id, title: 'Back from a breakdown' }); } }
  else if (c.str >= 85 - tt.brk && !asleep && !(c.calm > 0) && rnd() < .15 * dt) {
    c.alone = ri(4, 7) * HOUR; c.tru = Math.max(0, c.tru - 3); S.stats.breakdowns++;
    sim.log(`${c.name} broke down and walked off to be alone.`, 'bad', { e: 'breakdown', lvl: 2, who: c.id, title: `${c.name} broke down` }); remember(sim, c, 'Broke down and walked away from everyone for a few hours.');
  }
  // the body
  if (c.fresh > 0) { c.fresh -= 30; if (c.fresh <= 0) remember(sim, c, 'Stopped feeling like a stranger in this body.'); }
  if (ailing(c.bd)) {
    const rest = asleep || ward || a === ACT.DOWN || c.plan === 'ward';
    const heal = (rest ? 1.5 : working ? .6 : 1) * (ward ? 1.25 : 1) * (c.hungry ? .4 : 1) * (c.chill > 35 ? .7 : 1) * (c.unwell ? .7 : 1) * (c.fat > 80 ? .8 : 1);
    const weak = (c.fat > 80 ? 1.3 : 1) * (c.unwell ? 1.25 : 1) * (c.hungry ? 1.3 : 1) * (c.fresh > 0 ? 1.3 : 1);   // a new body has no resistance to anything
    const why = bodyTick(sim, c, dt, { heal, weak, lying: rest, hungry: c.hungry, chill: c.chill, ward });
    c.hurt = c.bd.w.length ? 1 : 0;
    if (why) return die(sim, c, why);
    if (!c.hurt && c.ward >= 0 && !c.cap) { c.ward = -1; if (c.plan === 'ward') c.plan = ''; }
  }
  if (c.hungry) { c.hp -= 3 / 24 * dt; if (c.hp <= 0) return die(sim, c, 'starved'); }
  if (c.chill >= 65) { c.hp -= (c.chill >= 99 ? 6 : 1.5) * dt; if (c.hp <= 0) return die(sim, c, 'froze'); }
  if (c.unwell && (c.tox > 8 || c.lack > 20)) { c.hp -= 2 / 24 * dt; if (c.hp <= 0) return die(sim, c, 'diet'); }
  else if (!c.hungry && c.chill < 50 && c.hp < 100) c.hp = Math.min(100, c.hp + (ward ? 12 : 6) / 24 * dt * (c.unwell ? .3 : 1));
  // practice
  if (working) c.worked += 30;
  if (a === ACT.BUILD) { grow(c, 'building', .02 * dt); grow(c, 'engineering', .01 * dt); }
  if (a === ACT.QUARRY || a === ACT.FELL) { grow(c, 'building', .01 * dt); grow(c, 'fieldcraft', .01 * dt); }
  if (a === ACT.BENCH || a === ACT.TEST) grow(c, 'engineering', .02 * dt);
  if (a === ACT.SURVEY) grow(c, 'fieldcraft', .02 * dt);
  if (a === ACT.FARM) grow(c, 'botany', .02 * dt);
  if (a === ACT.GATHER || a === ACT.SAMPLE) { grow(c, 'fieldcraft', .012 * dt); grow(c, 'botany', .01 * dt); }
  if (a === ACT.COOK) grow(c, 'cooking', .02 * dt);
  if (a === ACT.BENCH && at && at.type === 'lab') { grow(c, 'botany', .015 * dt); grow(c, 'medicine', .008 * dt); }
  if (working && cr && cr.lead === c.id) grow(c, 'leadership', .006 * dt);
  // accidents: exhausted, careless or clumsy hands at work
  const hz = c.mv === 0 && HAZ[a];
  if (hz) {
    let p = (c.fat > 85 ? .03 : .002) * (hz === 'bench' || hz === 'cook' || hz === 'gather' || hz === 'farm' ? .5 : 1);
    if (has('reckless')) p += .006; if (has('careful')) p *= .3; if (c.fresh > 0) p *= 1.5; if (a === ACT.FELL) p *= 1.5; if (wx.out) p *= 2.5; if (c.chill > 35) p *= 1.5;
    if (c.cap) p *= 1 + (1 - c.cap.sight) * 1.5 + (1 - c.cap.manip) * .8;
    if (rnd() < p * dt) {
      const s = .15 + Math.pow(rnd(), 1.7) * .75 * (wx.out ? 1.2 : 1) * (c.fat > 85 ? 1.15 : 1);
      hurtBy(sim, c, hz, s, `${c.name} was hurt ${HAZ_WHERE[hz]}${wx.out ? ' in the storm' : ''}${c.fat > 85 ? ', working while exhausted' : ''}`, `Got hurt ${HAZ_WHERE[hz]}.`, HAZ_WHERE[hz]);
    }
  }
  if (land && outside && !asleep) {
    // ice underfoot
    if (c.moving && S.F.ice > .3 && rnd() < .0025 * S.F.ice * dt) hurtBy(sim, c, 'fall', .2 + rnd() * .6, `${c.name} slipped on the ice and fell`, 'Slipped on the ice and fell hard.', 'slipping on the ice');
    // frostbite: the very cold, out in the open
    if (c.chill >= 75 && rnd() < .06 * dt) hurtBy(sim, c, 'frost', .25 + (c.chill - 75) / 50 + rnd() * .2, `${c.name} has frostbite`, 'Got frostbite out in the cold.', 'out in the cold');
    // lightning: rare, and only out on open ground in a storm
    if (wx.k === 'storm' && dCamp > 12 && rnd() < .0005 * dt) hurtBy(sim, c, 'lightning', .7 + rnd() * .3, `${c.name} was struck by lightning`, 'Was struck by lightning.', 'struck by lightning');
  }
}
const HAZ = { [ACT.BUILD]: 'build', [ACT.QUARRY]: 'quarry', [ACT.FELL]: 'fell', [ACT.BENCH]: 'bench', [ACT.COOK]: 'cook', [ACT.GATHER]: 'gather', [ACT.SAMPLE]: 'gather', [ACT.FARM]: 'farm' };
const HAZ_WHERE = { build: 'on the building site', quarry: 'cutting stone', fell: 'felling a tree', bench: 'at a workshop bench', cook: 'cooking', gather: 'gathering', farm: 'working a field' };
// someone gets hurt: the wounds, the news, and their next thought is to stop
function hurtBy(sim, c, kind, s, lead, mem, how) {
  const S = sim.S, ws = injure(sim, c, kind, s, how);
  S.stats.accidents++; c.str = Math.min(100, c.str + 4 + s * 8);
  const seen = ws.filter(w => w.kn).map(w => woundText(w).toLowerCase()), bad = danger(c) > .45 || downed(c);
  sim.log(`${lead}: ${seen.length ? seen.join(', and ') : 'bruised, with nothing broken that anyone can see'}.`, 'bad', { e: bad ? 'badhurt' : 'hurt', lvl: bad ? 2 : 1, who: c.id, title: bad ? `${c.name} is badly hurt` : kind === 'frost' ? 'Frostbite' : kind === 'lightning' ? 'Lightning' : 'An accident' });
  remember(sim, c, mem);
  if (bad) { relive(sim, ['hurt'], o => o !== c && Math.hypot(o.x - c.x, o.y - c.y) < 8); scar(sim, c, 'hurt', 28 + s * 30, `Was badly hurt ${how}.`); }
  if (c.plan !== 'down') c.plan = '';
}
function anyoneNear(S, c, r) { for (const o of S.cols) if (o !== c && !o.dead && !hidden(o.act) && Math.abs(o.x - c.x) < r && Math.abs(o.y - c.y) < r) return true; return false; }
function countNear(S, c, r) { let n = 0; for (const o of S.cols) if (o !== c && o.act === c.act && (c.act !== ACT.INDOORS || o.where === c.where) && Math.abs(o.x - c.x) < r && Math.abs(o.y - c.y) < r) n++; return n; }
// practice: a few points a year of full-time work for a beginner, slower the better someone already is
const grow = (c, k, v) => { c.skills[k] = Math.min(10, Math.round((c.skills[k] + v * .15 * (1.1 - c.skills[k] / 10)) * 1000) / 1000); c.pr |= BIT[k]; };

// ---------- ties: working and eating together makes people familiar; temperament decides the rest ----------
function bonds(sim, c, dt, working) {
  const S = sim.S;
  let near = null;
  if (working && c.crew >= 0) near = S.crews[c.crew].members.map(i => S.cols[i]).filter(o => o !== c && !o.dead && Math.hypot(o.x - c.x, o.y - c.y) < 6);
  else if (c.act === ACT.EAT) { near = []; for (const o of S.cols) if (o !== c && o.act === ACT.EAT && Math.hypot(o.x - c.x, o.y - c.y) < 4) near.push(o); }
  if (!near || !near.length) return;
  const rate = working ? 1 : .6;
  for (const o of near) {
    const t = c.ties[o.id] || (c.ties[o.id] = { f: 0, a: 0, k: null });
    t.f = Math.min(100, t.f + rate * dt);
    let da = .5;
    for (const [x, y] of CLASH) if ((c.traits.includes(x) && o.traits.includes(y)) || (c.traits.includes(y) && o.traits.includes(x))) da -= 1.3;
    if (c.traits.some(k => o.traits.includes(k)) && !c.traits.includes('stubborn')) da += .5;
    if (c.traits.includes('cheerful') || o.traits.includes('cheerful')) da += .3;
    if (c.str > 60 || o.str > 60) da -= 1.2;   // tempers fray
    t.a = clamp(t.a + da * dt, -100, 100);
    if (FAMILY.has(t.k)) continue;   // family stays family, whatever the day was like
    const k = t.a >= 25 && t.f >= 30 ? 'friend' : t.a <= -25 && t.f >= 15 ? 'rival' : t.k === 'friend' && t.a > 10 ? 'friend' : t.k === 'rival' && t.a < -10 ? 'rival' : null;
    if (k !== t.k) {
      t.k = k;
      if (k && c.id < o.id) {
        S.stats[k === 'friend' ? 'friends' : 'rivals']++;
        sim.log(k === 'friend' ? `${c.name} and ${o.name} have become friends.` : `${c.name} and ${o.name} can't stand each other.`, k === 'friend' ? 'good' : 'bad', { e: k === 'friend' ? 'friends' : 'rivals', lvl: 1, who: c.id, title: k === 'friend' ? 'New friends' : 'A falling-out' });
        remember(sim, c, k === 'friend' ? `Became friends with ${o.name}.` : `Fell out with ${o.name}.`); remember(sim, o, k === 'friend' ? `Became friends with ${c.name}.` : `Fell out with ${c.name}.`);
      }
    }
  }
}

// ---------- once a day, before dawn: how the day went, and what it did to trust ----------
export function daily(sim, c) {
  if (c.dead) return;
  const S = sim.S, has = t => c.traits.includes(t), k = has('stubborn') ? .6 : 1;
  let d = 0;
  if (c.act === ACT.BED && sim.day >= 3) d -= has('steady') ? .4 : .8;          // still sleeping on the ground
  if (c.worked > 12 * HOUR) d -= has('patient') ? 1.2 : 2.5; else if (c.worked > 0 && c.worked <= 8 * HOUR) d += .3;
  if (c.dark) { d -= 3; S.stats.darkReturns++; }
  if (c.hungry) d -= 2;
  c.tru = clamp(c.tru + d * k, 0, 100);
  c.worked = 0; c.dark = 0;
  if (S.mode === 'landfall') { dietDay(sim, c); illDay(sim, c); traumaDay(sim, c); }
  // keep only the ties that matter
  const ids = Object.keys(c.ties);
  const w = t => (FAMILY.has(t.k) ? 1000 : t.k ? 200 : 0) + t.f;
  if (ids.length > 10) { ids.sort((a, b) => w(c.ties[b]) - w(c.ties[a])); for (const id of ids.slice(10)) if (!FAMILY.has(c.ties[id].k)) delete c.ties[id]; }
}
// trust moves for the whole colony at once when something the Seed planned works out
export function trustAll(sim, v, why) {
  for (const c of sim.S.cols) if (!c.dead) { c.tru = clamp(c.tru + v * (c.traits.includes('stubborn') ? .6 : 1), 0, 100); if (why) remember(sim, c, why); }
}
const DIED = { old: ' of old age', starved: ' of hunger', froze: ' of the cold', diet: ' after a long sickness from what they ate', bled: ': they lost too much blood', shock: ' of shock from their injuries', infection: ' of an infection that got into their wounds', head: ' of a head injury' };
export function die(sim, c, why) {
  if (c.care) endCare(sim, c);
  dropCarry(sim, c); c.dead = true; c.act = ACT.DEAD; c.mv = 0; c.home = c.mess = c.ward = -1; c.carried = -1; c.down = false; sim.S.stats.deaths++; spend(sim, 4, 'death');
  const ill = why.startsWith('ill:') && why.split(':');
  const yrs = Math.floor((sim.S.tick / DAY_TICKS - c.born) / YEAR_DAYS);
  sim.log(`${c.name} died${ill ? (ill[2] === '1' ? ` of ${ILL[ill[1]].name.toLowerCase()}` : ' of an illness nobody had named') : DIED[why] || ''}${why === 'old' || c.life < 4 ? `, at ${yrs}` : ''}.`, 'bad', { e: why === 'old' ? 'oldage' : 'death', lvl: 2, who: c.id, title: `${c.name} died` });
  relive(sim, ['grief', 'death']);
  for (const o of sim.S.cols) if (!o.dead) {
    const t = o.ties[c.id], saw = !hidden(o.act) && o.act !== ACT.BED && Math.hypot(o.x - c.x, o.y - c.y) < 10;
    // a death of age is mourned, but it is not the same shock; the loss of a partner or a child is the hardest of all
    const near = t && (t.k === 'partner' || t.k === 'child'), soft = why === 'old' ? .6 : 1;
    o.str = Math.min(100, o.str + (near ? 35 : close(t) ? 25 : 8) * soft); if (t && t.k) remember(sim, o, `Lost ${c.name}.`);
    if (close(t)) scar(sim, o, 'grief', (near ? 60 : 45) * soft, `Lost ${c.name}.`, c.id); else if (saw || (o.care && o.care.who === c.id)) scar(sim, o, 'death', 22, `Saw ${c.name} die.`, c.id);
  }
  const cr = c.crew >= 0 ? sim.S.crews[c.crew] : null;
  if (cr) { cr.members = cr.members.filter(i => i !== c.id); if (cr.lead === c.id) cr.lead = cr.members[0] ?? -1; }
  if (c.partner >= 0 && sim.S.cols[c.partner]) sim.S.cols[c.partner].partner = -1;
  lastFounder(sim, c);
  sim.S.rv++;
}

// The colony's work: the fabricator printing founders from the archive (and modules from salvage when it has no
// body to print), crews and what they do (building, quarrying, felling, foraging, farming, the kitchen, workshop
// and lab benches, surveying), and the commands the player gives through the page. The books for buildings are
// kept in build.js, and for food in food.js.
import { MAP, HOUR, DAY_TICKS, ACT, SHIFTS, T, WORKS, WORK_NAME, SEASON_DAYS, YEAR_DAYS } from './consts.js';
import { rnd, ri, clamp } from './rng.js';
import { remember, trustAll, playAt } from './life.js';
import { suggestFirst } from './founders.js';
import {
  TYPES, RAW, PRECISE, RECIPE, FIT_H, SHAFT_CREW, FAB_SLOW, STAGE_NAMES, matName, stageLoads, loadsOf, billOf, loadCheck, capacity, checkPlot, addProject,
  active, built, byId, capOf, powerCheck, shortOf, stockOf, sources, takeFrom, putBack, nextOrder, rawWanted, clearPlot, LANDER_KW, PANEL_KW, LABOUR, stagesOf, FEED, plantStop, PIT_ROCK,
} from './build.js';
import { replacePart } from './aging.js';
import { illMeal } from './illness.js';
import { FIRE_STEP, beat } from './hazards.js';
import { take, order, release } from './control.js';
import { restoreStart, restoreDone, queueRestore } from './scan.js';
import { storyPlot, storyBuilt } from './story.js';
import { eat, analyse, labHour, kitchenJob, cookMeals, foodOf, add, patchLeft, takePatch, inSeason, cropPlan, cropWait, sowUnits, harvestLoads, keyOf, isCrop, mealsInStore, kitchenOnly, hasKitchen, vatLimit, vatsFor, VAT_LOADS, VAT_FILL, SAMPLES, PROC_DAYS, CROPS, CROP_KEYS } from './food.js';
import { dayWeather, untilDeep, doyOf, seasonOf, DEEP } from './year.js';
import { careArrive, careTimer, MED_KIT, MED_MADE, TRIAGE, MEDIC } from './care.js';
import { capOf as bodyCap } from './body.js';
import { worker, portion, playSpot, BIT } from './lives.js';
import { keepHour, libraryWork, pupilsOf, PUPILS, setRule, askCouncil, giveWay, RULES } from './society.js';

export const PRINT_TICKS = 4 * HOUR;
const MEDS_SALVAGE = 2, MEDS_H = 3;   // a batch of medical supplies: salvage, and hours at a workshop's pace
const TPH = 95;          // tiles an unhurried person covers in an hour, for planning trips
const STAKES_ALL = 10, PICK = 100, NO_WORK = Math.round(HOUR / 2);
const FIT_JOBS = new Set(['fetch', 'pick', 'cut', 'fit']);

// ---------- the fabricator ----------
export function seedTick(sim) {
  const S = sim.S, sd = S.seedc;
  if (S.mode !== 'landfall') return;
  if (S.tick % PLANT_STEP === 0) plantTick(sim);
  restoreStart(sim);   // waking someone from a scan comes before anyone new
  if (!sd.printing && sd.queue.length && sd.feed > 0) {
    const fid = sd.queue.shift(); sd.printing = { fid, left: PRINT_TICKS }; sd.feed--; S.rv++;
    sim.log(`The fabricator began printing a body for ${S.archive[fid].name}.`);
  }
  if (sd.printing && --sd.printing.left <= 0) {
    if (sd.printing.rid != null) { const id = sd.printing.rid; sd.printing = null; restoreDone(sim, id); return; }
    const p = S.archive[sd.printing.fid]; p.woke = S.tick; sd.printing = null;
    const c = sim.spawn(p, sim.cargoTile, ACT.WAKE); c.timer = HOUR; c.plan = 'wake'; c.job = 'wake';
    remember(sim, c, 'Woke in a new body, on a new world.');
    sim.log(`${p.name} woke in a new body.`, 'good', { e: 'woke', lvl: 1, who: c.id, title: 'A founder is awake' });
    if (S.crewPlan) planCrews(sim, 'woke'); else if (S.autoCrews) autoCrew(sim, c); else sim.log(`${p.name} is waiting to be put in a crew.`, '', { e: 'nocrew', lvl: 1, who: c.id, title: 'Waiting for a crew' });
    if (!sd.feed && !sd.queue.length) sim.log(`The fabricator has used the last of its feedstock for bodies. ${built(S).some(q => q.type === 'plant') ? 'The feedstock plant makes more, a batch at a time.' : 'To print more people, the colony needs a feedstock plant: plan one in the Build window.'} Meanwhile the fabricator makes modules from salvage.`, '', { e: 'feedstock', lvl: 1, x: sim.W.site.cargo.x + .5, y: sim.W.site.cargo.y + .5, title: 'No more bodies to print' });
  }
  // with no body to print, the fabricator makes modules from salvage, three times slower than a workshop bench
  if (sd.printing || sd.queue.length) return;
  const f = S.fab;
  if (f.job) {
    if (--f.job.left <= 0) {
      if (f.job.k === 'meds') { for (const k in MED_MADE) S.med[k] += MED_MADE[k]; sim.log('The fabricator finished a batch of medical supplies: dressings, painkillers, antibiotics and blood substitute.'); }
      else if (f.job.k === 'refine') { S.stores.yard.salvage += REFINE.out; S.stats.refined = (S.stats.refined || 0) + REFINE.out; }
      else { S.stores.cargo[f.job.k]++; sim.log(`The fabricator finished ${matName(f.job.k, 1).replace(/^1 /, 'a ')}.`); }
      f.job = null; S.rv++;
    }
  } else if (S.tick % 60 === 0) {
    // medical supplies come before parts when they run low
    const M = S.med;
    if (M && (M.dress < MED_KIT.dress / 3 || M.abx < 3 || M.blood < 2 || M.pk < 4) && S.stores.yard.salvage >= MEDS_SALVAGE) { S.stores.yard.salvage -= MEDS_SALVAGE; f.job = { k: 'meds', left: Math.round(MEDS_H * HOUR * FAB_SLOW) }; S.rv++; return; }
    const k = nextOrder(sim);
    if (k && S.stores.yard.salvage >= RECIPE[k].salvage) { S.stores.yard.salvage -= RECIPE[k].salvage; f.job = { k, left: Math.round(RECIPE[k].h * HOUR * FAB_SLOW) }; S.rv++; }
    else if ((S.stores.yard.ore || 0) >= REFINE.ore) { S.stores.yard.ore -= REFINE.ore; f.job = { k: 'refine', left: Math.round(REFINE.h * HOUR) }; S.rv++; }   // nothing to make: ore into salvage
  }
}
// three loads of ore smelt down to two of salvage in the fabricator's furnace
export const REFINE = { ore: 3, out: 2, h: 6 };
// ---------- the feedstock plant ----------
// With power, each tank takes a batch of biomass and stone from the yard and over half a day turns it into an
// eighth of a body's feedstock. What it waits for, if anything, goes on its card.
const PLANT_STEP = 30, PLANT_WAIT = {
  biomass: 'Waiting for biomass in the yard. A forage crew brings it.',
  stone: 'Waiting for stone in the yard. A quarry crew brings it.',
  'biomass+stone': 'Waiting for biomass and stone in the yard. A forage crew brings biomass, and a quarry crew brings stone.',
};
// when no crew does the work that would bring it, the card says so
function nobody(S, short) {
  const want = short.map(k => k === 'stone' ? 'quarry' : 'forage').filter(w => !S.crews.some(k => !k.gone && k.work === w && k.members.length));
  if (!want.length) return '';
  return ` No ${want.join(' or ')} crew is working now: ${S.crewPlan ? 'the Seed adds one when it plans the crews in the morning' : 'make one in Crews, or press Let the Seed plan the crews'}.`;
}
function plantTick(sim) {
  const S = sim.S, sd = S.seedc, Y = S.stores.yard;
  for (const p of built(S)) {
    if (p.type !== 'plant') continue;
    const n = capOf(p).tanks; if (!p.tanks) p.tanks = [];
    while (p.tanks.length < n) p.tanks.push(0);
    let why = p.powered ? '' : 'No power, so the tanks have stopped.';
    for (let i = 0; i < n && p.powered; i++) {
      if (p.tanks[i] > 0) {
        if ((p.tanks[i] -= PLANT_STEP) > 0) continue;
        p.tanks[i] = 0; S.rv++;
        if ((sd.fb = (sd.fb || 0) + 1) >= FEED.per) {
          sd.fb -= FEED.per; sd.feed++; S.stats.feedstock = (S.stats.feedstock || 0) + 1;
          const asleep = S.archive.some(q => q.woke == null && !sd.queue.includes(q.fid)), ask = S.gen.asks[0], couple = ask && `${S.cols[ask.a].name} and ${S.cols[ask.b].name}`;
          const next = sd.queue.length ? `The fabricator starts on ${S.archive[sd.queue[0]].name}, next in line.` : asleep ? `The fabricator can print one more founder: choose who in the Archive.${couple ? ` If you choose nobody before dawn, it goes to the child ${couple} asked for.` : ''}` : couple ? `At dawn it goes to the child ${couple} asked for.` : 'It waits in the fabricator.';
          sim.log(`${p.name} has made feedstock for another body. ${next}${asleep || sd.queue.length ? shortNote(foodShort(sim)) : ''}`, 'good', { e: 'feedmade', lvl: asleep || sd.queue.length ? 2 : 1, pid: p.id, title: 'Feedstock for one more person' });
        }
      }
      const stop = plantStop(S);
      if (stop) { why = why || stop; continue; }
      const short = ['biomass', 'stone'].filter(k => Y[k] < FEED[k]);
      if (short.length) { why = why || PLANT_WAIT[short.join('+')] + nobody(S, short); continue; }
      Y.biomass -= FEED.biomass; Y.stone -= FEED.stone; p.tanks[i] = Math.round(FEED.h * HOUR); S.rv++;
    }
    if (why !== (p.why || '')) {
      p.why = why; S.rv++;
      if (S.crewPlan && why.includes(' No ') && !(S.tick - (S.planAt || -1e9) < 2 * HOUR)) { S.planAt = S.tick; planCrews(sim, 'plant'); }   // the Seed finds hands for it at once
    }
  }
}
// the Seed's suggestion for where a new founder goes: two out surveying, everyone else building
export function autoCrew(sim, c) {
  const S = sim.S;
  let sh = S.crews.find(k => !k.gone && k.work === 'build'), sv = S.crews.find(k => !k.gone && k.work === 'survey');
  if (!sh) { sh = sim.newCrew('build'); S.crews.push(sh); }
  if (!sv) { sv = sim.newCrew('survey'); S.crews.push(sv); }
  const toSurvey = sv.members.length < 2 && (c.skills.fieldcraft >= 4 || sh.members.length >= 3) && c.skills.fieldcraft >= c.skills.building - 1;
  const k = toSurvey || (S.projects[0].done && sv.members.length < 4 && !active(S).length) ? sv : sh;
  sim.addTo(c, k.id);
  for (const cr of [sh, sv]) { let best = cr.lead, bs = -1; for (const i of cr.members) { const s = S.cols[i].skills.leadership; if (s > bs) { bs = s; best = i; } } cr.lead = best; }
  sim.log(`The Seed put ${c.name} in the ${k.name} crew (${WORKS[k.work].toLowerCase()}).`);
}

// ---------- the Seed plans the crews ----------
// How many hands each kind of work needs today, from what the colony has built and what it is short of. Every
// one of them is filled with whoever suits it best compared with building, which takes everyone left over.
const FIT = {
  build: s => .45 + s.building * .05 + s.engineering * .025, survey: s => .5 + s.fieldcraft * .05 + s.botany * .01,
  quarry: s => .55 + s.building * .03 + s.fieldcraft * .03, timber: s => .55 + s.building * .03 + s.fieldcraft * .03,
  forage: s => .55 + s.fieldcraft * .04 + s.botany * .02, farm: s => .5 + s.botany * .05 + s.fieldcraft * .01,
  kitchen: s => .5 + s.cooking * .05, workshop: s => .4 + s.engineering * .07, lab: s => .4 + s.botany * .045 + s.medicine * .03,
  clinic: s => .3 + s.medicine * .08, care: s => .5 + s.teaching * .05 + s.medicine * .02, mine: s => .55 + s.building * .04 + s.engineering * .02,
  teach: s => .35 + s.teaching * .07 + s.leadership * .01, keep: s => .4 + s.teaching * .04 + s.engineering * .03, watch: s => .5 + s.fieldcraft * .03 + s.leadership * .03,
};
const CAPOF = { survey: 'forage', quarry: 'cut', timber: 'cut', kitchen: 'cook', workshop: 'bench', clinic: 'lab', care: 'lab', mine: 'cut', teach: 'lab', keep: 'lab', watch: 'forage' };
function fitFor(c, w) {
  let e = FIT[w](c.skills) * (c.life === 3 ? .7 : c.life === 5 ? .85 : 1);   // an apprentice is still learning; an elder is slowing
  if (c.cap) { const q = CAPW[CAPOF[w] || w] || CAPW.build; let f = 0; for (const k in q) f += q[k] * bodyCap(c, k); e *= f; }
  return e;
}
// after Deep cold, the weeks of thaw before the first crops ripen: the larder has to cover them too
export const THAW_GAP = 20;
// days of food a person the colony needs in store now to reach the first crops after the next Deep cold, or 0 in the
// months when food can still be found and grown
export function leanNeed(sim) {
  const doy = doyOf(sim.cal), ahead = untilDeep(sim.cal), deepStart = DEEP * SEASON_DAYS;
  if (doy >= deepStart) return YEAR_DAYS - doy + THAW_GAP;
  if (doy < THAW_GAP) return THAW_GAP - doy;
  return ahead <= 30 ? ahead + SEASON_DAYS + THAW_GAP : 0;
}
// food for fewer days than the lean months ahead need: what the fabricator's messages and the archive warn of
export function foodShort(sim) {
  const live = sim.S.cols.filter(c => !c.dead).length || 1, days = Math.floor(mealsInStore(sim, true) / live), need = leanNeed(sim);
  return days < need ? { days, need } : null;
}
const shortNote = q => q ? ` The larder holds food for about ${q.days} day${q.days === 1 ? '' : 's'}, and the colony needs about ${q.need} to reach the first crops after Deep cold: everyone woken now eats from it too.` : '';
export function crewNeeds(sim) {
  const S = sim.S, F = S.F, Y = S.stores.yard, people = S.cols.filter(c => !c.dead), n = people.filter(worker).length, B = built(S), has = t => B.filter(p => p.type === t && (p.powered || t === 'field'));
  const need = [];   // in order of what matters most
  const add = (w, k) => { if (k <= 0) return; const o = need.find(q => q[0] === w); if (o) o[1] = Math.max(o[1], k); else need.push([w, k]); };
  if (!S.projects[0].done) { add('survey', n >= 4 ? Math.min(2, n - 3) : 0); return { need, n }; }
  // the small children first: nobody leaves them alone
  const small = people.filter(c => c.life <= 1).length; add('care', Math.ceil(small / 4));
  const days = mealsInStore(sim) / Math.max(1, people.length), tested = F.life.some((L, o) => L.tested && sim.kinds[o].food);
  // the fields first: their harvest is food too, and quicker to bring in than anything found (one farmer for every
  // two fields to sow, harvest or clear; one to keep an eye on the rest)
  const fields = has('field'), toDo = fields.filter(p => p.crop && (p.crop.st === 'ripe' || p.crop.st === 'dead' || (p.crop.st === 'bare' && cropPlan(sim, p)))).length;
  if (fields.length) add('farm', Math.max(1, Math.ceil(toDo / 2)));
  add('forage', days < 3 ? Math.ceil(people.length / 4) : days < 8 ? Math.max(1, Math.ceil(people.length / 8)) : 1);
  if (tested || F.firstHarvest || F.vats.length) add('kitchen', Math.max(1, Math.ceil(people.length / 10)) + (people.some(c => c.hungry) && kitchenOnly(sim) > 4 ? 1 : 0));
  // a working feedstock plant eats biomass and stone every half day: a quarry crew for as long as it runs, and another
  // forager while biomass is short. New people come from it, so it comes before the rest
  const plant = has('plant').length > 0 && !plantStop(S);
  if (plant) { const fo = need.find(q => q[0] === 'forage'); if (fo && Y.biomass < rawWanted(S, 'biomass')) fo[1]++; add('quarry', 1); }
  // out of metal: the mine comes next, since nothing else can be built without it
  const mines = has('mine').filter(p => p.seam > 0), metal = Y.salvage + (Y.ore || 0) * SMELT.out / SMELT.ore;
  // or rare earths, when a project waits on them and a deep seam carries them
  const rareWant = (Y.rare || 0) < 10 && active(S).some(p => (p.need.rare || 0) > (p.got.rare || 0)) && mines.some(p => p.rare > 0);
  if (mines.length && (metal < METAL_WANT / 3 || rareWant)) add('mine', Math.min(mines.reduce((a, p) => a + capOf(p).faces, 0), n >= 10 ? 2 : 1));
  if (S.stakes.length < STAKES_ALL) add('survey', n >= 8 ? 2 : n >= 4 ? 1 : 0);
  // stone and timber for the projects: the builders cut their own only when the yard runs dry
  for (const k of ['stone', 'timber']) { const short = rawWanted(S, k) - (Y[k] || 0); if (short > 8 && active(S).length) add(k === 'stone' ? 'quarry' : 'timber', short > 25 && n >= 10 ? 2 : 1); }
  if (has('lab').length && (F.lab.cur !== -1 || F.lab.queue.length)) add('lab', Math.min(2, has('lab').reduce((a, p) => a + capOf(p).benches, 0)));
  // the workshop, while it has salvage or ore to work; then miners while the colony is short of metal
  if (has('workshop').length && (Y.salvage >= 1 || (Y.ore || 0) >= SMELT.ore)) add('workshop', n >= 15 ? 2 : 1);
  if (mines.length && metal < METAL_WANT) add('mine', 1);
  if (has('clinic').length && n >= 12 && people.some(c => c.skills.medicine >= MEDIC)) add('clinic', 1);
  // the institutions: teachers for the children at school, keepers for the library, and two for the watch at least,
  // so the nights go by turns
  const pupils = pupilsOf(S).length, any = t => B.some(p => p.type === t && !p.shut);
  if (any('school') && pupils) add('teach', Math.ceil(pupils / PUPILS));
  if (any('watch') && n >= 8) add('watch', n >= 40 ? 3 : 2);
  if (any('library') && n >= 10 && libraryWork(S)) add('keep', n >= 40 ? 2 : 1);
  // the last weeks before Deep cold: enough put by to see the cold through, when nothing grows and little can be found
  // and the thaw after it, until the first crops ripen: the hungry weeks. These foragers come last, from the hands
  // that would otherwise be building, so the mines, the workshop and the yard keep going (and never more than two
  // workers in five)
  let more = 0; const push = k => { more = Math.max(more, Math.min(Math.ceil(n * .4), k)); };
  const ahead = untilDeep(sim.cal); if (ahead > 0 && ahead <= 40 && days < ahead + 20 + THAW_GAP) push(Math.ceil(people.length / (days < ahead + 20 ? 2 : 3)));
  { const doy = doyOf(sim.cal); if (seasonOf(doy) === 0 && doy < 25 && days < 12) push(Math.ceil(people.length / 3)); }
  const fo = need.find(q => q[0] === 'forage'); if (more > fo[1]) need.push(['forage', more - fo[1]]);   // a second entry, at the back of the queue
  return { need, n };
}
// everything that has gone into a project so far, the loads being fitted now included: all of it comes back
export function refundOf(p) {
  const L = {};
  for (const k in p.used || {}) if (p.used[k] > 0 && k !== 'dig' && k !== 'mark' && k !== 'test') L[k] = p.used[k];
  for (const k in p.out || {}) if (p.out[k] > 0) L[k] = (L[k] || 0) + p.out[k];   // parts a workshop made and still holds
  return L;
}
// the player changing who works where takes the crews back from the Seed
function handsOn(sim) {
  if (!sim.S.crewPlan) return;
  sim.S.crewPlan = false;
  sim.log('The Seed stopped planning the crews, because you changed them. Ask it again from the Crews window.');
}
export function planCrews(sim, why = '') {
  const S = sim.S, people = S.cols.filter(worker);
  if (!people.length) return '';
  const { need } = crewNeeds(sim), crewOf = c => c.crew >= 0 && !S.crews[c.crew].gone ? S.crews[c.crew].work : '';
  // building keeps at least a quarter of the colony while there is something to build, and never fewer than one
  // (a project stalled for parts nobody can make doesn't count: those hands are better spent on food)
  const building = active(S).some(p => !p.paused && p.type !== 'test' && !p.stall);
  let room = people.length - (building ? Math.max(1, Math.ceil(people.length / 4)) : 1);
  const free = new Set(people), want = {};
  for (const [w, k] of need) {
    for (let i = 0; i < k && room > 0; i++) {
      let best = null, bs = -1e9;
      for (const c of free) { const s = fitFor(c, w) - fitFor(c, 'build') + (crewOf(c) === w ? .12 : 0) + (w === 'clinic' && c.skills.medicine < MEDIC ? -9 : 0); if (s > bs) { bs = s; best = c; } }
      if (!best) break;
      free.delete(best); (want[w] = want[w] || []).push(best); room--;
    }
  }
  if (!building && free.size > 1) {   // nothing to build: everyone but one builder forages, which always helps
    const spare = [...free].sort((a, b) => (fitFor(b, 'forage') - fitFor(b, 'build')) - (fitFor(a, 'forage') - fitFor(a, 'build'))).slice(0, free.size - 1);
    for (const c of spare) { free.delete(c); (want.forage = want.forage || []).push(c); }
  }
  want.build = [...free];
  // keep the crews already doing each kind of work; turn crews nobody needs any more into new ones before making more
  const live = S.crews.filter(k => !k.gone), byWork = {};
  for (const k of live) if (want[k.work] && want[k.work].length) (byWork[k.work] = byWork[k.work] || []).push(k);
  const spare = live.filter(k => !byWork[k.work] || !byWork[k.work].includes(k));
  let moved = 0;
  for (const w in want) {
    if (!want[w].length) continue;
    if (!byWork[w]) {
      let k = spare.shift();
      if (k) { k.work = w; k.dest = -1; k.recalled = false; k.proj = -1; k.target = -1; for (const i of k.members) { S.cols[i].plan = ''; S.cols[i].noWork = 0; } }
      else { k = sim.newCrew(w); S.crews.push(k); }
      byWork[w] = [k];
    }
    const home = byWork[w][0];
    for (const c of want[w]) if (!byWork[w].some(k => k.id === c.crew)) { sim.addTo(c, home.id); moved++; }
  }
  for (const k of S.crews) if (!k.gone && !k.members.length) { k.gone = true; k.lead = -1; }
  for (const k of S.crews) if (!k.gone) k.lead = k.members.reduce((b, i) => b < 0 || S.cols[i].skills.leadership > S.cols[b].skills.leadership ? i : b, -1);
  S.rv++;
  const sum = Object.entries(want).filter(([, v]) => v.length).map(([w, v]) => `${v.length} ${WORK_NAME[w]}`).join(', ');
  if (moved || why === 'asked') sim.log(`The Seed planned the crews${why === 'morning' ? ' for the day' : ''}: ${sum}.${moved ? ` ${moved} ${moved === 1 ? 'person' : 'people'} changed crew.` : ' Nobody needed to move.'}`);
  return sum;
}

// ---------- a crew member's next job ----------
export function workNext(sim, c) {
  const cr = sim.S.crews[c.crew];
  if (!cr) return false;
  switch (cr.work) {
    case 'build': return buildNext(sim, c, cr);
    case 'survey': return surveyJoin(sim, c, cr);
    case 'quarry': return gatherNext(sim, c, 'stone');
    case 'timber': return gatherNext(sim, c, 'timber');
    case 'workshop': return benchNext(sim, c);
    case 'mine': return mineNext(sim, c);
    case 'forage': return forageNext(sim, c);
    case 'farm': return farmNext(sim, c);
    case 'kitchen': return kitchenNext(sim, c);
    case 'lab': return labNext(sim, c);
    case 'clinic': return clinicNext(sim, c);
    case 'teach': return roomNext(sim, c, 'school', 'teach', ACT.TEACH, () => pupilsOf(sim.S).length > 0);
    case 'keep': return roomNext(sim, c, 'library', 'keep', ACT.READ, () => libraryWork(sim.S));
    case 'watch': return patrolNext(sim, c);
    case 'care': if (playSpot(sim) < 0) return false; playAt(sim, c, 'mind'); return true;   // indoors with the children in hard cold
  }
  return false;
}
export const carryAct = k => k === 'stone' ? ACT.STONE : k === 'timber' ? ACT.LOG : k === 'food' || k === 'biomass' ? ACT.SACK : ACT.CARRY;
// loads on their way to a project, or being fitted
function inflight(S, p, k) { let n = 0; for (const o of S.cols) if (!o.dead && o.pj === p.id && o.want === k && FIT_JOBS.has(o.job)) n++; return n; }
const stockAt = (S, key, k) => key === 'yard' ? S.stores.yard[k] : key === 'cargo' ? S.stores.cargo[k] || 0 : ((byId(S, +key.slice(1)) || {}).out || {})[k] || 0;
function reserved(S, key, k) { let n = 0; for (const o of S.cols) if (!o.dead && o.srcKey === key && o.want === k && (o.job === 'fetch' || o.job === 'pick')) n++; return n; }

function buildNext(sim, c, cr) {
  const S = sim.S, p = cr.proj >= 0 ? byId(S, cr.proj) : null;
  if (!p || p.done || p.paused) return false;
  for (const k in p.need) {
    if (p.need[k] - (p.got[k] || 0) - inflight(S, p, k) <= 0) continue;
    if (k === 'dig' && p.type === 'shaft' && inflight(S, p, k) >= SHAFT_CREW) continue;   // room at the face for only a few
    if (LABOUR.has(k)) { fitJob(sim, c, p, k); return true; }
    for (const s of sources(sim, k)) if (stockAt(S, s.key, k) - reserved(S, s.key, k) > 0) {
      c.job = 'fetch'; c.want = k; c.pj = p.id; c.srcKey = s.key; sim.goTo(c, s.tile, ACT.IDLE); return true;
    }
    // nothing in the yard: a builder cuts the stone or fells the tree themselves and carries it straight to the site
    if (RAW.includes(k) && gatherJob(sim, c, k, p.id)) return true;
  }
  return false;
}
function fitJob(sim, c, p, k) {
  const spots = sim.spotsOf(p), spot = spots[(c.id * 7 + sim.S.stats.fits * 3) % spots.length];
  c.job = 'fit'; c.want = k; c.pj = p.id; c.spot = spot; c.fx = p.x + p.w / 2; c.fy = p.y + p.h / 2; c.where = -1;
  sim.goTo(c, spot, (p.below || (p.type === 'shaft' && k === 'dig')) && p.stage > 0 ? ACT.DIG : k === 'test' ? ACT.TEST : k === 'dig' || (p.type === 'field' && k === 'biomass') ? ACT.FARM : ACT.BUILD, c.carry ? carryAct(c.carry) : ACT.WALK);
}
// the nearest stone or timber nobody else is already cutting: a felled tree with logs left beats a standing one
function gatherJob(sim, c, k, pj) {
  const S = sim.S, W = sim.W, list = k === 'stone' ? sim.rocks : k === 'biomass' ? sim.scrub : sim.trees, claimed = new Set();
  for (const o of S.cols) if (!o.dead && o.job === 'cut' && o.src >= 0) claimed.add(o.src);
  let best = null, bs = 1e9;
  for (const e of list) {
    if (e.d - 15 > bs) break;
    if (claimed.has(e.src) || !W.cost[e.work]) continue;
    const g = S.gone[e.src], q = S.quarry[e.src] || 0;
    if (e.kind === 0 ? g === 0 : e.kind === 1 || e.kind === 3 ? g !== undefined || q >= 2 : q >= 30) continue;
    const s = e.d - (e.kind === 0 && g > 0 ? 15 : 0);
    if (s < bs) { bs = s; best = e; }
  }
  // a stone pit: cut from its face when it is nearer than what is left lying about, or when nothing else is
  if (k === 'stone') for (const p of built(S)) {
    if (p.type !== 'pit' || !(p.rock > 0)) continue;
    const src = -1 - p.id; let used = 0; for (const o of S.cols) if (!o.dead && o.job === 'cut' && o.src === src) used++;
    const t = sim.doorOf(p), d = Math.hypot(t % MAP - sim.yardTile % MAP, (t / MAP | 0) - (sim.yardTile / MAP | 0));
    if (used < capOf(p).faces && d < bs) { bs = d; best = { src, work: t, kind: 4 }; }
  }
  if (!best) return false;
  c.job = 'cut'; c.want = k; c.pj = pj; c.src = best.src; c.srcKind = best.kind; const ft = best.kind === 4 ? best.work : best.src; c.fx = ft % MAP + .5; c.fy = (ft / MAP | 0) + .5;
  sim.goTo(c, best.work, k === 'stone' ? ACT.QUARRY : k === 'biomass' ? ACT.GATHER : ACT.FELL);
  return true;
}
function gatherNext(sim, c, k) {
  const S = sim.S; let going = 0;
  for (const o of S.cols) if (!o.dead && o.pj === -1 && o.want === k && (o.job === 'cut' || o.job === 'drop')) going++;
  if (S.stores.yard[k] + going >= rawWanted(S, k)) return false;
  return gatherJob(sim, c, k, -1);
}
function benchNext(sim, c) {
  const S = sim.S;
  let ws = null;
  for (const p of built(S)) {
    if (p.type !== 'workshop' || !p.powered) continue;
    let used = 0; for (const o of S.cols) if (!o.dead && o.ws === p.id && o.make) used++;
    if (used < capOf(p).benches) { ws = p; break; }
  }
  if (!ws) return false;
  let k = nextOrder(sim);
  // with nothing to make, or no salvage to make it from, a bench smelts ore into metal
  if (!k || S.stores.yard.salvage < RECIPE[k].salvage) k = (S.stores.yard.ore || 0) >= SMELT.ore && S.stores.yard.salvage < METAL_WANT * 2 ? 'smelt' : null;
  if (!k) return false;
  c.job = 'salv'; c.make = k; c.ws = ws.id; c.want = ''; c.pj = -1;
  sim.goTo(c, sim.yardTile, ACT.IDLE);
  return true;
}
// ---------- foraging: biomass for made soil, food the Seed has tested, and samples of what it hasn't ----------
const FORAGE_R = 110;
function forageNext(sim, c) {
  const S = sim.S;
  let going = 0; for (const o of S.cols) if (!o.dead && o.want === 'biomass' && (o.job === 'cut' || o.job === 'drop' || o.job === 'bio')) going++;
  // the projects' biomass first, then food when the larder needs it, then the feedstock plant's
  const bio = plants => S.stores.yard.biomass + going < rawWanted(S, 'biomass', plants) - 6 && (patchJob(sim, c, 'bio') || gatherJob(sim, c, 'biomass', -1));
  if (bio(false)) return true;
  if (forageWanted(sim) && patchJob(sim, c, 'forage')) return true;
  if (bio(true)) return true;
  return patchJob(sim, c, 'sample');
}
// whether the larder needs more wild food: five days of meals beyond the rations, and in the last weeks before
// Deep cold, enough to see the cold through
function forageWanted(sim) {
  const S = sim.S, eaters = S.cols.filter(o => !o.dead).length, ahead = untilDeep(sim.cal);
  const want = eaters * (ahead > 0 && ahead <= 25 ? 22 : 5);
  return mealsInStore(sim, true) - S.food < want;
}
// the nearest patch worth the walk for this job, that nobody else is already heading for
function patchJob(sim, c, job) {
  const S = sim.S, F = S.F, W = sim.W, L = W.land, claimed = new Set();
  for (const o of S.cols) if (!o.dead && o.src >= 0 && (o.job === 'forage' || o.job === 'sample' || o.job === 'bio')) claimed.add(o.src);
  let best = -1, bd = 1e9;
  const list = sim.life.list, kitchen = hasKitchen(sim);
  // food that has to wait for the vats isn't worth gathering while more of it waits than they can get through
  const wait = { leach: 0, ferment: 0 }; for (const k in F.larder.raw) { const f = foodOf(sim, k); if (f && wait[f.proc] != null) wait[f.proc] += F.larder.raw[k]; }
  const full = { leach: wait.leach >= vatLimit(S, 'leach'), ferment: wait.ferment >= vatLimit(S, 'ferment') };
  for (let i = 0; i < list.length; i++) {
    const p = list[i], k = sim.kinds[p.o], Lf = F.life[p.o];
    if (!Lf.seen || claimed.has(i) || !W.reach[p.t] || !W.cost[p.t]) continue;
    if (Math.abs(p.x - L.x) > FORAGE_R || Math.abs(p.y - L.y) > FORAGE_R) continue;
    if (job === 'sample') { if (Lf.tested || Lf.queued || Lf.samples >= SAMPLES || F.sampled[i]) continue; }
    else if (job === 'forage') { if (!Lf.tested || !k.food || (!kitchen && k.food.proc !== 'cook') || full[k.food.proc] || !inSeason(sim, k) || patchLeft(sim, i) <= 0) continue; }
    else if (!Lf.tested || k.bio < 2 || k.food || patchLeft(sim, i) <= 0) continue;
    const d = Math.hypot(p.x - c.x, p.y - c.y) + Math.hypot(p.x - L.x, p.y - L.y) * .5;
    if (d < bd) { bd = d; best = i; }
  }
  if (best < 0) return false;
  const p = list[best];
  c.job = job; c.src = best; c.want = job === 'bio' ? 'biomass' : ''; c.pj = -1; c.fx = p.x; c.fy = p.y;
  sim.goTo(c, p.t, job === 'sample' ? ACT.SAMPLE : ACT.GATHER);
  return true;
}

// ---------- farming: sowing, harvesting, clearing what the frost killed ----------
function farmNext(sim, c) {
  const S = sim.S;
  for (const p of built(S)) {
    if (p.type !== 'field' || !p.crop) continue;
    const cr = p.crop; let busy = 0;
    for (const o of S.cols) if (!o.dead && o.pj === p.id && (o.job === 'sow' || o.job === 'reap' || o.job === 'clear')) busy++;
    if (cr.st === 'ripe') { if (cr.left == null) { cr.left = harvestLoads(p); cr.total = cr.left; } if (cr.left - busy > 0) return farmJob(sim, c, p, 'reap'); continue; }
    if (cr.st === 'dead') { if (!busy) return farmJob(sim, c, p, 'clear'); continue; }
    if (cr.st === 'bare') {
      const k = cropPlan(sim, p); if (!k) continue;
      if (cr.todo == null || cr.sowK !== k) { cr.todo = sowUnits(p); cr.sowK = k; }
      if (cr.todo - busy > 0) return farmJob(sim, c, p, 'sow');
    }
  }
  return false;
}
function farmJob(sim, c, p, k) {
  const spots = sim.spotsOf(p), spot = spots[(c.id * 5 + sim.S.stats.fits + sim.S.tick) % spots.length];
  c.job = k; c.pj = p.id; c.fx = p.x + p.w / 2; c.fy = p.y + p.h / 2;
  sim.goTo(c, spot, ACT.FARM);
  return true;
}

// ---------- the kitchen: cooking, and the vats where food is leached and fermented ----------
function kitchenNext(sim, c) {
  const S = sim.S, j = kitchenJob(sim, S.cols.filter(o => !o.dead).length);
  if (!j) return false;
  if (j.k === 'unvat') { const v = S.F.vats[j.v]; v.taken = S.tick; c.job = 'unvat'; c.vat = v.id; sim.goTo(c, sim.vatTile, ACT.COOK); return true; }
  c.job = 'kget'; c.food = j.src; c.from = j.from || 'raw'; c.next = j.k; c.pj = -1;
  sim.goTo(c, sim.cargoTile, ACT.IDLE);
  return true;
}

// ---------- the lab ----------
function labNext(sim, c) {
  const S = sim.S, F = S.F;
  if (F.lab.cur === -1 && !F.lab.queue.length) return false;
  for (const p of built(S)) {
    if (p.type !== 'lab' || !p.powered) continue;
    let used = 0; for (const o of S.cols) if (!o.dead && o.ws === p.id && o.job === 'lab') used++;
    if (used < capOf(p).benches) { c.job = 'lab'; c.ws = p.id; sim.goTo(c, p.door.y * MAP + p.door.x, ACT.BENCH); return true; }
  }
  return false;
}

// ---------- the clinic: medics wait there, ready, when nobody needs them ----------
function clinicNext(sim, c) {
  const p = built(sim.S).find(q => q.type === 'clinic' && q.powered);
  if (!p) return false;
  c.job = 'tend'; c.ws = p.id; sim.goTo(c, sim.doorOf(p), ACT.INDOORS); return true;
}

// ---------- the school and the library: an hour's work at a time, indoors ----------
function roomNext(sim, c, type, job, act, wanted) {
  const p = built(sim.S).find(q => q.type === type && !q.shut);
  if (!p || !wanted()) return false;
  c.job = job; c.ws = p.id; sim.goTo(c, sim.doorOf(p), act); return true;
}
// ---------- the watch by day: walking the edge of camp ----------
function patrolNext(sim, c) {
  const W = sim.W, L = W.land;
  if (!built(sim.S).some(p => p.type === 'watch' && !p.shut)) return false;
  for (let k = 0; k < 20; k++) {
    const a = rnd() * 6.283, r = 14 + rnd() * 16, x = Math.floor(L.x + Math.cos(a) * r), y = Math.floor(L.y + Math.sin(a) * r), t = y * MAP + x;
    if (W.reach[t] && W.cost[t] && W.cost[t] < 15) { c.job = 'patrol'; sim.goTo(c, t, ACT.WATCH); return true; }
  }
  return false;
}

// ---------- the mine: a load of ore cut at a face, carried up and piled in the yard ----------
export const DEEP_SUN = .55;   // what panels make in Deep cold, against a summer day
export const SMELT = { ore: 3, out: 2, h: 2 }, METAL_WANT = 30, MINE_H = 1.5;
function mineNext(sim, c) {
  const S = sim.S;
  for (const p of built(S)) {
    if (p.type !== 'mine' || !p.powered || !(p.seam > 0)) continue;
    let used = 0; for (const o of S.cols) if (!o.dead && o.ws === p.id && o.job === 'mine') used++;
    if (used < Math.min(capOf(p).faces, p.seam)) { c.job = 'mine'; c.ws = p.id; sim.goTo(c, sim.doorOf(p), ACT.DIG); return true; }
  }
  return false;
}
// whatever someone was carrying when called away goes back to the stores
export function dropCarry(sim, c) {
  const S = sim.S;
  if (c.carry === 'food') add(S.F.larder[c.from || 'raw'], c.food, 1);
  else if (c.carry === 'salvage' || c.carry === 'ore') S.stores.yard[c.carry] = (S.stores.yard[c.carry] || 0) + (c.cn || 0); else if (c.carry === 'biomass' && c.cn > 1) S.stores.yard.biomass += c.cn; else if (c.carry) putBack(S, c.carry);
  c.food = ''; c.from = '';
  c.carry = ''; c.cn = 0; c.make = ''; c.want = ''; c.pj = -1; c.src = -1; c.srcKey = '';
}
function eff(sim, c, kind = 'build') {
  const S = sim.S, cr = c.crew >= 0 ? S.crews[c.crew] : null, lead = cr && cr.lead >= 0 ? S.cols[cr.lead] : null, sk = c.skills;
  let e = kind === 'bench' ? .4 + sk.engineering * .07 : kind === 'cut' ? .55 + sk.building * .03 + sk.fieldcraft * .03 : kind === 'farm' ? .5 + sk.botany * .05 + sk.fieldcraft * .01
    : kind === 'cook' ? .5 + sk.cooking * .05 : kind === 'forage' ? .55 + sk.fieldcraft * .04 + sk.botany * .02 : kind === 'lab' ? .4 + sk.botany * .045 + sk.medicine * .03 : .45 + sk.building * .05 + sk.engineering * .025;
  if (c.fat > 75) e *= .7; if (c.chill > 35) e *= .85; if (c.unwell) e *= .85; if (c.fresh > 0) e *= .75; if (c.str > 65) e *= .85;
  if (c.cap) { const w = CAPW[kind] || CAPW.build; let f = 0; for (const k in w) f += w[k] * bodyCap(c, k); e *= f; }   // what the body can do
  if (c.traits.includes('reckless')) e *= 1.1; if (c.traits.includes('careful')) e *= .92;
  if (lead) e *= .85 + lead.skills.leadership * .03;
  return Math.max(.2, e);
}

// which capacities each kind of work leans on
const CAPW = { build: { manip: .5, carry: .3, move: .2 }, cut: { carry: .6, manip: .4 }, bench: { manip: .8, sight: .2 }, farm: { manip: .5, move: .5 }, cook: { manip: .8, sight: .2 }, forage: { move: .6, sight: .4 }, lab: { manip: .6, sight: .4 } };

// ---------- the projects: stages, crews, waiting, power, beds ----------
function fitted(sim, c) {
  const S = sim.S, p = byId(S, c.pj), k = c.want;
  if (!p || p.done || !(p.need[k] > (p.got[k] || 0))) { if (c.carry) putBack(S, c.carry); }
  else {
    p.got[k] = (p.got[k] || 0) + 1; S.stats.fits++;
    if (k === 'dig' && (p.below || p.type === 'shaft')) spoilOf(sim, p);
    if (k !== 'mark' && k !== 'test') p.used[k] = (p.used[k] || 0) + 1;
    if (Object.keys(p.need).every(q => (p.got[q] || 0) >= p.need[q])) advance(sim, p);
  }
  c.carry = ''; c.want = ''; c.pj = -1; c.job = ''; c.where = -1;
}
// what comes up the stairs as a room is dug: stone from stony ground, and ore where a seam runs through it
function spoilOf(sim, p) {
  const S = sim.S, g = p.ug || {};
  if (rnd() < (g.stone || 0) * .6) S.stores.yard.stone++;
  if (rnd() < (g.ore || 0) * .9) {
    S.stores.yard.ore = (S.stores.yard.ore || 0) + 1;
    if (!S.oreSeen) { S.oreSeen = 1; sim.log(`The diggers under ${p.name} struck a seam of metal ore. A workshop bench smelts it into salvage, and so does the Seed's fabricator when it has nothing else to make.${p.type === 'mine' ? '' : ' A mine dug along the seam would bring up far more.'}`, 'good', { e: 'ore', lvl: 1, pid: p.id, title: 'Ore' }); }
  }
}
function advance(sim, p) {
  const S = sim.S, st = p.stage;
  S.rv++;
  if (p.type === 'test') {
    if (st === 0) { p.stage = 1; p.got = {}; p.need = stageLoads(S, 'test', 1, 1, 1, p.mat); sim.log(`${p.name}: samples are at the rig. Testing them now.`); return; }
    const m = S.mat[p.mat], pct = Math.round((m.f - 1) * 100); m.tested = true; p.done = true; p.gone = true;
    sim.log(`Load test done: the local ${p.mat} is ${pct === 0 ? 'exactly as strong as' : Math.abs(pct) + '% ' + (pct > 0 ? 'stronger' : 'weaker') + ' than'} the databank's standard. Designs now use it with a measured margin instead of a guess.${p.mat === 'timber' ? ` Timber beams can span ${Math.floor(3 + 3 * m.f)} tiles before they need posts.` : ''}`, 'good', { e: 'tested', lvl: 2, x: p.x + .5, y: p.y + .5, title: `What the local ${p.mat} can carry` });
    trustAll(sim, 1, `Saw the Seed test the local ${p.mat} instead of guessing.`);
    return;
  }
  if (st === 0 && !p.below) { if (p.type !== 'shelter') clearPlot(sim, p); if (!p.blocked) sim.block(p); }
  p.stage++; p.got = {};
  if (p.stage >= 5) return finish(sim, p);
  p.need = loadsOf(S, p, p.stage);
  const names = stagesOf(p.type);
  sim.log(`${p.name}: ${names[st].toLowerCase()} done. Next: ${names[p.stage].toLowerCase()}.`, 'good', { pid: p.id });
  if (p.type === 'shelter') trustAll(sim, 2);
}
function finish(sim, p) {
  const S = sim.S; p.done = true; p.stage = 5; p.need = {}; S.rv++;
  powerCheck(sim);
  const cap = capOf(p), more = active(S).some(q => q.type !== 'test' && !q.paused);
  if (p.dmg) {   // a repair after a fire or a flood
    p.dmg = '';
    if (p.type === 'field') p.crop = { k: '', st: 'bare', g: 0, h: 1, want: 'auto', todo: null, sowK: '', left: null, total: 0, ripe: 0, sown: 0 };
    sim.log(`${p.name} is repaired and back in use.`, 'good', { e: 'repaired', lvl: 1, pid: p.id, title: 'Repaired' });
  } else if (p.type === 'shelter') {
    sim.log(`The shelter is finished: twelve bunks, walls and a roof made from the lander.${more ? '' : ' Nothing else is planned yet, so the build crew is free.'}`, 'good', { e: 'shelter', lvl: 2, pid: p.id, title: 'A roof at last' });
    trustAll(sim, 6, 'Slept under a roof again.');
  } else if (p.type === 'field') {
    p.crop = { k: '', st: 'bare', g: 0, h: 1, want: 'auto', todo: null, sowK: '', left: null, total: 0, ripe: 0, sown: 0 };
    const k = cropPlan(sim, p), soon = !k && cropWait(sim, p), farmers = S.crews.some(cr => !cr.gone && cr.work === 'farm' && cr.members.length);
    sim.log(`${p.name} is ready: ${cap.tiles} tiles of made soil.${k ? ` The Seed would sow ${CROPS[k].name.toLowerCase()}.` : soon ? ` The Seed will sow ${CROPS[soon.k].name.toLowerCase()} in about ${soon.days} day${soon.days === 1 ? '' : 's'}, when it is warm enough.` : ' Nothing in the seed bank could ripen before Deep cold now, so it stays bare until Thaw.'}${farmers ? '' : ' It needs a farm crew to sow and harvest it.'}`, 'good', { e: 'field', lvl: 1, pid: p.id, title: 'A field of made soil' });
    trustAll(sim, 2, `Watched ${p.name} being made out of bare local ground.`);
  } else {
    const what = { cellar: `cool storage for ${cap.store} loads of food`, burrow: `${cap.beds} bunks, warm under the ground`, dorm: `${cap.beds} bunks`, commons: `seats for ${cap.seats}`, workshop: `${cap.benches} bench${cap.benches > 1 ? 'es' : ''}`, clinic: `${cap.beds} beds`, solar: `${cap.panels} panels making ${cap.supply} kW`, lab: `${cap.benches} bench${cap.benches > 1 ? 'es' : ''}`,
      school: `desks for ${cap.desks} children`, library: `${cap.shelves} shel${cap.shelves > 1 ? 'ves' : 'f'} for the colony's records`, watch: 'a post with a lamp, for whoever keeps the night watch',
      nursery: `${cap.tanks} more growth tank${cap.tanks > 1 ? 's' : ''}`, shaft: 'the cage runs down to the middle and the deep. Rooms can be planned down there now: press U to go down a level at a time',
      vault: `room for ${cap.places} people deep in the rock, where a flare can't reach them`, scanner: `${cap.slots} scanning bed${cap.slots > 1 ? 's' : ''}: from tonight the Seed scans everyone who agrees, a few each night`, geo: `${cap.supply} kW from the hot rock, day and night` }[p.type] || 'ready for use';
    sim.log(`${p.name} is finished: ${what}.${p.type !== 'solar' && !p.powered ? ` It stays dark until the colony has ${shortOf(S, p)} kW more power.` : ''}`, 'good', { e: 'built', lvl: 1, pid: p.id, title: 'Finished' });
    trustAll(sim, 2, `Watched ${p.name} go up.`);
  }
  assignHomes(sim);
  if (!p.dmg) storyBuilt(sim, p);
}
// why a project isn't moving, or '' when there is work for a crew to do
// loads of stone still lying about near camp, in boulders and rock faces: for the bot, to plan a pit in time
export function stoneLeft(sim) {
  const S = sim.S; let n = 0;
  for (const e of sim.rocks) { if (!sim.W.cost[e.work]) continue; const g = S.gone[e.src], q = S.quarry[e.src] || 0; n += e.kind === 1 ? (g === undefined ? Math.max(0, 2 - q) : 0) : Math.max(0, 30 - q); }
  return n;
}
// is anything left to cut for this near camp: a rock or tree in reach, or a stone pit with stone in it
function sourceLeft(sim, k) {
  const S = sim.S, W = sim.W, list = k === 'stone' ? sim.rocks : k === 'biomass' ? sim.scrub : sim.trees;
  for (const e of list) {
    if (!W.cost[e.work]) continue;
    const g = S.gone[e.src], q = S.quarry[e.src] || 0;
    if (e.kind === 0 ? g !== 0 : e.kind === 1 || e.kind === 3 ? g === undefined && q < 2 : q < 30) return true;
  }
  return k === 'stone' && built(S).some(p => p.type === 'pit' && p.rock > 0);
}
function waitReason(sim, p) {
  const S = sim.S;
  if (p.paused) return 'Paused';
  if (p.fire) return 'On fire';
  if (p.shut === 'flood' || p.wetH) return 'Under water';
  if (p.done) return p.type !== 'solar' && !p.powered ? `Dark: needs ${shortOf(S, p)} kW more power` : '';
  let miss = null;
  for (const k in p.need) {
    const left = p.need[k] - (p.got[k] || 0); if (left <= 0) continue;
    if (LABOUR.has(k) || stockOf(S, k) > 0 || inflight(S, p, k) > 0 || (RAW.includes(k) && sourceLeft(sim, k))) return '';
    if (!miss) miss = [k, left];
  }
  if (!miss) return '';
  const [k, n] = miss;
  if (k === 'module') return 'Out of lander modules';
  if (k === 'rare') return `Needs ${n} rare earth${n === 1 ? '' : 's'}: miners bring them up from seams on the deep level`;
  if (k === 'stone') return 'Needs stone and there is none left to cut near camp: plan a stone pit on stony ground';
  if (RAW.includes(k)) return `Needs ${matName(k, n)} and there is none left to gather near camp`;
  if ((S.fab.job && S.fab.job.k === k) || S.cols.some(o => !o.dead && o.make === k)) return `Waiting for ${matName(k, n)}, being made`;
  if (S.stores.yard.salvage < RECIPE[k].salvage) return `Needs ${matName(k, n)} and there is no salvage left to make them${(S.stores.yard.ore || 0) >= SMELT.ore ? ': ore is waiting to be smelted' : built(S).some(q => q.type === 'mine' && q.seam > 0) ? ': the miners bring up ore to smelt' : ''}`;
  return `Waiting for ${matName(k, n)}`;
}
export function projectsThink(sim) {
  const S = sim.S, list = active(S), crews = S.crews.filter(cr => !cr.gone && cr.work === 'build' && cr.members.length);
  const why = new Map(list.map(p => [p.id, waitReason(sim, p)])), workable = list.filter(p => !why.get(p.id)), taken = new Set();
  // build crews take workable projects in list order, one each; spare crews double up on the first
  for (const cr of crews) {
    const p = workable.find(q => !taken.has(q.id)) || workable[0] || null, id = p ? p.id : -1;
    if (id !== cr.proj) { cr.proj = id; S.rv++; }
    if (p) taken.add(p.id);
  }
  for (const cr of S.crews) if (cr.work !== 'build' && cr.proj !== -1) cr.proj = -1;
  for (const p of S.projects) {
    if (p.gone) continue;
    let w = p.done ? waitReason(sim, p) : why.get(p.id);
    if (!p.done && !w && !taken.has(p.id)) w = crews.length ? 'Queued: the build crews are on other projects' : 'No build crew';
    const stuck = !p.done && !!w && !/^(Paused|Queued|No build crew)/.test(w);
    if (stuck && !S.salvOut && /no salvage left/.test(w)) { S.salvOut = 1; sim.log(`The salvage the Seed brought down is used up, and ${p.name} needs parts nobody can make without it. Metal has to come from this world now: plan a mine over a seam of ore (the Build window, then press U to see the seams), and a workshop to smelt what the miners bring up.`, 'bad', { e: 'nosalvage', lvl: 2, pid: p.id, title: 'Out of salvage' }); }
    if (stuck && !S.stoneOut && /^Needs stone and there is none/.test(w)) { S.stoneOut = 1; sim.log(`There is no stone left to cut near camp: the boulders and rock faces are used up, and ${p.name} needs more. Plan a stone pit in the Build window, on ground where stone lies under shallow soil (press U to see it), and the quarry crew will cut it there for years.`, 'bad', { e: 'nostone', lvl: 2, pid: p.id, title: 'Out of stone' }); }
    if (stuck && !p.stall) { p.stall = 1; sim.log(`${p.name} stalled: ${w[0].toLowerCase() + w.slice(1)}.`, 'bad', { e: 'stalled', lvl: 1, pid: p.id, title: 'A project stalled' }); }
    else if (!stuck && p.stall) { p.stall = 0; if (!p.done && !w) sim.log(`Work on ${p.name} picked up again.`, '', { pid: p.id }); }
    if (w !== p.wait) { p.wait = w; S.rv++; }
  }
  if (S.tick % HOUR < 120) { for (const p of powerCheck(sim)) powerNote(sim, p); assignHomes(sim); }
}
function powerNote(sim, p) {
  if (p.type === 'solar') return;
  if (p.powered) sim.log(`${p.name} has power.`, 'good', { pid: p.id }); else sim.log(`${p.name} went dark: the colony needs ${shortOf(sim.S, p)} kW more power.`, 'bad', { e: 'dark', lvl: 1, pid: p.id, title: 'Not enough power' });
}
// bunks in the shelter and the dormitories, and seats in the commons, for everyone they hold
export const HOMES = ['shelter', 'dorm', 'burrow'];
export function assignHomes(sim) {
  const S = sim.S, live = S.cols.filter(c => !c.dead), on = built(S).filter(p => (p.powered || (!p.shut && HOMES.includes(p.type))) && !(p.closed && HOMES.includes(p.type)));   // a dark bunkhouse still has its bunks; a closed one has none
  const fill = (types, key, capKey) => {
    const left = new Map(on.filter(p => types.includes(p.type)).map(p => [p.id, capOf(p)[capKey]]));
    const moved = [];
    for (const c of live) { const n = left.get(c[key]); if (n > 0) left.set(c[key], n - 1); else c[key] = -1; }
    for (const c of live) if (c[key] < 0) for (const [id, n] of left) if (n > 0) { c[key] = id; left.set(id, n - 1); moved.push(c); break; }
    return moved;
  };
  const moved = fill(HOMES, 'home', 'beds');
  fill(['commons'], 'mess', 'seats');
  for (const c of moved) if (c.home > 0) remember(sim, c, `Got a bunk in ${byId(S, c.home).name}.`);
  if (moved.length) { S.rv++; if (moved.some(c => c.home > 0)) sim.log(`${moved.length} ${moved.length === 1 ? 'person has' : 'people have'} a bunk indoors now.`); }
}
export const clinicFor = (S, c) => {
  for (const p of built(S)) {
    if (p.type !== 'clinic' || !p.powered) continue;
    let used = 0; for (const o of S.cols) if (o !== c && !o.dead && o.ward === p.id) used++;
    if (used < capOf(p).beds) return p;
  }
  return null;
};

// ---------- surveying ----------
export function surveyJoin(sim, c, cr) {
  if (cr.dest < 0) { c.job = 'survey'; sim.goTo(c, c.tile, ACT.IDLE); c.job = ''; return true; }   // the crew hasn't set out yet
  c.job = 'survey'; sim.goTo(c, spotNear(sim, cr.dest, cr.members.indexOf(c.id)), ACT.SURVEY); return true;
}
function spotNear(sim, dest, k) {
  const W = sim.W;
  if (k > 0) for (let tries = 0; tries < 12; tries++) { const a = k * 2.4 + tries, r = 1.5 + (k % 4) + tries * .3, x = (dest % MAP) + Math.round(Math.cos(a) * r), y = (dest / MAP | 0) + Math.round(Math.sin(a) * r), t = y * MAP + x; if (x > 0 && y > 0 && x < MAP && y < MAP && W.reach[t] && W.cost[t]) return t; }
  return dest;
}
// share of a spot's surroundings the Seed hasn't seen yet
function unknownAt(sim, x, y) { let u = 0; for (let j = -1; j <= 1; j++) for (let i = -1; i <= 1; i++) { const X = clamp(x + i * 8, 0, MAP - 1), Y = clamp(y + j * 8, 0, MAP - 1); if (!sim.known[Y * MAP + X]) u++; } return u / 9; }
export function crewThink(sim, cr) {
  if (cr.gone || cr.work !== 'survey') return;
  if (cr.wait > 0) { cr.wait--; return; }
  cr.wait = 15;
  const S = sim.S, W = sim.W, L = W.land, h = sim.hour, sh = SHIFTS[cr.shift];
  if (h < sh.a - .5) { cr.recalled = false; cr.dest = -1; return; }
  if (dayWeather(sim.W.seed, sim.cal).out && !cr.recalled) { cr.recalled = true; return; }   // nobody goes surveying in a storm
  const out = cr.members.map(i => S.cols[i]).filter(c => !c.dead && c.plan === 'work');
  if (!out.length) return;
  let px = 0, py = 0; for (const c of out) { px += c.x; py += c.y; } px /= out.length; py /= out.length;
  const dCamp = Math.hypot(px - L.x, py - L.y);
  // time to turn back, so as to be home by the end of the shift (or by dark, if that's the rule)
  const until = cr.rules.dark ? Math.min(sh.b, sim.dusk - .2) : sh.b;
  if (!cr.recalled && dCamp > 15 && h + dCamp * 1.3 / TPH + .25 >= until) { cr.recalled = true; return; }
  // nobody walks alone: if someone has to head back early, the freshest crewmate goes with them
  if (cr.rules.pairs) for (const i of cr.members) {
    const c = S.cols[i];
    if (c.dead || c.plan === 'work' || c.escort === sim.day || Math.hypot(c.x - L.x, c.y - L.y) < 20 || c.mv === 0) continue;
    if (out.some(o => o.escort === sim.day)) break;
    const comp = out.filter(o => o !== c).sort((a, b) => a.fat - b.fat)[0];
    if (comp) { comp.escort = sim.day; sim.log(`${comp.name} walked back with ${c.name}, so nobody went alone.`); }
    break;
  }
  const ready = out.every(c => c.mv === 0 && (c.act === ACT.SURVEY || c.act === ACT.IDLE || c.act === ACT.PLANT));
  if (!ready) return;
  const atSite = cr.dest >= 0 && out.every(c => c.act === ACT.SURVEY || c.act === ACT.PLANT);
  if (atSite && cr.siteLeft > 0) { cr.siteLeft -= 15; return; }
  // the next site: unseen ground, near where they are, within a day's walk of camp
  const left = until - h, maxR = clamp(TPH * (left - 1.8) / 2 * .85, 20, 280), from = cr.dest >= 0 ? { x: px, y: py } : { x: L.x, y: L.y };
  let dest = -1, best = 1e9;
  for (let k = 0; k < 40; k++) {
    let x, y;
    if (cr.target >= 0) { x = (cr.target % MAP) + (rnd() - .5) * 24; y = (cr.target / MAP | 0) + (rnd() - .5) * 24; }
    else { const a = rnd() * 6.283, r = cr.dest >= 0 ? 15 + rnd() * 45 : 25 + rnd() * maxR; x = from.x + Math.cos(a) * r; y = from.y + Math.sin(a) * r; }
    x = Math.floor(x); y = Math.floor(y); if (x < 2 || y < 2 || x >= MAP - 2 || y >= MAP - 2) continue;
    const t = y * MAP + x; if (!W.reach[t] || !W.cost[t] || W.type[t] === T.SHALLOW || W.type[t] === T.MARSH) continue;
    const dc = Math.hypot(x - L.x, y - L.y); if (dc > maxR && cr.target < 0) continue;
    const s = -unknownAt(sim, x, y) * 100 + Math.hypot(x - px, y - py) * .25 + (cr.target >= 0 ? 0 : dc * .05);
    if (s < best) { best = s; dest = t; }
  }
  if (dest < 0) { cr.wait = 120; return; }
  if (cr.dest < 0) { cr.trips++; S.stats.trips++; }
  cr.dest = dest; cr.siteLeft = ri(Math.round(1.2 * HOUR), Math.round(2.2 * HOUR));
  // the lead plants a sensor stake on fresh ground, if any are left
  const dx = dest % MAP, dy = dest / MAP | 0;
  const plant = S.seedc.stakes > 0 && Math.hypot(dx - L.x, dy - L.y) > 30 && S.stakes.every(s => Math.hypot(s.x - dx, s.y - dy) > 40) && !S.crews.some(k => k !== cr && k.dest >= 0 && Math.hypot((k.dest % MAP) - dx, (k.dest / MAP | 0) - dy) < 40);
  if (plant) S.seedc.stakes--;   // the stake leaves the lander with the crew
  out.forEach((c, k) => {
    const lead = c.id === cr.lead || (k === 0 && !out.some(o => o.id === cr.lead));
    c.job = lead && plant ? 'plant' : 'survey';
    sim.goTo(c, lead && plant ? dest : spotNear(sim, dest, k + 1), lead && plant ? ACT.PLANT : ACT.SURVEY); c.wait = k * 6;
  });
}

// ---------- arriving and finishing ----------
export function onArrive(sim, c) {
  const S = sim.S;
  switch (c.job) {
    case 'fetch': c.job = 'pick'; c.act = ACT.IDLE; c.timer = PICK; break;
    case 'fit': { const p = byId(S, c.pj); if (p && (p.below || p.type === 'shaft') && c.act === ACT.DIG) c.where = p.id; c.timer = Math.round(FIT_H[c.want] * HOUR / eff(sim, c)); break; }
    case 'cut': {
      const felled = c.srcKind === 0 && S.gone[c.src] > 0;
      c.timer = Math.round((felled ? .25 : c.srcKind === 0 ? .8 : c.srcKind === 3 ? .3 : .6) * HOUR / eff(sim, c, 'cut')); break;
    }
    case 'drop':
      if (c.carry in S.stores.yard) S.stores.yard[c.carry] += Math.max(1, c.cn || 0); else if (c.carry) putBack(S, c.carry);
      c.carry = ''; c.cn = 0; c.want = ''; c.job = ''; c.act = ACT.IDLE; break;
    case 'forage': case 'bio': c.timer = Math.round((c.job === 'bio' ? .5 : 2) * HOUR / eff(sim, c, 'forage')); break;
    case 'sample': c.timer = Math.round(.25 * HOUR); break;
    case 'store': add(S.F.larder.raw, c.food, 1); if (!isCrop(c.food)) S.stats.foraged = (S.stats.foraged || 0) + 1; c.carry = ''; c.food = ''; c.job = ''; c.act = ACT.IDLE; S.rv++; break;
    case 'sow': c.timer = Math.round(.5 * HOUR / eff(sim, c, 'farm')); break;
    case 'reap': c.timer = Math.round(.4 * HOUR / eff(sim, c, 'farm')); break;
    case 'clear': c.timer = Math.round(.6 * HOUR / eff(sim, c, 'farm')); break;
    case 'kget': c.act = ACT.IDLE; c.timer = PICK; break;
    case 'cook': c.timer = Math.round(HOUR / eff(sim, c, 'cook')); break;
    case 'vat': c.timer = Math.round(.5 * HOUR / eff(sim, c, 'cook')); break;
    case 'unvat': c.timer = Math.round(.4 * HOUR); break;
    case 'lab': c.where = c.ws; c.timer = HOUR; break;
    case 'teach': case 'keep': c.where = c.ws; c.timer = HOUR; break;
    case 'school': c.where = c.ws; c.sch = sim.day; break;
    case 'held': c.where = c.ws; break;
    case 'patrol': c.timer = Math.round(HOUR * (.6 + rnd() * .8)); break;
    case 'salv': c.job = 'salvpick'; c.act = ACT.IDLE; c.timer = PICK; break;
    case 'bench': c.where = c.ws; c.timer = Math.round((c.make === 'smelt' ? SMELT.h : RECIPE[c.make].h) * HOUR / eff(sim, c, 'bench')); break;
    case 'mine': { const p = byId(S, c.ws); if (p) c.where = p.id; c.timer = Math.round(MINE_H * HOUR / eff(sim, c, 'cut')); break; }
    case 'plant': c.timer = Math.round(HOUR / 6); break;
    case 'fire': c.timer = FIRE_STEP; break;
    case 'defend': c.timer = 20; break;
    case 'ctl': c.job = ''; c.act = ACT.IDLE; if (c.ord && c.ord.k === 'go') { c.ord.k = 'hold'; c.ord.t = c.tile; } break;   // there, or as near as they could get
    case 'mind': if (c.plan === 'work') c.timer = Math.round(HOUR * (.5 + rnd())); break;
    case 'eat':
      if (c.act === ACT.INDOORS) c.where = c.mess;
      if (c.ate !== sim.day && c.life < 3 && (c.owe = (c.owe || 0) + portion(c)) < 1) { c.ate = sim.day; c.hungry = false; break; }   // a child's share is smaller
      if (c.ate !== sim.day && giveWay(sim, c)) { c.ate = sim.day; c.hungry = true; c.meal = ''; if (c.life < 3) c.owe -= 1; if (!(sim.day - (c.gaveD ?? -99) < 10)) remember(sim, c, 'Went without supper so the others could eat, as the rule says.'); c.gaveD = sim.day; break; }   // the rule on short food puts others first
      if (c.ate !== sim.day) {
        if (c.life < 3) c.owe -= 1;
        c.ate = sim.day;
        const had = S.food >= 1, got = eat(sim, c);
        if (had && S.food < 1 && !S.F.rationsOut) { S.F.rationsOut = true; sim.log('The last of the lander’s rations was eaten tonight. From now on the colony lives on what it grows and gathers.', 'bad', { e: 'rations', lvl: 1, x: sim.W.site.cargo.x + .5, y: sim.W.site.cargo.y + .5, title: 'The rations are gone' }); }
        if (got) { c.meal = got; c.hungry = false; S.noFood = false; if (got !== 'ration') S.stats.meals++; illMeal(sim, c, c.act === ACT.INDOORS && c.mess >= 0 ? 'm' + c.mess : 'fire', got); }
        else { if (!S.noFood) { S.noFood = true; sim.log('There is nothing left to eat. From tonight people go to bed hungry, and the hungry weaken day by day until they die.', 'bad', { e: 'nofood', lvl: 2, x: sim.W.site.fire.x, y: sim.W.site.fire.y, title: 'Nothing left to eat' }); } if (!c.hungry) sim.log(`${c.name} went to bed hungry: there is nothing left to eat.`, 'bad', { who: c.id }); c.hungry = true; c.meal = ''; }
      }
      break;
    case 'sleep': case 'ward': if (c.act === ACT.INSIDE || c.act === ACT.INDOORS) c.where = c.ward >= 0 ? c.ward : c.home >= 0 && byId(S, c.home) && !byId(S, c.home).shut ? c.home : c.warmAt ?? -1; break;
    case 'warm': if (c.act === ACT.INDOORS) c.where = c.warmAt; break;
    case 'shelter': if (c.act === ACT.INDOORS || c.act === ACT.INSIDE) c.where = c.warmAt; break;
    case 'aid': case 'treat': case 'carry': careArrive(sim, c); break;
    case 'tend': c.where = c.ws; c.timer = HOUR; break;
    case 'wake': break;
  }
}
export function onTimer(sim, c) {
  const S = sim.S;
  switch (c.job) {
    case 'pick':
      if (takeFrom(S, c.srcKey, c.want)) { c.carry = c.want; c.srcKey = ''; const p = byId(S, c.pj); if (p && !p.done) fitJob(sim, c, p, c.want); else { putBack(S, c.carry); c.carry = ''; c.job = ''; } }
      else { c.job = ''; c.want = ''; c.pj = -1; c.srcKey = ''; }
      break;
    case 'fit': fitted(sim, c); if (c.plan === 'work') workNext(sim, c); break;
    case 'cut': {
      const k = c.want, t = c.src;
      if (c.srcKind === 4) {   // a load from a stone pit's face
        const p = byId(S, -1 - t); if (!p || !(p.rock > 0)) { c.job = ''; break; }
        p.rock--; S.stats.quarried++; S.rv++;
        if (!p.rock) sim.log(`${p.name} is cut out: the stone left in it is too deep to reach. Plan another pit on stony ground.`, 'bad', { e: 'pitout', lvl: 1, pid: p.id, title: 'A stone pit is used up' });
      } else if (c.srcKind === 3) { if (S.gone[t] !== undefined) { c.job = ''; break; } sim.setGone(t, 0); }
      else if (c.srcKind === 0) {
        if (S.gone[t] === undefined) { sim.setGone(t, 2); S.stats.felled++; }
        if (!(S.gone[t] > 0)) { c.job = ''; break; }
        sim.setGone(t, S.gone[t] - 1);
      } else {
        const q = (S.quarry[t] || 0) + 1; sim.setQuarry(t, q); S.stats.quarried++;
        if (c.srcKind === 1 && q >= 2) sim.setGone(t, 0);
      }
      c.carry = k; c.src = -1;
      const p = c.pj >= 0 ? byId(S, c.pj) : null;
      if (p && !p.done && p.need[k] > (p.got[k] || 0)) fitJob(sim, c, p, k);
      else { c.pj = -1; c.job = 'drop'; sim.goTo(c, sim.yardTile, ACT.IDLE, carryAct(k)); }
      break;
    }
    case 'salvpick': {
      const ore = c.make === 'smelt', n = ore ? SMELT.ore : RECIPE[c.make].salvage, ws = byId(S, c.ws), k = ore ? 'ore' : 'salvage';
      if (ws && (S.stores.yard[k] || 0) >= n) { S.stores.yard[k] -= n; c.carry = k; c.cn = n; c.job = 'bench'; sim.goTo(c, ws.door.y * MAP + ws.door.x, ACT.BENCH, ACT.CARRY); }
      else { c.job = ''; c.make = ''; }
      break;
    }
    case 'bench': {
      const ws = byId(S, c.ws);
      if (c.make === 'smelt') {
        S.stores.yard.salvage += SMELT.out; S.stats.refined = (S.stats.refined || 0) + SMELT.out;
        S.stats.smelted = (S.stats.smelted || 0) + 1;
        if (S.stats.smelted === 1) sim.log(`${c.name} smelted the colony's first metal from local ore at a workshop bench. Parts no longer have to come from what the Seed brought down.`, 'good', { e: 'smelted', lvl: 1, who: c.id, title: 'Metal from local ore' });
        c.carry = ''; c.cn = 0; c.make = ''; c.job = ''; c.where = -1; c.act = ACT.IDLE;
        break;
      }
      if (ws) ws.out[c.make] = (ws.out[c.make] || 0) + 1; else S.stores.cargo[c.make]++;
      if (!S.stats.made++) sim.log(`${c.name} made the colony's first ${MAT_ONE[c.make]} at a workshop bench.`, 'good', { e: 'made', lvl: 1, who: c.id, title: 'Made here, not salvaged' });
      c.carry = ''; c.cn = 0; c.make = ''; c.job = ''; c.where = -1; c.act = ACT.IDLE;
      break;
    }
    case 'mine': {
      const p = byId(S, c.ws); c.where = -1;
      if (!p || !(p.seam > 0)) { c.job = ''; break; }
      p.seam--; S.stats.mined = (S.stats.mined || 0) + 1; S.rv++;
      if (p.seam === 30 && !S.projects.some(q => !q.gone && q.type === 'mine' && q.seam > 30)) sim.log(`${p.name} is nearly worked out: about 30 loads of ore are left in its seam. Plan the next mine over another seam now, so it is dug before this one runs dry.`, 'bad', { e: 'mineLow', lvl: 1, pid: p.id, title: 'A mine is running out' });
      if (!p.seam) sim.log(`${p.name} is worked out: the seam under it is exhausted. To keep the colony in metal, plan a new mine over another seam (press U to see them).`, 'bad', { e: 'workedout', lvl: 1, pid: p.id, title: 'A mine is worked out' });
      // in the deep, some of what comes up is rare earths
      const rare = p.rare > 0 && rnd() < p.rare / (p.seam + p.rare);
      if (rare) { p.rare--; p.seam++; if (!S.rareSeen) { S.rareSeen = 1; sim.log(`The miners in ${p.name} brought up the colony's first load of rare earths, from a thin vein in the deep seam. The yard keeps them: a scanner's imaging magnets need them.`, 'good', { e: 'rare', lvl: 1, pid: p.id, title: 'Rare earths' }); } }
      c.carry = rare ? 'rare' : 'ore'; c.cn = 1; c.job = 'drop'; sim.goTo(c, sim.yardTile, ACT.IDLE, ACT.STONE);
      break;
    }
    case 'plant': {
      const s = { x: c.x, y: c.y, day: sim.day }; S.stakes.push(s); sim.reveal(c.x, c.y, 22); S.rv++;
      const cr = S.crews[c.crew], all = S.stakes.length >= STAKES_ALL; sim.log(`The ${cr ? cr.name : ''} crew planted sensor stake ${S.stakes.length} of ${STAKES_ALL}.${all ? ' The Seed now watches the whole ring of stakes.' : ''}`, '', all ? { e: 'stakes', lvl: 1, x: s.x, y: s.y, title: 'Every sensor stake is out' } : { x: s.x, y: s.y });
      c.job = 'survey'; c.act = ACT.SURVEY; break;
    }
    case 'wake': c.act = ACT.IDLE; c.plan = ''; c.job = ''; break;
    case 'forage': case 'bio': {
      const i = c.src, pt = sim.life.list[i];
      if (pt && patchLeft(sim, i) > 0) {
        takePatch(sim, i); S.rv++;
        if (c.job === 'bio') { c.carry = 'biomass'; c.cn = sim.kinds[pt.o].bio; c.job = 'drop'; c.src = -1; sim.goTo(c, sim.yardTile, ACT.IDLE, ACT.SACK); }
        else { c.carry = 'food'; c.food = keyOf(pt.o); c.from = 'raw'; c.job = 'store'; c.src = -1; sim.goTo(c, sim.cargoTile, ACT.IDLE, ACT.SACK); }
      } else { c.job = ''; c.src = -1; }
      break;
    }
    case 'sample': {
      const i = c.src, pt = sim.life.list[i], F = S.F, L = pt && F.life[pt.o];
      if (L && !L.tested && !L.queued && L.samples < SAMPLES && !F.sampled[i]) {
        F.sampled[i] = 1; L.samples++; S.rv++;
        if (L.samples === SAMPLES) sim.log(`Samples of ${sim.kinds[pt.o].name.toLowerCase()} are ready to test: ${c.name} took the third.`, 'good', { e: 'samples', lvl: 1, who: c.id, title: 'Ready to test' });
      }
      c.job = ''; c.src = -1; c.act = ACT.IDLE; break;
    }
    case 'sow': case 'reap': case 'clear': {
      const p = byId(S, c.pj), cr = p && p.crop; c.pj = -1; c.act = ACT.IDLE;
      const job = c.job; c.job = '';
      if (!cr) break;
      S.rv++;
      if (job === 'clear' && cr.st === 'dead') { cr.st = 'bare'; cr.g = 0; cr.h = 1; cr.left = null; }
      else if (job === 'sow' && cr.st === 'bare' && cr.todo > 0) {
        if (--cr.todo <= 0) {
          Object.assign(cr, { st: 'grow', k: cr.sowK, g: 0, h: 1, sown: sim.day, todo: null, left: null });
          const c0 = CROPS[cr.k], first = !S.stats.sown; S.stats.sown = (S.stats.sown || 0) + 1;
          sim.log(`${p.name} is sown with ${c0.name.toLowerCase()}.`, 'good', first ? { e: 'sown', lvl: 1, pid: p.id, title: 'The first crop is in' } : { pid: p.id });
        }
      } else if (job === 'reap' && cr.st === 'ripe' && cr.left > 0) {
        cr.left--; c.carry = 'food'; c.food = cr.k; c.from = 'raw'; c.job = 'store'; sim.goTo(c, sim.cargoTile, ACT.IDLE, ACT.SACK);
        if (cr.left <= 0) {
          const c0 = CROPS[cr.k], first = !S.F.firstHarvest; S.F.firstHarvest = true; S.stats.harvests++;
          sim.log(`${p.name}: the ${c0.name.toLowerCase()} are in, ${cr.total} sacks, about ${cr.total * 4} meals.`, 'good', first ? { e: 'harvest', lvl: 2, pid: p.id, title: 'The first harvest' } : { e: 'harvested', lvl: 1, pid: p.id, title: 'Harvest' });
          if (first) trustAll(sim, 5, 'Ate food grown on this world for the first time.');
          Object.assign(cr, { st: 'bare', g: 0, h: 1, left: null, todo: null });
        }
      }
      break;
    }
    case 'kget': {
      const Ld = S.F.larder[c.from];
      if (Ld && Ld[c.food] >= 1) { Ld[c.food]--; if (Ld[c.food] < .05) delete Ld[c.food]; c.carry = 'food'; c.job = c.next; sim.goTo(c, c.next === 'cook' ? sim.cookTile : sim.vatTile, ACT.COOK, ACT.SACK); }
      else { c.job = ''; c.food = ''; }
      break;
    }
    case 'cook': {
      const f = foodOf(sim, c.food);
      if (f) { add(S.F.larder.meals, c.food, cookMeals(f, c.skills.cooking, false)); S.rv++; }
      c.carry = ''; c.food = ''; c.from = ''; c.job = ''; c.act = ACT.IDLE; break;
    }
    case 'vat': {
      const f = foodOf(sim, c.food), F = S.F;
      if (f) {
        const v = F.vats.find(q => q.src === c.food && q.n < VAT_LOADS && q.start > S.tick - VAT_FILL);
        if (v) v.n++; else if (F.vats.length >= vatsFor(S)) add(F.larder.raw, c.food, 1);   // someone else filled the last one first: back in the larder
        else { F.vid = (F.vid || 0) + 1; F.vats.push({ id: F.vid, src: c.food, n: 1, proc: f.proc, start: S.tick, ready: S.tick + PROC_DAYS[f.proc] * DAY_TICKS, taken: 0 }); }
        S.rv++;
      }
      c.carry = ''; c.food = ''; c.from = ''; c.job = ''; c.act = ACT.IDLE; break;
    }
    case 'unvat': {
      const F = S.F, i = F.vats.findIndex(q => q.id === c.vat), v = F.vats[i];
      if (v) {
        const f = foodOf(sim, v.src); F.vats.splice(i, 1); S.rv++;
        if (f && v.proc === 'leach') add(F.larder.prep, v.src, v.n);
        else if (f) add(F.larder.meals, v.src, v.n * cookMeals(f, c.skills.cooking, false));
      }
      c.job = ''; c.vat = 0; c.act = ACT.IDLE; break;
    }
    case 'lab': labHour(sim, eff(sim, c, 'lab')); c.job = ''; c.where = -1; c.ws = -1; c.act = ACT.IDLE; break;
    case 'aid': case 'treat': careTimer(sim, c); break;
    case 'tend': c.job = ''; c.where = -1; c.ws = -1; break;
    case 'teach': c.taught = sim.day; if (rnd() < .3) { c.skills.teaching = Math.min(10, Math.round((c.skills.teaching + .01) * 1000) / 1000); c.pr |= BIT.teaching; } c.job = ''; c.where = -1; c.ws = -1; break;
    case 'keep': keepHour(sim, c); c.job = ''; c.where = -1; c.ws = -1; break;
    case 'patrol': c.job = ''; break;
    case 'fire': beat(sim, c); c.job = ''; if (!(c.fight > 0)) c.plan = ''; break;
    case 'defend': c.job = ''; if (!(c.def >= 0)) c.plan = ''; break;
    case 'ctl': c.job = ''; break;
    case 'mind': c.job = ''; break;
  }
}
const MAT_ONE = { seal: 'airlock seal', pipe: 'pipe run', power: 'power unit', panel: 'solar panel' };

// ---------- the player's commands ----------
// power every planned and finished building will draw, against what the lander and every solar field will make
// ---------- the Seed's suggested size for a new building, from what the colony needs ----------
// The smallest plot, close to square, that holds what is needed; the reason comes with it.
export function sizeFor(sim, type) {
  const S = sim.S, T0 = TYPES[type]; if (!T0 || T0.fixed) return null;
  const alive = S.cols.filter(c => !c.dead).length, coming = (S.seedc.printing ? 1 : 0) + Math.max(S.seedc.queue.length, S.seedc.feed), soon = alive + coming;
  const mine = S.projects.filter(p => !p.gone && p.type !== 'test'), sumOf = (types, k) => mine.filter(p => types.includes(p.type)).reduce((a, p) => a + (capacity(p.type, p.w, p.h)[k] || 0), 0);
  const fit = (want, key, sq = 3) => {
    let best = null;
    for (let w = T0.min; w <= T0.max; w++) for (let h = T0.min; h <= T0.max; h++) {
      if (Math.abs(w - h) > sq) continue;
      const v = capacity(type, w, h)[key] || 0, ok = v >= want, sc = ok ? w * h + Math.abs(w - h) * .1 : 1e6 - v * 100 + w * h;
      if (!best || sc < best.sc) best = { w, h, v, ok, sc };
    }
    return best;
  };
  const n = (k, a, b) => `${k} ${k === 1 ? a : b}`;
  let r, why;
  switch (type) {
    case 'dorm': case 'burrow': {
      const beds = sumOf(['shelter', 'dorm', 'burrow'], 'beds'), short = soon + 2 - beds;
      r = fit(Math.max(4, short), 'beds');
      why = `${n(r.v, 'bunk', 'bunks')}. ` + (short > 0 ? `There are ${n(soon, 'person', 'people')} awake or on the way and ${n(beds, 'bunk', 'bunks')} built or planned, so this gives everyone one, with two to spare` : `Everyone already has a bunk, so this is room for more people`);
      break;
    }
    case 'commons': {
      const seats = sumOf(['commons'], 'seats'), want = Math.max(6, soon + 4 - seats);
      r = fit(want, 'seats'); why = `${n(r.v, 'seat', 'seats')}${seats ? `, beside the ${seats} already built or planned` : ''}, so the ${n(soon, 'person', 'people')} awake or on the way can all eat indoors, with room to grow`;
      break;
    }
    case 'field': {
      const eaters = Math.max(1, soon), want = clamp(Math.ceil(Math.max(6, eaters) * 4), 25, 64);
      r = fit(want, 'tiles', 2);
      why = `${r.v} tiles: about ${r.v * CROPS.potato.yield} meals a harvest of potatoes, ${Math.round(r.v * CROPS.potato.yield / eaters)} days of food for ${n(eaters, 'person', 'people')}. Plan more fields as the colony grows`;
      break;
    }
    case 'clinic': { r = fit(Math.max(2, Math.ceil(soon / 5)), 'beds'); why = `${n(r.v, 'bed', 'beds')}, about one for every five people`; break; }
    case 'workshop': { r = fit(soon >= 15 ? 3 : 2, 'benches'); why = `${n(r.v, 'bench', 'benches')}, enough to keep the projects in parts`; break; }
    case 'lab': { r = fit(1, 'benches'); why = 'One bench, which tests samples far faster than the Seed’s own analyser'; break; }
    case 'mine': { r = fit(2, 'faces'); why = 'Two faces for the miners to work. Draw it over a seam of ore: the view below ground shows where they run'; break; }
    case 'pit': { r = fit(4, 'faces'); why = `${n(r.v, 'face', 'faces')} for the quarry crew to cut, about ${PIT_ROCK * r.w * r.h} loads of stone. Draw it where stone lies under shallow soil: the view below ground shows where`; break; }
    case 'school': { const kids = S.cols.filter(c => !c.dead && c.life >= 1 && c.life <= 2).length; r = fit(Math.max(8, kids + 4), 'desks'); why = `${n(r.v, 'desk', 'desks')}: room for the ${n(kids, 'child', 'children')} aged two to twelve now, as they reach school age, and a few more`; break; }
    case 'library': { r = fit(4, 'shelves'); why = `${n(r.v, 'shelf', 'shelves')} and a terminal: room to write down the best of what everyone knows`; break; }
    case 'watch': { r = fit(1, 'posts'); why = 'One post with a lamp, for whoever keeps the watch at night'; break; }
    case 'nursery': { r = fit(2, 'tanks'); why = `${n(r.v, 'tank', 'tanks')} more for children, beside the Seed’s own two`; break; }
    case 'shaft': { r = fit(3, 'levels'); why = 'A shaft three tiles across is enough for a cage and a ladder beside it'; break; }
    case 'vault': { r = fit(Math.max(20, soon), 'places'); why = `Room for ${n(r.v, 'person', 'people')} to shelter on a flare day: everyone the colony has now and will soon`; break; }
    case 'scanner': { r = fit(Math.min(3, Math.max(1, Math.ceil(soon / 40))), 'slots'); why = `${n(r.v, 'bed', 'beds')}: each scans three people a night, so everyone is scanned well within a season`; break; }
    case 'geo': { r = fit(8, 'supply', 2); why = `About ${r.v} kW, day and night and in every season`; break; }
    case 'plant': { r = fit(2, 'tanks'); why = `${n(r.v, 'tank', 'tanks')}: a new body about every ${Math.round(FEED.per * FEED.h / 24 / r.v)} days, with biomass and stone to feed it`; break; }
    case 'solar': {
      // sized for the short days of Deep cold, when panels make about half what they do in summer
      const supply = LANDER_KW + sumOf(['solar'], 'supply') * DEEP_SUN + sumOf(['geo'], 'supply'), draw = sumOf(mine.map(p => p.type).filter(t => t !== 'solar'), 'kw'), short = draw - supply;
      r = fit(Math.max(4, Math.ceil((Math.max(0, short) + 1) / (PANEL_KW * DEEP_SUN))), 'panels', 4);
      why = short > 0 ? `in Deep cold the buildings built and planned would draw ${draw.toFixed(1)} kW against ${supply.toFixed(1)} kW: ${r.v} panels make up the ${short.toFixed(1)} kW short even then, with a little to spare` : `${r.v} panels add ${(r.v * PANEL_KW).toFixed(1)} kW to spare in summer, about half that in Deep cold`;
      break;
    }
    case 'cellar': {
      const Ld = S.F.larder; let loads = 0; for (const g of [Ld.raw, Ld.prep, Ld.meals]) for (const k in g) loads += g[k];
      const room = sumOf(['cellar'], 'store'); r = fit(Math.max(alive * 4, Math.ceil(loads * 1.5) - room, 20), 'store');
      why = `Room for ${r.v} loads of food, more than the larder holds now`;
      break;
    }
    default: { const [w, h] = T0.size; return { w, h, why: '' }; }
  }
  why = why.replace(/^./, m => m.toUpperCase());
  return { w: r.w, h: r.h, why: why + '.' + (r.ok ? '' : ' That is the most one building can hold: plan another for the rest.') };
}
function powerPlan(S) {
  let supply = LANDER_KW, draw = 0;
  for (const p of S.projects) { if (p.gone || p.type === 'test') continue; const c = capOf(p); if (p.type === 'solar') supply += c.supply * S.F.sun; else if (p.type === 'geo') supply += c.supply; else draw += c.kw; }
  return { supply: +supply.toFixed(1), draw: +draw.toFixed(1) };
}
export function command(sim, m) {
  const S = sim.S, cr = m.crew != null ? S.crews[m.crew] : null, p = m.id != null ? byId(S, m.id) : null;
  switch (m.op) {
    case 'print':
      for (const fid of m.ids) { const q = S.archive[fid]; if (q && q.woke == null && !S.seedc.queue.includes(fid) && !(S.seedc.printing && S.seedc.printing.fid === fid)) S.seedc.queue.push(fid); }
      S.rv++; break;
    case 'unqueue': S.seedc.queue = S.seedc.queue.filter(f => f !== m.fid); S.rv++; break;
    case 'suggest': return suggestFirst(S.archive, Math.max(1, S.seedc.feed));
    case 'crewPlan': S.autoCrews = false; S.crewPlan = m.keep !== false; planCrews(sim, 'asked'); S.rv++; break;
    case 'crewKeep': S.crewPlan = !!m.on; S.rv++; break;
    case 'birthRule': return setRule(sim, 'children', m.v);
    case 'shiftAll': return setRule(sim, 'hours', clamp(m.shift | 0, 0, SHIFTS.length - 1));
    case 'rule': return RULES[m.k] ? setRule(sim, m.k, m.v) : false;
    case 'ask': return RULES[m.k] ? askCouncil(sim, m.k, m.v) : false;
    case 'ruleKeep': if (S.soc.verdict) { S.soc.verdict = null; S.rv++; } return true;
    case 'crewNew': { handsOn(sim); const k = sim.newCrew(m.work && WORKS[m.work] ? m.work : 'rest'); S.crews.push(k); S.autoCrews = false; S.rv++; return k.id; }
    case 'crewDel': if (cr) { handsOn(sim); for (const i of cr.members.slice()) sim.addTo(S.cols[i], -1); cr.gone = true; cr.members = []; cr.lead = -1; S.autoCrews = false; S.rv++; } break;
    case 'crewSet':
      if (!cr) break;
      if (m.work && WORKS[m.work] && m.work !== cr.work) { handsOn(sim); cr.work = m.work; cr.dest = -1; cr.recalled = false; cr.proj = -1; for (const i of cr.members) { S.cols[i].plan = ''; S.cols[i].noWork = 0; } }
      if (m.shift != null) cr.shift = clamp(m.shift | 0, 0, SHIFTS.length - 1);
      if (m.lead != null && cr.members.includes(m.lead)) cr.lead = m.lead;
      if (m.rule) cr.rules[m.rule] = !!m.on;
      if (m.target !== undefined) { cr.target = m.target; cr.dest = -1; }
      S.autoCrews = false; S.rv++; break;
    case 'move': { const c = S.cols[m.person]; if (c && !c.dead && c.life >= 3 && c.crew !== m.crew) { handsOn(sim); sim.addTo(c, m.crew); S.autoCrews = false; } break; }
    // ---- building ----
    case 'plan': {
      if (!TYPES[m.type] || TYPES[m.type].fixed) return { ok: false, why: 'That is not something the colony can plan.' };
      const chk = checkPlot(sim, m.type, m.x, m.y, m.w, m.h, m.side, m.lvl), cap = capacity(m.type, m.w, m.h), pw = powerPlan(S);
      const after = { supply: +(pw.supply + (cap.supply || 0)).toFixed(1), draw: +(pw.draw + cap.kw).toFixed(1) };
      return { ...chk, bill: billOf(S, m.type, m.w, m.h, chk.ground), load: loadCheck(S, m.type, m.w, m.h), cap, power: after, short: +Math.max(0, after.draw - after.supply).toFixed(1), site: storyPlot(sim, m.x, m.y, m.w, m.h) };
    }
    case 'sizeFor': return sizeFor(sim, m.type);
    case 'place': {
      const chk = checkPlot(sim, m.type, m.x, m.y, m.w, m.h, m.side, m.lvl);
      if (!chk.ok) return { ok: false, why: chk.why };
      const q = addProject(sim, m.type, m.x, m.y, m.w, m.h, m.side, undefined, m.lvl);
      if (m.save) saveBlueprint(S, m.save, m.type, m.w, m.h);
      sim.log(`Planned ${q.name}. The Seed laid out the inside: ${planNote(q)}.`);
      projectsThink(sim);
      return { ok: true, id: q.id };
    }
    case 'projMove': {
      if (!p) break;
      const L = S.projects, i = L.indexOf(p); let j = i + (m.d < 0 ? -1 : 1);
      while (j >= 0 && j < L.length && L[j].gone) j += m.d < 0 ? -1 : 1;
      if (j < 0 || j >= L.length) break;
      L[i] = L[j]; L[j] = p; S.rv++;
      for (const q of powerCheck(sim)) powerNote(sim, q);
      assignHomes(sim); projectsThink(sim); break;
    }
    case 'projBunks': {   // close a bunkhouse, or open it again: closed bunks stand empty
      if (!p || !HOMES.includes(p.type)) return false;
      p.closed = !!m.closed; S.rv++;
      const out = S.cols.filter(c => !c.dead && c.home === p.id).length;
      sim.log(p.closed ? `Closed the bunks in ${p.name}.${out ? ` ${out === 1 ? 'The one person' : `The ${out} people`} who slept there will find bunks elsewhere if there are any free.` : ''}` : `Opened the bunks in ${p.name} again.`);
      assignHomes(sim); return true;
    }
    case 'projPause': if (p && !p.done) { p.paused = !!m.on; S.rv++; sim.log(`${p.name} ${p.paused ? 'is paused' : 'is back on the list'}.`); projectsThink(sim); } break;
    case 'projCancel': {
      if (!p || p.type === 'shelter') return false;
      if (p.fire) return { ok: false, why: 'It is burning: put the fire out first.' };
      if (p.type === 'shaft' && S.projects.some(q => !q.gone && q.via === p.id)) return { ok: false, why: 'Rooms on the middle or the deep level are reached through this shaft: take those down first.' };
      if (p.blocked) sim.unblock(p);
      const back = refundOf(p), was = p.done || p.dmg;
      for (const k in back) for (let n = 0; n < back[k]; n++) putBack(S, k);
      p.gone = true; S.rv++;
      // anyone working in it or carrying to it drops what they hold back in the stores and finds other work
      for (const c of S.cols) {
        if (c.dead) continue;
        if (c.home === p.id) c.home = -1; if (c.mess === p.id) c.mess = -1; if (c.ward === p.id) c.ward = -1;
        if ((c.pj === p.id || c.ws === p.id) && c.job !== 'wake' && !c.down && c.carried < 0) { dropCarry(sim, c); c.plan = ''; c.job = ''; c.ws = -1; c.noWork = 0; }
      }
      const list = Object.entries(back).map(([k, n]) => matName(k, n));
      sim.log(`${was ? 'Took down' : 'Cancelled'} ${p.name}.${list.length ? ' ' + list.join(', ').replace(/^./, m => m.toUpperCase()) + ' went back to the stores.' : ' Nothing had gone into it yet.'}`);
      for (const q of powerCheck(sim)) powerNote(sim, q);
      assignHomes(sim); projectsThink(sim);
      return true;
    }
    case 'test': {
      const k = m.mat;
      if (!S.mat[k] || S.mat[k].tested || active(S).some(q => q.type === 'test' && q.mat === k)) return false;
      const r = sim.W.site.yard.rig, q = addProject(sim, 'test', r.x, r.y, 1, 1, 0, k);
      sim.log(`Planned a load test of the local ${k}: three loads go to the rig in the yard and are crushed and bent until they fail.`);
      projectsThink(sim);
      return q.id;
    }
    case 'bpSave': saveBlueprint(S, m.name, m.type, m.w, m.h); break;
    // ---- food ----
    case 'analyse': return analyse(sim, m.o);
    case 'unanalyse': { const F = S.F, L = F.life[m.o]; if (L && L.queued && F.lab.cur !== m.o) { F.lab.queue = F.lab.queue.filter(o => o !== m.o); L.queued = false; S.rv++; } break; }
    case 'triage': if (TRIAGE[m.v]) { S.care.triage = m.v; S.rv++; } break;
    case 'restore': return queueRestore(sim, m.id);
    case 'replacePart': { const c = S.cols[m.id]; return !!c && !c.dead && replacePart(sim, c, m.m); }
    // ---- direct orders in an emergency ----
    case 'ctlTake': return take(sim, m.person);
    case 'ctlOrder': return order(sim, m.person, { k: m.k, t: m.t, who: m.who });
    case 'ctlEnd': { const c = S.cols[m.person]; if (c && c.ctl) release(sim, c, `${c.name} is back with their crew.`); return { ok: true }; }
    case 'iso': S.care.iso = !!m.v; for (const c of S.cols) if (!c.dead && c.plan === 'ward') c.plan = ''; S.rv++; break;
    case 'crop': if (p && p.crop && (m.k === 'auto' || m.k === 'fallow' || CROPS[m.k])) { p.crop.want = m.k; if (p.crop.st === 'bare') p.crop.todo = null; S.rv++; } break;
    case 'bpDel': if (S.blueprints[m.i]) { S.blueprints.splice(m.i, 1); S.rv++; } break;
  }
  return null;
}
function saveBlueprint(S, name, type, w, h) {
  if (!TYPES[type] || TYPES[type].fixed) return;
  name = String(name || TYPES[type].name).slice(0, 40);
  S.blueprints = S.blueprints.filter(b => b.name !== name); S.blueprints.push({ name, type, w, h }); S.rv++;
}
function planNote(p) {
  const c = capOf(p);
  return { dorm: `${c.beds} bunks`, commons: `tables for ${c.seats}`, workshop: `${c.benches} bench${c.benches > 1 ? 'es' : ''}`, clinic: `${c.beds} beds`, solar: `${c.panels} panels`, field: `${c.tiles} tiles of beds`, lab: `${c.benches} bench${c.benches > 1 ? 'es' : ''}`, plant: `${c.tanks} tank${c.tanks > 1 ? 's' : ''}`, cellar: `shelves for ${c.store} loads of food`, burrow: `${c.beds} bunks, dug into ${p.ug ? p.ug.name : 'the ground'}`, mine: `${c.faces} face${c.faces > 1 ? 's' : ''} along a seam of about ${p.seam} loads of ore${p.rare ? `, with a vein of rare earths in it` : ''}`, shaft: 'a lined shaft down to the middle and the deep, and a cage on a powered hoist', vault: `room for ${c.places} people to shelter`, geo: `bores into the hot rock and a heat engine making ${c.supply} kW` }[p.type] || 'done';
}

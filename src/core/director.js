// The director: how hard the world pushes. Each season it gets a danger budget, sized to the season and to how
// strong the colony is (people, food, health) and growing year by year, after an easy first stretch. Everything
// dangerous that happens spends from it: fires, floods, crises, people down, deaths. It plans a few events of its
// own for the season, spaced out, each with a reason in the world and only when the world allows it: a dry
// lightning strike, a cloudburst upstream, a breakdown, a tremor, a blight, an illness brought in. After a death
// or a big blow it holds back for a few days, and once the budget is spent it damps the world's own hazards
// (lightning, floods, illness caught from the world), never people's own illness passing between them. When the
// colony is struggling it can plan relief instead: salvage found, a wild crop fruiting heavily.
// Nothing here is shown to the player. This is the rule-based director; in-game Claude plans the seasons later
// through the same plan list, and this one takes over whenever Claude can't be reached.
import { MAP, T, SEASON_DAYS, YEAR_DAYS, ACT, hidden } from './consts.js';
import { rnd, clamp } from './rng.js';
import { seasonOf, doyOf } from './year.js';
import { floodPlain, FLOOD_LINE } from './world.js';
import { ignite, damage, FUEL } from './hazards.js';
import { injure, woundText } from './body.js';
import { catchIt, BROUGHT } from './illness.js';
import { mealsInStore } from './food.js';
import { remember } from './life.js';
import { scar, relive } from './trauma.js';
import { startFlare } from './sky.js';

const GRACE = 12;                       // days after landing with nothing planned and half the budget
const BASE = [3, 5, 6, 4];              // by season: thaw, long light, storms, deep cold
export const newDir = () => ({ s: -1, budget: 0, spent: 0, calm: 0, damp: 1, plan: [], hist: [], relief: 0 });

// ---------- spending ----------
// cost in rough units: a fire near the camp 2, a building on fire 2, a flooded building 1, a crisis 1, someone down 1, a death 4
export function spend(sim, cost, why) {
  const S = sim.S, D = S.dir; if (!D || S.mode !== 'landfall') return;
  D.spent += cost; D.hist.push([sim.day, why, cost]); if (D.hist.length > 60) D.hist.shift();
  if (cost >= 4 || why === 'death') D.calm = Math.max(D.calm, sim.day + 3 + Math.floor(rnd() * 3));   // a recovery window
  damp(sim);
}
function damp(sim) {
  const D = sim.S.dir, over = D.budget > 0 ? (D.spent - D.budget) / D.budget : 0;
  D.damp = clamp(1 - Math.max(0, over), .25, 1);
  if (sim.day < D.calm) D.damp = Math.min(D.damp, .4);
}

// ---------- how strong the colony is ----------
function strength(sim) {
  const S = sim.S, live = S.cols.filter(c => !c.dead), n = live.length || 1;
  const fdays = mealsInStore(sim, true) / n, hurt = live.filter(c => c.down || (c.cap && c.bd.blood < .8) || c.bd.ill.some(q => q.st >= 1)).length / n;
  return clamp(n / 8, .5, 2.5) * (fdays > 30 ? 1.2 : fdays > 15 ? 1 : fdays > 5 ? .7 : .4) * (1 - hurt * .6);
}

// ---------- the season's plan ----------
const EVENTS = {
  strike: { cost: 2, seasons: [1, 2], w: 3 },
  burst: { cost: 3, seasons: [0, 2], w: 2 },
  wear: { cost: 1, seasons: [0, 1, 2, 3], w: 3 },
  tremor: { cost: 4, seasons: [0, 1, 2, 3], w: 1 },
  blight: { cost: 2, seasons: [0, 1, 2], w: 2 },
  bug: { cost: 2, seasons: [0, 1, 2, 3], w: 2 },
  flare: { cost: 1, seasons: [0, 1, 2, 3], w: 1.5 },
};
function newSeason(sim, s) {
  const S = sim.S, D = S.dir, year = Math.floor((sim.cal - 1) / YEAR_DAYS);
  D.s = s; D.spent = 0; D.plan = [];
  D.budget = +(BASE[s] * strength(sim) * (1 + .3 * year) * (sim.day < GRACE ? .5 : 1)).toFixed(1);
  // about two thirds planned, the rest left for whatever the world does by itself
  let left = D.budget * .65, day = Math.max(sim.day + 2, GRACE), end = sim.day + SEASON_DAYS - (doyOf(sim.cal) % SEASON_DAYS) - 1;
  while (left >= 1 && day < end) {
    day += 3 + Math.floor(rnd() * 5);
    const can = Object.entries(EVENTS).filter(([, e]) => e.seasons.includes(s) && e.cost <= left + .5);
    if (!can.length || day >= end) break;
    const wt = ([key, e]) => e.w * ((D.boost && D.boost[key]) || 1);   // the story can make some events likelier
    let r = rnd() * can.reduce((a, q) => a + wt(q), 0), k = can[0][0];
    for (const q of can) { r -= wt(q); if (r <= 0) { k = q[0]; break; } }
    D.plan.push({ d: day, k, tries: 0 }); left -= EVENTS[k].cost;
  }
  damp(sim);
}

// ---------- each morning ----------
export function dirMorning(sim) {
  const S = sim.S, D = S.dir; if (!D || S.mode !== 'landfall') return;
  const s = seasonOf(doyOf(sim.cal));
  if (D.s !== s) newSeason(sim, s);
  damp(sim);
  for (const ev of D.plan) {
    if (ev.done || ev.d > sim.day) continue;
    if (sim.day < D.calm || D.spent + EVENTS[ev.k].cost > D.budget * 1.1) { ev.d = sim.day + 2; if (++ev.tries > 4) ev.done = true; continue; }
    if (fire(sim, ev.k)) { ev.done = true; spend(sim, EVENTS[ev.k].cost, ev.k); }
    else { ev.d = sim.day + 1; if (++ev.tries > 4) ev.done = true; }
    break;   // one a day at most
  }
  D.plan = D.plan.filter(ev => !ev.done);
  relief(sim);
}
// a colony that is going hungry, or has had a hard season, may get a little luck: never more than twice a year
function relief(sim) {
  const S = sim.S, D = S.dir, live = S.cols.filter(c => !c.dead).length || 1, fdays = mealsInStore(sim, true) / live;
  if (sim.day - D.relief < 30 || sim.day < GRACE) return;
  const hard = fdays < 6 || D.spent > D.budget * 1.3 || (S.stores.yard.salvage < 8 && S.projects.some(p => !p.done && !p.gone));
  if (!hard || rnd() > .25) return;
  if ((fdays < 6 && glut(sim)) || cache(sim)) D.relief = sim.day;
}

// something the story needs to happen now, outside the plan (it still costs what it costs)
export function happen(sim, k) { if (!EVENTS[k] || !fire(sim, k)) return false; spend(sim, EVENTS[k].cost, k); return true; }

// ---------- the events ----------
const pick = a => a[Math.floor(rnd() * a.length)];
const builtOf = (S, f) => S.projects.filter(p => !p.gone && p.done && !p.shut && !p.fire && p.type !== 'shelter' && p.type !== 'test' && f(p));
function fire(sim, k) {
  const S = sim.S, W = sim.W, L = W.land;
  switch (k) {
    case 'strike': {   // dry lightning out of a building storm, upwind of the camp
      if (S.hz.dry < .5) return false;
      for (let n = 0; n < 40; n++) {
        const a = S.hz.wa + Math.PI + (rnd() - .5) * 1.6, r = 25 + rnd() * 35, x = Math.floor(L.x + Math.cos(a) * r), y = Math.floor(L.y + Math.sin(a) * r), t = y * MAP + x;
        if (x > 2 && y > 2 && x < MAP - 3 && y < MAP - 3 && (FUEL[W.type[t]] || 0) >= .5 && ignite(sim, t, 'lightning')) return true;
      }
      return false;
    }
    case 'burst': {    // a cloudburst in the hills upstream: the river comes up whatever the weather here
      const thr = floodPlain(W), low = builtOf(S, p => { let n = 0; for (let y = p.y; y < p.y + p.h; y++) for (let x = p.x; x < p.x + p.w; x++) if (thr[y * MAP + x] <= FLOOD_LINE + 2) n++; return n >= p.w * p.h * .3; });
      let near = 0; for (let y = L.y - 40; y < L.y + 40; y += 2) for (let x = L.x - 40; x < L.x + 40; x += 2) if (thr[y * MAP + x] <= 4) near++;
      if (near < 20) return false;   // no river or lake close enough to matter
      S.hz.fl.burst = (S.hz.fl.burst || 0) + 3 + rnd() * (low.length ? 3 : 2);
      return true;
    }
    case 'wear': {     // something the colony relies on wears out and breaks
      const c = builtOf(S, p => WEAR[p.type]); if (!c.length) return false;
      const p = pick(c); sim.log(`${p.name}: ${WEAR[p.type]}`, 'bad', { e: 'wear', lvl: 1, pid: p.id, title: 'A breakdown' });
      damage(sim, p, .2, 'wear'); return true;
    }
    case 'tremor': {   // the ground shakes: frames crack, some people inside are hurt
      const c = builtOf(S, p => p.type !== 'field'); if (c.length < 2 || sim.day < 25) return false;
      sim.log('The ground shook this morning: a tremor, short and sharp. The Seed is checking every building for damage.', 'bad', { e: 'tremor', lvl: 2, title: 'A tremor' });
      relive(sim, ['quake']);
      let hit = 0;
      for (const p of c) {
        if (rnd() > (p.below ? ((p.lvl || 1) > 1 ? .08 : p.ug && p.ug.kind < 2 ? .55 : .2) : p.type === 'shaft' ? .25 : .4)) continue; hit++;   // dug rooms in soft ground take it worst, in rock least, and the deep levels hardly at all
        for (const o of S.cols) if (!o.dead && o.where === p.id && hidden(o.act)) {
          if (rnd() < .3) { const ws = injure(sim, o, 'build', .2 + rnd() * .4, `when ${p.name} shook`); if (ws.length) sim.log(`${o.name} was hurt inside ${p.name} when it shook: ${ws.map(w => woundText(w).toLowerCase()).join(', and ')}.`, 'bad', { who: o.id }); scar(sim, o, 'quake', 30, `Was hurt inside ${p.name} when the ground shook.`); }
          else scar(sim, o, 'quake', 12, `Was inside ${p.name} when the ground shook.`);
          remember(sim, o, `Was inside ${p.name} when the ground shook.`);
        }
        damage(sim, p, .2 + rnd() * .4, 'quake');
      }
      if (!hit) sim.log('The tremor passed without damage: every frame held.', 'good', {});
      for (const o of S.cols) if (!o.dead) o.str = Math.min(100, o.str + (o.traits.includes('anxious') ? 6 : 3));
      return true;
    }
    case 'blight': {   // a mould through a field's crop
      const c = S.projects.filter(p => !p.gone && p.done && p.type === 'field' && p.crop && p.crop.st === 'grow' && p.crop.g > .25); if (!c.length) return false;
      const p = pick(c), lost = .3 + rnd() * .4, name = p.crop.k;
      p.crop.g = Math.max(0, p.crop.g * (1 - lost)); p.crop.blight = (p.crop.blight || 0) + lost;
      sim.log(`A grey mould spread through the ${name} in ${p.name} overnight. The farmers cut out what they could; about ${Math.round(lost * 100)}% of the growth is lost.`, 'bad', { e: 'blight', lvl: 1, pid: p.id, title: 'Blight' });
      return true;
    }
    case 'flare': return sim.day >= 30 && startFlare(sim);   // a flare on the sun, and the particle storm after it
    case 'bug': {      // one of the Seed's starter cultures gets loose: in the water, or someone's chest after a cold night
      const live = S.cols.filter(c => !c.dead && !c.bd.ill.length && c.act !== ACT.WAKE); if (live.length < 4) return false;
      const K = pick(BROUGHT), c = pick(live); catchIt(sim, c, K, -1); return true;
    }
  }
  return false;
}
const WEAR = {
  solar: 'an inverter burned out and a string of panels went dead. It needs repairs.',
  workshop: 'a bench drive seized and took the power train with it. It needs repairs.',
  plant: 'a pump in the feedstock line cracked and the tanks had to be drained. It needs repairs.',
  clinic: 'the steriliser failed and the clinic had to close until it is fixed.',
  lab: 'the analyser bench lost its seals and is out of use until they are remade.',
  commons: 'the stove flue cracked and filled the room with smoke. It needs repairs.',
  dorm: 'a roof beam split along the grain and the bunks underneath had to be cleared. It needs repairs.',
  burrow: 'the air shaft fan seized and the room went stale. Nobody can sleep down there until it is fixed.',
  cellar: 'a shoring prop bowed under the weight of the earth and the cellar had to be cleared. It needs repairs.',
  mine: 'a run of shoring gave way in a gallery, and the miners had to come up until it is propped again. It needs repairs.',
  pit: 'a bench slumped into the pit and took the hoist footing with it. It needs repairs.',
  shaft: 'the hoist’s winding motor burned out, and the cage is stuck at the foot of the shaft until it is rewound. It needs repairs.',
  geo: 'a bore pipe scaled up with minerals from the hot rock and the heat engine stalled. It needs repairs.',
  vault: 'the vault’s air fan seized and the air down there went stale. It needs repairs.',
};
function cache(sim) {
  const S = sim.S, W = sim.W, L = W.land, n = 10 + Math.floor(rnd() * 14), a = rnd() * 6.283, r = 30 + rnd() * 40;
  S.stores.yard.salvage += n; S.rv++;
  sim.log(`Surveyors came on a piece of the Seed's descent stage that broke away on the way down, ${Math.round(r * 2 / 10) * 10} metres out. They stripped it and carried back ${n} loads of salvage.`, 'good', { e: 'cache', lvl: 1, x: L.x + Math.cos(a) * r, y: L.y + Math.sin(a) * r, title: 'Salvage found' });
  return true;
}
function glut(sim) {
  const S = sim.S, F = S.F, ok = sim.kinds.map((k, o) => o).filter(o => F.life[o] && F.life[o].tested && sim.kinds[o].food && sim.kinds[o].season[seasonOf(doyOf(sim.cal))]);
  if (!ok.length) return false;
  const o = pick(ok), k = sim.kinds[o];
  sim.life.list.forEach((p, i) => { if (p.o === o) delete F.patch[i]; });
  sim.log(`The ${k.name.toLowerCase()} is fruiting heavily this season: every patch the foragers know is full again.`, 'good', { e: 'glut', lvl: 1, title: 'A good season for foraging' });
  return true;
}

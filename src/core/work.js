// The colony's work: the fabricator printing founders from the archive (and modules from salvage when it has no
// body to print), crews and what they do (building, quarrying, felling, workshop benches, surveying), and the
// commands the player gives through the page. The books for buildings are kept in build.js.
import { MAP, HOUR, ACT, SHIFTS, DUSK, T, WORKS } from './consts.js';
import { rnd, ri, clamp } from './rng.js';
import { remember, trustAll } from './life.js';
import { suggestFirst } from './founders.js';
import {
  TYPES, RAW, PRECISE, RECIPE, FIT_H, FAB_SLOW, STAGE_NAMES, matName, stageLoads, billOf, loadCheck, capacity, checkPlot, addProject,
  active, built, byId, capOf, powerCheck, shortOf, stockOf, sources, takeFrom, putBack, nextOrder, rawWanted, clearPlot, LANDER_KW,
} from './build.js';

export const PRINT_TICKS = 4 * HOUR;
const TPH = 95;          // tiles an unhurried person covers in an hour, for planning trips
const STAKES_ALL = 10, PICK = 100, NO_WORK = Math.round(HOUR / 2);
const FIT_JOBS = new Set(['fetch', 'pick', 'cut', 'fit']);

// ---------- the fabricator ----------
export function seedTick(sim) {
  const S = sim.S, sd = S.seedc;
  if (S.mode !== 'landfall') return;
  if (!sd.printing && sd.queue.length && sd.feed > 0) {
    const fid = sd.queue.shift(); sd.printing = { fid, left: PRINT_TICKS }; sd.feed--; S.rv++;
    sim.log(`The fabricator began printing a body for ${S.archive[fid].name}.`);
  }
  if (sd.printing && --sd.printing.left <= 0) {
    const p = S.archive[sd.printing.fid]; p.woke = S.tick; sd.printing = null;
    const c = sim.spawn(p, sim.cargoTile, ACT.WAKE); c.timer = HOUR; c.plan = 'wake'; c.job = 'wake';
    remember(sim, c, 'Woke in a new body, on a new world.');
    sim.log(`${p.name} woke in a new body.`, 'good');
    if (S.autoCrews) autoCrew(sim, c); else sim.log(`${p.name} is waiting to be put in a crew.`);
    if (!sd.feed && !sd.queue.length) sim.log('The fabricator has used the last of its feedstock for bodies. It will make modules from salvage when the colony needs them.');
  }
  // with no body to print, the fabricator makes modules from salvage, three times slower than a workshop bench
  if (sd.printing || sd.queue.length) return;
  const f = S.fab;
  if (f.job) {
    if (--f.job.left <= 0) { S.stores.cargo[f.job.k]++; sim.log(`The fabricator finished ${matName(f.job.k, 1).replace(/^1 /, 'a ')}.`); f.job = null; S.rv++; }
  } else if (S.tick % 60 === 0) {
    const k = nextOrder(sim);
    if (k && S.stores.yard.salvage >= RECIPE[k].salvage) { S.stores.yard.salvage -= RECIPE[k].salvage; f.job = { k, left: Math.round(RECIPE[k].h * HOUR * FAB_SLOW) }; S.rv++; }
  }
}
// the Seed's suggestion for where a new founder goes: two out surveying, everyone else building
function autoCrew(sim, c) {
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
  }
  return false;
}
export const carryAct = k => k === 'stone' ? ACT.STONE : k === 'timber' ? ACT.LOG : ACT.CARRY;
// loads on their way to a project, or being fitted
function inflight(S, p, k) { let n = 0; for (const o of S.cols) if (!o.dead && o.pj === p.id && o.want === k && FIT_JOBS.has(o.job)) n++; return n; }
const stockAt = (S, key, k) => key === 'yard' ? S.stores.yard[k] : key === 'cargo' ? S.stores.cargo[k] || 0 : ((byId(S, +key.slice(1)) || {}).out || {})[k] || 0;
function reserved(S, key, k) { let n = 0; for (const o of S.cols) if (!o.dead && o.srcKey === key && o.want === k && (o.job === 'fetch' || o.job === 'pick')) n++; return n; }

function buildNext(sim, c, cr) {
  const S = sim.S, p = cr.proj >= 0 ? byId(S, cr.proj) : null;
  if (!p || p.done || p.paused) return false;
  for (const k in p.need) {
    if (p.need[k] - (p.got[k] || 0) - inflight(S, p, k) <= 0) continue;
    if (k === 'mark' || k === 'test') { fitJob(sim, c, p, k); return true; }
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
  c.job = 'fit'; c.want = k; c.pj = p.id; c.spot = spot; c.fx = p.x + p.w / 2; c.fy = p.y + p.h / 2;
  sim.goTo(c, spot, k === 'test' ? ACT.TEST : ACT.BUILD, c.carry ? carryAct(c.carry) : ACT.WALK);
}
// the nearest stone or timber nobody else is already cutting: a felled tree with logs left beats a standing one
function gatherJob(sim, c, k, pj) {
  const S = sim.S, W = sim.W, list = k === 'stone' ? sim.rocks : sim.trees, claimed = new Set();
  for (const o of S.cols) if (!o.dead && o.job === 'cut' && o.src >= 0) claimed.add(o.src);
  let best = null, bs = 1e9;
  for (const e of list) {
    if (e.d - 15 > bs) break;
    if (claimed.has(e.src) || !W.cost[e.work]) continue;
    const g = S.gone[e.src], q = S.quarry[e.src] || 0;
    if (e.kind === 0 ? g === 0 : e.kind === 1 ? g !== undefined || q >= 2 : q >= 30) continue;
    const s = e.d - (e.kind === 0 && g > 0 ? 15 : 0);
    if (s < bs) { bs = s; best = e; }
  }
  if (!best) return false;
  c.job = 'cut'; c.want = k; c.pj = pj; c.src = best.src; c.srcKind = best.kind; c.fx = best.src % MAP + .5; c.fy = (best.src / MAP | 0) + .5;
  sim.goTo(c, best.work, k === 'stone' ? ACT.QUARRY : ACT.FELL);
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
  const k = nextOrder(sim);
  if (!k || S.stores.yard.salvage < RECIPE[k].salvage) return false;
  c.job = 'salv'; c.make = k; c.ws = ws.id; c.want = ''; c.pj = -1;
  sim.goTo(c, sim.yardTile, ACT.IDLE);
  return true;
}
// whatever someone was carrying when called away goes back to the stores
export function dropCarry(sim, c) {
  const S = sim.S;
  if (c.carry === 'salvage') S.stores.yard.salvage += c.cn || 0; else if (c.carry) putBack(S, c.carry);
  c.carry = ''; c.cn = 0; c.make = ''; c.want = ''; c.pj = -1; c.src = -1; c.srcKey = '';
}
function eff(sim, c, kind = 'build') {
  const S = sim.S, cr = c.crew >= 0 ? S.crews[c.crew] : null, lead = cr && cr.lead >= 0 ? S.cols[cr.lead] : null, sk = c.skills;
  let e = kind === 'bench' ? .4 + sk.engineering * .07 : kind === 'cut' ? .55 + sk.building * .03 + sk.fieldcraft * .03 : .45 + sk.building * .05 + sk.engineering * .025;
  if (c.fat > 75) e *= .7; if (c.fresh > 0) e *= .75; if (c.hurt > 0) e *= .8; if (c.str > 65) e *= .85;
  if (c.traits.includes('reckless')) e *= 1.1; if (c.traits.includes('careful')) e *= .92;
  if (lead) e *= .85 + lead.skills.leadership * .03;
  return Math.max(.2, e);
}

// ---------- the projects: stages, crews, waiting, power, beds ----------
function fitted(sim, c) {
  const S = sim.S, p = byId(S, c.pj), k = c.want;
  if (!p || p.done || !(p.need[k] > (p.got[k] || 0))) { if (c.carry) putBack(S, c.carry); }
  else {
    p.got[k] = (p.got[k] || 0) + 1; S.stats.fits++;
    if (k !== 'mark' && k !== 'test') p.used[k] = (p.used[k] || 0) + 1;
    if (Object.keys(p.need).every(q => (p.got[q] || 0) >= p.need[q])) advance(sim, p);
  }
  c.carry = ''; c.want = ''; c.pj = -1; c.job = '';
}
function advance(sim, p) {
  const S = sim.S, st = p.stage;
  S.rv++;
  if (p.type === 'test') {
    if (st === 0) { p.stage = 1; p.got = {}; p.need = stageLoads(S, 'test', 1, 1, 1, p.mat); sim.log(`${p.name}: samples are at the rig. Testing them now.`); return; }
    const m = S.mat[p.mat], pct = Math.round((m.f - 1) * 100); m.tested = true; p.done = true; p.gone = true;
    sim.log(`Load test done: the local ${p.mat} is ${pct === 0 ? 'exactly as strong as' : Math.abs(pct) + '% ' + (pct > 0 ? 'stronger' : 'weaker') + ' than'} the databank's standard. Designs now use it with a measured margin instead of a guess.${p.mat === 'timber' ? ` Timber beams can span ${Math.floor(3 + 3 * m.f)} tiles before they need posts.` : ''}`, 'good');
    trustAll(sim, 1, `Saw the Seed test the local ${p.mat} instead of guessing.`);
    return;
  }
  if (st === 0) { if (p.type !== 'shelter') clearPlot(sim, p); if (!p.blocked) sim.block(p); }
  p.stage++; p.got = {};
  if (p.stage >= 5) return finish(sim, p);
  p.need = stageLoads(S, p.type, p.w, p.h, p.stage, p.mat);
  sim.log(`${p.name}: ${STAGE_NAMES[st].toLowerCase()} done. Next: ${STAGE_NAMES[p.stage].toLowerCase()}.`, 'good');
  if (p.type === 'shelter') trustAll(sim, 2);
}
function finish(sim, p) {
  const S = sim.S; p.done = true; p.stage = 5; p.need = {}; S.rv++;
  powerCheck(sim);
  const cap = capOf(p), more = active(S).some(q => q.type !== 'test' && !q.paused);
  if (p.type === 'shelter') {
    sim.log(`The shelter is finished: twelve bunks, walls and a roof made from the lander.${more ? '' : ' Nothing else is planned yet, so the build crew is free.'}`, 'good');
    trustAll(sim, 6, 'Slept under a roof again.');
  } else {
    const what = { dorm: `${cap.beds} bunks`, commons: `seats for ${cap.seats}`, workshop: `${cap.benches} bench${cap.benches > 1 ? 'es' : ''}`, clinic: `${cap.beds} beds`, solar: `${cap.panels} panels making ${cap.supply} kW` }[p.type];
    sim.log(`${p.name} is finished: ${what}.${p.type !== 'solar' && !p.powered ? ` It stays dark until the colony has ${shortOf(S, p)} kW more power.` : ''}`, 'good');
    trustAll(sim, 2, `Watched ${p.name} go up.`);
  }
  assignHomes(sim);
}
// why a project isn't moving, or '' when there is work for a crew to do
function waitReason(sim, p) {
  const S = sim.S;
  if (p.paused) return 'Paused';
  if (p.done) return p.type !== 'solar' && !p.powered ? `Dark: needs ${shortOf(S, p)} kW more power` : '';
  let miss = null;
  for (const k in p.need) {
    const left = p.need[k] - (p.got[k] || 0); if (left <= 0) continue;
    if (k === 'mark' || k === 'test' || RAW.includes(k) || stockOf(S, k) > 0 || inflight(S, p, k) > 0) return '';
    if (!miss) miss = [k, left];
  }
  if (!miss) return '';
  const [k, n] = miss;
  if (k === 'module') return 'Out of lander modules';
  if ((S.fab.job && S.fab.job.k === k) || S.cols.some(o => !o.dead && o.make === k)) return `Waiting for ${matName(k, n)}, being made`;
  if (S.stores.yard.salvage < RECIPE[k].salvage) return `Needs ${matName(k, n)} and there is no salvage left to make them`;
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
    if (stuck && !p.stall) { p.stall = 1; sim.log(`${p.name} stalled: ${w[0].toLowerCase() + w.slice(1)}.`, 'bad'); }
    else if (!stuck && p.stall) { p.stall = 0; if (!p.done && !w) sim.log(`Work on ${p.name} picked up again.`); }
    if (w !== p.wait) { p.wait = w; S.rv++; }
  }
  if (S.tick % HOUR < 120) { for (const p of powerCheck(sim)) powerNote(sim, p); assignHomes(sim); }
}
function powerNote(sim, p) {
  if (p.type === 'solar') return;
  if (p.powered) sim.log(`${p.name} has power.`, 'good'); else sim.log(`${p.name} went dark: the colony needs ${shortOf(sim.S, p)} kW more power.`, 'bad');
}
// bunks in the shelter and the dormitories, and seats in the commons, for everyone they hold
export function assignHomes(sim) {
  const S = sim.S, live = S.cols.filter(c => !c.dead), on = built(S).filter(p => p.powered);
  const fill = (types, key, capKey) => {
    const left = new Map(on.filter(p => types.includes(p.type)).map(p => [p.id, capOf(p)[capKey]]));
    const moved = [];
    for (const c of live) { const n = left.get(c[key]); if (n > 0) left.set(c[key], n - 1); else c[key] = -1; }
    for (const c of live) if (c[key] < 0) for (const [id, n] of left) if (n > 0) { c[key] = id; left.set(id, n - 1); moved.push(c); break; }
    return moved;
  };
  const moved = fill(['shelter', 'dorm'], 'home', 'beds');
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
  const out = cr.members.map(i => S.cols[i]).filter(c => !c.dead && c.plan === 'work');
  if (!out.length) return;
  let px = 0, py = 0; for (const c of out) { px += c.x; py += c.y; } px /= out.length; py /= out.length;
  const dCamp = Math.hypot(px - L.x, py - L.y);
  // time to turn back, so as to be home by the end of the shift (or by dark, if that's the rule)
  const until = cr.rules.dark ? Math.min(sh.b, DUSK - .2) : sh.b;
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
    case 'fit': c.timer = Math.round(FIT_H[c.want] * HOUR / eff(sim, c)); break;
    case 'cut': {
      const felled = c.srcKind === 0 && S.gone[c.src] > 0;
      c.timer = Math.round((felled ? .25 : c.srcKind === 0 ? .8 : .6) * HOUR / eff(sim, c, 'cut')); break;
    }
    case 'drop':
      if (c.carry in S.stores.yard) S.stores.yard[c.carry]++; else if (c.carry) putBack(S, c.carry);
      c.carry = ''; c.want = ''; c.job = ''; c.act = ACT.IDLE; break;
    case 'salv': c.job = 'salvpick'; c.act = ACT.IDLE; c.timer = PICK; break;
    case 'bench': c.where = c.ws; c.timer = Math.round(RECIPE[c.make].h * HOUR / eff(sim, c, 'bench')); break;
    case 'plant': c.timer = Math.round(HOUR / 6); break;
    case 'eat':
      if (c.act === ACT.INDOORS) c.where = c.mess;
      if (c.ate !== sim.day) { c.ate = sim.day; if (S.food >= 1) { S.food--; c.hungry = false; } else { if (!c.hungry) sim.log(`${c.name} went to bed hungry: the rations are gone.`, 'bad'); c.hungry = true; } }
      break;
    case 'sleep': case 'ward': if (c.act === ACT.INSIDE || c.act === ACT.INDOORS) c.where = c.job === 'ward' ? c.ward : c.home; break;
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
      if (c.srcKind === 0) {
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
      const n = RECIPE[c.make].salvage, ws = byId(S, c.ws);
      if (ws && S.stores.yard.salvage >= n) { S.stores.yard.salvage -= n; c.carry = 'salvage'; c.cn = n; c.job = 'bench'; sim.goTo(c, ws.door.y * MAP + ws.door.x, ACT.BENCH, ACT.CARRY); }
      else { c.job = ''; c.make = ''; }
      break;
    }
    case 'bench': {
      const ws = byId(S, c.ws);
      if (ws) ws.out[c.make] = (ws.out[c.make] || 0) + 1; else S.stores.cargo[c.make]++;
      if (!S.stats.made++) sim.log(`${c.name} made the colony's first ${MAT_ONE[c.make]} at a workshop bench.`, 'good');
      c.carry = ''; c.cn = 0; c.make = ''; c.job = ''; c.where = -1; c.act = ACT.IDLE;
      break;
    }
    case 'plant': {
      const s = { x: c.x, y: c.y, day: sim.day }; S.stakes.push(s); sim.reveal(c.x, c.y, 22); S.rv++;
      const cr = S.crews[c.crew]; sim.log(`The ${cr ? cr.name : ''} crew planted sensor stake ${S.stakes.length} of ${STAKES_ALL}.`);
      c.job = 'survey'; c.act = ACT.SURVEY; break;
    }
    case 'wake': c.act = ACT.IDLE; c.plan = ''; c.job = ''; break;
  }
}
const MAT_ONE = { seal: 'airlock seal', pipe: 'pipe run', power: 'power unit', panel: 'solar panel' };

// ---------- the player's commands ----------
// power every planned and finished building will draw, against what the lander and every solar field will make
function powerPlan(S) {
  let supply = LANDER_KW, draw = 0;
  for (const p of S.projects) { if (p.gone || p.type === 'test') continue; const c = capOf(p); if (p.type === 'solar') supply += c.supply; else draw += c.kw; }
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
    case 'crewNew': { const k = sim.newCrew(m.work && WORKS[m.work] ? m.work : 'rest'); S.crews.push(k); S.autoCrews = false; S.rv++; return k.id; }
    case 'crewDel': if (cr) { for (const i of cr.members.slice()) sim.addTo(S.cols[i], -1); cr.gone = true; cr.members = []; cr.lead = -1; S.autoCrews = false; S.rv++; } break;
    case 'crewSet':
      if (!cr) break;
      if (m.work && WORKS[m.work] && m.work !== cr.work) { cr.work = m.work; cr.dest = -1; cr.recalled = false; cr.proj = -1; for (const i of cr.members) { S.cols[i].plan = ''; S.cols[i].noWork = 0; } }
      if (m.shift != null) cr.shift = clamp(m.shift | 0, 0, SHIFTS.length - 1);
      if (m.lead != null && cr.members.includes(m.lead)) cr.lead = m.lead;
      if (m.rule) cr.rules[m.rule] = !!m.on;
      if (m.target !== undefined) { cr.target = m.target; cr.dest = -1; }
      S.autoCrews = false; S.rv++; break;
    case 'move': { const c = S.cols[m.person]; if (c && !c.dead) { sim.addTo(c, m.crew); S.autoCrews = false; } break; }
    // ---- building ----
    case 'plan': {
      if (!TYPES[m.type] || TYPES[m.type].fixed) return { ok: false, why: 'That is not something the colony can plan.' };
      const chk = checkPlot(sim, m.type, m.x, m.y, m.w, m.h, m.side), cap = capacity(m.type, m.w, m.h), pw = powerPlan(S);
      const after = { supply: +(pw.supply + (cap.supply || 0)).toFixed(1), draw: +(pw.draw + cap.kw).toFixed(1) };
      return { ...chk, bill: billOf(S, m.type, m.w, m.h), load: loadCheck(S, m.type, m.w, m.h), cap, power: after, short: +Math.max(0, after.draw - after.supply).toFixed(1) };
    }
    case 'place': {
      const chk = checkPlot(sim, m.type, m.x, m.y, m.w, m.h, m.side);
      if (!chk.ok) return { ok: false, why: chk.why };
      const q = addProject(sim, m.type, m.x, m.y, m.w, m.h, m.side);
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
    case 'projPause': if (p && !p.done) { p.paused = !!m.on; S.rv++; sim.log(`${p.name} ${p.paused ? 'is paused' : 'is back on the list'}.`); projectsThink(sim); } break;
    case 'projCancel': {
      if (!p || p.type === 'shelter') return false;
      if (p.blocked) sim.unblock(p);
      const back = [];
      for (const k in p.used) { for (let n = 0; n < p.used[k]; n++) putBack(S, k); back.push(matName(k, p.used[k])); }
      p.gone = true; S.rv++;
      for (const c of S.cols) { if (c.pj === p.id && c.job === 'fit') c.pj = -1; if (c.home === p.id) c.home = -1; if (c.mess === p.id) c.mess = -1; if (c.ward === p.id) c.ward = -1; }
      sim.log(`${p.done ? 'Took down' : 'Cancelled'} ${p.name}.${back.length ? ' ' + back.join(', ') + ' went back to the stores.' : ''}`);
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
  return { dorm: `${c.beds} bunks`, commons: `tables for ${c.seats}`, workshop: `${c.benches} bench${c.benches > 1 ? 'es' : ''}`, clinic: `${c.beds} beds`, solar: `${c.panels} panels` }[p.type] || 'done';
}

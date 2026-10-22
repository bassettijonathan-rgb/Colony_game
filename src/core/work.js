// The colony's work: the fabricator printing founders from the archive, crews and what they do (turning the
// lander into a shelter, surveying the land), and the commands the player gives through the page.
import { MAP, HOUR, ACT, SHIFTS, DUSK, T, WORKS } from './consts.js';
import { rnd, ri, clamp } from './rng.js';
import { remember, trustAll } from './life.js';
import { suggestFirst } from './founders.js';

export const PRINT_TICKS = 4 * HOUR;
// the shelter goes up in stages: [name, fittings needed, each one needs a module carried from the lander]
export const STAGES = [['Marking out the plot', 4, false], ['Foundations', 8, true], ['Frame', 12, true], ['Systems', 12, true], ['Fit-out', 10, true]];
export const BEDS = 12;
const TPH = 95;
const STAKES_ALL = 10;   // tiles an unhurried person covers in an hour, for planning trips

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
    if (!sd.feed && !sd.queue.length) sim.log('The fabricator has used the last of its feedstock. The core is stopping until there is more.');
  }
}
// the Seed's suggestion for where a new founder goes: two out surveying, everyone else on the shelter
function autoCrew(sim, c) {
  const S = sim.S;
  let sh = S.crews.find(k => !k.gone && k.work === 'shelter'), sv = S.crews.find(k => !k.gone && k.work === 'survey');
  if (!sh) { sh = sim.newCrew('shelter'); S.crews.push(sh); }
  if (!sv) { sv = sim.newCrew('survey'); S.crews.push(sv); }
  const toSurvey = sv.members.length < 2 && (c.skills.fieldcraft >= 4 || sh.members.length >= 3) && c.skills.fieldcraft >= c.skills.building - 1;
  const k = toSurvey || (S.shelter.done && sv.members.length < 4) ? sv : sh;
  sim.addTo(c, k.id);
  for (const cr of [sh, sv]) { let best = cr.lead, bs = -1; for (const i of cr.members) { const s = S.cols[i].skills.leadership; if (s > bs) { bs = s; best = i; } } cr.lead = best; }
  sim.log(`The Seed put ${c.name} in the ${k.name} crew (${WORKS[k.work].toLowerCase()}).`);
}

// ---------- the shelter ----------
const stageAt = fits => { let n = 0; for (let i = 0; i < STAGES.length; i++) { n += STAGES[i][1]; if (fits < n) return i; } return STAGES.length; };
export function shelterNext(sim, c) {
  const S = sim.S, sh = S.shelter;
  if (sh.done) return false;
  const st = STAGES[sh.stage], spot = sim.spots[(c.id * 7 + S.stats.fits * 3) % sim.spots.length];
  c.spot = spot;
  if (st[2] && !c.carry) {
    if (S.seedc.cargo <= 0) return false;
    c.job = 'fetch'; sim.goTo(c, sim.cargoTile, ACT.IDLE); return true;
  }
  c.job = 'fit'; sim.goTo(c, spot, ACT.BUILD, c.carry ? ACT.CARRY : ACT.WALK); return true;
}
function eff(sim, c) {
  const S = sim.S, cr = c.crew >= 0 ? S.crews[c.crew] : null, lead = cr && cr.lead >= 0 ? S.cols[cr.lead] : null;
  let e = .45 + c.skills.building * .05 + c.skills.engineering * .025;
  if (c.fat > 75) e *= .7; if (c.fresh > 0) e *= .75; if (c.hurt > 0) e *= .8; if (c.str > 65) e *= .85;
  if (c.traits.includes('reckless')) e *= 1.1; if (c.traits.includes('careful')) e *= .92;
  if (lead) e *= .85 + lead.skills.leadership * .03;
  return Math.max(.2, e);
}
function fitted(sim, c) {
  const S = sim.S, sh = S.shelter; c.carry = 0; S.stats.fits++; sh.fits++;
  const st = stageAt(sh.fits);
  if (st > sh.stage) {
    const done = STAGES[sh.stage][0]; sh.stage = st; S.rv++;
    if (st >= STAGES.length) {
      sh.done = true; sh.beds = S.cols.filter(o => !o.dead).slice(0, BEDS).map(o => o.id);
      sim.log('The shelter is finished: twelve bunks, walls and a roof made from the lander. Its crew has no project now.', 'good');
      trustAll(sim, 6, 'Slept under a roof again.');
      for (const cr of S.crews) if (cr.work === 'shelter') cr.work = 'rest';
    } else { sim.log(`Shelter: ${done.toLowerCase()} done. Next: ${STAGES[st][0].toLowerCase()}.`, 'good'); trustAll(sim, 2); }
  }
}

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
    case 'fetch': c.job = 'pick'; c.act = ACT.IDLE; c.timer = 100; break;
    case 'fit': c.timer = Math.round(75 / 60 * HOUR / eff(sim, c)); break;
    case 'plant': c.timer = Math.round(HOUR / 6); break;
    case 'eat':
      if (c.ate !== sim.day) { c.ate = sim.day; if (S.food >= 1) { S.food--; c.hungry = false; } else { if (!c.hungry) sim.log(`${c.name} went to bed hungry: the rations are gone.`, 'bad'); c.hungry = true; } }
      break;
    case 'wake': break;
  }
}
export function onTimer(sim, c) {
  const S = sim.S;
  switch (c.job) {
    case 'pick':
      if (S.seedc.cargo > 0) { S.seedc.cargo--; c.carry = 1; c.job = 'fit'; sim.goTo(c, c.spot, ACT.BUILD, ACT.CARRY); }
      else { c.job = ''; }
      break;
    case 'fit': fitted(sim, c); c.job = ''; if (c.plan === 'work') shelterNext(sim, c); break;
    case 'plant': {
      const s = { x: c.x, y: c.y, day: sim.day }; S.stakes.push(s); sim.reveal(c.x, c.y, 22); S.rv++;
      const cr = S.crews[c.crew]; sim.log(`The ${cr ? cr.name : ''} crew planted sensor stake ${S.stakes.length} of ${STAKES_ALL}.`);
      c.job = 'survey'; c.act = ACT.SURVEY; break;
    }
    case 'wake': c.act = ACT.IDLE; c.plan = ''; c.job = ''; break;
  }
}

// ---------- the player's commands ----------
export function command(sim, m) {
  const S = sim.S, cr = m.crew != null ? S.crews[m.crew] : null;
  switch (m.op) {
    case 'print':
      for (const fid of m.ids) { const p = S.archive[fid]; if (p && p.woke == null && !S.seedc.queue.includes(fid) && !(S.seedc.printing && S.seedc.printing.fid === fid)) S.seedc.queue.push(fid); }
      S.rv++; break;
    case 'unqueue': S.seedc.queue = S.seedc.queue.filter(f => f !== m.fid); S.rv++; break;
    case 'suggest': return suggestFirst(S.archive, Math.max(1, S.seedc.feed));
    case 'crewNew': { const k = sim.newCrew('rest'); S.crews.push(k); S.autoCrews = false; S.rv++; return k.id; }
    case 'crewDel': if (cr) { for (const i of cr.members.slice()) sim.addTo(S.cols[i], -1); cr.gone = true; cr.members = []; cr.lead = -1; S.autoCrews = false; S.rv++; } break;
    case 'crewSet':
      if (!cr) break;
      if (m.work && WORKS[m.work]) { cr.work = m.work; cr.dest = -1; cr.recalled = false; for (const i of cr.members) S.cols[i].plan = ''; }
      if (m.shift != null) cr.shift = clamp(m.shift | 0, 0, SHIFTS.length - 1);
      if (m.lead != null && cr.members.includes(m.lead)) cr.lead = m.lead;
      if (m.rule) cr.rules[m.rule] = !!m.on;
      if (m.target !== undefined) { cr.target = m.target; cr.dest = -1; }
      S.autoCrews = false; S.rv++; break;
    case 'move': { const c = S.cols[m.person]; if (c && !c.dead) { sim.addTo(c, m.crew); S.autoCrews = false; } break; }
  }
  return null;
}

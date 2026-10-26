// Scans and restores. A scanner records the pattern of a living brain, closely enough that the Seed can print the
// person again: the same machinery that stored the founders' minds before the voyage, rebuilt here once the colony
// can make its imaging magnets, which need rare earths from the deep. A scan takes an hour of lying still, so the
// Seed fits them into the nights, once a season for each adult who agrees. Some won't: natives most of all, who
// never went through it. When someone with a scan dies, the Seed can print a body and wake them from it, at the cost
// of a body's worth of feedstock, and they lose everything since that scan: days, skills, what they learned of the
// people around them. The founders' charter forbids two of anyone at once, so only the dead can be restored.
import { DAY_TICKS, YEAR_DAYS, SEASON_DAYS, HOUR, ACT, MAP } from './consts.js';
import { clamp, lcg } from './rng.js';
import { built, capOf } from './build.js';
import { newBody } from './body.js';
import { printBody } from './aging.js';
import { remember } from './life.js';
import { PRINT_TICKS, planCrews, autoCrew } from './work.js';

export const SCAN_EVERY = SEASON_DAYS;
const yrs = (sim, c) => (sim.S.tick / DAY_TICKS - c.born) / YEAR_DAYS;
// whether this person agrees to be scanned: fixed for each person, and less likely for anyone born on this world
export function willScan(c) {
  if (c.scanOk != null) return c.scanOk;
  const r = lcg((c.look || 1) * 31 + 17)(), has = t => c.traits.includes(t);
  const no = .08 + (c.native ? .3 : 0) + (c.nbr != null ? .25 : 0) + (has('stubborn') ? .15 : 0) + (has('anxious') ? .1 : 0) - (has('steady') ? .05 : 0);
  return r >= no;
}
// each night at four: the scanners take as many of those due as they have places for, the longest unscanned first
export function scanNight(sim) {
  const S = sim.S, sc = built(S).filter(p => p.type === 'scanner' && p.powered && !p.shut); if (!sc.length) return;
  const places = sc.reduce((a, p) => a + capOf(p).slots * 3, 0);
  const due = S.cols.filter(c => !c.dead && c.life >= 3 && willScan(c) && (!c.scan || sim.day - c.scan.d >= SCAN_EVERY) && c.act !== ACT.WAKE)
    .sort((a, b) => (a.scan ? a.scan.d : -1) - (b.scan ? b.scan.d : -1));
  let n = 0;
  for (const c of due.slice(0, places)) {
    const first = !c.scan;
    c.scan = { d: sim.day, skills: { ...c.skills }, mem: c.mem.length, age: +yrs(sim, c).toFixed(1) }; n++;
    if (first) remember(sim, c, 'Was scanned for the first time: if they die, the Seed can wake them again.');
  }
  if (n && !S.scanSeen) { S.scanSeen = 1; sim.log(`The scanner made its first recordings last night: ${n === 1 ? 'one person' : `${n} people`}. From now on the Seed scans every adult who agrees once a season, at night. If someone with a scan dies, the Seed can print them again from it.`, 'good', { e: 'scanned', lvl: 2, pid: sc[0].id, title: 'The first scans' }); }
  const refuse = S.cols.filter(c => !c.dead && c.life >= 3 && !willScan(c) && !c.scanSaid);
  for (const c of refuse.slice(0, 1)) { c.scanSaid = 1; remember(sim, c, 'Refused to be scanned.'); sim.log(`${c.name} won’t be scanned. ${c.native || c.nbr != null ? 'Born on this world, they never went through it, and they don’t want a copy of themselves kept in the Seed.' : 'They say one life is enough, and they don’t want a copy kept.'}`, '', { e: 'noscan', lvl: 1, who: c.id, title: 'No scan' }); }
}
// someone dead the Seed could wake again, and why not if it can't
export function canRestore(sim, c) {
  const S = sim.S;
  if (!c.dead || !c.scan) return { ok: false, why: '' };
  if (S.seedc.restore && S.seedc.restore.includes(c.id)) return { ok: false, why: 'Waiting for the fabricator.', queued: true };
  if (S.seedc.printing && S.seedc.printing.rid === c.id) return { ok: false, why: 'The fabricator is printing their body.', queued: true };
  if (S.seedc.feed < 1) return { ok: false, why: 'Needs a body’s worth of feedstock: the feedstock plant makes it.' };
  return { ok: true, why: '', lost: Math.max(0, c.dday - c.scan.d) };
}
export function queueRestore(sim, id) {
  const S = sim.S, c = S.cols[id], r = c && canRestore(sim, c);
  if (!r || !r.ok) return r || { ok: false };
  (S.seedc.restore || (S.seedc.restore = [])).push(id); S.rv++;
  sim.log(`The Seed will print ${c.name} again from the scan of day ${c.scan.d}, next after whoever is printing now.`);
  return { ok: true };
}
// the fabricator, when it is free: restores come before anyone new from the archive
export function restoreStart(sim) {
  const S = sim.S, sd = S.seedc;
  if (sd.printing || !sd.restore || !sd.restore.length || sd.feed < 1) return false;
  const id = sd.restore.shift(), c = S.cols[id];
  if (!c || !c.dead || !c.scan) return false;
  sd.printing = { rid: id, left: PRINT_TICKS }; sd.feed--; S.rv++;
  sim.log(`The fabricator began printing a body for ${c.name}, to wake them from their scan.`);
  return true;
}
export function restoreDone(sim, id) {
  const S = sim.S, c = S.cols[id], sc = c.scan, t = sim.cargoTile, lost = c.dday - sc.d;
  // a new body, as old as they were at the scan (at most forty), with the skills and memories of that night
  const age = clamp(sc.age, 13, 40);
  Object.assign(c, {
    dead: false, act: ACT.WAKE, timer: HOUR, plan: 'wake', job: 'wake', x: t % MAP + .5, y: (t / MAP | 0) + .5, tile: t, mv: 0, wps: [], wi: 0, leg: [], li: 0, goal: -1, wait: 0, stuck: 0,
    crew: -1, carry: '', cn: 0, want: '', pj: -1, ws: -1, home: -1, mess: -1, ward: -1, where: -1, fat: 18, str: 20, hp: 100, fresh: 10 * DAY_TICKS, hurt: 0, alone: 0, hungry: false, chill: 0, unwell: false,
    bd: newBody(), cap: null, down: false, care: null, carried: -1, aidBy: -1, medBy: -1, iso: false, fight: -1, ctl: false, ord: null, retired: false,
    skills: { ...sc.skills }, mem: c.mem.slice(0, sc.mem), born: S.tick / DAY_TICKS - age * YEAR_DAYS, bday: sim.day, restored: (c.restored || 0) + 1, life: age < 16 ? 3 : 4,
  });
  delete c.dday; delete c.why; delete c.dtick;
  const m0 = c.mem.length; printBody(sim, c); c.mem.length = m0;   // (printBody's note about a mind in a younger body is old news to them)
  remember(sim, c, `Woke from the scan of day ${sc.d}. The last ${lost} day${lost === 1 ? '' : 's'} are gone: other people remember them, and they don’t.`);
  for (const o of S.cols) if (!o.dead && o !== c && o.ties[c.id]) { remember(sim, o, `Saw ${c.name} come back from a scan.`); o.str = Math.max(0, o.str - 10); }
  S.stats.restores = (S.stats.restores || 0) + 1;
  sim.log(`${c.name} woke in a new body, from the scan of day ${sc.d}. ${lost > 0 ? `They remember nothing of the ${lost} day${lost === 1 ? '' : 's'} after it, or of dying.` : 'They lost nothing.'}`, 'good', { e: 'restored', lvl: 2, who: c.id, title: `${c.name} is back` });
  if (S.crewPlan) planCrews(sim, 'woke'); else if (S.autoCrews) autoCrew(sim, c);
}

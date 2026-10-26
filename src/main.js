// The page: starts the simulation thread, draws what it reports, and turns input into camera moves and
// commands. A new game starts in orbit: the player picks one of three sites, the Seed lands there, and
// from then on the player chooses who the fabricator prints, runs the crews and plans what gets built.
import { startSim } from './ui/simclient.js';
import { View } from './render/view.js';
import { PersonArt, artKey } from './render/people.js';
import { Panels } from './ui/panels.js';
import { News } from './ui/news.js';
import { Guide } from './ui/guide.js';
import { thingAt } from './ui/things.js';
import { Stats } from './ui/stats.js';
import { Music, moodFor } from './ui/music.js';
import { SEASONS, MAP, NCH, ACT, DAY_TICKS, hidden } from './core/consts.js';
import { WX } from './core/year.js';
import { TYPES, facing, levelsOf } from './core/build.js';
import { LAYERS } from './render/terrain.js';
import { Store, initStorage, saveLocal, loadLocal, saveAccount, loadAccount, exportFile, importFile } from './ui/storage.js';

const $ = id => document.getElementById(id);
const HUD = '.glass,.topbar,#bar,#dock,.lt,.al';   // the interface over the map: clicks and the wheel there are not for the map
const app = $('app');
const A = {
  sim: null, view: null, panels: null, phase: 'boot', W: null, sites: null, siteSel: 0, mode: 'landfall', tag: '',
  speed: 1, lastSpeed: 1, n: 0, prev: null, cur: null, pos: new Float32Array(0), arts: [], names: [], people: [], archive: [], ui: null, log: [], leads: new Set(),
  clock: null, perf: null, sel: -1, hover: -1, follow: false, frames: [], lastSaveLocal: 0, lastSaveAcct: 0, saveId: 0, cmdId: 0, waiting: new Map(),
  savedNote: 'not yet', thread: '-', timing: null, hold: false, pickCrew: -1, pickAt: null, pendingWear: [], pendingKnown: [], music: new Music(),
  place: null, projSel: -1, thing: null, retype: []
};
const pad = n => String(n).padStart(2, '0');
const when = t => { const d = Math.floor(t / DAY_TICKS) + 1, h = (t % DAY_TICKS) / (DAY_TICKS / 24); return `Day ${d}, ${pad(Math.floor(h))}:${pad(Math.floor((h % 1) * 60))}`; };
const toast = (m) => { const t = $('toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('on'), 3200); };
const loader = (msg, p) => { if (msg) $('ldmsg').textContent = msg; if (p !== undefined) $('ldbar').style.width = Math.round(p * 100) + '%'; };
const withTimeout = (p, ms, v) => Promise.race([p, new Promise(r => setTimeout(() => r(v), ms))]);
const rand6 = () => Math.floor(Math.random() * 900000) + 100000;

// ---------- talking to the simulation ----------
function onSim(m) {
  switch (m.t) {
    case 'survey': return onSurvey(m);
    case 'ready': return onReady(m);
    case 'state': return onState(m);
    case 'snap': A.prev = A.cur; A.cur = { pos: m.pos, t: performance.now() }; A.gprev = A.gcur; A.gcur = { pos: m.gpos || new Float32Array(0), t: A.cur.t }; A.clock = m.clock; A.perf = m.perf; return;
    case 'wear': if (A.view && A.phase === 'colony') for (const [k, d] of m.chunks) A.view.terrain.setWear(k, d); else A.pendingWear.push(...m.chunks); return;
    case 'known': if (A.view && A.phase === 'colony') for (const [k, d] of m.chunks) A.view.setKnown(k, d); else A.pendingKnown.push(...m.chunks); return;
    case 'marks': return onMarks(m);
    case 'skip': return onSkip(m);
    case 'skipEnd': return skipEnd(m);
    case 'skipNo': toast(m.why); return;
    case 'saved': case 'cmd': { const r = A.waiting.get(m.rq); if (r) { A.waiting.delete(m.rq); r(m.t === 'saved' ? m.data : m.r); } }
  }
}
function ask(msg) { const id = ++A.saveId; return withTimeout(new Promise(r => { A.waiting.set(id, r); A.sim.send({ ...msg, rq: id }); }), 4000, null); }   // rq, not id: commands use id for the project
const requestSave = () => ask({ t: 'save' });
// the whole page fills the screen; inside a frame that doesn't allow it, say how else
async function fullscreen() {
  const d = document, el = d.documentElement;
  try {
    if (d.fullscreenElement || d.webkitFullscreenElement) await (d.exitFullscreen || d.webkitExitFullscreen).call(d);
    else await (el.requestFullscreen || el.webkitRequestFullscreen).call(el, { navigationUI: 'hide' });
  } catch (e) { toast('Fullscreen isn’t allowed here. Your browser’s own fullscreen (F11) works instead.'); }
}
function cmd(op, args = {}) { return ask({ t: 'cmd', op, ...args }); }
const wrap = sim => ({ v: 4, day: Math.floor(sim.tick / DAY_TICKS) + 1, count: sim.cols.length, sim });
function ensureView(W) {
  if (!A.view) {
    A.view = new View(app, W);
    if (!A.view.G || !A.view.ok) { loader('This needs a browser with WebGL 2. ' + (A.view.G ? 'A shader did not compile.' : ''), 1); $('ldmsg').id = 'nogl'; return false; }
    A.panels = new Panels(A, { cmd, select, toast, pickArea, land, siteSelect, startPlace, showProject, useSug, wantRecs: on => { if (A.sim) A.sim.send({ t: 'recs', on }); if (!on) A.recs = null; }, wantSoc: on => { if (A.sim) A.sim.send({ t: 'soc', on }); if (!on) A.soc = null; } });
    A.stats = new Stats(A);
    A.news = new News(A, { select, showProject, setSpeed, toast, when, flyTo: (x, y) => { A.view.flyTo(x, y, Math.max(A.view.cam.z, 18)); A.follow = false; }, tab: t => A.panels.setTab(t) });
    A.guide = new Guide(A, { tab: t => A.panels.setTab(t) });
    hookInput();
  } else A.view.setWorld(W);
  if (!A.raf) A.raf = requestAnimationFrame(frame);
  return true;
}
function resetPeople() { if (A.news) A.news.reset(); A.skipping = false; A.held = []; A.chron = []; $('skipping').hidden = true; $('skipMenu').hidden = true; A.n = 0; A.arts = []; A.names = []; A.people = []; A.archive = []; A.ui = null; A.log = []; A.leads = new Set(); A.cur = A.prev = null; A.pos = new Float32Array(0); A.G = { n: 0, pos: new Float32Array(0), arts: [], names: [], sig: '' }; A.gcur = A.gprev = null; select(-1); }

// from orbit: the planet, and three places to land
function onSurvey(m) {
  A.W = { seed: m.seed, land: null, rock: m.rock, type: m.world.type, elev: m.world.elev, moist: m.world.moist };
  A.sites = m.sites; A.siteSel = 0; A.phase = 'orbit'; A.mode = 'landfall'; A.timing = m.timing; A.clock = null; resetPeople();
  A.pendingWear = []; A.pendingKnown = [];
  if (!ensureView(A.W)) return;
  A.panels.show(false); A.panels.orbit(A.sites, 0);
  $('sub').textContent = `Choosing where to land · seed ${m.seed}`;
  const V = A.view; V.cam.x = MAP / 2; V.cam.y = MAP / 2; V.cam.z = 1; V.clampCam();
  speedButtons();
  saveLocal({ v: 4, orbit: m.seed });   // a reload comes back to the same planet
  if (A.oldSave) { A.oldSave = false; setTimeout(() => toast('The colony from milestone 1 cannot continue in this version, so this is a new landing.'), 1500); }
}
function siteSelect(i) {
  if (A.phase !== 'orbit') return;
  A.siteSel = i; A.panels.orbit(A.sites, i);
  const V = A.view, s = A.sites[i], z = Math.max(V.zFit, Math.min(V.VW, V.VH) / 230), off = V.VW > 760 ? 190 / z : 0;
  V.flyTo(s.x - off, s.y + (V.VW > 760 ? 0 : 60 / z), z);
}
function land(i) {
  if (A.phase !== 'orbit') return;
  A.phase = 'landing'; A.panels.orbit(null);
  const s = A.sites[i]; A.view.flyTo(s.x + .5, s.y + 2, 14);
  A.sim.send({ t: 'land', site: i, season: A.season || 0 });
}

// the colony starts (after a landing, or from a save)
function onReady(m) {
  const W = { seed: m.seed, land: m.land, site: m.site, rock: m.rock, type: m.world.type, elev: m.world.elev, moist: m.world.moist, siteId: m.siteId };
  // what has been felled, cleared and quarried so far: the map is painted without it
  W.gone = new Map(Object.entries(m.gone || {}).map(([k, v]) => [+k, v])); W.quarry = new Map(Object.entries(m.quarry || {}).map(([k, v]) => [+k, v]));
  const landing = A.phase === 'landing' && A.view;
  A.W = W; A.retype = []; A.mode = m.mode; A.tag = m.tag; A.timing = { ...(A.timing || {}), ...m.timing };
  if (landing) A.view.land(W, m.patch);
  else { resetPeople(); if (!ensureView(W)) return; }
  setRoster(m.roster); A.ui = m.ui; A.log = m.log.slice(); A.hist = (m.hist || []).slice(); A.panels.logSeen = landing ? 0 : m.ui.logN;
  A.cur = { pos: m.pos, t: performance.now() }; A.prev = null; A.pos = new Float32Array(m.pos.length); A.pos.set(m.pos); A.gcur = { pos: m.gpos || new Float32Array(0), t: A.cur.t }; A.gprev = null; guestArts();
  A.clock = m.clock; A.phase = 'colony';
  for (const [k, d] of A.pendingWear) A.view.terrain.setWear(k, d); for (const [k, d] of A.pendingKnown) A.view.setKnown(k, d); A.pendingWear = []; A.pendingKnown = [];
  recolour(); A.panels.orbit(null); A.panels.show(true);
  A.panels.setTab(A.mode === 'landfall' && !A.ui.alive ? 'archive' : 'crews');
  $('sub').textContent = A.mode === 'stress' ? `Stress test · ${A.ui.alive} people · seed ${W.seed}` : `${A.tag || 'Landfall'} · seed ${W.seed}`;
  A.hold = true; A.sim.send({ t: 'speed', v: 0 });   // held until the map is painted and the lander is down
  A.lastSaveLocal = performance.now() - 20000; speedButtons();
}
function setRoster(r) {
  A.people = r.people; A.archive = r.archive; A.names = r.people.map(p => p.name);
  for (let i = 0; i < r.people.length; i++) if (!A.arts[i]) A.arts[i] = new PersonArt(r.people[i], A.ui && A.ui.p[i] ? A.ui.p[i][1] : -1, A.ui && A.ui.p[i] ? A.ui.p[i][8] : 30);
}
// people wear their crew's colour, so a move to another crew changes their clothes
function recolour() {
  const U = A.ui; if (!U) return;
  // and children grow, and hair greys
  for (let i = 0; i < A.arts.length; i++) { const k = U.p[i] ? U.p[i][1] : -1, y = U.p[i] ? U.p[i][8] : 30; if (A.arts[i].crew !== k || A.arts[i].key !== artKey(y)) { const w = A.arts[i].walk; A.arts[i] = new PersonArt(A.people[i], k, y); A.arts[i].walk = w; } }
  A.leads = new Set(U.crews.filter(c => !c.gone && c.lead >= 0).map(c => c.lead));
}
// visitors: drawn in their settlement's colours, made again whenever a different party is in
function guestArts() {
  const P = A.ui && A.ui.nb && A.ui.nb.party, sig = P ? P.seq + ':' + P.people.map(p => p.name).join() : '';
  if (!A.G) A.G = { n: 0, pos: new Float32Array(0), arts: [], names: [], sig: '' };
  if (A.G.sig === sig) return;
  A.G.sig = sig; A.G.arts = P ? P.people.map(p => new PersonArt({ look: p.look, coat: p.coat }, -1, p.age)) : []; A.G.names = P ? P.people.map(p => p.name) : []; A.G.place = P ? A.ui.nb.list.find(q => q.i === P.i)?.place || '' : '';
}
function onMarks(m) {
  const W = A.W; if (!W || !W.gone) return;
  const tiles = [];
  for (let i = 0; i < m.gone.length; i += 2) { const t = m.gone[i], n = m.gone[i + 1]; if (n < 0) { if (W.gone.delete(t)) tiles.push(t); continue; } if (!W.gone.has(t)) tiles.push(t); W.gone.set(t, n); }
  for (let i = 0; i < m.quarry.length; i += 2) W.quarry.set(m.quarry[i], m.quarry[i + 1]);
  if (tiles.length && A.view) A.view.terrain.propsGone(tiles);
  // burnt ground, and ground grown back: repainted in batches, not tile by tile
  if (m.ground && m.ground.length) { for (let i = 0; i < m.ground.length; i += 2) { W.type[m.ground[i]] = m.ground[i + 1]; A.retype.push(m.ground[i]); } }
  flushRetype();
}
function flushRetype() { if (A.retype.length && A.view && A.W && performance.now() - (A.retypeAt || 0) > 1500) { A.retypeAt = performance.now(); A.view.terrain.retype(A.W, A.retype); A.view.mmBase = A.view.minimapBase(); A.retype = []; } }
function onState(m) {
  if (A.phase !== 'colony') return;
  if (m.recs) A.recs = m.recs;
  if (m.soc) A.soc = m.soc;
  if (m.roster) setRoster(m.roster);
  A.ui = m.ui;
  if (m.hist) A.hist.push(...m.hist);
  if (m.chron) A.chron = m.chron;
  // while a skip runs, its news waits: the chronicle tells it afterwards
  if (m.log.length) { A.log.push(...m.log); if (A.log.length > 300) A.log.splice(0, A.log.length - 300); if (A.skipping) A.held.push(...m.log.filter(e => e.lvl)); else A.news.add(m.log); }
  flushRetype(); recolour(); guestArts(); A.panels.update(); A.news.alerts(A.ui); A.guide.update(A.ui); A.stats.update();
  if (A.projSel >= 0 && !A.ui.projects.some(p => p.id === A.projSel)) A.projSel = -1;
}

// ---------- the frame ----------
let lastFrame = performance.now(), keys = new Set();
function frame(now) {
  A.raf = requestAnimationFrame(frame);
  const dt = Math.min(.1, (now - lastFrame) / 1000); lastFrame = now;
  const V = A.view; if (!V || A.phase === 'boot') return;
  const T = V.terrain;
  if (!T.ready) { loader(A.phase === 'orbit' ? 'Mapping the planet from orbit' : 'Painting the map', .3 + T.progress * .7); T.paintOverviewStep(); if (T.ready) { $('loader').classList.add('gone'); if (A.phase === 'orbit') siteSelect(0); } return; }
  const t0 = performance.now();
  interpolate(now);
  V.step(dt);
  // keyboard panning and following
  const c = V.cam, sp = 650 / c.z * dt;
  const pan = (dx, dy) => { c.x += dx; c.y += dy; A.follow = false; V.fly = null; };
  if (keys.has('KeyA') || keys.has('ArrowLeft')) pan(-sp, 0); if (keys.has('KeyD') || keys.has('ArrowRight')) pan(sp, 0);
  if (keys.has('KeyW') || keys.has('ArrowUp')) pan(0, -sp); if (keys.has('KeyS') || keys.has('ArrowDown')) pan(0, sp);
  if (A.follow && A.sel >= 0 && A.sel < A.n) { c.x += (A.pos[A.sel * 4] - c.x) * Math.min(1, dt * 6); c.y += (A.pos[A.sel * 4 + 1] - c.y) * Math.min(1, dt * 6); }
  V.clampCam();
  const colony = A.phase === 'colony' && A.ui ? { seed: A.ui.seed, stakes: A.ui.stakes, crews: A.ui.crews, projects: A.ui.projects, stores: A.ui.stores, year: A.ui.year, F: A.ui.F, spots: A.ui.spots, hz: A.ui.hz, ctl: A.ui.ctl ?? -1, ord: A.ui.ord, day: A.clock ? A.clock.cal || A.clock.abs : 1 } : null;
  const hour = A.clock && A.phase === 'colony' ? A.clock.hour : 10.5;
  V.frame({ n: A.n, pos: A.pos, arts: A.arts, names: A.names, leads: A.leads, hour, time: now / 1000, sel: A.sel, hover: A.hover, budget: A.frames.length > 30 && avgMs() > 22 ? 1 : 2, colony, orbit: A.phase === 'orbit' ? { sites: A.sites, sel: A.siteSel } : null, pickAt: A.pickCrew >= 0 ? A.pickAt : null, place: A.place, projSel: A.projSel, thing: A.thing, ctlMark: A.ctlMark, G: A.phase === 'colony' ? A.G : null, ghover: A.ghover ?? -1 });
  if (A.hold && A.phase === 'colony' && !V.landing) { A.hold = false; setSpeed(A.speed || 1); if (V.anim) toast('The Seed is down. Choose who the fabricator prints first.'); }
  A.frames.push(now - (A.lastNow || now)); A.lastNow = now; if (A.frames.length > 120) A.frames.shift();
  A.cpuMs = (A.cpuMs || 0) * .9 + (performance.now() - t0) * .1;
  if (now - (A.lastHud || 0) > 250) { A.lastHud = now; hud(); V.drawMinimap({ n: A.n, pos: A.pos, arts: A.arts, G: A.phase === 'colony' ? A.G : null, orbit: A.phase === 'orbit' ? { sites: A.sites, sel: A.siteSel } : null, colony }); }
  autosave(now);
}
const avgMs = () => { const f = A.frames.slice(-30); return f.reduce((a, b) => a + b, 0) / Math.max(1, f.length); };
function interpolate(now) {
  interpGuests(now);
  const cur = A.cur; if (!cur) { A.n = 0; return; }
  if (A.pos.length !== cur.pos.length) { A.pos = new Float32Array(cur.pos.length); A.pos.set(cur.pos); }
  A.n = Math.min(cur.pos.length / 4, A.arts.length);
  const prev = A.prev, P = A.pos, n = A.n;
  if (!prev || prev.pos.length !== cur.pos.length) { P.set(cur.pos); return; }
  const span = Math.max(8, cur.t - prev.t), a = Math.min(1, (now - cur.t) / span), C = cur.pos, Q = prev.pos;
  for (let i = 0; i < n; i++) {
    const o = i * 4, x = Q[o] + (C[o] - Q[o]) * a, y = Q[o + 1] + (C[o + 1] - Q[o + 1]) * a;
    let da = C[o + 2] - Q[o + 2]; while (da > Math.PI) da -= 6.2832; while (da < -Math.PI) da += 6.2832;
    const moved = Math.hypot(x - P[o], y - P[o + 1]); if (moved < 2) A.arts[i].walk += moved * 9;
    P[o] = x; P[o + 1] = y; P[o + 2] = Q[o + 2] + da * a; P[o + 3] = C[o + 3];
  }
}

function interpGuests(now) {
  const G = A.G, cur = A.gcur; if (!G) return;
  if (!cur || cur.pos.length / 4 !== G.arts.length) { G.n = 0; return; }
  if (G.pos.length !== cur.pos.length) { G.pos = new Float32Array(cur.pos.length); G.pos.set(cur.pos); }
  G.n = G.arts.length;
  const prev = A.gprev, P = G.pos;
  if (!prev || prev.pos.length !== cur.pos.length) { P.set(cur.pos); return; }
  const a = Math.min(1, (now - cur.t) / Math.max(8, cur.t - prev.t)), C = cur.pos, Q = prev.pos;
  for (let i = 0; i < G.n; i++) {
    const o = i * 4, x = Q[o] + (C[o] - Q[o]) * a, y = Q[o + 1] + (C[o + 1] - Q[o + 1]) * a;
    let da = C[o + 2] - Q[o + 2]; while (da > Math.PI) da -= 6.2832; while (da < -Math.PI) da += 6.2832;
    const moved = Math.hypot(x - P[o], y - P[o + 1]); if (moved < 2) G.arts[i].walk += moved * 9;
    P[o] = x; P[o + 1] = y; P[o + 2] = Q[o + 2] + da * a; P[o + 3] = C[o + 3];
  }
}

// ---------- the clock and the performance readout ----------
function hud() {
  const ck = A.clock;
  A.music.setMood(moodFor(A.phase, ck ? ck.hour : 12));
  if (ck && A.phase === 'colony') {
    const h = Math.floor(ck.hour), mi = Math.floor((ck.hour - h) * 60);
    $('time').textContent = `${pad(h)}:${pad(mi)}`;
    $('date').innerHTML = `<b>Day ${((ck.day - 1) % 20) + 1} of ${SEASONS[ck.season]}</b>Year ${ck.year} · day ${ck.abs} since landing`;
    weather(A.ui && A.ui.year);
  } else { $('time').textContent = '--:--'; $('date').innerHTML = '<b>In orbit</b>Before landing'; $('wx').hidden = true; }
  const f = A.frames.slice(-30), ms = f.reduce((a, b) => a + b, 0) / Math.max(1, f.length), fps = ms ? 1000 / ms : 0, cls = fps >= 55 ? 'g' : fps >= 30 ? 'y' : 'x';
  for (const id of ['fps', 'fps2']) { const el = $(id); el.textContent = fps ? Math.round(fps) : '--'; el.className = cls; }
  if ($('perf').hidden) return;
  $('ms').textContent = `${ms.toFixed(1)} ms · draw ${(A.cpuMs || 0).toFixed(1)} ms`;
  const V = A.view, T = V.terrain, p = A.perf;
  $('pPeople').textContent = `${A.n} · ${V.stats.people} on screen`;
  $('pSim').textContent = A.phase !== 'colony' ? 'waiting for the landing' : p ? `${Math.round(p.tps)} ticks/s · ${p.tickMs.toFixed(2)} ms/tick` : (A.speed ? 'starting' : 'paused');
  $('pThread').textContent = A.thread;
  $('pPath').textContent = p ? `${p.paths.coarse + p.paths.local} searches · ${p.paths.ms.toFixed(0)} ms` : '-';
  $('pChunks').textContent = `${T.cached} of ${LAYERS} kept · ${NCH * NCH} in all`;
  $('pLights').textContent = `${V.stats.lights} lit of ${V.stats.lightsInView} in view`;
  $('pZoom').textContent = `${V.cam.z.toFixed(1)} px per tile`;
  $('pSaved').textContent = A.savedNote;
  spark();
}
// the weather chip: the temperature now and the day's weather, with the day's light and the cold to come
const WX_ICON = { clear: 'sun', cloud: 'cloud', fog: 'fog', rain: 'rain', storm: 'storm', snow: 'snow', blizzard: 'snow' };
const hhmm = h => `${pad(Math.floor(h))}:${pad(Math.floor((h % 1) * 60))}`;
function weather(Y) {
  const el = $('wx'); if (!Y || A.ui.mode === 'stress') { el.hidden = true; return; }
  el.hidden = false;
  const w = WX[Y.wx], hot = Math.round(Y.temp);
  const h = A.clock ? A.clock.hour : 12, dark = h < Y.dawn || h > Y.dusk, ic = WX_ICON[Y.wx] || 'sun';
  el.querySelector('use').setAttribute('href', '#i-' + (ic === 'sun' && dark ? 'moon' : ic));
  $('wxT').textContent = `${hot}°`; $('wxN').textContent = w.name + (Y.snap ? ' · cold snap' : '');
  el.className = w.out === 2 || Y.temp < -15 ? 'bad' : Y.temp < 0 ? 'cold' : '';
  el.title = `${w.name}, ${hot}°C${Y.snap ? ', a cold snap' : ''}. ${w.out === 2 ? 'Nobody works outside today. ' : w.out ? 'Work outside is risky today. ' : ''}Light from ${hhmm(Y.dawn)} to ${hhmm(Y.dusk)}. ` +
    (Y.season === 3 ? 'Deep cold: nothing grows.' : `Deep cold in ${Y.deepIn} day${Y.deepIn === 1 ? '' : 's'}.`) + (Y.snow > .1 ? ` Snow on the ground.` : '') + (Y.ice > .2 ? ' The water is freezing over.' : '') + (A.ui.hz ? (A.ui.hz.dry > .75 ? ' The ground is tinder dry: fires spread fast.' : A.ui.hz.dry > .5 ? ' The ground is dry: a fire would spread.' : '') + (A.ui.hz.lv > .5 ? ' The river is in flood.' : A.ui.hz.warn ? ' The river is rising.' : '') : '');
}
function spark() {
  const cv = $('spark'), g = cv.getContext('2d'), W = cv.width, H = cv.height, f = A.frames; g.clearRect(0, 0, W, H);
  g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = 1; for (const v of [16.7, 33.3]) { const y = H - v / 50 * H; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  if (f.length < 2) return; const step = W / 119;
  g.beginPath(); f.forEach((v, i) => { const x = i * step, y = H - Math.min(50, v) / 50 * H; i ? g.lineTo(x, y) : g.moveTo(x, y); });
  g.lineTo((f.length - 1) * step, H); g.lineTo(0, H); g.closePath(); g.fillStyle = 'rgba(127,211,143,.16)'; g.fill();
  g.beginPath(); f.forEach((v, i) => { const x = i * step, y = H - Math.min(50, v) / 50 * H; i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.strokeStyle = '#7fd38f'; g.lineWidth = 2; g.stroke();
}
function musicToggle(on) { const v = A.music.toggle(on); musicButton(); toast(v ? 'Music on.' : 'Music off.'); }
function musicButton() { const on = A.music.on; $('bMusic').classList.toggle('off', !on); $('bMusic').setAttribute('aria-pressed', on); $('musicTxt').textContent = on ? 'Music' : 'Music off'; }
function select(i, fly) {
  A.sel = i; A.follow = false; $('cFollow').textContent = 'Follow';
  if (i >= 0 && A.projSel >= 0) closeProject();
  if (i >= 0 && A.thing) A.thing = null;
  if (A.sim) A.sim.send({ t: 'watch', id: i });
  if (A.panels) A.panels.card();
  if (fly && i >= 0 && i < A.n && A.view) { const act = A.pos[i * 4 + 3] >> 1; if (!hidden(act)) A.view.flyTo(A.pos[i * 4], A.pos[i * 4 + 1], Math.max(A.view.cam.z, 22)); else toast(act === ACT.DEAD ? `${A.names[i]} is dead.` : `${A.names[i]} is indoors.`); }
}
// ---------- skipping ahead ----------
function skipMenu(on = $('skipMenu').hidden) {
  if (on && (A.phase !== 'colony' || A.skipping)) return;
  $('skipMenu').hidden = !on; $('bSkip').classList.toggle('on', on);
}
function startSkip(kind) { skipMenu(false); if (A.sim && A.phase === 'colony' && !A.skipping) A.sim.send({ t: 'skip', kind }); }
function stopSkip() { if (A.skipping && A.sim) { A.sim.send({ t: 'skipStop' }); $('skNote').textContent = 'Stopping…'; } }
function onSkip(m) {
  if (!A.skipping) { A.skipping = true; A.held = []; $('skipping').hidden = false; $('skNote').textContent = 'The colony lives on at full speed. It stops for anything that needs you.'; if (A.news && A.news.open) A.news.closeLetter(); }
  $('skBar').style.width = Math.round((m.at - m.from) / Math.max(1, m.to - m.from) * 100) + '%';
  const c = A.clock; if (c) $('skDate').textContent = `Day ${((c.day - 1) % 20) + 1} of ${SEASONS[c.season]}, year ${c.year}`;
}
function skipEnd(m) {
  A.skipping = false; $('skipping').hidden = true; A.speed = 0; speedButtons();
  // what stopped it first, then the chronicle on top, open
  const held = A.held; A.held = [];
  const stop = m.stop && held.find(e => e.n === m.stop), ch = held.filter(e => e.e === 'chronicle').pop();
  if (stop) A.news.push(stop);
  if (ch) A.news.show(ch);
}
function setSpeed(s) {
  if (A.skipping) { stopSkip(); return; }
  if (s > 0) A.lastSpeed = s; A.speed = s;
  if (A.sim && A.phase === 'colony' && !A.hold) A.sim.send({ t: 'speed', v: s });
  speedButtons();
}
function speedButtons() { const on = A.phase === 'colony'; document.querySelectorAll('.speeds button').forEach(b => { b.classList.toggle('on', on && +b.dataset.s === A.speed); b.disabled = !on; }); $('bSkip').disabled = !on || A.mode === 'stress'; }
function pickArea(crew) {
  A.pickCrew = crew; const cr = A.ui.crews[crew];
  $('pickTxt').textContent = `Click the map where the ${cr.name} crew should survey`; $('pickHint').hidden = false;
}
function endPick() { A.pickCrew = -1; A.pickAt = null; $('pickHint').hidden = true; }

// ---------- placing a building ----------
// Drawing: drag a rectangle on the map. A blueprint: the building follows the pointer, a click puts it down.
// Either way the Seed checks the plot and its loads, and a card shows the bill before anything is committed.
function startPlace(type, w, h, name, lv0 = 0) {
  if (A.phase !== 'colony' || !TYPES[type]) return;
  endPick(); select(-1);
  const was = A.view ? A.view.below : 0, lvs = levelsOf(type), lvl = TYPES[type].below ? (lvs.includes(lv0) ? lv0 : lvs.includes(was) ? was : lvs[0]) : 0;
  A.place = { type, w: w || 0, h: h || 0, fixed: !!w, name: name || '', x: null, y: null, side: 0, turned: false, check: null, locked: false, seq: 0, wasBelow: was, lvl };
  if (TYPES[type].below || TYPES[type].ground) belowView(lvl || 1);   // the Seed's soundings show where to dig
  $('placeTxt').textContent = w ? `Move the ${name || TYPES[type].name} where it should go and click to put it down` : `Drag on the map to draw the ${TYPES[type].name.toLowerCase()}: at least ${TYPES[type].min} by ${TYPES[type].min} tiles, at most ${TYPES[type].max} long`;
  // the Seed suggests a size for what the colony needs: it follows the pointer and a click puts it down; a drag still draws any size
  if (!w) cmd('sizeFor', { type }).then(r => {
    const P = A.place; if (!P || P.type !== type || !r || P.drag || P.locked) return;
    P.sug = r; P.w = r.w; P.h = r.h; A.panels.planCard(null);
    $('placeTxt').textContent = `The Seed suggests ${r.w} × ${r.h} tiles. ${r.why} Click to put it down, or drag to draw another size.`;
  });
  $('placeTurn').hidden = !!TYPES[type].open; $('plTurn').hidden = !!TYPES[type].open;
  $('placeTurn').textContent = TYPES[type].below ? 'Turn stairs (R)' : 'Turn door (R)'; $('plTurn').textContent = TYPES[type].below ? 'Turn stairs' : 'Turn door';
  $('placeHint').hidden = false; app.classList.add('placing');
  $('plKeep').checked = false; $('plName2').value = name || ''; delete $('plName2').dataset.auto;
  A.panels.planCard(null);
}
function endPlace() { if (A.place && (TYPES[A.place.type].below || TYPES[A.place.type].ground) && A.place.wasBelow != null) belowView(A.place.wasBelow); A.place = null; $('placeHint').hidden = true; app.classList.remove('placing'); A.panels.planCard(null); }
function placeRect(x, y, w, h) {
  const P = A.place; if (!P) return;
  if (P.x === x && P.y === y && P.w === w && P.h === h) return;
  P.x = x; P.y = y; P.w = w; P.h = h;
  if (!P.turned) P.side = facing(A.W, x, y, w, h);
  P.door = doorAt(P); checkPlace();
}
const doorAt = P => P.side === 0 ? { x: P.x + (P.w >> 1), y: P.y - 1 } : P.side === 1 ? { x: P.x + P.w, y: P.y + (P.h >> 1) } : P.side === 2 ? { x: P.x + (P.w >> 1), y: P.y + P.h } : { x: P.x - 1, y: P.y + (P.h >> 1) };
async function checkPlace() {
  const P = A.place; if (!P || P.x == null) return;
  const seq = ++P.seq, r = await cmd('plan', { type: P.type, x: P.x, y: P.y, w: P.w, h: P.h, side: P.side, lvl: P.lvl });
  if (A.place !== P || seq !== P.seq || !r) return;
  P.check = r; if (r.door) P.door = r.door;
  A.panels.planCard(P);
}
// back to the Seed's suggested size, centred where the drawn plot was
function useSug() {
  const P = A.place; if (!P || !P.sug || P.x == null) return;
  const cx = P.x + P.w / 2, cy = P.y + P.h / 2;
  placeRect(Math.round(cx - P.sug.w / 2), Math.round(cy - P.sug.h / 2), P.sug.w, P.sug.h);
}
function turnDoor() { const P = A.place; if (!P || TYPES[P.type].open) return; P.side = (P.side + 1) % 4; P.turned = true; P.door = doorAt(P); checkPlace(); }
async function confirmPlace() {
  const P = A.place; if (!P || !P.check || !P.check.ok) return;
  const keep = $('plKeep').checked, name = $('plName2').value.trim();
  const r = await cmd('place', { type: P.type, x: P.x, y: P.y, w: P.w, h: P.h, side: P.side, lvl: P.lvl, save: keep ? name || TYPES[P.type].name : undefined });
  if (r && r.ok) { P.wasBelow = null; endPlace(); A.projSel = r.id; A.panels.setTab('build'); toast(`Planned. ${TYPES[P.type].name} is on the project list${keep ? ', and saved as a blueprint' : ''}.`); }
  else toast(r && r.why ? r.why : 'That could not be planned just now.');
}
// the Build tab and the map agree on which project you are looking at
function showProject(id) {
  const p = A.ui && A.ui.projects.find(q => q.id === id); if (!p || !A.view) return;
  select(-1); A.projSel = id; A.thing = null; A.panels.sig = ''; A.panels.update();
  A.view.flyTo(p.x + p.w / 2, p.y + p.h / 2, Math.max(A.view.cam.z, 16)); A.follow = false;
}
function menu(on) { $('menu').hidden = !on; $('bMenu').classList.toggle('on', on); if (on) $('perf').hidden = true; }
function showThing(th) { select(-1); if (A.projSel >= 0) A.projSel = -1; A.thing = th; A.panels.update(); }
function closeThing() { A.thing = null; if (A.panels) A.panels.update(); }
function closeProject() { A.projSel = -1; if (A.panels) { A.panels.sig = ''; A.panels.update(); } }
function projectAt(wx, wy) {
  if (!A.ui) return null;
  const below = A.view ? A.view.below : 0, inR = (p, x, y, w, h) => wx >= x - .3 && wx < x + w + .3 && wy >= y - .3 && wy < y + h + .3;
  for (const p of A.ui.projects) {
    if (p.type === 'test') continue;
    // below ground, the rooms on the level in view and the shafts through it; on the surface, the buildings and the stairs of the shallow rooms
    if (p.below ? (below ? p.lvl === below && inR(p, p.x, p.y, p.w, p.h) : p.via == null && p.door && inR(p, p.door.x, p.door.y, 1, 1)) : (!below || p.type === 'shaft') && inR(p, p.x, p.y, p.w, p.h)) return p;
  }
  if (below) for (const p of A.ui.projects) if (p.below && p.lvl === below && p.via == null && p.door && inR(p, p.door.x, p.door.y, 1, 1)) return p;
  return null;
}
// the view below ground, where rooms are dug: on and off by the button or U, and on by itself while one is planned
function roofView(on) {
  const V = A.view; if (!V) return;
  V.inside = on === undefined ? !V.inside : !!on;
  $('bRoof').classList.toggle('on', V.inside); $('bRoof').setAttribute('aria-pressed', V.inside ? 'true' : 'false');
  $('bRoof').title = V.inside ? 'Roofs off: see inside buildings (I)' : 'Roofs on (I)';
}
// U goes down a level at a time and back up to the surface; the middle and the deep only once a lift shaft is planned
const LEVEL_TAG = ['', 'A few metres down', 'The middle, 30 m down, by lift shaft', 'The deep, over 100 m down, by lift shaft'];
function belowView(on) {
  const V = A.view; if (!V) return;
  const shaft = !!(A.ui && A.ui.projects.some(p => p.type === 'shaft'));
  V.below = on === undefined ? (V.below + 1) % (shaft ? 4 : 2) : on === true ? V.below || 1 : +on || 0;
  $('bBelow').classList.toggle('on', !!V.below); $('bBelow').setAttribute('aria-pressed', V.below ? 'true' : 'false');
  app.classList.toggle('below', !!V.below);
  $('belowTxt').textContent = LEVEL_TAG[V.below];
  for (const b of document.querySelectorAll('#belowLv button')) b.classList.toggle('on', +b.dataset.lv === V.below);
  const P = A.place;   // a room being planned moves with the view to a level it can go on
  if (P && TYPES[P.type].below && V.below && levelsOf(P.type).includes(V.below) && P.lvl !== V.below) { P.lvl = V.below; checkPlace(); }
}

// ---------- saving ----------
async function autosave(now) {
  if (A.busySave || A.phase !== 'colony' || A.hold) return;
  const dueLocal = now - A.lastSaveLocal > 30000, dueAcct = Store.db && now - A.lastSaveAcct > 60000;
  if (!dueLocal && !dueAcct) return;
  A.busySave = true;
  try {
    const sim = await requestSave(); if (!sim) return;
    const data = wrap(sim);
    if (dueLocal) { A.lastSaveLocal = now; if (saveLocal(data)) A.savedNote = 'this browser, ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
    if (dueAcct) { A.lastSaveAcct = now; if (await saveAccount(data)) A.savedNote = 'your account, ' + new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); }
  } finally { A.busySave = false; }
}
function newest(a, b) { if (!a) return b; if (!b) return a; return (a.savedAt || 0) >= (b.savedAt || 0) ? a : b; }
// milestone 2 colonies (version 2) carry on: their shelter becomes the first project of many
const isSave = d => d && d.v >= 2 && d.v <= 4 && d.sim && d.sim.v >= 2 && d.sim.v <= 7 && Array.isArray(d.sim.cols);
function startColony(opts) {
  A.phase = 'boot'; A.hold = false; endPick(); if (A.place) endPlace(); A.projSel = -1; A.thing = null; belowView(false);
  if (A.panels) { A.panels.show(false); A.panels.orbit(null); }
  $('loader').classList.remove('gone'); loader(opts.save ? 'Waking the colony' : 'Surveying the planet from orbit', .15);
  A.sim.send(opts.save ? { t: 'init', seed: opts.save.seed, save: opts.save } : { t: 'init', seed: opts.seed, mode: opts.mode || 'landfall', count: opts.count || 300 });
}

// ---------- input ----------
function hookInput() {
  const V = A.view, ptrs = new Map(); let drag = null, pinch = null;
  const local = e => { const r = app.getBoundingClientRect(); return [e.clientX - r.left, e.clientY - r.top]; };
  window.addEventListener('resize', () => V.resize());
  const tileAt = e => { const [wx, wy] = V.toWorld(...local(e)); return [Math.floor(wx), Math.floor(wy)]; };
  app.addEventListener('pointerdown', e => {
    if (e.target.closest(HUD + ',#pickHint,#placeHint')) return;
    app.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    // drawing a building: the left button (or one finger) draws, anything else still moves the map
    if (A.place && ptrs.size === 1 && e.button === 0 && !A.place.fixed) { const [x, y] = tileAt(e); A.place.drag = { x0: x, y0: y, still: !!A.place.sug }; A.place.locked = false; A.panels.planCard(null); if (A.place.sug) sugAt(e); else placeRect(x, y, 1, 1); return; }
    if (ptrs.size === 1) drag = { x: e.clientX, y: e.clientY, cx: V.cam.x, cy: V.cam.y, moved: 0 };
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: V.cam.z }; drag = null; }
  });
  app.addEventListener('pointermove', e => {
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (pinch && ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); V.zoomAt(pinch.z * d / pinch.d / V.cam.z, (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); return; }
    if (A.place && A.place.drag) { const [x, y] = tileAt(e), d = A.place.drag; if (d.still && x === d.x0 && y === d.y0) return; d.still = false; placeRect(Math.min(x, d.x0), Math.min(y, d.y0), Math.abs(x - d.x0) + 1, Math.abs(y - d.y0) + 1); return; }
    if (A.place && (A.place.fixed || A.place.sug) && !A.place.locked && !drag && !e.target.closest(HUD)) sugAt(e);
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
      if (drag.moved > 4) { app.classList.add('drag'); A.follow = false; V.fly = null; V.cam.x = drag.cx - dx / V.cam.z; V.cam.y = drag.cy - dy / V.cam.z; V.clampCam(); }
      return;
    }
    if (e.target.closest(HUD)) { A.hover = -1; return; }
    const [sx, sy] = local(e);
    if (A.pickCrew >= 0) A.pickAt = V.toWorld(sx, sy);
    A.hover = A.phase === 'colony' ? pick(sx, sy) : -1; A.ghover = A.phase === 'colony' && A.hover < 0 ? pickGuest(sx, sy) : -1;
    // a hand over anything that opens a card when clicked
    let can = A.hover >= 0 || A.ghover >= 0;
    if (!can && A.phase === 'colony' && !A.place && A.pickCrew < 0) { const [wx, wy] = V.toWorld(sx, sy); can = !!(thingAt(A, V, wx, wy) || projectAt(wx, wy)); }
    app.classList.toggle('can', can);
  });
  // a blueprint or the suggested size, centred on the pointer
  const sugAt = e => { const P = A.place, [wx, wy] = V.toWorld(...local(e)), w = P.fixed ? P.w : P.sug.w, h = P.fixed ? P.h : P.sug.h; placeRect(Math.round(wx - w / 2), Math.round(wy - h / 2), w, h); };
  const up = e => {
    ptrs.delete(e.pointerId); app.classList.remove('drag');
    if (A.place && A.place.drag) { A.place.drag = null; A.place.locked = true; A.panels.planCard(A.place); drag = null; return; }
    if (drag && drag.moved <= 4 && e.button !== 2) click(...local(e));
    if (ptrs.size < 2) pinch = null; drag = null;
  };
  app.addEventListener('pointerup', up); app.addEventListener('pointercancel', up);
  app.addEventListener('wheel', e => { if (e.target.closest(HUD)) return; e.preventDefault(); V.zoomAt(Math.exp(-e.deltaY * .0016), ...local(e)); }, { passive: false });
  window.addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input,select')) return;
    keys.add(e.code);
    const colony = A.phase === 'colony';
    if (e.code === 'Space') { e.preventDefault(); if (colony && !(A.news && A.news.open)) setSpeed(A.speed ? 0 : A.lastSpeed); }
    else if (e.code === 'Digit1' && colony) setSpeed(1); else if (e.code === 'Digit2' && colony) setSpeed(2); else if (e.code === 'Digit3' && colony) setSpeed(3);
    else if (e.code === 'Tab') { e.preventDefault(); V.labels = !V.labels; }
    else if (e.code === 'KeyH') goHome();
    else if (e.code === 'KeyF' && A.sel >= 0) { A.follow = !A.follow; $('cFollow').textContent = A.follow ? 'Stop following' : 'Follow'; }
    else if (e.code === 'KeyQ' && colony) A.panels.toggleTab('archive');
    else if (e.code === 'KeyC' && colony) A.panels.toggleTab('crews');
    else if (e.code === 'KeyL' && colony) A.panels.toggleTab('log');
    else if (e.code === 'KeyG' && colony) A.panels.toggleTab('life');
    else if (e.code === 'KeyK' && colony) A.panels.toggleTab('records');
    else if (e.code === 'KeyP' && colony) A.panels.toggleTab('society');
    else if (e.code === 'KeyV' && colony) A.panels.toggleTab('nb');
    else if (e.code === 'KeyT' && colony) A.stats.show();
    else if (e.code === 'KeyB' && colony) A.panels.toggleTab('build');
    else if (e.code === 'KeyR' && A.place) turnDoor();
    else if (e.code === 'KeyM') musicToggle();
    else if (e.code === 'KeyN' && colony) skipMenu();
    else if (e.code === 'KeyU' && colony) belowView();
    else if (e.code === 'KeyI' && colony) roofView();
    else if (e.code === 'F11') { e.preventDefault(); fullscreen(); }
    else if ((e.code === 'Escape' || e.code === 'Enter') && A.news && A.news.open) { e.preventDefault(); A.news.closeLetter(); }
    else if (e.code === 'Escape' && A.ui && A.ui.ctl >= 0 && !A.place) toggleCtl(A.ui.ctl);
    else if (e.code === 'Escape' && !$('skipMenu').hidden) skipMenu(false);
    else if (e.code === 'Escape') { if (A.stats && A.stats.open) A.stats.show(false); else if (A.place) endPlace(); else if (A.pickCrew >= 0) endPick(); else if (!$('newdlg').hidden) $('newdlg').hidden = true; else if (!$('menu').hidden) menu(false); else if (A.projSel >= 0) closeProject(); else if (A.thing) closeThing(); else if (A.sel >= 0) select(-1); else if (A.panels && !A.panels.min) A.panels.fold(true); }
    else if (e.code === 'Equal' || e.code === 'NumpadAdd') V.zoomAt(1.25, V.VW / 2, V.VH / 2);
    else if (e.code === 'Minus' || e.code === 'NumpadSubtract') V.zoomAt(.8, V.VW / 2, V.VH / 2);
  });
  window.addEventListener('keyup', e => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());
  document.querySelectorAll('.speeds button').forEach(b => b.addEventListener('click', () => setSpeed(+b.dataset.s)));
  $('bHome').onclick = goHome;
  $('bSkip').onclick = () => skipMenu(); $('skStop').onclick = stopSkip;
  document.querySelectorAll('[data-skip]').forEach(b => b.onclick = () => startSkip(b.dataset.skip));
  $('bBelow').onclick = () => belowView(); $('bRoof').onclick = () => roofView(); $('belowUp').onclick = () => belowView(0);
  for (const b of document.querySelectorAll('#belowLv button')) b.onclick = () => belowView(+b.dataset.lv);
  $('bFull').onclick = () => fullscreen();
  const fsIcon = () => { const on = !!(document.fullscreenElement || document.webkitFullscreenElement); $('bFull').querySelector('use').setAttribute('href', on ? '#i-unfull' : '#i-full'); $('bFull').title = on ? 'Leave fullscreen (F11)' : 'Fullscreen (F11)'; };
  document.addEventListener('fullscreenchange', fsIcon); document.addEventListener('webkitfullscreenchange', fsIcon);
  $('bMusic').onclick = () => musicToggle();
  $('vol').value = Math.round(A.music.vol * 100); musicButton();
  $('vol').oninput = e => { A.music.setVolume(e.target.value / 100); if (!A.music.on && e.target.value > 0) musicToggle(true); };
  $('fpsChip').onclick = () => { $('perf').hidden = !$('perf').hidden; menu(false); };
  $('bMenu').onclick = () => menu($('menu').hidden); $('menuX').onclick = () => menu(false);
  $('pickCancel').onclick = endPick;
  $('placeCancel').onclick = endPlace; $('plCancel').onclick = endPlace; $('placeTurn').onclick = turnDoor; $('plTurn').onclick = turnDoor; $('plGo').onclick = confirmPlace;
  $('plName2').oninput = e => { delete e.target.dataset.auto; $('plKeep').checked = true; };
  $('cClose').onclick = () => select(-1);
  $('bStats').onclick = () => A.stats.show();
  $('bClose').onclick = () => { if (A.thing) closeThing(); else closeProject(); };
  $('bList').onclick = () => { if (A.thing) { const c = A.panels.thingInfo; if (c && c.btn) A.panels.setTab(c.btn.tab); return; } const id = A.projSel; A.panels.setTab('build:list'); showProject(id); };
  $('bCancel').onclick = () => { if (A.projSel >= 0) A.panels.askCancel(A.projSel); };
  $('bPause').onclick = () => { const p = A.ui && A.ui.projects.find(q => q.id === A.projSel); if (p) cmd('projPause', { id: p.id, on: !p.paused }); };
  $('cCtl').onclick = () => toggleCtl(A.sel); $('ctlEnd').onclick = () => { if (A.ui && A.ui.ctl >= 0) toggleCtl(A.ui.ctl); };
  // right-click gives the person under direct orders their next order
  app.addEventListener('contextmenu', e => {
    e.preventDefault();
    if (A.phase !== 'colony' || !A.ui || A.ui.ctl < 0 || A.place || e.target.closest(HUD)) return;
    ctlOrderAt(...local(e));
  });
  $('cFollow').onclick = () => { A.follow = !A.follow; $('cFollow').textContent = A.follow ? 'Stop following' : 'Follow'; };
  const mm = $('mm');
  const mmGo = e => { const r = mm.getBoundingClientRect(); V.fly = null; V.cam.x = (e.clientX - r.left) / r.width * MAP; V.cam.y = (e.clientY - r.top) / r.height * MAP; A.follow = false; V.clampCam(); };
  mm.addEventListener('pointerdown', e => { e.stopPropagation(); mmGo(e); mm.setPointerCapture(e.pointerId); mm.onpointermove = mmGo; });
  mm.addEventListener('pointerup', () => { mm.onpointermove = null; });
  $('bSave').onclick = async () => {
    if (A.phase !== 'colony') return toast('There is no colony to save until the Seed has landed.');
    const sim = await requestSave(); if (!sim) return toast('The colony could not be saved just now.');
    const w = wrap(sim), r = await exportFile(w, `landfall-day-${w.day}.json`);
    toast(r === 'saved' ? 'Saved to a file.' : r === 'declined' ? 'Not saved: the download was declined.' : 'Saving to a file did not work in this browser.');
  };
  $('bLoad').onclick = async () => { const d = await importFile(); if (!isSave(d)) return toast(d && d.sim ? 'That colony is from an older version and cannot continue.' : 'That file is not a saved colony.'); startColony({ save: d.sim }); toast('Loading the colony from the file.'); };
  let nMode = 'landfall';
  document.querySelectorAll('#nMode button').forEach(b => b.onclick = () => { nMode = b.dataset.m; document.querySelectorAll('#nMode button').forEach(x => x.classList.toggle('on', x === b)); });
  $('bNew').onclick = () => { menu(false); $('nSeed').value = String(rand6()); $('newdlg').hidden = false; };
  $('nCancel').onclick = () => { $('newdlg').hidden = true; };
  $('nGo').onclick = () => { const s = parseInt($('nSeed').value, 10) || 1; $('newdlg').hidden = true; startColony({ seed: s, mode: nMode, count: 300 }); };
}
function click(sx, sy) {
  const V = A.view;
  if (A.phase === 'orbit') {
    let best = -1, bd = Math.max(34, 40 * V.cam.z);
    A.sites.forEach((s, i) => { const [X, Y] = V.toScreen(s.x, s.y), d = Math.hypot(X - sx, Y - sy); if (d < bd) { bd = d; best = i; } });
    if (best >= 0) siteSelect(best);
    return;
  }
  if (A.phase !== 'colony') return;
  if (A.place) {   // a blueprint goes down where it is; a drawn building was handled on release
    if (A.place.fixed) { A.place.locked = !A.place.locked; A.panels.planCard(A.place.locked ? A.place : null); if (!A.place.locked) { const [wx, wy] = V.toWorld(sx, sy); placeRect(Math.round(wx - A.place.w / 2), Math.round(wy - A.place.h / 2), A.place.w, A.place.h); } }
    return;
  }
  if (A.pickCrew >= 0) {
    const [wx, wy] = V.toWorld(sx, sy), x = Math.floor(wx), y = Math.floor(wy), crew = A.pickCrew;
    if (x < 0 || y < 0 || x >= MAP || y >= MAP) return;
    cmd('crewSet', { crew, target: y * MAP + x }); endPick(); toast(`The ${A.ui.crews[crew].name} crew will survey around there.`);
    return;
  }
  const who = pick(sx, sy), gi = who < 0 ? pickGuest(sx, sy) : -1;
  if (gi >= 0) { A.panels.setTab('nb'); toast(`${A.G.names[gi]}, from ${A.G.place}.`); return; }
  if (who < 0) {
    const [wx, wy] = V.toWorld(sx, sy), th = thingAt(A, V, wx, wy), p = th && th.k !== 'life' && th.k !== 'tree' && th.k !== 'boulder' && th.k !== 'bush' ? null : projectAt(wx, wy);
    if (p) { select(-1); A.projSel = p.id; A.thing = null; A.panels.sig = ''; A.panels.update(); return; }
    if (th) { showThing(th); return; }
  }
  if (A.projSel >= 0) closeProject();
  if (A.thing) closeThing();
  select(who);
}
function pickGuest(sx, sy) {
  const V = A.view, G = A.G, [wx, wy] = V.toWorld(sx, sy); let best = -1, bd = Math.max(.7, 9 / V.cam.z);
  if (!G || V.below) return -1;
  for (let i = 0; i < G.n; i++) { if (hidden(G.pos[i * 4 + 3] >> 1)) continue; const d = Math.hypot(G.pos[i * 4] - wx, G.pos[i * 4 + 1] - wy); if (d < bd) { bd = d; best = i; } }
  return best;
}
function pick(sx, sy) {
  const V = A.view, [wx, wy] = V.toWorld(sx, sy); let best = -1, bd = Math.max(.7, 9 / V.cam.z);
  for (let i = 0; i < A.n; i++) { const act = A.pos[i * 4 + 3] >> 1; if (hidden(act)) continue; const d = Math.hypot(A.pos[i * 4] - wx, A.pos[i * 4 + 1] - wy); if (d < bd) { bd = d; best = i; } }
  return best;
}
// ---------- direct orders in an emergency ----------
async function toggleCtl(i) {
  if (i < 0 || !A.ui) return;
  const mine = A.ui.ctl === i, r = await cmd(mine ? 'ctlEnd' : 'ctlTake', { person: i });
  if (r && r.ok === false && r.why) toast(r.why);
  else if (!mine && r && r.ok) toast(`You are directing ${A.people[i].name}. Right-click to give orders.`);
}
// what a right-click means: someone hurt under the pointer is helped, flames are beaten at, anywhere else is walked to
async function ctlOrderAt(sx, sy) {
  const U = A.ui, V = A.view, i = U.ctl, who = pick(sx, sy), [wx, wy] = V.toWorld(sx, sy), x = Math.floor(wx), y = Math.floor(wy);
  if (x < 0 || y < 0 || x >= MAP || y >= MAP) return;
  const t = y * MAP + x, hz = U.hz, hurt = who >= 0 && who !== i && U.p[who] && (U.p[who][6] & (2 | 256 | 512 | 16384));
  const fire = hz && (hz.fire.some(f => Math.abs(f % MAP - x) <= 2 && Math.abs((f / MAP | 0) - y) <= 2) || U.projects.some(p => p.fire && x >= p.x - 1 && x <= p.x + p.w && y >= p.y - 1 && y <= p.y + p.h));
  const k = hurt ? 'help' : fire ? 'fire' : 'go';
  const r = await cmd('ctlOrder', { person: i, k, t, who: hurt ? who : -1 });
  if (r && r.ok === false && r.why) toast(r.why);
  else A.ctlMark = { x: wx, y: wy, k, at: performance.now() };
}
function goHome() { const V = A.view; if (!V || !V.W.land) return; V.flyTo(V.W.land.x + .5, V.W.land.y + 3, Math.max(V.cam.z, 24)); A.follow = false; }

// ---------- start ----------
async function boot() {
  loader('Looking for your colony', .04);
  await withTimeout(initStorage(), 2500);
  const acct = await withTimeout(loadAccount(), 3000, null), local = loadLocal(), found = newest(local, acct), d = found && found.data;
  loader('Generating the planet', .1);
  A.sim = await startSim(onSim);
  A.thread = A.sim.mode === 'thread' ? 'its own thread' : 'the page (no worker)';
  if (isSave(d)) { A.savedNote = 'continued from ' + (found === acct ? 'your account' : 'this browser'); startColony({ save: d.sim }); }
  else { if (d && !d.orbit) A.oldSave = true; startColony({ seed: d && d.orbit ? d.orbit : rand6() }); }
}
window.addEventListener('visibilitychange', async () => {
  if (document.hidden && A.phase === 'colony' && !A.hold) { const sim = await requestSave(); if (sim) saveLocal(wrap(sim)); }
});
// a handle for the automated checks
window.__colony = {
  get state() {
    const V = A.view;
    return { phase: A.phase, ready: A.phase === 'colony' && !!V && V.terrain.ready && !A.hold, painted: !!V && V.terrain.ready, n: A.n, clock: A.clock, perf: A.perf, thread: A.thread, fps: A.frames.length ? 1000 / avgMs() : 0, cam: V && { ...V.cam }, chunks: V && V.terrain.cached, paint: V && V.terrain.stats, lights: V && V.stats, timing: A.timing, sel: A.sel, saved: A.savedNote, sites: A.sites, ui: A.ui && { alive: A.ui.alive, seed: A.ui.seed, shelter: A.ui.shelter, food: A.ui.food, known: A.ui.known, stakes: A.ui.stakes.length, crews: A.ui.crews.map(c => ({ name: c.name, work: c.work, members: c.members.length, target: c.target, proj: c.proj })), stats: A.ui.stats, projects: A.ui.projects.map(p => ({ id: p.id, name: p.name, type: p.type, stage: p.stage, done: p.done, powered: p.powered, wait: p.wait })), stores: A.ui.stores, power: A.ui.power, mat: A.ui.mat, year: A.ui.year, F: A.ui.F && { total: A.ui.F.total, usable: A.ui.F.usable, seen: A.ui.F.life.filter(Boolean).length, tested: A.ui.F.life.filter(l => l && l.tested).length } }, place: A.place && { type: A.place.type, x: A.place.x, y: A.place.y, w: A.place.w, h: A.place.h, ok: A.place.check && A.place.check.ok, why: A.place.check && A.place.check.why }, log: A.log.slice(-6).map(e => e.m) };
  },
  setSpeed, select, goHome, requestSave, startColony, siteSelect, land, cmd, toast, startPlace, placeRect, confirmPlace, endPlace, showProject, get music() { return A.music.state; }, musicToggle,
  tab: t => A.panels.setTab(t), panels: () => A.panels, news: () => A.news,
  who: i => ({ name: A.people[i] && A.people[i].name, row: A.ui && A.ui.p[i], x: A.pos[i * 4], y: A.pos[i * 4 + 1] }),
  look(x, y, z) { const V = A.view; V.fly = null; V.cam.x = x; V.cam.y = y; if (z) V.cam.z = z; V.clampCam(); },
};
boot();

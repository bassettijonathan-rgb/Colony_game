// The page: starts the simulation thread, draws what it reports, and turns input into camera moves
// and commands. Milestone 1 lands 300 colonists by default, as a stress test of the foundations.
import { startSim } from './ui/simclient.js';
import { View } from './render/view.js';
import { PersonArt, crewColour } from './render/people.js';
import { MODE_NAME } from './core/sim.js';
import { SEASONS, SPEEDS, MAP, NCH } from './core/consts.js';
import { LAYERS } from './render/terrain.js';
import { Store, initStorage, saveLocal, loadLocal, saveAccount, loadAccount, exportFile, importFile } from './ui/storage.js';

const $ = id => document.getElementById(id);
const app = $('app');
const A = {
  sim: null, view: null, speed: 1, lastSpeed: 1, n: 0, prev: null, cur: null, pos: null, arts: [], names: [], leads: [], crews: [], people: [],
  clock: null, perf: null, sel: -1, hover: -1, follow: false, started: 0, frames: [], lastSaveLocal: 0, lastSaveAcct: 0, saveId: 0, waiting: new Map(), savedNote: 'not yet', thread: '-', timing: null, ready: false
};
const pad = n => String(n).padStart(2, '0');
const toast = (m) => { const t = $('toast'); t.textContent = m; t.classList.add('on'); clearTimeout(toast.h); toast.h = setTimeout(() => t.classList.remove('on'), 2600); };
const loader = (msg, p) => { if (msg) $('ldmsg').textContent = msg; if (p !== undefined) $('ldbar').style.width = Math.round(p * 100) + '%'; };
const withTimeout = (p, ms, v) => Promise.race([p, new Promise(r => setTimeout(() => r(v), ms))]);

// ---------- talking to the simulation ----------
function onSim(m) {
  if (m.t === 'ready') return onReady(m);
  if (m.t === 'snap') { A.prev = A.cur; A.cur = { pos: m.pos, t: performance.now() }; A.clock = m.clock; A.perf = m.perf; return; }
  if (m.t === 'wear') { if (A.view && A.view.terrain) for (const [k, d] of m.chunks) A.view.terrain.setWear(k, d); else A.pendingWear = (A.pendingWear || []).concat(m.chunks); return; }
  if (m.t === 'saved') { const r = A.waiting.get(m.id); if (r) { A.waiting.delete(m.id); r(m.data); } }
}
function requestSave() { const id = ++A.saveId; return withTimeout(new Promise(r => { A.waiting.set(id, r); A.sim.send({ t: 'save', id }); }), 4000, null); }
const wrap = sim => ({ v: 1, day: Math.floor(sim.tick / 21600) + 1, count: sim.count, sim });

function onReady(m) {
  const W = { seed: m.seed, land: m.land, rock: m.rock, type: m.world.type, elev: m.world.elev, moist: m.world.moist };
  A.n = m.people.length; A.people = m.people; A.crews = m.crews;
  A.names = m.people.map(p => p.name); A.arts = m.people.map(p => new PersonArt(p, p.crew)); A.leads = m.crews.map(c => c.lead);
  A.cur = { pos: m.pos, t: performance.now() }; A.prev = null; A.pos = new Float32Array(m.pos.length); A.pos.set(m.pos);
  A.clock = m.clock; A.timing = m.timing; A.sel = -1; A.follow = false; $('card').hidden = true;
  if (!A.view) {
    A.view = new View(app, W);
    if (!A.view.G || !A.view.ok) { loader('This needs a browser with WebGL 2. ' + (A.view.G ? 'A shader did not compile.' : ''), 1); $('ldmsg').id = 'nogl'; return; }
    hookInput();
  } else A.view.setWorld(W);
  if (A.pendingWear) { for (const [k, d] of A.pendingWear) A.view.terrain.setWear(k, d); A.pendingWear = null; }
  $('sub').textContent = `${A.n} colonists in ${A.crews.length} crews · seed ${W.seed}`;
  A.ready = true; A.started = performance.now();
  A.sim.send({ t: 'speed', v: 0 });   // held until the map is painted
  if (!A.raf) A.raf = requestAnimationFrame(frame);
}

// ---------- the frame ----------
let lastFrame = performance.now(), keys = new Set();
function frame(now) {
  A.raf = requestAnimationFrame(frame);
  const dt = Math.min(.1, (now - lastFrame) / 1000); lastFrame = now;
  const V = A.view; if (!V || !A.ready) return;
  const T = V.terrain;
  if (!T.ready) { loader('Painting the map', .3 + T.progress * .7); T.paintOverviewStep(); if (T.ready) { $('loader').classList.add('gone'); setSpeed(A.speed); } return; }
  const t0 = performance.now();
  interpolate(now, dt);
  // keyboard panning and following
  const c = V.cam, sp = 650 / c.z * dt;
  if (keys.has('KeyA') || keys.has('ArrowLeft')) { c.x -= sp; A.follow = false; } if (keys.has('KeyD') || keys.has('ArrowRight')) { c.x += sp; A.follow = false; }
  if (keys.has('KeyW') || keys.has('ArrowUp')) { c.y -= sp; A.follow = false; } if (keys.has('KeyS') || keys.has('ArrowDown')) { c.y += sp; A.follow = false; }
  if (A.follow && A.sel >= 0) { c.x += (A.pos[A.sel * 4] - c.x) * Math.min(1, dt * 6); c.y += (A.pos[A.sel * 4 + 1] - c.y) * Math.min(1, dt * 6); }
  V.clampCam();
  const hour = A.clock ? A.clock.hour : 7;
  V.frame({ n: A.n, pos: A.pos, arts: A.arts, names: A.names, leads: A.leads, hour, time: now / 1000, sel: A.sel, hover: A.hover, budget: A.frames.length > 30 && avgMs() > 22 ? 1 : 2 });
  A.frames.push(now - (A.lastNow || now)); A.lastNow = now; if (A.frames.length > 120) A.frames.shift();
  A.cpuMs = (A.cpuMs || 0) * .9 + (performance.now() - t0) * .1;
  if (now - (A.lastHud || 0) > 250) { A.lastHud = now; hud(); V.drawMinimap({ n: A.n, pos: A.pos, arts: A.arts }); }
  autosave(now);
}
const avgMs = () => { const f = A.frames.slice(-30); return f.reduce((a, b) => a + b, 0) / Math.max(1, f.length); };
function interpolate(now, dt) {
  const cur = A.cur; if (!cur) return;
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

// ---------- the panels ----------
function hud() {
  const ck = A.clock; if (ck) {
    const h = Math.floor(ck.hour), mi = Math.floor((ck.hour - h) * 60);
    $('time').textContent = `${pad(h)}:${pad(mi)}`;
    $('date').innerHTML = `<b>Day ${((ck.day - 1) % 20) + 1} of ${SEASONS[ck.season]}</b>Year ${ck.year} · day ${ck.day} of 80`;
  }
  const f = A.frames.slice(-30), ms = f.reduce((a, b) => a + b, 0) / Math.max(1, f.length), fps = ms ? 1000 / ms : 0;
  const el = $('fps'); el.textContent = fps ? Math.round(fps) : '--'; el.className = fps >= 55 ? 'g' : fps >= 30 ? 'y' : 'x';
  $('ms').textContent = `${ms.toFixed(1)} ms · draw ${(A.cpuMs || 0).toFixed(1)} ms`;
  const V = A.view, T = V.terrain, p = A.perf;
  $('pPeople').textContent = `${A.n} · ${V.stats.people} on screen`;
  $('pSim').textContent = p ? `${Math.round(p.tps)} ticks/s · ${p.tickMs.toFixed(2)} ms/tick` : (A.speed ? 'starting' : 'paused');
  $('pThread').textContent = A.thread;
  $('pPath').textContent = p ? `${p.paths.coarse + p.paths.local} searches · ${p.paths.ms.toFixed(0)} ms` : '-';
  $('pChunks').textContent = `${T.cached} of ${LAYERS} kept · ${NCH * NCH} in all`;
  $('pLights').textContent = `${V.stats.lights} lit of ${V.stats.lightsInView} in view`;
  $('pZoom').textContent = `${V.cam.z.toFixed(1)} px per tile`;
  $('pSaved').textContent = A.savedNote;
  spark();
  if (A.sel >= 0) { const mode = A.pos[A.sel * 4 + 3] >> 1; $('cJob').textContent = MODE_NAME[mode]; }
  document.querySelectorAll('.speeds button').forEach(b => b.classList.toggle('on', +b.dataset.s === A.speed));
}
function spark() {
  const cv = $('spark'), g = cv.getContext('2d'), W = cv.width, H = cv.height, f = A.frames; g.clearRect(0, 0, W, H);
  g.strokeStyle = 'rgba(255,255,255,.08)'; g.lineWidth = 1; for (const v of [16.7, 33.3]) { const y = H - v / 50 * H; g.beginPath(); g.moveTo(0, y); g.lineTo(W, y); g.stroke(); }
  if (f.length < 2) return; const step = W / 119;
  g.beginPath(); f.forEach((v, i) => { const x = i * step, y = H - Math.min(50, v) / 50 * H; i ? g.lineTo(x, y) : g.moveTo(x, y); });
  g.lineTo((f.length - 1) * step, H); g.lineTo(0, H); g.closePath(); g.fillStyle = 'rgba(127,211,143,.16)'; g.fill();
  g.beginPath(); f.forEach((v, i) => { const x = i * step, y = H - Math.min(50, v) / 50 * H; i ? g.lineTo(x, y) : g.moveTo(x, y); }); g.strokeStyle = '#7fd38f'; g.lineWidth = 2; g.stroke();
}
function select(i) {
  A.sel = i; A.follow = false; const card = $('card');
  if (i < 0) { card.hidden = true; return; }
  const p = A.people[i], cr = A.crews[p.crew], col = crewColour(p.crew);
  $('cName').textContent = p.name; $('cSw').style.background = `rgb(${col.map(v => v | 0).join(',')})`;
  $('cCrew').textContent = `${cr.name} crew${cr.lead === i ? ', crew lead' : ''} · ${cr.members.length} people`;
  $('cJob').textContent = MODE_NAME[A.pos[i * 4 + 3] >> 1]; card.hidden = false; $('cFollow').textContent = 'Follow';
}
function setSpeed(s) { if (s > 0) A.lastSpeed = s; A.speed = s; A.sim && A.sim.send({ t: 'speed', v: s }); document.querySelectorAll('.speeds button').forEach(b => b.classList.toggle('on', +b.dataset.s === s)); }

// ---------- saving ----------
async function autosave(now) {
  if (A.busySave || !A.ready) return;
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
function startColony(opts) {
  A.ready = false; A.cur = A.prev = null; A.lastSaveLocal = performance.now() - 20000;
  if (A.view) { $('loader').classList.remove('gone'); loader('Landing', .15); }
  A.sim.send(opts.save ? { t: 'init', seed: opts.save.seed, save: opts.save } : { t: 'init', seed: opts.seed, count: opts.count });
}

// ---------- input ----------
function hookInput() {
  const V = A.view, ptrs = new Map(); let drag = null, pinch = null;
  window.addEventListener('resize', () => V.resize());
  app.addEventListener('pointerdown', e => {
    if (e.target.closest('.glass')) return;
    app.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (ptrs.size === 1) drag = { x: e.clientX, y: e.clientY, cx: V.cam.x, cy: V.cam.y, moved: 0 };
    if (ptrs.size === 2) { const [a, b] = [...ptrs.values()]; pinch = { d: Math.hypot(a[0] - b[0], a[1] - b[1]), z: V.cam.z }; drag = null; }
  });
  app.addEventListener('pointermove', e => {
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, [e.clientX, e.clientY]);
    if (pinch && ptrs.size === 2) { const [a, b] = [...ptrs.values()]; const d = Math.hypot(a[0] - b[0], a[1] - b[1]); const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2; V.zoomAt(pinch.z * d / pinch.d / V.cam.z, mx, my); return; }
    if (drag) {
      const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.moved = Math.max(drag.moved, Math.hypot(dx, dy));
      if (drag.moved > 4) { app.classList.add('drag'); A.follow = false; V.cam.x = drag.cx - dx / V.cam.z; V.cam.y = drag.cy - dy / V.cam.z; V.clampCam(); }
      return;
    }
    if (e.target.closest('.glass')) { A.hover = -1; return; }
    const r = app.getBoundingClientRect(); A.hover = pick(e.clientX - r.left, e.clientY - r.top);
  });
  const up = e => {
    ptrs.delete(e.pointerId); app.classList.remove('drag');
    if (drag && drag.moved <= 4) { const r = app.getBoundingClientRect(); select(pick(e.clientX - r.left, e.clientY - r.top)); }
    if (ptrs.size < 2) pinch = null; drag = null;
  };
  app.addEventListener('pointerup', up); app.addEventListener('pointercancel', up);
  app.addEventListener('wheel', e => { if (e.target.closest('.glass')) return; e.preventDefault(); const r = app.getBoundingClientRect(); V.zoomAt(Math.exp(-e.deltaY * .0016), e.clientX - r.left, e.clientY - r.top); }, { passive: false });
  window.addEventListener('keydown', e => {
    if (e.target.closest && e.target.closest('input')) return;
    keys.add(e.code);
    if (e.code === 'Space') { e.preventDefault(); setSpeed(A.speed ? 0 : A.lastSpeed); }
    else if (e.code === 'Digit1') setSpeed(1); else if (e.code === 'Digit2') setSpeed(2); else if (e.code === 'Digit3') setSpeed(3);
    else if (e.code === 'Tab') { e.preventDefault(); V.labels = !V.labels; }
    else if (e.code === 'KeyH') goHome();
    else if (e.code === 'KeyF' && A.sel >= 0) A.follow = !A.follow;
    else if (e.code === 'Escape') select(-1);
    else if (e.code === 'Equal' || e.code === 'NumpadAdd') V.zoomAt(1.25, V.VW / 2, V.VH / 2);
    else if (e.code === 'Minus' || e.code === 'NumpadSubtract') V.zoomAt(.8, V.VW / 2, V.VH / 2);
  });
  window.addEventListener('keyup', e => keys.delete(e.code));
  window.addEventListener('blur', () => keys.clear());
  document.querySelectorAll('.speeds button').forEach(b => b.addEventListener('click', () => setSpeed(+b.dataset.s)));
  $('bHome').onclick = goHome;
  $('cClose').onclick = () => select(-1);
  $('cFollow').onclick = () => { A.follow = !A.follow; $('cFollow').textContent = A.follow ? 'Stop following' : 'Follow'; };
  const mm = $('mm');
  const mmGo = e => { const r = mm.getBoundingClientRect(); V.cam.x = (e.clientX - r.left) / r.width * MAP; V.cam.y = (e.clientY - r.top) / r.height * MAP; A.follow = false; V.clampCam(); };
  mm.addEventListener('pointerdown', e => { e.stopPropagation(); mmGo(e); mm.setPointerCapture(e.pointerId); mm.onpointermove = mmGo; });
  mm.addEventListener('pointerup', () => { mm.onpointermove = null; });
  $('bSave').onclick = async () => { const sim = await requestSave(); if (!sim) return toast('The colony could not be saved just now.'); const r = await exportFile(wrap(sim), `landfall-day-${wrap(sim).day}.json`); toast(r === 'saved' ? 'Saved to a file.' : r === 'declined' ? 'Not saved: the download was declined.' : 'Saving to a file did not work in this browser.'); };
  $('bLoad').onclick = async () => { const d = await importFile(); if (!d || !d.sim || !d.sim.cols) return toast('That file is not a saved colony.'); startColony({ save: d.sim }); toast('Loading the colony from the file.'); };
  $('bNew').onclick = () => { $('nSeed').value = String(Math.floor(Math.random() * 900000) + 100000); $('newdlg').hidden = false; };
  $('nCancel').onclick = () => { $('newdlg').hidden = true; };
  document.querySelectorAll('#nCount button').forEach(b => b.onclick = () => document.querySelectorAll('#nCount button').forEach(x => x.classList.toggle('on', x === b)));
  $('nGo').onclick = () => { const n = +document.querySelector('#nCount .on').dataset.n, s = parseInt($('nSeed').value, 10) || 1; $('newdlg').hidden = true; startColony({ seed: s, count: n }); };
}
function pick(sx, sy) {
  const V = A.view, [wx, wy] = V.toWorld(sx, sy); let best = -1, bd = Math.max(.7, 9 / V.cam.z);
  for (let i = 0; i < A.n; i++) { const d = Math.hypot(A.pos[i * 4] - wx, A.pos[i * 4 + 1] - wy); if (d < bd) { bd = d; best = i; } }
  return best;
}
function goHome() { const V = A.view; V.cam.x = V.W.land.x + .5; V.cam.y = V.W.land.y + 3; V.cam.z = Math.max(V.cam.z, 24); A.follow = false; V.clampCam(); }

// ---------- start ----------
async function boot() {
  loader('Looking for your colony', .04);
  await withTimeout(initStorage(), 2500);
  const acct = await withTimeout(loadAccount(), 3000, null), local = loadLocal(), found = newest(local, acct);
  loader('Generating the planet', .1);
  A.sim = await startSim(onSim);
  A.thread = A.sim.mode === 'thread' ? 'its own thread' : 'the page (no worker)';
  const save = found && found.data && found.data.sim;
  if (save) { A.savedNote = 'continued from ' + (found === acct ? 'your account' : 'this browser'); startColony({ save }); }
  else startColony({ seed: Math.floor(Math.random() * 900000) + 100000, count: 300 });
}
window.addEventListener('visibilitychange', async () => {
  if (document.hidden && A.ready) { const sim = await requestSave(); if (sim) saveLocal(wrap(sim)); }
});
// a handle for the automated checks
window.__colony = {
  get state() { const V = A.view; return { ready: A.ready && !!V && V.terrain.ready, n: A.n, clock: A.clock, perf: A.perf, thread: A.thread, fps: A.frames.length ? 1000 / avgMs() : 0, cam: V && { ...V.cam }, chunks: V && V.terrain.cached, painted: V && V.terrain.stats, lights: V && V.stats, timing: A.timing, sel: A.sel, saved: A.savedNote }; },
  setSpeed, select, goHome, requestSave, startColony,
  look(x, y, z) { const V = A.view; V.cam.x = x; V.cam.y = y; if (z) V.cam.z = z; V.clampCam(); },
};
boot();

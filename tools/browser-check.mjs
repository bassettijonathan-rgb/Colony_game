// Opens the built page in headless Chromium and plays the first hours: the orbital survey, choosing a site,
// the landing, printing the founders, crews at work, the evening, then saving and continuing. Then a colony a
// bot has played for nine days (workshop, solar field, commons and more), by day and by night, the Build tab,
// drawing a new building on the map, and a colony saved by the previous version carrying on.
// NODE_PATH must reach a Playwright install: NODE_PATH=$(npm root -g) node tools/browser-check.mjs
// Software rendering makes the frame rate here meaningless; it only proves nothing breaks.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');
import { readFileSync, existsSync } from 'node:fs';
import { registerSealed } from './sealed.mjs';
registerSealed();
const { landColony, botBuild } = await import('../src/bot/runner.js');
const { DAY_TICKS, HOUR } = await import('../src/core/consts.js');

const file = 'file://' + resolve('dist/colony.html');
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined, args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on('pageerror', e => errors.push(String(e.stack || e)));
page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push(m.type() + ': ' + m.text()); });
const shot = n => page.screenshot({ path: `${process.env.SHOTS || '.'}/${n}.png` });
const st = () => page.evaluate(() => window.__colony.state);
const wait = ms => page.waitForTimeout(ms);
const until = async (fn, ms, arg) => { const t = Date.now(); while (Date.now() - t < ms) { if (await page.evaluate(fn, arg)) return true; await wait(250); } return false; };
const hourAt = () => page.evaluate(() => { const c = window.__colony.state.clock; return c ? c.abs * 24 + c.hour : 0; });
const untilHour = async (h, ms) => until(h => { const c = window.__colony.state.clock; return c && c.abs * 24 + c.hour >= h; }, ms, h);
const brief = s => ({ phase: s.phase, n: s.n, clock: s.clock && `day ${s.clock.abs} ${s.clock.hour.toFixed(2)}`, ui: s.ui && { alive: s.ui.alive, feed: s.ui.seed.feed, queue: s.ui.seed.queue.length, shelter: s.ui.shelter, food: Math.round(s.ui.food), known: s.ui.known, stakes: s.ui.stakes, crews: s.ui.crews } });

await page.goto(file);
let ok = await until(() => window.__colony && window.__colony.state.phase === 'orbit' && window.__colony.state.painted, 120000);
let s = await st();
console.log('orbit:', ok, { sites: s.sites && s.sites.map(x => x.tag), thread: s.thread });
await wait(2500); await shot('01-orbit');
await page.click('#orbit .site[data-site="1"]'); await wait(2500); await shot('02-site');
await page.click('#orbit [data-land]');
ok = await until(() => window.__colony.state.phase === 'colony', 60000); await wait(900); await shot('03-landing');
ok = await until(() => window.__colony.state.ready, 60000);
s = await st(); console.log('landed:', ok, brief(s));
await wait(1500); await shot('04-archive');
const chosen = await page.evaluate(() => document.querySelectorAll('#sideBody .f.sel').length);
await page.click('#sideBody [data-act="print"]'); await wait(800);
s = await st(); console.log('printing:', { chosen, queue: s.ui.seed.queue.length, printing: !!s.ui.seed.printing });
// fastest until the first founders are awake and at work
await page.evaluate(() => window.__colony.setSpeed(3));
await until(() => window.__colony.state.ui.alive >= 3, 240000);
const h0 = await hourAt(); await untilHour(h0 + 2, 120000);
await page.evaluate(() => { window.__colony.select(0, true); });
await wait(2500); s = await st(); console.log('first founders:', brief(s));
await shot('05-card');
await page.evaluate(() => window.__colony.select(-1)); await page.evaluate(() => window.__colony.tab('crews'));
// a survey area marked on the map
const crews = s.ui.crews; const sv = crews.findIndex(c => c.work === 'survey');
if (sv >= 0) { await page.evaluate(sv => window.__colony.cmd('crewSet', { crew: sv, target: (window.__colony.state.ui ? 0 : 0) + 330 * 600 + 300 }), sv); }
await page.evaluate(() => window.__colony.goHome()); await wait(3000); await shot('06-crews');
// the next evening, by the fire
const day = (await st()).clock.abs;
await until(d => { const c = window.__colony.state.clock; return c && c.abs > d && c.hour > 19.6; }, 400000, day);
await page.evaluate(() => window.__colony.setSpeed(1)); await page.evaluate(() => window.__colony.goHome()); await wait(4000);
s = await st(); console.log('evening:', { ...brief(s), lights: s.lights });
await shot('07-evening');
// on to the shelter's frame, then a look at the surveyed ground from higher up
await page.evaluate(() => window.__colony.setSpeed(3));
await until(() => { const u = window.__colony.state.ui; return u && u.shelter.stage >= 3; }, 400000);
await until(() => { const c = window.__colony.state.clock; return c && c.hour > 10 && c.hour < 16; }, 300000);
await page.evaluate(() => { const S = window.__colony.state; window.__colony.goHome(); });
await wait(3000); s = await st(); console.log('building:', brief(s)); await shot('08-shelter');
await page.evaluate(() => { const V = window.__colony; V.look(V.state.cam.x, V.state.cam.y, 4); }); await wait(3000); await shot('09-survey');
await page.evaluate(() => window.__colony.tab('log')); await wait(600); await shot('10-log');
// save, reload, continue
const before = await page.evaluate(async () => { const d = await window.__colony.requestSave(); return { tick: d.tick, size: JSON.stringify(d).length }; });
await page.evaluate(async () => { const d = await window.__colony.requestSave(); localStorage.setItem('colony-run', JSON.stringify({ savedAt: Date.now(), data: { v: 2, day: 1, count: d.cols.length, sim: d } })); });
await page.reload();
ok = await until(() => window.__colony && window.__colony.state.ready, 120000);
s = await st(); console.log('continued:', ok, { tick: s.clock.tick, savedTick: before.tick, saveKB: (before.size / 1024).toFixed(0), saved: s.saved, alive: s.ui.alive });
await wait(3000); await shot('11-continued');

// a colony the bot has built up for nine days, loaded into the page
const grown = landColony(4242); for (let i = 0; i < 9 * DAY_TICKS; i++) { grown.sim.tick(); if (grown.sim.S.tick % DAY_TICKS === Math.round(6 * HOUR)) botBuild(grown.sim); }
const loadSave = async d => { await page.evaluate(d => localStorage.setItem('colony-run', JSON.stringify({ savedAt: Date.now() + 1e6, data: { v: 3, day: 1, count: d.cols.length, sim: d } })), d); await page.reload(); return until(() => window.__colony && window.__colony.state.ready, 120000); };
ok = await loadSave(grown.sim.serialize());
s = await st(); console.log('grown colony:', ok, { day: s.clock.abs, projects: s.ui.projects.map(p => `${p.name} ${p.done ? (p.powered || p.type === 'solar' ? 'done' : 'dark') : 'stage ' + (p.stage + 1)}${p.wait ? ' (' + p.wait + ')' : ''}`), power: s.ui.power, yard: s.ui.stores.yard });
await page.evaluate(() => window.__colony.setSpeed(0));
const mid = await page.evaluate(() => { const ps = window.__colony.state.ui.projects.filter(p => p.type !== 'test'); const a = window.__colony.panels().A.ui.projects.filter(p => p.type !== 'test'); let x = 0, y = 0; for (const p of a) { x += p.x + p.w / 2; y += p.y + p.h / 2; } return [x / a.length, y / a.length, ps.length]; });
await page.evaluate(m => window.__colony.look(m[0], m[1], 15), mid); await wait(3500); await shot('12-buildings');
await page.evaluate(() => window.__colony.goHome()); await page.evaluate(() => { const V = window.__colony; V.look(V.state.cam.x, V.state.cam.y, 30); }); await wait(3000); await shot('13-yard');
await page.evaluate(() => window.__colony.tab('build')); await wait(800); await shot('14-build-tab');
// draw a dormitory on the nearest good plot, through the same steps a player takes
const plot = await page.evaluate(async () => {
  const C = window.__colony, L = C.panels().A.W.land;
  for (let r = 12; r < 40; r += 2) for (let a = 0; a < 6.28; a += .4) {
    const x = Math.round(L.x + Math.cos(a) * r - 3), y = Math.round(L.y + Math.sin(a) * r - 4), q = await C.cmd('plan', { type: 'dorm', x, y, w: 6, h: 8, side: 0 });
    if (q && q.ok) return { x, y };
  }
  return null;
});
if (plot) {
  await page.evaluate(p => { const C = window.__colony; C.startPlace('dorm'); C.placeRect(p.x, p.y, 6, 8); C.panels().A.place.locked = true; C.look(p.x + 3, p.y + 4, 18); }, plot);
  await wait(2500); await page.evaluate(() => window.__colony.panels().planCard(window.__colony.panels().A.place)); await wait(600); await shot('15-placing');
  await page.evaluate(() => window.__colony.confirmPlace()); await wait(1500);
  s = await st(); console.log('placed:', { plot, last: s.ui.projects[s.ui.projects.length - 1] });
} else console.log('placed: NO PLOT FOUND');
// the same colony after dark
await page.evaluate(() => window.__colony.setSpeed(3));
await until(() => { const c = window.__colony.state.clock; return c && c.hour > 20.2; }, 300000);
await page.evaluate(() => window.__colony.setSpeed(0)); await page.evaluate(m => window.__colony.look(m[0], m[1], 13), mid); await wait(3000); await shot('16-buildings-night');
// a colony saved by milestone 2 carries on in this version
const v2 = process.env.V2_SAVE;
if (v2 && existsSync(v2)) {
  ok = await loadSave(JSON.parse(readFileSync(v2, 'utf8')));
  s = await st(); console.log('milestone 2 save:', ok, { day: s.clock.abs, projects: s.ui.projects.map(p => `${p.name} ${p.done ? 'done' : 'stage ' + (p.stage + 1)}`), alive: s.ui.alive });
  await page.evaluate(() => window.__colony.goHome()); await wait(3000); await shot('17-v2-save');
}
console.log('errors:', errors.length ? errors.slice(0, 10) : 'none');
await browser.close();

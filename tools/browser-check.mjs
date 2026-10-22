// Opens the built page in headless Chromium and plays the first hours: the orbital survey, choosing a site,
// the landing, printing the founders, crews at work, the evening, then saving and continuing.
// NODE_PATH must reach a Playwright install: NODE_PATH=$(npm root -g) node tools/browser-check.mjs
// Software rendering makes the frame rate here meaningless; it only proves nothing breaks.
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

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
console.log('errors:', errors.length ? errors.slice(0, 10) : 'none');
await browser.close();

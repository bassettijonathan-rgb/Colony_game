// Opens the built page in headless Chromium and checks that it lands, draws, walks, saves and continues.
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
const until = async (fn, ms) => { const t = Date.now(); while (Date.now() - t < ms) { if (await page.evaluate(fn)) return true; await wait(250); } return false; };

await page.goto(file);
const ok = await until(() => window.__colony && window.__colony.state.ready, 120000);
let s = await st();
console.log('landed:', ok, { n: s.n, thread: s.thread, timing: s.timing && Object.fromEntries(Object.entries(s.timing).map(([k, v]) => [k, Math.round(v)])) });
await wait(8000); s = await st();
console.log('morning', { hour: s.clock && s.clock.hour.toFixed(2), chunks: s.chunks, painted: s.painted, lights: s.lights, fps: Math.round(s.fps), perf: s.perf && { tps: Math.round(s.perf.tps), tickMs: +s.perf.tickMs.toFixed(3) } });
await shot('01-landing');
// fast forward, then look at people out on the map
await page.evaluate(() => window.__colony.setSpeed(3)); await wait(10000);
await page.evaluate(() => { const S = window.__colony.state; window.__colony.select(5); });
await page.keyboard.press('KeyF'); await wait(5000);
s = await st(); console.log('following', { hour: s.clock.hour.toFixed(2), sel: s.sel, cam: s.cam && { x: Math.round(s.cam.x), y: Math.round(s.cam.y) }, chunks: s.chunks });
await shot('02-following');
// zoomed out over the whole map
await page.evaluate(() => window.__colony.look(300, 300, 1.4)); await wait(4000);
await shot('03-whole-map');
// the evening: everyone walks home with lanterns
await page.evaluate(() => window.__colony.goHome());
await until(() => { const c = window.__colony.state.clock; return c && c.hour > 19.3; }, 240000);
await page.evaluate(() => window.__colony.setSpeed(1)); await wait(5000);
s = await st(); console.log('evening', { hour: s.clock.hour.toFixed(2), lights: s.lights, fps: Math.round(s.fps) });
await shot('04-evening');
// save, reload, continue
const before = await page.evaluate(async () => { const d = await window.__colony.requestSave(); return { tick: d.tick, size: JSON.stringify(d).length }; });
await page.evaluate(async () => { window.dispatchEvent(new Event('visibilitychange')); });
await page.evaluate(async () => { const d = await window.__colony.requestSave(); localStorage.setItem('colony-run', JSON.stringify({ savedAt: Date.now(), data: { v: 1, day: 1, count: d.count, sim: d } })); });
await page.reload();
await until(() => window.__colony && window.__colony.state.ready, 120000);
s = await st(); console.log('continued', { tick: s.clock.tick, savedTick: before.tick, saveKB: (before.size / 1024).toFixed(0), saved: s.saved });
await wait(3000); await shot('05-continued');
console.log('errors:', errors.length ? errors.slice(0, 10) : 'none');
await browser.close();

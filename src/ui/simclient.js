// Starts the simulation on its own thread. If the browser will not start a worker, the same code runs
// on the page instead, a little slower but otherwise identical.
import WORKER_SRC from 'virtual:worker-src';
import { createSimCore } from '../sim/host.js';

export function startSim(onMessage) {
  return new Promise(resolve => {
    let done = false;
    const fallback = (why) => {
      if (done) return; done = true;
      const core = createSimCore((m) => setTimeout(() => onMessage(m), 0));
      resolve({ mode: 'page', why, send: m => setTimeout(() => core.handle(m), 0) });
    };
    let w;
    try { w = new Worker(URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }))); }
    catch (e) { fallback(String(e && e.message || e)); return; }
    const timer = setTimeout(() => { try { w.terminate(); } catch (e) { /* gone */ } fallback('no answer from the worker'); }, 3000);
    w.onerror = (e) => { clearTimeout(timer); try { w.terminate(); } catch (er) { /* gone */ } fallback(e.message || 'worker error'); };
    w.onmessage = (e) => {
      if (e.data.t === 'hello') { if (done) return; done = true; clearTimeout(timer); w.onerror = null; resolve({ mode: 'thread', send: m => w.postMessage(m) }); return; }
      onMessage(e.data);
    };
  });
}

// Entry point of the simulation thread.
import { createSimCore } from './host.js';

const core = createSimCore((m, transfer) => self.postMessage(m, transfer || []));
self.onmessage = e => core.handle(e.data);
self.postMessage({ t: 'hello' });

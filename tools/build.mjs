// Bundles the game into one HTML page: dist/colony.html. The simulation thread is bundled first and
// carried inside the page as text, so the page can start it as a worker without any other file.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sealedPath, sealedPlugin, usingStub } from './sealed.mjs';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const min = process.argv.includes('--min');
const common = { bundle: true, format: 'iife', write: false, target: 'es2020', minify: min, legalComments: 'none' };
const worker = await build({ ...common, entryPoints: [resolve(root, 'src/sim/worker.js')], plugins: [sealedPlugin] });
const workerSrc = worker.outputFiles[0].text;
const workerPlugin = { name: 'worker-src', setup(b) {
  b.onResolve({ filter: /^virtual:worker-src$/ }, () => ({ path: 'worker-src', namespace: 'worker' }));
  b.onLoad({ filter: /.*/, namespace: 'worker' }, () => ({ contents: 'export default ' + JSON.stringify(workerSrc), loader: 'js' }));
} };
const out = await build({ ...common, entryPoints: [resolve(root, 'src/main.js')], plugins: [sealedPlugin, workerPlugin] });
const js = out.outputFiles[0].text.replace(/<\/script/gi, '<\\/script');
const page = readFileSync(resolve(root, 'src/ui/page.html'), 'utf8').replace('/*BUNDLE*/', () => js);
mkdirSync(resolve(root, 'dist'), { recursive: true });
writeFileSync(resolve(root, 'dist/colony.html'), page);
console.log(`dist/colony.html ${(page.length / 1024).toFixed(0)} KB (simulation thread ${(workerSrc.length / 1024).toFixed(0)} KB) · sealed texts from ${usingStub ? 'the stand-ins' : sealedPath}`);

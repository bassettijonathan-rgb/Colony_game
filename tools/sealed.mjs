// Where the sealed texts come from: a local src/sealed/ if present, then the colony's sealed folder in the
// project (outside this public repository), else the stand-ins.
import { existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { register } from 'node:module';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// SEALED_STUB=1 forces the stand-ins
const STUB = resolve(root, 'src/sealed-stub/texts.js');
export const sealedPath = process.env.SEALED_STUB ? STUB : [resolve(root, 'src/sealed/texts.js'), '/mnt/project-files/game-design/sealed/game-src/texts.js', STUB].find(p => existsSync(p));
export const usingStub = sealedPath === STUB;
// for esbuild
export const sealedPlugin = { name: 'sealed', setup(b) { b.onResolve({ filter: /sealed\/texts\.js$/ }, () => ({ path: sealedPath })); } };
// for plain node: send imports of sealed/texts.js to the same file
export function registerSealed() {
  const hooks = `export async function resolve(spec, ctx, next) { if (/sealed\\/texts\\.js$/.test(spec)) return { url: ${JSON.stringify(pathToFileURL(sealedPath).href)}, shortCircuit: true }; return next(spec, ctx); }`;
  register('data:text/javascript,' + encodeURIComponent(hooks));
}

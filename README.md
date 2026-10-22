# Colony game

A RimWorld-like colony game that runs in the browser. The whole game builds into one HTML page.

## Commands

```
npm install
npm run build     # dist/colony.html
npm run sim       # determinism, save round trip and bot colonies (node tools/sim.mjs [worlds] [days] [colonists])
NODE_PATH=$(npm root -g) node tools/browser-check.mjs   # headless Chromium: lands, draws, walks, saves, continues
```

## Layout

- `src/core`: plain-data simulation with no browser APIs. World generation (`world.js`), pathfinding (`path.js`: chunk-level graph, local A*, flow fields), the colony itself (`sim.js`), constants and the seeded rng.
- `src/sim`: runs the simulation in a Web Worker (`worker.js`) through a small message protocol (`host.js`). The page falls back to running it in place if the worker cannot start.
- `src/render`: WebGL2 renderer in the Lumen style. Map chunks are painted once into texture arrays; each frame lights height, shadows and up to 24 lights.
- `src/ui`: the page, the HUD, the connection to the simulation and saving (this browser, the player's account, a file).
- `src/bot`: headless bot runner used by `tools/sim.mjs` to balance and test without players.
- `src/sealed-stub`: stand-ins for texts the player must not read. The real ones live outside this public repository and are never committed.

## Numbers

Map 600 x 600 tiles in 32-tile chunks; 30 simulation ticks per second at normal speed; one day lasts 12 minutes at normal speed.

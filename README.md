# Colony game

A RimWorld-like colony game that runs in the browser. The whole game builds into one HTML page.

## Commands

```
npm install
npm run build     # dist/colony.html
npm run sim       # determinism, save round trip and bot colonies (node tools/sim.mjs [worlds] [days] [landfall|stress] [colonists])
POLICY=careless npm run sim   # the same bots playing with long shifts and no safety rules
NODE_PATH=$(npm root -g) node tools/browser-check.mjs   # headless Chromium: orbit, landing, printing, crews, evening, save and continue
```

## Layout

- `src/core`: plain-data simulation with no browser APIs. World generation, landing sites and the landing (`world.js`), pathfinding (`path.js`: chunk-level graph, local A*, flow fields), the colony (`sim.js`), people's days, minds and ties (`life.js`), the fabricator, crews, the shelter and the player's commands (`work.js`), the founders' archive (`founders.js`), constants and the seeded rng.
- `src/sim`: runs the simulation in a Web Worker (`worker.js`) through a small message protocol (`host.js`). The page falls back to running it in place if the worker cannot start.
- `src/render`: WebGL2 renderer in the Lumen style. Map chunks are painted once into texture arrays; each frame lights height, shadows and up to 24 lights.
- `src/ui`: the page, the panels (orbital survey, archive, crews, log, person card), the connection to the simulation and saving (this browser, the player's account, a file).
- `src/bot`: headless bot runner used by `tools/sim.mjs` to balance and test without players.
- `src/sealed-stub`: stand-ins for texts the player must not read. The real ones live outside this public repository and are never committed.

## Numbers

Map 600 x 600 tiles in 32-tile chunks; 30 simulation ticks per second at normal speed; one day lasts 12 minutes at normal speed.

## How a game starts (milestone 2)

1. From orbit, the Seed offers three landing sites with what it knows and doesn't know about each.
2. It lands where you choose; the burn clears a ring and the shelter plot and the cook fire are laid out.
3. The fabricator has feedstock for six bodies out of the forty minds in the archive. You choose who, about four hours each.
4. Founders wake with bodies, skills, traits, memories and old ties. The Seed sorts them into a shelter crew and a survey crew until you change anything.
5. Crews have a lead, a shift and rules (back by dark, nobody walks alone, stop when exhausted). Survey crews reveal the ground and plant ten sensor stakes; the shelter crew turns the lander's modules into a twelve-bunk shelter in five stages.
6. Fatigue, strain and trust in the Seed rise and fall with the work and the rules; bonds form at work and at meals.

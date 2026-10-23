# Colony game

A RimWorld-like colony game that runs in the browser. The whole game builds into one HTML page.

## Commands

```
npm install
npm run build     # dist/colony.html
npm run sim       # determinism, save round trip and bot colonies (node tools/sim.mjs [worlds] [days] [landfall|stress] [colonists])
POLICY=careless npm run sim   # the same bots playing with long shifts and no safety rules
NODE_PATH=$(npm root -g) node tools/browser-check.mjs   # headless Chromium: orbit, landing, printing, crews, evening, save and continue, a built-up colony, placing a building
V2_SAVE=old.json ...  browser-check.mjs                 # also continue a colony saved by milestone 2
```

## Layout

- `src/core`: plain-data simulation with no browser APIs. World generation, landing sites and the landing (`world.js`), pathfinding (`path.js`: chunk-level graph, local A*, flow fields), the colony (`sim.js`), people's days, minds and ties (`life.js`), the fabricator, crews, building projects and the player's commands (`work.js`), what can be built and what it costs, load checks, power and stock (`build.js`), the founders' archive (`founders.js`), constants and the seeded rng.
- `src/sim`: runs the simulation in a Web Worker (`worker.js`) through a small message protocol (`host.js`). The page falls back to running it in place if the worker cannot start.
- `src/render`: WebGL2 renderer in the Lumen style. Map chunks are painted once into texture arrays (and again when trees come down); each frame lights height, shadows and up to 24 lights. Buildings, the yard, stumps and quarried rock are drawn stage by stage in `buildings.js`.
- `src/ui`: the page and its game interface (a top bar with the colony's stock and the clock, colonist portraits, open projects, a dock that opens the archive, crews, build and log windows, cards for the person or building you pick and for a building being placed, a menu with saving, music, news settings and the controls), the news (`news.js`: event cards, letters that pause the game, standing alerts and first-time explanations), the connection to the simulation, saving (this browser, the player's account, a file) and the music (`music.js`).
- `src/bot`: headless bot runner used by `tools/sim.mjs` to balance and test without players.
- `src/sealed-stub`: stand-ins for texts the player must not read. The real ones live outside this public repository and are never committed.

## Numbers

Map 600 x 600 tiles in 32-tile chunks; 30 simulation ticks per second at normal speed; one day lasts 12 minutes at normal speed.

## Music

Generated live with Web Audio, with no audio files: a pad changing chord every two bars, a bass note, a plucked melody built from a short motif that repeats with small changes and rests now and then, and an occasional bell, through a generated reverb and an echo. The mood follows the clock (orbit, dawn, day, evening, night) and changes only on a chord change. It starts on the first click or key, as browsers require. `M` or the music button turns it on and off; the slider sets the volume; both are kept in this browser.

## How a game starts (milestone 2)

1. From orbit, the Seed offers three landing sites with what it knows and doesn't know about each.
2. It lands where you choose; the burn clears a ring and the shelter plot and the cook fire are laid out.
3. The fabricator has feedstock for six bodies out of the forty minds in the archive. You choose who, about four hours each.
4. Founders wake with bodies, skills, traits, memories and old ties. The Seed sorts them into a shelter crew and a survey crew until you change anything.
5. Crews have a lead, a shift and rules (back by dark, nobody walks alone, stop when exhausted). Survey crews reveal the ground and plant ten sensor stakes; the shelter crew turns the lander's modules into a twelve-bunk shelter in five stages.
6. Fatigue, strain and trust in the Seed rise and fall with the work and the rules; bonds form at work and at meals.

## Building (milestone 3)

1. The Build tab (`B`) lists stock, power, the two local materials and their load tests, the buildings you can plan, saved blueprints and the project list.
2. Pick a building and drag its outline on the map; `R` turns the door. The Seed checks the plot (surveyed, dry, reachable, clear of the camp and other plots) and shows what each stage takes, whether the roof needs posts, and what the colony's power would be. A plan can be saved as a blueprint and placed again.
3. Each building goes up in five stages, worked by a build crew: marking out, foundations (stone), frame (timber), systems (airlock seal, pipe runs, power units), fit-out. Trees and boulders on the plot are cleared into the yard; from foundations on, the plot can't be walked across.
4. Stone is cut from boulders and rock faces and timber felled from trees, by quarry and timber crews that fill the yard, or by builders themselves when the yard is empty. Seals, pipes, power units and solar panels are made from the lander's salvage at workshop benches, or three times slower by the fabricator when it has no body to print.
5. Until a load test shows how strong the local stone and timber really are, designs carry 40% extra as a margin and roofs wider than four tiles need posts. Tests use three loads at the rig in the yard. Loads are worked out when each stage starts, so testing early makes the rest cheaper.
6. The lander makes 8 kW; solar fields add more. Finished buildings take power in list order and any that don't fit stay dark and unused. Projects show what they are waiting for, stall, and pick up again.
7. Click a building, finished or not, for its card: what it is, its five stages, what the current stage still needs and who is working on it.
8. Dormitories give bunks, the commons a sit-down evening meal that eases strain more than the fire, the clinic beds where the hurt heal twice as fast, and workshops benches for the workshop crew.
9. Saves are version 3; a milestone 2 colony continues, its shelter becoming the first project of many.

## News

Nothing important waits in the log to be found.

1. **Cards.** Notable events (someone wakes, gets hurt or makes a friend, a building is finished, stalls or goes dark) appear as cards on the right of the map for about twenty seconds, longer while the pointer is on them. Clicking one takes the camera to the person or building.
2. **Letters.** Big events (a death, a breakdown, the rations running out, the shelter finished, a load test result) open a letter in the middle of the screen and pause the game until it is read. `Enter` or `Esc` closes it and the game carries on at the speed it had. The menu can turn the pausing off.
3. **Alerts.** Problems that last (nobody chosen to print, rations under ten days, hunger, injuries, breakdowns, strain near breaking point, exhaustion, falling trust, people without a crew, stalled projects, buildings without power, a build crew with nothing to build) stay on screen until they are fixed. Pointing at one says what helps; each click looks at the next person or building it is about.
4. **First-time explanations.** The first time each kind of event happens, its card or letter also says what it means and what can be done. This browser remembers which ones have been shown; the menu can show them all again.

The simulation tags each log line with its kind, how loud it is and where to look; the page decides how to show it.


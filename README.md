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

- `src/core`: plain-data simulation with no browser APIs. World generation, landing sites and the landing (`world.js`), pathfinding (`path.js`: chunk-level graph, local A*, flow fields), the colony (`sim.js`), people's days, minds and ties (`life.js`), bodies and wounds (`body.js`), first aid and medicine (`care.js`), the fabricator, crews, building projects and the player's commands (`work.js`), what can be built and what it costs, load checks, power and stock (`build.js`), the founders' archive (`founders.js`), constants and the seeded rng.
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

1. From orbit, the Seed offers three landing sites with what it knows and doesn't know about each. You also choose the season it comes down in (Thaw by default); the year runs on from there, so a landing in Deep cold starts in snow with twenty days to the thaw. `SEASON=0..3` does the same for the bot sims.
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
7. Click a building, finished or not, for its card: what it is, its five stages, what the current stage still needs and who is working on it. The Seed, the campfire, the cooking spot and vats, the yard, sensor stakes, local life, trees, boulders, bushes and rock faces open a card the same way: what it is, what it holds or gives, and who is working on it.
8. Dormitories give bunks, the commons a sit-down evening meal that eases strain more than the fire, the clinic beds where the hurt heal twice as fast, and workshops benches for the workshop crew.
9. Saves are version 3; a milestone 2 colony continues, its shelter becoming the first project of many.

## More people: the feedstock plant

1. The Seed lands with feedstock for six bodies. After that the fabricator can only print more people from feedstock the colony makes itself.
2. A feedstock plant (Build window, Plan) holds one to three tanks, by size, and draws power like any building. With power, each tank takes a batch of 3 loads of biomass and 1 of stone from the yard and turns it, over half a day, into an eighth of a body's feedstock. A two-tank plant makes a body's worth about every two days.
3. Forage crews keep the yard stocked with biomass for it (after the projects' own biomass, and after food when the larder runs low), and quarry crews with stone. The plant's card shows each tank, the next body's progress and what it waits for; an alert says when it is starved.
4. The plant stops once the fabricator holds feedstock for four bodies, or for everyone left in the archive. Each new body's worth arrives as a letter; pick who wakes in the Archive (`Q`), which also explains the plant when the feedstock runs out.
5. The bot builds a plant after its solar field, puts someone on quarrying, and prints the Seed's pick whenever there is feedstock.

## Food and the year (milestone 4, part 1)

1. The year is 80 days in four seasons of 20. Temperature follows the season and the hour, the weather is drawn day by day (clear, cloud, rain, fog, wind, storms, snow), and the sun rises and sets later or earlier through the year. Deep cold is the fourth season: nothing grows, water freezes, snow lies, and anyone outdoors at night chills fast. The chip next to the clock shows today's weather and temperature; pointing at it gives sunrise, sunset and the days left until Deep cold.
2. The lander's rations run out, so the colony has to live off this world. People notice the local life near where they work; each kind becomes a card in the Life window (`G`) with where it grows and when.
3. Nothing found is known to be safe. Foraging crews take samples, and the Seed's analyser (or a lab with a lab crew, much faster) tests them one kind at a time. Results say whether it can be eaten and how: raw, cooked, leached or fermented in the vats. Some foods do slow harm or aren't enough on their own; the Seed plans meals so no one eats too much of one.
4. Foragers gather tested food while the larder is low, more when Deep cold is near. Picked patches take a while to grow back. A kitchen crew cooks at the fire and runs the vats; food that must be leached or fermented is useless without one.
5. Fields are built like any other building (marked out, dug, made soil, drains, raised beds) and worked by a farm crew. The seed bank holds potatoes, kale and beans; the Seed picks what has time to ripen before the frost, or the player chooses per field in the Life window or the field's card. Frost kills a crop that isn't in.
6. People get cold outdoors, worse at night, in wind and rain; the person card shows how cold, what they last ate and whether the diet is telling on them. Cold above 65 does harm, and the dangerously cold can freeze. The larder in the Life window and the food readout at the top count only food that can actually be eaten.
7. The bot runs three food policies for balancing (`seed`, `lean` with one forager, `nofood`); a careful colony gets through two years, a careless one starves in the second.
8. Saves are version 4; version 2 and 3 saves continue.

## Hazards and medicine (milestone 4, part 2: bodies layer 1)

1. A body has fourteen parts (head, eyes, torso, heart and lungs, gut, arms, hands, legs, back, skin) feeding eight capacities: consciousness, sight, breathing, blood flow, digestion, carrying, hands and moving (`src/core/body.js`). Work speed, walking speed and the chance of an accident come from the capacities.
2. Wounds are cuts, crushes, broken bones, burns, punctures and frostbite. Each bleeds, hurts, can get dirty and infected, and heals day by day. Blood loss, pain and shock add up across wounds, so several survivable wounds can kill together. Death comes from blood loss, shock, infection or a head injury.
3. Accidents come from the work itself (felling, cutting stone, building, benches, cooking, gathering, fields), more for the exhausted, the reckless, the very cold, people new to their bodies and in storms. Outdoors there is also ice, frostbite and lightning.
4. Not everything shows. A small break under a bruise, or bleeding inside the body or under the skull, stays hidden until a medic examines the patient. The page only ever shows what the colony knows; blood lost to a hidden wound shows as "losing blood, cause not found".
5. Care (`src/core/care.js`): the nearest free person gives first aid and carries someone who is down to a bed, waking up if they must. Then the best free medic examines and treats: closing and dressing wounds, setting bones, operating, antibiotics, shock treatment and painkillers. Success depends on skill, a clinic with power, daylight, tiredness and the medic's own hands. When there are more patients than medics, the clinic's triage rule decides (worst first, most likely to live first, or crew leads first).
6. Supplies (dressings, painkillers, antibiotics, blood substitute) start in the lander; the fabricator makes more from salvage when they run low.
7. Healed wounds can leave marks: a bone that healed crooked, tight burn or frost scars, lost fingers or an eye. Marks are permanent until printed parts arrive in a later milestone.
8. The person card has a Health tab (body outline coloured by known harm, blood, pain, shock and infection, capacities, each wound with its state, marks and the last examination). The colonist bar marks who is down, bleeding or in care; alerts cover people down or bleeding, running out of supplies and having no one skilled in medicine.
9. Saves are version 5; version 4 saves continue, with anyone hurt given a matching healing wound.

## Illness and quarantine (milestone 4, part 3)

1. Illness comes from two directions (`src/core/illness.js`). What came down with the colonists: microbes in the Seed's own starter cultures, which the databank knows (gut fever, a chest infection). And what lives here: kept in the sealed texts, with stand-ins in `src/sealed-stub/texts.js`, and learned only from the cases themselves.
2. A case runs a course: a hidden incubation, the sick days, a crisis for the worst cases, then recovery. It takes capacities while it shows, adds fever to pain, and in a crisis can kill. A clinic bed, a medic sitting with them, the right medicine, food and warmth all lower that chance.
3. New cases start from the world: food handled carelessly (never the sealed rations), cold and exhaustion, and for local illness the work, the ground, the season and the weather. Some pass from person to person: at shared meals, from a sick cook, and between people who sleep or work in the same room. The clinic itself cuts the risk to the people inside.
4. A new printed body has no resistance and catches far more in its first season. Recovery leaves resistance that fades slowly; some local illness leaves the opposite, so each case comes on faster and harder.
5. Diagnosis is a belief. Until a medic examines someone, an illness is only its symptoms. An illness the databank knows is named by a good enough medic. A local one has to be worked out: every examination and every case that runs its course adds to what is known, faster in a clinic and with a lab, and once it is understood every case is named at once. Medics try antibiotics on an unnamed fever once; they only help against illnesses they are made for.
6. The clinic's card has a rule to isolate anyone with a named catching illness: they stay in a clinic bed (their bunk if the clinic is full) and eat there until it passes. It stops the spread, but being shut away adds strain and costs trust. The card also lists the illness seen so far, named or not, with what the medics know.
7. Anyone laid up is brought supper where they lie. The Health tab shows each illness, its stage, whether it is catching and whether antibiotics work, plus past illnesses and resistance. The colonist bar and the alerts mark the sick, the gravely ill, and a catching illness with nobody kept apart. The Stats window charts the sick and counts illnesses caught and deaths from them.
8. Version 5 saves continue, with everyone healthy and counted as a seasoned body.

## Fire and floods (milestone 4, part 4)

1. Fire needs fuel and dry ground (`src/core/hazards.js`). The ground dries in sun, warmth and wind and soaks up rain and snow; it is driest late in Long light. Woodland burns hottest and longest, meadow fast, marsh and bare ground hardly at all. Water, sand, rock and scorched ground don't burn.
2. Fires start from lightning: on storm days in the morning, before the rain arrives in the afternoon, and now and then from a dry thunderstorm on a hot afternoon in Long light. Sparks from the campfire can also blow into dry grass on a windy evening. A fire spreads every ten game minutes, faster downwind and in dry weather, slower at night; rain and snow put it out.
3. Burnt ground is scorched: its trees and bushes are gone, local life on it is lost until it grows back, and it greens over as meadow after a season.
4. A fire that comes near the camp, the fields or a building raises the alarm: everyone able drops their work to beat it out, the sleepers are woken, and the nearest flames are taken first, burning buildings before grass. Firefighting is tiring and can burn people; anyone caught in the flames is burned.
5. Buildings catch from flames next to them. Everyone inside gets out, and the building is out of use while it burns. The longer it burns, the further back it goes: a fire put out early needs a small repair, a building that burns out keeps only its footings. Repairs are ordinary build projects. Fields lose their crop. The shelter's lander modules don't burn.
6. Floods come from snowmelt upstream and from days of heavy rain. The Seed's sensors give a day's warning. The water rises over the low ground by the river or lake for about a day, stands, and falls slowly. How low a tile is comes from its height above the nearest water and its distance from it (`floodPlain` in `src/core/world.js`).
7. Buildings and fields in the water are out of use until it goes down, then need repairs: the longer it stood, the more work. Crops drown, loose biomass washes out of the yard, people wading get cold, and deep water can knock them off their feet. Planning on low ground shows a warning, and the Seed's own suggestions avoid it.
8. The map draws the flames, smoke and the glow they cast, scorched ground, and the flood water over the land; the minimap marks fires. Letters and alerts cover fires near the camp, burning buildings, flood warnings and flooded buildings; the weather tooltip says when the ground is dry and when the river is high. Stats count fires and floods.
9. Saves are version 7; version 6 saves continue with dry ground at a middle value and no fire or flood under way.

## Stats

The Stats window (`T`) is the colony's record. Headline numbers sit on top, then twelve charts of the record day by day: people (awake, hungry, unwell, hurt, sick), food in store, days of food, food brought in, meals cooked, average fatigue, strain, trust and health, low and high temperature, the worst cold, stone and timber in the yard, power, ground surveyed and local life. Seasons are shaded behind each chart, hovering shows that day's values, and the range can be the last 20 days, the last year or everything. Totals since landing and a table of every day are below. The simulation adds one row at each midnight (`src/core/history.js`, saved with the colony); today so far is the last point, drawn dashed.

## News

Nothing important waits in the log to be found.

1. **Letters**, as in RimWorld. Every notable event drops down the right edge of the screen onto a stack. Red is bad news that matters, amber smaller trouble, green good news and blue everything else. Hover a letter for a preview, click it to read it in full (`Show me` takes the camera to the person or building), right-click to throw it away. Small news leaves the stack by itself after about ninety seconds of play (three minutes when it carries a first-time explanation), never while the game is paused. Big news (a death, a breakdown, the rations running out, the shelter finished, a load test result, feedstock for another body) stays and glows until it is read, and pauses the game when it lands. The game carries on once every letter that paused it is read or thrown away. The menu can turn the pausing off. `Enter` or `Esc` closes an open letter.
2. **Alerts.** Problems that last (nobody chosen to print, rations under ten days, hunger, people down or bleeding, injuries, running out of medical supplies, nobody skilled in medicine, breakdowns, strain near breaking point, exhaustion, falling trust, people without a crew, stalled projects, a starved feedstock plant, buildings without power, a build crew with nothing to build) are listed under the letters until they are fixed. Pointing at one says what helps; each click looks at the next person or building it is about.
3. **First steps.** A guide under the projects tracker shows one step at a time for a first colony: wake the founders, let the shelter go up, test stone and timber, forage, test local life, plan a field, farm it, power and a workshop, a feedstock plant. Each step is done when the colony shows it done, so the guide follows the order you actually play in. It can be hidden from the menu.
4. **First-time explanations.** The first time each kind of event happens, its letter also says what it means and what can be done. This browser remembers which ones have been shown; the menu can show them all again.

The simulation tags each log line with its kind, how loud it is and where to look; the page decides how to show it.


// Telling the player what happens, so nothing important waits in the log to be found. Two ways, as in RimWorld:
// - letters: every notable event drops down the right edge of the screen onto a stack, coloured by what kind of news
//   it is. Hover one for a preview, click it to read it in full (with a button that takes the camera there), right-
//   click to throw it away. Small news leaves the stack on its own after a while of play; big news stays until it
//   is read, glows until then, and can pause the game when it arrives;
// - alerts: problems that last (rations running low, people hungry, buildings dark), listed under the letters until
//   they are fixed.
// The first time each kind of event happens, its letter also says what it means and what can be done.
// The log keeps everything; this only decides what is worth interrupting for.
import { ACT, MAP } from '../core/consts.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const KEY = 'colony-news';
const SMALL_S = 90, SMALL_NEW_S = 180, MAX_LETTERS = 12;   // seconds of play a small letter stays; how many fit

// what an event means, said once, the first time it happens
export const EXPLAIN = {
  woke: 'A founder is awake in a printed body. For the first ten days a new body feels strange: they tire faster and work a little slower. Unless you have taken over the crews, the Seed puts each new founder in one.',
  nocrew: 'Since you took over the crews from the Seed, new founders wait at camp until you put them in one. Open Crews (C) to choose.',
  feedstock: 'The feedstock the Seed brought down is used up. A body is mostly water and the molecules of life, with minerals for the bones: a feedstock plant makes that from local biomass and crushed stone, slowly. Plan one in the Build window (B), give it power, and keep a forage crew and a quarry crew filling the yard.',
  feedmade: 'Each body of feedstock lets the fabricator print one more founder from the archive. Choose who in the Archive (Q). The plant keeps going until the fabricator holds feedstock for four bodies.',
  hurt: 'Accidents happen most to the exhausted, the reckless, the very cold and people new to their bodies, and more in storms. Wounds bleed, hurt and can go bad; the Health tab of a person’s card shows each one and what has been done for it. The hurt are slower until they heal.',
  badhurt: 'Blood loss, pain and shock add up: someone can die of several wounds that would each be survivable. Someone nearby gives first aid and gets them to a bed; a medic does the rest, far better in a clinic with power.',
  down: 'Someone who is down can’t get up on their own. The nearest free person comes to stop the bleeding and carry them to a bed, even if it means waking up.',
  hidden: 'Not every injury shows. A broken bone under a bruise, or bleeding inside, stays hidden until a medic examines them. Skilled medics find more, and find it faster in a clinic.',
  treated: 'Treatment works better from a skilled medic, in a clinic with power, in daylight, and with supplies. A medic who gets it wrong can try again. Dressings, painkillers, antibiotics and blood substitute come from the fabricator, made from salvage.',
  breakdown: 'When strain peaks, people walk off to be alone for a few hours, and trust in the Seed drops. Strain comes from overwork, bedrolls on open ground, being out after dark, hunger and rivals. Rest, meals together, bunks indoors and friends ease it.',
  friends: 'Friends ease each other’s strain when they work or eat close by. Ties grow between people who work and eat together, and their temperaments decide which way a tie goes.',
  rivals: 'Rivals add to each other’s strain whenever they are near. Putting them in different crews keeps them apart.',
  death: 'Death is permanent. Everyone who knew them takes it hard, their friends most of all.',
  tested: 'A finished test is always right. Before a material is tested, every design carries a 40% safety margin. Now designs use the measured strength, so a strong material makes buildings cheaper, and a weak one makes them safer.',
  shelter: 'The shelter has twelve bunks. A bunk indoors restores more than a bedroll and eases strain. From now on, the Build window (B) lets you plan more buildings.',
  built: 'A finished building only works with power. The lander makes 8 kW and solar fields make more. Buildings take power in the order of the project list.',
  stalled: 'A stalled project is waiting for something its crews can’t get on their own. Its card says what. Usually a workshop has to make the part, or the colony is out of salvage.',
  dark: 'A building without power can’t be used. Build a solar field, or move what matters most up the project list so it gets power first.',
  made: 'Workshop benches turn salvage into airlock seals, pipe runs, power units and solar panels, three times faster than the fabricator can.',
  stakes: 'The sensor stakes let the Seed watch the ground around each of them. Survey crews keep mapping beyond them on foot.',
  nofood: 'Hungry people tire faster and strain more, and each day without a meal costs health until they die. Foragers bring in wild food fastest; fields take longer but feed far more.',
  found: 'People notice the local life around them as they work outside. Nobody knows yet whether it is food, poison or neither: only a test tells. Survey crews and foragers take samples as they pass; three samples make a test. The Life window (G) lists everything found.',
  samples: 'Three samples are enough for a test. Queue it in the Life window (G). The Seed’s own analyser works slowly; a lab with people at its benches is much faster.',
  lifetest: 'A test is always right. Food that only needs cooking can be eaten as soon as it is gathered. Some food has to be leached or fermented first, and only a kitchen crew does that. Some has a slow harm, and some isn’t enough on its own: the Seed plans meals around both, as long as there is something else to eat.',
  field: 'A finished field grows the crops in the Seed’s seed bank. A farm crew sows, harvests and clears it, and the Seed picks the crop that can ripen before the frost unless you choose one on the field’s card.',
  sown: 'Crops grow faster the warmer it is, stop in the cold and die in frost. Each crop has its own limits: the field’s card shows when it should ripen.',
  ripe: 'Ripe crops wait about a week, then start to spoil in the field. A farm crew brings them into the larder.',
  harvest: 'The first harvest. Harvested crops keep for a while in the larder, and much longer once it freezes. Potatoes and beans keep best; kale spoils fast.',
  frost: 'Frost kills crops that can’t stand it. Sowing waits for the last usual frost, but an unusually cold night can still catch a field.',
  rations: 'The lander’s rations are gone. From now on every meal has to come from the larder.',
  season0: 'A planetary year is eighty days: Thaw, Long light, Storm and Deep cold, twenty days each. Thaw is when the ground opens up: the first chance to sow and to forage.',
  season1: 'Long light is the warm season. Crops grow fastest, the days are long, and the solar fields make the most power.',
  season2: 'The storm season brings wind and lightning. Storms flatten crops and keep survey crews in camp, and the first frosts end it. Whatever is ripe needs bringing in, and the larder needs to be full before Deep cold.',
  season3: 'In Deep cold nothing grows and little can be gathered. Work outside chills people to the bone, blizzards keep everyone in camp, and the solar fields make half as much. The larder and bunks indoors carry the colony through.',
  deepwarn: 'The weeks before Deep cold are for filling the larder: foragers bring in what keeps, and fields bring in their last harvest. Food that keeps well matters most.',
  storm: 'In a storm people have more accidents outside, crops can be flattened, and survey crews stay in camp.',
  blizzard: 'Nobody works outside in a blizzard. Crews wait it out in camp, and the day’s outside work waits too.',
  snap: 'A cold snap lasts a few days. People outside get cold far faster, and crops left in the fields freeze.',
  cold: 'People get cold outside below freezing, faster in the wind. Indoors, or by the lit fire, they warm up again. The very cold work slower, strain more and have accidents, and someone left dangerously cold too long can die.',
  sickfirst: 'Illness comes from two directions: the microbes that came down with the Seed’s own starter cultures, which the databank knows, and whatever lives here, which nobody knows yet. The sick work slower, or not at all, and the worst cases go through a crisis where a clinic bed and a medic decide a lot. A new body has no resistance to anything in its first season. A person’s Health tab shows what is known.',
  illknown: 'A medic names an illness the databank knows. From now on its card on the clinic says what helps: antibiotics work only against the illnesses they are made for. If it is catching, the clinic has a rule to keep the sick apart.',
  illfound: 'A local illness has to be worked out from the cases themselves: every examination adds to what the medics know, faster in a clinic and faster still with a lab. Now that it is understood, every case is named on sight.',
  crisis: 'A crisis is the dangerous part of an illness. A clinic bed, a medic sitting with them, the right medicine, food and warmth all make it far more likely they pull through.',
  wildfire: 'Grass and woodland burn when the ground is dry: after days of sun and wind, and worst late in Long light. A fire spreads downwind, fast in woodland, and rain or snow puts it out. When it comes near the camp, the fields or a building, everyone who can drops what they are doing to beat it out, and the Seed wakes the sleepers. Burnt ground grows back over a season.',
  farfire: 'Fires far out burn themselves out, or the rain puts them out. The Seed raises the alarm if one comes within reach of the camp.',
  bfire: 'A burning building is out of use and everyone inside gets out. The more of it burns before it is beaten out, the more of it the build crews have to put back. Timber frames burn; the shelter’s lander modules don’t.',
  gutted: 'A building that burns out keeps its footings: the build crews rebuild it from there, like a new project, and it is out of use until they finish.',
  floodwarn: 'Floods come from a fast thaw upstream or from days of heavy rain. The water rises over the low ground by the river or lake for a day or so, stands, and falls slowly. Buildings in it are out of use until it goes down, and need repairs after; crops drown. The Seed warns when planning on low ground. The lander and its shelter stand on legs and stay dry.',
  flood: 'Buildings under water are out of use until it goes down, and need repairs after: the longer the water stands, the more work. Anyone wading through it gets cold, and deep water can knock people off their feet.',
  wear: 'Things wear out: panels, pumps, benches and frames all fail now and then, more as they age. A broken building is out of use until a build crew repairs it, like any other project on the list.',
  tremor: 'The ground here is not still. A tremor can crack frames and hurt the people inside; the damaged buildings go on the project list for repairs. The lander and its shelter ride it out on their legs.',
  blight: 'Crops from the seed bank have no defences against what lives here. A blight takes part of a field’s growth; what is left still ripens.',
  cache: 'Pieces of the Seed broke away on the way down and are scattered around the landing site. Surveyors find them now and then.',
  glut: 'Local life has good years and bad. In a good one, every patch the foragers know fills up again at once.',
  repaired: 'Repairs are build projects like any other: they show on the project list, and a build crew sees to them in order.',
  ore: 'Ore waits in the yard until a workshop bench or the fabricator is free; then three loads smelt into two of salvage. Press U to see the ground below: the glinting seams are ore. A mine dug along a seam brings up far more than digging other rooms does.',
  nosalvage: 'Salvage is the metal from the lander and its descent stage, and every seal, pipe run, power unit and solar panel is made from it. Once it is gone, the only metal is the ore in the ground. A mine (Build window, below ground) dug over a seam lets a mine crew bring ore up, and workshop benches smelt it, three loads into two of salvage. Each mine holds only so much: when one is worked out, dig another.',
  smelted: 'From now on a workshop smelts ore whenever it has nothing else to make and the yard is low on salvage. Keep a mine crew working while there is ore in the seam.',
  mineLow: 'A new mine takes days to dig, so plan it before the old one is empty. Press U to see the seams of ore below ground.',
  chronic: 'Years of work, the diet and the sun leave their mark slowly, and some of it turns into lasting trouble: worn joints, scarred lungs, a weak heart, failing kidneys, a growth. Each person’s Health tab shows what they feel; a check-up names it.',
  checkup: 'With a working clinic and someone in a clinic crew, the clinic calls everyone in every forty days. A skilled medic finds more, and a lab helps. A growth found while it is small can be cut out.',
  heartattack: 'A weak heart can fail without warning. A printed heart, once the colony has a clinic, a lab and a body’s worth of feedstock, replaces it: see their Health tab.',
  operated: 'A growth found early, at a check-up, can be cut out. The more skilled the medic and the smaller the growth, the better the odds.',
  printpart: 'A printed part takes a body’s worth of feedstock and about twelve days to feel like their own. Lost eyes and hands, failing kidneys and worn-out hearts can all be replaced, from the Health tab.',
  pitout: 'A pit holds only the stone near the surface. The view below ground (U) shows where stone lies under shallow soil: plan the next pit there.',
  nostone: 'Boulders and rock faces do not come back once cut. A stone pit, planned in the Build window on stony ground, gives stone for years.',
  workedout: 'A mine only holds the ore of the seam it was dug along. Press U to find another seam, and plan a new mine over it before the salvage runs low.',
  trauma: 'The worst things leave a mark: a death, a bad injury, a fire, the flood, a tremor, a night that nearly froze them. What someone carries makes strain build faster and sleep restore less, and they break sooner; the same thing happening again brings it back. It fades over weeks, faster with friends, a bunk indoors and a steady nature. The person card shows what they carry.',
  ctl: 'In an emergency the Seed can direct one person: right-click open ground to send them there, flames to beat them out, or someone hurt to give first aid. People who barely trust the Seed refuse, the wary hesitate, and every order costs a little trust. Esc or Release hands them back; an hour after the emergency they go back to their crew anyway.',
  firstcouple: 'Close friends who are both free can become a couple: it takes a strong friendship on both sides, and some time. A partner nearby eases strain more than any friend, and losing one is the hardest loss there is. Couples who settle down may ask the Seed for a child.',
  ask: 'The Seed grows a child in one of its two growth tanks: sixty days, from a body’s worth of feedstock and the genes of both parents. Founders you choose to print get the feedstock first; a body nobody chose goes to the couple who asked first. The Archive (Q) shows the tanks, who is waiting, and the colony’s rule on children.',
  firstborn: 'Children spend their first two years in the Seed’s nursery. Then they play by the fire, eat smaller meals, go to bed early, and pick up what their parents know. Small children need someone with them: a childcare crew looks after four each, or a parent stays at camp instead of working. At thirteen they join the crews as apprentices, and at sixteen they are adults.',
  nocare: 'Children under six need an adult with them. Make a childcare crew in Crews (C): each carer looks after four. Without one, a parent of each small child stays at camp.',
  apprentice: 'An apprentice works in a crew at a little more than half pace and learns fast from the most skilled person in it, faster if that person is a good teacher.',
  firstadult: 'The first person born here has come of age. Natives never knew another world: they don’t remember Earth, and they never had a body that felt strange.',
  retired: 'At seventy-two people stop working in the crews on their own. They still eat, sleep and keep their friends. Put them back in a crew if the colony needs their hands.',
  oldage: 'Bodies age a year with every planetary year. Past sixty the chance of dying of age grows each year, doubling about every seven.',
  split: 'A couple whose tie turns sour splits up. It hurts both of them for a while, and they can find someone else later.',
  lastfounder: 'Nobody who remembers Earth is left alive. What the founders knew survives only in what they taught.',
  unwell: 'A narrow diet shows over time. Food with a slow harm builds up in the body, and food that isn’t enough on its own leaves people short of what they need. More kinds of food, and fewer meals of the troublesome ones, put it right over some days.',
};

// problems that last: what to look at and what helps
const ALERTS = {
  print: ['info', 'Choose who to print', 'The fabricator has feedstock and nobody in line. Open the Archive (Q) to pick who wakes next.'],
  feedwait: ['warn', '', 'Its tanks have stopped. Its card says what it waits for.'],
  food: ['warn', '', 'Foragers bring in wild food the Life window (G) shows is safe; fields feed more once they are made and sown.'],
  cold: ['bad', '', 'They need to get indoors or to the fire. The very cold work slower and have accidents, and can die if it lasts.'],
  crisis: ['bad', '', 'A clinic bed and a medic sitting with them give them the best chance.'],
  fire: ['bad', '', 'Everyone who can is beating it out. Rain puts it out; a fire left alone spreads downwind.'],
  bfire: ['bad', '', 'It is out of use while it burns, and every minute of it means more repairs.'],
  flooded: ['warn', '', 'Out of use until the water goes down, then the build crews repair them.'],
  floodwarn: ['warn', 'The river is rising', 'The water will come over the low ground. Buildings there will be out of use until it goes down.'],
  sick: ['warn', '', 'The sick work slower, or rest until it passes. Their Health tab shows what is known about it.'],
  catching: ['warn', 'A catching illness', 'Someone has an illness that spreads, and nobody is kept apart. The clinic’s card has a rule to isolate the sick, at a cost to their strain and trust.'],
  unwell: ['warn', '', 'Something in their diet. More kinds of food in the larder put it right over some days.'],
  ripe: ['info', '', 'Ripe crops start to spoil after about a week in the field. A farm crew brings them in.'],
  nofarm: ['warn', 'No farm crew', 'Fields need a farm crew to sow and harvest them. Set one up in the Crews window (C).'],
  samples: ['info', '', 'Queue the test in the Life window (G).'],
  locked: ['warn', 'Food only a kitchen can prepare', 'Some of the larder needs leaching or fermenting before it is safe, and nobody is on kitchen work. Set up a kitchen crew in the Crews window (C).'],
  behind: ['bad', 'The kitchen can’t keep up', 'People are going hungry while food waits to be leached, fermented or cooked. One cook feeds about ten people: put more on kitchen work in the Crews window (C).'],
  deep: ['bad', '', 'Nothing grows in Deep cold. Fill the larder before it comes: foragers, harvests, and food that keeps.'],
  hungry: ['bad', '', 'They lose health every day without a meal, and die when it runs out.'],
  down: ['bad', '', 'They can’t get up. Someone nearby comes to give first aid and carry them to a bed.'],
  bleed: ['bad', '', 'First aid slows the bleeding; closing the wound stops it. Lost blood comes back slowly over days.'],
  hurt: ['warn', '', 'The hurt are slower until they heal. Their card’s Health tab shows each wound and what has been done for it.'],
  nomedic: ['info', 'Nobody skilled in medicine', 'Anyone can give first aid and close a wound, but not well. Someone with medicine skill 1.5 or more works as a medic. Treating people and working at a lab bench build the skill.'],
  meds: ['warn', '', 'The fabricator makes a batch from salvage when it is free. Without dressings wounds go bad more often, and without antibiotics an infection runs its course.'],
  alone: ['warn', '', 'Strain got to be too much. They come back on their own after a few hours, a little calmer.'],
  strain: ['warn', '', 'Strain this high can end in a breakdown. Shorter shifts, bunks indoors, meals at a commons and time with friends bring it down.'],
  tired: ['warn', '', 'The exhausted work slower and have more accidents. The crew rule “Stop when exhausted” sends them to rest.'],
  trust: ['warn', '', 'People who don’t trust the Seed stop at the end of a normal day, whatever their shift. Trust grows when its plans work out, and falls with overwork and nights out in the dark.'],
  nocrew: ['info', '', 'People without a crew only take it easy at camp. Put them in one in the Crews window (C).'],
  dark: ['warn', '', 'There isn’t enough power for them. Build a solar field, or move them up the project list.'],
  stalled: ['warn', '', ''],
  idle: ['info', 'Nothing to build', 'A build crew has nothing on the project list. Plan a building in the Build window (B), or give the crew other work.'],
};
const ORDER = ['fire', 'bfire', 'down', 'crisis', 'bleed', 'floodwarn', 'flooded', 'catching', 'hungry', 'behind', 'cold', 'food', 'deep', 'locked', 'nofarm', 'ripe', 'unwell', 'sick', 'samples', 'print', 'feedwait', 'alone', 'hurt', 'meds', 'nomedic', 'strain', 'tired', 'trust', 'nocrew', 'stalled', 'dark', 'idle'];

export class News {
  constructor(A, api) {
    this.A = A; this.api = api; this.stack = []; this.cur = null; this.resume = 0; this.cycle = {}; this.sig = '';
    let st = {}; try { st = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { /* private window */ }
    this.seen = new Set(st.seen || []); this.pause = st.pause !== false; this.explain = st.explain !== false;
    const L = $('letters'), at = e => { const el = e.target.closest('.lt'); return el && this.stack.find(k => k.n === +el.dataset.n); };
    L.addEventListener('click', e => { const k = at(e); if (k) this.openLetter(k); });
    L.addEventListener('contextmenu', e => { const k = at(e); if (!k) return; e.preventDefault(); this.remove(k, true); });
    L.addEventListener('pointerover', e => { const k = at(e); if (k) { k.hold = true; this.tip(k); } });
    L.addEventListener('pointerout', e => { const k = at(e); if (k) { k.hold = false; this.tip(null); } });
    $('alerts').addEventListener('click', e => { const a = e.target.closest('[data-a]'); if (a) this.goAlert(a.dataset.a); });
    $('lGo').onclick = () => { const k = this.cur; this.closeLetter(); if (k) this.go(k.e); };
    $('lOk').onclick = () => this.closeLetter();
    $('nPause').onchange = e => { this.pause = e.target.checked; this.keep(); };
    $('nExplain').onchange = e => { this.explain = e.target.checked; this.keep(); };
    $('nAgain').onclick = () => { this.seen.clear(); this.explain = true; $('nExplain').checked = true; this.keep(); this.api.toast('New things will be explained again as they happen.'); };
    $('nPause').checked = this.pause; $('nExplain').checked = this.explain;
    setInterval(() => this.tick(), 500);
  }
  keep() { try { localStorage.setItem(KEY, JSON.stringify({ seen: [...this.seen], pause: this.pause, explain: this.explain })); } catch (e) { /* not kept */ } }
  // the explanation for an event kind, once
  why(e) {
    if (!this.explain || !EXPLAIN[e] || this.seen.has(e)) return '';
    this.seen.add(e); this.keep(); return EXPLAIN[e];
  }
  reset() { this.stack = []; this.cur = null; this.resume = 0; this.cycle = {}; this.sig = ''; $('letters').innerHTML = ''; $('alerts').innerHTML = ''; $('letter').hidden = true; this.tip(null); }

  // ---------- letters: each one falls down the right edge onto the stack ----------
  add(entries) { for (const e of entries) if (e.lvl) this.push(e); }
  push(e) {
    const big = e.lvl >= 2, why = this.why(e.e);
    const k = { n: e.n, e, why, big, life: (why ? SMALL_NEW_S : SMALL_S) * 1000, hold: false, el: null };
    this.stack.unshift(k);
    // too many: the oldest small letter goes first, then the oldest of all
    while (this.stack.length > MAX_LETTERS) this.remove([...this.stack].reverse().find(q => !q.big) || this.stack[this.stack.length - 1]);
    if (!this.stack.includes(k)) return;
    const el = k.el = document.createElement('div');
    el.className = `lt ${tone(e)}${big ? ' big' : ''}`; el.dataset.n = e.n;
    el.innerHTML = `<span class="lb">${esc(e.title || 'News')}</span><i><svg class="ic"><use href="#i-letter"/></svg></i>`;
    $('letters').prepend(el);
    const drop = el.getBoundingClientRect().top + 40;
    el.animate([{ transform: `translateY(${-drop}px)`, easing: 'cubic-bezier(.5,0,1,1)' }, { transform: 'translateY(0)', offset: .82, easing: 'ease-out' }, { transform: 'translateY(-5px)', offset: .92, easing: 'ease-in' }, { transform: 'none' }], { duration: 420 + drop * .45 });
    if (big && this.pause && this.A.speed > 0) { this.resume = this.A.speed; this.api.setSpeed(0); }
  }
  // take a letter off the stack; the ones above it slide down into the gap
  remove(k, fade = false) {
    const i = this.stack.indexOf(k); if (i < 0) return;
    this.stack.splice(i, 1);
    if (this.cur === k) { this.cur = null; $('letter').hidden = true; }
    const gone = () => {
      if (!k.el) return;
      const above = this.stack.filter(q => q.el && q.el.compareDocumentPosition(k.el) & Node.DOCUMENT_POSITION_FOLLOWING).map(q => [q, q.el.getBoundingClientRect().top]);
      k.el.remove();
      for (const [q, y] of above) { const d = y - q.el.getBoundingClientRect().top; if (d) q.el.animate([{ transform: `translateY(${d}px)` }, { transform: 'none' }], { duration: 240, easing: 'ease-out' }); }
    };
    if (fade) { k.el.style.pointerEvents = 'none'; k.el.animate([{ opacity: 1 }, { opacity: 0, transform: 'translateX(24px)' }], { duration: 220, easing: 'ease-in', fill: 'forwards' }).onfinish = gone; } else gone();
    if (this.tipFor === k) this.tip(null);
    this.after();
  }
  // small letters leave on their own after a while of play; nothing goes while the game is paused or a letter is open
  tick() {
    if (!(this.A.speed > 0) || this.cur) return;
    for (const k of [...this.stack]) if (!k.big && !k.hold && (k.life -= 500) <= 0) this.remove(k, true);
  }
  // the preview beside a letter, while the pointer is on it
  tip(k) {
    const t = $('lTip'); this.tipFor = k;
    if (!k) { t.hidden = true; return; }
    const r = k.el.getBoundingClientRect(), e = k.e;
    t.innerHTML = `<div class="nh"><b>${esc(e.title || 'News')}</b><em>${this.api.when(e.t)}</em></div><p>${esc(e.m)}</p>${k.why ? `<div class="why"><i>New</i>${esc(k.why)}</div>` : ''}<small>Click to read${target(e) ? ' and look' : ''} · right-click to dismiss</small>`;
    t.hidden = false;
    t.style.right = Math.round(innerWidth - r.left + 10) + 'px';
    t.style.top = Math.round(Math.max(8, Math.min(r.top - 6, innerHeight - t.offsetHeight - 8))) + 'px';
  }

  // ---------- reading a letter ----------
  openLetter(k) {
    this.tip(null); this.cur = k; k.el.classList.add('read');
    const e = k.e;
    $('lTitle').textContent = e.title || 'News'; $('lWhen').textContent = this.api.when(e.t);
    $('lText').textContent = e.m;
    $('lWhy').hidden = !k.why; $('lWhyT').textContent = k.why || '';
    $('lGo').hidden = !target(e);
    const more = this.stack.length - 1; $('lMore').textContent = more > 0 ? `${more} more on the right` : '';
    $('letter').className = 'glass ' + tone(e); $('letter').hidden = false;
    $('lPaused').hidden = !this.resume;
  }
  closeLetter() { if (this.cur) this.remove(this.cur); }
  get open() { return !!this.cur; }
  // the game picks up again once every big letter that paused it has been read or thrown away, unless the
  // player has set a speed meanwhile
  after() {
    if (!this.resume || this.cur || this.stack.some(q => q.big && !q.el.classList.contains('read'))) return;
    if (this.A.speed === 0) this.api.setSpeed(this.resume);
    this.resume = 0;
  }

  // ---------- looking at what a letter is about ----------
  go(e) {
    const A = this.A;
    if (e.who != null && e.who >= 0) this.api.select(e.who, true);
    else if (e.pid != null && A.ui && A.ui.projects.some(p => p.id === e.pid)) this.api.showProject(e.pid);
    else if (e.x != null) this.api.flyTo(e.x, e.y);
  }

  // ---------- alerts: worked out from the colony's state each update ----------
  alerts(U) {
    const A = this.A, list = [];
    if (!U || U.mode === 'stress') { if (this.sig) { $('alerts').innerHTML = ''; this.sig = ''; } return; }
    const P = U.p, live = i => P[i] && !(P[i][6] & 16), people = f => { const o = []; for (let i = 0; i < P.length; i++) if (live(i) && f(P[i], i)) o.push(i); return o; };
    const named = (ids, one, many) => ids.length === 1 ? `${A.names[ids[0]]} ${one}` : `${ids.length} ${many}`;
    const add = (key, title, aims, detail) => list.push({ key, title, aims, detail });
    const eaters = U.alive + U.seed.queue.length + (U.seed.printing ? 1 : 0), days = eaters ? U.food / eaters : 99;
    if (U.seed.feed > 0 && !U.seed.queue.length && !U.seed.printing && U.seed.stored > 0) add('print', ALERTS.print[1], [{ tab: 'archive' }]);
    const F = U.F, Y = U.year, usable = F ? F.usable : U.food, fdays = eaters ? usable / eaters : 99;
    if (eaters && fdays < 10) add('food', usable < 1 ? 'Nothing left to eat' : `Food for ${Math.max(1, Math.floor(fdays))} day${Math.floor(fdays) === 1 ? '' : 's'}`, [{ tab: 'life' }], usable < 1 ? 'Nobody has had a meal since the food ran out.' : U.food >= 1 ? `${Math.floor(U.food)} meals of it are the lander’s rations.` : '');
    if (Y && eaters && Y.deepIn > 0 && Y.deepIn <= 15 && fdays < Y.deepIn + 20) add('deep', `Deep cold in ${Y.deepIn} day${Y.deepIn === 1 ? '' : 's'}, food for ${Math.floor(fdays)}`, [{ tab: 'life' }], `It lasts twenty days, so the colony needs about ${(Y.deepIn + 20) * eaters} meals and has ${Math.floor(usable)}.`);
    if (F && F.locked > 0 && !U.crews.some(c => !c.gone && c.work === 'kitchen' && c.members.length)) add('locked', ALERTS.locked[1], [{ tab: 'crews' }], `${Math.floor(F.locked)} meals’ worth is waiting.`);
    const fields = U.projects.filter(p => p.type === 'field' && p.done);
    if (fields.length && !U.crews.some(c => !c.gone && c.work === 'farm' && c.members.length)) add('nofarm', ALERTS.nofarm[1], [{ tab: 'crews' }]);
    const ripe = fields.filter(p => p.crop && p.crop.st === 'ripe');
    if (ripe.length) add('ripe', ripe.length === 1 ? `${ripe[0].name} is ready to harvest` : `${ripe.length} fields are ready to harvest`, ripe.map(p => ({ pid: p.id })));
    const ready = F ? F.life.filter(l => l && !l.tested && !l.queued && l.samples >= 3) : [];
    if (ready.length) add('samples', ready.length === 1 ? `${ready[0].name}: samples ready to test` : `${ready.length} sets of samples ready to test`, [{ tab: 'life:local' }]);
    let ids;
    if ((ids = people(p => p[6] & 8)).length) add('hungry', named(ids, 'is hungry', 'people are hungry'), ids.map(i => ({ who: i })));
    if (ids.length && F && F.waiting >= ids.length && U.crews.some(c => !c.gone && c.work === 'kitchen' && c.members.length)) add('behind', ALERTS.behind[1], [{ tab: 'crews' }], `${Math.floor(F.waiting)} meals’ worth is waiting for the kitchen.`);
    if ((ids = people(p => p[6] & 64)).length) add('cold', named(ids, 'is dangerously cold', 'people are dangerously cold'), ids.map(i => ({ who: i })));
    if ((ids = people(p => p[6] & 128)).length) add('unwell', named(ids, 'is unwell', 'people are unwell'), ids.map(i => ({ who: i })));
    if ((ids = people(p => p[6] & 4)).length) add('alone', named(ids, 'broke down', 'people broke down'), ids.map(i => ({ who: i })));
    if ((ids = people(p => p[6] & 512)).length) add('down', named(ids, 'is down', 'people are down'), ids.map(i => ({ who: i })));
    if ((ids = people(p => p[6] & 256 && !(p[6] & 512))).length) add('bleed', named(ids, 'is bleeding', 'people are bleeding'), ids.map(i => ({ who: i })));
    if ((ids = people(p => p[6] & 2 && !(p[6] & 768))).length) add('hurt', named(ids, 'is hurt', 'people are hurt'), ids.map(i => ({ who: i })));
    if ((ids = people(p => p[6] & 16384)).length) add('crisis', named(ids, 'is gravely ill', 'people are gravely ill'), ids.map(i => ({ who: i })));
    if ((ids = people(p => p[6] & 4096 && !(p[6] & 16384))).length) add('sick', named(ids, 'is sick', 'people are sick'), ids.map(i => ({ who: i })));
    const clinic = U.projects.find(p => p.type === 'clinic' && p.done);
    if (U.care && !U.care.iso && (ids = people(p => p[6] & 32768 && !(p[6] & 8192))).length) add('catching', ALERTS.catching[1], clinic ? [{ pid: clinic.id }] : ids.map(i => ({ who: i })), clinic ? '' : 'There is no clinic yet to set the rule on: build one.');
    const H = U.hz;
    if (H) {
      const burning = U.projects.filter(p => p.fire);
      if (burning.length) add('bfire', burning.length === 1 ? `${burning[0].name} is on fire` : `${burning.length} buildings are on fire`, burning.map(p => ({ pid: p.id })));
      if (H.alarm && H.fire.length) { const t = H.fire[0]; add('fire', 'Fire near the camp', [{ x: t % MAP + .5, y: (t / MAP | 0) + .5 }]); }
      const wet = U.projects.filter(p => p.wet && p.type !== 'shelter');
      if (wet.length) add('flooded', wet.length === 1 ? `${wet[0].name} is under water` : `${wet.length} buildings are under water`, wet.map(p => ({ pid: p.id })));
      else if (H.lv > 1) add('floodwarn', 'The river is in flood', [], 'The water is over the low ground. Nothing the colony has built is in it.');
      else if (H.warn) add('floodwarn', ALERTS.floodwarn[1], []);
    }
    const hurtN = people(p => p[6] & 4098).length, M = U.med;
    if (hurtN && U.care && !U.care.medics) add('nomedic', ALERTS.nomedic[1], []);
    if (M) { const out = [M.dress ? '' : 'dressings', M.pk ? '' : 'painkillers', M.abx ? '' : 'antibiotics', M.blood ? '' : 'blood substitute'].filter(Boolean); if (out.length) add('meds', `Out of ${out.join(', ')}`, []); }
    if ((ids = people(p => p[3] >= 70 && !(p[6] & 4))).length) add('strain', named(ids, 'is near breaking point', 'people are near breaking point'), ids.map(i => ({ who: i })));
    if ((ids = people(p => p[2] >= 90)).length) add('tired', named(ids, 'is exhausted', 'people are exhausted'), ids.map(i => ({ who: i })));
    if ((ids = people(p => p[4] < 35)).length) add('trust', named(ids, 'is losing trust in the Seed', 'people are losing trust in the Seed'), ids.map(i => ({ who: i })));
    if ((ids = people(p => p[1] < 0 && p[0] !== ACT.WAKE && !(p[6] & (65536 | 131072)))).length) add('nocrew', named(ids, 'has no crew', 'people have no crew'), ids.map(i => ({ who: i })));
    const stalled = U.projects.filter(p => p.stall && !p.done);
    if (stalled.length) add('stalled', stalled.length === 1 ? `${stalled[0].name} stalled` : `${stalled.length} projects stalled`, stalled.map(p => ({ pid: p.id })), stalled.map(p => `${p.name}: ${p.wait}.`).join(' '));
    const starved = U.projects.filter(p => p.type === 'plant' && p.done && p.powered && p.why && p.why.startsWith('Waiting'));
    if (starved.length) add('feedwait', starved.length === 1 ? `${starved[0].name} is waiting` : `${starved.length} feedstock plants are waiting`, starved.map(p => ({ pid: p.id })), starved[0].why);
    const dark = U.projects.filter(p => p.done && p.type !== 'solar' && !p.powered && !p.shut);
    if (dark.length) add('dark', dark.length === 1 ? `${dark[0].name} is dark` : `${dark.length} buildings are dark`, dark.map(p => ({ pid: p.id })));
    const idle = U.crews.filter(c => !c.gone && c.work === 'build' && c.members.length && c.proj < 0);
    if (idle.length && U.shelter.done && !U.projects.some(p => !p.done && !p.paused && p.type !== 'test')) add('idle', ALERTS.idle[1], [{ tab: 'build:plan' }]);
    list.sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
    this.list = list;
    const sig = list.map(a => a.key + ':' + a.title + ':' + (a.detail || '')).join('|');
    if (sig === this.sig) return;
    this.sig = sig;
    $('alerts').innerHTML = list.map(a => {
      const [lvl, , help] = ALERTS[a.key], sev = a.key === 'food' && fdays < 3 ? 'bad' : lvl;
      return `<button class="al ${sev}" data-a="${a.key}"><i></i><span><b>${esc(a.title)}</b><small>${esc([a.detail, help].filter(Boolean).join(' '))}</small></span>${a.aims.length > 1 ? `<em>${a.aims.length}</em>` : ''}</button>`;
    }).join('');
  }
  // each click on an alert looks at the next person or building it is about
  goAlert(key) {
    const a = (this.list || []).find(q => q.key === key); if (!a || !a.aims.length) return;
    const k = (this.cycle[key] = ((this.cycle[key] ?? -1) + 1) % a.aims.length), aim = a.aims[k];
    if (aim.tab) this.api.tab(aim.tab); else this.go(aim);
  }
}
const target = e => (e.who != null && e.who >= 0) || e.pid != null || e.x != null;
// a letter's colour: red for bad news that matters, amber for smaller trouble, green for good news, blue for the rest
const tone = e => e.k === 'bad' ? (e.lvl >= 2 ? 'bad' : 'warn') : e.k === 'good' ? 'good' : 'info';

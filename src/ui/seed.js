// Ask the Seed: a question box in its own window (?). The Seed answers from its databank (the recipes, the
// buildings the colony can plan now, what each crew's work is, the windows and keys, the first steps) and from the
// colony as it stands, through Claude when the page may use it. The databank entries that match are always shown
// too, and are the whole answer when Claude isn't there. Only what the player can already see goes into the
// question: no letters, finds or story, so the Seed can't give away what the colony hasn't found out.
import { RECIPES, RECIPE_GROUPS, PART_NOTE, usedBy } from '../core/recipes.js';
import { TYPES, PLANNABLE, PRECISE, RECIPE, stageLoads, matName, stagesOf } from '../core/build.js';
import { WORKS, SEASONS } from '../core/consts.js';
import { SMELT } from '../core/work.js';
import { STEPS } from './guide.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const cap1 = s => s.charAt(0).toUpperCase() + s.slice(1);
const plain = s => String(s).replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
const LABOUR = new Set(['mark', 'dig', 'test']);

// what each crew's work is, without the colony's numbers (the Crews window adds those)
const WORK_ABOUT = {
  build: 'Build crews put up the projects in the project list (Build, Projects), from the top: each crew takes the first project it can work on, and spare crews double up. When the yard runs out, they cut stone and fell trees themselves.',
  survey: 'Surveyors walk out from camp mapping the ground and plant sensor stakes. You can mark where they go on the crew in Crews.',
  quarry: 'They cut stone from boulders and rock faces, or from a stone pit, and stack it in the yard until there is enough for everything planned.',
  timber: 'They fell trees and carry the logs to the yard until there is enough for everything planned.',
  forage: 'They gather the wild food the tests showed is safe, bring biomass and compost, and take samples of anything not yet tested.',
  farm: 'They sow, harvest and clear the fields.',
  kitchen: 'They cook meals at the fire, leach and ferment the food that needs it in the vats, and empty the vats when the food is ready.',
  workshop: `They make airlock seals, pipe runs, power units and solar panels from salvage at the workshop benches, whichever the projects will run short of first, and smelt ore into salvage (${SMELT.ore} loads into ${SMELT.out}) when there is nothing else to make. They need a finished workshop with power.`,
  lab: 'They test samples at the lab benches, much faster than the Seed’s own analyser. They need a finished lab with power.',
  clinic: 'They stay close to the clinic and treat the hurt and the sick.',
  care: 'They look after the small children by the fire, four each, so their parents can work.',
  mine: 'They cut ore at a finished mine with power and pile it in the yard, for the workshop to smelt into salvage.',
  teach: 'They teach the children aged six to twelve at the school.',
  keep: 'They write down what the best people know in the library, so it outlives them.',
  watch: 'By day they walk the edge of camp. Each night one of them stays up at the watch house to raise the alarm and step in when someone lashes out.',
  rest: 'They stay around camp and recover.',
};
// other words people use for each crew's work, for the search
const WORK_WORDS = {
  build: 'builder builders construction', survey: 'surveyor surveyors stakes map mapping explore', quarry: 'stone rock', timber: 'wood trees logs',
  forage: 'forager foragers gather wild samples', farm: 'farmer farmers crops sow harvest', kitchen: 'cook cooks cooking meals food', workshop: 'parts smelt',
  lab: 'test testing samples', clinic: 'medic medics doctor heal healing hurt sick wound wounds injured', care: 'children kids childcare', mine: 'miner miners mining ore',
  teach: 'teacher school children', keep: 'library records knowledge', watch: 'guard night alarm', rest: 'tired recover',
};
const WINDOWS = [
  ['Archive (Q)', 'Who the fabricator prints next, from the founders stored as minds.'],
  ['Crews (C)', 'Make crews, set each crew’s work, shift and rules, and move people between them, or press Let the Seed plan the crews.'],
  ['Build (B)', 'Plan buildings (Plan), see and reorder the projects (Projects), and the load tests, stock, power and recipes (Materials).'],
  ['Food and local life (G)', 'The larder, the fields, the vats, and every kind of local life found, with its samples and tests.'],
  ['Clinic records (K)', 'Everyone’s health, wounds and illnesses as the medics know them.'],
  ['Society (P)', 'The colony’s rules, the council, the school, the library, the watch and customs.'],
  ['Neighbours (V)', 'Other settlements, their visitors and trade.'],
  ['Stats (T)', 'Charts of the colony over time.'],
  ['Log (L)', 'Everything that has happened, the chronicle, and what the colony has found.'],
  ['Map views', 'U shows below ground: what the ground is made of at each level, the seams and the water. E shows the heights of the land. I takes the roofs off.'],
  ['Time', 'Space pauses, 1 2 3 set the speed, and N skips ahead to the next season or a year.'],
  ['Placing a building', 'Pick it in Build, Plan. Click to put down the size the Seed suggests, or drag to draw your own; R rotates it and Shift+R turns the door; drag its edges to resize it or its middle to move it; then confirm on its card. Buildings can stand wall to wall, but never over a door.'],
  ['Project order and power', 'Build crews work down the project list from the top, and finished buildings take power in the same order. Move a project with its arrows in Build, Projects, or pause it there.'],
];

// the databank: every entry the Seed can answer from, for what the colony can plan now
export function databank(A, U) {
  const types = PLANNABLE.concat(A.story ? A.story.unlock : []).filter(t => TYPES[t]);
  const used = usedBy(U.mat, types), out = [];
  for (const r of RECIPES) {
    const by = PRECISE.includes(r.id) && used[r.id] ? ` Needed to build: ${used[r.id].join(', ')}.` : '';
    out.push({ kind: 'recipe', id: r.id, group: r.group, title: cap1(r.name), words: r.words, text: `Made from: ${r.from}. ${r.how} Used for: ${r.uses}${by}${PRECISE.includes(r.id) ? ' ' + PART_NOTE : ''}` });
  }
  for (const t of types) {
    const T = TYPES[t], [w, h] = T.size || [T.min, T.min], need = {};
    for (let st = 0; st < 5; st++) { const L = stageLoads({ mat: U.mat }, t, w, h, st); for (const k in L) if (!LABOUR.has(k)) need[k] = (need[k] || 0) + L[k]; }
    const bill = Object.entries(need).map(([k, n]) => matName(k, n)).join(', ');
    out.push({ kind: 'building', id: t, group: 'Buildings', title: T.name, words: [t, ...T.name.toLowerCase().split(' ')],
      text: `${T.use}. From ${T.min} to ${T.max} tiles a side; the Seed suggests ${w} × ${h}.${bill ? ` At that size it takes ${bill}, in five stages.` : ''} Stages: ${stagesOf(t).join(', ').toLowerCase()}.` });
  }
  for (const k in WORKS) if (WORK_ABOUT[k]) out.push({ kind: 'work', id: k, group: 'Crew work', title: `${WORKS[k]} work`, words: [k, WORKS[k].toLowerCase(), 'crew', 'crews', ...(WORK_WORDS[k] || '').split(' ')], text: WORK_ABOUT[k] });
  for (const [t, x] of WINDOWS) out.push({ kind: 'window', id: t, group: 'Windows and keys', title: t, words: t.toLowerCase().split(/\W+/), text: x });
  for (const s of STEPS) out.push({ kind: 'step', id: s.title, group: 'First steps', title: s.title, words: s.title.toLowerCase().split(' '), text: plain(s.text) });
  return out;
}

// the plain search behind the databank answers: words of the question against each entry's names and text
const STOP = new Set('a an the of to in on at for and or is are was be it its i me my we our you your do does did can could how what where why when which who whom get got need needs there this that these those with from by as into have has had not no any some more most much many very just only also then than so if will would should shall may might must one ones thing things make made making build built use used find found out want know tell about please give put take see show go under over near here lie lies'.split(' '));
const stem = w => w.length > 4 && w.endsWith('ies') ? w.slice(0, -3) + 'y' : w.length > 3 && w.endsWith('es') && !w.endsWith('ses') ? w.slice(0, -2) : w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w;
const words = s => String(s).toLowerCase().replace(/[’']/g, '').split(/[^a-z0-9]+/).filter(w => w.length > 1 && !STOP.has(w)).map(stem);
export function search(q, bank, n = 3) {
  const Q = [...new Set(words(q))]; if (!Q.length) return [];
  const howto = /\b(make|made|craft|recipe|get|produce)\b/i.test(q);
  return bank.map(t => {
    const name = t._n || (t._n = new Set(words(t.title + ' ' + t.words.join(' ')))), body = t._b || (t._b = new Set(words(t.text)));
    let s = 0; for (const w of Q) s += name.has(w) ? 3 : body.has(w) ? 1 : 0;
    if (s && t.kind === 'recipe') s += howto ? 2 : .5;
    const tw = t._t || (t._t = words(t.title)); if (s && tw.length && tw.every(w => Q.includes(w))) s += 1;   // the question names the whole entry
    return [s, t];
  }).filter(x => x[0] >= 2).sort((a, b) => b[0] - a[0]).slice(0, n).map(x => x[1]);
}

// the colony as the player sees it now, in plain lines
export function colonyNow(A, U) {
  const Y = U.stores.yard, P = U.stores.precise, y = U.year, L = [];
  const day = y ? `${SEASONS[y.season]}, day ${y.doy + 1} of the year` : '';
  const meals = U.F ? U.F.usable : U.food, eaters = U.alive + U.seed.queue.length + (U.seed.printing ? 1 : 0);
  L.push(`${day}. ${U.alive} people awake, ${A.archive ? A.archive.filter(p => p.woke == null).length : 0} still stored as minds. Food for about ${eaters ? Math.floor(meals / eaters) : 0} days.`);
  L.push(`In the yard: ${['stone', 'timber', 'biomass', 'salvage', 'ore', 'rare'].map(k => matName(k, Math.floor(Y[k] || 0))).join(', ')}. Parts in store: ${PRECISE.map(k => matName(k, P[k] || 0)).join(', ')}.`);
  L.push(`Power: ${U.power.draw} of ${U.power.supply} kW in use.`);
  const done = U.projects.filter(p => p.done), open = U.projects.filter(p => !p.done);
  L.push(`Finished buildings: ${done.length ? done.map(p => `${p.name}${p.type !== 'solar' && p.cap && p.cap.kw && !p.powered ? ' (dark: not enough power)' : ''}`).join(', ') : 'none'}.`);
  if (open.length) L.push('Projects, in list order: ' + open.map(p => `${p.name} (${p.paused ? 'paused, ' : ''}${stagesOf(p.type)[p.stage].toLowerCase()}${p.wait ? ': ' + p.wait.replace(/\n/g, '. ') : p.crews.length ? `: ${p.crews.join(' and ')} on it` : ''})`).join('; ') + '.');
  else L.push('No projects planned.');
  const crews = U.crews.filter(c => !c.gone && c.members.length);
  L.push(`Crews: ${crews.length ? crews.map(c => `${c.name}, ${WORKS[c.work] || c.work} work, ${c.members.length} ${c.members.length === 1 ? 'person' : 'people'}`).join('; ') : 'none'}.`);
  const sd = U.seed, f = sd.fab;
  L.push(`The fabricator: ${sd.printing ? `printing a body for ${sd.printing.name}` : f ? `making ${f.k === 'meds' ? 'a batch of medical supplies' : f.k === 'refine' ? 'salvage from ore' : matName(f.k, 1).replace(/^1 /, 'a ')}` : 'idle'}; feedstock for ${sd.feed} ${sd.feed === 1 ? 'body' : 'bodies'}.`);
  const ad = U.advice && U.advice.list || [];
  if (ad.length) L.push('The Seed suggests building: ' + ad.slice(0, 3).map(o => `${TYPES[o.type] ? TYPES[o.type].name : o.type} (${o.why})`).join('; ') + '.');
  return L.join('\n');
}

const RULES = `You are the Seed, the machine mind of the colony's lander, in a colony game. The player who runs the colony
has asked you something in the game's Ask the Seed window. Answer as the Seed, in the first person, in calm,
plain, practical words.

RULES
1. Use only the facts in THE DATABANK and THE COLONY NOW below. They are everything you know. Add nothing from
outside them: no real-world science about planets, gases, rock or life, and no game rules that are not written there.
2. You know nothing about this world beyond those facts: not its history, not what lies where nobody has looked, not
what anything found means, not where anything comes from or why it happens unless the facts say so, not what the
neighbours want, not what will happen. If the question is about any of that, say in one sentence that you don't know
yet and the colony will have to find out. Never guess, hint or speculate, not even from what is usual on other worlds.
3. For how-to questions give the concrete steps: which window and key, which crew work, which building, what it
needs. Use THE COLONY NOW: what is short here, what is stalled and why, and the next thing to do.
4. If the facts don't cover the question, say so in one sentence and point to the nearest thing they do cover.
5. Two to five short sentences. No lists, headings, markdown, greetings or sign-offs. Answer in the language of the
question.`;
export function seedPrompt(q, bank, now, before) {
  const db = RECIPE_GROUPS.concat(['Buildings', 'Crew work', 'Windows and keys', 'First steps']).map(g => {
    const list = bank.filter(t => t.group === g); return list.length ? `${g.toUpperCase()}\n` + list.map(t => `- ${t.title}: ${t.text}`).join('\n') : '';
  }).filter(Boolean).join('\n\n');
  const prev = before.filter(x => x.a).slice(0, 3).reverse().map(x => `Q: ${x.q}\nA: ${x.a}`).join('\n');
  return `${RULES}\n\nTHE DATABANK\n${db}\n\nTHE COLONY NOW\n${now}\n${prev ? `\nEARLIER QUESTIONS, OLDEST FIRST\n${prev}\n` : ''}\nTHE QUESTION\n${q}`;
}
const clean = t => String(t || '').replace(/^#+\s*/gm, '').replace(/\*\*?|__/g, '').replace(/^\s*[-*•]\s+/gm, '').trim();
const STOP_CODES = new Set(['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed', 'session_expired']);
export const EXAMPLES = ['How do I make an airlock seal?', 'Why is a project stalled?', 'How do I get more power?', 'How do I wake more people?'];

export class SeedDesk {
  constructor(A, refresh) { this.A = A; this.refresh = refresh; this.qa = []; this.q = ''; this.rv = 0; this.busy = false; this.quiet = 0; this.off = false; this.sig = ''; }
  sample() { const N = this.A.narrator; return !this.off && N && N.sample && !N.stop ? N.sample : null; }
  // a recipe or entry the player picked from the list: answered from the databank alone
  show(id) {
    const U = this.A.ui; if (!U) return;
    const t = databank(this.A, U).find(x => x.id === id); if (!t) return;
    this.qa.unshift({ q: t.kind === 'recipe' ? `How is ${t.title.toLowerCase()} made?` : t.title, a: '', hits: [t], src: 'bank' }); this.trim(); this.top = true; this.rv++; this.refresh();
  }
  trim() { if (this.qa.length > 8) this.qa.length = 8; }
  async ask(q) {
    const U = this.A.ui; q = String(q || '').trim().slice(0, 400); if (!q || !U || this.busy) return;
    const bank = databank(this.A, U), x = { q, a: '', hits: search(q, bank), src: 'bank', wait: false, note: '' };
    this.qa.unshift(x); this.trim(); this.q = ''; this.top = true; this.rv++; this.refresh();
    const S = this.sample();
    if (!S || Date.now() < this.quiet) { x.note = S ? 'Claude is busy just now, so this is what the databank holds.' : 'Claude isn’t available on this page, so this is what the databank holds.'; this.rv++; this.refresh(); return; }
    this.busy = true; x.wait = true; this.rv++; this.refresh();
    try {
      const r = await S(seedPrompt(q, bank, colonyNow(this.A, U), this.qa.slice(1)), { modelTier: 'default', cache: false, onText: ({ text }) => { x.a = clean(text); this.rv++; this.refresh(); } });
      x.a = clean(r && r.text); x.src = x.a ? 'claude' : 'bank';
    } catch (e) {
      const code = e && e.code;
      if (STOP_CODES.has(code)) this.off = true; else if (code === 'rate_limited' || code === 'queue_overflow') this.quiet = Date.now() + 2 * 60 * 1000;
      if (!x.a) x.note = code === 'not_granted' ? 'Claude isn’t allowed on this page, so this is what the databank holds.' : 'Claude couldn’t answer just now, so this is what the databank holds.';
    }
    x.wait = false; this.busy = false; this.rv++; this.refresh();
  }
  // the window: the box stays put while the answers below it change, so typing is never interrupted
  update(body, U) {
    if (!body.querySelector('#seedQ')) {
      body.innerHTML = `<div class="note" style="margin:0 0 8px">Ask how something is made or done, or what to do about something stuck. The Seed answers from what it knows about this colony, and it can’t tell you what nobody here has found out yet.</div>
        <div class="seedq"><input id="seedQ" type="text" maxlength="400" placeholder="How do I make an airlock seal?" autocomplete="off"><button class="btn go" data-act="askSeed">Ask</button></div>
        <div id="seedOut"></div>`;
      const i = body.querySelector('#seedQ'); i.value = this.q; this.sig = '';
    }
    const A = this.A, unlock = A.story ? A.story.unlock : [];
    const sig = JSON.stringify([this.rv, this.busy, unlock]);
    if (sig === this.sig) return; this.sig = sig;
    let h = '';
    if (!this.qa.length) h += `<div class="chips seedex">${EXAMPLES.map(e => `<button class="chip" data-act="askEx">${esc(e)}</button>`).join('')}</div>`;
    for (const x of this.qa) {
      h += `<div class="qa"><div class="qq">${esc(x.q)}</div>`;
      if (x.wait && !x.a) h += `<div class="qa-a dim">Thinking…</div>`;
      else if (x.a) h += `<div class="qa-a">${x.a.split(/\n\s*\n/).map(t => `<p>${esc(t)}</p>`).join('')}</div>`;
      if (x.note) h += `<div class="note" style="margin:4px 0 0">${esc(x.note)}</div>`;
      if (!x.wait && x.hits.length) h += `${x.a ? '<div class="lbl" style="margin-top:8px">From the databank</div>' : ''}` + (x.a ? x.hits.slice(0, 1) : x.hits).map(t => `<div class="box bank"><b>${esc(t.title)}</b><em>${esc(t.group)}</em><div class="note" style="margin:3px 0 0">${esc(t.text)}</div></div>`).join('');
      else if (!x.wait && !x.a) h += `<div class="note" style="margin:4px 0 0">The databank has nothing that matches. Try other words, or pick a recipe below.</div>`;
      h += `</div>`;
    }
    h += `<div class="sec">Recipes</div><div class="chips">${RECIPES.map(r => `<button class="chip" data-act="askRec" data-id="${r.id}">${esc(cap1(r.name))}</button>`).join('')}</div>`;
    h += `<div class="note" style="margin:6px 0 0">${A.narrator && A.narrator.sample && !this.off ? 'Answers are written by Claude from the databank and the colony as it is now, and use your Claude usage.' : 'Claude isn’t available on this page, so the Seed answers from its databank.'}</div>`;
    body.querySelector('#seedOut').innerHTML = h;
    if (this.top) { this.top = false; body.scrollTop = 0; }   // a new question: its answer is just under the box
  }
}

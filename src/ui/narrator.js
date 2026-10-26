// The page's half of in-game Claude: the simulation sends questions (narrator.js in core), this asks Claude through
// the page's sample capability and sends the answers back as commands, which the simulation checks before using.
// One question at a time, never in a loop: a new season's question replaces an older one still waiting, a refusal
// or a broken answer drops the question (the rule-based plan or text stands), and a rate limit or a missing
// permission stops asking for a while or for this visit. Nothing in the game says Claude was involved.
const KEY = 'colony-claude';
const QUIET_MS = 30 * 60 * 1000;   // after a rate limit
const STOP_CODES = new Set(['not_granted', 'sampling_disabled', 'not_declared', 'capability_disabled', 'capability_removed', 'session_expired']);

export class Narrator {
  constructor(A, api) {
    this.A = A; this.api = api; this.sample = null; this.q = []; this.busy = false; this.stop = false; this.quiet = 0;
    try { this.on = localStorage.getItem(KEY) !== 'off'; } catch (e) { this.on = true; }
    const box = document.getElementById('nClaude');
    if (box) { box.checked = this.on; box.onchange = e => { this.on = e.target.checked; try { localStorage.setItem(KEY, this.on ? 'on' : 'off'); } catch (er) { /* fine */ } if (this.on) this.next(); }; }
    const use = window.claude && window.claude.use ? window.claude.use('sample').catch(() => null) : Promise.resolve(null);
    use.then(s => { this.sample = s; if (!s && box) box.closest('label').hidden = true; this.next(); });
  }
  // a new landing is a good moment to ask for permission, since the player just clicked
  async askLeave() {
    try { const p = window.claude && await window.claude.use('permissions'); if (p && this.on) await p.request(['sample']); } catch (e) { /* asked on first use instead */ }
  }
  take(list) {
    for (const x of list) {
      if (x.kind === 'season') this.q = this.q.filter(y => y.kind !== 'season');
      this.q.push(x);
    }
    if (this.q.length > 6) this.q.splice(0, this.q.length - 6);
    this.next();
  }
  async next() {
    if (this.busy || !this.on || this.stop || !this.sample || !this.q.length || Date.now() < this.quiet) return;
    const x = this.q.shift(); this.busy = true;
    try {
      if (x.kind === 'season') {
        const r = await this.sample.json(seasonPrompt(x.brief), { modelTier: 'default', cache: false });
        if (r && typeof r === 'object') await this.api.cmd('narrate', { id: x.id, plan: r.plan, moments: r.moments, custom: r.custom });
      } else if (x.kind === 'chron') {
        const r = await this.sample(chronPrompt(x), { modelTier: 'default', cache: false });
        const text = String(r.text || '').split(/\n\s*\n/).map(t => t.replace(/^#+\s*/, '').trim()).filter(Boolean);
        if (text.length && !r.truncated) await this.api.cmd('chronText', { i: x.i, text });
      }
    } catch (e) {
      const code = e && e.code;
      if (STOP_CODES.has(code)) this.stop = true;
      else if (code === 'rate_limited' || code === 'queue_overflow') this.quiet = Date.now() + QUIET_MS;
    }
    this.busy = false;
    if (this.q.length) setTimeout(() => this.next(), 1500);
  }
}

const CANON = `The game: a colony on a newly settled world, in hard science fiction. A lander called the Seed came down
with forty founders stored as minds in its archive; it prints bodies for them, plans the crews' work and gives advice.
People are born here too, from the Seed's growth tanks. There are seasons (Thaw, Long light, Storm, Deep cold), fields
of crops from the seed bank, local life that must be tested before anyone eats it, buildings raised by build crews,
and neighbours from settlements beyond the map who come as visitors and traders. Tone: restrained, concrete,
physically plausible, like the fiction of Greg Egan or Peter Watts; no melodrama, no miracles, no villains.`;

function seasonPrompt(b) {
  return `You are the unseen narrator of a colony game. The player never sees you or this message. Plan the coming season's
dangers, and write a few small moments of colony life, from the facts below.

${CANON}

YOUR TWO JOBS
1. The director: choose which of the listed events happen this season, and on which days. Their costs must add up to
at most ${b.plannable} (the season's budget is ${b.budget}). Days must be after day ${b.today} and no later than day
${b.last}, at least two days apart. Read the colony's state: when it is struggling (little food, high strain, recent
deaths, few people) plan less or nothing; when it is strong and comfortable, push it. Vary it: the rules would have
planned ${JSON.stringify(b.rulePlan)}. An event only happens if the world allows it then. An empty plan is allowed.
2. The writer: up to two moments, each a small, true-to-life scene about one to four of the people listed: something
done, said, made, mended, taught, argued over or shared, grounded in who they are (traits, work, partner, what
happened to them lately). Two to four sentences, past tense, plain words, like a careful observer writing in the
colony's log. Each changes how the people in it feel a little: "lift" eases their strain, "weigh" adds to it, "none"
neither. Give each a "memory": one short sentence for the person's own memories, past tense, starting with a verb
(for example "Taught Ada to splice cable by lamplight."). Use only the names given and the ids beside them.
${b.colony.writeCustom ? `You may also start one new custom, a yearly observance that grows naturally out of what happened recently (or
none, which is usually right): a name of two to four words and two or three sentences ending with what the colony will
do on this day every year.` : 'Do not start a custom this time: "custom" must be null.'}

NEVER: invent technology, places, creatures, settlements or people that are not in the facts; say anything about where
the colony or the neighbours came from, about the Seed's archive or past, or about anything unexplained; explain,
guess at or hint at the causes of anything; mention this game, the player, budgets or events by their names.

THE FACTS
${JSON.stringify({ season: b.season, year: b.year, today: b.today, lastDayOfSeason: b.last, colony: b.colony, events: b.events, people: b.people, recentNews: b.recent })}

Answer with JSON only, in this shape:
{"plan":[{"k":"<event key>","day":<day>}],"moments":[{"day":<day>,"title":"<two to five words>","text":"<the scene>","who":[<ids>],"mood":"lift"|"weigh"|"none","memory":"<one sentence>"}],"custom":null}`;
}

function chronPrompt(x) {
  return `You are the colony's chronicler in a hard science fiction colony game. Below is the chronicle of ${x.year ? 'a year' : 'a stretch of time the player skipped'}, written plainly
from the colony's records. Rewrite it as a careful historian of the colony would: three to six short paragraphs of
restrained, concrete prose, past tense, with the most important things first.

${CANON}

Keep every fact, name, number and date exactly as given, and keep the last paragraph's meaning if it says why the
skip stopped. Add nothing that is not stated: no new events, causes, feelings, places or people. Do not explain or
speculate about anything the records leave unexplained, and do not interpret anything that was found or analysed:
repeat it plainly or leave it out. No headings, no lists, no title. Separate paragraphs with a blank line.

TITLE: ${x.title}

${x.text.join('\n\n')}`;
}

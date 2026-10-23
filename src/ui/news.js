// Telling the player what happens, so nothing important waits in the log to be found. Three ways:
// - cards: notable events on the right of the screen for a while, with a click that takes the camera there;
// - letters: big events in the middle of the screen, with the game paused until they are read;
// - alerts: problems that last (rations running low, people hungry, buildings dark), shown until they are fixed.
// The first time each kind of event happens, its card or letter also says what it means and what can be done.
// The log keeps everything; this only decides what is worth interrupting for.
import { ACT } from '../core/consts.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const KEY = 'colony-news';
const CARD_S = 22, CARD_NEW_S = 45, MAX_CARDS = 4;

// what an event means, said once, the first time it happens
export const EXPLAIN = {
  woke: 'A founder is awake in a printed body. For the first ten days a new body feels strange: they tire faster and work a little slower. Unless you have taken over the crews, the Seed puts each new founder in one.',
  nocrew: 'Since you took over the crews from the Seed, new founders wait at camp until you put them in one. Open Crews (C) to choose.',
  feedstock: "The fabricator can't print any more people. From here the colony has only the people who are already awake.",
  hurt: 'Accidents happen most to the exhausted, the reckless and people new to their bodies. The hurt heal in about two days, twice as fast in a clinic with power, and walk and work slower until then.',
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
  nofood: 'The colony has no other food yet. Hungry people tire faster and strain more, and each day without a meal costs health until they die.',
};

// problems that last: what to look at and what helps
const ALERTS = {
  print: ['info', 'Choose who to print', 'The fabricator has feedstock and nobody in line. Open the Archive (Q) to pick who wakes next.'],
  food: ['warn', '', 'Every meal comes out of the lander’s rations, and nothing replaces them yet.'],
  hungry: ['bad', '', 'They lose health every day without a meal, and die when it runs out.'],
  hurt: ['warn', '', 'The hurt walk and work slower until they heal. A clinic with power heals them twice as fast.'],
  alone: ['warn', '', 'Strain got to be too much. They come back on their own after a few hours, a little calmer.'],
  strain: ['warn', '', 'Strain this high can end in a breakdown. Shorter shifts, bunks indoors, meals at a commons and time with friends bring it down.'],
  tired: ['warn', '', 'The exhausted work slower and have more accidents. The crew rule “Stop when exhausted” sends them to rest.'],
  trust: ['warn', '', 'People who don’t trust the Seed stop at the end of a normal day, whatever their shift. Trust grows when its plans work out, and falls with overwork and nights out in the dark.'],
  nocrew: ['info', '', 'People without a crew only take it easy at camp. Put them in one in the Crews window (C).'],
  dark: ['warn', '', 'There isn’t enough power for them. Build a solar field, or move them up the project list.'],
  stalled: ['warn', '', ''],
  idle: ['info', 'Nothing to build', 'A build crew has nothing on the project list. Plan a building in the Build window (B), or give the crew other work.'],
};
const ORDER = ['hungry', 'food', 'print', 'alone', 'hurt', 'strain', 'tired', 'trust', 'nocrew', 'stalled', 'dark', 'idle'];

export class News {
  constructor(A, api) {
    this.A = A; this.api = api; this.cards = []; this.letters = []; this.resume = 0; this.cycle = {}; this.sig = '';
    let st = {}; try { st = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch (e) { /* private window */ }
    this.seen = new Set(st.seen || []); this.pause = st.pause !== false; this.explain = st.explain !== false;
    $('cards').addEventListener('click', e => {
      const c = e.target.closest('[data-n]'); if (!c) return;
      const card = this.cards.find(k => k.n === +c.dataset.n); if (!card) return;
      if (!e.target.closest('.x')) this.go(card.e);
      this.drop(card);
    });
    $('cards').addEventListener('pointerover', e => { const c = e.target.closest('[data-n]'); const k = c && this.cards.find(q => q.n === +c.dataset.n); if (k) k.hold = true; });
    $('cards').addEventListener('pointerout', e => { const c = e.target.closest('[data-n]'); const k = c && this.cards.find(q => q.n === +c.dataset.n); if (k) { k.hold = false; k.until = Math.max(k.until, performance.now() + 4000); } });
    $('alerts').addEventListener('click', e => { const a = e.target.closest('[data-a]'); if (a) this.goAlert(a.dataset.a); });
    $('lGo').onclick = () => { const l = this.letters[0]; this.closeLetter(); if (l) this.go(l); };
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
  reset() { this.cards = []; this.letters = []; this.resume = 0; this.cycle = {}; this.sig = ''; $('cards').innerHTML = ''; $('alerts').innerHTML = ''; $('letter').hidden = true; }

  // ---------- events, as the log entries come in ----------
  add(entries) {
    for (const e of entries) {
      if (!e.lvl) continue;
      if (e.lvl >= 2) this.letter(e); else this.card(e);
    }
  }
  card(e) {
    const now = performance.now(), why = this.why(e.e);
    this.cards.unshift({ n: e.n, e, why, until: now + (why ? CARD_NEW_S : CARD_S) * 1000, hold: false });
    while (this.cards.length > MAX_CARDS) this.cards.pop();
    this.drawCards();
  }
  drop(card) { this.cards = this.cards.filter(k => k !== card); this.drawCards(); }
  drawCards() {
    $('cards').innerHTML = this.cards.map(k => {
      const e = k.e, aim = target(e);
      return `<div class="nc ${e.k || 'info'}${aim ? ' aim' : ''}" data-n="${e.n}" title="${aim ? 'Click to look' : ''}">
        <div class="nh"><b>${esc(e.title || '')}</b><em>${this.api.when(e.t)}</em><button class="x" aria-label="Dismiss"><svg class="ic"><use href="#i-close"/></svg></button></div>
        <p>${esc(e.m)}</p>${k.why ? `<div class="why"><i>New</i>${esc(k.why)}</div>` : ''}</div>`;
    }).join('');
  }
  tick() {
    const now = performance.now(), before = this.cards.length;
    this.cards = this.cards.filter(k => k.hold || k.until > now);
    if (this.cards.length !== before) this.drawCards();
  }

  // ---------- letters: the game waits until they are read ----------
  letter(e) {
    this.letters.push({ ...e, why: this.why(e.e) });
    if (this.letters.length === 1) this.showLetter();
    if (this.pause && this.A.speed > 0) { this.resume = this.A.speed; this.api.setSpeed(0); }
  }
  showLetter() {
    const l = this.letters[0]; if (!l) { $('letter').hidden = true; return; }
    $('lTitle').textContent = l.title || 'News'; $('lWhen').textContent = this.api.when(l.t);
    $('lText').textContent = l.m;
    $('lWhy').hidden = !l.why; $('lWhyT').textContent = l.why || '';
    $('lGo').hidden = !target(l);
    $('lMore').textContent = this.letters.length > 1 ? `${this.letters.length - 1} more after this` : '';
    $('letter').className = 'glass ' + (l.k || 'info'); $('letter').hidden = false;
    $('lPaused').hidden = !this.resume;
  }
  closeLetter() {
    this.letters.shift(); this.showLetter();
    // the game picks up again once the last letter is read, unless the player has set a speed meanwhile
    if (!this.letters.length && this.resume) { if (this.A.speed === 0) this.api.setSpeed(this.resume); this.resume = 0; }
  }
  get open() { return this.letters.length > 0; }

  // ---------- looking at what a card is about ----------
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
    if (U.seed.feed > 0 && !U.seed.queue.length && !U.seed.printing) add('print', ALERTS.print[1], [{ tab: 'archive' }]);
    if (eaters && days < 10) add('food', U.food < 1 ? 'No rations left' : `Rations for ${Math.max(1, Math.floor(days))} day${Math.floor(days) === 1 ? '' : 's'}`, [{ x: A.W.site.fire.x, y: A.W.site.fire.y }], U.food < 1 ? 'Nobody has had a meal since the rations ran out.' : '');
    let ids;
    if ((ids = people(p => p[6] & 8)).length) add('hungry', named(ids, 'is hungry', 'people are hungry'), ids.map(i => ({ who: i })));
    if ((ids = people(p => p[6] & 4)).length) add('alone', named(ids, 'broke down', 'people broke down'), ids.map(i => ({ who: i })));
    if ((ids = people(p => p[6] & 2)).length) add('hurt', named(ids, 'is hurt', 'people are hurt'), ids.map(i => ({ who: i })));
    if ((ids = people(p => p[3] >= 70 && !(p[6] & 4))).length) add('strain', named(ids, 'is near breaking point', 'people are near breaking point'), ids.map(i => ({ who: i })));
    if ((ids = people(p => p[2] >= 90)).length) add('tired', named(ids, 'is exhausted', 'people are exhausted'), ids.map(i => ({ who: i })));
    if ((ids = people(p => p[4] < 35)).length) add('trust', named(ids, 'is losing trust in the Seed', 'people are losing trust in the Seed'), ids.map(i => ({ who: i })));
    if ((ids = people(p => p[1] < 0 && p[0] !== ACT.WAKE)).length) add('nocrew', named(ids, 'has no crew', 'people have no crew'), ids.map(i => ({ who: i })));
    const stalled = U.projects.filter(p => p.stall && !p.done);
    if (stalled.length) add('stalled', stalled.length === 1 ? `${stalled[0].name} stalled` : `${stalled.length} projects stalled`, stalled.map(p => ({ pid: p.id })), stalled.map(p => `${p.name}: ${p.wait}.`).join(' '));
    const dark = U.projects.filter(p => p.done && p.type !== 'solar' && !p.powered);
    if (dark.length) add('dark', dark.length === 1 ? `${dark[0].name} is dark` : `${dark.length} buildings are dark`, dark.map(p => ({ pid: p.id })));
    const idle = U.crews.filter(c => !c.gone && c.work === 'build' && c.members.length && c.proj < 0);
    if (idle.length && U.shelter.done && !U.projects.some(p => !p.done && !p.paused && p.type !== 'test')) add('idle', ALERTS.idle[1], [{ tab: 'build' }]);
    list.sort((a, b) => ORDER.indexOf(a.key) - ORDER.indexOf(b.key));
    this.list = list;
    const sig = list.map(a => a.key + ':' + a.title + ':' + (a.detail || '')).join('|');
    if (sig === this.sig) return;
    this.sig = sig;
    $('alerts').innerHTML = list.map(a => {
      const [lvl, , help] = ALERTS[a.key], sev = a.key === 'food' && days < 3 ? 'bad' : lvl;
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

// The panels around the map: the orbital survey before the landing, then the top bar's readouts, the colonist
// portraits, the open projects, the window the dock opens (the archive of who the fabricator prints, the crews
// and their rules, building with stock, power, load tests, blueprints and the project list, and the log), the
// card of the person you picked, the card of the building you picked, and the card for a building being placed. They only show what the simulation reports and send commands back; they decide nothing.
import { ACT, ACT_NAME, SHIFTS, WORKS, RULES, SKILLS, SKILL_NAME, DAY_TICKS, HOUR, MAP } from '../core/consts.js';
import { TRAITS, suggestFirst } from '../core/founders.js';
import { PRINT_TICKS, SMELT } from '../core/work.js';
import { CROPS, CROP_KEYS, SAMPLES, TEST_H, PROC_NAME } from '../core/food.js';
import { TYPES, PLANNABLE, STAGE_NAMES, TEST_STAGES, stagesOf, matName, LANDER_KW, FEED, seamOf, PIT_ROCK } from '../core/build.js';
import { progress } from '../render/buildings.js';
import { crewColour, portrait } from '../render/people.js';
import { LETTERS } from '../render/view.js';
import { thingCard } from './things.js';
import { healthTab } from './health.js';
import { TRIAGE } from '../core/care.js';
import { EM_TXT } from '../core/control.js';
import { TR_NAME } from '../core/trauma.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const rgb = c => `rgb(${c.map(v => v | 0).join(',')})`;
const pad = n => String(n).padStart(2, '0');
const when = t => { const d = Math.floor(t / DAY_TICKS) + 1, h = (t % DAY_TICKS) / HOUR; return `Day ${d} ${pad(Math.floor(h))}:${pad(Math.floor((h % 1) * 60))}`; };
const cap1 = s => s.charAt(0).toUpperCase() + s.slice(1);
const SIDE = ['north', 'east', 'south', 'west'];
const pct = f => Math.round(f * 100) + '%';
const icon = (id, cls = 'ic') => `<svg class="${cls}"><use href="#i-${id}"/></svg>`;
const TICON = { shelter: 'seed', dorm: 'dorm', commons: 'commons', workshop: 'tool', clinic: 'clinic', solar: 'solar', test: 'test', field: 'field', lab: 'lab', plant: 'tank', cellar: 'cellar', burrow: 'below', mine: 'mine', pit: 'stone' };
const KIN = { partner: 'Partner', parent: 'Parent', child: 'Child', sibling: 'Brother or sister' }, KIN_ORDER = ['partner', 'parent', 'child', 'sibling'];
const GEN = ['first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'eighth'];
// how old someone is: a founder's mind is older than the body the Seed printed for it
function ageLine(p, r) {
  const body = Math.floor(r[8] ?? p.age), mind = r[9] ?? p.age;
  if (p.native) return `${body} · born here, ${GEN[Math.max(0, p.gen - 1)] || p.gen + 'th'} generation${r[8] < 2 ? ' · in the nursery' : r[8] < 13 ? ' · a child' : r[8] < 16 ? ' · an apprentice' : ''}`;
  return `${mind}, in a body of ${body} · former ${p.trade.toLowerCase()}`;
}
const TAB = { archive: ['Archive', 'archive'], crews: ['Crews', 'crews'], build: ['Build', 'build'], life: ['Food and local life', 'life'], log: ['Log', 'log'] };
// what a building holds, in a few words
const holds = (type, c) => ({ shelter: `${c.beds} bunks`, dorm: `${c.beds} bunks`, commons: `seats for ${c.seats}`, workshop: `${c.benches} bench${c.benches > 1 ? 'es' : ''}`, clinic: `${c.beds} beds`, solar: `${c.panels} panels, ${c.supply} kW`, field: `${c.tiles} tiles of beds`, lab: `${c.benches} lab bench${c.benches > 1 ? 'es' : ''}`, plant: `${c.tanks} tank${c.tanks > 1 ? 's' : ''}`, cellar: `cool shelves for ${c.store} loads of food`, burrow: `${c.beds} bunks`, mine: `${c.faces} face${c.faces > 1 ? 's' : ''} to work`, pit: `${c.faces} face${c.faces > 1 ? 's' : ''} to cut` })[type] || '';
const UG_TXT = { soil: 'soft soil: quick to dig, but the walls need a lot of shoring', clay: 'clay: heavier digging, and it holds its shape', stone: 'stone: slow digging, little shoring, and the spoil gives stone for the yard', 'hard rock': 'hard rock: very slow digging, but it barely needs shoring and gives stone' };
const loads = L => Object.entries(L).filter(([k, n]) => n > 0 && k !== 'mark' && k !== 'test').map(([k, n]) => matName(k, n)).join(', ');const SHIFT_TXT = SHIFTS.map(s => `${s.name} ${s.a}–${s.b}`);
// what a crew's members are doing, in a word each
const DOING = { [ACT.BED]: 'asleep', [ACT.INSIDE]: 'asleep', [ACT.WALK]: 'walking', [ACT.HOME]: 'walking back', [ACT.TOBED]: 'turning in', [ACT.SURVEY]: 'surveying', [ACT.PLANT]: 'planting a stake', [ACT.CARRY]: 'carrying', [ACT.BUILD]: 'building', [ACT.EAT]: 'eating', [ACT.IDLE]: 'at camp', [ACT.ALONE]: 'off alone', [ACT.WAKE]: 'waking', [ACT.QUARRY]: 'cutting stone', [ACT.FELL]: 'felling', [ACT.STONE]: 'carrying stone', [ACT.LOG]: 'carrying logs', [ACT.TEST]: 'testing', [ACT.INDOORS]: 'indoors', [ACT.BENCH]: 'at a bench', [ACT.DEAD]: 'dead', [ACT.DOWN]: 'down', [ACT.TEND]: 'tending someone', [ACT.DRAG]: 'carrying someone', [ACT.FIGHT]: 'fighting a fire', [ACT.DIG]: 'digging', [ACT.PLAY]: 'playing', [ACT.MIND]: 'minding the children' };
const meterCol = (v, goodHigh) => { const x = goodHigh ? 100 - v : v; return x > 70 ? 'var(--bad)' : x > 45 ? 'var(--mid)' : 'var(--good)'; };
// a row of buttons choosing a part of a window, and a numbered how-to for it
const sub = (key, cur, items) => `<div class="seg sm sub">${items.map(([k, t]) => `<button data-act="sub" data-k="${key}" data-v="${k}" class="${cur === k ? 'on' : ''}">${t}</button>`).join('')}</div>`;
const how = steps => `<ol class="how">${steps.map(t => `<li>${t}</li>`).join('')}</ol>`;
const topSkills = (sk, n = 3) => SKILLS.map(k => [k, sk[k]]).sort((a, b) => b[1] - a[1]).slice(0, n);

// a field's crop in words, and the buttons to choose what goes in it next
function fieldBits(p) {
  const c = p.crop || {}, cr = CROPS[c.k];
  const state = c.st === 'grow' ? `${cr.name}, ${pct(c.g)} grown${c.eta == null ? '' : c.eta === Infinity || c.eta === null ? ', won’t ripen before the frost' : `, ripe in about ${c.eta} day${c.eta === 1 ? '' : 's'}`}` : c.st === 'ripe' ? `${cr.name}, ripe: ready to harvest` : c.st === 'dead' ? `${cr ? cr.name : 'The crop'} killed by frost: to be cleared` : c.plan ? `Bare: ${CROPS[c.plan].name.toLowerCase()} next` : 'Bare: nothing has time to ripen before Deep cold';
  return [esc(state) + (c.st === 'grow' && c.h < .99 ? ` · ${pct(1 - c.h)} lost` : ''),
    `<div class="seg sm wrap">${['auto', ...CROP_KEYS, 'fallow'].map(k => `<button data-act="crop" data-id="${p.id}" data-v="${k}" class="${(c.want || 'auto') === k ? 'on' : ''}">${k === 'auto' ? 'Seed chooses' : k === 'fallow' ? 'Leave fallow' : CROPS[k].name}</button>`).join('')}</div>`];
}

// the season the Seed comes down in: the year then runs on from there
const SEASON_PICK = [
  ['Thaw', 'The usual start: the cold is ending, and there is a whole year before the next Deep cold.'],
  ['Long light', 'The warm season, with the longest days. About forty days to get ready for the cold.'],
  ['Storms', 'Wind and storms from the start, and Deep cold twenty days away.'],
  ['Deep cold', 'The hardest start: twenty days of frost, snow and blizzards before the thaw.'],
];
const DMG = { fire: 'the fire', flood: 'the flood', wear: 'a breakdown', quake: 'the tremor' };
export class Panels {
  constructor(A, api) {
    this.A = A; this.api = api; this.tab = 'archive'; this.chosen = new Set(); this.touched = false; this.sig = ''; this.cardSig = ''; this.moveSig = '';
    this.btab = 'plan'; this.ltab = 'larder'; this.logSeen = 0; this.busy = false; this.min = false; this.confirm = -1; this.planSig = '';
    const side = $('side'), body = $('sideBody');
    document.querySelectorAll('#dock [data-tab]').forEach(b => b.onclick = () => this.toggleTab(b.dataset.tab));
    $('sideMin').onclick = () => this.fold(true);
    $('kBuild').onclick = e => { const b = e.target.closest('[data-proj]'); if (b) this.api.showProject(+b.dataset.proj); };
    const bar = $('bar');
    bar.onclick = e => { const b = e.target.closest('[data-i]'); if (b) this.api.select(+b.dataset.i); };
    bar.ondblclick = e => { const b = e.target.closest('[data-i]'); if (b) this.api.select(+b.dataset.i, true); };
    side.addEventListener('pointerdown', () => { this.busy = true; });
    window.addEventListener('pointerup', () => { if (this.busy) { this.busy = false; setTimeout(() => this.update(), 0); } });
    body.addEventListener('click', e => this.onClick(e));
    this.ctab = 'about';
    $('cBody').addEventListener('click', e => { const b = e.target.closest('[data-ctab]'); if (b) { this.ctab = b.dataset.ctab; this.cardSig = ''; this.card(); } });
    $('bBody').addEventListener('click', e => this.onClick(e));
    $('plBody').addEventListener('click', e => { if (e.target.closest('[data-act="useSug"]')) this.api.useSug(); });
    $('bBody').addEventListener('change', e => this.onChange(e));
    body.addEventListener('change', e => this.onChange(e));
    $('cMove').onchange = e => { const v = +e.target.value; this.api.cmd('move', { person: this.A.sel, crew: v }); };
    $('orbit').addEventListener('click', e => {
      const site = e.target.closest('[data-site]'), go = e.target.closest('[data-land]'), sea = e.target.closest('[data-season]');
      if (sea) { this.A.season = +sea.dataset.season; this.orbit(this.A.sites, this.A.siteSel); }
      else if (go) this.api.land(+go.dataset.land); else if (site) this.api.siteSelect(+site.dataset.site);
    });
  }

  // ---------- before the landing ----------
  orbit(sites, sel) {
    const el = $('orbit'); if (!sites) { el.hidden = true; return; }
    const unknown = { 'Lake shore': 'how high the lake rises', 'River meadow': 'how far the river floods', 'Woodland clearing': 'what lives under the trees', 'Under the ridge': 'whether the slope is stable', 'Marsh edge': 'how sound the ground is', 'Open plain': 'how hard the wind blows' };
    el.innerHTML = `<div class="wt">${icon('orbit')}<b>Orbital survey</b></div><div class="in" style="padding-top:12px"><p>The Seed has found three places it could come down. It can only land once, and it won't lift again.</p>` +
      sites.map((s, i) => `<div class="site${i === sel ? ' on' : ''}" data-site="${i}"><h3><b>${LETTERS[i]}</b>${esc(s.tag)}</h3>
        <div class="facts"><div>Open ground <em>${s.open}%</em></div><div>Woodland <em>${s.wood}%</em></div><div>Stone <em>${s.stone}%</em></div><div>Marsh <em>${s.marsh}%</em></div>
        <div>Water <em>${s.water == null ? 'none seen' : s.water < 30 ? 'at hand' : s.water + ' m'}</em></div><div>Open water <em>${s.wet}%</em></div></div>
        <div class="unk">Not known from orbit: the soil, the weather, what lives here, and ${unknown[s.tag] || 'what is under the surface'}.</div></div>`).join('') +
      `<h4 class="sea">Arrive in</h4><div class="seg sm">${SEASON_PICK.map(([n], i) => `<button data-season="${i}"${i === (this.A.season || 0) ? ' class="on"' : ''}>${n}</button>`).join('')}</div>
      <p style="margin:6px 0 0">${SEASON_PICK[this.A.season || 0][1]}</p>` +
      `<div class="acts"><button class="go" data-land="${sel}">Land at ${LETTERS[sel]}: ${esc(sites[sel].tag)}</button></div>
      <p style="margin-top:10px">The survey covers ground about 1.2 km across. Each site's figures are for the ground within 80 m of it.</p></div>`;
    el.hidden = false;
  }

  // ---------- the colony ----------
  show(on) {
    this.on = on; if (!on) $('stats').hidden = true; $('side').hidden = !on || this.min; $('colony').hidden = !on; $('dock').hidden = !on; $('track').hidden = !on; $('news').hidden = !on; if (!on) $('guide').hidden = true;
    if (!on) { $('card').hidden = true; $('bar').hidden = true; $('bcard').hidden = true; }
    this.dock();
  }
  setTab(t) {
    const [w, part] = t.split(':'); t = w; if (part) this[t === 'build' ? 'btab' : 'ltab'] = part;   // 'life:local' opens a part of a window
    this.tab = t; this.sig = '';
    $('sideTitle').textContent = TAB[t][0]; $('sideIc').innerHTML = `<use href="#i-${TAB[t][1]}"/>`;
    if (this.min) this.fold(false); else this.dock();
    this.update();
  }
  fold(on = !this.min) { this.min = on; $('side').hidden = on || !this.on; this.dock(); }
  dock() { document.querySelectorAll('#dock [data-tab]').forEach(b => b.classList.toggle('on', !this.min && b.dataset.tab === this.tab)); $('news').classList.toggle('side', !$('side').hidden); }
  toggleTab(t) { if (this.tab === t && !this.min) this.fold(true); else this.setTab(t); }
  update() {
    const A = this.A, U = A.ui; if (!U) return;
    this.strip(U);
    if (this.tab === 'log') this.logSeen = U.logN;
    const nNew = U.logN - this.logSeen, badge = $('logNew'); badge.hidden = nNew <= 0 || this.tab === 'log'; badge.textContent = nNew > 99 ? '99+' : nNew;
    if (!this.busy && !this.min) {
      const body = $('sideBody'), focus = document.activeElement;
      const holding = focus && body.contains(focus) && focus.tagName === 'SELECT';
      const [sig, html] = this.tab === 'archive' ? this.archive(U) : this.tab === 'crews' ? this.crews(U) : this.tab === 'build' ? this.build(U) : this.tab === 'life' ? this.life(U) : this.log(U);
      if (sig !== this.sig && !holding) { const top = body.scrollTop; body.innerHTML = html(); body.scrollTop = top; this.sig = sig; }
      if (this.tab === 'archive') this.archiveLive(U);
    }
    this.card(); this.bcard(); this.ctlBar(U);
  }
  // the banner while someone is under direct orders
  ctlBar(U) {
    const el = $('ctlHint'), i = U.ctl ?? -1, A = this.A;
    if (i < 0 || A.phase !== 'colony' || !A.people[i]) { el.hidden = true; return; }
    const n = A.people[i].name.split(' ')[0], o = U.ord, now = !o || o.k === 'hold' ? 'waiting for orders' : o.k === 'fire' ? 'going to beat out the flames' : o.k === 'help' ? 'going to help' : 'on the way';
    const t = `Directing ${n}, ${now}${U.emerg ? '' : ': the emergency is over, so they go back to their crew soon'}. Right-click the ground to send them there, flames to beat them out, someone hurt to help them.`;
    if ($('ctlTxt').textContent !== t) $('ctlTxt').textContent = t;
    el.hidden = false;
  }
  // the top bar never hides a readout behind the clock: when it doesn't fit, drop details step by step
  fitBar() {
    const res = $('colony'), bar = res.parentNode, key = res.textContent + '|' + innerWidth;
    if (key === this.barKey) return; this.barKey = key;
    for (let i = 1; i <= 5; i++) bar.classList.remove('f' + i);
    for (let i = 1; i <= 5 && res.scrollWidth > res.clientWidth + 1; i++) bar.classList.add('f' + i);
  }
  strip(U) {
    const awake = U.alive, left = U.seed.feed + U.seed.queue.length;
    $('kPeople').innerHTML = U.mode === 'stress' ? `${awake}<small>awake</small>` : `${awake}<small class="dx">+${this.A.archive.filter(p => p.woke == null).length} stored</small>`;
    const meals = U.F ? U.F.usable : U.food, eaters = awake + U.seed.queue.length + (U.seed.printing ? 1 : 0), days = eaters ? meals / eaters : 0, kf = $('kFood');
    kf.innerHTML = U.mode === 'stress' ? '<small>not counted</small>' : eaters ? `${Math.floor(days)}<small>days<i class="xm"> · ${Math.floor(meals)} meals</i></small>` : `${Math.floor(meals)}<small>meals</small>`;
    if (U.F) $('rFood').title = `Food the colony can eat: ${Math.floor(U.food)} lander rations and ${Math.floor(meals - U.food)} meals of food from this world${U.F.locked > 0 ? `, plus ${Math.floor(U.F.locked)} that need a kitchen crew first` : ''}. At ${eaters} mouths that is ${Math.floor(days)} days. Open Life (G) for the larder.`;
    kf.className = U.mode !== 'stress' && eaters && days < 10 ? (days < 3 ? 'bad' : 'warn') : '';
    const pw = U.power, dark = U.projects.filter(p => p.done && p.type !== 'solar' && !p.powered).length;
    $('kPower').innerHTML = `${pw.draw}/${pw.supply}<small>kW${dark ? `<i class="dx"> · ${dark} dark</i>` : ''}</small>`; $('rPower').classList.toggle('warn', !!dark);
    const y = U.stores.yard; $('kStone').textContent = y.stone; $('kTimber').textContent = y.timber; $('kSalvage').innerHTML = y.ore ? `${y.salvage}<small class="dx">+${y.ore} ore</small>` : `${y.salvage}`;
    $('kKnown').innerHTML = `${(U.known / (MAP * MAP) * 100).toFixed(1)}%`; $('kKnown').parentNode.title = `Ground surveyed: ${(U.known / (MAP * MAP) * 100).toFixed(1)}%. Sensor stakes planted: ${U.stakes.length} of 10`;
    this.fitBar();
    this.tracker(U); this.colbar(U);
    void left;
  }

  // ---------- the archive ----------
  archive(U) {
    const A = this.A, sd = U.seed, arch = A.archive, capLeft = Math.max(0, sd.feed - sd.queue.length);
    if (U.mode === 'stress') return ['stress', () => `<div class="note">The stress test wakes everyone at once, so the fabricator prints nobody. Start a new landing in Landfall mode to choose founders.</div>`];
    // the Seed's own suggestion is ticked until the player changes anything
    if (!this.touched && capLeft > 0 && !this.chosen.size && !sd.queue.length && !sd.printing) {
      const busy = new Set([...sd.queue]), pool = arch.map(p => busy.has(p.fid) ? { ...p, woke: 1 } : p);
      for (const f of suggestFirst(pool, capLeft)) this.chosen.add(f);
    }
    for (const f of [...this.chosen]) { const p = arch[f]; if (!p || p.woke != null || sd.queue.includes(f) || (sd.printing && sd.printing.fid === f)) this.chosen.delete(f); }
    const G = U.gen, sig = ['a', U.rv, sd.feed, sd.fb, sd.queue.join('.'), sd.printing ? sd.printing.fid : -1, [...this.chosen].join('.'), arch.length, JSON.stringify(G)].join('|');
    return [sig, () => {
      const names = new Map(arch.map(p => [p.fid, p.name]));
      const plants = U.projects.filter(p => p.type === 'plant' && p.done);
      let h = `<div class="box"><div class="row2"><div class="grow"><b>Fabricator</b><div class="note" style="margin:2px 0 0">${sd.feed ? `Feedstock for ${sd.feed} more ${sd.feed === 1 ? 'body' : 'bodies'}.` : 'No feedstock left for bodies.'} Each body takes about four hours to print.</div></div></div>`;
      if (plants.length) h += `<div class="note" style="margin:8px 0 0">Feedstock plant: the next body’s feedstock is ${Math.round(sd.fb / sd.per * 100)}% made.${plants.map(p => p.why ? ` ${esc(p.name)}: ${esc(p.why)}` : '').join('')}</div><div class="bar"><u style="width:${Math.round(sd.fb / sd.per * 100)}%"></u></div>`;
      else if (!sd.feed || capLeft <= 0) h += `<div class="sec">To print more people</div>` + how(['Plan a <b>feedstock plant</b> in the Build window (<kbd>B</kbd>), under Plan. It needs power, like every building.', 'Keep its tanks fed: a forage crew brings biomass and a quarry crew brings stone to the yard.', 'Each tank turns that into feedstock, an eighth of a body every half day. When a body’s worth is ready, pick who wakes here.']);
      if (sd.printing) h += `<div style="margin-top:8px;font-size:12px;font-weight:700">Printing ${esc(names.get(sd.printing.fid))}</div><div class="bar"><u id="prBar" style="width:0"></u></div>`;
      if (sd.queue.length) h += `<div class="sec">Next in line</div>` + sd.queue.map((f, i) => `<div class="q"><span>${i + 1}. ${esc(names.get(f))}</span><button data-act="unq" data-fid="${f}">Remove</button></div>`).join('');
      h += `</div>`;
      h += this.tanksBox(U);
      if (capLeft > 0) {
        h += `<div class="note">Pick who wakes first. The archive keeps everyone you don't pick; ${capLeft} ${capLeft === 1 ? 'body is' : 'bodies are'} left to print.</div>
          <div class="row2" style="margin-bottom:6px"><button class="btn" data-act="seedpick">Seed's pick</button><button class="btn" data-act="clear"${this.chosen.size ? '' : ' disabled'}>Clear</button><span class="grow"></span><button class="btn go" data-act="print"${this.chosen.size ? '' : ' disabled'}>Print ${this.chosen.size || ''} selected</button></div>
          ${this.chosen.size ? `<div class="note">In this order: ${[...this.chosen].map(f => esc(names.get(f))).join(', ')}.</div>` : ''}`;
      }
      const asleep = arch.filter(p => p.woke == null && !sd.queue.includes(p.fid) && !(sd.printing && sd.printing.fid === p.fid)), awake = arch.filter(p => p.woke != null);
      const row = (p, pickable) => {
        const sel = this.chosen.has(p.fid), knew = p.knew.map(t => `<span class="chip ${t.k === 'friend' ? 'g' : 'b'}">${t.k === 'friend' ? 'Old friend of' : 'Old rival of'} ${esc(names.get(t.fid))}</span>`).join('');
        return `<div class="f${sel ? ' sel' : ''}"${pickable ? ` data-act="fsel" data-fid="${p.fid}"` : ''}>${pickable ? '<span class="ck"></span>' : '<span></span>'}
          <div><div class="nm">${esc(p.name)}</div><div class="tr">${p.age} · former ${esc(p.trade.toLowerCase())}</div></div>
          <div class="more"><div class="chips">${topSkills(p.skills).map(([k, v]) => `<span class="chip sk" title="${SKILLS.map(s => SKILL_NAME[s] + ' ' + p.skills[s]).join(', ')}">${SKILL_NAME[k]} ${v.toFixed(1)}</span>`).join('')}${p.traits.map(t => `<span class="chip t" title="${esc(TRAITS[t])}">${cap1(t)}</span>`).join('')}${knew}</div>
          <div style="margin-top:4px;color:var(--mut)">${esc(p.mem[0])}</div></div></div>`;
      };
      if (asleep.length) h += `<div class="sec">Stored in the archive · ${asleep.length}</div>` + asleep.map(p => row(p, capLeft > 0)).join('');
      if (awake.length) h += `<div class="sec">Awake · ${awake.length}</div>` + awake.map(p => row(p, false)).join('');
      return h;
    }];
  }
  // the Seed's growth tanks, the couples waiting, and the colony's rule on children
  tanksBox(U) {
    const G = U.gen; if (!G) return '';
    const couples = U.p.filter(r => !(r[6] & 16)).length && G.born + G.womb.length + G.asks.length > 0;
    let h = `<div class="box"><b>Growth tanks</b><div class="note" style="margin:2px 0 0">A couple can ask the Seed for a child. It grows one in each of its ${G.tanks} tanks for sixty days, from a body’s worth of feedstock and the genes of both parents. Founders you choose to print get the feedstock first.</div>`;
    h += G.womb.length ? G.womb.map(e => `<div style="margin-top:8px;font-size:12px;font-weight:700">The child of ${esc(e.names[0])} and ${esc(e.names[1])}</div><div class="note" style="margin:0">Born in ${e.left} day${e.left === 1 ? '' : 's'}.</div><div class="bar"><u style="width:${Math.round((1 - e.left / 60) * 100)}%"></u></div>`).join('') : `<div class="note" style="margin:8px 0 0">${couples ? 'Both tanks are empty.' : 'Both tanks are empty. Couples form from close friendships, and ask for a child once they are settled.'}</div>`;
    if (G.asks.length) h += `<div class="sec">Waiting for a tank</div>` + G.asks.map((q, i) => `<div class="q"><span>${i + 1}. ${esc(q.names[0])} and ${esc(q.names[1])} <small style="color:var(--mut)">· asked on day ${q.d}</small></span></div>`).join('');
    const why = G.rule === 'no' ? 'Nobody gets a child while this rule stands.' : G.rule === 'fed' ? (G.ok ? `There are at least ${G.fedDays} days of food for everyone and nobody is hungry, so couples can have children.` : `There is less than ${G.fedDays} days of food for everyone, or someone is hungry, so couples wait.`) : 'Every couple who asks gets a child as soon as a tank and feedstock are free.';
    h += `<div class="lbl">THE COLONY’S RULE ON CHILDREN</div><div class="seg sm">${[['yes', 'Every couple'], ['fed', 'If food allows'], ['no', 'Not now']].map(([k, t]) => `<button data-act="brule" data-v="${k}" class="${G.rule === k ? 'on' : ''}">${t}</button>`).join('')}</div><div class="note">${why}</div></div>`;
    return h;
  }
  archiveLive(U) { const b = $('prBar'), p = U.seed.printing; if (b && p) b.style.width = Math.round((1 - p.left / PRINT_TICKS) * 100) + '%'; }

  // ---------- crews ----------
  crews(U) {
    const A = this.A, P = U.p, names = A.names;
    const live = U.crews.filter(c => !c.gone), free = P.map((r, i) => i).filter(i => P[i][1] < 0 && !(P[i][6] & (16 | 65536 | 131072)));
    const statusOf = cr => {
      const n = {}; for (const i of cr.members) { const w = DOING[P[i][0]] || 'busy'; n[w] = (n[w] || 0) + 1; }
      return Object.entries(n).map(([w, k]) => `${k} ${w}`).join(' · ') || 'nobody yet';
    };
    const mm = i => { const r = P[i]; return [Math.round(r[2] / 10), Math.round(r[3] / 10), Math.round(r[4] / 10)]; };
    const sig = 'c' + JSON.stringify([U.rv, U.auto, U.plan, live.map(c => [c.id, c.lead, c.work, c.shift, c.rules, c.target, c.members, statusOf(c), c.members.map(mm), this.workNote(U, c)]), free, free.map(mm)]);
    return [sig, () => {
      let h = U.plan ? '' : U.auto ? `<div class="note">The Seed is sorting people into crews as they wake. Change anything here and it leaves the crews to you.</div>` : '';
      if (P.length) h += `<div class="crew plan"><button class="btn go" data-act="crewPlan" style="width:100%">Let the Seed plan the crews</button>
        <label class="keep"><input type="checkbox" data-act="crewKeep"${U.plan ? ' checked' : ''}>Plan again every morning and when someone wakes</label>
        <div class="note">${U.plan ? 'The Seed is planning the crews: it works out' : 'The Seed works out'} how many hands the food, the fields, the kitchen, the yard, the survey and the buildings need, puts the best-suited person on each, and keeps everyone else building.${U.plan ? ' Move someone or change a crew\u2019s work and it leaves the crews to you.' : ''}</div></div>`;
      if (live.length > 1) { const same = live.every(c => c.shift === live[0].shift) ? live[0].shift : -1; h += `<div class="crew plan"><div class="lbl" style="margin-top:0">SHIFT FOR EVERY CREW</div><div class="seg sm">${SHIFT_TXT.map((t, k) => `<button data-act="shiftAll" data-v="${k}" class="${same === k ? 'on' : ''}">${t}</button>`).join('')}</div><div class="note">Sets the working hours of all crews at once, and of any crew made later. Each crew below can still be changed on its own.</div></div>`; }
      if (!live.length && !free.length) h += `<div class="note">Nobody is awake yet. Crews form as the fabricator prints the founders.</div>`;
      const member = (i, cr) => { const r = P[i]; return `<div class="mem" data-act="person" data-id="${i}"><span class="nm">${esc(names[i] || '')}</span>${cr && cr.lead === i ? '<span class="lead">LEAD</span>' : ''}<span class="mini3" title="Fatigue, strain, trust">${[[r[2], 0], [r[3], 0], [r[4], 1]].map(([v, g]) => `<b><u style="width:${v}%;background:${meterCol(v, g)}"></u></b>`).join('')}</span></div>`; };
      for (const cr of live) {
        const col = rgb(crewColour(cr.id));
        h += `<div class="crew"><h3><i style="background:${col}"></i>${esc(cr.name)}<em>${cr.members.length} ${cr.members.length === 1 ? 'person' : 'people'}</em></h3><div class="st">${esc(cap1(statusOf(cr)))}</div>
          <div class="lbl">WORK</div><div class="seg sm wrap">${Object.entries(WORKS).map(([k, v]) => `<button data-act="work" data-crew="${cr.id}" data-v="${k}" class="${cr.work === k ? 'on' : ''}">${v}</button>`).join('')}</div>
          <div class="lbl">SHIFT</div><div class="seg sm">${SHIFT_TXT.map((t, k) => `<button data-act="shift" data-crew="${cr.id}" data-v="${k}" class="${cr.shift === k ? 'on' : ''}">${t}</button>`).join('')}</div>
          <div class="lbl">LEAD</div><select data-act="lead" data-crew="${cr.id}" aria-label="Crew lead">${cr.members.length ? cr.members.map(i => `<option value="${i}"${cr.lead === i ? ' selected' : ''}>${esc(names[i] || '')}</option>`).join('') : '<option>Nobody</option>'}</select>
          <div class="lbl">RULES</div><div class="rules">${Object.entries(RULES).map(([k, v]) => `<label><input type="checkbox" data-act="rule" data-crew="${cr.id}" data-rule="${k}"${cr.rules[k] ? ' checked' : ''}>${v}</label>`).join('')}</div>`;
        if (cr.work === 'survey') h += `<div class="lbl">SURVEY AREA</div><div class="row2"><span class="grow" style="font-size:12px;font-weight:600">${cr.target >= 0 ? 'Around the marked spot' : 'Wherever is unseen and in reach'}</span><button class="btn" data-act="area" data-crew="${cr.id}">${cr.target >= 0 ? 'Move' : 'Mark on map'}</button>${cr.target >= 0 ? `<button class="btn" data-act="areaClear" data-crew="${cr.id}">Clear</button>` : ''}</div>`;
        h += this.workNote(U, cr);
        h += `<div class="lbl">PEOPLE</div>${cr.members.map(i => member(i, cr)).join('') || '<div class="note">Nobody. Move people here from their card.</div>'}
          <div class="row2" style="margin-top:8px"><span class="grow"></span><button class="btn" data-act="crewDel" data-crew="${cr.id}">Disband</button></div></div>`;
      }
      if (free.length) h += `<div class="sec">Not in a crew · ${free.length}</div>` + free.map(i => member(i, null)).join('') + `<div class="note">Pick someone to put them in a crew from their card.</div>`;
      if (P.length) h += `<button class="btn" data-act="crewNew" style="width:100%;margin-top:6px">New crew</button>`;
      return h;
    }];
  }

  workNote(U, cr) {
    const y = U.stores.yard, ws = U.projects.some(p => p.type === 'workshop' && p.done && p.powered), proj = U.projects.find(p => p.id === cr.proj && !p.done);
    const t = {
      build: proj ? `Working on ${proj.name}: ${stagesOf(proj.type)[proj.stage].toLowerCase()}. When the yard runs out, they cut stone and fell trees themselves.` : 'Nothing they can build right now. Plan something in the Build tab, or check what the projects there are waiting for.',
      quarry: `They cut stone from boulders and rock faces, or from a stone pit when that is nearer, and stack it in the yard, until there is enough for everything planned. ${y.stone} there now.`,
      timber: `They fell trees and carry the logs to the yard, until there is enough for everything planned. ${y.timber} there now.`,
      workshop: ws ? `They make airlock seals, pipe runs, power units and solar panels from salvage at the workshop benches, whichever the projects will run short of first. When there is nothing to make, they smelt ore into salvage, ${SMELT.ore} loads into ${SMELT.out}.` : 'They need a finished workshop with power before they can make anything.',
      mine: (() => { const m = U.projects.filter(p => p.type === 'mine' && p.done); return !m.length ? 'There is no finished mine yet. Plan one over a seam of ore in the Build window (press U to see the seams).' : m.some(p => p.seam > 0 && p.powered) ? `They cut ore at the mine faces and pile it in the yard, while the colony is short of metal. ${y.ore || 0} ore and ${y.salvage} salvage there now; the workshop smelts the ore.` : m.some(p => p.seam > 0) ? 'The mine is dark: it needs power for its lamps before anyone works it.' : 'Every mine is worked out. Plan a new one over another seam.'; })(),
      rest: `Resting: they stay around camp and recover.`,
      forage: (() => { const ok = U.F && U.F.life.some(l => l && l.tested && l.food); return ok ? 'They gather the wild food the tests showed is safe, bring compost for made soil when a field needs it, and take samples of anything not yet tested.' : 'Nothing found so far has been tested as food, so they take samples of what they find for the Seed to test.'; })(),
      farm: U.projects.some(p => p.type === 'field' && p.done) ? 'They sow, harvest and clear the fields. The Seed chooses each field’s crop unless you set one on its card.' : 'There is no finished field yet. Plan one in the Build window; a farm crew works it once it is made.',
      kitchen: 'They cook meals at the fire, leach and ferment the food that needs it in the vats, and empty the vats when the food is ready. Cooked food goes further than what people cook for themselves.',
      lab: U.projects.some(p => p.type === 'lab' && p.done && p.powered) ? 'They work the lab benches, testing samples much faster than the Seed’s own analyser.' : 'They need a finished lab with power. Until then the Seed’s own analyser tests samples on its own, slowly.',
    }[cr.work];
    return t ? `<div class="note" style="margin-top:8px">${esc(t)}</div>` : '';
  }

  // ---------- food and local life: the larder, the fields, the lab and everything found ----------
  life(U) {
    const F = U.F, Y = U.year; if (!F) return ['lf-none', () => `<div class="note">Nothing here in the stress test.</div>`];
    const fields = U.projects.filter(p => p.type === 'field' && p.done);
    const sig = 'lf' + JSON.stringify([U.rv, Math.round(U.food), F.total, F.raw, F.prep, F.meals, F.vats.map(v => [v.src, Math.ceil(v.left / DAY_TICKS * 4)]), F.lab, F.life, fields.map(p => [p.id, p.crop]), Y && Y.season, this.ltab]);
    return [sig, () => {
      const eaters = Math.max(1, U.alive), days = Math.floor(F.usable / eaters), nm = k => esc(F.names[k] || k);
      const list = (o, f, min = .5) => Object.entries(o).filter(([, n]) => n >= min).map(([k, n]) => `<div class="row2 li"><span class="grow">${nm(k)}</span><span class="num">${f(n, k)}</span></div>`).join('');
      const lt = this.ltab, ready = F.life.filter(l => l && !l.tested && !l.queued && l.samples >= 3).length;
      let h = sub('ltab', lt, [['larder', 'Larder'], ['fields', `Fields · ${fields.length}`], ['local', `Local life${ready ? ` · ${ready}` : ''}`]]);
      if (lt === 'larder') {
        h += `<div class="box"><div class="row2"><b class="grow">The larder</b><span class="num">${days} day${days === 1 ? '' : 's'} of food</span></div>
        <div class="note" style="margin:6px 0 4px">About ${Math.floor(F.usable)} meals for ${eaters} ${eaters === 1 ? 'person' : 'people'}, one meal each a day.${Y && Y.season !== 3 ? ` Deep cold comes in ${Y.deepIn} day${Y.deepIn === 1 ? '' : 's'} and lasts twenty.` : ' It is Deep cold: nothing grows.'}${F.locked > 0 ? ` Another ${Math.floor(F.locked)} meals’ worth needs a kitchen crew to make it safe.` : ''}</div>`;
        h += `<div class="row2 li"><span class="grow">Lander rations</span><span class="num">${Math.floor(U.food)} meals</span></div>`;
        h += list(F.meals, n => `${Math.floor(n)} cooked`, 1) + list(F.prep, n => `${n.toFixed(1)} loads leached`) + list(F.raw, n => `${n.toFixed(1)} loads`);
        if (F.vats.length) h += F.vats.map(v => `<div class="row2 li"><span class="grow">Vat: ${nm(v.src)}, ${v.proc === 'leach' ? 'leaching' : 'fermenting'}</span><span class="num">${v.left <= 0 ? 'ready' : Math.ceil(v.left / DAY_TICKS * 24) + ' h left'}</span></div>`).join('');
        h += `</div><div class="note">Foragers bring in tested wild food, a kitchen crew cooks it and runs the vats, and fields grow the seed bank's crops. Food that hasn't been tested is never eaten: see Local life.</div>`;
        h += `<div class="note">Raw and cooked food spoils day by day, much slower when it freezes. ${F.cool > 0 ? `The root cellars hold ${F.cool >= 1 ? 'all of it' : `about ${Math.round(F.cool * 100)}% of it`} cool, where it keeps three times as long.` : 'A root cellar, dug below ground (Build window), keeps it three times as long.'}</div>`;
        return h;
      }
      // fields
      if (lt === 'fields') {
        h += how(['Plan a field in the Build window (<kbd>B</kbd>). Build crews make it in five stages.', 'Put a crew on farm work (Crews window, <kbd>C</kbd>). They sow, harvest and clear it.', 'The Seed picks a crop that can ripen before the frost, or choose one below.']);
        if (!fields.length) h += `<div class="note">No finished field yet.</div>`;
        for (const p of fields) {
          const [state, sel] = fieldBits(p);
          h += `<div class="crew"><h3><i style="background:#7fae5a"></i>${esc(p.name)}<em>${p.w * p.h} tiles</em></h3><div class="st">${state}</div>
            <div class="lbl">CROP</div>${sel}</div>`;
        }
        // the seed bank
        h += `<div class="sec">The seed bank</div>` + CROP_KEYS.map(k => { const c = CROPS[k]; return `<div class="li2"><b>${c.name}</b> · ripens in ${c.days} warm days, grows above ${c.min}°, killed below ${c.frost}° · <span>${esc(c.note)}</span></div>`; }).join('');
        return h;
      }
      // the lab
      h += how(['People notice the local life around them as they work outside; it appears below.', 'Foragers and survey crews take samples as they pass. Three samples are enough for a test.', 'Press <b>Test it</b>. The Seed’s analyser tests one kind at a time, slowly; a lab with a lab crew is much faster.', 'The result says whether it can be eaten, and how: raw, cooked, leached or fermented.']);
      const cur = F.lab.cur >= 0 ? F.life[F.lab.cur] : null, labs = U.projects.filter(p => p.type === 'lab' && p.done && p.powered).length;
      if (cur || F.lab.queue.length) h += `<div class="sec">Testing</div>`;
      h += cur ? `<div class="box"><div class="row2"><b class="grow">Testing ${esc(cur.name.toLowerCase())}</b><span class="num">${pct(F.lab.work / TEST_H)}</span></div><div class="bar"><u style="width:${pct(F.lab.work / TEST_H)}"></u></div></div>` : '';
      if (F.lab.queue.length) h += `<div class="note">Waiting: ${F.lab.queue.map(o => esc(F.life[o].name.toLowerCase())).join(', ')}.</div>`;
      if (labs) h += `<div class="note">People at the lab benches test much faster than the Seed alone.</div>`;
      // local life
      const seen = F.life.filter(Boolean);
      h += `<div class="sec">Local life · ${seen.length} found</div>`;
      if (!seen.length) h += `<div class="note">Nothing noticed yet. People outside notice the local life around them as they work; survey crews see the most.</div>`;
      const SEAS = ['Thaw', 'Long light', 'Storm', 'Deep cold'];
      for (const l of seen) {
        const when = l.season.map((on, i) => on ? SEAS[i] : null).filter(Boolean), all = when.length === 4;
        h += `<div class="crew"><h3><i style="background:${l.tested ? (l.food ? '#7fd38f' : '#c9b48a') : '#8a96a6'}"></i>${esc(l.name)}<em>${l.tested ? (l.food ? 'food' : 'not food') : 'untested'}</em></h3>
          <div class="note" style="margin:2px 0 6px">${esc(l.seen)}</div>
          <div class="chips"><span class="chip">${esc(l.where.join(', '))}</span><span class="chip${l.now ? ' g' : ''}">${all ? 'All year' : esc(when.join(', '))}${l.now ? ' · now' : ''}</span></div>`;
        if (l.tested) h += `<div class="note" style="margin-top:8px;color:var(--txt)">${esc(l.result)}</div><div class="note">${esc(l.verdict)}</div>`;
        else if (l.queued) h += `<div class="row2" style="margin-top:8px"><span class="grow" style="font-size:12px;font-weight:600">${F.lab.cur === l.o ? 'Being tested' : 'Waiting for the analyser'}</span>${F.lab.cur === l.o ? '' : `<button class="btn" data-act="unanalyse" data-o="${l.o}">Take out</button>`}</div>`;
        else h += `<div class="row2" style="margin-top:8px"><span class="grow" style="font-size:12px;font-weight:600">Samples ${l.samples} of ${SAMPLES}</span><button class="btn" data-act="analyse" data-o="${l.o}"${l.samples >= SAMPLES ? '' : ' disabled'}>Test it</button></div>`;
        h += `</div>`;
      }
      return h;
    }];
  }

  // ---------- building ----------
  build(U) {
    const A = this.A, pw = U.power, st = U.stores, mat = U.mat, list = U.projects;
    const sig = 'b' + JSON.stringify([U.rv, pw, st, mat, U.seed.fab && U.seed.fab.k, U.blueprints, list.map(p => [p.id, p.stage, p.got, p.wait, p.stall, p.powered, p.paused, p.crews, p.out]), this.confirm, A.projSel, this.btab]);
    return [sig, () => {
      const used = pw.supply ? Math.min(1, pw.draw / pw.supply) : 0, dark = list.filter(p => p.done && p.type !== 'solar' && !p.powered);
      const open = list.filter(p => !p.done), done = list.filter(p => p.done), bt = this.btab;
      let h = sub('btab', bt, [['plan', 'Plan'], ['list', `Projects · ${open.length}`], ['mat', 'Materials']]);
      if (bt === 'plan') {
        h += how(['Pick a building below.', 'Drag on the map to draw it. <kbd>R</kbd> turns the door; the card shows what it needs. Confirm to add it to the projects.', 'Build crews (Crews window, <kbd>C</kbd>) work through the projects from the top, cutting stone and felling trees for what each needs.', 'A finished building only works with power: see Materials.', 'Root cellars, dug quarters and mines go below ground: the map switches to the view underneath (<kbd>U</kbd>), where the Seed’s soundings show what can be dug and where the seams of ore run.']);
        h += `<div class="types">${PLANNABLE.map(t => `<button data-act="plan" data-type="${t}"><i class="bi">${icon(TICON[t])}</i><b>${TYPES[t].name}</b><span>${esc(TYPES[t].use)}</span></button>`).join('')}</div>`;
        if (U.blueprints.length) h += `<div class="sec">Blueprints</div><div class="note" style="margin:0 0 6px">Buildings you saved to place again, same size and layout.</div>` + U.blueprints.map((b, i) => `<div class="q"><span>${esc(b.name)} <em class="dim">${TYPES[b.type].name.toLowerCase()} · ${b.w} × ${b.h}</em></span><button class="btn" data-act="bp" data-i="${i}">Place</button><button data-act="bpDel" data-i="${i}" title="Forget this blueprint">Forget</button></div>`).join('');
        return h;
      }
      if (bt === 'mat') {
        // the local materials and their load tests
        h += `<div class="sec">Local materials</div><div class="note" style="margin:0 0 6px">Nobody knows yet how strong this world's stone and timber are. <b>Test it</b> adds a load test to the projects: a build crew takes three loads to the rig in the yard and breaks them. After that, every design uses the measured strength instead of a 40% safety margin.</div>`;
        for (const m of ['stone', 'timber']) {
          const M = mat[m], test = list.find(p => p.type === 'test' && p.mat === m), k = M.tested ? Math.round(Math.min(1.3, Math.max(.75, Math.round(100 / M.f) / 100)) * 100) / 100 : 1.4;
          const d = M.tested ? Math.round((M.f - 1) * 100) : 0;
          const what = M.tested ? `Tested: ${d === 0 ? 'as strong as' : Math.abs(d) + '% ' + (d > 0 ? 'stronger' : 'weaker') + ' than'} the databank's standard, so designs use ${k < 1 ? Math.round((1 - k) * 100) + '% less' : Math.round((k - 1) * 100) + '% more'} ${m} than the standard.${m === 'timber' ? ` Beams span ${Math.floor(3 + 3 * M.f)} tiles before a roof needs posts.` : ''}`
            : test ? `Being tested at the rig in the yard: ${TEST_STAGES[test.stage].toLowerCase()}.` : `Untested: every design adds 40% extra ${m} as a safety margin${m === 'timber' ? ', and roofs wider than 4 tiles need rows of posts' : ''}. A test takes three loads.`;
          h += `<div class="mat"><div class="grow"><b>${m === 'stone' ? 'Stone' : 'Timber'}</b><div class="note" style="margin:2px 0 0">${what}</div></div>${M.tested || test ? '' : `<button class="btn" data-act="test" data-mat="${m}">Test it</button>`}</div>`;
        }
        h += `<div class="sec">Power and stock</div><div class="box"><div class="row2"><b class="grow">Power</b><span class="num">${pw.draw} of ${pw.supply} kW</span></div><div class="bar"><u style="width:${pct(used)}"></u></div>
          <div class="note" style="margin:6px 0 0">The lander makes ${LANDER_KW} kW${pw.supply > LANDER_KW ? ` and the solar fields ${+(pw.supply - LANDER_KW).toFixed(1)} kW` : ''}. Finished buildings take power in list order; any that don't fit stay dark and unused.${dark.length ? ` Dark now: ${dark.map(p => esc(p.name)).join(', ')}.` : ''}</div></div>`;
        const cg = st.cargo, pr = st.precise;
        h += `<div class="box"><b>Stock</b><div class="stock"><span>Stone <em>${st.yard.stone}</em></span><span>Timber <em>${st.yard.timber}</em></span><span>Salvage <em>${st.yard.salvage}</em></span>${st.yard.ore ? `<span>Ore <em>${st.yard.ore}</em></span>` : ''}<span>Lander modules <em>${cg.module}</em></span><span>Airlock seals <em>${pr.seal}</em></span><span>Pipe runs <em>${pr.pipe}</em></span><span>Power units <em>${pr.power}</em></span><span>Solar panels <em>${pr.panel}</em></span></div>
          <div class="note" style="margin:6px 0 0">${U.seed.fab ? `The fabricator is making ${matName(U.seed.fab.k, 1).replace(/^1 (.)/, (m, c) => ('aeiou'.includes(c) ? 'an ' : 'a ') + c)} from salvage. ` : ''}Stone and timber come from the land; seals, pipes, power units and panels are made from salvage at workshop benches, or slowly by the fabricator. When the salvage the Seed brought down runs out, more comes from ore: a mine dug along a seam brings it up, and a workshop smelts it.</div></div>`;
        return h;
      }
      // the list
      const row = p => {
        const sel = A.projSel === p.id, f = progress(p), stage = stagesOf(p.type)[p.stage];
        const left = p.done ? '' : loads(Object.fromEntries(Object.entries(p.need).map(([k, n]) => [k, n - (p.got[k] || 0)])));
        let r = `<div class="proj${sel ? ' sel' : ''}${p.stall ? ' stuck' : ''}"><div class="row2"><button class="pn grow" data-act="pGo" data-id="${p.id}">${esc(p.name)}</button>`;
        if (p.type !== 'shelter') r += `<button data-act="pUp" data-id="${p.id}" title="Earlier in the list">↑</button><button data-act="pDown" data-id="${p.id}" title="Later in the list">↓</button>`;
        r += `</div>`;
        if (p.done) r += `<div class="ps">${esc(holds(p.type, p.cap))}${p.type === 'solar' ? '' : ` · ${p.cap.kw} kW · ${p.powered ? 'has power' : 'dark'}`}</div>${p.wait ? `<div class="pw">${esc(p.wait)}</div>` : ''}`;
        else r += `<div class="ps">${p.paused ? 'Paused · ' : ''}${esc(stage)} · ${pct(f)}${p.type !== 'test' ? ` · stage ${p.stage + 1} of 5` : ''}</div><div class="bar"><u style="width:${pct(f)}"></u></div>
          ${left ? `<div class="ps">Still needs ${esc(left)}</div>` : ''}${p.wait ? `<div class="pw">${esc(p.wait)}</div>` : p.crews.length ? `<div class="ps">${esc(p.crews.join(', '))} crew${p.crews.length > 1 ? 's' : ''} on it</div>` : ''}`;
        if (p.type !== 'shelter') {
          r += `<div class="row2" style="margin-top:6px"><span class="grow"></span>`;
          if (!p.done) r += `<button class="btn" data-act="pPause" data-id="${p.id}">${p.paused ? 'Resume' : 'Pause'}</button>`;
          r += `<button class="btn" data-act="pCancel" data-id="${p.id}">${this.confirm === p.id ? 'Yes, ' + (p.done || p.dmg ? 'take it down' : 'cancel it') : p.done || p.dmg ? 'Take down' : 'Cancel'}</button></div>`;
          if (this.confirm === p.id) { const b = Object.entries(p.back || {}).map(([k, q]) => matName(k, q)).join(', '); r += `<div class="ps">${b ? `Gives back ${esc(b)}.` : 'Nothing has gone into it yet.'}</div>`; }
        }
        return r + `</div>`;
      };
      h += `<div class="note" style="margin:0 0 8px">Build crews work from the top. The arrows change the order, Pause sets a project aside, and cancelling a project or taking a building down gives back everything that went into it. Click a name to see it on the map.</div>`;
      h += `<div class="sec">Projects · in priority order</div>` + (open.length ? open.map(row).join('') : `<div class="note">Nothing planned. Pick a building in Plan.</div>`);
      if (done.length) h += `<div class="sec">Buildings · power goes to them in this order</div>` + done.map(row).join('');
      return h;
    }];
  }

  // the card for a building being placed: what it holds, what it costs, whether it carries its loads, its power
  planCard(P) {
    const el = $('plan'); if (!P || P.x == null || !P.check || !P.locked) { el.hidden = true; this.planSig = ''; return; }
    const sig = JSON.stringify([P.type, P.x, P.y, P.w, P.h, P.side, P.check.ok, P.check.why, P.check.warn, P.sug]); if (sig === this.planSig) { el.hidden = false; return; }
    this.planSig = sig;
    const c = P.check, T = TYPES[P.type];
    $('plName').textContent = T.name; $('plPic').innerHTML = icon(TICON[P.type] || 'build');
    $('plMeta').textContent = `${P.w} × ${P.h} tiles${T.open ? '' : T.below ? ` · stairs on the ${SIDE[P.side]} side` : ` · door on the ${SIDE[P.side]} side`}`;
    let h = '';
    if (!c.ok) h += `<div class="pw bad">${esc(c.why)}</div>`;
    else if (c.warn) h += `<div class="pw">${esc(c.warn)}</div>`;
    h += `<div class="note" style="margin:8px 0 4px">${esc(T.use)}. It holds ${esc(holds(P.type, c.cap))}.</div>`;
    const sg = P.sug;
    if (sg && sg.w === P.w && sg.h === P.h) h += `<div class="note sug">The size the Seed suggests. ${esc(sg.why)}</div>`;
    else if (sg) h += `<div class="row2 sug"><span class="grow">The Seed suggests ${sg.w} × ${sg.h} tiles for what the colony needs.</span><button class="btn" data-act="useSug">Use ${sg.w} × ${sg.h}</button></div>`;
    if (c.bill) {
      h += `<div class="sec">What it takes</div><div class="bill">` + c.bill.stages.map((L, i) => `<div><em>${stagesOf(P.type)[i]}</em>${esc(loads(L) || (i === 0 ? 'pegs and string' : '-'))}</div>`).join('') + `</div>`;
      h += `<div class="note" style="margin-top:4px">In all: ${esc(loads(c.bill.total))}. Stone and timber are worked out again when each stage starts, so a load test before then makes later stages cheaper.</div>`;
    }
    if (T.below && c.ground) {
      const g = c.ground;
      h += `<div class="sec">The ground below</div><div class="note">The Seed's soundings show ${esc(UG_TXT[g.name] || g.name)}.${g.dig > 1.05 ? ` Digging takes ${Math.round((g.dig - 1) * 100)}% longer than in soil.` : ''}${P.type === 'mine' ? (g.ore > .05 ? ` A seam of metal ore runs under ${Math.round(g.ore * 100)}% of it: about ${seamOf(g, P.w, P.h)} loads, which a mining crew brings up once the galleries are dug.` : '') : g.ore > .05 ? ' A seam of metal ore runs through it: the diggers will bring it up, and a workshop or the fabricator smelts it into salvage.' : ''} Below ground there is nothing to burn and the cold doesn't reach, but water finds its way down the stairs.</div>`;
    }
    if (P.type === 'pit' && c.ground) h += `<div class="sec">The ground</div><div class="note">The Seed's soundings show stone under ${Math.round(c.ground.stone * 100)}% of it, close to the surface: about ${PIT_ROCK * P.w * P.h} loads to cut.</div>`;
    const L = c.load;
    if (L && !T.open && !T.below) {
      h += `<div class="sec">Load check</div><div class="note">`;
      h += L.posts ? `The roof spans ${L.span} tiles, more than ${L.timber ? 'this' : 'untested'} timber can carry (${L.limit}), so ${L.posts} posts go down the middle.` : `The roof spans ${L.span} tiles: timber beams carry that${L.timber ? '' : ' even untested'}.`;
      h += ` ${L.stone ? 'Stone is tested.' : 'Stone is untested: 40% extra as a margin.'} ${L.timber ? 'Timber is tested.' : 'Timber is untested: 40% extra as a margin.'}</div>`;
    }
    if (c.power) {
      h += `<div class="sec">Power</div><div class="note">`;
      h += P.type === 'solar' ? `Makes ${c.cap.supply} kW. With everything planned, the colony would make ${c.power.supply} kW and use ${c.power.draw} kW.` : `Draws ${c.cap.kw} kW. With everything planned, the colony would use ${c.power.draw} of ${c.power.supply} kW.`;
      if (c.short > 0) h += ` <b class="warn">That is ${c.short} kW more than it makes: whatever comes last in the list stays dark until there is a solar field.</b>`;
      h += `</div>`;
    }
    $('plBody').innerHTML = h;
    $('plGo').disabled = !c.ok;
    if (!$('plName2').value || $('plName2').dataset.auto) { $('plName2').value = `${T.name} ${P.w}×${P.h}`; $('plName2').dataset.auto = '1'; }
    el.hidden = false;
  }

  // ---------- the log ----------
  log(U) {
    const L = this.A.log;
    return ['l' + U.logN + '|' + L.length, () => L.length ? L.slice().reverse().map(e => `<div class="lg ${e.k}"><em>${when(e.t)}</em><span>${esc(e.m)}</span></div>`).join('') : '<div class="note">Nothing has happened yet.</div>'];
  }

  // ---------- input in the side panel ----------
  onClick(e) {
    const el = e.target.closest('[data-act]'); if (!el || el.tagName === 'INPUT' || el.tagName === 'SELECT') return;
    const A = this.A, U = A.ui, act = el.dataset.act, crew = el.dataset.crew != null ? +el.dataset.crew : null;
    switch (act) {
      case 'fsel': {
        const f = +el.dataset.fid, cap = U.seed.feed - U.seed.queue.length; this.touched = true;
        if (this.chosen.has(f)) this.chosen.delete(f); else if (this.chosen.size < cap) this.chosen.add(f); else this.api.toast(`The feedstock covers ${cap} more ${cap === 1 ? 'body' : 'bodies'}. Untick someone first.`);
        break;
      }
      case 'seedpick': { this.touched = true; this.chosen.clear(); const sd = U.seed, busy = new Set(sd.queue), pool = A.archive.map(p => busy.has(p.fid) ? { ...p, woke: 1 } : p); for (const f of suggestFirst(pool, sd.feed - sd.queue.length)) this.chosen.add(f); break; }
      case 'clear': this.touched = true; this.chosen.clear(); break;
      case 'print': if (this.chosen.size) { this.api.cmd('print', { ids: [...this.chosen] }); this.api.toast(`${this.chosen.size === 1 ? 'One founder' : this.chosen.size + ' founders'} queued for the fabricator.`); this.chosen.clear(); this.touched = true; } break;
      case 'unq': this.api.cmd('unqueue', { fid: +el.dataset.fid }); break;
      case 'work': this.api.cmd('crewSet', { crew, work: el.dataset.v }); break;
      case 'shift': this.api.cmd('crewSet', { crew, shift: +el.dataset.v }); break;
      case 'shiftAll': this.api.cmd('shiftAll', { shift: +el.dataset.v }); break;
      case 'brule': this.api.cmd('birthRule', { v: el.dataset.v }); break;
      case 'area': this.api.pickArea(crew); break;
      case 'areaClear': this.api.cmd('crewSet', { crew, target: -1 }); break;
      case 'person': this.api.select(+el.dataset.id, true); break;
      case 'crewNew': this.api.cmd('crewNew', {}); break;
      case 'crewPlan': this.api.cmd('crewPlan', { keep: true }); break;
      case 'crewDel': this.api.cmd('crewDel', { crew }); break;
      case 'plan': this.api.startPlace(el.dataset.type); break;
      case 'bp': { const b = U.blueprints[+el.dataset.i]; if (b) this.api.startPlace(b.type, b.w, b.h, b.name); break; }
      case 'bpDel': this.api.cmd('bpDel', { i: +el.dataset.i }); break;
      case 'test': this.api.cmd('test', { mat: el.dataset.mat }); this.api.toast(`The ${el.dataset.mat} test is first on the project list.`); break;
      case 'pGo': this.api.showProject(+el.dataset.id); break;
      case 'sub': this[el.dataset.k] = el.dataset.v; this.update(); break;
      case 'triage': this.api.cmd('triage', { v: el.dataset.v }); break;
      case 'crop': this.api.cmd('crop', { id: +el.dataset.id, k: el.dataset.v }); break;
      case 'analyse': this.api.cmd('analyse', { o: +el.dataset.o }); break;
      case 'unanalyse': this.api.cmd('unanalyse', { o: +el.dataset.o }); break;
      case 'pUp': case 'pDown': this.api.cmd('projMove', { id: +el.dataset.id, d: act === 'pUp' ? -1 : 1 }); break;
      case 'pPause': { const p = U.projects.find(q => q.id === +el.dataset.id); if (p) this.api.cmd('projPause', { id: p.id, on: !p.paused }); break; }
      case 'pCancel': this.askCancel(+el.dataset.id); break;
    }
    this.sig = ''; this.update();
  }
  // cancelling or taking down asks twice: the first press shows what comes back
  askCancel(id) {
    if (this.confirm === id) { this.confirm = -1; this.api.cmd('projCancel', { id }); }
    else { this.confirm = id; clearTimeout(this.cTimer); this.cTimer = setTimeout(() => { this.confirm = -1; this.sig = ''; this.bSig = ''; this.update(); }, 6000); }
    this.sig = ''; this.bSig = ''; this.update();
  }
  onChange(e) {
    const el = e.target, act = el.dataset.act, crew = +el.dataset.crew;
    if (act === 'rule') this.api.cmd('crewSet', { crew, rule: el.dataset.rule, on: el.checked });
    else if (act === 'lead') { this.api.cmd('crewSet', { crew, lead: +el.value }); el.blur(); }
    else if (act === 'iso') this.api.cmd('iso', { v: el.checked });
    else if (act === 'crewKeep') this.api.cmd('crewKeep', { on: el.checked });
  }

  // open projects, top left: click one for its card
  tracker(U) {
    const open = U.projects.filter(p => !p.done), sig = JSON.stringify([open.map(p => [p.id, p.name, p.stage, Math.round(progress(p) * 50), p.paused, p.stall, p.wait, p.crews]), this.A.projSel]);
    if (sig === this.trackSig) return; this.trackSig = sig;
    $('trackN').textContent = open.length ? open.length : '';
    $('kBuild').innerHTML = open.length ? open.slice(0, 5).map(p => {
      const names = stagesOf(p.type), all = (p.stage + progress(p)) / names.length;
      return `<button class="tk${p.stall ? ' stuck' : ''}${this.A.projSel === p.id ? ' on' : ''}" data-proj="${p.id}"><div class="row2"><b class="grow">${esc(p.name)}</b><em>${pct(all)}</em></div>
        <div class="ps">${p.paused ? 'Paused · ' : ''}${esc(names[p.stage])}${p.stall ? ' · stalled' : !p.crews.length && !p.paused ? ' · waiting' : ''}</div><div class="bar"><u style="width:${pct(all)}"></u></div></button>`;
    }).join('') + (open.length > 5 ? `<div class="tk idle">${open.length - 5} more in the build list</div>` : '') : `<div class="tk idle">Nothing being built. Press B to plan a building.</div>`;
  }
  // the colonists along the top, like a game's party bar
  colbar(U) {
    const A = this.A, el = $('bar');
    if (U.mode === 'stress' || !A.people.length || A.place) { el.hidden = true; this.barSig = ''; return; }
    const who = A.people.map((p, i) => i).filter(i => U.p[i] && !(U.p[i][6] & 16));
    const row = i => { const r = U.p[i]; return [i, r[1], Math.round(Math.min(100 - r[2], 100 - r[3], r[5]) / 5), r[0], r[6]]; };
    const sig = JSON.stringify([who.map(row), A.sel]); if (sig === this.barSig) { el.hidden = false; return; }
    this.barSig = sig;
    el.innerHTML = who.map(i => {
      const p = A.people[i], r = U.p[i], cond = Math.min(100 - r[2], 100 - r[3], r[5]), f = r[6], act = r[0];
      const asleep = act === ACT.BED || act === ACT.INSIDE, st = f & 512 ? ['!', 'down', 'Down'] : f & 16384 ? ['!', 'sick', 'Gravely ill'] : f & 256 ? ['+', 'bleed', 'Bleeding'] : f & 4096 ? ['~', 'sick', f & 8192 ? 'Sick, kept apart' : 'Sick'] : f & 2 ? ['+', 'hurt', f & 2048 ? 'Hurt, getting worse' : 'Hurt'] : f & 8 ? ['!', 'hungry', 'Hungry'] : asleep ? ['z', '', 'Asleep'] : null;
      const tip = `${p.name} · ${DOING[act] || ACT_NAME[act] || ''}${st && st[2] !== 'Asleep' ? ' · ' + st[2].toLowerCase() : ''}\nFatigue ${r[2]} · strain ${r[3]} · trust ${r[4]} · health ${r[5]}\nDouble-click to look at them`;
      return `<button class="pc${A.sel === i ? ' on' : ''}${f & 1024 ? ' care' : ''}${act === ACT.INSIDE || act === ACT.INDOORS || act === ACT.BENCH ? ' out' : ''}" data-i="${i}" title="${esc(tip)}"><img src="${portrait(p, r[1], r[8])}" alt="">${st ? `<em class="${st[1]}">${st[0]}</em>` : ''}<span>${esc(p.name.split(' ')[0])}</span><u><i style="width:${cond}%;background:${meterCol(cond, true)}"></i></u></button>`;
    }).join('');
    el.hidden = false;
  }

  // ---------- the person you picked ----------
  card() {
    const A = this.A, U = A.ui, i = A.sel, card = $('card');
    if (i < 0 || !U || !U.p[i] || !A.people[i]) { card.hidden = true; return; }
    const p = A.people[i], r = U.p[i], d = U.detail && U.detail.id === i ? U.detail : null, crew = r[1] >= 0 ? U.crews[r[1]] : null;
    const flags = r[6], extra = [flags & 16 ? 'dead' : '', flags & 1 ? 'getting used to a new body' : '', flags & 512 && r[0] !== ACT.DOWN ? 'down' : '', flags & 256 ? 'bleeding' : flags & 2 ? 'hurt' : '', flags & 2048 ? 'getting worse' : '', flags & 16384 ? 'gravely ill' : flags & 4096 ? 'sick' : '', flags & 8192 ? 'kept apart' : '', flags & 1024 && !(flags & 512) ? 'in care' : '', flags & 8 ? 'hungry' : '', flags & 64 ? 'cold' : '', flags & 128 ? 'unwell' : ''].filter(Boolean);
    $('cName').textContent = p.name; const pic = portrait(p, r[1], r[8]); if ($('cPic').getAttribute('src') !== pic) $('cPic').src = pic;
    $('cMeta').textContent = ageLine(p, r);
    $('cSw').style.background = rgb(crewColour(r[1]));
    $('cCrew').textContent = crew ? `${crew.name} crew${crew.lead === i ? ', lead' : ''}${r[8] < 16 ? ', apprentice' : ''} · ${WORKS[crew.work].toLowerCase()} · ${SHIFT_TXT[crew.shift].toLowerCase()}` : r[8] < 2 ? 'In the Seed’s nursery' : flags & 65536 ? 'Too young for the crews' : flags & 131072 ? 'Retired from the crews' : 'Not in a crew';
    $('cJob').textContent = (flags & 16 ? 'Dead' : ACT_NAME[r[0]] || '') + (extra.length && !(flags & 16) ? ' · ' + extra.join(', ') : '');
    { const cc = $('cCtl'), mine = U.ctl === i;
      cc.hidden = U.mode !== 'landfall' || !!(flags & 16); cc.textContent = mine ? 'Release' : 'Take charge'; cc.classList.toggle('on', mine); cc.disabled = !mine && !U.emerg;
      cc.title = mine ? 'Hand them back to their crew (Esc)' : U.emerg ? `Direct them yourself, for now: ${EM_TXT[U.emerg]}. Right-click to give orders` : 'Only in an emergency: a fire near the camp, someone down or bleeding, a flood, or someone freezing'; }
    const sig = JSON.stringify([i, r, d, A.names.length, this.ctab]);
    if (sig !== this.cardSig) {
      this.cardSig = sig;
      const B = d && d.body, dg = B ? B.danger : 0, dot = B && (B.w.length || B.inner.length || B.unexplained || dg > .2) ? `<i style="background:${dg >= .45 ? 'var(--bad)' : dg >= .2 ? 'var(--mid)' : 'var(--good)'}"></i>` : '';
      const tabs = `<div class="ctabs"><button data-ctab="about" class="${this.ctab === 'about' ? 'on' : ''}">About</button><button data-ctab="health" class="${this.ctab === 'health' ? 'on' : ''}">Health${dot}</button></div>`;
      if (this.ctab === 'health') { $('cBody').innerHTML = tabs + (d ? healthTab(B, p.name.split(' ')[0], !!(flags & 16)) : ''); }
      else {
      const meter = (lbl, v, goodHigh, tip) => `<span title="${tip}">${lbl}</span><b><u style="width:${v}%;background:${meterCol(v, goodHigh)}"></u></b><em>${v}</em>`;
      let h = `<div class="meters">${meter('Fatigue', r[2], false, 'Tired from work and walking; sleep brings it down')}${meter('Strain', r[3], false, 'Worry, hardship and loneliness; company and rest bring it down')}${meter('Trust', r[4], true, 'Trust in the Seed: falls with long shifts, nights outside and hunger')}${meter('Health', r[5], true, 'Injuries, hunger, cold and a poor diet')}${meter('Cold', r[7] || 0, false, 'Cold soaks in outdoors, worst at night and in wind and rain; a roof and a warm bed take it away. Above 65 it starts to do harm')}</div>`;
      h += `<div class="chips" style="margin-top:10px">${p.traits.map(t => `<span class="chip t" title="${esc(TRAITS[t])}">${cap1(t)}: ${esc(TRAITS[t].toLowerCase())}</span>`).join('')}</div>`;
      if (d) {
        const fn = U.F && U.F.names, meal = !d.meal ? 'No meal yet.' : d.meal === 'ration' ? 'Last ate a lander ration.' : `Last ate ${esc(((fn && fn[d.meal]) || (CROPS[d.meal] && CROPS[d.meal].name) || 'food from this world').toLowerCase())}.`;
        const diet = d.tox > 4 ? ' Something in the diet is building up in the body: aching joints, headaches.' : d.lack > 10 ? ' The diet has been short of something for a long while: tired, slow to heal.' : d.tox > 2 || d.lack > 5 ? ' The diet is starting to tell.' : '';
        h += `<div class="note" style="margin:10px 0 0">${d.home ? `Sleeps in ${esc(d.home)}.` : 'Sleeps in a bedroll by the Seed.'} ${meal}${diet}</div>`;
        h += `<div class="sec">Skills</div><div class="skills">${SKILLS.map(k => `<div>${SKILL_NAME[k]}<em>${d.skills[k].toFixed(1)}</em></div>`).join('')}</div>`;
        const gone = id => U.p[id] && U.p[id][6] & 16 ? ' (died)' : '';
        const fam = d.ties.filter(t => KIN[t.k]).sort((a, b) => KIN_ORDER.indexOf(a.k) - KIN_ORDER.indexOf(b.k)), ties = d.ties.filter(t => t.k && !KIN[t.k]);
        if (fam.length) h += `<div class="sec">Family</div><div class="chips">${fam.map(t => `<span class="chip g">${KIN[t.k]}: ${esc(A.names[t.id] || '')}${gone(t.id)}</span>`).join('')}</div>`;
        if (ties.length) h += `<div class="sec">People</div><div class="chips">${ties.map(t => `<span class="chip ${t.k === 'rival' ? 'b' : 'g'}">${t.k === 'friend' ? 'Friend' : t.k === 'rival' ? 'Rival' : cap1(t.k)}: ${esc(A.names[t.id] || '')}${gone(t.id)}</span>`).join('')}</div>`;
        if (d.tr && d.tr.length) h += `<div class="sec">What they carry</div>${d.tr.slice().sort((a, b) => b.w - a.w).map(t => `<div class="mm2" title="${t.w >= 50 ? 'Heavy: it adds to their strain, troubles their sleep and brings a breakdown closer' : t.w >= 20 ? 'It still weighs on them, and comes back when the same thing happens again' : 'Fading'}"><em>${t.w >= 50 ? 'Heavy' : t.w >= 20 ? 'Weighing' : 'Fading'}</em>${esc(TR_NAME[t.k])}: ${esc(t.m)}</div>`).join('')}`;
        h += `<div class="sec">Memories</div>${d.mem.slice().reverse().map(m => `<div class="mm2"><em>${m.d ? 'Day ' + m.d : 'Before'}</em>${esc(m.m)}</div>`).join('')}`;
      }
      $('cBody').innerHTML = tabs + h;
      }
    }
    const ms = $('cMove'), mSig = JSON.stringify([U.crews.map(c => [c.id, c.name, c.gone]), r[1]]);
    if (mSig !== this.moveSig && document.activeElement !== ms) {
      this.moveSig = mSig;
      ms.innerHTML = `<option value="-1">No crew</option>` + U.crews.filter(c => !c.gone).map(c => `<option value="${c.id}">${esc(c.name)} crew</option>`).join('');
      ms.value = String(r[1]);
    }
    ms.disabled = !!(flags & 16) || !!(flags & 65536);
    card.hidden = false;
  }

  // ---------- the building you picked on the map (or in the list) ----------
  bcard() {
    const A = this.A, U = A.ui, el = $('bcard'), p = U && A.projSel >= 0 ? U.projects.find(q => q.id === A.projSel) : null;
    if (!p && A.thing && U && A.phase === 'colony') return this.tcard(A.thing);
    if (!p || A.phase !== 'colony') { el.hidden = true; this.bSig = ''; return; }
    const sig = JSON.stringify([p, this.confirm === p.id, p.type === 'clinic' && [U.care, U.med, U.ill], p.type === 'plant' && [U.seed.feed, U.seed.fb]]); if (sig === this.bSig) { el.hidden = false; return; }
    this.bSig = sig;
    const T = TYPES[p.type], test = p.type === 'test', names = stagesOf(p.type), n = names.length;
    const f = progress(p), all = p.done ? 1 : (p.stage + f) / n;
    $('bName').textContent = p.name; $('bPic').innerHTML = icon(TICON[p.type] || 'build');
    $('bMeta').textContent = test ? `At the rig in the yard` : `${T.name} · ${p.w} × ${p.h} tiles${T.open ? '' : T.below ? ` · dug into ${p.ug || 'the ground'}` : ` · door on the ${SIDE[p.side]} side`}`;
    $('bJob').textContent = p.done ? (p.type === 'solar' ? `Finished · making ${p.cap.supply} kW` : !p.cap.kw ? 'Finished · in use' : `Finished · ${p.powered ? 'has power' : 'dark: not enough power'}`)
      : p.paused ? `Paused at ${names[p.stage].toLowerCase()}` : p.stall ? 'Stalled' : p.crews.length ? `Being built · ${names[p.stage].toLowerCase()}` : `Waiting · ${names[p.stage].toLowerCase()}`;
    if (p.fire) $('bJob').textContent = `On fire · ${Math.round(p.burn * 100)}% burned`;
    else if (p.wet) $('bJob').textContent = 'Under water';
    else if (p.dmg && !p.done) $('bJob').textContent = `Repairing after ${DMG[p.dmg] || 'damage'} · ${names[p.stage].toLowerCase()}`;
    $('bDot').className = 'dot' + (p.fire || p.wet ? ' bad' : p.done ? (p.powered || p.type === 'solar' ? ' ok' : ' off') : p.paused || p.stall || !p.crews.length ? ' off' : '');
    let h = '';
    if (p.fire) h += `<div class="pw bad">It is burning. Everyone inside got out, and anyone who can is beating it out. The longer it burns, the more of it the build crews will have to put back.</div>`;
    else if (p.wet) h += `<div class="pw">Flood water is standing in it${p.done || p.type === 'field' ? ': it is out of use until the water goes down' : ': building waits until the water goes down'}. The longer it stands, the more repairs it will need.</div>`;
    else if (p.dmg && !p.done) h += `<div class="note" style="margin:0 0 6px">Damaged by ${DMG[p.dmg] || 'damage'}: it is out of use until the build crews finish the repairs below.</div>`;
    if (!test) h += `<div class="note" style="margin:8px 0 0">${esc(T.use || 'Twelve bunks in the lander\'s own modules, the first roof on this world')}. It holds ${esc(holds(p.type, p.cap))}${p.type === 'solar' || !p.cap.kw ? '' : ` and draws ${p.cap.kw} kW`}.</div>`;
    if (p.type === 'clinic' && p.done && U.care) {
      const C = U.care, M = U.med, here = C.ward.filter(q => q[1] === p.id).map(q => q[0]);
      h += `<div class="sec">Patients</div>${here.length ? `<div class="chips">${here.map(id => `<button class="chip" data-act="person" data-id="${id}">${esc(A.people[id] ? A.people[id].name : '')}</button>`).join('')}</div>` : '<div class="note" style="margin:0">No one is in here.</div>'}`;
      h += `<div class="note" style="margin:6px 0 0">${C.medics ? `${C.medics} ${C.medics === 1 ? 'person is' : 'people are'} skilled enough to work as a medic.` : 'Nobody is skilled in medicine yet: others will do what they can, worse.'} A crew set to clinic work stays close by.</div>`;
      const I = U.ill;
      if (I) {
        h += `<div class="sec">Keeping the sick apart</div><div class="rules"><label><input type="checkbox" data-act="iso"${I.iso ? ' checked' : ''}>Isolate anyone with a catching illness</label></div>`;
        h += `<div class="note" style="margin:4px 0 0">The sick stay in a clinic bed, or their own bunk if the clinic is full, until it passes, and eat there. It stops the spread at meals and in shared rooms, but being shut away adds to their strain and costs trust. Only illnesses a medic has named as catching count.</div>`;
        if (I.kinds.length) h += `<div class="sec">Illness seen here</div>${I.kinds.map(k => `<div class="wd"><b>${esc(k.name || 'Not yet named')}</b><div class="sub">${esc(k.sym)}. ${k.cases} case${k.cases === 1 ? '' : 's'}${k.deaths ? `, ${k.deaths} dead` : ''}.${k.name ? '' : ` What the medics know: ${Math.round(k.seen * 100)}%. Every examination adds to it, faster in a clinic and with a lab.`}</div>${k.name ? `<div class="sub">${esc(k.text)}</div><div class="chips">${k.catching ? '<span class="chip b">Catching</span>' : '<span class="chip g">Not catching</span>'}${k.abx ? '<span class="chip g">Antibiotics work</span>' : '<span class="chip m">Antibiotics don’t help</span>'}</div>` : ''}</div>`).join('')}`;
      }
      h += `<div class="sec">When there are more patients than medics</div><div class="seg sm wrap">${Object.entries(TRIAGE).map(([k, t]) => `<button data-act="triage" data-v="${k}" class="${C.triage === k ? 'on' : ''}">${t}</button>`).join('')}</div>`;
      if (M) h += `<div class="note" style="margin:6px 0 0">Supplies: ${M.dress} dressings, ${M.pk} painkillers, ${M.abx} antibiotic courses, ${M.blood} units of blood substitute.</div>`;
    }
    if (p.type === 'plant' && p.done) {
      const sd = U.seed, T0 = p.tanks || [], full = FEED.h * HOUR;
      h += `<div class="sec">Tanks</div><div class="bill">${Array.from({ length: p.cap.tanks }, (_, i) => `<div><em>Tank ${i + 1}</em>${T0[i] > 0 ? `working, ${Math.round((1 - T0[i] / full) * 100)}%` : 'empty'}</div>`).join('')}</div>`;
      h += `<div class="sec">Next body · ${sd.fb} of ${sd.per} batches</div><div class="bar"><u style="width:${Math.round(sd.fb / sd.per * 100)}%"></u></div>`;
      h += `<div class="note" style="margin:6px 0 0">Each batch takes ${FEED.biomass} loads of biomass and ${FEED.stone} of stone from the yard and half a day with power. ${sd.feed ? `The fabricator holds feedstock for ${sd.feed} ${sd.feed === 1 ? 'body' : 'bodies'}: pick who wakes in the Archive (<kbd>Q</kbd>).` : ''}</div>`;
      if (p.why) h += `<div class="pw">${esc(p.why)}</div>`;
    }
    if (p.type === 'mine') {
      const Y = U.stores.yard;
      h += `<div class="sec">The seam</div><div class="note" style="margin:0">${p.seam > 0 ? `About ${p.seam} loads of ore are left to bring up${p.done ? '' : ', once the galleries are dug'}.` : 'Worked out: there is no ore left under it. Plan a new mine over another seam.'} ${p.done && p.seam > 0 ? 'A crew set to mine work cuts it, a load at a time, and piles it in the yard, while the colony is short of metal.' : ''} Every three loads of ore smelt into two of salvage at a workshop bench, or more slowly in the Seed's fabricator.${Y.ore ? ` The yard holds ${Y.ore} ${Y.ore === 1 ? 'load' : 'loads'} of ore.` : ''}</div>`;
    }
    if (p.type === 'pit') h += `<div class="sec">The stone</div><div class="note" style="margin:0">${p.rock > 0 ? `About ${p.rock} loads of stone are left to cut${p.done ? '' : ', once the face is open'}.` : 'Cut out: the stone left is too deep to reach. Plan a new pit on stony ground.'} ${p.done && p.rock > 0 ? 'Quarry crews and builders cut here when it is nearer than the rocks left lying about, or when nothing else is left.' : ''}</div>`;
    if (p.type === 'field' && p.done) { const [state, sel] = fieldBits(p); h += `<div class="sec">Crop</div><div class="note" style="margin:0 0 6px">${state}</div>${sel}`; }
    if (!p.done) {
      h += `<div class="sec">Progress · ${pct(all)}</div><div class="bar"><u style="width:${pct(all)}"></u></div>`;
      h += `<div class="stg">` + names.map((nm, i) => {
        const st = i < p.stage ? 'done' : i === p.stage ? 'now' : '';
        return `<div class="${st}"><i>${i < p.stage ? '✓' : i + 1}</i><span>${nm}</span><em>${i < p.stage ? 'done' : i === p.stage ? pct(f) : ''}</em></div>`;
      }).join('') + `</div>`;
      const rows = Object.entries(p.need).filter(([k, q]) => q > 0 && k !== 'mark' && k !== 'test');
      if (rows.length) h += `<div class="sec">This stage takes</div><div class="bill">` + rows.map(([k, q]) => { const g = Math.min(q, p.got[k] || 0); return `<div><em>${esc(cap1(matName(k, 2).replace(/^2 /, '')))}</em>${g} of ${q} in place</div>`; }).join('') + `</div>`;
      else if (p.stage === 0 && !test) h += `<div class="note" style="margin-top:6px">${T.below ? 'Marking out needs only pegs and string; the crew paces out the room above it and sets the stairs.' : 'Marking out needs only pegs and string; the crew walks the plot and clears what stands on it.'}</div>`;
      if (T.below && !p.done) h += `<div class="note" style="margin-top:6px">Press <kbd>U</kbd> to see it below ground.${p.ore > .05 ? ' There is ore in this ground.' : ''}</div>`;
      if (p.wait) h += `<div class="pw">${esc(p.wait)}</div>`;
      else if (p.crews.length) h += `<div class="ps" style="margin-top:6px">${esc(p.crews.join(', '))} crew${p.crews.length > 1 ? 's are' : ' is'} on it.</div>`;
    } else if (p.wait) h += `<div class="pw">${esc(p.wait)}</div>`;
    if (p.type !== 'shelter' && this.confirm === p.id) {
      const b = Object.entries(p.back || {}).map(([k, q]) => matName(k, q)).join(', ');
      h += `<div class="pw">${p.done || p.dmg ? 'Take it down?' : 'Cancel it?'} ${b ? `Everything that went into it comes back to the stores: ${esc(b)}.` : 'Nothing has gone into it yet.'} Press again to confirm.</div>`;
    }
    $('bBody').innerHTML = h;
    const cx = $('bCancel'); cx.hidden = p.type === 'shelter'; cx.textContent = this.confirm === p.id ? (p.done || p.dmg ? 'Yes, take it down' : 'Yes, cancel it') : p.done || p.dmg ? 'Take down' : 'Cancel';
    const pause = $('bPause'); pause.hidden = p.done || p.type === 'shelter'; pause.textContent = p.paused ? 'Resume' : 'Pause';
    $('bList').hidden = false; $('bList').textContent = 'In the build list';
    el.hidden = false;
  }
  // the same card for anything else on the map: the Seed, the fire, the kitchen, the yard, stakes, life, trees and rocks
  tcard(th) {
    const el = $('bcard'), c = thingCard(this.A, th); this.thingInfo = c;
    if (!c) { el.hidden = true; return; }
    const sig = 't' + JSON.stringify(c); if (sig === this.bSig) { el.hidden = false; return; }
    this.bSig = sig;
    $('bName').textContent = c.name; $('bPic').innerHTML = icon(c.icon); $('bMeta').textContent = c.meta;
    $('bJob').textContent = c.job; $('bDot').className = 'dot' + (c.dot ? ' ' + c.dot : '');
    $('bBody').innerHTML = c.body;
    $('bPause').hidden = true; $('bCancel').hidden = true; $('bList').hidden = !c.btn; if (c.btn) $('bList').textContent = c.btn.label;
    el.hidden = false;
  }
}

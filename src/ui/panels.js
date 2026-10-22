// The panels around the map: the orbital survey before the landing, then the colony strip, the archive (who
// the fabricator prints), the crews (what people do and by what rules), the log, and the card of the person
// you picked. They only show what the simulation reports and send commands back; they decide nothing.
import { ACT, ACT_NAME, SHIFTS, WORKS, RULES, SKILLS, SKILL_NAME, DAY_TICKS, HOUR, MAP } from '../core/consts.js';
import { TRAITS, suggestFirst } from '../core/founders.js';
import { STAGES, PRINT_TICKS } from '../core/work.js';
import { crewColour } from '../render/people.js';
import { LETTERS } from '../render/view.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const rgb = c => `rgb(${c.map(v => v | 0).join(',')})`;
const pad = n => String(n).padStart(2, '0');
const when = t => { const d = Math.floor(t / DAY_TICKS) + 1, h = (t % DAY_TICKS) / HOUR; return `Day ${d} ${pad(Math.floor(h))}:${pad(Math.floor((h % 1) * 60))}`; };
const cap1 = s => s.charAt(0).toUpperCase() + s.slice(1);
const SHORT = ['Plot', 'Foundations', 'Frame', 'Systems', 'Fit-out'];
const SHIFT_TXT = SHIFTS.map(s => `${s.name} ${s.a}–${s.b}`);
// what a crew's members are doing, in a word each
const DOING = { [ACT.BED]: 'asleep', [ACT.INSIDE]: 'asleep', [ACT.WALK]: 'walking', [ACT.HOME]: 'walking back', [ACT.TOBED]: 'turning in', [ACT.SURVEY]: 'surveying', [ACT.PLANT]: 'planting a stake', [ACT.CARRY]: 'carrying', [ACT.BUILD]: 'building', [ACT.EAT]: 'eating', [ACT.IDLE]: 'at camp', [ACT.ALONE]: 'off alone', [ACT.WAKE]: 'waking', 15: 'dead' };
const meterCol = (v, goodHigh) => { const x = goodHigh ? 100 - v : v; return x > 70 ? 'var(--bad)' : x > 45 ? 'var(--mid)' : 'var(--good)'; };
const topSkills = (sk, n = 3) => SKILLS.map(k => [k, sk[k]]).sort((a, b) => b[1] - a[1]).slice(0, n);

export class Panels {
  constructor(A, api) {
    this.A = A; this.api = api; this.tab = 'archive'; this.chosen = new Set(); this.touched = false; this.sig = ''; this.cardSig = ''; this.moveSig = '';
    this.logSeen = 0; this.busy = false; this.min = false;
    const side = $('side'), body = $('sideBody');
    side.querySelectorAll('.tabs [data-tab]').forEach(b => b.onclick = () => this.setTab(b.dataset.tab));
    $('sideMin').onclick = () => this.fold();
    side.addEventListener('pointerdown', () => { this.busy = true; });
    window.addEventListener('pointerup', () => { if (this.busy) { this.busy = false; setTimeout(() => this.update(), 0); } });
    body.addEventListener('click', e => this.onClick(e));
    body.addEventListener('change', e => this.onChange(e));
    $('cMove').onchange = e => { const v = +e.target.value; this.api.cmd('move', { person: this.A.sel, crew: v }); };
    $('orbit').addEventListener('click', e => {
      const site = e.target.closest('[data-site]'), go = e.target.closest('[data-land]');
      if (go) this.api.land(+go.dataset.land); else if (site) this.api.siteSelect(+site.dataset.site);
    });
  }

  // ---------- before the landing ----------
  orbit(sites, sel) {
    const el = $('orbit'); if (!sites) { el.hidden = true; return; }
    const unknown = { 'Lake shore': 'how high the lake rises', 'River meadow': 'how far the river floods', 'Woodland clearing': 'what lives under the trees', 'Under the ridge': 'whether the slope is stable', 'Marsh edge': 'how sound the ground is', 'Open plain': 'how hard the wind blows' };
    el.innerHTML = `<h2>Orbital survey</h2><p>The Seed has found three places it could come down. It can only land once, and it won't lift again.</p>` +
      sites.map((s, i) => `<div class="site${i === sel ? ' on' : ''}" data-site="${i}"><h3><b>${LETTERS[i]}</b>${esc(s.tag)}</h3>
        <div class="facts"><div>Open ground <em>${s.open}%</em></div><div>Woodland <em>${s.wood}%</em></div><div>Stone <em>${s.stone}%</em></div><div>Marsh <em>${s.marsh}%</em></div>
        <div>Water <em>${s.water == null ? 'none seen' : s.water < 30 ? 'at hand' : s.water + ' m'}</em></div><div>Open water <em>${s.wet}%</em></div></div>
        <div class="unk">Not known from orbit: the soil, the weather, what lives here, and ${unknown[s.tag] || 'what is under the surface'}.</div></div>`).join('') +
      `<div class="acts"><button class="go" data-land="${sel}">Land at ${LETTERS[sel]}: ${esc(sites[sel].tag)}</button></div>
      <p style="margin-top:10px">The survey covers ground about 1.2 km across. Each site's figures are for the ground within 80 m of it.</p>`;
    el.hidden = false;
  }

  // ---------- the colony ----------
  show(on) { $('side').hidden = !on; $('colony').hidden = !on; if (!on) $('card').hidden = true; }
  setTab(t) {
    this.tab = t; this.sig = '';
    document.querySelectorAll('#side .tabs [data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === t));
    if (this.min) this.fold(false);
    this.update();
  }
  fold(on = !this.min) { this.min = on; $('side').classList.toggle('min', on); }
  toggleTab(t) { if (this.tab === t && !this.min) this.fold(true); else this.setTab(t); }
  update() {
    const A = this.A, U = A.ui; if (!U) return;
    this.strip(U);
    if (this.tab === 'log') this.logSeen = U.logN;
    const nNew = U.logN - this.logSeen, badge = $('logNew'); badge.hidden = nNew <= 0 || this.tab === 'log'; badge.textContent = nNew > 99 ? '99+' : nNew;
    if (!this.busy && !this.min) {
      const body = $('sideBody'), focus = document.activeElement;
      const holding = focus && body.contains(focus) && focus.tagName === 'SELECT';
      const [sig, html] = this.tab === 'archive' ? this.archive(U) : this.tab === 'crews' ? this.crews(U) : this.log(U);
      if (sig !== this.sig && !holding) { const top = body.scrollTop; body.innerHTML = html(); body.scrollTop = top; this.sig = sig; }
      if (this.tab === 'archive') this.archiveLive(U);
    }
    this.card();
  }
  strip(U) {
    const awake = U.alive, left = U.seed.feed + U.seed.queue.length;
    $('kPeople').textContent = U.mode === 'stress' ? `${awake} awake` : `${awake} awake · ${this.A.archive.filter(p => p.woke == null).length} stored`;
    const eaters = awake + U.seed.queue.length + (U.seed.printing ? 1 : 0), days = eaters ? U.food / eaters : 0, kf = $('kFood');
    kf.textContent = U.mode === 'stress' ? 'not counted' : eaters ? `${Math.floor(U.food)} meals · ${Math.floor(days)} days` : `${Math.floor(U.food)} meals`;
    kf.className = U.mode !== 'stress' && eaters && days < 10 ? (days < 3 ? 'bad' : 'warn') : '';
    const sh = U.shelter; $('kShelter').textContent = sh.done ? `Done · ${sh.beds} bunks` : `${SHORT[sh.stage]} · ${Math.round(sh.fits / STAGES.reduce((t, s) => t + s[1], 0) * 100)}%`;
    $('kKnown').textContent = `${(U.known / (MAP * MAP) * 100).toFixed(1)}% · ${U.stakes.length} of 10 stakes`;
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
    const sig = ['a', U.rv, sd.feed, sd.queue.join('.'), sd.printing ? sd.printing.fid : -1, [...this.chosen].join('.'), arch.length].join('|');
    return [sig, () => {
      const names = new Map(arch.map(p => [p.fid, p.name]));
      let h = `<div class="box"><div class="row2"><div class="grow"><b>Fabricator</b><div class="note" style="margin:2px 0 0">${sd.feed ? `Feedstock for ${sd.feed} more ${sd.feed === 1 ? 'body' : 'bodies'}.` : 'No feedstock left. The core has stopped.'} Each body takes about four hours to print.</div></div></div>`;
      if (sd.printing) h += `<div style="margin-top:8px;font-size:12px;font-weight:700">Printing ${esc(names.get(sd.printing.fid))}</div><div class="bar"><u id="prBar" style="width:0"></u></div>`;
      if (sd.queue.length) h += `<div class="sec">Next in line</div>` + sd.queue.map((f, i) => `<div class="q"><span>${i + 1}. ${esc(names.get(f))}</span><button data-act="unq" data-fid="${f}">Remove</button></div>`).join('');
      h += `</div>`;
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
  archiveLive(U) { const b = $('prBar'), p = U.seed.printing; if (b && p) b.style.width = Math.round((1 - p.left / PRINT_TICKS) * 100) + '%'; }

  // ---------- crews ----------
  crews(U) {
    const A = this.A, P = U.p, names = A.names;
    const live = U.crews.filter(c => !c.gone), free = P.map((r, i) => i).filter(i => P[i][1] < 0 && !(P[i][6] & 16));
    const statusOf = cr => {
      const n = {}; for (const i of cr.members) { const w = DOING[P[i][0]] || 'busy'; n[w] = (n[w] || 0) + 1; }
      return Object.entries(n).map(([w, k]) => `${k} ${w}`).join(' · ') || 'nobody yet';
    };
    const mm = i => { const r = P[i]; return [Math.round(r[2] / 10), Math.round(r[3] / 10), Math.round(r[4] / 10)]; };
    const sig = 'c' + JSON.stringify([U.rv, U.auto, live.map(c => [c.id, c.lead, c.work, c.shift, c.rules, c.target, c.members, statusOf(c), c.members.map(mm)]), free, free.map(mm)]);
    return [sig, () => {
      let h = U.auto ? `<div class="note">The Seed is sorting people into crews as they wake. Change anything here and it leaves the crews to you.</div>` : '';
      if (!live.length && !free.length) h += `<div class="note">Nobody is awake yet. Crews form as the fabricator prints the founders.</div>`;
      const member = (i, cr) => { const r = P[i]; return `<div class="mem" data-act="person" data-id="${i}"><span class="nm">${esc(names[i] || '')}</span>${cr && cr.lead === i ? '<span class="lead">LEAD</span>' : ''}<span class="mini3" title="Fatigue, strain, trust">${[[r[2], 0], [r[3], 0], [r[4], 1]].map(([v, g]) => `<b><u style="width:${v}%;background:${meterCol(v, g)}"></u></b>`).join('')}</span></div>`; };
      for (const cr of live) {
        const col = rgb(crewColour(cr.id));
        h += `<div class="crew"><h3><i style="background:${col}"></i>${esc(cr.name)}<em>${cr.members.length} ${cr.members.length === 1 ? 'person' : 'people'}</em></h3><div class="st">${esc(cap1(statusOf(cr)))}</div>
          <div class="lbl">WORK</div><div class="seg sm">${Object.entries(WORKS).map(([k, v]) => `<button data-act="work" data-crew="${cr.id}" data-v="${k}" class="${cr.work === k ? 'on' : ''}">${v}</button>`).join('')}</div>
          <div class="lbl">SHIFT</div><div class="seg sm">${SHIFT_TXT.map((t, k) => `<button data-act="shift" data-crew="${cr.id}" data-v="${k}" class="${cr.shift === k ? 'on' : ''}">${t}</button>`).join('')}</div>
          <div class="lbl">LEAD</div><select data-act="lead" data-crew="${cr.id}" aria-label="Crew lead">${cr.members.length ? cr.members.map(i => `<option value="${i}"${cr.lead === i ? ' selected' : ''}>${esc(names[i] || '')}</option>`).join('') : '<option>Nobody</option>'}</select>
          <div class="lbl">RULES</div><div class="rules">${Object.entries(RULES).map(([k, v]) => `<label><input type="checkbox" data-act="rule" data-crew="${cr.id}" data-rule="${k}"${cr.rules[k] ? ' checked' : ''}>${v}</label>`).join('')}</div>`;
        if (cr.work === 'survey') h += `<div class="lbl">SURVEY AREA</div><div class="row2"><span class="grow" style="font-size:12px;font-weight:600">${cr.target >= 0 ? 'Around the marked spot' : 'Wherever is unseen and in reach'}</span><button class="btn" data-act="area" data-crew="${cr.id}">${cr.target >= 0 ? 'Move' : 'Mark on map'}</button>${cr.target >= 0 ? `<button class="btn" data-act="areaClear" data-crew="${cr.id}">Clear</button>` : ''}</div>`;
        if (cr.work === 'rest') h += `<div class="note" style="margin-top:8px">Resting: they stay around camp and recover. Nothing else needs doing yet${U.shelter.done ? ' now the shelter is up' : ''}.</div>`;
        h += `<div class="lbl">PEOPLE</div>${cr.members.map(i => member(i, cr)).join('') || '<div class="note">Nobody. Move people here from their card.</div>'}
          <div class="row2" style="margin-top:8px"><span class="grow"></span><button class="btn" data-act="crewDel" data-crew="${cr.id}">Disband</button></div></div>`;
      }
      if (free.length) h += `<div class="sec">Not in a crew · ${free.length}</div>` + free.map(i => member(i, null)).join('') + `<div class="note">Pick someone to put them in a crew from their card.</div>`;
      if (P.length) h += `<button class="btn" data-act="crewNew" style="width:100%;margin-top:6px">New crew</button>`;
      return h;
    }];
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
      case 'area': this.api.pickArea(crew); break;
      case 'areaClear': this.api.cmd('crewSet', { crew, target: -1 }); break;
      case 'person': this.api.select(+el.dataset.id, true); break;
      case 'crewNew': this.api.cmd('crewNew', {}); break;
      case 'crewDel': this.api.cmd('crewDel', { crew }); break;
    }
    this.sig = ''; this.update();
  }
  onChange(e) {
    const el = e.target, act = el.dataset.act, crew = +el.dataset.crew;
    if (act === 'rule') this.api.cmd('crewSet', { crew, rule: el.dataset.rule, on: el.checked });
    else if (act === 'lead') { this.api.cmd('crewSet', { crew, lead: +el.value }); el.blur(); }
  }

  // ---------- the person you picked ----------
  card() {
    const A = this.A, U = A.ui, i = A.sel, card = $('card');
    if (i < 0 || !U || !U.p[i] || !A.people[i]) { card.hidden = true; return; }
    const p = A.people[i], r = U.p[i], d = U.detail && U.detail.id === i ? U.detail : null, crew = r[1] >= 0 ? U.crews[r[1]] : null;
    const flags = r[6], extra = [flags & 16 ? 'dead' : '', flags & 1 ? 'getting used to a new body' : '', flags & 2 ? 'hurt' : '', flags & 8 ? 'hungry' : ''].filter(Boolean);
    $('cName').textContent = p.name;
    $('cMeta').textContent = `${p.age} · former ${p.trade.toLowerCase()}`;
    $('cSw').style.background = rgb(crewColour(r[1]));
    $('cCrew').textContent = crew ? `${crew.name} crew${crew.lead === i ? ', lead' : ''} · ${WORKS[crew.work].toLowerCase()} · ${SHIFT_TXT[crew.shift].toLowerCase()}` : 'Not in a crew';
    $('cJob').textContent = (flags & 16 ? 'Dead' : ACT_NAME[r[0]] || '') + (extra.length && !(flags & 16) ? ' · ' + extra.join(', ') : '');
    const sig = JSON.stringify([i, r, d, A.names.length]);
    if (sig !== this.cardSig) {
      this.cardSig = sig;
      const meter = (lbl, v, goodHigh, tip) => `<span title="${tip}">${lbl}</span><b><u style="width:${v}%;background:${meterCol(v, goodHigh)}"></u></b><em>${v}</em>`;
      let h = `<div class="meters">${meter('Fatigue', r[2], false, 'Tired from work and walking; sleep brings it down')}${meter('Strain', r[3], false, 'Worry, hardship and loneliness; company and rest bring it down')}${meter('Trust', r[4], true, 'Trust in the Seed: falls with long shifts, nights outside and hunger')}${meter('Health', r[5], true, 'Injuries and hunger')}</div>`;
      h += `<div class="chips" style="margin-top:10px">${p.traits.map(t => `<span class="chip t" title="${esc(TRAITS[t])}">${cap1(t)}: ${esc(TRAITS[t].toLowerCase())}</span>`).join('')}</div>`;
      if (d) {
        h += `<div class="sec">Skills</div><div class="skills">${SKILLS.map(k => `<div>${SKILL_NAME[k]}<em>${d.skills[k].toFixed(1)}</em></div>`).join('')}</div>`;
        const ties = d.ties.filter(t => t.k);
        if (ties.length) h += `<div class="sec">People</div><div class="chips">${ties.map(t => `<span class="chip ${t.k === 'rival' ? 'b' : 'g'}">${t.k === 'friend' ? 'Friend' : t.k === 'rival' ? 'Rival' : cap1(t.k)}: ${esc(A.names[t.id] || '')}</span>`).join('')}</div>`;
        h += `<div class="sec">Memories</div>${d.mem.slice().reverse().map(m => `<div class="mm2"><em>${m.d ? 'Day ' + m.d : 'Before'}</em>${esc(m.m)}</div>`).join('')}`;
      }
      $('cBody').innerHTML = h;
    }
    const ms = $('cMove'), mSig = JSON.stringify([U.crews.map(c => [c.id, c.name, c.gone]), r[1]]);
    if (mSig !== this.moveSig && document.activeElement !== ms) {
      this.moveSig = mSig;
      ms.innerHTML = `<option value="-1">No crew</option>` + U.crews.filter(c => !c.gone).map(c => `<option value="${c.id}">${esc(c.name)} crew</option>`).join('');
      ms.value = String(r[1]);
    }
    ms.disabled = !!(flags & 16);
    card.hidden = false;
  }
}

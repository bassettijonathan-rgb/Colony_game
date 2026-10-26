// The Neighbours window (V): the settlements the colony knows of, the party in camp now, and trading with them.
// A bargain is put together here and only sent when the player offers it; the simulation decides whether they take it.
import { GOODS, GOOD_KEYS, valueOf } from '../core/nb.js';
import { DAY_TICKS, HOUR } from '../core/consts.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const cap1 = s => s.charAt(0).toUpperCase() + s.slice(1);
const list = a => a.length < 2 ? a.join('') : a.slice(0, -1).join(', ') + ' and ' + a[a.length - 1];
const gname = k => GOODS[k].name.toLowerCase();

export class NbPanel {
  constructor(api) { this.api = api; this.deal = { seq: -1, give: {}, get: {} }; this.msg = ''; }
  // the bargain on the table, cleared when a new party comes in
  table(P) { if (!P || this.deal.seq !== P.seq) { this.deal = { seq: P ? P.seq : -1, give: {}, get: {} }; this.msg = ''; } return this.deal; }
  render(U) {
    const N = U.nb; if (!N) return ['nb-none', () => '<div class="note">Nobody else is known on this world.</div>'];
    const P = N.party, D = this.table(P);
    return ['nb' + JSON.stringify([N.list, P, N.have, D, this.msg]), () => {
      let h = '';
      if (!N.list.length && !P) return '<div class="note" style="margin-top:0">Nobody else is known on this world. The orbital survey saw no settlement within reach of the landing, but it only covered the ground around it.</div>';
      if (P) h += this.party(U, N, P, D);
      if (N.list.length) h += `<div class="sec">Settlements</div>` + N.list.map(q => this.place(q, P)).join('');
      return h;
    }];
  }
  party(U, N, P, D) {
    const q = N.list.find(o => o.i === P.i), place = q ? q.place : 'another settlement';
    const leave = P.st === 'come' ? 'walking in' : P.st === 'go' ? 'walking home' : `in camp until about ${hourOf(P.until)} tomorrow`;
    let h = `<div class="box nbp"><b>${P.kind === 'meet' ? 'Visitors' : 'Traders'} from ${esc(place)}</b> <span class="note" style="margin:0">· ${leave}</span>
      <div class="chips" style="margin-top:6px">${P.people.map(p => `<span class="chip"><i class="dot" style="background:rgb(${p.coat.join(',')})"></i>${esc(p.name)}${p.lead ? ' · speaks for them' : ''}</span>`).join('')}</div>`;
    if (P.ask) h += `<div class="ask"><b>${esc(P.ask)} asks to stay.</b> If you say yes, they join the colony as one of its own, and the Seed puts them in a crew.<div class="row2"><button class="btn go" data-act="nbjoin" data-v="1">Let them stay</button><button class="btn" data-act="nbjoin" data-v="0">Not now</button></div></div>`;
    if (P.kind === 'meet') h += `<div class="note">They came to see who has landed. Next time they will bring things to trade.</div>`;
    h += '</div>';
    if (P.kind !== 'trade' || P.st !== 'stay') return h;
    // the bargain
    const K = { wants: P.wants, fair: P.fair }, know = Object.fromEntries(P.lessons.map(l => [l.id, l.v]));
    const v = valueOf(K, P.trust, D.give, D.get, know), have = N.have;
    const row = (side, k, max, note) => { const n = D[side][k] || 0; return `<div class="trow${n ? ' on' : ''}"><span>${esc(GOODS[k].name)}<small>${note}</small></span><span class="step"><button data-act="nbq" data-s="${side}" data-k="${k}" data-d="-10">−10</button><button data-act="nbq" data-s="${side}" data-k="${k}" data-d="-1">−</button><em>${n}</em><button data-act="nbq" data-s="${side}" data-k="${k}" data-d="1">+</button><button data-act="nbq" data-s="${side}" data-k="${k}" data-d="10">+10</button></span></div>`; };
    const theirs = Object.keys(P.goods).filter(k => P.goods[k] > 0);
    h += `<div class="sec">What they have</div>`;
    h += theirs.length ? theirs.map(k => row('get', k, P.goods[k], `${P.goods[k]} ${GOODS[k].unit}`)).join('') : '<div class="note">Nothing left to trade.</div>';
    if (P.lessons.length) h += `<div class="sec">What they can teach</div>` + P.lessons.map(l => `<label class="trow lk${D.get[l.id] ? ' on' : ''}"><input type="checkbox" data-act="nbk" data-k="${l.id}"${D.get[l.id] ? ' checked' : ''}><span>${esc(l.name)}<small>worth ${l.v} meals to them</small></span></label>`).join('');
    const ours = GOOD_KEYS.filter(k => have[k] > 0);
    const val = k => { const w = P.wants[k] ?? 1; return w >= 1.3 ? 'they want this' : w < .6 ? 'of little use to them' : ''; };
    h += `<div class="sec">What the colony gives</div>` + (ours.length ? ours.map(k => row('give', k, have[k], `${have[k]} in store${val(k) ? ' · ' + val(k) : ''}`)).join('') : '<div class="note">The colony has nothing to give.</div>');
    const asked = Object.keys(D.get).length, gave = Object.keys(D.give).length, short = Math.max(0, v.need - v.have);
    const verdict = !asked && !gave ? 'Put together a bargain: what you want from them, and what the colony gives.' : v.gift ? 'A gift: nothing asked back. They will remember it.' : v.ok ? `They would take this.${v.have > v.need * 1.4 ? ' The colony is giving a lot more than it needs to.' : ''}` : `They want more: about ${Math.ceil(short)} meals’ worth.`;
    h += `<div class="deal"><div class="bar"><u style="width:${Math.min(100, v.need ? v.have / v.need * 100 : v.have ? 100 : 0)}%" class="${v.ok ? 'ok' : ''}"></u></div><div class="note" style="margin:4px 0 6px">${esc(verdict)}${this.msg ? ` <b>${esc(this.msg)}</b>` : ''}</div>
      <div class="row2"><button class="btn go" data-act="nboffer"${!asked && !gave ? ' disabled' : ''}>${v.gift ? 'Give it' : 'Offer it'}</button><button class="btn" data-act="nbclear">Clear</button></div>
      <div class="note">Goods are valued in meals. The more they trust the colony, the less extra they ask for, and goods they want are worth more to them.</div></div>`;
    return h;
  }
  place(q, P) {
    const here = P && P.i === q.i, bar = Math.round((q.trust + 100) / 2);
    return `<div class="box"><b>${esc(q.place)}</b>${here ? ' <span class="chip g">in camp</span>' : ''}
      <div class="note" style="margin:2px 0 4px">${esc(cap1(q.folk))}: about ${q.pop} people, ${q.km} km to the ${q.dir}, by their own account.</div>
      <div class="sup"><div class="bar"><u style="width:${bar}%"></u></div><span>${esc(cap1(q.word))}.</span></div>
      <div class="note">Met on day ${q.met}; ${q.visits} visit${q.visits === 1 ? '' : 's'}, ${q.trades} trade${q.trades === 1 ? '' : 's'}${q.joined ? `, ${q.joined} stayed` : ''}. They bring ${list(q.offers.map(gname))}${q.wants.length ? `, and want ${list(q.wants.slice(0, 4).map(gname))} most` : ''}.${q.taught ? ` They have taught the colony ${q.taught} thing${q.taught === 1 ? '' : 's'}.` : ''}${q.left ? ` They know ${q.left} more about this land that the colony doesn’t.` : ''}</div></div>`;
  }
  // clicks inside the window
  click(el, U) {
    const P = U.nb && U.nb.party, D = this.deal, act = el.dataset.act;
    if (act === 'nbq' && P) {
      const s = el.dataset.s, k = el.dataset.k, max = s === 'get' ? P.goods[k] || 0 : U.nb.have[k] || 0;
      const n = Math.max(0, Math.min(max, (D[s][k] || 0) + +el.dataset.d)); if (n) D[s][k] = n; else delete D[s][k]; this.msg = ''; return true;
    }
    if (act === 'nbk') { const k = el.dataset.k; if (el.checked) D.get[k] = 1; else delete D.get[k]; this.msg = ''; return true; }
    if (act === 'nbclear') { D.give = {}; D.get = {}; this.msg = ''; return true; }
    if (act === 'nboffer') { this.api.cmd('trade', { give: D.give, get: D.get }).then(r => { if (r && r.ok) { D.give = {}; D.get = {}; this.msg = ''; this.api.toast('They took it.'); } else this.msg = r && r.why || 'They said no.'; this.api.refresh(); }); return true; }
    if (act === 'nbjoin') { this.api.cmd('join', { yes: el.dataset.v === '1' }); return true; }
    return false;
  }
}
const hourOf = t => { const h = (t % DAY_TICKS) / HOUR; return `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.floor((h % 1) * 60)).padStart(2, '0')}`; };

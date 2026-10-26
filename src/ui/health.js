// The Health tab of a person's card: the medic's view of their body. Only what the colony knows is shown: a
// wound nobody has found is not here, though blood lost from it shows as "losing blood, cause not found", and an
// illness nobody has named shows only as its symptoms.
import { CAPS, CAP_NAME, PARTS, PART } from '../core/body.js';
import { DAY_TICKS, HOUR } from '../core/consts.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
const cap1 = s => s.charAt(0).toUpperCase() + s.slice(1);
const pad = n => String(n).padStart(2, '0');
const when = t => { const d = Math.floor(t / DAY_TICKS) + 1, h = (t % DAY_TICKS) / HOUR; return `day ${d}, ${pad(Math.floor(h))}:${pad(Math.floor((h % 1) * 60))}`; };
const col = v => v > .7 ? 'var(--bad)' : v > .35 ? 'var(--mid)' : v > .02 ? 'var(--good)' : '';
const harmCol = v => v >= .6 ? '#e0564f' : v >= .3 ? '#e8924e' : v > .02 ? '#e6c35c' : '';

// how hurt each part looks from outside, 0 to 1
function harm(B) {
  const h = new Array(PARTS.length).fill(0);
  for (const w of B.w) h[w.p] += w.s * (1 - w.heal) * (w.k === 'frac' && !w.set ? 1.6 : .8);
  for (const w of B.inner) h[w.p] += .5;
  for (const m of B.marks) if (m.k !== 'age' && !m.sub) h[m.p] += m.loss;   // the years are not an injury
  return h.map(v => Math.min(1, v));
}
// the body from the front, its parts coloured by how hurt they are; hover a part for its name
function figure(B) {
  const h = harm(B), base = 'rgba(255,255,255,.07)', line = 'rgba(255,255,255,.28)';
  const f = k => harmCol(h[PART[k]]) || base, t = k => `<title>${esc(PARTS[PART[k]].label || cap1(PARTS[PART[k]].name))}</title>`;
  const skin = h[PART.skin] > .02 ? harmCol(h[PART.skin]) : line;
  return `<svg class="fig" viewBox="0 0 100 180" aria-label="Body">
  <g stroke="${skin}" stroke-width="${h[PART.skin] > .02 ? 2.2 : 1}">
    <circle cx="50" cy="20" r="14" fill="${f('head')}">${t('head')}</circle>
    <path d="M30 40 Q50 34 70 40 L72 98 Q50 104 28 98 Z" fill="${f('torso')}">${t('torso')}</path>
    <path d="M28 42 Q20 44 17 56 L12 92 L20 93 L25 62 Z" fill="${f('armR')}">${t('armR')}</path>
    <path d="M72 42 Q80 44 83 56 L88 92 L80 93 L75 62 Z" fill="${f('armL')}">${t('armL')}</path>
    <ellipse cx="15" cy="101" rx="6" ry="8" fill="${f('handR')}">${t('handR')}</ellipse>
    <ellipse cx="85" cy="101" rx="6" ry="8" fill="${f('handL')}">${t('handL')}</ellipse>
    <path d="M30 100 Q40 103 49 102 L47 170 L36 170 Z" fill="${f('legR')}">${t('legR')}</path>
    <path d="M70 100 Q60 103 51 102 L53 170 L64 170 Z" fill="${f('legL')}">${t('legL')}</path>
  </g>
  <g stroke="${line}" stroke-width="1">
    <circle cx="44" cy="18" r="3" fill="${f('eyeR')}">${t('eyeR')}</circle>
    <circle cx="56" cy="18" r="3" fill="${f('eyeL')}">${t('eyeL')}</circle>
    <ellipse cx="50" cy="56" rx="13" ry="10" fill="${f('chest')}">${t('chest')}</ellipse>
    <ellipse cx="50" cy="82" rx="12" ry="9" fill="${f('gut')}">${t('gut')}</ellipse>
    <rect x="48.5" y="40" width="3" height="58" rx="1.5" fill="${f('spine')}" opacity=".9">${t('spine')}</rect>
  </g></svg>`;
}
// a wound's state, as a few chips
function state(w) {
  const c = [];
  if (w.bl) c.push(['b', 'Bleeding']);
  if (w.inf) c.push(['b', w.inf > .8 ? 'Badly infected' : 'Infected']);
  if (w.k === 'frac') c.push(w.set === 1 ? ['g', 'Set'] : w.set === -1 ? ['m', 'Set, not straight'] : ['b', 'Not set']);
  else if (w.k === 'burn' || w.k === 'frost') c.push(w.closed ? ['g', 'Dressed'] : ['m', 'Not dressed']);
  else if (w.closed) c.push(['g', 'Closed']);
  else if (w.k !== 'crush') c.push(['m', 'Open']);
  else if (w.s > .25) c.push(['m', 'Not treated']);
  c.push(['', `${Math.round(w.heal * 100)}% healed`]);
  return c.map(([k, s]) => `<span class="chip ${k}">${s}</span>`).join('');
}

const STAGE = ['', 'Sick', 'Crisis', 'Recovering'];
// an illness as the colony sees it: named once a medic has, otherwise only what anyone can see
function illness(q) {
  const c = [[q.st === 2 ? 'b' : q.st === 3 ? 'g' : 'm', STAGE[q.st]]];
  if (q.catching) c.push(['b', 'Catching']);
  if (q.kn) c.push(q.abx ? ['g', 'Antibiotics work'] : ['m', 'Antibiotics don’t help']);
  else if (q.tried) c.push(['', 'Antibiotics tried']);
  return `<div class="wd"><b>${esc(q.kn ? q.name : 'An illness nobody has named')}</b><div class="sub">${esc(q.sym)}. Since day ${q.d}.${q.kn ? '' : ' A medic’s examination may name it.'}</div><div class="chips">${c.map(([k, t]) => `<span class="chip ${k}">${t}</span>`).join('')}</div></div>`;
}
// the whole tab; B is the sim's body report, name the person's first name
export function healthTab(B, name, dead) {
  if (!B) return '<div class="note">Nothing to report.</div>';
  const L = B.life;
  const ill = B.ill || [], hurt = B.w.length || B.inner.length, crisis = ill.some(q => q.st === 2);
  const d = B.danger, how = dead ? 'Dead.' : B.danger >= .75 ? 'In grave danger.' : B.danger >= .45 ? (crisis && !hurt ? 'Gravely ill.' : 'In danger.') : ill.length && !hurt ? (ill.every(q => q.st === 3) ? 'Getting better.' : 'Sick.') : B.danger >= .2 ? 'Hurt, but not in danger.' : hurt ? 'Mending.' : L && L.ch.some(q => q.s >= .6) ? 'Living with a serious condition.' : L && L.ch.length ? 'In fair health.' : 'Healthy.';
  const where = B.down ? ` ${name} is down and can't get up.` : B.iso ? ' Kept apart from everyone while it passes.' : B.laid ? ` Laid up resting.` : '';
  const by = B.by ? ` ${esc(B.by)} is looking after them.` : '';
  let h = `<div class="hsum" style="--c:${col(d) || 'var(--good)'}"><b>${how}</b>${B.worse && !dead ? ' <em>Getting worse.</em>' : ''}${where}${by}</div>`;
  const bar = (lbl, v, tip, txt) => `<span title="${tip}">${lbl}</span><b><u style="width:${Math.round(Math.min(1, v) * 100)}%;background:${col(Math.min(1, v)) || 'var(--good)'}"></u></b><em>${txt}</em>`;
  const lost = 1 - B.blood;
  h += `<div class="hrow">${figure(B)}<div class="meters hm">${bar('Blood lost', lost * 2, 'Below half their blood, a person dies', Math.round(lost * 100) + '%')}${bar('Pain', B.pain / 1.3, 'Bad pain slows everything and can put them down', B.pain > 1.25 ? 'agony' : B.pain > .8 ? 'severe' : B.pain > .4 ? 'bad' : B.pain > .1 ? 'mild' : 'none')}${bar('Shock', B.shock, 'Shock comes from blood loss, pain and cold; at full it kills', Math.round(B.shock * 100))}${B.inf > .05 ? bar('Infection', B.inf / 1.3, 'Dirty wounds go bad; antibiotics fight it', Math.round(B.inf * 100)) : ''}</div></div>`;
  if (B.caps) h += `<div class="sec">What they can do</div><div class="skills caps">${CAPS.map(k => { const v = B.caps[k]; return `<div${v < .7 ? ' class="low"' : ''}>${CAP_NAME[k]}<em>${Math.round(v * 100)}%</em></div>`; }).join('')}</div>`;
  if (B.w.length || B.inner.length || B.unexplained) {
    h += `<div class="sec">Wounds</div>`;
    for (const w of B.inner) h += `<div class="wd"><b>${esc(w.text)}</b><div class="chips"><span class="chip b">Needs an operation</span></div></div>`;
    if (B.unexplained) h += `<div class="wd"><b>Losing blood, cause not found</b><div class="sub">Something is bleeding that nobody has found yet. A medic's examination may find it.</div></div>`;
    for (const w of B.w) h += `<div class="wd"><b>${esc(w.text)}</b><div class="sub">${esc(cap1(w.how || 'how, nobody knows'))}, day ${w.d}.</div><div class="chips">${state(w)}</div></div>`;
  }
  if (ill.length) h += `<div class="sec">Illness</div>${ill.map(illness).join('')}`;
  const lasting = B.marks.filter(m => m.k !== 'age' && m.k !== 'chronic');
  if (lasting.length) h += `<div class="sec">Lasting marks</div>${lasting.map(m => `<div class="wd"><b>${esc(m.what)}</b><div class="sub">${esc(cap1(m.how || ''))}${m.how ? ', ' : ''}day ${m.d}.${m.loss ? ` It costs them ${Math.round(m.loss * 100)}% of the ${esc(PARTS[m.p].name)}.` : ''}${m.pain ? ' It still aches.' : ''}${m.k === 'printed' && L && L.adj > 0 ? ' Still settling in.' : ''}</div>${m.k === 'lost' && !dead ? repl(B, m.i, 'Print a replacement') : ''}</div>`).join('')}`;
  if (L) h += lifeSec(B, L, dead);
  if (B.ex) h += `<div class="note" style="margin-top:10px">Last examined by ${esc(B.ex.by)}, ${when(B.ex.t)}. A medic that skilled would find a hidden injury about ${B.ex.conf}% of the time.</div>`;
  else if (B.w.length || ill.some(q => q.st < 3)) h += `<div class="note" style="margin-top:10px">Nobody has examined them yet.</div>`;
  if (B.hx && B.hx.length) h += `<div class="sec">Illnesses before</div>${B.hx.slice().reverse().map(x => `<div class="wd"><b>${esc(x.name || 'An illness nobody named')}</b><div class="sub">${x.name ? '' : esc(x.sym) + '. '}Day ${x.d} to day ${x.e}: ${x.out === 'died' ? 'it killed them' : 'got over it'}.</div></div>`).join('')}`;
  if (B.imm && B.imm.length) h += `<div class="note" style="margin-top:8px">${B.imm.map(m => m.v > 0 ? `Some resistance to ${esc(m.name.toLowerCase())}.` : `Their body now overreacts to ${esc(m.name.toLowerCase())}: each case comes on faster and harder.`).join(' ')}</div>`;
  if (B.pk || B.abx || B.nu) h += `<div class="chips" style="margin-top:8px">${B.pk ? '<span class="chip">On painkillers</span>' : ''}${B.abx ? '<span class="chip">On antibiotics</span>' : ''}${B.nu ? '<span class="chip">Being nursed</span>' : ''}</div>`;
  return h;
}

// a button to have the Seed print a replacement, or why it can't yet
const repl = (B, i, label) => B.repl ? `<div class="sub" style="margin-top:4px">A printed replacement: ${esc(B.repl.toLowerCase())}.</div>` : `<button class="btn" data-repl="${i}" style="margin-top:6px" title="Uses a body's worth of feedstock from the fabricator">${label}</button>`;
const SEV = s => s >= .85 ? ['b', 'Grave'] : s >= .6 ? ['b', 'Severe'] : s >= .3 ? ['m', 'Moderate'] : ['', 'Mild'];
const SLOW = [['rad', 'Radiation dose', 'Time under this sun, more in storms; it raises the risk of growths'], ['diet', 'Diet load', 'What food the colony has not fully worked out leaves in the liver and kidneys'], ['joint', 'Wear on joints', 'Years of hauling, cutting and digging'], ['lung', 'Dust and smoke', 'Rock dust from quarrying and digging, smoke from cooking and fires'], ['sleep', 'Sleep debt', 'Short nights and nights on the ground; it weakens them against infection and slows healing']];
// the long view: age, conditions, flaws from the print, and the totals as last measured
function lifeSec(B, L, dead) {
  let h = '';
  if (L.age || L.ch.length || L.fl.length) {
    h += `<div class="sec">Over the years</div>`;
    if (L.age) h += `<div class="note" style="margin:0 0 6px">The body is slowing with age: about ${L.age}% off their legs, a little less off hands, heart and lungs, and eyes.</div>`;
    for (const q of L.ch) {
      const [k, t] = SEV(q.s), chips = [`<span class="chip ${k}">${t}</span>`];
      if (q.kn && q.ck === 'growth') chips.push(q.s < .6 ? '<span class="chip g">Small enough to cut out</span>' : '<span class="chip b">Too big to cut out</span>');
      h += `<div class="wd"><b>${esc(q.kn ? q.name : 'Something nobody has named')}</b><div class="sub">${esc(q.sym)}. Since about day ${q.d}.${q.kn ? '' : ' A check-up at the clinic may find what it is.'}</div><div class="chips">${chips.join('')}</div>${q.kn && !dead && (q.ck === 'kidney' || q.ck === 'heart') && q.s >= .3 ? repl(B, q.i, q.ck === 'heart' ? 'Print a new heart' : 'Print new kidneys') : ''}</div>`;
    }
    for (const f of L.fl) h += `<div class="wd"><b>${esc(f.name)}</b><div class="sub">${esc(cap1(f.note))}, found at a check-up.</div></div>`;
  }
  if (L.seen) {
    const S0 = L.seen.sl;
    h += `<div class="sec">Measured at a check-up</div><div class="meters hm">${SLOW.map(([k, n, tip]) => { const v = k === 'sleep' ? S0[k] / 40 : S0[k]; return `<span title="${esc(tip)}">${n}</span><b><u style="width:${Math.round(Math.min(1, v) * 100)}%;background:${col(Math.min(1, v)) || 'var(--good)'}"></u></b><em>${k === 'sleep' ? Math.round(S0[k]) + ' h' : Math.round(v * 100)}</em>`; }).join('')}</div>`;
    h += `<div class="note" style="margin-top:4px">By ${esc(L.seen.by)} on day ${L.seen.d}. The totals only ever grow, except sleep debt, which good nights pay back. A medic that skilled finds a hidden condition about ${L.seen.conf}% of the time.</div>`;
  } else if (!dead) h += `<div class="note" style="margin-top:10px">No check-up yet. With a working clinic and someone in a clinic crew, the clinic calls everyone in every ${40} days.</div>`;
  return h;
}

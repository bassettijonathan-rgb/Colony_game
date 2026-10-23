// The Stats window (T): the colony's record day by day, drawn as charts, with the totals since landing.
// Each chart is a canvas with one y-axis; hovering shows a crosshair and that day's values.
import { HIST_KEYS } from '../core/history.js';
import { YEAR_DAYS, SEASON_DAYS } from '../core/consts.js';

const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const K = Object.fromEntries(HIST_KEYS.map((k, i) => [k, i]));
// four categorical slots, stepped for a dark surface and checked for colour-blind separation on the panel
const C = ['#3987e5', '#d95926', '#199e70', '#c98500'];
const SEAS = ['Thaw', 'Long light', 'Storm', 'Deep cold'];
const SEAS_TINT = ['rgba(120,200,140,.05)', 'rgba(240,200,110,.05)', 'rgba(200,140,90,.06)', 'rgba(150,190,255,.08)'];
const RANGES = [['20', 'Last 20 days'], ['80', 'Last year'], ['all', 'Everything']];

// what each chart shows: per-day amounts come from running totals
const CHARTS = [
  { id: 'people', title: 'People', unit: 'people', series: [['Awake', r => r[K.alive]], ['Hungry', r => r[K.hungry]], ['Unwell', r => r[K.unwell]]], int: true },
  { id: 'food', title: 'Food in store', unit: 'meals', series: [['Lander rations', r => r[K.rations]], ['Food from this world', r => Math.max(0, r[K.meals] - r[K.rations])]], int: true },
  { id: 'fdays', title: 'Days of food', unit: 'days', series: [['Days of food', r => r[K.alive] ? r[K.meals] / r[K.alive] : 0]], warn: 10 },
  { id: 'gather', title: 'Food brought in, per day', unit: 'loads', bars: true, series: [['Loads foraged', (r, p) => r[K.foraged] - (p ? p[K.foraged] : 0)], ['Harvests', (r, p) => r[K.harvests] - (p ? p[K.harvests] : 0)]], int: true },
  { id: 'cooked', title: 'Meals cooked, per day', unit: 'meals', bars: true, series: [['Meals cooked', (r, p) => r[K.cooked] - (p ? p[K.cooked] : 0)]], int: true },
  { id: 'minds', title: 'How people are, on average', unit: '0 to 100', max: 100, series: [['Fatigue', r => r[K.fat]], ['Strain', r => r[K.str]], ['Trust', r => r[K.tru]], ['Health', r => r[K.hp]]], int: true },
  { id: 'temp', title: 'Temperature', unit: '°C', zero: true, series: [['Low', r => r[K.tmin]], ['High', r => r[K.tmax]]], fmt: v => `${v.toFixed(1)}°` },
  { id: 'chill', title: 'Cold, at its worst each day', unit: '0 to 100', max: 100, series: [['Average cold', r => r[K.chill]]], warn: 65, int: true },
  { id: 'stores', title: 'Building stock in the yard', unit: 'loads', series: [['Stone', r => r[K.stone]], ['Timber', r => r[K.timber]]], int: true },
  { id: 'power', title: 'Power', unit: 'kW', series: [['Made', r => r[K.supply]], ['Used', r => r[K.draw]]], fmt: v => `${+v.toFixed(1)} kW` },
  { id: 'known', title: 'Ground surveyed', unit: '% of the map', series: [['Surveyed', r => r[K.known]]], fmt: v => `${v.toFixed(1)}%` },
  { id: 'life', title: 'Local life', unit: 'kinds', series: [['Found', r => r[K.seen]], ['Tested', r => r[K.tested]]], int: true },
];
const TOTALS = [['meals', 'Meals cooked'], ['foraged', 'Loads foraged'], ['harvests', 'Harvests'], ['felled', 'Trees felled'], ['quarried', 'Stone cut'], ['made', 'Parts made'], ['friends', 'Friendships'], ['rivals', 'Rivalries'], ['breakdowns', 'Breakdowns'], ['accidents', 'Accidents'], ['cold', 'Dangerously cold'], ['deaths', 'Deaths']];

// a round step for the y-axis (whole numbers for counts), and the axis ends on whole steps
function axis(lo0, hi0, whole) {
  const raw = Math.max(hi0 - lo0, whole ? 4 : 1e-6) / 4, e = Math.pow(10, Math.floor(Math.log10(raw))), f = raw / e;
  let step = (f <= 1 ? 1 : f <= 2 ? 2 : f <= 2.5 && !(whole && e === 1) ? 2.5 : f <= 5 ? 5 : 10) * e;
  if (whole) step = Math.max(1, Math.round(step));
  const lo = Math.floor(lo0 / step) * step; let hi = Math.ceil(hi0 / step) * step; if (hi <= lo) hi = lo + step;
  return { lo, hi, step };
}

export class Stats {
  constructor(A) {
    this.A = A; this.range = 'all'; this.sig = ''; this.hover = null; this.charts = [];
    $('stX').onclick = () => this.show(false);
    $('stRange').onclick = e => { const b = e.target.closest('[data-r]'); if (b) { this.range = b.dataset.r; this.sig = ''; this.update(); } };
    const body = $('stBody');
    body.addEventListener('pointermove', e => this.move(e));
    body.addEventListener('scroll', () => { if (this.hover) { this.hover = null; $('stTip').hidden = true; this.redraw(); } });
    body.addEventListener('pointerleave', () => { this.hover = null; $('stTip').hidden = true; this.redraw(); });
    window.addEventListener('resize', () => { if (this.open) { this.sig = ''; this.update(); } });
  }
  get open() { return !$('stats').hidden; }
  show(on = !this.open) { $('stats').hidden = !on; $('bStats') && $('bStats').classList.toggle('on', on); if (on) { this.sig = ''; this.update(); } else $('stTip').hidden = true; }

  // the rows to draw: the record so far, then today as it stands
  rows() {
    const A = this.A, all = (A.hist || []).slice(), U = A.ui;
    if (U && U.today && (!all.length || all[all.length - 1][K.day] !== U.today[K.day])) all.push(U.today);
    return all;
  }
  update() {
    if (!this.open || !this.A.ui) return;
    const U = this.A.ui, rows = this.rows(), n = this.range === 'all' ? rows.length : +this.range, from = Math.max(0, rows.length - n), shown = rows.slice(from), prev = from > 0 ? rows[from - 1] : null;
    document.querySelectorAll('#stRange [data-r]').forEach(b => b.classList.toggle('on', b.dataset.r === this.range));
    const sig = JSON.stringify([this.range, rows.length, rows[rows.length - 1], U.stats, $('stBody').clientWidth]);
    if (sig === this.sig) return;
    this.sig = sig;
    const today = rows[rows.length - 1], first = U.mode === 'stress';
    // headline numbers
    const t = today || [], doy = ((t[K.day] - 1) % YEAR_DAYS) + 1, yr = Math.floor((t[K.day] - 1) / YEAR_DAYS) + 1;
    const tile = (lbl, v, sub) => `<div class="stt"><em>${lbl}</em><b>${v}</b><span>${sub || ''}</span></div>`;
    let h = `<div class="sttiles">` +
      tile('Days since landing', t[K.day] || 1, `Year ${yr || 1} · ${SEAS[Math.floor((doy - 1) / SEASON_DAYS)] || SEAS[0]}`) +
      tile('People awake', t[K.alive] ?? U.alive, `${U.stats.deaths || 0} ${U.stats.deaths === 1 ? 'death' : 'deaths'}`) +
      (first ? '' : tile('Days of food', t[K.alive] ? Math.floor(t[K.meals] / t[K.alive]) : 0, `${Math.floor(t[K.meals] || 0)} meals`)) +
      tile('Buildings finished', t[K.built] ?? 0, '') +
      tile('Ground surveyed', `${(t[K.known] || 0).toFixed(1)}%`, '') +
      tile('Local life', `${t[K.seen] || 0}`, `${t[K.tested] || 0} tested`) + `</div>`;
    if (shown.length < 2) h += `<div class="note" style="margin:4px 2px 12px">The charts fill in day by day: each midnight adds a point. Today so far is the last point.</div>`;
    // the charts
    this.charts = CHARTS.filter(c => !(first && (c.id === 'food' || c.id === 'fdays' || c.id === 'gather' || c.id === 'cooked'))).map(c => ({ ...c, data: shown.map((r, i) => c.series.map(([, f]) => +f(r, i ? shown[i - 1] : prev) || 0)), days: shown.map(r => r[K.day]), live: !!(U.today && shown.length && shown[shown.length - 1] === U.today) }));
    h += `<div class="stgrid">` + this.charts.map((c, i) => `<div class="stc"><div class="sth"><b>${esc(c.title)}</b><em>${esc(c.unit)}</em></div>` +
      (c.series.length > 1 ? `<div class="stleg">${c.series.map(([nm], j) => `<span><i style="background:${C[j]}"></i>${esc(nm)}</span>`).join('')}</div>` : '') +
      `<canvas data-c="${i}"></canvas></div>`).join('') + `</div>`;
    // totals
    const S = U.stats;
    h += `<div class="sec">Since landing</div><div class="sttot">${TOTALS.map(([k, l]) => `<div><span>${l}</span><b>${S[k] || 0}</b></div>`).join('')}</div>`;
    // the same numbers as a table, for reading exact values
    h += `<details class="sttab"><summary>All days as a table</summary><div class="sttw"><table><thead><tr><th>Day</th>${this.charts.flatMap(c => c.series.map(([nm]) => `<th>${esc(nm)}</th>`)).join('')}</tr></thead><tbody>` +
      shown.map((r, i) => `<tr><td>${r[K.day]}${U.today && r === U.today ? ' (today)' : ''}</td>${this.charts.flatMap(c => c.data[i].map(v => `<td>${this.fmt(c, v)}</td>`)).join('')}</tr>`).reverse().join('') + `</tbody></table></div></details>`;
    const body = $('stBody'), top = body.scrollTop, open = body.querySelector('details') && body.querySelector('details').open;
    body.innerHTML = h; body.scrollTop = top; if (open) body.querySelector('details').open = true;
    this.redraw();
  }
  fmt(c, v) { return c.fmt ? c.fmt(v) : c.int ? String(Math.round(v)) : v.toFixed(1); }
  redraw() { document.querySelectorAll('#stBody canvas').forEach(cv => this.draw(cv, this.charts[+cv.dataset.c])); }

  draw(cv, c) {
    if (!c) return;
    const dpr = window.devicePixelRatio || 1, W = cv.clientWidth, H = 150;
    if (cv.width !== Math.round(W * dpr)) { cv.width = Math.round(W * dpr); cv.height = Math.round(H * dpr); }
    const g = cv.getContext('2d'); g.setTransform(dpr, 0, 0, dpr, 0, 0); g.clearRect(0, 0, W, H);
    const n = c.days.length; if (!n) return;
    const all = c.data.flat(), lo0 = Math.min(0, ...all), hi0 = Math.max(...all, c.warn || 0);
    const ax = c.max ? { lo: 0, hi: c.max, step: c.max / 4 } : axis(lo0, hi0, c.int || c.bars), lo = ax.lo, hi = ax.hi;
    const L = 34, R = 8, T = 16, B = 20, pw = W - L - R, ph = H - T - B;
    const X = i => c.bars ? L + (i + .5) * pw / n : L + (n === 1 ? pw / 2 : i / (n - 1) * pw), Y = v => T + ph - (v - lo) / (hi - lo || 1) * ph;
    // the seasons behind the chart
    g.font = '600 9.5px Manrope,system-ui,sans-serif'; g.textBaseline = 'top';
    let s0 = 0;
    for (let i = 1; i <= n; i++) {
      const si = d => Math.floor((((d - 1) % YEAR_DAYS)) / SEASON_DAYS), s = si(c.days[s0]);
      if (i < n && si(c.days[i]) === s) continue;
      const x0 = c.bars ? L + s0 * pw / n : n === 1 ? L : X(s0) - (s0 ? pw / (n - 1) / 2 : 0), x1 = c.bars ? L + i * pw / n : n === 1 ? L + pw : X(i - 1) + (i < n ? pw / (n - 1) / 2 : 0);
      g.fillStyle = SEAS_TINT[s]; g.fillRect(x0, T, x1 - x0, ph);
      if (x1 - x0 > 52) { g.fillStyle = 'rgba(154,165,182,.55)'; g.textAlign = 'left'; g.fillText(SEAS[s], x0 + 4, 2); }
      s0 = i;
    }
    // grid and y labels
    g.textBaseline = 'middle'; g.textAlign = 'right'; g.font = '500 10px "JetBrains Mono",ui-monospace,monospace';
    for (let v = lo; v <= hi + ax.step * .01; v += ax.step) {
      const y = Y(v);
      g.strokeStyle = 'rgba(255,255,255,.06)'; g.lineWidth = 1; g.beginPath(); g.moveTo(L, Math.round(y) + .5); g.lineTo(W - R, Math.round(y) + .5); g.stroke();
      g.fillStyle = '#6b7486'; g.fillText(+v.toFixed(ax.step < 1 ? 1 : 0), L - 5, y);
    }
    if (c.zero && lo < 0) { g.strokeStyle = 'rgba(255,255,255,.22)'; g.beginPath(); g.moveTo(L, Math.round(Y(0)) + .5); g.lineTo(W - R, Math.round(Y(0)) + .5); g.stroke(); }
    if (c.warn) { g.strokeStyle = 'rgba(238,107,95,.45)'; g.setLineDash([3, 3]); g.beginPath(); g.moveTo(L, Math.round(Y(c.warn)) + .5); g.lineTo(W - R, Math.round(Y(c.warn)) + .5); g.stroke(); g.setLineDash([]); }
    // x labels: a few day numbers
    g.textAlign = 'center'; g.textBaseline = 'top'; g.fillStyle = '#6b7486';
    const step = Math.max(1, Math.ceil(n / Math.max(2, Math.floor(pw / 70))));
    for (let i = 0; i < n; i += step) g.fillText(`Day ${c.days[i]}`, Math.min(W - R - 22, Math.max(L + 22, X(i))), H - B + 5);
    // the marks
    const m = c.series.length;
    if (c.bars) {
      const bw = Math.max(1, pw / n / m - 2);
      for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) {
        const v = c.data[i][j]; if (v <= 0) continue;
        const x = L + i * pw / n + (pw / n - (bw + 2) * m) / 2 + j * (bw + 2) + 1, y = Y(v), r = Math.min(2, bw / 2);
        g.fillStyle = C[j]; g.globalAlpha = c.live && i === n - 1 ? .55 : 1; g.beginPath(); g.roundRect(x, y, bw, Y(0) - y, [r, r, 0, 0]); g.fill(); g.globalAlpha = 1;
      }
    } else {
      for (let j = 0; j < m; j++) {
        g.strokeStyle = C[j]; g.lineWidth = 2; g.lineJoin = 'round'; g.lineCap = 'round';
        const end = c.live && n > 1 ? n - 1 : n;
        g.beginPath(); for (let i = 0; i < end; i++) { const x = X(i), y = Y(c.data[i][j]); i ? g.lineTo(x, y) : g.moveTo(x, y); } g.stroke();
        if (c.live && n > 1) { g.setLineDash([3, 3]); g.beginPath(); g.moveTo(X(n - 2), Y(c.data[n - 2][j])); g.lineTo(X(n - 1), Y(c.data[n - 1][j])); g.stroke(); g.setLineDash([]); }
        if (n === 1) { g.fillStyle = C[j]; g.beginPath(); g.arc(X(0), Y(c.data[0][j]), 4, 0, 6.3); g.fill(); }
      }
    }
    // the hovered day
    const hv = this.hover;
    if (hv && hv.cv === cv && hv.i < n) {
      const x = X(hv.i);
      g.strokeStyle = 'rgba(238,241,246,.35)'; g.lineWidth = 1; g.beginPath(); g.moveTo(Math.round(x) + .5, T); g.lineTo(Math.round(x) + .5, T + ph); g.stroke();
      if (!c.bars) for (let j = 0; j < m; j++) { const y = Y(c.data[hv.i][j]); g.fillStyle = '#141a24'; g.beginPath(); g.arc(x, y, 5.5, 0, 6.3); g.fill(); g.fillStyle = C[j]; g.beginPath(); g.arc(x, y, 4, 0, 6.3); g.fill(); }
    }
    cv.style.height = H + 'px';
    c.geo = { L, R, pw, n, bars: c.bars };
  }
  move(e) {
    const cv = e.target.closest && e.target.closest('canvas'), tip = $('stTip');
    if (!cv) { if (this.hover) { this.hover = null; tip.hidden = true; this.redraw(); } return; }
    const c = this.charts[+cv.dataset.c]; if (!c || !c.geo) return;
    const r = cv.getBoundingClientRect(), x = e.clientX - r.left, { L, pw, n, bars } = c.geo;
    const i = Math.max(0, Math.min(n - 1, bars ? Math.floor((x - L) / pw * n) : Math.round((x - L) / pw * (n - 1 || 1))));
    if (!this.hover || this.hover.cv !== cv || this.hover.i !== i) { const old = this.hover && this.hover.cv; this.hover = { cv, i }; if (old && old !== cv) this.draw(old, this.charts[+old.dataset.c]); this.draw(cv, c); }
    const live = c.live && i === n - 1;
    tip.innerHTML = `<b>Day ${c.days[i]}${live ? ' · so far' : ''}</b>` + c.series.map(([nm], j) => `<div><i style="background:${C[j]}"></i><span>${esc(nm)}</span><em>${this.fmt(c, c.data[i][j])}</em></div>`).join('');
    tip.hidden = false;
    const box = $('stats').getBoundingClientRect(), tw = tip.offsetWidth;
    let tx = e.clientX - box.left + 14; if (tx + tw > box.width - 8) tx = e.clientX - box.left - tw - 14;
    let ty = e.clientY - box.top + 12; if (ty + tip.offsetHeight > box.height - 8) ty = e.clientY - box.top - tip.offsetHeight - 12;
    tip.style.left = tx + 'px'; tip.style.top = ty + 'px';
  }
}

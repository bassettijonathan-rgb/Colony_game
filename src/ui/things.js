// What else can be clicked on the map besides people and buildings: the Seed, the campfire, the kitchen,
// the yard, sensor stakes, local life, trees, boulders, bushes and rock faces. thingAt finds it under the
// pointer; thingCard says what it is, in the same card the buildings use.
import { MAP, T, ACT } from '../core/consts.js';
import { propsIn, propAt } from '../core/world.js';
import { fireOn } from '../core/year.js';
import { SAMPLES, TEST_H } from '../core/food.js';
import { matName, LANDER_KW } from '../core/build.js';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const pct = f => Math.round(f * 100) + '%';
const SEAS = ['Thaw', 'Long light', 'Storm', 'Deep cold'];
// what the analyser is busy with: a kind of local life by its number, or a find ('f' and its number)
export function labItem(A, F, q) {
  if (q == null || q === -1) return null;
  if (typeof q === 'string') { const f = A.story && A.story.finds.find(x => 'f' + x.i === q); return f ? { name: f.name.charAt(0).toLowerCase() + f.name.slice(1), h: f.h || 8, find: true } : null; }
  const l = F.life[q]; return l ? { name: l.name.toLowerCase(), h: TEST_H } : null;
}
const TREE = { oak: ['Broadleaf', 'A broad, spreading tree with heavy limbs.'], pine: ['Needle tree', 'A tall tree with dark needles, common on high ground.'], birch: ['Pale-bark tree', 'A slender tree with pale bark.'], bloom: ['Flowering tree', 'A low tree that flowers in the warm months and likes wet ground.'] };
const SOURCE_R = 70;   // as in the simulation: how far from the Seed people go for stone and timber

// the thing nearest the pointer, within a small reach that grows as the map zooms out
export function thingAt(A, V, wx, wy) {
  const W = A.W, U = A.ui; if (!W || !W.land || !U) return null;
  const reach = Math.max(.55, 7 / V.cam.z), d = (x, y) => Math.hypot(x - wx, y - wy);
  const L = W.land, site = W.site;
  if (d(L.x + .5, L.y + .5) < 2.4) return { k: 'seed', x: L.x + .5, y: L.y + .5, r: 2.4 };
  if (d(site.fire.x, site.fire.y) < .9) return { k: 'fire', x: site.fire.x, y: site.fire.y, r: .9 };
  const sp = U.spots;
  if (sp && sp.cook != null) { const x = sp.cook % MAP + .5, y = (sp.cook / MAP | 0) + .5; if (d(x, y) < .6) return { k: 'cook', x, y, r: .5 }; }
  if (sp && sp.vat != null) { const x = sp.vat % MAP + .5, y = (sp.vat / MAP | 0) + .5; if (Math.abs(wx - x) < 1.05 && Math.abs(wy - y) < .4) return { k: 'vats', x, y, r: 1.1 }; }
  const Y = site.yard; if (wx >= Y.x && wx < Y.x + Y.w && wy >= Y.y && wy < Y.y + Y.h) return { k: 'yard', x: Y.x + Y.w / 2, y: Y.y + Y.h / 2, r: Math.max(Y.w, Y.h) / 2 + .3 };
  for (let i = 0; i < U.stakes.length; i++) { const s = U.stakes[i]; if (d(s.x + .5, s.y + .5) < Math.max(.6, reach)) return { k: 'stake', i, x: s.x + .5, y: s.y + .5, r: .6 }; }
  // local life the colony knows, then trees, boulders and bushes, then the tile itself if it is a rock face or a felled tree
  let best = null, bd = reach;
  const life = A.view && A.view.lifeList(), FD = U.F;
  if (life && FD) {
    const NC = Math.ceil(MAP / 32), cx = Math.floor(wx / 32), cy = Math.floor(wy / 32);
    for (let y = cy - 1; y <= cy + 1; y++) for (let x = cx - 1; x <= cx + 1; x++) { const b = x >= 0 && y >= 0 && x < NC && y < NC && life.by[y * NC + x]; if (b) for (const i of b) { const p = life.list[i]; if (!FD.life[p.o]) continue; const e = d(p.x, p.y); if (e < bd) { bd = e; best = { k: 'life', i, o: p.o, x: p.x, y: p.y, r: .5 }; } } }
  }
  for (const q of propsIn(W, Math.floor(wx) - 1, Math.floor(wy) - 1, Math.floor(wx) + 2, Math.floor(wy) + 2)) {
    const e = d(q.x, q.y) - (q.k === 'tree' ? .25 * q.sc : q.r || 0); if (e < bd) { bd = e; best = { k: q.k, q, t: Math.floor(q.y) * MAP + Math.floor(q.x), x: q.x, y: q.y, r: q.k === 'tree' ? .7 * q.sc : (q.r || .3) + .15 }; }
  }
  if (best) return best;
  const x = Math.floor(wx), y = Math.floor(wy); if (x < 0 || y < 0 || x >= MAP || y >= MAP) return null;
  const t = y * MAP + x;
  if (W.gone && W.gone.get(t) > 0) { const p = propAt(W, x, y); if (p && p.k === 'tree') return { k: 'logs', t, x: p.x, y: p.y, r: .6 }; }
  if (W.type[t] === T.ROCK) return { k: 'rock', t, x: x + .5, y: y + .5, r: .7 };
  return null;
}

// who is at work on, or standing near, a spot: [names of people within r tiles, of them doing one of acts]
function near(A, x, y, r, acts) {
  const out = [];
  for (let i = 0; i < A.n; i++) { const a = A.pos[i * 4 + 3] >> 1; if (a === ACT.DEAD || a === ACT.INSIDE || a === ACT.INDOORS) continue; if (Math.hypot(A.pos[i * 4] - x, A.pos[i * 4 + 1] - y) > r) continue; if (!acts || acts.includes(a)) out.push(A.names[i]); }
  return out;
}
const who = (names, verb) => names.length ? `${names.slice(0, 4).map(esc).join(', ')}${names.length > 4 ? ` and ${names.length - 4} more` : ''} ${names.length === 1 ? verb[0] : verb[1]}.` : '';
const row = (a, b) => `<div class="row2 li"><span class="grow">${a}</span><span class="num">${b}</span></div>`;
const note = (s, top = 8) => `<div class="note" style="margin:${top}px 0 0">${s}</div>`;
const sec = s => `<div class="sec">${s}</div>`;
const reachable = (A, x, y) => Math.hypot(x - A.W.land.x, y - A.W.land.y) <= SOURCE_R;
const crewsOn = (U, work) => U.crews.filter(c => !c.gone && c.work === work && c.members.length);

// the card: name, icon, a line under the name, the status line with its dot, the body, and an optional button
export function thingCard(A, th) {
  const U = A.ui, F = U.F, W = A.W, hour = A.clock ? A.clock.hour : 12;
  switch (th.k) {
    case 'seed': {
      const sd = U.seed, arch = A.archive || [], stored = arch.filter(p => p.woke == null).length, names = new Map(arch.map(p => [p.fid, p.name]));
      const lab = F && F.lab, cur = lab && labItem(A, F, lab.cur);
      let h = note('The lander’s mind. It came down with the colony’s founders stored as minds in its archive, prints their bodies, and plans the work, the meals and the power.', 8);
      h += sec('Archive and fabricator') + row('Minds stored', stored) + row('Feedstock left', `${sd.feed} ${sd.feed === 1 ? 'body' : 'bodies'}`) + (U.projects.some(p => p.type === 'plant' && p.done) ? row('Next body’s feedstock', pct(sd.fb / sd.per)) : !sd.feed ? note('A feedstock plant (Build window, Plan) makes more from biomass and stone.', 0) : '');
      if (sd.printing) h += row(`${sd.printing.rid != null ? 'Waking' : 'Printing'} ${esc(sd.printing.name || '')}`, '');
      if (sd.queue.length) h += row('Next in line', sd.queue.length);
      if (sd.fab) h += row('Making from salvage', esc(matName(sd.fab.k, 1)));
      if (U.gen) { const G = U.gen, kids = U.p.filter(r => !(r[6] & 16) && r[8] < 2).length; h += sec('Growth tanks and nursery') + row('Children growing', `${G.womb.length} of ${G.tanks}`) + G.womb.map(e => row(`Child of ${esc(e.names[0].split(' ')[0])} and ${esc(e.names[1].split(' ')[0])}`, `${e.left} day${e.left === 1 ? '' : 's'}`)).join('') + (G.asks.length ? row('Couples waiting', G.asks.length) : '') + row('In the nursery', kids); }
      if (F) { h += sec('Analyser'); h += cur ? row(`${cur.find ? 'Looking at' : 'Testing'} ${esc(cur.name)}`, pct(lab.work / cur.h)) : note('Idle. Samples of local life go here to be tested before anyone eats them.', 0); if (lab.queue.length) h += row('Waiting to be tested', lab.queue.length); }
      if (U.med) { const M = U.med; h += sec('Medical supplies') + row('Dressings', M.dress) + row('Painkillers', M.pk) + row('Antibiotic courses', M.abx) + row('Blood substitute', `${M.blood} unit${M.blood === 1 ? '' : 's'}`) + note('The fabricator makes more from salvage when they run low.', 0); }
      h += sec('Supplies') + row('Lander power', `${LANDER_KW} kW`) + (U.mode === 'stress' ? '' : row('Lander rations', `${Math.floor(U.food)} meals`)) + row('Sensor stakes not yet planted', sd.stakes);
      return { name: 'The Seed', icon: 'seed', meta: 'The lander and its mind', job: sd.printing ? 'Printing a body' : cur ? 'Testing samples' : 'Watching over the colony', dot: 'ok', body: h, btn: { label: 'Open the archive', tab: 'archive' } };
    }
    case 'fire': {
      const lit = fireOn(hour) > .05, by = near(A, th.x, th.y, 3.5);
      let h = note('People gather at the fire in the evening to eat and talk. An evening here eases strain, more with friends around it. A commons does the same indoors, better.');
      if (by.length) h += note(who(by, ['is here', 'are here']));
      const sp = U.spots; if (sp && sp.cook != null) h += note('The cooking spot and the vats are next to it.');
      return { name: 'Campfire', icon: 'fire', meta: 'By the Seed', job: lit ? 'Lit' : 'Embers: lit again at dusk', dot: lit ? 'ok' : 'off', body: h };
    }
    case 'cook': {
      const ks = crewsOn(U, 'kitchen'), cooks = near(A, th.x, th.y, 1.6, [ACT.COOK]);
      const meals = F ? Object.values(F.meals).reduce((a, b) => a + b, 0) : 0;
      let h = note('A pot on a stand by the fire. A kitchen crew cooks meals here, which go further than what people cook for themselves.');
      h += row('Cooked meals in store', Math.floor(meals));
      if (cooks.length) h += note(who(cooks, ['is cooking', 'are cooking']));
      if (!ks.length) h += note('No kitchen crew. Give a crew Kitchen work in the Crews window (C).');
      return { name: 'Cooking spot', icon: 'food', meta: 'The kitchen', job: cooks.length ? 'Cooking' : ks.length ? 'Kitchen crew at work' : 'Unused: no kitchen crew', dot: cooks.length || ks.length ? 'ok' : 'off', body: h };
    }
    case 'vats': {
      const vats = F ? F.vats : [], ks = crewsOn(U, 'kitchen'), DT = 12 * 60 * 30;
      let h = note(`${F ? F.vatN : 4} vats for food that cannot be eaten as it is: soaked and rinsed to leach out what does harm, or left to ferment. The kitchen crew fills and empties them, and makes another vat for every three people past twelve, up to sixteen.`);
      h += sec(`In use · ${vats.length} of ${F ? F.vatN : 4}`);
      h += vats.length ? vats.map(v => row(`${esc(F.names[v.src] || 'Food')}, ${v.proc === 'leach' ? 'leaching' : 'fermenting'}`, v.left <= 0 ? 'ready' : Math.ceil(v.left / DT * 24) + ' h left')).join('') : note('All empty.', 0);
      if (!ks.length) h += note('No kitchen crew to work them.');
      return { name: 'Vats', icon: 'food', meta: 'The kitchen', job: vats.length ? `${vats.length} in use` : 'Empty', dot: vats.length ? 'ok' : 'off', body: h, btn: { label: 'The larder', tab: 'life' } };
    }
    case 'yard': {
      const y = U.stores.yard, m = U.mat;
      let h = note('Where the stone, timber and biomass brought in are piled, with the lander’s salvage. Builders take what each stage needs from here.');
      h += sec('Piled here') + row('Stone', `${y.stone} loads`) + row('Timber', `${y.timber} loads`) + (y.biomass != null ? row('Biomass', `${y.biomass} loads`) : '') + row('Salvage', y.salvage);
      h += sec('Load-test rig') + ['stone', 'timber'].map(k => { const d = m[k].tested ? Math.round((m[k].f - 1) * 100) : 0; return row(k === 'stone' ? 'Stone' : 'Timber', !m[k].tested ? 'not tested' : d === 0 ? 'as strong as standard' : `${Math.abs(d)}% ${d > 0 ? 'stronger' : 'weaker'} than standard`); }).join('');
      return { name: 'The yard', icon: 'stone', meta: 'Stores and the load-test rig', job: 'Stores', dot: 'ok', body: h, btn: { label: 'In the Build window', tab: 'build' } };
    }
    case 'stake': {
      const s = U.stakes[th.i];
      const h = note(`Planted by a survey crew on day ${s.day}. The Seed reads the ground, the air and the weather around it, and the land near a stake shows up as surveyed.`);
      return { name: `Sensor stake ${th.i + 1}`, icon: 'survey', meta: `${U.stakes.length} of 10 planted`, job: 'Reporting to the Seed', dot: 'ok', body: h };
    }
    case 'life': {
      const l = F.life[th.o], bare = F.gone.includes(th.i), now = l.now;
      const when = l.season.map((on, i) => on ? SEAS[i] : null).filter(Boolean);
      let h = note(esc(l.seen)) + `<div class="chips" style="margin-top:8px"><span class="chip">${esc(l.where.join(', '))}</span><span class="chip${now ? ' g' : ''}">${when.length === 4 ? 'All year' : esc(when.join(', '))}${now ? ' · now' : ''}</span></div>`;
      if (l.tested) h += sec('Tested') + note(esc(l.result), 0) + note(esc(l.verdict), 4);
      else h += sec('Not tested') + note(l.queued ? 'Its samples are with the analyser.' : `Samples taken: ${l.samples} of ${SAMPLES}. Nobody eats it until it has been tested; foragers take samples as they go.`, 0);
      const job = bare ? 'Picked bare: growing back' : !now ? 'Dormant out of season' : l.tested ? (l.food ? 'Food' : 'Not food') : 'Untested';
      return { name: l.name, icon: 'life', meta: 'Local life', job, dot: bare || !now ? 'off' : 'ok', body: h, btn: { label: 'In the Life window', tab: 'life' } };
    }
    case 'tree': {
      const [nm, txt] = TREE[th.q.kind] || ['Tree', ''], fell = near(A, th.x, th.y, 1.6, [ACT.FELL]), ok = reachable(A, th.x, th.y);
      let h = note(`${txt} Felled, it gives 2 loads of timber.`);
      h += note(ok ? (crewsOn(U, 'timber').length ? 'Within reach of camp: timber crews fell the nearest trees to the yard first.' : 'Within reach of camp. Give a crew Timber work to fell trees.') : 'Too far from camp for timber crews to come for it.');
      if (fell.length) h += note(who(fell, ['is felling it', 'are felling it']));
      return { name: nm, icon: 'timber', meta: 'Tree', job: fell.length ? 'Being felled' : ok ? 'Standing' : 'Out of reach', dot: fell.length ? 'ok' : 'off', body: h };
    }
    case 'logs': {
      const n = W.gone.get(th.t);
      return { name: 'Felled tree', icon: 'timber', meta: 'Timber', job: `${n} ${n === 1 ? 'log' : 'logs'} still lying here`, dot: 'ok', body: note('Timber crews carry the logs to the yard, one at a time.') };
    }
    case 'boulder': {
      const q = (W.quarry && W.quarry.get(th.t)) || 0, cut = near(A, th.x, th.y, 1.6, [ACT.QUARRY]), ok = reachable(A, th.x, th.y);
      let h = note(`Loose rock left by the land. Quarry crews cut it into ${2 - q} more ${2 - q === 1 ? 'load' : 'loads'} of stone.`);
      h += note(ok ? (crewsOn(U, 'quarry').length ? 'Within reach of camp: quarry crews take the nearest stone first.' : 'Within reach of camp. Give a crew Quarry work to cut stone.') : 'Too far from camp for quarry crews to come for it.');
      if (cut.length) h += note(who(cut, ['is cutting it', 'are cutting it']));
      return { name: 'Boulder', icon: 'stone', meta: 'Stone', job: cut.length ? 'Being cut' : ok ? 'Untouched' : 'Out of reach', dot: cut.length ? 'ok' : 'off', body: h };
    }
    case 'bush': {
      const h = note('Low, tough scrub. Cleared, it gives a load of biomass, which goes into the made soil of new fields.');
      return { name: 'Scrub bush', icon: 'life', meta: 'Biomass', job: reachable(A, th.x, th.y) ? 'Within reach of camp' : 'Out of reach', dot: 'off', body: h };
    }
    case 'rock': {
      const q = (W.quarry && W.quarry.get(th.t)) || 0, cut = near(A, th.x, th.y, 1.8, [ACT.QUARRY]);
      let h = note(`Bare bedrock. Quarry crews can cut about ${Math.max(0, 30 - q)} more loads of stone from this face.`);
      if (cut.length) h += note(who(cut, ['is cutting stone here', 'are cutting stone here']));
      return { name: 'Rock face', icon: 'stone', meta: 'Stone', job: cut.length ? 'Being quarried' : q ? 'Partly quarried' : 'Untouched', dot: cut.length ? 'ok' : 'off', body: h };
    }
  }
  return null;
}

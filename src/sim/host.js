// The simulation's side of the conversation with the page. It runs inside a Web Worker when the
// browser allows one, or on the page itself otherwise; either way it only talks through messages.
//   page -> sim: init {seed, mode, count, save}, land {site}, speed {v}, save {id}, cmd {op, ...}, watch {id}
//   sim -> page: survey {world, sites}, ready {world, site, roster, ui, ...}, snap {pos, clock, perf},
//                state {ui, log, roster?}, wear {chunks}, known {chunks}, marks {gone, quarry, ground}, saved {id, data}, cmd {id, r}
//   skips: page -> sim skip {kind}, skipStop; sim -> page skip {from, to, at} while it runs, skipEnd {why, chron} or skipNo {why}
import { generateWorld, findSites, landAt } from '../core/world.js';
import { Pathfinder } from '../core/path.js';
import { Sim } from '../core/sim.js';
import { TPS, SPEEDS } from '../core/consts.js';
import { STOP, skipBlock, skipTarget, skipMark, chronicle } from '../core/chronicle.js';

const now = () => performance.now();

export function createSimCore(post) {
  let W = null, P = null, sim = null, sites = null, speed = 1, last = 0, acc = 0, timer = null, lastWear = 0, lastState = 0, watch = -1, recs = false, recsAt = 0, soc = false, socAt = 0, skip = null, sentChron = 0, sentLog = 0, sentRv = -1, sentHist = 0;
  const perf = { ticks: 0, tickMs: 0, tps: 0, window: now(), worst: 0 };

  function step() {
    const t = now(), dt = Math.min(250, t - last); last = t;
    if (skip) { skipStep(t); timer = setTimeout(step, 0); return; }
    acc += dt / 1000 * TPS * SPEEDS[speed];
    let n = Math.min(60, Math.floor(acc)); acc -= n; if (acc > 60) acc = 0;   // never fall into a spiral
    if (n > 0) {
      const t0 = now();
      for (let i = 0; i < n; i++) sim.tick();
      const ms = now() - t0; perf.ticks += n; perf.tickMs += ms; perf.worst = Math.max(perf.worst, ms / n);
      const pos = sim.snapshot(new Float32Array(sim.S.cols.length * 4));
      post({ t: 'snap', tick: sim.S.tick, pos, clock: sim.clock(), perf: perfOut() }, [pos.buffer]);
    }
    if (t - lastWear > 500) { lastWear = t; chunks('wear', sim.dirty, k => sim.wearChunk(k)); chunks('known', sim.kdirty, k => sim.knownChunk(k)); marks(); }
    if (t - lastState > 400) { lastState = t; state(); }
    timer = setTimeout(step, 8);
  }
  // a skip: as many ticks as fit in a slice of time, then a look at the map and the clock for the page
  function skipStep(t) {
    const S = sim.S, K = skip, end = t + 40;
    let n = 0;
    while (S.tick < K.until && !K.stop && now() < end) { for (let i = 0; i < 30 && S.tick < K.until; i++) sim.tick(); n += 30; }
    perf.ticks += n;
    if (t - K.shown > 120) {
      K.shown = t;
      const pos = sim.snapshot(new Float32Array(S.cols.length * 4));
      post({ t: 'snap', tick: S.tick, pos, clock: sim.clock(), perf: perfOut() }, [pos.buffer]);
      post({ t: 'skip', from: K.from, to: K.until, at: S.tick });
    }
    if (t - lastWear > 1000) { lastWear = t; chunks('wear', sim.dirty, k => sim.wearChunk(k)); chunks('known', sim.kdirty, k => sim.knownChunk(k)); marks(); }
    if (t - lastState > 1000) { lastState = t; state(); }
    if (S.tick >= K.until || K.stop) endSkip(K.stop ? `${K.stop.title || 'something happened'}.` : '');
  }
  function endSkip(why) {
    const K = skip; skip = null; sim.tap = null; speed = 0;
    const C = chronicle(sim, K.mark, why);
    lastState = 0; state();
    post({ t: 'skipEnd', why, chron: C, stop: K.stop ? K.stop.n : 0 });
    last = now(); acc = 0;
  }
  function chunks(kind, set, get) {
    if (!set.size) return;
    const out = []; for (const k of set) out.push([k, get(k)]); set.clear();
    post({ t: kind, chunks: out }, out.map(c => c[1].buffer));
  }
  // trees felled and stone quarried since the last report, as flat [tile, value, ...] lists
  function marks() {
    if (!sim.gnew.length && !sim.qnew.length && !sim.tnew.length) return;
    post({ t: 'marks', gone: sim.gnew, quarry: sim.qnew, ground: sim.tnew }); sim.gnew = []; sim.qnew = []; sim.tnew = [];
  }
  function state() {
    const S = sim.S, m = { t: 'state', ui: sim.ui(watch), log: sim.logSince(sentLog) };
    sentLog = S.logN;
    if (S.hist.rows.length !== sentHist) { m.hist = S.hist.rows.slice(sentHist); sentHist = S.hist.rows.length; }
    if (S.rv !== sentRv) { sentRv = S.rv; m.roster = sim.roster(); }
    if (recs && now() - recsAt > 2000) { recsAt = now(); m.recs = sim.recordsUI(); }   // only while the records are open
    if (soc && now() - socAt > 1000 && sim.S.soc) { socAt = now(); m.soc = sim.socUI(); }   // and the Society window
    if (S.chron && S.chron.length !== sentChron) { sentChron = S.chron.length; m.chron = S.chron; }
    post(m);
  }
  function perfOut() {
    const t = now(), span = t - perf.window;
    if (span > 1000) { perf.tps = perf.ticks / span * 1000; perf.avg = perf.ticks ? perf.tickMs / perf.ticks : 0; perf.load = perf.tickMs / span; perf.ticks = 0; perf.tickMs = 0; perf.window = t; perf.lastWorst = perf.worst; perf.worst = 0; }
    return { tps: perf.tps, tickMs: perf.avg || 0, worst: perf.lastWorst || 0, load: perf.load || 0, paths: { ...P.stats } };
  }
  // the landing itself: lay out the camp, build the path graph, start the colony
  function begin(site, save, mode, count, t0, t1, season = 0) {
    const patch = landAt(W, site); W.siteId = site.id;
    const t2 = now(); P = new Pathfinder(W); const t3 = now(); sim = new Sim(W, P); const t4 = now();
    if (save) sim.load(save); else sim.newGame(mode, count, season);
    const S = sim.S; sentLog = 0; sentRv = S.rv; sentHist = S.hist.rows.length; sentChron = 0; skip = null;
    post({
      t: 'ready', seed: W.seed, land: W.land, site: W.site, siteId: site.id, tag: sites && sites[site.id] ? sites[site.id].tag : '', patch, rock: W.rock, mode: S.mode,
      world: { type: W.type, elev: W.elev, moist: W.moist },
      roster: sim.roster(), ui: sim.ui(-1), log: sim.logSince(0), gone: S.gone, quarry: S.quarry, hist: S.hist.rows,
      pos: sim.snapshot(new Float32Array(S.cols.length * 4)), clock: sim.clock(),
      timing: { world: t1 - t0, land: t2 - t1, graph: t3 - t2, field: t4 - t3, nodes: P.nodes.length }
    });
    sentLog = S.logN; sim.gnew = []; sim.qnew = []; sim.tnew = [];
    // the trodden and the surveyed ground go out at once
    chunks('wear', sim.dirty, k => sim.wearChunk(k)); chunks('known', sim.kdirty, k => sim.knownChunk(k));
    last = now(); acc = 0; timer = setTimeout(step, 8);
  }

  function handle(m) {
    if (m.t === 'init') {
      clearTimeout(timer); sim = null; watch = -1;
      const t0 = now(); W = generateWorld(m.seed, m.save ? m.save.wv || 1 : undefined); sites = findSites(W); const t1 = now();
      if (m.save) begin({ id: m.save.site.id, x: m.save.site.x, y: m.save.site.y }, m.save, null, 0, t0, t1);
      else if (m.mode === 'stress') begin(sites[0], null, 'stress', m.count || 300, t0, t1);
      else post({ t: 'survey', seed: W.seed, rock: W.rock, world: { type: W.type, elev: W.elev, moist: W.moist }, sites, timing: { world: t1 - t0 } });
    } else if (m.t === 'land') { if (W && !sim) { const t1 = now(); begin(sites[m.site], null, 'landfall', 0, t1, t1, m.season | 0); } }
    else if (m.t === 'speed') { speed = m.v; }
    else if (m.t === 'save') { post({ t: 'saved', rq: m.rq, data: sim ? sim.serialize() : null }); }
    else if (m.t === 'watch') { watch = m.id; if (sim) { lastState = 0; } }
    else if (m.t === 'recs') { recs = !!m.on; recsAt = 0; }
    else if (m.t === 'soc') { soc = !!m.on; socAt = 0; }
    else if (m.t === 'cmd') { if (!sim) return; const r = sim.command(m); if (m.rq) post({ t: 'cmd', rq: m.rq, r }); lastState = 0; socAt = 0; }
    else if (m.t === 'skip') {
      if (!sim || skip) return;
      const why = skipBlock(sim); if (why) { post({ t: 'skipNo', why }); return; }
      const mark = skipMark(sim);
      skip = { from: sim.S.tick, until: skipTarget(sim, m.kind), mark, stop: null, shown: 0 };
      sim.tap = e => { mark.ev.push(e); if (!skip.stop && STOP.has(e.e)) skip.stop = e; };
      post({ t: 'skip', from: skip.from, to: skip.until, at: skip.from });
    }
    else if (m.t === 'skipStop') { if (skip) skip.stop = { title: 'you stopped it', n: 0 }; }
    else if (m.t === 'stop') { clearTimeout(timer); }
  }
  return { handle };
}

// Generative music, made live with Web Audio: no audio files. A slow pad carries a chord change every two bars,
// a bass note sits under it, a plucked melody repeats a short motif with small changes and rests now and then,
// and a bell rings on some chord changes. The mood follows the time of day (orbit, dawn, day, evening, night) and only
// changes on a chord change, so the music never jumps. Browsers allow sound only after a click or a key, so the
// audio starts on the first one. The on/off choice and the volume are kept in this browser.
const LYDIAN = [0, 2, 4, 6, 7, 9, 11], MIXO = [0, 2, 4, 5, 7, 9, 10], AEOLIAN = [0, 2, 3, 5, 7, 8, 10], DORIAN = [0, 2, 3, 5, 7, 9, 10];
const ROOT = 50; // D3
// prog: scale degrees of the chords, two bars each; dens: chance of a melody note per eighth; cut: pad filter (Hz)
const MOODS = {
  orbit: { mode: LYDIAN, progs: [[0, 1, 0, 4], [0, 4, 1, 5]], bpm: 54, dens: .12, bass: 0, bell: .55, cut: 1500, verb: .75, pluck: .7, low: 9, high: 21 },
  day: { mode: LYDIAN, progs: [[0, 4, 5, 3], [0, 1, 5, 4], [5, 3, 0, 4]], bpm: 66, dens: .34, bass: 1, bell: .2, cut: 2200, verb: .45, pluck: 1, low: 7, high: 18 },
  evening: { mode: MIXO, progs: [[0, 6, 3, 0], [0, 4, 6, 3], [3, 6, 0, 4]], bpm: 60, dens: .25, bass: 1, bell: .3, cut: 1500, verb: .55, pluck: .9, low: 7, high: 17 },
  night: { mode: AEOLIAN, progs: [[0, 5, 3, 4], [0, 3, 5, 6], [0, 5, 2, 6]], bpm: 50, dens: .14, bass: .8, bell: .35, cut: 850, verb: .7, pluck: .75, low: 5, high: 15 },
  dawn: { mode: DORIAN, progs: [[0, 3, 0, 6], [0, 4, 3, 0]], bpm: 56, dens: .2, bass: .9, bell: .3, cut: 1100, verb: .6, pluck: .85, low: 6, high: 16 },
};
const KEY = 'colony-music';
const mtof = m => 440 * Math.pow(2, (m - 69) / 12);

export function moodFor(phase, hour) {
  if (phase !== 'colony') return 'orbit';
  if (hour >= 6.5 && hour < 17.5) return 'day';
  if (hour >= 17.5 && hour < 21) return 'evening';
  if (hour >= 5 && hour < 6.5) return 'dawn'; // the grey before sunrise
  return 'night';
}

export class Music {
  constructor() {
    let p = {}; try { p = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { /* storage blocked: defaults */ }
    this.on = p.on !== false; this.vol = typeof p.vol === 'number' ? p.vol : .5;
    this.ctx = null; this.mood = 'orbit'; this.want = 'orbit'; this.notes = 0;
    this.rnd = Math.random;
    const start = () => { this.start(); };
    window.addEventListener('pointerdown', start, { capture: true });
    window.addEventListener('keydown', start, { capture: true });
    document.addEventListener('visibilitychange', () => this.wake());
  }
  get state() { return { on: this.on, vol: this.vol, mood: this.mood, audio: this.ctx ? this.ctx.state : 'waiting for a click', notes: this.notes }; }
  save() { try { localStorage.setItem(KEY, JSON.stringify({ on: this.on, vol: this.vol })); } catch (e) { /* not kept */ } }
  setMood(m) { this.want = m; }
  setVolume(v) { this.vol = Math.max(0, Math.min(1, v)); this.save(); this.level(); }
  toggle(on = !this.on) { this.on = on; this.save(); if (on) this.start(); this.level(); this.wake(); return on; }

  // ---------- the audio graph, built on the first click or key ----------
  start() {
    if (!this.on) return;
    if (this.ctx) { this.wake(); return; }
    const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
    const c = this.ctx = new AC();
    this.master = c.createGain(); this.master.gain.value = 0;
    const comp = c.createDynamicsCompressor(); comp.threshold.value = -18; comp.ratio.value = 3; comp.attack.value = .02; comp.release.value = .4;
    this.master.connect(comp); comp.connect(c.destination);
    this.dry = c.createGain(); this.dry.connect(this.master);
    // reverb: a generated tail of decaying stereo noise, darkened over time
    this.verb = c.createConvolver(); this.verb.buffer = this.impulse(4.2);
    this.verbIn = c.createGain(); this.verbOut = c.createGain(); this.verbIn.connect(this.verb); this.verb.connect(this.verbOut); this.verbOut.connect(this.master);
    // a soft echo for the plucks, fed into the reverb too
    this.delay = c.createDelay(2); this.fb = c.createGain(); this.fb.gain.value = .32;
    const dl = c.createBiquadFilter(); dl.type = 'lowpass'; dl.frequency.value = 2200;
    this.echo = c.createGain(); this.echo.gain.value = .28;
    this.echo.connect(this.delay); this.delay.connect(dl); dl.connect(this.fb); this.fb.connect(this.delay); dl.connect(this.dry); dl.connect(this.verbIn);
    // the pad shares one filter so its brightness can follow the mood
    this.padF = c.createBiquadFilter(); this.padF.type = 'lowpass'; this.padF.Q.value = .6; this.padF.frequency.value = 1500;
    this.padG = c.createGain(); this.padG.gain.value = .13; this.padF.connect(this.padG); this.padG.connect(this.dry); this.padG.connect(this.verbIn);
    this.step = 0; this.next = c.currentTime + .15; this.prog = MOODS.orbit.progs[0]; this.mood = this.want; this.newMotif(); this.apply(true);
    this.timer = setInterval(() => this.tick(), 90);
    this.level(); this.wake();
  }
  impulse(sec) {
    const c = this.ctx, n = Math.floor(c.sampleRate * sec), b = c.createBuffer(2, n, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const d = b.getChannelData(ch); let lp = 0;
      for (let i = 0; i < n; i++) { const t = i / n, k = .25 + .7 * (1 - t); lp += k * ((Math.random() * 2 - 1) - lp); d[i] = lp * Math.pow(1 - t, 2.6); }
    }
    return b;
  }
  level() {
    if (!this.ctx) return;
    const g = this.on ? Math.pow(this.vol, 1.5) * 1.2 : 0, t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t); this.master.gain.setTargetAtTime(g, t, .4);
  }
  // pause the audio when the tab is hidden or the music is off, so nothing runs for nobody
  wake() {
    const c = this.ctx; if (!c) return;
    const run = this.on && !document.hidden;
    if (run && c.state !== 'running') { c.resume().then(() => { this.next = Math.max(this.next, c.currentTime + .1); }).catch(() => {}); }
    else if (!run && c.state === 'running') { clearTimeout(this.sleep); this.sleep = setTimeout(() => { if (!(this.on && !document.hidden)) c.suspend().catch(() => {}); }, this.on ? 0 : 1600); }
  }

  // ---------- the score ----------
  get M() { return MOODS[this.mood]; }
  apply(first) {
    const M = this.M, t = this.ctx.currentTime;
    this.prog = M.progs[Math.floor(this.rnd() * M.progs.length)];
    this.padF.frequency.setTargetAtTime(M.cut, t, first ? .01 : 2.5);
    this.verbIn.gain.setTargetAtTime(M.verb, t, first ? .01 : 2);
    this.verbOut.gain.setTargetAtTime(.9, t, .01);
    this.delay.delayTime.setValueAtTime(60 / M.bpm * .75, t);
    this.rest = 0;
  }
  deg(d) { const m = this.M.mode, o = Math.floor(d / 7); return ROOT + 12 * o + m[((d % 7) + 7) % 7]; }
  newMotif() {
    // a two-bar figure of scale degrees; null is silence. It repeats, with a note nudged now and then.
    const M = MOODS[this.mood], mo = []; let d = Math.floor((M.low + M.high) / 2);
    for (let i = 0; i < 16; i++) {
      const strong = i % 4 === 0, p = M.dens * (strong ? 1.7 : i % 2 ? .6 : 1);
      if (this.rnd() < p) { d += [-2, -1, -1, 0, 1, 1, 2, 3, -3][Math.floor(this.rnd() * 9)]; d = Math.max(M.low, Math.min(M.high, d)); mo.push(d); } else mo.push(null);
    }
    if (mo.every(x => x === null)) mo[0] = Math.floor((M.low + M.high) / 2);
    this.motif = mo;
  }
  tick() {
    const c = this.ctx; if (!c || c.state !== 'running' || !this.on) return;
    if (this.next < c.currentTime - .5) this.next = c.currentTime + .05; // we fell behind (a stall): skip, don't burst
    while (this.next < c.currentTime + .3) { this.play(this.step, this.next); this.next += 30 / this.M.bpm; this.step++; }
  }
  play(s, t) {
    const bar16 = s % 16;
    if (bar16 === 0) {
      // a chord change: the only moment the mood may change
      if (this.want !== this.mood) { this.mood = this.want; this.apply(false); this.newMotif(); }
      if (s % 128 === 0 && s) { this.newMotif(); this.prog = this.M.progs[Math.floor(this.rnd() * this.M.progs.length)]; this.rest = this.rnd() < .3 ? 4 : 0; }
      else if (this.rest > 0) this.rest--;
      else if (this.rnd() < .25) this.vary();
      this.chord(t);
    }
    if (this.rest > 0) return;
    const d = this.motif[bar16]; if (d === null) return;
    const M = this.M, root = this.prog[Math.floor(s / 16) % this.prog.length];
    let n = d;
    if (bar16 % 4 === 0) { const tones = [root, root + 2, root + 4].map(x => x + 7 * Math.round((d - x) / 7)); n = tones.reduce((a, b) => Math.abs(b - d) < Math.abs(a - d) ? b : a); }
    this.pluck(this.deg(n), t, M.pluck * (bar16 % 4 === 0 ? 1 : .72) * (.85 + this.rnd() * .3));
  }
  vary() { const i = this.motif.findIndex((x, k) => x !== null && k && this.rnd() < .4); if (i > 0) { const M = this.M; this.motif[i] = Math.max(M.low, Math.min(M.high, this.motif[i] + (this.rnd() < .5 ? -1 : 1))); } }
  chord(t) {
    const M = this.M, r = this.prog[Math.floor(this.step / 16) % this.prog.length], len = 16 * 30 / M.bpm;
    // a seventh chord voiced close, around the G below middle C
    const notes = [r, r + 2, r + 4, r + 6].map(x => { let m = this.deg(x); while (m < 55) m += 12; while (m > 67) m -= 12; return m; });
    for (const m of notes) this.pad(m, t, len);
    if (M.bass) this.bass(this.deg(r) - 12, t, len, M.bass);
    if (this.rnd() < M.bell) this.bell(this.deg(r + 7 * 2 + (this.rnd() < .5 ? 4 : 2)), t + 30 / M.bpm * Math.floor(this.rnd() * 4) * 2);
  }
  pad(m, t, len) {
    const c = this.ctx, g = c.createGain(), f = mtof(m), end = t + len + 3;
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.16, t + 2); g.gain.setValueAtTime(.16, t + len); g.gain.linearRampToValueAtTime(0, end);
    g.connect(this.padF);
    for (const det of [-7, 6]) { const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f; o.detune.value = det; o.connect(g); o.start(t); o.stop(end + .05); }
    this.notes++;
  }
  bass(m, t, len, amt) {
    const c = this.ctx, o = c.createOscillator(), g = c.createGain(), end = t + len + 1.5;
    o.type = 'sine'; o.frequency.value = mtof(m);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.26 * amt, t + .4); g.gain.setTargetAtTime(.14 * amt, t + .4, len / 2); g.gain.linearRampToValueAtTime(0, end);
    o.connect(g); g.connect(this.dry); o.start(t); o.stop(end + .05);
  }
  pluck(m, t, v) {
    const c = this.ctx, g = c.createGain(), lp = c.createBiquadFilter(), f = mtof(m);
    lp.type = 'lowpass'; lp.frequency.setValueAtTime(Math.min(6000, f * 6), t); lp.frequency.exponentialRampToValueAtTime(f * 1.5, t + 1.2);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.13 * v, t + .006); g.gain.exponentialRampToValueAtTime(.0005, t + 1.9);
    const a = c.createOscillator(), b = c.createOscillator(), bg = c.createGain();
    a.type = 'triangle'; a.frequency.value = f; b.type = 'sine'; b.frequency.value = f * 2; bg.gain.value = .3;
    a.connect(lp); b.connect(bg); bg.connect(lp); lp.connect(g); g.connect(this.dry); g.connect(this.echo); g.connect(this.verbIn);
    a.start(t); b.start(t); a.stop(t + 2); b.stop(t + 2);
    this.notes++;
  }
  bell(m, t) {
    // two-operator FM: an inharmonic modulator that fades gives the strike and then a pure tail
    const c = this.ctx, f = mtof(m), car = c.createOscillator(), mod = c.createOscillator(), mg = c.createGain(), g = c.createGain();
    car.frequency.value = f; mod.frequency.value = f * 3.51;
    mg.gain.setValueAtTime(f * 2.2, t); mg.gain.exponentialRampToValueAtTime(f * .05, t + 2.5);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.07, t + .01); g.gain.exponentialRampToValueAtTime(.0005, t + 5);
    mod.connect(mg); mg.connect(car.frequency); car.connect(g); g.connect(this.dry); g.connect(this.verbIn);
    car.start(t); mod.start(t); car.stop(t + 5.1); mod.stop(t + 5.1);
    this.notes++;
  }
}

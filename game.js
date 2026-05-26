// Padel Wall Chaos — Phaser bootstrap + global namespace.
// All tunables, colors, audio, storage, and juice helpers live on window.PWC.

window.PWC = window.PWC || {};

PWC.config = {
  width: 720,
  height: 1280,

  court: {
    top: 180,
    bottom: 1080,
    left: 60,
    right: 660,
  },

  racket: {
    y: 1020,
    width: 150,
    height: 20,
    // Drag/release input: racket snaps near finger (snap-with-trail).
    followSnapPx: 6,        // racket teleports if finger is further than this
    followLerp: 0.55,       // otherwise lerps fast
    // Spatial hit grading. Sweet spot is X px above racket center.
    sweetSpotOffsetY: -28,
    perfectBandPx: 18,      // ±Y from sweet spot for perfect
    goodBandPx: 56,         // ±Y from sweet spot for good
    xToleranceExtraPx: 8,   // extra X slack beyond racket half-width
  },

  ball: {
    radius: 16,
    baseSpeed: 360,
    speedCap: 1100,
    perBounceMul: 1.035,
    perReturnMul: 1.07,
    serveTelegraphMs: 280,
  },

  onboarding: {
    warmupServes: 2,
    warmupSpeedMul: 0.55,
    warmupTelegraphMs: 480,
    firstRunTutorialMs: 4200,
  },

  difficulty: {
    returnsPerWave: [4, 5, 6, 7, 8, 8, 9, 10, 10, 11, 12, 13, 14],
    jitterDegByWave: [0, 0, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7],
    mercyMisses: 2,
    mercyWindow: 5,
    mercyDurationReturns: 3,
    mercySpeedMul: 0.94,
  },

  combo: {
    // Front-loaded curve so even short streaks feel rewarding.
    multTable: [1.0, 1.1, 1.25, 1.45, 1.7, 2.0, 2.4, 2.9, 3.5, 4.2, 5.0, 5.9, 6.9, 8.0, 9.2],
    tierAt: [0, 3, 6, 10, 15, 20, 30],
    tierLabels: ['', 'NICE', 'HOT', 'BLAZING', 'INSANE', 'ON FIRE', 'CHAOS'],
  },

  scoring: {
    basePerHit: 100,
    perfectBonus: 350,
  },

  modifiers: {
    curveball: {
      startWave: 4,
      chance: 0.30,         // chance a serve becomes a curveball
      amplitude: 110,       // px lateral perturbation
      frequency: 0.0025,    // rad/ms
      tint: 0xff6fb5,
    },
    surge: {
      startWave: 6,
      chance: 0.25,
      speedMul: 1.30,
      tint: 0xffb13a,
    },
  },

  escalation: {
    // Court ambient tint shifts per wave bucket (hex). Subtle.
    courtTintByWave: [0x14283a, 0x14283a, 0x182c40, 0x1c2e44, 0x222e46, 0x2a2c48, 0x322748, 0x381f44, 0x3c1840],
    crowdEnterAtCombo: 6,
  },

  lives: 3,

  nearMissPx: 70,
  almostBestPct: 0.85,      // show "ALMOST!" tension once score ≥ 85% of PB
};

PWC.colors = {
  bg: 0x0e1d2a,
  bgHex: '#0e1d2a',
  court: 0x14283a,
  courtAccent: 0x1c3650,
  courtLine: 0xffffff,
  ball: 0xd6ff3a,
  ballHex: '#d6ff3a',
  trail: 0xd6ff3a,
  perfect: 0x5cf3ff,
  perfectHex: '#5cf3ff',
  danger: 0xff5c5c,
  dangerHex: '#ff5c5c',
  text: 0xf7f9fb,
  textHex: '#f7f9fb',
  textDim: 0x93a4b2,
  textDimHex: '#93a4b2',
  wave: 0xffd166,
  waveHex: '#ffd166',
  curve: 0xff6fb5,
  curveHex: '#ff6fb5',
  surge: 0xffb13a,
  surgeHex: '#ffb13a',
  almost: 0xffd166,
  almostHex: '#ffd166',
};

// ----- Centralized event names ------------------------------------------
PWC.events = {
  SCORE_CHANGED: 'score:changed',
  COMBO_CHANGED: 'combo:changed',
  COMBO_TIER_UP: 'combo:tierUp',
  COMBO_BROKEN: 'combo:broken',
  LIFE_LOST: 'life:lost',
  WAVE_ADVANCED: 'wave:advanced',
  TRIPLE_PERFECT: 'triplePerfect',
  RUN_ENDED: 'run:ended',
  ALMOST_PB: 'almost:pb',          // fired once when score ≥ almostBestPct of PB
  ONBOARDING_HINT: 'onboarding:hint',
};

// ----- Seeded PRNG (mulberry32) -----------------------------------------
// Used for daily-mode determinism so every player faces the same chaos.
PWC.rng = {
  _state: 0,

  seed(intSeed) {
    this._state = (intSeed >>> 0) || 1;
  },

  next() {
    let t = (this._state += 0x6D2B79F5) >>> 0;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  },

  between(min, max) { return min + this.next() * (max - min); },
  intBetween(min, max) { return Math.floor(this.between(min, max + 1)); },
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; },
};

// ----- Daily challenge --------------------------------------------------
// Day #1 = the launch date. Today's number = days since launch + 1.
PWC.daily = {
  launchDateISO: '2026-05-26',

  todayISO() {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  },

  seedFor(iso) {
    // YYYYMMDD as integer
    return parseInt(iso.replace(/-/g, ''), 10);
  },

  dayNumber(iso = null) {
    const today = new Date(iso || this.todayISO());
    const launch = new Date(this.launchDateISO);
    const days = Math.floor((today - launch) / 86400000);
    return Math.max(1, days + 1);
  },

  // Today's best score for daily mode
  todayBest() {
    const iso = this.todayISO();
    const all = PWC.storage.get('daily') || {};
    return (all[iso] && all[iso].best) || 0;
  },

  recordTodayRun(score, longestCombo, perfects) {
    const iso = this.todayISO();
    const all = PWC.storage.get('daily') || {};
    const cur = all[iso] || { best: 0, bestCombo: 0, runs: 0 };
    cur.runs += 1;
    if (score > cur.best) cur.best = score;
    if (longestCombo > cur.bestCombo) cur.bestCombo = longestCombo;
    all[iso] = cur;
    // Prune anything older than 30 days
    const cutoff = Date.now() - 30 * 86400000;
    Object.keys(all).forEach(k => {
      if (new Date(k).getTime() < cutoff) delete all[k];
    });
    PWC.storage.set('daily', all);
    return cur;
  },

  isNewTodayBest(score) {
    return score > this.todayBest();
  },
};

// ----- Generic object pool ----------------------------------------------
// Used to recycle GameObjects (text, sprites) so the hot path doesn't
// allocate. Pools are per-scene because Phaser GameObjects die with scenes.
PWC.Pool = class {
  constructor(factory, initial = 4) {
    this.factory = factory;
    this.free = [];
    this.used = new Set();
    for (let i = 0; i < initial; i++) this.free.push(factory());
  }
  acquire() {
    let obj = this.free.pop();
    if (!obj) obj = this.factory();
    this.used.add(obj);
    return obj;
  }
  release(obj) {
    if (!this.used.delete(obj)) return;
    this.free.push(obj);
  }
  destroyAll() {
    this.free.forEach(o => o && o.destroy && o.destroy());
    this.used.forEach(o => o && o.destroy && o.destroy());
    this.free = [];
    this.used.clear();
  }
};

// ----- End-of-run title generator ---------------------------------------
// Picks a flattering / funny title based on the run shape.
PWC.titles = {
  pick(stats) {
    // stats: { score, longestCombo, perfects, wave, wasBest, wallBounces, totalReturns }
    const T = [
      // ordered by specificity — first match wins
      { cond: s => s.perfects >= 10,                       text: 'PURE PRECISION' },
      { cond: s => s.longestCombo >= 30,                   text: 'UNSTOPPABLE' },
      { cond: s => s.wasBest && s.perfects >= 5,           text: 'NEW LEGEND' },
      { cond: s => s.wasBest,                              text: 'NEW BEST' },
      { cond: s => s.longestCombo >= 20,                   text: 'COMBO MACHINE' },
      { cond: s => s.perfects >= 5,                        text: 'CLEAN STRIKER' },
      { cond: s => s.wave >= 8,                            text: 'WALL DEFENDER' },
      { cond: s => s.longestCombo >= 10,                   text: 'IN THE ZONE' },
      { cond: s => s.wave >= 5,                            text: 'CHAOS SURVIVOR' },
      { cond: s => s.perfects >= 2,                        text: 'NICE TOUCH' },
      { cond: s => s.totalReturns >= 10,                   text: 'RALLY KEEPER' },
      { cond: s => s.totalReturns >= 3,                    text: 'WARMED UP' },
      { cond: s => true,                                   text: 'GAME OVER' },
    ];
    for (const t of T) if (t.cond(stats)) return t.text;
    return 'GAME OVER';
  },
};

PWC.motion = {
  ease: {
    pop: 'Back.easeOut',
    snap: 'Cubic.easeOut',
    swell: 'Sine.easeInOut',
    smash: 'Quad.easeIn',
  },
  dur: {
    quick: 120,
    snappy: 180,
    swell: 260,
    grand: 420,
  },
};

// ----- Persistent storage (localStorage) ---------------------------------
PWC.storage = {
  key: 'PWC:v1',
  data: null,

  load() {
    try {
      const raw = localStorage.getItem(this.key);
      this.data = raw ? JSON.parse(raw) : {};
    } catch (e) {
      this.data = {};
    }
    this.data.best = this.data.best || 0;
    this.data.bestCombo = this.data.bestCombo || 0;
    this.data.bestPerfects = this.data.bestPerfects || 0;
    this.data.runs = this.data.runs || 0;
    this.data.soundOn = this.data.soundOn !== false;
    this.data.hasPlayed = !!this.data.hasPlayed;
    this.data.daily = this.data.daily || {};
    return this.data;
  },

  save() {
    try {
      localStorage.setItem(this.key, JSON.stringify(this.data));
    } catch (e) { /* private mode — ignore */ }
  },

  set(k, v) { this.data[k] = v; this.save(); },
  get(k) { return this.data ? this.data[k] : undefined; },
};

// ----- Procedural audio (Web Audio API) ----------------------------------
// We synthesize SFX so the game is fully self-contained on GitHub Pages.
// Howler is loaded and available for future real audio assets; for now,
// procedural synthesis gives us a tight, consistent sound palette.
PWC.audio = {
  ctx: null,
  master: null,
  musicGain: null,
  enabled: true,
  unlocked: false,

  init() {
    if (this.ctx) return;
    try {
      const C = window.AudioContext || window.webkitAudioContext;
      this.ctx = new C();
      this.master = this.ctx.createGain();
      this.master.gain.value = 0.55;
      this.master.connect(this.ctx.destination);
      this.musicGain = this.ctx.createGain();
      this.musicGain.gain.value = 0.0;
      this.musicGain.connect(this.master);
    } catch (e) {
      this.ctx = null;
    }
  },

  unlock() {
    if (!this.ctx) this.init();
    if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume();
    this.unlocked = true;
  },

  setEnabled(v) { this.enabled = !!v; },

  _envOsc({ freq, type = 'sine', dur = 0.15, attack = 0.005, peak = 0.25, sweepTo = null, detune = 0 }) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(freq, t);
    if (sweepTo !== null) o.frequency.exponentialRampToValueAtTime(Math.max(20, sweepTo), t + dur);
    o.detune.value = detune;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + dur + 0.05);
  },

  _noise({ dur = 0.1, peak = 0.18, filter = 800, q = 1, sweep = null }) {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    const samples = Math.floor(this.ctx.sampleRate * dur);
    const buffer = this.ctx.createBuffer(1, samples, this.ctx.sampleRate);
    const d = buffer.getChannelData(0);
    for (let i = 0; i < samples; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource();
    src.buffer = buffer;
    const bp = this.ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = filter;
    bp.Q.value = q;
    if (sweep !== null) bp.frequency.exponentialRampToValueAtTime(Math.max(60, sweep), t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(peak, t);
    g.gain.exponentialRampToValueAtTime(0.0008, t + dur);
    src.connect(bp).connect(g).connect(this.master);
    src.start(t);
    src.stop(t + dur + 0.02);
  },

  hit(speedFactor = 1) {
    const pitch = 200 + Math.min(220, speedFactor * 60);
    this._envOsc({ freq: pitch, type: 'triangle', dur: 0.09, peak: 0.32, sweepTo: pitch * 0.5 });
    this._noise({ dur: 0.05, peak: 0.16, filter: 2400, q: 0.6 });
  },

  perfect() {
    // bright bell + sub thump
    [880, 1320, 1760].forEach((f, i) => {
      this._envOsc({ freq: f, type: 'sine', dur: 0.5 + i * 0.08, peak: 0.18 - i * 0.04, attack: 0.004 });
    });
    this._envOsc({ freq: 110, type: 'sine', dur: 0.18, peak: 0.28, sweepTo: 55 });
    this._noise({ dur: 0.04, peak: 0.12, filter: 5000, q: 0.5 });
  },

  wallSoft(speedFactor = 1) {
    const f = 320 + Math.min(360, speedFactor * 90);
    this._envOsc({ freq: f, type: 'sine', dur: 0.05, peak: 0.16, sweepTo: f * 0.6 });
  },

  comboUp(tier) {
    // 4-note pentatonic rising arpeggio
    const notes = [523, 659, 784, 988];
    notes.forEach((n, i) => {
      setTimeout(() => this._envOsc({ freq: n * (1 + tier * 0.02), type: 'triangle', dur: 0.14, peak: 0.16 }), i * 60);
    });
  },

  comboBreak() {
    if (!this.enabled || !this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(620, t);
    o.frequency.exponentialRampToValueAtTime(80, t + 0.55);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.22, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.6);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + 0.7);
    this._noise({ dur: 0.2, peak: 0.18, filter: 240, q: 1, sweep: 80 });
  },

  lifeLost() {
    this._envOsc({ freq: 140, type: 'square', dur: 0.18, peak: 0.28, sweepTo: 60 });
    this._noise({ dur: 0.18, peak: 0.22, filter: 1800, q: 1.5, sweep: 600 });
  },

  wave() {
    this._envOsc({ freq: 220, type: 'sine', dur: 0.7, peak: 0.18, sweepTo: 880 });
    this._noise({ dur: 0.45, peak: 0.12, filter: 1500, q: 0.7, sweep: 4000 });
  },

  uiTick() {
    this._envOsc({ freq: 1200, type: 'sine', dur: 0.04, peak: 0.12 });
  },

  uiConfirm() {
    this._envOsc({ freq: 660, type: 'triangle', dur: 0.08, peak: 0.18 });
    setTimeout(() => this._envOsc({ freq: 990, type: 'triangle', dur: 0.1, peak: 0.16 }), 50);
  },

  triplePerfect() {
    // brassy stab — three layered sawtooths
    [220, 330, 440].forEach(f => {
      this._envOsc({ freq: f, type: 'sawtooth', dur: 0.45, peak: 0.18 });
    });
    setTimeout(() => this.perfect(), 200);
  },

  // Soft crowd "woo" — bandpass-swept noise. Use sparingly on tier-ups.
  crowd(intensity = 1) {
    this._noise({ dur: 0.55 * intensity, peak: 0.10 + intensity * 0.05, filter: 600, q: 0.8, sweep: 1800 });
  },

  // Short, tense rising tone — for "almost PB" moments.
  tension() {
    this._envOsc({ freq: 440, type: 'sine', dur: 0.45, peak: 0.16, sweepTo: 880, attack: 0.02 });
  },

  // Single-shot whiff (player swung but missed) — very subtle.
  whiff() {
    this._noise({ dur: 0.06, peak: 0.06, filter: 1200, q: 1 });
  },

  duck(amount = 0.4, dur = 0.4) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.master.gain.cancelScheduledValues(t);
    this.master.gain.setValueAtTime(this.master.gain.value, t);
    this.master.gain.linearRampToValueAtTime(amount * 0.55, t + 0.04);
    this.master.gain.linearRampToValueAtTime(0.55, t + dur);
  },
};

// ----- Juice helpers ----------------------------------------------------
// Used by all scenes. Shake, freeze, flash, slow-mo, vignette, etc.
PWC.juice = {
  // Vibrate where supported (no-op otherwise). Respect a tap budget so we
  // never spam phones with haptics during chaos.
  _lastVibrate: 0,
  vibrate(pattern) {
    const now = performance.now();
    if (now - this._lastVibrate < 50) return;
    this._lastVibrate = now;
    if (navigator.vibrate) try { navigator.vibrate(pattern); } catch (e) {}
  },
};

// ----- Phaser game --------------------------------------------------------
window.addEventListener('load', () => {
  PWC.storage.load();
  PWC.audio.init();

  const cfg = {
    type: Phaser.AUTO,
    parent: 'game',
    backgroundColor: PWC.colors.bgHex,
    width: PWC.config.width,
    height: PWC.config.height,
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
      width: PWC.config.width,
      height: PWC.config.height,
    },
    physics: {
      default: 'arcade',
      arcade: {
        gravity: { x: 0, y: 0 },
        debug: false,
      },
    },
    render: {
      antialias: true,
      pixelArt: false,
      roundPixels: false,
      powerPreference: 'high-performance',
    },
    fps: {
      target: 60,
      forceSetTimeOut: false,
    },
    input: {
      activePointers: 2,
    },
    scene: [BootScene, MenuScene, GameScene, UIScene, GameOverScene],
  };

  window.PWC.game = new Phaser.Game(cfg);
});

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
    lerp: 0.22,
    hitZoneHeight: 110,
  },

  ball: {
    radius: 16,
    baseSpeed: 360,
    speedCap: 1080,
    perBounceMul: 1.035,
    perReturnMul: 1.07,
    serveTelegraphMs: 360,
  },

  swing: {
    windowMs: 130,
    perfectWindowMs: 60,
    cooldownMs: 90,
  },

  difficulty: {
    returnsPerWave: [4, 5, 6, 7, 8, 8, 9, 10, 10, 11, 12, 13, 14],
    jitterDegByWave: [0, 0, 2, 2, 3, 3, 4, 4, 5, 5, 6, 6, 7],
    mercyMisses: 2,
    mercyWindow: 5,
    mercyDurationReturns: 3,
    mercySpeedMul: 0.92,
  },

  combo: {
    multTable: [1.0, 1.0, 1.0, 1.2, 1.4, 1.6, 1.9, 2.3, 2.7, 3.2, 3.8, 4.5, 5.3, 6.2, 7.2],
    tierAt: [0, 3, 6, 10, 15, 20, 30],
    tierLabels: ['', 'NICE', 'HOT', 'BLAZING', 'INSANE', 'ON FIRE', 'CHAOS'],
  },

  scoring: {
    basePerHit: 100,
    perfectBonus: 250,
  },

  lives: 3,

  nearMissPx: 70,
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

// GameScene — simulation owner.
//
// v0.95 sprint: drag-to-position + release-to-swing input, spatial hit
// grading, predictive target marker, modifier balls, per-wave visual
// escalation, pooled effects, optional daily-seed mode, and an onboarding
// overlay for first-time players.

class GameScene extends Phaser.Scene {
  constructor() { super({ key: 'GameScene' }); }

  init(data) {
    this.mode = (data && data.mode) || 'endless';   // 'endless' | 'daily'
    this.skipIntro = !!(data && data.skipIntro);    // set true on rematch

    // Seed the PRNG — daily mode is deterministic for everyone today.
    if (this.mode === 'daily') {
      PWC.rng.seed(PWC.daily.seedFor(PWC.daily.todayISO()));
    } else {
      PWC.rng.seed((Date.now() & 0xffffffff) || 1);
    }
  }

  create() {
    const W = this.scale.width, H = this.scale.height;
    const C = PWC.colors;
    const cfg = PWC.config;

    this.W = W; this.H = H;

    // Run state ---------------------------------------------------------
    this.state = 'WAITING';
    this.score = 0;
    this.combo = 0;
    this.comboTier = 0;
    this.lives = cfg.lives;
    this.wave = 1;
    this.returnsInWave = 0;
    this.totalReturns = 0;
    this.totalWallBounces = 0;
    this.perfectsThisRun = 0;
    this.perfectStreak = 0;
    this.longestComboThisRun = 0;
    this.recentMisses = [];
    this.mercyReturnsLeft = 0;
    this.runStartedAt = performance.now();
    this.almostFired = false;
    this.servesDone = 0;
    this._timeScale = 1;

    this.cameras.main.fadeIn(220, 14, 29, 42);
    this.cameras.main.setBackgroundColor(C.bgHex);

    this.drawCourt();
    this.wallFx = {
      top:   this.makeWallFlash('top'),
      left:  this.makeWallFlash('left'),
      right: this.makeWallFlash('right'),
    };

    this.vignette = this.add.graphics().setDepth(50).setScrollFactor(0);
    this.vignettePulse = 0;
    this.crackFx = this.add.graphics().setDepth(40).setScrollFactor(0);

    // Ball
    this.ball = this.physics.add.image(W / 2, cfg.court.top + 60, 'ball').setTint(C.ball);
    this.ball.setCircle(cfg.ball.radius, this.ball.width / 2 - cfg.ball.radius, this.ball.height / 2 - cfg.ball.radius);
    this.ball.setBounce(1, 1);
    this.ball.setVisible(false);
    this.ball.body.setAllowGravity(false);
    this.ball.modifier = null;          // 'curve' | 'surge' | null
    this.ball.curvePhase = 0;
    this.ball.curveAmp = 0;

    // Trail
    this.trail = this.add.particles(0, 0, 'particle', {
      follow: this.ball, lifespan: 360,
      scale: { start: 1.1, end: 0 }, alpha: { start: 0.75, end: 0 },
      tint: C.trail, quantity: 1, frequency: 14,
      blendMode: 'ADD', emitting: false,
    });

    // Racket
    this.racket = this.add.image(W / 2, cfg.racket.y, 'racket').setTint(C.text);
    this.racket.targetX = W / 2;
    this.racketGlow = this.add.image(this.racket.x, this.racket.y, 'glow')
      .setScale(3, 0.6).setAlpha(0.25).setTint(C.text).setBlendMode('ADD');

    // Sweet-spot marker on the racket — a thin glowing line just above the
    // bar that makes the impact zone visible.
    this.sweetLine = this.add.rectangle(this.racket.x, this.racket.y + cfg.racket.sweetSpotOffsetY, cfg.racket.width - 16, 2, 0xffffff, 0.18).setBlendMode('ADD').setDepth(11);

    // Predictive target marker (the cue that teaches timing without text)
    this.targetMarker = this.add.image(W / 2, cfg.racket.y - 6, 'target')
      .setAlpha(0).setBlendMode('ADD').setDepth(8).setTint(C.text);

    // Pools / shared FX emitters ---------------------------------------
    this.initEffects();

    // Input ------------------------------------------------------------
    this.touchActive = false;
    this.setupInput();

    this.events.on('shutdown', () => this.shutdown());

    this.scene.launch('UIScene', { mode: this.mode, dayNumber: this.mode === 'daily' ? PWC.daily.dayNumber() : 0 });
    this.scene.bringToTop('UIScene');

    // First-ever-play onboarding overlay (only on very first run).
    const isFirstEver = !PWC.storage.get('hasPlayed');
    if (isFirstEver) {
      this.showTutorialOverlay();
      // Mark "played" only once they've actually started moving.
      this.once('tutorialDismissed', () => {
        PWC.storage.set('hasPlayed', true);
        this.time.delayedCall(220, () => this.serveBall());
      });
    } else {
      // Quick "GO" pulse — no slow countdown — then immediate serve.
      if (!this.skipIntro) this.showQuickGo();
      this.time.delayedCall(this.skipIntro ? 180 : 260, () => this.serveBall());
    }
  }

  // ---------------------------------------------------------------------
  // POOLED EFFECTS — single long-lived emitter per FX type, sprite pools
  // for rings/coronas/flashes. The hot path no longer allocates.
  // ---------------------------------------------------------------------
  initEffects() {
    const C = PWC.colors;

    // Hit burst (glow particles, upward fan)
    this.fxHit = this.add.particles(0, 0, 'particle', {
      speed: { min: 140, max: 380 },
      angle: { min: -180, max: 0 },
      lifespan: { min: 240, max: 520 },
      scale: { start: 1.0, end: 0 },
      alpha: { start: 1, end: 0 },
      blendMode: 'ADD',
      emitting: false,
    });

    // Sparks (crisp chips)
    this.fxSparks = this.add.particles(0, 0, 'spark', {
      speed: { min: 200, max: 560 },
      angle: { min: -180, max: 0 },
      lifespan: { min: 160, max: 320 },
      scale: { start: 1.2, end: 0 },
      alpha: { start: 1, end: 0 },
      blendMode: 'ADD',
      emitting: false,
    });

    // Wall bounce sparks
    this.fxBounce = this.add.particles(0, 0, 'particle', {
      speed: { min: 80, max: 220 },
      angle: { min: 0, max: 360 },
      lifespan: { min: 180, max: 320 },
      scale: { start: 0.7, end: 0 },
      alpha: { start: 0.9, end: 0 },
      tint: 0xffffff,
      blendMode: 'ADD',
      emitting: false,
    });

    // Combo-break particles
    this.fxBreak = this.add.particles(0, 0, 'particle', {
      speed: { min: 100, max: 300 },
      angle: { min: 0, max: 360 },
      lifespan: { min: 500, max: 900 },
      scale: { start: 1, end: 0 },
      alpha: { start: 1, end: 0 },
      tint: C.danger,
      blendMode: 'ADD',
      emitting: false,
    });

    // Ring pool (4) — for serve telegraph + perfect-hit rings
    this.poolRings = new PWC.Pool(() => {
      const r = this.add.image(0, 0, 'ring').setVisible(false).setBlendMode('ADD');
      return r;
    }, 4);

    // Corona pool (2) — perfect hit ball glow
    this.poolCorona = new PWC.Pool(() => {
      return this.add.image(0, 0, 'glow').setVisible(false).setBlendMode('ADD');
    }, 2);

    // Full-screen flash pool (2) — perfect screen flash + danger flash
    this.poolFlash = new PWC.Pool(() => {
      return this.add.rectangle(this.W / 2, this.H / 2, this.W, this.H, 0xffffff, 0)
        .setDepth(60).setVisible(false);
    }, 2);
  }

  acquireRing(x, y, tint, scale, alpha) {
    const r = this.poolRings.acquire();
    r.setPosition(x, y).setTint(tint).setScale(scale).setAlpha(alpha).setVisible(true);
    return r;
  }
  releaseRing(r) {
    r.setVisible(false);
    this.poolRings.release(r);
  }
  acquireCorona(x, y, tint) {
    const c = this.poolCorona.acquire();
    c.setPosition(x, y).setTint(tint).setVisible(true).setAlpha(0.9).setScale(1.2);
    return c;
  }
  releaseCorona(c) {
    c.setVisible(false);
    this.poolCorona.release(c);
  }
  flashScreen(color, alpha = 0.2, dur = 380) {
    const f = this.poolFlash.acquire();
    f.setFillStyle(color, alpha).setAlpha(alpha).setVisible(true);
    this.tweens.add({
      targets: f,
      alpha: 0,
      duration: dur,
      ease: 'Cubic.easeOut',
      onComplete: () => { f.setVisible(false); this.poolFlash.release(f); },
    });
  }

  // ---------------------------------------------------------------------
  // COURT + WALL FX (unchanged structure, kept tight)
  // ---------------------------------------------------------------------
  drawCourt() {
    const W = this.W, H = this.H;
    const c = PWC.config.court;
    const C = PWC.colors;

    this.bgGfx = this.add.graphics().setDepth(-10);
    this.courtPanel = this.add.graphics().setDepth(-9);
    this.repaintCourt(C.court);
  }

  repaintCourt(courtColor) {
    const W = this.W, H = this.H;
    const c = PWC.config.court;
    const C = PWC.colors;
    this.bgGfx.clear();
    this.bgGfx.fillStyle(C.bg, 1).fillRect(0, 0, W, H);
    this.courtPanel.clear();
    this.courtPanel.fillStyle(courtColor, 1);
    this.courtPanel.fillRoundedRect(c.left - 12, c.top - 12, (c.right - c.left) + 24, (c.bottom - c.top) + 24, 18);
    for (let i = 0; i < 60; i++) {
      this.courtPanel.fillStyle(C.courtAccent, (1 - i / 60) * 0.10);
      this.courtPanel.fillRect(c.left, c.top + i, c.right - c.left, 1);
    }
    for (let y = c.top + 24; y < c.bottom - 24; y += 18) {
      this.courtPanel.fillStyle(0xffffff, 0.07);
      this.courtPanel.fillRect((c.left + c.right) / 2 - 1, y, 2, 8);
    }
    this.courtPanel.lineStyle(2, 0xffffff, 0.22);
    this.courtPanel.strokeRoundedRect(c.left, c.top, c.right - c.left, c.bottom - c.top, 6);
    this.courtPanel.fillStyle(0xffffff, 0.05);
    this.courtPanel.fillRect(c.left, c.bottom - 1, c.right - c.left, 2);
  }

  makeWallFlash(side) {
    const c = PWC.config.court;
    let x, y, w, h;
    if (side === 'top')   { x = c.left;      y = c.top - 4;     w = c.right - c.left; h = 6; }
    if (side === 'left')  { x = c.left - 4;  y = c.top;         w = 6;                h = c.bottom - c.top; }
    if (side === 'right') { x = c.right - 2; y = c.top;         w = 6;                h = c.bottom - c.top; }
    return this.add.rectangle(x + w / 2, y + h / 2, w, h, 0xffffff, 0).setBlendMode('ADD').setDepth(5);
  }

  flashWall(side, intensity = 1) {
    const r = this.wallFx[side];
    if (!r) return;
    r.setAlpha(0.7 * intensity);
    this.tweens.killTweensOf(r);
    this.tweens.add({ targets: r, alpha: 0, duration: 260, ease: 'Quad.easeOut' });
  }

  // ---------------------------------------------------------------------
  // INPUT — drag-to-position, release-to-swing.
  // The release IS the swing. No hidden timing window.
  // ---------------------------------------------------------------------
  setupInput() {
    const cfg = PWC.config;
    const clamp = (x) => Phaser.Math.Clamp(x, cfg.court.left + cfg.racket.width / 2, cfg.court.right - cfg.racket.width / 2);

    this.input.on('pointerdown', (p) => {
      if (!this.acceptsInput()) return;
      this.touchActive = true;
      // Snap racket to finger immediately (no perceptible lag).
      this.racket.x = clamp(p.x);
      this.racket.targetX = clamp(p.x);
      this.armRacket();
      // If the tutorial overlay is up, dismiss on first interaction.
      this.dismissTutorialIfOpen();
    });

    this.input.on('pointermove', (p) => {
      if (!this.touchActive || !p.isDown) return;
      if (!this.acceptsInput()) return;
      this.racket.targetX = clamp(p.x);
    });

    this.input.on('pointerup', () => {
      if (!this.touchActive) return;
      this.touchActive = false;
      this.disarmRacket();
      this.fireSwing();
    });

    // Keyboard (desktop): arrows position, space fires
    this.cursors = this.input.keyboard.createCursorKeys();
    this.input.keyboard.on('keydown-SPACE', () => {
      if (this.acceptsInput()) this.fireSwing();
    });
    this.input.keyboard.on('keydown-ENTER', () => {
      if (this.acceptsInput()) this.fireSwing();
    });
  }

  acceptsInput() {
    return this.state === 'IN_PLAY' || this.state === 'WAITING';
  }

  armRacket() {
    this.racket.setTint(PWC.colors.perfect);
    this.tweens.killTweensOf(this.racketGlow);
    this.tweens.add({ targets: this.racketGlow, alpha: 0.55, scaleY: 1.0, duration: 120, ease: 'Quad.easeOut' });
  }

  disarmRacket() {
    this.racket.setTint(PWC.colors.text);
    this.tweens.killTweensOf(this.racketGlow);
    this.tweens.add({ targets: this.racketGlow, alpha: 0.25, scaleY: 0.6, duration: 240, ease: 'Quad.easeOut' });
  }

  // ---------------------------------------------------------------------
  // SWING — fires at release. Spatial grading on ball position.
  // ---------------------------------------------------------------------
  fireSwing() {
    const grade = this.gradeSwing();
    if (grade === 'whiff') {
      this.whiffEffect();
      return;
    }
    this.applyHit({ perfect: grade === 'perfect' });
  }

  gradeSwing() {
    const cfg = PWC.config;
    const b = this.ball;
    const r = this.racket;

    if (!b.visible) return 'whiff';
    if (b.body.velocity.y <= 0) return 'whiff'; // moving up — already returned

    const halfW = cfg.racket.width / 2 + cfg.ball.radius + cfg.racket.xToleranceExtraPx;
    if (Math.abs(b.x - r.x) > halfW) return 'whiff';

    const sweetY = r.y + cfg.racket.sweetSpotOffsetY;
    const yDist = Math.abs(b.y - sweetY);
    if (yDist <= cfg.racket.perfectBandPx) return 'perfect';
    if (yDist <= cfg.racket.goodBandPx) return 'good';
    return 'whiff';
  }

  whiffEffect() {
    // Tiny, low-confidence racket flash. Teaches "swing registered, ball missed".
    PWC.audio.whiff();
    this.tweens.killTweensOf(this.racket);
    this.tweens.add({
      targets: this.racket,
      scaleX: 1.10, scaleY: 0.92,
      duration: 60, yoyo: true, ease: 'Quad.easeOut',
    });
  }

  // ---------------------------------------------------------------------
  // SERVE — uses seeded RNG so daily mode is deterministic.
  // First few serves of a run are warmup (slower, longer telegraph).
  // ---------------------------------------------------------------------
  serveBall() {
    if (this.state === 'DEAD') return;
    this.state = 'WAITING';

    const cfg = PWC.config;
    const c = cfg.court;
    const isWarmup = this.servesDone < cfg.onboarding.warmupServes;

    // Side: top is the friendlier opening; sides unlock at wave 4
    const sides = (this.wave >= 4 && !isWarmup) ? ['top', 'top', 'left', 'right'] : ['top', 'top', 'top'];
    const side = PWC.rng.pick(sides);

    let x, y, angleDeg;
    if (side === 'top') {
      x = PWC.rng.intBetween(c.left + 80, c.right - 80);
      y = c.top + 30;
      // Warmup serves: tighter angle, more central
      angleDeg = isWarmup
        ? PWC.rng.intBetween(80, 100)
        : PWC.rng.intBetween(60, 120);
    } else if (side === 'left') {
      x = c.left + 30;
      y = PWC.rng.intBetween(c.top + 60, c.top + 220);
      angleDeg = PWC.rng.intBetween(20, 70);
    } else {
      x = c.right - 30;
      y = PWC.rng.intBetween(c.top + 60, c.top + 220);
      angleDeg = PWC.rng.intBetween(110, 160);
    }

    // Choose modifier (post-warmup only, and only above modifier wave gates)
    let modifier = null;
    let serveTint = PWC.colors.ball;
    if (!isWarmup) {
      const mc = cfg.modifiers.curveball;
      const ms = cfg.modifiers.surge;
      const roll = PWC.rng.next();
      if (this.wave >= ms.startWave && roll < ms.chance) {
        modifier = 'surge'; serveTint = ms.tint;
      } else if (this.wave >= mc.startWave && roll < mc.chance + (this.wave >= ms.startWave ? ms.chance : 0)) {
        modifier = 'curve'; serveTint = mc.tint;
      }
    }
    this.ball.modifier = modifier;
    this.ball.curvePhase = PWC.rng.next() * Math.PI * 2;
    this.ball.curveAmp = modifier === 'curve' ? cfg.modifiers.curveball.amplitude : 0;

    // Reset & telegraph
    this.tweens.killTweensOf(this.ball);
    this.ball.setPosition(x, y).setVelocity(0, 0).setScale(0.2).setAlpha(0).setVisible(true).setTint(serveTint);
    this.trail.particleTint = serveTint; // best-effort; new particles inherit
    this.trail.emitting = false;

    const ring = this.acquireRing(x, y, serveTint, 0.5, 0.7);
    this.tweens.add({
      targets: ring, scale: 2.2, alpha: 0,
      duration: 360, ease: 'Cubic.easeOut',
      onComplete: () => this.releaseRing(ring),
    });

    const telegraphMs = isWarmup ? cfg.onboarding.warmupTelegraphMs : cfg.ball.serveTelegraphMs;

    this.tweens.add({
      targets: this.ball, scale: 1.05, alpha: 1,
      duration: telegraphMs * 0.7, ease: 'Back.easeOut',
    });

    this.time.delayedCall(telegraphMs, () => {
      this.tweens.add({ targets: this.ball, scale: 1, duration: 120, ease: 'Sine.easeOut' });
      let speed = this.currentBaseSpeed();
      if (isWarmup) speed *= cfg.onboarding.warmupSpeedMul;
      if (modifier === 'surge') speed *= cfg.modifiers.surge.speedMul;
      const rad = Phaser.Math.DegToRad(angleDeg);
      this.ball.setVelocity(Math.cos(rad) * speed, Math.sin(rad) * speed);
      this.trail.emitting = true;
      this.state = 'IN_PLAY';
      this.servesDone++;
    });
  }

  currentBaseSpeed() {
    const base = PWC.config.ball.baseSpeed;
    const waveMul = 1 + (this.wave - 1) * 0.05;
    const mercy = this.mercyReturnsLeft > 0 ? PWC.config.difficulty.mercySpeedMul : 1;
    return base * waveMul * mercy;
  }

  // ---------------------------------------------------------------------
  // UPDATE LOOP
  // ---------------------------------------------------------------------
  update(_, dtMs) {
    const dt = Math.min(dtMs, 32) / 1000;
    const cfg = PWC.config;

    // Racket follow (snap when far, fast lerp when near)
    const dxR = this.racket.targetX - this.racket.x;
    if (Math.abs(dxR) > cfg.racket.followSnapPx * 8) {
      this.racket.x = this.racket.targetX;
    } else {
      this.racket.x += dxR * cfg.racket.followLerp;
    }
    this.racketGlow.x = this.racket.x;
    this.sweetLine.x = this.racket.x;

    // Keyboard fallback positioning
    if (this.cursors) {
      const step = 22;
      const left = Math.max(cfg.court.left + cfg.racket.width / 2, this.racket.targetX - step);
      const right = Math.min(cfg.court.right - cfg.racket.width / 2, this.racket.targetX + step);
      if (this.cursors.left.isDown)  this.racket.targetX = left;
      if (this.cursors.right.isDown) this.racket.targetX = right;
    }

    if (this.state === 'IN_PLAY') {
      this.updateBall(dt);
      this.updateTargetMarker();
    } else {
      this.targetMarker.setAlpha(0);
    }

    // Vignette pulse on final life
    if (this.lives <= 1 && this.state === 'IN_PLAY') {
      this.vignettePulse += dt * 5;
      const a = 0.10 + Math.sin(this.vignettePulse) * 0.05;
      this.drawVignette(PWC.colors.danger, a);
    } else if (this.vignette && this._vignetteActive) {
      this.vignette.clear();
      this._vignetteActive = false;
    }

    // Racket "approach glow" — brighten as ball nears
    if (this.ball.visible && this.ball.body.velocity.y > 0) {
      const dist = Math.abs(this.ball.y - this.racket.y);
      const near = Phaser.Math.Clamp(1 - dist / 500, 0, 1);
      if (!this.touchActive) this.racketGlow.setAlpha(0.18 + near * 0.35);
    }
  }

  drawVignette(color, alpha) {
    const W = this.W, H = this.H;
    this.vignette.clear();
    // Single rounded stroke — cheaper than the multi-layer version.
    this.vignette.lineStyle(80, color, alpha * 0.5);
    this.vignette.strokeRect(0, 0, W, H);
    this.vignette.lineStyle(40, color, alpha);
    this.vignette.strokeRect(0, 0, W, H);
    this._vignetteActive = true;
  }

  // ---------------------------------------------------------------------
  // BALL MOTION + modifier behavior + wall collision
  // ---------------------------------------------------------------------
  updateBall(dt) {
    const c = PWC.config.court;
    const b = this.ball;
    const r = PWC.config.ball.radius;

    // Curveball: sinusoidal lateral acceleration
    if (b.modifier === 'curve') {
      b.curvePhase += PWC.config.modifiers.curveball.frequency * (dt * 1000);
      const lateral = Math.cos(b.curvePhase) * b.curveAmp * dt;
      b.x += lateral;
    }

    // Wall collisions
    if (b.x - r <= c.left && b.body.velocity.x < 0) {
      b.x = c.left + r;
      b.body.velocity.x = -b.body.velocity.x;
      this.onWallBounce('left');
    } else if (b.x + r >= c.right && b.body.velocity.x > 0) {
      b.x = c.right - r;
      b.body.velocity.x = -b.body.velocity.x;
      this.onWallBounce('right');
    }
    if (b.y - r <= c.top && b.body.velocity.y < 0) {
      b.y = c.top + r;
      b.body.velocity.y = -b.body.velocity.y;
      this.onWallBounce('top');
    }

    if (b.y - r > c.bottom + 30) this.onMiss();

    b.rotation += (b.body.velocity.x / 600) * dt * 6;
  }

  onWallBounce(side) {
    const cfg = PWC.config;
    const b = this.ball;
    const v = b.body.velocity;
    const speed = Math.hypot(v.x, v.y);
    const newSpeed = Math.min(cfg.ball.speedCap, speed * cfg.ball.perBounceMul);
    const scale = newSpeed / Math.max(1, speed);
    b.body.velocity.x *= scale;
    b.body.velocity.y *= scale;

    const jitterIdx = Math.min(this.wave - 1, cfg.difficulty.jitterDegByWave.length - 1);
    const jitterDeg = cfg.difficulty.jitterDegByWave[jitterIdx] || 0;
    if (jitterDeg > 0) {
      const jr = (PWC.rng.next() * 2 - 1) * jitterDeg * Math.PI / 180;
      const cosA = Math.cos(jr), sinA = Math.sin(jr);
      const vx = b.body.velocity.x, vy = b.body.velocity.y;
      b.body.velocity.x = vx * cosA - vy * sinA;
      b.body.velocity.y = vx * sinA + vy * cosA;
    }

    this.totalWallBounces++;
    this.flashWall(side, Math.min(1, speed / 800));
    PWC.audio.wallSoft(speed / cfg.ball.baseSpeed);

    const ix = side === 'left' ? cfg.court.left : side === 'right' ? cfg.court.right : b.x;
    const iy = side === 'top' ? cfg.court.top : b.y;
    this.fxBounce.explode(6, ix, iy);
  }

  // ---------------------------------------------------------------------
  // TARGET MARKER — predicts where the ball will cross the racket line.
  // Color/size tells the player WHEN to release.
  // ---------------------------------------------------------------------
  updateTargetMarker() {
    const cfg = PWC.config;
    const b = this.ball;

    if (!b.visible || b.body.velocity.y <= 0) {
      this.targetMarker.setAlpha(0);
      return;
    }

    const targetY = this.racket.y + cfg.racket.sweetSpotOffsetY;
    const pred = this.predictBallAtY(targetY);
    if (!pred) { this.targetMarker.setAlpha(0); return; }

    this.targetMarker.x = pred.x;
    this.targetMarker.y = targetY;

    // Proximity: 0 (far) → 1 (here right now)
    const distRemaining = pred.distTravelled;
    const totalDist = pred.distTravelled + Math.abs(b.y - targetY);
    const proximity = 1 - Phaser.Math.Clamp(distRemaining / Math.max(1, totalDist + 200), 0, 1);

    // In perfect Y zone? bright cyan : neutral white
    const ballYDistToSweet = Math.abs(b.y - targetY);
    const inPerfectBand = ballYDistToSweet <= cfg.racket.perfectBandPx;
    const inGoodBand = ballYDistToSweet <= cfg.racket.goodBandPx;

    let tint = 0xffffff;
    let alpha = 0.25 + proximity * 0.55;
    if (inGoodBand) { tint = PWC.colors.text; alpha = 0.8; }
    if (inPerfectBand) { tint = PWC.colors.perfect; alpha = 1.0; }

    this.targetMarker.setTint(tint);
    this.targetMarker.setAlpha(alpha);

    // Marker contracts as ball approaches — the visual "incoming"
    const scale = 1.6 - proximity * 1.0;
    this.targetMarker.setScale(scale);
  }

  // Forward-simulate the ball (with current velocity & walls) until it
  // crosses targetY. Returns {x, distTravelled} or null if it never will.
  predictBallAtY(targetY) {
    const cfg = PWC.config;
    const c = cfg.court;
    let x = this.ball.x, y = this.ball.y;
    let vx = this.ball.body.velocity.x, vy = this.ball.body.velocity.y;
    if (vy <= 0) return null;
    const r = cfg.ball.radius;
    const stepMs = 8;
    const dt = stepMs / 1000;
    let traveled = 0;
    for (let i = 0; i < 600; i++) {
      const nx = x + vx * dt;
      const ny = y + vy * dt;
      // wall bounce (no jitter in prediction — simple)
      if (nx - r <= c.left)  { vx = Math.abs(vx); }
      if (nx + r >= c.right) { vx = -Math.abs(vx); }
      if (ny - r <= c.top)   { vy = Math.abs(vy); }
      x += vx * dt;
      y += vy * dt;
      traveled += Math.hypot(vx, vy) * dt;
      if (y >= targetY) {
        // Linear interp last step for accuracy
        const overshoot = y - targetY;
        const t = overshoot / Math.max(1, vy * dt);
        x -= vx * dt * t;
        return { x, distTravelled: traveled };
      }
    }
    return null;
  }

  // ---------------------------------------------------------------------
  // HIT — applies physics, scores, juice. Now called from fireSwing only.
  // ---------------------------------------------------------------------
  applyHit({ perfect }) {
    const cfg = PWC.config;
    const C = PWC.colors;
    const b = this.ball;

    const dx = b.x - this.racket.x;
    const angleInfluence = dx / (cfg.racket.width * 0.55);
    const speed = Math.hypot(b.body.velocity.x, b.body.velocity.y);
    const newSpeed = Math.min(cfg.ball.speedCap, speed * cfg.ball.perReturnMul * (perfect ? 1.30 : 1));
    const upAngle = Phaser.Math.DegToRad(-90 + angleInfluence * 35);
    b.body.velocity.x = Math.cos(upAngle) * newSpeed;
    b.body.velocity.y = Math.sin(upAngle) * newSpeed;

    // Combo + score
    this.combo += perfect ? 3 : 1;
    this.longestComboThisRun = Math.max(this.longestComboThisRun, this.combo);
    const tier = this.tierFromCombo(this.combo);
    const tierUp = tier > this.comboTier;
    this.comboTier = tier;

    const mult = this.comboMultiplier();
    const base = cfg.scoring.basePerHit + (perfect ? cfg.scoring.perfectBonus : 0);
    const gained = Math.round(base * mult);
    this.score += gained;

    this.totalReturns++;
    this.returnsInWave++;
    if (this.mercyReturnsLeft > 0) this.mercyReturnsLeft--;
    if (perfect) {
      this.perfectsThisRun++;
      this.perfectStreak++;
      if (this.perfectStreak === 3) this.onTriplePerfect();
    } else {
      this.perfectStreak = 0;
    }

    // Events
    const E = PWC.events;
    this.game.events.emit(E.SCORE_CHANGED, { score: this.score, gained, x: this.racket.x, y: this.racket.y - 36, perfect });
    this.game.events.emit(E.COMBO_CHANGED, { combo: this.combo, tier, tierUp, perfect });

    // Audio
    if (perfect) PWC.audio.perfect();
    else PWC.audio.hit(speed / cfg.ball.baseSpeed);
    if (tierUp) {
      PWC.audio.comboUp(tier);
      this.game.events.emit(E.COMBO_TIER_UP, { tier });
      if (tier >= 2) PWC.audio.crowd(Math.min(1, 0.4 + tier * 0.15));
    }

    // Visuals
    this.hitBurst(this.racket.x, this.racket.y - 18, perfect);
    this.cameras.main.shake(perfect ? 140 : 70, perfect ? 0.008 : 0.0035);
    this.tweens.killTweensOf(this.racket);
    this.tweens.add({
      targets: this.racket,
      scaleX: 1.18, scaleY: 0.7,
      duration: 70, yoyo: true, ease: 'Quad.easeOut',
    });

    if (perfect) {
      this.perfectMoment(this.racket.x, this.racket.y - 18);
    } else {
      this.cameras.main.zoomTo(1.02, 70, 'Cubic.easeOut');
      this.time.delayedCall(140, () => this.cameras.main.zoomTo(1.0, 180, 'Cubic.easeOut'));
      PWC.juice.vibrate(8);
    }

    // "Almost PB" tension — fires once, when player crosses 85% of PB
    this.checkAlmostPB();

    // Wave progression
    if (this.returnsInWave >= this.returnsNeededThisWave()) this.advanceWave();
  }

  hitBurst(x, y, perfect) {
    const tint = perfect ? PWC.colors.perfect : 0xffffff;
    // Reconfigure pooled emitters per shot — config is mutable on the emitter.
    this.fxHit.particleTint = tint;
    this.fxHit.setParticleTint && this.fxHit.setParticleTint(tint);
    this.fxHit.explode(perfect ? 22 : 12, x, y);
    this.fxSparks.particleTint = tint;
    this.fxSparks.setParticleTint && this.fxSparks.setParticleTint(tint);
    this.fxSparks.explode(perfect ? 14 : 8, x, y);
  }

  perfectMoment(x, y) {
    const C = PWC.colors;
    // Double cyan ring
    const ring1 = this.acquireRing(x, y, C.perfect, 0.4, 0.95);
    this.tweens.add({
      targets: ring1, scale: 3.2, alpha: 0,
      duration: 480, ease: 'Cubic.easeOut',
      onComplete: () => this.releaseRing(ring1),
    });
    const ring2 = this.acquireRing(x, y, C.perfect, 0.2, 0.8);
    this.tweens.add({
      targets: ring2, scale: 5.0, alpha: 0,
      duration: 720, delay: 80, ease: 'Cubic.easeOut',
      onComplete: () => this.releaseRing(ring2),
    });

    this.freezeFrame(80);
    setTimeout(() => this.slowMo(0.4, 180), 95);

    this.cameras.main.zoomTo(1.06, 110, 'Cubic.easeOut');
    this.time.delayedCall(230, () => this.cameras.main.zoomTo(1.0, 300, 'Quad.easeOut'));

    const origScale = this.ball.scaleX;
    this.tweens.add({
      targets: this.ball, scale: origScale * 1.45,
      duration: 130, yoyo: true, ease: 'Quad.easeOut',
    });
    const corona = this.acquireCorona(this.ball.x, this.ball.y, C.perfect);
    this.tweens.add({
      targets: corona, scale: 2.8, alpha: 0,
      duration: 380, ease: 'Cubic.easeOut',
      onComplete: () => this.releaseCorona(corona),
    });

    PWC.juice.vibrate([4, 6, 12]);
  }

  onTriplePerfect() {
    PWC.audio.triplePerfect();
    this.game.events.emit(PWC.events.TRIPLE_PERFECT, {});
    this.flashScreen(PWC.colors.perfect, 0.25, 380);
    this.cameras.main.shake(200, 0.012);
  }

  checkAlmostPB() {
    if (this.almostFired || this.mode !== 'endless') return;
    const pb = PWC.storage.get('best') || 0;
    if (pb < 1000) return;
    if (this.score >= pb * PWC.config.almostBestPct && this.score < pb) {
      this.almostFired = true;
      this.game.events.emit(PWC.events.ALMOST_PB, { score: this.score, best: pb });
      PWC.audio.tension();
    }
  }

  // ---------------------------------------------------------------------
  // MISS
  // ---------------------------------------------------------------------
  onMiss() {
    if (this.state === 'DYING' || this.state === 'DEAD') return;
    this.state = 'DYING';

    const wasNearMiss = Math.abs(this.ball.x - this.racket.x) < PWC.config.nearMissPx;

    this.ball.setVelocity(0, 0);
    this.trail.emitting = false;
    this.targetMarker.setAlpha(0);

    const now = performance.now();
    this.recentMisses.push({ at: now, returnsAt: this.totalReturns });
    this.recentMisses = this.recentMisses.filter(m => this.totalReturns - m.returnsAt <= PWC.config.difficulty.mercyWindow);

    const comboLost = this.combo;
    const tierLost = this.comboTier;
    this.perfectStreak = 0;

    const isDramatic = wasNearMiss || comboLost >= 5;
    if (isDramatic) {
      this.slowMo(0.28, 320);
      PWC.audio.duck(0.35, 0.5);
    }

    this.drawCourtCrack(this.ball.x);
    this.flashScreen(PWC.colors.danger, 0.18, 380);
    this.cameras.main.shake(220, 0.012 + Math.min(0.02, comboLost * 0.001));

    if (comboLost >= 5) {
      PWC.audio.comboBreak();
      this.fxBreak.particleTint = PWC.colors.danger;
      this.fxBreak.setParticleTint && this.fxBreak.setParticleTint(PWC.colors.danger);
      this.fxBreak.explode(Math.min(30, 6 + comboLost * 2), this.ball.x, this.ball.y);
    }
    PWC.audio.lifeLost();
    PWC.juice.vibrate([20, 40, 20]);

    this.combo = 0;
    this.comboTier = 0;
    this.returnsInWave = 0;
    this.lives -= 1;
    if (this.recentMisses.length >= PWC.config.difficulty.mercyMisses) {
      this.mercyReturnsLeft = PWC.config.difficulty.mercyDurationReturns;
    }

    const E = PWC.events;
    this.game.events.emit(E.COMBO_BROKEN, { lost: comboLost, tier: tierLost, x: this.ball.x, y: this.ball.y });
    this.game.events.emit(E.LIFE_LOST, { lives: this.lives });

    this.tweens.add({
      targets: this.ball, alpha: 0, scale: 0.4,
      duration: 380, delay: 200, ease: 'Cubic.easeIn',
    });

    const delayBeforeNext = isDramatic ? 950 : 700;
    this.time.delayedCall(delayBeforeNext, () => {
      if (this.lives <= 0) this.endRun();
      else this.serveBall();
    });
  }

  drawCourtCrack(centerX) {
    const c = PWC.config.court;
    const g = this.crackFx;
    g.clear();
    const baseX = Phaser.Math.Clamp(centerX, c.left + 20, c.right - 20);
    const startY = c.bottom;
    g.lineStyle(2, PWC.colors.danger, 0.85);
    const branches = 5;
    for (let i = 0; i < branches; i++) {
      const angle = Phaser.Math.DegToRad(-90 + Phaser.Math.Between(-60, 60));
      let x = baseX, y = startY;
      g.beginPath();
      g.moveTo(x, y);
      for (let s = 0; s < 5; s++) {
        x += Math.cos(angle + Phaser.Math.FloatBetween(-0.5, 0.5)) * Phaser.Math.Between(20, 60);
        y += Math.sin(angle + Phaser.Math.FloatBetween(-0.5, 0.5)) * Phaser.Math.Between(20, 60);
        g.lineTo(x, y);
      }
      g.strokePath();
    }
    g.setAlpha(1);
    this.tweens.add({
      targets: g, alpha: 0, duration: 900, ease: 'Cubic.easeOut',
      onComplete: () => g.clear(),
    });
  }

  // ---------------------------------------------------------------------
  // WAVES — escalation, visual tint, breathing
  // ---------------------------------------------------------------------
  returnsNeededThisWave() {
    const t = PWC.config.difficulty.returnsPerWave;
    return t[Math.min(this.wave - 1, t.length - 1)];
  }

  advanceWave() {
    this.wave++;
    this.returnsInWave = 0;
    this.game.events.emit(PWC.events.WAVE_ADVANCED, { wave: this.wave });
    PWC.audio.wave();

    this.cameras.main.zoomTo(0.96, 240, 'Cubic.easeOut');
    this.time.delayedCall(300, () => this.cameras.main.zoomTo(1.0, 320, 'Cubic.easeOut'));

    // Court tint shift — subtle, escalating palette
    const tints = PWC.config.escalation.courtTintByWave;
    const target = tints[Math.min(this.wave - 1, tints.length - 1)];
    this.tweenCourtTint(target);
  }

  tweenCourtTint(targetColor) {
    if (this._currentCourtTint === targetColor) return;
    const fromColor = this._currentCourtTint || PWC.colors.court;
    this._currentCourtTint = targetColor;
    const fromObj = Phaser.Display.Color.IntegerToColor(fromColor);
    const toObj = Phaser.Display.Color.IntegerToColor(targetColor);
    const tween = { t: 0 };
    this.tweens.add({
      targets: tween, t: 1, duration: 600, ease: 'Sine.easeInOut',
      onUpdate: () => {
        const r = Phaser.Math.Linear(fromObj.red, toObj.red, tween.t);
        const g = Phaser.Math.Linear(fromObj.green, toObj.green, tween.t);
        const b = Phaser.Math.Linear(fromObj.blue, toObj.blue, tween.t);
        const c = Phaser.Display.Color.GetColor(Math.round(r), Math.round(g), Math.round(b));
        this.repaintCourt(c);
      },
    });
  }

  comboMultiplier() {
    const table = PWC.config.combo.multTable;
    return table[Math.min(this.combo, table.length - 1)] || table[table.length - 1];
  }

  tierFromCombo(combo) {
    const tiers = PWC.config.combo.tierAt;
    let t = 0;
    for (let i = 0; i < tiers.length; i++) if (combo >= tiers[i]) t = i;
    return t;
  }

  // ---------------------------------------------------------------------
  // TIME EFFECTS
  // ---------------------------------------------------------------------
  freezeFrame(ms = 60) {
    if (this._frozen) return;
    this._frozen = true;
    this.physics.pause();
    this.tweens.pauseAll();
    setTimeout(() => {
      this._frozen = false;
      if (this.physics && this.physics.world) this.physics.resume();
      if (this.tweens) this.tweens.resumeAll();
    }, ms);
  }

  slowMo(scale, durationMs) {
    this._timeScale = scale;
    this.physics.world.timeScale = 1 / scale;
    this.tweens.timeScale = scale;
    setTimeout(() => {
      this._timeScale = 1;
      this.physics.world.timeScale = 1;
      this.tweens.timeScale = 1;
    }, durationMs);
  }

  // ---------------------------------------------------------------------
  // QUICK "GO" — replaces the slow 3·2·1 countdown.
  // ---------------------------------------------------------------------
  showQuickGo() {
    const W = this.W, H = this.H;
    const txt = this.add.text(W / 2, H / 2, 'GO', {
      fontFamily: 'Space Grotesk, sans-serif',
      fontSize: '120px',
      fontStyle: '700',
      color: PWC.colors.ballHex,
    }).setOrigin(0.5).setDepth(80).setAlpha(0).setScale(0.6);
    txt.setShadow(0, 0, PWC.colors.ballHex, 18, true, true);

    gsap.to(txt, { alpha: 1, scale: 1, duration: 0.12, ease: 'back.out(2)' });
    gsap.to(txt, { alpha: 0, scale: 1.4, duration: 0.28, delay: 0.2, ease: 'cubic.in',
                   onComplete: () => txt.destroy() });
    PWC.audio.uiTick();
  }

  // ---------------------------------------------------------------------
  // TUTORIAL OVERLAY (first-ever play only)
  // Shows for ~4 seconds or until first pointerdown, whichever first.
  // ---------------------------------------------------------------------
  showTutorialOverlay() {
    const W = this.W, H = this.H;
    const C = PWC.colors;

    this.tutorialGroup = this.add.container(0, 0).setDepth(90);

    const dim = this.add.rectangle(W / 2, H / 2, W, H, C.bg, 0.55);
    const finger = this.add.image(W / 2 - 80, this.racket.y + 80, 'finger').setScale(0.9).setAlpha(0.95);
    const trail = this.add.graphics();
    const drawTrail = (toX) => {
      trail.clear();
      trail.lineStyle(3, C.text, 0.4);
      trail.lineBetween(W / 2 - 80, this.racket.y + 80, toX, this.racket.y + 80);
    };
    const txt1 = this.add.text(W / 2, this.racket.y - 220, 'DRAG TO MOVE', {
      fontFamily: 'Space Grotesk, sans-serif', fontSize: '38px', fontStyle: '700', color: C.textHex,
    }).setOrigin(0.5);
    const txt2 = this.add.text(W / 2, this.racket.y - 170, 'RELEASE TO HIT', {
      fontFamily: 'Space Grotesk, sans-serif', fontSize: '38px', fontStyle: '700', color: C.perfectHex,
    }).setOrigin(0.5);
    txt2.setShadow(0, 0, C.perfectHex, 14, true, true);
    const hint = this.add.text(W / 2, this.racket.y + 200, 'tap anywhere to begin', {
      fontFamily: 'Inter, sans-serif', fontSize: '18px', color: C.textDimHex,
    }).setOrigin(0.5);

    this.tutorialGroup.add([dim, trail, finger, txt1, txt2, hint]);
    this.tutorialGroup.setAlpha(0);
    gsap.to(this.tutorialGroup, { alpha: 1, duration: 0.3 });

    // Looping animation: finger drags right, releases (fades briefly), repeats
    const loop = gsap.timeline({ repeat: -1 });
    loop.fromTo(finger,
      { x: W / 2 - 80, alpha: 0.95 },
      { x: W / 2 + 80, alpha: 0.95, duration: 1.0, ease: 'sine.inOut',
        onUpdate: () => drawTrail(finger.x) });
    loop.to(finger, { alpha: 0.2, scale: 1.15, duration: 0.18, ease: 'power2.out' });
    loop.to(finger, { alpha: 0.95, scale: 0.9, x: W / 2 - 80, duration: 0.3, delay: 0.2 });

    this._tutorialLoop = loop;

    // Auto-dismiss after timeout
    this._tutorialTimer = setTimeout(() => this.dismissTutorialIfOpen(),
      PWC.config.onboarding.firstRunTutorialMs);
  }

  dismissTutorialIfOpen() {
    if (!this.tutorialGroup) return;
    if (this._tutorialLoop) { this._tutorialLoop.kill(); this._tutorialLoop = null; }
    if (this._tutorialTimer) { clearTimeout(this._tutorialTimer); this._tutorialTimer = null; }
    const group = this.tutorialGroup;
    this.tutorialGroup = null;
    gsap.to(group, { alpha: 0, duration: 0.25, onComplete: () => group.destroy() });
    this.showQuickGo();
    this.emit('tutorialDismissed');
  }

  // Helper: small per-scene event emitter (separate from this.events)
  emit(name) {
    if (this._listeners && this._listeners[name]) {
      this._listeners[name].forEach(fn => fn());
    }
  }
  once(name, fn) {
    this._listeners = this._listeners || {};
    this._listeners[name] = this._listeners[name] || [];
    const wrap = () => { fn(); this._listeners[name] = this._listeners[name].filter(f => f !== wrap); };
    this._listeners[name].push(wrap);
  }

  // ---------------------------------------------------------------------
  // END RUN
  // ---------------------------------------------------------------------
  endRun() {
    if (this.state === 'DEAD') return;
    this.state = 'DEAD';
    this.trail.emitting = false;
    this.targetMarker.setAlpha(0);

    const data = PWC.storage.data;
    const previousBest = data.best || 0;
    const previousBestCombo = data.bestCombo || 0;
    const previousBestPerfects = data.bestPerfects || 0;
    const wasBest = this.score > previousBest;
    const wasBestCombo = this.longestComboThisRun > previousBestCombo;
    const wasBestPerfects = this.perfectsThisRun > previousBestPerfects;
    if (wasBest) data.best = this.score;
    if (wasBestCombo) data.bestCombo = this.longestComboThisRun;
    if (wasBestPerfects) data.bestPerfects = this.perfectsThisRun;
    data.runs = (data.runs || 0) + 1;
    PWC.storage.save();

    // Daily-mode bookkeeping
    let dailyPayload = null;
    if (this.mode === 'daily') {
      const previousToday = PWC.daily.todayBest();
      const wasTodayBest = this.score > previousToday;
      PWC.daily.recordTodayRun(this.score, this.longestComboThisRun, this.perfectsThisRun);
      dailyPayload = {
        dayNumber: PWC.daily.dayNumber(),
        previousTodayBest: previousToday,
        todayBest: PWC.daily.todayBest(),
        wasTodayBest,
      };
    }

    // End-of-run title from stats
    const titleStats = {
      score: this.score,
      longestCombo: this.longestComboThisRun,
      perfects: this.perfectsThisRun,
      wave: this.wave,
      wasBest,
      wallBounces: this.totalWallBounces,
      totalReturns: this.totalReturns,
    };
    const runTitle = PWC.titles.pick(titleStats);

    const payload = {
      mode: this.mode,
      score: this.score,
      previousBest,
      best: data.best,
      previousBestCombo,
      bestCombo: data.bestCombo,
      previousBestPerfects,
      bestPerfects: data.bestPerfects,
      longestCombo: this.longestComboThisRun,
      perfects: this.perfectsThisRun,
      wave: this.wave,
      wasBest, wasBestCombo, wasBestPerfects,
      runTitle,
      daily: dailyPayload,
    };

    this.game.events.emit(PWC.events.RUN_ENDED, payload);

    this.time.delayedCall(380, () => {
      this.scene.launch('GameOverScene', payload);
      this.scene.bringToTop('GameOverScene');
    });
  }

  shutdown() {
    if (this._tutorialLoop) { this._tutorialLoop.kill(); this._tutorialLoop = null; }
    if (this._tutorialTimer) { clearTimeout(this._tutorialTimer); this._tutorialTimer = null; }
    this.physics.world.timeScale = 1;
    this.tweens.timeScale = 1;
    this.time.timeScale = 1;
    this._timeScale = 1;
    // Pool cleanup (kill GameObjects)
    if (this.poolRings) this.poolRings.destroyAll();
    if (this.poolCorona) this.poolCorona.destroyAll();
    if (this.poolFlash) this.poolFlash.destroyAll();
  }
}

window.GameScene = GameScene;

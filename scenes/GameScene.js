// GameScene — the simulation. Owns ball, racket, court, hit detection,
// combo, lives, the difficulty director, and every camera/juice flourish.
class GameScene extends Phaser.Scene {
  constructor() { super({ key: 'GameScene' }); }

  create() {
    const W = this.scale.width, H = this.scale.height;
    const C = PWC.colors;
    const cfg = PWC.config;

    this.W = W; this.H = H;

    // Run state ----------------------------------------------------------
    this.state = 'WAITING';
    this.score = 0;
    this.combo = 0;
    this.comboTier = 0;
    this.lives = cfg.lives;
    this.wave = 1;
    this.returnsInWave = 0;
    this.totalReturns = 0;
    this.perfectsThisRun = 0;
    this.perfectStreak = 0;
    this.longestComboThisRun = 0;
    this.recentMisses = []; // timestamps
    this.mercyReturnsLeft = 0;
    this.swingCooldownUntil = 0;
    this.runStartedAt = performance.now();

    this.cameras.main.fadeIn(280, 14, 29, 42);
    this.cameras.main.setBackgroundColor(C.bgHex);
    this.cameras.main.setRoundPixels(false);

    // Court --------------------------------------------------------------
    this.drawCourt();

    // Wall flash layer (each wall has a glow that flashes on bounce) ---
    this.wallFx = {
      top: this.makeWallFlash('top'),
      left: this.makeWallFlash('left'),
      right: this.makeWallFlash('right'),
    };

    // Danger vignette (low lives) ---------------------------------------
    this.vignette = this.add.graphics().setDepth(50).setScrollFactor(0);
    this.vignettePulse = 0;

    // Court crack overlay (on miss) -------------------------------------
    this.crackFx = this.add.graphics().setDepth(40).setScrollFactor(0);

    // Ball ---------------------------------------------------------------
    this.ball = this.physics.add.image(W / 2, cfg.court.top + 60, 'ball').setTint(C.ball);
    this.ball.setCircle(PWC.config.ball.radius, this.ball.width / 2 - PWC.config.ball.radius, this.ball.height / 2 - PWC.config.ball.radius);
    this.ball.setCollideWorldBounds(false);
    this.ball.setBounce(1, 1);
    this.ball.setVisible(false);
    this.ball.body.setAllowGravity(false);

    // Ball trail (particle emitter) -------------------------------------
    this.trail = this.add.particles(0, 0, 'particle', {
      follow: this.ball,
      lifespan: 360,
      scale: { start: 1.1, end: 0 },
      alpha: { start: 0.75, end: 0 },
      tint: C.trail,
      quantity: 1,
      frequency: 14,
      blendMode: 'ADD',
      emitting: false,
    });

    // Racket -------------------------------------------------------------
    this.racket = this.add.image(W / 2, cfg.racket.y, 'racket').setTint(C.text);
    this.racket.targetX = W / 2;
    this.racketGlow = this.add.image(this.racket.x, this.racket.y, 'glow').setScale(3, 0.6).setAlpha(0.25).setTint(C.text).setBlendMode('ADD');

    // Custom hit zone (above racket) — handled manually each frame
    this.swing = { active: false, startedAt: 0, hitRegistered: false };

    // Input --------------------------------------------------------------
    this.setupInput();

    // Director state
    this.directorJustAdvanced = false;

    // Slow-mo / time state
    this._timeScale = 1;

    // Listen for sound toggle from anywhere (defensive)
    this.events.on('shutdown', () => this.shutdown());

    // Tell UIScene about initial state
    this.scene.launch('UIScene', { game: this });
    this.scene.bringToTop('UIScene');

    // Wait briefly, then serve.
    this.time.delayedCall(420, () => this.serveBall());

    // Countdown overlay
    this.showCountdown();
  }

  // ---------- COURT & WALL FX ---------------------------------------------
  drawCourt() {
    const W = this.W, H = this.H;
    const c = PWC.config.court;
    const C = PWC.colors;

    // Background ambient panel
    const g = this.add.graphics().setDepth(-10);
    g.fillStyle(C.bg, 1).fillRect(0, 0, W, H);

    // Court interior panel
    g.fillStyle(C.court, 1);
    g.fillRoundedRect(c.left - 12, c.top - 12, (c.right - c.left) + 24, (c.bottom - c.top) + 24, 18);

    // Inner accent gradient strip near top (subtle vertical fade)
    for (let i = 0; i < 60; i++) {
      g.fillStyle(C.courtAccent, (1 - i / 60) * 0.10);
      g.fillRect(c.left, c.top + i, c.right - c.left, 1);
    }

    // Center dotted service line
    for (let y = c.top + 24; y < c.bottom - 24; y += 18) {
      g.fillStyle(0xffffff, 0.07);
      g.fillRect((c.left + c.right) / 2 - 1, y, 2, 8);
    }

    // Outer wall lines
    g.lineStyle(2, 0xffffff, 0.22);
    g.strokeRoundedRect(c.left, c.top, c.right - c.left, c.bottom - c.top, 6);

    // Bottom edge — softer (it's the "no wall" side)
    g.lineStyle(2, 0xffffff, 0.0);
    // a thin glowing baseline where the racket sits
    g.fillStyle(0xffffff, 0.05);
    g.fillRect(c.left, c.bottom - 1, c.right - c.left, 2);
  }

  makeWallFlash(side) {
    const c = PWC.config.court;
    let x, y, w, h;
    if (side === 'top')   { x = c.left; y = c.top - 4; w = c.right - c.left; h = 6; }
    if (side === 'left')  { x = c.left - 4; y = c.top; w = 6; h = c.bottom - c.top; }
    if (side === 'right') { x = c.right - 2; y = c.top; w = 6; h = c.bottom - c.top; }
    const r = this.add.rectangle(x + w / 2, y + h / 2, w, h, 0xffffff, 0).setBlendMode('ADD').setDepth(5);
    return r;
  }

  flashWall(side, intensity = 1) {
    const r = this.wallFx[side];
    if (!r) return;
    r.setAlpha(0.7 * intensity);
    this.tweens.add({
      targets: r,
      alpha: 0,
      duration: 260,
      ease: 'Quad.easeOut',
    });
  }

  // ---------- INPUT --------------------------------------------------------
  setupInput() {
    const cfg = PWC.config;

    this.input.on('pointerdown', (p) => {
      if (this.state !== 'IN_PLAY' && this.state !== 'WAITING') return;
      this.racket.targetX = Phaser.Math.Clamp(p.x, cfg.court.left + cfg.racket.width / 2, cfg.court.right - cfg.racket.width / 2);
      this.tryStartSwing();
    });

    this.input.on('pointermove', (p) => {
      if (!p.isDown) return;
      if (this.state !== 'IN_PLAY' && this.state !== 'WAITING') return;
      this.racket.targetX = Phaser.Math.Clamp(p.x, cfg.court.left + cfg.racket.width / 2, cfg.court.right - cfg.racket.width / 2);
    });

    // Keyboard support (desktop dev)
    this.cursors = this.input.keyboard.createCursorKeys();
    this.input.keyboard.on('keydown-SPACE', () => this.tryStartSwing());
  }

  tryStartSwing() {
    const now = performance.now();
    if (now < this.swingCooldownUntil) return;
    if (this.swing.active) return;
    this.swing.active = true;
    this.swing.startedAt = now;
    this.swing.hitRegistered = false;
    this.swingCooldownUntil = now + PWC.config.swing.windowMs + PWC.config.swing.cooldownMs;
    this.flashRacket();
  }

  flashRacket() {
    // brief brighten + squash
    this.racket.setTint(PWC.colors.perfect);
    this.tweens.add({
      targets: this.racket,
      scaleY: 1.25,
      duration: 70,
      yoyo: true,
      ease: 'Quad.easeOut',
      onComplete: () => this.racket.setTint(PWC.colors.text),
    });
    this.tweens.add({
      targets: this.racketGlow,
      alpha: 0.6,
      scaleY: 1.2,
      duration: 90,
      yoyo: true,
    });
  }

  // ---------- BALL ---------------------------------------------------------
  serveBall() {
    if (this.state === 'DEAD') return;
    this.state = 'WAITING';

    const c = PWC.config.court;
    // Pick a serve point: from the top wall, slight angle bias toward center.
    const side = Phaser.Math.RND.pick(this.wave >= 4 ? ['top', 'top', 'left', 'right'] : ['top', 'top', 'top']);
    let x, y, angleDeg;
    if (side === 'top') {
      x = Phaser.Math.Between(c.left + 80, c.right - 80);
      y = c.top + 30;
      // angle pointing down with slight horizontal
      angleDeg = Phaser.Math.Between(60, 120); // 90 is straight down
    } else if (side === 'left') {
      x = c.left + 30;
      y = Phaser.Math.Between(c.top + 60, c.top + 220);
      angleDeg = Phaser.Math.Between(20, 70);
    } else {
      x = c.right - 30;
      y = Phaser.Math.Between(c.top + 60, c.top + 220);
      angleDeg = Phaser.Math.Between(110, 160);
    }

    this.tweens.killTweensOf(this.ball); // cancel any leftover fade-out
    this.ball.setPosition(x, y);
    this.ball.setVelocity(0, 0);
    this.ball.setScale(0.2);
    this.ball.setAlpha(0);
    this.ball.setVisible(true);
    this.ball.setTint(PWC.colors.ball);
    this.trail.emitting = false;

    // Telegraph: bloom + ring
    const ring = this.add.image(x, y, 'ring').setBlendMode('ADD').setTint(PWC.colors.ball).setAlpha(0.7).setScale(0.5);
    this.tweens.add({
      targets: ring,
      scale: 2.2,
      alpha: 0,
      duration: 380,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });

    this.tweens.add({
      targets: this.ball,
      scale: 1.05,
      alpha: 1,
      duration: PWC.config.ball.serveTelegraphMs * 0.7,
      ease: 'Back.easeOut',
    });

    this.time.delayedCall(PWC.config.ball.serveTelegraphMs, () => {
      this.tweens.add({ targets: this.ball, scale: 1, duration: 120, ease: 'Sine.easeOut' });
      const speed = this.currentBaseSpeed();
      const rad = Phaser.Math.DegToRad(angleDeg);
      this.ball.setVelocity(Math.cos(rad) * speed, Math.sin(rad) * speed);
      this.trail.emitting = true;
      this.state = 'IN_PLAY';
    });
  }

  currentBaseSpeed() {
    const base = PWC.config.ball.baseSpeed;
    const waveMul = 1 + (this.wave - 1) * 0.05;
    const mercy = this.mercyReturnsLeft > 0 ? PWC.config.difficulty.mercySpeedMul : 1;
    return base * waveMul * mercy;
  }

  // ---------- UPDATE -------------------------------------------------------
  update(_, dtMs) {
    const dt = Math.min(dtMs, 32) / 1000; // clamp tab-blur dt
    const cfg = PWC.config;

    // Racket smoothing
    this.racket.x += (this.racket.targetX - this.racket.x) * cfg.racket.lerp;
    this.racketGlow.x = this.racket.x;
    // Keyboard fallback (desktop)
    if (this.cursors) {
      const step = 18;
      if (this.cursors.left.isDown)  this.racket.targetX = Math.max(cfg.court.left + cfg.racket.width / 2, this.racket.targetX - step);
      if (this.cursors.right.isDown) this.racket.targetX = Math.min(cfg.court.right - cfg.racket.width / 2, this.racket.targetX + step);
    }

    // Ball logic
    if (this.state === 'IN_PLAY') this.updateBall(dt);

    // Swing window
    if (this.swing.active) {
      const elapsed = performance.now() - this.swing.startedAt;
      if (elapsed > PWC.config.swing.windowMs) {
        this.swing.active = false;
      } else if (!this.swing.hitRegistered) {
        if (this.ballInHitZone()) {
          this.swing.hitRegistered = true;
          this.registerHit(elapsed);
        }
      }
    }

    // Vignette pulse (low-life tension)
    if (this.lives <= 1 && this.state === 'IN_PLAY') {
      this.vignettePulse += dt * 5;
      const a = 0.10 + Math.sin(this.vignettePulse) * 0.05;
      this.drawVignette(PWC.colors.danger, a);
    } else if (this.vignette) {
      this.vignette.clear();
    }

    // Subtle racket "anticipation" — brighten as ball approaches
    if (this.ball && this.ball.visible && this.ball.body.velocity.y > 0) {
      const dist = Math.abs(this.ball.y - this.racket.y);
      const near = Phaser.Math.Clamp(1 - dist / 500, 0, 1);
      this.racketGlow.setAlpha(0.18 + near * 0.4);
    }
  }

  drawVignette(color, alpha) {
    const W = this.W, H = this.H;
    this.vignette.clear();
    const steps = 16;
    for (let i = 0; i < steps; i++) {
      const t = i / steps;
      const a = alpha * (1 - t);
      this.vignette.lineStyle(8, color, a);
      this.vignette.strokeRect(i * 4, i * 4, W - i * 8, H - i * 8);
    }
  }

  updateBall(dt) {
    const c = PWC.config.court;
    const b = this.ball;

    // Manual integration (we read body.velocity but apply our own corrections)
    // Phaser is already moving the ball via physics; we just react to walls.
    // Wall collisions (manual — we want jitter + flash)
    const r = PWC.config.ball.radius;

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

    // Miss line: ball passes bottom of court
    if (b.y - r > c.bottom + 30) {
      this.onMiss();
    }

    // Rotation tied to velocity for spin feel
    b.rotation += (b.body.velocity.x / 600) * dt * 6;
  }

  onWallBounce(side) {
    const cfg = PWC.config;
    const b = this.ball;

    // Speed gain on wall bounce
    const v = b.body.velocity;
    const speed = Math.hypot(v.x, v.y);
    const newSpeed = Math.min(cfg.ball.speedCap, speed * cfg.ball.perBounceMul);
    const scale = newSpeed / Math.max(1, speed);
    b.body.velocity.x *= scale;
    b.body.velocity.y *= scale;

    // Jitter ±degrees from wave config
    const jitterIdx = Math.min(this.wave - 1, cfg.difficulty.jitterDegByWave.length - 1);
    const jitterDeg = cfg.difficulty.jitterDegByWave[jitterIdx] || 0;
    if (jitterDeg > 0) {
      const jr = Phaser.Math.FloatBetween(-jitterDeg, jitterDeg) * Math.PI / 180;
      const cosA = Math.cos(jr), sinA = Math.sin(jr);
      const vx = b.body.velocity.x, vy = b.body.velocity.y;
      b.body.velocity.x = vx * cosA - vy * sinA;
      b.body.velocity.y = vx * sinA + vy * cosA;
    }

    // Audio + visual
    this.flashWall(side, Math.min(1, speed / 800));
    PWC.audio.wallSoft(speed / cfg.ball.baseSpeed);

    // Small spark at impact
    const ix = side === 'left' ? cfg.court.left : side === 'right' ? cfg.court.right : b.x;
    const iy = side === 'top' ? cfg.court.top : b.y;
    this.bounceSpark(ix, iy);
  }

  bounceSpark(x, y) {
    const emitter = this.add.particles(x, y, 'particle', {
      speed: { min: 80, max: 220 },
      angle: { min: 0, max: 360 },
      lifespan: { min: 180, max: 320 },
      scale: { start: 0.7, end: 0 },
      alpha: { start: 0.9, end: 0 },
      tint: 0xffffff,
      blendMode: 'ADD',
      emitting: false,
    });
    emitter.explode(6, x, y);
    this.time.delayedCall(400, () => emitter.destroy());
  }

  // ---------- HIT GRADING --------------------------------------------------
  ballInHitZone() {
    const r = this.racket;
    const b = this.ball;
    const cfg = PWC.config;
    // Zone above the racket, slightly wider than racket
    const zx = r.x - cfg.racket.width / 2 - 10;
    const zw = cfg.racket.width + 20;
    const zy = r.y - cfg.racket.hitZoneHeight;
    const zh = cfg.racket.hitZoneHeight + 4;
    // Only count if ball is moving downward (approaching)
    if (b.body.velocity.y < 0) return false;
    const radius = cfg.ball.radius;
    return (
      b.x + radius >= zx && b.x - radius <= zx + zw &&
      b.y + radius >= zy && b.y - radius <= zy + zh
    );
  }

  registerHit(elapsedMs) {
    const cfg = PWC.config;
    const w = cfg.swing.windowMs;
    const pw = cfg.swing.perfectWindowMs;
    const center = w / 2;
    const half = pw / 2;
    const perfect = Math.abs(elapsedMs - center) <= half;

    if (perfect) this.onPerfectHit();
    else this.onGoodHit();
  }

  onGoodHit() {
    this.applyHit({ perfect: false });
  }

  onPerfectHit() {
    this.applyHit({ perfect: true });
    this.perfectsThisRun++;
    this.perfectStreak++;
    if (this.perfectStreak === 3) this.onTriplePerfect();
  }

  applyHit({ perfect }) {
    const cfg = PWC.config;
    const C = PWC.colors;
    const b = this.ball;

    // Reverse Y, scale speed, blend racket-X-offset into X
    const dx = b.x - this.racket.x;
    const angleInfluence = dx / (cfg.racket.width * 0.55); // -ish 1 to 1

    const speed = Math.hypot(b.body.velocity.x, b.body.velocity.y);
    const newSpeed = Math.min(cfg.ball.speedCap, speed * cfg.ball.perReturnMul * (perfect ? 1.25 : 1));

    // Aim upward with horizontal bias from racket contact offset
    const upAngle = Phaser.Math.DegToRad(-90 + angleInfluence * 35);
    b.body.velocity.x = Math.cos(upAngle) * newSpeed;
    b.body.velocity.y = Math.sin(upAngle) * newSpeed;

    // Score & combo
    this.combo += perfect ? 3 : 1;
    this.longestComboThisRun = Math.max(this.longestComboThisRun, this.combo);
    const tier = this.tierFromCombo(this.combo);
    const tierUp = tier > this.comboTier;
    this.comboTier = tier;

    const mult = this.comboMultiplier();
    const base = cfg.scoring.basePerHit + (perfect ? cfg.scoring.perfectBonus : 0);
    const gained = Math.round(base * mult);
    this.score += gained;

    // Returns counter (only count full returns for wave progression)
    this.totalReturns++;
    this.returnsInWave++;
    if (this.mercyReturnsLeft > 0) this.mercyReturnsLeft--;

    // Events
    this.game.events.emit('score:changed', { score: this.score, gained, x: this.racket.x, y: this.racket.y - 30, perfect });
    this.game.events.emit('combo:changed', { combo: this.combo, tier, tierUp, perfect });

    // Audio
    if (perfect) PWC.audio.perfect();
    else PWC.audio.hit(speed / cfg.ball.baseSpeed);
    if (tierUp) {
      PWC.audio.comboUp(tier);
      this.game.events.emit('combo:tierUp', { tier });
    }

    // Juice ---------------------------------------------------------
    this.hitParticles(this.racket.x, this.racket.y - 18, perfect);
    this.cameras.main.shake(perfect ? 140 : 70, perfect ? 0.008 : 0.0035);

    // Racket squash
    this.tweens.add({
      targets: this.racket,
      scaleX: 1.18, scaleY: 0.7,
      duration: 70,
      yoyo: true,
      ease: 'Quad.easeOut',
    });

    if (perfect) {
      this.perfectMoment(this.racket.x, this.racket.y - 18);
    } else {
      // small zoom punch
      this.cameras.main.zoomTo(1.02, 70, 'Cubic.easeOut');
      this.time.delayedCall(140, () => this.cameras.main.zoomTo(1.0, 180, 'Cubic.easeOut'));
      PWC.juice.vibrate(8);
    }

    // Wave progression
    const need = this.returnsNeededThisWave();
    if (this.returnsInWave >= need) this.advanceWave();
  }

  hitParticles(x, y, perfect) {
    const tint = perfect ? PWC.colors.perfect : 0xffffff;
    const count = perfect ? 22 : 12;
    const emitter = this.add.particles(x, y, 'particle', {
      speed: { min: 140, max: perfect ? 520 : 360 },
      angle: { min: -180, max: 0 }, // mostly upward
      lifespan: { min: 240, max: 520 },
      scale: { start: perfect ? 1.4 : 1.0, end: 0 },
      alpha: { start: 1, end: 0 },
      tint,
      blendMode: 'ADD',
      emitting: false,
    });
    emitter.explode(count, x, y);
    this.time.delayedCall(700, () => emitter.destroy());

    // Quick crisp chips (sparks)
    const spark = this.add.particles(x, y, 'spark', {
      speed: { min: 200, max: perfect ? 700 : 500 },
      angle: { min: -180, max: 0 },
      lifespan: { min: 160, max: 320 },
      scale: { start: 1.2, end: 0 },
      alpha: { start: 1, end: 0 },
      tint,
      blendMode: 'ADD',
      emitting: false,
    });
    spark.explode(perfect ? 14 : 8, x, y);
    this.time.delayedCall(500, () => spark.destroy());
  }

  perfectMoment(x, y) {
    const C = PWC.colors;
    // Expanding cyan ring
    const ring = this.add.image(x, y, 'ring').setBlendMode('ADD').setTint(C.perfect).setScale(0.4).setAlpha(0.95);
    this.tweens.add({
      targets: ring,
      scale: 3.2,
      alpha: 0,
      duration: 480,
      ease: 'Cubic.easeOut',
      onComplete: () => ring.destroy(),
    });
    const ring2 = this.add.image(x, y, 'ring').setBlendMode('ADD').setTint(C.perfect).setScale(0.2).setAlpha(0.8);
    this.tweens.add({
      targets: ring2,
      scale: 5.0,
      alpha: 0,
      duration: 720,
      delay: 80,
      ease: 'Cubic.easeOut',
      onComplete: () => ring2.destroy(),
    });

    // Brief slow-mo + freeze
    this.freezeFrame(70);
    this.time.delayedCall(90, () => this.slowMo(0.5, 140));

    // Camera zoom punch
    this.cameras.main.zoomTo(1.05, 90, 'Cubic.easeOut');
    this.time.delayedCall(200, () => this.cameras.main.zoomTo(1.0, 280, 'Quad.easeOut'));

    // Ball corona — temporary scale punch
    const origScale = this.ball.scaleX;
    this.tweens.add({
      targets: this.ball,
      scale: origScale * 1.45,
      duration: 120,
      yoyo: true,
      ease: 'Quad.easeOut',
    });
    // Quick cyan flash overlay on the ball
    const corona = this.add.image(this.ball.x, this.ball.y, 'glow').setScale(1.2).setTint(C.perfect).setBlendMode('ADD').setAlpha(0.9);
    this.tweens.add({
      targets: corona,
      scale: 2.6,
      alpha: 0,
      duration: 360,
      ease: 'Cubic.easeOut',
      onComplete: () => corona.destroy(),
    });

    PWC.juice.vibrate([4, 6, 12]);
  }

  onTriplePerfect() {
    PWC.audio.triplePerfect();
    this.game.events.emit('triplePerfect', {});
    // Big screen flash
    const flash = this.add.rectangle(this.W / 2, this.H / 2, this.W, this.H, PWC.colors.perfect, 0.25).setDepth(60);
    this.tweens.add({ targets: flash, alpha: 0, duration: 380, ease: 'Cubic.easeOut', onComplete: () => flash.destroy() });
    this.cameras.main.shake(200, 0.012);
  }

  // ---------- MISS ---------------------------------------------------------
  onMiss() {
    if (this.state === 'DYING' || this.state === 'DEAD') return;
    this.state = 'DYING';

    const wasNearMiss = Math.abs(this.ball.x - this.racket.x) < PWC.config.nearMissPx;

    // Halt the ball — Phaser physics keeps integrating velocity otherwise,
    // which sends it off-screen during the dramatic delay.
    this.ball.setVelocity(0, 0);
    this.trail.emitting = false;

    // Track recent misses for mercy slope
    const now = performance.now();
    this.recentMisses.push({ at: now, returnsAt: this.totalReturns });
    this.recentMisses = this.recentMisses.filter(m => this.totalReturns - m.returnsAt <= PWC.config.difficulty.mercyWindow);

    const comboLost = this.combo;
    const tierLost = this.comboTier;
    this.perfectStreak = 0;

    // Dramatic moment for near misses or big combo breaks
    const isDramatic = wasNearMiss || comboLost >= 5;

    if (isDramatic) {
      this.slowMo(0.28, 320);
      PWC.audio.duck(0.35, 0.5);
    }

    // Court crack
    this.drawCourtCrack(this.ball.x);

    // Red vignette pulse
    this.flashDanger();

    // Camera shake (heavier for bigger losses)
    this.cameras.main.shake(220, 0.012 + Math.min(0.02, comboLost * 0.001));

    // Audio
    if (comboLost >= 5) PWC.audio.comboBreak();
    PWC.audio.lifeLost();
    PWC.juice.vibrate([20, 40, 20]);

    // Reset combo + lose life
    this.combo = 0;
    this.comboTier = 0;
    this.returnsInWave = 0;
    this.lives -= 1;

    // Trigger mercy if too many recent misses
    if (this.recentMisses.length >= PWC.config.difficulty.mercyMisses) {
      this.mercyReturnsLeft = PWC.config.difficulty.mercyDurationReturns;
    }

    this.game.events.emit('combo:broken', { lost: comboLost, tier: tierLost, x: this.ball.x, y: this.ball.y });
    this.game.events.emit('life:lost', { lives: this.lives });

    // Ball: flick away dramatically
    this.tweens.add({
      targets: this.ball,
      alpha: 0,
      scale: 0.4,
      duration: 380,
      delay: 200,
      ease: 'Cubic.easeIn',
    });

    // Next step: serve again or end run
    const delayBeforeNext = isDramatic ? 950 : 700;
    this.time.delayedCall(delayBeforeNext, () => {
      if (this.lives <= 0) {
        this.endRun();
      } else {
        this.serveBall();
      }
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
      targets: g,
      alpha: 0,
      duration: 900,
      ease: 'Cubic.easeOut',
      onComplete: () => g.clear(),
    });
  }

  flashDanger() {
    const flash = this.add.rectangle(this.W / 2, this.H / 2, this.W, this.H, PWC.colors.danger, 0.18).setDepth(60);
    this.tweens.add({ targets: flash, alpha: 0, duration: 380, ease: 'Cubic.easeOut', onComplete: () => flash.destroy() });
  }

  // ---------- WAVES --------------------------------------------------------
  returnsNeededThisWave() {
    const t = PWC.config.difficulty.returnsPerWave;
    const idx = Math.min(this.wave - 1, t.length - 1);
    return t[idx];
  }

  advanceWave() {
    this.wave++;
    this.returnsInWave = 0;
    this.game.events.emit('wave:advanced', { wave: this.wave });
    PWC.audio.wave();
    // brief zoom-out breathing moment
    this.cameras.main.zoomTo(0.96, 240, 'Cubic.easeOut');
    this.time.delayedCall(300, () => this.cameras.main.zoomTo(1.0, 320, 'Cubic.easeOut'));
  }

  // ---------- COMBO HELPERS ------------------------------------------------
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

  // ---------- TIME EFFECTS ------------------------------------------------
  freezeFrame(ms = 60) {
    // Pause physics and Phaser tweens. Audio is intentionally not paused
    // — un-slowed audio over frozen visuals is the "weight" trick.
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
    // Arcade physics treats timeScale as a divisor — higher = slower.
    this.physics.world.timeScale = 1 / scale;
    this.tweens.timeScale = scale;
    setTimeout(() => {
      this._timeScale = 1;
      this.physics.world.timeScale = 1;
      this.tweens.timeScale = 1;
    }, durationMs);
  }

  // ---------- COUNTDOWN ---------------------------------------------------
  showCountdown() {
    const W = this.W, H = this.H;
    const C = PWC.colors;
    const txt = this.add.text(W / 2, H / 2, '', {
      fontFamily: 'Space Grotesk, sans-serif',
      fontSize: '140px',
      fontStyle: '700',
      color: C.textHex,
    }).setOrigin(0.5).setDepth(80).setAlpha(0);

    const seq = ['3', '2', '1', 'GO'];
    seq.forEach((s, i) => {
      this.time.delayedCall(i * 360, () => {
        txt.setText(s).setScale(0.6).setAlpha(0);
        gsap.to(txt, { alpha: 1, scale: 1, duration: 0.16, ease: 'back.out(2)' });
        gsap.to(txt, { alpha: 0, scale: 1.4, duration: 0.22, delay: 0.18, ease: 'cubic.in' });
        if (s === 'GO') txt.setColor(C.ballHex);
        PWC.audio.uiTick();
      });
    });
    this.time.delayedCall(seq.length * 360 + 220, () => txt.destroy());
  }

  // ---------- END RUN -----------------------------------------------------
  endRun() {
    if (this.state === 'DEAD') return;
    this.state = 'DEAD';
    this.trail.emitting = false;

    // Capture previous bests BEFORE overwriting so the delta math is correct.
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

    const payload = {
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
      wasBest,
      wasBestCombo,
      wasBestPerfects,
    };

    this.game.events.emit('run:ended', payload);

    this.time.delayedCall(400, () => {
      this.scene.launch('GameOverScene', payload);
      this.scene.bringToTop('GameOverScene');
    });
  }

  shutdown() {
    // make sure time scales are reset if we tear down mid-slowmo
    this.physics.world.timeScale = 1;
    this.tweens.timeScale = 1;
    this.time.timeScale = 1;
    this._timeScale = 1;
  }
}

window.GameScene = GameScene;

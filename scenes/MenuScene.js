class MenuScene extends Phaser.Scene {
  constructor() { super({ key: 'MenuScene' }); }

  create() {
    const W = this.scale.width, H = this.scale.height;
    const C = PWC.colors;

    this.cameras.main.fadeIn(280, 14, 29, 42);

    // Ambient backdrop ---------------------------------------------------
    const bg = this.add.graphics();
    bg.fillGradientStyle(0x16314a, 0x16314a, C.bg, C.bg, 1, 1, 1, 1);
    bg.fillRect(0, 0, W, H);

    // Subtle court panel behind everything
    const panelMargin = 40;
    const panel = this.add.graphics();
    panel.fillStyle(C.court, 0.55);
    panel.fillRoundedRect(panelMargin, 200, W - panelMargin * 2, H - 360, 20);
    panel.lineStyle(1, 0xffffff, 0.06);
    panel.strokeRoundedRect(panelMargin, 200, W - panelMargin * 2, H - 360, 20);

    // Decorative dotted center line
    for (let y = 240; y < H - 200; y += 18) {
      this.add.rectangle(W / 2, y, 2, 8, 0xffffff, 0.06);
    }

    // Ambient ball that drifts and bounces — pure decoration -----------
    this.ambientBall = this.add.image(W / 2, H / 2, 'ball').setTint(C.ball).setScale(1).setAlpha(0.95);
    this.ambientBallTrail = this.add.particles(0, 0, 'particle', {
      follow: this.ambientBall,
      lifespan: 480,
      scale: { start: 1.2, end: 0 },
      alpha: { start: 0.55, end: 0 },
      tint: C.trail,
      quantity: 1,
      frequency: 24,
      blendMode: 'ADD',
    });
    this.ambientBall.vx = 220;
    this.ambientBall.vy = -180;
    this.ambientBounds = { left: panelMargin + 30, right: W - panelMargin - 30, top: 240, bottom: H - 200 };

    // Title --------------------------------------------------------------
    const titleY = 280;
    const title = this.add.text(W / 2, titleY, 'PADEL WALL', {
      fontFamily: 'Space Grotesk, sans-serif',
      fontSize: '72px',
      fontStyle: '700',
      color: C.textHex,
    }).setOrigin(0.5);
    title.setShadow(0, 0, '#5cf3ff', 18, true, true);

    const title2 = this.add.text(W / 2, titleY + 76, 'CHAOS', {
      fontFamily: 'Space Grotesk, sans-serif',
      fontSize: '108px',
      fontStyle: '700',
      color: C.ballHex,
    }).setOrigin(0.5);
    title2.setShadow(0, 0, C.ballHex, 28, true, true);

    // Tag line
    const tag = this.add.text(W / 2, titleY + 156, 'survive the rebounds', {
      fontFamily: 'Inter, sans-serif',
      fontSize: '22px',
      fontStyle: '500',
      color: C.textDimHex,
      letterSpacing: 4,
    }).setOrigin(0.5).setAlpha(0);
    tag.setLetterSpacing && tag.setLetterSpacing(6);

    // Title intro animation (GSAP — survives any scene timeScale changes)
    title.setAlpha(0).setY(titleY - 20);
    title2.setAlpha(0).setScale(0.85);
    gsap.to(title, { alpha: 1, y: titleY, duration: 0.5, ease: 'expo.out' });
    gsap.to(title2, { alpha: 1, scale: 1, duration: 0.6, delay: 0.12, ease: 'back.out(1.6)' });
    gsap.to(tag, { alpha: 1, duration: 0.5, delay: 0.5 });

    // PLAY button --------------------------------------------------------
    const btnY = H - 360;
    const btnW = 360, btnH = 110;
    const playGroup = this.add.container(W / 2, btnY);

    const btnGlow = this.add.image(0, 0, 'glow').setScale(5, 2.4).setAlpha(0.35).setTint(C.ball).setBlendMode('ADD');
    const btnBg = this.add.graphics();
    btnBg.fillStyle(0xffffff, 1);
    btnBg.fillRoundedRect(-btnW / 2, -btnH / 2, btnW, btnH, btnH / 2);
    const btnText = this.add.text(0, -2, 'PLAY', {
      fontFamily: 'Space Grotesk, sans-serif',
      fontSize: '48px',
      fontStyle: '700',
      color: C.bgHex,
    }).setOrigin(0.5);
    btnText.setLetterSpacing && btnText.setLetterSpacing(6);
    playGroup.add([btnGlow, btnBg, btnText]);

    // Idle pulse on the play button glow
    gsap.to(btnGlow, { alpha: 0.55, scaleX: 5.4, scaleY: 2.7, duration: 1.4, yoyo: true, repeat: -1, ease: 'sine.inOut' });

    // Hit area
    this.transitioning = false;
    const hitZone = this.add.zone(W / 2, btnY, btnW + 80, btnH + 80).setInteractive({ useHandCursor: true });

    let pressed = false;
    hitZone.on('pointerdown', () => {
      if (this.transitioning) return;
      pressed = true;
      PWC.audio.unlock();
      PWC.audio.uiTick();
      gsap.to(playGroup, { scale: 0.94, duration: 0.08, ease: 'power2.out' });
    });
    hitZone.on('pointerout', () => {
      if (pressed) { pressed = false; gsap.to(playGroup, { scale: 1, duration: 0.12 }); }
    });
    hitZone.on('pointerup', () => {
      if (!pressed || this.transitioning) return;
      pressed = false;
      this.startGame();
    });

    // Personal best badge -----------------------------------------------
    const best = PWC.storage.get('best') || 0;
    if (best > 0) {
      const badge = this.add.container(W / 2, btnY + 100);
      const badgeBg = this.add.graphics();
      badgeBg.fillStyle(0xffffff, 0.06);
      badgeBg.fillRoundedRect(-90, -20, 180, 40, 20);
      const bestLabel = this.add.text(-60, 0, 'BEST', {
        fontFamily: 'Inter, sans-serif',
        fontSize: '14px',
        fontStyle: '600',
        color: C.textDimHex,
      }).setOrigin(0, 0.5);
      bestLabel.setLetterSpacing && bestLabel.setLetterSpacing(2);
      const bestVal = this.add.text(70, 0, best.toLocaleString(), {
        fontFamily: 'Space Grotesk, sans-serif',
        fontSize: '20px',
        fontStyle: '600',
        color: C.textHex,
      }).setOrigin(1, 0.5);
      badge.add([badgeBg, bestLabel, bestVal]);
      badge.setAlpha(0);
      gsap.to(badge, { alpha: 1, duration: 0.5, delay: 0.5 });
    }

    // Sound toggle -------------------------------------------------------
    this.soundIcon = this.add.text(W - 50, 50, PWC.audio.enabled ? '♪' : '·', {
      fontFamily: 'Space Grotesk, sans-serif',
      fontSize: '34px',
      fontStyle: '700',
      color: C.textDimHex,
    }).setOrigin(0.5);
    const soundZone = this.add.zone(W - 50, 50, 80, 80).setInteractive({ useHandCursor: true });
    soundZone.on('pointerup', () => {
      const wasOn = PWC.audio.enabled;
      PWC.audio.setEnabled(!wasOn);
      PWC.storage.set('soundOn', !wasOn);
      this.soundIcon.setText(PWC.audio.enabled ? '♪' : '·');
      PWC.audio.uiTick();
    });

    // Hint at the bottom
    const hint = this.add.text(W / 2, H - 80, 'tap to swing  ·  drag to position', {
      fontFamily: 'Inter, sans-serif',
      fontSize: '16px',
      color: C.textDimHex,
      letterSpacing: 1,
    }).setOrigin(0.5).setAlpha(0);
    hint.setLetterSpacing && hint.setLetterSpacing(2);
    gsap.to(hint, { alpha: 0.7, duration: 0.4, delay: 0.8 });

    // Apply persisted sound preference
    PWC.audio.setEnabled(PWC.storage.get('soundOn') !== false);
  }

  startGame() {
    this.transitioning = true;
    PWC.audio.uiConfirm();
    this.cameras.main.fadeOut(280, 14, 29, 42);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.start('GameScene');
    });
  }

  update(_, dtMs) {
    const dt = dtMs / 1000;
    const b = this.ambientBall;
    if (!b) return;
    b.x += b.vx * dt;
    b.y += b.vy * dt;
    const B = this.ambientBounds;
    if (b.x < B.left) { b.x = B.left; b.vx = Math.abs(b.vx); }
    if (b.x > B.right) { b.x = B.right; b.vx = -Math.abs(b.vx); }
    if (b.y < B.top) { b.y = B.top; b.vy = Math.abs(b.vy); }
    if (b.y > B.bottom) { b.y = B.bottom; b.vy = -Math.abs(b.vy); }
    b.rotation += dt * 1.5;
  }
}

window.MenuScene = MenuScene;

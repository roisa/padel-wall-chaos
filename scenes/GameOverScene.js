// GameOverScene — death reveal, delta-to-best, REMATCH.
// Designed so the next run is one tap away within ~1 second.
class GameOverScene extends Phaser.Scene {
  constructor() { super({ key: 'GameOverScene' }); }

  init(data) {
    this.runData = data || {};
  }

  create() {
    const W = this.scale.width, H = this.scale.height;
    const C = PWC.colors;
    const d = this.runData;

    // Dim backdrop
    const dim = this.add.rectangle(W / 2, H / 2, W, H, C.bg, 0).setDepth(0);
    gsap.to(dim, { fillAlpha: 0.75, duration: 0.4, ease: 'cubic.out' });

    // ---- Score reveal --------------------------------------------------
    const wasBest = !!d.wasBest;
    const scoreColor = wasBest ? C.perfectHex : C.textHex;

    // Game-Over label
    const goLabel = this.add.text(W / 2, H * 0.18, wasBest ? 'NEW BEST' : 'GAME OVER', {
      fontFamily: 'Space Grotesk, sans-serif',
      fontSize: '34px',
      fontStyle: '700',
      color: wasBest ? C.perfectHex : C.textDimHex,
    }).setOrigin(0.5);
    goLabel.setLetterSpacing && goLabel.setLetterSpacing(8);
    goLabel.setAlpha(0).y = H * 0.18 - 16;
    gsap.to(goLabel, { alpha: 1, y: H * 0.18, duration: 0.5, delay: 0.1, ease: 'expo.out' });
    if (wasBest) goLabel.setShadow(0, 0, C.perfectHex, 16, true, true);

    // Big score
    const scoreObj = { v: 0 };
    const scoreText = this.add.text(W / 2, H * 0.32, '0', {
      fontFamily: 'Space Grotesk, sans-serif',
      fontSize: '128px',
      fontStyle: '700',
      color: scoreColor,
    }).setOrigin(0.5);
    if (wasBest) scoreText.setShadow(0, 0, C.perfectHex, 30, true, true);

    scoreText.setScale(0.6).setAlpha(0);
    gsap.to(scoreText, { alpha: 1, scale: 1, duration: 0.6, delay: 0.25, ease: 'back.out(2)' });
    gsap.to(scoreObj, {
      v: d.score,
      duration: 1.0,
      delay: 0.3,
      ease: 'expo.out',
      onUpdate: () => scoreText.setText(Math.round(scoreObj.v).toLocaleString()),
    });

    const previousBest = d.previousBest || 0;
    let deltaText;
    if (wasBest) {
      const gap = d.score - previousBest;
      deltaText = previousBest > 0 ? `+${gap.toLocaleString()} vs old best` : 'a new high';
    } else if (previousBest > 0) {
      const diff = previousBest - d.score;
      deltaText = diff > 0 ? `${diff.toLocaleString()} from best` : 'matched best';
    } else {
      deltaText = 'first run';
    }

    const deltaLabel = this.add.text(W / 2, H * 0.41, deltaText, {
      fontFamily: 'Inter, sans-serif',
      fontSize: '20px',
      fontStyle: '500',
      color: wasBest ? C.perfectHex : C.textDimHex,
    }).setOrigin(0.5);
    deltaLabel.setAlpha(0);
    gsap.to(deltaLabel, { alpha: 1, duration: 0.4, delay: 0.9 });

    // Stat row -----------------------------------------------------------
    const statsY = H * 0.52;
    const stats = [
      { label: 'COMBO',    value: d.longestCombo || 0, isBest: !!d.wasBestCombo },
      { label: 'PERFECTS', value: d.perfects || 0,     isBest: !!d.wasBestPerfects },
      { label: 'WAVE',     value: d.wave || 1 },
    ];
    const colW = 180;
    const totalW = colW * stats.length;
    stats.forEach((s, i) => {
      const cx = W / 2 - totalW / 2 + colW * i + colW / 2;
      const grp = this.add.container(cx, statsY);
      const lbl = this.add.text(0, -28, s.label, {
        fontFamily: 'Inter, sans-serif',
        fontSize: '12px',
        fontStyle: '600',
        color: C.textDimHex,
      }).setOrigin(0.5);
      lbl.setLetterSpacing && lbl.setLetterSpacing(3);

      const val = this.add.text(0, 4, String(s.value), {
        fontFamily: 'Space Grotesk, sans-serif',
        fontSize: '38px',
        fontStyle: '700',
        color: s.isBest ? C.perfectHex : C.textHex,
      }).setOrigin(0.5);
      if (s.isBest) {
        val.setShadow(0, 0, C.perfectHex, 14, true, true);
        const star = this.add.text(40, -10, '★', {
          fontFamily: 'Space Grotesk, sans-serif',
          fontSize: '18px',
          color: C.perfectHex,
        }).setOrigin(0.5);
        grp.add(star);
      }
      grp.add([lbl, val]);
      grp.setAlpha(0).y = statsY + 10;
      gsap.to(grp, { alpha: 1, y: statsY, duration: 0.4, delay: 0.7 + i * 0.08, ease: 'expo.out' });
    });

    // REMATCH button -----------------------------------------------------
    const btnY = H * 0.78;
    const btnW = 380, btnH = 120;
    const playGroup = this.add.container(W / 2, btnY);

    const btnGlow = this.add.image(0, 0, 'glow').setScale(5.4, 2.6).setAlpha(0).setTint(C.ball).setBlendMode('ADD');
    const btnBg = this.add.graphics();
    btnBg.fillStyle(0xffffff, 1);
    btnBg.fillRoundedRect(-btnW / 2, -btnH / 2, btnW, btnH, btnH / 2);
    const btnText = this.add.text(0, -2, 'REMATCH', {
      fontFamily: 'Space Grotesk, sans-serif',
      fontSize: '48px',
      fontStyle: '700',
      color: C.bgHex,
    }).setOrigin(0.5);
    btnText.setLetterSpacing && btnText.setLetterSpacing(6);
    playGroup.add([btnGlow, btnBg, btnText]);

    playGroup.setAlpha(0).y = btnY + 20;
    gsap.to(playGroup, { alpha: 1, y: btnY, duration: 0.5, delay: 1.0, ease: 'expo.out' });
    gsap.to(btnGlow, { alpha: 0.55, duration: 1.0, delay: 1.2, yoyo: true, repeat: -1, ease: 'sine.inOut' });

    // Hit area (large, thumb-friendly)
    this.transitioning = false;
    const hitZone = this.add.zone(W / 2, btnY, btnW + 80, btnH + 80).setInteractive({ useHandCursor: true });
    let pressed = false;
    hitZone.on('pointerdown', () => {
      if (this.transitioning) return;
      pressed = true;
      PWC.audio.uiTick();
      gsap.to(playGroup, { scale: 0.94, duration: 0.08 });
    });
    hitZone.on('pointerout', () => { if (pressed) { pressed = false; gsap.to(playGroup, { scale: 1, duration: 0.12 }); } });
    hitZone.on('pointerup', () => {
      if (!pressed || this.transitioning) return;
      pressed = false;
      this.rematch();
    });

    // Menu link ---------------------------------------------------------
    const menuY = H * 0.92;
    const menuLink = this.add.text(W / 2, menuY, 'menu', {
      fontFamily: 'Inter, sans-serif',
      fontSize: '18px',
      fontStyle: '500',
      color: C.textDimHex,
    }).setOrigin(0.5).setAlpha(0);
    menuLink.setLetterSpacing && menuLink.setLetterSpacing(4);
    gsap.to(menuLink, { alpha: 0.7, duration: 0.4, delay: 1.2 });
    const menuZone = this.add.zone(W / 2, menuY, 200, 60).setInteractive({ useHandCursor: true });
    menuZone.on('pointerup', () => { if (!this.transitioning) this.goMenu(); });

    // Spacebar / Enter = REMATCH for desktop
    this.input.keyboard.on('keydown-SPACE', () => { if (!this.transitioning) this.rematch(); });
    this.input.keyboard.on('keydown-ENTER', () => { if (!this.transitioning) this.rematch(); });

    // Ambient drift effect on background — adds life to the screen
    this.time.delayedCall(800, () => this.ambientPulse());

    PWC.audio.duck(0.3, 0.6);
  }

  ambientPulse() {
    const C = PWC.colors;
    const W = this.W = this.scale.width;
    const H = this.H = this.scale.height;
    // Add a couple of slow drifting glow blobs in the background
    for (let i = 0; i < 3; i++) {
      const blob = this.add.image(
        Phaser.Math.Between(80, W - 80),
        Phaser.Math.Between(80, H - 80),
        'glow'
      ).setScale(Phaser.Math.FloatBetween(3, 6))
        .setAlpha(0)
        .setTint(i === 0 ? C.ball : i === 1 ? C.perfect : C.text)
        .setBlendMode('ADD')
        .setDepth(-1);
      gsap.to(blob, { alpha: 0.06, duration: 1.4, ease: 'sine.inOut' });
      gsap.to(blob, {
        x: blob.x + Phaser.Math.Between(-100, 100),
        y: blob.y + Phaser.Math.Between(-100, 100),
        duration: 8,
        repeat: -1,
        yoyo: true,
        ease: 'sine.inOut',
      });
    }
  }

  rematch() {
    this.transitioning = true;
    PWC.audio.uiConfirm();
    this.cameras.main.fadeOut(250, 14, 29, 42);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.stop('UIScene');
      this.scene.stop('GameScene');
      this.scene.start('GameScene');
    });
  }

  goMenu() {
    this.transitioning = true;
    PWC.audio.uiTick();
    this.cameras.main.fadeOut(250, 14, 29, 42);
    this.cameras.main.once('camerafadeoutcomplete', () => {
      this.scene.stop('UIScene');
      this.scene.stop('GameScene');
      this.scene.start('MenuScene');
    });
  }
}

window.GameOverScene = GameOverScene;

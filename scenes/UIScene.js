// UIScene — runs in parallel with GameScene. Listens to global events and
// renders the HUD. Stays steady when GameScene shakes.
class UIScene extends Phaser.Scene {
  constructor() { super({ key: 'UIScene' }); }

  init(data) {
    this.mode = (data && data.mode) || 'endless';
    this.dayNumber = (data && data.dayNumber) || 0;
  }

  create() {
    const W = this.scale.width, H = this.scale.height;
    const C = PWC.colors;
    this.W = W; this.H = H;
    this._gsapTweens = [];

    // Top bar: lives + wave + score + best line --------------------------
    this.topBar = this.add.container(0, 0);

    // Lives icons (hearts as filled circles for stylized look)
    this.livesContainer = this.add.container(40, 60);
    this.lives = [];
    for (let i = 0; i < PWC.config.lives; i++) {
      const heart = this.add.graphics();
      this.drawHeart(heart, 0, 0, 14, C.danger);
      heart.x = i * 36;
      this.livesContainer.add(heart);
      this.lives.push(heart);
    }
    this.topBar.add(this.livesContainer);

    // Wave label / daily badge (top-center)
    const initialLabel = this.mode === 'daily' ? `DAILY · CHAOS #${this.dayNumber}` : 'WAVE 1';
    const labelColor = this.mode === 'daily' ? C.perfectHex : C.waveHex;
    this.waveLabel = this.add.text(W / 2, 50, initialLabel, {
      fontFamily: 'Space Grotesk, sans-serif',
      fontSize: this.mode === 'daily' ? '18px' : '20px',
      fontStyle: '600',
      color: labelColor,
    }).setOrigin(0.5);
    this.waveLabel.setLetterSpacing && this.waveLabel.setLetterSpacing(4);
    this.topBar.add(this.waveLabel);

    // Sub-line: in daily mode, show "today's best"
    if (this.mode === 'daily') {
      const tBest = PWC.daily.todayBest();
      this.dailySubLabel = this.add.text(W / 2, 74, tBest > 0 ? `today’s best  ${tBest.toLocaleString()}` : 'fresh canvas', {
        fontFamily: 'Inter, sans-serif', fontSize: '12px', color: C.textDimHex,
      }).setOrigin(0.5);
      this.dailySubLabel.setLetterSpacing && this.dailySubLabel.setLetterSpacing(2);
      this.topBar.add(this.dailySubLabel);
    }

    // Wave progress arc / pips
    this.wavePips = this.add.container(W / 2, 88);
    this.topBar.add(this.wavePips);

    // Score (top-right) — large, bold
    this.scoreLabel = this.add.text(W - 40, 36, 'SCORE', {
      fontFamily: 'Inter, sans-serif',
      fontSize: '12px',
      fontStyle: '600',
      color: C.textDimHex,
    }).setOrigin(1, 0);
    this.scoreLabel.setLetterSpacing && this.scoreLabel.setLetterSpacing(3);

    this.scoreText = this.add.text(W - 40, 52, '0', {
      fontFamily: 'Space Grotesk, sans-serif',
      fontSize: '34px',
      fontStyle: '700',
      color: C.textHex,
    }).setOrigin(1, 0);
    this.topBar.add(this.scoreLabel);
    this.topBar.add(this.scoreText);

    // Personal-best line (faint horizontal across court top)
    const best = PWC.storage.get('best') || 0;
    if (best > 0) {
      this.bestLine = this.add.graphics();
      this.bestLine.lineStyle(1, C.text, 0.10);
      this.bestLine.lineBetween(PWC.config.court.left, PWC.config.court.top - 2, PWC.config.court.right, PWC.config.court.top - 2);
      this.bestLabel = this.add.text(PWC.config.court.right, PWC.config.court.top - 14, `BEST ${best.toLocaleString()}`, {
        fontFamily: 'Inter, sans-serif',
        fontSize: '11px',
        fontStyle: '500',
        color: C.textDimHex,
      }).setOrigin(1, 1).setAlpha(0.7);
    }

    // Bottom: combo display ----------------------------------------------
    this.comboGroup = this.add.container(W / 2, H - 100);

    this.comboPrefix = this.add.text(-50, 0, 'COMBO', {
      fontFamily: 'Inter, sans-serif',
      fontSize: '16px',
      fontStyle: '600',
      color: C.textDimHex,
    }).setOrigin(1, 0.5);
    this.comboPrefix.setLetterSpacing && this.comboPrefix.setLetterSpacing(3);

    this.comboValue = this.add.text(-30, 0, '×0', {
      fontFamily: 'Space Grotesk, sans-serif',
      fontSize: '46px',
      fontStyle: '700',
      color: C.textHex,
    }).setOrigin(0, 0.5);
    this.comboGroup.add([this.comboPrefix, this.comboValue]);
    this.comboGroup.setAlpha(0);

    // Combo side bar (right edge) ---------------------------------------
    this.comboBarBg = this.add.graphics();
    this.comboBarBg.fillStyle(0xffffff, 0.04);
    this.comboBarBg.fillRoundedRect(W - 22, 140, 8, H - 280, 4);

    this.comboBar = this.add.graphics();
    this._comboBarFill = 0;

    // Pool: score popups (6) and banners (2)
    this.poolPopup = new PWC.Pool(() => {
      const t = this.add.text(0, 0, '', {
        fontFamily: 'Space Grotesk, sans-serif', fontSize: '32px', fontStyle: '700', color: C.textHex,
      }).setOrigin(0.5).setDepth(70).setVisible(false);
      return t;
    }, 6);

    // Listen to events ---------------------------------------------------
    const E = PWC.events;
    this.game.events.on(E.SCORE_CHANGED, this.onScoreChanged, this);
    this.game.events.on(E.COMBO_CHANGED, this.onComboChanged, this);
    this.game.events.on(E.COMBO_TIER_UP, this.onTierUp, this);
    this.game.events.on(E.COMBO_BROKEN, this.onComboBroken, this);
    this.game.events.on(E.LIFE_LOST, this.onLifeLost, this);
    this.game.events.on(E.WAVE_ADVANCED, this.onWaveAdvanced, this);
    this.game.events.on(E.TRIPLE_PERFECT, this.onTriplePerfect, this);
    this.game.events.on(E.RUN_ENDED, this.onRunEnded, this);
    this.game.events.on(E.ALMOST_PB, this.onAlmostPB, this);

    this.events.on('shutdown', () => this.shutdown());

    // Initial wave pips
    this.drawWavePips(1);

    // Intro slide-in
    this.topBar.setAlpha(0).y = -20;
    gsap.to(this.topBar, { alpha: 1, y: 0, duration: 0.4, ease: 'expo.out', delay: 0.2 });

    // Score counter cache for tween
    this._displayedScore = 0;
  }

  shutdown() {
    const E = PWC.events;
    this.game.events.off(E.SCORE_CHANGED, this.onScoreChanged, this);
    this.game.events.off(E.COMBO_CHANGED, this.onComboChanged, this);
    this.game.events.off(E.COMBO_TIER_UP, this.onTierUp, this);
    this.game.events.off(E.COMBO_BROKEN, this.onComboBroken, this);
    this.game.events.off(E.LIFE_LOST, this.onLifeLost, this);
    this.game.events.off(E.WAVE_ADVANCED, this.onWaveAdvanced, this);
    this.game.events.off(E.TRIPLE_PERFECT, this.onTriplePerfect, this);
    this.game.events.off(E.RUN_ENDED, this.onRunEnded, this);
    this.game.events.off(E.ALMOST_PB, this.onAlmostPB, this);
    if (this.poolPopup) this.poolPopup.destroyAll();
    if (this._scoreCounterTween) this._scoreCounterTween.kill();
    if (this._almostPulse) this._almostPulse.kill();
  }

  drawHeart(g, x, y, size, color) {
    g.clear();
    g.fillStyle(color, 1);
    g.fillCircle(x - size / 2.5, y - size / 5, size / 2.2);
    g.fillCircle(x + size / 2.5, y - size / 5, size / 2.2);
    g.beginPath();
    g.moveTo(x - size, y);
    g.lineTo(x + size, y);
    g.lineTo(x, y + size);
    g.closePath();
    g.fillPath();
  }

  drawWavePips(wave) {
    this.wavePips.removeAll(true);
    const need = (() => {
      const t = PWC.config.difficulty.returnsPerWave;
      return t[Math.min(wave - 1, t.length - 1)];
    })();
    const total = Math.min(need, 12);
    const spacing = 14;
    const startX = -(total - 1) * spacing / 2;
    for (let i = 0; i < total; i++) {
      const pip = this.add.rectangle(startX + i * spacing, 0, 8, 3, PWC.colors.text, 0.12);
      pip.idx = i;
      this.wavePips.add(pip);
    }
  }

  fillWavePips(filled) {
    this.wavePips.list.forEach((p) => {
      if (p.idx < filled) p.setFillStyle(PWC.colors.wave, 0.95);
      else p.setFillStyle(PWC.colors.text, 0.12);
    });
  }

  // ---------- EVENT HANDLERS ----------------------------------------------
  onScoreChanged({ score, gained, x, y, perfect }) {
    // Single persistent counter tween — kills the previous to avoid races.
    if (this._scoreCounterTween) this._scoreCounterTween.kill();
    const obj = this._scoreCounterObj || (this._scoreCounterObj = { v: this._displayedScore });
    this._scoreCounterTween = gsap.to(obj, {
      v: score, duration: 0.35, ease: 'expo.out',
      onUpdate: () => {
        this._displayedScore = Math.round(obj.v);
        this.scoreText.setText(this._displayedScore.toLocaleString());
      },
    });

    // Pooled score popup at hit point
    const color = perfect ? PWC.colors.perfectHex : PWC.colors.textHex;
    const popup = this.poolPopup.acquire();
    popup.setText(`+${gained}`)
         .setPosition(x, y)
         .setVisible(true)
         .setAlpha(1)
         .setScale(0.4)
         .setStyle({ fontSize: perfect ? '40px' : '30px', color })
         .setShadow(0, 0, color, 12, true, true);
    gsap.to(popup, {
      y: y - 80, alpha: 0, duration: 0.65, ease: 'expo.out',
      onComplete: () => { popup.setVisible(false); this.poolPopup.release(popup); },
    });
    gsap.fromTo(popup, { scale: 0.4 }, { scale: 1.0, duration: 0.22, ease: 'back.out(2)', overwrite: 'auto' });

    // Score text bloom
    gsap.fromTo(this.scoreText, { scale: 1.0 }, { scale: 1.08, duration: 0.12, yoyo: true, repeat: 1, ease: 'power2.out', overwrite: 'auto' });
  }

  onAlmostPB({ score, best }) {
    // Pulsing "ALMOST!" banner near the score, with a tension audio (fired
    // by GameScene). Communicates "you're close — push it."
    if (this._almostLabel) return; // single-fire per run
    const x = this.W - 40;
    const y = 96;
    this._almostLabel = this.add.text(x, y, 'ALMOST!', {
      fontFamily: 'Space Grotesk, sans-serif', fontSize: '16px', fontStyle: '700',
      color: PWC.colors.almostHex,
    }).setOrigin(1, 0);
    this._almostLabel.setLetterSpacing && this._almostLabel.setLetterSpacing(3);
    this._almostLabel.setShadow(0, 0, PWC.colors.almostHex, 8, true, true);
    this._almostLabel.setAlpha(0);
    gsap.to(this._almostLabel, { alpha: 1, duration: 0.2 });
    this._almostPulse = gsap.to(this._almostLabel, {
      scale: 1.18, duration: 0.55, yoyo: true, repeat: -1, ease: 'sine.inOut',
    });
  }

  onComboChanged({ combo, tier, tierUp, perfect }) {
    this.comboValue.setText('×' + combo);
    if (combo > 0) {
      gsap.to(this.comboGroup, { alpha: 1, duration: 0.15 });
    }
    // Color shift with tier
    const colors = [PWC.colors.textHex, '#ffffff', PWC.colors.ballHex, '#ffd166', '#ff9c5b', PWC.colors.perfectHex, PWC.colors.perfectHex];
    const col = colors[Math.min(tier, colors.length - 1)];
    this.comboValue.setColor(col);
    this.comboValue.setShadow(0, 0, col, 14, true, true);

    // Scale bloom on every combo tick
    gsap.fromTo(this.comboValue, { scale: 0.85 }, {
      scale: 1.0, duration: 0.32, ease: 'elastic.out(1, 0.45)',
    });

    // Combo bar fill (right edge)
    const tierFloor = PWC.config.combo.tierAt[tier] || 0;
    const tierCeil = PWC.config.combo.tierAt[tier + 1] || (tierFloor + 10);
    const frac = Math.min(1, (combo - tierFloor) / Math.max(1, tierCeil - tierFloor));
    this.drawComboBar(tier, frac);

    // Update wave pips
    const game = this.scene.get('GameScene');
    if (game) this.fillWavePips(game.returnsInWave);
  }

  drawComboBar(tier, frac) {
    const W = this.W, H = this.H;
    this.comboBar.clear();
    const x = W - 22, y = 140, w = 8, h = H - 280;
    const fillH = h * Math.max(0, Math.min(1, frac + tier * 0.001));
    const colors = [0xffffff, 0xffffff, PWC.colors.ball, 0xffd166, 0xff9c5b, PWC.colors.perfect, PWC.colors.perfect];
    const col = colors[Math.min(tier, colors.length - 1)];
    // Background already drawn separately
    this.comboBar.fillStyle(col, 0.7 + tier * 0.04);
    this.comboBar.fillRoundedRect(x, y + (h - fillH), w, fillH, 4);
    // Soft glow on high tier
    if (tier >= 2) {
      this.comboBar.fillStyle(col, 0.2);
      this.comboBar.fillRoundedRect(x - 2, y + (h - fillH) - 2, w + 4, fillH + 4, 6);
    }
  }

  onTierUp({ tier }) {
    const label = PWC.config.combo.tierLabels[tier] || '';
    if (!label) return;
    this.showBanner(label, PWC.colors.perfectHex);
  }

  onComboBroken({ lost, tier, x, y }) {
    if (lost === 0) return;
    // Particles for the break are spawned by GameScene's pooled fxBreak
    // emitter — UIScene only owns the HUD reaction below.

    // Combo text shake-collapse
    gsap.to(this.comboValue, {
      scale: 1.4,
      color: PWC.colors.dangerHex,
      duration: 0.12,
      yoyo: true,
      repeat: 1,
      onComplete: () => {
        this.comboValue.setText('×0');
        this.comboValue.setColor(PWC.colors.textHex);
        this.comboValue.setShadow(0, 0, '#000000', 0);
        gsap.to(this.comboGroup, { alpha: 0, duration: 0.3, delay: 0.4 });
      },
    });

    this.drawComboBar(0, 0);
    this.fillWavePips(0);
  }

  onLifeLost({ lives }) {
    // Animate the lost heart away
    const lostIdx = lives; // index of the heart that just disappeared
    if (this.lives[lostIdx]) {
      const heart = this.lives[lostIdx];
      gsap.to(heart, {
        scale: 2.2,
        alpha: 0,
        duration: 0.45,
        ease: 'power2.out',
      });
    }
    // Remaining hearts pulse
    for (let i = 0; i < lives; i++) {
      gsap.fromTo(this.lives[i], { scale: 1 }, { scale: 1.3, duration: 0.15, yoyo: true, repeat: 1 });
    }
  }

  onWaveAdvanced({ wave }) {
    this.waveLabel.setText('WAVE ' + wave);
    gsap.fromTo(this.waveLabel, { scale: 1 }, { scale: 1.4, duration: 0.18, yoyo: true, repeat: 1, ease: 'power2.out' });
    this.drawWavePips(wave);
    this.showBanner('WAVE ' + wave, PWC.colors.waveHex);
  }

  onTriplePerfect() {
    this.showBanner('TRIPLE  PERFECT', PWC.colors.perfectHex, { big: true });
  }

  onRunEnded() {
    // hide HUD overlays as game-over takes over
    gsap.to(this.comboGroup, { alpha: 0, duration: 0.3 });
  }

  showBanner(text, color, opts = {}) {
    const W = this.W, H = this.H;
    const y = H * 0.42;
    const big = !!opts.big;
    const banner = this.add.container(W / 2, y).setDepth(80);

    // background sweep strip
    const stripH = big ? 110 : 80;
    const strip = this.add.graphics();
    strip.fillStyle(PWC.colors.bg, 0.55);
    strip.fillRect(-W / 2, -stripH / 2, W, stripH);
    strip.lineStyle(2, color, 0.6);
    strip.lineBetween(-W / 2, -stripH / 2, W / 2, -stripH / 2);
    strip.lineBetween(-W / 2, stripH / 2, W / 2, stripH / 2);

    const label = this.add.text(0, 0, text, {
      fontFamily: 'Space Grotesk, sans-serif',
      fontSize: big ? '72px' : '48px',
      fontStyle: '700',
      color: '#' + color.toString(16).padStart(6, '0'),
    }).setOrigin(0.5);
    label.setShadow(0, 0, '#' + color.toString(16).padStart(6, '0'), 24, true, true);

    banner.add([strip, label]);

    banner.setAlpha(0);
    banner.x = W / 2 - W;
    gsap.to(banner, { x: W / 2, alpha: 1, duration: 0.32, ease: 'expo.out' });
    gsap.to(banner, { x: W / 2 + W, alpha: 0, duration: 0.32, delay: big ? 0.9 : 0.55, ease: 'expo.in', onComplete: () => banner.destroy() });
  }
}

window.UIScene = UIScene;

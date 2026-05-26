class BootScene extends Phaser.Scene {
  constructor() { super({ key: 'BootScene' }); }

  preload() {
    const w = this.scale.width, h = this.scale.height;

    // Minimal loading visual (procedural textures haven't been built yet).
    const bar = this.add.rectangle(w / 2, h / 2 + 40, 220, 2, 0xffffff, 0.15);
    const fill = this.add.rectangle(w / 2 - 110, h / 2 + 40, 0, 2, 0xd6ff3a, 1).setOrigin(0, 0.5);
    const title = this.add.text(w / 2, h / 2 - 20, 'PADEL WALL CHAOS', {
      fontFamily: 'Space Grotesk, sans-serif',
      fontSize: '34px',
      fontStyle: '600',
      color: PWC.colors.textHex,
      letterSpacing: 2,
    }).setOrigin(0.5).setAlpha(0.85);
    title.setLetterSpacing && title.setLetterSpacing(4);

    // We have no external assets, but this gives the loader a real tick.
    // Fake progress via tween so the loading bar still feels alive.
    this.tweens.add({
      targets: fill,
      width: 220,
      duration: 600,
      ease: 'Cubic.easeOut',
    });

    this._bootRefs = { bar, fill, title };
  }

  create() {
    this.generateTextures();

    // Wait for Google Fonts to be ready before leaving boot — otherwise the
    // first frame of MenuScene flashes a fallback font.
    const proceed = () => {
      this.time.delayedCall(150, () => {
        this.cameras.main.fadeOut(200, 14, 29, 42);
        this.cameras.main.once('camerafadeoutcomplete', () => {
          this.scene.start('MenuScene');
        });
      });
    };

    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(proceed);
    } else {
      this.time.delayedCall(400, proceed);
    }
  }

  generateTextures() {
    // Particle: soft glowing dot ----------------------------------------
    const pSize = 24;
    const gP = this.add.graphics();
    for (let r = pSize / 2; r > 0; r--) {
      gP.fillStyle(0xffffff, Math.pow(r / (pSize / 2), 2) * 0.25);
      gP.fillCircle(pSize / 2, pSize / 2, r);
    }
    gP.fillStyle(0xffffff, 1);
    gP.fillCircle(pSize / 2, pSize / 2, 3);
    gP.generateTexture('particle', pSize, pSize);
    gP.destroy();

    // Ball: white core + soft halo --------------------------------------
    const r = PWC.config.ball.radius;
    const ballSize = (r + 18) * 2;
    const gB = this.add.graphics();
    for (let i = r + 16; i > r; i -= 1) {
      const a = Math.max(0, Math.pow((r + 16 - i) / 16, 1.6) * 0.18);
      gB.fillStyle(0xffffff, a);
      gB.fillCircle(ballSize / 2, ballSize / 2, i);
    }
    gB.fillStyle(0xffffff, 1);
    gB.fillCircle(ballSize / 2, ballSize / 2, r);
    // tiny brighter highlight
    gB.fillStyle(0xffffff, 1);
    gB.fillCircle(ballSize / 2 - r * 0.3, ballSize / 2 - r * 0.3, r * 0.35);
    gB.generateTexture('ball', ballSize, ballSize);
    gB.destroy();

    // Racket: rounded bar with subtle glow halo -------------------------
    const rw = PWC.config.racket.width;
    const rh = PWC.config.racket.height;
    const padX = 16, padY = 14;
    const racketW = rw + padX * 2;
    const racketH = rh + padY * 2;
    const gR = this.add.graphics();
    for (let i = 0; i < 8; i++) {
      const a = 0.06 - i * 0.006;
      gR.fillStyle(0xffffff, Math.max(0, a));
      gR.fillRoundedRect(padX - i, padY - i, rw + i * 2, rh + i * 2, (rh + i * 2) / 2);
    }
    gR.fillStyle(0xffffff, 1);
    gR.fillRoundedRect(padX, padY, rw, rh, rh / 2);
    gR.generateTexture('racket', racketW, racketH);
    gR.destroy();

    // Ring (perfect-hit expanding ring) ---------------------------------
    const ringSize = 160;
    const gRing = this.add.graphics();
    gRing.lineStyle(6, 0xffffff, 1);
    gRing.strokeCircle(ringSize / 2, ringSize / 2, ringSize / 2 - 6);
    gRing.lineStyle(3, 0xffffff, 0.6);
    gRing.strokeCircle(ringSize / 2, ringSize / 2, ringSize / 2 - 16);
    gRing.generateTexture('ring', ringSize, ringSize);
    gRing.destroy();

    // Soft glow (for additive blooms) -----------------------------------
    const glowSize = 128;
    const gG = this.add.graphics();
    for (let i = glowSize / 2; i > 0; i -= 1) {
      const a = Math.pow(i / (glowSize / 2), 2) * 0.18;
      gG.fillStyle(0xffffff, a);
      gG.fillCircle(glowSize / 2, glowSize / 2, glowSize / 2 - i);
    }
    gG.generateTexture('glow', glowSize, glowSize);
    gG.destroy();

    // Spark (square chip for crisp particle bursts) ---------------------
    const sSize = 8;
    const gS = this.add.graphics();
    gS.fillStyle(0xffffff, 1);
    gS.fillRect(0, 0, sSize, sSize);
    gS.generateTexture('spark', sSize, sSize);
    gS.destroy();

    // Pixel (1x1 for solid fills via image) -----------------------------
    const gPx = this.add.graphics();
    gPx.fillStyle(0xffffff, 1);
    gPx.fillRect(0, 0, 1, 1);
    gPx.generateTexture('pixel', 1, 1);
    gPx.destroy();
  }
}

window.BootScene = BootScene;

# Padel Wall Chaos

A fast, stylish, one-thumb arcade reflex game. Survive escalating padel-wall
rebounds, chain combos, chase perfect hits.

> Built with HTML5, vanilla JS, Phaser 3, GSAP, and Howler. No build tools.
> Designed for mobile-first one-thumb play.

## Play

**Open `index.html`** in any modern browser — or serve the folder over HTTP:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Audio uses procedurally synthesized sounds via the Web Audio API, so the
project is fully self-contained: no external asset downloads required.

## Controls

- **Tap** to swing
- **Drag** to position the racket
- (Desktop) Arrow keys to move, Space to swing

## Project layout

```
index.html         Entry point, CDN imports, script loading
style.css          Page chrome (canvas-centered, mobile viewport locked)
game.js            Phaser config + PWC namespace (config, colors, audio, storage)
scenes/
  BootScene.js     Procedural texture generation + font wait
  MenuScene.js     Title + PLAY + sound toggle + best score
  GameScene.js     Simulation: ball, racket, hits, combos, waves, juice
  UIScene.js       HUD: lives, wave, score, combo bar (parallel to game)
  GameOverScene.js Death reveal + delta-to-best + REMATCH
assets/            (reserved for future real audio/sprite assets)
DESIGN.md          Full preproduction design document
```

## Deploying to GitHub Pages

1. Push `main` (or any branch) to GitHub.
2. Settings → Pages → Deploy from a branch → root.
3. Game is live at `https://<user>.github.io/padel-wall-chaos/`.

The included `.nojekyll` prevents GitHub from filtering files.

## Design

See **DESIGN.md** for the full preproduction document covering the gameplay
loop, game-feel philosophy, replayability psychology, architecture, physics,
combo system, perfect-hit system, mobile control design, animation, UI,
audio, performance strategy, and future roadmap.

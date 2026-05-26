# Padel Wall Chaos — Audit, Documentation & Roadmap

> **Status:** Post-v0.9 audit · build under review at branch `claude/padel-wall-chaos-design-6V7JY`
> **Scope:** A full pass over the v0.9 build with concrete findings, fixes, and forward-looking roadmaps.

This document has three parts:
1. **Audit** — what's actually in the build and what's wrong with it
2. **Documentation & roadmaps** — technical reference, deployment, mobile checklist, and three growth roadmaps
3. **Brutally honest feedback** — risks, weak points, and the path to exceptional

The intent is to be specific. Every audit item references real code locations. Every roadmap item is sized for a one-person team with no backend. Every risk is one you'd hit in real player data.

---

# PART 1 — AUDIT

## 1. Performance

The build runs but it leans on the garbage collector hard. The design doc (§15.2) was explicit about pooling; that work was not done in v0.9.

### 1.1 Allocations per hit (the hot path)

A single successful return currently allocates the following:

| Allocation | Line(s) | Quantity per hit |
|---|---|---|
| `add.particles(...)` for hit burst | `GameScene.js:542` | 1 emitter + 12–22 particles |
| `add.particles(...)` for sparks | `GameScene.js:556` | 1 emitter + 8–14 particles |
| `add.image('ring')` (perfect only) | `GameScene.js:573, 582` | 2 ring sprites |
| `add.image('glow')` corona (perfect only) | `GameScene.js:611` | 1 sprite |
| `add.text('+N')` score popup | `UIScene.js:188` | 1 text object |
| 3–6 `tweens.add(...)` for animations | various | each carries a target + ease state |

A 20-combo streak (~20 hits in 4 seconds) creates **~80 emitters, ~250 particles, 20 text objects, 100+ tweens** that all hit the GC in close succession. On a mid-range Android (Snapdragon 6-series, ~3 years old), expect periodic GC pauses of 4–8ms at exactly the moments the game most needs frame consistency.

**Fix priority: HIGH.** Pool everything in the hot path.

### 1.2 Per-frame redraws

`GameScene.drawVignette()` (line 314) clears and re-strokes 16 nested rectangles every frame while `lives <= 1`. That's 16 × 60 = 960 graphics commands per second to produce a vignette that only changes alpha. Replace with a single pre-rendered radial gradient texture tinted red and pulsed via alpha tween.

### 1.3 Wall flash creates a fresh tween per bounce

`GameScene.flashWall()` (line 154) calls `this.tweens.add(...)` every time the ball touches a wall. With wall jitter at high waves the ball can bounce 8+ times per rally, creating 8+ tween objects that go to GC. Reuse a single tween per wall with `restart()`.

### 1.4 No render-degradation path

Design doc §15.5 mandates "Lower particle count automatically if actualFps < 50 for 2+ seconds." This is unimplemented. There's also no debug overlay (§15.6 mandates `?debug=1`) which makes tuning blind.

### 1.5 Court is redrawn? Actually no, it isn't — but it's a Graphics object that the renderer must touch each frame

`GameScene.drawCourt()` (line 103) draws the court into a Graphics object once. Phaser still has to walk the Graphics command list each frame. Convert to a texture cached after first draw (`graphics.generateTexture('court', W, H)` then `add.image`).

### 1.6 Wins available

| Action | Estimated savings | Effort |
|---|---|---|
| Pool hit particle emitters | -8ms GC per combo wave | Medium |
| Pool score-popup text objects | -2ms per hit | Small |
| Pool ring + corona sprites | -3ms per perfect | Small |
| Bake court Graphics to texture | -1ms per frame steady | Small |
| Replace vignette redraw with tinted gradient | -0.5ms per frame (low-life only) | Small |
| Add fps-driven auto-degrade | smoother low-end | Medium |

---

## 2. Input Latency

The design doc target is "input → first visible reaction ≤ 1 frame (16.6ms)" (§11.4). The current build is close but has measurable slack.

### 2.1 Racket lerp delays visible response by 60–80ms

`GameScene.update()` lerps `racket.x` toward `racket.targetX` at `lerp=0.22`. To reach 99% of the target takes ~`ln(0.01)/ln(0.78)` ≈ 19 frames = ~320ms at 60fps. Most of that is imperceptible because the racket is already most of the way there in 3–4 frames, but the racket *visibly* never quite arrives where the finger is. On a touchscreen that breaks the "magic wand" feel.

**Fix:** Halve the lerp constant to `0.40`, **OR** clamp distance — if `|targetX - x| > 8px`, snap to `targetX - 8 * sign(dx)`. This guarantees the racket is always within 8px of the finger after one frame.

### 2.2 Swing cooldown blocks legitimate fast rallies

`tryStartSwing()` enforces `swingCooldownUntil = now + windowMs + cooldownMs` = 220ms. A player who misses a swing must wait 220ms before the next swing registers. At Wave 6+ rally speeds, the ball can already be back at the racket inside 220ms. **The cooldown is currently a punishment for being late, layered on top of the existing punishment for being late.**

**Fix:** Drop the cooldown to 30ms. The hit-registered guard already prevents double-counting.

### 2.3 Pointermove fires only when `isDown`

`GameScene.setupInput()` guards `pointermove` on `p.isDown`. That's correct for the current design (drag-to-position) but means there's no "ready" state from a hover — fine for mobile, irrelevant for desktop. Not a bug, just be aware if we later add desktop polish.

### 2.4 GSAP score counter starts a new tween on every hit

`UIScene.onScoreChanged` calls `gsap.to(obj, { v: target, ... })` on every score event. Rapid hits create overlapping tweens on different temp objects. Each completes independently and updates the score text; in the worst case the visible score "judders" because multiple tweens are racing to overwrite it.

**Fix:** Tween a single persistent counter object (`this._scoreTween`), kill the prior tween before starting the new one with `gsap.killTweensOf(this._scoreCounterObj)`.

### 2.5 Countdown delays first action by ~1.7s

`showCountdown()` runs 4 × 360ms = 1440ms + a 220ms grace, then the ball serves after 420ms. From scene start to first playable moment: ~1.65s. That's not bad, but it's noticeable on a rematch — players want to be playing within 1.5s (the design doc's own retention rule).

**Fix:** Skip the countdown on rematch (only show on the first run of a session, or when entering from menu). Pass a `skipCountdown: true` payload to GameScene from GameOverScene's rematch handler.

---

## 3. Mobile Responsiveness

### 3.1 Aspect ratio handling

`Phaser.Scale.FIT` at 720×1280 preserves the design aspect (9:16 = 0.5625). On a modern phone at 1170×2532 (iPhone 14 Pro), the canvas fits to height and leaves ~36px wide vertical letterbox bars on each side. Acceptable. On a tablet in portrait at 4:3, the bars become huge.

**Fix (optional):** Use `Phaser.Scale.ENVELOPE` with a wider design canvas (e.g., 900×1280) and clamp the court bounds dynamically. Keep `FIT` if tablet players aren't a target.

### 3.2 Safe-area handling is half-done

`index.html` uses `viewport-fit=cover` and `style.css` pads `#game-wrap` by `env(safe-area-inset-*)`. The canvas inside is centered via flex, so it respects the safe area — good. **But** game HUD coordinates (lives at y=60, combo at y=H-100) are hardcoded. On a notched device in landscape, the notch can clip the lives badge.

**Fix:** Compute HUD positions from the *visible* canvas region, not raw width/height. Phaser exposes `this.scale.gameSize` and `this.scale.displaySize`.

### 3.3 Tap latency vs FastClick

Modern browsers no longer have the 300ms tap delay if `viewport` includes `width=device-width`. We do, so this is fine — but it should be confirmed with WebPageTest's Mobile-Latency probe on iOS 15+ Safari before launch.

### 3.4 Long-press context menu

`touch-action: none` is set on the canvas, which suppresses double-tap-to-zoom. But long-press still triggers a context menu on some Androids. Add `oncontextmenu="return false"` on the canvas wrapper or a global `contextmenu` listener that calls `preventDefault()`.

### 3.5 Audio unlock chain

Web Audio context is created in `window.load`, unlocked on first PLAY tap. On older iOS Safari (<15), simply resuming the context isn't enough — a silent buffer must be played in the same user-gesture callstack. Test on iOS 14 if backward compat matters.

### 3.6 Vibration

`PWC.juice.vibrate` calls `navigator.vibrate`. iOS Safari **does not implement** this — the call is a no-op. That's harmless but worth knowing: haptics only work for Android Chrome users. Not a fix, an expectation reset.

### 3.7 Battery / thermal

`fps.target: 60` is set, but there's no `fps.min` and no thermal-aware downscaling. On a hot phone, framerate drops and the game gets *harder* (physics step misses, balls clip). Add a moving-average fps gauge that drops particle/trail density when sustained < 50fps.

---

## 4. Architecture

### 4.1 GameScene is a 700-line god class

It owns the simulation, the visual effects, the audio triggers, the camera effects, the persistence, the difficulty director, and the countdown. That's six responsibilities in one file. It works at v0.9 scope but doesn't scale to v1.5 (modifier balls, daily seed, replay system).

**Refactor target:**

```
GameScene.js          ← orchestration, FSM, scene lifecycle
sim/Ball.js           ← ball physics + wall + jitter
sim/Racket.js         ← racket lerp + swing window + grading
sim/Director.js       ← waves, mercy slope, modifier scheduling
fx/JuiceController.js ← shake, freeze, slow-mo, flashes
fx/ParticlePool.js    ← all transient particle emitters (pooled)
fx/Pooled.js          ← generic acquire/release for text + sprites
```

These are still plain script files attached to `window.*`. No bundler.

### 4.2 Stringly-typed events

The cross-scene event bus uses bare strings: `'hit:perfect'`, `'score:changed'`, `'combo:tierUp'`. A typo silently no-ops. Centralize in `PWC.events`:

```js
PWC.events = {
  SCORE_CHANGED: 'score:changed',
  COMBO_CHANGED: 'combo:changed',
  // ...
};
// usage: this.game.events.emit(PWC.events.SCORE_CHANGED, payload);
```

Tiny change, big maintainability win.

### 4.3 Sim and presentation are tangled

`applyHit()` (around line 470) does, in this order: physics (velocity reflection), state (combo, score), persistence (longest combo), event emission, audio, particles, camera, racket tween, perfect-moment trigger, wave-advance check. The method works but cannot be unit-tested because every concern is wired into Phaser.

**Refactor:** Have `applyHit` return a `HitResult` `{perfect, combo, score, gained, tierUp}` and let a separate `presentHit(result)` handle audio/particles/camera. Then `applyHit` can be tested in isolation.

### 4.4 Scene transitions are fragile

The rematch flow calls `scene.stop('UIScene')`, `scene.stop('GameScene')`, `scene.start('GameScene')` in that order. Phaser queues these ops, but the queue order is "first stop runs, then start runs," which means GameScene's `create()` re-runs `scene.launch('UIScene')` — but UIScene was just stopped *in the same frame*. Phaser handles it (verified in 3.80) but the chain is implicit. Document or simplify.

### 4.5 PWC namespace assembly is one-shot

`PWC.config`, `PWC.colors`, `PWC.audio`, `PWC.storage`, `PWC.juice`, `PWC.motion` are all assigned at script-load. There's no defensive merge — if `game.js` were loaded twice, configs would overwrite cleanly but listeners wouldn't. For v1 single-load this is fine.

### 4.6 No error boundaries

If Web Audio fails to init (rare but happens in private browsing on Safari), every `PWC.audio.*` method silently no-ops via the `if (!this.ctx) return` guard. Good. But if `localStorage` is blocked (Safari ITP), `PWC.storage.save()` swallows the exception — also good. Make sure these are intentional: a postable `__debug__` flag could surface them.

---

## 5. Maintainability

### 5.1 No JSDoc, no types

Methods are uncommented except where intent isn't obvious. For a one-person project at this size that's fine. The moment a second contributor joins, JSDoc on the public surface (`PWC.audio.*`, `PWC.storage.*`, scene event payloads) starts paying off.

### 5.2 Mixed time units

Some constants are in seconds (GSAP `duration: 0.4`), some in ms (`PWC.config.swing.windowMs: 130`). The GSAP/Phaser split forces this. Keep the convention: **all PWC config is ms**, all GSAP durations are seconds. Don't drift.

### 5.3 Magic numbers that didn't make it to config

| Location | Constant | Comment |
|---|---|---|
| `GameScene.flashWall` | shake durations 140, 70 | Belongs in `PWC.motion.dur` |
| `GameScene.bounceSpark` | particle counts 6 | Belongs in config |
| `GameScene.flashDanger` | rectangle alpha 0.18 | Belongs in `PWC.colors` modifiers |
| `GameScene.drawVignette` | step count 16, line width 8 | Belongs in config |

Not bugs. Tuning friction.

### 5.4 Defensive method-existence checks

`obj.setLetterSpacing && obj.setLetterSpacing(4)` appears repeatedly. The check is hedging against older Phaser versions. Either pin the Phaser version (we already do — 3.80.1 via CDN) or drop the guards.

### 5.5 Unused properties

`this.directorJustAdvanced = false` is set in `GameScene.create()` and never read. Dead code.

### 5.6 `_displayedScore` not reset on rematch

UIScene caches `this._displayedScore = 0` in `create()`. On rematch, UIScene is stopped and re-launched, so create() re-runs — actually fine. Verified.

### 5.7 No linter, no tests

A single `eslint --init` + `eslint .` would catch the unused property and a couple of unused variables. A single Vitest-style smoke test of `PWC.config` shape would catch malformed configs before they break a run. Not critical at this size, but adding one of each takes 15 minutes and pays back forever.

---

## 6. Replayability

The retention scaffolding from the design doc is **not yet built**. Persistence works but the player has only one carrot (personal best) and no reason to return tomorrow.

### 6.1 What's currently in the build

- Personal best score (`PWC.storage.data.best`)
- Longest combo, total perfects (stored, never displayed in menu)
- Run count (stored, never displayed)
- Delta-to-best on game over (good)

### 6.2 What's missing from the design doc

| Feature | Design doc reference | Status |
|---|---|---|
| Daily seed | §4.3, §19 | Not built |
| Top-10 local leaderboard | §19 Tier 1 | Not built |
| Share card | §20 | Not built |
| Unlockable cosmetics | §18.5 (stretch) | Not designed yet |
| Modifier balls | §8.3 | Skipped from v0.9 |
| Tutorial / first-run onboarding | §4.4 (contextual hints) | Not built |

### 6.3 The meso-loop is weak

Within a run, the *only* signal that something has changed is the wave number bumping. There's no new color palette, no new audio stem, no new ball behavior (since modifiers are out). Players will plateau emotionally around Wave 4 and stop caring whether they hit Wave 8 or Wave 12.

**Fix priority: HIGH.** This is the single biggest gap between "good prototype" and "addictive."

### 6.4 No streak / daily continuity

A player who plays today and tomorrow has no shared thread. Add a "days streak" counter and surface it in the menu. Costs ~10 lines.

---

## 7. Scalability

### 7.1 Adding a second mini-game requires GameScene-internal changes

Design doc §18 envisions a multi-mini-game hub. The current GameScene hardcodes ball/racket/court — there's no abstraction for "this is one game inside a hub." Refactor scaffolding from §4.1 (sim/, fx/) is the precondition.

### 7.2 Adding modifier balls requires a new ball type system

There's currently one Ball (the `this.ball` image). Adding curveball/heavy/splitter/ghost/echo per design doc §8.3 needs:
- A `Ball` class instead of an image
- A `BallManager` that holds multiple balls
- A modifier-effect interface (`Curveball.update(ball, dt)`)
- Updated collision and miss logic to handle N balls

Estimated work: 2 focused days. Architecturally clean if §4.1 refactor lands first.

### 7.3 Audio is locked to procedural synth

`PWC.audio` is a Web-Audio synth bank. Howler is loaded but unused. If we later commission real audio (sting samples, music stems), `PWC.audio` needs a parallel "Howler-backed" implementation behind the same `play('hit')` interface. Define the interface now even if only synth ships.

### 7.4 Hardcoded scene boot order

`game.js` lists scenes in an array. New mini-games would mean editing that array. Use a scene registry with auto-discovery (each scene file calls `PWC.registerScene(class)`) — small change, large flexibility.

### 7.5 No content pipeline

If we ever want themed courts, custom rackets, seasonal balls — there's no asset descriptor format. A simple JSON `themes.json` with color tokens and asset paths, consumed at BootScene, would let non-engineers add themes.

---

## 8. Rendering Optimization

### 8.1 Court should be a baked texture

The court Graphics has ~10 fillRoundedRect/fillRect calls plus ~50 fillRect calls in a loop for the gradient strip. Phaser walks this list every frame. Bake once via `generateTexture('court_bg', W, H)` then `add.image`.

### 8.2 Particle textures are oversized

The `'particle'` texture is 24×24 with nested-circle alpha buildup — pretty but more than needed for a 3px hit chip. A 16×16 radial gradient would render 36% fewer pixels per particle. Across 250 particles per combo wave, this matters.

### 8.3 Additive blending everywhere is fine on WebGL, fragile on Canvas fallback

Most fx use `setBlendMode('ADD')`. WebGL handles this natively. Phaser's Canvas fallback emulates additive blending via per-particle compositing, which is markedly slower. Force WebGL in the config (`type: Phaser.WEBGL` instead of `Phaser.AUTO`) and accept that very old browsers (no WebGL) just won't run.

### 8.4 No depth strategy

Depths are assigned ad-hoc: vignette=50, crackFx=40, flash=60, banner=80, countdown=80. Easy to break. Define a `PWC.depth` enum:

```js
PWC.depth = {
  COURT_BG: -10, BALL_TRAIL: 0, WALL_FX: 5, BALL: 10,
  RACKET: 15, CRACK: 40, VIGNETTE: 50, FLASH: 60,
  HUD: 70, BANNER: 80, COUNTDOWN: 90,
};
```

### 8.5 Camera shake intensity is normalized

`cameras.main.shake(70, 0.0035)` — the second arg is normalized to camera dimensions. On portrait 720×1280, 0.0035 of width = ~2.5px shake. That's right. On a future landscape mode, the same normalized value would shake 9px vertically. Be aware before any landscape mode.

### 8.6 Camera zoom + shake interaction

When shake happens during zoom, the perceived shake distance is divided by zoom. Currently the zoom punch (1.02–1.05) is small enough not to matter, but if zooms grow, increase shake correspondingly.

---

## 9. Animation Optimization

### 9.1 GSAP tweens not killed on scene shutdown

UIScene creates dozens of GSAP tweens (popups, banners, button animations). On `scene.stop('UIScene')`, the GameObjects are destroyed but GSAP's tween list still references them. Each tick GSAP tries to update properties on a destroyed object. Phaser objects are nulled gracefully, so this doesn't crash, but it wastes CPU.

**Fix:** In `UIScene.shutdown()`, call `gsap.globalTimeline.clear()` or track all tweens in a `Set` and kill them explicitly.

### 9.2 Phaser tween conflicts on rapid hits

`UIScene.onComboChanged` calls `gsap.fromTo(this.comboValue, { scale: 0.85 }, { scale: 1.0, ... })`. If hits come faster than 320ms, multiple tweens overlap on `comboValue.scale`. GSAP's default is to add them — the value can spike past 1.0. Use `overwrite: true` in the GSAP config.

### 9.3 Mixed tween systems without clear policy

The doc (§12.4) split Phaser tweens for world objects and GSAP for HUD. The build mostly follows this but `MenuScene` uses GSAP for the ambient ball (a world object). Not wrong, just inconsistent. Pick a per-scene policy and stick to it.

### 9.4 Score counter animation cost

`UIScene.onScoreChanged` starts a 400ms GSAP tween on every hit. At 20 combo hits per 4 seconds, that's 20 overlapping tweens against 20 different temp objects. They harmlessly resolve, but it's wasteful. See §2.4 for the fix.

---

## 10. Code Quality

### 10.1 What's good

- Single namespace (`PWC`) — clean global hygiene
- Config-driven (most numbers are in `PWC.config`)
- Scene responsibilities are mostly clear
- Persistence has a graceful degradation path
- File structure matches the design doc exactly

### 10.2 What needs fixing

- **Long methods**: `applyHit` (50 lines), `perfectMoment` (35 lines), `onMiss` (60 lines), `endRun` (40 lines). All do more than one thing. Split.
- **Hardcoded color hex in some places** — e.g., `0xffffff` particle tints. Use `PWC.colors.text` (or a `PWC.colors.white` if you want literal white).
- **Inconsistent constant placement** — `nearMissPx` is at top level of config; `swing.windowMs` is nested. Either flatten or fully nest, don't mix.
- **No graceful path if a texture fails to generate** — `BootScene.generateTextures` always succeeds in practice but has no try/catch. A failure would silently break MenuScene's `add.image('ball')`.
- **Listener cleanup is partial** — UIScene has `detachListeners()`. GameScene has `shutdown()` for time-scale reset but doesn't unregister from anything because it doesn't register on `game.events` (it only emits). Correct, but worth verifying after the refactor.
- **`drawHeart` recreates the heart by calling `.clear()` every time** but is only called once at create time. Fine, but rename to `paintHeart` if it's meant to be redrawable, or drop the `.clear()` if it's one-shot.

### 10.3 Specific small bugs

- `GameScene.flashRacket()` overrides the racket tint to perfect-color even on miss-grade hits. Subtle visual confusion. Move the tint flip into `perfectMoment` only.
- `UIScene.drawComboBar()` uses `tier * 0.001` as a "tweak" to ensure visibility. Reads as a typo. Remove.
- `GameOverScene.ambientPulse()` reads `this.W = this.scale.width` after the scene has run for 800ms. Should be set in `create()` once.

---

# PART 2 — DOCUMENTATION & ROADMAPS

## A. Full Technical Documentation

### A.1 Tech stack summary

| Layer | Tech | Purpose |
|---|---|---|
| Markup | HTML5, `index.html` | Single-page mount, viewport, font preload |
| Style | CSS3, `style.css` | Page chrome, canvas centering, safe areas |
| Engine | Phaser 3.80.1 (CDN) | Scene system, input, arcade physics, rendering |
| HUD anim | GSAP 3.12.5 (CDN) | UI tweens decoupled from scene time scale |
| Audio | Web Audio API (procedural); Howler 2.2.4 loaded for future use | SFX bank |
| Persistence | `localStorage` | Best score, prefs, future leaderboards |
| Build | None | Static files only |
| Deploy | GitHub Pages | Static hosting |

### A.2 Scene model

```
BootScene ── generates textures ──► MenuScene ── PLAY ──► GameScene + UIScene (parallel)
                                                                │
                                                                ▼
                                                          GameOverScene
                                                          (rematch loop)
```

- **BootScene**: synthesizes textures, waits for fonts, fades to MenuScene
- **MenuScene**: title, PLAY, sound toggle, best badge, ambient ball
- **GameScene**: simulation owner. Spawns UIScene as parallel child
- **UIScene**: parallel HUD; subscribes to global `game.events`
- **GameOverScene**: death reveal, stats, REMATCH button

### A.3 Global namespace (`PWC`)

| Member | Purpose | Read by |
|---|---|---|
| `PWC.config` | All tuneables | All scenes |
| `PWC.colors` | Color tokens | All scenes |
| `PWC.motion` | Easing constants | UIScene, GameOverScene |
| `PWC.audio` | Procedural SFX bank | All scenes |
| `PWC.storage` | localStorage wrapper | GameScene, MenuScene, UIScene |
| `PWC.juice` | Vibration (+ future helpers) | GameScene |
| `PWC.game` | The Phaser.Game instance | None (debug only) |

### A.4 Event bus (`this.game.events`)

| Event | Payload | Emitter | Listeners |
|---|---|---|---|
| `score:changed` | `{score, gained, x, y, perfect}` | GameScene | UIScene |
| `combo:changed` | `{combo, tier, tierUp, perfect}` | GameScene | UIScene |
| `combo:tierUp` | `{tier}` | GameScene | UIScene (banner) |
| `combo:broken` | `{lost, tier, x, y}` | GameScene | UIScene (explosion) |
| `life:lost` | `{lives}` | GameScene | UIScene (heart anim) |
| `wave:advanced` | `{wave}` | GameScene | UIScene (banner, pips) |
| `triplePerfect` | `{}` | GameScene | UIScene (banner) |
| `run:ended` | full payload | GameScene | (none — read for analytics later) |

### A.5 Tuning surface

Every tunable lives in `PWC.config` at the top of `game.js`. Bookmark these keys for playtest iteration:

| Key | Effect |
|---|---|
| `ball.baseSpeed` | Starting serve speed (px/s) |
| `ball.speedCap` | Hard ceiling on ball speed |
| `ball.perBounceMul` | Wall-bounce speed gain |
| `ball.perReturnMul` | Player-return speed gain |
| `swing.windowMs` | Total swing window |
| `swing.perfectWindowMs` | Perfect sub-window (centered) |
| `difficulty.returnsPerWave[]` | Wave thresholds |
| `difficulty.jitterDegByWave[]` | Per-wave wall jitter |
| `difficulty.mercyMisses` | Misses needed to trigger mercy |
| `combo.multTable[]` | Score multiplier per combo level |
| `combo.tierAt[]` | Combo values at which tier increments |

### A.6 Local development

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

Direct `file://` open works for the game itself; audio context may need an HTTP origin on some browsers.

Useful URL params to add (currently unimplemented — see §15.6 of DESIGN.md):
- `?debug=1` — fps + ball-speed + combo overlay
- `?wave=5` — start at wave N
- `?seed=20260526` — fixed PRNG seed for deterministic runs

### A.7 Persistence schema

Stored under `localStorage[PWC:v1]` as JSON:

```json
{
  "best": 14820,
  "bestCombo": 23,
  "bestPerfects": 9,
  "runs": 47,
  "soundOn": true
}
```

Schema additions are backward-compatible: missing keys default in `PWC.storage.load()`.

---

## B. GitHub Pages Deployment Guide

### B.1 One-time setup

1. Push the repository to GitHub (any default branch).
2. **Repository → Settings → Pages.**
3. Under **Source**, select **Deploy from a branch**.
4. **Branch**: `main` (or whatever you ship from). **Folder**: `/ (root)`.
5. **Save.** Wait ~60 seconds for the first build.
6. Your game is live at `https://<user>.github.io/padel-wall-chaos/`.

### B.2 What makes it work

- `.nojekyll` (empty file at repo root) prevents Jekyll filtering.
- All asset paths use `./` (relative), so the game works under the `/padel-wall-chaos/` subpath.
- All third-party scripts come from CDN (Phaser, GSAP, Howler), so we pay no Pages bandwidth for them.
- No build step. The repo *is* the site.

### B.3 Cache strategy

GitHub Pages serves with aggressive cache headers (~10 minutes). For a content update:

- **HTML/CSS/JS files**: append a version query param to scripts in `index.html`, e.g. `<script src="./game.js?v=2026-05-26">`. This bypasses the cache for users.
- **No invalidation API**: GitHub Pages does not expose one. Versioned URLs are the only knob.

### B.4 Custom domain (optional)

1. Add a `CNAME` file at the repo root containing your domain (e.g., `padelchaos.app`).
2. Configure DNS:
   - `CNAME padelchaos.app → <user>.github.io.`
   - Or, for apex: 4 × A records pointing to GitHub's IPs (documented in their support article).
3. Enable HTTPS in Pages settings (auto-provisioned by Let's Encrypt; takes ~1 hour).

### B.5 Pre-launch checklist

- [ ] `.nojekyll` present
- [ ] All `<script src>` and `<link href>` use `./` (relative)
- [ ] `index.html` `<title>` and OG meta tags set
- [ ] `theme-color` meta matches background
- [ ] No `console.log` in production code (run a grep)
- [ ] Test on iOS Safari, Chrome Android, desktop Chrome, desktop Safari
- [ ] First-load total < 500KB (Phaser is 1.2MB minified but served via CDN cache)
- [ ] Lighthouse Performance ≥ 90 on mobile
- [ ] Audio unlocks on first PLAY tap (iOS gesture requirement)

### B.6 Analytics (no backend required)

- **GoatCounter** (free, privacy-friendly): one `<script>` tag, no PII.
- **Plausible** (paid, EU): also one tag, $9/mo.
- **Avoid** Google Analytics for this audience — privacy-aware mobile players actively block it.

---

## C. Mobile Optimization Checklist

A pre-launch and pre-update checklist. Run through this before every shipped build.

### C.1 Performance budget

- [ ] First-frame paint < 1.0s on mid-range Android over 4G
- [ ] Total JS shipped (excluding CDN) < 80KB minified
- [ ] First playable interaction < 2.5s from URL hit
- [ ] Steady-state RAM < 150MB on a 4GB-RAM Android
- [ ] No frame > 33ms during a 60-second run (measure via Chrome DevTools Performance trace)

### C.2 Touch and gestures

- [ ] `viewport` meta includes `width=device-width, initial-scale=1`, `user-scalable=no`
- [ ] Canvas has `touch-action: none` (CSS, applied)
- [ ] Long-press context menu suppressed (`contextmenu` event preventDefault)
- [ ] Double-tap doesn't zoom (covered by user-scalable=no)
- [ ] Pull-to-refresh disabled (`overscroll-behavior: none` on body, applied)
- [ ] No element accidentally selectable (`-webkit-user-select: none`, applied)

### C.3 Display

- [ ] Aspect ratio adapts to 9:16 through 9:21 (tall phones)
- [ ] Notch-safe via `viewport-fit=cover` + `env(safe-area-inset-*)` padding (applied to wrapper)
- [ ] Status bar color matches game background (`theme-color` meta, applied)
- [ ] iOS PWA-capable meta tags present (applied)
- [ ] Bottom home-indicator area not used for critical UI

### C.4 Audio

- [ ] Audio context created lazily (only on user gesture)
- [ ] First sound plays within the same callstack as a tap event (iOS requirement)
- [ ] Audio respects system "silent mode" where the OS supports it (iOS lacks Web Audio mute respect — known)
- [ ] Mute toggle persists across sessions (yes, via localStorage)

### C.5 Battery and thermals

- [ ] Framerate capped at 60 (no 120fps burn)
- [ ] Animations pause when the tab is hidden (Phaser does this by default; verify)
- [ ] Auto-degrade trail/particle density when sustained fps < 50 (TODO — design doc §15.5)
- [ ] No `setInterval` in the hot loop (we use Phaser's update — good)

### C.6 Network

- [ ] Game runs fully offline after first load (TODO — add a service worker for v1.5)
- [ ] No analytics blocking the load (defer everything non-essential)
- [ ] Fonts loaded with `display=swap` (applied in Google Fonts URL)

### C.7 Accessibility floor

- [ ] Color choices pass WCAG AA contrast for HUD text (verify: white on `#0e1d2a` = ~14:1, fine)
- [ ] Critical info not color-only (lives use shape + color)
- [ ] Reduce motion fallback (TODO — respect `prefers-reduced-motion` to skip slow-mo)
- [ ] All controls reachable by one hand in either thumb's natural arc

### C.8 Storage

- [ ] All persisted keys namespaced (`PWC:v1`, applied)
- [ ] Failure to write does not throw (`try/catch` applied)
- [ ] Schema versioned so v2 can migrate

---

## D. Future Multiplayer Roadmap

The brief is "no backend" — that constrains multiplayer to **local same-device** and **async share-card** modes for v1.x. Real-time online is a v3 conversation, separate.

### D.1 V1.5 — Hot-seat (two players, one device)

**Mode**: alternating one-life mode. Player A plays until first miss, Player B plays. Highest score wins. ~3 minutes per match.

**Implementation**:
- Add a new menu entry: "1P · 2P"
- In 2P mode, after each `run:ended` event, show a "Player 2 — pass the phone" handoff screen
- Track both scores; compare at the end
- ~150 lines, one weekend.

**Why this first**: zero infrastructure, fits the audience (friends at a café), shareable IRL moments.

### D.2 V2.0 — Async ghost mode

**Mode**: each daily seed records the day's top local ghost (combo + timing trace as a thin JSON). A friend playing the same seed sees a translucent "ghost ball" that mirrors yesterday's top run's positions.

**Implementation**:
- Capture per-frame ball position into a typed array during a run
- Compress with run-length encoding (~5KB for a 90s run)
- Encode in the share-card URL or QR code (still no backend)
- On receipt, decode and replay alongside the live ball

**Why second**: keeps no-backend constraint, adds presence without latency.

### D.3 V2.5 — Lobby mode (split-screen, two devices on local Wi-Fi)

**Mode**: peer-to-peer over WebRTC data channel. Both players play simultaneously on synchronized seeds. Each sees only their own ball but score deltas are live.

**Implementation**:
- WebRTC offer/answer via QR-code exchange (no signaling server needed for local)
- Lockstep simulation seeded identically; deltas only on miss/perfect events
- Latency tolerance: ±100ms acceptable (the games are independent — only state syncs)

**Why third**: medium complexity, high WOW factor, still no server.

### D.4 V3.0 — Real-time online (needs backend)

Out of scope for the "no backend" constraint. If pursued: a signaling server (Cloudflare Workers, free tier) for WebRTC discovery + a Redis Pub/Sub for matchmaking. ~$5/month at hobby scale.

### D.5 Multiplayer-specific design risks

- **Asymmetric devices**: Player A's iPhone runs at 60fps, Player B's Android at 45fps — same seed, different timings. Lockstep helps but needs a fixed simulation step (not delta-based) which is a refactor.
- **Pause exploits**: a player who pauses gains thinking time. Disable pause in 2P modes.
- **Connection drops in lobby**: have a graceful "opponent disconnected, here's your score so far" path.

---

## E. Future Daily Challenge Roadmap

The daily challenge is the **single highest-ROI retention feature** for this kind of game. Implementable entirely client-side.

### E.1 V1.5 — Local daily seed

**Mechanic**: each day, the game uses `YYYYMMDD` as the integer seed for a seeded PRNG that drives serve angles, modifier order, jitter sequence. Everyone playing today gets the same opening 30 seconds.

**UI**:
- Menu shows "Today's Challenge" button alongside "Play Endless"
- During the daily run, the wave label is replaced with "DAILY · 26 MAY"
- Game over shows "Today's run: 12,400 — your best today: 14,200"

**Implementation**: ~80 lines. A seeded PRNG (e.g., `mulberry32`) replacing all `Phaser.Math.RND` calls inside the seeded section.

**Persistence**: store the top 5 attempts of today under `PWC.storage.data.daily[YYYYMMDD]`. Prune > 7 days old.

### E.2 V1.7 — Streak system

A "days played" streak counter. Played → +1. Skip a day → reset. Surface as a chip in the menu: "🔥 7-day streak."

Free-to-implement, psychologically powerful. People hate losing streaks; Duolingo built an empire on it.

### E.3 V1.9 — Weekly tournament (still local)

**Mechanic**: each Monday, a fixed seed runs for 7 days. Players can attempt as many times as they want; the best of the week is recorded.

**UI**:
- Weekly leaderboard panel in menu (top 5 of your own attempts this week)
- A "this week's best" badge that resets every Monday

### E.4 V2.0 — Shared daily (still no backend)

Combine the daily seed with the share-card system:
- Game-over card includes the date as a watermark
- "Today's Best" share button posts your top run of today
- The seed itself is shareable as a URL param (`?seed=20260526`) so friends can play any past day

### E.5 V2.5 — Cloud daily (needs *minimal* backend)

A read-only JSON file hosted on a static CDN (Cloudflare Pages, free) listing the day's top 10 scores worldwide. Updated hourly by a tiny serverless function that aggregates submissions.

Players opt in to submit a score with a single button tap and an optional nickname. Submission is a fire-and-forget POST to a Cloudflare Worker (~$0/month at hobby scale).

### E.6 Daily-specific design risks

- **Skill gating**: the same daily seed is harder for new players than veterans. Show your *personal best of today*, not the global one, as the primary motivator.
- **Reset timing**: midnight in *whose* timezone? Use local midnight to maximize psychological reward (your day, your reset).
- **Cheating**: a determined cheater can edit localStorage. For the cloud daily, validate scores against a server-side seed replay (a Worker can do this in ~50ms).

---

## F. Future Tournament Mode Roadmap

A separate, structured competitive mode layered on top of endless and daily.

### F.1 V2.0 — Local bracket tournament

**Mechanic**: a 4 or 8-player single-elimination bracket on one device. Each match is best-of-3 one-life runs.

**UI**:
- Bracket visualization (clean, minimal)
- Animated advancement between matches
- A trophy screen for the winner

**Implementation**: ~250 lines. UI-heavy, simulation-cheap.

**Why this exists**: parties, family game nights, classrooms. This is the niche this kind of game owns.

### F.2 V2.3 — Seasonal ladder

**Mechanic**: a 30-day "season." Each daily-challenge attempt earns ladder points (your best score that day / 100 + bonus for top-5 placement). Season totals reset every 30 days.

**UI**:
- A small "Season X · Day 7 · 12,400 pts" line in the menu
- End-of-season summary screen ("you placed in the top 12% of your local sessions")

**Why this matters**: it converts daily play into long-term progression without requiring a global leaderboard.

### F.3 V2.6 — Async tournament rooms (peer-shared)

**Mechanic**: a player creates a "room" defined by a seed + length (e.g., "best of 5 attempts on seed X"). The room code is a QR / short URL. Friends play the same seed; everyone's scores are reported back via share-card uploads to a common JSON file (Pastebin, GitHub Gist as backend — still serverless from our side).

**Implementation**: 1 week. Mostly URL encoding and a JSON read.

### F.4 V3.0+ — Sponsored tournaments

If the audience grows: partner with a padel club / brand to run a real-money tournament. Scores submitted via a verified-replay endpoint. Out of scope for now.

### F.5 Tournament-mode design risks

- **Length**: arcade reflex matches are short; a bracket can finish in 15 minutes. Make the match itself feel weighty (announce the winner, dramatic camera moves) — it's the only way short matches feel like "matches" instead of "runs."
- **Power dynamics**: in family bracket play, a 6-year-old vs a 30-year-old isn't fun. Build in a difficulty handicap (longer swing window for selected players) without making it patronizing.
- **Spectator UI**: in local bracket, players who are out should still be entertained. Show a chill ambient screen with the bracket.

---

## G. Monetization Opportunities

Web games on Pages have weird monetization economics. The realistic options:

### G.1 Tier 1 — No-cost, low-risk

- **Donation link** in the menu. PayPal.me, Stripe Buy Button, "Buy me a coffee." Conversion is awful (~0.3%) but free to set up. ~$5–50/month potential at modest traffic.
- **Affiliate links** to padel equipment (Amazon, Decathlon). One discreet "racket?" link on the menu. Pennies per click but $0 effort.

### G.2 Tier 2 — Cosmetic micro-purchases (requires payment processor)

- **Court themes** ($1.99 each): neon, retro, beach, midnight. Pure cosmetic.
- **Racket skins** ($0.99 each): tied to combo tiers ("unlocks at 100 perfect hits").
- **Ball trails** ($0.99 each): fire, lightning, rainbow.

**Implementation**: Stripe Checkout in a popup, JWT-signed unlock token stored in localStorage. ~$0/month overhead at hobby scale. Probably **not worth it** until DAU > 500.

### G.3 Tier 3 — One-time premium upgrade

- **"Padel Wall Chaos+"** ($2.99 one-time): unlocks all current cosmetics + future ones, removes the donation prompt.

Cleaner narrative than F2P micro-transactions. Mobile gamers respond to "buy once, done."

### G.4 Tier 4 — Sponsorship

- **Branded tournament** (per F.3): a padel brand pays for a week-long event with their logo on the menu screen. Realistic ask at DAU > 5K.
- **Native banner** on the menu (NOT during play): "Brought to you by [brand]." Non-intrusive.

### G.5 Tier 5 — Wrap and re-ship (this is the real money)

The web build is the prototype. Wrap it with **Capacitor** or **Cordova**, submit to the App Store and Google Play. Same code. Add:

- Apple/Google IAP for cosmetics
- Ad SDK (rewarded video for "continue this run with 1 extra life")
- Game Center / Play Games leaderboards
- Push notifications (daily challenge reminder)

This is where the actual revenue lives. The web version becomes the funnel.

### G.6 What to **avoid**

- **Interstitial ads** during gameplay. Audience hates them; will uninstall.
- **Energy systems** ("3 free games per hour"). Antithetical to the "one more try" loop.
- **Pay-to-win mechanics**. The game has no win state to pay for — keep it that way.
- **Loot boxes**. Regulatory minefield, especially in EU.

### G.7 The honest math

For a free web game, expect:
- 1,000 monthly visits → ~$5–20 in ad/affiliate revenue at best
- 10,000 monthly visits → ~$50–200
- 100,000 monthly visits → ~$500–2,000

For a wrapped App Store version with cosmetics:
- 1,000 installs → ~$20–100 lifetime revenue
- 10,000 installs → ~$200–1,500
- 100,000 installs → ~$5,000–30,000

These are realistic order-of-magnitude estimates. Most indie web games never see 1,000 visits. **Plan for the love, not the revenue.**

---

# PART 3 — BRUTALLY HONEST FEEDBACK

I built this. I'll tell you what's wrong with it.

## H. Weak Points

### H.1 In the code

- **The pooling work isn't done.** I wrote a design doc that mandates pooling, then shipped code that allocates on every hit. That's a self-imposed technical debt I should have paid down in v0.9.
- **GameScene is doing too much.** 700 lines is the upper limit of what one engineer can hold in their head. Split before adding modifier balls.
- **No instrumentation.** The build has no fps overlay, no telemetry, no way to verify performance in the wild. Flying blind.
- **Tests don't exist.** A single broken tuning value (e.g., setting `perBounceMul` to `4`) makes the game unplayable, and there's no automated way to catch it.

### H.2 In the game design

- **The hit mechanic is non-obvious.** A new player will expect "touch the racket to the ball" — they get "tap to swing in a 130ms window." That's a real skill mechanic but it's invisible. Without a tutorial or visual telegraph for the swing window, players will think they're missing balls that "clearly touched the racket."
- **Tap = position + swing is overloaded.** A player who wants to reposition the racket without swinging *can't*. Every tap costs a swing. Two-handed players solve this; one-thumb players are penalized.
- **The "5-second test" probably fails today.** First-run is: 1.7s countdown, 0.4s telegraph, then a slow Wave 1 serve. By second 5, the player has hit maybe 2 balls and isn't yet wowed. The 5-second test needs the wow moment in the first 5 seconds — and the first serve should be slower-but-perfectly-juiced, not slower-and-undecorated.

## I. Retention Risks

### I.1 The "why come back tomorrow?" question is unanswered

- No daily challenge → no notification reason → no return.
- No streak → no loss aversion.
- No unlocks → no goal beyond "beat your score."
- No social → no presence of others.

A player who plays 3 runs today will not play tomorrow unless one of those is added. **Daily challenge is the cheapest, highest-impact fix.** Build it first in v1.1.

### I.2 The meso-loop dies around Wave 4

Inside a single run, the only escalation signal is the wave number bumping. There's no visual transformation (court palette doesn't really shift), no new ball, no new music stem. By Wave 4, players are emotionally plateaued even if the chaos is technically ramping.

Modifier balls (design doc §8.3) directly address this. They were cut from v0.9 to focus on core feel — that was right, but they should be the very next feature, not a stretch.

### I.3 The macro-loop has nothing past personal best

A player who breaks their personal best at run 8 has nothing to chase at run 9. Even Tetris had levels. Add at least:
- Longest combo (separate goal, different play style)
- Most perfects in a run (rewards precision over endurance)
- Wave reached (encourages survival)

These already exist in `PWC.storage` but aren't visible in the menu. Surface them.

### I.4 The first-run experience is a cliff, not a slope

There's no onboarding. A confused player has no help. The "tap anywhere to swing" pattern needs a one-time visual hint on first run — even a single ghost-tap animation pointing at where to touch.

## J. Gameplay Risks

### J.1 The skill ceiling might not exist

With a 130ms swing window and a 60ms perfect zone (46% of the window!), most taps are "good." The grade distribution will skew toward perfect/good by a lot. That makes "perfect" feel un-special. Tighten to 30ms perfect (23% of the window) to give it real prestige.

### J.2 The combo system is mathematically un-exciting

Multiplier `1.0` through combo 2, then `1.2, 1.4, 1.6` — the player needs to land 6 hits before seeing meaningful score growth. Front-load this: start at `1.1` from combo 1, ramp faster early. Players who quit at run 3 never reach the satisfying multipliers; only the survivors enjoy the curve.

### J.3 The mercy slope is silent and *too* generous

8% serve speed reduction for 3 returns after 2 misses in 5 returns. That triggers easily and stays invisible. It's the right *idea* but should be smaller (~4%) and shorter (2 returns) so it doesn't quietly carry mediocre play to undeserved wave milestones.

### J.4 No "death by inches" experience

When a player misses by 20px, the game animates a generic miss. Compare: the player sees their ball pass *just* past the racket in dramatic slow motion, with a "missed by 18 pixels" overlay. That sells the next run. Currently the near-miss slow-mo plays but doesn't *show* the inches.

### J.5 Two balls in play simultaneously (design doc Wave 6) is going to be terrible without prototyping

Two balls in a single 720-wide court will look like clutter. Either drop the feature, or stagger them so only one is ever in the "approach the racket" phase at a time. Prototype before designing the higher waves around it.

## K. Scope Risks

### K.1 One person, one codebase, no audio/visual collaborator

The procedural-everything approach is a smart constraint for now, but it has a ceiling. To reach "Apple Arcade-quality," you need either:
- A pixel artist for ball/racket/court/effects
- An audio designer for real samples (or at least a polished synth bank)
- Yourself, but with 200 hours invested in juice tuning

Without one of these, the game tops out at "really good prototype" — never "premium."

### K.2 The roadmap is ambitious for a part-time project

Modifier balls + daily seed + share card + tournament mode + 2P hot-seat + multiplayer is **a year** of evening work. Pick three and ship them well.

My pick (in order): daily seed, modifier balls, share card. Those three create a complete v1.5 product. Everything else is v2.

### K.3 No analytics means no data

You will guess what's working. Even a single PostHog or GoatCounter line giving you "average run length" and "rematch rate" would change every design decision you make. Add it before launch.

### K.4 The web platform is fragile

Browser API drift, iOS Safari bugs, Phaser updates, GSAP licensing changes — all of these can break your live game without warning. **Pin every dependency version. Test on real devices before every push.** GitHub Pages has no rollback button; a broken push is broken until you fix it.

## L. What Could Make This Exceptional

These are the moves that take this from "really good" to "people make TikToks about it."

### L.1 The replay highlight reel

After a run, the game auto-saves the last 5 seconds of play (ball positions, racket positions, sound triggers — tiny data). On game over, it offers "watch the moment you died." Slow-motion replay with the ball flying past the racket. Add a "share" button on the replay → renders an MP4 client-side via `MediaRecorder` API. **This is the single highest-virality feature you could build.**

### L.2 The daily seed + global leaderboard combo

Done well, this turns the game into a daily ritual. Wordle proved this. The combo of "same puzzle for everyone today" + "share your result" is the closest thing to free marketing the modern internet offers.

### L.3 A second mini-game

Build "Service Ace" or "Drop Shot" (design doc §18.2) in the same visual language. Suddenly you have a *micro-arcade*, not a single game. The hub concept transforms the brand.

### L.4 A signature sound

Right now the audio is synthesized and serviceable. Commission (or self-compose) a **signature 4-note motif** that plays when you break your personal best. People will remember it. The Tetris theme, the Mario coin sound — these are the assets that outlive their games.

### L.5 An actual character

The game has no protagonist. Even an abstract one — a single emoji-style "you" mascot in the corner that emotes after big plays — would create *attachment*. "I made the racket happy" is more powerful than "I scored 14,820."

### L.6 Physical-world tie-ins

Find a padel club. Set up a free wall-projector tournament. Let real players play it on a wall. Film it. Post it. **One viral video > 1000 hours of polish.**

### L.7 Constraint as identity

The "no backend, no build, single thumb" constraints aren't limitations — they're an identity. Lean into it. The README and itch.io page should say:

> **A 200KB game. No tracking. No accounts. No ads. One thumb. Made by one person.**

That is the kind of positioning that gets press in 2026.

---

## End of audit

If I had to pick three things to do next, in priority order:

1. **Pool the hot path** (1 day). The single biggest QoL win for low-end mobile.
2. **Daily seed + show "today's best" in menu** (1–2 days). The single biggest retention win.
3. **A 5-second onboarding pass** (1 day). Fix the cliff that's losing first-run players right now.

After those, everything else is iteration. Without them, the rest of the polish doesn't matter — because the audience is already gone.

— end —

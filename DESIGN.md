# Padel Wall Chaos — Preproduction Design Document

> **Status:** Preproduction · v0.1
> **Working title:** Padel Wall Chaos
> **Genre tags:** Arcade · Reflex · Endless · One-button · Mobile-first
> **Pitch (one line):** A hyper-stylized padel rally turns into beautiful chaos — survive the walls, chain the combos, get pulled into one more run.
> **Pitch (one paragraph):** Padel Wall Chaos is a 30-to-90-second arcade reflex game where the court itself becomes the antagonist. Balls whip off four glowing walls at impossible angles while the player, a single elegant racket at the bottom of the screen, must read, anticipate, and counter-swing with one thumb. Every clean return tightens a combo string that bends time, color, and sound. Every miss cracks the court. The game lives in the space between a tennis volley and a pinball machine, with the visual restraint of Apple Arcade and the kinetic punch of a Nintendo party game.

---

## 0. Reading guide

This document is the source of truth before a single line of game code is written. It is structured so that:

- **Sections 1–4** define **why** the game exists and how it should feel.
- **Sections 5–10** define **what** the game is mechanically.
- **Sections 11–14** define **how** the game presents itself.
- **Sections 15–17** define **how** the game ships and stays performant.
- **Sections 18–20** define **where** the game goes after launch.

Every section ends with a short **Implementation Notes** block aimed at the engineer (you, future-me, or a contributor) — this is what gets translated into code in the next phase.

---

## 1. Core Gameplay Loop

### 1.1 The loop, in 12 seconds

1. A ball is **served** from one of the four walls.
2. The ball **rebounds** off walls, accelerating and curving.
3. The player **reads the trajectory** and prepares.
4. The player **swipes or taps** in a precise window to return.
5. On a clean return, the ball **rockets back into the chaos** and a **combo counter ticks up**.
6. On a miss, a life cracks; on three misses, the run ends.
7. Every N successful returns, the **difficulty layer escalates** (new ball, new pattern, new modifier).
8. Run ends → animated score reveal → personal-best comparison → **REMATCH** button pulsing under the thumb.

### 1.2 Loop layers

The game runs three nested loops at different time scales. Designing all three is what makes the game addictive instead of merely fun.

| Layer            | Duration       | Question the player is answering                  | Reward                                |
|------------------|----------------|---------------------------------------------------|---------------------------------------|
| **Micro-loop**   | ~0.4 – 1.2 s   | "Can I read and hit *this* ball?"                 | Hit feedback, combo tick, juice burst |
| **Meso-loop**    | ~10 – 25 s     | "Can I sustain this rally through the next wave?" | Modifier reveal, score milestone, slow-mo moment |
| **Macro-loop**   | ~45 – 120 s    | "Can I beat my personal best?"                    | New high score, unlock, share card    |

If any of these three feels weak, the others collapse. A great micro-loop with a flat meso-loop produces a tech demo; a great meso-loop with no macro stakes produces boredom by run 4.

### 1.3 Loop pacing curve

```
intensity
   ▲
   │                              ╱╲    ← chaos peak (cap difficulty)
   │                           ╱╲╱  ╲
   │                       ╱╲╱        ╲╲    ← player either dies or breaks personal best
   │                   ╱╲╱
   │               ╱╲╱        ← combo wave 2 (new modifier introduced)
   │           ╱╲╱
   │       ╱╲╱        ← combo wave 1 (speed-up)
   │   ╱╲╱
   │ ╱╯  ← onboarding rally (3–5 easy returns)
   └────────────────────────────────────────────────►  time
```

The curve is not linear. It is **sawtooth-with-rising-mean**: each new "wave" introduces a brief moment of breathing (a slower serve, a slight zoom-out) so the player feels the chaos resetting *just enough* to think they have it under control — before it spikes again.

### 1.4 Implementation Notes

- Implement loop as a **finite state machine** inside `GameScene` with explicit states: `Serving → InPlay → Returning → Recovery → Serving`.
- Wave escalation lives in a separate `DifficultyDirector` object (not coupled to the FSM) so it can be tuned independently.
- The slight breathing moment at the start of each wave is non-negotiable — it is the single most important pacing tool.

---

## 2. Game Feel Philosophy

### 2.1 The North Star

> **"The player's thumb should feel like a magic wand."**

Every input must produce more output than the player paid for. A tap returns a ball *and* a screen pulse *and* a chime *and* a particle burst *and* a number popping. That asymmetry — small input, huge output — is the entire point of arcade design.

### 2.2 The Five Feels

These are the five sensations the game must produce. Every system, animation, and sound is graded against this list.

1. **Snap** — inputs respond within a single frame. No floaty delay. No "almost".
2. **Weight** — when something matters (a perfect hit, a combo milestone), the world momentarily resists time. Screen freezes 50–80ms, audio dips, then everything releases at once.
3. **Bloom** — successful actions overshoot visually. Scale-up past the target, then settle. Color goes brighter than it should, then calms.
4. **Crunch** — failures are loud, short, and unmistakable. The court cracks, the screen lurches, the music ducks. Failure is *information*, never confusion.
5. **Flow** — between high-juice moments there must be visual quiet. Juice over a quiet baseline is shocking. Juice over juice is noise.

### 2.3 The "5 second" test

A first-time player who has never seen the game should feel something — a smile, a flinch, an "oh!" — within five seconds of the ball being served. If they don't, the opening is too gentle.

### 2.4 Hit categories and their feel

| Result            | Window      | Visual                              | Audio                          | Haptic (where supported) |
|-------------------|-------------|-------------------------------------|--------------------------------|--------------------------|
| **Perfect**       | ±60 ms      | Cyan/white flash, 80ms freeze-frame | Bright chime + sub thump       | Sharp tick               |
| **Good**          | ±150 ms     | Soft white flash                    | Crisp racket *thwock*          | Light tick               |
| **Late / Early**  | ±220 ms     | Ball returns weakly, no flash       | Muted *plink*                  | None                     |
| **Miss**          | Out of zone | Court crack, red vignette, 200ms shake | Low thud + crowd "oof"      | Strong buzz              |

### 2.5 Implementation Notes

- Build a single `JuiceController` module that exposes verbs (`flash`, `shake`, `freeze`, `bloom`) so designers can tune feel without hunting through scene code.
- Reserve `freeze` (time scale → 0) for **perfect hits only** and **run-ending miss only**. Overuse destroys the magic.
- All juice is **additive** to gameplay, never blocking. The simulation continues underneath; only presentation pauses.

---

## 3. Replayability Psychology

### 3.1 Why people replay arcade games

Arcade replay is driven by four overlapping psychological levers. A run-based game needs at least three of them functioning at any given moment:

1. **Mastery** — "I think I can do that better." Skill ceiling must be visible from run 1.
2. **Variance** — "The next run will be different." No two openings should feel identical.
3. **Proximity to victory** — "I almost had it." Most runs should end one beat away from a new personal best.
4. **Narrative drama** — "That run was wild." Even a 20-second failure should produce a story.

### 3.2 How Padel Wall Chaos hits each lever

| Lever          | Mechanism in Padel Wall Chaos                                                               |
|----------------|---------------------------------------------------------------------------------------------|
| Mastery        | Perfect-hit timing window stays the same forever — players literally see themselves improve.|
| Variance       | Wall spawn pattern, serve angle, and modifier order randomize within tuned ranges.          |
| Proximity      | Score display animates *toward* personal best and visibly stops short on near-misses.       |
| Drama          | Slow-motion on perfect hits, screen-crack on death, replay card on game over.               |

### 3.3 The "almost" engineering

The game must **engineer the feeling of almost-winning**. Practical implementation:

- On a near-personal-best run, **delay the death animation by ~250ms** and zoom into the ball as it sails past the racket. The player watches themselves lose by inches.
- Always display **delta to personal best** in large type on the game-over screen, even when negative. Loss feedback is engagement.
- A **"new best!"** flourish must be reserved and loud — it's the carrot, don't cheapen it with participation trophies.

### 3.4 Implementation Notes

- Persist personal best, longest combo, total runs, and total perfects in `localStorage` under a single namespaced key.
- On game over, compute and display three deltas: vs personal best, vs last run, vs longest combo. Pick the most flattering one to highlight first (subtly biasing toward forward motion).

---

## 4. "One More Try" Retention Design

### 4.1 The 1.5-second rule

> **From the instant a run ends to the instant the next run is playable, less than 1.5 seconds may elapse if the player wants to skip.**

Anything longer is a doorway out of the game. This is the single most important UX constraint in the entire project.

### 4.2 The death-to-rematch sequence

```
0 ms      Miss detected. Ball flies past racket.
50 ms     Court crack animation begins. Music ducks. Time scale 0.3x.
350 ms    Score number flies upward into the score banner.
600 ms    Personal-best delta animates in.
800 ms    REMATCH button blooms under the player's thumb position (mobile).
800 ms    First tap from this moment instantly restarts. No confirmation. No menu.
```

The REMATCH button is **placed where the thumb was last seen** for mobile, and centered + spacebar/enter-armed for desktop.

### 4.3 The carrot stack

At any given moment the player should be chasing at least two of the following:

- **Personal best score** (always visible during run as a thin line at the top)
- **Longest combo** (separate stat — encourages a different play style)
- **Perfect-hit streak** (rare, prestigious)
- **Wave milestone** (visible "Wave 3 → Wave 4" callout)
- **Daily seed** (future) — same starting conditions for everyone today

### 4.4 Anti-frustration design

Addiction is not the same as punishment. The game must avoid four specific failure modes that kill long-term play:

1. **Unreadable death** — every miss must clearly show *why* the player missed. The replay card includes the last 3 ball positions.
2. **Loadout fatigue** — no menus, no inventory. The game restarts in the same configuration.
3. **Tutorial gating** — no forced tutorial after run 1. Hints fade in contextually.
4. **Punishing comebacks** — restarting never penalizes (no "you lost your streak"). The streak is a goal, not a leash.

### 4.5 Implementation Notes

- Pre-warm the next run's state during the game-over animation so the rematch tap has zero perceptible load.
- `GameOverScene` and `GameScene` should share an asset cache; never reload between attempts.
- The REMATCH button is a Phaser interactive zone, *not* an HTML element, so it inherits the canvas's input pipeline and avoids touch-delay issues.

---

## 5. Phaser Architecture

### 5.1 Engine choice rationale

Phaser 3 is chosen for:

- Mature scene system with clean lifecycle hooks.
- Arcade Physics (good enough for our non-realistic needs; we'll override where needed).
- First-class touch + pointer input.
- Single-file CDN deployment — fits the "no build tools" constraint.

GSAP is layered on top for **all UI and feel animations** (score popups, screen transitions, button blooms). Phaser tweens are reserved for in-world game objects. This split keeps responsibilities clean.

Howler.js handles audio — Phaser's audio is fine but Howler gives us better mobile unlock behavior and cleaner sprite/fade APIs.

### 5.2 Scene graph

```
BootScene        →  preload bare-minimum assets, init audio, show studio splash
     ↓
MenuScene        →  title, play button, settings (sound toggle), best score badge
     ↓
GameScene        →  the actual game; runs simulation
     ↕  (parallel)
UIScene          →  HUD overlay (score, combo, lives, wave) — separate scene so it doesn't shake with the world
     ↓
GameOverScene    →  death sequence, score reveal, REMATCH
     ↑
     └──→ back to GameScene
```

`UIScene` runs **in parallel** with `GameScene`. This is critical: when `GameScene` shakes, the HUD must stay still, or the HUD becomes unreadable during the most important moments.

### 5.3 Scene responsibilities (strict)

| Scene          | Owns                                                   | Does NOT own                          |
|----------------|--------------------------------------------------------|---------------------------------------|
| BootScene      | Asset preload, font ready, audio unlock                | Game state                            |
| MenuScene      | Title flow, settings persistence                       | Gameplay                              |
| GameScene      | Simulation, physics, world rendering, input → action   | HUD, menus, persistence               |
| UIScene        | Score, combo, lives, wave indicator, juice on HUD only | Simulation                            |
| GameOverScene  | Death animation, score reveal, restart logic           | Score *calculation* (GameScene emits) |

### 5.4 Cross-scene communication

Use Phaser's global event emitter (`this.game.events`) as the only inter-scene channel. Emit semantic events:

- `score:changed`
- `combo:changed`
- `combo:broken`
- `life:lost`
- `wave:advanced`
- `hit:perfect`
- `run:ended`

Scenes subscribe; they never reach into each other. This decoupling is what makes the codebase survive feature additions.

### 5.5 Folder mapping to code

```
/scenes/BootScene.js      ← class BootScene extends Phaser.Scene
/scenes/MenuScene.js      ← class MenuScene extends Phaser.Scene
/scenes/GameScene.js      ← class GameScene extends Phaser.Scene
/scenes/UIScene.js        ← class UIScene extends Phaser.Scene
/scenes/GameOverScene.js  ← class GameOverScene extends Phaser.Scene
game.js                   ← Phaser.Game config, scene list, global event bus init
```

Each scene file exposes a single class via `window.SceneName` (no modules, no bundler — see Section 16).

### 5.6 Implementation Notes

- Boot order in `game.js`: `[BootScene, MenuScene, GameScene, UIScene, GameOverScene]`.
- `UIScene` is launched (`scene.launch`) in parallel from `GameScene.create`, not from the boot list.
- Pause/resume `GameScene` while `GameOverScene` runs, but keep `UIScene` rendered for the score handoff animation.

---

## 6. Physics System

### 6.1 Physics philosophy

> **The physics must be readable, not accurate.**

Real padel balls have spin, drag, and topspin curves. We will ignore most of that. The model is a **stylized 2D billiard** with custom acceleration rules and a small amount of "designer cheating" to keep the ball entertaining.

### 6.2 Engine

Use **Phaser Arcade Physics** as the base. Override where needed:

- Wall collisions: Arcade Physics (axis-aligned bounces are perfect for our court).
- Ball acceleration over rally length: custom (multiply velocity by a small factor each bounce, capped).
- Player hit detection: **not** physics-based — a timing window around the racket sweet spot is checked manually (see Section 7).

### 6.3 Ball model

| Property         | Value / behavior                                                              |
|------------------|-------------------------------------------------------------------------------|
| Shape            | Circle, ~14 px radius at base resolution                                      |
| Mass             | Constant (we don't simulate mass-based interactions)                          |
| Base speed       | 380 px/s (tuneable)                                                           |
| Speed cap        | 1100 px/s                                                                     |
| Speed gain       | × 1.04 per wall bounce, × 1.08 per successful return, decays slightly idle    |
| Spin             | Cosmetic only — sprite rotation tied to velocity vector                       |
| Curve            | Optional sine-wave perturbation on certain wave modifiers (see Section 8)     |

### 6.4 Court model

The court is a rectangle. Four walls. Top wall behaves identically to side walls. The bottom is **not** a wall — it is the player's responsibility zone. If a ball crosses the bottom line without being hit, it's a miss.

Wall bounces are perfectly elastic in angle (mirror reflection) but inject a tiny random angle jitter (±2°) on each bounce starting at Wave 3. This is *engineered chaos* — it keeps high-skill players from solving the geometry.

### 6.5 Trails and ghosting

A ball trail is rendered as a series of fading position samples (8–12 samples, ~16ms apart). At high combo, the trail brightens and lengthens. At slow-motion, the trail compresses and gains a chromatic edge. The trail is the single biggest "premium feel" element in the visual budget.

### 6.6 Implementation Notes

- Use `setBounce(1, 1)` on the ball for elastic wall response, then manually nudge angle by jitter on `worldbounce`.
- Track `ball.body.velocity.length()` each frame to drive trail intensity, audio pitch, and background pulse.
- Speed cap is enforced post-acceleration: clamp `velocity` to cap each frame.

---

## 7. Collision System

### 7.1 Two collision domains

1. **World collisions** (ball ↔ walls) — handled by Arcade Physics.
2. **Skill collisions** (ball ↔ player racket) — handled manually with a **timing-and-zone check**, not physics.

The second domain being manual is what allows perfect/good/late grading. Arcade Physics can't grade a hit; only a custom check can.

### 7.2 The racket and the swing window

The racket is a horizontal bar near the bottom of the court. It does **not** persistently exist in the physics world. Instead:

- The player **commits to a swing** by tapping or swiping.
- A swing creates a **temporary hit zone** in front of the racket for ~120ms.
- During those 120ms, if the ball intersects the zone, a hit is registered.
- The quality (perfect / good / late) depends on **when in the 120ms** the ball entered.

This design is borrowed from rhythm games. It is the cleanest way to give a one-button game *real* skill expression.

### 7.3 The grading function

Given `t = ball entry time within swing window (0 ms → 120 ms)`:

| t range            | Grade   |
|--------------------|---------|
| 30 – 90 ms         | Perfect |
| 0 – 30, 90 – 120   | Good    |
| Outside (too early or too late) | Miss-but-flailing — count as no-hit |

If the player does **not** swing and the ball crosses the bottom line: **Miss → lose life**.
If the player swings and the ball is nowhere near: **whiff** — no penalty, but the missed swing creates a small visual to teach.

### 7.4 Hit response

On a registered hit:

1. Reflect ball Y velocity (now traveling upward).
2. Adjust ball X velocity based on swing direction (swipe vector) or racket offset (tap).
3. Apply speed multiplier per Section 6.3.
4. Emit `hit:perfect` or `hit:good`.
5. Trigger juice cascade (Section 12).

### 7.5 Implementation Notes

- Swing window is a state on the racket object: `{ active: bool, startedAt: timestamp }`.
- Use `Phaser.Geom.Intersects.RectangleToCircle` for the manual collision check — cheap and exact enough.
- Reset window when the swing ends, regardless of hit/miss.

---

## 8. Difficulty Escalation System

### 8.1 The escalation philosophy

The game must always feel like it's about to be too hard, and almost always actually be just barely possible. The escalation curve is the most-tuned system in the game.

### 8.2 The wave structure

A "wave" is a 6–10 successful return chunk. Each wave advances one or more parameters:

| Wave | Returns to advance | New element introduced                                  |
|------|--------------------|---------------------------------------------------------|
| 1    | 5                  | Baseline. Single ball. No jitter. Slow speed.           |
| 2    | 6                  | Speed gain per bounce kicks in.                         |
| 3    | 7                  | Wall jitter ±2°.                                        |
| 4    | 8                  | Ball trail elongates; serves come from 2 walls.         |
| 5    | 8                  | First **modifier ball** (e.g., curveball).              |
| 6    | 8                  | Two balls in play briefly (overlap window of 1.5s).    |
| 7    | 10                 | Wider jitter ±4°. Speed cap rises.                      |
| 8+   | 10                 | Modifiers compound. Two balls become normal.            |
| 10+  | 12                 | Court visual transitions to "chaos mode" palette.       |
| 15+  | 14                 | Soft cap: chaos plateaus. Now it's pure endurance.      |

### 8.3 Modifier balls (introduced from Wave 5)

Modifier balls visually distinguish themselves and behave differently. Only one modifier type is active per wave to keep things readable.

| Modifier      | Visual        | Behavior                                                       |
|---------------|---------------|----------------------------------------------------------------|
| **Curveball** | Pink trail    | Sine-wave perturbation on its X velocity                       |
| **Heavy**     | Larger, dim   | Slower but worth 2x on hit                                     |
| **Splitter**  | Glitchy outline | On wall bounce, briefly forks a ghost ball (only one is real) |
| **Ghost**     | Translucent   | Invisible for 0.3s every 1.2s — must be predicted              |
| **Echo**      | Doubled trail | Spawns a delayed copy of itself one beat later                 |

### 8.4 The Director

Difficulty is owned by a `DifficultyDirector` object, not by the scene. The Director knows:

- Current wave
- Returns within wave
- Last modifier used
- Player's recent miss rate

If the player **misses twice within 5 returns**, the Director applies a hidden **mercy slope**: the next serve is 8% slower and the jitter is halved for 3 returns. This is invisible to the player and is the reason the game feels fair even when it's brutal.

### 8.5 Difficulty parameters (initial values, all tuneable)

```js
DIFFICULTY = {
  baseBallSpeed: 380,
  perBounceMul: 1.04,
  perReturnMul: 1.08,
  speedCap: 1100,
  swingWindowMs: 120,
  perfectWindowMs: 60,
  jitterDegreesByWave: [0, 0, 2, 2, 3, 3, 4, 4, 5, 5, 6],
  returnsPerWave:       [5, 6, 7, 8, 8, 8, 10, 10, 10, 12, 14],
  mercyTriggerMisses: 2,
  mercyTriggerWindow: 5,
  mercyDurationReturns: 3,
};
```

### 8.6 Implementation Notes

- All numbers above live in a single `config.js`-style object at the top of `game.js`. **No magic numbers in the scene files.**
- The Director publishes `wave:advanced` so UI can react without inspecting Director state.
- Mercy slope must be silent — no UI flash, no log, no sound.

---

## 9. Combo System

### 9.1 Why combos exist

Combos transform a sequence of independent events into a single emotional arc. Three returns in a row aren't "three returns" — they're a *streak*, and a streak is a story.

### 9.2 The rules

- Each successful return adds 1 to combo.
- Combo multiplies score: `score += baseScore × comboMultiplier`.
- Combo multiplier grows non-linearly: `1.0, 1.0, 1.2, 1.5, 1.9, 2.4, 3.0, 3.7, 4.5, ...` — easy at first, dramatic later.
- A miss resets combo to 0.
- Combo never decays on time alone — only misses break it. (Decay-on-time punishes the cautious player.)

### 9.3 Visual representation

Combo is shown three ways simultaneously:

1. **Big number** at top-center, scaling and color-shifting with value.
2. **Side bar** along the right edge that fills as combo grows, glowing brighter past x3.
3. **Background pulse** — the court's ambient color saturates further with each combo tier.

### 9.4 Combo tiers and tier rewards

| Tier | Combo value | Reward                                                |
|------|-------------|-------------------------------------------------------|
| 0    | 0–2         | Plain                                                 |
| 1    | 3–5         | Cyan trail on ball                                    |
| 2    | 6–9         | Slow-motion zoom on every return                      |
| 3    | 10–14       | Crowd-roar audio layer enters                         |
| 4    | 15–19       | Court edges glow and pulse                            |
| 5    | 20+         | "ON FIRE" banner; background shifts to chaos palette  |

Tier transitions are events the player can *feel* before they see the number — that's the design intent.

### 9.5 Combo break

A combo break is a *moment*. When the player misses with combo ≥ 5:

- Time scales to 0.3x for 200ms.
- The combo number explodes outward into particles.
- A descending audio sweep plays.
- The actual life loss happens after the moment.

This makes failure dramatic instead of dull. The bigger the combo, the bigger the funeral.

### 9.6 Implementation Notes

- Combo state lives on the Director object (it co-owns difficulty + combo since they interact).
- All visual reactions to combo are driven by a single `comboTier` derived value, not the raw number. This makes tuning trivial.
- The combo break animation must lock input for 200ms to prevent panic-tap restart, then auto-unlock.

---

## 10. Perfect Hit System

### 10.1 Why perfect hits matter

Perfect hits are the **prestige verb** of the game. They're not how you survive — they're how you *thrive*. They give a high-skill ceiling without raising the floor.

### 10.2 Mechanical effects of a perfect hit

A perfect hit:

- Adds 3 to combo instead of 1.
- Returns the ball with a 1.5x speed multiplier (immediate offense).
- Triggers a **micro-freeze** (50–80ms global time stop).
- Plays the perfect chime audio cue.
- Spawns a **light burst** at racket position.
- Increments a separate `perfectsThisRun` counter (relevant for share cards and unlocks later).

### 10.3 Aesthetic effects

A perfect hit is the only moment in normal play that the game lets itself be loud and clear:

- A wide cyan ring expands from the racket.
- The ball briefly takes on a white-cyan corona.
- A subtle radial chromatic-aberration tweens out from the hit point.
- The HUD's perfect counter ticks with a small bloom.

### 10.4 Perfect hit streaks

Three perfect hits in a row triggers **"TRIPLE PERFECT"** — a banner, a brass-stab audio cue, and a 2-second comet trail on the ball. This is a deliberately *rare* event, designed to be screenshot-worthy.

### 10.5 Implementation Notes

- Perfect detection is just the grading function in Section 7.3 — no new code path required.
- The triple-perfect event listens on `hit:perfect` and tracks a local 3-buffer.
- Micro-freeze uses `scene.time.timeScale = 0` for 60ms then restores. Audio is **not** time-scaled — that's the trick that makes it feel weighty rather than broken.

---

## 11. Mobile Control Design

### 11.1 The constraint

> **One thumb. Bottom half of the phone. No off-screen reaches.**

If a player has to use two hands, we've failed.

### 11.2 The control scheme

There are two viable input gestures. We will implement both, and the game accepts whichever the player uses.

**A. Tap-to-swing (timing-based)**
- Tap anywhere in the bottom half of the screen.
- The racket auto-positions horizontally to follow the tap X coordinate.
- The tap also starts the swing window.
- This is the **easier-to-learn** control. Players can use it forever.

**B. Swipe-to-swing (directional)**
- Drag the racket horizontally with the thumb to position.
- Quick flick upward to swing — the flick angle influences the return angle.
- This is the **higher-ceiling** control. Skilled players will gravitate to it.

Both are active at all times. The first frame of contact decides which the player meant (a flick is a fast directional drag; a tap is a release within 100ms and minimal travel).

### 11.3 Touch zones

```
┌──────────────────────────────┐
│                              │
│       PLAY FIELD             │  ← input ignored here (informational only)
│                              │
│                              │
├──────────────────────────────┤
│                              │
│       CONTROL ZONE           │  ← all input read here
│                              │
└──────────────────────────────┘
```

The control zone is the bottom ~40% of the screen. The racket sits at the top of this zone.

### 11.4 Input feel

- **Touch latency budget:** input → first visible reaction ≤ 1 frame (16.6ms at 60fps).
- **Racket smoothing:** the racket lerps to the target X over ~60ms. Zero smoothing feels twitchy; too much feels laggy. 60ms is the sweet spot.
- **Edge clamping:** racket stops at the court edge with a tiny rubber-band overshoot (3–5px) — feels alive.

### 11.5 Desktop fallback

Keyboard: `← →` to move, `Space` to swing. Mouse: same as touch but using pointer events. Phaser's pointer abstraction handles this for us; we just don't write touch-specific code.

### 11.6 Audio unlock

iOS Safari requires a user gesture to unlock audio. Howler handles this if we initiate audio *after* the first tap on MenuScene's PLAY button. Never attempt to play audio in BootScene.

### 11.7 Implementation Notes

- Use `scene.input.on('pointerdown' / 'pointermove' / 'pointerup')`. No raw touch events.
- The tap-vs-swipe decision is made on `pointerup` using elapsed time + total travel.
- Disable browser long-press menus and double-tap zoom via CSS (`touch-action: none`) on the canvas container.

---

## 12. Animation Design

### 12.1 The animation budget

Every animation must answer one of three questions:

- "Did my input register?" (input feedback)
- "What is happening right now?" (state communication)
- "What just happened?" (event punctuation)

Animations that don't answer one of these are noise.

### 12.2 Easing palette

We restrict ourselves to a small easing vocabulary. Consistent easing across a project is invisible but enormously felt.

| Use case                       | Easing                          |
|--------------------------------|---------------------------------|
| Score number popup             | `back.out(1.7)` — overshoots    |
| Button press                   | `power2.out`                    |
| Combo number scale             | `elastic.out(1, 0.5)`           |
| Screen shake                   | Manual (random + damped)        |
| Slow motion in/out             | `power2.inOut` on time scale    |
| UI scene transitions           | `expo.inOut`                    |
| Ball trail fade                | Linear (it's data, not feel)    |

### 12.3 Key animation moments

| Moment              | Animation                                                                              |
|---------------------|----------------------------------------------------------------------------------------|
| Game start          | Court draws in from center, walls "snap" into place, then a 1-2-3 countdown            |
| First serve         | Ball materializes at wall, with a brief charge-up flash, then launches                 |
| Successful return   | Racket squashes vertically (0.85x scaleY for 80ms), then springs back                  |
| Combo tier up       | Sidebar surges, color shifts, brief whoosh                                             |
| Perfect hit         | Cyan ring expands, ball corona, micro-freeze, then everything releases at once         |
| Combo break         | Combo number explodes into particles drifting toward HUD                               |
| Life lost           | Court briefly cracks (vector overlay), red vignette pulses once                        |
| Wave advance        | Banner sweeps across screen with wave number; background palette shifts subtly         |
| Run end             | Time scale → 0.3x for 600ms, ball flies off, score banner rises, REMATCH button blooms |

### 12.4 GSAP vs Phaser tweens

| Animate this with **GSAP**            | Animate this with **Phaser tween**      |
|---------------------------------------|------------------------------------------|
| HUD numbers, score counters           | Game-world sprites (ball, racket)        |
| Modal/menu transitions                | Particles, hit effects                   |
| Banner/text choreography              | Tinting, alpha pulses on world objects   |
| Anything time-scale-independent       | Anything that should respect game pause  |

This split matters: Phaser tweens automatically pause when the scene pauses; GSAP does not. We want HUD anims to **keep going** during a slow-mo moment for dramatic contrast.

### 12.5 Implementation Notes

- Centralize easing constants and durations in a `motion.js`-style namespace inside `game.js`.
- Use Phaser's `cameras.main.shake(duration, intensity)` rather than manual position tweens — it accounts for shake-during-pause correctly.

---

## 13. UI Design

### 13.1 Visual identity

| Element            | Direction                                                                     |
|--------------------|-------------------------------------------------------------------------------|
| Mood               | Sport-premium with a neon arcade edge. Apple Arcade meets early F-Zero menus. |
| Background         | Soft gradient teal/navy with subtle vignette                                  |
| Court              | Off-white surface, thin glowing line work                                     |
| Ball               | Bright lime-yellow with a strong neon trail                                   |
| Accent (perfect)   | Electric cyan                                                                 |
| Accent (danger)    | Warm coral-red                                                                |
| UI surfaces        | Frosted glass effect (CSS `backdrop-filter` on overlay only; canvas uses semi-transparent rect) |

### 13.2 Typography

Use **two** typefaces, no more.

- **Display**: a bold modern grotesque (e.g., *Space Grotesk* via Google Fonts) for scores, titles, banners.
- **UI**: a clean humanist sans (e.g., *Inter*) for menus, small text.

Both load via Google Fonts in `index.html` with `<link rel="preload">` so they're ready by the time the boot scene finishes.

### 13.3 HUD layout (in-game)

```
┌──────────────────────────────────────────────┐
│  ❤❤❤   WAVE 3              [SCORE]  1,420   │  ← top bar (UIScene)
├──────────────────────────────────────────────┤
│                                              │
│                                              │
│              [PLAY FIELD]                    │  ← GameScene
│                                              │
│                                              │
│                                              │
├──────────────────────────────────────────────┤
│           COMBO  x12                         │  ← combo bar (UIScene)
└──────────────────────────────────────────────┘
```

- HUD is intentionally sparse. Three numbers, three lives, one wave label. Nothing else lives there.
- The combo bar is at the **bottom** of the screen so it sits near the thumb, where the player's attention already is during play.
- A thin horizontal line marks the personal-best score at the top — visible at all times.

### 13.4 Menu screens

Each menu is a single screen with one primary action and at most two secondary actions.

- **Title:** "PADEL WALL CHAOS" big, glowing. **[ PLAY ]** button. Personal best badge in corner. Sound toggle. That's it.
- **Game Over:** Score (huge), delta-to-best (subtle), longest combo (subtle), perfects count (subtle), **[ REMATCH ]**, secondary "Menu" link.

### 13.5 Color tokens

```
--color-bg:        #0e1d2a
--color-court:     #f2efe6
--color-line:      rgba(255,255,255,0.5)
--color-ball:      #d6ff3a
--color-trail:     #d6ff3a
--color-perfect:   #5cf3ff
--color-danger:    #ff5c5c
--color-text:      #f7f9fb
--color-text-dim:  #93a4b2
```

These are duplicated between CSS variables (for the page chrome) and a JS constants object (for canvas drawing). They must be edited in lock-step. A single function in `game.js` reads from CSS variables on boot to keep them in sync if needed.

### 13.6 Implementation Notes

- HUD lives entirely in `UIScene`; never instantiate HUD objects in `GameScene`.
- The "frosted glass" on canvas overlays is a semi-transparent rounded rect drawn with `Graphics`. We do **not** attempt true blur on canvas — performance cost is not worth it.

---

## 14. Audio Direction

### 14.1 Audio mission

> **Audio is gameplay.** A muted player can win; an audio-on player gets pulled in.

We design as if audio is on by default but tolerate muted play gracefully.

### 14.2 The sound palette

| Category          | Sound                                  | Notes                                |
|-------------------|----------------------------------------|--------------------------------------|
| **Racket hit**    | Crisp "thwock" — synthetic, not real   | Pitch-shift slightly per hit         |
| **Perfect hit**   | Bright bell + sub thump                | Same sample every time — recognizable|
| **Wall bounce**   | Soft synthetic blip                    | Pitch tied to ball speed             |
| **Combo tier up** | Rising arpeggio (4 notes)              | Pentatonic — always pleasant         |
| **Combo break**   | Descending sweep + low impact          | Mournful, brief                      |
| **Wave advance**  | Whoosh + low riser                     | 1 second                             |
| **Life lost**     | Glass crack + bass thump               | Strong but not annoying              |
| **Crowd murmur**  | Loop, fades in past combo tier 3       | Adds stakes                          |
| **Crowd roar**    | One-shot on personal best break        | Earned and rare                      |
| **Menu music**    | Ambient pad loop                       | 30–60s loop, calm                    |
| **In-game music** | Stem-based; intensity tied to combo    | See 14.4                             |
| **UI ticks**      | Tiny clicks for menu nav               | -                                    |

### 14.3 Mixing rules

- All gameplay SFX are at -6 to -12 dB headroom from peak. Perfect hit and life loss are loudest.
- Music ducks by 6 dB during combo break and game over.
- Audio is **not** time-scaled during slow-mo. Slow-mo without slowed audio is the most powerful "weight" trick in arcade design.

### 14.4 Dynamic music (stretch goal)

Music is composed as 2–3 stems played simultaneously, with stems faded in/out by combo tier:

- Stem A: bass + drums (always on during play)
- Stem B: melody (enters at combo tier 2)
- Stem C: synth lead + percussion fills (enters at combo tier 4)

This gives the music an emotional arc tied to the player's run without requiring tracker-level composition.

### 14.5 Audio assets sourcing

For preproduction we will use a curated set of CC0/CC-BY sounds from sources like Freesound, Kenney, or zapsplat free tier. Each asset goes into `assets/audio/` with the credit recorded in a `CREDITS.md` (to be added once assets are committed).

### 14.6 Implementation Notes

- All audio loaded via Howler with `preload: true`.
- Maintain a single `audio.js`-style object: `Audio.play('perfect')`, `Audio.duck()`, `Audio.setIntensity(tier)`.
- Mobile: don't autoplay anything. First sound plays after the PLAY tap.

---

## 15. Performance Optimization Strategy

### 15.1 Performance targets

| Device tier                      | Frame target | Resolution strategy            |
|----------------------------------|--------------|--------------------------------|
| Modern flagship (iPhone 13+)     | 60 fps solid | Native pixel ratio (capped 2.0)|
| Mid-range Android (4–6 yrs old)  | 60 fps solid | 1.5x DPR cap                   |
| Low-end mobile / old tablet      | ≥ 45 fps     | 1.0x DPR cap, reduced trails   |

### 15.2 Optimization rules of thumb

1. **Object pool the ball, particles, and any short-lived sprite.** No `new` calls in the hot loop.
2. **Cap particle count.** Hit effects use ≤ 12 particles; combo break uses ≤ 24. Particles are the fastest way to tank a budget phone.
3. **Reuse text objects.** Score and combo numbers are *updated*, not destroyed and recreated.
4. **No high-cost canvas filters in play.** No blur, no shadow blur on moving objects. Glows are precomputed sprites with additive blend.
5. **Audio decode upfront.** Howler decodes in BootScene during the loading bar.
6. **Cap delta time.** Use a fixed max `delta` per frame so a long tab-blur doesn't shoot the ball off-screen.

### 15.3 Render strategy

- Phaser canvas at logical 720×1280 (portrait) by default; scaled by `Phaser.Scale.FIT` to viewport.
- Use **WebGL** renderer; fall back to Canvas if unavailable (Phaser handles this).
- Disable antialiasing only on low tier (perceptible quality drop, big perf win).

### 15.4 Memory

The game has a fixed asset set; memory never grows during play. Verify by leaving a run idle (autopilot mock) and watching memory in DevTools — flat line required.

### 15.5 Battery and thermal

- Cap framerate to 60 even on 120Hz screens (the game does not benefit from 120fps and burns battery).
- Lower particle count automatically if `Phaser.Game.loop.actualFps < 50` for 2+ seconds. Self-healing.

### 15.6 Implementation Notes

- Add a hidden debug overlay (toggle with `?debug=1` URL param) showing fps, ball speed, combo, active particles. Critical for tuning.
- A single object pool module: `Pool.acquire('particle')`, `Pool.release(obj)`. Strict — leaks are bugs.

---

## 16. GitHub Pages Deployment Strategy

### 16.1 Constraints recap

- No build tools.
- No npm install.
- No bundler.
- Project must run by opening `index.html` directly or hosting static files.

### 16.2 The plan

GitHub Pages serves the repository directly as static files. The deployment plan:

1. Push the repo to `main` (or any default branch).
2. In repository settings → Pages, select **"Deploy from a branch"** and pick `main` / root.
3. The game becomes available at `https://<user>.github.io/padel-wall-chaos/`.
4. Custom domain optional later.

### 16.3 Asset loading strategy

All third-party libraries are loaded via CDN in `index.html`:

```html
<script src="https://cdn.jsdelivr.net/npm/phaser@3.80.1/dist/phaser.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/gsap@3.12.5/dist/gsap.min.js"></script>
<script src="https://cdn.jsdelivr.net/npm/howler@2.2.4/dist/howler.min.js"></script>
```

Scene scripts are loaded via plain `<script>` tags in order:

```html
<script src="scenes/BootScene.js"></script>
<script src="scenes/MenuScene.js"></script>
<script src="scenes/GameScene.js"></script>
<script src="scenes/UIScene.js"></script>
<script src="scenes/GameOverScene.js"></script>
<script src="game.js"></script>
```

Each scene file attaches its class to `window.SceneName`. `game.js` consumes them. No imports. No modules.

### 16.4 Cache busting

For production, append `?v=YYYYMMDD` to the script tags when a new version ships. Crude but effective and requires zero infrastructure.

### 16.5 Local development

A developer can:

- Open `index.html` directly with `file://` (Phaser handles this for most things; audio may need a server).
- Or run `python -m http.server 8000` in the project root to get a proper HTTP origin.

The README will document both paths once we move past preproduction.

### 16.6 PWA potential (future)

Once stable, add a `manifest.json` and a tiny service worker for offline play. Out of scope for v1.

### 16.7 Implementation Notes

- All asset paths are **relative** (`./assets/audio/hit.wav`), never absolute (`/assets/...`), because GitHub Pages serves under a subpath.
- Add a `.nojekyll` file to the repo root to prevent GitHub from running Jekyll on our static assets.

---

## 17. Folder Architecture

### 17.1 Final folder structure

```
/padel-wall-chaos
├── index.html
├── style.css
├── game.js                  ← Phaser.Game config, global event bus, config constants
├── README.md                ← player-facing + dev quickstart
├── DESIGN.md                ← this document
├── CREDITS.md               ← (added when assets are committed)
├── .nojekyll                ← (empty file, disables Jekyll on GitHub Pages)
│
├── /scenes
│   ├── BootScene.js
│   ├── MenuScene.js
│   ├── GameScene.js
│   ├── UIScene.js
│   └── GameOverScene.js
│
└── /assets
    ├── /audio
    │   ├── hit.wav
    │   ├── perfect.wav
    │   ├── wall.wav
    │   ├── combo_up.wav
    │   ├── combo_break.wav
    │   ├── life_lost.wav
    │   ├── wave.wav
    │   ├── music_menu.mp3
    │   └── music_game.mp3
    ├── /sprites
    │   ├── ball.png
    │   ├── racket.png
    │   ├── ring_perfect.png
    │   └── ui_atlas.png
    └── /effects
        ├── particle_hit.png
        ├── particle_break.png
        └── trail.png
```

### 17.2 File responsibilities (one-liners)

| File                | Owns                                                        |
|---------------------|-------------------------------------------------------------|
| `index.html`        | Markup, CDN script loads, mount point, mobile viewport meta |
| `style.css`         | Page background, full-screen canvas mount, font preload     |
| `game.js`           | Phaser config, scene registration, global config & event bus|
| `BootScene.js`      | Preload, loading bar                                        |
| `MenuScene.js`      | Title, PLAY, settings                                       |
| `GameScene.js`      | Simulation, physics, ball/racket, input → action            |
| `UIScene.js`        | HUD overlay, parallel to GameScene                          |
| `GameOverScene.js`  | Death sequence, rematch                                     |

### 17.3 Naming conventions

- **Files:** PascalCase for scenes (matches class names), camelCase for utilities (none yet).
- **Classes:** PascalCase (`GameScene`, `DifficultyDirector`).
- **Globals:** Single namespace `PWC` (Padel Wall Chaos) — e.g., `window.PWC.config`, `window.PWC.audio`.
- **Events:** `domain:verb` (`hit:perfect`, `wave:advanced`).

### 17.4 Implementation Notes

- Resist the urge to add a `utils/` folder until at least two utilities exist. Premature folder structure is a slow tax.
- Don't add a build step "just in case." This is a hard constraint; revisit only if the project outgrows the brief.

---

## 18. Future Mini-Game Expansion Strategy

### 18.1 The hub vision

Padel Wall Chaos can grow into a small **micro-arcade** of sports-flavored reflex games. Each game shares the visual identity, audio palette, and motion language — but plays differently.

### 18.2 Candidate future mini-games

| Title (working)     | Verb               | Twist                                                            |
|---------------------|--------------------|------------------------------------------------------------------|
| **Padel Wall Chaos**| React + return     | The flagship — wall rebounds, combos                             |
| **Service Ace**     | Aim + power        | Pure aim minigame; bullseye targets                              |
| **Smash Lab**       | Charge + release   | Hold to charge, release to fire; physics destruction             |
| **Volley Tower**    | Sustain a rally    | Two-player local on one device; co-op rally count                |
| **Drop Shot**       | Precision timing   | Drop the ball into shrinking targets; one-tap meditative         |

### 18.3 Architecture changes required

The current architecture **already supports** this expansion with one addition: a `HubScene` between `MenuScene` and the per-game scenes, plus per-game folders:

```
/scenes
  /shared/            ← Boot, Hub, GameOver (generic), JuiceController
  /padel/             ← GameScene + UIScene for Padel Wall Chaos
  /service/           ← GameScene + UIScene for Service Ace
  ...
```

Naming inside each per-game folder stays consistent so the hub can boot any one of them with the same protocol: `scene.start('PadelGame')`, `scene.start('ServiceGame')`, etc.

### 18.4 Shared systems

When v2 begins, these systems become **library modules** (still no build step — just plain script files):

- `JuiceController` (shake, freeze, flash)
- `Audio` (Howler wrapper)
- `Pool` (object pool)
- `Director` (per-game subclass for difficulty)
- `Score` (localStorage namespace per game)

### 18.5 Cross-game progression (very stretch)

A shared "Cup" meta-currency could be earned across all mini-games — purely cosmetic unlocks (racket skins, court themes). All persisted to `localStorage` under a single root key.

### 18.6 Implementation Notes

- Do not generalize prematurely. v1 ships as a single game. The hub appears in v2 when the second mini-game justifies it.
- When generalizing, prefer **duplication over premature abstraction**. Three games is the right time to extract.

---

## 19. Future Leaderboard Strategy (No Backend)

### 19.1 Constraints recap

No backend. No database. No build tools. Yet players want to see how they compare.

### 19.2 Three tiers of leaderboard, no backend required

**Tier 1: Personal leaderboard (v1)**
- Top 10 scores, top combo, total perfects, all in `localStorage`.
- Visible from MenuScene as a small ribbon.
- Zero infrastructure.

**Tier 2: Daily seed leaderboard (v1.5)**
- Each day, the game uses a date-derived seed for serve angles and modifier order.
- Players who completed the daily seed see their score on a small "today's runs" panel locally.
- A **share button** generates a tiny image-card with their score + the date — they post it on social.
- Still no backend. Comparison is social, not algorithmic.

**Tier 3: True global leaderboard (v2, opt-in)**
- The smallest possible serverless solution: a single read-only public Google Sheet, written via a Google Apps Script web app, or a free-tier Cloudflare Worker.
- Critically: opt-in. Anonymous nickname only. No PII.
- Stays optional — the game works fully offline if the global leaderboard is unreachable.

### 19.3 Anti-cheat realism

A no-backend leaderboard cannot be made cheat-proof. Don't pretend it can. The mitigations are:

- Mark cloud scores as **"unverified"**.
- Show friends + nearby players prominently; the absolute global #1 is decoration.
- If a number is impossible by physics (e.g., 999,999,999), client-side reject it before submit.

### 19.4 Implementation Notes

- Personal leaderboard goes in `localStorage` under `PWC:scores`.
- Daily seed uses `YYYYMMDD` as integer seed for a deterministic PRNG inside the Director.
- Global leaderboard is a v2 concern. Don't even sketch endpoints yet.

---

## 20. Future Social Sharing Strategy

### 20.1 Why sharing matters

Every shared score-card is a free, organic install. Sharing is the cheapest growth channel a no-backend game has.

### 20.2 The share-card

After a great run (personal best, ≥ 20 combo, or ≥ 5 perfects), the game offers **"Share this run"**. The share-card is a generated PNG showing:

```
┌────────────────────────────────────┐
│                                    │
│         PADEL WALL CHAOS           │
│                                    │
│            14,820                  │  ← score
│                                    │
│   WAVE 7   ·   COMBO 23            │
│   PERFECTS  9                      │
│                                    │
│        roisa  ·  2026-05-26        │
│                                    │
└────────────────────────────────────┘
```

The card is generated by drawing to an offscreen canvas using the same fonts and colors as the game, then exported as a `dataURL`.

### 20.3 Share mechanism

We use the **Web Share API** where available (`navigator.share` with a `File`), and fall back to:

1. A download link ("Save image") on desktop.
2. A copy-to-clipboard ("Image copied — paste it!") via `navigator.clipboard.write` where supported.
3. As a last resort, render the card full-screen with a "screenshot this" hint.

This is fully no-backend: the card is generated client-side and never touches a server.

### 20.4 Deep links

Share images include the URL `https://<user>.github.io/padel-wall-chaos/` and, eventually, `?seed=<dailyseed>` so friends can play the **same exact daily seed**. This is the social hook — "I got 14k on today's seed, beat me."

### 20.5 Open Graph & meta

`index.html` includes proper OG tags so any link shared on social previews nicely. The OG image is a static promotional asset, separate from the per-run share-card.

### 20.6 Implementation Notes

- Card rendering: build a small `ShareCard` helper that takes `{score, combo, perfects, wave, date, name}` and returns a Blob.
- Generation runs only when the player taps Share — never proactively.
- Respect privacy: nickname is optional; never read OS-level user data.

---

## Appendix A — Open questions to resolve before coding

These are deliberate ambiguities to confirm with the creative director (you) before implementation begins.

1. **Orientation:** Portrait-only (recommended for one-thumb play), or also support landscape?
2. **Lives count:** 3 lives, 1 life, or a "shield" pickup model?
3. **Sound default:** On by default, or off-by-default with a clear unmute prompt?
4. **Naming on share cards:** anonymous by default, or a one-time nickname prompt on first share?
5. **Modifier order at Wave 5:** fixed (so players can learn) or randomized (more variance)?
6. **Audio palette:** prefer a synthetic/synthwave palette or a more acoustic/sporty palette?
7. **Color identity:** stay with the proposed teal/lime/cyan, or workshop alternatives?
8. **Vibration:** opt-in or opt-out? Some users find it intrusive on iOS.

---

## Appendix B — Roadmap snapshot

| Phase    | Scope                                                                              |
|----------|------------------------------------------------------------------------------------|
| **v0**   | This document (✓ you are here)                                                     |
| **v0.5** | Scaffolding: `index.html`, scene shells, ball that bounces, racket that swings     |
| **v0.8** | Core loop playable end-to-end (serve → return → miss → game over → restart)        |
| **v0.9** | Juice pass: trails, shake, freeze, particles, sounds                               |
| **v1.0** | Difficulty director + waves + modifiers; localStorage best score; share-card MVP   |
| **v1.1** | Polish, balancing, performance tuning, deploy to GitHub Pages                      |
| **v1.5** | Daily seed + personal leaderboard panel                                            |
| **v2.0** | Second mini-game; hub introduction                                                 |

---

## Appendix C — Definition of "done" for v1

A v1 build is shippable when:

- A new player can pick up the phone and complete a full run within their first 60 seconds without reading anything.
- The 5-second test (Section 2.3) passes for 5 of 5 testers.
- 60fps on a 4-year-old mid-range Android over a 90-second run.
- Death-to-rematch time is ≤ 1.5s on every measured device.
- Three returning testers, across three days, choose to play more than one run unprompted.

If those five are true, we ship. If any one is false, we tune until it isn't.

---

*End of document. Awaiting creative-director approval before coding begins.*

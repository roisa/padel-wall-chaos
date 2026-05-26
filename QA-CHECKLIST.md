# Real-Device QA Checklist

> Run this on actual phones once Pages is live. Items grouped by risk.
> Treat any ❌ as a ship-blocker; ⚠️ is a follow-up.

**Live URL**: https://roisa.github.io/padel-wall-chaos/

---

## A. Cold-start (iPhone Safari + Android Chrome)

- [ ] Load completes within 3s on 4G/LTE
- [ ] Fonts render correctly on first paint (no `Inter` / `Space Grotesk` fallback flash)
- [ ] No mixed-content warnings in URL bar
- [ ] Background color matches the iOS status bar (no white strip top/bottom)
- [ ] Notched phones: no UI clipped behind notch or home indicator
- [ ] Tablet portrait: court is centered with reasonable letterbox
- [ ] Landscape orientation: court is centered with letterbox (game still playable)

## B. Audio unlock

- [ ] First sound plays inside the PLAY tap on iOS Safari (no silent first run)
- [ ] Mute toggle (♪) on menu persists between sessions
- [ ] No audio plays before any user interaction
- [ ] System ringer switch on iPhone: audio respects it where Web Audio honors it
      (known iOS limitation — note behavior, do not block on it)

## C. Touch responsiveness (THE big one)

- [ ] Press anywhere in the lower half → racket snaps under finger within 1 frame
- [ ] Drag → racket follows finger with no perceptible lag
- [ ] Release → swing fires immediately, ball reflects on the same frame
- [ ] No accidental swing when scrolling-style gestures hit the canvas
- [ ] Long-press does NOT open the browser context menu (Android Chrome)
- [ ] Pinch-zoom is blocked
- [ ] Pull-to-refresh is blocked
- [ ] iOS Safari "swipe-from-edge" doesn't yank the player out of the game

## D. Onboarding clarity (first-ever play only)

- [ ] Tutorial overlay appears on first run with finger animation + text
- [ ] First tap anywhere dismisses the tutorial within 1 frame
- [ ] After dismiss, GO pulse fires and warmup serve begins immediately
- [ ] Player makes contact on the first warmup ball ≥ 8 out of 10 attempts
- [ ] Tutorial does NOT reappear on subsequent runs (check after 2 runs)
- [ ] Predictive target marker is visible and clearly tracks the ball

## E. Hit feedback / combo readability

- [ ] "Perfect" hits (cyan ring + freeze) are visually distinct from "good"
- [ ] Score popup at hit position is legible without obscuring the racket
- [ ] Combo number is easy to read at the bottom while watching the ball
- [ ] Color of the combo number visibly shifts at combo 3, 6, 10
- [ ] Banner labels ("NICE", "HOT", "ON FIRE") swing across cleanly
- [ ] Wave label visibly bumps and pips refill on wave advance

## F. Accidental misses (the hard one)

- [ ] Players miss because of *their* timing, never because of the controls
- [ ] Whiff (swing but no contact) is unmistakable but not punishing
- [ ] Near misses trigger the slow-motion drama (ball passes within 70px)
- [ ] Court crack draws below the ball location, not somewhere arbitrary
- [ ] Lives icons clearly pulse on the remaining hearts after a loss
- [ ] No "I hit it!" moments where the player visibly contacted the ball
      but no hit registered (this would indicate the spatial bands are
      too tight — log occurrences)

## G. Restart speed ("one more try" rule)

- [ ] Death → GameOver reveal completes within 1.5s
- [ ] REMATCH button visibly blooms within that window
- [ ] Tap on REMATCH → next ball serves within 0.6s of the fade
- [ ] No scene-transition jitter (canvas doesn't flash white between scenes)
- [ ] The intro countdown is skipped on rematch (only the GO pulse appears)

## H. Daily mode

- [ ] Tapping DAILY CHAOS on the menu starts a daily-seeded run
- [ ] HUD shows "DAILY · CHAOS #N" and "today's best" subline
- [ ] Two consecutive daily runs serve the same opening sequence
- [ ] Game-over shows daily-best comparison (not all-time)
- [ ] Day number rolls over correctly at local midnight (test by waiting
      or by setting device clock — note the timezone choice is local)

## I. Frame pacing (per device)

- [ ] iPhone (any 2020+): solid 60fps across 60s of play
- [ ] Android flagship (Pixel 6+, Galaxy S22+): solid 60fps
- [ ] Mid-range Android (3–4 years old): ≥ 50fps, auto-degrade kicks in if needed
- [ ] No frame > 33ms during a 20+ combo wave
- [ ] No GC stutter when collecting 5+ perfects in a row
- [ ] Use `?debug=1` to monitor `fps`, `degraded`, and `ball` speed live
- [ ] Tab-blur for 10s then return — game resumes cleanly, no ball off-screen

## J. Mute toggle / sound persistence

- [ ] Toggling sound off in menu mutes all subsequent SFX
- [ ] Reload preserves the mute setting
- [ ] Tutorial / GO / first ball play correctly after toggling back on

## K. Edge cases

- [ ] Background while ball is mid-flight → resume keeps ball state
- [ ] Tap the screen during the warmup serve — no double-swing or freeze
- [ ] Spam-tap on REMATCH — only one rematch fires
- [ ] Spam-tap on PLAY in menu — only one transition fires
- [ ] Open game on a phone with localStorage disabled (private mode) —
      game still runs (no best score persisted, no crash)

## L. Visual / typography sanity

- [ ] Score and combo numbers never overlap at any score length (up to
      999,999)
- [ ] Banner text fits within screen width on a 360px-wide Android
- [ ] Menu DAILY CHAOS button text doesn't clip on small displays
- [ ] Heart icons stay aligned (no jitter on consecutive life-lost anims)

## M. Network resilience

- [ ] After first load, opening the URL while offline: page renders, fonts
      fall back gracefully, game runs (no real assets to fetch)
- [ ] CDN script fails to load → game does not silently freeze (acceptable
      to fail loudly; no half-state)

---

## How to log issues

For each ❌, capture: device · OS version · browser · steps · short clip.
Use `?debug=1` for the live fps/state overlay during repro.

## How to prioritize fixes

P0 — anything in C (Touch), D (Onboarding), or G (Restart). These break
the loop.

P1 — anything in F (Accidental misses) or I (Frame pacing).

P2 — anything in A/B/H/J/K/L/M. Polish & robustness.

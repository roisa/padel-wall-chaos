# Deploying Padel Wall Chaos

The repo is the site. Static files only. No build, no Actions required.

## One-time Pages setup (the single manual step)

1. Open **https://github.com/roisa/padel-wall-chaos/settings/pages**
2. Under **Source**, choose **Deploy from a branch**.
3. **Branch**: `main` · **Folder**: `/ (root)` · click **Save**.
4. Wait ~60 seconds. GitHub displays the live URL once the build finishes.

Live URL:
**https://roisa.github.io/padel-wall-chaos/**

Confirm with a hard refresh after the first deploy. Subsequent pushes to
`main` redeploy automatically (~30–60s).

## Cache-busting

`index.html` script tags include `?v=0.95`. Bump that string in `index.html`
on every shipped change so phones don't serve a stale `.js`. CDN deps
(Phaser, GSAP, Howler) are already version-pinned.

## Debug overlay

Append `?debug=1` to the URL on a real device to see a live readout of fps,
ball speed, wave, combo, and auto-degrade state. Strip the query for normal
play.

## What this build expects from Pages

- `.nojekyll` is present (disables Jekyll path filtering)
- All asset paths are relative (`./`)
- The game lives under `/padel-wall-chaos/` subpath, no absolute paths
  anywhere
- CDN scripts load via HTTPS only
- Inline SVG favicon — no separate icon files to 404

## Failure recovery

If a deploy lands broken:

```
git revert HEAD
git push origin main
```

Pages redeploys the previous good state in under a minute. There is no
rollback button on Pages.

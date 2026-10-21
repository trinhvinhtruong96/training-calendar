# HM sub-2:00 training calendar

A small web page for the HM sub-2:00 plan (20 Oct 2026 → race on Sun 31 Jan 2027). It shows today's
workout, this week, all 15 weeks with today highlighted, and your completed runs next to each planned
workout. A Fitness row shows Garmin's VO2 max (with its level and trend) and a race predictor for 5K, 10K,
half and marathon. Everything is read live from [intervals.icu](https://intervals.icu) in your browser.

Live site: <https://trinhvinhtruong96.github.io/training-calendar/>

## Use it

1. Open the live site on your phone or PC.
2. Paste your intervals.icu API key (intervals.icu → Settings → Developer Settings → API Key) and press
   **Connect**. The key is saved only in that browser, so do this once per device.
3. Optional: add it to your home screen (iPhone Safari: Share → Add to Home Screen; Android Chrome:
   ⋮ → Add to Home screen).

Runs appear after your watch syncs them to Garmin Connect and intervals.icu. Changes to the plan in
intervals.icu (for example new paces after a test) show up the next time the page refreshes. Press
**T** to jump to today; you can switch that shortcut off in Settings.

## One-time GitHub setup

1. Make the repository public (Settings → General → Danger Zone → Change visibility). GitHub Pages on
   a free account needs a public repository; this repository contains no API key, plan or run data.
2. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
3. Push to `main`. `.github/workflows/pages.yml` runs the tests and publishes the `site/` folder.

## Privacy and security

- No API key, plan or run data is stored in this repository. Someone who opens the link without a key
  only sees the setup screen.
- The key and the last loaded data live in your browser's local storage. Settings → **Forget key on
  this device** removes them. To revoke the key everywhere, clear it in intervals.icu → Settings →
  Developer Settings.
- The page only reads from intervals.icu and only talks to `https://intervals.icu` (enforced by its
  Content Security Policy). The key itself, though, gives full access to your intervals.icu account.
- All GitHub Pages sites of one account share the origin `https://trinhvinhtruong96.github.io`, and
  with it the browser's local storage. Any other Pages site you publish under this account (and any
  third-party script it loads) could read the saved key. Keep other Pages sites free of third-party
  scripts, or host this page on its own domain.

## Develop

Node 20 or newer; there are no dependencies to install.

```
npm test        # unit tests (node --test)
npm run serve   # http://localhost:8080
```

| Path | What it is |
|---|---|
| `site/index.html`, `site/styles.css` | Page shell and styles (light/dark, phone/PC) |
| `site/src/config.js` | Plan dates, title and phase names |
| `site/src/dates.js`, `workout.js`, `model.js` | Pure logic: dates, workouts, days/weeks/statuses |
| `site/src/fitness.js` | Pure logic: VO2 max levels and trends, race predictions |
| `site/src/api.js` | Read-only intervals.icu client and browser storage |
| `site/src/app.js` | Rendering and interaction |
| `site/sw.js`, `site/manifest.webmanifest`, `site/icons/` | Offline support and home-screen app |
| `test/` | Unit tests with synthetic data |
| `docs/superpowers/` | Design spec and implementation plan |

If you add or rename files under `site/`, add them to `FILES` in `site/sw.js`. The deploy workflow gives the
offline cache a new name on every push (from the commit ID), so you never need to bump `CACHE` by hand. The PNG
icons are rendered from `site/icons/icon.svg`.

# HM sub-1:30 training calendar

A small web page for the HM sub-1:30 plan (20 Oct 2026 → race on Sun 31 Jan 2027). It shows today's
workout, this week, all 15 weeks with today highlighted, and your completed runs next to each planned
workout. Everything is read live from [intervals.icu](https://intervals.icu) in your browser.

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
   a free account needs a public repository; this repository contains no personal data.
2. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
3. Push to `main`. `.github/workflows/pages.yml` runs the tests and publishes the `site/` folder.

## Privacy and security

- No API key, plan or run data is stored in this repository. Someone who opens the link without a key
  only sees the setup screen.
- The key and the last loaded data live in your browser's local storage. Settings → **Forget key on
  this device** removes them. To revoke the key everywhere, clear it in intervals.icu → Settings →
  Developer Settings.
- The page only reads from intervals.icu and only talks to `https://intervals.icu` (enforced by its
  Content Security Policy).

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
| `site/src/api.js` | Read-only intervals.icu client and browser storage |
| `site/src/app.js` | Rendering and interaction |
| `site/sw.js`, `site/manifest.webmanifest`, `site/icons/` | Offline support and home-screen app |
| `test/` | Unit tests with synthetic data |
| `docs/superpowers/` | Design spec and implementation plan |

If you add or rename files under `site/`, add them to `FILES` in `site/sw.js` and bump `CACHE`. The PNG
icons are rendered from `site/icons/icon.svg`.

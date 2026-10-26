# HM sub-2:00 training calendar

A small web page for the HM sub-2:00 plan (20 Oct 2026 → race on Sun 10 Jan 2027). It shows today's
workout, this week, all 12 weeks with today highlighted, and your completed runs next to each planned
workout, plus a **Performance** card: your threshold pace and heart rate, a review of the last 10 days and
suggestions. Everything is read live from [intervals.icu](https://intervals.icu) in your browser.

Live site: <https://trinhvinhtruong96.github.io/training-calendar/>

## Use it

1. Open the live site on your phone or PC.
2. Press **Log in with intervals.icu** and allow access on intervals.icu (only read access is asked for:
   planned workouts and runs, plus wellness and settings for the Performance card, which you may untick).
   Or open **Use an API key instead**, paste your intervals.icu API key
   (intervals.icu → Settings → Developer Settings → API Key) and press **Connect**. The login or key is
   saved only in that browser, so do this once per device. The login button shows once `OAUTH.clientId`
   is set (see below); until then the page offers the key only.
3. Optional: add it to your home screen (iPhone Safari: Share → Add to Home Screen; Android Chrome:
   ⋮ → Add to Home screen).

Runs appear after your watch syncs them to Garmin Connect and intervals.icu. Changes to the plan in
intervals.icu (for example new paces after a test) show up the next time the page refreshes. Press
**T** to jump to today; you can switch that shortcut off in Settings.

Tap a day to see its details. For a day with a run, **Steps** shows what you ran in each planned step
(pace, time, HR) against the plan, with ✓ or !. The laps are loaded the first time you open the day and then
saved in your browser.

## One-time GitHub setup

1. Make the repository public (Settings → General → Danger Zone → Change visibility). GitHub Pages on
   a free account needs a public repository; this repository contains no API key, plan or run data.
2. Settings → Pages → Build and deployment → Source: **GitHub Actions**.
3. Push to `main`. `.github/workflows/pages.yml` runs the tests and publishes the `site/` folder.

## One-time intervals.icu login setup

1. While logged in to intervals.icu, register an app at <https://intervals.icu/oauth/apply>.
2. On its management page (intervals.icu → Settings → Apps → Manage App), tick **public client** and add
   these redirect URIs exactly: `https://trinhvinhtruong96.github.io/training-calendar/` and
   `http://localhost:8080/`.
3. Put the app's client ID (not the secret) in `OAUTH.clientId` in `site/src/config.js` and push. The client ID
   is not secret. Logins work only after intervals.icu has approved the app (its "Pending" tag is gone).

## Privacy and security

- No API key, login, plan or run data is stored in this repository. Someone who opens the link without
  connecting only sees the setup screen.
- The login (or key) and the last loaded data live in your browser's local storage. Settings → **Log out
  on this device** (or **Forget key on this device**) removes them; logging out also ends the login on
  intervals.icu. You can end a login there too (Settings → Apps), or revoke a key under Developer Settings.
- The login uses OAuth with PKCE and no client secret, and grants read access only: planned workouts, runs,
  wellness (resting HR, fitness) and sport settings. The page only reads from intervals.icu and only talks to `https://intervals.icu` (enforced by
  its Content Security Policy). An API key, though, gives full access to your intervals.icu account.
- All GitHub Pages sites of one account share the origin `https://trinhvinhtruong96.github.io`, and
  with it the browser's local storage. Any other Pages site you publish under this account (and any
  third-party script it loads) could read the saved login or key. Keep other Pages sites free of third-party
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
| `site/src/performance.js` | Pure logic: threshold estimates, 10-day review and suggestions for the Performance card |
| `site/src/steps.js` | Pure logic: matches a run's laps to its planned steps for the day details |
| `site/src/api.js` | Read-only intervals.icu client and browser storage |
| `site/src/auth.js` | "Log in with intervals.icu" (OAuth with PKCE, no secret) |
| `site/src/app.js` | Rendering and interaction |
| `site/sw.js`, `site/manifest.webmanifest`, `site/icons/` | Offline support and home-screen app |
| `test/` | Unit tests with synthetic data |
| `docs/superpowers/` | Design spec and implementation plan |

If you add or rename files under `site/`, add them to `FILES` in `site/sw.js`. The deploy workflow gives the
offline cache a new name on every push (from the commit ID), so you never need to bump `CACHE` by hand. The PNG
icons are rendered from `site/icons/icon.svg`.

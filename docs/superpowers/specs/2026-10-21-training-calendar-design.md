# Training calendar web page: design

Date: 2026-10-21 · Status: draft for review

## 1. Goal

A web page for the HM sub-1:30 plan (20/10/2026 → race 10/01/2027) that you open on your phone or PC
to see where you are in the plan, today's workout, this week, and the whole plan, with your completed
runs next to the planned workouts. All data is read **live from intervals.icu** in the browser, so
pace changes after the tests and new runs show up without rebuilding the page. It is published
with GitHub Pages.

**Success:** on any day, opening the page shows today highlighted, today's workout with steps and
pace targets, the status of every past day (done / missed), and km done against planned, all
matching what intervals.icu has. Works on a phone and on a PC, in light and dark mode, and with a
keyboard or screen reader.

## 2. Constraints

- Repo: `C:\Users\tvtrinh\Desktop\hahaha\training-calendar` (`origin` = `github.com/trinhvinhtruong96/training-calendar`, branch `main`).
  The agent commits locally and never pushes; the user pushes.
- Hosting: GitHub Pages via GitHub Actions at `https://trinhvinhtruong96.github.io/training-calendar/`.
  Needs the repo to be public (free plan) and Pages source set to "GitHub Actions".
- **No personal data in the repo.** No API key, no plan data, no activity data. Strangers who open
  the URL see only the setup screen.
- **Read-only:** the page reads intervals.icu data with `GET` only. The only other requests belong to the
  login: the token swap (`POST /api/oauth/token`) and logging out (`DELETE /api/v1/disconnect-app`).
- No framework, no build step, no runtime dependencies. Plain HTML, CSS and ES modules. Dev-only
  tooling is Node's built-in test runner (Node 24 is installed).
- No external requests other than `https://intervals.icu` (no web fonts, CDNs or analytics).
- English UI. Dates as `Wed 21 Oct`, paces as `m:ss/km`, distances in km.

Verified on 2026-10-21:
- intervals.icu answers CORS requests from `https://trinhvinhtruong96.github.io` and `http://localhost:8080`
  (`Access-Control-Allow-Origin` echoes the origin; `authorization` header allowed).
- `GET /api/v1/athlete/0` returns `name`, `timezone`.
- Events: `id` (int), `start_date_local`, `category`, `name`, `description`, `external_id`,
  `distance` (m), `moving_time` (s), `paired_activity_id`, `workout_doc.steps[]`. A step has
  `text`, `distance`, `duration`, `pace {start, end, units: "secs/km"}`; a repeat has `reps` and `steps`.
- Activities: `id` (string), `start_date_local`, `type` (e.g. `Run`), `name`, `distance`,
  `moving_time`, `average_heartrate`, `paired_event_id`, `compliance`.

## 3. Approach

Static single page. On load it renders the last saved copy from `localStorage` at once, then
fetches fresh data:

- `GET /api/v1/athlete/0` (when connecting a key, and on every refresh for the Performance card's settings check)
- `GET /api/v1/athlete/0/events?oldest=2026-10-19&newest=2027-01-10`
- `GET /api/v1/athlete/0/activities?oldest=2026-10-19&newest=<today>`
- Performance card: pace and HR curves, wellness, `/athlete/0` and laps per run; see
  `2026-10-26-performance-card-design.md`. The activities request starts 10 days back when that is earlier.

Auth, one of:
- **Login** ("Log in with intervals.icu", §3a): `Authorization: Bearer <token>`.
- **API key**: HTTP Basic, username `API_KEY`, password = the key the user entered on that device.

### 3a. Log in with intervals.icu (`src/auth.js`)

OAuth 2 authorization code flow for a **public client with PKCE**, so there is no client secret and no
server ([intervals.icu OAuth](https://forum.intervals.icu/t/intervals-icu-oauth-support/2759)).
`OAUTH.clientId` in `src/config.js` holds the registered app's client ID; while it is empty the setup
screen offers the API key only. The app must be marked "public client", with the redirect URIs
`https://trinhvinhtruong96.github.io/training-calendar/` and `http://localhost:8080/`.

1. **Start:** 32 random bytes → base64url `code_verifier`; 16 random bytes → `state`. Both are saved in
   `sessionStorage` (`tc.v1.login`), then the page opens `https://intervals.icu/oauth/authorize` with
   `client_id`, `redirect_uri` (the page's own address without `index.html`), `scope=CALENDAR:READ,ACTIVITY:READ,WELLNESS:READ,SETTINGS:READ`,
   `state`, `code_challenge` (S256) and `code_challenge_method=S256`.
2. **Return:** intervals.icu opens the page with `?code&state` or `?error`. The page removes the query
   from the address bar at once, takes and deletes the saved values (one use), and refuses a missing or
   different `state`. `error=access_denied` shows "Login cancelled."
3. **Token:** `POST https://intervals.icu/api/oauth/token`, form-encoded `client_id`, `code`, `code_verifier`.
   The reply carries `access_token`, `scope` and `athlete.name`; the name is used, so no `/athlete/0` call.
   Calendar and activities must be granted, as READ or WRITE; wellness and settings are optional (Performance card).
4. **Saved:** the token in `tc.v1.token` (a saved key is removed, and the other way round).
5. **Log out:** Settings → Log out clears this device first, then calls `DELETE /api/v1/disconnect-app`
   (best effort).
6. A failed return while the device still has a login or key (e.g. an old login link) keeps the calendar
   and only announces the error.

## 4. Files

```
site/                      published to GitHub Pages
  index.html               page shell, CSP meta, setup screen, dialogs
  styles.css               layout, light/dark themes, phone/PC breakpoints
  manifest.webmanifest     "Add to home screen"
  sw.js                    offline cache of the app files (never caches API data)
  icons/                   icon.svg, icon-192.png, icon-512.png, apple-touch-icon.png
  src/config.js            plan constants (§5), login settings (§3a)
  src/dates.js             pure: date math (weeks, days, countdown) and formatting
  src/workout.js           pure: workout type, names, notes, steps, pace ranges, workout bar
  src/model.js             pure: days and weeks, run matching, day status, km, labels, header text
  src/api.js               pure-ish: intervals.icu fetch + cache, with injected fetch and storage
  src/auth.js              pure-ish: "Log in with intervals.icu" (§3a), with injected fetch, storage and crypto
  src/app.js               DOM rendering and interaction (the only module that touches the DOM)
tools/serve.js             dev-only static server for site/ on http://localhost:8080
test/
  dates.test.js, workout.test.js, model.test.js, api.test.js, auth.test.js, fixtures.js (synthetic data only)
.github/workflows/pages.yml  test, then deploy site/ on push to main
package.json               "type": "module", scripts: test, serve
README.md                  what it is, one-time GitHub setup, connecting the key, local dev, privacy
```

## 5. Plan constants (`src/config.js`)

- Title `HM sub-2:00` (title only; the plan itself targets sub-1:30); calendar starts Mon 2026-10-19 (week 1); first plan day
  2026-10-20; race day Sun 2027-01-10 (moved from 2027-01-31 on 2026-10-24); 12 weeks; "Day N of 83" counts from 2026-10-20.
- Phase names by week: 1 Start · 2–3 Adapt · 4 Light · 5–6 Build · 7 Peak · 8 Light ·
  9 Race-specific · 10 Key week · 11 Taper · 12 Race.

## 6. Data model (`src/dates.js`, `src/workout.js`, `src/model.js`)

**Today** is the device's local date (`YYYY-MM-DD`). Dates compare as date strings taken from the first
10 characters of `start_date_local`; no time-zone conversion.

**Day** = one calendar date with its events (WORKOUT and NOTE categories; others ignored) and its activities.

**Workout type** from the event name, first match wins:

| Rule | Type |
|---|---|
| `RACE` (word) | race |
| `TEST` (word) | test |
| `KEY` (word) | key |
| `Threshold` | threshold |
| `Long` | long |
| `@RP` | racepace |
| `\d+x\d+` | intervals |
| `Easy` | easy |
| otherwise | run |

Colour groups: easy · long · threshold · intervals · race (race, test, key, racepace) · rest.

**Run matching** for each WORKOUT event, in order:
1. an activity with `paired_event_id == event.id`, or `event.paired_activity_id == activity.id`;
2. otherwise the first unmatched running activity (`type` contains `Run`) on the same date.

**Day status:**

| Status | Rule |
|---|---|
| done | every workout on the day has a matched run |
| partial | some, not all, workouts matched |
| missed | date < today, has a workout, no matched run |
| today | date == today (combined with done/partial if already run) |
| planned | date > today, has a workout |
| rest | only NOTE events (rest day); a run on such a day shows as "extra run" |
| empty | no events |

**Week totals:** planned km = sum of WORKOUT `distance`; done km = sum of running-activity `distance`
in that week. Plan totals are the same over all weeks.

**Workout bar:** flatten `workout_doc.steps` (repeats expanded). Block width ∝ step `duration`.
Level from the step cue first, then pace:

| Cue (case-insensitive) | Level |
|---|---|
| Rest, Walk | rest |
| Warmup, Easy | easy |
| Steady | long |
| Settle, Threshold | threshold |
| Rep, Stride | intervals |
| Race pace, Race, Test | race |
| otherwise | by mean pace: < 250 s/km intervals · < 270 threshold · < 300 long · else easy; no pace → easy |

Block height by level: rest 20 % · easy 40 % · long 55 % · threshold 70 % · intervals 90 % · race 80 %.

**Actual run summary:** distance, moving time, average pace (`moving_time / distance km`), average HR,
`compliance` % when present, link `https://intervals.icu/activities/<id>`.

**Day link:** `https://intervals.icu/?w=<Monday of that week>`.

## 7. Screens (`src/app.js`, `index.html`, `styles.css`)

**Setup screen** (nothing saved on this device): short explanation. With `OAUTH.clientId` set: a
**Log in with intervals.icu** button with a note that only read access is asked for, and a closed
**Use an API key instead** section holding the key form. Without it: the key form only. Key form:
password field with show/hide; link to intervals.icu settings (Developer Settings → API Key); Connect.
Connect calls `/athlete/0`; on success it saves the key and goes to the calendar; on failure it shows
the reason (§8). A note says the key is saved only in this browser and the page only reads data.

**Main page**, in order:
1. **Header** (sticky): title; `Week W of 12 · Day N of 83 · D days to race`; plan progress bar;
   last updated time + refresh button; settings button.
2. **Today card:** date, week and phase; workout name; planned distance and time; note line
   (e.g. `+ gym`); workout bar; step list with pace ranges (repeats shown as `10 × 400 m · 4:02–4:08`
   with the rest under it); actual run summary once done. Rest day: rest note and a "Tomorrow" preview.
   Before 20/10: "Plan starts Tue 20 Oct". After 10/1: "Race done" plus plan totals.
3. **This week:** 7 days (type colour, name, km, status icon + text); km done / planned; previous and
   next week buttons (and swipe on touch); "This week" button returns.
3a. **Performance:** threshold pace and HR, last 10 days review, suggestions (spec 2026-10-26).
4. **Plan:** a table with 12 rows (week label + phase) and Mon–Sun columns; each cell is a button with
   type colour and status icon; test, key and race days are marked; last column km done / planned with
   a bar. Today's cell has a ring.
5. **Details** (tap any day): bottom sheet on narrow screens, side panel on wide screens: all events of
   the day with full steps, notes, actual run(s) and links to intervals.icu. Other activities that day
   (e.g. weight training) are listed as "Also".
6. **Today button** (floating on phone, in header on PC) and key `T` jump to today. The `T` shortcut
   can be switched off in settings (WCAG 2.1.4, single-key shortcuts).
7. **Settings dialog:** connected athlete name and how (login or API key); theme (System / Light / Dark);
   `T` shortcut on/off; Refresh; **Log out on this device** or **Forget key on this device** (removes the
   login or key and cached data from this browser; logging out also ends the login on intervals.icu).

**Layout:** < 720 px one column; ≥ 1024 px two columns (Today left; This week and Performance right; Plan below);
720–1023 px one column with the wide plan table.

**Accessibility:**
- landmarks and headings;
- status is never colour alone (icon + text), and contrast meets WCAG AA in both themes;
- the plan grid is a `<table>` with row and column headers, and each cell's accessible name reads like
  "Thu 5 Nov, Threshold 2x4 km, done";
- one Tab stop for the grid, with arrow keys, Home/End and PageUp/PageDown moving between days (roving tabindex);
- `aria-current="date"` on today;
- details and settings use `<dialog>` with focus moved in and returned on close; Esc closes;
- refresh and error messages are announced through a polite live region;
- `prefers-reduced-motion` and `prefers-color-scheme` are respected.

## 8. Errors and offline

| Situation | Behaviour |
|---|---|
| No internet / fetch fails | keep showing the cached copy; header says `Offline · updated <time>`; Retry button |
| HTTP 401, or 403 whose body is not a Cloudflare block (`cloudflare_error`) | "Key not accepted" or "Your intervals.icu login has ended"; back to the setup screen (cache kept until Forget/Log out) |
| Other HTTP error | message with the status; cached copy stays; Retry |
| No cache and fetch fails | setup or error screen with Retry |
| Page hidden > 5 min, then shown again | refresh automatically |

**Cache:** `localStorage` key `tc.v1.data` holds `{fetchedAt, athleteName, events, activities}`, reduced to
the fields in §2. The key is in `tc.v1.key` or the login token in `tc.v1.token`, the theme in `tc.v1.theme`,
the `T` shortcut setting in `tc.v1.shortcut`. If `localStorage` is unavailable or full (private mode, quota),
values are kept in memory for the session and the page keeps working without a saved copy.

**Service worker:** caches the files under `site/` (cache name includes a version) and serves them
cache-first, falling back to the network, and refreshes the cached copy in the background so a new
deploy shows on the next visit; it never stores intervals.icu responses. Requests are fetched and cached
without their query, so a login return (`?code=…`) is neither passed on to the host nor cached.

## 9. Security

- Render with DOM APIs and `textContent` only; API strings are never inserted as HTML.
- CSP meta: `default-src 'self'; connect-src https://intervals.icu; img-src 'self' data:;
  style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'none'`.
- No third-party scripts.

## 10. Testing

- `npm test` → `node --test`. `dates.test.js`, `workout.test.js` and `model.test.js` cover: week number and
  day number; days to race; workout type rules; run matching (pairing first, then same date, no double use);
  every status in §6; week and plan km totals; workout bar flattening, widths and levels. `api.test.js` (fake fetch and
  storage) covers: auth header and URLs; cache saved and served; 401/403 → key error; network error →
  offline with cache; field reduction.
- Fixtures are synthetic; no real activity data in the repo.
- Live smoke check (agent, local only): serve `site/` on `http://localhost:8080`, open in Chrome,
  put the key from `C:\Users\tvtrinh\.intervals_key` into that browser's storage without printing it,
  check phone (390 px) and PC (1440 px) widths, light and dark, keyboard-only navigation, the
  accessibility tree of the grid and dialogs, offline reload; screenshots to the user.

## 11. Deployment

`.github/workflows/pages.yml`: on push to `main` and manual run → checkout → setup Node 24 → `npm test`
→ configure-pages → upload `site/` → deploy-pages. Permissions `contents: read`, `pages: write`,
`id-token: write`.

One-time user steps (README): make the repo public; Settings → Pages → Source: GitHub Actions; push.

## 12. Out of scope

Editing or uploading workouts from the page; gym logging; notifications; more than one athlete or plan;
OAuth login; syncing ticks between devices (there are none, runs come from intervals.icu).

# Performance card: design

Date: 2026-10-26 · Status: draft for review · Extends `2026-10-21-training-calendar-design.md`

## 1. Goal

A **Performance** card that tells the signed-in athlete, within a few seconds:

1. their current **threshold pace** and **threshold heart rate**, how they changed since the plan started,
   and how far the pace is from the threshold their race goal needs;
2. whether the **last 10 days** were trained right (sessions on target, easy runs easy, recovery);
3. **up to 3 concrete things** to do differently.

**Success:** on 26 Oct with Truong's key the card shows threshold 4:23 /km, threshold HR 180, goal about
4:10, and run verdicts that match the hand-written week 1 review: Thu 22 easy run ! (too hard at the end),
Fri 23 threshold ! (blocks above 180), Sat 24 ✓, Sun 25 long run ! (fast finish, last km 4:13), 3 hard days
against 2 planned, easy share under 70 %. Recovery is ✓ (resting HR 65–68 against a 28-day median of 66.5,
form about 0): the rise seen within week 1 is not above the athlete's October normal. With Baobao001's key
(no hard running yet) it shows "not enough hard running yet" instead of threshold numbers.

Decisions taken with the user:

- Both parts: a 10-day review (main part) and a short threshold trend.
- Recovery is included (resting HR, form), which needs the wellness permission.
- Window: the **last 10 days, rolling** (today and the 9 days before), not a plan week.
- Approach B: run summaries plus the **laps** of each run in the window.
- Threshold tiles compare **now / since plan start / goal**, not "10 days ago" (a 90-day best-effort
  estimate only moves when a best effort enters or leaves the window, so a 10-day change mostly reads
  "no change" and a slower value would only mean an old best effort dropped out). New best efforts of the
  last 10 days appear as a review line instead.
- No overall score.
- No new unit tests (user decision, see §9).

Out of scope: VO2 max and race-predictor cards (dropped by the user on 2026-10-21), writing anything to
intervals.icu (the card can only point out that its settings differ), Garmin training status/readiness
(not available through intervals.icu).

## 2. Card layout

One card with the heading **Performance** (`h2`). On PC (≥ 1024 px) it sits in the left column under
This week; below 1024 px it sits between This week and Plan.

1. **Two tiles.**
   - **Threshold pace** `4:23 /km`, a change line, a goal line ("Goal 4:10 for your race pace 4:15 · 13 s to
     go"), and a source line ("from your best efforts, last 90 days").
   - **Threshold heart rate** `180 bpm`, a change line, and a source line ("highest HR held for 60 min, last
     90 days" or "… for 30 min, minus 2").
   - Under the tiles, only when intervals.icu's settings differ (§5.6): "intervals.icu has threshold HR 168
     set: its zones and load for you use 168."
2. **Last 10 days · 17–26 Oct**: one line per check (§5.4), each with ✓ or ! **and** words (status is never
   shown by colour alone; the icon has a text label "on target" / "check").
3. **Suggestions**: up to 3 numbered lines (§5.5).
4. **Each run (n)**: a button (`aria-expanded`, keyboard operable, same pattern as the phone plan week
   cards) that opens one line per run in the window: date, workout name, ✓ / ! / – and a short reason.

Uses the existing colour tokens, light and dark themes, phone (390 px) and PC (1440 px) layouts.

## 3. Data from intervals.icu

All `GET`, only `https://intervals.icu` (CSP unchanged). Fetched with every refresh, in parallel with the
existing events and activities requests. `today` is the device's local date; `firstDay` is
`PLAN.firstDay`; `d − n` is n days before d.

| # | Request | Kept (reduced) |
|---|---|---|
| 1 | `/athlete/0/pace-curves?type=Run&curves=r.{today−89}.{today},r.{firstDay−89}.{firstDay}` | per window: critical speed (`paceModels[type=CS].criticalSpeed`, m/s) or null; for the "now" window also the best time and `activity_id` at 1000, 3000, 5000, 10000 and 21097.5 m (match within 1 m) |
| 2 | `/athlete/0/hr-curves?type=Run&curves=` same two windows | per window: best HR held for 3600 s, 1800 s and 60 s (`secs`/`values`), or null where absent |
| 3 | `/athlete/0/wellness?oldest={today−34}&newest={today}&fields=id,restingHR,ctl,atl` | `[{date, restingHR, ctl, atl}]` |
| 4 | `/athlete/0` | running sport settings: `lthr`, `max_hr`, `threshold_pace` (m/s) |
| 5 | `/activity/{id}/intervals` for every run in the window (type Run, VirtualRun or TrailRun, ≥ 2 km) whose laps are not saved yet | `[{distance, movingTime, avgHr, avgSpeed}]` per lap, in order |

- The existing activities request starts at `min(PLAN.calendarStart, today−9)` instead of
  `PLAN.calendarStart`, so the 10-day window is complete early in the plan.
- Saved under `performance` in the cached data (`tc.v1.data`):
  `{ paceNow, pacePlanStart, hrNow, hrPlanStart, wellness, settings, laps: {activityId: [...]}, denied:
  {wellness, settings} }`. Laps of runs that are no longer in the window are dropped on save.
- **Failures never affect the calendar.** Requests 1–5 run with `Promise.allSettled`; a failed request
  keeps that part's previously saved value. Requests 1–5 must not throw `KeyError`: a **403** on request 3
  or 4 sets `denied.wellness` / `denied.settings` (that part is hidden with a note) and does not log out.
  A 401 or other error on them only keeps the old value; the calendar requests keep today's handling.
- **Login permissions.** `OAUTH.scope` becomes `CALENDAR:READ,ACTIVITY:READ,WELLNESS:READ,SETTINGS:READ`.
  A login still **requires** only CALENDAR and ACTIVITY (new `OAUTH.requiredScope =
  "CALENDAR:READ,ACTIVITY:READ"`, used by the granted-scope check in `auth.js`); WELLNESS and SETTINGS are
  optional. The login is not live yet (no approved client ID), so nobody has to log in again. An API key
  already covers everything.

## 4. Threshold estimates

Let `H60`, `H30`, `H1` be the best HR held for 60 min, 30 min and 1 min in a window, and
`HRmax = max(settings.max_hr, H1)` (only `H1` when settings are denied).

- **Threshold heart rate (LT):** `H60` if `H60 ≥ 0.88 × HRmax`; else `H30 − 2` if `H30 ≥ 0.88 × HRmax`;
  else none ("Not enough hard running yet: a test or race of 30+ min sets it"). The 88 % check stops an
  athlete with only easy runs from getting an easy-run HR as threshold. Truong: H60 180 ≥ 163 → 180.
- **Threshold pace (T):** `1000 / criticalSpeed` s/km from the window's CS model; none if there is no model.
- **Change since plan start** (same rules on the window ending on `firstDay`):
  - pace faster by ≥ 2 s/km: "8 s faster since 20 Oct"; within 2 s: "same as 20 Oct"; slower: "best
    efforts from before {today−89} no longer count" (within a window a best can only improve, so a slower
    estimate always means an older best dropped out);
  - HR: neutral "180 bpm (178 on 20 Oct)" when it differs by ≥ 2, else "unchanged since 20 Oct".
  - No plan-start estimate: the change line is left out.
- **Goal threshold:** the race event in the athlete's calendar (the planned workout whose type is `race`);
  midpoint of its race step's pace range → half-marathon time = pace × 21.0975 → VDOT with the Daniels/
  Gilbert formulas (`VO2(v) = −4.60 + 0.182258 v + 0.000104 v²`, `%max(t) = 0.8 + 0.1894393 e^(−0.012778 t)
  + 0.2989558 e^(−0.1932605 t)`, v in m/min, t in min) → threshold pace = pace whose VO2 is 88 % of VDOT.
  Truong (4:15) → 4:10; Baobao001 (5:24) → 5:13. Line: "Goal 4:10 for your race pace 4:15 · 13 s to go"
  (or "· reached"). No race event, or after race day → no goal line.

## 5. Rules

Derived per athlete: **easy limit** `E = 0.83 × LT` rounded to the nearest 5 (Truong 150); **hard HR**
`0.95 × LT` (171). Each run is matched to its planned workout with the existing run matching in
`model.js`, and typed with `workoutType` (`workout.js`). Unplanned runs are treated as easy. Lap pace =
`movingTime / distance`. "Work laps" = laps faster than the middle between the planned easy range's fast
end and the planned work step's slow end, and ≥ 150 m.

### 5.1 Run verdicts

| Run | ✓ when | ! reason (example) |
|---|---|---|
| Easy, recovery, unplanned, long run | no lap after the first km has HR > E + 3 (laps of a planned faster part are excluded) | "HR 161–170 in the last 2 km" |
| Long run without a planned faster part | also: mean pace of the last 3 km not more than 30 s/km faster than the first 3 km | "last 3 km 4:34 vs first 3 km 5:43, last km 4:13 at HR 184" |
| Long run or key run with a steady / race-pace part | laps of that part (located by cumulative distance from the planned steps) inside its range, ± 3 s/km | "last 4 km 4:28–4:31, target 4:35–4:45 (too fast)" |
| Intervals and short race-pace sessions (racepace type, not long) | every work lap's pace inside the planned work range, ± 2 s/km | "reps 3:44–3:48, target 3:45–3:51" ✓ / "2 of 5 reps faster than 3:57" ! |
| Threshold | no work lap with HR > LT + 2 and none more than 5 s/km faster than the fastest planned threshold range | "blocks at HR 182–184, above 180" |
| Test, race | no verdict (–) | "10 km in 41:48" |
| Planned workout (date ≤ today) without a run | missed (!) | "missed" |

Without LT, HR conditions are skipped (pace conditions stay). Without HR on a run: pace only, marked
"no heart rate". Without laps (one lap): whole-run averages, marked "no laps". Work laps not found where the
plan has repeats or blocks: "different from the plan" (–). Runs under 2 km: counted in km, not judged.

### 5.2 Hard days

A day is **hard** if it has a done planned hard workout (types intervals, threshold, test, racepace, key,
race) or ≥ 5 min of lap time with HR ≥ 0.95 × LT. Planned hard days = days in the window (≤ today) with a
planned hard workout. Truong's week 1: Wed, Fri, Sun hard (Sun 19 min ≥ 171) against Wed, Fri planned.

### 5.3 Recovery

- Resting HR: the 3 most recent days with a value against the median of the 28 days before them.
  ! when ≥ 5 bpm above on at least 2 of those 3 days.
- Form = `ctl − atl` of the latest day. ! when below −30 (intervals.icu's high-risk zone).

### 5.4 Review lines (last 10 days)

| Line | Shows | ✓ when |
|---|---|---|
| Done | "5 of 5 planned runs · 54.0 of 37.5 km" — planned = workouts in the window up to today; km = all runs, planned or not | no missed workout |
| Easy runs | "2 of 5 easy (HR under 150)" — easy-type runs ≥ 2 km, planned or not | all easy-type runs ✓ |
| Hard sessions | "0 of 2 on target · 3 hard days, plan had 2" | all hard runs ✓ and hard days ≤ planned |
| Easy share | "45 % of running time under HR 150 (aim 70–80 %)" — lap time with HR ≤ E / lap time with HR, runs ≥ 2 km | ≥ 70 % |
| Recovery | "resting HR 65, normal 66 · form +1" | §5.3 has no ! |
| New best (only if any) | "New best: 3 km in 12:27 (4:09 /km), Tue 27 Oct" | always ✓ |

Numbers in the "Shows" column are examples of the format, not expected values.

### 5.5 Suggestions

The first 3 that apply, in this order:

1. Resting HR up: "Take tomorrow easy or rest: resting HR {x}, normal {y}."
2. Long run too fast at the end: "Keep the long run easy to the end: {date} got faster to {pace}."
3. Threshold above LT: "Keep threshold blocks under HR {LT}: {date} reached {hr}."
4. Easy run too hard: "Slow easy runs to HR under {E}: {date} reached {hr} in km {n}."
5. Reps outside the range: "Run reps inside {range}, not faster: {date} averaged {pace}."
6. Easy share under 70 %: "Make more of your running easy: {p} % this time, aim 70–80 %."
7. Missed workouts: "{n} planned run(s) missed: {dates}."
8. Settings differ: "Set threshold HR to {LT} in intervals.icu (now {x})." / "… threshold pace to {T}."
9. None of the above: "Good 10 days: keep it this way."

### 5.6 Settings differ

When settings are readable and `|lthr − LT| ≥ 3`, or `threshold_pace` is missing or ≥ 5 s/km from T.

## 6. Missing data

| Case | Card |
|---|---|
| No LT or no T | that tile says what is needed; HR-based checks and the easy-share line are left out |
| No resting HR | Recovery shows form only, "no resting heart rate" |
| Wellness / settings denied | that part hidden: "Recovery needs wellness access" / settings warning omitted |
| Request failed | last saved values, with the page's usual "updated …" time; nothing saved yet: "Performance couldn't load" |
| Two runs on a day | both judged; the day counts once |
| Before the plan / after race day | works on the last 10 days; runs outside the plan are easy-type; no goal line after race day |
| Offline | saved data |

## 7. Files

| File | Change |
|---|---|
| `site/src/performance.js` (new) | pure: §4 and §5 — plain data in, plain data out |
| `site/src/api.js` | requests 1–5, reductions, laps cache and pruning, wider activities range, 403-tolerant requests |
| `site/src/auth.js`, `site/src/config.js` | requested vs required scopes (§3) |
| `site/src/app.js` | render the card (§2) |
| `site/styles.css` | card styles with existing tokens |
| `site/sw.js` | `performance.js` in `FILES` |
| `test/api.test.js`, `test/auth.test.js` | updated only where existing assertions change (request list, activities range, scopes) |
| `README.md`, `2026-10-21-training-calendar-design.md` | new card, permissions |

## 8. Security

Unchanged: read-only `GET`s, only intervals.icu, rendering with DOM APIs and `textContent`, no third-party
code. Saved data stays in the browser's local storage and is removed by Forget / Log out.

## 9. Verification

- **No new unit tests** (user decision). Risk accepted: a wrong rule shows as a wrong verdict on the card;
  it is caught by the checks below, not by the suite.
- `npm test` must still pass (CI runs it before every deploy); existing tests are updated only where §7
  changes what they assert.
- During the build, a throwaway script (not kept) runs `performance.js` on Truong's real week 1 data and
  the output is compared with §1's expected verdicts.
- Live check on `http://localhost:8080` with Truong's key and Baobao001's key: values and verdicts as in §1;
  phone 390 px and PC 1440 px; light and dark; keyboard only (the Each run button, focus order); a declined
  permission simulated by blocking request 3 shows the note and does not log out; offline reload.

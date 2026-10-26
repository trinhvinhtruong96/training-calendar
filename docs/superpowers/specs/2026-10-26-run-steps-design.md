# Run steps in the day details: design

Date: 2026-10-26 · Status: draft for review · Extends `2026-10-21-training-calendar-design.md` and
`2026-10-26-performance-card-design.md`

## 1. Goal

When the athlete opens a day that has a run, the day details show **what was actually run in each planned
step** (warm-up, each rep or block, rests, cool-down, anything after the workout), next to what was planned,
with ✓ / ! against the plan's targets.

**Success:** opening Truong's days from week 1 shows:

- **Wed 21 Oct (10×400):** Warm-up 1.61 km ✓ (HR about 143); a repeat line "10 × 400 m · reps 3:25–3:56 ·
  10 faster than 4:02 !" that opens to each rep and rest; "After the workout" ≈ 1.39 km.
- **Fri 23 Oct (threshold, first plan version):** Warm-up ✓, then 2 × (Settle 1 km, Threshold 2 km, Rest 3 min):
  both Settle rows ! too fast (4:18 vs 4:30–4:40), the first Threshold row ! (too fast, HR above 180);
  "After the workout" ≈ 2.1 km.
- **Sat 24 Oct (easy 7 km + strides):** Easy 7 km ✓ (HR 132–150), 4 strides and walks, no verdict.
- **Sun 25 Oct (long 12 km):** one Easy 12 km step (12.0 km, 12 laps) with HR above 150 marked !; "After the
  workout" 0.13 km.
- **Sat 17 Oct (run before the plan):** not a plan day, so no details. **Sun 18 Oct** likewise. (Details exist
  only for plan days, as today.)

Decisions taken with the user:

- Every day with a run (option A). Laps are fetched the first time a day is opened and saved on the device.
- Only in the day details, not on the Today card.
- Approach 1: walk the watch's laps against the planned steps; fall back to plain laps when they don't fit.
- The Performance card's "Each run" list is removed.
- No new unit tests (same decision as for the Performance card).

Out of scope: second-by-second streams, editing anything in intervals.icu, charts.

## 2. What the day details show

For each planned workout with a run, under the existing "Your run" box, a **Steps** section:

- One row per planned step: **step name**, **planned** (amount and pace range), **done** (distance or time,
  pace, HR), and **status** (✓, ! with a short reason, or none). Status is never colour alone: the icon has a
  text label for screen readers.
- A planned repeat is **one summary row**: "10 × 400 m · @4:02–4:08 · 90 s rest" planned; done "reps 3:25–3:56 ·
  10 faster" (or "all on target"); status ! if any rep has !. A **Show reps** button (`aria-expanded`,
  keyboard operable) opens the rep and rest rows (Rep 1, Rest, Rep 2, …).
- **After the workout**: one row with the laps after the last planned step (distance, time, pace, HR), only
  when there are any.
- **Not done**: planned steps that have no laps left (the run stopped early), listed without numbers.
- When matching stops early (laps don't fit): "Steps after this didn't match your laps", then the remaining
  laps as plain lines.

Extra runs (runs not matched to a planned workout on that day) show a **Laps** list: one line per lap (km,
time, pace, HR).

States: "Loading laps…" while fetching; "Couldn't load the laps" with a **Try again** button; "Laps aren't
ready yet in intervals.icu" when the reply has no laps; "No laps from your watch" (single lap) with the run
total only.

The Performance card loses its "Each run" button and list; everything else on it stays.

## 3. Data

- **Saved laps:** a new storage key `tc.v1.laps` holds `{ [activityId]: [{distance, movingTime, avgHr}] }`
  (the same reduced lap shape as the Performance card). Written only for non-empty replies. On every write it
  is pruned to activity ids present in the current cached `activities`. `store.forget()` removes it.
- **Where the details get laps**, in order: `tc.v1.laps` → `data.performance.laps` → `GET
  /activity/{id}/intervals` (reduced with the existing `reduceLaps`).
- **The Performance card** (`loadPerformance`) also reads `tc.v1.laps` before fetching, and writes what it
  fetches there, so a run's laps are fetched at most once per device. It writes only while the credential it
  started with is still the saved one (no laps saved after Forget / Log out / a new key), and it skips lap
  requests that haven't started yet when the credential has changed.
- **Lap fetch for the details** is soft like the card's requests: network errors, 401 and 403 show "Couldn't
  load the laps" and never log out. If the user moves to another day while laps load, the result is saved but
  only rendered if that day is still open.
- No other new requests. CSP unchanged (only intervals.icu).

## 4. Matching laps to planned steps

Input: the workout's steps (as cached: `text`, `distance`, `duration`, `pace {start,end,units}`, `reps`,
`steps`), the run's laps, and limits `{ lt, easyLimit }` from the Performance card (both null when unknown).

1. Expand the steps in order; a repeat becomes its steps × reps, remembering group and rep number.
2. Ignore laps shorter than 20 m (intervals.icu's tiny extra laps).
3. For each expanded step, take consecutive laps:
   - **Distance step** (`distance > 0`): add laps until covered ≥ distance − tol, `tol = max(100 m, 10 %)`;
     then keep adding the next lap while that brings the total closer to the planned distance (so a 12 km step
     takes all twelve 1 km auto-laps, not eleven).
   - **Timed step** (no distance, `duration > 0`): add laps until time ≥ duration − 15 s; then the same
     "closer to the plan" rule on time.
   - **Mismatch** — stop matching at this step — if the step's laps exceed the plan by more than
     `max(tol, 300 m)` (distance) or 30 s (time), or if laps run out before the step is covered. Steps from
     here on are "Not done" if no laps are left, otherwise the remaining laps become plain lines under "Steps
     after this didn't match your laps".
4. Laps left after the last step: "After the workout".
5. A step's numbers: distance = sum, time = sum of moving time, pace = time ÷ km, HR = time-weighted mean of
   the laps that have HR; the HR range (min–max of lap averages) is shown when the step has 2+ laps.

Workout with no steps: plain laps. Run with one lap or no laps: "No laps from your watch" and no rows.

## 5. Step verdicts

Same tolerances as the Performance card. `cue` = the step text, lower-cased.

| Step cue | ✓ when | ! reason |
|---|---|---|
| warmup, easy, cooldown | HR ≤ easyLimit + 3 | "HR above {easyLimit}" |
| rep; race pace in a workout of type intervals/racepace | pace within [fast − 2 s, slow + 2 s] | "too fast" / "too slow" |
| threshold, settle, tempo | pace ≥ fast − 5 s and HR ≤ lt + 2 | "too fast" / "HR above {lt}"; slower than slow + 5 s → note "slower than planned", no ! |
| steady; race pace in a long or key run | pace within [fast − 3 s, slow + 3 s] | "too fast" / "too slow" |
| stride, walk, rest, race, test all out, anything else | no verdict (a walk after a stride still has a high HR) | — |

- Checks that need HR are skipped when the step has no HR or the limit is null; a step with nothing to check
  shows no status.
- A repeat's summary is ! when any of its rep rows is !, ✓ when all checked rep rows are ✓.
- Pace ranges are only used when `units` is `secs/km` (or missing).

## 6. Files

| File | Change |
|---|---|
| `site/src/steps.js` (new) | pure: `matchSteps(workout, laps, limits)` → rows, groups, after, notDone, unmatched; `lapLines(laps)` |
| `site/src/performance.js` | expose `limits: { lt, easyLimit }` in `buildPerformance` output; drop `runs` (and the code that builds it) |
| `site/src/api.js` | `store.getLaps / setLaps` (key `tc.v1.laps`, pruning), `forget()` removes it; `loadDayLaps(activityId, { store, fetchImpl })`; `loadPerformance` uses and fills the store, credential guard |
| `site/src/config.js` | `STORAGE_KEYS.laps = "tc.v1.laps"` |
| `site/src/app.js` | Steps section in the day details (not on Today); loading / error / retry states; Show reps toggle; Laps list for extra runs; remove the "Each run" list from the Performance card |
| `site/styles.css` | step result rows, repeat toggle |
| `site/sw.js` | `src/steps.js` in `FILES` |
| `test/api.test.js` | only where existing assertions change |
| `README.md`, main spec, performance spec | document the Steps section and the saved laps; remove "Each run" from the performance spec |

## 7. Verification

- No new unit tests (user decision); `npm test` must pass.
- Throwaway script (not kept) running `matchSteps` on Truong's real week 1 laps and plan steps: results as in
  §1.
- Live check on `http://localhost:8080`: open Wed 21, Fri 23, Sat 24, Sun 25 Oct; Show reps with keyboard;
  phone 390 px and PC 1440 px, light and dark; the second open of a day makes no request; offline open of an
  unsaved day shows "Couldn't load the laps" and Try again works once online; a 403 on the lap request shows
  the error without logging out; Forget removes `tc.v1.laps`.

# Steps display: expected vs actual with pace and HR bars — design

Date: 2026-10-26. Status: approved in chat (parts 1–4), written for review.
Builds on: `2026-10-26-run-steps-design.md` (matching laps to steps, saved laps, loading states). This spec
changes only how the **Steps** section of the day details looks.

## 1. Goal

The plan part of the day details stays as it is, and the results stay in their own **Steps** section. That
section is redesigned so that every step shows what was **expected** and what actually happened together, with
the pace (or HR) easy to read at a glance.

**Success:** opening Truong's week 1 days shows:

- **Wed 21 Oct:** Warm-up ✓ with Expected "1.6 km · 5:30–5:50 /km · HR ≤ 150", Actual "1.61 km · 8:40 ·
  5:24 /km · HR 143 · max 171", an HR bar with the dot at 143 inside the band (limit 150) and "7 below the
  limit". The repeat "10 × 400 m" ! with Expected "4:02–4:08 /km · 90 s rest", Actual "reps 3:25–3:56", ten
  dots on one strip (rep 10, 3:25, as an arrow at the fast edge) and "10 too fast". "Show reps" opens a table
  with 10 rep rows and their rests.
- **Fri 23 Oct:** the repeat "2 × (1 km + 2 km + 3 min)" ! with "blocks 4:10–4:18" and "4 too fast"; "Show
  blocks" opens a table with Block 1 and Block 2 (Settle in, Threshold, Rest each). Threshold 1 in the table:
  "2 km · 8:24 · 4:12 · 13 s fast · 182 · !".
- **Sat 24 Oct:** Easy 7 km ✓ with an HR bar, dot at 144, and "6 below the limit"; the strides repeat has no
  bar, "4 of 4 done", and "Show reps" opens a table with Stride and Walk rows, no verdicts.
- **Sun 25 Oct:** Easy 12 km ! with the HR dot at 159, above the limit, and "9 above the limit".

## 2. Decisions (from the brainstorm)

- Keep the plan and the results separate (user).
- Pace display: **A, a bar per step** — planned range as a band, actual as a dot (user).
- Steps judged by HR (warm-up, easy, cool-down) get an **HR bar** against the limit; pace as text (user).
- Repeats open into a **compact table** (user).
- `steps.js` computes everything, including bar positions; `app.js` only draws (approach 1).
- No change to matching, saving laps, loading/error states, the plan part, the "Your run" card, the Today card.
- No new unit tests (same decision as before); `npm test` must pass.

## 3. Row layout

Every step row, in this order:

1. **Status icon and name**: ✓ (on target), ! (check), or no icon; the icon has a spoken label as today.
2. **Expected** line (muted label): the planned amount and pace range, plus the HR limit where a check uses
   one: "HR ≤ {easyLimit}" for warm-up/easy/cool-down, "HR ≤ {lt}" for threshold/settle/tempo. No limit known
   → no HR part. Example: "2 km · 4:25–4:35 /km · HR ≤ 180".
3. **Actual** line (muted label): distance, time, pace, HR. Distance step: "2 km · 8:24 · 4:12 /km · HR 182 ·
   max 185". Timed step: "3:09 · 214 m · HR 151 · max 185". HR is the time-weighted average; "max" is the
   highest lap peak (`max_heartrate`), left out when the laps carry none.
4. **Bar** (§4), when the step has one.
5. **Difference line**: the bar's name on the left ("Pace" or "HR"), the result on the right in the status
   colour (green ✓, red !, muted otherwise):
   - Pace: "plan {range} · " then "in range", or the pace difference per km from the nearer end of the range
     (rounded): "n s/km too fast" / "n s/km too slow" when the step is !, "n s/km fast" / "n s/km slow" when it
     is ✓ (inside the tolerance), "n s/km slower than plan" for the threshold/settle/tempo note (no !).
   - HR: "n below the limit", "at the limit", "n above the limit" (n = average − easyLimit).
   - Threshold/settle/tempo whose HR check fails: " · HR above {lt}" is added to the pace text.
   No bar → no difference line, except the threshold HR failure, which then shows alone ("HR above 180").

Rows without a bar: rest, walk, stride (no pace target or no verdict), race, test all out (Expected + Actual,
no verdict, as today), and any step whose number or limit is missing (§4.4).

**After the workout**: one row, name and the Actual line only.

**Legend**, once above the first row when any bar is shown: "● you ▬ plan · left = faster / lower".

## 4. Bars

### 4.1 Pace bar

For steps judged by pace (rep, threshold, settle, tempo, steady, race pace) with a planned range and a pace.
Scale: from `fast − 30 s` (left) to `slow + 30 s` (right). Band = the planned range. Dot = the step's pace.

### 4.2 HR bar

For warm-up, easy and cool-down steps with an HR and a known easy limit. Scale: `easyLimit − 40` to
`easyLimit + 20` bpm. Band = from the left edge to the limit, with a tick at the limit. Dot = average HR.

### 4.3 Repeat strip

For a repeat with exactly one work step (a step with a pace range that is not warm-up/easy/cool-down): one
pace bar on the work step's scale with one dot per done rep. Each dot has its rep's own colour (✓ / ! / none);
dots are slightly transparent so reps at the same pace stack darker. Repeats with several work steps (Settle + Threshold) or no work step (strides) have
no strip; their table has the detail.

### 4.4 Common rules

- Positions are percentages of the bar width, computed in `steps.js`.
- A value beyond the scale is clamped to the edge (`off: "low"` / `"high"`) and drawn as an arrow pointing
  outward; the text has the exact number.
- Dot colour = row status (✓ `--ok`, ! `--danger`, none `--muted`); band `--accent` at about 45 %; track
  `--border`. Light and dark follow the existing tokens.
- No bar when the value (pace or HR) is missing, when an HR bar has no easy limit, or when a pace step has no
  planned range.
- Bars and the legend are `aria-hidden`; the Expected/Actual/difference text carries all of it. In forced
  colours (Windows high contrast) the bars use system colours so they show on any canvas: track `Canvas` with a
  `CanvasText` border, band `Highlight`, dot, limit tick and legend dot `CanvasText` (no status colour there;
  the text says ✓ / !).

## 5. Repeats

The repeat row: name (for example "10 × 400 m"), **Expected** (single work step: "{range} /km · {other steps}",
e.g. "4:02–4:08 /km · 90 s rest"; otherwise the inner steps joined with " + ", e.g. "Settle in 1 km
@4:30–4:40 + Threshold 2 km @4:25–4:35 + Rest 3 min"), **Actual** ("reps 3:25–3:56", "blocks 4:10–4:18", or
"4 of 4 done" without work steps), the strip (§4.3), the difference line (label "Pace", the existing summary:
"10 too fast", "2 too fast, 1 with HR too high", "all on target"; none for strides), and the button.

**Button:** "Show reps" / "Hide reps" for one work step or none (strides), "Show blocks" / "Hide blocks" for
several. `aria-expanded`, `aria-controls`; open state and focus survive a refresh as today.

**Table** (a real `<table>` with a visually hidden caption, e.g. "Reps of 10 × 400 m", and `th scope="col"`):

- **Look:** the table sits in a rounded card (border, tinted header row, small-caps headers); number columns
  (Dist, Time, Pace, HR) are right-aligned; Pace is bold; one divider per step together with its rest line.
  On the details sheet the card uses 12 px of the sheet's side padding so it fits a 390 px phone.
- **One work step:** a line above the table "Expected 400 m @4:02–4:08 /km · 90 s rest"; columns **#**,
  **Time**, **Pace**, **vs plan**, **HR**. Each rest is a thin muted line under its rep:
  "↳ rest 1:30 · 100 m · HR 149" (average only: a rest's peak is the end of the rep).
- **Several work steps or none:** columns **Step**, **Dist**, **Time**, **Pace**, **vs plan**, **HR**; each
  round is its own `<tbody>` headed by a "Block n" row (spanning, `th scope="rowgroup"`). A rest/walk after a
  step of the same round is a "↳" line under it; a step without a pace target that starts a round (a stride)
  keeps a full row without "vs plan".
- **Status:** ✓ / ! in the first cell, before the rep number or step name, with a spoken label ("1, check").
- **vs plan:** two lines: "plan 4:02–4:08" (small, muted), then a pill "6 s/km fast" / "3 s/km slow" /
  "in range" — green for ✓ (also inside the tolerance), red for !; text ≥ 4.5:1 on the pill in both themes.
- **HR:** time-weighted average, with "max 182" (highest lap peak) small underneath.
- Only rounds with laps appear (a run stopped early shows the done rounds; "Not done" stays as today).
- The table scrolls sideways inside its box on very narrow screens.

## 6. Data (`site/src/steps.js`)

`matchSteps(workout, laps, limits)` keeps its kinds (`single`, `laps`, `steps`) and the fields `after`,
`notDone`, `unmatched`. Items change (clean cutover; `planned` and `done` are removed):

- Step item: `{ kind: "step", name, status, reason, expected, actual, bar, diff }`
- Repeat item: `{ kind: "repeat", name, status, reason, expected, actual, bar, diff, label, table }`
- `bar`: `null` or `{ kind: "pace" | "hr", lo, hi, at, off, status, dots }` — `lo`/`hi` band edges and `at` the
  dot in % (0–100); `off` `"low" | "high" | null`; `status` the item's status (dot colour); `dots` (strip only)
  `[{ at, off, status }]` with each rep's own status, and then `at`, `off` and `status` are `null`.
- `diff`: `null` or `{ label: "Pace" | "HR", text }`; the colour comes from the item's `status`.
- `label`: `"reps"` or `"blocks"` (button text).
- `table`: `{ columns: "single" | "multi", target: string | null, rows }`; a row is
  `{ kind: "work" | "rest" | "block", n, step, dist, time, pace, plan, vs, hr, hrMax, status, attached }`
  (strings except `n`, `status`, `attached`; fields not used by a kind are empty strings; `block` rows have
  only `n`; `attached` = a rest/walk drawn as a line under the step before it in the same round).

`app.js` renders these as described in §3–§5 and keeps everything else (loading, errors, Try again, saved laps,
open tables and focus across refreshes) unchanged.

## 7. Files

| File | Change |
|---|---|
| `site/src/steps.js` | expected/actual texts, bar geometry, difference texts, repeat tables |
| `site/src/app.js` | legend, rows, bars, strip, table, button labels |
| `site/styles.css` | row layout, bar (track, band, dot, edge arrow via `--lo/--hi/--at`), table; forced-colours list |
| `README.md` | the Steps sentence mentions expected vs actual and the bars |
| `docs/superpowers/specs/2026-10-26-run-steps-design.md` | §2 points here for the display |

## 8. Verification

- **No new unit tests** (user decision). `npm test` must pass.
- **Throwaway script** (not kept) on Truong's real week 1 laps; the §1 values, plus: Wed 21 HR bar `at` ≈ 55
  and band `hi` ≈ 66.7; Fri 23 Threshold 1 `at` ≈ 24.3 with band 42.9–57.1; rep 10 of Wed 21 `off: "low"`.
- **Synthetic cases:** no HR, no limits (`lt`/`easyLimit` null), pace beyond the scale on both sides,
  threshold slower than planned (muted dot, "n s slower than plan", no !), strides (no strip, Step/Dist
  table), a run stopped mid-repeat.
- **Live** on `http://localhost:8080` with Truong's key: phone 390 px and PC 1440 px; light, dark, forced
  colours; keyboard on Show reps / Show blocks; the table's headers in the accessibility tree; a refresh keeps
  an open table and focus; no console errors. Storage cleared afterwards.

Out of scope: the plan part, the "Your run" card, charts of the whole run, the Today card, matching rules.

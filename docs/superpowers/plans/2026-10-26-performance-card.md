# Performance Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a Performance card to the training calendar: threshold pace and threshold HR (now, since plan start,
goal), a review of the last 10 days with per-run verdicts, and up to 3 suggestions, all computed in the browser
from each athlete's own intervals.icu data.

**Architecture:** A new pure module `site/src/performance.js` turns cached data into display data (strings and
statuses). `site/src/api.js` fetches five extra read-only resources on every refresh (pace curves, HR curves,
wellness, athlete settings, laps per run) through a "soft" request that can never break the calendar or log
anyone out, and saves them under `performance` in the existing cache. `site/src/app.js` renders the card.

**Tech Stack:** Plain HTML/CSS/ES modules, no build step, no dependencies. Node's built-in test runner for the
existing suite (`npm test`).

**Spec:** `docs/superpowers/specs/2026-10-26-performance-card-design.md`

## Global Constraints

- No framework, no build step, no runtime dependencies; plain ES modules (`package.json` has `"type": "module"`).
- Read-only: only `GET` requests to `https://intervals.icu` (CSP `connect-src https://intervals.icu` unchanged).
- Render with DOM APIs and `textContent` only (the `h()` helper in `app.js`); API strings never become HTML.
- **No new unit tests** (user decision). `npm test` must still pass: CI runs it before every deploy. Existing tests
  change only where this plan changes what they assert (Task 3).
- **Never print, log or commit an API key.** Keys come from `%USERPROFILE%\.intervals_key` or are pasted into a
  local browser / passed as a script argument at run time. The plan and repo contain no keys.
- Window: today and the 9 days before (`WINDOW_DAYS = 10`). Curve windows: 90 days (`CURVE_DAYS = 90`), "now"
  ends today, "plan start" ends `PLAN.firstDay`. Runs under 2 km (`MIN_RUN_M = 2000`) are not judged.
- Easy limit `E = 0.83 × LT` rounded to the nearest 5; hard HR `0.95 × LT`; threshold HR valid only when
  `≥ 0.88 × HRmax`, `HRmax = max(settings.max_hr, best 1-min HR)`.
- English UI, paces `m:ss`, distances in km, dates `Sun 25 Oct`.
- If a file under `site/` is added, add it to `FILES` in `site/sw.js`.

## Review Focus

Most likely to bite a real user and not exercised by any test (there are no new unit tests); each is checked in
the owning task's verification step:

1. **Old cache without `performance`** (first load after the deploy, or right after Connect): the card must
   say "Performance couldn't load yet…" and the calendar must render normally. → Task 4, Step 4.
2. **Athlete with no hard running** (Baobao001: one walk, empty curves, no `paceModels`, no 1800/3600 s HR
   values): no exception, tiles say "Not enough hard running yet…", HR checks skipped. → Task 3, Step 6.
3. **Wellness or settings access declined** (403 on those requests, e.g. a login that unticked them): the
   matching part is hidden with a note, the user is **not** sent back to the setup screen. → Task 4, Step 4.
4. **Today's planned run not done yet**: it must not show as missed or count as planned. → Task 2, Step 3.
5. **Run synced but intervals.icu has not analysed it yet** (`icu_intervals` empty): laps are not cached, the run
   is judged "no laps" now and properly on a later refresh. → Task 3, Step 6.

---

## File Structure

| File | Responsibility |
|---|---|
| `site/src/performance.js` (create) | Pure logic and display text: estimates (§4), verdicts and review (§5), suggestions. Exports `buildPerformance`, `windowFrom`, `curveWindow`, `MIN_RUN_M`, `WINDOW_DAYS`, `CURVE_DAYS`, `thresholdHr`, `thresholdPace`, `goalThreshold`. |
| `site/src/api.js` (modify) | Soft requests, reducers for the new data, laps cache, wider activities range, `performance` in the cache. |
| `site/src/config.js`, `site/src/auth.js` (modify) | Requested scope vs required scope. |
| `site/src/app.js` (modify) | Render the card; state for the "Each run" toggle. |
| `site/styles.css` (modify) | Card styles; desktop grid area. |
| `site/sw.js` (modify) | Offline file list. |
| `test/api.test.js` (modify) | Updated request list and activity range assertions. |
| `README.md`, `docs/superpowers/specs/2026-10-21-training-calendar-design.md` (modify) | Document the card and permissions. |

---

### Task 1: Threshold estimates, goal and tiles (`performance.js`, part 1)

**Files:**
- Create: `site/src/performance.js`

**Interfaces:**
- Consumes: `addDays`, `formatDate`, `formatPace` (`dates.js`); `flattenSteps`, `workoutType` (`workout.js`);
  `PLAN` (`config.js`).
- Produces (used by Tasks 2–3):
  - `WINDOW_DAYS = 10`, `CURVE_DAYS = 90`, `MIN_RUN_M = 2000`
  - `windowFrom(today: string) → string` (ISO date, 9 days before today)
  - `curveWindow(end: string) → string` (`"r.<end−89>.<end>"`, the intervals.icu custom window id)
  - `thresholdHr(hr: {h60,h30,h1}|null, settings: {maxHr}|null) → {bpm: number, minutes: 60|30} | null`
  - `thresholdPace(curve: {cs}|null) → number | null` (seconds per km)
  - `goalThreshold(racePace: number) → number` (seconds per km)
  - internal: `paceTile(perf, events, today, plan) → {tile, pace}`, `hrTile(perf, today, plan) → {tile, lt}`,
    `settingsNote(settings, lt, pace) → string | null`, helpers `dayMonth`, `round5`, `paceOf`, `span`,
    `paceSpan`, `median`
  - Tile shape: `{ label: string, value: string | null, lines: [{ kind: "good"|"note"|"muted", text: string }] }`

- [ ] **Step 1: Create `site/src/performance.js` with constants, helpers and estimates**

```js
// Performance card: threshold estimates, the last-10-days review and suggestions.
// Pure: cached data in, display data out. Spec: docs/superpowers/specs/2026-10-26-performance-card-design.md
import { PLAN } from "./config.js";
import { addDays, formatClock, formatDate, formatKm, formatPace } from "./dates.js";
import { buildModel, isRun } from "./model.js";
import { flattenSteps, shortName, workoutType } from "./workout.js";

export const WINDOW_DAYS = 10;
export const CURVE_DAYS = 90;
export const MIN_RUN_M = 2000;

const HM_M = 21097.5;

export const windowFrom = today => addDays(today, -(WINDOW_DAYS - 1));
export const curveWindow = end => `r.${addDays(end, -(CURVE_DAYS - 1))}.${end}`;

const dayMonth = iso => formatDate(iso).slice(4); // "Tue 20 Oct" → "20 Oct"
const round5 = x => Math.round(x / 5) * 5;
const paceOf = (metres, seconds) => (metres > 0 && seconds > 0 ? seconds / (metres / 1000) : null);

function span(values) {
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  return lo === hi ? String(lo) : `${lo}–${hi}`;
}

function paceSpan(paces) {
  const lo = formatPace(Math.min(...paces));
  const hi = formatPace(Math.max(...paces));
  return lo === hi ? lo : `${lo}–${hi}`;
}

function median(values) {
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// ---------- threshold estimates (spec §4) ----------

// Best HR held for 60 min; else for 30 min minus 2. Only from a hard effort (≥ 88 % of max HR).
export function thresholdHr(hr, settings) {
  if (!hr) return null;
  const hrMax = Math.max(Number(settings?.maxHr) || 0, Number(hr.h1) || 0);
  if (!hrMax) return null;
  const floor = 0.88 * hrMax;
  if (hr.h60 >= floor) return { bpm: Math.round(hr.h60), minutes: 60 };
  if (hr.h30 >= floor) return { bpm: Math.round(hr.h30 - 2), minutes: 30 };
  return null;
}

// intervals.icu's critical speed (m/s) as seconds per km.
export function thresholdPace(curve) {
  return curve?.cs > 0 ? 1000 / curve.cs : null;
}

const vo2 = v => -4.6 + 0.182258 * v + 0.000104 * v * v; // v in m/min
const vo2Share = t => 0.8 + 0.1894393 * Math.exp(-0.012778 * t) + 0.2989558 * Math.exp(-0.1932605 * t); // t in min

// Daniels/Gilbert: half-marathon race pace → VDOT → threshold pace (88 % of VDOT). Seconds per km.
export function goalThreshold(racePace) {
  const minutes = (racePace * HM_M) / 1000 / 60;
  const vdot = vo2(HM_M / minutes) / vo2Share(minutes);
  const c = -4.6 - 0.88 * vdot;
  const v = (-0.182258 + Math.sqrt(0.182258 ** 2 - 4 * 0.000104 * c)) / (2 * 0.000104);
  return 60000 / v;
}

// Middle of the race step's pace range in the athlete's calendar; null after race day or without a race.
function racePaceOf(events, today) {
  const race = events.find(e => e.category === "WORKOUT" && workoutType(e.name) === "race" && e.date >= today);
  const step = flattenSteps(race?.steps ?? [])
    .find(s => /^race$/i.test(String(s.text ?? "").trim()) && s.pace?.start != null && s.pace?.end != null);
  return step ? (step.pace.start + step.pace.end) / 2 : null;
}

function paceTile(perf, events, today, plan) {
  const now = thresholdPace(perf.paceNow);
  const tile = { label: "Threshold pace", value: now ? `${formatPace(now)} /km` : null, lines: [] };
  if (!now) {
    tile.lines.push({ kind: "muted", text: "Not enough hard running yet: a test or race sets it." });
    return { tile, pace: null };
  }
  const start = thresholdPace(perf.pacePlanStart);
  if (start && today > plan.firstDay) {
    const faster = start - now;
    if (faster >= 2) tile.lines.push({ kind: "good", text: `${Math.round(faster)} s faster since ${dayMonth(plan.firstDay)}` });
    else if (faster > -2) tile.lines.push({ kind: "muted", text: `Same as ${dayMonth(plan.firstDay)}` });
    else tile.lines.push({ kind: "muted", text: `Best efforts from before ${dayMonth(addDays(today, -(CURVE_DAYS - 1)))} no longer count` });
  }
  const racePace = racePaceOf(events, today);
  if (racePace) {
    const goal = goalThreshold(racePace);
    const gap = Math.round(now - goal);
    tile.lines.push({
      kind: gap <= 0 ? "good" : "note",
      text: `Goal ${formatPace(goal)} for your race pace ${formatPace(racePace)} · ${gap <= 0 ? "reached" : `${gap} s to go`}`,
    });
  }
  tile.lines.push({ kind: "muted", text: "From your best efforts, last 90 days" });
  return { tile, pace: now };
}

function hrTile(perf, today, plan) {
  const lt = thresholdHr(perf.hrNow, perf.settings);
  const tile = { label: "Threshold heart rate", value: lt ? `${lt.bpm} bpm` : null, lines: [] };
  if (!lt) {
    tile.lines.push({ kind: "muted", text: "Not enough hard running yet: a test or race of 30+ min sets it." });
    return { tile, lt: null };
  }
  const start = thresholdHr(perf.hrPlanStart, perf.settings);
  if (start && today > plan.firstDay) {
    tile.lines.push({
      kind: "muted",
      text: Math.abs(start.bpm - lt.bpm) >= 2 ? `${start.bpm} bpm on ${dayMonth(plan.firstDay)}` : `Unchanged since ${dayMonth(plan.firstDay)}`,
    });
  }
  tile.lines.push({ kind: "muted", text: `Highest HR held for ${lt.minutes} min${lt.minutes === 30 ? ", minus 2" : ""}, last 90 days` });
  return { tile, lt: lt.bpm };
}

// Spec §5.6: intervals.icu's own settings differ from the estimates.
function settingsNote(settings, lt, pace) {
  if (!settings) return null;
  const notes = [];
  if (lt) {
    if (!settings.lthr) notes.push("intervals.icu has no threshold HR set.");
    else if (Math.abs(settings.lthr - lt) >= 3) notes.push(`intervals.icu has threshold HR ${settings.lthr} set: its zones and load for you use ${settings.lthr}.`);
  }
  if (pace) {
    const set = settings.thresholdPace > 0 ? 1000 / settings.thresholdPace : null;
    if (!set) notes.push("intervals.icu has no threshold pace set.");
    else if (Math.abs(set - pace) >= 5) notes.push(`intervals.icu has threshold pace ${formatPace(set)} /km set.`);
  }
  return notes.length ? notes.join(" ") : null;
}
```

The imports `formatClock`, `formatKm`, `buildModel`, `isRun`, `shortName` are used in Task 2; leave them.

- [ ] **Step 2: Check the estimates with a throwaway command (not kept)**

Run (repo root; on this PC use `"C:\Program Files\nodejs\node.exe"` if `node` is not on the shell's PATH):

```bash
node --input-type=module -e "
import { goalThreshold, thresholdHr, thresholdPace, windowFrom, curveWindow } from './site/src/performance.js';
import { formatPace } from './site/src/dates.js';
console.log(formatPace(goalThreshold(255)), formatPace(goalThreshold(324)));
console.log(JSON.stringify(thresholdHr({ h60: 180, h30: 182, h1: 185 }, { maxHr: 185 })));
console.log(JSON.stringify(thresholdHr({ h60: null, h30: 182, h1: 185 }, null)));
console.log(JSON.stringify(thresholdHr({ h60: 140, h30: 145, h1: 152 }, { maxHr: 180 })));
console.log(formatPace(thresholdPace({ cs: 3.8067026 })), thresholdPace(null));
console.log(windowFrom('2026-10-26'), curveWindow('2026-10-21'));
"
```

Expected:
```
4:10 5:13
{"bpm":180,"minutes":60}
{"bpm":180,"minutes":30}
null
4:23 null
2026-10-17 r.2026-07-24.2026-10-21
```

- [ ] **Step 3: Run the existing suite**

Run: `npm test`
Expected: all tests pass (53 at the time of writing). The new module is not imported anywhere yet.

- [ ] **Step 4: Commit**

```bash
git add site/src/performance.js
git commit -m "feat(performance): threshold pace and HR estimates, goal threshold"
```

---

### Task 2: Run verdicts, review lines, suggestions (`performance.js`, part 2)

**Files:**
- Modify: `site/src/performance.js` (append)

**Interfaces:**
- Consumes: Task 1 exports and helpers; `buildModel(data, today, plan)` and `isRun(activity)` (`model.js`);
  `shortName`, `flattenSteps` (`workout.js`); `formatClock`, `formatKm`, `formatDate`, `formatPace`.
- Cached `data.performance` shape (written by Task 3):
  `{ paceNow: {cs, bests: {[metres]: {secs, activityId}}} | null, pacePlanStart: {cs, bests} | null,
     hrNow: {h60,h30,h1} | null, hrPlanStart: {h60,h30,h1} | null,
     wellness: [{date, restingHR, ctl, atl}], settings: {lthr, maxHr, thresholdPace} | null,
     laps: {[activityId]: [{distance, movingTime, avgHr}]}, denied: {wellness: boolean, settings: boolean},
     loadFailed: boolean }` (`loadFailed`: both curve requests failed and nothing was saved before)
- Produces (used by Task 4): `buildPerformance(data, today, plan = PLAN) →`
  `{ from, to, loaded: boolean, pace: Tile|null, hr: Tile|null, settingsNote: string|null,
     lines: [{ status: "ok"|"check"|"neutral", text }], suggestions: [string],
     runs: [{ date, title, status: "ok"|"check"|"neutral"|"skip", reason }] }`

- [ ] **Step 1: Append targets, laps and verdict functions**

```js
// ---------- laps and planned targets (spec §5.1) ----------
const HARD = new Set(["intervals", "threshold", "tempo", "racepace", "key", "test", "race"]);
const REPS = new Set(["intervals", "racepace"]);
const BLOCKS = new Set(["threshold", "tempo"]);
const SESSIONS = new Set(["intervals", "threshold", "tempo", "racepace", "key"]);
const EASY = new Set(["easy", "run", "long"]);
const BEST_LABEL = { 1000: "1 km", 3000: "3 km", 5000: "5 km", 10000: "10 km", 21097.5: "Half marathon" };

const isRunSport = w => !w.sport || /run/i.test(w.sport);
// Baobao001's Thursday "Tempo" workouts have no type of their own in workout.js.
const typeOf = w => (w.type === "run" && /\btempo\b/i.test(w.name) ? "tempo" : w.type);
const hasRange = s => s.pace && s.pace.start != null && s.pace.end != null && (!s.pace.units || s.pace.units === "secs/km");
const inStep = (lap, step) => {
  const mid = (lap.start + lap.end) / 2;
  return mid >= step.start && mid <= step.end;
};

function withOffsets(laps) {
  let at = 0;
  return laps.map(l => {
    const lap = { ...l, start: at, end: at + (l.distance || 0), pace: paceOf(l.distance, l.movingTime) };
    at = lap.end;
    return lap;
  });
}

// Planned steps with their distance offsets; "easy" = first warm-up/easy/cool-down range, "work" = faster steps.
function targets(workout) {
  let at = 0;
  const steps = flattenSteps(workout?.steps ?? []).map(s => {
    const step = { text: String(s.text ?? "").trim().toLowerCase(), start: at, end: at + (s.distance || 0) };
    if (hasRange(s)) {
      step.lo = Math.min(s.pace.start, s.pace.end);
      step.hi = Math.max(s.pace.start, s.pace.end);
    }
    at = step.end;
    return step;
  });
  return {
    easy: steps.find(s => s.lo != null && /^(warm-?up|easy|cool-?down)\b/.test(s.text)) ?? null,
    work: steps.filter(s => s.lo != null && /^(rep|threshold|tempo|race pace|race|steady|settle)\b/.test(s.text)),
  };
}

// Laps faster than the middle between the easy range's fast end and the slowest work range, ≥ 150 m.
function workLaps(laps, t) {
  if (!t.work.length) return [];
  const slowest = Math.max(...t.work.map(s => s.hi));
  const cut = t.easy ? (t.easy.lo + slowest) / 2 : slowest + 30;
  return laps.filter(l => l.distance >= 150 && l.pace != null && l.pace < cut);
}

function judgeReps(laps, t) {
  const reps = workLaps(laps, t);
  if (!reps.length) return { status: "neutral", reason: "different from the plan", issues: [] };
  const lo = Math.min(...t.work.map(s => s.lo));
  const hi = Math.max(...t.work.map(s => s.hi));
  const range = `${formatPace(lo)}–${formatPace(hi)}`;
  const paces = reps.map(l => l.pace);
  const seen = `reps ${paceSpan(paces)}, target ${range}`;
  const fast = paces.filter(p => p < lo - 2).length;
  const slow = paces.filter(p => p > hi + 2).length;
  if (!fast && !slow) return { status: "ok", reason: seen, issues: [] };
  const parts = [];
  if (fast) parts.push(`${fast} of ${reps.length} reps faster than ${formatPace(lo)}`);
  if (slow) parts.push(`${slow} of ${reps.length} reps slower than ${formatPace(hi)}`);
  const avg = paceOf(reps.reduce((s, l) => s + l.distance, 0), reps.reduce((s, l) => s + l.movingTime, 0));
  return { status: "check", reason: `${parts.join(", ")} (${seen})`, issues: [{ kind: "reps", range, pace: avg, fast: fast > 0 }] };
}

function judgeBlocks(laps, t, ctx) {
  const blocks = workLaps(laps, t);
  if (!blocks.length) return { status: "neutral", reason: "different from the plan", issues: [] };
  const fastest = Math.min(...t.work.map(s => s.lo));
  const slowest = Math.max(...t.work.map(s => s.hi));
  const paces = blocks.map(l => l.pace);
  const hrs = blocks.filter(l => l.avgHr > 0).map(l => Math.round(l.avgHr));
  const problems = [];
  const issues = [];
  if (ctx.lt && hrs.length && Math.max(...hrs) > ctx.lt + 2) {
    problems.push(`blocks at HR ${span(hrs)}, above ${ctx.lt}`);
    issues.push({ kind: "blockHr", hr: Math.max(...hrs) });
  }
  if (Math.min(...paces) < fastest - 5) {
    const range = `${formatPace(fastest)}–${formatPace(slowest)}`;
    problems.push(`blocks ${paceSpan(paces)}, target ${range} (too fast)`);
    issues.push({ kind: "blockPace", range, pace: Math.min(...paces) });
  }
  if (problems.length) return { status: "check", reason: problems.join(" · "), issues };
  return { status: "ok", reason: `blocks ${paceSpan(paces)}${hrs.length ? ` at HR ${span(hrs)}` : ""}`, issues: [] };
}

// Mean pace of the last 3 km more than 30 s/km faster than the first 3 km (runs of 7 km or more).
function fastFinish(laps) {
  const usable = laps.filter(l => l.distance >= 200 && l.pace != null);
  if (usable.reduce((s, l) => s + l.distance, 0) < 7000) return null;
  const take = list => {
    const out = [];
    let metres = 0;
    for (const l of list) {
      if (metres >= 3000) break;
      out.push(l);
      metres += l.distance;
    }
    return out;
  };
  const mean = list => paceOf(list.reduce((s, l) => s + l.distance, 0), list.reduce((s, l) => s + l.movingTime, 0));
  const first = mean(take(usable));
  const last = mean(take([...usable].reverse()));
  if (first - last <= 30) return null;
  const end = [...usable].reverse().find(l => l.distance >= 500) ?? usable[usable.length - 1];
  return { first, last, lastKm: end.pace, lastHr: end.avgHr > 0 ? Math.round(end.avgHr) : null };
}

// Easy, unplanned, long and key runs: HR under the easy limit (outside planned faster parts);
// long/key runs with a faster part: that part inside its range; long runs without one: no fast finish.
function judgeEasy(laps, t, ctx, type) {
  const problems = [];
  const issues = [];
  const limit = ctx.easyLimit;
  const inPart = l => t.work.some(s => inStep(l, s));
  if (limit) {
    const over = laps.filter(l => l.start >= 900 && l.distance >= 200 && l.avgHr > limit + 3 && !inPart(l));
    if (over.length) {
      const hrs = over.map(l => Math.round(l.avgHr));
      const km = Math.floor(over[0].start / 1000) + 1;
      problems.push(`HR ${span(hrs)} from km ${km}, limit ${limit}`);
      issues.push({ kind: "easyHr", hr: Math.max(...hrs), km });
    }
  }
  if (t.work.length) {
    for (const s of t.work) {
      const part = laps.filter(l => l.pace != null && l.distance >= 200 && inStep(l, s));
      if (!part.length) continue;
      const paces = part.map(l => l.pace);
      const tooFast = Math.min(...paces) < s.lo - 3;
      const tooSlow = Math.max(...paces) > s.hi + 3;
      if (tooFast || tooSlow) {
        const where = `km ${Math.round(s.start / 1000)}–${Math.round(s.end / 1000)}`;
        problems.push(`${where} ${paceSpan(paces)}, target ${formatPace(s.lo)}–${formatPace(s.hi)} (${tooFast ? "too fast" : "too slow"})`);
        if (tooFast) issues.push({ kind: "partFast", pace: Math.min(...paces) });
      }
    }
  } else if (type === "long") {
    const ff = fastFinish(laps);
    if (ff) {
      problems.push(`last 3 km ${formatPace(ff.last)} vs first 3 km ${formatPace(ff.first)}, last km ${formatPace(ff.lastKm)}${ff.lastHr ? ` at HR ${ff.lastHr}` : ""}`);
      issues.push({ kind: "fastFinish", pace: ff.lastKm });
    }
  }
  if (problems.length) return { status: "check", reason: problems.join(" · "), issues };
  const hrs = laps.filter(l => l.start >= 900 && l.distance >= 200 && l.avgHr > 0).map(l => Math.round(l.avgHr));
  return { status: "ok", reason: hrs.length ? `HR ${span(hrs)}` : "", issues: [] };
}

// No laps: only the whole-run average HR can be judged, and only for easy-type runs.
function judgeWhole(run, type, ctx) {
  if (!EASY.has(type)) return { status: "neutral", reason: "", issues: [] };
  if (ctx.easyLimit && run.avgHr > ctx.easyLimit + 3) {
    const hr = Math.round(run.avgHr);
    return { status: "check", reason: `average HR ${hr}, limit ${ctx.easyLimit}`, issues: [{ kind: "easyHr", hr, km: null }] };
  }
  return { status: "ok", reason: run.avgHr > 0 ? `average HR ${Math.round(run.avgHr)}` : "", issues: [] };
}

function judge(run, workout, rawLaps, ctx) {
  const type = workout ? typeOf(workout) : "easy";
  if (run.distance < MIN_RUN_M) return { type, status: "skip", reason: `${formatKm(run.distance, 2)} km, not judged`, issues: [] };
  if (type === "test" || type === "race") {
    return { type, status: "neutral", reason: `${formatKm(run.distance, 2)} km in ${formatClock(run.movingTime)}`, issues: [] };
  }
  const laps = Array.isArray(rawLaps) && rawLaps.length > 1 ? withOffsets(rawLaps) : null;
  const hrCtx = run.avgHr > 0 ? ctx : { ...ctx, lt: null, easyLimit: null };
  const t = targets(workout);
  let v;
  if (!laps) v = judgeWhole(run, type, hrCtx);
  else if (REPS.has(type)) v = judgeReps(laps, t);
  else if (BLOCKS.has(type)) v = judgeBlocks(laps, t, hrCtx);
  else v = judgeEasy(laps, t, hrCtx, type);
  const marks = [run.avgHr > 0 ? "" : "no heart rate", laps ? "" : "no laps"].filter(Boolean);
  return { type, ...v, reason: [v.reason, ...marks].filter(Boolean).join(" · ") };
}
```

- [ ] **Step 2: Append hard days, recovery and `buildPerformance`**

```js
// ---------- the 10 days (spec §5.2–§5.5) ----------

// The plan's days in the window, with runs matched to workouts by the calendar's own matching.
function windowDays(data, today) {
  const model = buildModel(data, today, { calendarStart: windowFrom(today), weeks: 2, phases: [] });
  return model.days.filter(d => d.date <= today);
}

function hardDays(days, laps, lt, today) {
  let done = 0;
  let planned = 0;
  for (const d of days) {
    const hardPlan = d.workouts.filter(w => isRunSport(w) && HARD.has(typeOf(w)));
    if (hardPlan.some(w => w.run || d.date < today)) planned += 1;
    let hard = hardPlan.some(w => w.run);
    if (!hard && lt) {
      const secs = d.activities.filter(isRun)
        .flatMap(a => laps[a.id] ?? [])
        .filter(l => l.avgHr >= 0.95 * lt)
        .reduce((s, l) => s + (l.movingTime || 0), 0);
      hard = secs >= 300;
    }
    if (hard) done += 1;
  }
  return { done, planned };
}

function recoveryOf(wellness) {
  const rows = [...(wellness ?? [])].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const withRhr = rows.filter(r => r.restingHR > 0);
  const last3 = withRhr.slice(-3);
  let rhr = null;
  if (last3.length) {
    const first = last3[0].date;
    const base = withRhr.filter(r => r.date < first && r.date >= addDays(first, -28)).map(r => r.restingHR);
    const normal = base.length >= 7 ? median(base) : null;
    rhr = {
      latest: last3[last3.length - 1].restingHR,
      normal,
      high: normal == null ? 0 : last3.filter(r => r.restingHR >= normal + 5).length,
    };
  }
  const latest = [...rows].reverse().find(r => r.ctl != null && r.atl != null);
  return { rhr, form: latest ? latest.ctl - latest.atl : null };
}

export function buildPerformance(data, today, plan = PLAN) {
  const from = windowFrom(today);
  const out = { from, to: today, loaded: false, pace: null, hr: null, settingsNote: null, lines: [], suggestions: [], runs: [] };
  const perf = data?.performance;
  if (!perf || perf.loadFailed) return out; // nothing could be loaded yet: the card says so
  out.loaded = true;

  const paceInfo = paceTile(perf, data.events ?? [], today, plan);
  const hrInfo = hrTile(perf, today, plan);
  out.pace = paceInfo.tile;
  out.hr = hrInfo.tile;
  out.settingsNote = settingsNote(perf.settings, hrInfo.lt, paceInfo.pace);
  const lt = hrInfo.lt;
  const ctx = { lt, easyLimit: lt ? round5(0.83 * lt) : null };
  const laps = perf.laps ?? {};

  // Runs and missed workouts, oldest first.
  const days = windowDays(data, today);
  const judged = [];
  const missed = [];
  let plannedCount = 0;
  let plannedM = 0;
  for (const d of days) {
    for (const w of d.workouts.filter(isRunSport)) {
      if (!w.run && d.date === today) continue; // today's run may still happen
      plannedCount += 1;
      plannedM += w.distance || 0;
      if (w.run) judged.push({ date: d.date, run: w.run, workout: w, verdict: judge(w.run, w, laps[w.run.id], ctx) });
      else missed.push({ date: d.date, workout: w });
    }
    for (const a of d.extraRuns) judged.push({ date: d.date, run: a, workout: null, verdict: judge(a, null, laps[a.id], ctx) });
  }
  out.runs = [
    ...judged.map(j => ({
      date: j.date,
      title: `${formatDate(j.date)} · ${j.workout ? shortName(j.workout.name) : `Run ${formatKm(j.run.distance)} km`}`,
      status: j.verdict.status,
      reason: j.verdict.reason,
    })),
    ...missed.map(m => ({ date: m.date, title: `${formatDate(m.date)} · ${shortName(m.workout.name)}`, status: "check", reason: "missed" })),
  ].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

  // Review lines.
  const doneM = days.flatMap(d => d.activities).filter(isRun).reduce((s, a) => s + (a.distance || 0), 0);
  out.lines.push({
    status: missed.length ? "check" : "ok",
    text: plannedCount
      ? `Done: ${plannedCount - missed.length} of ${plannedCount} planned runs · ${formatKm(doneM)} of ${formatKm(plannedM)} km`
      : `Done: ${formatKm(doneM)} km, no planned runs`,
  });

  const easyRuns = judged.filter(j => EASY.has(j.verdict.type) && j.verdict.status !== "skip");
  if (easyRuns.length) {
    const ok = easyRuns.filter(j => j.verdict.status === "ok").length;
    out.lines.push({
      status: ok === easyRuns.length ? "ok" : "check",
      text: `Easy runs: ${ok} of ${easyRuns.length} easy${ctx.easyLimit ? ` (HR under ${ctx.easyLimit})` : ""}`,
    });
  }

  const sessions = judged.filter(j => SESSIONS.has(j.verdict.type) && j.verdict.status !== "neutral" && j.verdict.status !== "skip");
  const hard = hardDays(days, laps, lt, today);
  if (sessions.length || hard.planned || hard.done) {
    const ok = sessions.filter(j => j.verdict.status === "ok").length;
    out.lines.push({
      status: ok === sessions.length && hard.done <= hard.planned ? "ok" : "check",
      text: `Hard sessions: ${ok} of ${sessions.length} on target · ${hard.done} hard day${hard.done === 1 ? "" : "s"}, plan had ${hard.planned}`,
    });
  }

  let easyShare = null;
  if (ctx.easyLimit) {
    let easy = 0;
    let total = 0;
    for (const j of judged) {
      if (j.run.distance < MIN_RUN_M) continue;
      for (const l of laps[j.run.id] ?? []) {
        if (!(l.avgHr > 0) || !(l.movingTime > 0)) continue;
        total += l.movingTime;
        if (l.avgHr <= ctx.easyLimit) easy += l.movingTime;
      }
    }
    if (total) {
      easyShare = Math.round((easy / total) * 100);
      out.lines.push({
        status: easyShare >= 70 ? "ok" : "check",
        text: `Easy running: ${easyShare}% of running time under HR ${ctx.easyLimit} (aim 70–80%)`,
      });
    }
  }

  let recovery = null;
  if (perf.denied?.wellness) {
    out.lines.push({ status: "neutral", text: "Recovery needs wellness access" });
  } else {
    recovery = recoveryOf(perf.wellness);
    if (recovery.rhr || recovery.form != null) {
      const parts = [recovery.rhr
        ? (recovery.rhr.normal != null ? `resting HR ${recovery.rhr.latest}, normal ${Math.round(recovery.rhr.normal)}` : `resting HR ${recovery.rhr.latest}`)
        : "no resting heart rate"];
      if (recovery.form != null) parts.push(`form ${recovery.form >= 0 ? "+" : ""}${Math.round(recovery.form)}`);
      const bad = (recovery.rhr?.high ?? 0) >= 2 || (recovery.form != null && recovery.form < -30);
      out.lines.push({ status: bad ? "check" : "ok", text: `Recovery: ${parts.join(" · ")}` });
    }
  }

  const runDates = new Map(days.flatMap(d => d.activities).filter(isRun).map(a => [String(a.id), a.date]));
  const bests = Object.entries(perf.paceNow?.bests ?? {})
    .filter(([, b]) => runDates.has(String(b.activityId)))
    .map(([m, b]) => {
      const metres = Number(m);
      const label = BEST_LABEL[m] ?? `${formatKm(metres)} km`;
      return `${label} in ${formatClock(b.secs)} (${formatPace(b.secs / (metres / 1000))} /km), ${formatDate(runDates.get(String(b.activityId)))}`;
    });
  if (bests.length) out.lines.push({ status: "ok", text: `New best: ${bests.join("; ")}` });

  // Suggestions: the first 3 that apply, in the spec's order; each names the newest run concerned.
  const newestFirst = [...judged].reverse();
  const find = (...kinds) => {
    for (const j of newestFirst) {
      const issue = j.verdict.issues.find(i => kinds.includes(i.kind));
      if (issue) return { date: j.date, issue };
    }
    return null;
  };
  const tips = [];
  if ((recovery?.rhr?.high ?? 0) >= 2) {
    tips.push(`Take tomorrow easy or rest: resting HR ${recovery.rhr.latest}, normal ${Math.round(recovery.rhr.normal)}.`);
  }
  const long = find("fastFinish", "partFast");
  if (long) {
    tips.push(long.issue.kind === "fastFinish"
      ? `Keep the long run easy to the end: ${formatDate(long.date)} got faster to ${formatPace(long.issue.pace)} /km.`
      : `Keep the faster part of the long run inside its range: ${formatDate(long.date)} reached ${formatPace(long.issue.pace)} /km.`);
  }
  const block = find("blockHr", "blockPace");
  if (block) {
    tips.push(block.issue.kind === "blockHr"
      ? `Keep threshold blocks under HR ${lt}: ${formatDate(block.date)} reached ${block.issue.hr}.`
      : `Keep threshold blocks inside ${block.issue.range}: ${formatDate(block.date)} ran ${formatPace(block.issue.pace)} /km.`);
  }
  const easyHr = find("easyHr");
  if (easyHr) {
    tips.push(`Slow easy runs to HR under ${ctx.easyLimit}: ${formatDate(easyHr.date)} reached ${easyHr.issue.hr}${easyHr.issue.km ? ` in km ${easyHr.issue.km}` : ""}.`);
  }
  const reps = find("reps");
  if (reps) {
    tips.push(`Run reps inside ${reps.issue.range}${reps.issue.fast ? ", not faster" : ""}: ${formatDate(reps.date)} averaged ${formatPace(reps.issue.pace)} /km.`);
  }
  if (easyShare != null && easyShare < 70) tips.push(`Make more of your running easy: ${easyShare}% this time, aim 70–80%.`);
  if (missed.length) {
    tips.push(`${missed.length} planned run${missed.length === 1 ? "" : "s"} missed: ${missed.map(m => formatDate(m.date)).join(", ")}.`);
  }
  if (perf.settings && lt && (!perf.settings.lthr || Math.abs(perf.settings.lthr - lt) >= 3)) {
    tips.push(`Set threshold HR to ${lt} in intervals.icu${perf.settings.lthr ? ` (now ${perf.settings.lthr})` : ""}.`);
  } else if (perf.settings && paceInfo.pace && out.settingsNote) {
    tips.push(`Set threshold pace to ${formatPace(paceInfo.pace)} /km in intervals.icu.`);
  }
  out.suggestions = tips.length ? tips.slice(0, 3) : ["Good 10 days: keep it this way."];
  return out;
}
```

- [ ] **Step 3: Check the logic with a throwaway command on synthetic data (not kept)**

This covers Review Focus 4 (today's run not done) and "no performance data".

```bash
node --input-type=module -e "
import { buildPerformance } from './site/src/performance.js';
const easy = { text: 'Easy', distance: 7000, pace: { start: 330, end: 370, units: 'secs/km' } };
const events = [
  { id: 1, date: '2026-10-24', category: 'WORKOUT', name: 'W01 Sat - Easy 7 km', sport: 'Run', distance: 7000, steps: [easy] },
  { id: 2, date: '2026-10-26', category: 'WORKOUT', name: 'W02 Mon - Easy 7 km', sport: 'Run', distance: 7000, steps: [easy] },
];
const activities = [{ id: 'a1', date: '2026-10-24', type: 'Run', name: 'x', distance: 7000, movingTime: 2520, avgHr: 160, pairedEventId: 1 }];
const lap = hr => ({ distance: 1000, movingTime: 360, avgHr: hr });
const performance = {
  paceNow: { cs: 3.8, bests: {} }, pacePlanStart: { cs: 3.8, bests: {} },
  hrNow: { h60: 180, h30: 182, h1: 185 }, hrPlanStart: { h60: 180, h30: 182, h1: 185 },
  wellness: [], settings: { lthr: 168, maxHr: 185, thresholdPace: null },
  laps: { a1: [lap(130), lap(140), lap(145), lap(150), lap(160), lap(165), lap(170)] }, denied: { wellness: false, settings: false },
};
console.log(JSON.stringify(buildPerformance({ events, activities, performance }, '2026-10-26'), null, 1));
console.log(JSON.stringify(buildPerformance({ events, activities }, '2026-10-26')));
"
```

Expected (check by eye):
- `hr.value` `"180 bpm"`, `pace.value` `"4:23 /km"`, `settingsNote` mentions threshold HR 168 and no threshold pace.
- `runs` has exactly one entry (Sat 24 Oct, status `"check"`, reason contains `HR 160–170 from km 5, limit 150`);
  Mon 26 Oct (today, not run) is **not** listed and not counted (`Done: 1 of 1 planned runs`).
- `suggestions[0]` starts `Slow easy runs to HR under 150: Sat 24 Oct reached 170 in km 5.`
- The second line printed is `{"from":"2026-10-17","to":"2026-10-26","loaded":false,…}` with empty arrays.

- [ ] **Step 4: Run the existing suite**

Run: `npm test`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add site/src/performance.js
git commit -m "feat(performance): run verdicts, 10-day review and suggestions"
```

---

### Task 3: Fetch and cache the data (`api.js`, login scopes, existing tests)

**Files:**
- Modify: `site/src/api.js` (imports at line 2; new reducers after `reduceActivity` at line 165; `refresh` at lines 184–201)
- Modify: `site/src/config.js:19-24` (`OAUTH`)
- Modify: `site/src/auth.js:70-74,102`
- Modify: `test/api.test.js:122-126,140`

**Interfaces:**
- Consumes: `windowFrom`, `curveWindow`, `MIN_RUN_M` (Task 1); `addDays` (`dates.js`); existing `request`,
  `KeyError`, `reduceEvent`, `reduceActivity`.
- Produces: `refresh()` returns and caches `{ fetchedAt, athleteName, events, activities, performance }` with
  `performance` in the shape listed in Task 2. New exports: `reducePaceCurve`, `reduceHrCurve`,
  `reduceWellness`, `reduceSettings`, `reduceLaps`. `OAUTH.requiredScope`.

- [ ] **Step 1: Imports in `site/src/api.js`**

Replace line 2:

```js
import { API_BASE, PLAN, STORAGE_KEYS } from "./config.js";
import { addDays } from "./dates.js";
import { MIN_RUN_M, curveWindow, windowFrom } from "./performance.js";
```

- [ ] **Step 2: Add the reducers after `reduceActivity`**

```js
const BEST_METRES = [1000, 3000, 5000, 10000, 21097.5];

// One pace-curve window: intervals.icu's critical speed and the best times at the race distances.
export function reducePaceCurve(c) {
  if (!c) return null;
  const model = (c.paceModels ?? []).find(m => m.type === "CS");
  const distances = c.distance ?? [];
  const bests = {};
  for (const target of BEST_METRES) {
    const i = distances.findIndex(d => Math.abs(d - target) <= 1);
    if (i >= 0 && c.values?.[i] > 0) bests[target] = { secs: c.values[i], activityId: String(c.activity_id?.[i] ?? "") };
  }
  return { cs: model?.criticalSpeed ?? null, bests };
}

// One HR-curve window: best HR held for 60 min, 30 min and 1 min.
export function reduceHrCurve(c) {
  if (!c) return null;
  const at = secs => {
    const i = (c.secs ?? []).indexOf(secs);
    return i >= 0 && c.values?.[i] > 0 ? c.values[i] : null;
  };
  return { h60: at(3600), h30: at(1800), h1: at(60) };
}

export function reduceWellness(rows) {
  return (Array.isArray(rows) ? rows : []).map(r => ({
    date: String(r.id ?? "").slice(0, 10),
    restingHR: r.restingHR ?? null,
    ctl: r.ctl ?? null,
    atl: r.atl ?? null,
  }));
}

export function reduceSettings(athlete) {
  const run = (athlete?.sportSettings ?? []).find(s => (s.types ?? []).includes("Run"));
  return run ? { lthr: run.lthr ?? null, maxHr: run.max_hr ?? null, thresholdPace: run.threshold_pace ?? null } : null;
}

export function reduceLaps(reply) {
  return (reply?.icu_intervals ?? []).map(l => ({
    distance: l.distance ?? 0,
    movingTime: l.moving_time ?? 0,
    avgHr: l.average_heartrate ?? null,
  }));
}
```

- [ ] **Step 3: Replace `refresh` (lines 184–201) with the soft requests and the laps cache**

```js
// Requests for the Performance card never break the calendar and never log anyone out (spec §3).
async function softRequest(path, auth, fetchImpl) {
  try {
    return { value: await request(path, auth, fetchImpl) };
  } catch (err) {
    return { failed: true, denied: err instanceof KeyError };
  }
}

async function loadPerformance({ extras, activities, prev, auth, fetchImpl, today, plan }) {
  const [pace, hr, wellness, athlete] = await extras;
  const idNow = curveWindow(today);
  const idStart = curveWindow(plan.firstDay);
  const curve = (res, id) => (res.value?.list ?? []).find(c => c.id === id) ?? null;
  const from = windowFrom(today);
  const runs = activities.filter(a => /run/i.test(a.type) && a.distance >= MIN_RUN_M && a.date >= from && a.date <= today);
  const oldLaps = prev?.laps ?? {};
  const laps = {};
  await Promise.all(runs.map(async a => {
    if (oldLaps[a.id]?.length) {
      laps[a.id] = oldLaps[a.id];
      return;
    }
    const res = await softRequest(`/activity/${encodeURIComponent(a.id)}/intervals`, auth, fetchImpl);
    const reduced = res.failed ? [] : reduceLaps(res.value);
    if (reduced.length) laps[a.id] = reduced; // none yet while intervals.icu is analysing: ask again next time
  }));
  return {
    paceNow: pace.failed ? prev?.paceNow ?? null : reducePaceCurve(curve(pace, idNow)),
    pacePlanStart: pace.failed ? prev?.pacePlanStart ?? null : reducePaceCurve(curve(pace, idStart)),
    hrNow: hr.failed ? prev?.hrNow ?? null : reduceHrCurve(curve(hr, idNow)),
    hrPlanStart: hr.failed ? prev?.hrPlanStart ?? null : reduceHrCurve(curve(hr, idStart)),
    wellness: wellness.denied ? [] : wellness.failed ? prev?.wellness ?? [] : reduceWellness(wellness.value),
    settings: athlete.denied ? null : athlete.failed ? prev?.settings ?? null : reduceSettings(athlete.value),
    denied: { wellness: Boolean(wellness.denied), settings: Boolean(athlete.denied) },
    laps,
    // Spec §6 "nothing saved yet": both curve requests failed and there are no earlier values to show.
    loadFailed: Boolean(pace.failed && hr.failed && !prev?.paceNow && !prev?.hrNow),
  };
}

export async function refresh({ store, today, fetchImpl = defaultFetch, plan = PLAN, now = new Date() }) {
  const auth = store.getAuth();
  if (!auth) throw new KeyError("No API key or login on this device", "missing");
  const from = windowFrom(today);
  const oldest = from < plan.calendarStart ? from : plan.calendarStart;
  const newest = today < plan.calendarStart ? plan.calendarStart : today;
  const curves = `${curveWindow(today)},${curveWindow(plan.firstDay)}`;
  // Started first so they run alongside the calendar requests; softRequest never rejects.
  const extras = Promise.all([
    softRequest(`/athlete/0/pace-curves?type=Run&curves=${curves}`, auth, fetchImpl),
    softRequest(`/athlete/0/hr-curves?type=Run&curves=${curves}`, auth, fetchImpl),
    softRequest(`/athlete/0/wellness?oldest=${addDays(today, -34)}&newest=${today}&fields=id,restingHR,ctl,atl`, auth, fetchImpl),
    softRequest("/athlete/0", auth, fetchImpl),
  ]);
  const [events, activities] = await Promise.all([
    request(`/athlete/0/events?oldest=${plan.calendarStart}&newest=${plan.raceDay}`, auth, fetchImpl),
    request(`/athlete/0/activities?oldest=${oldest}&newest=${newest}`, auth, fetchImpl),
  ]);
  const prev = store.getCache();
  const runs = (Array.isArray(activities) ? activities : []).map(reduceActivity);
  const data = {
    fetchedAt: now.toISOString(),
    athleteName: prev?.athleteName ?? "",
    events: (Array.isArray(events) ? events : []).map(reduceEvent),
    activities: runs,
    performance: await loadPerformance({ extras, activities: runs, prev: prev?.performance, auth, fetchImpl, today, plan }),
  };
  // Forget (or a new key or login) while this was loading: don't bring the old data back.
  if (store.getAuth()?.secret === auth.secret) store.setCache(data);
  return data;
}
```

- [ ] **Step 4: Requested vs required login scopes**

`site/src/config.js`, replace the `scope` line (line 23):

```js
  // Asked for at login. WELLNESS and SETTINGS feed the Performance card and may be declined.
  scope: "CALENDAR:READ,ACTIVITY:READ,WELLNESS:READ,SETTINGS:READ",
  // A login without these is refused.
  requiredScope: "CALENDAR:READ,ACTIVITY:READ",
```

`site/src/auth.js`, line 70 comment and line 102:

```js
// Every scope area the page requires must be granted, as READ or WRITE.
```

```js
  if (body.scope != null && missingScopes(body.scope, config.requiredScope ?? config.scope).length) {
```

(`test/auth.test.js` uses its own `CONFIG` without `requiredScope`, so its assertions keep passing unchanged.)

- [ ] **Step 5: Update the two existing assertions in `test/api.test.js` and run the suite**

Lines 123–126 become:

```js
  assert.deepEqual(f.calls.map(c => c.url).sort(), [
    `${BASE}/activity/i11/intervals`,
    `${BASE}/athlete/0`,
    `${BASE}/athlete/0/activities?oldest=2026-10-12&newest=2026-10-21`,
    `${BASE}/athlete/0/events?oldest=2026-10-19&newest=2027-01-10`,
    `${BASE}/athlete/0/hr-curves?type=Run&curves=r.2026-07-24.2026-10-21,r.2026-07-23.2026-10-20`,
    `${BASE}/athlete/0/pace-curves?type=Run&curves=r.2026-07-24.2026-10-21,r.2026-07-23.2026-10-20`,
    `${BASE}/athlete/0/wellness?oldest=2026-09-17&newest=2026-10-21&fields=id,restingHR,ctl,atl`,
  ]);
```

Line 140 becomes:

```js
  assert.ok(f.calls.some(c => c.url.endsWith("/athlete/0/activities?oldest=2026-09-22&newest=2026-10-19")));
```

Run: `npm test`
Expected: all pass. (In that test the new requests get a 404 from `fakeFetch`; `softRequest` turns them into
`failed`, so `performance` is all-empty and the cache still equals the returned data.)

- [ ] **Step 6: Throwaway check against real data (not kept, never commit, never print keys)**

Create `%TEMP%\perf-check.mjs` (outside the repo):

```js
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
const repo = "C:/Users/tvtrinh/Desktop/hahaha/training-calendar/site/src/";
const { createStore, refresh } = await import(pathToFileURL(repo + "api.js"));
const { buildPerformance } = await import(pathToFileURL(repo + "performance.js"));
const { localToday } = await import(pathToFileURL(repo + "dates.js"));
const key = process.argv[2] || readFileSync(`${process.env.USERPROFILE}/.intervals_key`, "utf8").replace(/^\uFEFF/, "").trim();
const store = createStore(null);
store.setAuth({ type: "key", secret: key });
const fetchImpl = (url, init) => fetch(url, { ...init, headers: { ...init.headers, "User-Agent": "tc-check" } });
const today = localToday();
const data = await refresh({ store, today, fetchImpl });
console.log(JSON.stringify(buildPerformance(data, today), null, 1));
const again = await refresh({ store, today, fetchImpl }); // second refresh: laps come from the cache
console.log("laps cached:", Object.keys(again.performance.laps).length);
```

Run with Truong's key: `node %TEMP%\perf-check.mjs`
Run with Baobao001's key (ask the user for it; pass it as the argument, don't save it): `node %TEMP%\perf-check.mjs <key>`

Expected for Truong on 2026-10-26 (spec §1): pace `4:23 /km`; HR `180 bpm`; goal line `Goal 4:10 for your race
pace 4:15 · 13 s to go`; settings note mentions threshold HR 168; runs: Thu 22 Oct `check` (HR from km 4),
Fri 23 Oct `check` (blocks above 180), Sat 24 Oct `ok`, Sun 25 Oct `check` (last 3 km … last km 4:13);
Hard sessions line `… 3 hard days, plan had 2`; Easy running about 42 % (under 70 %); Recovery `ok` (resting HR 65, normal
66 or 67, form about +1). For Baobao001: no exception; both tiles "Not enough hard running yet…"; no easy-share
line (Review Focus 2). Also confirm no run with empty laps appears in `again.performance.laps` (Review Focus 5).
If an expected value differs, fix the rule in `performance.js` before continuing. Delete the script afterwards.

- [ ] **Step 7: Commit**

```bash
git add site/src/api.js site/src/config.js site/src/auth.js test/api.test.js
git commit -m "feat(performance): fetch curves, wellness, settings and laps; optional login scopes"
```

---

### Task 4: Render the card (`app.js`, `styles.css`, `sw.js`)

**Files:**
- Modify: `site/src/app.js` (imports lines 2–9; `state` lines 25–37; `rebuild` lines 99–107; `render` line 115;
  new section before `// ---------- plan grid ----------` at line 408)
- Modify: `site/styles.css` (append a block before `@media (max-width: 719px)`; desktop rule lines 699–708)
- Modify: `site/sw.js:14` (FILES)

**Interfaces:**
- Consumes: `buildPerformance` (Task 2) and its output shape; existing `h`, `icon`, `formatShortRange`, `state`.
- Produces: the rendered card; `state.performance`, `state.perfRunsOpen`.

- [ ] **Step 1: Wire state and render in `site/src/app.js`**

After line 9 add:

```js
import { buildPerformance } from "./performance.js";
```

In `state` (after `openWeeks`):

```js
  performance: null, // Performance card data (buildPerformance)
  perfRunsOpen: false, // "Each run" list expanded
```

In `rebuild()`, after the `state.model = …` line:

```js
  state.performance = buildPerformance(state.data, state.today, PLAN);
```

In `render()`, line 115 becomes:

```js
    h("main", { id: "main", class: "layout" }, renderToday(), renderWeek(), renderPerformance(), renderPlan()),
```

- [ ] **Step 2: Add the card section before `// ---------- plan grid ----------`**

```js
// ---------- performance ----------
const PERF_STATUS = {
  ok: { icon: "✓", label: "On target" },
  check: { icon: "!", label: "Check" },
  neutral: { icon: "–", label: "No verdict" },
  skip: { icon: "·", label: "Not judged" },
};

function renderPerformance() {
  const p = state.performance;
  const section = h("section", { class: "card perf", "aria-labelledby": "perf-title" },
    h("div", { class: "section-head" }, h("h2", { id: "perf-title", text: "Performance" })));
  if (!p?.loaded) {
    section.append(h("p", { class: "muted", text: "Performance couldn't load yet. It updates with the next refresh." }));
    return section;
  }
  section.append(
    h("div", { class: "perf-tiles" }, perfTile(p.pace), perfTile(p.hr)),
    p.settingsNote ? h("p", { class: "perf-note", text: p.settingsNote }) : "",
    h("h3", { class: "perf-sub", text: `Last 10 days · ${formatShortRange(p.from, p.to)}` }),
    h("ul", { class: "perf-list" }, p.lines.map(l => perfItem(l.status, h("span", { text: l.text })))),
    h("h3", { class: "perf-sub", text: "Suggestions" }),
    h("ol", { class: "perf-suggest" }, p.suggestions.map(s => h("li", { text: s }))),
    perfRuns(p.runs));
  return section;
}

function perfTile(t) {
  return h("div", { class: "perf-tile" },
    h("p", { class: "perf-label", text: t.label }),
    h("p", { class: "perf-value", text: t.value ?? "–" }),
    t.lines.map(line => h("p", { class: `perf-meta k-${line.kind}`, text: line.text })));
}

// Status is never colour alone: a visible icon plus a spoken label.
function perfItem(status, ...content) {
  const s = PERF_STATUS[status] ?? PERF_STATUS.neutral;
  return h("li", { class: `perf-item s-${status}` },
    h("span", { class: "perf-icon", "aria-hidden": "true", text: s.icon }),
    h("span", {}, h("span", { class: "sr-only", text: `${s.label}: ` }), ...content));
}

function perfRuns(runs) {
  if (!runs.length) return "";
  const open = state.perfRunsOpen;
  return h("div", { class: "perf-runs" },
    h("h3", {},
      h("button", {
        type: "button",
        class: "perf-toggle",
        "aria-expanded": String(open),
        "aria-controls": "perf-runs",
        "data-key": "btn:perf-runs",
        onclick: e => togglePerfRuns(e.currentTarget),
      }, h("span", { text: `Each run (${runs.length})` }), h("span", { class: "pw-chevron", "aria-hidden": "true" }, icon("right")))),
    h("ul", { class: "perf-list", id: "perf-runs", hidden: !open },
      runs.map(r => perfItem(r.status, h("strong", { text: r.title }), r.reason ? h("span", { class: "muted", text: ` · ${r.reason}` }) : ""))));
}

function togglePerfRuns(btn) {
  state.perfRunsOpen = !state.perfRunsOpen;
  btn.setAttribute("aria-expanded", String(state.perfRunsOpen));
  document.getElementById("perf-runs").hidden = !state.perfRunsOpen;
}
```

- [ ] **Step 3: Styles and offline list**

In `site/styles.css`, add before `@media (max-width: 719px)`:

```css
/* ---------- performance ---------- */
.perf-tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px; }
.perf-tile { min-width: 0; padding: 14px 16px; border: 1px solid var(--border); border-radius: 14px; background: var(--surface-2); }
.perf-label { margin: 0; font-size: 0.85rem; font-weight: 600; color: var(--muted); }
.perf-value { margin: 4px 0 6px; font-size: 1.6rem; font-weight: 800; font-variant-numeric: tabular-nums; }
.perf-meta { margin: 2px 0 0; font-size: 0.85rem; color: var(--muted); }
.perf-meta.k-good { color: var(--ok); font-weight: 600; }
.perf-meta.k-note { color: var(--fg); font-weight: 600; }
.perf-note {
  margin: 12px 0 0;
  padding: 10px 12px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--warn) 12%, transparent);
  font-size: 0.9rem;
}
.perf-sub { margin: 18px 0 8px; font-size: 1rem; }
.perf-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 6px; }
.perf-list[hidden] { display: none; }
.perf-item { display: grid; grid-template-columns: 20px minmax(0, 1fr); gap: 8px; align-items: baseline; }
.perf-icon { font-weight: 800; text-align: center; color: var(--muted); }
.perf-item.s-ok .perf-icon { color: var(--ok); }
.perf-item.s-check .perf-icon { color: var(--danger); }
.perf-suggest { margin: 0; padding-left: 22px; display: grid; gap: 6px; }
.perf-runs h3 { margin: 12px 0 0; font-size: inherit; font-weight: inherit; }
.perf-toggle {
  width: 100%;
  min-height: 44px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 0;
  border: 0;
  background: transparent;
  color: var(--fg);
  font: inherit;
  font-weight: 700;
  text-align: left;
  cursor: pointer;
}
.perf-toggle[aria-expanded="true"] .pw-chevron .icon { transform: rotate(90deg); }
```

In the `@media (min-width: 1024px)` block, the `grid-template-areas` line becomes
`grid-template-areas: "today week" "today perf" "plan plan";` and add after `.week { grid-area: week; }`:

```css
  .perf { grid-area: perf; }
```

In `site/sw.js`, add `"src/performance.js",` after `"src/model.js",`.

- [ ] **Step 4: Live check (local, Truong's key; nothing committed with a key)**

Run `npm run serve` (on this PC: start `"C:\Program Files\nodejs\node.exe" tools/serve.js` from the repo root) and
open `http://localhost:8080/` in a browser profile used only for this check. Put the key into local storage from
the devtools console without echoing it: `localStorage.setItem("tc.v1.key", "<paste>")`, then reload.

Check:
1. The card shows the values from Task 3 Step 6; "Each run (n)" opens/closes with Enter and Space and its
   `aria-expanded` changes; focus order goes Today → This week → Performance → Plan.
2. 390 px and 1440 px widths, light and dark themes: no overflow, card under This week on 1440 px.
3. **Review Focus 1:** in the console run
   `const d = JSON.parse(localStorage["tc.v1.data"]); delete d.performance; localStorage["tc.v1.data"] = JSON.stringify(d);`
   then go offline in devtools and reload: calendar renders, card says "Performance couldn't load yet…". Go
   online and refresh: the card fills in.
4. **Review Focus 3:** in devtools block the URL pattern `*/athlete/0/wellness*` with a 403 response (Network →
   request blocking, or an override returning 403), refresh: the Recovery line reads "Recovery needs wellness
   access" and the page stays on the calendar (no setup screen). Remove the block.
5. Offline reload keeps the card (saved data).
6. Remove the key from that browser afterwards (Settings → Forget key on this device).

- [ ] **Step 5: Run the suite and commit**

Run: `npm test` — expected: all pass.

```bash
git add site/src/app.js site/styles.css site/sw.js
git commit -m "feat(performance): Performance card on the page"
```

---

### Task 5: Documentation

**Files:**
- Modify: `README.md:3-5,12-13,47-48,68` (intro, login note, privacy, file table)
- Modify: `docs/superpowers/specs/2026-10-21-training-calendar-design.md:50,66,73,189-190,203`

- [ ] **Step 1: README**

- Lines 3–5 become:

```markdown
A small web page for the HM sub-2:00 plan (20 Oct 2026 → race on Sun 10 Jan 2027). It shows today's
workout, this week, all 12 weeks with today highlighted, and your completed runs next to each planned
workout, plus a **Performance** card: your threshold pace and heart rate, a review of the last 10 days and
suggestions. Everything is read live from [intervals.icu](https://intervals.icu) in your browser.
```

- Lines 12–13: `(only read access to planned workouts and runs is asked for)` becomes
  `(only read access is asked for: planned workouts and runs, plus wellness and settings for the Performance
  card, which you may untick)`.
- Lines 47–48: `grants read access to planned workouts and runs only.` becomes
  `grants read access only: planned workouts, runs, wellness (resting HR, fitness) and sport settings.`
- After line 68 add the row:

```markdown
| `site/src/performance.js` | Pure logic: threshold estimates, 10-day review and suggestions for the Performance card |
```

- [ ] **Step 2: Main design spec**

- After line 50 add:
  `- Performance card: pace and HR curves, wellness, \`/athlete/0\` and laps per run; see
  \`2026-10-26-performance-card-design.md\`. The activities request starts 10 days back when that is earlier.`
- Line 66: `scope=CALENDAR:READ,ACTIVITY:READ` becomes `scope=CALENDAR:READ,ACTIVITY:READ,WELLNESS:READ,SETTINGS:READ`.
- Line 73 becomes: `Calendar and activities must be granted, as READ or WRITE; wellness and settings are optional (Performance card).`
- After the "This week" item (lines 189–190) insert:
  `3a. **Performance:** threshold pace and HR, last 10 days review, suggestions (spec 2026-10-26).`
- Line 203 becomes: `**Layout:** < 720 px one column; ≥ 1024 px two columns (Today left; This week and Performance right; Plan below);`

- [ ] **Step 3: Final suite and commit**

Run: `npm test` — expected: all pass.

```bash
git add README.md docs/superpowers/specs/2026-10-21-training-calendar-design.md
git commit -m "docs: Performance card and login permissions"
```

Do not push; the user decides when to push.

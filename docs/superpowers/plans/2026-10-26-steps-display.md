# Steps Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The Steps section of the day details shows each step's Expected and Actual lines with a pace or HR
bar and a difference line; repeats show a dot strip and open into a compact table.

**Architecture:** `site/src/steps.js` (pure) builds every display value — texts, bar positions in %, table
rows. `site/src/app.js` only turns those into DOM with `h()`, and `site/styles.css` draws the bars from
`--lo/--hi/--at` custom properties like the existing meters.

**Tech Stack:** Plain HTML/CSS/ES modules, no build step, no dependencies; `npm test` (node --test).

**Spec:** `docs/superpowers/specs/2026-10-26-steps-display-design.md` (display); matching and verdicts stay as in
`docs/superpowers/specs/2026-10-26-run-steps-design.md`.

## Global Constraints

- No framework, no build step, no runtime dependencies; render with `h()` / `textContent` only.
- **No new unit tests** (user decision); `npm test` must pass. Verify with throwaway scripts (deleted) and live
  browser checks.
- **Never print, log or commit an API key**; keys are read from `%USERPROFILE%\.intervals_key` at run time.
- Pace scale: planned range ± 30 s. HR scale: easy limit − 40 … + 20 bpm. Positions in % rounded to 0.1.
- Off-scale values: `at` 0 or 100 with `off: "low" | "high"`.
- Status colours: ✓ `--ok`, ! `--danger`, none `--muted`; band `--accent` at 45 %; track `--border`.
- Bars and legend `aria-hidden`; status never by colour alone.
- Unchanged: matching, verdict rules, saved laps, loading/error states, the plan part, "Your run", Today card.

## Review Focus

1. **A pace far off the scale** (GPS glitch: a 2:30/km or 9:00/km lap inside a step): the dot becomes an edge
   arrow and the text gives the exact seconds; nothing overflows the bar. → Task 1 Step 2 (cases B, C).
2. **No HR or no limits** (watch without HR; new athlete before the Performance card knows the threshold HR):
   no bar where its number is missing, no "HR ≤" part, no "undefined"/"null" text. → Task 1 Step 2 (cases D, E).
3. **A 320 px wide phone** with the 7-column blocks table: the table scrolls inside its box; the page itself
   never scrolls sideways. → Task 2 Step 4 (check 3).
4. **A refresh while a table is open** with focus on its button: the table stays open and focus stays on
   "Hide reps"/"Hide blocks". → Task 2 Step 4 (check 4).
5. **Windows high contrast** (forced colours): band, dot and limit tick stay visible. → Task 2 Step 4 (check 5).

---

## File Structure

| File | Responsibility |
|---|---|
| `site/src/steps.js` | Pure: matching (unchanged), verdicts (unchanged), and every display value |
| `site/src/app.js` | Steps section DOM: legend, rows, bars, strip, table, button labels |
| `site/styles.css` | Row layout, bar, table, forced colours |
| `README.md`, specs | Documentation |

---

### Task 1: Display values in `steps.js`

**Files:**
- Modify (rewrite): `site/src/steps.js`

**Interfaces:**
- Consumes: `formatClock`, `formatKm`, `formatPace` (`dates.js`); `flattenSteps`, `formatStepAmount`,
  `paceRange` (returns e.g. `"4:25–4:35"`, no unit), `stepName` (`workout.js`).
- Produces (used by Task 2), `matchSteps(workout, laps, limits)` →
  - `{ kind: "single" }` | `{ kind: "laps", lines: string[] }` |
    `{ kind: "steps", items, after: string | null, notDone: string[], unmatched: string[] }`
  - Step item `{ kind: "step", name, status: "ok"|"check"|null, reason, expected, actual, bar, diff }`
  - Repeat item `{ kind: "repeat", name, status, reason, expected, actual, bar, diff, label: "reps"|"blocks", table }`
  - `bar` = `null` | `{ kind: "pace"|"hr", lo, hi, at, off, status, dots }`; single bar: `at` number, `off`
    `"low"|"high"|null`, `status` = the item's status, `dots` `null`; strip: `at` `null`, `off` `null`,
    `status` `null`, `dots` `[{ at, off, status }]` (each rep's own status).
  - `diff` = `null` | `{ label: "Pace"|"HR", text }`
  - `table` = `{ columns: "single"|"multi", target: string|null, rows }`, row =
    `{ kind: "work"|"rest"|"block", n, step, dist, time, pace, vs, hr, status }` (strings; `n` number; `block`
    rows have only `n` filled).

- [ ] **Step 1: Replace `site/src/steps.js` with:**

```js
// Matches a run's watch laps to its planned steps and builds the day-details rows: expected vs actual,
// pace/HR bars and repeat tables. Pure.
// Spec: docs/superpowers/specs/2026-10-26-run-steps-design.md §4–§5 (matching, verdicts),
//       docs/superpowers/specs/2026-10-26-steps-display-design.md (display)
import { formatClock, formatKm, formatPace } from "./dates.js";
import { flattenSteps, formatStepAmount, paceRange, stepName } from "./workout.js";

// Timed steps are timed on the clock, so a standing rest counts in full. Laps saved before elapsedTime: moving.
const elapsedOf = l => l.elapsedTime ?? l.movingTime ?? 0;
// intervals.icu's tiny extra laps: short in distance and in time (a standing rest is short in distance only).
const MIN_LAP_M = 20;
const MIN_LAP_S = 10;
const isTiny = l => (l.distance || 0) < MIN_LAP_M && elapsedOf(l) < MIN_LAP_S;
const SHORT_SESSIONS = new Set(["intervals", "racepace"]);
const NONE = Object.freeze({ status: null, reason: "" });
// Bar scales (display spec §4): pace = planned range ± 30 s; HR = easy limit − 40 … + 20 bpm.
const PACE_SPAN_S = 30;
const HR_BELOW = 40;
const HR_ABOVE = 20;

const paceOf = (metres, seconds) => (metres > 0 && seconds > 0 ? seconds / (metres / 1000) : null);
const cueOf = step => String(step?.text ?? "").trim().toLowerCase();
const isEasyCue = cue => /^(warm-?up|easy|cool-?down)\b/.test(cue);
const isLimitCue = cue => /^(threshold|settle|tempo)\b/.test(cue); // checked against the threshold HR
const isPaceCue = cue => /^(rep|threshold|settle|tempo|steady|race pace)\b/.test(cue); // judged by pace

function rangeOf(step) {
  const p = step?.pace;
  if (!p || p.start == null || p.end == null || (p.units && p.units !== "secs/km")) return null;
  return [Math.min(p.start, p.end), Math.max(p.start, p.end)];
}

// A step whose pace is the point of the repeat (rep, block, race pace), as opposed to rests, walks, strides.
const isWork = step => Boolean(rangeOf(step)) && !isEasyCue(cueOf(step));

function paceSpan(paces) {
  const lo = formatPace(Math.min(...paces));
  const hi = formatPace(Math.max(...paces));
  return lo === hi ? lo : `${lo}–${hi}`;
}

// Distance, time, pace and time-weighted HR of some laps.
function totals(laps) {
  const distance = laps.reduce((s, l) => s + (l.distance || 0), 0);
  const time = laps.reduce((s, l) => s + (l.movingTime || 0), 0);
  const elapsed = laps.reduce((s, l) => s + elapsedOf(l), 0);
  const withHr = laps.filter(l => l.avgHr > 0 && l.movingTime > 0);
  const hrTime = withHr.reduce((s, l) => s + l.movingTime, 0);
  const hrs = withHr.map(l => Math.round(l.avgHr));
  return {
    distance,
    time,
    elapsed,
    pace: paceOf(distance, time),
    hr: hrTime ? Math.round(withHr.reduce((s, l) => s + l.avgHr * l.movingTime, 0) / hrTime) : null,
    hrLo: hrs.length ? Math.min(...hrs) : null,
    hrHi: hrs.length ? Math.max(...hrs) : null,
    laps: laps.length,
  };
}

// "HR 143", or "HR 143 (136–156)" when the step's laps differ.
function hrText(t) {
  if (t.hr == null) return "";
  return t.laps >= 2 && t.hrLo !== t.hrHi ? ` · HR ${t.hr} (${t.hrLo}–${t.hrHi})` : ` · HR ${t.hr}`;
}

const distText = metres => (metres < 1000 ? `${Math.round(metres)} m` : `${formatKm(metres, 2)} km`);

// The Actual line (display spec §3.3).
function actualText(t, timed) {
  if (timed) return `${formatClock(t.elapsed)} · ${Math.round(t.distance)} m${hrText(t)}`;
  const pace = t.pace ? ` · ${formatPace(t.pace)} /km` : "";
  return `${distText(t.distance)} · ${formatClock(t.time)}${pace}${hrText(t)}`;
}

// The Expected line (display spec §3.2): amount, pace range and the HR limit a check uses.
function expectedText(step, limits) {
  const cue = cueOf(step);
  const pace = paceRange(step.pace);
  const limit = isEasyCue(cue) ? limits?.easyLimit : isLimitCue(cue) ? limits?.lt : null;
  return [formatStepAmount(step), pace ? `${pace} /km` : "", limit ? `HR ≤ ${limit}` : ""].filter(Boolean).join(" · ");
}

function lapLines(laps, first = 1) {
  return laps.map((l, i) => `Lap ${first + i}: ${actualText(totals([l]), false)}`);
}

function within(t, range, slack) {
  if (!range || t.pace == null) return NONE;
  if (t.pace < range[0] - slack) return { status: "check", reason: "too fast" };
  if (t.pace > range[1] + slack) return { status: "check", reason: "too slow" };
  return { status: "ok", reason: "" };
}

// Run-steps spec §5. Checks needing HR or a limit are skipped when either is missing.
function stepVerdict(step, t, limits, workoutType) {
  const cue = cueOf(step);
  const range = rangeOf(step);
  if (isEasyCue(cue)) {
    if (t.hr == null || !limits?.easyLimit) return NONE;
    return t.hr <= limits.easyLimit + 3 ? { status: "ok", reason: "" } : { status: "check", reason: `HR above ${limits.easyLimit}` };
  }
  if (/^rep\b/.test(cue) || (/^race pace\b/.test(cue) && SHORT_SESSIONS.has(workoutType))) return within(t, range, 2);
  if (isLimitCue(cue)) {
    const reasons = [];
    if (range && t.pace != null && t.pace < range[0] - 5) reasons.push("too fast");
    if (limits?.lt && t.hr != null && t.hr > limits.lt + 2) reasons.push(`HR above ${limits.lt}`);
    if (reasons.length) return { status: "check", reason: reasons.join(", ") };
    if (range && t.pace != null && t.pace > range[1] + 5) return { status: null, reason: "slower than planned" };
    const checked = (range && t.pace != null) || (limits?.lt && t.hr != null);
    return checked ? { status: "ok", reason: "" } : NONE;
  }
  if (/^(steady|race pace)\b/.test(cue)) return within(t, range, 3);
  return NONE;
}

// ---------- bars and differences (display spec §3–§4) ----------
const pct = (v, min, max) => Math.round(((v - min) / (max - min)) * 1000) / 10;

function place(v, min, max) {
  if (v < min) return { at: 0, off: "low" };
  if (v > max) return { at: 100, off: "high" };
  return { at: pct(v, min, max), off: null };
}

const paceScale = range => [range[0] - PACE_SPAN_S, range[1] + PACE_SPAN_S];

function paceBar(range, pace, status) {
  const [min, max] = paceScale(range);
  return { kind: "pace", lo: pct(range[0], min, max), hi: pct(range[1], min, max), ...place(pace, min, max), status, dots: null };
}

function hrBar(limit, hr, status) {
  const min = limit - HR_BELOW;
  const max = limit + HR_ABOVE;
  return { kind: "hr", lo: 0, hi: pct(limit, min, max), ...place(hr, min, max), status, dots: null };
}

// One dot per rep on the work step's scale, each in its rep's own colour.
function stripBar(range, reps) {
  const [min, max] = paceScale(range);
  return {
    kind: "pace", lo: pct(range[0], min, max), hi: pct(range[1], min, max), at: null, off: null, status: null,
    dots: reps.map(r => ({ ...place(r.pace, min, max), status: r.status })),
  };
}

// Seconds outside the planned range, rounded: negative = faster, 0 = inside.
function gapOf(pace, range) {
  if (pace < range[0]) return Math.round(pace - range[0]);
  if (pace > range[1]) return Math.round(pace - range[1]);
  return 0;
}

// Table wording: "6 s fast" / "3 s slow" / "in range".
function vsText(pace, range) {
  const n = gapOf(pace, range);
  return n === 0 ? "in range" : `${Math.abs(n)} s ${n < 0 ? "fast" : "slow"}`;
}

// Difference-line wording: "too" only when the verdict says so; the threshold note says "slower than plan".
function paceDiffText(pace, range, verdict) {
  const n = gapOf(pace, range);
  if (n === 0) return "in range";
  const side = n < 0 ? "fast" : "slow";
  if (verdict.reason.includes(`too ${side}`)) return `${Math.abs(n)} s too ${side}`;
  if (verdict.reason === "slower than planned") return `${n} s slower than plan`;
  return `${Math.abs(n)} s ${side}`;
}

function hrDiffText(hr, limit) {
  const n = hr - limit;
  if (n === 0) return "at the limit";
  return n < 0 ? `${-n} below the limit` : `${n} above the limit`;
}

// Bar and difference line of one step (display spec §3.4–§3.5, §4).
function stepVisual(step, t, verdict, limits) {
  const cue = cueOf(step);
  const range = rangeOf(step);
  if (isEasyCue(cue)) {
    if (t.hr == null || !limits?.easyLimit) return { bar: null, diff: null };
    return { bar: hrBar(limits.easyLimit, t.hr, verdict.status), diff: { label: "HR", text: hrDiffText(t.hr, limits.easyLimit) } };
  }
  const hrFail = /HR above \d+/.exec(verdict.reason)?.[0] ?? "";
  if (isPaceCue(cue) && range && t.pace != null) {
    const text = [paceDiffText(t.pace, range, verdict), hrFail].filter(Boolean).join(" · ");
    return { bar: paceBar(range, t.pace, verdict.status), diff: { label: "Pace", text } };
  }
  return { bar: null, diff: hrFail ? { label: "HR", text: hrFail } : null };
}

// ---------- steps and repeats ----------
// Planned steps in order; a repeat becomes its steps × reps, remembering the group and rep number.
function expand(steps) {
  const out = [];
  (steps ?? []).forEach((s, group) => {
    if (s.reps && Array.isArray(s.steps)) {
      for (let rep = 1; rep <= s.reps; rep++) for (const inner of flattenSteps(s.steps)) out.push({ step: inner, group, rep });
    } else {
      out.push({ step: s, group: null, rep: null });
    }
  });
  return out;
}

// Laps for one step from position `from`, or null when they don't fit (run-steps spec §4.3).
function take(laps, from, step) {
  const timed = !(step.distance > 0);
  const target = timed ? step.duration || 0 : step.distance;
  if (!target) return null;
  const tol = timed ? 15 : Math.max(100, 0.1 * target);
  const over = timed ? 30 : Math.max(tol, 300);
  const size = l => (timed ? elapsedOf(l) : l.distance || 0);
  let i = from;
  let sum = 0;
  while (i < laps.length && sum < target - tol) sum += size(laps[i++]);
  if (sum < target - tol) return null; // laps ran out
  while (i < laps.length && Math.abs(sum + size(laps[i]) - target) < Math.abs(sum - target)) sum += size(laps[i++]);
  if (sum > target + over) return null; // one lap covers this step and more: laps don't follow the plan
  return { next: i, laps: laps.slice(from, i), timed };
}

// Name, Expected line, table target and the Actual word of a repeat (display spec §5).
function repeatHeader(groupStep) {
  const inner = flattenSteps(groupStep.steps ?? []);
  const work = inner.filter(isWork);
  if (work.length === 1) {
    const others = inner.filter(s => s !== work[0]).map(s => `${formatStepAmount(s)} ${stepName(s.text).toLowerCase()}`);
    const pace = paceRange(work[0].pace);
    return {
      name: `${groupStep.reps} × ${formatStepAmount(work[0])}`,
      expected: [pace ? `${pace} /km` : "", ...others].filter(Boolean).join(" · "),
      target: ["Expected " + [formatStepAmount(work[0]), pace ? `@${pace} /km` : ""].filter(Boolean).join(" "), ...others].join(" · "),
      word: /^rep\b/.test(cueOf(work[0])) ? "reps" : "blocks",
    };
  }
  const named = s => [stepName(s.text), formatStepAmount(s), paceRange(s.pace) ? `@${paceRange(s.pace)}` : ""].filter(Boolean).join(" ");
  return {
    name: `${groupStep.reps} × (${inner.map(formatStepAmount).join(" + ")})`,
    expected: inner.map(named).join(" + "),
    target: null,
    word: "blocks",
  };
}

function repeatSummary(rows, work, reps, word) {
  const rounds = `${new Set(rows.map(r => r.rep)).size} of ${reps} done`;
  if (!work.length) return { actual: rounds, status: null, reason: "" };
  const count = text => work.filter(r => r.verdict.reason.includes(text)).length;
  const parts = [];
  if (count("too fast")) parts.push(`${count("too fast")} too fast`);
  if (count("too slow")) parts.push(`${count("too slow")} too slow`);
  if (count("HR above")) parts.push(`${count("HR above")} with HR too high`);
  const anyCheck = work.some(r => r.verdict.status === "check");
  const anyOk = work.some(r => r.verdict.status === "ok");
  const paces = work.filter(r => r.t.pace != null).map(r => r.t.pace);
  return {
    actual: paces.length ? `${word} ${paceSpan(paces)}` : rounds,
    status: anyCheck ? "check" : anyOk ? "ok" : null,
    reason: parts.length ? parts.join(", ") : anyOk ? "all on target" : "",
  };
}

const blockRow = n => ({ kind: "block", n, step: "", dist: "", time: "", pace: "", vs: "", hr: "", status: null });

function repeatTable(rows, single, target) {
  const out = [];
  let lastRep = null;
  for (const r of rows) {
    if (!single && r.rep !== lastRep) out.push(blockRow(r.rep));
    lastRep = r.rep;
    const work = isWork(r.step);
    const range = rangeOf(r.step);
    out.push({
      kind: work ? "work" : "rest",
      n: r.rep,
      step: stepName(r.step.text),
      dist: distText(r.t.distance),
      time: formatClock(r.timed ? r.t.elapsed : r.t.time),
      pace: !r.timed && r.t.pace ? formatPace(r.t.pace) : "",
      vs: work && range && r.t.pace != null ? vsText(r.t.pace, range) : "",
      hr: r.t.hr == null ? "" : String(r.t.hr),
      status: work ? r.verdict.status : null,
    });
  }
  return { columns: single ? "single" : "multi", target: single ? target : null, rows: out };
}

function stepItem(r, limits) {
  return {
    kind: "step",
    name: stepName(r.step.text),
    status: r.verdict.status,
    reason: r.verdict.reason,
    expected: expectedText(r.step, limits),
    actual: actualText(r.t, r.timed),
    ...stepVisual(r.step, r.t, r.verdict, limits),
  };
}

function repeatItem(rows, groupStep) {
  const workSteps = flattenSteps(groupStep.steps ?? []).filter(isWork);
  const single = workSteps.length === 1;
  const head = repeatHeader(groupStep);
  const work = rows.filter(r => isWork(r.step));
  const summary = repeatSummary(rows, work, groupStep.reps, head.word);
  const range = single ? rangeOf(workSteps[0]) : null;
  const reps = work.filter(r => r.t.pace != null).map(r => ({ pace: r.t.pace, status: r.verdict.status }));
  return {
    kind: "repeat",
    name: head.name,
    status: summary.status,
    reason: summary.reason,
    expected: head.expected,
    actual: summary.actual,
    bar: range && reps.length ? stripBar(range, reps) : null,
    diff: summary.reason ? { label: "Pace", text: summary.reason } : null,
    label: workSteps.length > 1 ? "blocks" : "reps",
    table: repeatTable(rows, single, head.target),
  };
}

function buildItems(rows, steps, limits) {
  const items = [];
  for (let i = 0; i < rows.length;) {
    const r = rows[i];
    if (r.group == null) {
      items.push(stepItem(r, limits));
      i += 1;
      continue;
    }
    let j = i;
    while (j < rows.length && rows[j].group === r.group) j += 1;
    items.push(repeatItem(rows.slice(i, j), steps[r.group]));
    i = j;
  }
  return items;
}

// The rep a repeat is "Not done" from is its first work step without laps; a repeat with only rests left is
// done. A repeat without work steps (strides) is named from its first step without laps.
function notDoneNames(rest, steps) {
  const names = [];
  const named = new Set();
  const hasWork = g => flattenSteps(steps[g].steps ?? []).some(isWork);
  for (const p of rest) {
    if (p.group == null) names.push(stepName(p.step.text));
    else if (!named.has(p.group) && (isWork(p.step) || !hasWork(p.group))) {
      named.add(p.group);
      names.push(`${repeatHeader(steps[p.group]).name} (from rep ${p.rep})`);
    }
  }
  return names;
}

export function matchSteps(workout, rawLaps, limits = {}) {
  const laps = (rawLaps ?? []).filter(l => !isTiny(l));
  if (laps.length <= 1) return { kind: "single" };
  const plan = expand(workout?.steps);
  if (!plan.length) return { kind: "laps", lines: lapLines(laps) };
  const rows = [];
  let at = 0;
  let stopped = -1;
  for (let k = 0; k < plan.length; k++) {
    const m = take(laps, at, plan[k].step);
    if (!m) {
      stopped = k;
      break;
    }
    const t = totals(m.laps);
    rows.push({ ...plan[k], t, timed: m.timed, verdict: stepVerdict(plan[k].step, t, limits, workout?.type) });
    at = m.next;
  }
  const rest = laps.slice(at);
  const result = { kind: "steps", items: buildItems(rows, workout.steps, limits), after: null, notDone: [], unmatched: [] };
  if (stopped < 0) {
    if (rest.length) result.after = actualText(totals(rest), false);
  } else if (rest.length) {
    result.unmatched = lapLines(rest, at + 1);
  } else {
    result.notDone = notDoneNames(plan.slice(stopped), workout.steps);
  }
  return result;
}
```

(`stepVerdict` is no longer exported: nothing outside `steps.js` imports it — confirm with
`grep -rn "stepVerdict" site test` before the rewrite; only `site/src/steps.js` may match.)

- [ ] **Step 2: Throwaway synthetic check (not kept)**

Create `%TEMP%\steps-display-synth.mjs` (import `steps.js` by its `file://` URL) with these cases and print the
listed fields; `lap(d, t, hr, el = t)` = `{ distance: d, movingTime: t, avgHr: hr, elapsedTime: el }`,
`r(a, b)` = `{ start: a, end: b, units: "secs/km" }`:

| Case | Input | Expected |
|---|---|---|
| A | steps `[Warmup 1600 m r(330,350), Threshold 2000 m r(265,275)]`, laps `[lap(1600,520,140), lap(2000,504,176), lap(500,200,150)]`, limits `{lt:180, easyLimit:150}` | Warm-up `bar` `{kind:"hr", lo:0, hi:66.7, at:50, off:null, status:"ok"}`, diff `"10 below the limit"`, expected `"1.6 km · 5:30–5:50 /km · HR ≤ 150"`; Threshold bar `at` 24.3, `lo` 42.9, `hi` 57.1, diff `"13 s too fast"`, expected `"2 km · 4:25–4:35 /km · HR ≤ 180"` |
| B | A's steps, threshold lap `lap(2000,300,170)` (2:30/km) | Threshold `bar.at` 0, `off` `"low"`, diff `"115 s too fast"` |
| C | steps `[Threshold 2000 m r(265,275)]` + Easy 1000 m, laps `[lap(2000,1080,160), lap(1000,360,140)]` (9:00/km) | Threshold `bar.at` 100, `off` `"high"`, status `null`, diff `"265 s slower than plan"` |
| D | A with every `avgHr: null` | Warm-up `bar` `null`, `diff` `null`, actual has no "HR"; Threshold diff `"13 s too fast"` |
| E | A with limits `{}` | Warm-up expected `"1.6 km · 5:30–5:50 /km"` (no HR part), `bar` `null`; Threshold expected without "HR ≤" |
| F | steps `[{reps:3, steps:[Rep 400 m r(242,248), Rest 90 s]}, Cooldown 1000 m]`, laps `[lap(400,94,170), lap(100,90,140), lap(400,98,172), lap(100,90,141), lap(400,100,175), lap(100,90,142), lap(1000,400,140)]`, limits `{lt:180, easyLimit:150}` | repeat `label` `"reps"`, `actual` `"reps 3:55–4:10"`, diff `"1 too fast"`, `bar.dots` statuses `["check","ok","ok"]` (3:55 is 7 s fast; 4:05 in range; 4:10 is 2 s slow, inside ±2 s); `table.columns` `"single"`, 6 rows (work, rest × 3); first work row `{n:1, time:"1:34", pace:"3:55", vs:"7 s fast", hr:"170", status:"check"}`; third work row `vs` `"2 s slow"`, `status` `"ok"`; rest row `{kind:"rest", step:"Rest", dist:"100 m", time:"1:30"}`; `table.target` `"Expected 400 m @4:02–4:08 /km · 90 s rest"` |
| G | F stopped after rep 2's rest (drop the last 3 laps) | `table.rows` 4; `notDone` `["3 × 400 m (from rep 3)", "Cooldown"]` |
| H | steps `[{reps:2, steps:[Stride 80 m, Walk 45 s]}]` + Easy 1000 m r(330,370), laps `[lap(85,19,150), lap(70,3,152,46), lap(71,13,150), lap(60,3,150,46), lap(1000,360,140)]` | repeat `bar` `null`, `diff` `null`, `actual` `"2 of 2 done"`, `label` `"reps"`, `table.columns` `"multi"`, rows `block,rest,rest,block,rest,rest`; walk row `time` `"0:46"`, `pace` `""` |
| I | steps `[{reps:1, steps:[Settle 1000 m r(270,280), Threshold 2000 m r(265,275), Rest 180 s]}]`, laps `[lap(1000,258,170), lap(2000,504,183), lap(214,30,150,189)]`, limits `{lt:180}` | `label` `"blocks"`, `bar` `null`, `table.columns` `"multi"`, rows `block,work,work,rest`; Threshold row `vs` `"13 s fast"`, `status` `"check"`; repeat diff text `"2 too fast, 1 with HR too high"` |

Run it with `"C:\Program Files\nodejs\node.exe"`. Expected: every value as in the table. If a value differs,
decide against the spec whether the code or the table is wrong; fix the code, or ledger the corrected
expectation as a ruling. Delete the script.

- [ ] **Step 3: Throwaway real-data check (not kept, never print the key)**

Create `%TEMP%\steps-display-real.mjs`: load Truong's data with `createStore(null)`, `store.setAuth({type:"key",
secret})` (key from `%USERPROFILE%\.intervals_key`, BOM stripped), `refresh({store, today: localToday()})`,
`buildModel`, `buildPerformance(...).limits`; for 2026-10-21/23/24/25 call `matchSteps(workout, data.performance.laps[run.id], limits)`.
Expected (display spec §1 and §8):
- 21 Oct: Warm-up `expected` `"1.6 km · 5:30–5:50 /km · HR ≤ 150"`, `actual` `"1.61 km · 8:40 · 5:24 /km · HR 143 (136–156)"`,
  `bar` hr `at` 55 `hi` 66.7, diff `"7 below the limit"`; repeat `"10 × 400 m"`, `expected` `"4:02–4:08 /km · 90 s rest"`,
  `actual` `"reps 3:25–3:56"`, diff `"10 too fast"`, `bar.dots` 10 with `dots[9].off` `"low"`, table single, 20 rows,
  first work row `{n:1, time:"1:35", pace:"3:56", vs:"6 s fast", hr:"179", status:"check"}`.
- 23 Oct: repeat `label` `"blocks"`, `actual` `"blocks 4:10–4:18"`, diff `"4 too fast"`, table multi with 8 rows
  (block, Settle in, Threshold, Rest × 2); first Threshold row `{dist:"2 km", time:"8:24", pace:"4:12", vs:"13 s fast", hr:"182", status:"check"}`.
- 24 Oct: Easy diff `"6 below the limit"`, `bar.at` 56.7; strides repeat `bar` `null`, `actual` `"4 of 4 done"`,
  `label` `"reps"`, table multi 12 rows.
- 25 Oct: Easy status `"check"`, diff `"9 above the limit"`, `bar.at` 81.7.

Delete the script afterwards.

- [ ] **Step 4: Suite and commit**

Run: `npm test` — expected: 53/53 pass. (The page still imports the old row fields until Task 2; do not open
it between the commits.)

```bash
git add site/src/steps.js
git commit -m "feat(steps): expected vs actual, pace/HR bars and repeat tables in matchSteps"
```

---

### Task 2: Draw the new rows (`app.js`, `styles.css`)

**Files:**
- Modify: `site/src/app.js` — `stepsContent`, `stepRow`, `toggleReps`; new `stepsLegend`, `kv`, `stepBar`,
  `repeatRow`, `repsTable`
- Modify: `site/styles.css` — run steps block, forced-colours list

**Interfaces:**
- Consumes: Task 1's item, bar, diff and table shapes; existing `PERF_STATUS` (incl. `none`), `perfItem`,
  `state.openReps`, `byKeyIn`, `stepsNote`, `fillSteps`.

- [ ] **Step 1: `app.js` — replace `stepsContent`, `stepRow` and `toggleReps` with:**

```js
function stepsContent(res, run, workout, body, title) {
  if (res.error) {
    return [stepsNote("Couldn't load the laps."),
      h("button", {
        type: "button", class: "btn ghost small", "data-key": `steps:${run.id}:retry`,
        onclick: () => fillSteps(body, title, run, workout),
      }, "Try again")];
  }
  if (res.notReady) return [stepsNote("Laps aren't ready yet in intervals.icu.")];
  const m = matchSteps(workout, res.laps, state.performance?.limits ?? {}); // no workout (extra run): plain laps
  if (m.kind === "single") return [stepsNote("No laps from your watch.")];
  const lines = items => h("ul", { class: "perf-list steps-list" }, items.map(t => perfItem("none", h("span", { text: t }))));
  if (m.kind === "laps") return [lines(m.lines)];
  const list = h("ul", { class: "step-list" },
    m.items.map((it, i) => (it.kind === "repeat" ? repeatRow(it, run, i) : stepRow(it))),
    m.after ? stepRow({ name: "After the workout", status: null, expected: "", actual: m.after, bar: null, diff: null }) : "");
  const out = [m.items.some(it => it.bar) ? stepsLegend() : "", list];
  if (m.notDone.length) out.push(stepsNote(`Not done: ${m.notDone.join(", ")}`));
  if (m.unmatched.length) out.push(stepsNote("Steps after this didn't match your laps:"), lines(m.unmatched));
  return out;
}

// One step: name with status, Expected and Actual lines, bar, difference line (display spec §3).
function stepRow(it, ...extra) {
  const key = it.status ?? "none";
  const s = PERF_STATUS[key];
  return h("li", { class: `step-row s-${key}` },
    h("span", { class: "perf-icon", "aria-hidden": "true", text: s.icon }),
    h("div", { class: "step-body" },
      h("p", { class: "step-name" }, s.label ? h("span", { class: "sr-only", text: `${s.label}: ` }) : "", h("strong", { text: it.name })),
      it.expected ? kv("Expected", it.expected) : "",
      kv("Actual", it.actual),
      it.bar ? stepBar(it.bar) : "",
      it.diff ? h("p", { class: "step-diff" }, h("span", { text: it.diff.label }), h("span", { class: "step-diff-text", text: it.diff.text })) : "",
      ...extra));
}

const kv = (label, value) => h("p", { class: "step-kv" }, h("span", { class: "step-k", text: label }), h("span", { text: value }));

const stepsLegend = () => h("p", { class: "steps-legend", "aria-hidden": "true" },
  h("span", { class: "legend-dot" }), "you", h("span", { class: "legend-band" }), "plan · left = faster / lower");

// Band = plan, dot = you; positions in % from steps.js. Hidden from screen readers: the text says the same.
function stepBar(bar) {
  const mark = (p, status) => h("span", {
    class: `bar-dot s-${status ?? "none"}${p.off ? ` off-${p.off}` : ""}`,
    style: { "--at": `${p.at}%` },
  });
  return h("div", {
    class: `step-bar${bar.dots ? " strip" : ""}`,
    "aria-hidden": "true",
    style: { "--lo": `${bar.lo}%`, "--hi": `${bar.hi}%` },
  },
  h("span", { class: "bar-band" }),
  bar.kind === "hr" ? h("span", { class: "bar-limit" }) : "",
  bar.dots ? bar.dots.map(d => mark(d, d.status)) : mark(bar, bar.status));
}

function repeatRow(it, run, i) {
  const id = `reps-${run.id}-${i}`;
  const open = state.openReps.has(id);
  return stepRow(it,
    h("button", {
      type: "button", class: "btn ghost small", "aria-expanded": String(open), "aria-controls": id,
      "data-key": `steps:${run.id}:reps:${i}`, "data-noun": it.label, onclick: e => toggleReps(e.currentTarget, id),
    }, `${open ? "Hide" : "Show"} ${it.label}`),
    h("div", { class: "reps-wrap", id, hidden: !open }, repsTable(it)));
}

// Compact table of a repeat (display spec §5): one work step → # Time Pace vs-plan HR, rests as thin rows;
// otherwise Step Dist Time Pace vs-plan HR with a "Block n" row per round.
function repsTable(it) {
  const t = it.table;
  const single = t.columns === "single";
  const heads = single ? ["#", "Time", "Pace", "vs plan", "HR"] : ["Step", "Dist", "Time", "Pace", "vs plan", "HR"];
  const span = heads.length + 1;
  const statusCell = status => {
    const s = PERF_STATUS[status ?? "none"];
    return h("td", { class: "rt-status" }, h("span", { "aria-hidden": "true", text: s.icon }), s.label ? h("span", { class: "sr-only", text: s.label }) : "");
  };
  const rows = t.rows.map(r => {
    if (r.kind === "block") return h("tr", { class: "rt-block" }, h("th", { scope: "colgroup", colspan: span, text: `Block ${r.n}` }));
    if (single && r.kind === "rest") {
      return h("tr", { class: "rt-rest" }, h("td", { colspan: span, text: `${r.step.toLowerCase()} ${r.time} · ${r.dist}${r.hr ? ` · HR ${r.hr}` : ""}` }));
    }
    const cells = single ? [String(r.n), r.time, r.pace, r.vs, r.hr] : [r.step, r.dist, r.time, r.pace, r.vs, r.hr];
    const vsAt = cells.length - 2;
    return h("tr", { class: `${r.kind === "rest" ? "rt-rest " : ""}s-${r.status ?? "none"}` },
      cells.map((c, k) => h("td", { class: k === vsAt ? "rt-vs" : null, text: c })),
      statusCell(r.status));
  });
  return [
    t.target ? h("p", { class: "step-kv muted small", text: t.target }) : "",
    h("div", { class: "reps-scroll" },
      h("table", { class: "reps-table" },
        h("caption", { class: "sr-only", text: `${it.label === "blocks" ? "Blocks" : "Reps"} of ${it.name}` }),
        h("thead", {}, h("tr", {},
          heads.map(x => h("th", { scope: "col", text: x })),
          h("th", { scope: "col" }, h("span", { class: "sr-only", text: "Status" })))),
        h("tbody", {}, rows))),
  ];
}

function toggleReps(btn, id) {
  const open = !state.openReps.has(id);
  if (open) state.openReps.add(id);
  else state.openReps.delete(id);
  btn.setAttribute("aria-expanded", String(open));
  btn.textContent = `${open ? "Hide" : "Show"} ${btn.dataset.noun}`;
  document.getElementById(id).hidden = !open;
}
```

Also update the comment above `byKeyIn` ("open \"Show reps\" lists") to "open repeat tables".

- [ ] **Step 2: `styles.css` — replace the `/* ---------- run steps (day details) ---------- */` block with:**

```css
/* ---------- run steps (day details) ---------- */
.steps-result { margin-top: 14px; }
.steps-title { margin: 0 0 8px; font-size: 0.95rem; }
.steps-legend { display: flex; align-items: center; gap: 6px; margin: 0 0 4px; font-size: 0.8rem; color: var(--muted); }
.legend-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--fg); }
.legend-band { width: 18px; height: 7px; margin-left: 6px; border-radius: 4px; background: color-mix(in srgb, var(--accent) 45%, transparent); }
.step-list { list-style: none; margin: 0; padding: 0; }
.step-row { display: grid; grid-template-columns: 20px minmax(0, 1fr); gap: 8px; padding: 10px 0; border-top: 1px solid var(--border); }
.step-row:first-child { border-top: 0; }
.step-row.s-ok > .perf-icon { color: var(--ok); }
.step-row.s-check > .perf-icon { color: var(--danger); }
.step-body > p { margin: 0; }
.step-name { margin-bottom: 2px !important; }
.step-kv { display: grid; grid-template-columns: 64px minmax(0, 1fr); gap: 6px; font-size: 0.9rem; font-variant-numeric: tabular-nums; }
.step-k { color: var(--muted); font-size: 0.8rem; line-height: 1.6; }
.step-bar { position: relative; height: 12px; margin: 8px 6px 2px; forced-color-adjust: none; }
.step-bar::before { content: ""; position: absolute; inset: 2px 0 auto; height: 8px; border-radius: 4px; background: var(--border); }
.bar-band { position: absolute; top: 2px; height: 8px; left: var(--lo); width: calc(var(--hi) - var(--lo)); border-radius: 4px; background: color-mix(in srgb, var(--accent) 45%, transparent); }
.bar-limit { position: absolute; top: -2px; left: calc(var(--hi) - 1px); width: 2px; height: 16px; background: var(--accent); }
.bar-dot { position: absolute; top: 0; left: var(--at); width: 12px; height: 12px; margin-left: -6px; border-radius: 50%; background: var(--muted); }
.bar-dot.s-ok { background: var(--ok); }
.bar-dot.s-check { background: var(--danger); }
.strip .bar-dot { top: 1.5px; width: 9px; height: 9px; margin-left: -4.5px; opacity: 0.8; }
.bar-dot.off-low, .bar-dot.off-high { width: 10px; height: 12px; top: 0; border-radius: 0; opacity: 1; }
.bar-dot.off-low { margin-left: -10px; clip-path: polygon(0 50%, 100% 0, 100% 100%); }
.bar-dot.off-high { margin-left: 0; clip-path: polygon(0 0, 100% 50%, 0 100%); }
.step-diff { display: flex; justify-content: space-between; gap: 8px; font-size: 0.8rem; color: var(--muted); }
.step-row.s-ok .step-diff-text { color: var(--ok); }
.step-row.s-check .step-diff-text { color: var(--danger); font-weight: 700; }
.step-body .btn.small { margin-top: 8px; }
.reps-wrap { margin-top: 8px; }
.reps-wrap[hidden] { display: none; }
.reps-scroll { overflow-x: auto; }
.reps-table { width: 100%; border-collapse: collapse; font-size: 0.85rem; font-variant-numeric: tabular-nums; }
.reps-table th { padding: 4px 8px 4px 0; border-bottom: 1px solid var(--border); text-align: left; font-size: 0.75rem; font-weight: 700; color: var(--muted); }
.reps-table td { padding: 4px 8px 4px 0; white-space: nowrap; }
.reps-table .rt-rest td { padding-top: 0; font-size: 0.8rem; color: var(--muted); }
.reps-table .rt-block th { padding-top: 8px; border-bottom: 0; }
.reps-table tr.s-check .rt-vs, .reps-table tr.s-check .rt-status { color: var(--danger); font-weight: 700; }
.reps-table tr.s-ok .rt-status { color: var(--ok); font-weight: 700; }
.steps-result .btn.small { margin-top: 6px; }
```

In the `@media (forced-colors: active)` block, add `.legend-dot, .legend-band` to the
`forced-color-adjust: none` selector list (`.step-bar` sets it itself).

- [ ] **Step 3: Static checks**

Run: `npm test` — expected: 53/53 pass. `grep -n "step-done\|steps-reps\|planned\b\|\.done\b" site/src/app.js site/styles.css`
— expected: no hits from the Steps code (`renderSteps` plan code may use unrelated names; check each hit).

- [ ] **Step 4: Live check (Review Focus 3–5)**

Serve `site/` (`"C:\Program Files\nodejs\node.exe" tools/serve.js`), open `http://localhost:8080` in a test
browser, put Truong's key in `localStorage["tc.v1.key"]` without printing it, reload:
1. Phone 390 px: Wed 21, Fri 23, Sat 24, Sun 25 Oct show the rows of Task 1 Step 3: Expected/Actual lines,
   bars (HR dot inside band on Wed 21 warm-up; red strip with an edge arrow for rep 10), difference lines,
   legend once. Screenshot each.
2. Show reps / Show blocks: Enter and Space toggle, label and `aria-expanded` follow; the accessibility tree
   of the table lists the column headers and the caption.
3. 320 px wide: open Fri 23's blocks table; `document.documentElement.scrollWidth <= innerWidth` (page does
   not scroll sideways) and the table box scrolls.
4. Focus "Hide reps" on Wed 21, trigger a refresh (`document.querySelector('[data-key="btn:refresh"]').click()`),
   wait for it: table still open, focus still on the button (a new node with the same `data-key`).
5. PC 1440 px light and dark; `emulate({ forcedColors: "active" })` (or `--force-high-contrast`): bands, dots
   and the limit tick visible. Screenshot.
6. No console errors. Clear storage, close the tab, stop the server.

- [ ] **Step 5: Commit**

```bash
git add site/src/app.js site/styles.css
git commit -m "feat(steps): expected vs actual rows with pace/HR bars and repeat tables"
```

---

### Task 3: Documentation

**Files:**
- Modify: `README.md` (the "Tap a day to see its details" paragraph)
- Modify: `docs/superpowers/specs/2026-10-26-run-steps-design.md` (§2 Display)
- Modify: `docs/superpowers/specs/2026-10-26-steps-display-design.md` (§4.3 dot colours, §6 bar shape)

- [ ] **Step 1: README** — the paragraph becomes:

```markdown
Tap a day to see its details. For a day with a run, **Steps** shows each planned step with what was
expected and what you ran (pace, time, HR), a bar that places your pace (or HR on easy steps) against the
plan, and ✓ or !. Repeats show one dot per rep and open into a table. The laps are loaded the first time you
open the day and then saved in your browser.
```

- [ ] **Step 2: run-steps spec** — at the top of §2 add the line
`(Display superseded by 2026-10-26-steps-display-design.md: Expected/Actual lines, bars, repeat tables.)`

- [ ] **Step 3: display spec** — §4.3: replace "Dots are slightly transparent so reps at the same pace stack
darker." with "Each dot has its rep's own colour (✓ / ! / none); dots are slightly transparent so reps at the
same pace stack darker." §6 `bar`: add `status` (single bar: the item's status; strip: `null`, each dot has
its own `status`).

- [ ] **Step 4: Suite and commit**

Run: `npm test` — expected: 53/53 pass.

```bash
git add README.md docs/superpowers/specs/2026-10-26-run-steps-design.md docs/superpowers/specs/2026-10-26-steps-display-design.md
git commit -m "docs: steps display"
```

Do not push; the user decides when to push.

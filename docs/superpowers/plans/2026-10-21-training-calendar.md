# Training Calendar Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A static web page, published with GitHub Pages, that shows the HM sub-1:30 plan with today highlighted, this week, all 15 weeks and your completed runs, read live from intervals.icu in the browser.

**Architecture:** Plain HTML/CSS/ES modules in `site/`, no build step. Pure modules (`dates.js`, `workout.js`, `model.js`, `api.js`) hold all logic and are unit-tested with Node's built-in runner; `app.js` is the only DOM module and is verified with a live browser check. The API key lives only in the visitor's `localStorage`; the page sends read-only `GET`s to intervals.icu.

**Tech Stack:** HTML, CSS (custom properties, `color-mix`, `:has`), JavaScript ES modules, Service Worker, Web App Manifest, Node 24 `node --test`, GitHub Actions Pages deploy.

**Spec:** `docs/superpowers/specs/2026-10-21-training-calendar-design.md`

## Global Constraints

- Repo root: `C:\Users\tvtrinh\Desktop\hahaha\training-calendar`; run every command from it.
- Commit locally after each task; **never push** (the user pushes).
- No runtime or dev dependencies; no `npm install`. Node 24 is installed.
- No API key, plan data or activity data in any committed file. Test fixtures are synthetic.
- The page only sends `GET` to `https://intervals.icu/api/v1/athlete/0/...`; auth is HTTP Basic `API_KEY:<key>`.
- CSP: `default-src 'self'; connect-src https://intervals.icu; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'`. So: no inline `<script>`, no `style="…"` attributes in HTML or via `setAttribute("style")`; dynamic styles only through `element.style.setProperty`.
- API strings are rendered with `textContent` / text nodes only, never as HTML.
- Plan constants: calendar starts Mon `2026-10-19`, first plan day `2026-10-20`, race `2027-01-31`, 15 weeks, 104 plan days.
- Storage keys: `tc.v1.key`, `tc.v1.data`, `tc.v1.theme`, `tc.v1.shortcut`.
- UI copy is English; dates `Wed 21 Oct`; paces `m:ss /km`; distances in km.
- Code blocks below that start with `~~~<lang> title=<path>` are complete file contents for `<path>`.

## Review Focus

1. **Page left open across midnight, or device near midnight** → "today" follows the device's local date and the highlight moves without a reload (pinned in Task 1 `local today uses the device clock around midnight`; the roll-over in `tick()`/`onVisibility()` is checked in Task 6 Step 7).
2. **Your own intervals.icu entries on plan dates** (other categories, two workouts on a day, a workout without steps) → shown or ignored without breaking the day (pinned in Task 3 `events outside the plan or of other categories are ignored`, `a day with two workouts and one run is partly done`, Task 2 `workout bar without durations…`).
3. **`localStorage` blocked or full** (private mode, quota) → the page still connects and shows data for the session (pinned in Task 4 `store survives blocked storage and corrupt data`).
4. **Key pasted with spaces, a newline, or as random text** → trimmed; obvious non-keys rejected without a network call (pinned in Task 4 `connect trims the key…`, `connect rejects a malformed or refused key…`).
5. **Runs with no distance, time or heart rate** (manual entries, treadmill) → blanks, never `NaN` (pinned in Task 3 `run summary, including runs with missing numbers`).

---

### Task 1: Project scaffold and date module

**Files:**
- Create: `package.json`, `.gitignore`, `site/src/config.js`, `site/src/dates.js`
- Test: `test/dates.test.js`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `config.js`: `PLAN {title, calendarStart, firstDay, raceDay, weeks, phases[15]}`, `API_BASE`, `STORAGE_KEYS {key, data, theme, shortcut}`
  - `dates.js`: `WEEKDAYS`, `addDays(iso, n) → iso`, `diffDays(from, to) → int`, `weekdayIndex(iso) → 0..6 (Mon=0)`, `mondayOf(iso)`, `localToday(now?) → iso`, `weekNumber(iso, plan?)`, `clampWeek(week, plan?)`, `dayNumber(iso, plan?)`, `totalDays(plan?)`, `daysToRace(iso, plan?)`, `formatDate(iso) → "Wed 21 Oct"`, `formatKm(metres, digits=1) → "5.6"`, `formatPace(secPerKm) → "4:05"`, `formatDuration(sec) → "40 min"`, `formatClock(sec) → "40:12"`, `timeAgo(isoTimestamp, now?)`

- [ ] **Step 1: Create the scaffold files**

~~~json title=package.json
{
  "name": "training-calendar",
  "private": true,
  "type": "module",
  "description": "HM sub-1:30 training calendar, live from intervals.icu",
  "scripts": {
    "test": "node --test \"test/*.test.js\"",
    "serve": "node tools/serve.js"
  },
  "engines": {
    "node": ">=20"
  }
}
~~~

~~~gitignore title=.gitignore
node_modules/
.superpowers/
.DS_Store
Thumbs.db
~~~

~~~js title=site/src/config.js
// Plan constants. Everything else comes from intervals.icu at runtime.
export const PLAN = Object.freeze({
  title: "HM sub-1:30",
  calendarStart: "2026-10-19", // Monday of week 1
  firstDay: "2026-10-20", // first day with a plan entry
  raceDay: "2027-01-31",
  weeks: 15,
  phases: Object.freeze([
    "Start", "Adapt", "Adapt", "Adapt", "Light", "Build", "Build", "Build",
    "Peak", "Light", "Race-specific", "Key week", "Race-specific", "Taper", "Race",
  ]),
});

export const API_BASE = "https://intervals.icu/api/v1";

export const STORAGE_KEYS = Object.freeze({
  key: "tc.v1.key",
  data: "tc.v1.data",
  theme: "tc.v1.theme",
  shortcut: "tc.v1.shortcut",
});
~~~

- [ ] **Step 2: Write the failing tests**

~~~js title=test/dates.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays, clampWeek, dayNumber, daysToRace, diffDays, formatClock, formatDate, formatDuration, formatKm, formatPace,
  localToday, mondayOf, timeAgo, totalDays, weekNumber, weekdayIndex,
} from "../site/src/dates.js";

test("addDays and diffDays cross months and years", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-10-19", 104), "2027-01-31");
  assert.equal(diffDays("2026-10-20", "2027-01-31"), 103);
  assert.equal(diffDays("2026-10-21", "2026-10-20"), -1);
});

test("weekday and Monday of a date", () => {
  assert.equal(weekdayIndex("2026-10-19"), 0);
  assert.equal(weekdayIndex("2026-10-25"), 6);
  assert.equal(mondayOf("2026-10-21"), "2026-10-19");
  assert.equal(mondayOf("2027-01-31"), "2027-01-25");
});

test("plan week, day and countdown numbers", () => {
  assert.equal(weekNumber("2026-10-19"), 1);
  assert.equal(weekNumber("2026-10-25"), 1);
  assert.equal(weekNumber("2026-10-26"), 2);
  assert.equal(weekNumber("2027-01-31"), 15);
  assert.equal(weekNumber("2026-10-01"), -2);
  assert.equal(clampWeek(-2), 1);
  assert.equal(clampWeek(20), 15);
  assert.equal(dayNumber("2026-10-21"), 2);
  assert.equal(totalDays(), 104);
  assert.equal(daysToRace("2026-10-21"), 102);
});

test("local today uses the device clock around midnight", () => {
  assert.equal(localToday(new Date(2026, 9, 21, 23, 59)), "2026-10-21");
  assert.equal(localToday(new Date(2026, 9, 22, 0, 1)), "2026-10-22");
});

test("formats dates, distances, paces and times", () => {
  assert.equal(formatDate("2026-10-21"), "Wed 21 Oct");
  assert.equal(formatDate("2027-01-31"), "Sun 31 Jan");
  assert.equal(formatKm(5600), "5.6");
  assert.equal(formatKm(12000), "12");
  assert.equal(formatKm(5620, 2), "5.62");
  assert.equal(formatPace(245), "4:05");
  assert.equal(formatPace(299.6), "5:00");
  assert.equal(formatDuration(2424), "40 min");
  assert.equal(formatDuration(5400), "1 h 30 min");
  assert.equal(formatClock(2412), "40:12");
  assert.equal(formatClock(5731), "1:35:31");
});

test("timeAgo describes when data was fetched", () => {
  const now = new Date(2026, 9, 21, 10, 0);
  assert.equal(timeAgo(null, now), "never");
  assert.equal(timeAgo(new Date(2026, 9, 21, 9, 59, 30).toISOString(), now), "just now");
  assert.equal(timeAgo(new Date(2026, 9, 21, 9, 58).toISOString(), now), "2 min ago");
  assert.equal(timeAgo(new Date(2026, 9, 21, 7, 5).toISOString(), now), "at 07:05");
  assert.equal(timeAgo(new Date(2026, 9, 20, 18, 30).toISOString(), now), "Tue 20 Oct 18:30");
});
~~~

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL, `ERR_MODULE_NOT_FOUND` for `site/src/dates.js`.

- [ ] **Step 4: Write the module**

~~~js title=site/src/dates.js
// Date math on "YYYY-MM-DD" strings (no time zones) and display formatting.
import { PLAN } from "./config.js";

const DAY_MS = 86_400_000;
export const WEEKDAYS = Object.freeze(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = n => String(n).padStart(2, "0");

function toUtc(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(iso, n) {
  return fromUtc(toUtc(iso) + n * DAY_MS);
}

export function diffDays(from, to) {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

export function weekdayIndex(iso) {
  return (new Date(toUtc(iso)).getUTCDay() + 6) % 7;
}

export function mondayOf(iso) {
  return addDays(iso, -weekdayIndex(iso));
}

export function localToday(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function weekNumber(iso, plan = PLAN) {
  return Math.floor(diffDays(plan.calendarStart, iso) / 7) + 1;
}

export function clampWeek(week, plan = PLAN) {
  return Math.min(plan.weeks, Math.max(1, week));
}

export function dayNumber(iso, plan = PLAN) {
  return diffDays(plan.firstDay, iso) + 1;
}

export function totalDays(plan = PLAN) {
  return diffDays(plan.firstDay, plan.raceDay) + 1;
}

export function daysToRace(iso, plan = PLAN) {
  return diffDays(iso, plan.raceDay);
}

export function formatDate(iso) {
  const [, m, d] = iso.split("-").map(Number);
  return `${WEEKDAYS[weekdayIndex(iso)]} ${d} ${MONTHS[m - 1]}`;
}

export function formatKm(metres, digits = 1) {
  return String(Number((metres / 1000).toFixed(digits)));
}

export function formatPace(secondsPerKm) {
  const total = Math.round(secondsPerKm);
  return `${Math.floor(total / 60)}:${pad(total % 60)}`;
}

export function formatDuration(seconds) {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)} h ${pad(mins % 60)} min`;
}

export function formatClock(seconds) {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function timeAgo(iso, now = new Date()) {
  if (!iso) return "never";
  const then = new Date(iso);
  const mins = Math.floor((now - then) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const clock = `${pad(then.getHours())}:${pad(then.getMinutes())}`;
  if (localToday(then) === localToday(now)) return `at ${clock}`;
  return `${formatDate(localToday(then))} ${clock}`;
}
~~~

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm test`
Expected: `# tests 6`, `# pass 6`, `# fail 0`.

- [ ] **Step 6: Commit**

```bash
git add package.json .gitignore site/src/config.js site/src/dates.js test/dates.test.js
git commit -m "feat: project scaffold and date helpers"
```

### Task 2: Workout module

**Files:**
- Create: `site/src/workout.js`, `test/fixtures.js`
- Test: `test/workout.test.js`

**Interfaces:**
- Consumes: `formatKm`, `formatPace` from `dates.js`.
- Produces: `TYPE_LABEL`, `GROUP`, `workoutType(name) → "easy"|"long"|"threshold"|"intervals"|"racepace"|"test"|"key"|"race"|"run"`, `shortName(name)`, `noteText(description)`, `stepName(text)`, `formatStepAmount(step)`, `paceRange(pace) → "4:02–4:08"|""`, `LEVEL_HEIGHT`, `stepLevel(step) → "rest"|"easy"|"long"|"threshold"|"intervals"|"race"`, `flattenSteps(steps)`, `workoutBar(steps) → [{level, width, height}]`. `test/fixtures.js` exports `steps10x400`, `events`, `activities` (reduced shapes, see Task 4 `reduceEvent`/`reduceActivity`).

- [ ] **Step 1: Write the fixtures and failing tests**

~~~js title=test/fixtures.js
// Synthetic data only, in the reduced shape the page caches (see site/src/api.js).
export const steps10x400 = [
  { text: "Warmup", distance: 1600, duration: 544, pace: { start: 330, end: 350, units: "secs/km" } },
  {
    text: "",
    reps: 10,
    steps: [
      { text: "Rep", distance: 400, duration: 98, pace: { start: 242, end: 248, units: "secs/km" } },
      { text: "Rest", duration: 90 },
    ],
  },
];

const workout = (id, date, name, distance, steps = [], description = "") => ({
  id, date, category: "WORKOUT", name, description, distance, movingTime: Math.round(distance * 0.34),
  pairedActivityId: null, steps,
});

export const events = [
  { id: 1, date: "2026-10-20", category: "NOTE", name: "Rest", description: "", distance: 0, movingTime: 0, pairedActivityId: null, steps: [] },
  workout(2, "2026-10-21", "W01 Wed - 10x400 @4:05", 5600, steps10x400, "+ gym\n\n- Warmup 1.6km 5:30-5:50/km Pace"),
  workout(3, "2026-10-22", "W01 Thu - Easy 5 km", 5000, [{ text: "Easy", distance: 5000, duration: 1700, pace: { start: 330, end: 350, units: "secs/km" } }]),
  workout(4, "2026-10-23", "W01 Fri - Threshold 2x3 km", 8000, [], "+ gym"),
  workout(5, "2026-10-25", "W01 Sun - Long 12 km", 12000),
  { id: 6, date: "2026-10-25", category: "RACE_A", name: "Other category", description: "", distance: 0, movingTime: 0, pairedActivityId: null, steps: [] },
  workout(7, "2027-02-05", "Outside the plan", 5000),
];

const run = (id, date, type, distance, movingTime, extra = {}) => ({
  id, date, type, name: type, distance, movingTime, avgHr: null, pairedEventId: null, compliance: null, ...extra,
});

export const activities = [
  run("i10", "2026-10-20", "Run", 3000, 1000, { avgHr: 130 }),
  run("i11", "2026-10-21", "Run", 5620, 2412, { avgHr: 152.4, pairedEventId: 2, compliance: 96.4 }),
  run("i12", "2026-10-21", "WeightTraining", 0, 2700),
  run("i13", "2026-10-22", "Run", 5050, 1730, { avgHr: 138 }),
];
~~~

~~~js title=test/workout.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  flattenSteps, formatStepAmount, noteText, paceRange, shortName, stepLevel, stepName, workoutBar, workoutType,
} from "../site/src/workout.js";
import { steps10x400 } from "./fixtures.js";

test("workout type comes from the plan's names", () => {
  const cases = [
    ["W01 Wed - 10x400 @4:05", "intervals"],
    ["W03 Tue - 5x1000 @4:03", "intervals"],
    ["W01 Fri - Threshold 2x3 km", "threshold"],
    ["W01 Thu - Easy 5 km", "easy"],
    ["W01 Sat - Easy 7 km + strides", "easy"],
    ["W04 Sun - Long 16 km", "long"],
    ["W11 Sun - Long 18 km, 5 @RP", "long"],
    ["W05 Sun - TEST 1 10 km", "test"],
    ["W12 Sun - KEY 20 km, 10 @RP", "key"],
    ["W15 Tue - 3x1000 @RP", "racepace"],
    ["W15 Thu - 3 km @RP", "racepace"],
    ["W15 Sun - RACE 21.1 km", "race"],
    ["Morning jog with friends", "run"],
  ];
  for (const [name, type] of cases) assert.equal(workoutType(name), type, name);
});

test("short names drop the week prefix and use ×", () => {
  assert.equal(shortName("W01 Wed - 10x400 @4:05"), "10×400 @4:05");
  assert.equal(shortName("W01 Fri - Threshold 2x3 km"), "Threshold 2×3 km");
  assert.equal(shortName("My own run"), "My own run");
  assert.equal(shortName(""), "Workout");
});

test("note text is the part before the steps", () => {
  assert.equal(noteText("+ gym\n\n- Warmup 1.6km 5:30-5:50/km Pace\n\n10x\n- Rep 400mtr 4:02-4:08/km Pace"), "+ gym");
  assert.equal(noteText("- Easy 5km 5:30-5:50/km Pace"), "");
  assert.equal(
    noteText("Start 4:15/km, speed up after 5 km.\nReport your time.\n\n- Warmup 1.6km"),
    "Start 4:15/km, speed up after 5 km. Report your time.",
  );
  assert.equal(noteText("Christmas"), "Christmas");
  assert.equal(noteText(undefined), "");
});

test("step names and amounts", () => {
  assert.equal(stepName("Warmup"), "Warm-up");
  assert.equal(stepName("Test all out"), "Test, all out");
  assert.equal(stepName("Custom bit"), "Custom bit");
  assert.equal(stepName(""), "Step");
  assert.equal(formatStepAmount({ distance: 400 }), "400 m");
  assert.equal(formatStepAmount({ distance: 1600, duration: 544 }), "1.6 km");
  assert.equal(formatStepAmount({ duration: 90 }), "90 s");
  assert.equal(formatStepAmount({ duration: 180 }), "3 min");
  assert.equal(formatStepAmount({}), "");
});

test("pace ranges are shown fast to slow in m:ss", () => {
  assert.equal(paceRange({ start: 242, end: 248, units: "secs/km" }), "4:02–4:08");
  assert.equal(paceRange({ start: 248, end: 242, units: "secs/km" }), "4:02–4:08");
  assert.equal(paceRange({ start: 255, end: 255 }), "4:15");
  assert.equal(paceRange({ start: 90, end: 95, units: "%pace" }), "");
  assert.equal(paceRange(null), "");
});

test("step level from the cue, then from pace", () => {
  const cases = [
    [{ text: "Warmup" }, "easy"], [{ text: "Easy" }, "easy"], [{ text: "Rest" }, "rest"], [{ text: "Walk" }, "rest"],
    [{ text: "Steady" }, "long"], [{ text: "Settle" }, "threshold"], [{ text: "Threshold" }, "threshold"],
    [{ text: "Rep" }, "intervals"], [{ text: "Stride" }, "intervals"], [{ text: "Race pace" }, "race"],
    [{ text: "Race" }, "race"], [{ text: "Test all out" }, "race"],
    [{ text: "", pace: { start: 242, end: 248 } }, "intervals"],
    [{ text: "", pace: { start: 262, end: 272 } }, "threshold"],
    [{ text: "", pace: { start: 275, end: 285 } }, "long"],
    [{ text: "" }, "easy"],
  ];
  for (const [step, level] of cases) assert.equal(stepLevel(step), level, JSON.stringify(step));
});

test("workout bar expands repeats and sizes blocks by time", () => {
  assert.equal(flattenSteps(steps10x400).length, 21);
  const bar = workoutBar(steps10x400);
  assert.equal(bar.length, 21);
  assert.ok(Math.abs(bar.reduce((t, b) => t + b.width, 0) - 1) < 1e-9);
  assert.deepEqual(bar.slice(0, 3).map(b => b.level), ["easy", "intervals", "rest"]);
  assert.equal(bar[1].height, 0.9);
  assert.ok(bar[0].width > bar[1].width);
});

test("workout bar without durations uses equal blocks; no steps gives no bar", () => {
  assert.deepEqual(workoutBar([{ text: "Stride" }, { text: "Walk" }]).map(b => b.width), [0.5, 0.5]);
  assert.deepEqual(workoutBar([]), []);
  assert.deepEqual(workoutBar(undefined), []);
});
~~~

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL in `test/workout.test.js` with `ERR_MODULE_NOT_FOUND` for `site/src/workout.js`; the 6 date tests still pass.

- [ ] **Step 3: Write the module**

~~~js title=site/src/workout.js
// Workout names, notes, steps and the small "workout bar" chart.
import { formatKm, formatPace } from "./dates.js";

export const TYPE_LABEL = Object.freeze({
  easy: "Easy run",
  long: "Long run",
  threshold: "Threshold",
  intervals: "Intervals",
  racepace: "Race pace",
  test: "10 km test",
  key: "Key run",
  race: "Race",
  run: "Run",
});

// Colour groups used by the page.
export const GROUP = Object.freeze({
  easy: "easy",
  long: "long",
  threshold: "threshold",
  intervals: "intervals",
  racepace: "race",
  test: "race",
  key: "race",
  race: "race",
  run: "easy",
});

export function workoutType(name = "") {
  if (/\bRACE\b/.test(name)) return "race";
  if (/\bTEST\b/.test(name)) return "test";
  if (/\bKEY\b/.test(name)) return "key";
  if (/threshold/i.test(name)) return "threshold";
  if (/\blong\b/i.test(name)) return "long";
  if (/@RP\b/.test(name)) return "racepace";
  if (/\d+x\d+/.test(name)) return "intervals";
  if (/\beasy\b/i.test(name)) return "easy";
  return "run";
}

export function shortName(name = "") {
  const short = name.replace(/^W\d+\s+[A-Za-z]{3}\s+-\s+/, "").replace(/(\d)x(\d)/g, "$1×$2").trim();
  return short || "Workout";
}

// The free text before the first workout step line ("- …" or "10x").
export function noteText(description = "") {
  const out = [];
  for (const line of String(description ?? "").split(/\r?\n/)) {
    const t = line.trim();
    if (t.startsWith("- ") || /^\d+x\s*$/i.test(t)) break;
    if (t) out.push(t);
  }
  return out.join(" ");
}

const STEP_NAMES = Object.freeze({
  warmup: "Warm-up",
  easy: "Easy",
  rep: "Repeat",
  rest: "Rest",
  walk: "Walk",
  stride: "Stride",
  settle: "Settle in",
  threshold: "Threshold",
  steady: "Steady",
  "race pace": "Race pace",
  race: "Race",
  "test all out": "Test, all out",
});

export function stepName(text = "") {
  const t = String(text ?? "").trim();
  return STEP_NAMES[t.toLowerCase()] ?? (t || "Step");
}

export function formatStepAmount(step) {
  if (step.distance) return step.distance < 1000 ? `${Math.round(step.distance)} m` : `${formatKm(step.distance)} km`;
  if (step.duration) return step.duration < 120 ? `${Math.round(step.duration)} s` : `${Math.round(step.duration / 60)} min`;
  return "";
}

export function paceRange(pace) {
  if (!pace || (pace.units && pace.units !== "secs/km")) return "";
  const { start, end } = pace;
  if (start == null && end == null) return "";
  if (start == null || end == null || start === end) return formatPace(start ?? end);
  return `${formatPace(Math.min(start, end))}–${formatPace(Math.max(start, end))}`;
}

export const LEVEL_HEIGHT = Object.freeze({ rest: 0.2, easy: 0.4, long: 0.55, threshold: 0.7, race: 0.8, intervals: 0.9 });

export function stepLevel(step) {
  const t = String(step.text ?? "").trim().toLowerCase();
  if (/^(rest|walk)\b/.test(t)) return "rest";
  if (/^(warm-?up|easy)\b/.test(t)) return "easy";
  if (/^steady\b/.test(t)) return "long";
  if (/^(settle|threshold)\b/.test(t)) return "threshold";
  if (/^(rep|stride)\b/.test(t)) return "intervals";
  if (/^(race pace|race|test)\b/.test(t)) return "race";
  const p = step.pace;
  if (p && p.start != null && p.end != null && (!p.units || p.units === "secs/km")) {
    const mean = (p.start + p.end) / 2;
    if (mean < 250) return "intervals";
    if (mean < 270) return "threshold";
    if (mean < 300) return "long";
  }
  return "easy";
}

export function flattenSteps(steps = []) {
  const out = [];
  for (const s of steps ?? []) {
    if (s.reps && Array.isArray(s.steps)) {
      for (let i = 0; i < s.reps; i++) out.push(...flattenSteps(s.steps));
    } else {
      out.push(s);
    }
  }
  return out;
}

// One block per step: width = share of the workout's time, height = effort.
export function workoutBar(steps = []) {
  const flat = flattenSteps(steps);
  const sizes = flat.map(s => s.duration || (s.distance ? (s.distance / 1000) * 330 : 0));
  const total = sizes.reduce((a, b) => a + b, 0);
  return flat.map((s, i) => {
    const level = stepLevel(s);
    return { level, width: total ? sizes[i] / total : 1 / flat.length, height: LEVEL_HEIGHT[level] };
  });
}
~~~

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: `# tests 14`, `# pass 14`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add site/src/workout.js test/fixtures.js test/workout.test.js
git commit -m "feat: workout types, steps and workout bar"
```

### Task 3: Model module

**Files:**
- Create: `site/src/model.js`
- Test: `test/model.test.js`

**Interfaces:**
- Consumes: `PLAN`; `clampWeek`, `dayNumber`, `daysToRace`, `formatClock`, `formatDate`, `formatKm`, `formatPace`, `mondayOf`, `totalDays`, `weekNumber` from `dates.js`; `shortName`, `workoutType` from `workout.js`; fixtures from Task 2.
- Produces:
  - `isRun(activity) → bool`
  - `buildModel({events, activities}, today, plan?) → { today, days[105], byDate: Map<iso, Day>, weeks[15], totals }`
    - `Day = { date, week, weekday, isToday, workouts: [event & {type, run}], notes: [event], activities, extraRuns, others, status }`
    - `Week = { number, phase, start, end, days[7], plannedM, doneM }`
    - `totals = { plannedM, doneM, workouts, doneWorkouts, missedWorkouts }`
  - `dayStatus(day, today) → "done"|"partial"|"missed"|"planned"|"rest"|"empty"`
  - `statusInfo(day, today) → { key: "done"|"partial"|"missed"|"today"|"planned"|"rest"|"empty", icon, short, label }`
  - `dayLabel(day, today) → string`, `headerInfo(today, plan?) → { week, day, total, toRace, progress, text, phase }`
  - `runSummary(activity) → { distance, time, pace, hr, compliance, url }`, `activityUrl(id)`, `dayUrl(iso)`

- [ ] **Step 1: Write the failing tests**

~~~js title=test/model.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import { activityUrl, buildModel, dayLabel, dayUrl, headerInfo, runSummary, statusInfo } from "../site/src/model.js";
import { activities, events } from "./fixtures.js";

const data = { events, activities };

test("model covers 15 weeks from Mon 19 Oct to race day", () => {
  const m = buildModel(data, "2026-10-23");
  assert.equal(m.days.length, 105);
  assert.equal(m.days[0].date, "2026-10-19");
  assert.equal(m.days.at(-1).date, "2027-01-31");
  assert.equal(m.weeks.length, 15);
  assert.equal(m.weeks[0].phase, "Start");
  assert.equal(m.weeks[11].phase, "Key week");
  assert.equal(m.weeks[14].phase, "Race");
});

test("events outside the plan or of other categories are ignored", () => {
  const m = buildModel(data, "2026-10-23");
  assert.equal(m.byDate.get("2026-10-25").workouts.length, 1);
  assert.equal(m.byDate.get("2026-10-25").notes.length, 0);
  assert.equal(m.byDate.has("2027-02-05"), false);
  assert.equal(m.totals.workouts, 4);
});

test("runs match their workout by pairing first, then by date", () => {
  const m = buildModel(data, "2026-10-23");
  assert.equal(m.byDate.get("2026-10-21").workouts[0].run.id, "i11");
  assert.equal(m.byDate.get("2026-10-22").workouts[0].run.id, "i13");
  assert.deepEqual(m.byDate.get("2026-10-21").others.map(a => a.id), ["i12"]);
  assert.deepEqual(m.byDate.get("2026-10-20").extraRuns.map(a => a.id), ["i10"]);
});

test("an unpaired run on the same day does not take a paired run's place", () => {
  const jog = { id: "i14", date: "2026-10-21", type: "Run", name: "Jog", distance: 2000, movingTime: 700, avgHr: null, pairedEventId: null, compliance: null };
  const m = buildModel({ events, activities: [jog, ...activities] }, "2026-10-23");
  const day = m.byDate.get("2026-10-21");
  assert.equal(day.workouts[0].run.id, "i11");
  assert.deepEqual(day.extraRuns.map(a => a.id), ["i14"]);
});

test("pairing also works from the event side", () => {
  const paired = events.map(e => (e.id === 3 ? { ...e, pairedActivityId: "i13" } : e));
  const commute = { id: "i15", date: "2026-10-22", type: "Run", name: "Commute", distance: 1500, movingTime: 600, avgHr: null, pairedEventId: null, compliance: null };
  const m = buildModel({ events: paired, activities: [commute, ...activities] }, "2026-10-23");
  const day = m.byDate.get("2026-10-22");
  assert.equal(day.workouts[0].run.id, "i13");
  assert.deepEqual(day.extraRuns.map(a => a.id), ["i15"]);
});

test("day status for every case", () => {
  const m = buildModel(data, "2026-10-23");
  const status = d => m.byDate.get(d).status;
  assert.equal(status("2026-10-19"), "empty");
  assert.equal(status("2026-10-20"), "rest");
  assert.equal(status("2026-10-21"), "done");
  assert.equal(status("2026-10-22"), "done");
  assert.equal(status("2026-10-23"), "planned");
  assert.equal(statusInfo(m.byDate.get("2026-10-23"), "2026-10-23").key, "today");
  assert.equal(status("2026-10-25"), "planned");
  const later = buildModel(data, "2026-10-26");
  assert.equal(later.byDate.get("2026-10-23").status, "missed");
  assert.equal(later.totals.missedWorkouts, 2);
});

test("a day with two workouts and one run is partly done", () => {
  const second = { ...events[2], id: 99, name: "Strides 2 km", distance: 2000 };
  const m = buildModel({ events: [...events, second], activities }, "2026-10-23");
  assert.equal(m.byDate.get("2026-10-22").status, "partial");
});

test("week and plan km: planned from workouts, done from runs only", () => {
  const m = buildModel(data, "2026-10-23");
  assert.equal(m.weeks[0].plannedM, 30600);
  assert.equal(m.weeks[0].doneM, 13670);
  assert.equal(m.totals.plannedM, 30600);
  assert.equal(m.totals.doneWorkouts, 2);
});

test("accessible day labels", () => {
  const today = "2026-10-23";
  const m = buildModel(data, today);
  const label = d => dayLabel(m.byDate.get(d), today);
  assert.equal(label("2026-10-21"), "Wed 21 Oct, 10×400 @4:05, 5.6 km, done");
  assert.equal(label("2026-10-23"), "Fri 23 Oct, today, Threshold 2×3 km, 8 km, not done yet");
  assert.equal(label("2026-10-20"), "Tue 20 Oct, rest day, extra run");
  assert.equal(label("2026-10-24"), "Sat 24 Oct, nothing planned");
});

test("header text before, during and after the plan", () => {
  assert.equal(headerInfo("2026-10-15").text, "Plan starts Tue 20 Oct · 108 days to race");
  assert.equal(headerInfo("2026-10-15").progress, 0);
  const now = headerInfo("2026-10-21");
  assert.equal(now.text, "Week 1 of 15 · Day 2 of 104 · 102 days to race");
  assert.ok(Math.abs(now.progress - 2 / 104) < 1e-9);
  assert.equal(headerInfo("2027-01-30").text, "Week 15 of 15 · Day 103 of 104 · 1 day to race");
  assert.equal(headerInfo("2027-01-31").text, "Race day · Sun 31 Jan");
  assert.equal(headerInfo("2027-02-02").text, "Plan complete · race was Sun 31 Jan");
  assert.equal(headerInfo("2027-02-02").progress, 1);
});

test("run summary, including runs with missing numbers", () => {
  assert.deepEqual(runSummary(activities[1]), {
    distance: "5.62 km", time: "40:12", pace: "7:09 /km", hr: "152 bpm", compliance: "96%",
    url: "https://intervals.icu/activities/i11",
  });
  assert.deepEqual(runSummary({ id: "i20", distance: 0, movingTime: 0, avgHr: null, compliance: null }), {
    distance: "", time: "", pace: "", hr: "", compliance: "", url: "https://intervals.icu/activities/i20",
  });
});

test("links to intervals.icu", () => {
  assert.equal(activityUrl("i11"), "https://intervals.icu/activities/i11");
  assert.equal(dayUrl("2026-10-21"), "https://intervals.icu/?w=2026-10-19");
});
~~~

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL in `test/model.test.js` with `ERR_MODULE_NOT_FOUND` for `site/src/model.js`; the 14 earlier tests pass.

- [ ] **Step 3: Write the module**

~~~js title=site/src/model.js
// Turns intervals.icu events and activities into days, weeks and statuses.
import { PLAN } from "./config.js";
import {
  addDays, clampWeek, dayNumber, daysToRace, formatClock, formatDate, formatKm, formatPace, mondayOf, totalDays, weekNumber,
} from "./dates.js";
import { shortName, workoutType } from "./workout.js";

export function isRun(activity) {
  return /run/i.test(activity?.type ?? "");
}

const sum = (items, pick) => items.reduce((total, item) => total + (Number(pick(item)) || 0), 0);
const sameId = (a, b) => a != null && b != null && String(a) === String(b);

export function buildModel(data, today, plan = PLAN) {
  const events = data?.events ?? [];
  const activities = data?.activities ?? [];
  const days = [];
  const byDate = new Map();
  for (let i = 0; i < plan.weeks * 7; i++) {
    const date = addDays(plan.calendarStart, i);
    const day = {
      date,
      week: Math.floor(i / 7) + 1,
      weekday: i % 7,
      isToday: date === today,
      workouts: [],
      notes: [],
      activities: [],
      extraRuns: [],
      others: [],
      status: "empty",
    };
    days.push(day);
    byDate.set(date, day);
  }

  for (const e of events) {
    const day = byDate.get(e.date);
    if (!day) continue;
    if (e.category === "WORKOUT") day.workouts.push({ ...e, type: workoutType(e.name), run: null });
    else if (e.category === "NOTE") day.notes.push(e);
  }
  for (const a of activities) byDate.get(a.date)?.activities.push(a);

  // 1) intervals.icu's own pairing, from either side; 2) a run on the same date.
  const used = new Set();
  for (const w of days.flatMap(d => d.workouts)) {
    const a = activities.find(x => !used.has(x.id) && (sameId(x.pairedEventId, w.id) || sameId(w.pairedActivityId, x.id)));
    if (a) {
      w.run = a;
      used.add(a.id);
    }
  }
  for (const day of days) {
    for (const w of day.workouts) {
      if (w.run) continue;
      const a = day.activities.find(x => isRun(x) && !used.has(x.id));
      if (a) {
        w.run = a;
        used.add(a.id);
      }
    }
    for (const a of day.activities) {
      if (!used.has(a.id)) (isRun(a) ? day.extraRuns : day.others).push(a);
    }
    day.status = dayStatus(day, today);
  }

  const weeks = [];
  for (let n = 1; n <= plan.weeks; n++) {
    const wdays = days.slice((n - 1) * 7, n * 7);
    weeks.push({
      number: n,
      phase: plan.phases[n - 1] ?? "",
      start: wdays[0].date,
      end: wdays[6].date,
      days: wdays,
      plannedM: sum(wdays.flatMap(d => d.workouts), w => w.distance),
      doneM: sum(wdays.flatMap(d => d.activities).filter(isRun), a => a.distance),
    });
  }

  const workouts = days.flatMap(d => d.workouts);
  const totals = {
    plannedM: sum(weeks, w => w.plannedM),
    doneM: sum(weeks, w => w.doneM),
    workouts: workouts.length,
    doneWorkouts: workouts.filter(w => w.run).length,
    missedWorkouts: workouts.filter(w => !w.run && w.date < today).length,
  };
  return { today, days, byDate, weeks, totals };
}

export function dayStatus(day, today) {
  const total = day.workouts.length;
  if (!total) return day.notes.length ? "rest" : "empty";
  const done = day.workouts.filter(w => w.run).length;
  if (done === total) return "done";
  if (done > 0) return "partial";
  return day.date < today ? "missed" : "planned";
}

export function statusInfo(day, today) {
  const isToday = day.date === today;
  switch (day.status) {
    case "done":
      return { key: "done", icon: "✓", short: "Done", label: "done" };
    case "partial":
      return { key: "partial", icon: "◐", short: "Part done", label: "partly done" };
    case "missed":
      return { key: "missed", icon: "!", short: "Missed", label: "missed" };
    case "planned":
      return isToday
        ? { key: "today", icon: "•", short: "Today", label: "not done yet" }
        : { key: "planned", icon: "", short: "", label: "planned" };
    case "rest":
      return day.extraRuns.length
        ? { key: "rest", icon: "+", short: "Extra run", label: "rest day, extra run" }
        : { key: "rest", icon: "", short: isToday ? "Rest" : "", label: "rest day" };
    default:
      return { key: "empty", icon: "", short: "", label: "nothing planned" };
  }
}

export function dayLabel(day, today) {
  const parts = [formatDate(day.date)];
  if (day.date === today) parts.push("today");
  for (const w of day.workouts) {
    parts.push(w.distance ? `${shortName(w.name)}, ${formatKm(w.distance)} km` : shortName(w.name));
  }
  parts.push(statusInfo(day, today).label);
  return parts.join(", ");
}

export function headerInfo(today, plan = PLAN) {
  const total = totalDays(plan);
  const day = dayNumber(today, plan);
  const toRace = daysToRace(today, plan);
  const week = weekNumber(today, plan);
  let text;
  if (today < plan.firstDay) text = `Plan starts ${formatDate(plan.firstDay)} · ${toRace} days to race`;
  else if (toRace > 0) text = `Week ${week} of ${plan.weeks} · Day ${day} of ${total} · ${toRace} ${toRace === 1 ? "day" : "days"} to race`;
  else if (toRace === 0) text = `Race day · ${formatDate(plan.raceDay)}`;
  else text = `Plan complete · race was ${formatDate(plan.raceDay)}`;
  return {
    week,
    day,
    total,
    toRace,
    progress: Math.min(1, Math.max(0, day / total)),
    text,
    phase: plan.phases[clampWeek(week, plan) - 1],
  };
}

export function activityUrl(id) {
  return `https://intervals.icu/activities/${encodeURIComponent(id)}`;
}

export function dayUrl(iso) {
  return `https://intervals.icu/?w=${mondayOf(iso)}`;
}

export function runSummary(a) {
  const km = (a.distance || 0) / 1000;
  const pace = km > 0 && a.movingTime > 0 ? a.movingTime / km : null;
  return {
    distance: km > 0 ? `${formatKm(a.distance, 2)} km` : "",
    time: a.movingTime > 0 ? formatClock(a.movingTime) : "",
    pace: pace ? `${formatPace(pace)} /km` : "",
    hr: a.avgHr ? `${Math.round(a.avgHr)} bpm` : "",
    compliance: a.compliance != null ? `${Math.round(a.compliance)}%` : "",
    url: activityUrl(a.id),
  };
}
~~~

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: `# tests 26`, `# pass 26`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add site/src/model.js test/model.test.js
git commit -m "feat: plan model with run matching and statuses"
```

### Task 4: intervals.icu API and storage

**Files:**
- Create: `site/src/api.js`
- Test: `test/api.test.js`

**Interfaces:**
- Consumes: `API_BASE`, `PLAN`, `STORAGE_KEYS`.
- Produces:
  - `class KeyError(message?, reason = "rejected"|"format"|"missing")`, `class NetworkError`, `class HttpError(status, message)`
  - `authHeader(key)`, `request(path, key, fetchImpl?) → JSON`
  - `createStore(storage) → { getKey, setKey, getCache, setCache, getTheme, setTheme, getShortcut, setShortcut, forget }`
  - `reduceStep`, `reduceEvent(raw) → {id, date, category, name, description, distance, movingTime, pairedActivityId, steps}`, `reduceActivity(raw) → {id, date, type, name, distance, movingTime, avgHr, pairedEventId, compliance}`
  - `connect(rawKey, {store, fetchImpl?}) → {athleteName}`; `refresh({store, today, fetchImpl?, plan?, now?}) → {fetchedAt, athleteName, events, activities}`

- [ ] **Step 1: Write the failing tests**

~~~js title=test/api.test.js
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HttpError, KeyError, NetworkError, authHeader, connect, createStore, reduceActivity, reduceEvent, refresh, request,
} from "../site/src/api.js";

const BASE = "https://intervals.icu/api/v1";

function memoryStorage() {
  const map = new Map();
  return {
    map,
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: k => { map.delete(k); },
  };
}

function brokenStorage() {
  const fail = () => { throw new Error("storage unavailable"); };
  return { getItem: fail, setItem: fail, removeItem: fail };
}

function reply(status, body) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { status, ok: status >= 200 && status < 300, text: async () => text, json: async () => JSON.parse(text) };
}

function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const route = routes[url.slice(BASE.length).split("?")[0]];
    if (route instanceof Error) throw route;
    return route ?? reply(404, { error: "not found" });
  };
  fn.calls = calls;
  return fn;
}

const rawEvent = {
  id: 2, start_date_local: "2026-10-21T00:00:00", category: "WORKOUT", name: "W01 Wed - 10x400 @4:05",
  description: "+ gym", distance: 5600, moving_time: 2424, paired_activity_id: null, external_id: "x-2026-10-21",
  icu_ctl: 40, oauth_client_id: null,
  workout_doc: {
    distance: 5600,
    duration: 2424,
    steps: [
      { text: "Warmup", distance: 1600, duration: 544, pace: { start: 330, end: 350, units: "secs/km" } },
      {
        text: "", reps: 10, distance: 4000, duration: 1880,
        steps: [
          { text: "Rep", distance: 400, duration: 98, pace: { start: 242, end: 248, units: "secs/km" } },
          { text: "Rest", duration: 90 },
        ],
      },
    ],
  },
};

const rawActivity = {
  id: "i11", start_date_local: "2026-10-21T17:05:12", type: "Run", name: "Intervals", distance: 5620,
  moving_time: 2412, average_heartrate: 152.4, paired_event_id: 2, compliance: 96.4, device_name: "Watch", calories: 400,
};

test("auth header uses API_KEY and the key", () => {
  assert.equal(authHeader("abc123"), `Basic ${Buffer.from("API_KEY:abc123").toString("base64")}`);
});

test("request sends the key and returns JSON", async () => {
  const f = fakeFetch({ "/athlete/0": reply(200, { name: "Runner" }) });
  assert.deepEqual(await request("/athlete/0", "secret-key", f), { name: "Runner" });
  assert.equal(f.calls[0].url, `${BASE}/athlete/0`);
  assert.equal(f.calls[0].init.headers.Authorization, authHeader("secret-key"));
  assert.equal(f.calls[0].init.headers.Accept, "application/json");
});

test("request turns failures into clear errors", async () => {
  const run = route => request("/athlete/0", "k", fakeFetch({ "/athlete/0": route }));
  await assert.rejects(run(reply(401, { error: "Unauthorized" })), KeyError);
  await assert.rejects(run(reply(403, { error: "Access denied" })), KeyError);
  await assert.rejects(
    run(reply(403, { title: "Error 1010", cloudflare_error: true })),
    e => e instanceof HttpError && !(e instanceof KeyError) && e.status === 403,
  );
  await assert.rejects(run(reply(500, "oops")), e => e instanceof HttpError && e.status === 500);
  await assert.rejects(run(new TypeError("Failed to fetch")), NetworkError);
  await assert.rejects(run(reply(200, "<html>not json</html>")), HttpError);
});

test("events and activities are reduced to the fields the page uses", () => {
  assert.deepEqual(reduceEvent(rawEvent), {
    id: 2, date: "2026-10-21", category: "WORKOUT", name: "W01 Wed - 10x400 @4:05", description: "+ gym",
    distance: 5600, movingTime: 2424, pairedActivityId: null,
    steps: [
      { text: "Warmup", distance: 1600, duration: 544, pace: { start: 330, end: 350, units: "secs/km" } },
      {
        text: "", distance: 4000, duration: 1880, reps: 10,
        steps: [
          { text: "Rep", distance: 400, duration: 98, pace: { start: 242, end: 248, units: "secs/km" } },
          { text: "Rest", duration: 90 },
        ],
      },
    ],
  });
  assert.deepEqual(reduceActivity({ ...rawActivity, id: 123 }), {
    id: "123", date: "2026-10-21", type: "Run", name: "Intervals", distance: 5620, movingTime: 2412,
    avgHr: 152.4, pairedEventId: 2, compliance: 96.4,
  });
});

test("refresh loads the plan range and caches a reduced copy", async () => {
  const store = createStore(memoryStorage());
  store.setKey("secret-key");
  store.setCache({ fetchedAt: null, athleteName: "Runner", events: [], activities: [] });
  const f = fakeFetch({
    "/athlete/0/events": reply(200, [rawEvent]),
    "/athlete/0/activities": reply(200, [rawActivity]),
  });
  const data = await refresh({ store, today: "2026-10-21", fetchImpl: f, now: new Date("2026-10-21T03:00:00Z") });
  assert.deepEqual(f.calls.map(c => c.url).sort(), [
    `${BASE}/athlete/0/activities?oldest=2026-10-19&newest=2026-10-21`,
    `${BASE}/athlete/0/events?oldest=2026-10-19&newest=2027-01-31`,
  ]);
  assert.equal(data.fetchedAt, "2026-10-21T03:00:00.000Z");
  assert.equal(data.athleteName, "Runner");
  assert.equal(data.events[0].date, "2026-10-21");
  assert.equal(data.activities[0].id, "i11");
  assert.equal("icu_ctl" in data.events[0], false);
  assert.deepEqual(store.getCache(), data);
});

test("refresh before the plan starts still asks for a valid activity range", async () => {
  const store = createStore(memoryStorage());
  store.setKey("secret-key");
  const f = fakeFetch({ "/athlete/0/events": reply(200, []), "/athlete/0/activities": reply(200, []) });
  await refresh({ store, today: "2026-10-01", fetchImpl: f });
  assert.ok(f.calls.some(c => c.url.endsWith("/athlete/0/activities?oldest=2026-10-19&newest=2026-10-19")));
});

test("refresh without a key asks for one", async () => {
  const store = createStore(memoryStorage());
  await assert.rejects(
    refresh({ store, today: "2026-10-21", fetchImpl: fakeFetch({}) }),
    e => e instanceof KeyError && e.reason === "missing",
  );
});

test("connect trims the key, checks it, and saves it with the athlete name", async () => {
  const store = createStore(memoryStorage());
  store.setCache({ fetchedAt: "x", athleteName: "Old", events: [{ id: 1 }], activities: [] });
  const f = fakeFetch({ "/athlete/0": reply(200, { name: "Truong" }) });
  assert.deepEqual(await connect("  secret-key-123\n", { store, fetchImpl: f }), { athleteName: "Truong" });
  assert.equal(store.getKey(), "secret-key-123");
  assert.equal(f.calls[0].init.headers.Authorization, authHeader("secret-key-123"));
  assert.deepEqual(store.getCache(), { fetchedAt: null, athleteName: "Truong", events: [], activities: [] });
});

test("connect rejects a malformed or refused key and saves nothing", async () => {
  const store = createStore(memoryStorage());
  const none = fakeFetch({});
  await assert.rejects(connect("not a key", { store, fetchImpl: none }), e => e instanceof KeyError && e.reason === "format");
  assert.equal(none.calls.length, 0);
  await assert.rejects(connect("secret-key-123", { store, fetchImpl: fakeFetch({ "/athlete/0": reply(401, {}) }) }), KeyError);
  assert.equal(store.getKey(), null);
});

test("store survives blocked storage and corrupt data", () => {
  const blocked = createStore(brokenStorage());
  blocked.setKey("secret-key");
  assert.equal(blocked.getKey(), "secret-key");
  blocked.setCache({ fetchedAt: null, athleteName: "", events: [], activities: [] });
  assert.deepEqual(blocked.getCache().events, []);
  assert.equal(blocked.getTheme(), "system");
  assert.equal(createStore(null).getKey(), null);

  const storage = memoryStorage();
  storage.setItem("tc.v1.data", "{not json");
  assert.equal(createStore(storage).getCache(), null);
});

test("forget removes the key and the saved data but keeps settings", () => {
  const store = createStore(memoryStorage());
  store.setKey("secret-key");
  store.setCache({ fetchedAt: null, athleteName: "", events: [], activities: [] });
  store.setTheme("dark");
  store.setShortcut(false);
  store.forget();
  assert.equal(store.getKey(), null);
  assert.equal(store.getCache(), null);
  assert.equal(store.getTheme(), "dark");
  assert.equal(store.getShortcut(), false);
});
~~~

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test`
Expected: FAIL in `test/api.test.js` with `ERR_MODULE_NOT_FOUND` for `site/src/api.js`; the 26 earlier tests pass.

- [ ] **Step 3: Write the module**

~~~js title=site/src/api.js
// Read-only intervals.icu client and the browser-side store (key, cached data, settings).
import { API_BASE, PLAN, STORAGE_KEYS } from "./config.js";

export class KeyError extends Error {
  constructor(message = "Key not accepted", reason = "rejected") {
    super(message);
    this.name = "KeyError";
    this.reason = reason;
  }
}

export class NetworkError extends Error {
  constructor(message = "Cannot reach intervals.icu") {
    super(message);
    this.name = "NetworkError";
  }
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

const defaultFetch = (url, init) => globalThis.fetch(url, init);
const KEY_PATTERN = /^[\x21-\x7e]{8,}$/;

export function authHeader(key) {
  return `Basic ${btoa(`API_KEY:${key}`)}`;
}

export async function request(path, key, fetchImpl = defaultFetch) {
  let res;
  try {
    res = await fetchImpl(`${API_BASE}${path}`, {
      headers: { Authorization: authHeader(key), Accept: "application/json" },
    });
  } catch {
    throw new NetworkError();
  }
  if (res.status === 401) throw new KeyError();
  if (res.status === 403) {
    const body = await res.text().catch(() => "");
    if (body.includes("cloudflare_error")) throw new HttpError(403, "intervals.icu blocked the request (HTTP 403)");
    throw new KeyError();
  }
  if (!res.ok) throw new HttpError(res.status, `intervals.icu answered HTTP ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new HttpError(res.status, "Unexpected reply from intervals.icu");
  }
}

// localStorage wrapper that falls back to memory when storage is blocked or full.
export function createStore(storage) {
  const memory = new Map();
  const read = k => {
    try {
      const v = storage?.getItem(k);
      if (v != null) return v;
    } catch {
      // storage blocked: use memory
    }
    return memory.has(k) ? memory.get(k) : null;
  };
  const write = (k, v) => {
    memory.set(k, v);
    try {
      storage?.setItem(k, v);
    } catch {
      // quota or blocked: memory copy is enough for this session
    }
  };
  const remove = k => {
    memory.delete(k);
    try {
      storage?.removeItem(k);
    } catch {
      // nothing to remove
    }
  };
  return {
    getKey: () => read(STORAGE_KEYS.key),
    setKey: key => write(STORAGE_KEYS.key, key),
    getCache() {
      const raw = read(STORAGE_KEYS.data);
      if (!raw) return null;
      try {
        const data = JSON.parse(raw);
        return data && Array.isArray(data.events) && Array.isArray(data.activities) ? data : null;
      } catch {
        return null;
      }
    },
    setCache: data => write(STORAGE_KEYS.data, JSON.stringify(data)),
    getTheme: () => read(STORAGE_KEYS.theme) || "system",
    setTheme: theme => write(STORAGE_KEYS.theme, theme),
    getShortcut: () => read(STORAGE_KEYS.shortcut) !== "off",
    setShortcut: on => write(STORAGE_KEYS.shortcut, on ? "on" : "off"),
    forget() {
      remove(STORAGE_KEYS.key);
      remove(STORAGE_KEYS.data);
    },
  };
}

export function reduceStep(s) {
  const out = { text: s.text ?? "" };
  if (s.distance) out.distance = s.distance;
  if (s.duration) out.duration = s.duration;
  if (s.pace) {
    out.pace = {
      start: s.pace.start ?? s.pace.value ?? null,
      end: s.pace.end ?? s.pace.value ?? null,
      units: s.pace.units ?? "",
    };
  }
  if (s.reps) {
    out.reps = s.reps;
    out.steps = (s.steps ?? []).map(reduceStep);
  }
  return out;
}

export function reduceEvent(e) {
  return {
    id: e.id,
    date: String(e.start_date_local ?? "").slice(0, 10),
    category: e.category ?? "",
    name: e.name ?? "",
    description: e.description ?? "",
    distance: e.distance ?? 0,
    movingTime: e.moving_time ?? 0,
    pairedActivityId: e.paired_activity_id ?? null,
    steps: (e.workout_doc?.steps ?? []).map(reduceStep),
  };
}

export function reduceActivity(a) {
  return {
    id: String(a.id),
    date: String(a.start_date_local ?? "").slice(0, 10),
    type: a.type ?? "",
    name: a.name ?? "",
    distance: a.distance ?? 0,
    movingTime: a.moving_time ?? 0,
    avgHr: a.average_heartrate ?? null,
    pairedEventId: a.paired_event_id ?? null,
    compliance: a.compliance ?? null,
  };
}

export async function connect(rawKey, { store, fetchImpl = defaultFetch }) {
  const key = String(rawKey ?? "").trim();
  if (!KEY_PATTERN.test(key)) throw new KeyError("That doesn't look like an intervals.icu API key.", "format");
  const athlete = await request("/athlete/0", key, fetchImpl);
  const athleteName = athlete?.name || athlete?.firstname || "";
  store.setKey(key);
  store.setCache({ fetchedAt: null, athleteName, events: [], activities: [] });
  return { athleteName };
}

export async function refresh({ store, today, fetchImpl = defaultFetch, plan = PLAN, now = new Date() }) {
  const key = store.getKey();
  if (!key) throw new KeyError("No API key on this device", "missing");
  const newest = today < plan.calendarStart ? plan.calendarStart : today;
  const [events, activities] = await Promise.all([
    request(`/athlete/0/events?oldest=${plan.calendarStart}&newest=${plan.raceDay}`, key, fetchImpl),
    request(`/athlete/0/activities?oldest=${plan.calendarStart}&newest=${newest}`, key, fetchImpl),
  ]);
  const data = {
    fetchedAt: now.toISOString(),
    athleteName: store.getCache()?.athleteName ?? "",
    events: (Array.isArray(events) ? events : []).map(reduceEvent),
    activities: (Array.isArray(activities) ? activities : []).map(reduceActivity),
  };
  store.setCache(data);
  return data;
}
~~~

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm test`
Expected: `# tests 37`, `# pass 37`, `# fail 0`.

- [ ] **Step 5: Commit**

```bash
git add site/src/api.js test/api.test.js
git commit -m "feat: read-only intervals.icu client and browser store"
```

### Task 5: Page shell, styles, icons and offline support

**Files:**
- Create: `site/index.html`, `site/styles.css`, `site/manifest.webmanifest`, `site/sw.js`, `site/icons/icon.svg`, `site/icons/icon-192.png`, `site/icons/icon-512.png`, `site/icons/apple-touch-icon.png`, `tools/serve.js`

**Interfaces:**
- Consumes: module paths `src/app.js` (Task 6), `src/*.js` (Tasks 1–4).
- Produces: DOM ids used by Task 6: `#app`, `#live`, `#details` (with `#details-eyebrow`, `#details-title`, `#details-body`, `.sheet-grip`, `[data-action=close|prev|next]`), `#settings` (with `#settings-athlete`, `input[name=theme]`, `input[name=shortcut]`, `[data-action=close|refresh|forget]`). CSS classes listed in Task 6 code. `npm run serve` serves `site/` on `http://localhost:8080`.

- [ ] **Step 1: Write the dev server**

~~~js title=tools/serve.js
// Dev-only static server for site/ (no dependencies). Usage: npm run serve
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize, resolve, sep } from "node:path";

const root = resolve("site");
const port = Number(process.env.PORT || 8080);
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".webmanifest": "application/manifest+json",
  ".json": "application/json",
};

createServer(async (req, res) => {
  try {
    let path = decodeURIComponent(new URL(req.url, "http://localhost").pathname);
    if (path.endsWith("/")) path += "index.html";
    const file = normalize(join(root, path));
    if (file !== root && !file.startsWith(root + sep)) {
      res.writeHead(403).end();
      return;
    }
    const body = await readFile(file);
    res.writeHead(200, { "Content-Type": TYPES[extname(file)] ?? "application/octet-stream", "Cache-Control": "no-cache" });
    res.end(body);
  } catch {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" }).end("Not found");
  }
}).listen(port, () => console.log(`Serving site/ on http://localhost:${port}/`));
~~~

- [ ] **Step 2: Write the page shell, manifest, service worker and icon**

~~~html title=site/index.html
<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; connect-src https://intervals.icu; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; form-action 'none'; object-src 'none'">
  <meta name="referrer" content="no-referrer">
  <title>HM sub-1:30 · Training calendar</title>
  <meta name="description" content="HM sub-1:30 training plan, today's workout and your runs, live from intervals.icu.">
  <meta name="theme-color" content="#f4f6fb" media="(prefers-color-scheme: light)">
  <meta name="theme-color" content="#0a0f1c" media="(prefers-color-scheme: dark)">
  <meta name="mobile-web-app-capable" content="yes">
  <meta name="apple-mobile-web-app-title" content="HM 1:30">
  <link rel="manifest" href="manifest.webmanifest">
  <link rel="icon" href="icons/icon.svg" type="image/svg+xml">
  <link rel="apple-touch-icon" href="icons/apple-touch-icon.png">
  <link rel="stylesheet" href="styles.css">
  <script type="module" src="src/app.js"></script>
</head>
<body>
  <a class="skip" href="#today">Skip to today</a>
  <div id="app" aria-busy="true">
    <main id="main" class="setup"><section class="card setup-card"><p>Loading…</p></section></main>
  </div>
  <div id="live" class="sr-only" aria-live="polite" aria-atomic="true"></div>

  <dialog id="details" class="sheet" aria-labelledby="details-title">
    <div class="sheet-inner">
      <div class="sheet-grip" aria-hidden="true"><span></span></div>
      <div class="sheet-head">
        <div>
          <p class="eyebrow" id="details-eyebrow"></p>
          <h2 id="details-title"></h2>
        </div>
        <button type="button" class="icon-btn" data-action="close" aria-label="Close">
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>
        </button>
      </div>
      <div class="sheet-body" id="details-body"></div>
      <div class="sheet-foot">
        <button type="button" class="btn ghost" data-action="prev"><span aria-hidden="true">‹</span> Previous day</button>
        <button type="button" class="btn ghost" data-action="next">Next day <span aria-hidden="true">›</span></button>
      </div>
    </div>
  </dialog>

  <dialog id="settings" class="modal" aria-labelledby="settings-title">
    <div class="modal-inner">
      <div class="sheet-head">
        <h2 id="settings-title">Settings</h2>
        <button type="button" class="icon-btn" data-action="close" aria-label="Close">
          <svg class="icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M6 6l12 12"/><path d="M18 6L6 18"/></svg>
        </button>
      </div>
      <p id="settings-athlete" class="muted"></p>
      <fieldset class="field">
        <legend>Theme</legend>
        <div class="segmented">
          <label><input type="radio" name="theme" value="system"> System</label>
          <label><input type="radio" name="theme" value="light"> Light</label>
          <label><input type="radio" name="theme" value="dark"> Dark</label>
        </div>
      </fieldset>
      <label class="switch"><input type="checkbox" name="shortcut"> Press <kbd>T</kbd> to jump to today</label>
      <div class="settings-actions">
        <button type="button" class="btn" data-action="refresh">Refresh now</button>
        <button type="button" class="btn danger" data-action="forget">Forget key on this device</button>
      </div>
      <p class="muted small">The key is stored only in this browser. To revoke it everywhere, clear the API key in <a href="https://intervals.icu/settings" target="_blank" rel="noopener noreferrer">intervals.icu settings<span class="sr-only"> (opens in a new tab)</span></a> under Developer Settings.</p>
    </div>
  </dialog>
</body>
</html>
~~~

~~~json title=site/manifest.webmanifest
{
  "name": "HM sub-1:30 training calendar",
  "short_name": "HM 1:30",
  "description": "HM sub-1:30 plan, today's workout and your runs, live from intervals.icu.",
  "start_url": "./",
  "scope": "./",
  "display": "standalone",
  "background_color": "#0a0f1c",
  "theme_color": "#2563eb",
  "icons": [
    { "src": "icons/icon-192.png", "sizes": "192x192", "type": "image/png" },
    { "src": "icons/icon-512.png", "sizes": "512x512", "type": "image/png" },
    { "src": "icons/icon.svg", "sizes": "any", "type": "image/svg+xml" }
  ]
}
~~~

~~~js title=site/sw.js
// Offline copy of the app files. Never touches intervals.icu requests.
// Cache-first, refreshed in the background so a new deploy shows on the next visit.
const CACHE = "tc-shell-v1";
const FILES = [
  "./",
  "index.html",
  "styles.css",
  "manifest.webmanifest",
  "src/app.js",
  "src/api.js",
  "src/config.js",
  "src/dates.js",
  "src/model.js",
  "src/workout.js",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
];

self.addEventListener("install", event => {
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith("tc-shell-") && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request, { ignoreSearch: true });
    const network = fetch(request)
      .then(response => {
        if (response.ok) cache.put(request, response.clone());
        return response;
      })
      .catch(() => null);
    if (cached) {
      event.waitUntil(network);
      return cached;
    }
    const response = await network;
    if (response) return response;
    if (request.mode === "navigate") {
      const shell = await cache.match("index.html");
      if (shell) return shell;
    }
    return new Response("Offline", { status: 503, statusText: "Offline" });
  })());
});
~~~

~~~svg title=site/icons/icon.svg
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#2563eb"/>
      <stop offset="1" stop-color="#7c3aed"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#g)"/>
  <g fill="#ffffff">
    <rect x="120" y="340" width="56" height="64" rx="10" opacity=".55"/>
    <rect x="192" y="300" width="56" height="104" rx="10" opacity=".7"/>
    <rect x="264" y="250" width="56" height="154" rx="10" opacity=".85"/>
    <rect x="336" y="196" width="56" height="208" rx="10"/>
  </g>
  <text x="256" y="178" text-anchor="middle" font-family="Segoe UI, system-ui, -apple-system, sans-serif" font-size="132" font-weight="800" fill="#ffffff">1:30</text>
</svg>
~~~

- [ ] **Step 3: Write the stylesheet**

~~~css title=site/styles.css
/* HM sub-1:30 training calendar. Plain CSS: light and dark themes, phone and PC layouts. */

:root {
  color-scheme: light;
  --bg: #f4f6fb;
  --surface: #ffffff;
  --surface-2: #eef1f7;
  --fg: #0f172a;
  --muted: #55607a;
  --border: #dde2ec;
  --accent: #2563eb;
  --accent-fg: #ffffff;
  --accent-soft: #e3ecff;
  --ok: #15803d;
  --warn: #b45309;
  --danger: #b91c1c;
  --easy: #16a34a;
  --long: #0284c7;
  --threshold: #d97706;
  --intervals: #dc2626;
  --race: #7c3aed;
  --rest: #94a3b8;
  --on-easy: #ffffff;
  --on-long: #ffffff;
  --on-threshold: #1f1300;
  --on-intervals: #ffffff;
  --on-race: #ffffff;
  --shadow: 0 1px 2px rgb(15 23 42 / 0.05), 0 10px 30px rgb(15 23 42 / 0.06);
  --radius: 18px;
  --font: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --mono: ui-monospace, "Cascadia Mono", "SF Mono", Consolas, monospace;
}

:root[data-theme="dark"] {
  color-scheme: dark;
  --bg: #0a0f1c;
  --surface: #111a2c;
  --surface-2: #19233a;
  --fg: #e8ecf4;
  --muted: #9ba7be;
  --border: #253149;
  --accent: #6ea8ff;
  --accent-fg: #0a0f1c;
  --accent-soft: #18284a;
  --ok: #4ade80;
  --warn: #fbbf24;
  --danger: #f87171;
  --easy: #34d399;
  --long: #38bdf8;
  --threshold: #fbbf24;
  --intervals: #f87171;
  --race: #a78bfa;
  --rest: #56627c;
  --on-easy: #06281a;
  --on-long: #062235;
  --on-threshold: #2a1a00;
  --on-intervals: #2d0a0a;
  --on-race: #1d1140;
  --shadow: 0 1px 2px rgb(0 0 0 / 0.4), 0 12px 32px rgb(0 0 0 / 0.3);
}

@media (prefers-color-scheme: dark) {
  :root:not([data-theme="light"]) {
    color-scheme: dark;
    --bg: #0a0f1c;
    --surface: #111a2c;
    --surface-2: #19233a;
    --fg: #e8ecf4;
    --muted: #9ba7be;
    --border: #253149;
    --accent: #6ea8ff;
    --accent-fg: #0a0f1c;
    --accent-soft: #18284a;
    --ok: #4ade80;
    --warn: #fbbf24;
    --danger: #f87171;
    --easy: #34d399;
    --long: #38bdf8;
    --threshold: #fbbf24;
    --intervals: #f87171;
    --race: #a78bfa;
    --rest: #56627c;
    --on-easy: #06281a;
    --on-long: #062235;
    --on-threshold: #2a1a00;
    --on-intervals: #2d0a0a;
    --on-race: #1d1140;
    --shadow: 0 1px 2px rgb(0 0 0 / 0.4), 0 12px 32px rgb(0 0 0 / 0.3);
  }
}

/* ---------- base ---------- */
*, *::before, *::after { box-sizing: border-box; }
html { -webkit-text-size-adjust: 100%; text-size-adjust: 100%; }
html:has(dialog[open]) { overflow: hidden; }
body {
  margin: 0;
  min-height: 100dvh;
  background: var(--bg);
  color: var(--fg);
  font: 16px/1.5 var(--font);
  -webkit-font-smoothing: antialiased;
}
h1, h2, h3 { line-height: 1.2; letter-spacing: -0.01em; }
h2 { font-size: 1.15rem; margin: 0; }
h3 { font-size: 1.05rem; margin: 0; }
a { color: var(--accent); }
button, input { font: inherit; color: inherit; }
kbd {
  font-family: var(--mono);
  font-size: 0.85em;
  padding: 1px 6px;
  border: 1px solid var(--border);
  border-bottom-width: 2px;
  border-radius: 6px;
  background: var(--surface-2);
}
:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
.sr-only {
  position: absolute !important;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0 0 0 0);
  white-space: nowrap;
  border: 0;
}
.skip {
  position: absolute;
  left: 8px;
  top: -64px;
  z-index: 100;
  padding: 8px 14px;
  border-radius: 8px;
  background: var(--accent);
  color: var(--accent-fg);
  font-weight: 700;
  text-decoration: none;
}
.skip:focus { top: 8px; }
.muted { color: var(--muted); }
.small { font-size: 0.85rem; }
.icon {
  width: 20px;
  height: 20px;
  flex: none;
  fill: none;
  stroke: currentColor;
  stroke-width: 2;
  stroke-linecap: round;
  stroke-linejoin: round;
}

/* colour groups: --c is the type colour, --on the text drawn on top of it */
.g-easy { --c: var(--easy); --on: var(--on-easy); }
.g-long { --c: var(--long); --on: var(--on-long); }
.g-threshold { --c: var(--threshold); --on: var(--on-threshold); }
.g-intervals { --c: var(--intervals); --on: var(--on-intervals); }
.g-race { --c: var(--race); --on: var(--on-race); }
.g-rest { --c: var(--rest); --on: var(--fg); }
.g-empty { --c: var(--border); --on: var(--fg); }
.lv-easy { --c: var(--easy); }
.lv-long { --c: var(--long); }
.lv-threshold { --c: var(--threshold); }
.lv-intervals { --c: var(--intervals); }
.lv-race { --c: var(--race); }
.lv-rest { --c: var(--rest); }

/* ---------- buttons and links ---------- */
.btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  gap: 8px;
  min-height: 40px;
  padding: 8px 16px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--surface);
  font-weight: 600;
  cursor: pointer;
  text-decoration: none;
}
.btn:hover:not(:disabled) { background: var(--surface-2); }
.btn.primary { background: var(--accent); border-color: transparent; color: var(--accent-fg); }
.btn.primary:hover:not(:disabled) { background: color-mix(in srgb, var(--accent) 88%, var(--fg)); }
.btn.ghost { background: transparent; }
.btn.small { min-height: 32px; padding: 4px 12px; font-size: 0.85rem; }
.btn.block { width: 100%; min-height: 48px; }
.btn.danger { color: var(--danger); border-color: color-mix(in srgb, var(--danger) 40%, var(--border)); }
.btn:disabled, .icon-btn:disabled { opacity: 0.45; cursor: default; }
.icon-btn {
  width: 40px;
  height: 40px;
  display: inline-grid;
  place-items: center;
  flex: none;
  border: 1px solid transparent;
  border-radius: 10px;
  background: transparent;
  cursor: pointer;
}
.icon-btn:hover:not(:disabled) { background: var(--surface-2); }
.link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-weight: 600;
  text-decoration: none;
}
.link:hover { text-decoration: underline; }
.link .icon { width: 16px; height: 16px; }

/* ---------- header ---------- */
.top {
  position: sticky;
  top: 0;
  z-index: 10;
  background: color-mix(in srgb, var(--bg) 86%, transparent);
  backdrop-filter: saturate(1.4) blur(12px);
  -webkit-backdrop-filter: saturate(1.4) blur(12px);
  border-bottom: 1px solid var(--border);
}
.top-inner {
  max-width: 1320px;
  margin: 0 auto;
  padding: max(12px, env(safe-area-inset-top)) 16px 12px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}
.brand { min-width: 0; }
.brand h1 { margin: 0; font-size: 1.2rem; }
.sub { margin: 2px 0 0; font-size: 0.82rem; color: var(--muted); }
.actions { display: flex; align-items: center; gap: 6px; flex: none; }
.status-btn {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  min-height: 40px;
  padding: 6px 12px;
  border-radius: 999px;
  border: 1px solid var(--border);
  background: var(--surface);
  color: var(--muted);
  font-size: 0.8rem;
  cursor: pointer;
}
.status-btn:hover { color: var(--fg); }
.status-btn .icon { width: 16px; height: 16px; }
.status-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--ok); flex: none; }
.status-btn.idle .status-dot { background: var(--muted); }
.status-btn.loading .status-dot { background: var(--accent); }
.status-btn.offline .status-dot { background: var(--warn); }
.status-btn.error .status-dot { background: var(--danger); }
.progress { height: 3px; background: var(--border); }
.progress span {
  display: block;
  width: var(--p, 0%);
  height: 100%;
  background: linear-gradient(90deg, var(--accent), var(--race));
}

/* ---------- layout ---------- */
.layout {
  max-width: 1320px;
  margin: 0 auto;
  padding: 16px 16px calc(96px + env(safe-area-inset-bottom));
  display: grid;
  gap: 16px;
}
.card {
  background: var(--surface);
  border: 1px solid var(--border);
  border-radius: var(--radius);
  padding: 20px;
  box-shadow: var(--shadow);
  min-width: 0;
}
.section-head {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 14px;
}
.section-head p { margin: 2px 0 0; }
.week-nav { display: flex; align-items: center; gap: 4px; flex: none; }

/* ---------- today ---------- */
.today {
  position: relative;
  overflow: hidden;
  scroll-margin-top: 96px;
  border-color: color-mix(in srgb, var(--accent) 40%, var(--border));
}
.today::before {
  content: "";
  position: absolute;
  inset: 0 0 auto 0;
  height: 4px;
  background: linear-gradient(90deg, var(--accent), var(--race));
}
.today:focus { outline: none; }
.today:focus-visible { outline: 3px solid var(--accent); outline-offset: 2px; }
.eyebrow {
  margin: 0 0 6px;
  font-size: 0.75rem;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--accent);
}
.workout + .workout { margin-top: 24px; padding-top: 20px; border-top: 1px solid var(--border); }
.workout-title { margin: 0; font-size: 1.3rem; }
.today .workout-title { font-size: clamp(1.6rem, 5vw, 2.15rem); }
.workout-meta { margin: 6px 0 0; color: var(--muted); }
.workout-note {
  display: inline-block;
  margin: 10px 0 0;
  padding: 4px 12px;
  border-radius: 999px;
  background: var(--surface-2);
  font-size: 0.85rem;
  font-weight: 600;
}
.bar { display: block; width: 100%; height: 64px; margin: 18px 0 10px; }
.bar rect { fill: var(--c); }
.steps { list-style: none; margin: 0; padding: 0; }
.step {
  display: grid;
  grid-template-columns: 10px minmax(0, 1fr) auto auto;
  align-items: baseline;
  gap: 10px;
  padding: 7px 0;
  border-bottom: 1px solid var(--border);
  font-variant-numeric: tabular-nums;
}
.step-dot { width: 8px; height: 8px; border-radius: 50%; background: var(--c); align-self: center; }
.step-name { font-weight: 600; }
.step-amount { color: var(--muted); }
.step-pace { min-width: 7.5em; text-align: right; font-weight: 700; }
.repeat { padding: 8px 0 2px; border-bottom: 1px solid var(--border); }
.repeat-label { font-weight: 800; }
.steps.nested { margin: 4px 0 4px 6px; padding-left: 12px; border-left: 2px solid var(--border); }
.steps.nested .step:last-child { border-bottom: 0; }
.run {
  margin-top: 16px;
  padding: 14px 16px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--ok) 10%, var(--surface));
  border: 1px solid color-mix(in srgb, var(--ok) 30%, var(--border));
}
.run-title { margin: 0; display: flex; align-items: center; gap: 8px; font-weight: 700; }
.run-check {
  display: inline-grid;
  place-items: center;
  width: 22px;
  height: 22px;
  border-radius: 50%;
  background: var(--ok);
  color: var(--surface);
  font-size: 0.8rem;
}
.run-stats {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(96px, 1fr));
  gap: 10px 16px;
  margin: 12px 0;
}
.stat dt { font-size: 0.72rem; letter-spacing: 0.05em; text-transform: uppercase; color: var(--muted); }
.stat dd { margin: 0; font-size: 1.05rem; font-weight: 700; font-variant-numeric: tabular-nums; }
.pending { margin: 14px 0 0; color: var(--muted); font-weight: 600; }
.pending.missed { color: var(--danger); }
.card-foot { display: flex; justify-content: flex-end; margin-top: 16px; }
.preview {
  display: grid;
  gap: 2px;
  width: 100%;
  margin-top: 16px;
  padding: 12px 14px 12px 18px;
  border: 1px solid var(--border);
  border-radius: 14px;
  background: var(--surface-2);
  text-align: left;
  cursor: pointer;
  position: relative;
}
.preview::before {
  content: "";
  position: absolute;
  inset: 10px auto 10px 8px;
  width: 4px;
  border-radius: 2px;
  background: var(--c);
}
.preview-label { font-size: 0.75rem; color: var(--muted); font-weight: 600; }
.preview-name { font-weight: 700; }
.preview-meta { font-size: 0.85rem; color: var(--muted); }

/* ---------- week ---------- */
.km { margin-bottom: 12px; }
.km-text { margin: 0 0 6px; color: var(--muted); }
.km-text strong { color: var(--fg); font-size: 1.1rem; }
.meter { height: 6px; border-radius: 3px; background: var(--surface-2); overflow: hidden; }
.meter span { display: block; width: var(--p, 0%); height: 100%; border-radius: inherit; background: var(--accent); }
.week-list { list-style: none; margin: 0; padding: 0; display: grid; gap: 2px; touch-action: pan-y; }
.week-row {
  width: 100%;
  display: grid;
  grid-template-columns: 6px 40px minmax(0, 1fr) auto auto;
  align-items: center;
  gap: 12px;
  padding: 10px 12px;
  border: 0;
  border-radius: 12px;
  background: transparent;
  text-align: left;
  cursor: pointer;
}
.week-row:hover { background: var(--surface-2); }
.week-row.is-today { background: var(--accent-soft); }
.type-bar { width: 6px; height: 30px; border-radius: 3px; background: var(--c); }
.week-row.g-rest .type-bar, .week-row.g-empty .type-bar { opacity: 0.6; }
.wr-date { display: grid; line-height: 1.1; }
.wr-wd { font-size: 0.7rem; font-weight: 600; letter-spacing: 0.05em; text-transform: uppercase; color: var(--muted); }
.wr-d { font-size: 1.05rem; font-weight: 700; font-variant-numeric: tabular-nums; }
.wr-name { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 600; }
.week-row.g-rest .wr-name, .week-row.g-empty .wr-name { color: var(--muted); font-weight: 500; }
.wr-km { color: var(--muted); font-size: 0.9rem; font-variant-numeric: tabular-nums; }
.chip {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  margin: 0;
  padding: 2px 10px;
  border-radius: 999px;
  font-size: 0.78rem;
  font-weight: 700;
  white-space: nowrap;
  background: var(--surface-2);
  color: var(--muted);
}
.chip.s-done { color: var(--ok); background: color-mix(in srgb, var(--ok) 14%, transparent); }
.chip.s-partial { color: var(--warn); background: color-mix(in srgb, var(--warn) 14%, transparent); }
.chip.s-missed { color: var(--danger); background: color-mix(in srgb, var(--danger) 12%, transparent); }
.chip.s-today { color: var(--accent); background: color-mix(in srgb, var(--accent) 14%, transparent); }
.sheet-body > .chip { margin-bottom: 12px; }

/* ---------- plan grid ---------- */
.grid-wrap { overflow-x: auto; margin: 0 -4px; padding: 4px; }
.plan-grid { width: 100%; border-collapse: separate; border-spacing: 4px; table-layout: fixed; }
.plan-grid th { font-size: 0.7rem; font-weight: 600; color: var(--muted); text-align: center; padding: 0; }
.plan-grid td { padding: 0; }
.plan-grid .wk-col { width: 68px; text-align: left; }
.wk-num { display: block; font-size: 0.8rem; font-weight: 800; color: var(--fg); }
.wk-phase {
  display: block;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.66rem;
  font-weight: 500;
  color: var(--muted);
}
tr.is-current .wk-num { color: var(--accent); }
.plan-grid .km-col { width: 64px; text-align: right; font-size: 0.72rem; color: var(--muted); font-variant-numeric: tabular-nums; }
.mini-meter { display: block; height: 4px; margin-top: 4px; border-radius: 2px; background: var(--surface-2); overflow: hidden; }
.mini-meter span { display: block; width: var(--p, 0%); height: 100%; background: var(--accent); }
.cell {
  position: relative;
  display: grid;
  place-items: center;
  width: 100%;
  min-width: 26px;
  aspect-ratio: 1;
  padding: 0;
  border: 0;
  border-radius: 9px;
  background: color-mix(in srgb, var(--c) 20%, var(--surface));
  font-size: 0.72rem;
  cursor: pointer;
}
.cell:hover { background: color-mix(in srgb, var(--c) 32%, var(--surface)); }
.cell.g-rest {
  background: repeating-linear-gradient(135deg, var(--surface-2) 0 4px, transparent 4px 8px);
  box-shadow: inset 0 0 0 1px var(--border);
}
.cell.g-empty { background: transparent; box-shadow: inset 0 0 0 1px var(--border); }
.cell.s-done { background: var(--c); color: var(--on); }
.cell.s-missed { box-shadow: inset 0 0 0 2px var(--danger); }
.cell.is-today { box-shadow: 0 0 0 2px var(--surface), 0 0 0 4px var(--accent); }
.cell.is-today.s-missed { box-shadow: inset 0 0 0 2px var(--danger), 0 0 0 2px var(--surface), 0 0 0 4px var(--accent); }
.cell-day { font-weight: 700; font-variant-numeric: tabular-nums; }
.cell-icon { position: absolute; top: 1px; right: 4px; font-size: 0.66rem; font-weight: 800; }
.cell.s-missed .cell-icon { color: var(--danger); }
.cell-mark { position: absolute; bottom: 1px; left: 4px; font-size: 0.58rem; font-weight: 800; }
.legend {
  list-style: none;
  display: flex;
  flex-wrap: wrap;
  gap: 8px 14px;
  margin: 14px 0 0;
  padding: 0;
  font-size: 0.78rem;
  color: var(--muted);
}
.legend li { display: inline-flex; align-items: center; gap: 6px; }
.swatch { width: 12px; height: 12px; border-radius: 3px; background: var(--c); }
.swatch.g-rest { background: repeating-linear-gradient(135deg, var(--rest) 0 2px, transparent 2px 4px); box-shadow: inset 0 0 0 1px var(--border); }
.swatch.ring { background: transparent; box-shadow: 0 0 0 2px var(--accent); }
.glyph { font-weight: 800; color: var(--fg); }
.glyph.ok { color: var(--ok); }
.glyph.bad { color: var(--danger); }

/* ---------- details sheet and settings ---------- */
dialog { border: 0; padding: 0; color: var(--fg); background: var(--surface); }
dialog::backdrop { background: rgb(2 6 23 / 0.55); backdrop-filter: blur(2px); }
.sheet {
  position: fixed;
  inset: auto 0 0 0;
  width: 100%;
  max-width: 100%;
  max-height: 90dvh;
  margin: 0;
  border-radius: 22px 22px 0 0;
  box-shadow: var(--shadow);
}
.sheet-inner { display: flex; flex-direction: column; max-height: 90dvh; }
.sheet-grip { display: grid; place-items: center; padding: 8px 0 0; cursor: grab; touch-action: none; }
.sheet-grip span { width: 40px; height: 5px; border-radius: 3px; background: var(--border); }
.sheet-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 12px; padding: 12px 20px 8px; }
.sheet-head h2 { margin: 0; font-size: 1.35rem; }
.sheet-body { overflow-y: auto; overscroll-behavior: contain; padding: 4px 20px 16px; }
.sheet-foot {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  padding: 12px 20px calc(12px + env(safe-area-inset-bottom));
  border-top: 1px solid var(--border);
}
.details-link { margin: 20px 0 0; }
.also { margin-top: 20px; }
.also ul { margin: 8px 0 0; padding-left: 1.1em; }
.modal { width: min(460px, calc(100% - 32px)); border-radius: 20px; box-shadow: var(--shadow); }
.modal-inner { padding: 8px 4px 20px; }
.modal-inner > :not(.sheet-head) { margin-left: 20px; margin-right: 20px; }
.field { border: 0; padding: 0; margin-top: 16px; margin-bottom: 0; }
.field legend { font-weight: 700; margin-bottom: 8px; }
.segmented { display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px; padding: 4px; border-radius: 12px; background: var(--surface-2); }
.segmented label { position: relative; display: flex; align-items: center; justify-content: center; gap: 6px; min-height: 40px; border-radius: 9px; cursor: pointer; font-weight: 600; }
.segmented label:has(input:checked) { background: var(--surface); box-shadow: var(--shadow); }
.segmented label:has(input:focus-visible) { outline: 3px solid var(--accent); outline-offset: 1px; }
.segmented input { position: absolute; opacity: 0; pointer-events: none; }
.switch { display: flex; align-items: center; gap: 10px; margin-top: 16px; font-weight: 600; cursor: pointer; }
.switch input { width: 20px; height: 20px; accent-color: var(--accent); }
.settings-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 20px; }

/* ---------- setup, loading, errors ---------- */
.setup { min-height: 100dvh; display: grid; place-items: center; padding: 24px 16px; }
.setup-card { width: min(480px, 100%); padding: 28px; }
.setup-card h1 { margin: 14px 0 6px; font-size: 1.6rem; }
.logo { display: block; border-radius: 14px; }
.lead { margin: 0 0 12px; color: var(--muted); }
.setup-steps { margin: 0 0 8px; padding-left: 1.3em; color: var(--muted); }
.setup-steps li { margin: 4px 0; }
.setup-form { display: grid; gap: 8px; margin-top: 18px; }
.setup-form label { font-weight: 700; }
.key-row { display: flex; gap: 8px; }
.key-row input {
  flex: 1;
  min-width: 0;
  min-height: 46px;
  padding: 8px 12px;
  border: 1px solid var(--border);
  border-radius: 10px;
  background: var(--surface-2);
  font-family: var(--mono);
}
.key-row input[aria-invalid="true"] { border-color: var(--danger); }
.error { margin: 0; min-height: 1.5em; color: var(--danger); font-weight: 600; }
.row { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
.loading { display: grid; justify-items: center; gap: 12px; text-align: center; }
.spinner {
  width: 32px;
  height: 32px;
  border-radius: 50%;
  border: 3px solid var(--border);
  border-top-color: var(--accent);
  animation: spin 0.9s linear infinite;
}

/* ---------- floating Today button (phone) ---------- */
.fab {
  position: fixed;
  right: 16px;
  bottom: calc(16px + env(safe-area-inset-bottom));
  z-index: 20;
  min-height: 48px;
  padding: 0 22px;
  border: 0;
  border-radius: 999px;
  background: var(--accent);
  color: var(--accent-fg);
  font-weight: 700;
  box-shadow: 0 8px 24px color-mix(in srgb, var(--accent) 40%, transparent);
  cursor: pointer;
}

/* ---------- responsive ---------- */
@media (max-width: 479px) {
  .status-text { display: none; }
  .card { padding: 16px; }
  .plan-grid { border-spacing: 3px; }
  .plan-grid .wk-col { width: 40px; }
  .wk-phase { display: none; }
  .plan-grid .km-col { width: 48px; }
  .week-row { gap: 10px; padding: 10px 8px; }
}
@media (max-width: 1023px) {
  .today-btn { display: none; }
}
@media (min-width: 1024px) {
  .layout {
    grid-template-columns: minmax(0, 5fr) minmax(0, 6fr);
    grid-template-areas: "today plan" "week plan";
    align-items: start;
    gap: 24px;
    padding: 24px 24px 48px;
  }
  .today { grid-area: today; }
  .week { grid-area: week; }
  .plan { grid-area: plan; position: sticky; top: 88px; }
  .fab { display: none; }
  .sheet {
    inset: 0 0 0 auto;
    width: min(480px, 100%);
    height: 100dvh;
    max-height: 100dvh;
    border-radius: 0;
    border-left: 1px solid var(--border);
  }
  .sheet-inner { height: 100%; max-height: 100dvh; }
  .sheet-grip { display: none; }
}

/* ---------- motion ---------- */
@keyframes spin { to { transform: rotate(360deg); } }
@keyframes sheet-up { from { transform: translateY(24px); opacity: 0; } }
@keyframes panel-in { from { transform: translateX(24px); opacity: 0; } }
@media (prefers-reduced-motion: no-preference) {
  .sheet[open] { animation: sheet-up 0.22s ease-out; }
  .modal[open] { animation: sheet-up 0.18s ease-out; }
  .status-btn.loading .icon { animation: spin 0.9s linear infinite; }
  .week-row, .cell, .btn, .icon-btn { transition: background-color 0.15s ease; }
}
@media (prefers-reduced-motion: no-preference) and (min-width: 1024px) {
  .sheet[open] { animation-name: panel-in; }
}
@media (prefers-reduced-motion: reduce) {
  .spinner { animation-duration: 2.4s; }
}

/* ---------- Windows high contrast ---------- */
@media (forced-colors: active) {
  .cell, .week-row, .chip, .preview, .status-btn { border: 1px solid CanvasText; }
  .cell.is-today, .week-row.is-today { outline: 3px solid Highlight; outline-offset: 1px; }
  .bar rect, .type-bar, .step-dot, .swatch, .meter span, .mini-meter span, .progress span { forced-color-adjust: none; }
}
~~~

- [ ] **Step 4: Render the PNG icons from the SVG**

Start the dev server (bash, long-lived service named `tc-serve`, ready on port 8080): `npm run serve`.
Then render with the agent browser (JavaScript eval cell):

```js
const tab = await browser.open({ name: "icons", url: "http://localhost:8080/icons/icon.svg", viewport: { width: 512, height: 512 } });
await tab.run(async ({ page }) => {
  const root = "C:/Users/tvtrinh/Desktop/hahaha/training-calendar/site/icons";
  for (const [size, file, fill] of [[512, "icon-512.png", null], [192, "icon-192.png", null], [180, "apple-touch-icon.png", "#3f4fe0"]]) {
    await page.setViewport({ width: size, height: size, deviceScaleFactor: 1 });
    await page.goto("http://localhost:8080/icons/icon.svg");
    if (fill) await page.evaluate(c => { document.documentElement.style.background = c; }, fill);
    await page.screenshot({ path: `${root}/${file}`, omitBackground: !fill });
  }
});
await tab.close();
```

Expected: three PNG files exist; reading `site/icons/icon-512.png` shows the rounded gradient icon with "1:30" and four bars on a transparent background; `apple-touch-icon.png` is 180×180 with a solid background.

- [ ] **Step 5: Verify the shell loads**

`site/src/app.js` arrives in Task 6, so this step checks the static files only.
Run (bash): `curl -s -o /dev/null -w "%{http_code} %{content_type}\n" http://localhost:8080/ http://localhost:8080/styles.css http://localhost:8080/sw.js http://localhost:8080/manifest.webmanifest http://localhost:8080/icons/icon.svg http://localhost:8080/icons/icon-192.png`
Expected: six lines starting with `200`, types `text/html`, `text/css`, `text/javascript`, `application/manifest+json`, `image/svg+xml`, `image/png`.
Run: `curl -s --path-as-is -o /dev/null -w "%{http_code}\n" http://localhost:8080/../package.json`
Expected: `404` or `403` (no files outside `site/`).

- [ ] **Step 6: Commit**

```bash
git add tools/serve.js site/index.html site/manifest.webmanifest site/sw.js site/styles.css site/icons
git commit -m "feat: page shell, styles, icons and offline cache"
```

### Task 6: App UI

**Files:**
- Create: `site/src/app.js`

**Interfaces:**
- Consumes: everything from Tasks 1–5 (exact names in their Produces blocks); DOM ids from Task 5.
- Produces: the running page. No exports.

- [ ] **Step 1: Write the module**

~~~js title=site/src/app.js
// The page: rendering and interaction. All data logic lives in the pure modules.
import { PLAN } from "./config.js";
import { KeyError, NetworkError, connect, createStore, refresh } from "./api.js";
import { WEEKDAYS, addDays, clampWeek, formatDate, formatDuration, formatKm, localToday, timeAgo, weekNumber } from "./dates.js";
import { GROUP, TYPE_LABEL, formatStepAmount, noteText, paceRange, shortName, stepLevel, stepName, workoutBar } from "./workout.js";
import { buildModel, dayLabel, dayUrl, headerInfo, runSummary, statusInfo } from "./model.js";

let storage = null;
try {
  storage = window.localStorage;
} catch {
  storage = null;
}
const store = createStore(storage);

const app = document.getElementById("app");
const live = document.getElementById("live");
const details = document.getElementById("details");
const settings = document.getElementById("settings");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)");

const state = {
  data: null,
  model: null,
  today: localToday(),
  viewWeek: null,
  focusDate: null,
  status: { kind: "idle", message: "" },
  hiddenAt: 0,
  detailsDate: null,
  opener: null,
};

const SVG_NS = "http://www.w3.org/2000/svg";
const MARKS = { test: "T", key: "K", race: "R" };
const NEW_TAB = " (opens in a new tab)";
const ICONS = {
  refresh: ["M20 11a8 8 0 1 0-2.34 5.66", "M20 4v7h-7"],
  settings: ["M4 7h9", "M17 7h3", "M4 17h3", "M11 17h9", "M15 5v4", "M9 15v4"],
  left: ["M15 18l-6-6 6-6"],
  right: ["M9 18l6-6-6-6"],
  external: ["M14 4h6v6", "M20 4l-9 9", "M19 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6a1 1 0 0 1 1-1h5"],
};
const FOCUS_FALLBACK = {
  "btn:this-week": ["btn:prev-week", "btn:next-week"],
  "btn:prev-week": ["btn:next-week"],
  "btn:next-week": ["btn:prev-week"],
};

// ---------- helpers ----------
function h(tag, props, ...children) {
  const isSvg = tag.startsWith("svg:");
  const el = isSvg ? document.createElementNS(SVG_NS, tag.slice(4)) : document.createElement(tag);
  for (const [k, v] of Object.entries(props ?? {})) {
    if (v == null || v === false) continue;
    if (k === "text") el.textContent = v;
    else if (k === "style") for (const [p, val] of Object.entries(v)) el.style.setProperty(p, val);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false || c === "") continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return el;
}

function icon(name) {
  return h("svg:svg", { class: "icon", viewBox: "0 0 24 24", "aria-hidden": "true", focusable: "false" },
    ICONS[name].map(d => h("svg:path", { d })));
}

function externalLink(href, label) {
  return h("a", { class: "link", href, target: "_blank", rel: "noopener noreferrer" },
    label, icon("external"), h("span", { class: "sr-only", text: NEW_TAB }));
}

function announce(message) {
  live.textContent = "";
  window.setTimeout(() => { live.textContent = message; }, 60);
}

function applyTheme(theme) {
  if (theme === "light" || theme === "dark") document.documentElement.dataset.theme = theme;
  else delete document.documentElement.dataset.theme;
}

const hasData = data => Boolean(data && Array.isArray(data.events));
const currentWeek = () => clampWeek(weekNumber(state.today, PLAN), PLAN);
const pct = (part, whole) => `${(whole ? Math.min(100, (part / whole) * 100) : 0).toFixed(1)}%`;
const byKey = key => app.querySelector(`[data-key="${CSS.escape(key)}"]`);

// ---------- state → page ----------
function rebuild() {
  state.today = localToday();
  state.model = buildModel(state.data, state.today, PLAN);
  if (state.viewWeek == null) state.viewWeek = currentWeek();
  if (!state.focusDate || !state.model.byDate.has(state.focusDate)) {
    state.focusDate = state.model.byDate.has(state.today) ? state.today : state.model.days[0].date;
  }
}

function render() {
  if (!state.model) rebuild();
  const active = document.activeElement;
  const activeKey = active && app.contains(active) ? active.dataset.key : null;
  app.replaceChildren(
    renderHeader(),
    h("main", { id: "main", class: "layout" }, renderToday(), renderWeek(), renderPlan()),
    h("button", { type: "button", class: "fab", "data-key": "btn:fab", onclick: goToToday }, "Today"),
  );
  app.removeAttribute("aria-busy");
  if (activeKey) restoreFocus(activeKey);
  if (details.open && state.detailsDate) fillDetails(state.detailsDate);
}

function restoreFocus(key) {
  for (const k of [key, ...(FOCUS_FALLBACK[key] ?? [])]) {
    const el = byKey(k);
    if (el && !el.disabled) {
      el.focus({ preventScroll: true });
      return;
    }
  }
}

// ---------- header ----------
function statusText() {
  const at = state.data?.fetchedAt;
  const when = at ? timeAgo(at) : "";
  switch (state.status.kind) {
    case "loading": return "Updating…";
    case "offline": return when ? `Offline · updated ${when}` : "Offline";
    case "error": return when ? `Couldn't update · updated ${when}` : "Couldn't update";
    default: return when ? `Updated ${when}` : "Not updated yet";
  }
}

function renderHeader() {
  const info = headerInfo(state.today, PLAN);
  return h("header", { class: "top" },
    h("div", { class: "top-inner" },
      h("div", { class: "brand" },
        h("h1", { text: PLAN.title }),
        h("p", { class: "sub", text: info.text })),
      h("div", { class: "actions" },
        h("button", {
          type: "button",
          class: `status-btn ${state.status.kind}`,
          "data-key": "btn:refresh",
          "aria-label": `Refresh. ${statusText()}`,
          onclick: () => doRefresh({ announceResult: true }),
        },
          h("span", { class: "status-dot", "aria-hidden": "true" }),
          h("span", { class: "status-text", text: statusText() }),
          icon("refresh")),
        h("button", { type: "button", class: "btn ghost today-btn", "data-key": "btn:today", onclick: goToToday }, "Today"),
        h("button", { type: "button", class: "icon-btn", "data-key": "btn:settings", "aria-label": "Settings", onclick: openSettings },
          icon("settings")))),
    h("div", { class: "progress", "aria-hidden": "true" }, h("span", { style: { "--p": pct(info.progress, 1) } })));
}

function updateStatus() {
  const btn = app.querySelector(".status-btn");
  if (!btn) return;
  btn.className = `status-btn ${state.status.kind}`;
  btn.setAttribute("aria-label", `Refresh. ${statusText()}`);
  btn.querySelector(".status-text").textContent = statusText();
}

// ---------- today ----------
function renderToday() {
  const t = state.today;
  const day = state.model.byDate.get(t);
  const eyebrow = [`Today · ${formatDate(t)}`];
  if (day) eyebrow.push(`Week ${day.week} · ${PLAN.phases[day.week - 1]}`);
  const section = h("section", { class: "card today", id: "today", tabindex: "-1", "aria-labelledby": "today-title" },
    h("p", { class: "eyebrow", text: eyebrow.join(" · ") }));

  if (t < PLAN.firstDay) {
    const first = state.model.days.find(d => d.workouts.length);
    section.append(
      h("h2", { id: "today-title", class: "workout-title", text: `Plan starts ${formatDate(PLAN.firstDay)}` }),
      first ? previewButton(first, "First workout") : "");
    return section;
  }
  if (t > PLAN.raceDay) {
    const { totals } = state.model;
    section.append(
      h("h2", { id: "today-title", class: "workout-title", text: "Plan complete" }),
      h("p", {
        class: "workout-meta",
        text: `${formatKm(totals.doneM)} km run of ${formatKm(totals.plannedM)} km planned · ${totals.doneWorkouts} of ${totals.workouts} workouts done`,
      }));
    return section;
  }

  if (day.workouts.length) {
    day.workouts.forEach((w, i) => section.append(workoutBlock(w, { titleId: i === 0 ? "today-title" : null, headingTag: i === 0 ? "h2" : "h3" })));
  } else {
    section.append(h("h2", { id: "today-title", class: "workout-title", text: day.notes.length ? "Rest day" : "Nothing planned" }));
    const note = day.notes.map(n => noteText(n.description)).filter(Boolean).join(" ");
    if (note) section.append(h("p", { class: "workout-note", text: note }));
    for (const a of day.extraRuns) section.append(renderRun(a, "Extra run"));
    const next = state.model.days.find(d => d.date > t && d.workouts.length);
    if (next) section.append(previewButton(next, next.date === addDays(t, 1) ? "Tomorrow" : "Next workout"));
  }
  section.append(h("div", { class: "card-foot" },
    h("button", {
      type: "button", class: "btn ghost small", "data-key": "btn:today-details",
      onclick: e => openDetails(t, e.currentTarget),
    }, "Day details")));
  return section;
}

function previewButton(day, label) {
  const w = day.workouts[0];
  return h("button", {
    type: "button", class: `preview g-${GROUP[w.type]}`, "data-key": `preview:${day.date}`,
    onclick: e => openDetails(day.date, e.currentTarget),
  },
    h("span", { class: "preview-label", text: `${label} · ${formatDate(day.date)}` }),
    h("span", { class: "preview-name", text: shortName(w.name) }),
    h("span", { class: "preview-meta", text: w.distance ? `${formatKm(w.distance)} km` : "" }));
}

function workoutBlock(w, { titleId = null, headingTag = "h3" } = {}) {
  const note = noteText(w.description);
  const meta = [
    TYPE_LABEL[w.type],
    w.distance ? `${formatKm(w.distance)} km` : "",
    w.movingTime ? `~${formatDuration(w.movingTime)}` : "",
  ].filter(Boolean).join(" · ");
  return h("article", { class: `workout g-${GROUP[w.type]}` },
    h(headingTag, { class: "workout-title", id: titleId, text: shortName(w.name) }),
    h("p", { class: "workout-meta", text: meta }),
    note ? h("p", { class: "workout-note", text: note }) : "",
    renderBar(w.steps),
    renderSteps(w.steps),
    w.run ? renderRun(w.run, "Your run") : renderPending(w));
}

function renderPending(w) {
  if (w.date < state.today) {
    return h("p", { class: "pending missed" }, h("span", { "aria-hidden": "true", text: "! " }), "Missed: no run found for this day.");
  }
  if (w.date === state.today) return h("p", { class: "pending", text: "Not done yet. Your run shows here once it syncs to intervals.icu." });
  return "";
}

function renderBar(steps) {
  const blocks = workoutBar(steps);
  if (!blocks.length) return "";
  const gap = blocks.length > 1 ? 0.5 : 0;
  const usable = 100 - gap * (blocks.length - 1);
  const svg = h("svg:svg", { class: "bar", viewBox: "0 0 100 32", preserveAspectRatio: "none", "aria-hidden": "true", focusable: "false" });
  let x = 0;
  for (const b of blocks) {
    const width = Math.max(b.width * usable, 0.3);
    const height = b.height * 32;
    svg.append(h("svg:rect", {
      x: x.toFixed(2), y: (32 - height).toFixed(2), width: width.toFixed(2), height: height.toFixed(2), class: `lv-${b.level}`,
    }));
    x += width + gap;
  }
  return svg;
}

function renderSteps(steps) {
  if (!steps?.length) return "";
  return h("ul", { class: "steps" }, steps.map(s => (s.reps
    ? h("li", { class: "repeat" },
      h("span", { class: "repeat-label" },
        h("span", { "aria-hidden": "true", text: `${s.reps} ×` }),
        h("span", { class: "sr-only", text: `${s.reps} times:` })),
      h("ul", { class: "steps nested" }, (s.steps ?? []).map(stepItem)))
    : stepItem(s))));
}

function stepItem(s) {
  const pace = paceRange(s.pace);
  return h("li", { class: `step lv-${stepLevel(s)}` },
    h("span", { class: "step-dot", "aria-hidden": "true" }),
    h("span", { class: "step-name", text: stepName(s.text) }),
    h("span", { class: "step-amount", text: formatStepAmount(s) }),
    h("span", { class: "step-pace", text: pace ? `${pace} /km` : "" }));
}

function renderRun(a, label) {
  const s = runSummary(a);
  const stats = [["Distance", s.distance], ["Time", s.time], ["Avg pace", s.pace], ["Avg HR", s.hr], ["Compliance", s.compliance]]
    .filter(([, v]) => v);
  return h("div", { class: "run", role: "group", "aria-label": label },
    h("p", { class: "run-title" }, h("span", { class: "run-check", "aria-hidden": "true", text: "✓" }), label),
    stats.length
      ? h("dl", { class: "run-stats" }, stats.map(([k, v]) => h("div", { class: "stat" }, h("dt", { text: k }), h("dd", { text: v }))))
      : "",
    externalLink(s.url, "Open in intervals.icu"));
}

// ---------- week ----------
function renderWeek() {
  const wk = state.model.weeks[state.viewWeek - 1];
  const isCurrent = state.viewWeek === currentWeek();
  const list = h("ul", { class: "week-list" }, wk.days.map(d => h("li", {}, weekRow(d))));
  bindSwipe(list, dir => changeWeek(dir));
  return h("section", { class: "card week", "aria-labelledby": "week-title" },
    h("div", { class: "section-head" },
      h("div", {},
        h("h2", { id: "week-title", text: isCurrent ? "This week" : `Week ${wk.number}` }),
        h("p", { class: "muted small", text: `Week ${wk.number} of ${PLAN.weeks} · ${wk.phase} · ${formatDate(wk.start)} – ${formatDate(wk.end)}` })),
      h("div", { class: "week-nav" },
        h("button", {
          type: "button", class: "icon-btn", "data-key": "btn:prev-week", "aria-label": "Previous week",
          disabled: state.viewWeek <= 1, onclick: () => changeWeek(-1),
        }, icon("left")),
        isCurrent ? "" : h("button", {
          type: "button", class: "btn ghost small", "data-key": "btn:this-week", onclick: () => setWeek(currentWeek()),
        }, "This week"),
        h("button", {
          type: "button", class: "icon-btn", "data-key": "btn:next-week", "aria-label": "Next week",
          disabled: state.viewWeek >= PLAN.weeks, onclick: () => changeWeek(1),
        }, icon("right")))),
    kmMeter(wk.doneM, wk.plannedM),
    list);
}

function kmMeter(doneM, plannedM) {
  return h("div", { class: "km" },
    h("p", { class: "km-text" }, h("strong", { text: formatKm(doneM) }), ` of ${formatKm(plannedM)} km`),
    h("div", { class: "meter", "aria-hidden": "true" }, h("span", { style: { "--p": pct(doneM, plannedM) } })));
}

function weekRow(d) {
  const st = statusInfo(d, state.today);
  const w = d.workouts[0];
  const group = w ? GROUP[w.type] : d.notes.length ? "rest" : "empty";
  const name = w
    ? shortName(w.name) + (d.workouts.length > 1 ? ` +${d.workouts.length - 1}` : "")
    : d.notes.length ? "Rest" : "Nothing planned";
  const km = d.workouts.reduce((t, x) => t + (x.distance || 0), 0);
  return h("button", {
    type: "button",
    class: `week-row g-${group} s-${st.key}${d.isToday ? " is-today" : ""}`,
    "data-key": `week:${d.date}`,
    "aria-current": d.isToday ? "date" : null,
    "aria-label": dayLabel(d, state.today),
    onclick: e => openDetails(d.date, e.currentTarget),
  },
    h("span", { class: "type-bar", "aria-hidden": "true" }),
    h("span", { class: "wr-date", "aria-hidden": "true" },
      h("span", { class: "wr-wd", text: WEEKDAYS[d.weekday] }),
      h("span", { class: "wr-d", text: String(Number(d.date.slice(8))) })),
    h("span", { class: "wr-name", text: name }),
    h("span", { class: "wr-km", text: km ? `${formatKm(km)} km` : "" }),
    st.short ? h("span", { class: `chip s-${st.key}` }, st.icon ? h("span", { "aria-hidden": "true", text: st.icon }) : "", st.short) : "");
}

function setWeek(n) {
  state.viewWeek = clampWeek(n, PLAN);
  render();
}

function changeWeek(dir) {
  setWeek(state.viewWeek + dir);
}

function bindSwipe(el, onSwipe) {
  let start = null;
  el.addEventListener("pointerdown", e => {
    if (e.pointerType !== "mouse") start = { x: e.clientX, y: e.clientY };
  });
  el.addEventListener("pointercancel", () => { start = null; });
  el.addEventListener("pointerup", e => {
    if (!start) return;
    const dx = e.clientX - start.x;
    const dy = e.clientY - start.y;
    start = null;
    if (Math.abs(dx) > 60 && Math.abs(dx) > 2 * Math.abs(dy)) {
      el.dataset.swiped = "1";
      onSwipe(dx < 0 ? 1 : -1);
    }
  });
  el.addEventListener("click", e => {
    if (!el.dataset.swiped) return;
    delete el.dataset.swiped;
    e.preventDefault();
    e.stopPropagation();
  }, true);
}

// ---------- plan grid ----------
function renderPlan() {
  const m = state.model;
  const cur = currentWeek();
  const table = h("table", { class: "plan-grid", role: "grid", "aria-labelledby": "plan-title", "aria-describedby": "plan-help" },
    h("thead", {}, h("tr", {},
      h("th", { scope: "col", class: "wk-col" }, h("span", { class: "sr-only", text: "Week" })),
      WEEKDAYS.map(d => h("th", { scope: "col", "aria-label": d, text: d.slice(0, 1) })),
      h("th", { scope: "col", class: "km-col", text: "km" }))),
    h("tbody", {}, m.weeks.map(wk => h("tr", { class: wk.number === cur ? "is-current" : null },
      h("th", { scope: "row", class: "wk-col" },
        h("span", { class: "wk-num", text: `W${wk.number}` }),
        h("span", { class: "wk-phase", text: wk.phase })),
      wk.days.map(d => h("td", { role: "gridcell" }, gridCell(d))),
      h("td", { class: "km-col", role: "gridcell" },
        h("span", { "aria-hidden": "true", text: `${formatKm(wk.doneM)}/${formatKm(wk.plannedM)}` }),
        h("span", { class: "sr-only", text: `${formatKm(wk.doneM)} of ${formatKm(wk.plannedM)} km` }),
        h("span", { class: "mini-meter", "aria-hidden": "true" }, h("span", { style: { "--p": pct(wk.doneM, wk.plannedM) } })))))));
  table.addEventListener("keydown", onGridKey);
  return h("section", { class: "card plan", "aria-labelledby": "plan-title" },
    h("div", { class: "section-head" },
      h("div", {},
        h("h2", { id: "plan-title", text: "Plan" }),
        h("p", {
          class: "muted small",
          text: `${formatKm(m.totals.doneM)} of ${formatKm(m.totals.plannedM)} km · ${m.totals.doneWorkouts} of ${m.totals.workouts} workouts done`,
        }))),
    h("p", { id: "plan-help", class: "sr-only", text: "Arrow keys move between days. Enter opens the day." }),
    h("div", { class: "grid-wrap" }, table),
    renderLegend());
}

function gridCell(d) {
  const st = statusInfo(d, state.today);
  const w = d.workouts[0];
  const group = w ? GROUP[w.type] : d.notes.length ? "rest" : "empty";
  const mark = w ? MARKS[w.type] ?? "" : "";
  const cls = ["cell", `g-${group}`, `s-${st.key}`, d.isToday && "is-today", d.date < state.today && "is-past"].filter(Boolean).join(" ");
  return h("button", {
    type: "button",
    class: cls,
    tabindex: d.date === state.focusDate ? "0" : "-1",
    "data-date": d.date,
    "data-key": `cell:${d.date}`,
    "aria-current": d.isToday ? "date" : null,
    "aria-label": dayLabel(d, state.today),
    onclick: e => {
      moveGridFocus(d.date, false);
      openDetails(d.date, e.currentTarget);
    },
  },
    h("span", { class: "cell-day", "aria-hidden": "true", text: String(Number(d.date.slice(8))) }),
    st.icon ? h("span", { class: "cell-icon", "aria-hidden": "true", text: st.icon }) : "",
    mark ? h("span", { class: "cell-mark", "aria-hidden": "true", text: mark }) : "");
}

function onGridKey(e) {
  const btn = e.target.closest("button.cell");
  if (!btn) return;
  const days = state.model.days;
  const i = days.findIndex(d => d.date === btn.dataset.date);
  const row = i - (i % 7);
  const moves = {
    ArrowRight: i + 1,
    ArrowLeft: i - 1,
    ArrowDown: i + 7,
    ArrowUp: i - 7,
    Home: e.ctrlKey ? 0 : row,
    End: e.ctrlKey ? days.length - 1 : row + 6,
    PageDown: i + 28,
    PageUp: i - 28,
  };
  if (!(e.key in moves)) return;
  e.preventDefault();
  moveGridFocus(days[Math.max(0, Math.min(days.length - 1, moves[e.key]))].date, true);
}

function moveGridFocus(date, focus) {
  state.focusDate = date;
  const table = app.querySelector(".plan-grid");
  if (!table) return;
  for (const b of table.querySelectorAll("button.cell")) b.tabIndex = b.dataset.date === date ? 0 : -1;
  if (focus) table.querySelector(`button.cell[data-date="${date}"]`)?.focus();
}

function renderLegend() {
  const items = [["easy", "Easy"], ["long", "Long"], ["threshold", "Threshold"], ["intervals", "Intervals"], ["race", "Test, race pace, race"], ["rest", "Rest"]];
  return h("ul", { class: "legend", "aria-label": "Legend" },
    items.map(([g, label]) => h("li", {}, h("span", { class: `swatch g-${g}`, "aria-hidden": "true" }), label)),
    h("li", {}, h("span", { class: "swatch ring", "aria-hidden": "true" }), "Today"),
    h("li", {}, h("span", { class: "glyph ok", "aria-hidden": "true", text: "✓" }), "Done"),
    h("li", {}, h("span", { class: "glyph bad", "aria-hidden": "true", text: "!" }), "Missed"),
    h("li", {}, h("span", { class: "glyph", "aria-hidden": "true", text: "T K R" }), "Test, key run, race"));
}

function goToToday() {
  if (localToday() !== state.today) {
    state.viewWeek = null;
    rebuild();
  }
  state.viewWeek = currentWeek();
  if (state.model.byDate.has(state.today)) state.focusDate = state.today;
  render();
  const card = document.getElementById("today");
  card?.scrollIntoView({ behavior: reduceMotion.matches ? "auto" : "smooth", block: "start" });
  card?.focus({ preventScroll: true });
}

// ---------- day details ----------
function openDetails(date, opener) {
  if (!state.model?.byDate.has(date)) return;
  state.detailsDate = date;
  state.opener = opener ?? document.activeElement;
  fillDetails(date);
  details.querySelector("#details-body").scrollTop = 0;
  if (!details.open) details.showModal();
  details.querySelector('[data-action="close"]').focus();
}

function fillDetails(date) {
  const d = state.model.byDate.get(date);
  if (!d) return;
  const st = statusInfo(d, state.today);
  details.querySelector("#details-eyebrow").textContent = `Week ${d.week} · ${PLAN.phases[d.week - 1]}${d.isToday ? " · Today" : ""}`;
  details.querySelector("#details-title").textContent = formatDate(date);
  const parts = [];
  if (st.short) parts.push(h("p", { class: `chip s-${st.key}` }, st.icon ? h("span", { "aria-hidden": "true", text: st.icon }) : "", st.short));
  for (const w of d.workouts) parts.push(workoutBlock(w, { headingTag: "h3" }));
  for (const n of d.notes) {
    const text = noteText(n.description);
    parts.push(h("article", { class: "workout g-rest" },
      h("h3", { class: "workout-title", text: n.name === "Rest" ? "Rest day" : n.name || "Note" }),
      text ? h("p", { class: "workout-note", text }) : ""));
  }
  for (const a of d.extraRuns) parts.push(renderRun(a, "Extra run"));
  if (d.others.length) {
    parts.push(h("div", { class: "also", role: "group", "aria-labelledby": "also-title" },
      h("h3", { id: "also-title", text: "Also on this day" }),
      h("ul", {}, d.others.map(a => h("li", {},
        externalLink(runSummary(a).url, `${a.name || a.type}${a.movingTime ? ` · ${formatDuration(a.movingTime)}` : ""}`))))));
  }
  if (!d.workouts.length && !d.notes.length && !d.activities.length) parts.push(h("p", { class: "muted", text: "Nothing planned for this day." }));
  parts.push(h("p", { class: "details-link" }, externalLink(dayUrl(date), "Open this week in intervals.icu")));
  details.querySelector("#details-body").replaceChildren(...parts);
  const first = state.model.days[0].date;
  const last = state.model.days.at(-1).date;
  details.querySelector('[data-action="prev"]').disabled = date <= first;
  details.querySelector('[data-action="next"]').disabled = date >= last;
  if (document.activeElement?.disabled) details.querySelector('[data-action="close"]').focus();
}

function stepDetails(dir) {
  const next = addDays(state.detailsDate, dir);
  if (!state.model.byDate.has(next)) return;
  state.detailsDate = next;
  moveGridFocus(next, false);
  state.opener = byKey(`cell:${next}`) ?? state.opener;
  fillDetails(next);
  details.querySelector("#details-body").scrollTop = 0;
  announce(formatDate(next));
}

// ---------- settings ----------
function openSettings() {
  const name = state.data?.athleteName;
  settings.querySelector("#settings-athlete").textContent = name ? `Connected to intervals.icu as ${name}.` : "Connected to intervals.icu.";
  const theme = store.getTheme();
  for (const r of settings.querySelectorAll('input[name="theme"]')) r.checked = r.value === theme;
  settings.querySelector('input[name="shortcut"]').checked = store.getShortcut();
  settings.showModal();
  settings.querySelector('[data-action="close"]').focus();
}

function forgetKey() {
  if (!window.confirm("Forget the API key and saved data on this device?")) return;
  store.forget();
  settings.close();
  state.data = null;
  state.model = null;
  state.viewWeek = null;
  renderSetup("");
  announce("Key removed from this device");
}

function wireDialogs() {
  details.addEventListener("click", e => {
    const action = e.target.closest("[data-action]")?.dataset.action;
    if (action === "close" || e.target === details) details.close();
    else if (action === "prev") stepDetails(-1);
    else if (action === "next") stepDetails(1);
  });
  details.addEventListener("close", () => {
    state.detailsDate = null;
    const opener = state.opener;
    state.opener = null;
    const key = opener?.dataset?.key;
    const target = opener?.isConnected ? opener : key ? byKey(key) : null;
    target?.focus({ preventScroll: true });
  });
  const grip = details.querySelector(".sheet-grip");
  let startY = null;
  grip.addEventListener("pointerdown", e => {
    startY = e.clientY;
    grip.setPointerCapture(e.pointerId);
  });
  grip.addEventListener("pointerup", e => {
    if (startY != null && e.clientY - startY > 60) details.close();
    startY = null;
  });
  grip.addEventListener("pointercancel", () => { startY = null; });

  settings.addEventListener("click", e => {
    const action = e.target.closest("[data-action]")?.dataset.action;
    if (action === "close" || e.target === settings) settings.close();
    else if (action === "refresh") {
      settings.close();
      doRefresh({ announceResult: true });
    } else if (action === "forget") forgetKey();
  });
  settings.addEventListener("change", e => {
    if (e.target.name === "theme") {
      store.setTheme(e.target.value);
      applyTheme(e.target.value);
      announce(`Theme: ${e.target.value}`);
    } else if (e.target.name === "shortcut") {
      store.setShortcut(e.target.checked);
    }
  });
  settings.addEventListener("close", () => byKey("btn:settings")?.focus({ preventScroll: true }));
}

// ---------- setup, loading, errors ----------
function renderSetup(message) {
  if (details.open) details.close();
  if (settings.open) settings.close();
  const input = h("input", {
    id: "key", name: "key", type: "password", autocomplete: "off", autocapitalize: "off", spellcheck: "false",
    "aria-describedby": "key-help",
  });
  const error = h("p", { id: "key-error", class: "error", role: "alert" });
  const toggle = h("button", { type: "button", class: "btn ghost small", "aria-pressed": "false", "aria-controls": "key" }, "Show");
  toggle.addEventListener("click", () => {
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    toggle.setAttribute("aria-pressed", String(show));
    toggle.textContent = show ? "Hide" : "Show";
  });
  const submit = h("button", { type: "submit", class: "btn primary block" }, "Connect");
  const showError = text => {
    error.textContent = text;
    input.setAttribute("aria-invalid", "true");
    input.setAttribute("aria-describedby", "key-help key-error");
    input.focus();
  };
  const form = h("form", { class: "setup-form", novalidate: true },
    h("label", { for: "key", text: "intervals.icu API key" }),
    h("div", { class: "key-row" }, input, toggle),
    h("p", { id: "key-help", class: "muted small", text: "Saved only in this browser. This page only reads your calendar and runs." }),
    error,
    submit);
  form.addEventListener("submit", async e => {
    e.preventDefault();
    submit.disabled = true;
    submit.textContent = "Connecting…";
    error.textContent = "";
    try {
      await connect(input.value, { store });
      state.data = store.getCache();
      state.model = null;
      state.viewWeek = null;
      state.status = { kind: "idle", message: "" };
      renderLoading();
      await doRefresh();
      announce("Connected. Calendar loaded.");
    } catch (err) {
      submit.disabled = false;
      submit.textContent = "Connect";
      if (err instanceof KeyError) {
        showError(err.reason === "format" ? err.message : "That key was not accepted. Copy it again from intervals.icu and retry.");
      } else if (err instanceof NetworkError) {
        showError("Can't reach intervals.icu. Check your connection and retry.");
      } else {
        showError(err.message);
      }
    }
  });
  app.replaceChildren(h("main", { id: "main", class: "setup" },
    h("section", { class: "card setup-card", "aria-labelledby": "setup-title" },
      h("img", { class: "logo", src: "icons/icon.svg", alt: "", width: "56", height: "56" }),
      h("h1", { id: "setup-title", text: "Connect intervals.icu" }),
      h("p", { class: "lead", text: `See your ${PLAN.title} plan, today's workout and your runs, live from intervals.icu.` }),
      h("ol", { class: "setup-steps" },
        h("li", {}, "Open ", externalLink("https://intervals.icu/settings", "intervals.icu settings"), "."),
        h("li", { text: "In Developer Settings, copy your API Key." }),
        h("li", { text: "Paste it below and press Connect." })),
      form)));
  app.removeAttribute("aria-busy");
  if (message) showError(message);
  else input.focus();
}

function renderLoading() {
  app.setAttribute("aria-busy", "true");
  app.replaceChildren(h("main", { id: "main", class: "setup" },
    h("section", { class: "card setup-card loading", "aria-label": "Loading" },
      h("div", { class: "spinner", "aria-hidden": "true" }),
      h("p", { text: "Loading your plan from intervals.icu…" }))));
}

function renderError(message) {
  app.removeAttribute("aria-busy");
  app.replaceChildren(h("main", { id: "main", class: "setup" },
    h("section", { class: "card setup-card", "aria-labelledby": "error-title" },
      h("h1", { id: "error-title", text: "Couldn't load your plan" }),
      h("p", { class: "error", role: "alert", text: message }),
      h("div", { class: "row" },
        h("button", { type: "button", class: "btn primary", onclick: () => { renderLoading(); doRefresh(); } }, "Try again"),
        h("button", { type: "button", class: "btn ghost", onclick: () => { store.forget(); renderSetup(""); } }, "Use a different key")))));
}

// ---------- data ----------
async function doRefresh({ announceResult = false } = {}) {
  if (state.status.kind === "loading") return;
  state.status = { kind: "loading", message: "" };
  updateStatus();
  try {
    state.data = await refresh({ store, today: localToday() });
    state.status = { kind: "ok", message: "" };
    rebuild();
    render();
    if (announceResult) announce("Calendar updated");
  } catch (err) {
    if (err instanceof KeyError) {
      state.status = { kind: "idle", message: "" };
      renderSetup(err.reason === "missing" ? "" : "Your key was not accepted. Paste a current key from intervals.icu.");
      return;
    }
    state.status = { kind: err instanceof NetworkError ? "offline" : "error", message: err.message };
    if (hasData(state.data)) {
      if (!state.model) rebuild();
      render();
      announce(statusText());
    } else {
      renderError(err instanceof NetworkError ? "Can't reach intervals.icu. Check your connection." : err.message);
    }
  }
}

function onVisibility() {
  if (document.visibilityState === "hidden") {
    state.hiddenAt = Date.now();
    return;
  }
  if (!store.getKey() || !state.model) return;
  if (localToday() !== state.today) {
    state.viewWeek = null;
    rebuild();
    render();
  }
  if (state.hiddenAt && Date.now() - state.hiddenAt > 5 * 60_000) doRefresh();
}

function tick() {
  if (!state.model) return;
  if (localToday() !== state.today) {
    state.viewWeek = null;
    rebuild();
    render();
  } else {
    updateStatus();
  }
}

function onKey(e) {
  if (e.key !== "t" && e.key !== "T") return;
  if (e.defaultPrevented || e.ctrlKey || e.metaKey || e.altKey || !state.model || !store.getShortcut()) return;
  if (details.open || settings.open || e.target.closest?.("input, textarea, select, [contenteditable]")) return;
  e.preventDefault();
  goToToday();
}

function registerServiceWorker() {
  if (!("serviceWorker" in navigator)) return;
  const local = location.hostname === "localhost" || location.hostname === "127.0.0.1";
  if (location.protocol !== "https:" && !local) return;
  navigator.serviceWorker.register("sw.js").catch(() => {});
}

async function init() {
  applyTheme(store.getTheme());
  wireDialogs();
  registerServiceWorker();
  document.addEventListener("keydown", onKey);
  document.addEventListener("visibilitychange", onVisibility);
  window.setInterval(tick, 60_000);
  if (!store.getKey()) {
    renderSetup("");
    return;
  }
  state.data = store.getCache();
  if (hasData(state.data)) {
    rebuild();
    render();
  } else {
    renderLoading();
  }
  await doRefresh();
}

init();
~~~

- [ ] **Step 2: Setup screen check (no key)**

With `tc-serve` running, open `http://localhost:8080/` in the agent browser (fresh profile, 390×844).
Expected: the "Connect intervals.icu" card; `tab.console()` / `tab.errors()` show no errors and no CSP violations; Tab order is: skip link, settings link, key field, Show, Connect; pressing Connect with an empty field shows "That doesn't look like an intervals.icu API key." in the alert and focuses the field.

- [ ] **Step 3: Live data check (key from the key file, never printed)**

In the same tab, put the key into the test browser's storage and reload:

```js
await tab.run(async ({ page }) => {
  const key = (await Bun.file(`${process.env.USERPROFILE}/.intervals_key`).text()).trim();
  await page.evaluate(k => localStorage.setItem("tc.v1.key", k), key);
  await page.reload({ waitUntil: "networkidle0" });
});
```

Expected: the header matches today's date (on 2026-10-21: "Week 1 of 15 · Day 2 of 104 · 102 days to race"); the Today card shows that day's workout with workout bar and steps; This week lists 7 days; the Plan table has 15 rows; today's cell has the ring; no console errors. If a file changed since the last load, reload twice (the service worker serves the previous copy once). Take screenshots: phone 390×844 light, phone dark (`tab.emulate({ colorScheme: "dark" })`), PC 1440×900 light and dark.

- [ ] **Step 4: Interaction check**

At 1440×900:
- Click a grid cell of a past day → details panel opens on the right with steps; Esc closes it; focus returns to the same cell (`document.activeElement.dataset.key === "cell:<date>"`).
- Focus today's cell, press ArrowRight, ArrowDown, Home, End → `document.activeElement.dataset.date` moves to the next day, the day a week later, that week's Monday, that week's Sunday.
- In details press "Next day" → title changes to the next date; prev disables on Mon 19 Oct.
- Next week / Previous week / This week buttons change the week card heading; focus stays on a week button.
- Open Settings → choose Dark → page switches theme; reload keeps it; untick the `T` shortcut → pressing `t` does nothing; tick it again → `t` scrolls to and focuses the Today card.
- `tab.ariaSnapshot(".plan-grid")` shows a grid with column headers Mon–Sun and cells named like "Wed 21 Oct, today, 10×400 @4:05, 5.6 km, not done yet".
Expected: every item behaves as written.

- [ ] **Step 5: Offline and error check**

- `page.setOfflineMode(true)`, reload → the page still renders from the service worker and saved data; the header says "Offline · updated …". `page.setOfflineMode(false)`; press the refresh button → "Updated just now".
- Set an invalid key in storage (`localStorage.setItem("tc.v1.key", "invalid-key-000")`), reload → the setup screen appears with "Your key was not accepted. Paste a current key from intervals.icu."; then restore the real key as in Step 3.
Expected: as written; no uncaught errors in `tab.errors()`.

- [ ] **Step 6: Phone layout check**

At 390×844: the floating Today button is visible and the header Today button hidden; the plan table fits without horizontal scrolling; tapping a day opens the bottom sheet; dragging the grip down 80 px closes it.
Expected: as written; screenshot of the open bottom sheet.

- [ ] **Step 7: Day roll-over check**

In the page, override the clock for one tick: `await tab.evaluate("(() => { const real = Date; const next = new real(real.now() + 86400000); window.Date = class extends real { constructor(...a) { super(...(a.length ? a : [next])); } static now() { return next.getTime(); } }; })()")`, then dispatch `document.dispatchEvent(new Event("visibilitychange"))`.
Expected: the today ring and Today card move to the next day without a reload. Reload the page afterwards to restore the real clock.

- [ ] **Step 8: Run the unit tests and commit**

Run: `npm test`
Expected: `# pass 37`, `# fail 0`.

```bash
git add site/src/app.js
git commit -m "feat: calendar page with today, week, plan grid and day details"
```

### Task 7: Deployment and README

**Files:**
- Create: `.github/workflows/pages.yml`, `README.md`

**Interfaces:**
- Consumes: `npm test` (Tasks 1–4), `site/` (Tasks 5–6).
- Produces: GitHub Pages deploy on push to `main`; user documentation.

- [ ] **Step 1: Write the workflow**

~~~yaml title=.github/workflows/pages.yml
name: Deploy to GitHub Pages

on:
  push:
    branches: [main]
  workflow_dispatch:

permissions:
  contents: read
  pages: write
  id-token: write

concurrency:
  group: pages
  cancel-in-progress: false

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v5
      - uses: actions/setup-node@v5
        with:
          node-version: 24
      - run: npm test
      - uses: actions/configure-pages@v5
      - uses: actions/upload-pages-artifact@v4
        with:
          path: site

  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v4
~~~

- [ ] **Step 2: Write the README**

~~~markdown title=README.md
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
~~~

- [ ] **Step 3: Final checks and commit**

Run: `npm test`
Expected: `# pass 37`, `# fail 0`.
Run (bash): `git status --porcelain` and `git ls-files`
Expected: clean tree after the commit below; `git ls-files` lists no file containing the API key (check with `git grep -n -F -f <(cat ~/.intervals_key)` → no output, exit code 1).

```bash
git add .github/workflows/pages.yml README.md
git commit -m "ci: deploy site/ to GitHub Pages; add README"
```

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

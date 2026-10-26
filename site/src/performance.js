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

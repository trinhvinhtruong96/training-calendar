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

// Matches a run's watch laps to its planned steps, for the day details.
// Pure. Spec: docs/superpowers/specs/2026-10-26-run-steps-design.md §4–§5
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

const paceOf = (metres, seconds) => (metres > 0 && seconds > 0 ? seconds / (metres / 1000) : null);
const cueOf = step => String(step?.text ?? "").trim().toLowerCase();
const isEasyCue = cue => /^(warm-?up|easy|cool-?down)\b/.test(cue);

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

function hrText(t) {
  if (t.hr == null) return "";
  return t.laps >= 2 && t.hrLo !== t.hrHi ? ` · HR ${t.hrLo}–${t.hrHi}` : ` · HR ${t.hr}`;
}

function doneText(t, timed) {
  if (timed) return `${formatClock(t.elapsed)} · ${Math.round(t.distance)} m${hrText(t)}`;
  const pace = t.pace ? ` · ${formatPace(t.pace)} /km` : "";
  const dist = t.distance < 1000 ? `${Math.round(t.distance)} m` : `${formatKm(t.distance, 2)} km`;
  return `${dist} · ${formatClock(t.time)}${pace}${hrText(t)}`;
}

function plannedText(step) {
  const pace = paceRange(step.pace);
  return [formatStepAmount(step), pace ? `@${pace}` : ""].filter(Boolean).join(" ");
}

function lapLines(laps, first = 1) {
  return laps.map((l, i) => `Lap ${first + i}: ${doneText(totals([l]), false)}`);
}

function within(t, range, slack) {
  if (!range || t.pace == null) return NONE;
  if (t.pace < range[0] - slack) return { status: "check", reason: "too fast" };
  if (t.pace > range[1] + slack) return { status: "check", reason: "too slow" };
  return { status: "ok", reason: "" };
}

// Spec §5. Checks needing HR or a limit are skipped when either is missing.
export function stepVerdict(step, t, limits, workoutType) {
  const cue = cueOf(step);
  const range = rangeOf(step);
  if (isEasyCue(cue)) {
    if (t.hr == null || !limits?.easyLimit) return NONE;
    return t.hr <= limits.easyLimit + 3 ? { status: "ok", reason: "" } : { status: "check", reason: `HR above ${limits.easyLimit}` };
  }
  if (/^rep\b/.test(cue) || (/^race pace\b/.test(cue) && SHORT_SESSIONS.has(workoutType))) return within(t, range, 2);
  if (/^(threshold|settle|tempo)\b/.test(cue)) {
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

// Laps for one step from position `from`, or null when they don't fit (spec §4.3).
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

function repeatHeader(groupStep) {
  const inner = flattenSteps(groupStep.steps ?? []);
  const work = inner.filter(isWork);
  if (work.length === 1) {
    const others = inner.filter(s => s !== work[0]).map(s => `${formatStepAmount(s)} ${stepName(s.text).toLowerCase()}`);
    const pace = paceRange(work[0].pace);
    return {
      name: `${groupStep.reps} × ${formatStepAmount(work[0])}`,
      planned: [pace ? `@${pace}` : "", ...others].filter(Boolean).join(" · "),
      label: /^rep\b/.test(cueOf(work[0])) ? "reps" : "blocks",
    };
  }
  return { name: `${groupStep.reps} × (${inner.map(formatStepAmount).join(" + ")})`, planned: "", label: "blocks" };
}

function repeatSummary(g, reps) {
  const work = g.rows.filter(r => r.work);
  if (!work.length) {
    const done = new Set(g.rows.map(r => r.rep)).size;
    return { done: `${done} of ${reps} done`, status: null, reason: "" };
  }
  const count = word => work.filter(r => r.reason.includes(word)).length;
  const parts = [];
  if (count("too fast")) parts.push(`${count("too fast")} too fast`);
  if (count("too slow")) parts.push(`${count("too slow")} too slow`);
  if (count("HR above")) parts.push(`${count("HR above")} with HR too high`);
  const anyCheck = work.some(r => r.status === "check");
  const anyOk = work.some(r => r.status === "ok");
  return {
    done: `${g.label} ${paceSpan(work.filter(r => r.pace != null).map(r => r.pace))}`,
    status: anyCheck ? "check" : anyOk ? "ok" : null,
    reason: parts.length ? parts.join(", ") : anyOk ? "all on target" : "",
  };
}

function group(rows, steps) {
  const items = [];
  for (const r of rows) {
    const row = { name: r.name, planned: r.planned, done: r.done, status: r.status, reason: r.reason };
    if (r.group == null) {
      items.push({ kind: "step", ...row });
      continue;
    }
    let g = items[items.length - 1];
    if (!g || g.kind !== "repeat" || g.group !== r.group) {
      g = { kind: "repeat", group: r.group, ...repeatHeader(steps[r.group]), rows: [] };
      items.push(g);
    }
    const work = isWork(r.step);
    const name = work ? `${/^rep\b/.test(cueOf(r.step)) ? "Rep" : r.name} ${r.rep}` : r.name;
    g.rows.push({ ...row, name, work, rep: r.rep, pace: r.pace });
  }
  return items.map(it => {
    if (it.kind !== "repeat") return it;
    const summary = repeatSummary(it, steps[it.group].reps);
    return {
      kind: "repeat",
      name: it.name,
      planned: it.planned,
      ...summary,
      rows: it.rows.map(({ name, planned, done, status, reason }) => ({ name, planned, done, status, reason })),
    };
  });
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
    rows.push({
      ...plan[k],
      name: stepName(plan[k].step.text),
      planned: plannedText(plan[k].step),
      done: doneText(t, m.timed),
      pace: t.pace,
      ...stepVerdict(plan[k].step, t, limits, workout?.type),
    });
    at = m.next;
  }
  const rest = laps.slice(at);
  const result = { kind: "steps", items: group(rows, workout.steps), after: null, notDone: [], unmatched: [] };
  if (stopped < 0) {
    if (rest.length) result.after = doneText(totals(rest), false);
  } else if (rest.length) {
    result.unmatched = lapLines(rest, at + 1);
  } else {
    result.notDone = notDoneNames(plan.slice(stopped), workout.steps);
  }
  return result;
}

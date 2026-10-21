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

// VO2 max levels and race predictions (pure, no DOM).
import { addDays, formatClock } from "./dates.js";

export const RACES = Object.freeze([
  { key: "5k", label: "5K", metres: 5000 },
  { key: "10k", label: "10K", metres: 10000 },
  { key: "half", label: "Half", metres: 21097.5 },
  { key: "marathon", label: "Marathon", metres: 42195 },
]);

export const WINDOW_DAYS = 84; // real-runs predictions use the best efforts of the 12 weeks up to a date
export const MIN_RUNS = 3; // a window fitted to fewer runs (e.g. the start of your history) isn't a fair prediction

// Garmin's VO2 max standard ratings (The Cooper Institute): lower edges of Fair, Good, Excellent, Superior.
const VO2_TABLE = Object.freeze({
  male: {
    "20-29": [41.7, 45.4, 51.1, 55.4],
    "30-39": [40.5, 44, 48.3, 54],
    "40-49": [38.5, 42.4, 46.4, 52.5],
    "50-59": [35.6, 39.2, 43.4, 48.9],
    "60-69": [32.3, 35.5, 39.5, 45.7],
    "70-79": [29.4, 32.3, 36.7, 42.1],
  },
  female: {
    "20-29": [36.1, 39.5, 43.9, 49.6],
    "30-39": [34.4, 37.8, 42.4, 47.4],
    "40-49": [33, 36.3, 39.7, 45.3],
    "50-59": [30.1, 33, 36.7, 41.1],
    "60-69": [27.5, 30, 33, 37.8],
    "70-79": [25.9, 28.1, 30.9, 36.7],
  },
});

export const LEVELS = Object.freeze([
  { key: "poor", label: "Poor" },
  { key: "fair", label: "Fair" },
  { key: "good", label: "Good" },
  { key: "excellent", label: "Excellent" },
  { key: "superior", label: "Superior" },
]);

export function vo2Level(value, athlete) {
  const [fair, good, excellent, superior] = VO2_TABLE[athlete.sex][athlete.ageBand];
  const edges = [fair - 6, fair, good, excellent, superior, superior + 6];
  let index = 0;
  while (index < 4 && value >= edges[index + 1]) index++;
  const lo = edges[index];
  const hi = edges[index + 1];
  const fraction = Math.min(1, Math.max(0, (value - lo) / (hi - lo)));
  return {
    ...LEVELS[index],
    thresholds: { fair, good, excellent, superior },
    position: Math.min(1, Math.max(0, (index + fraction) / 5)),
  };
}

// Points are {date, vo2max}, sorted by date.
export function vo2Series(points, today, days) {
  const after = addDays(today, -days);
  return points.filter(p => p.date > after && p.date <= today);
}

export function vo2At(points, date) {
  let value = null;
  for (const p of points) {
    if (p.date > date) break;
    value = p.vo2max;
  }
  return value;
}

export function vo2Change(points, today, days) {
  const to = vo2At(points, today);
  if (to == null) return null;
  const from = vo2At(points, addDays(today, -days)) ?? points[0].vo2max;
  return { from, to, delta: Math.round((to - from) * 10) / 10 };
}

// Jack Daniels' running formula: oxygen cost of a pace and the share of VO2 max sustainable for a duration.
function vdotOf(metres, minutes) {
  const v = metres / minutes;
  const cost = -4.6 + 0.182258 * v + 0.000104 * v * v;
  const share = 0.8 + 0.1894393 * Math.exp(-0.012778 * minutes) + 0.2989558 * Math.exp(-0.1932605 * minutes);
  return cost / share;
}

export function danielsTime(vdot, metres) {
  let lo = 1;
  let hi = 600;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (vdotOf(metres, mid) > vdot) lo = mid;
    else hi = mid;
  }
  return ((lo + hi) / 2) * 60;
}

const riegel = (seconds, fromMetres, toMetres) => seconds * (toMetres / fromMetres) ** 1.06;

// window: {cs (m/s), dPrime (m), best: {metres: seconds}} from intervals.icu's pace curve for 12 weeks.
export function realRunsTimes(window) {
  if (!window || !(window.cs > 0)) return null;
  if (window.runs != null && window.runs < MIN_RUNS) return null;
  const { cs } = window;
  const dPrime = window.dPrime ?? 0;
  const best = window.best ?? {};
  const pick = (model, metres) => {
    const b = best[metres];
    return b > 0 && b < model ? b : model;
  };
  const t10 = pick((10000 - dPrime) / cs, 10000);
  return {
    "5k": pick((5000 - dPrime) / cs, 5000),
    "10k": t10,
    half: pick(riegel(t10, 10000, 21097.5), 21097.5),
    marathon: pick(riegel(t10, 10000, 42195), 42195),
  };
}

export function vo2Times(vo2max) {
  if (!(vo2max > 0)) return null;
  return Object.fromEntries(RACES.map(r => [r.key, danielsTime(vo2max, r.metres)]));
}

const HISTORY = Object.freeze({ "4w": { step: 7, count: 5 }, "6m": { step: 14, count: 14 }, "1y": { step: 28, count: 14 } });

export function predictorDates(today, range) {
  const { step, count } = HISTORY[range];
  return Array.from({ length: count }, (_, i) => addDays(today, -(count - 1 - i) * step));
}

export function allPredictorDates(today) {
  return [...new Set(Object.keys(HISTORY).flatMap(r => predictorDates(today, r)))].sort();
}

export function windowRange(date) {
  return `r.${addDays(date, -(WINDOW_DAYS - 1))}.${date}`;
}

export function predictionSeries(dates, windows, vo2Points) {
  const byEnd = new Map(windows.map(w => [w.end, w]));
  return dates.map(date => {
    const vo2max = vo2At(vo2Points, date);
    return { date, vo2max, real: realRunsTimes(byEnd.get(date)), vo2: vo2Times(vo2max) };
  });
}

export function formatDelta(seconds) {
  const s = Math.round(seconds);
  const sign = s < 0 ? "−" : s > 0 ? "+" : "±";
  return `${sign}${formatClock(Math.abs(s))}`;
}

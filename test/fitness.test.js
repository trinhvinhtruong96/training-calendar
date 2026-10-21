import { test } from "node:test";
import assert from "node:assert/strict";
import {
  RACES, danielsTime, formatDelta, predictionSeries, predictorDates, realRunsTimes, vo2At, vo2Change, vo2Level, vo2Series,
  windowRange,
} from "../site/src/fitness.js";

const near = (actual, expected, tolerance, label) =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} not within ${tolerance} of ${expected}`);

test("Daniels' formula matches his published VDOT 50 table", () => {
  const [k5, k10, half, full] = RACES.map(r => danielsTime(50, r.metres));
  near(k5, 19 * 60 + 57, 10, "5K");
  near(k10, 41 * 60 + 21, 10, "10K");
  near(half, 3600 + 31 * 60 + 35, 15, "Half");
  near(full, 3 * 3600 + 10 * 60 + 49, 20, "Marathon");
  assert.ok(danielsTime(58, 21097.5) < danielsTime(50, 21097.5));
});

test("real-runs prediction: critical speed for 5K/10K, Riegel from the 10K for longer races", () => {
  const t = realRunsTimes({ cs: 3.807, dPrime: 131, best: {} });
  near(t["5k"], 1279, 1, "5K");
  near(t["10k"], 2592, 1, "10K");
  near(t.half, 5720, 3, "Half");
  near(t.marathon, 11925, 6, "Marathon");
});

test("a real best time that is faster than the model is used, and feeds the longer races", () => {
  const t = realRunsTimes({ cs: 3.807, dPrime: 131, best: { 10000: 2500, 21097.5: 5400 } });
  assert.equal(t["10k"], 2500);
  assert.equal(t.half, 5400);
  const fromTen = realRunsTimes({ cs: 3.807, dPrime: 131, best: { 10000: 2500, 21097.5: 5600 } });
  near(fromTen.half, 2500 * (21097.5 / 10000) ** 1.06, 1, "a slower real half loses to the Riegel time from the real 10K");
  near(t.marathon, 2500 * (42195 / 10000) ** 1.06, 1, "Marathon from the real 10K");
  const slower = realRunsTimes({ cs: 3.807, dPrime: 131, best: { 5000: 1400 } });
  near(slower["5k"], 1279, 1, "a slower best does not replace the model");
});

test("no critical-speed model, or fewer than 3 runs in the window, means no real-runs prediction", () => {
  assert.equal(realRunsTimes(null), null);
  assert.equal(realRunsTimes({ cs: null, dPrime: null, best: {} }), null);
  assert.equal(realRunsTimes({ cs: 2.643, dPrime: 410, best: {}, runs: 1 }), null);
  assert.ok(realRunsTimes({ cs: 3.807, dPrime: 131, best: {}, runs: 3 }));
  assert.ok(realRunsTimes({ cs: 3.807, dPrime: 131, best: {} }), "older cached windows without a run count still work");
});

test("VO2 max level uses Garmin's table and its band edges", () => {
  const male30 = { sex: "male", ageBand: "30-39" };
  const level = v => vo2Level(v, male30).key;
  assert.equal(level(58), "superior");
  assert.equal(level(54), "superior");
  assert.equal(level(53.9), "excellent");
  assert.equal(level(48.3), "excellent");
  assert.equal(level(44), "good");
  assert.equal(level(40.5), "fair");
  assert.equal(level(40.4), "poor");
  assert.equal(vo2Level(45, { sex: "female", ageBand: "20-29" }).key, "excellent");
  const a = vo2Level(45, male30).position;
  const b = vo2Level(58, male30).position;
  assert.ok(a > 0 && a < b && b <= 1);
});

test("VO2 max series, value on a date and change over a period", () => {
  const points = [
    { date: "2026-07-20", vo2max: 55 },
    { date: "2026-09-20", vo2max: 57 },
    { date: "2026-09-30", vo2max: 57 },
    { date: "2026-10-18", vo2max: 58 },
  ];
  assert.deepEqual(vo2Series(points, "2026-10-21", 28).map(p => p.date), ["2026-09-30", "2026-10-18"]);
  assert.equal(vo2Series(points, "2026-10-21", 182).length, 4);
  assert.equal(vo2At(points, "2026-09-25"), 57);
  assert.equal(vo2At(points, "2026-07-01"), null);
  assert.deepEqual(vo2Change(points, "2026-10-21", 28), { from: 57, to: 58, delta: 1 });
  assert.equal(vo2Change([], "2026-10-21", 28), null);
});

test("history dates: weekly for 4W, every 2 weeks for 6M, every 4 weeks for 1Y, oldest first", () => {
  const w4 = predictorDates("2026-10-21", "4w");
  assert.deepEqual(w4, ["2026-09-23", "2026-09-30", "2026-10-07", "2026-10-14", "2026-10-21"]);
  const m6 = predictorDates("2026-10-21", "6m");
  assert.equal(m6.length, 14);
  assert.equal(m6[0], "2026-04-22");
  const y1 = predictorDates("2026-10-21", "1y");
  assert.equal(y1.length, 14);
  assert.equal(y1[0], "2025-10-22");
  assert.equal(y1.at(-1), "2026-10-21");
  assert.equal(windowRange("2026-10-21"), "r.2026-07-30.2026-10-21");
});

test("prediction series pairs each date with its window and the VO2 max on that date", () => {
  const windows = [{ end: "2026-10-21", cs: 3.807, dPrime: 131, best: {} }];
  const vo2 = [{ date: "2026-09-01", vo2max: 58 }];
  const series = predictionSeries(["2026-10-14", "2026-10-21"], windows, vo2);
  assert.equal(series.length, 2);
  assert.equal(series[0].real, null);
  near(series[1].real.half, 5720, 3, "real half");
  near(series[0].vo2.half, danielsTime(58, 21097.5), 0.5, "vo2 half");
});

test("time and value changes read as faster/slower with a real minus sign", () => {
  assert.equal(formatDelta(-110), "−1:50");
  assert.equal(formatDelta(12), "+0:12");
  assert.equal(formatDelta(0), "±0:00");
});

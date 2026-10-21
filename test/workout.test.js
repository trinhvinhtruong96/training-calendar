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

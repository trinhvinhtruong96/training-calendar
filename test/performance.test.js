import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPerformance } from "../site/src/performance.js";

const TODAY = "2026-10-26";
// intervals.icu settings as reduceSettings() returns them: threshold pace in m/s (4:50 /km).
const SETTINGS = { lthr: 178, maxHr: 200, thresholdPace: 1000 / 290 };
// Last 90 days without a hard effort: best 60 and 30 min HR stay under 88 % of max HR (176).
const NO_HARD_EFFORT = { h60: 166, h30: 170, h1: 189 };
const race = {
  id: 9, date: "2027-01-10", category: "WORKOUT", name: "W11 Sun - RACE 21.1 km", description: "", distance: 21100,
  movingTime: 6240, pairedActivityId: null, sport: "Run",
  steps: [{ text: "Race", distance: 19100, pace: { start: 295, end: 298, units: "secs/km" } }],
};

function data({ hrNow = NO_HARD_EFFORT, cs = 3.66, settings = SETTINGS, events = [] } = {}) {
  return {
    events,
    activities: [],
    performance: {
      paceNow: { cs, bests: {} }, pacePlanStart: null, hrNow, hrPlanStart: null, wellness: [], settings,
      denied: { wellness: false, settings: false }, laps: {}, loadFailed: false,
    },
  };
}

const texts = tile => tile.lines.map(l => l.text);

test("without a hard effort in 90 days the card shows intervals.icu's threshold settings", () => {
  const out = buildPerformance(data({ events: [race] }), TODAY);
  assert.equal(out.hr.value, "178 bpm");
  assert.ok(texts(out.hr).includes("From your intervals.icu settings · a test or race of 30+ min updates it"));
  assert.equal(out.pace.value, "4:50 /km");
  assert.ok(texts(out.pace).includes("From your intervals.icu settings"));
  assert.ok(texts(out.pace).some(t => /^Goal \d:\d\d for your race pace 4:57 · /.test(t)), texts(out.pace).join(" | "));
});

test("the threshold HR from the settings sets the easy-run limit", () => {
  const out = buildPerformance(data(), TODAY);
  assert.deepEqual(out.limits, { lt: 178, easyLimit: 150 });
});

test("values taken from the settings are not compared with themselves", () => {
  const out = buildPerformance(data(), TODAY);
  assert.equal(out.settingsNote, null);
  assert.ok(!out.suggestions.some(s => /^Set threshold/.test(s)), out.suggestions.join(" | "));
});

test("an estimate from the last 90 days of runs wins over the settings", () => {
  const out = buildPerformance(data({ hrNow: { h60: 180, h30: 181, h1: 192 }, settings: { ...SETTINGS, lthr: 172 } }), TODAY);
  assert.equal(out.hr.value, "180 bpm");
  assert.match(out.settingsNote, /threshold HR 172 set/);
});

test("with neither a hard effort nor settings the tiles stay empty", () => {
  const out = buildPerformance(data({ hrNow: { h60: 150, h30: 155, h1: 189 }, settings: null }), TODAY);
  assert.equal(out.hr.value, null);
  assert.equal(out.pace.value, null);
  assert.deepEqual(out.limits, { lt: null, easyLimit: null });
});

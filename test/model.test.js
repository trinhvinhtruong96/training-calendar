import { test } from "node:test";
import assert from "node:assert/strict";
import {
  activityUrl, buildModel, dayLabel, dayUrl, headerInfo, primaryWorkout, resultText, runSummary, statusInfo,
} from "../site/src/model.js";
import { activities, events } from "./fixtures.js";

const data = { events, activities };

test("model covers 12 weeks from Mon 19 Oct to race day", () => {
  const m = buildModel(data, "2026-10-23");
  assert.equal(m.days.length, 84);
  assert.equal(m.days[0].date, "2026-10-19");
  assert.equal(m.days.at(-1).date, "2027-01-10");
  assert.equal(m.weeks.length, 12);
  assert.equal(m.weeks[0].phase, "Start");
  assert.equal(m.weeks[9].phase, "Key week");
  assert.equal(m.weeks[11].phase, "Race");
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
  assert.equal(label("2026-10-21"), "Wed 21 Oct, 10×400 @4:05, 5.6 km, done, 5.62 km at 7:09 per km");
  assert.equal(label("2026-10-23"), "Fri 23 Oct, today, Threshold 2×3 km, 8 km, not done yet");
  assert.equal(label("2026-10-20"), "Tue 20 Oct, rest day, extra run, 3 km");
  assert.equal(label("2026-10-24"), "Sat 24 Oct, nothing planned");
});

test("header text before, during and after the plan", () => {
  assert.equal(headerInfo("2026-10-15").text, "Plan starts Tue 20 Oct · 87 days to race");
  assert.equal(headerInfo("2026-10-15").progress, 0);
  const now = headerInfo("2026-10-21");
  assert.equal(now.text, "Week 1 of 12 · Day 2 of 83 · 81 days to race");
  assert.ok(Math.abs(now.progress - 2 / 83) < 1e-9);
  assert.equal(headerInfo("2027-01-09").text, "Week 12 of 12 · Day 82 of 83 · 1 day to race");
  assert.equal(headerInfo("2027-01-10").text, "Race day · Sun 10 Jan");
  assert.equal(headerInfo("2027-01-12").text, "Plan complete · race was Sun 10 Jan");
  assert.equal(headerInfo("2027-01-12").progress, 1);
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

test("a non-run event on a plan day does not take the run or the day's mark", () => {
  const gym = {
    id: 50, date: "2026-10-22", category: "WORKOUT", sport: "WeightTraining", name: "Gym", description: "",
    distance: 0, movingTime: 2700, pairedActivityId: null, steps: [],
  };
  const testDay = { ...events[2], name: "W03 Thu - TEST 1 10 km" };
  const planned = [gym, ...events.filter(e => e.id !== 3), testDay];
  const m = buildModel({ events: planned, activities }, "2026-10-23");
  const day = m.byDate.get("2026-10-22");
  assert.equal(day.workouts.find(w => w.id === 3).run.id, "i13");
  assert.equal(day.workouts.find(w => w.id === 50).run, null);
  assert.equal(primaryWorkout(day).id, 3);
  assert.equal(day.status, "partial");

  const lifted = { id: "i30", date: "2026-10-22", type: "WeightTraining", name: "Gym", distance: 0, movingTime: 2600, avgHr: null, pairedEventId: null, compliance: null };
  const m2 = buildModel({ events: planned, activities: [...activities, lifted] }, "2026-10-23");
  assert.equal(m2.byDate.get("2026-10-22").workouts.find(w => w.id === 50).run.id, "i30");
  assert.equal(m2.byDate.get("2026-10-22").status, "done");
});

test("primary workout: test, key or race first, then a run, else the first entry", () => {
  const m = buildModel(data, "2026-10-23");
  assert.equal(primaryWorkout(m.byDate.get("2026-10-21")).id, 2);
  assert.equal(primaryWorkout(m.byDate.get("2026-10-20")), null);
  const gymOnly = { date: "2026-10-24", workouts: [{ id: 9, type: "run", sport: "WeightTraining" }] };
  assert.equal(primaryWorkout(gymOnly).id, 9);
});

test("result line for each kind of day", () => {
  const today = "2026-10-23";
  const m = buildModel(data, today);
  const r = d => resultText(m.byDate.get(d), today);
  assert.deepEqual(r("2026-10-21"), { kind: "done", text: "✓ 5.62 km · 7:09/km", spoken: "5.62 km at 7:09 per km" });
  assert.deepEqual(r("2026-10-20"), { kind: "extra", text: "+ 3 km run", spoken: "3 km" });
  assert.deepEqual(r("2026-10-23"), { kind: "today", text: "Today", spoken: "" });
  assert.deepEqual(r("2026-10-25"), { kind: "planned", text: "", spoken: "" });
  assert.deepEqual(r("2026-10-24"), { kind: "empty", text: "", spoken: "" });
  const later = buildModel(data, "2026-10-26");
  assert.deepEqual(resultText(later.byDate.get("2026-10-23"), "2026-10-26"), { kind: "missed", text: "! Missed", spoken: "" });
});

test("result line for a partly done day, a plain rest day and a run without numbers", () => {
  const second = { ...events[2], id: 99, name: "Strides 2 km", distance: 2000 };
  const partial = buildModel({ events: [...events, second], activities }, "2026-10-23");
  assert.deepEqual(resultText(partial.byDate.get("2026-10-22"), "2026-10-23"), { kind: "partial", text: "◐ 1 of 2 done", spoken: "1 of 2 workouts done" });

  const rest = buildModel({ events, activities: activities.filter(a => a.id !== "i10") }, "2026-10-23");
  assert.deepEqual(resultText(rest.byDate.get("2026-10-20"), "2026-10-23"), { kind: "rest", text: "", spoken: "" });

  const blank = { id: "i40", date: "2026-10-25", type: "Run", name: "Run", distance: 0, movingTime: 0, avgHr: null, pairedEventId: null, compliance: null };
  const manual = buildModel({ events, activities: [...activities, blank] }, "2026-10-26");
  assert.deepEqual(resultText(manual.byDate.get("2026-10-25"), "2026-10-26"), { kind: "done", text: "✓ Done", spoken: "" });
});

test("links to intervals.icu", () => {
  assert.equal(activityUrl("i11"), "https://intervals.icu/activities/i11");
  assert.equal(dayUrl("2026-10-21"), "https://intervals.icu/?w=2026-10-19");
});

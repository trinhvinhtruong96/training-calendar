import { test } from "node:test";
import assert from "node:assert/strict";
import { activityUrl, buildModel, dayLabel, dayUrl, headerInfo, runSummary, statusInfo } from "../site/src/model.js";
import { activities, events } from "./fixtures.js";

const data = { events, activities };

test("model covers 15 weeks from Mon 19 Oct to race day", () => {
  const m = buildModel(data, "2026-10-23");
  assert.equal(m.days.length, 105);
  assert.equal(m.days[0].date, "2026-10-19");
  assert.equal(m.days.at(-1).date, "2027-01-31");
  assert.equal(m.weeks.length, 15);
  assert.equal(m.weeks[0].phase, "Start");
  assert.equal(m.weeks[11].phase, "Key week");
  assert.equal(m.weeks[14].phase, "Race");
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
  assert.equal(label("2026-10-21"), "Wed 21 Oct, 10×400 @4:05, 5.6 km, done");
  assert.equal(label("2026-10-23"), "Fri 23 Oct, today, Threshold 2×3 km, 8 km, not done yet");
  assert.equal(label("2026-10-20"), "Tue 20 Oct, rest day, extra run");
  assert.equal(label("2026-10-24"), "Sat 24 Oct, nothing planned");
});

test("header text before, during and after the plan", () => {
  assert.equal(headerInfo("2026-10-15").text, "Plan starts Tue 20 Oct · 108 days to race");
  assert.equal(headerInfo("2026-10-15").progress, 0);
  const now = headerInfo("2026-10-21");
  assert.equal(now.text, "Week 1 of 15 · Day 2 of 104 · 102 days to race");
  assert.ok(Math.abs(now.progress - 2 / 104) < 1e-9);
  assert.equal(headerInfo("2027-01-30").text, "Week 15 of 15 · Day 103 of 104 · 1 day to race");
  assert.equal(headerInfo("2027-01-31").text, "Race day · Sun 31 Jan");
  assert.equal(headerInfo("2027-02-02").text, "Plan complete · race was Sun 31 Jan");
  assert.equal(headerInfo("2027-02-02").progress, 1);
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

test("links to intervals.icu", () => {
  assert.equal(activityUrl("i11"), "https://intervals.icu/activities/i11");
  assert.equal(dayUrl("2026-10-21"), "https://intervals.icu/?w=2026-10-19");
});

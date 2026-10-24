import { test } from "node:test";
import assert from "node:assert/strict";
import {
  addDays, clampWeek, dayNumber, daysToRace, diffDays, formatClock, formatDate, formatDuration, formatKm, formatPace,
  formatShortRange, localToday, mondayOf, timeAgo, totalDays, weekNumber, weekdayIndex,
} from "../site/src/dates.js";

test("addDays and diffDays cross months and years", () => {
  assert.equal(addDays("2026-12-31", 1), "2027-01-01");
  assert.equal(addDays("2026-10-19", 104), "2027-01-31");
  assert.equal(diffDays("2026-10-20", "2027-01-31"), 103);
  assert.equal(diffDays("2026-10-21", "2026-10-20"), -1);
});

test("weekday and Monday of a date", () => {
  assert.equal(weekdayIndex("2026-10-19"), 0);
  assert.equal(weekdayIndex("2026-10-25"), 6);
  assert.equal(mondayOf("2026-10-21"), "2026-10-19");
  assert.equal(mondayOf("2027-01-31"), "2027-01-25");
});

test("plan week, day and countdown numbers", () => {
  assert.equal(weekNumber("2026-10-19"), 1);
  assert.equal(weekNumber("2026-10-25"), 1);
  assert.equal(weekNumber("2026-10-26"), 2);
  assert.equal(weekNumber("2027-01-10"), 12);
  assert.equal(weekNumber("2026-10-01"), -2);
  assert.equal(clampWeek(-2), 1);
  assert.equal(clampWeek(20), 12);
  assert.equal(dayNumber("2026-10-21"), 2);
  assert.equal(totalDays(), 83);
  assert.equal(daysToRace("2026-10-21"), 81);
});

test("local today uses the device clock around midnight", () => {
  assert.equal(localToday(new Date(2026, 9, 21, 23, 59)), "2026-10-21");
  assert.equal(localToday(new Date(2026, 9, 22, 0, 1)), "2026-10-22");
});

test("formats dates, distances, paces and times", () => {
  assert.equal(formatDate("2026-10-21"), "Wed 21 Oct");
  assert.equal(formatDate("2027-01-31"), "Sun 31 Jan");
  assert.equal(formatKm(5600), "5.6");
  assert.equal(formatKm(12000), "12");
  assert.equal(formatKm(5620, 2), "5.62");
  assert.equal(formatPace(245), "4:05");
  assert.equal(formatPace(299.6), "5:00");
  assert.equal(formatDuration(2424), "40 min");
  assert.equal(formatDuration(5400), "1 h 30 min");
  assert.equal(formatClock(2412), "40:12");
  assert.equal(formatClock(5731), "1:35:31");
});

test("short week ranges", () => {
  assert.equal(formatShortRange("2026-11-02", "2026-11-08"), "2–8 Nov");
  assert.equal(formatShortRange("2026-11-30", "2026-12-06"), "30 Nov – 6 Dec");
  assert.equal(formatShortRange("2026-12-28", "2027-01-03"), "28 Dec – 3 Jan");
});

test("timeAgo describes when data was fetched", () => {
  const now = new Date(2026, 9, 21, 10, 0);
  assert.equal(timeAgo(null, now), "never");
  assert.equal(timeAgo(new Date(2026, 9, 21, 9, 59, 30).toISOString(), now), "just now");
  assert.equal(timeAgo(new Date(2026, 9, 21, 9, 58).toISOString(), now), "2 min ago");
  assert.equal(timeAgo(new Date(2026, 9, 21, 7, 5).toISOString(), now), "at 07:05");
  assert.equal(timeAgo(new Date(2026, 9, 20, 18, 30).toISOString(), now), "Tue 20 Oct 18:30");
});

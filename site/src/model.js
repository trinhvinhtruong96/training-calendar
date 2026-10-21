// Turns intervals.icu events and activities into days, weeks and statuses.
import { PLAN } from "./config.js";
import {
  addDays, clampWeek, dayNumber, daysToRace, formatClock, formatDate, formatKm, formatPace, mondayOf, totalDays, weekNumber,
} from "./dates.js";
import { shortName, workoutType } from "./workout.js";

export function isRun(activity) {
  return /run/i.test(activity?.type ?? "");
}

const sum = (items, pick) => items.reduce((total, item) => total + (Number(pick(item)) || 0), 0);
const sameId = (a, b) => a != null && b != null && String(a) === String(b);
const isRunSport = sport => !sport || /run/i.test(sport);
const MARKED = new Set(["test", "key", "race"]);

// A run fits a run workout; anything else (e.g. WeightTraining) only fits its own sport.
function fits(workout, activity) {
  if (isRunSport(workout.sport)) return isRun(activity);
  return String(activity.type ?? "").toLowerCase() === String(workout.sport).toLowerCase();
}

// The workout that colours and marks the day: test/key/race first, then a run, else the first entry.
export function primaryWorkout(day) {
  return day.workouts.find(w => MARKED.has(w.type)) ?? day.workouts.find(w => isRunSport(w.sport)) ?? day.workouts[0] ?? null;
}

export function buildModel(data, today, plan = PLAN) {
  const events = data?.events ?? [];
  const activities = data?.activities ?? [];
  const days = [];
  const byDate = new Map();
  for (let i = 0; i < plan.weeks * 7; i++) {
    const date = addDays(plan.calendarStart, i);
    const day = {
      date,
      week: Math.floor(i / 7) + 1,
      weekday: i % 7,
      isToday: date === today,
      workouts: [],
      notes: [],
      activities: [],
      extraRuns: [],
      others: [],
      status: "empty",
    };
    days.push(day);
    byDate.set(date, day);
  }

  for (const e of events) {
    const day = byDate.get(e.date);
    if (!day) continue;
    if (e.category === "WORKOUT") day.workouts.push({ ...e, type: workoutType(e.name), run: null });
    else if (e.category === "NOTE") day.notes.push(e);
  }
  for (const a of activities) byDate.get(a.date)?.activities.push(a);

  // 1) intervals.icu's own pairing, from either side; 2) a run on the same date.
  const used = new Set();
  for (const w of days.flatMap(d => d.workouts)) {
    const a = activities.find(x => !used.has(x.id) && (sameId(x.pairedEventId, w.id) || sameId(w.pairedActivityId, x.id)));
    if (a) {
      w.run = a;
      used.add(a.id);
    }
  }
  for (const day of days) {
    for (const w of day.workouts) {
      if (w.run) continue;
      const a = day.activities.find(x => fits(w, x) && !used.has(x.id));
      if (a) {
        w.run = a;
        used.add(a.id);
      }
    }
    for (const a of day.activities) {
      if (!used.has(a.id)) (isRun(a) ? day.extraRuns : day.others).push(a);
    }
    day.status = dayStatus(day, today);
  }

  const weeks = [];
  for (let n = 1; n <= plan.weeks; n++) {
    const wdays = days.slice((n - 1) * 7, n * 7);
    weeks.push({
      number: n,
      phase: plan.phases[n - 1] ?? "",
      start: wdays[0].date,
      end: wdays[6].date,
      days: wdays,
      plannedM: sum(wdays.flatMap(d => d.workouts), w => w.distance),
      doneM: sum(wdays.flatMap(d => d.activities).filter(isRun), a => a.distance),
    });
  }

  const workouts = days.flatMap(d => d.workouts);
  const totals = {
    plannedM: sum(weeks, w => w.plannedM),
    doneM: sum(weeks, w => w.doneM),
    workouts: workouts.length,
    doneWorkouts: workouts.filter(w => w.run).length,
    missedWorkouts: workouts.filter(w => !w.run && w.date < today).length,
  };
  return { today, days, byDate, weeks, totals };
}

export function dayStatus(day, today) {
  const total = day.workouts.length;
  if (!total) return day.notes.length ? "rest" : "empty";
  const done = day.workouts.filter(w => w.run).length;
  if (done === total) return "done";
  if (done > 0) return "partial";
  return day.date < today ? "missed" : "planned";
}

export function statusInfo(day, today) {
  const isToday = day.date === today;
  switch (day.status) {
    case "done":
      return { key: "done", icon: "✓", short: "Done", label: "done" };
    case "partial":
      return { key: "partial", icon: "◐", short: "Part done", label: "partly done" };
    case "missed":
      return { key: "missed", icon: "!", short: "Missed", label: "missed" };
    case "planned":
      return isToday
        ? { key: "today", icon: "•", short: "Today", label: "not done yet" }
        : { key: "planned", icon: "", short: "", label: "planned" };
    case "rest":
      return day.extraRuns.length
        ? { key: "rest", icon: "+", short: "Extra run", label: "rest day, extra run" }
        : { key: "rest", icon: "", short: isToday ? "Rest" : "", label: "rest day" };
    default:
      return { key: "empty", icon: "", short: "", label: "nothing planned" };
  }
}

export function dayLabel(day, today) {
  const parts = [formatDate(day.date)];
  if (day.date === today) parts.push("today");
  for (const w of day.workouts) {
    parts.push(w.distance ? `${shortName(w.name)}, ${formatKm(w.distance)} km` : shortName(w.name));
  }
  parts.push(statusInfo(day, today).label);
  return parts.join(", ");
}

export function headerInfo(today, plan = PLAN) {
  const total = totalDays(plan);
  const day = dayNumber(today, plan);
  const toRace = daysToRace(today, plan);
  const week = weekNumber(today, plan);
  let text;
  if (today < plan.firstDay) text = `Plan starts ${formatDate(plan.firstDay)} · ${toRace} days to race`;
  else if (toRace > 0) text = `Week ${week} of ${plan.weeks} · Day ${day} of ${total} · ${toRace} ${toRace === 1 ? "day" : "days"} to race`;
  else if (toRace === 0) text = `Race day · ${formatDate(plan.raceDay)}`;
  else text = `Plan complete · race was ${formatDate(plan.raceDay)}`;
  return {
    week,
    day,
    total,
    toRace,
    progress: Math.min(1, Math.max(0, day / total)),
    text,
    phase: plan.phases[clampWeek(week, plan) - 1],
  };
}

export function activityUrl(id) {
  return `https://intervals.icu/activities/${encodeURIComponent(id)}`;
}

export function dayUrl(iso) {
  return `https://intervals.icu/?w=${mondayOf(iso)}`;
}

export function runSummary(a) {
  const km = (a.distance || 0) / 1000;
  const pace = km > 0 && a.movingTime > 0 ? a.movingTime / km : null;
  return {
    distance: km > 0 ? `${formatKm(a.distance, 2)} km` : "",
    time: a.movingTime > 0 ? formatClock(a.movingTime) : "",
    pace: pace ? `${formatPace(pace)} /km` : "",
    hr: a.avgHr ? `${Math.round(a.avgHr)} bpm` : "",
    compliance: a.compliance != null ? `${Math.round(a.compliance)}%` : "",
    url: activityUrl(a.id),
  };
}

// Date math on "YYYY-MM-DD" strings (no time zones) and display formatting.
import { PLAN } from "./config.js";

const DAY_MS = 86_400_000;
export const WEEKDAYS = Object.freeze(["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"]);
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const pad = n => String(n).padStart(2, "0");

function toUtc(iso) {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

export function addDays(iso, n) {
  return fromUtc(toUtc(iso) + n * DAY_MS);
}

export function diffDays(from, to) {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

export function weekdayIndex(iso) {
  return (new Date(toUtc(iso)).getUTCDay() + 6) % 7;
}

export function mondayOf(iso) {
  return addDays(iso, -weekdayIndex(iso));
}

export function localToday(now = new Date()) {
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

export function weekNumber(iso, plan = PLAN) {
  return Math.floor(diffDays(plan.calendarStart, iso) / 7) + 1;
}

export function clampWeek(week, plan = PLAN) {
  return Math.min(plan.weeks, Math.max(1, week));
}

export function dayNumber(iso, plan = PLAN) {
  return diffDays(plan.firstDay, iso) + 1;
}

export function totalDays(plan = PLAN) {
  return diffDays(plan.firstDay, plan.raceDay) + 1;
}

export function daysToRace(iso, plan = PLAN) {
  return diffDays(iso, plan.raceDay);
}

export function formatDate(iso) {
  const [, m, d] = iso.split("-").map(Number);
  return `${WEEKDAYS[weekdayIndex(iso)]} ${d} ${MONTHS[m - 1]}`;
}

// "2–8 Nov", or "30 Nov – 6 Dec" when the range crosses a month.
export function formatShortRange(from, to) {
  const [, m1, d1] = from.split("-").map(Number);
  const [, m2, d2] = to.split("-").map(Number);
  if (m1 === m2) return `${d1}–${d2} ${MONTHS[m2 - 1]}`;
  return `${d1} ${MONTHS[m1 - 1]} – ${d2} ${MONTHS[m2 - 1]}`;
}

export function formatKm(metres, digits = 1) {
  return String(Number((metres / 1000).toFixed(digits)));
}

export function formatPace(secondsPerKm) {
  const total = Math.round(secondsPerKm);
  return `${Math.floor(total / 60)}:${pad(total % 60)}`;
}

export function formatDuration(seconds) {
  const mins = Math.round(seconds / 60);
  if (mins < 60) return `${mins} min`;
  return `${Math.floor(mins / 60)} h ${pad(mins % 60)} min`;
}

export function formatClock(seconds) {
  const total = Math.round(seconds);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return h ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
}

export function timeAgo(iso, now = new Date()) {
  if (!iso) return "never";
  const then = new Date(iso);
  const mins = Math.floor((now - then) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const clock = `${pad(then.getHours())}:${pad(then.getMinutes())}`;
  if (localToday(then) === localToday(now)) return `at ${clock}`;
  return `${formatDate(localToday(then))} ${clock}`;
}

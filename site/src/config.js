// Plan constants. Everything else comes from intervals.icu at runtime.
export const PLAN = Object.freeze({
  title: "HM sub-2:00",
  calendarStart: "2026-10-19", // Monday of week 1
  firstDay: "2026-10-20", // first day with a plan entry
  raceDay: "2027-01-31",
  weeks: 15,
  phases: Object.freeze([
    "Start", "Adapt", "Adapt", "Adapt", "Light", "Build", "Build", "Build",
    "Peak", "Light", "Race-specific", "Key week", "Race-specific", "Taper", "Race",
  ]),
});

export const API_BASE = "https://intervals.icu/api/v1";

export const STORAGE_KEYS = Object.freeze({
  key: "tc.v1.key",
  data: "tc.v1.data",
  theme: "tc.v1.theme",
  shortcut: "tc.v1.shortcut",
});

// Plan constants. Everything else comes from intervals.icu at runtime.
export const PLAN = Object.freeze({
  title: "HM sub-1:30",
  calendarStart: "2026-10-19", // Monday of week 1
  firstDay: "2026-10-20", // first day with a plan entry
  raceDay: "2027-01-10",
  weeks: 12,
  phases: Object.freeze([
    "Start", "Adapt", "Adapt", "Light", "Build", "Build", "Peak", "Light",
    "Race-specific", "Key week", "Taper", "Race",
  ]),
});

export const API_BASE = "https://intervals.icu/api/v1";

// "Log in with intervals.icu": OAuth for a public client with PKCE, so no secret is needed.
// clientId comes from the app registered at https://intervals.icu/oauth/apply (it is not a secret).
// While it is empty, the setup screen offers the API key only.
export const OAUTH = Object.freeze({
  clientId: "",
  authorizeUrl: "https://intervals.icu/oauth/authorize",
  tokenUrl: "https://intervals.icu/api/oauth/token",
  scope: "CALENDAR:READ,ACTIVITY:READ",
});

export const STORAGE_KEYS = Object.freeze({
  key: "tc.v1.key",
  token: "tc.v1.token",
  data: "tc.v1.data",
  theme: "tc.v1.theme",
  shortcut: "tc.v1.shortcut",
  login: "tc.v1.login", // sessionStorage: the PKCE verifier and state while a login is under way
});

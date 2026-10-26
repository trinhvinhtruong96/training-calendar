// Read-only intervals.icu client and the browser-side store (key or login, cached data, settings).
import { API_BASE, PLAN, STORAGE_KEYS } from "./config.js";
import { addDays } from "./dates.js";
import { MIN_RUN_M, curveWindow, windowFrom } from "./performance.js";

export class KeyError extends Error {
  constructor(message = "Key not accepted", reason = "rejected") {
    super(message);
    this.name = "KeyError";
    this.reason = reason;
  }
}

export class NetworkError extends Error {
  constructor(message = "Cannot reach intervals.icu") {
    super(message);
    this.name = "NetworkError";
  }
}

export class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.name = "HttpError";
    this.status = status;
  }
}

const defaultFetch = (url, init) => globalThis.fetch(url, init);
const KEY_PATTERN = /^[\x21-\x7e]{8,}$/;

// auth is { type: "key", secret } for an API key or { type: "oauth", secret } for a login token.
export function authHeader(auth) {
  return auth.type === "oauth" ? `Bearer ${auth.secret}` : `Basic ${btoa(`API_KEY:${auth.secret}`)}`;
}

export async function request(path, auth, fetchImpl = defaultFetch) {
  let res;
  try {
    res = await fetchImpl(`${API_BASE}${path}`, {
      headers: { Authorization: authHeader(auth), Accept: "application/json" },
    });
  } catch {
    throw new NetworkError();
  }
  if (res.status === 401) throw new KeyError();
  if (res.status === 403) {
    const body = await res.text().catch(() => "");
    if (body.includes("cloudflare_error")) throw new HttpError(403, "intervals.icu blocked the request (HTTP 403)");
    throw new KeyError();
  }
  if (!res.ok) throw new HttpError(res.status, `intervals.icu answered HTTP ${res.status}`);
  try {
    return await res.json();
  } catch {
    throw new HttpError(res.status, "Unexpected reply from intervals.icu");
  }
}

// localStorage wrapper that falls back to memory when storage is blocked or full.
export function createStore(storage) {
  const memory = new Map();
  const read = k => {
    try {
      const v = storage?.getItem(k);
      if (v != null) return v;
    } catch {
      // storage blocked: use memory
    }
    return memory.has(k) ? memory.get(k) : null;
  };
  const write = (k, v) => {
    memory.set(k, v);
    try {
      storage?.setItem(k, v);
    } catch {
      // quota or blocked: memory copy is enough for this session
    }
  };
  const remove = k => {
    memory.delete(k);
    try {
      storage?.removeItem(k);
    } catch {
      // nothing to remove
    }
  };
  return {
    getAuth() {
      const token = read(STORAGE_KEYS.token);
      if (token) return { type: "oauth", secret: token };
      const key = read(STORAGE_KEYS.key);
      return key ? { type: "key", secret: key } : null;
    },
    setAuth({ type, secret }) {
      remove(type === "oauth" ? STORAGE_KEYS.key : STORAGE_KEYS.token);
      write(type === "oauth" ? STORAGE_KEYS.token : STORAGE_KEYS.key, secret);
    },
    getCache() {
      const raw = read(STORAGE_KEYS.data);
      if (!raw) return null;
      try {
        const data = JSON.parse(raw);
        return data && Array.isArray(data.events) && Array.isArray(data.activities) ? data : null;
      } catch {
        return null;
      }
    },
    setCache: data => write(STORAGE_KEYS.data, JSON.stringify(data)),
    getTheme: () => read(STORAGE_KEYS.theme) || "system",
    setTheme: theme => write(STORAGE_KEYS.theme, theme),
    getShortcut: () => read(STORAGE_KEYS.shortcut) !== "off",
    setShortcut: on => write(STORAGE_KEYS.shortcut, on ? "on" : "off"),
    forget() {
      remove(STORAGE_KEYS.key);
      remove(STORAGE_KEYS.token);
      remove(STORAGE_KEYS.data);
    },
  };
}

export function reduceStep(s) {
  const out = { text: s.text ?? "" };
  if (s.distance) out.distance = s.distance;
  if (s.duration) out.duration = s.duration;
  if (s.pace) {
    out.pace = {
      start: s.pace.start ?? s.pace.value ?? null,
      end: s.pace.end ?? s.pace.value ?? null,
      units: s.pace.units ?? "",
    };
  }
  if (s.reps) {
    out.reps = s.reps;
    out.steps = (s.steps ?? []).map(reduceStep);
  }
  return out;
}

export function reduceEvent(e) {
  return {
    id: e.id,
    date: String(e.start_date_local ?? "").slice(0, 10),
    category: e.category ?? "",
    name: e.name ?? "",
    description: e.description ?? "",
    distance: e.distance ?? 0,
    movingTime: e.moving_time ?? 0,
    pairedActivityId: e.paired_activity_id ?? null,
    sport: e.type ?? "",
    steps: (e.workout_doc?.steps ?? []).map(reduceStep),
  };
}

export function reduceActivity(a) {
  return {
    id: String(a.id),
    date: String(a.start_date_local ?? "").slice(0, 10),
    type: a.type ?? "",
    name: a.name ?? "",
    distance: a.distance ?? 0,
    movingTime: a.moving_time ?? 0,
    avgHr: a.average_heartrate ?? null,
    pairedEventId: a.paired_event_id ?? null,
    compliance: a.compliance ?? null,
  };
}

const BEST_METRES = [1000, 3000, 5000, 10000, 21097.5];

// One pace-curve window: intervals.icu's critical speed and the best times at the race distances.
export function reducePaceCurve(c) {
  if (!c) return null;
  const model = (c.paceModels ?? []).find(m => m.type === "CS");
  const distances = c.distance ?? [];
  const bests = {};
  for (const target of BEST_METRES) {
    const i = distances.findIndex(d => Math.abs(d - target) <= 1);
    if (i >= 0 && c.values?.[i] > 0) bests[target] = { secs: c.values[i], activityId: String(c.activity_id?.[i] ?? "") };
  }
  return { cs: model?.criticalSpeed ?? null, bests };
}

// One HR-curve window: best HR held for 60 min, 30 min and 1 min.
export function reduceHrCurve(c) {
  if (!c) return null;
  const at = secs => {
    const i = (c.secs ?? []).indexOf(secs);
    return i >= 0 && c.values?.[i] > 0 ? c.values[i] : null;
  };
  return { h60: at(3600), h30: at(1800), h1: at(60) };
}

export function reduceWellness(rows) {
  return (Array.isArray(rows) ? rows : []).map(r => ({
    date: String(r.id ?? "").slice(0, 10),
    restingHR: r.restingHR ?? null,
    ctl: r.ctl ?? null,
    atl: r.atl ?? null,
  }));
}

export function reduceSettings(athlete) {
  const run = (athlete?.sportSettings ?? []).find(s => (s.types ?? []).includes("Run"));
  return run ? { lthr: run.lthr ?? null, maxHr: run.max_hr ?? null, thresholdPace: run.threshold_pace ?? null } : null;
}

export function reduceLaps(reply) {
  return (reply?.icu_intervals ?? []).map(l => ({
    distance: l.distance ?? 0,
    movingTime: l.moving_time ?? 0,
    avgHr: l.average_heartrate ?? null,
  }));
}

export async function connect(rawKey, { store, fetchImpl = defaultFetch }) {
  const key = String(rawKey ?? "").trim();
  if (!KEY_PATTERN.test(key)) throw new KeyError("That doesn't look like an intervals.icu API key.", "format");
  const auth = { type: "key", secret: key };
  const athlete = await request("/athlete/0", auth, fetchImpl);
  const athleteName = athlete?.name || athlete?.firstname || "";
  store.setAuth(auth);
  store.setCache({ fetchedAt: null, athleteName, events: [], activities: [] });
  return { athleteName };
}

// After "Log in with intervals.icu": the token reply already carries the athlete's name.
export function saveLogin(token, athleteName, { store }) {
  store.setAuth({ type: "oauth", secret: token });
  store.setCache({ fetchedAt: null, athleteName, events: [], activities: [] });
}

// Requests for the Performance card never break the calendar and never log anyone out (spec §3).
async function softRequest(path, auth, fetchImpl) {
  try {
    return { value: await request(path, auth, fetchImpl) };
  } catch (err) {
    return { failed: true, denied: err instanceof KeyError };
  }
}

async function loadPerformance({ extras, activities, prev, auth, fetchImpl, today, plan }) {
  const [pace, hr, wellness, athlete] = await extras;
  const idNow = curveWindow(today);
  const idStart = curveWindow(plan.firstDay);
  const curve = (res, id) => (res.value?.list ?? []).find(c => c.id === id) ?? null;
  const from = windowFrom(today);
  const runs = activities.filter(a => /run/i.test(a.type) && a.distance >= MIN_RUN_M && a.date >= from && a.date <= today);
  const oldLaps = prev?.laps ?? {};
  const laps = {};
  await Promise.all(runs.map(async a => {
    if (oldLaps[a.id]?.length) {
      laps[a.id] = oldLaps[a.id];
      return;
    }
    const res = await softRequest(`/activity/${encodeURIComponent(a.id)}/intervals`, auth, fetchImpl);
    const reduced = res.failed ? [] : reduceLaps(res.value);
    if (reduced.length) laps[a.id] = reduced; // none yet while intervals.icu is analysing: ask again next time
  }));
  return {
    paceNow: pace.failed ? prev?.paceNow ?? null : reducePaceCurve(curve(pace, idNow)),
    pacePlanStart: pace.failed ? prev?.pacePlanStart ?? null : reducePaceCurve(curve(pace, idStart)),
    hrNow: hr.failed ? prev?.hrNow ?? null : reduceHrCurve(curve(hr, idNow)),
    hrPlanStart: hr.failed ? prev?.hrPlanStart ?? null : reduceHrCurve(curve(hr, idStart)),
    wellness: wellness.denied ? [] : wellness.failed ? prev?.wellness ?? [] : reduceWellness(wellness.value),
    settings: athlete.denied ? null : athlete.failed ? prev?.settings ?? null : reduceSettings(athlete.value),
    denied: { wellness: Boolean(wellness.denied), settings: Boolean(athlete.denied) },
    laps,
    // Spec §6 "nothing saved yet": both curve requests failed and there are no earlier values to show.
    loadFailed: Boolean(pace.failed && hr.failed && !prev?.paceNow && !prev?.hrNow),
  };
}

export async function refresh({ store, today, fetchImpl = defaultFetch, plan = PLAN, now = new Date() }) {
  const auth = store.getAuth();
  if (!auth) throw new KeyError("No API key or login on this device", "missing");
  const from = windowFrom(today);
  const oldest = from < plan.calendarStart ? from : plan.calendarStart;
  const newest = today < plan.calendarStart ? plan.calendarStart : today;
  const curves = `${curveWindow(today)},${curveWindow(plan.firstDay)}`;
  // Started first so they run alongside the calendar requests; softRequest never rejects.
  const extras = Promise.all([
    softRequest(`/athlete/0/pace-curves?type=Run&curves=${curves}`, auth, fetchImpl),
    softRequest(`/athlete/0/hr-curves?type=Run&curves=${curves}`, auth, fetchImpl),
    softRequest(`/athlete/0/wellness?oldest=${addDays(today, -34)}&newest=${today}&fields=id,restingHR,ctl,atl`, auth, fetchImpl),
    softRequest("/athlete/0", auth, fetchImpl),
  ]);
  const [events, activities] = await Promise.all([
    request(`/athlete/0/events?oldest=${plan.calendarStart}&newest=${plan.raceDay}`, auth, fetchImpl),
    request(`/athlete/0/activities?oldest=${oldest}&newest=${newest}`, auth, fetchImpl),
  ]);
  const prev = store.getCache();
  const runs = (Array.isArray(activities) ? activities : []).map(reduceActivity);
  const data = {
    fetchedAt: now.toISOString(),
    athleteName: prev?.athleteName ?? "",
    events: (Array.isArray(events) ? events : []).map(reduceEvent),
    activities: runs,
    performance: await loadPerformance({ extras, activities: runs, prev: prev?.performance, auth, fetchImpl, today, plan }),
  };
  // Forget (or a new key or login) while this was loading: don't bring the old data back.
  if (store.getAuth()?.secret === auth.secret) store.setCache(data);
  return data;
}

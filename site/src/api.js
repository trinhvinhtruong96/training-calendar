// Read-only intervals.icu client and the browser-side store (key, cached data, settings).
import { API_BASE, PLAN, STORAGE_KEYS } from "./config.js";
import { addDays } from "./dates.js";
import { RACES, allPredictorDates, windowRange } from "./fitness.js";

const WELLNESS_DAYS = 400; // enough for the 6-month VO2 max chart and the 1-year race-predictor history

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

export function authHeader(key) {
  return `Basic ${btoa(`API_KEY:${key}`)}`;
}

export async function request(path, key, fetchImpl = defaultFetch) {
  let res;
  try {
    res = await fetchImpl(`${API_BASE}${path}`, {
      headers: { Authorization: authHeader(key), Accept: "application/json" },
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
    getKey: () => read(STORAGE_KEYS.key),
    setKey: key => write(STORAGE_KEYS.key, key),
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

export function reduceWellness(rows) {
  return (Array.isArray(rows) ? rows : [])
    .filter(r => r.vo2max > 0)
    .map(r => ({ date: String(r.id).slice(0, 10), vo2max: r.vo2max }))
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

// One entry per requested 12-week window: critical-speed model and real best times at the race distances.
export function reducePaceCurves(reply) {
  return (reply?.list ?? []).map(c => {
    const fromId = String(c.id ?? "").split(".")[2];
    const end = /^\d{4}-\d{2}-\d{2}$/.test(fromId ?? "") ? fromId : String(c.end_date_local ?? "").slice(0, 10);
    const model = (c.paceModels ?? []).find(m => m.type === "CS");
    const best = {};
    (c.distance ?? []).forEach((d, i) => {
      const race = RACES.find(r => Math.abs(d - r.metres) <= 1);
      if (race && c.values?.[i] > 0) best[race.metres] = c.values[i];
    });
    const runs = new Set((c.activity_id ?? []).filter(Boolean)).size;
    return { end, cs: model?.criticalSpeed ?? null, dPrime: model?.dPrime ?? null, best, runs };
  });
}

export async function connect(rawKey, { store, fetchImpl = defaultFetch }) {
  const key = String(rawKey ?? "").trim();
  if (!KEY_PATTERN.test(key)) throw new KeyError("That doesn't look like an intervals.icu API key.", "format");
  const athlete = await request("/athlete/0", key, fetchImpl);
  const athleteName = athlete?.name || athlete?.firstname || "";
  store.setKey(key);
  store.setCache({ fetchedAt: null, athleteName, events: [], activities: [] });
  return { athleteName };
}

export async function refresh({ store, today, fetchImpl = defaultFetch, plan = PLAN, now = new Date() }) {
  const key = store.getKey();
  if (!key) throw new KeyError("No API key on this device", "missing");
  const newest = today < plan.calendarStart ? plan.calendarStart : today;
  const curves = allPredictorDates(today).map(windowRange).join(",");
  const fitness = Promise.allSettled([
    request(`/athlete/0/wellness?oldest=${addDays(today, -WELLNESS_DAYS)}&newest=${today}&fields=id,vo2max`, key, fetchImpl),
    request(`/athlete/0/pace-curves.json?type=Run&curves=${curves}`, key, fetchImpl),
  ]);
  const [events, activities] = await Promise.all([
    request(`/athlete/0/events?oldest=${plan.calendarStart}&newest=${plan.raceDay}`, key, fetchImpl),
    request(`/athlete/0/activities?oldest=${plan.calendarStart}&newest=${newest}`, key, fetchImpl),
  ]);
  // Fitness data is nice to have: if either request fails, keep what we had.
  const [wellness, paces] = await fitness;
  const prev = store.getCache();
  const data = {
    fetchedAt: now.toISOString(),
    athleteName: prev?.athleteName ?? "",
    events: (Array.isArray(events) ? events : []).map(reduceEvent),
    activities: (Array.isArray(activities) ? activities : []).map(reduceActivity),
    vo2: wellness.status === "fulfilled" ? reduceWellness(wellness.value) : prev?.vo2 ?? [],
    paceWindows: paces.status === "fulfilled" ? reducePaceCurves(paces.value) : prev?.paceWindows ?? [],
  };
  // Forget key (or a new key) while this was loading: don't bring the old data back.
  if (store.getKey() === key) store.setCache(data);
  return data;
}

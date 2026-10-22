// Read-only intervals.icu client and the browser-side store (key or login, cached data, settings).
import { API_BASE, PLAN, STORAGE_KEYS } from "./config.js";

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

export async function refresh({ store, today, fetchImpl = defaultFetch, plan = PLAN, now = new Date() }) {
  const auth = store.getAuth();
  if (!auth) throw new KeyError("No API key or login on this device", "missing");
  const newest = today < plan.calendarStart ? plan.calendarStart : today;
  const [events, activities] = await Promise.all([
    request(`/athlete/0/events?oldest=${plan.calendarStart}&newest=${plan.raceDay}`, auth, fetchImpl),
    request(`/athlete/0/activities?oldest=${plan.calendarStart}&newest=${newest}`, auth, fetchImpl),
  ]);
  const data = {
    fetchedAt: now.toISOString(),
    athleteName: store.getCache()?.athleteName ?? "",
    events: (Array.isArray(events) ? events : []).map(reduceEvent),
    activities: (Array.isArray(activities) ? activities : []).map(reduceActivity),
  };
  // Forget (or a new key or login) while this was loading: don't bring the old data back.
  if (store.getAuth()?.secret === auth.secret) store.setCache(data);
  return data;
}

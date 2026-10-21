import { test } from "node:test";
import assert from "node:assert/strict";
import {
  HttpError, KeyError, NetworkError, authHeader, connect, createStore, reduceActivity, reduceEvent, refresh, request,
} from "../site/src/api.js";

const BASE = "https://intervals.icu/api/v1";

function memoryStorage() {
  const map = new Map();
  return {
    map,
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: k => { map.delete(k); },
  };
}

function brokenStorage() {
  const fail = () => { throw new Error("storage unavailable"); };
  return { getItem: fail, setItem: fail, removeItem: fail };
}

function reply(status, body) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { status, ok: status >= 200 && status < 300, text: async () => text, json: async () => JSON.parse(text) };
}

function fakeFetch(routes) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    const route = routes[url.slice(BASE.length).split("?")[0]];
    if (route instanceof Error) throw route;
    return route ?? reply(404, { error: "not found" });
  };
  fn.calls = calls;
  return fn;
}

const rawEvent = {
  id: 2, start_date_local: "2026-10-21T00:00:00", category: "WORKOUT", name: "W01 Wed - 10x400 @4:05",
  description: "+ gym", distance: 5600, moving_time: 2424, paired_activity_id: null, external_id: "x-2026-10-21", type: "Run",
  icu_ctl: 40, oauth_client_id: null,
  workout_doc: {
    distance: 5600,
    duration: 2424,
    steps: [
      { text: "Warmup", distance: 1600, duration: 544, pace: { start: 330, end: 350, units: "secs/km" } },
      {
        text: "", reps: 10, distance: 4000, duration: 1880,
        steps: [
          { text: "Rep", distance: 400, duration: 98, pace: { start: 242, end: 248, units: "secs/km" } },
          { text: "Rest", duration: 90 },
        ],
      },
    ],
  },
};

const rawActivity = {
  id: "i11", start_date_local: "2026-10-21T17:05:12", type: "Run", name: "Intervals", distance: 5620,
  moving_time: 2412, average_heartrate: 152.4, paired_event_id: 2, compliance: 96.4, device_name: "Watch", calories: 400,
};

test("auth header uses API_KEY and the key", () => {
  assert.equal(authHeader("abc123"), `Basic ${Buffer.from("API_KEY:abc123").toString("base64")}`);
});

test("request sends the key and returns JSON", async () => {
  const f = fakeFetch({ "/athlete/0": reply(200, { name: "Runner" }) });
  assert.deepEqual(await request("/athlete/0", "secret-key", f), { name: "Runner" });
  assert.equal(f.calls[0].url, `${BASE}/athlete/0`);
  assert.equal(f.calls[0].init.headers.Authorization, authHeader("secret-key"));
  assert.equal(f.calls[0].init.headers.Accept, "application/json");
});

test("request turns failures into clear errors", async () => {
  const run = route => request("/athlete/0", "k", fakeFetch({ "/athlete/0": route }));
  await assert.rejects(run(reply(401, { error: "Unauthorized" })), KeyError);
  await assert.rejects(run(reply(403, { error: "Access denied" })), KeyError);
  await assert.rejects(
    run(reply(403, { title: "Error 1010", cloudflare_error: true })),
    e => e instanceof HttpError && !(e instanceof KeyError) && e.status === 403,
  );
  await assert.rejects(run(reply(500, "oops")), e => e instanceof HttpError && e.status === 500);
  await assert.rejects(run(new TypeError("Failed to fetch")), NetworkError);
  await assert.rejects(run(reply(200, "<html>not json</html>")), HttpError);
});

test("events and activities are reduced to the fields the page uses", () => {
  assert.deepEqual(reduceEvent(rawEvent), {
    id: 2, date: "2026-10-21", category: "WORKOUT", name: "W01 Wed - 10x400 @4:05", description: "+ gym",
    distance: 5600, movingTime: 2424, pairedActivityId: null, sport: "Run",
    steps: [
      { text: "Warmup", distance: 1600, duration: 544, pace: { start: 330, end: 350, units: "secs/km" } },
      {
        text: "", distance: 4000, duration: 1880, reps: 10,
        steps: [
          { text: "Rep", distance: 400, duration: 98, pace: { start: 242, end: 248, units: "secs/km" } },
          { text: "Rest", duration: 90 },
        ],
      },
    ],
  });
  assert.deepEqual(reduceActivity({ ...rawActivity, id: 123 }), {
    id: "123", date: "2026-10-21", type: "Run", name: "Intervals", distance: 5620, movingTime: 2412,
    avgHr: 152.4, pairedEventId: 2, compliance: 96.4,
  });
});

test("refresh loads the plan range and caches a reduced copy", async () => {
  const store = createStore(memoryStorage());
  store.setKey("secret-key");
  store.setCache({ fetchedAt: null, athleteName: "Runner", events: [], activities: [] });
  const f = fakeFetch({
    "/athlete/0/events": reply(200, [rawEvent]),
    "/athlete/0/activities": reply(200, [rawActivity]),
  });
  const data = await refresh({ store, today: "2026-10-21", fetchImpl: f, now: new Date("2026-10-21T03:00:00Z") });
  assert.deepEqual(f.calls.map(c => c.url).sort(), [
    `${BASE}/athlete/0/activities?oldest=2026-10-19&newest=2026-10-21`,
    `${BASE}/athlete/0/events?oldest=2026-10-19&newest=2027-01-31`,
  ]);
  assert.equal(data.fetchedAt, "2026-10-21T03:00:00.000Z");
  assert.equal(data.athleteName, "Runner");
  assert.equal(data.events[0].date, "2026-10-21");
  assert.equal(data.activities[0].id, "i11");
  assert.equal("icu_ctl" in data.events[0], false);
  assert.deepEqual(store.getCache(), data);
});

test("refresh before the plan starts still asks for a valid activity range", async () => {
  const store = createStore(memoryStorage());
  store.setKey("secret-key");
  const f = fakeFetch({ "/athlete/0/events": reply(200, []), "/athlete/0/activities": reply(200, []) });
  await refresh({ store, today: "2026-10-01", fetchImpl: f });
  assert.ok(f.calls.some(c => c.url.endsWith("/athlete/0/activities?oldest=2026-10-19&newest=2026-10-19")));
});

test("refresh without a key asks for one", async () => {
  const store = createStore(memoryStorage());
  await assert.rejects(
    refresh({ store, today: "2026-10-21", fetchImpl: fakeFetch({}) }),
    e => e instanceof KeyError && e.reason === "missing",
  );
});

test("connect trims the key, checks it, and saves it with the athlete name", async () => {
  const store = createStore(memoryStorage());
  store.setCache({ fetchedAt: "x", athleteName: "Old", events: [{ id: 1 }], activities: [] });
  const f = fakeFetch({ "/athlete/0": reply(200, { name: "Truong" }) });
  assert.deepEqual(await connect("  secret-key-123\n", { store, fetchImpl: f }), { athleteName: "Truong" });
  assert.equal(store.getKey(), "secret-key-123");
  assert.equal(f.calls[0].init.headers.Authorization, authHeader("secret-key-123"));
  assert.deepEqual(store.getCache(), { fetchedAt: null, athleteName: "Truong", events: [], activities: [] });
});

test("connect rejects a malformed or refused key and saves nothing", async () => {
  const store = createStore(memoryStorage());
  const none = fakeFetch({});
  await assert.rejects(connect("not a key", { store, fetchImpl: none }), e => e instanceof KeyError && e.reason === "format");
  assert.equal(none.calls.length, 0);
  await assert.rejects(connect("secret-key-123", { store, fetchImpl: fakeFetch({ "/athlete/0": reply(401, {}) }) }), KeyError);
  assert.equal(store.getKey(), null);
});

test("store survives blocked storage and corrupt data", () => {
  const blocked = createStore(brokenStorage());
  blocked.setKey("secret-key");
  assert.equal(blocked.getKey(), "secret-key");
  blocked.setCache({ fetchedAt: null, athleteName: "", events: [], activities: [] });
  assert.deepEqual(blocked.getCache().events, []);
  assert.equal(blocked.getTheme(), "system");
  assert.equal(createStore(null).getKey(), null);

  const storage = memoryStorage();
  storage.setItem("tc.v1.data", "{not json");
  assert.equal(createStore(storage).getCache(), null);
});

test("refresh does not save data when the key is removed while it loads", async () => {
  const store = createStore(memoryStorage());
  store.setKey("secret-key");
  const forgetMidway = async () => {
    store.forget();
    return reply(200, []);
  };
  await refresh({ store, today: "2026-10-21", fetchImpl: forgetMidway });
  assert.equal(store.getKey(), null);
  assert.equal(store.getCache(), null);
});

test("forget removes the key and the saved data but keeps settings", () => {
  const store = createStore(memoryStorage());
  store.setKey("secret-key");
  store.setCache({ fetchedAt: null, athleteName: "", events: [], activities: [] });
  store.setTheme("dark");
  store.setShortcut(false);
  store.forget();
  assert.equal(store.getKey(), null);
  assert.equal(store.getCache(), null);
  assert.equal(store.getTheme(), "dark");
  assert.equal(store.getShortcut(), false);
});

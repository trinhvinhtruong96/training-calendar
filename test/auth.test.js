import { test } from "node:test";
import assert from "node:assert/strict";
import { NetworkError } from "../site/src/api.js";
import { LoginError, finishLogin, pkceChallenge, readCallback, redirectUri, revoke, startLogin } from "../site/src/auth.js";

// RFC 7636, Appendix B.
const RFC_OCTETS = [116, 24, 223, 180, 151, 153, 224, 37, 79, 250, 96, 125, 216, 173, 187, 186, 22, 212, 37, 77, 105, 214, 191, 240,
  91, 88, 5, 88, 83, 132, 141, 121];
const RFC_VERIFIER = "dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk";
const RFC_CHALLENGE = "E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM";

const CONFIG = {
  clientId: "app-42",
  authorizeUrl: "https://intervals.icu/oauth/authorize",
  tokenUrl: "https://intervals.icu/api/oauth/token",
  scope: "CALENDAR:READ,ACTIVITY:READ",
};
const PAGE = { origin: "https://trinhvinhtruong96.github.io", pathname: "/training-calendar/" };
const SESSION_KEY = "tc.v1.login";

function memorySession(saved) {
  const map = new Map(saved ? [[SESSION_KEY, JSON.stringify(saved)]] : []);
  return {
    map,
    getItem: k => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: k => { map.delete(k); },
  };
}

// Hands out the RFC octets first (the verifier), then sixteen 7s (the state).
function fakeCrypto() {
  const queue = [RFC_OCTETS, Array(16).fill(7)];
  return {
    getRandomValues: arr => { arr.set(queue.shift().slice(0, arr.length)); return arr; },
    subtle: globalThis.crypto.subtle,
  };
}

function reply(status, body) {
  const text = typeof body === "string" ? body : JSON.stringify(body);
  return { status, ok: status >= 200 && status < 300, text: async () => text, json: async () => JSON.parse(text) };
}

function recorder(response) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    if (response instanceof Error) throw response;
    return response;
  };
  fn.calls = calls;
  return fn;
}

const TOKEN_REPLY = {
  token_type: "Bearer", access_token: "tok-1", scope: "CALENDAR:READ,ACTIVITY:READ", athlete: { id: "i1", name: "Truong" },
};

test("the PKCE challenge matches the RFC 7636 example", async () => {
  assert.equal(await pkceChallenge(RFC_VERIFIER), RFC_CHALLENGE);
});

test("login starts at intervals.icu with PKCE, a state and read-only scopes, and remembers them for this tab", async () => {
  const session = memorySession();
  const url = new URL(await startLogin({ session, location: PAGE, cryptoImpl: fakeCrypto(), config: CONFIG }));
  const state = Buffer.from(Array(16).fill(7)).toString("base64url");
  assert.equal(`${url.origin}${url.pathname}`, CONFIG.authorizeUrl);
  assert.deepEqual(Object.fromEntries(url.searchParams), {
    client_id: "app-42",
    redirect_uri: "https://trinhvinhtruong96.github.io/training-calendar/",
    scope: "CALENDAR:READ,ACTIVITY:READ",
    state,
    code_challenge: RFC_CHALLENGE,
    code_challenge_method: "S256",
  });
  assert.deepEqual(JSON.parse(session.map.get(SESSION_KEY)), { verifier: RFC_VERIFIER, state });
});

test("the return address is the page itself, without index.html", () => {
  assert.equal(redirectUri({ origin: PAGE.origin, pathname: "/training-calendar/index.html" }), "https://trinhvinhtruong96.github.io/training-calendar/");
  assert.equal(redirectUri({ origin: "http://localhost:8080", pathname: "/" }), "http://localhost:8080/");
});

test("only a return from intervals.icu counts as a login callback", () => {
  assert.deepEqual(readCallback("?code=abc&state=s1"), { code: "abc", state: "s1", error: null });
  assert.deepEqual(readCallback("?error=access_denied"), { code: null, state: null, error: "access_denied" });
  assert.equal(readCallback(""), null);
  assert.equal(readCallback("?w=2026-10-19"), null);
});

test("finishing a login swaps the code for a token without a client secret", async () => {
  const session = memorySession({ verifier: "ver-1", state: "s1" });
  const f = recorder(reply(200, TOKEN_REPLY));
  const out = await finishLogin({ code: "abc", state: "s1", error: null }, { session, fetchImpl: f, config: CONFIG });
  assert.deepEqual(out, { token: "tok-1", athleteName: "Truong" });
  const [{ url, init }] = f.calls;
  assert.equal(url, CONFIG.tokenUrl);
  assert.equal(init.method, "POST");
  assert.equal(init.headers["Content-Type"], "application/x-www-form-urlencoded");
  assert.deepEqual(Object.fromEntries(new URLSearchParams(init.body)), { client_id: "app-42", code: "abc", code_verifier: "ver-1" });
  assert.equal(session.map.has(SESSION_KEY), false);
});

test("a login is refused when it was cancelled, not started here, or failed", async () => {
  const run = (callback, { saved = { verifier: "ver-1", state: "s1" }, response = reply(200, TOKEN_REPLY) } = {}) => {
    const session = memorySession(saved);
    const f = recorder(response);
    const result = finishLogin(callback, { session, fetchImpl: f, config: CONFIG });
    return { result, session, f };
  };
  const reason = r => e => e instanceof LoginError && e.reason === r;

  let c = run({ code: null, state: "s1", error: "access_denied" });
  await assert.rejects(c.result, reason("cancelled"));
  assert.equal(c.session.map.has(SESSION_KEY), false);

  c = run({ code: null, state: null, error: "server_error" });
  await assert.rejects(c.result, reason("failed"));

  c = run({ code: "abc", state: "other", error: null });
  await assert.rejects(c.result, reason("state"));
  assert.equal(c.f.calls.length, 0);
  assert.equal(c.session.map.has(SESSION_KEY), false);

  c = run({ code: "abc", state: "s1", error: null }, { saved: null });
  await assert.rejects(c.result, reason("state"));
  assert.equal(c.f.calls.length, 0);

  c = run({ code: "abc", state: "s1", error: null }, { response: reply(400, { status: 400, error: "Invalid code" }) });
  await assert.rejects(c.result, e => reason("failed")(e) && e.message.includes("Invalid code"));

  c = run({ code: "abc", state: "s1", error: null }, { response: reply(200, { token_type: "Bearer" }) });
  await assert.rejects(c.result, reason("failed"));

  c = run({ code: "abc", state: "s1", error: null }, { response: reply(200, { ...TOKEN_REPLY, scope: "ACTIVITY:READ" }) });
  await assert.rejects(c.result, reason("scope"));

  c = run({ code: "abc", state: "s1", error: null }, { response: new TypeError("Failed to fetch") });
  await assert.rejects(c.result, NetworkError);
});

test("a broader grant (WRITE) still covers the read scopes the page needs", async () => {
  const session = memorySession({ verifier: "ver-1", state: "s1" });
  const f = recorder(reply(200, { ...TOKEN_REPLY, scope: "ACTIVITY:WRITE,CALENDAR:WRITE" }));
  assert.equal((await finishLogin({ code: "abc", state: "s1", error: null }, { session, fetchImpl: f, config: CONFIG })).token, "tok-1");
});

test("forgetting a login cancels it on intervals.icu; a key or a failed call is left alone", async () => {
  const f = recorder(reply(200, {}));
  await revoke({ type: "oauth", secret: "tok-1" }, f);
  assert.equal(f.calls[0].url, "https://intervals.icu/api/v1/disconnect-app");
  assert.equal(f.calls[0].init.method, "DELETE");
  assert.equal(f.calls[0].init.headers.Authorization, "Bearer tok-1");

  const none = recorder(reply(200, {}));
  await revoke({ type: "key", secret: "k" }, none);
  assert.equal(none.calls.length, 0);
  await revoke({ type: "oauth", secret: "tok-1" }, recorder(new TypeError("Failed to fetch")));
});

// "Log in with intervals.icu": OAuth 2 authorization code flow with PKCE for a public client.
// There is no client secret; the one-time verifier stays in this tab's sessionStorage until the return.
import { API_BASE, OAUTH, STORAGE_KEYS } from "./config.js";
import { NetworkError } from "./api.js";

export class LoginError extends Error {
  // reason: "cancelled" | "state" | "scope" | "failed" | "storage"
  constructor(message, reason) {
    super(message);
    this.name = "LoginError";
    this.reason = reason;
  }
}

const defaultFetch = (url, init) => globalThis.fetch(url, init);

const base64url = bytes => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");

const randomValue = (size, cryptoImpl) => base64url(cryptoImpl.getRandomValues(new Uint8Array(size)));

export async function pkceChallenge(verifier, cryptoImpl = globalThis.crypto) {
  const digest = await cryptoImpl.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

// The page's own address; it must match a redirect URI registered for the app exactly.
export function redirectUri(location) {
  return `${location.origin}${location.pathname.replace(/index\.html$/, "")}`;
}

// Saves the verifier and state for this tab and returns the intervals.icu address to open.
export async function startLogin({ session, location, cryptoImpl = globalThis.crypto, config = OAUTH }) {
  const verifier = randomValue(32, cryptoImpl);
  const state = randomValue(16, cryptoImpl);
  try {
    session.setItem(STORAGE_KEYS.login, JSON.stringify({ verifier, state }));
  } catch {
    throw new LoginError("This browser blocks the storage the login needs. Use an API key instead.", "storage");
  }
  const url = new URL(config.authorizeUrl);
  url.search = new URLSearchParams({
    client_id: config.clientId,
    redirect_uri: redirectUri(location),
    scope: config.scope,
    state,
    code_challenge: await pkceChallenge(verifier, cryptoImpl),
    code_challenge_method: "S256",
  }).toString();
  return url.toString();
}

// The page was opened by intervals.icu after a login (?code=… or ?error=…); null otherwise.
export function readCallback(search) {
  const params = new URLSearchParams(search);
  if (!params.has("code") && !params.has("error")) return null;
  return { code: params.get("code"), state: params.get("state"), error: params.get("error") };
}

function takeSaved(session) {
  let saved = null;
  try {
    saved = JSON.parse(session.getItem(STORAGE_KEYS.login) ?? "null");
    session.removeItem(STORAGE_KEYS.login);
  } catch {
    // blocked or corrupt: treated as "not started here"
  }
  return saved;
}

// Every READ scope the page asks for must be granted, as READ or WRITE.
function missingScopes(granted, wanted) {
  const have = new Set(String(granted).split(",").map(s => s.trim().split(":")[0]));
  return wanted.split(",").map(s => s.split(":")[0]).filter(area => !have.has(area));
}

// Swaps the one-time code for a token. Returns { token, athleteName }.
export async function finishLogin(callback, { session, fetchImpl = defaultFetch, config = OAUTH }) {
  const saved = takeSaved(session);
  if (callback.error) {
    if (callback.error === "access_denied") throw new LoginError("Login cancelled.", "cancelled");
    throw new LoginError(`intervals.icu could not complete the login (${callback.error}). Try again.`, "failed");
  }
  if (!saved?.verifier || !callback.code || callback.state !== saved.state) {
    throw new LoginError("This login was not started on this page, or it expired. Log in again.", "state");
  }
  let res;
  try {
    res = await fetchImpl(config.tokenUrl, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
      body: new URLSearchParams({ client_id: config.clientId, code: callback.code, code_verifier: saved.verifier }).toString(),
    });
  } catch {
    throw new NetworkError();
  }
  const body = await res.json().catch(() => null);
  if (!res.ok) {
    const detail = body?.error ? `: ${body.error}` : "";
    throw new LoginError(`Login failed (HTTP ${res.status}${detail}). Log in again.`, "failed");
  }
  if (!body?.access_token) throw new LoginError("Login failed: intervals.icu sent no token. Log in again.", "failed");
  if (body.scope != null && missingScopes(body.scope, config.scope).length) {
    throw new LoginError("The page needs read access to both your calendar and your activities. Log in again and allow both.", "scope");
  }
  return { token: body.access_token, athleteName: body.athlete?.name ?? "" };
}

// Ends a login on intervals.icu too. Best effort: Forget still clears this device when it fails.
export async function revoke(auth, fetchImpl = defaultFetch) {
  if (auth?.type !== "oauth") return;
  try {
    await fetchImpl(`${API_BASE}/disconnect-app`, { method: "DELETE", headers: { Authorization: `Bearer ${auth.secret}` } });
  } catch {
    // offline: the user can still remove the app in intervals.icu settings
  }
}

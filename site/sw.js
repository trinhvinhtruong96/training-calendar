// Offline copy of the app files. Never touches intervals.icu requests.
// Cache-first, refreshed in the background so a new deploy shows on the next visit.
const CACHE = "tc-shell-v1";
const FILES = [
  "./",
  "index.html",
  "styles.css",
  "manifest.webmanifest",
  "src/app.js",
  "src/api.js",
  "src/auth.js",
  "src/config.js",
  "src/dates.js",
  "src/model.js",
  "src/performance.js",
  "src/workout.js",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
  "icons/apple-touch-icon.png",
];

self.addEventListener("install", event => {
  // cache: "reload" skips the browser's HTTP cache, so one install never mixes old and new module files.
  const fresh = FILES.map(f => new Request(f, { cache: "reload" }));
  event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(fresh)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k.startsWith("tc-shell-") && k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", event => {
  const { request } = event;
  const url = new URL(request.url);
  if (request.method !== "GET" || url.origin !== self.location.origin) return;
  // Fetched and cached without the query: with the worker in place, a login return (?code=…) is neither
  // passed on to the host nor kept in the cache.
  const key = url.search ? new Request(`${url.origin}${url.pathname}`) : request;
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(key);
    const network = fetch(key)
      .then(response => {
        if (response.ok) cache.put(key, response.clone());
        return response;
      })
      .catch(() => null);
    if (cached) {
      event.waitUntil(network);
      return cached;
    }
    const response = await network;
    if (response) return response;
    if (request.mode === "navigate") {
      const shell = await cache.match("index.html");
      if (shell) return shell;
    }
    return new Response("Offline", { status: 503, statusText: "Offline" });
  })());
});

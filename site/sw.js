// Offline copy of the app files. Never touches intervals.icu requests.
// Cache-first, refreshed in the background so a new deploy shows on the next visit.
const CACHE = "tc-shell-v2";
const FILES = [
  "./",
  "index.html",
  "styles.css",
  "manifest.webmanifest",
  "src/app.js",
  "src/api.js",
  "src/config.js",
  "src/dates.js",
  "src/fitness.js",
  "src/model.js",
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
  event.respondWith((async () => {
    const cache = await caches.open(CACHE);
    const cached = await cache.match(request, { ignoreSearch: true });
    const network = fetch(request)
      .then(response => {
        if (response.ok) cache.put(request, response.clone());
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

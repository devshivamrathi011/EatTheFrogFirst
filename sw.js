/* Offline cache for the Daily Routine Tracker. Bump VERSION after you change any file. */
const VERSION = "routine-v6";
const FILES = ["./", "index.html", "css/app.css", "js/store.js", "js/auth.js", "js/app.js",
  "data/plan.json", "data/workouts.json", "data/figures.json", "manifest.webmanifest",
  "icons/icon-192.png", "icons/icon-512.png"];
self.addEventListener("install", e => { e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES))); self.skipWaiting(); });
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== VERSION).map(k => caches.delete(k)))));
  self.clients.claim();
});
// network first (so edits to data/*.json show up), cache as the offline fallback
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET" || new URL(e.request.url).origin !== location.origin) return;
  e.respondWith(fetch(e.request).then(res => {
    const copy = res.clone(); caches.open(VERSION).then(c => c.put(e.request, copy)); return res;
  }).catch(() => caches.match(e.request, { ignoreSearch: true })));
});

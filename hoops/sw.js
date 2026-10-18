// Brier Stats service worker: the whole app is cached so it opens in a gym with no signal.
// It lives in its own folder, so it only handles Brier Stats pages and leaves Mound Book's cache alone.
const CACHE = "brierstats-0.3.0-d915662fd8";
const FILES = ["./", "index.html", "fb.js", "manifest.webmanifest", "live.webmanifest", "live/index.html", "bobcat-head.png", "icon-180.png", "icon-192.png", "icon-512.png", "fonts/barlow-latin-400-normal.woff2", "fonts/barlow-latin-500-normal.woff2", "fonts/barlow-latin-600-normal.woff2", "fonts/barlow-latin-700-normal.woff2", "fonts/big-shoulders-display-latin-700-normal.woff2", "fonts/big-shoulders-display-latin-800-normal.woff2", "fonts/big-shoulders-display-latin-900-normal.woff2"];
self.addEventListener("install", e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(FILES)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE && k.startsWith("brierstats-")).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== self.location.origin) return;
  // App files: cache first (works offline), refresh the cache in the background when there's signal.
  e.respondWith(caches.open(CACHE).then(c => c.match(e.request, {ignoreSearch: true}).then(hit => {
    const net = fetch(e.request).then(r => { if (r && r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  })));
});

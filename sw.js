// Service worker: precache the app shell, serve cache-first so the app opens
// fully offline. Rate API calls are cross-origin and pass straight through —
// offline rate fallback is handled in-app via localStorage, not here.

const VERSION = "tripcash-v2";
const SHELL = [
  "./",
  "./index.html",
  "./styles.css",
  "./manifest.json",
  "./js/app.js",
  "./js/ui.js",
  "./js/store.js",
  "./js/rates.js",
  "./js/convert.js",
  "./js/currencies.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(SHELL)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== "GET") return;
  e.respondWith(
    caches.match(e.request).then(
      (hit) =>
        hit ??
        fetch(e.request).then((res) => {
          // Cache new same-origin files as they're fetched (e.g. after updates).
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put(e.request, copy));
          return res;
        }).catch(() =>
          // Offline navigation to an uncached URL → serve the app shell.
          e.request.mode === "navigate" ? caches.match("./index.html") : undefined
        )
    )
  );
});

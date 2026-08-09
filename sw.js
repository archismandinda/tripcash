// Service worker: precache the app shell, serve cache-first so the app opens
// fully offline. Rate API calls are cross-origin and pass straight through —
// offline rate fallback is handled in-app via localStorage, not here.

const VERSION = "tripcash-v55";
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
  "./js/history.js",
  "./js/chart.js",
  "./js/parse.js",
  "./js/insights.js",
  "./js/scan.js",
  "./js/splits.js",
  "./js/attach.js",
  "./js/merge.js",
  "./js/members.js",
  "./js/prefs.js",
  "./js/receipts.js",
  "./js/firebase.js",
  "./js/firebase-config.js",
  "./js/firestore.js",
  "./js/sync.js",
  "./js/vendor/jsqr.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./fonts/manrope-latin.woff2",
  "./fonts/manrope-latin-ext.woff2",
];

self.addEventListener("install", (e) => {
  // cache: "no-cache" forces revalidation with the server — without it the
  // precache can pin stale files straight out of the browser's HTTP cache.
  e.waitUntil(
    caches.open(VERSION).then((c) =>
      c.addAll(SHELL.map((url) => new Request(url, { cache: "no-cache" })))
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// Stale-while-revalidate: answer from cache instantly (offline-first), but
// always re-fetch in the background and update the cache. This heals any
// stale cache — e.g. a deploy racing the CDN — on the very next visit,
// without depending on a VERSION bump.
self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (url.origin !== location.origin || e.request.method !== "GET") return;
  const refresh = fetch(url.href, { cache: "no-cache" })
    .then((res) => {
      // Don't cache share-target / shortcut URLs — same page, endless keys.
      if (res.ok && !url.search) {
        const copy = res.clone();
        caches.open(VERSION).then((c) => c.put(e.request, copy));
      }
      return res;
    })
    .catch(() => undefined); // offline → cache answer below still works
  e.respondWith(
    caches.match(e.request).then(
      (hit) =>
        hit ??
        refresh.then((res) =>
          res ?? (e.request.mode === "navigate" ? caches.match("./index.html") : undefined)
        )
    )
  );
  e.waitUntil(refresh.then(() => {}));
});

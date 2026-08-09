// Service worker: precache the app shell, serve cache-first so the app opens
// fully offline. Rate API calls are cross-origin and pass straight through —
// offline rate fallback is handled in-app via localStorage, not here.

const VERSION = "tripcash-v89";
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
  "./js/push.js",
  "./js/notices.js",
  "./js/invites.js",
  "./js/absorb.js",
  "./js/roster.js",
  "./js/pricing.js",
  "./js/ledger.js",
  "./js/vendor/jsqr.js",
  "./icons/icon-192.png",
  "./icons/icon-512.png",
  "./icons/icon-maskable-512.png",
  "./fonts/manrope-latin.woff2",
  "./fonts/manrope-latin-ext.woff2",
];

// ---------- push notifications (phase D4) ----------
//
// Data-only messages, rendered here. Letting FCM auto-display would mean
// two code paths for one notification and no control over grouping —
// and the browser requires a visible notification per push anyway, so
// this handler has to exist regardless.
self.addEventListener("push", (e) => {
  // A push MUST produce a visible notification. Returning early on an
  // empty payload let Chrome substitute "This site has been updated in
  // the background" and, after enough of those, revoke push permission.
  if (!e.data) {
    e.waitUntil(self.registration.showNotification("TripCash", {
      body: "Something changed on a shared trip.",
      icon: "./icons/icon-192.png", tag: "tripcash",
    }));
    return;
  }
  let payload = {};
  try {
    payload = e.data.json();
  } catch {
    payload = { data: { body: e.data.text() } };
  }
  // Defensive about the shape: FCM delivers data-only as { data }, but a
  // `notification` payload arrives nested. Handle both.
  const d = { ...(payload.notification ?? {}), ...(payload.data ?? {}) };
  const title = d.title || "TripCash";
  // Keep an open tab's notification list in step. Deduplicated on the
  // page against whatever the next sync works out for itself.
  e.waitUntil(self.clients.matchAll({ type: "window", includeUncontrolled: true })
    .then((wins) => wins.forEach((w) => w.postMessage({
      type: "pushed", tripId: d.tripId, body: d.body, kind: d.kind, ref: d.ref,
    })))
    .catch(() => {}));
  e.waitUntil(
    self.registration.showNotification(title, {
      body: d.body || "",
      icon: "./icons/icon-192.png",
      badge: "./icons/icon-192.png",
      // One notification per trip, replaced as more arrives: a shared
      // trip on a busy day would otherwise bury the notification shade.
      tag: d.tripId ? `trip-${d.tripId}` : "tripcash",
      renotify: true,
      data: { tripId: d.tripId ?? "" },
    })
  );
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const tripId = e.notification.data?.tripId;
  const target = tripId ? `./?trip=${encodeURIComponent(tripId)}` : "./";
  e.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((wins) => {
      // Focus a tab we already have rather than piling up windows; tell
      // it which trip, since it won't reload.
      //
      // Scope, not origin: this is a *user* GitHub Pages origin shared
      // by every project published under it, so an origin check would
      // happily focus an unrelated app and hand it the trip id.
      const scope = self.registration.scope;
      for (const w of wins) {
        if (typeof w.url === "string" && w.url.startsWith(scope) && "focus" in w) {
          w.postMessage({ type: "open-trip", tripId });
          return w.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});

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

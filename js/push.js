// Push notifications (phase D4). The only way to learn that someone
// added an expense while the app is CLOSED — live updates (ADR-0012)
// stop the moment the tab does.
//
// Deliberately opt-in and lazy: the messaging SDK is never fetched
// unless the user switches this on, so the "signed-out users make zero
// Firebase requests" invariant still holds, and so does the one below
// it — a signed-IN user who doesn't want notifications doesn't pay for
// them either.

import { loadApp } from "./firebase.js";
import { FIREBASE_SDK_VERSION, VAPID_PUBLIC_KEY } from "./firebase-config.js";

const CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;

// Why this device can't have notifications, in words worth reading —
// or "" when it can. Checked BEFORE showing the switch, because a
// toggle that can only fail is worse than no toggle.
export function pushBlocker() {
  if (!("Notification" in globalThis)) return "This browser doesn't support notifications.";
  if (!("serviceWorker" in navigator) || !("PushManager" in globalThis)) {
    return "This browser doesn't support push notifications.";
  }
  // iOS delivers web push ONLY to a PWA installed on the Home Screen,
  // and only from 16.4. In Safari's browser tab the API exists and
  // permission can even be granted — nothing is ever delivered. Saying
  // so up front beats a switch that appears to work and doesn't.
  const iOS = /iPhone|iPad|iPod/.test(navigator.userAgent);
  const installed = globalThis.matchMedia?.("(display-mode: standalone)")?.matches
    || navigator.standalone === true;
  if (iOS && !installed) {
    return "On iPhone, notifications need TripCash added to your Home Screen first (Share → Add to Home Screen).";
  }
  if (!VAPID_PUBLIC_KEY) return "Notifications aren't configured for this build yet.";
  if (Notification.permission === "denied") {
    return "Notifications are blocked for this site in your browser settings.";
  }
  return "";
}

export const pushGranted = () =>
  "Notification" in globalThis && Notification.permission === "granted";

let messagingReady = null;

async function loadMessaging() {
  messagingReady ??= (async () => {
    const [app, m] = await Promise.all([
      loadApp(),
      import(`${CDN}/firebase-messaging.js`),
    ]);
    // isSupported() catches the environments the feature-detection above
    // can't — private windows, embedded webviews, older Safari.
    if (!(await m.isSupported())) throw new Error("unsupported");
    return { messaging: m.getMessaging(app), m };
  })();
  return messagingReady;
}

// Ask, then register. MUST be called straight from a user gesture:
// Safari discards a permission prompt that isn't, silently.
//
// Returns the FCM token, or null if the user said no. Throws only when
// something genuinely broke, so the caller can tell "declined" apart
// from "failed" — they need different words.
export async function enablePush() {
  const permission = await Notification.requestPermission();
  if (permission !== "granted") return null;

  // Our OWN service worker, not a second one. Registering
  // firebase-messaging-sw.js alongside sw.js would put two workers on
  // one scope, and the app shell's cache is in ours.
  const registration = await navigator.serviceWorker.ready;
  const { messaging, m } = await loadMessaging();
  const token = await m.getToken(messaging, {
    vapidKey: VAPID_PUBLIC_KEY,
    serviceWorkerRegistration: registration,
  });
  return token || null;
}

// Give up the token so the server stops sending to this device. The
// permission stays granted — the user turned a feature off, they didn't
// revoke trust in the site.
export async function disablePush() {
  // NO getToken() here. It used to call it first, to learn which token to
  // report back — but getToken is a NETWORK call, so an offline sign-out
  // threw before deleteToken ever ran and the registration stayed live.
  // It could also mint a FRESH token and then delete that one, leaving
  // the real, rotated token registered and unreachable.
  //
  // The caller already knows which token it stored. All this has to do
  // is revoke the registration.
  try {
    const { messaging, m } = await loadMessaging();
    await m.deleteToken(messaging);
    return true;
  } catch {
    return false; // offline or never registered — the caller must still clean up
  }
}

// Firebase project connection details (phase D3).
//
// This is PUBLIC on purpose. A Firebase web config is not a credential —
// Google ships it in the page source of every Firebase web app, and a
// static PWA has nowhere to hide it anyway. What actually protects the
// data is Firestore security rules + the authorized-domain list, not
// secrecy of these strings. See ADR-0005 / ADR-0008.
//
// Project: tripcash-7188d · free Spark plan · created 2026-08-05.
// measurementId is deliberately omitted: Google Analytics is enabled on
// the project but the app never loads it (weight, privacy, and it would
// mean hotlinking a script we can't cache offline).

export const FIREBASE_CONFIG = {
  apiKey: "AIzaSyCUMVV3VNRIhP5lBX9modObJU7mh4GvaYU",
  authDomain: "tripcash-7188d.firebaseapp.com",
  projectId: "tripcash-7188d",
  storageBucket: "tripcash-7188d.firebasestorage.app",
  messagingSenderId: "314451735540",
  appId: "1:314451735540:web:50b6a371dd8cbf27acc4a1",
};

// Pinned SDK version — loaded lazily from gstatic only when sync is
// switched on, so signed-out and offline users never fetch ~960 KB.
export const FIREBASE_SDK_VERSION = "12.15.0";

// Web Push certificate (VAPID public key), from
// Firebase console → Project settings → Cloud Messaging → Web Push
// certificates → Generate key pair. PUBLIC by design, like the config
// above: it identifies the sender to the browser's push service. The
// PRIVATE half stays in Firebase and is never in this repo.
//
// Empty until it's generated — js/push.js checks for that and says so
// rather than offering a switch that can only fail. See docs/PUSH.md.
export const VAPID_PUBLIC_KEY = "";

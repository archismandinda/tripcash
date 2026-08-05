// Firebase glue (phase D3.2). Wraps the handful of auth calls the app
// needs and — importantly — loads the SDK lazily from Google's CDN, so a
// signed-out or offline user never fetches ~260 KB they didn't ask for.
// The app must stay fully usable with none of this ever running.

import { FIREBASE_CONFIG, FIREBASE_SDK_VERSION } from "./firebase-config.js";

const CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;

let ready = null;

// Idempotent: every caller shares one SDK load and one initialised app.
export function loadAuth() {
  ready ??= (async () => {
    const [appMod, authMod] = await Promise.all([
      import(`${CDN}/firebase-app.js`),
      import(`${CDN}/firebase-auth.js`),
    ]);
    const app = appMod.initializeApp(FIREBASE_CONFIG);
    return { auth: authMod.getAuth(app), m: authMod };
  })();
  return ready;
}

// A popup can't survive in every environment — an installed PWA on iOS
// especially. Those two codes mean "popups aren't viable here", so fall
// back to a full-page redirect. A user who deliberately closed the popup
// is NOT in that set; re-opening sign-in on them would be obnoxious.
const POPUP_UNAVAILABLE = new Set([
  "auth/popup-blocked",
  "auth/operation-not-supported-in-this-environment",
]);

// onRedirect fires just before we leave the page, so the caller can note
// that a sign-in is in flight — otherwise the return trip looks like a
// cold start and the half-finished session is never picked up.
export async function signInWithGoogle({ onRedirect } = {}) {
  const { auth, m } = await loadAuth();
  const provider = new m.GoogleAuthProvider();
  try {
    return await m.signInWithPopup(auth, provider);
  } catch (err) {
    if (!POPUP_UNAVAILABLE.has(err?.code)) throw err;
    onRedirect?.();
    await m.signInWithRedirect(auth, provider); // page navigates away
    return null;
  }
}

// The session as Firebase currently sees it. Reading this back directly
// means the UI never depends on an auth-state callback having fired.
export async function currentUser() {
  const { auth } = await loadAuth();
  const u = auth.currentUser;
  return u ? { uid: u.uid, email: u.email } : null;
}

export async function signInWithEmail(email, password) {
  const { auth, m } = await loadAuth();
  return m.signInWithEmailAndPassword(auth, email, password);
}

export async function createAccount(email, password) {
  const { auth, m } = await loadAuth();
  return m.createUserWithEmailAndPassword(auth, email, password);
}

export async function signOutUser() {
  const { auth, m } = await loadAuth();
  return m.signOut(auth);
}

// Fires immediately with the restored session (or null), then on changes.
export async function watchAuth(onChange) {
  const { auth, m } = await loadAuth();
  return m.onAuthStateChanged(auth, (user) =>
    onChange(user ? { uid: user.uid, email: user.email } : null)
  );
}

// Completes a redirect-based sign-in after the page comes back.
export async function finishRedirect() {
  const { auth, m } = await loadAuth();
  try {
    return await m.getRedirectResult(auth);
  } catch {
    return null; // surfaced by the auth-state listener instead
  }
}

// Firebase error codes are for developers. These are for Archisman.
export function authErrorMessage(code) {
  switch (code) {
    case "auth/invalid-credential":
    case "auth/wrong-password":
    case "auth/user-not-found":
      return "That email and password don't match. Try again, or create an account.";
    case "auth/email-already-in-use":
      return "That email already has an account — sign in instead.";
    case "auth/weak-password":
      return "Pick a longer password — at least 6 characters.";
    case "auth/invalid-email":
      return "That doesn't look like an email address.";
    case "auth/missing-password":
      return "Enter your password.";
    case "auth/network-request-failed":
      return "Couldn't reach the server — check your connection and try again.";
    case "auth/too-many-requests":
      return "Too many attempts. Wait a minute, then try again.";
    case "auth/operation-not-allowed":
      return "That sign-in method isn't switched on for this app yet.";
    case "auth/unauthorized-domain":
      return "This address isn't authorised for sign-in yet.";
    case "auth/popup-closed-by-user":
    case "auth/cancelled-popup-request":
      return ""; // the user changed their mind; not an error worth shouting about
    default:
      return "Sign-in didn't work. Try again in a moment.";
  }
}

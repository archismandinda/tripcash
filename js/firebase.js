// Firebase glue (phase D3.2). Wraps the handful of auth calls the app
// needs and — importantly — loads the SDK lazily from Google's CDN, so a
// signed-out or offline user never fetches ~260 KB they didn't ask for.
// The app must stay fully usable with none of this ever running.

import { FIREBASE_CONFIG, FIREBASE_SDK_VERSION } from "./firebase-config.js";

const CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;

let appReady = null;
let ready = null;

// The one initialised Firebase app, shared by auth and Firestore.
export function loadApp() {
  appReady ??= import(`${CDN}/firebase-app.js`)
    .then((appMod) => appMod.initializeApp(FIREBASE_CONFIG));
  return appReady;
}

// Idempotent: every caller shares one SDK load and one initialised app.
export function loadAuth() {
  ready ??= (async () => {
    const [app, authMod] = await Promise.all([
      loadApp(),
      import(`${CDN}/firebase-auth.js`),
    ]);
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
  return u ? { uid: u.uid, email: u.email, emailVerified: u.emailVerified, photoURL: u.photoURL, displayName: u.displayName } : null;
}

// Invites are only honoured for verified addresses, so an email/password
// signup needs this before it can join anything. Google sign-ins arrive
// verified and never see it.
// Takes the user explicitly when the caller has one. Straight after
// createAccount, reading auth.currentUser back is a race — and this used
// to `return false` silently when it lost, so no email was sent and
// nothing said so.
export async function sendVerification(user) {
  const { auth, m } = await loadAuth();
  const target = user ?? auth.currentUser;
  if (!target) throw new Error("no-session");
  await m.sendEmailVerification(target);
  return true;
}

export async function signInWithEmail(email, password) {
  const { auth, m } = await loadAuth();
  return m.signInWithEmailAndPassword(auth, email, password);
}

export async function createAccount(email, password) {
  const { auth, m } = await loadAuth();
  const cred = await m.createUserWithEmailAndPassword(auth, email, password);
  return cred.user; // hand the user straight to sendVerification — no re-read race
}

export async function signOutUser() {
  const { auth, m } = await loadAuth();
  return m.signOut(auth);
}

// Fires immediately with the restored session (or null), then on changes.
export async function watchAuth(onChange) {
  const { auth, m } = await loadAuth();
  return m.onAuthStateChanged(auth, (user) =>
    onChange(user ? { uid: user.uid, email: user.email, emailVerified: user.emailVerified,
      photoURL: user.photoURL, displayName: user.displayName } : null)
  );
}

// Pick up a verification that happened elsewhere — in the mail app's
// browser, on another device, minutes ago.
//
// TWO things have to move, and only one of them is obvious. `reload()`
// refreshes the user RECORD, which is what `emailVerified` reads. But
// the security rules read the `email_verified` CLAIM inside the ID
// token, and Firebase caches that token for up to an hour — so without
// forcing a refresh, a verified account keeps being refused as
// unverified long after the user has done everything right. That is
// invisible from the app: the badge clears, the query still fails.
export async function refreshVerification() {
  const { auth } = await loadAuth();
  const u = auth.currentUser;
  if (!u) return null;
  try {
    await u.reload();
    if (u.emailVerified) await u.getIdToken(true); // re-mint with the new claim
  } catch {
    return null; // offline: try again next launch
  }
  return { uid: u.uid, email: u.email, emailVerified: u.emailVerified,
    photoURL: u.photoURL, displayName: u.displayName };
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

// Firebase error codes are for developers. These are for the person
// holding the phone.
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

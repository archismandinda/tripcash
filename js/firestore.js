// Firestore adapter (phase D3.3). Deliberately thin: all the decisions
// about whose edit wins live in js/sync.js and js/merge.js, which are
// pure and unit-tested. This file only moves bytes.

import { loadApp } from "./firebase.js";
import { FIREBASE_SDK_VERSION } from "./firebase-config.js";
import { mergePayload, payloadChanged } from "./sync.js";

const CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;

let ready = null;

function loadStore() {
  ready ??= (async () => {
    const [app, m] = await Promise.all([
      loadApp(),
      import(`${CDN}/firebase-firestore.js`),
    ]);
    return { db: m.getFirestore(app), m };
  })();
  return ready;
}

// Read → merge → write, inside a transaction.
//
// The transaction is the whole point: we rewrite the trip document
// wholesale (ADR-0009), so without it a write could silently discard
// whatever another phone committed between our read and our write.
// Firestore retries the callback if that happens, and the merge simply
// runs again against the newer data.
//
// `writer` names the account making the write. It only needs passing on
// the join path, where the payload's own lastEditBy is still the person
// who invited us — see mergePayload.
export async function syncTrip(tripId, localPayload, { writer = null } = {}) {
  const { db, m } = await loadStore();
  const ref = m.doc(db, "trips", tripId);
  return m.runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const remote = snap.exists() ? snap.data() : null;
    const merged = mergePayload(localPayload, remote, Date.now(), { writer });
    if (payloadChanged(merged, remote)) tx.set(ref, merged);
    return merged;
  });
}

// Every trip this account can see — including ones shared from another
// device or another person, which this phone may never have heard of.
export async function fetchMyTrips(uid) {
  const { db, m } = await loadStore();
  const q = m.query(m.collection(db, "trips"), m.where("memberUids", "array-contains", uid));
  const snap = await m.getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, payload: d.data() }));
}

// Trips waiting for you, read from a document addressed by the hash of
// your own address (ADR-0020). This replaced a query that the rules
// could refuse without saying why — twice, for a legitimate user.
export async function fetchInvites(key) {
  if (!key) return null;
  const { db, m } = await loadStore();
  const snap = await m.getDoc(m.doc(db, "invites", key));
  return snap.exists() ? snap.data() : null;
}

// Leave an invitation for someone. Written by the INVITER, into a
// document only the invitee can read.
export async function writeInvite(key, tripId, entry) {
  if (!key || !tripId) return;
  const { db, m } = await loadStore();
  await m.setDoc(m.doc(db, "invites", key), { trips: { [tripId]: entry } }, { merge: true });
}

// Clear entries the invitee has acted on, so the read stays small.
export async function dropInvites(key, tripIds = []) {
  if (!key || !tripIds.length) return;
  const { db, m } = await loadStore();
  const trips = Object.fromEntries(tripIds.map((id) => [id, m.deleteField()]));
  await m.setDoc(m.doc(db, "invites", key), { trips }, { merge: true });
}

// Live updates: Firestore pushes every change to trips this account can
// see, for as long as the app is open. Returns an unsubscribe function.
//
// Own writes echo back through here too. Those are skipped while still
// unacknowledged (`hasPendingWrites`) — we already have that data, and
// re-merging it would just churn.
export async function watchMyTrips(uid, onTrip, onError) {
  const { db, m } = await loadStore();
  const q = m.query(m.collection(db, "trips"), m.where("memberUids", "array-contains", uid));
  return m.onSnapshot(
    q,
    (snap) => {
      for (const change of snap.docChanges()) {
        if (change.type === "removed") continue; // handled by tombstones, not by absence
        if (change.doc.metadata.hasPendingWrites) continue;
        onTrip(change.doc.id, change.doc.data());
      }
    },
    // A dropped listener must never break the app — manual Sync still works.
    (err) => onError?.(err)
  );
}

// One specific trip, by id — the invite-link path. A single-document read
// is far more robust than the search above: Firestore refuses any query
// it can't *prove* the rules allow, whereas a direct get is judged on the
// document itself. This is what makes an invite work even for someone
// whose email isn't verified yet.
export async function fetchTripById(tripId) {
  const { db, m } = await loadStore();
  const snap = await m.getDoc(m.doc(db, "trips", tripId));
  return snap.exists() ? snap.data() : null;
}

// ----- your own preferences, in a document only you can read -----

export async function fetchPrefs(uid) {
  const { db, m } = await loadStore();
  const snap = await m.getDoc(m.doc(db, "users", uid));
  return snap.exists() ? snap.data() : null;
}

// The clock probe has to be PER DEVICE. Both devices share one prefs
// document, so a single serverAt/localAt pair tells you the offset of
// whichever device wrote last — apply that to the other one and you make
// the skew worse, not better. Each device keeps its own entry and reads
// only its own back.
export async function savePrefs(uid, prefs, { deviceId, clocks, email } = {}) {
  const { db, m } = await loadStore();
  const payload = { ...prefs };
  // Your own address, on your own document. Only you and the Cloud
  // Function (admin SDK) can read it. Without it there is no way to
  // turn an invited email into an account, so the one notification
  // that matters most — "you've been added to a trip" — could never be
  // delivered: an invitee isn't in memberUids until they join.
  if (email) payload.email = email;
  if (deviceId) {
    payload.clocks = {
      ...(clocks ?? {}),
      // serverTimestamp() is resolved by Firestore; localAt is this
      // device's view of the same moment. The gap is our offset.
      [deviceId]: { serverAt: m.serverTimestamp(), localAt: Date.now() },
    };
  }
  // merge: true — two devices syncing at once each build `clocks` from a
  // read taken before the other's write. A wholesale set drops the other
  // device's probe, so it never learns its offset and keeps stamping on
  // its own clock.
  await m.setDoc(m.doc(db, "users", uid), payload, { merge: true });
}

// Push tokens live on your own user document, which only you can write
// and only the Cloud Function (admin SDK, rules don't apply) can read
// for anyone else. Keyed BY token so two devices don't overwrite each
// other, and merge:true so this never touches your preferences.
export async function savePushToken(uid, token) {
  const { db, m } = await loadStore();
  await m.setDoc(m.doc(db, "users", uid), {
    pushTokens: { [token]: { at: Date.now() } },
  }, { merge: true });
}

export async function removePushToken(uid, token) {
  const { db, m } = await loadStore();
  await m.setDoc(m.doc(db, "users", uid), {
    pushTokens: { [token]: m.deleteField() },
  }, { merge: true });
}

// Live, so pinning on a laptop lands on the phone straight away.
export async function watchPrefs(uid, onPrefs, onError) {
  const { db, m } = await loadStore();
  return m.onSnapshot(
    m.doc(db, "users", uid),
    (snap) => {
      if (snap.metadata.hasPendingWrites) return; // our own echo
      if (snap.exists()) onPrefs(snap.data());
    },
    (err) => onError?.(err)
  );
}

// Firestore error codes, in language worth reading.
export function syncErrorMessage(code) {
  switch (code) {
    case "permission-denied":
      return "The database turned this down — its access rules may not be set up yet.";
    case "unavailable":
    case "deadline-exceeded":
      return "Couldn't reach the server. Your trips are safe on this device — try again when you have signal.";
    case "failed-precondition":
      return "Sync couldn't run in this browser (private mode can block it).";
    case "resource-exhausted":
      return "Hit the free plan's daily limit. Try again tomorrow.";
    default:
      return "Sync didn't finish. Nothing was lost — try again in a moment.";
  }
}

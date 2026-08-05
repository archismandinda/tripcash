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
export async function syncTrip(tripId, localPayload) {
  const { db, m } = await loadStore();
  const ref = m.doc(db, "trips", tripId);
  return m.runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const remote = snap.exists() ? snap.data() : null;
    const merged = mergePayload(localPayload, remote);
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

// Trips someone has invited this email address to but which this account
// hasn't joined yet. Separate from fetchMyTrips because the invitee isn't
// in memberUids until they accept.
export async function fetchInvitedTrips(email) {
  if (!email) return [];
  const { db, m } = await loadStore();
  // Lowercased to match how invites are stored AND how the rules compare
  // them — the query has to line up exactly or Firestore refuses it.
  const q = m.query(
    m.collection(db, "trips"),
    m.where("invitedEmails", "array-contains", email.trim().toLowerCase())
  );
  const snap = await m.getDocs(q);
  return snap.docs.map((d) => ({ id: d.id, payload: d.data() }));
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

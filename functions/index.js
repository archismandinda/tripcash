// Push notifications, server side (phase D4).
//
// Web push needs a server: the browser will not let a page send to
// another device. This is the only server-side code in TripCash, and it
// is deliberately the smallest thing that works — one Firestore trigger,
// no HTTP endpoints, no state of its own.
//
// It reads the trip document before and after each write, works out what
// a human would actually want to be told, and sends it to every member
// EXCEPT whoever made the change.
//
// Deploy: firebase deploy --only functions   (see docs/PUSH.md)

const { onDocumentWritten } = require("firebase-functions/v2/firestore");
const { setGlobalOptions } = require("firebase-functions/v2");
const { initializeApp } = require("firebase-admin/app");
const { getFirestore, FieldValue } = require("firebase-admin/firestore");
const { getMessaging } = require("firebase-admin/messaging");
const { describe } = require("./notify");

initializeApp();

// One instance is plenty for a personal app, and a hard cap means a
// runaway loop can't quietly run up a bill on the Blaze plan.
setGlobalOptions({ region: "asia-south1", maxInstances: 3 });

// Every device token belonging to these people, minus the author's.
async function tokensFor(uids, exceptUid) {
  const db = getFirestore();
  const targets = uids.filter((uid) => uid && uid !== exceptUid);
  if (!targets.length) return [];
  const snaps = await db.getAll(...targets.map((uid) => db.doc(`users/${uid}`)));
  const out = [];
  for (const snap of snaps) {
    const tokens = snap.exists ? snap.data().pushTokens ?? {} : {};
    for (const token of Object.keys(tokens)) out.push({ uid: snap.id, token });
  }
  return out;
}

// A token dies when the browser is uninstalled, cleared, or the user
// revokes permission. FCM tells us; leaving them behind means every
// future send retries a corpse.
async function dropDeadTokens(dead) {
  const db = getFirestore();
  await Promise.all(dead.map(({ uid, token }) =>
    db.doc(`users/${uid}`).set(
      { pushTokens: { [token]: FieldValue.delete() } }, { merge: true }
    ).catch(() => {})
  ));
}

exports.notifyTripChange = onDocumentWritten("trips/{tripId}", async (event) => {
  const before = event.data?.before?.data() ?? null;
  const after = event.data?.after?.data() ?? null;
  if (!after || after.deleted) return; // a delete is not a notification

  const what = describe(before, after);
  if (!what) return; // most writes say nothing — see functions/notify.js

  const recipients = await tokensFor(after.memberUids ?? [], after.lastEditBy);
  if (!recipients.length) return;

  const title = after.trip?.name ? `${after.trip.name}` : "TripCash";
  // Data-only: the service worker renders it, so there is one code path
  // for the notification rather than two that drift.
  const message = {
    data: { title, body: what.body, tripId: event.params.tripId },
    webpush: {
      headers: { Urgency: "normal", TTL: "86400" },
      fcmOptions: { link: `/tripcash/?trip=${event.params.tripId}` },
    },
  };

  const results = await getMessaging().sendEach(
    recipients.map((r) => ({ ...message, token: r.token }))
  );

  const dead = [];
  results.responses.forEach((res, i) => {
    const code = res.error?.code ?? "";
    if (code.includes("registration-token-not-registered") || code.includes("invalid-argument")) {
      dead.push(recipients[i]);
    }
  });
  if (dead.length) await dropDeadTokens(dead);
});

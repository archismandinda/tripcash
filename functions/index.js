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
const { getAuth } = require("firebase-admin/auth");
const { describe } = require("./notify");
const { onRequest } = require("firebase-functions/v2/https");
const { planBeacon } = require("./beacon");

const list = (v) => (Array.isArray(v) ? v : []);

initializeApp();

// One instance is plenty for a personal app, and a hard cap means a
// runaway loop can't quietly run up a bill on the Blaze plan.
setGlobalOptions({ region: "asia-south1", maxInstances: 3 });

// Accounts invited by EMAIL but not yet joined. They are the people who
// most need telling — "you've been added to a trip" — and they are
// exactly the ones memberUids doesn't contain, because you don't enter
// that list until you open the trip.
//
// Resolved through FIREBASE AUTH, not through the app's own data. The
// previous version queried `users` on an `email` field that each account
// writes for itself and the rules let it write freely — so claiming any
// participant's address subscribed you to that trip, and every new
// expense arrived on your lock screen with its description and amount.
// Auth's record of an address cannot be forged by the client.
async function uidsForEmails(emails) {
  if (!emails.length) return [];
  const found = [];
  for (const email of emails) {
    try {
      const user = await getAuth().getUserByEmail(email);
      // An unverified address proves nothing about who holds it, and
      // joining now requires verification anyway.
      if (user?.uid && user.emailVerified) found.push(user.uid);
    } catch {
      // No account on that address yet — the invitation waits in the
      // index until they sign up.
    }
  }
  return found;
}

// Every device token belonging to these people, minus the author's.
async function tokensFor(uids, exceptUid) {
  const db = getFirestore();
  const targets = [...new Set(uids)].filter((uid) => uid && uid !== exceptUid);
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
//
// ONLY these two codes mean "this token is gone". `invalid-argument` was
// in this list and is not a token verdict at all — it is FCM's canonical
// code for a malformed REQUEST, so one bad message deleted every
// recipient's tokens, and the clients never re-registered because they
// still believed they were subscribed. `mismatched-credential` means the
// token belongs to a different sender: also unusable by us, and exactly
// what the transposed-digit sender ID would have produced.
const DEAD_TOKEN_CODES = new Set([
  "messaging/registration-token-not-registered",
  "messaging/invalid-registration-token",
  "messaging/mismatched-credential",
]);

// Grouped per user: a member with ten dead tokens was costing ten writes.
async function dropDeadTokens(dead) {
  const db = getFirestore();
  const byUser = new Map();
  for (const { uid, token } of dead) {
    if (!byUser.has(uid)) byUser.set(uid, {});
    byUser.get(uid)[token] = FieldValue.delete();
  }
  await Promise.all([...byUser].map(([uid, pushTokens]) =>
    db.doc(`users/${uid}`).set({ pushTokens }, { merge: true }).catch(() => {})
  ));
}

// FCM refuses more than 500 messages in one call, and it throws
// synchronously — so a big trip meant NOBODY was notified rather than
// some partial failure.
const BATCH = 450;
const chunk = (list, size) => {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
};

// Bumped on every meaningful change to this directory. `firebase deploy`
// skips when it believes the source is unchanged, and a silently skipped
// deploy is indistinguishable from a successful one — you find out when
// the bug you fixed is still there.
const FUNCTION_VERSION = "1.64.0";

// Where the PWA lives, for the notification's click-through link.
const APP_ORIGIN = "https://archismandinda.github.io";

exports.notifyTripChange = onDocumentWritten("trips/{tripId}", async (event) => {
  // One try/catch around the whole body. There was none: a single
  // malformed document — `expenses` stored as a map by some older or
  // future client — threw and took the notification with it, invisibly,
  // for that write and every retry of it.
  try {
    await notify(event);
  } catch (err) {
    console.error("functionVersion", FUNCTION_VERSION);
    console.error("notifyTripChange failed", event.params.tripId, err);
    // Swallowed on purpose. Throwing asks Eventarc to retry, and a
    // document that is malformed now will be just as malformed then —
    // an infinite retry loop on a paid plan.
  }
});

async function notify(event) {
  const before = event.data?.before?.data() ?? null;
  const after = event.data?.after?.data() ?? null;
  if (!after || after.deleted) return; // a delete is not a notification

  const what = describe(before, after);
  if (!what) return; // most writes say nothing — see functions/notify.js

  // No author recorded (a document written by a client older than
  // v1.48) means we cannot tell who to skip. Staying silent beats
  // buzzing someone about their own typing.
  if (!after.lastEditBy) return;

  // Members AND anyone invited by address who hasn't joined yet.
  const invited = await uidsForEmails(list(after.invitedEmails));
  const recipients = await tokensFor(
    [...(after.memberUids ?? []), ...invited], after.lastEditBy
  );
  if (!recipients.length) return;

  // Every value in `data` MUST be a string — FCM rejects the whole
  // message otherwise, silently, per recipient.
  const message = {
    data: {
      title: String(after.trip?.name || "TripCash"),
      body: String(what.body),
      tripId: String(event.params.tripId),
    },
    webpush: {
      headers: { Urgency: "normal", TTL: "86400" },
      // ABSOLUTE. FCM requires a full https URL here and rejects a
      // relative path with INVALID_ARGUMENT — which, with the old dead-
      // token test below, would have wiped every token on the first
      // real send.
      fcmOptions: { link: `${APP_ORIGIN}/tripcash/?trip=${event.params.tripId}` },
    },
  };

  const dead = [];
  for (const batch of chunk(recipients, BATCH)) {
    const results = await getMessaging().sendEach(
      batch.map((r) => ({ ...message, token: r.token }))
    );
    results.responses.forEach((res, i) => {
      if (res.error && DEAD_TOKEN_CODES.has(res.error.code)) dead.push(batch[i]);
    });
  }
  if (dead.length) await dropDeadTokens(dead);
}

// ---------- counting (phase D8) ----------
//
// Six numbers, and nothing else. See docs/design/INSTRUMENTATION.md.
//
// Unauthenticated by necessity: the two events that matter most —
// a link being opened, and the trip being seen — happen before anyone
// signs in. Everything defensive about it is in ./beacon.js, which is
// pure and tested; this is the io.
//
// It stores COUNTS. The device id arrives, is used to decide the
// request is well-formed, and is then discarded — nothing per-person is
// ever written, so there is nothing here to leak and nothing to export
// under a data request.
exports.beacon = onRequest(
  { region: "asia-south1", maxInstances: 3, cors: true },
  async (req, res) => {
    // Fire-and-forget from the client (sendBeacon), so the response
    // body is never read. Answer 204 to everything that isn't a POST
    // rather than leaking which rejections happened.
    if (req.method !== "POST") return res.status(204).send("");
    try {
      const raw = typeof req.rawBody === "object" ? req.rawBody.toString("utf8")
        : typeof req.body === "string" ? req.body
        : JSON.stringify(req.body ?? "");
      const plan = planBeacon(raw);
      if (!plan.ok) {
        // Logged, not answered. A caller learning WHY it was refused is
        // a caller learning how to craft one that isn't.
        console.warn("beacon refused", plan.why, "v" + FUNCTION_VERSION);
        return res.status(204).send("");
      }
      await getFirestore().doc(`stats/${plan.day}`).set(
        { [plan.field]: FieldValue.increment(1) }, { merge: true }
      );
    } catch (err) {
      // Counting must never be able to break anything. A failure here
      // costs one data point.
      console.error("beacon failed", err);
    }
    return res.status(204).send("");
  }
);

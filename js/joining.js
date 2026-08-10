// What an attempted join concludes. Pure; app.js does the io.
//
// WHY THIS IS A MODULE AND NOT A FEW IFS INSIDE joinTrip():
//
// There are two call sites — the invite INDEX (ADR-0020) and the invite
// LINK (`?join=<id>` → settings.pendingJoin). They have already drifted
// apart once: the index path demanded a verified address and the link
// path did not, and nothing in the code said so. joinTrip() was written
// to end that, and then the two branches around it grew their own
// judgements anyway, which is how both of the defects below shipped.
//
// Defect 1 — the false success. `fetchTripById` answers a DELETED trip
// with a real, readable document: `{deleted:true, deletedAt, memberUids,
// invitedEmails}`. The tombstone keeps invitedEmails because the rules
// refuse any write that drops an existing member (see tombstonePayload
// in sync.js), so "am I invited?" is still TRUE for a trip that no
// longer exists. joinTrip never asked whether it was a tombstone, so it
// set `hasJoined`, fired `count("joined")` and reported "Shared trip
// added." That last part is the expensive one: `joined` is the
// acceptance number the growth loop is judged on, so a false success
// does not just mislead one person, it corrupts the measurement.
//
// Defect 2 — the endless retry. An invitation sent to an address you are
// not signed in as can NEVER succeed. The old code said so in a hint
// line and left `settings.pendingJoin` where it was, so the refused read
// ran again on every sync, for ninety days. Hence `clearPending`: every
// conclusion states out loud whether trying again could ever help.
//
// If you are tempted to move any of this back inline: the reason it is
// here is that the two call sites cannot then disagree about what a
// tombstone means.

import { isDeleted } from "./sync.js";
import { normaliseEmail } from "./members.js";

// The three sentences from the cold-open design note's failure table,
// plus the one for "try again later".
//
// None of them may be syncErrorMessage("permission-denied") — "The
// database turned this down — its access rules may not be set up yet."
// is a sentence about our infrastructure, aimed at someone who has never
// heard of TripCash and tapped a link a friend sent them.
export const GONE = "This trip isn't available any more.";
export const NOT_VERIFIED = "Check your email to finish joining.";
export const UNREACHABLE = "Couldn't open the shared trip — try Sync now again.";
export const wrongAddress = (email) =>
  email
    ? `This invite was sent to a different email. You're signed in as ${email}.`
    : "This invite was sent to a different email address.";

const list = (v) => (Array.isArray(v) ? v : []);

// `stage` says which half of the join produced the error, and it changes
// the answer for exactly one code:
//
//   read  + permission-denied → the document is not ours to see, so our
//                               address is not on it. Wrong account.
//   write + permission-denied → we had just READ this document, so we
//                               ARE on it. This is the rules being older
//                               than the client (the normal state until
//                               firestore.rules is republished), and
//                               telling the person to switch accounts
//                               would send them somewhere useless.
export function joinOutcome({ payload = null, account = null, error = null, stage = "read" } = {}) {
  if (error) {
    if (error?.code === "permission-denied" && stage === "read") {
      return {
        do: "wrong-address",
        clearPending: true,
        say: wrongAddress(normaliseEmail(account?.email)),
      };
    }
    // Offline, timed out, over quota, or refused mid-write: all of these
    // may work on the next sync, so this is the one failure that KEEPS
    // the invitation.
    return { do: "unreachable", clearPending: false, say: UNREACHABLE };
  }

  // Gone is checked before verification on purpose. Asking somebody to
  // go and verify an email address so they can join a trip that has been
  // deleted is a dead end dressed up as a next step.
  if (!payload || typeof payload !== "object" || isDeleted(payload)) {
    return { do: "gone", clearPending: true, say: GONE };
  }

  const uid = account?.uid ?? null;
  const email = normaliseEmail(account?.email);
  const member = !!uid && list(payload.memberUids).includes(uid);
  const invited = !!email && list(payload.invitedEmails).includes(email);

  // Readable but not addressed to us. the cold-open design deliberately gives this
  // the same sentence as a deleted trip: from the outside they are the
  // same event, and neither is the reader's fault.
  if (!member && !invited) return { do: "gone", clearPending: true, say: GONE };

  // Joining — and only joining — needs a verified address, because
  // becoming a member grants full write on the shared ledger (ADR-0021).
  // Someone who is already a member has nothing left to prove.
  if (!member && account?.emailVerified === false) {
    return { do: "verify", clearPending: false, say: NOT_VERIFIED };
  }

  // The success is the trip opening, not a sentence about it.
  return { do: "join", clearPending: true, say: "" };
}

// What to OFFER, per conclusion — the cold-open failure table, whose
// third column ("+ Ask them to add this address", "+ Resend", "offer the
// converter") had never been built. A sentence with nothing to do about
// it is a dead end with better manners, and it is the wrong-address case
// that strands people: they are signed in, the app works, and the only
// thing wrong is that the invitation went somewhere else.
//
// Kept apart from joinOutcome so the conclusion stays a statement of
// fact — the same conclusion can be reached from the invite index, where
// there is no invitation screen to put a button on.
export function nextStep(outcome) {
  switch (outcome?.do) {
    case "wrong-address":
      return { action: "add-address", label: "Ask them to add this address" };
    case "verify":
      return { action: "resend", label: "Resend the email" };
    // No blame and no dead end: the converter needs no account, no trip
    // and no network, which is exactly what this person has.
    case "gone":
      return { action: "look-around", label: "Have a look around" };
    case "unreachable":
      return { action: "retry", label: "Try again" };
    default:
      return null; // a join needs no next step — the trip IS the next step
  }
}

// The message the wrong-address next step hands to the share sheet. The
// person cannot fix this themselves: the address has to go on the trip,
// and only somebody already on it can put it there.
//
// The trip name comes from the link's preview, so it is a CLAIM and may
// be missing altogether (a generic invitation). Neither that nor an
// account with no address may put the word "undefined" into a message
// somebody is about to send to a friend.
export function addressRequest({ email, tripName } = {}) {
  const who = normaliseEmail(email);
  const name = typeof tripName === "string" ? tripName.trim() : "";
  const trip = name ? `“${name}”` : "the trip";
  return who
    ? `I tapped your TripCash link for ${trip}, but I'm signed in as ${who} — ` +
      `could you add that address to the trip?`
    : `I tapped your TripCash link for ${trip}, but I'm signed in with a different ` +
      `email address — could you add the one I use?`;
}

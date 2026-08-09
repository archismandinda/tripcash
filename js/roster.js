// Who is on a trip, and what you're allowed to do about it (phase D7).
//
// Pure decisions. app.js reads the input box and paints the result; every
// judgement about what that input MEANS, and about whether a person can
// be removed, lives here where it can be tested.
//
// This is the area that failed the owner five times running, and every
// failure was the same kind: a rule applied at one of the two places you
// can add a member and not the other, or a state the UI described
// wrongly. Both add-fields now go through one function, so they cannot
// disagree again.

import { parseMemberInput, normaliseEmail } from "./members.js";
import { ACCOUNT_SCOPE } from "./notices.js";

// What should happen when somebody types into an "add member" box.
//
// Returns one of:
//   { do: "nothing" }
//   { do: "add", member, invite: bool, say }
//   { do: "invite", target, email, say }   — they're already here by name
//   { do: "reject", say }
//
// `invite` is the crux. An address is an INVITATION, not a text field —
// adding a member from the obvious place used to create a name-only row
// that granted no access and invited nobody, which is indistinguishable
// from success and is why "I added them and they got nothing" kept
// happening.
export function planAddMember(text, members = [], { signedIn = false, newId } = {}) {
  const parsed = parseMemberInput(text);
  if (!parsed) return { do: "nothing" };

  const byName = members.find(
    (m) => (m.name ?? "").toLowerCase() === parsed.name.toLowerCase()
  );

  // An address for somebody already here by name is an invite for THEM.
  // Refusing it (and advising "add a surname") created a second person
  // and split the ledger across two rows.
  if (byName && parsed.kind === "email" && !byName.email) {
    return signedIn
      ? { do: "invite", target: byName, email: parsed.email,
          say: `${byName.name} will get this trip.` }
      : { do: "invite", target: byName, email: parsed.email,
          say: `Sign in to actually share this trip with ${byName.name}.` };
  }
  if (byName) {
    return { do: "reject", say: parsed.kind === "email"
      ? `${byName.name} already has an address on this trip.`
      : `Already someone called “${parsed.name}” — add a surname or initial.` };
  }
  if (parsed.kind === "email" && members.some((m) => normaliseEmail(m.email) === parsed.email)) {
    return { do: "reject", say: `${parsed.email} is already on this trip.` };
  }

  const member = {
    id: newId ?? crypto.randomUUID(),
    name: parsed.name,
    ...(parsed.kind === "email" ? { email: parsed.email } : {}),
    ...(parsed.kind === "phone" ? { phone: parsed.phone } : {}),
  };
  if (parsed.kind !== "email") return { do: "add", member, invite: false, say: "" };
  return {
    do: "add", member, invite: signedIn,
    // Signed out there is nothing to send and nowhere to send it. Saying
    // nothing let the member sheet show them as "invited, not opened
    // yet" when no invitation existed and none ever would.
    say: signedIn
      ? `${member.name} will get this trip.`
      : `Sign in to actually share this trip with ${member.name}.`,
  };
}

// May this person be taken off the trip, and if not, why not?
//
// The two add-fields and the member editor each had their own copy of
// this, and they drifted: one checked expenses only, so somebody who
// appeared solely in a recorded repayment could be removed — leaving the
// summary contradicting itself on one screen.
export function removability(
  member,
  { selfId, ownerUid = null, expenses = [], settlements = [], others = 0 } = {}
) {
  if (!member) return { removable: false, why: "gone", note: "" };
  if (member.id === selfId) {
    return { removable: false, why: "self", note: "",
      message: "You can't remove yourself from your own trip." };
  }
  // The owner is the one row nobody else may take off the trip.
  //
  // firestore.rules already refuses to drop the owner's UID, so their
  // ACCESS was never at risk — which is exactly what made this quiet.
  // The write still succeeded, because the rules police memberUids and
  // this deletes a row from `members`: the owner stayed able to open the
  // trip while vanishing from the members sheet and out of every split,
  // with no notice on either phone. Reachable on any trip where the
  // owner has no expenses yet, which is every trip on its first day.
  //
  // Gated on a known ownerUid: trips created before ownerUid existed
  // have none, and inventing an owner for them would lock a row that
  // nobody can explain.
  if (ownerUid && member.uid && member.uid === ownerUid) {
    const message = `${member.name || "They"} set this trip up — only they can leave it.`;
    // `note` is what the member sheet prints under a disabled Remove
    // button. Leaving it empty is how the trip editor used to behave —
    // a dead control and no reason given.
    return { removable: false, why: "owner", note: message, message };
  }
  const inExpenses = expenses.some(
    (e) => e.paidBy === member.id || Number(e.split?.parts?.[member.id]) > 0
  );
  const inPayments = settlements.some((p) => p.from === member.id || p.to === member.id);
  if (!inExpenses && !inPayments) return { removable: true, why: "", note: "" };

  // "Delete those first" was a dead end until there was a reassign tool
  // to point at. Now there is, so say that instead — unless there is
  // nobody to hand it to.
  return {
    removable: false,
    why: inExpenses ? "expenses" : "payments",
    canReassign: others > 0,
    note: others > 0
      ? `${member.name} is already in this trip's books, so someone has to take that over.`
      : "They're in the books and there's nobody to hand it to — add another member first.",
    message: "They're in this trip's books — open them from Members to hand it over and remove them.",
  };
}

// Removal has another side to it, and until TC-4 nobody was standing on
// it: what the REMOVED person's phone should do.
//
// It finds out the way anyone locked out of anything finds out — the door
// stops opening. Every push is refused, and all it could say was "the
// database turned this down — its access rules may not be set up yet",
// for ever, on a trip it still shows and still lets you add expenses to.
//
// `stillReadable` is the part that must not be guessed. A refused write
// is ambiguous: it also happens when the rules are simply older than the
// client — which is exactly the state of the world between shipping this
// and the owner publishing firestore.rules, and in that state it is the
// person doing the REMOVING whose push fails. Concluding "you were
// removed" from the error code alone would delete their trip. Only being
// unable to READ the document proves the access is gone, so the caller
// has to establish that first and pass it in.
export function evictionFrom({ code, tripId, trips = [], stillReadable = false }) {
  const held = trips.find((t) => t.id === tripId);
  const stay = { evicted: false, tripId, trips, notice: null, retry: true };
  if (code !== "permission-denied" || !held || stillReadable) return stay;
  return {
    evicted: true,
    tripId,
    // Dropped, not deleted — the caller must forget this trip without
    // recording a local delete. A tombstone would be re-asserted to the
    // cloud by a later sync, so a device that had merely lost access
    // would destroy the trip for everyone the moment it got access back.
    trips: trips.filter((t) => t.id !== tripId),
    // Account-scoped, because pruneNotices drops anything belonging to a
    // trip this device no longer holds — and this trip is precisely that.
    // The name has to be in the text or the notice says nothing.
    notice: {
      kind: "removed", tripId: ACCOUNT_SCOPE, ref: tripId,
      text: `You were removed from ${held.name || "a trip"} — it's no longer on this device.`,
    },
    // Retrying spends a refused write on every sync and reports a failure
    // the user cannot do anything about.
    retry: false,
  };
}

// Everyone with an address who has not been told yet. `invitedAt` records
// that an invitation actually WENT OUT, so re-saving a trip doesn't
// re-send and a failed send is retried.
export const awaitingInvite = (members = []) => members.filter((m) => m.email && !m.invitedAt);

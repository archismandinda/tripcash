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

// Losing access has another side to it, and until TC-4 nobody was
// standing on it: what the locked-out phone should do.
//
// It finds out the way anyone locked out of anything finds out — the door
// stops opening. Every push is refused, and all it could say was "the
// database turned this down — its access rules may not be set up yet",
// for ever, on a trip it still shows and still lets you add expenses to.
//
// `stillReadable` is the part that must not be guessed. A refused write
// is ambiguous: it also happens when the rules are simply older than the
// client, and in that state it is the person doing the REMOVING whose
// push fails. Only being unable to READ the document proves this device
// cannot reach the trip, so the caller has to establish that first.
//
// What that pair of refusals does NOT prove is who did it. Three things
// look identical from here:
//
//   - somebody removed this account from the trip
//   - a co-member's stale device dropped this row while merging
//     (members carry no tombstones — see the merge semantics)
//   - the rules are mid-rollout
//
// Until S6-1 this function returned `evicted: true` and the caller
// deleted the trip, its expenses, its settlements and its receipts. Two
// of those three readings make that permanent, silent destruction of
// somebody's money records, and the comment below justifying a missing
// tombstone was already reasoning from "a device wrongly locked out" —
// then throwing the data away anyway. So nothing here concludes removal
// any more. The trip is kept and marked read-only, which is recoverable
// under all three readings and costs a locked-out device nothing but
// patience.
export function evictionFrom({ code, tripId, trips = [], stillReadable = false }) {
  const held = trips.find((t) => t.id === tripId);
  const stay = { evicted: false, lockedOut: false, tripId, trips, notice: null, retry: true };
  if (code !== "permission-denied" || !held || stillReadable) return stay;
  return {
    // Kept, and kept false, as the standing answer to the question this
    // evidence cannot settle.
    evicted: false,
    lockedOut: true,
    tripId,
    // Every trip, including this one. Dropping it here is what deleted
    // it: the caller forgot the trip WITHOUT a tombstone, precisely
    // because a tombstone would have destroyed it for everyone else too.
    trips,
    // Trip-scoped, because the trip is still here to open. It was
    // account-scoped only because pruneNotices drops notices belonging to
    // a trip this device no longer holds. The name has to be in the text
    // or the notice says nothing.
    notice: {
      kind: "locked", tripId, ref: tripId,
      text: `${held.name || "A trip"} is read-only on this device — ` +
        "changes to it aren't being accepted. Nothing has been deleted.",
    },
    // Retrying spends a refused write on every sync and reports a failure
    // the user cannot do anything about. writeAccess() below is what the
    // push loop asks now that the trip is still in the list.
    retry: false,
  };
}

// May this device change this trip at all?
//
// One sentence, one decision, read by the push loop and by every screen
// that paints a control which writes. The push loop asks because a
// refused write costs a round trip and can never succeed; the screens ask
// because offering Add expense on a trip that cannot accept one is the
// same silence in a different place.
//
// `why` is empty when there is nothing to explain, so a caller can print
// it unconditionally.
export function writeAccess(tripId, lockedTripIds = []) {
  if (!(lockedTripIds ?? []).includes(tripId)) return { canWrite: true, why: "" };
  return {
    canWrite: false,
    // Says what is observable and stops there. Which of removal, a merge
    // accident or a rules rollout caused it is not knowable from here,
    // and the last line is the one the person actually needs.
    why: "Read-only on this device — changes to this trip aren't being accepted. " +
      "Nothing has been deleted. If someone took you off the trip, ask them to add you back.",
  };
}

// The lock, re-derived from evidence rather than remembered.
//
// `access` is what a READ of the trip document just proved:
//   "denied"  — refused: this device cannot reach the trip
//   "ok"      — it came back: whatever it was, it is over
//   "unknown" — offline, or a failure that proves nothing either way
//
// Returning the same array when nothing changed keeps a probe that only
// confirms what is already known from costing a settings write and a
// repaint on every sync.
export function locksAfter(lockedTripIds = [], tripId, access) {
  if (access !== "denied" && access !== "ok") return lockedTripIds;
  const locked = lockedTripIds.includes(tripId);
  if (locked === (access === "denied")) return lockedTripIds;
  return access === "denied"
    ? [...lockedTripIds, tripId]
    : lockedTripIds.filter((id) => id !== tripId);
}

// Everyone with an address who has not been told yet. `invitedAt` records
// that an invitation actually WENT OUT, so re-saving a trip doesn't
// re-send and a failed send is retried.
export const awaitingInvite = (members = []) => members.filter((m) => m.email && !m.invitedAt);

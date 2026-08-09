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
export function removability(member, { selfId, expenses = [], settlements = [], others = 0 } = {}) {
  if (!member) return { removable: false, why: "gone", note: "" };
  if (member.id === selfId) {
    return { removable: false, why: "self", note: "",
      message: "You can't remove yourself from your own trip." };
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

// Everyone with an address who has not been told yet. `invitedAt` records
// that an invitation actually WENT OUT, so re-saving a trip doesn't
// re-send and a failed send is retried.
export const awaitingInvite = (members = []) => members.filter((m) => m.email && !m.invitedAt);

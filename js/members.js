// Who's who in a trip (phase D3.6). Pure functions — no DOM, no network.
//
// A member is a PERSON in the trip's splits. Some have an account
// attached, so the trip appears on their phone and they see updates;
// some are just a name someone typed. Both split expenses identically —
// that's the whole point of unifying them.
//
//   member = { id, name, email?, uid? }
//
// Member ids are PERMANENT: expenses reference them by id (`paidBy`,
// `split.parts`), so a member can be renamed, invited, linked to an
// account or removed — but never re-keyed, or the ledger loses its
// history.

// The id every trip used before accounts existed. Kept forever so old
// expenses keep pointing at the right person.
export const LEGACY_SELF = "me";

export const normaliseEmail = (e) => (typeof e === "string" ? e.trim().toLowerCase() : "");

const sameEmail = (a, b) => !!normaliseEmail(a) && normaliseEmail(a) === normaliseEmail(b);

// A readable name to start from when we only know an address.
export const nameFromEmail = (email) => {
  const local = normaliseEmail(email).split("@")[0];
  return local ? local.charAt(0).toUpperCase() + local.slice(1) : "Someone";
};

// Which member is the person holding this device?
//
// This is the fix for the bug that made sharing wrong: "me" used to be a
// hardcoded id stored IN the trip, so once a trip synced, everyone's app
// thought the creator was them — and their expenses were filed under his
// name.
export function selfMemberId(members = [], account = null) {
  if (account?.uid) {
    const byUid = members.find((m) => m.uid === account.uid);
    if (byUid) return byUid.id;
    const byEmail = members.find((m) => sameEmail(m.email, account.email));
    if (byEmail) return byEmail.id;
    return null; // signed in but not yet linked to anyone in this trip
  }
  // Signed out: the original single-device member.
  return members.some((m) => m.id === LEGACY_SELF) ? LEGACY_SELF : members[0]?.id ?? null;
}

// Attach the signed-in account to the right member, once.
// `isOwner` = this account created the trip, so the unclaimed original
// member is theirs. Without that check, someone joining a shared trip
// would claim the creator's row.
export function linkAccount(members = [], account = null, { isOwner = false } = {}) {
  if (!account?.uid) return members;
  if (members.some((m) => m.uid === account.uid)) return members; // already linked

  const email = normaliseEmail(account.email);

  // 1. We were invited as a specific person — become them.
  const invited = members.findIndex((m) => sameEmail(m.email, email));
  if (invited >= 0) {
    return members.map((m, i) => (i === invited ? { ...m, uid: account.uid } : m));
  }

  // 2. The creator claiming their own row. "You" was a placeholder for a
  //    single device; now that others can see it, give it a real name.
  if (isOwner) {
    const own = members.findIndex((m) => !m.uid && (m.id === LEGACY_SELF || members.length === 1));
    if (own >= 0) {
      return members.map((m, i) => (i === own
        ? { ...m, uid: account.uid, email: email || m.email,
            name: m.name === "You" ? nameFromEmail(email) : m.name }
        : m));
    }
  }

  // 3. Reached the trip some other way — add a row so expenses can name us.
  return [...members, { id: crypto.randomUUID(), name: nameFromEmail(email), email, uid: account.uid }];
}

// Your own row reads "You"; everyone else reads their name.
export const memberLabel = (member, selfId) =>
  member?.id === selfId ? "You" : (member?.name ?? "?");

// The access lists the security rules actually check are DERIVED from
// members, so there's one list of people, not three that drift apart.
export const deriveMemberUids = (members = []) =>
  [...new Set(members.map((m) => m.uid).filter(Boolean))];

export const deriveInvitedEmails = (members = []) =>
  [...new Set(members.map((m) => normaliseEmail(m.email)).filter(Boolean))];

// One line explaining what a member is, for the members list.
export function memberStatus(member, selfId) {
  if (member.id === selfId) return member.email ? `${member.email} · this is you` : "this is you";
  if (member.uid) return `${member.email ?? "on TripCash"} · has the trip`;
  if (member.email) return `${member.email} · invited, not opened yet`;
  return "name only — won't see the trip";
}

// Invite discovery (phase D6). ADR-0020.
//
// Being added to a trip used to depend on FOUR independent things all
// working: a derived array on the trip, a Firestore QUERY the rules had
// to be able to prove, an ID-token claim that expires on its own
// schedule, and a Cloud Function that could only find you if you had
// already synced once. Any one of them failing looked identical from the
// outside — nothing happens — which is why three correct fixes in a row
// each uncovered another.
//
// This replaces all of it with ONE document read, addressed by the
// reader's own identity:
//
//     invites/{sha256(lowercased email)}  ->  { trips: { [id]: {...} } }
//
// A read of your own key cannot be "refused for a reason you can't see":
// there is no filter for the rules engine to prove, so no verification
// is needed and no enumeration is possible. The document id is a hash,
// so the collection is not a directory of anyone's address — a key is
// only computable by someone who already knows the email.
//
// The index is a HINT, never an authority. It hands you trip ids; each
// one is then fetched with an ordinary get that `isInvited()` still
// gates. So a stranger writing junk into your invite document gains
// them nothing at all.

export const INVITE_TTL_MS = 90 * 24 * 60 * 60 * 1000;

// Lowercased, because that is how invitedEmails is stored and how the
// rules compare it (`myEmail().lower()`).
export async function emailKey(email, subtle = globalThis.crypto?.subtle) {
  const clean = String(email ?? "").trim().toLowerCase();
  if (!clean || !subtle) return "";
  const bytes = new TextEncoder().encode(clean);
  const digest = await subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

// One entry per trip. Small on purpose: enough to name the trip in a
// notification before it has been fetched, and nothing more. It is
// readable only by the invitee, but it is written by someone else, so it
// carries no money and no member list.
export const inviteEntry = (trip, invitedBy, now = Date.now()) => ({
  name: String(trip?.name ?? "A trip"),
  invitedBy: String(invitedBy ?? ""),
  at: now,
});

// Which trips in the index this device hasn't got yet. Anything already
// held, or long stale, is noise.
export function pendingInvites(index, knownTripIds = [], now = Date.now()) {
  const held = new Set(knownTripIds);
  return Object.entries(index?.trips ?? {})
    .filter(([id, entry]) => id && !held.has(id) && now - (entry?.at ?? 0) < INVITE_TTL_MS)
    .map(([id, entry]) => ({ tripId: id, ...entry }));
}

// Entries worth deleting: trips this device has now joined, or that
// aged out. Keeping the index short keeps the read cheap.
export function spentInvites(index, knownTripIds = [], now = Date.now()) {
  const held = new Set(knownTripIds);
  return Object.keys(index?.trips ?? {})
    .filter((id) => held.has(id) || now - (index.trips[id]?.at ?? 0) >= INVITE_TTL_MS);
}

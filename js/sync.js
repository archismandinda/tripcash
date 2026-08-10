// Sync orchestration (phase D3.3). Pure functions over plain objects —
// the network lives in js/firestore.js — so "what should the merged trip
// look like?" is answered here and unit-tested with a fake remote.
//
// One document per trip carries the trip, its expenses, its settlements
// and its tombstones (ADR-0009); the record-level conflict rules come
// from js/merge.js (ADR-0008).

import { mergeCollection, mergeTombstones, winsOver, pruneTombstones,
  tripTombstones, attributeArrivals } from "./merge.js";
import { deriveMemberUids, deriveInvitedEmails } from "./members.js";

export const SCHEMA = 1;

const stampOf = (rec) => (Number.isFinite(rec?.updatedAt) ? rec.updatedAt : 0);

// Device-local trip fields that must never be uploaded: `lastEdit` is the
// converter's in-progress amount, session-only since v1.21.
const DEVICE_ONLY = ["lastEdit", "samples"];

// Variadic on purpose: this merges access lists from several sources at
// once, and a fixed-arity version silently dropped the extras.
const union = (...lists) => [...new Set(lists.flatMap((l) => l ?? []).filter(Boolean))];

const emptyTombs = (t = {}) => ({
  expenses: t.expenses ?? {},
  settlements: t.settlements ?? {},
});

// Everything this device knows about one trip, in the shape we store.
// Invited addresses are matched against the email on a signed-in user's
// token, so they must be stored the way that arrives: lowercased.
export const normaliseEmail = (email) =>
  typeof email === "string" ? email.trim().toLowerCase() : "";

export function buildPayload({ trip, expenses, settlements, tombstones, uid }) {
  const clean = { ...trip };
  for (const field of DEVICE_ONLY) delete clean[field];
  // The access lists the security rules check are DERIVED from the trip's
  // members (ADR-0011), so there is one list of people rather than three
  // that drift apart.
  //
  // memberUids used to be a UNION with whatever the trip already carried,
  // which meant a uid could get on the list but never off it. Removing
  // somebody was therefore cosmetic: their row vanished from the members
  // sheet while they kept full write on the trip document — able to read
  // every expense, rewrite the ledger, tombstone the whole trip — and the
  // notification function kept pushing every change to their phone. There
  // was no way to fix that from the app, and nothing said it was
  // happening. Derived means removal removes (TC-4).
  //
  // Two uids are not the roster's to drop, both for the same reason: the
  // rules judge a write by the document it PRODUCES.
  //   - the writer, or this push is one nobody could ever have sent;
  //   - the owner, who is the anchor that can always let people back in.
  const members = trip.members ?? [];
  // Whatever the trip already says, and NOTHING if it says nothing.
  //
  // This used to fall back to `uid`, i.e. "if I can't see an owner, it's
  // me". buildPayload runs before the transaction has read the document,
  // so it cannot tell "this trip has no owner" from "I have not looked" —
  // and on a trip whose stored document really had none, the old rules
  // accepted the guess. Whoever synced first became the pinned,
  // unremovable owner of somebody else's trip and could then evict the
  // person who created it, with two ordinary background pushes. Minting
  // moved to the one place that can prove there is no owner to displace:
  // mergePayload with a null remote, which means no document (ADR-0023).
  const ownerUid = trip.ownerUid ?? null;
  return {
    schema: SCHEMA,
    trip: clean,
    // Who wrote this. Top-level, NOT on the trip record: a field on the
    // record would restamp it on every push and hand a device that
    // merely synced a merge win (ADR-0017). Excluded from
    // payloadChanged too, so changing author never costs a write on its
    // own. The notification function uses it to skip the author.
    lastEditBy: uid ?? null,
    memberUids: union(deriveMemberUids(members), ownerUid ? [ownerUid] : [], uid ? [uid] : []),
    invitedEmails: union(deriveInvitedEmails(members)),
    ownerUid,
    expenses,
    settlements,
    // Only the deletions that happened IN this trip. The whole map used
    // to go into every document, so one account's trips all grew at the
    // same rate and each carried the others' history; at Firestore's
    // 1 MB ceiling that trip stops being pushable for good. See
    // tripTombstones in merge.js for what an unattributed id does.
    tombstones: tripTombstones(tombstones, trip?.id),
  };
}

// Accepting an invite is just adding your own uid to the trip. The rules
// allow it only when your verified email is on the invite list, so this
// can't be used to join a trip you weren't asked to.
export function joinIfInvited(payload, { uid, email }) {
  const mine = normaliseEmail(email);
  if (!uid || !mine) return payload;
  if (payload.memberUids?.includes(uid)) return payload;
  if (!(payload.invitedEmails ?? []).includes(mine)) return payload;
  return { ...payload, memberUids: union(payload.memberUids, [uid]) };
}

// Deleting a trip REPLACES its document with a tombstone rather than
// removing it. A missing document is indistinguishable from one this
// device has never seen, so the other phone — which still holds the trip
// locally — would recreate it on its next push, and the two would pass
// it back and forth forever. The tombstone is the only thing that tells
// every device it is genuinely gone.
export function tombstonePayload(payload, deletedAt = Date.now()) {
  return {
    schema: SCHEMA,
    deleted: true,
    deletedAt,
    // Access has to survive the delete: the rules refuse any write that
    // drops an existing member, including this one.
    memberUids: payload?.memberUids ?? [],
    invitedEmails: payload?.invitedEmails ?? [],
    ownerUid: payload?.ownerUid ?? null,
  };
}

export const isDeleted = (payload) => !!payload?.deleted;

// A member row's `uid` is not an ordinary edited field. It is a CLAIM,
// written once, by that account's own device, when it joins. Nobody else
// can produce it and nobody edits it away — so a trip record that wins
// the merge while missing one is not a removal, it is a device that
// hasn't heard yet.
//
// That distinction is the whole of TC-4's second half. Deriving access
// from the winner alone (ADR-0022) meant a co-member whose phone was
// offline through the join, and who then edited the trip at all, pushed a
// members list where the joiner's row had no uid — so the joiner lost
// write access to a trip nobody removed them from. The rules accept that
// write (the owner and the author are both still on it), the joiner can
// still READ it (their address is on the derived invitedEmails), so
// evictionFrom() correctly concludes "not evicted" and they get the
// generic refusal for ever. And it does not heal: the stale record is the
// merge winner, so the claim is gone from both sides for good.
//
// So the claims are reconciled onto the winner before access is derived.
// Removal still removes, because removal takes the whole ROW away and a
// row the winner no longer carries is never rebuilt here — only rows both
// sides still have are filled in. A row that already names somebody keeps
// whoever the winner says, so this can never re-key a member either.
function reconcileClaims(winner, loser) {
  const claims = new Map(
    (loser?.members ?? []).filter((m) => m?.id && m.uid).map((m) => [m.id, m.uid])
  );
  if (!claims.size) return winner;
  let changed = false;
  const members = (winner?.members ?? []).map((m) => {
    if (!m?.id || m.uid || !claims.has(m.id)) return m;
    changed = true;
    return { ...m, uid: claims.get(m.id) };
  });
  // Untouched means the SAME object: an equal-but-new trip record would
  // read as a change to the stamping diff and restamp the trip on a
  // device that had merely synced (ADR-0017).
  return changed ? { ...winner, members } : winner;
}

// Reconcile what we have with what the server has. Remote may be null
// (first upload of this trip). Never destructive: a record only vanishes
// because a tombstone outranks it, never because one side hadn't heard
// of it yet.
// `now` decides which tombstones have outlived their 90 days. It is the
// plain local clock rather than the server-corrected one records are
// stamped with: skew that matters between two phones is minutes, the TTL
// is measured in months, and a device whose clock is a season out has
// bigger problems than an extra tombstone.
//
// `writer` is the uid of the device making this write, and it defaults to
// lastEditBy because on every ordinary push those are the same person.
// The join is the exception: joinOnly() in firestore.rules refuses a
// write that restamps lastEditBy, so a joiner cannot announce themselves
// that way — and without being named here the derivation below would drop
// them out of the very list they are joining.
export function mergePayload(local, remote, now = Date.now(), { writer = null } = {}) {
  // No document. This is the ONLY moment anything in this codebase can
  // prove a trip has no owner rather than merely not having read one, so
  // it is the only place an owner is minted — and there is nobody to
  // displace, because there is nothing there. Every other path takes the
  // stored document's word for it (ADR-0023).
  if (!remote) {
    return {
      ...local,
      schema: SCHEMA,
      ownerUid: local?.ownerUid ?? writer ?? local?.lastEditBy ?? null,
    };
  }
  const author = writer ?? local?.lastEditBy ?? null;

  // A delete loses only to an edit made after it — the same rule the
  // records inside a trip already follow. Ties go to the delete.
  //
  // EITHER side may be the tombstone. Pushing a delete means merging our
  // tombstone against the live copy still in the cloud; if only the
  // remote were checked, that live copy would win and the tombstone
  // would erase itself, so the delete would never land.
  // Deleting a trip is FINAL.
  //
  // This used to let a later edit revive it, mirroring how records
  // inside a trip behave. That was wrong at the trip level: routine
  // housekeeping on another device — linking an account to a member
  // row, writing your profile into it — genuinely changes the trip
  // record, so it gets restamped with the current time. That restamp
  // out-dated the delete and brought the trip back, twice, without
  // anyone having edited anything. A delete nobody can rely on is worse
  // than no undo, so the tombstone now always wins.
  const localDeletedAt = isDeleted(local) ? (local.deletedAt ?? 0) : 0;
  const remoteDeletedAt = isDeleted(remote) ? (remote.deletedAt ?? 0) : 0;
  const deletedAt = Math.max(localDeletedAt, remoteDeletedAt);
  if (deletedAt) {
    return tombstonePayload({
      // Access still merges — a union here, unlike the live branch below,
      // because a tombstone has no members list left to derive from.
      // Whoever joined around the delete keeps their place on the
      // document, or later writes get refused. Nobody gains anything by
      // it: there is nothing behind the tombstone to read.
      memberUids: union(local.memberUids, remote.memberUids),
      invitedEmails: union(local.invitedEmails, remote.invitedEmails),
      // The document decides, here as everywhere below. A tombstone is
      // still an update, so the rules pin ownerUid across it too — send
      // anything but the stored value and the delete is refused for ever.
      ownerUid: remote.ownerUid ?? null,
    }, deletedAt);
  }

  // The trip's own fields (name, currencies, members…) are one record.
  // Same tie rule as the records inside it — a tie resolved "keep mine"
  // leaves the two devices permanently disagreeing.
  //
  // …and then the losing record's member CLAIMS are folded back onto it,
  // because a uid that is missing from the winner is news it never got,
  // not a removal. See reconcileClaims.
  const remoteWins = winsOver(remote.trip, local.trip);
  const trip = reconcileClaims(
    remoteWins ? remote.trip : local.trip,
    remoteWins ? local.trip : remote.trip,
  );

  const expenses = mergeCollection(
    local.expenses, remote.expenses ?? [],
    local.tombstones.expenses, emptyTombs(remote.tombstones).expenses
  );
  const settlements = mergeCollection(
    local.settlements, remote.settlements ?? [],
    local.tombstones.settlements, emptyTombs(remote.tombstones).settlements
  );

  // The stored document is the authority on who owns it, full stop. This
  // used to fall back to the local record, which looks harmless and is
  // not: on a trip whose document has no owner, "mine if the cloud has
  // none" is the seizure written in the client instead of the rules — and
  // now that ownerUid is pinned on every update, it is also a value the
  // rules will refuse for ever, i.e. a trip that can never sync again from
  // this device. A trip that reached the cloud without an owner stays
  // without one (ADR-0023); nothing here can work out who it should have
  // been, and guessing is what caused this.
  const ownerUid = remote.ownerUid ?? null;

  return {
    schema: SCHEMA,
    trip,
    // Ours if we have one: this device is the one doing the writing.
    lastEditBy: local.lastEditBy ?? remote.lastEditBy ?? null,
    // Both access lists now follow the same rule, and they follow the
    // WINNING trip record — not the local one. A union could never shrink,
    // so removing somebody did nothing at all (TC-4); deriving from the
    // local side instead would let a phone with a stale members list evict
    // people simply by losing the merge.
    //
    // The two additions are the two uids no merge may drop: the owner, and
    // whoever is writing. See buildPayload for why.
    memberUids: union(
      deriveMemberUids(trip.members ?? []),
      ownerUid ? [ownerUid] : [],
      author ? [author] : [],
    ),
    // An invite list that only grows can never be corrected: fix a typo'd
    // address and the typo stays, letting the wrong person join — and,
    // until v1.44, reappearing as a phantom member in every future equal
    // split.
    invitedEmails: deriveInvitedEmails(trip.members ?? []),
    ownerUid,
    expenses: expenses.merged,
    settlements: settlements.merged,
    // Pruned AFTER mergeCollection has used the full set to bury, never
    // before: the merge that forgets a delete would otherwise be the same
    // merge that hands the record back. By 90 days every device has long
    // since seen the delete, and the document has to stop growing
    // somewhere.
    tombstones: {
      expenses: pruneTombstones(expenses.tombstones, now),
      settlements: pruneTombstones(settlements.tombstones, now),
    },
  };
}

// Is it worth spending a write? Comparing the merged result against what
// the server already had keeps quiet devices from burning quota.
export function payloadChanged(merged, remote) {
  if (!remote) return true;
  return JSON.stringify(normalise(merged)) !== JSON.stringify(normalise(remote));
}

function normalise(payload) {
  const byId = (list = []) => [...list].sort((a, b) => (a.id < b.id ? -1 : 1));
  return {
    deleted: !!payload.deleted,
    deletedAt: payload.deletedAt ?? null,
    trip: sortKeys(payload.trip ?? {}),
    memberUids: [...(payload.memberUids ?? [])].sort(),
    invitedEmails: [...(payload.invitedEmails ?? [])].sort(),
    ownerUid: payload.ownerUid ?? null,
    expenses: byId(payload.expenses).map(sortKeys),
    settlements: byId(payload.settlements).map(sortKeys),
    tombstones: sortKeys(emptyTombs(payload.tombstones)),
  };
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys(value[k])]));
  }
  return value;
}

// Fold a merged payload back into the flat local collections. Expenses
// and settlements for OTHER trips are passed through untouched.
export function applyPayload({ merged, tripId, trips, expenses, settlements, tombstones }) {
  // memberUids is written back so the local record keeps saying who has
  // access. buildPayload no longer READS it — it derives the list from
  // members instead (TC-4) — but the field has been on every stored trip
  // for many versions, and removing it now would look like a change to
  // stampCollection, restamping every trip on the device that upgraded
  // first and handing it a win over genuine edits elsewhere (ADR-0017).
  // invitedEmails is different:
  // it is derived fresh from members on every upload, so writing it onto
  // the local record adds a field the record didn't have. That looked like
  // a real change to the stamping diff, so boot's "one-time" invite
  // migration deleted it, restamped every trip, and did so on EVERY
  // launch — handing a device that had merely been opened a stamp that
  // out-ranked a genuine edit made on the other phone. ADR-0014's
  // invariant, broken by a stray empty array (ADR-0017).
  const nextTrip = {
    ...merged.trip,
    id: tripId,
    memberUids: merged.memberUids,
    ownerUid: merged.ownerUid,
  };
  delete nextTrip.invitedEmails;
  const known = trips.some((t) => t.id === tripId);
  return {
    trips: known
      // lastEdit and samples are device-local (DEVICE_ONLY / LOCAL_ONLY)
      // and therefore absent from the merged payload. Dropping them here
      // wiped the decimal-slip guard's calibration on every sync, which
      // is precisely the guard that catches a mistyped amount.
      ? trips.map((t) => (t.id === tripId
        ? { ...nextTrip, lastEdit: t.lastEdit ?? null, ...(t.samples ? { samples: t.samples } : {}) }
        : t))
      : [...trips, nextTrip], // a trip shared with us from another device
    expenses: [
      ...expenses.filter((e) => e.tripId !== tripId),
      ...merged.expenses.map((e) => ({ ...e, tripId })),
    ],
    settlements: [
      ...settlements.filter((s) => s.tripId !== tripId),
      ...merged.settlements.map((s) => ({ ...s, tripId })),
    ],
    tombstones: {
      ...tombstones,
      expenses: mergeTombstones(tombstones.expenses ?? {}, merged.tombstones.expenses),
      settlements: mergeTombstones(tombstones.settlements ?? {}, merged.tombstones.settlements),
      // A delete that arrived in THIS trip's document happened in this
      // trip. Without writing that down, every delete made on another
      // device would land here unattributed and this device would then
      // upload it to every trip it owns — the same map travelling
      // between trips again, just the long way round.
      //
      // But only the ARRIVALS. Every id in this payload was assumed to be
      // this trip's, and the unattributed ones are in it precisely because
      // they ride on every trip — so the first sync after the upgrade filed
      // every pre-upgrade deletion under whichever trip happened to go
      // first, and a delete still on its way to the cloud never reached its
      // own trip's document at all. See attributeArrivals for what counts
      // as evidence.
      //
      // Attribution we already hold came from the record itself, so it is
      // the better evidence and wins.
      tripOf: {
        ...attributeArrivals({
          ids: [
            ...Object.keys(merged.tombstones.expenses ?? {}),
            ...Object.keys(merged.tombstones.settlements ?? {}),
          ],
          tripId,
          tombstones,
          elsewhere: [...expenses, ...settlements].filter((r) => r?.tripId !== tripId),
        }),
        ...(tombstones.tripOf ?? {}),
      },
    },
  };
}

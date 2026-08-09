// Folding a synced payload back into local state — as a DECISION, not as
// a side effect (phase D7).
//
// This logic used to live inline in app.js, where it could not be tested,
// and it produced four separate data-loss bugs in a fortnight:
//
//   - it applied the payload it had SENT over whatever the user had done
//     during the network round trip, then tombstoned the missing record
//     as a deletion and propagated that everywhere (ADR-0019);
//   - it wrote the tombstone map from a read taken before the saves,
//     erasing deletions those saves had just recorded;
//   - it left receipts in IndexedDB for expenses deleted elsewhere;
//   - and a trip arriving from another person announced itself nowhere.
//
// Every one is a wiring bug: the pure merge rules underneath were right
// the whole time. So the wiring is what moved out here.
//
// This function performs NO io. It takes the state as it is now and
// returns the state as it should be, plus the effects the caller must
// carry out in the order given. That makes the ordering itself testable,
// which is the part that kept going wrong.

import { diffTrip } from "./notices.js";
import { selfMemberId } from "./members.js";

/**
 * @returns {object} one of
 *   { deleted: true }                          — the trip is gone
 *   { deleted: false, trips, expenses, settlements, tombstones,
 *     notices, orphanedReceipts, arrival }     — apply, in that order
 */
export function absorbPayload({
  merged, tripId, trips, expenses, settlements, tombstones,
  account, money,
  buildPayload, mergePayload, applyPayload,
}) {
  const held = trips.find((t) => t.id === tripId);
  const mine = expenses.filter((e) => e.tripId === tripId);
  const minePays = settlements.filter((s) => s.tripId === tripId);

  // Rebuild from state as it is NOW, not as it was when the request
  // left. The merge is a union, so a record created during the round
  // trip survives, one edited during it wins on its stamp, and one
  // deleted during it stays deleted on its tombstone.
  const current = held
    ? buildPayload({ trip: held, expenses: mine, settlements: minePays,
        tombstones, uid: account?.uid })
    : null;
  const reconciled = current ? mergePayload(current, merged) : merged;

  if (reconciled?.deleted) return { deleted: true };

  const next = applyPayload({
    merged: reconciled, tripId, trips, expenses, settlements, tombstones,
  });

  // A trip we have never seen is the most important thing a sync can
  // find. It used to appear at the bottom of the list with no comment.
  const arrival = held ? null : { id: tripId, name: reconciled?.trip?.name ?? "" };

  // What changed for this person, worked out from data this device
  // already has — so it holds whether or not a push was delivered.
  const notices = current
    ? diffTrip({
        tripId,
        tripName: reconciled?.trip?.name ?? held?.name ?? "a trip",
        before: { expenses: mine, settlements: minePays },
        after: reconciled,
        selfId: held ? selfMemberId(held.members ?? [], account) : null,
        money,
      })
    : [];

  // Receipts whose expense a remote tombstone just removed. Nothing else
  // sweeps them: the local delete path only ever cleaned up deletes made
  // HERE, so a photo deleted on another phone stayed on this one for
  // ever, on every device that had ever seen the trip.
  const surviving = new Set(next.expenses.map((e) => e.id));
  const orphanedReceipts = mine
    .filter((e) => e.attachment && !surviving.has(e.id))
    .map((e) => e.id);

  return {
    deleted: false,
    trips: next.trips,
    expenses: next.expenses,
    settlements: next.settlements,
    // FIRST, before the saves — writing it after clobbered any tombstone
    // those saves had just recorded.
    tombstones: next.tombstones,
    notices,
    orphanedReceipts,
    arrival,
    reconciled,
  };
}

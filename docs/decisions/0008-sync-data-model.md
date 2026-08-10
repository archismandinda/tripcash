# ADR-0008: Last-write-wins sync with tombstones, stamped at one choke point

Date: 2026-08-05 · Status: accepted

## Context
Phase D3 syncs trips, expenses and settlements across devices and people.
TripCash is offline-first by design: two phones will routinely edit the
same trip with no network, then reconcile later. Local records had no
per-record change timestamps, and deletions left no trace — so a naive
"merge whatever both sides have" would resurrect every deleted expense
on the next sync, permanently.

Retrofitting timestamps *after* data is already in the cloud means
guessing at history, so this lands before any Firebase code.

## Decision
- Every synced record carries `updatedAt`. Conflicts resolve
  **last-write-wins per record**, not per field. Field-level merging (or
  CRDTs) would be the "correct" answer, but the real conflict here is two
  people editing the same expense minutes apart — LWW is predictable and
  explainable, and the loser's version is never silently blended into a
  record neither person typed.
- Deletions write **tombstones** (`tripcash:tombstones`, namespaced per
  collection) so a delete propagates. A tombstone beats an edit only when
  it is at least as new as that edit; an edit made *after* a delete
  legitimately resurrects the record. Ties go to the delete. Tombstones
  are pruned after 90 days.

  *Amended by [ADR-0024](0024-the-roster-is-a-collection.md).* The roster
  is the third collection now, and revive-on-later-edit is **off** for it:
  a member row is restamped by housekeeping nobody asked for
  (`linkAccount`, `applyProfile`), so an edit is not evidence a person
  wanted anybody back. Removal is final within the 90 days.
- Stamping happens **inside store.js**, by diffing the incoming array
  against what is already persisted, rather than at each of the ~20
  mutation sites in app.js. A future feature physically cannot forget to
  stamp, and no existing call site had to change.
- `lastEdit` (the converter's in-progress amount, session-only since
  v1.21) is excluded from change detection — otherwise every keystroke
  would restamp the trip and start a sync tug-of-war between devices.
- Merge rules live in `js/merge.js` as pure functions, unit-tested
  independently of Firebase (23 tests), including convergence: merging
  A into B and B into A must produce the same result.
- Ordering is not arbitrated by timestamps. Trips are drag-reorderable
  and that order is per-device taste; local order is preserved and
  remote-only records append at the end.

## Consequences
- Sync can be implemented, replaced, or removed without touching merge
  semantics; the hard part is testable with no network and no account.
- Records saved before this change have no `updatedAt`; they are
  backfilled on their next write and treated as oldest until then.
  Member rows are the exception (ADR-0024): they are **not** backfilled,
  because backfilling them would change every trip record on the device
  that upgraded first and hand it a win over a genuine edit made on the
  other phone — ADR-0014/0017. An unstamped row is judged by the trip
  record it rides on, which is the only evidence an older build leaves.
- Receipts stay device-local for now — they are IndexedDB blobs
  (ADR-0006), and Cloud Storage for Firebase requires the paid Blaze
  plan on new projects, which is a cost decision for the project owner, not an
  implementation detail. Flagged in the project's internal notes rather than assumed.
- Simultaneous edits lose one side's version. Acceptable for a trip
  ledger; revisit only if it actually bites.

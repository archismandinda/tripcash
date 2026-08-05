# ADR-0009: One Firestore document per trip, written in a transaction

Date: 2026-08-05 · Status: accepted

## Context
D3.3 syncs trips, expenses and settlements. The obvious Firestore shape
is a document per record — `trips/{id}/expenses/{id}` — but that buys
scaling we will never need and costs complexity we would pay for daily:
per-record reads/writes against the Spark plan's daily quota, N+1 reads
to load a trip, per-collection tombstone handling, and fiddlier rules.

Real scale here: a trip has a handful of members and tens of expenses.
An expense serialises to roughly 300 bytes.

## Decision
One document per trip (`trips/{tripId}`) holding the trip's own fields
plus its `expenses[]`, `settlements[]`, and `tombstones{}`. Access is
governed by a `memberUids` array on the same document, so the security
rule is a single membership check and invites (D3.4) are just "add a uid
to that array".

Sync is a **Firestore transaction**: read the remote document, merge it
against local state with the pure rules from ADR-0008, write the result
back. The transaction is what makes concurrent edits from two phones
safe — without it, a whole-document write could silently discard changes
another device committed between our read and our write.

Merge orchestration lives in `js/sync.js` as pure functions over plain
objects, so it is unit-tested with a fake remote and no network.

## Consequences
- Loading or saving a trip is one read / one write, which matters on a
  free-tier quota and on a phone with bad signal.
- The 1 MiB document limit caps a trip at roughly 3,000 expenses — about
  an order of magnitude beyond any realistic trip. If that is ever
  approached, the fix is to split expenses into a subcollection; the
  merge rules would not change, only the adapter.
- Any write rewrites the whole trip document. Acceptable at this size,
  and the transaction makes it correct rather than merely small.
- `lastEdit` is stripped before upload: it is device-local, session-only
  state (v1.21) and would otherwise cause pointless syncing.

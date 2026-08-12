# ADR-0016: The record you upload must be the record you stamped

Date: 2026-08-09 · Status: accepted

## Context
Archiving a trip undid itself within seconds, on the same device, with no
refresh and no second device involved.

`store.setTrips()` stamps `updatedAt` as it persists (that single choke
point is deliberate — ADR-0008). But it stamped a **copy**:
`stampCollection` returns `{ ...rec, updatedAt }` and the result went
straight to `localStorage`, while `app.js` kept holding the original
objects. The uploaded payload is built from those in-memory objects.

So every edit to an existing record was pushed carrying the stamp it had
*before* the edit. Against a cloud copy written from the same starting
point, that is an exact tie — and a tie was resolved as "keep the cloud's"
(pre-v1.43) or by coin flip (post-v1.43). The archive flag went up, lost,
and came straight back down through the live listener.

It stayed hidden for five releases because *new* records were unaffected
(nothing in the cloud to lose to), and a page reload re-read the correct
stamps from storage, so the symptom moved around depending on timing.
Every earlier fix — Lamport anchoring, server clocks, housekeeping order —
worked on making the stamps *correct*, when the problem was that the
correct stamp was never on the record being sent.

## Decision
`setTrips` / `setExpenses` / `setSettlements` return the stamped records,
and `saveTrips` / `saveExpenses` / `saveSettlements` copy `updatedAt` back
onto the matching in-memory objects (`restamp` — in `js/app.js` when this
was decided; it moved unchanged to `js/state.js` when the in-memory state
and its save functions were extracted there).

Copied field by field rather than swapping the arrays: several callers
hold a reference to a record across the save — the archive toast's Undo,
the member-linking pass in `syncNow` — and replacing the objects would
leave them writing to a copy nothing reads.

## Consequences
- Memory and storage carry the same stamp, so what gets uploaded is what
  was actually written.
- Anything that persists a synced record must go through `saveTrips()`
  and friends. Calling `store.setTrips()` directly re-opens this bug.
- Rule, fourth variant of the same lesson: **the value you compute must
  reach the thing you act on.** A function that stamps a copy is a
  function that does nothing, however correct the stamp is.

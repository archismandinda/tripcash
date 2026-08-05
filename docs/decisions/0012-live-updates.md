# ADR-0012: Live updates in both directions, with three guards

Date: 2026-08-06 · Status: accepted

## Context
Sync only ran at launch and on a Sync button. Two people at the same
dinner table would each add expenses and neither would see the other's
until someone tapped something — which reads as broken, not as "not yet
synced".

## Decision
Firestore's `onSnapshot` over "trips whose memberUids contains me", for
as long as the app is open. Free within the existing quota.

Crucially, **outbound is debounced-automatic too**. A listener alone
makes changes arrive but never leave: the person who typed an expense
would still have to press Sync for anyone else to see it, so from the
other side nothing has changed. Local writes therefore schedule a push
~4s later.

Three guards, each protecting against a specific failure:

1. **Ping-pong.** Absorbing a snapshot writes to local storage, which
   would schedule a push, which the other phone absorbs, which schedules
   a push… `suppressPush` is set while applying a snapshot. A push is
   scheduled afterwards *only* when `payloadChanged(merged, remote)` —
   i.e. our merge genuinely produced something the server lacks. That
   terminates, because once pushed the two agree.

2. **The UI moving under a finger.** A snapshot arriving while a sheet is
   open must not re-render beneath someone mid-way through typing an
   expense. Renders are deferred while any `dialog[open]` exists and
   flushed when it closes.

3. **Keystroke storms.** `saveTrips()` runs on every converter keystroke
   (it persists the in-progress amount). Debouncing collapses a typing
   burst into one push, which usually finds nothing changed — `lastEdit`
   is stripped from the payload and doesn't move `updatedAt` — and so
   costs a single read.

Own writes echo back through the listener; those are skipped while
`hasPendingWrites` is true. A dropped listener is not an error: it clears
itself and manual Sync still works. Returning to the app re-establishes
the listener and syncs once, since a backgrounded tab may have lost it.

## Consequences
- Both phones stay current without anyone thinking about syncing.
- Reads scale with edits, not with time — nowhere near the daily quota
  at this scale, and the app remains fully usable signed out or offline.
- The 4s delay is deliberate: it batches a flurry of edits into one
  write. Tighten only if it ever feels slow in practice.

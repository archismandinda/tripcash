# ADR-0012: Live updates in both directions, with three guards

Date: 2026-08-06 · Status: accepted · **push delay corrected in v1.40.1
(see the note at the end)**

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
~4s later. *(Corrected in v1.40.1 — it is 1.2s, and for a reason this
paragraph gets backwards. See the end of this file.)*

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

## Correction — v1.40.1, recorded 13 Aug 2026

**The delay is 1.2 seconds, not ~4, and the reasoning above it is the
wrong way round.** v1.40.1 replaced the literal `4000` with
`PUSH_DELAY_MS = 1200` and shortened it on purpose: the debounce exists
only to collapse converter keystrokes into one push, and anything longer
leaves a *discrete* action — archiving a trip, say — sitting unsent while
you pick up your other device to look for it. Batching harder is not the
goal; the same release added the flush on `visibilitychange`/`pagehide`,
because a backgrounded tab can have its timers frozen indefinitely and a
long debounce can mean the change is never sent at all.

Nothing else in this ADR changed. The three guards all still hold. The
machinery has since moved out of `js/app.js` into `js/flow/sync.js`
(decomposition story D-2) with no behavioural change, and
`PUSH_DELAY_MS` is exported from there.

Recorded rather than silently edited because a decision record that
disagrees with the code is worse than no record: this one had been wrong
since v1.40.1, and it was found by a mutation run rather than by anyone
reading it.

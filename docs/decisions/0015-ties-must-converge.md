# ADR-0015: A tie is not a draw — both devices must pick the same winner

Date: 2026-08-09 · Status: accepted

## Context
Archiving a trip on one device never reached the other, through four
attempted fixes (v1.37–v1.42.1). Diagnostics copied from both phones
finally showed why. Every trip on both devices carried the **identical**
`updatedAt`, and the cloud held one copy `archived=true` and one
`archived=false` at that same stamp.

Last-write-wins was implemented as `stampOf(rec) > stampOf(held)` —
strictly newer. On a tie that means *keep the one I already have*, which
is a different answer on each device. The Mac kept archived, Android kept
unarchived, each pushed its own, and neither was ever wrong enough to
lose. Divergence was stable: no amount of syncing could resolve it.

Ties are not an edge case here:
- `stampCollection` stamps everything changed in one write with a single
  number, so a whole collection shares a stamp.
- The Lamport anchor (v1.41) picks `max(now, highest seen + 1)`, so two
  devices reconciling off the same ceiling land on the same value.
- Server-time stamps (ADR-0014) removed the skew that used to *hide* this
  by making collisions unlikely.

## Decision
Comparison moves into one function, `winsOver(a, b)` in `js/merge.js`,
used by both `mergeCollection` and `mergePayload`'s choice of trip record.
Stamp decides when the stamps differ. When they are equal, the winner is
whichever record sorts higher as a canonical JSON string (keys sorted).

The tiebreak is arbitrary on purpose. There is no "right" copy when two
devices edited the same record at the same instant — the only thing that
matters is that **every device computes the same answer from the same
pair**. A stable serialisation gives that with no schema change, no
device ids, and no new field to keep in sync.

Related: unchanged content now keeps the *higher* of the two stamps
rather than the local one, so a record echoed back from the cloud isn't
knocked down locally and re-adopted on every sync.

## Consequences
- Two devices always converge. The losing edit is genuinely lost, which
  is what last-write-wins has always meant.
- Which copy survives a true tie is unpredictable from the outside. The
  fix for a user is to make the edit again: a fresh edit gets a stamp
  above everything seen, so it wins outright rather than tying.
- Rule this project keeps relearning, third variant: **any comparison
  that decides a merge must be total.** `>` on a value that can repeat
  is not — it silently means "prefer mine", and preferring mine on both
  sides is permanent disagreement.

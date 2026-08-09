# ADR-0017: Derived fields don't belong on the record

Date: 2026-08-09 · Status: accepted

## Context
An independent audit found that **opening the app restamped every trip**,
so a device that had merely been launched out-ranked a genuine edit made
on the other phone. The mechanism:

1. `applyPayload` wrote `invitedEmails: merged.invitedEmails ?? []` onto
   the local trip record on every sync.
2. `boot()`'s one-time invite migration tested `if (t.invitedEmails)` —
   and `[]` is truthy — so it deleted the field and called `saveTrips()`.
3. That was a real content change against what was in storage, so every
   trip was restamped with the current time.

`invitedEmails` is **derived**: `buildPayload` rebuilds it from the trip's
members on every upload and never reads the stored copy. It was pure
noise on the record — noise that broke ADR-0014's invariant that an
automatic write must never out-rank a deliberate one.

The same audit found the derived list was also a growing **union** across
devices, so a mistyped invite address could never be removed: the wrong
person kept the right to join, and boot turned every stale address back
into a member who then took a share of every new equal split.

## Decision
**A field derived from other fields is not stored on the record.**
`applyPayload` no longer writes `invitedEmails` locally. `memberUids`
stays, because `buildPayload` genuinely feeds on it — the list only ever
grows and must survive locally to do that.

**The invite list tracks the members it came from.** `mergePayload`
derives it from the winning trip's members instead of unioning both
sides. `memberUids` remains a union: access already granted must not be
yanked from someone whose phone hasn't synced. An invite is an
*intention*, and intentions get changed. The security rules permit this —
`keepsEveryone()` guards `memberUids` only.

**A migration flag means "I migrated something."** Not "I looked."

## Consequences
- Launching the app is no longer a write, so it cannot win a merge.
- Cancelling or correcting an invite now actually takes effect.
- A device holding an older member list can drop an invite the other
  device just added. That is the same whole-record last-write-wins that
  already applies to the member row itself, so the invite and the member
  it belongs to are lost or kept together rather than drifting apart.
- General rule: **anything written as a side effect of syncing must be
  invisible to the change detector** — either not stored, or listed in
  `LOCAL_ONLY`/`DEVICE_ONLY`. This is the third bug of exactly this shape
  (see ADR-0014, ADR-0016).

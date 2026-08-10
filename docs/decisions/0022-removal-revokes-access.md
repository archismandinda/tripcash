# ADR-0022: Removal revokes access — and the removed device is told

**Superseded by ADR-0024** —
[a missing member row is not a removal](0024-the-roster-is-a-collection.md).
The decision below — access derives from the winning trip record's members
— stands. Two things in it do not, and both were load-bearing: the property
it closes with (annotated where it stands, at the end), and what a locked-out
device *does* — it no longer forgets the trip, it keeps it and marks it
read-only. Read 0024 before touching membership.

Date: 2026-08-10 · Status: superseded by 0024 · Amends 0011

## Context
ADR-0011 said removal takes someone out of the splits but deliberately
leaves their cloud access alone: "pulling a trip out from under someone
mid-trip is worse than leaving them a stale copy", and it closed with
*"No hard 'remove someone's access' yet. Deliberate; revisit if wanted."*

What that produced was not a stale copy. It was full membership with the
member row hidden:

- `buildPayload()` unioned the trip's stored `memberUids` into every
  push, so a uid that reached the list could never leave it;
- `firestore.rules`' `keepsEveryone()` refused any write that dropped
  one, so even a client that tried could not;
- so a removed person kept `allow update` on the trip document: they
  could read every expense, rewrite the ledger, tombstone the whole trip
  — and `functions/index.js` kept pushing every change to their phone,
  because it notifies `after.memberUids`.

Two independent layers, each sufficient on its own, and no way for the
owner to get past either from the app. The comment in `members.js` case 3
had been documenting this as a live consequence for several versions:
removing somebody was impossible, because their own device saw a trip it
was still a member of and put the row straight back.

Meanwhile the shape of the answer was already in the codebase.
`invitedEmails` had been a growing union too, and for the same reason it
could never be corrected — a typo'd address kept the wrong person's right
to join for ever (v1.44). It was changed to derive from the winning trip
record's members. `memberUids` simply never followed.

## Decision
**Both access lists derive from the winning trip record's members.** A
uid with no member row has no access, in `buildPayload` and in
`mergePayload` alike. `keepsEveryone()` now constrains invitees only.

Three uids are exempt, and only three:

- **the writer**, because the rules judge a write by the document it
  produces — a payload without its own author is one nobody could have
  sent, and one nobody could undo;
- **the owner** (`keepsOwner()` in the rules), because everyone else can
  be removed and invited back, and the owner is who makes that possible.
  `ownerUid` is pinned at the same time, or seizing it and then evicting
  the real owner is two ordinary writes;
- **the joiner**, passed to `mergePayload` as `writer`. A join may not
  restamp `lastEditBy` (`joinOnly()` forbids it), so nothing on the
  payload says who is writing, and an unnamed joiner is derived straight
  back off the trip they are joining.

**Derivation reads the WINNING trip record, never the local one.**
Otherwise a phone with a stale members list evicts people by losing the
merge — the same failure in the opposite direction.

**The removed device says so.** `evictionFrom()` in `roster.js` turns a
refusal into a decision, and the trip is *forgotten* (`store.forgetTrip`)
rather than deleted: `setTrips` would record a local trip tombstone, and
`syncNow` re-asserts those to the cloud, so a device that had merely lost
access would destroy the trip for everybody the moment it could write
again.

**A refused write is not on its own evidence of removal.** It is also
what an out-of-date rules deployment looks like — and in that state the
failing device belongs to the person doing the *removing*. Only being
unable to READ the document proves the access is gone, so the caller
establishes that first and passes it in.

## Consequences
- Removing somebody ends their read, their write and their
  notifications. No Cloud Function change was needed: it sends to
  `after.memberUids`, and that list now shrinks.
- The rules relaxation is backwards-compatible and **must be published
  first**. The client change alone, against the older rules, makes every
  push after a removal fail with `permission-denied` — which is exactly
  the ADR-0011-era failure that this rule set is designed to survive
  (see §3's "a client change that needs new rules must tolerate the old
  ones"): it does, because that refusal is readable and therefore not
  read as an eviction.
- Unsynced local work on a trip you are removed from goes with the trip.
  Removal is the owner's deliberate act; there is nowhere to put it.
- A window remains between a join landing and the joiner's member row
  carrying their uid, during which another device's push would derive
  the list without them. `joinTrip` now claims the member row in its own
  write immediately after joining rather than waiting for the next
  sync's push loop, which reduces that window to the gap between two
  consecutive writes from the same device.

  **That last sentence was wrong, and it cost a critical bug (TC-4).**
  The window is not on the joiner's device, so closing it there closes
  nothing. Every OTHER device holds a copy of the members list from
  before the join, and a copy that has not heard is indefinitely stale —
  a phone that is offline or backgrounded for a week still holds it. The
  moment its owner makes any ordinary edit, their record wins on stamp
  and the derivation reads a row where the joiner is a name and an
  address, so the joiner loses write access to a trip nobody removed
  them from. It cannot be reported (`invitedEmails` derives from the same
  stale list, so the document stays readable and `evictionFrom` rightly
  says "not evicted") and it cannot heal (the stale record is the
  winner). **A member row's `uid` is a CLAIM, not an edited field**: it
  is written once, by that account's own device, and nobody else can
  produce it. So `mergePayload` folds the losing record's claims onto
  the winner before deriving access (`reconcileClaims`). Removal is
  unaffected — removal deletes the ROW, and a row the winner no longer
  carries is never rebuilt.

  **That last sentence is FALSE, and it is left standing so that a reader
  who arrives here first can see what was believed. See
  [ADR-0024](0024-the-roster-is-a-collection.md), which supersedes this
  record.** It holds only when the remover's record wins the stamp, and it
  is written here with no case attached. Reproduced both ways against the
  real `mergePayload`: a removal made on the losing record is silently
  undone and does not even cost a write, and a device that never heard
  about a member drops that member's row on the winner — which the
  derivation reads as a removal, so a merge accident revokes somebody's
  read, write and notifications. `reconcileClaims` cannot repair the
  second: it fills a `uid` onto a row both sides hold, and there the whole
  row is absent. The root of it is one line at the top of `js/merge.js` —
  a delete with no tombstone is indistinguishable from "the other side has
  not heard yet" — applied to expenses and settlements but never to the
  members list.
- Asserted in the emulator against the real rules: a member may drop
  another member; the owner may not be dropped; a removed uid can
  neither read nor write; a stranger still cannot.

# ADR-0024: A missing member row is not a removal — the roster is a collection

Date: 2026-08-10 · Status: accepted · Supersedes ADR-0022

## Context

[ADR-0022](0022-removal-revokes-access.md) closes with a property stated as
settled fact:

> Removal is unaffected — removal deletes the ROW, and a row the winner no
> longer carries is never rebuilt.

**That sentence is false.** It is true only in the case where the remover's
record wins the stamp, and it is stated with no case attached. It is the
reason five sprints and a seven-lane audit each asked whether the code does
what ADR-0022 says, rather than whether ADR-0022 was right. The same
property is restated in the comment block above `reconcileClaims` in
`js/sync.js`.

Both halves of the property fail, in opposite directions. Both were
reproduced by calling the real `mergePayload` from `js/sync.js`, and the
second by then calling the real `evictionFrom` from `js/roster.js` — three
members on a trip, uids written as their role for readability, nothing
mocked.

Every figure in the two blocks below is from ONE revision: the code as it
stood before this record's decision landed, which is the code the two
scenarios are about. What the same calls answer once part 1 is in place is
printed separately and labelled as such. A block spliced from two revisions
reproduces on neither, and a reader who checks it — which is the whole
reason to print it rather than describe it — is entitled to get what it
says.

### Scenario A — the remover loses the stamp, so the removal is undone

Asha takes Priya off the trip. Bala's phone has not heard about it and he
renames the trip a moment later; his record therefore wins on stamp and
still carries all three rows.

```
=== SCENARIO A — the remover loses the stamp ===
  local (Asha, removed Priya)   trip.updatedAt 1000, members Asha, Bala
  remote (Bala renamed it)      trip.updatedAt 1001, members Asha, Bala, Priya
after mergePayload:
  trip.members  ["Asha/OWNER","Bala/BALA","Priya/PRIYA"]
  memberUids    ["OWNER","BALA","PRIYA"]
  invitedEmails ["asha@example.com","bala@example.com","priya@example.com"]
```

Priya's uid is back on the access list and her row is back in every split.
Nothing announces it: `payloadChanged(merged, remote)` is `false`, so the
merge does not even cost a write. The removal evaporates in silence and
Asha's only evidence would be re-opening the members sheet.

### Scenario B — a device that has not heard wins, and evicts somebody nobody removed

The mirror image, and the expensive one. Priya was added on Asha's phone.
Bala was offline through it, then renamed the trip. Nobody removed anybody.

```
=== SCENARIO B — a device that has not heard wins the stamp ===
  local (Asha added Priya)      trip.updatedAt 2000, members Asha, Bala, Priya
  remote (Bala, never heard)    trip.updatedAt 2001, members Asha, Bala
after mergePayload:
  trip.members  ["Asha/OWNER","Bala/BALA"]
  memberUids    ["OWNER","BALA"]
  invitedEmails ["asha@example.com","bala@example.com"]
on Priya's phone, evictionFrom():
  evicted true  retry false  trips kept 0
  notice  "You were removed from Goa — it's no longer on this device."
```

Priya is off both derived lists. Her write is refused and so is her read —
`invitedEmails` derives from the same record, so she has lost the
convenience path back in as well. `reconcileClaims` cannot help: it fills a
`uid` onto a row **both** sides still carry, and here the whole row is
absent. This is the case ADR-0022's last paragraph does not cover — it
fixed the row-without-a-uid variant and declared the row-missing-entirely
variant impossible in the same breath.

The last line of that block is the expensive one, and it is why part 1 of
the decision below lands first. `trips kept 0` is the trip leaving the
device: its expenses, its settlements and its receipts went with it, on a
trip nobody had removed her from. Run the same call, on the same evidence,
against the code with part 1 in place and it answers instead:

```
on Priya's phone, evictionFrom() — with part 1 landed:
  evicted false  lockedOut true  retry false  trips kept 1
```

Nothing above it moves. Part 1 does not touch the merge, so on that revision
Priya is still off both derived lists and still cannot write or read the
trip; what changed is that she keeps her records while that is true. Part 2
is what stops the merge dropping her row at all, and after it this call is
never reached — which is why the block it belongs to is a run against the
code as it was before either part landed, and is labelled as one.

### Why the property was false, not merely wrong

`js/merge.js` opens by saying it:

> Deletes need tombstones — `{ [id]: deletedAt }` — or a delete would simply
> look like "the other side is missing a record" and get resurrected on the
> next sync.

That rule is applied to expenses and to settlements, which are merged by
`mergeCollection` with per-record stamps and a tombstone map. It is not
applied to the members list, which has neither. Members ride inside the
trip record as a plain field, so the whole roster is decided wholesale by
one comparison between two trip records — and an absent row carries no
evidence of anything. "This row was removed" and "this device has not heard
about this row yet" are the same bytes. `winsOver` cannot tell them apart
because there is nothing there to tell apart.

ADR-0022 then made `memberUids` and `invitedEmails` derived from the winner,
which was right and is not being undone. But it changed what that ambiguity
costs. Before, a lost merge lost a name in a split until the next edit
re-added it. Now the same lost merge revokes read access, write access and
notifications. **A merge accident became an access-control accident**, and
the client concluded from it — until this sprint — that the person had been
removed, and deleted their trip, their expenses, their settlements and
their receipts on that reading (`applyEviction` in `js/app.js`, on the
result of `evictionFrom` in `js/roster.js`).

The modules involved are `js/merge.js` (`mergeCollection`, `winsOver`),
`js/sync.js` (`mergePayload`, `reconcileClaims`) and `js/roster.js`
(`evictionFrom`); the destructive call site was `applyEviction` in
`js/app.js`.

## Decision

Two parts, in this order, because the first makes every case of the second
recoverable while it is being built.

### 1. Eviction stops deleting — first

`evictionFrom` no longer concludes removal from a refused write plus a
refused read. That pair of refusals proves only that *this device cannot
reach this trip*; removal, scenario B, and a mid-rollout ruleset are
indistinguishable from there, and only one of the three readings makes
deletion correct. It returns `lockedOut: true`, the full trips list, and a
trip-scoped notice that names the trip and says nothing has been deleted.
`applyEviction` becomes `applyLockout`: it records the lock, files the
notice and repaints. It destroys nothing. `writeAccess` is the single
sentence every screen and the push loop read, and `locksAfter` lifts the
lock the moment a read succeeds again.

This part is deliberately first. It is worth little on its own — a locked
trip is still a trip nobody can use — but until it lands, every scenario B
is permanent, silent destruction of somebody's money records, including
while part 2 is being written.

### 2. The roster becomes a collection — second

Members get the semantics expenses and settlements have had since ADR-0008:
a per-row stamp and a tombstone, merged by `mergeCollection` rather than
carried wholesale on the trip record. Then removal is a delete that carries
evidence, absence stops meaning removal, and both scenarios above resolve
the same way on every device:

- scenario A: Asha's tombstone for Priya's row beats Bala's stale copy of
  it, whatever the trip record's stamp says. The removal sticks.
- scenario B: Priya's row is a record Bala's device has never seen, not a
  record it deleted, so the merge keeps it. She is not evicted.

Access stays derived from the merged roster (ADR-0022's decision, kept) —
it is derived from a roster that can now be merged correctly.

## Consequences

- ADR-0022's sentence is annotated as false where it stands, not removed.
  A reader who arrives at 0022 first must be able to see both the claim and
  its correction; a quietly edited record teaches nothing.
- The comment above `reconcileClaims` in `js/sync.js` restates the same
  property and is corrected with the code, not here.
- `reconcileClaims` is not deleted by part 2. A `uid` claim folded onto a
  row both sides hold is still right, and it is cheaper than a merge.
- A member row now needs an `updatedAt` and a tombstone map of its own,
  which is a change to what is stored on a trip. Devices are on different
  builds for at least one launch (a service worker reaches a phone on its
  SECOND open), so an old build's roster — rows with no stamps — has to
  merge against a new one's without either side losing people. That is the
  work part 2 is scoped around, and the reason it is not a one-line change.

  **How part 2 answered it**, since the question above is the whole of the
  risk. Three rules, all in `js/merge.js`:
  - Unstamped rows are never backfilled. Only a row that is genuinely new
    or genuinely changed is stamped, so merely launching the app cannot
    restamp a trip and out-rank the other phone (ADR-0014/0017).
  - A row with no stamp of its own is *judged by the trip record it rides
    on*, for the comparison only. An older build's one way of saying "I
    edited a member" is to restamp the trip, so this keeps its edits
    winning — and the inherited number is never written onto the row.
  - `tombstones.members` is left off the wire while it is empty, so a trip
    with no removals in it is byte-for-byte the document older builds
    write. `joinOnly()` in `firestore.rules` pins `tombstones`, and
    `syncTrip` runs the fetched document through `mergePayload` rather
    than echoing it — an empty map added there refuses every invitation
    accepted during the rollout window. Proved in the emulator against the
    real rules before it was fixed, and `firestore.rules` needs no change.

  What is NOT solved: an older build cannot express a removal at all (it
  drops the row and writes no grave), so during the window a removal made
  on the old build is not honoured by the new one, and the two rewrite
  each other's roster once per sync until both are upgraded. That is the
  safe direction — nobody loses access — and it ends when the second
  phone opens the app twice.
- **Removal is final for the life of the trip.** Decided by the owner,
  10 Aug 2026, reversing what shipped in the first draft of this record.

  A member grave began as a tombstone like any other and inherited ADR-0008's
  90-day TTL. That was inheritance rather than a decision, and it was wrong,
  because the TTL solves a problem members do not have. Past the line the
  grave was pruned, and a co-member's phone still carrying the removed row
  brought that person back — row, uid, access and notifications — on its
  next sync, telling nobody. Driven through the real `mergePayload` with a
  grave one day past the TTL: `members ["Asha", "Priya"]`, `memberUids
  ["OWNER","PRIYA",…]`, graves empty.

  The argument for the TTL was Firestore's 1 MB per-document ceiling. It does
  not survive measurement. A member grave is one id and one timestamp:

      3 removals over a trip's life:      82 bytes  (0.008% of the limit)
     10 removals:                        271 bytes  (0.026%)
     50 removals:                      1,351 bytes  (0.13%)
    200 removals:                      5,401 bytes  (0.52%)

  A trip removes one or two people, ever. An expense grave is one of
  potentially hundreds, which is what ADR-0008's bound is actually for. The
  two cases only looked alike.

  What the TTL cost in exchange for those bytes: "removed" meant "removed
  until somebody's tablet wakes up", which is not a property that can be
  explained to the person who did the removing.

  **A deliberate re-add is unaffected**, and this was checked rather than
  assumed: `planAddMember` mints a fresh `crypto.randomUUID()`, so the grave
  names an id nobody carries. Pinned by a test that removes somebody, waits
  100 days, adds them back against a co-member's stale roster, and asserts
  both that they return and that the old grave is still there.
- **A collection brings its ordering rule with it, and that rule has to
  reach `payloadChanged` too.** `mergeCollection` keeps the LOCAL order and
  appends the rows only the other side had, deliberately: the sequence
  records sit in is per-device state no timestamp can arbitrate. So two
  phones that each added somebody between syncs hold the same roster in a
  different order for ever, and neither is wrong. `normalise()` in
  `js/sync.js` already id-sorted expenses and settlements before comparing
  them for exactly that reason; the roster was moved into the merge without
  being added to that list, so a member-order-only difference read as news
  and **both** phones pushed every cycle — each write waking the other's
  snapshot, which pushed back, bounded only by the 1.2s debounce. The
  ~3,000-writes-an-hour shape v1.57 already fixed once, plus a change
  notification to everybody on a trip nobody was editing.

  The lesson generalises past this ADR: **promoting a field to a
  collection means finding every place that compares it**, not only the
  place that merges it. Regression tests are in `tests/sync.test.mjs`
  ("the order members are listed in is per-device…", and the two-device
  loop that follows it).
- What is not decided here: whether a removed person's device should be
  told they were removed. It cannot be told from the evidence available on
  that device, and part 1 makes the honest answer — "read-only, nothing has
  been deleted" — survivable for as long as it takes to get told by a
  person.

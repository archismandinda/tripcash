# ADR-0023: Ownership cannot be inferred — an ownerless trip stays ownerless

Date: 2026-08-10 · Status: accepted · Amends 0022

## Context
ADR-0022 made the owner the one uid no write may drop, and pinned
`ownerUid` alongside it "or seizing it and then evicting the real owner is
two ordinary writes". Both halves shipped. Neither applied to a trip whose
stored document had no `ownerUid`:

```
function keepsOwner() {
  return resource.data.get('ownerUid', null) == null      // ← short-circuit
         || (request.resource.data.get('ownerUid', null) == resource.data.ownerUid
             && resource.data.ownerUid in request.resource.data.memberUids);
}
```

That first line was written to keep pre-ownerUid trips writable. What it
did was hand them away. `buildPayload` filled the gap from the other side —
`trip.ownerUid ?? uid ?? null`, i.e. *"if I can't see an owner, it's me"* —
so on such a trip the sequence was:

1. any co-member's ordinary background push carries `ownerUid: <themselves>`;
2. `keepsOwner()` short-circuits on the stored null and accepts it;
3. they are now the pinned owner, and the same rule refuses everyone
   else's attempt to correct it;
4. a second, equally ordinary push removes the person who created the trip.

Reproduced against the live `firestore.rules` in the emulator, not
reasoned about. The rule sold as *"the trip owner cannot be removed by
anyone else"* was, on every pre-ownerUid trip, protecting whoever synced
first. Nothing appears on either screen at any point.

The client half was the deeper error. `buildPayload` runs **before** the
transaction reads the document. It cannot distinguish *"this trip has no
owner"* from *"I have not looked"*, and a guess between those two is the
seizure. `mergePayload` had the same shape one layer down —
`remote.ownerUid ?? local.ownerUid ?? null`, which is the same guess made
by a function that had, by then, actually read the document and seen no
owner.

## Decision
**Nothing infers ownership. Ever.** Where an owner is unknown it stays
unknown, and the trip stays an ordinary trip.

- `buildPayload` sends `trip.ownerUid ?? null` and never mints.
- **Minting happens in exactly one place: `mergePayload(local, null)`.**
  A null remote means there is no document — the only moment anything here
  can *prove* an owner is absent rather than unread, and the only moment
  there is nobody to displace. It sets
  `local.ownerUid ?? writer ?? local.lastEditBy`.
- `mergePayload` against an existing document takes `remote.ownerUid`, and
  nothing else. Not the local record, however confident it is.
- `keepsOwner()` pins the field unconditionally on update:
  `request.resource.data.get('ownerUid', null) == resource.data.get('ownerUid', null)`,
  plus the surviving requirement that a non-null owner stays in
  `memberUids`. `.get(f, null)` on both sides means absent, null and
  unwritten all compare equal, so an old client that never heard of
  `ownerUid` keeps working and a current one can send the stored value
  straight back.
- `allow create` requires that any `ownerUid` present be
  `request.auth.uid`. Pinning the field on update buys nothing if a device
  can create the document naming somebody else.

**The blunt answer was chosen deliberately over every clever one.** An
ownerless trip stays ownerless for ever. The alternatives all guess:
first-writer-wins is the bug itself; oldest member row, or the member whose
uid matches `lastEditBy`, or the only account on the trip — each is a
heuristic that silently confers a permanent, unremovable status on somebody
the document never named, and each is wrong exactly when it matters (a
shared trip where the creator is offline). §9 of PROJECT_CONTEXT already
records what happens to clever rules here: revive-on-later-edit and
wall-clock LWW both looked principled and both destroyed real data. Prefer
the blunt, predictable rule.

Nothing is lost by it. `removability()` in `js/roster.js` was already gated
on a *known* `ownerUid` (`if (ownerUid && member.uid && …)`), so the app
never promised protection it could not deliver on these trips, and it does
not start now. Renaming, spending, inviting and removing all still work;
removal is simply symmetric, as it was before ownership existed.

## Rollout: the CLIENT ships first, the rules are published afterwards
This is the opposite order to ADR-0022's, and the reason is a test rather
than a preference (`tests-integration/compat.test.mjs`).

Every payload the v1.65 client emits carries `ownerUid: <its own uid>` —
that is the defect. Against the new rules, its push to a document that has
**no** owner is a seizure, and is refused. Devices only pick up a new
service worker on their **second** open (§8b.2), so publishing the rules
first opens a window in which a live phone gets `permission-denied` on
those trips until it happens to be reopened.

The reverse order costs nothing, and this is the part worth checking rather
than believing: the fixed client sends the *stored* value back — the same
value for an owned trip, and `null` for an ownerless one. The old
`keepsOwner()` short-circuits to true on a stored null and compares equal
on a stored owner, and the old `allow create` had no `ownerUid` clause at
all, so every payload the new client produces is accepted by the rules
already published. **So: ship the client, wait for the two-open window,
then publish `firestore.rules`.**

This is executed, not reasoned. `tests-integration/rollout.test.mjs` runs
the PUBLISHED rules and the DEPLOYED client — read out of git against a
pinned baseline, so they are what is actually live rather than a copy that
can drift — against the proposed ones, in all four combinations:

    published rules + deployed client + ownerless trip  -> REFUSED
    published rules + deployed client + owned trip      -> ok
    published rules + NEW client                        -> ok
    proposed  rules + NEW client                        -> ok

That first line is the whole reason this ADR carries a release order. An
earlier draft of this paragraph said the old-rules half was "reasoned from
the rule text, not executed"; that was true when written and is no longer,
and an ADR that understates its own evidence invites somebody to redo the
work or to distrust a real proof.

## Consequences
- The seizure is closed at both layers, and each is asserted separately:
  the client cannot compose the payload (`tests/sync.test.mjs`), and the
  rules would refuse it if it did (`tests-integration/rules.test.mjs`).
- `mergePayload` no longer preserves a stale local `ownerUid`. That is not
  only correctness: with the field pinned, a local claim the document does
  not share is a value the rules refuse **for ever**, i.e. a trip that can
  never sync again from that device.
- A trip that reaches the cloud without an owner can never acquire one.
  Believed to be an empty class in this project's own database —
  `buildPayload` has minted an owner on every upload since v1.26.0, the
  first sync release — but the rule must be right regardless: "whenever
  the field is missing, anything goes" is the wrong shape of rule, and the
  field's absence is a state the rules can meet for reasons nobody has
  thought of yet.
- On that class, the first sync after upgrading rewrites the local trip
  record's `ownerUid` from a stale uid to `null`, which reads as a real
  change to `stampCollection` and restamps the trip once (ADR-0017's
  shape). Accepted: it is one write, on trips that are believed not to
  exist, and the alternative is keeping a value on the record that is both
  untrue and unsendable.

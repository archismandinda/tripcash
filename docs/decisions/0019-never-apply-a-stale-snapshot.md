# ADR-0019: Never apply a snapshot across an await

Date: 2026-08-09 · Status: accepted

## Context
An audit found that any expense saved while a sync was in flight was
destroyed — and tombstoned on every other device, so it was gone for
everyone. Reproduced with the real modules:

```
user saved E2 — storage now: [ 'E1', 'E2' ]
after absorb   — storage now: [ 'E1' ]
tombstoned as a deletion: {"E2": 1786288422005}
```

`syncNow` built a payload, awaited a Firestore transaction — 0.5–5 s on a
phone — and then applied the result with `applyPayload`, which replaces a
trip's records **wholesale**. Anything saved during the await had the
same `tripId`, so it was filtered out. The next `writeSynced` then saw a
record that used to exist and no longer did, which is its definition of a
deletion, and wrote a tombstone.

The window was open almost continuously: a push is scheduled 1.2 s after
every save, and `syncNow` also runs on `visibilitychange` and sign-in.

This is the fourth variant of one mistake (ADR-0014, 0016, 0017). The
earlier three were about *stamps* being stale. This one is the whole
*snapshot* being stale, and no amount of correct stamping could have
caught it, because the record was gone before any comparison happened.

## Decision
**A value read before an await may not be written after it.** Anything
crossing an await is re-derived from live state on the far side.

Concretely, `absorbInto()` rebuilds the local payload from state as it is
when the transaction returns and merges the server's answer into *that*,
rather than applying what was sent. The merge is a union, so a record
created mid-flight survives; a record edited mid-flight wins on its
stamp; a record deleted mid-flight stays deleted on its tombstone. All
three are tested.

The tombstone map is written **before** the saves that follow it, not
after — writing it after clobbered any deletion those saves had just
recorded.

`suppressPush` is set in a `try/finally`. It had no guard, so one
malformed document threw between set and clear and latched outbound sync
off for the rest of the session, in silence.

## Consequences
- Absorbing costs one extra payload rebuild per trip per sync. Trivial
  against a network round trip, and it is the only thing standing
  between the user and silent data loss.
- The rule generalises past sync: **any** read-modify-write spanning an
  `await` in this codebase is suspect, because the user is a concurrent
  writer at all times.
- Standing rule, now four times learnt: *what you write must be derived
  from what is true at the moment you write it* — not from what was true
  when you started.

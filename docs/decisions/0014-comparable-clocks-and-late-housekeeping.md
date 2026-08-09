# ADR-0014: Comparable clocks, and housekeeping after the merge

Date: 2026-08-09 · Status: accepted

## Context
Archiving a trip on the Mac did not reach Android, and reverted on the
Mac itself after a refresh. Two independent causes, both of which let a
**stale copy out-rank a real edit** under last-write-wins:

1. **Unsynchronised clocks.** Stamps were `Date.now()` from each device.
   Two devices differ by minutes; the faster one's writes always look
   newer, so the slower device's edits are discarded — including edits
   the faster device had never seen. v1.41's Lamport anchor
   (`max(now, highest seen + 1)`) only helps once a device *has* seen
   the other's value, so it narrowed the window without closing it.

2. **Housekeeping restamping before the merge.** The push loop attached
   the account to a member row and called `saveTrips()` *before*
   uploading. That gave a stale local trip a fresh stamp, which then won
   the merge and erased whatever the other device had changed. This is
   the same shape as the delete bug fixed in v1.38: an automatic write
   outranking a deliberate one.

## Decision
**Stamp in server time.** Every write to `users/{uid}` carries a
Firestore `serverTimestamp()`. Read back on the next sync, it yields this
device's offset from the server, which `store.js` adds to `Date.now()`
for every record stamp. All devices then stamp on one timeline.

The offset is **device-local and must never sync** — shipping one
device's correction to another would double the error. An unreadable or
absurd reading (beyond a year) falls back to 0 rather than corrupting
every future stamp.

**Housekeeping runs after the merge, never before.** Claiming a member
row now happens once the trip has been reconciled with the cloud, so any
restamp it causes rides on current content and cannot erase anyone. The
Lamport anchor stays: belt and braces for the first sync, before an
offset is known.

## Consequences
- An edit made later in real time wins, whichever device made it.
- The offset needs one round trip to be learnt; until then a device uses
  its own clock plus the Lamport anchor, which is what v1.41 shipped.
- Network latency inflates the offset by the write's round trip
  (~100–500 ms). Irrelevant against the minutes of skew this addresses.
- General rule this project keeps relearning: **an automatic write must
  never out-rank a deliberate one.** Anything that mutates a record as a
  side effect of syncing has to happen after reconciliation, or be
  excluded from the change detection entirely.

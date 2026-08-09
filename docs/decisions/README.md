# Architecture decisions

One file per decision, written when it was made. Several were written
*after* the decision turned out to be wrong — those are the useful ones,
because they say what it cost.

**If you are about to change how syncing, membership or invitations
work, read 0014–0021 first.** They are largely one lesson learnt eight
times.

## The stack

| | | |
|---|---|---|
| [0001](0001-vanilla-static-stack.md) | Vanilla JS static site, not React Native | no build step, no runtime deps |
| [0002](0002-rates-api-open-er-api.md) | open.er-api.com for rates | broad coverage, no key |
| [0003](0003-node-test-runner.md) | Node's built-in test runner | no test framework either |
| [0004](0004-history-via-frankfurter.md) | Frankfurter for rate history | partial coverage accepted |
| [0007](0007-vendored-jsqr-for-ios.md) | Vendored jsQR | so the scanner exists on iOS |

## Data and storage

| | | |
|---|---|---|
| [0006](0006-receipts-in-indexeddb.md) | Receipt blobs in IndexedDB | records stay in localStorage |
| [0008](0008-sync-data-model.md) | Last-write-wins with tombstones | stamped at one choke point |
| [0009](0009-one-document-per-trip.md) | One Firestore document per trip | written in a transaction |
| [0013](0013-receipts-cloud-backing.md) | Receipts local-first, cloud backing | |

## People and access

| | | |
|---|---|---|
| [0005](0005-firebase-for-shared-trips.md) | Firebase, crossing the no-backend line | |
| [0010](0010-invite-by-email-share-by-hand.md) | Invite by email, deliver by hand | the link is the secret |
| [0011](0011-members-are-people.md) | A member is a person; an account is optional | |
| [0018](0018-push-notifications.md) | Push, and the first server-side code | push is never load-bearing |
| [0020](0020-discovery-is-a-read-not-a-query.md) | **Discovery is a document read, not a query** | a refused query cannot explain itself |
| [0021](0021-verification-gates-joining-only.md) | **Verification gates joining, and nothing else** | amends 0010 and 0020 |
| [0022](0022-removal-revokes-access.md) | **Removal revokes access; the removed device is told** | amends 0011 |

## The one lesson, learnt repeatedly

Each of these was a real bug that reached a real phone. They are the same
sentence in different clothes: **what you write must be derived from what
is true at the moment you write it — and the rule must exist in exactly
one place.**

| | | what it cost |
|---|---|---|
| [0012](0012-live-updates.md) | Live updates, with three guards | two phones bouncing a trip forever |
| [0014](0014-comparable-clocks-and-late-housekeeping.md) | Comparable clocks; housekeeping after the merge | an automatic write out-ranking a deliberate one |
| [0015](0015-ties-must-converge.md) | A tie is not a draw | five releases; archiving that never converged |
| [0016](0016-stamps-must-return-to-memory.md) | The record you upload is the record you stamped | a stamp that reached storage but not memory |
| [0017](0017-derived-fields-and-automatic-writes.md) | Derived fields don't belong on the record | an empty array making a "one-time" migration run for ever |
| [0019](0019-never-apply-a-stale-snapshot.md) | Never apply a snapshot across an await | an expense saved mid-sync, destroyed and tombstoned everywhere |

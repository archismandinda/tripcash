# Knowing what actually happens

*Design spec. Not yet built. Written 10 Aug 2026 at v1.63.0.*

Seven numbers. Without them every decision after Stage 1 of
the internal roadmap is a guess, and the two design specs beside
this one are speculation.

---

## The events

| Event | Fired when | Answers |
|---|---|---|
| `invite_sent` | an invitation is put in front of somebody — written to their invite index, or handed to the share sheet | **invites** — the `i` term, and the denominator the two below are ratios *of* |
| `link_opened` | the app loads with `?join=` | how many invitations are even tapped |
| `trip_seen` | the invitation screen renders a named trip | did the cold-open work |
| `joined` | a join write succeeds | **acceptance** — the `a` term |
| `first_expense` | a device logs its first expense on any trip | did they actually use it |
| `trip_created` | a trip is created, with `by_joiner` true if this device joined someone else's first | **conversion** — the `c` term |
| `returned` | the app opens ≥30 days after the previous open | retention, the category's real problem |

Seven, and no more. Every extra event is a thing to maintain and a
temptation to optimise something that does not matter.

It was six, and six was wrong — which is worth recording, because the
mistake was not carelessness but the same instinct that keeps the list
short. `k = invites × acceptance × conversion`. Six events measured
`joined` and `trip_created`, so acceptance and conversion were both
ratios against a denominator nobody was counting: an app that sends two
invitations and gets one join is not an app that sends two hundred and
gets one. Without the first term neither of the other two can be
computed at all, and every growth decision after this one is a guess
dressed as a number. So the seventh is not an extra event, it is the
one that makes the other six mean something.

**`invite_sent` is per person, not per press.** Three code paths put an
invitation in front of somebody, and one member can travel more than one
of them (invited automatically when the trip is saved, then the Send
button pressed to actually message them). Both are real sends; neither
is a second invitation. The dedupe list is device-local and never
synced, because `d` on the wire is a device and two devices are two rows
in the data.

Deliberately **not** once-ever, unlike `first_expense`: inviting a
second person has to be a second beacon or the numerator is capped at
one per device and the ratio means nothing.

## The constraint nobody should trade away

**A signed-out user makes zero Firebase requests.** That invariant has
been held since D3 and it is load-bearing: it is why the app opens
instantly offline and why someone who never signs in never touches
Google.

But the most important events — `link_opened`, `trip_seen` — happen
*before* anyone signs in. So analytics cannot go through the Firestore
SDK, and it must not become a reason to load it.

**Therefore: `navigator.sendBeacon` to a small HTTP Cloud Function.**

- No SDK. A few hundred bytes, fire-and-forget, non-blocking.
- Works before auth, before a service worker, offline-tolerant (the
  browser retries; if it never sends, we lose one event, not a session).
- Nothing to configure and no third party
  ([ADR-0001](../decisions/0001-vanilla-static-stack.md) forbids the
  weight; the app holds people's spending, which forbids the rest).

## What is sent

```json
{ "e": "joined", "d": "<device uuid>", "v": "v1.63.0", "t": 1786300000000 }
```

And nothing else. Specifically **never**: trip names, member names,
emails, amounts, currencies, trip ids, or a user id.

`d` is the existing device uuid (already in settings for the clock
probe). It is needed to count *people* rather than *events*, and to tell
whether a trip creator had previously joined someone else's. It is not
linked to an account anywhere.

The server records `{ event, date, count }` and the raw beacons are
discarded. Aggregate only, so there is nothing to leak and nothing to
subpoena.

## Consent

- **Off by default in the EU**, on elsewhere, with a single switch in
  Settings ("Help improve TripCash — sends counts, never your data").
- The switch must actually stop the beacons, verified by a test.
- Turning it off is not punished in any way.

## Abuse

The endpoint is unauthenticated, because it has to be. So:

- Increment-only counters. No reads, no way to query it back.
- Reject unknown event names and oversized bodies.
- Cap per device per day, server-side.

Someone determined can inflate our numbers. The consequence is that we
mislead ourselves, which is worth the cost of learning anything at all —
but it means these numbers are **directional, never contractual**.

## What this changes about the other specs

Both the internal cold-open design note and
the internal conversion design note end by saying "measure
first". This is that measurement, and it should ship **before** either of
them — otherwise we will have rebuilt the two most important screens in
the product and have no idea whether it helped.

The model in the growth plan claims acceptance is ~0.3 today and could be
~0.7. Both numbers are invented. The first thing this instrumentation
should do is tell us how wrong they are.

## Acceptance criteria

1. With analytics on, a `?join=` open sends exactly one `link_opened`.
2. With analytics off, a `?join=` open sends nothing at all — asserted by
   a test, not by inspection.
3. No beacon contains a trip name, member name, email, amount or trip id.
   Asserted by a test over the payload builder.
4. A signed-out user still makes zero Firebase SDK requests.
5. The endpoint rejects an unknown event name and an oversized body.
6. `trip_created` correctly reports `by_joiner` for a device that joined
   before it ever created.
7. Every path that sends an invitation counts one, each member counted
   once — asserted by a test that reads `js/app.js`, because a rule
   reaching one of several call sites is this project's recurring bug
   and no behavioural test has ever caught it.

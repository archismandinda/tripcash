# Turning a joiner into a creator

*Design spec. Not yet built. Written 10 Aug 2026 at v1.63.0.*

The other half of the loop. Per [`GROWTH-PLAN.md`](../GROWTH-PLAN.md),
`k = invites × acceptance × conversion`. The
[cold-open](COLD-OPEN.md) attacks *acceptance*. This attacks
*conversion* — the fraction of people who join somebody else's trip and
later create one of their own.

**Nothing in the product does this today.** A joiner uses a friend's trip
and is never given a reason, a moment or a mechanism to start their own.
Conversion is therefore whatever it is by accident.

---

## Why this term is harder than the other one

Acceptance happens in thirty seconds while somebody's attention is
already on you. Conversion happens **months later**, when they are the
one organising a trip — and by then the ordinary outcome is that they
have forgotten TripCash exists.

So it decomposes into two problems, and the second is the real one:

1. **At the moment they need it, is creating easy and obvious?**
2. **Do they still have the app, and think of it, when that moment
   comes?**

Most products attack (1) with a prompt and lose on (2). A prompt at the
wrong moment is noise, and "start your own trip!" to someone mid-holiday
on a friend's trip is exactly the wrong moment.

## The asset we already have

**The converter is a daily-use tool.** Somebody abroad opens it several
times a day with no trip at all. Splitwise has no equivalent — its app
is opened when a bill needs splitting and not otherwise.

That is the answer to problem (2), and it is already built. A joiner who
discovers the converter has a reason to keep TripCash on their phone
after the trip ends. A joiner who only ever sees the ledger does not.

**So the first intervention is not a prompt. It is making sure a joiner
finds the converter.** Today they land in someone else's ledger and may
never see the Convert tab at all.

## Candidate interventions, ranked

Ranked by expected effect per unit of work. **Do not build them all
before measuring** — see "Sequence" below.

### 1. Land a joiner on Convert, not on the ledger
When you join a trip you did not create, the converter is the tab that
demonstrates the app is useful *to you*, today, in the country you are
in. The ledger demonstrates that your friend is organised.
*Cost: small. Risk: they came for the ledger and may want it first —
measure.*

### 2. Install at the moment of value, not on arrival
The prompt to add TripCash to the home screen should fire after
something worked — the first conversion, or the first settle-up — never
on the invitation screen. An installed app survives the six months
between trips; a browser tab does not. On iOS this is also the only
route to push and to full screen.
*Cost: small. Effect: entirely on problem (2), which is the hard one.*

### 3. "Next trip with the same people" — one tap
The commonest second trip is with a subset of the same friends. Creating
one today means re-typing the trip, the currencies and every member.
Offer it from a finished trip, pre-filled, editable.
*Cost: medium. This is the lowest-friction path from joiner to creator
that exists, and the members are already there — which means the new
creator's own loop starts with invitations already addressed.*

### 4. A joiner is already a co-creator — say so
Anyone on a trip can add expenses and members
([ADR-0011](../decisions/0011-members-are-people.md)). The gap between
"I use my friend's trip" and "I could run one" is smaller than it feels
from the inside. Surfacing "+ New trip" as a genuine action for a joiner,
rather than as an empty-state button they never see once they have a
trip, is nearly free.
*Cost: trivial.*

### 5. The end-of-trip moment
When a trip settles up and closes, that is the natural moment to ask
about the next one. It is also the moment people put the app down.
*Cost: medium. Weakest of the five and easiest to get wrong — a prompt
here reads as nagging. Listed last on purpose.*

## What NOT to build

- **Emails.** No re-engagement mail. The app has already stranded a user
  behind a verification email that went to spam; email is not a channel
  we can rely on and not one we have earned.
- **Push to bring people back.** Push is for things that happened, not
  for things we want to happen. Notification permission is granted once
  and revoked for ever.
- **Gamification.** Streaks and badges on somebody's holiday spending.

## Sequence

**Measure before building past #2.** We do not know today's conversion
rate — the funnel that would tell us is specified in
[`INSTRUMENTATION.md`](INSTRUMENTATION.md) and not yet built.

1. Ship the funnel events. Learn what `c` actually is.
2. Ship #1, #2 and #4 — cheap, low-risk, and they attack the hard
   problem (do they still have the app).
3. Re-measure. If `c` has not moved, the assumption in this document is
   wrong and #3 and #5 will not save it — the honest conclusion would be
   that people simply do not organise trips often enough for this loop
   to compound, and growth must come from channels instead. That is a
   finding, not a failure, and it is far cheaper to learn here.

## Acceptance criteria (for the first three)

1. A device that joined a trip it did not create opens on Convert.
2. The install prompt does not appear on the invitation screen, and does
   appear after the first successful conversion or settle-up.
3. Dismissing the install prompt does not show it again that week.
4. "New trip" is reachable in one tap from the trip list, not only from
   the empty state.
5. Every one of the above is instrumented, or it did not happen.

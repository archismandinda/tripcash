# Getting to a million

The execution detail behind Stages 0–3 of [`ROADMAP.md`](ROADMAP.md).
That file holds the gates; this one holds the work, the arithmetic, and
the decisions we will have to make.

Written 10 Aug 2026 at v1.63.0, with one user. Every number below is an
assumption until instrumented — they are here to be *falsified*, not
believed.

---

## 1. What "a million" has to mean

Pick one, because they demand different products:

- **A million installs** — a vanity number. Reachable with one good
  Product Hunt day and a Reddit post. Means nothing.
- **A million monthly actives** — the real target. Requires solving
  retention, which for this category is the hard part (§4).

**Target: 1M MAU.** Everything below is aimed at that.

---

## 2. The arithmetic of the loop

TripCash has a property most products would pay for: **you cannot use it
alone.** A trip needs 2–6 people, and using it means pulling them in.

Let:
- `i` = people invited per trip created (naturally 3–5 — it is a trip)
- `a` = invite acceptance rate (fraction who open the link *and* join)
- `c` = fraction of joiners who later create a trip of their own

Then **k = i × a × c**, and the loop compounds when k > 1.

With `i = 4`, that needs **a × c > 0.25**.

Two plausible worlds:

| | `a` | `c` | k | |
|---|---|---|---|---|
| Today's cold-open (sign in, verify email, then see) | 0.3 | 0.2 | **0.24** | dies |
| See-the-trip-first, joiner prompted to start their own | 0.7 | 0.4 | **1.12** | compounds |

The gap between those rows is two pieces of work, and it is the whole
difference between a tool and a product:

1. **The cold-open** drives `a`. This is the single highest-leverage
   screen in the app.
2. **Nothing today drives `c`.** A joiner uses someone else's trip and
   never has a reason to create one. That is a product gap, not a
   marketing one.

**Cycle time matters as much as k.** Trips are episodic — a cycle is a
whole trip, so 1–6 months. At k = 1.1 and a 3-month cycle, growth from
1,000 seeds to 1M takes *decades*. **k must be well above 1, or the loop
is decoration and growth comes from channels.** Measure it before
believing it.

---

## 3. Instrumentation — Stage 1, not later

Without these six numbers every decision after this is a guess.

| Event | Answers |
|---|---|
| `invite_link_opened` | how many links are even tapped |
| `trip_seen` | did the cold-open work |
| `joined` | **`a`** — the acceptance rate |
| `first_expense_logged` | did they actually use it |
| `trip_created_by_joiner` | **`c`** — the loop closing |
| `returned_after_30d` | retention (§4) |

Constraints: no third-party analytics SDK (ADR-0001 forbids the weight,
and the app holds people's spending). Log counts, never contents. Anyone
must be able to switch it off, and it must be off by default in the EU.

**Do not skip this to ship a feature.** Every product that guesses its
funnel optimises the wrong thing for a year.

---

## 4. Retention is the real problem, and it is not acquisition

A trip lasts ten days. Then the app is unopened for six months. That is
fatal for MAU — and it is why this category's leaders all expanded
beyond trips.

TripCash has an asset Splitwise does not: **the converter is a
daily-use tool.** Someone abroad opens it several times a day without
any trip at all. That is the retention hook, and it is already built.

Three candidate answers, in increasing order of ambition. **Choose from
data at Stage 2, not now:**

1. **Be the travel money app.** Converter is the daily surface; splitting
   is what makes it social. Market = everyone who carries an unfamiliar
   currency. Largest addressable, weakest loop.
2. **Follow the group past the trip.** The same people also share
   dinners, rent, gifts. Splitwise's actual business. Strong retention,
   direct fight with an incumbent.
3. **Be the record.** Trips end but their ledger is a travel history —
   what a country cost you, what you spend abroad per year. Weak alone,
   strong as a reason to come back.

Named here so that whoever answers it knows the options were considered.

---

## 5. Channels, in order

Nothing here starts before its ROADMAP gate.

**Stage 1 (0 → 100).** No channels. Friends, and friends of friends,
recruited by hand. The purpose is to watch a stranger use it, not to grow.

**Stage 2 (100 → 10k).**
- **Communities where the pain is felt** — r/IndiaTravel, r/solotravel,
  r/backpacking, Indian travel Telegram groups. A post about a specific
  problem, never a launch announcement.
- **Product Hunt.** One shot; spend it once the funnel is measured, not
  before.
- **The loop itself**, which should by now be doing most of the work. If
  it isn't, the answer is §2, not more channels.

**Stage 3 (10k → 1M).**
- SEO on the thing people actually search: *"how to split expenses in
  another currency"*, *"offline currency converter"*. Slow, compounding,
  free.
- Partnerships where travellers already are — forex cards, travel
  insurers, hostel chains.
- Paid, **only** once lifetime value is known. There is currently no
  revenue, so there is currently no ceiling on acquisition cost, so paid
  is not an option yet.

---

## 6. What it costs to run — the number nobody has

Firestore charges per document read. Live listeners multiply that by
member and by device: one expense on a six-person trip with everyone
watching is **6 reads, not 1**.

A first-order model, entirely unverified:

```
assume  1M MAU, 10% daily active         =   100k DAU
        2 sessions/day, ~20 reads each   =   40 reads/DAU/day
                                         =   4M reads/day
Firestore reads ~ $0.06 / 100k           ≈   $2.40/day  ≈  $72/month
```

Cheap — **if the assumptions hold.** They may not:

- **Live listeners are the risk**, not sessions. A chatty six-person trip
  costs 6× per change, and this is exactly how the v1.58.0 sync loop
  burned a day's free quota from an *idle tab*.
- Storage grows without bound: ADR-0009 puts the whole ledger in one
  document per trip, and receipts sit in Cloud Storage.
- Push is per message and effectively free at this size.

**Action, before Stage 2 ends:** instrument reads per active trip per day
and replace this arithmetic with measurement. If the real number is 10×
this, Firestore may be the wrong store — and that is a far cheaper
decision at 10k users than at 1M.

---

## 7. What has to exist before 1M, and is missing today

Not optional at that size:

- **Privacy policy and terms.** The app holds spending and friends'
  contact details.
- **Data export and deletion.** India's DPDP Act; GDPR for any European
  user. Deletion is genuinely hard here — a trip is shared, so removing
  one person's data must not destroy four other people's ledger.
- **A support channel**, and someone to answer it. At 1M, a 0.1% contact
  rate is a thousand conversations.
- **Abuse handling.** An invitation puts attacker-chosen text on a
  stranger's screen. It will be abused the moment it is worth abusing.
- **Revenue, or a decision not to have any.** There is no plan. At 1M the
  bill is real, and "figure it out later" is how products die with users.

---

## 8. The order of work

1. Finish Sprint 1; publish rules. *(in flight)*
2. **The cold-open.** See the trip before signing in. Biggest lever on `a`.
3. Domain off `github.io`.
4. **Stage 0 gate: one real trip, real friends, real money.**
5. Instrumentation (§3) and the in-app bug report.
6. A reason for a joiner to create their own trip. Biggest lever on `c`.
7. **Stage 1 gate: 10 trips from strangers.**
8. Measure k and cost per trip. Answer §4 from data.
9. **Stage 2 gate: k > 1 sustained.**
10. Legal, support, abuse (§7). Then channels at scale.

---

## 9. Honest odds

Most products that reach a million do it because one thing worked
unreasonably well, not because a plan was executed. This document's job
is not to guarantee the outcome. It is to make sure that if the loop
does turn, nothing in the architecture, the law or the bill stops it —
and that we find out which world we are in **as cheaply as possible**.

The fastest way to learn we are wrong is Stage 1, and it costs almost
nothing. Get there.

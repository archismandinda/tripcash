# The plan

**Goal: a billion people use TripCash.** Not this year. Possibly not this
decade. The point of writing it down is that decisions made now either
keep that door open or quietly close it.

Written 10 Aug 2026, at v1.63.0, with one user.

---

## How to read this

Five stages, each with a **gate**: a condition that must be true before
the next stage starts. The gates matter more than the work. Every dead
product skipped one — most often by marketing something that wasn't
finished, to people who then never came back.

Nothing here is a schedule. A stage takes as long as its gate takes.

---

## Stage 0 — It works for six people

*Where we are.*

The app has had exactly one user, and it has failed him repeatedly:
five consecutive invitation bugs, a sync loop that burned Firestore
quota, amounts scrambled by a European keyboard, buttons that gave no
response to a tap. All fixed; none of them should have reached him.

**Work**
- Finish the current sprint and land member revocation.
- **The cold-open.** Someone taps a WhatsApp invite link having never
  heard of TripCash. Today they must sign in, then verify an email that
  lands in spam, before they see anything. This is the single most
  important screen in the product — see Stage 1 — and it is currently
  the worst.
- A real domain. `archismandinda.github.io/tripcash` reads as somebody's
  weekend project, because it is one.
- Stability: no known data-loss or access bug outstanding.

**Gate**
> One real trip. Real money, real friends, a week of use, and nobody
> quietly goes back to a WhatsApp note.

That is the whole gate. Not "tests pass" — they already do.

---

## Stage 1 — It works for strangers

*100 people, none of whom know you.*

Everything in Stage 0 was built with the owner's context in his head. A
stranger has none of it. This stage is about removing every place the
app assumes you already understand it.

**Work**
- **See before you sign in.** An invite link should show the trip — name,
  who's on it, what's been spent — before asking for anything. Signing in
  is for participating, not for looking.
- First-run for someone who arrived from a link, not from the home page.
- Every error a stranger can hit, in their language, with a next step.
  ("The database turned this down" was shipped, and was wrong as well as
  incomprehensible.)
- Privacy-respecting analytics. Not vanity metrics — the funnel:
  link opened → trip seen → joined → first expense logged. Without this
  the next stage is guesswork.
- A way to report a bug from inside the app. One tap, includes the
  version, doesn't require an email client.

**Gate**
> 10 trips created by people the owner has never met, each with more
> than one member, and an invite-acceptance rate we can actually measure.

**The metric that matters from here on: invite acceptance.** Everything
else is secondary. A trip creator who invites four people and gets one is
a product with no engine.

---

## Stage 2 — The loop compounds

*10,000 people. This is where you find out whether it's a business.*

Every trip needs 2–6 people, and using it means pulling them in. That is
a real viral loop — rare, and this product has it for free. Stage 2 is
about whether it actually turns.

**Work**
- Whatever the Stage 1 funnel says is broken. Do not guess in advance.
- Install friction, in both directions: iOS needs Add to Home Screen for
  push and for the full-screen app, and most people never do it.
- Push reliability, honestly measured. It has never been verified
  end-to-end even once.
- Whatever "invite" should become. A link in WhatsApp may not be the
  best mechanism; it is merely the first one.

**Gate**
> Each new trip creator brings in members who go on to create their own
> trips. Sustained, not once. k > 1.

**The strategic question, answered here and not before.** Splitwise —
the category leader, fifteen years old — has tens of millions of users.
A billion people do not split travel expenses. So one of these has to be
true, and Stage 2's data decides which:
- TripCash is a **travel money** app, not a splitter, and the market is
  everyone who ever carries an unfamiliar currency; or
- the splitting is the wedge and the product becomes something larger; or
- the honest ceiling is tens of millions, which is a fine outcome and a
  different plan.

Do not answer this from a whiteboard. Answer it from what users do.

---

## Stage 3 — It survives its own success

*1,000,000 people. The reckoning.*

Decisions that are correct for six friends stop being correct here.
Naming them now so none is a surprise:

- **Cost per active trip.** Firestore charges per read, and live
  listeners multiply that by device and by member. Nobody has modelled
  this. **It must be modelled before Stage 2 ends**, because the answer
  might be "Firestore is the wrong store", and that is a far cheaper
  decision at 10k than at 1M.
- **One document per trip** ([ADR-0009](decisions/0009-one-document-per-trip.md))
  has a hard 1 MB ceiling with the whole ledger inside it. Fine for a
  fortnight in Goa. Not fine for a shared household ledger running for
  years — and the tombstone growth heading for that wall had to be fixed
  in the very first sprint.
- **Legal, and not optional at this size**: a privacy policy, data
  export, data deletion, India's DPDP Act, GDPR for anyone European. The
  app holds people's spending and their friends' contact details.
- **Support.** There is currently no channel and no capacity. At 1M,
  even a 0.1% contact rate is a thousand conversations.
- **Abuse.** Invitations are a way to put text on a stranger's screen.
  That will be used badly the moment it is worth using badly.

**Gate**
> Unit economics that work at 1M without changing the product, and the
> legal obligations met before they are needed rather than after.

---

## Stage 4 — A billion

Nobody plans this stage, and any document claiming to is lying. Products
that got there did Stage 3 well and then found a distribution unlock
nobody predicted.

What is true and worth writing down:

- At this size TripCash is not a PWA maintained by one person and an
  assistant. It is an organisation, and the honest question at Stage 3's
  gate is whether that is what the owner wants.
- The decisions that will matter are being made now, in ADRs. Reversing
  the data model at 1M costs a year. That is why every non-obvious
  choice gets written down at the moment it is made — the discipline
  isn't bureaucracy, it is the only thing that makes a change at scale
  survivable.

---

## Rules for the whole journey

1. **Never market something that isn't finished.** A stranger gives you
   one try. The gates exist to stop this.
2. **The invite is the product.** More of the roadmap should go into the
   first thirty seconds after someone taps a link than into any feature.
3. **Decide from what users do, not from what we think.** Which is why
   analytics is Stage 1 work and not Stage 3 work.
4. **Write down what would be expensive to reverse, when it's decided.**
   [`decisions/`](decisions/README.md).
5. **One step at a time.** No stage starts before the one before it has
   passed its gate.

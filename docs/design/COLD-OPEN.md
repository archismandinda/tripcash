# The cold-open

*Design spec. Not yet built. Written 10 Aug 2026 at v1.63.0.*

The first thirty seconds of somebody who has never heard of TripCash and
has just tapped an invite link in WhatsApp.

It is the highest-leverage screen in the product. Per
[`GROWTH-PLAN.md`](../GROWTH-PLAN.md) the loop is
`k = invites × acceptance × conversion`, and this screen is almost the
whole of *acceptance*.

---

## What happens today

Observed on the live build at v1.63.0, `?join=<uuid>`, empty device:

1. A yellow banner: **"Not signed in — your trips stay on this device
   only."** A warning about a thing they do not have.
2. Exchange rates they did not ask for.
3. In the middle of the screen, in the largest type:
   **"No trips yet."**
4. The primary action: **"Create your first trip."**
5. A toast at the bottom: *"Sign in from Settings to open the trip
   shared with you."*

A friend told them the trip was here. The app's headline says it is not.
**The most likely reading is that the link is broken**, and the only
offered action is to start something unrelated. Then they must find
Settings, sign in, and verify an email that lands in spam — before
seeing anything at all.

Each of those is a place to give up, and they are stacked in front of
the value rather than behind it.

## The constraint that shapes everything

`firestore.rules` requires `signedIn()` for every read, and `isInvited()`
requires the caller's address to be on the trip. **An anonymous visitor
cannot be shown the trip from the database.** No UI work changes that,
and the rule is right — it is what stops trip ids being enumerated.

So: **do not read.** Put enough in the link to render the invitation.

## The design

### The link carries its own preview

The inviter's device already knows the trip name, who they are, and how
many people are on it. Encode it in the URL **fragment**:

```
https://tripcash.js.org/?join=<tripId>#p=<base64url({n,by,m,c})>
```

- `n` trip name · `by` inviter's display name · `m` member count ·
  `c` currencies
- A **fragment**, deliberately: it is never sent to a server, so the
  preview leaks nothing to hosting logs.
- Renders instantly, offline, with no auth, no read, no rules change.

**It is a claim, not a fact**, and must be treated as one. Anyone can
edit a link. So the preview is never persisted, never written to
storage, and never shown as though the app knows it — the wording is
"Archisman invited you to…", which is a report of what the link says.
Nothing can be spent, seen or joined on its strength: joining still
requires a real session, a real invitation and a real read.

If the fragment is missing or malformed, fall back to the generic
invitation screen below. Never to "No trips yet."

### What the screen says

```
        🧳  Archisman invited you to
            Goa
            4 people · INR, THB

     ┌───────────────────────────────┐
     │        Join this trip         │
     └───────────────────────────────┘

        Already have TripCash? It'll
        appear when you sign in.

     ─────────────────────────────────
     TripCash splits travel costs and
     converts currencies offline.
     [ Have a look around first ]
```

Three things, in this order of prominence:

1. **The invitation**, named and specific. Answers "did the link work?"
   before anything else can be wondered.
2. **One action.** Join. Sign-in is what *happens* when you tap it, not
   what you are asked for first.
3. **A way to look around without committing.** "Have a look around"
   drops them into the converter with no account — the app's genuinely
   useful daily surface, and a second chance if they are not ready to
   join.

What is NOT on this screen: the not-signed-in banner, the rates chip,
"No trips yet", "Create your first trip", the bell, and the scan button.
All of it is furniture for someone who already lives here.

### After they tap Join

Sign-in, and then the trip. Two rules:

- **Google first.** It is one tap and it arrives verified — and
  verification is required to join ([ADR-0021](../decisions/0021-verification-gates-joining-only.md)).
  Email/password is secondary and, if chosen, must say plainly that a
  verification mail is coming and to check spam. That has already
  stranded a real user once.
- **The trip must be the next thing they see.** Not the home screen with
  the trip somewhere in it. `pendingJoin` already survives the sign-in
  round trip; it must land on the trip, opened.

### If joining fails

Three cases, three different sentences. Never a generic error:

| | Say |
|---|---|
| Signed in with a different address | "This invite was sent to a different email. You're signed in as `<x>`." + *Ask them to add this address* (opens the share sheet, prefilled) |
| Email not yet verified | "Check your email to finish joining" + *Resend* |
| Trip deleted, or genuinely not invited | "This trip isn't available any more." No blame, no dead end — offer the converter |

The wrong-address case is already handled correctly in `syncNow`; it just
appears in the wrong place (a hint line in Settings) and at the wrong
time.

---

## Acceptance criteria

1. With a valid `?join=` and a well-formed preview fragment, the trip
   name and inviter appear **without any network request**, and the
   words "No trips yet" appear nowhere.
2. With a malformed or absent fragment, a generic invitation screen —
   never the empty home screen.
3. A tampered fragment can render only text. It cannot cause a join,
   cannot persist anything, and cannot survive a reload.
4. Tapping Join and completing Google sign-in lands on the opened trip.
5. Each of the three failure cases produces its own sentence and a next
   step.
6. "Have a look around" reaches the converter with no account, and the
   invitation is still there afterwards.
7. `pendingJoin` still survives the sign-in redirect (existing
   behaviour; must not regress).

## What this is worth

Per the growth plan's model, acceptance moving from ~0.3 to ~0.7 takes
`k` from **0.24 (dies)** to around **0.8** — still short of compounding,
which is why the *other* half of the loop matters just as much: giving a
joiner a reason to create a trip of their own. That is a separate spec.

## Not in this spec

- Where a joiner is prompted to start their own trip (the `c` term).
- Instrumentation: `invite_link_opened → trip_seen → joined` are the
  three events that will tell us whether any of this worked.

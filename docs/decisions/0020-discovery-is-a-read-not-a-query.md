# ADR-0020: Discovery is a document read, and verification gates nothing

Date: 2026-08-10 · Status: accepted

## Context
Being added to a trip failed three times in a row on a real device. Each
cause was different, each fix was correct, and each one uncovered the
next:

1. the push token was never removed on sign-out (v1.49.1);
2. finding trips shared with you required a **verified** email, and the
   app blamed the database rules instead (v1.53.0);
3. the ID token still carried `email_verified: false` for an hour after
   the user verified, because nothing forced a refresh (v1.53.1).

The owner's verdict was the right one: *"I shouldn't have to tell you
that it is failing."*

The pattern matters more than any of the three. Discovery depended on
four independent subsystems — a derived array on the trip document, a
Firestore **query** the rules had to be able to prove, a token claim
that expires on its own schedule, and a Cloud Function that could only
find you if you had already synced once. **Every one of them fails the
same way: nothing happens.** A refused query returns `permission-denied`
and no reason, so the client can only guess — and it guessed wrong twice.

## Decision
**Discovery is one read of a document addressed by the reader's own
identity:** `invites/{sha256(lowercased email)}`.

A read of your own key has no filter for the rules engine to prove, so
it cannot be refused for a reason the client cannot report. The id is a
hash, so the collection is not a directory of addresses — a key is only
computable by someone who already knows the email.

**The index is a hint, never an authority.** It hands out trip ids;
each is then fetched with the ordinary `get`, still gated by
`isInvited()`. So `allow write` on the index can be open to any signed-in
user — which it must be, since you have to be able to invite someone
whose account you cannot read — and a stranger stuffing your index gains
them nothing.

**Verification gates nothing.** `isInvitedVerified()` and the
invited-emails query are deleted. This is not a loosening: `allow get`
already permitted an unverified invitee (v1.29, deliberately), and
`joinOnly()` already let them write themselves into `memberUids`. The
gate only ever covered a convenience search, and the real secret is, and
always was, the trip id.

**One join path.** The index and the invite link now converge on the
same `fetchTripById` → `joinIfInvited` → `syncTrip`. Two paths is how
they came to differ in the first place.

**The rules and the client must normalise identically.** The rules
lowercase *and trim*; so does the client. An asymmetry here produces an
invite that exists and can never be found — caught by a test, before
shipping, which is the point of the next paragraph.

## Consequences
- An invitee discovers a trip **unverified, with no link, on first
  sync** — the commonest real case, which never worked before.
- Rules changes require one publish. The client tolerates the old rules:
  index reads and writes are caught individually and only degrade
  discovery, never sync.
- **This is tested end to end.** `npm run test:rules` runs the real
  `firestore.rules` in the Firestore emulator with throwaway accounts
  and asserts what a member, an invitee, an unverified invitee and a
  stranger can each do — 21 assertions. Every one of the three bugs
  above would have failed here first. That harness, not any individual
  fix, is the actual remedy: the reason those bugs reached a phone is
  that nothing in this area could be tested without signing in as the
  owner.

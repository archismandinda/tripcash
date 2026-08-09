# ADR-0021: Verification gates joining, and nothing else

Date: 2026-08-10 · Status: accepted · Amends ADR-0010, ADR-0020

## Context
ADR-0020 removed email verification from every path, on the reasoning
that it never guarded anything real — an unverified invitee could
already read a trip by link and write themselves into `memberUids`, so
the gate only covered a convenience search. That reasoning was right
about the search and wrong about the join.

A QA sweep proved the escalation on the emulator, in three writes:

```
▶ ESCALATION
  -> trip after impostor: {"deleted":true,"deletedAt":99,
     "memberUids":["A","IMP"],...}
  ✔ joinOnly is only the FIRST write: an unverified impostor on a
    member's address becomes a full member and then destroys the trip
```

`joinOnly()` constrains an `isInvited()` writer to changing only
`memberUids`. But the join *puts you in* `memberUids`, so from the very
next write `isMember()` is true and `allow update` grants everything.
And `invitedEmails` is derived from all members (ADR-0011), so it holds
the address of every **current** participant — not just people with an
invitation outstanding.

So: anyone who sees a forwarded invite link, and can register an
unverified account on any participant's address, could forge the ledger
or tombstone the trip for everybody. Firebase issues a token for an
unverified address quite happily.

## Decision
**Joining requires a verified email address. Reading, discovery and
being invited do not.**

Discovery stays open because that is what ADR-0020 exists to protect: a
refused *query* returns `permission-denied` with no reason attached, the
client can only guess, and it guessed wrong twice — stranding a real
user for days. That failure mode is what makes a gate unbearable, and it
is absent here.

A refused *join* is different in kind. It is a deliberate act at a known
moment, so the app can name the cause, re-mint the token first (the
claim is cached for up to an hour, which is its own trap — v1.53.1), and
file a notice that opens Settings. The user is told what to do and can
do it.

## Consequences
- An invitee must verify before opening a shared trip. That is one email
  click, and it is the only thing standing between a leaked link and
  someone deleting a trip for five people.
- The v1.29 lesson still holds where it applies: nothing about
  *discovery* depends on verification or on transactional email being
  delivered.
- Asserted in the emulator against the real rules: an unverified invitee
  can read and cannot join; a verified one joins and may then edit; the
  three-write escalation is closed.
- General rule this adds to the list: **a rule that constrains one write
  constrains only that write.** `joinOnly()` read as though it described
  a role; it described a moment. When a permission is granted by the
  very write it guards, the guard is single-use.

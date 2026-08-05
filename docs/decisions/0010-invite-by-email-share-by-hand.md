# ADR-0010: Invite by verified email; deliver via the user's own share sheet

Date: 2026-08-05 · Status: accepted

## Context
D3.4 lets someone else join a trip. Two problems hide inside that: who is
*allowed* in, and how they *hear* about it. Conflating them is what drags
projects into paid infrastructure.

Granting access needs a Firebase `uid`, but a person only knows an email
address. The obvious route — a `users` collection mapping email → uid —
requires letting any signed-in user query other people's records, which
hands out a directory of everyone's address. The other route, a Cloud
Function doing the lookup server-side, requires the paid Blaze plan.

Delivery has the same trap: sending email, SMS or WhatsApp from the app
means a server plus an email provider, or the WhatsApp Business API with
a Meta business account and per-conversation fees.

## Decision
**Access:** store the invited address on the trip (`invitedEmails`) and
let Firestore rules compare it against `request.auth.token.email` — the
address Firebase already puts in the signed-in user's token. No lookup,
no directory, no server, no cost. The invitee signs in with that address
and the trip appears; their device then adds its own uid to `memberUids`,
which the rules permit only for an address on the invite list.

The rule requires `email_verified`. Without it, anyone could register via
email/password using someone else's address and walk into their trip.
Google sign-ins arrive verified; email/password signups are sent a
verification mail (free, built into Firebase Auth).

Rules also enforce `memberUids.hasAll(previous memberUids)`, so no write
— by a member or an invitee — can evict anyone.

**Delivery:** hand the invite to `navigator.share()`, plus an explicit
`wa.me` link. Free, no server, and better than automation: the message
arrives from a person the recipient already knows, in a thread they
already trust, rather than from a service they have never heard of.

## Consequences
- Invites cost nothing and need no plan upgrade.
- The invited address must match exactly what they sign in with. A typo
  simply means nothing happens, which is safe but silent — the UI shows
  the pending invite list so it can be checked and corrected.
- Nobody can currently be removed from a trip once they've joined; the
  no-eviction rule is deliberately blunt. Revisit if it ever matters.
- Everyone on a trip sees every expense in it. That is the point, but it
  is worth stating: sharing a trip is not selective.

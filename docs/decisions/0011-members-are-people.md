# ADR-0011: A member is a person; an account is something they may have

Date: 2026-08-05 · Status: accepted

## Context
TripCash grew two parallel notions of "who is on this trip":

- **members** — names in the split (`{id, name}`), no identity;
- **invitedEmails / memberUids** — who may open the trip in the cloud.

They never met. You could invite `priya@gmail.com` and she'd get access
without being in any split, while "Priya" the member had no link to her
account. Two lists, drifting.

Worse, the current user was the hardcoded member id `"me"`, stored **in
the trip** — which now syncs. So once a trip was shared, every device
resolved `"me"` to whoever created it: the joiner saw themselves labelled
as the owner, and new expenses defaulted `paidBy: "me"`, filing their
spending under his name. Sharing was quietly producing wrong settle-ups.

## Decision
One list of people. `member = { id, name, email?, uid? }`.

- No email → a name in the split, exactly as before. The friend who will
  never install this stays a first-class participant.
- email → invited; the trip reaches their phone when they sign in.
- uid → they've opened it; `linkAccount()` attaches their account to the
  member they were invited as.

`memberUids` and `invitedEmails` are **derived** from members when
building the sync payload, so the security rules are unchanged and the
lists cannot drift from the people they describe.

**Member ids are permanent.** Expenses reference them (`paidBy`,
`split.parts`), so a member may be renamed, invited, linked or removed,
but never re-keyed. `"me"` therefore survives as a historical id — it is
simply no longer assumed to mean *the current user*. Who "you" are is now
resolved per device by `selfMemberId()`: your uid, else your email, else
(signed out) the original row.

Anyone on a trip may rename or remove anyone, per the owner's call.
Removal takes someone out of the splits; it does **not** revoke cloud
access, because the rules forbid dropping a uid — pulling a trip out from
under someone mid-trip is worse than leaving them a stale copy. Members
already named in an expense can't be removed until those are reassigned.

## Consequences
- Sharing produces correct ledgers: each device knows which member it is.
- Inviting is now a property of a person, not a separate trip-level list,
  so "add Rahul" and "give Rahul access" are one action in one place.
- Old trip-level `invitedEmails` migrate into members on first launch, so
  no pending invite loses access.
- No hard "remove someone's access" yet. Deliberate; revisit if wanted.

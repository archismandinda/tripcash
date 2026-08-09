# TripCash

A travel-money app for people splitting costs abroad: a multi-currency
converter that works with no signal, and a shared trip ledger that
settles up at the end.

**Live: https://archismandinda.github.io/tripcash/** · install it from
the browser's share menu for the full-screen, offline version.

---

## What it does

- **Convert** between the currencies of the trip you're on, offline,
  from rates cached the last time you had signal — with the exchange
  desk's markup applied so the number matches what you'll actually get.
- **Split expenses** with the people you're travelling with. Equal, by
  percentage, or by shares; anyone can be left out of any bill.
- **Settle up** at the end, in as few transfers as possible, in the
  currency you're holding as well as your own.
- **Share the trip** with the people on it. Everyone's phone stays in
  step, and it all still works on the plane.
- **Keep receipts** against the expense they belong to.

It works completely without an account. Signing in only adds syncing and
sharing; nothing is taken away if you don't.

## Running it

There is no build step. Serve the directory over HTTP and open it:

```bash
npx http-server . -p 8000 -c-1
```

Opening `index.html` from the filesystem will not work — service workers
and ES modules both need an origin.

## Tests

```bash
npm test             # 316 unit tests, no network, no browser
npm run test:rules   # the real security rules, in the Firestore emulator
```

See [`docs/TESTING.md`](docs/TESTING.md) — including the JDK trap that
will otherwise cost you twenty minutes.

## The code

Everything the browser downloads is hand-written ES modules. No
framework, no bundler, no runtime dependencies ([ADR-0001](docs/decisions/0001-vanilla-static-stack.md)).
The only server-side code is one Cloud Function that sends push
notifications, in `functions/`, which ships nothing to the client.

**Decisions live in pure modules; `js/app.js` does io only.** That split
is not cosmetic — nearly every bug this project has shipped came from a
rule written in two places and drifting apart. See
[`docs/WORKING-AGREEMENT.md`](docs/WORKING-AGREEMENT.md).

| | |
|---|---|
| `js/splits.js` | shares, balances, settle-up — all the money |
| `js/pricing.js` | what an expense is worth, and in which currency |
| `js/merge.js` `js/sync.js` `js/absorb.js` | offline-first sync: conflicts, tombstones, what a synced payload does to local state |
| `js/roster.js` `js/members.js` `js/invites.js` | people: adding, inviting, identifying, removing |
| `js/convert.js` `js/currencies.js` `js/rates.js` | conversion and rate data |
| `js/store.js` | every localStorage access, and where records get stamped |
| `js/app.js` `js/ui.js` | state, wiring and DOM. No decisions. |
| `functions/` | the push notification Cloud Function |

## Where this is going

[`docs/ROADMAP.md`](docs/ROADMAP.md) — five stages, each with a gate that
must be met before the next begins. The gates matter more than the work.

## Working on it

Read these, in this order:

1. [`docs/WORKING-AGREEMENT.md`](docs/WORKING-AGREEMENT.md) — how to work
   here and why. Every rule in it is there because breaking it cost
   something real.
2. [`PROJECT_CONTEXT.md`](PROJECT_CONTEXT.md) — the maintained state of
   the project: what's shipped, what's next, what's known-broken.
3. [`docs/decisions/`](docs/decisions/README.md) — 21 architecture
   decisions, each written at the moment it was made and kept honest
   about what it cost.

## Licence

Personal project. No licence granted; ask before reusing.

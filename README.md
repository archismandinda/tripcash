<h1 align="center">TripCash</h1>

<p align="center">
  <strong>Travel money that works with no signal.</strong><br />
  A multi-currency converter and a shared trip ledger that settles up at the end.
</p>

<p align="center">
  <a href="https://tripcash.app"><strong>tripcash.app →</strong></a>
</p>

<p align="center">
  <a href="https://github.com/archismandinda/tripcash/actions"><img alt="CI" src="https://github.com/archismandinda/tripcash/actions/workflows/ci.yml/badge.svg" /></a>
  <img alt="No dependencies" src="https://img.shields.io/badge/runtime%20deps-0-brightgreen" />
  <img alt="Tests" src="https://img.shields.io/badge/tests-700%2B%20unit%20%2B%2050%2B%20rules-blue" />
  <img alt="No build step" src="https://img.shields.io/badge/build%20step-none-informational" />
</p>

---

## What it is

You land somewhere, the signal is gone, and you need to know what a price
actually means. Later, four of you have paid for different things in two
currencies and nobody wants to do the arithmetic.

TripCash is both halves of that:

- **Convert offline.** Rates cached from the last time you had signal,
  with the exchange desk's markup applied — so the number on screen is
  what you will actually be handed, not the interbank rate.
- **Split anything.** Equal, by percentage, or by shares. Anyone can be
  left out of any bill.
- **Settle up in the fewest transfers.** Shown in the currency you are
  holding as well as your own, and it always reaches zero.
- **Share the trip.** Everyone's phone stays in step, and it keeps
  working on the plane.
- **Keep receipts** attached to the expense they belong to.

**It works completely without an account.** Signing in only adds syncing
and sharing. Nothing is taken away if you never do — and signed out, the
app makes no requests to any backend at all.

## Privacy

Seven anonymous counters, switchable off, carrying no trip names, no member
names and no amounts. No advertising, no third-party trackers, nothing
sold. Trip data is readable only by the people on that trip, enforced by
server-side rules that are in this repository and tested against a real
database emulator on every change.

The whole policy is short enough to read: **[PRIVACY.md](PRIVACY.md)**.

## Running it locally

There is no build step and nothing to install to look at the app.

```bash
npx http-server . -p 8000 -c-1
```

Opening `index.html` from the filesystem will not work — service workers
and ES modules both need a real origin.

## Tests

```bash
npm test             # 700+ unit tests. No network, no browser.
npm run test:rules   # 50+ tests against the real security rules, in the Firestore emulator
npm run preflight    # release gate — see below
```

`preflight` is the check that cannot be a test: it verifies that every
module the app imports is tracked in git and precached for offline use, that
the service-worker cache version moved past the one currently live at
tripcash.app — it fetches production to ask, and says so and falls back to a
git comparison if it cannot reach it — and that nothing personal is about
to be published. A new module is legitimately untracked for most of the day
that writes it, so this runs at the moment of release rather than on every
save — and a missing ES module is a blank page, not a degraded one.

`test:rules` needs JDK 21+ and the Firebase emulator. See
**[docs/TESTING.md](docs/TESTING.md)** — including the JDK trap that will
otherwise cost you twenty minutes.

## How it is built

Everything the browser downloads is hand-written ES modules. No
framework, no bundler, no runtime dependencies at all
([ADR-0001](docs/decisions/0001-vanilla-static-stack.md)). The only
server-side code is in `functions/`, and it ships nothing to the client.

**Decisions live in pure modules; `js/app.js` does io only.** That split
is not stylistic. Nearly every bug this project has shipped came from one
rule written in two places that drifted apart — so the rules that decide
anything live where they can be tested on their own.

| | |
|---|---|
| `js/splits.js` `js/pricing.js` | all the money: shares, balances, settle-up, what an expense is worth |
| `js/merge.js` `js/sync.js` `js/absorb.js` | offline-first sync: conflicts, tombstones, what an incoming payload does to local state |
| `js/roster.js` `js/members.js` `js/invites.js` | people: adding, inviting, identifying, removing |
| `js/convert.js` `js/currencies.js` `js/rates.js` | conversion and rate data |
| `js/ledger.js` `js/store.js` | committing records, and every localStorage access |
| `js/coldopen.js` `js/invitelink.js` `js/joining.js` `js/landing.js` | what somebody sees before they have an account |
| `js/install.js` `js/persist.js` | installing, and keeping data a browser would otherwise evict |
| `js/failure.js` `js/a11y.js` `js/desktop.js` | saying what went wrong; screen readers; mouse hazards |
| `js/app.js` `js/ui.js` | state, wiring and DOM. No decisions. |
| `functions/` | push notifications and anonymous counts |

**[docs/decisions/](docs/decisions/README.md)** — 23 architecture
decisions, each written when it was made and kept honest about what it
cost. Several of them are the same lesson learned the hard way: *what you
write must be derived from what is true at the moment you write it, and
the rule must exist in exactly one place.*

## Contributing

Bug reports — especially about two devices, going offline, or money
coming out wrong — are the most useful thing you can send.
See **[CONTRIBUTING.md](CONTRIBUTING.md)**.

Found a security issue? **[SECURITY.md](SECURITY.md)** — privately,
please.

## Licence

Source-visible, not open source. You may read and audit it; you may not
redistribute it or build on it. See **[LICENSE](LICENSE)** — and if you
want to do something it does not permit, open an issue and ask.

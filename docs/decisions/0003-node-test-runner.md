# ADR-0003: Node built-in test runner over Jest/Vitest

Date: 2026-08-05 · Status: accepted

## Context
The project may be shared, so conversion math and storage guards need an
automated suite + CI — but ADR-0001 commits to zero dependencies.

## Decision
`node --test tests/*.test.mjs` with Node's built-in `node:test` and
`node:assert`. App modules are plain ES modules that run in both browser and
Node; tests stub `globalThis.localStorage` where needed.

## Consequences
- `npm test` works with an empty node_modules; CI is a 4-line workflow.
- Note: `node --test <dir>` fails on Node 24 — the explicit file glob form is
  required and is what package.json and CI use.
- **The invocation above is not the whole command, and running it bare is not
  running this suite.** `npm test` prefixes it with `TZ=` and `LC_ALL=`/`LANG=`
  because `Intl` decides both the separators money is parsed with and the
  currency a new install opens on, so an unpinned runner answers differently on
  every machine — which held v1.76.0 green on a laptop and red on the runner.
  `tests/environment.test.mjs` fails if either half of the pin is removed or
  fails to take effect. See [docs/TESTING.md](../TESTING.md#the-unit-suite).
- Nearly all of the suite is pure logic; DOM behaviour is verified by
  driving the app before release.
- **Amended v1.75.0.** Two tests now measure the rendered screen inside
  `npm test` — the landing fold and the amount row's focus ring — because
  both defects they cover shipped past a green suite that could only read
  the source. The runner is unchanged and so is ADR-0001: the harness
  (`tests/chrome.mjs`) is a static server plus CDP over a hand-rolled
  WebSocket, no driver package. With no Chrome they skip, and
  `npm run preflight` fails rather than let a release be cut on a machine
  where nothing looked at the screen. See
  [docs/TESTING.md](../TESTING.md).

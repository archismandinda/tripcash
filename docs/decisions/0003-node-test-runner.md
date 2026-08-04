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
- Only pure logic (convert/store/rates helpers) is unit-tested; DOM behavior
  is verified manually/via browser automation before release.

# ADR-0001: Vanilla JS static site instead of React Native/Expo

Date: 2026-08-05 · Status: accepted

## Context
The usual default stack for this workspace is React Native + Expo. TripCash is
a single-screen web PWA whose hard requirements are: installable, fully
offline, deployable as plain static files to GitHub Pages, no heavy tooling.

## Decision
Plain HTML/CSS/JS with native ES modules. No framework, no bundler, no
dependencies (runtime or dev — tests use Node's built-in runner).

## Consequences
- Deploy is "push files to a branch"; nothing to build or break.
- No dependency upgrades to manage; the whole app is ~1,500 lines readable
  directly.
- Trade-off: no type checker. Mitigated by keeping logic in small pure
  modules (convert.js, store.js, rates.js) covered by unit tests.

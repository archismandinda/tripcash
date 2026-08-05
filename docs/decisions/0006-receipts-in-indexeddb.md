# ADR-0006: Receipt blobs in IndexedDB, records stay in localStorage

Date: 2026-08-05 · Status: accepted

## Context
v1.19 adds one receipt (photo or PDF) per expense. All app data so far
lives in localStorage via store.js, but localStorage is a ~5 MB string
budget for the whole origin — a single camera photo (3–10 MB, and ~33%
bigger once base64-encoded) would exhaust it. Receipts must also work
fully offline, like everything else in the app.

## Decision
Binary blobs go in IndexedDB (`tripcash-files` DB, `attachments` store,
key = expense id) through a new `js/attach.js` module; the expense record
in localStorage carries only `attachment: { name, type }`. Photos are
downscaled to ≤1600 px longest edge and re-encoded as JPEG (q 0.82)
before storing — plenty of resolution for a receipt at ~5–10% of the
bytes; files that can't be shrunk (PDFs) are capped at 8 MB. Blobs are
deleted together with their expense, and swept when a trip is deleted.

store.js remains the sole owner of localStorage; attach.js is the sole
owner of IndexedDB. One attachment per expense keeps the UI and the
lifecycle (replace = remove + add) simple.

## Consequences
- Receipts survive offline and restarts; storage stays modest (a typical
  receipt photo lands around 100–300 KB after downscale).
- IndexedDB is origin-scoped like localStorage, so the D3 Firebase sync
  will need to treat receipts separately (upload blobs, not JSON) — noted
  for that phase.
- `structuredClone`-able records only; no schema migrations needed for a
  single keyed store.

# ADR-0013: Receipts — local-first with a cloud backing copy

Date: 2026-08-06 · Status: accepted

## Context
Receipts were the one thing not protected by sync: lose the phone, lose
every receipt (ADR-0006 kept blobs in IndexedDB only). Blaze is now on,
with the bucket in us-east1 — one of the regions where the 5 GB free
allowance applies, so realistic cost is ₹0/month.

## Decision
IndexedDB stays what the UI reads; Cloud Storage holds a backing copy at
`receipts/{tripId}/{expenseId}`. The expense record — which already syncs
— carries `attachment.cloudAt`, so every device knows a cloud copy exists
and whether its local one is stale (a re-attached photo bumps `cloudAt`
and other devices re-fetch).

- **Upload**: right after saving (background, Save never waits on
  signal), and a catch-up sweep in every sync for receipts saved offline
  (`isPendingUpload`: attachment present, no cloudAt).
- **Download**: lazy, on first view, then cached back into IndexedDB —
  reads scale with receipts actually looked at, not with receipts taken.
  The 📎 marker needs only the synced metadata, so it shows everywhere
  immediately.
- **Access**: storage.rules call `firestore.get()` on the trip document
  and check the SAME `memberUids` the database rules use — one membership
  list, not two. Uploads capped at 10 MB; every other path in the bucket
  is default-deny.
- **Deletes**: best-effort, fire-and-forget. An orphaned object costs
  approximately nothing and must never block deleting an expense. A
  device absorbing a remote delete does not reach into the bucket at all.

Also fixed while building: tapping Save while a photo was still being
downscaled silently dropped the receipt. `saveExpense` now awaits any
in-flight prepare.

## Consequences
- Receipts survive a lost phone and appear on other devices on demand.
- Signed out, nothing changes: no SDK load, no requests, fully offline.
- Orphaned blobs are possible (failed deletes, remote deletes) and
  accepted; a cleanup sweep can be added if they ever matter.
- Blobs are fetched only on view, so a brand-new device shows 📎 markers
  instantly but pays for a receipt only when it's opened.

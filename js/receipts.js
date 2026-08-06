// Receipt sync (phase D3.5). Blobs go to Cloud Storage at
// receipts/{tripId}/{expenseId}; the expense record carries
// attachment.cloudAt so other devices know a copy exists and how fresh
// theirs is. Local IndexedDB stays the source the UI reads from — the
// cloud is a backing copy, fetched on demand and cached back locally.
//
// The SDK is lazy-loaded like auth/firestore: signed out, none of this
// ever runs and nothing is downloaded.

import { loadApp } from "./firebase.js";
import { FIREBASE_SDK_VERSION } from "./firebase-config.js";

const CDN = `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}`;

let ready = null;

function loadStorage() {
  ready ??= (async () => {
    const [app, m] = await Promise.all([
      loadApp(),
      import(`${CDN}/firebase-storage.js`),
    ]);
    return { storage: m.getStorage(app), m };
  })();
  return ready;
}

const pathFor = (tripId, expenseId) => `receipts/${tripId}/${expenseId}`;

// ---------- pure decisions (unit-tested) ----------

// Should this device pull the blob from the cloud?
export function needsFetch(local, meta) {
  if (!Number.isFinite(meta?.cloudAt)) return false; // nothing in the cloud
  if (!local?.blob) return true;                     // we have no copy
  return (local.cloudAt ?? 0) < meta.cloudAt;        // ours is stale
}

// Does this expense have a receipt that still needs uploading?
export const isPendingUpload = (expense) =>
  !!expense?.attachment && !Number.isFinite(expense.attachment.cloudAt);

// ---------- network ----------

export async function uploadReceipt(tripId, expenseId, rec) {
  const { storage, m } = await loadStorage();
  const ref = m.ref(storage, pathFor(tripId, expenseId));
  await m.uploadBytes(ref, rec.blob, { contentType: rec.type || "application/octet-stream" });
}

export async function downloadReceipt(tripId, expenseId) {
  const { storage, m } = await loadStorage();
  return m.getBlob(m.ref(storage, pathFor(tripId, expenseId)));
}

// Fire-and-forget cleanup. An orphaned object costs ~nothing; a failed
// delete must never block deleting the expense itself.
export async function deleteReceipt(tripId, expenseId) {
  const { storage, m } = await loadStorage();
  await m.deleteObject(m.ref(storage, pathFor(tripId, expenseId)));
}

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

// A download URL, NOT getBlob(). getBlob/getBytes require the bucket to
// be configured for CORS with a command-line tool — without it they fail
// on any device that doesn't already hold the file, which is precisely
// the device that needs to download it. A download URL needs no setup
// and can be handed straight to an <img>.
export async function receiptUrl(tripId, expenseId) {
  const { storage, m } = await loadStorage();
  return m.getDownloadURL(m.ref(storage, pathFor(tripId, expenseId)));
}

// Best-effort local cache so the receipt works offline afterwards.
// Fetching the download URL is allowed without bucket CORS config, but
// if it ever isn't, the URL still displays — so this failing costs
// nothing.
export async function cacheableBlob(url) {
  try {
    const res = await fetch(url);
    return res.ok ? await res.blob() : null;
  } catch {
    return null;
  }
}

// Storage error codes, in language worth reading.
export function storageErrorMessage(code) {
  switch (code) {
    case "storage/object-not-found":
      return "This receipt hasn't reached the cloud yet — open TripCash on the device that added it and let it sync.";
    case "storage/unauthorized":
      return "The storage rules turned this down. They may need publishing in the Firebase console.";
    case "storage/retry-limit-exceeded":
    case "storage/canceled":
      return "The connection dropped. Try again when you have better signal.";
    case "storage/quota-exceeded":
      return "Hit the storage plan's limit.";
    default:
      return "Couldn't load that receipt. Nothing is lost — try again in a moment.";
  }
}

// Fire-and-forget cleanup. An orphaned object costs ~nothing; a failed
// delete must never block deleting the expense itself.
export async function deleteReceipt(tripId, expenseId) {
  const { storage, m } = await loadStorage();
  await m.deleteObject(m.ref(storage, pathFor(tripId, expenseId)));
}

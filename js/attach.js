// Receipt / attachment blobs, one per expense, keyed by expense id.
// localStorage can't hold photos (~5 MB string budget for the whole app),
// so blobs live in IndexedDB; the expense record only carries { name, type }.

const DB_NAME = "tripcash-files";
const STORE = "attachments";

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, fn) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const t = db.transaction(STORE, mode);
      const req = fn(t.objectStore(STORE));
      t.oncomplete = () => resolve(req?.result);
      t.onabort = () => reject(t.error);
      t.onerror = () => reject(t.error);
    });
  } finally {
    db.close();
  }
}

// Value shape: { blob, name, type }
export const putAttachment = (id, rec) => withStore("readwrite", (s) => s.put(rec, id));
export const getAttachment = (id) => withStore("readonly", (s) => s.get(id)).then((r) => r ?? null);
export const deleteAttachment = (id) => withStore("readwrite", (s) => s.delete(id));
export const deleteAttachments = (ids) =>
  withStore("readwrite", (s) => { for (const id of ids) s.delete(id); });

const MAX_DIM = 1600; // longest edge after downscale — plenty for a receipt
const JPEG_Q = 0.82;
const MAX_BYTES = 8 * 1024 * 1024; // cap for files we can't shrink (PDFs etc.)

// Turn a picked file into a storable record. Photos are downscaled and
// re-encoded so a 12 MP camera shot doesn't eat the phone's storage;
// anything else is stored as-is up to MAX_BYTES. Returns null = too big.
export async function prepareAttachment(file) {
  if (file.type.startsWith("image/")) {
    try {
      const shrunk = await shrinkImage(file);
      if (shrunk) return shrunk;
    } catch {
      // Undecodable format (e.g. HEIC on some browsers) — fall through.
    }
  }
  if (file.size > MAX_BYTES) return null;
  return { blob: file, name: file.name, type: file.type };
}

async function shrinkImage(file) {
  const bmp = await createImageBitmap(file);
  const scale = Math.min(1, MAX_DIM / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bmp.width * scale));
  canvas.height = Math.max(1, Math.round(bmp.height * scale));
  canvas.getContext("2d").drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const blob = await new Promise((r) => canvas.toBlob(r, "image/jpeg", JPEG_Q));
  if (!blob) return null;
  // Re-encoding a small image can grow it — keep the original then.
  if (blob.size >= file.size && file.size <= MAX_BYTES) {
    return { blob: file, name: file.name, type: file.type };
  }
  return { blob, name: file.name.replace(/\.[^.]+$/, "") + ".jpg", type: "image/jpeg" };
}

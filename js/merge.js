// Offline-first merge semantics (phase D3). Pure functions over plain data —
// no Firebase, no DOM, no storage — so the rules that decide whose edit wins
// are unit-testable on their own.
//
// Every synced record carries { id, updatedAt }. Two devices editing while
// offline is normal here, so conflicts are resolved last-write-wins per
// RECORD (not per field): the newest updatedAt survives.
//
// Deletes need tombstones — { [id]: deletedAt } — or a delete would simply
// look like "the other side is missing a record" and get resurrected on the
// next sync.

const stampOf = (rec) => (Number.isFinite(rec?.updatedAt) ? rec.updatedAt : 0);

// Does `a` win over `b`?
//
// Stamp first, but ties MUST be broken the same way on every device or
// the two never converge: each keeps its own copy, pushes it, and the
// record flips back and forth forever. Ties are not rare — every record
// changed in a single write shares one stamp (see stampCollection), and
// two devices anchoring off the same ceiling land on the same number.
//
// The tiebreak is arbitrary but IDENTICAL everywhere: compare the record
// serialised with sorted keys. Which copy wins matters far less than
// both devices choosing the same one.
export function winsOver(a, b) {
  const sa = stampOf(a);
  const sb = stampOf(b);
  if (sa !== sb) return sa > sb;
  return stableKey(a) > stableKey(b);
}

const stableKey = (rec) => JSON.stringify(sortKeys(rec ?? {}));

// Newest deletedAt per id across both sides.
export function mergeTombstones(a = {}, b = {}) {
  const out = { ...a };
  for (const [id, ts] of Object.entries(b)) {
    if (!Number.isFinite(ts)) continue;
    if (!Number.isFinite(out[id]) || ts > out[id]) out[id] = ts;
  }
  return out;
}

// Merge one collection (trips / expenses / settlements).
//
// Ordering: trips are drag-reorderable, and that order is per-device state
// no timestamp can arbitrate. So local order is preserved and records seen
// only on the remote are appended — a trip added on another phone shows up
// at the bottom instead of shuffling this phone's list.
export function mergeCollection(local = [], remote = [], localTombs = {}, remoteTombs = {}) {
  const tombstones = mergeTombstones(localTombs, remoteTombs);
  const winner = new Map();
  for (const rec of [...local, ...remote]) {
    if (!rec?.id) continue;
    const held = winner.get(rec.id);
    if (!held || winsOver(rec, held)) winner.set(rec.id, rec);
  }
  // A delete beats an edit only when the tombstone is at least as new as the
  // surviving edit; an edit made AFTER a delete legitimately brings it back.
  // (Ties go to the delete: deterministic, and the safer way to be wrong.)
  const alive = (rec) => !(Number.isFinite(tombstones[rec.id]) && tombstones[rec.id] >= stampOf(rec));

  const order = [...local.map((r) => r?.id), ...remote.map((r) => r?.id)];
  const merged = [];
  const emitted = new Set();
  for (const id of order) {
    if (!id || emitted.has(id)) continue;
    const rec = winner.get(id);
    if (!rec || !alive(rec)) continue;
    emitted.add(id);
    merged.push(rec);
  }
  return { merged, tombstones };
}

// Tombstones can't grow forever. Anything older than the window is dropped:
// by then every device has long since seen the delete.
export const TOMBSTONE_TTL_MS = 90 * 24 * 60 * 60 * 1000; // 90 days

export function pruneTombstones(tombs = {}, now = Date.now(), ttl = TOMBSTONE_TTL_MS) {
  const out = {};
  for (const [id, ts] of Object.entries(tombs)) {
    if (Number.isFinite(ts) && now - ts < ttl) out[id] = ts;
  }
  return out;
}

// Fields that change constantly but mean nothing to another device, so they
// must not bump updatedAt and start a sync tug-of-war. `lastEdit` is the
// converter's in-progress amount — session-only since v1.21.
// `samples` is the decimal-slip guard's memory of what a normal amount
// looks like on THIS device. Two people's samples overwriting each other
// in a shared document is meaningless, and it made typing in the
// converter restamp the trip and win merges.
const LOCAL_ONLY = { trips: ["lastEdit", "samples"] };

// Did this record actually change in a way worth syncing?
export function recordChanged(before, after, collection) {
  const strip = (rec) => {
    const copy = { ...rec };
    delete copy.updatedAt;
    for (const field of LOCAL_ONLY[collection] ?? []) delete copy[field];
    return JSON.stringify(sortKeys(copy));
  };
  return strip(before) !== strip(after);
}

// Stable key order so { a, b } and { b, a } compare equal.
function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys(value[k])]));
  }
  return value;
}

// Stamp updatedAt on a collection about to be written, by diffing against
// what's currently stored, and report which ids disappeared (= deletions).
// Doing this in one place means no mutation site can forget to stamp.
export function stampCollection(previous = [], next = [], collection, now = Date.now()) {
  const before = new Map(previous.filter((r) => r?.id).map((r) => [r.id, r]));

  // Two devices never agree on the time, and "newest wins" taken
  // literally means the device with the slower clock can never win: its
  // edits are stamped OLDER than the data they replace and get thrown
  // away. That shows up as syncing that works in one direction only.
  //
  // So a new edit is stamped above everything this device has already
  // seen — including records pulled from other devices, which are in
  // `previous` by the time we get here. A Lamport clock: wall time when
  // it's ahead of history, one tick past history when it isn't.
  const seen = previous.reduce((max, rec) => Math.max(max, stampOf(rec)), 0);
  const stamp = Math.max(now, seen + 1);
  const stamped = next.map((rec) => {
    if (!rec?.id) return rec;
    const old = before.get(rec.id);
    // Records arriving from sync already carry the stamp of whoever
    // edited them. Overwriting that with "now" would make a stale remote
    // edit look like the newest one and break last-write-wins entirely.
    if (!old) return { ...rec, updatedAt: rec.updatedAt ?? stamp };
    // Unchanged content keeps its stamp — but the HIGHER of the two. A
    // record that came back from sync with a bumped stamp and identical
    // content would otherwise be knocked back down locally, so this
    // device would keep re-reading the cloud copy on every sync.
    if (!recordChanged(old, rec, collection)) {
      return { ...rec, updatedAt: Math.max(stampOf(old), stampOf(rec)) || stamp };
    }
    return { ...rec, updatedAt: stampOf(rec) > stampOf(old) ? rec.updatedAt : stamp };
  });
  const live = new Set(next.map((r) => r?.id));
  const deleted = [...before.keys()].filter((id) => !live.has(id));
  return { stamped, deleted };
}

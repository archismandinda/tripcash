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

// ---------- which trip a deletion belongs to ----------
//
// The tombstone map is one map for the whole account, but there is one
// DOCUMENT per trip, and each document used to be handed the lot. So the
// Goa document listed every expense ever deleted in Vietnam, and both
// grew in step for as long as the account was used. Firestore's 1 MB
// per-document ceiling is a wall with nothing behind it: once a trip hits
// it every push for that trip fails, permanently, and there is nothing
// the owner can do from the app.
//
// `tombstones.tripOf` is the answer — { recordId: tripId }, written in
// store.js at the moment of deletion, because the record being buried is
// the only thing that still knows where it lived.
//
// An id with no owner means "written before this existed, and the record
// that could have told us is gone". Guessing resurrects somebody's
// deleted expense, so an unknown owner keeps the old behaviour and rides
// on every trip until the 90-day prune retires it. That is a shrinking
// set, not a growing one.
export function tripTombstones(tombstones = {}, tripId) {
  const owner = asMap(tombstones.tripOf);
  const mine = (map) => {
    const out = {};
    for (const [id, ts] of Object.entries(asMap(map))) {
      const owns = owner[id];
      if (owns === undefined || owns === tripId) out[id] = ts;
    }
    return out;
  };
  return { expenses: mine(tombstones.expenses), settlements: mine(tombstones.settlements) };
}

// Filing an incoming delete under the document it arrived in is what stops a
// deletion made on another device from riding on every trip here. But a
// document is only evidence when it is that delete's OWN document, and two
// kinds of id in a payload are merely passing through:
//
//   - one we already hold. An unattributed tombstone rides on every trip's
//     payload by design, so watching it come back in trip A's document says
//     nothing about where the delete happened. Stamping it "A" mis-files it
//     permanently and — worse — stops it ever reaching the document of the
//     trip it really happened in, so a delete that had not yet reached the
//     cloud is never delivered and the record returns on every device,
//     including the one that deleted it.
//   - one whose record we still hold ALIVE in another trip. A pre-upgrade
//     document carries the whole account's map, so trip A's document can name
//     a deletion that happened in trip B; the live record is the proof, and
//     claiming it for A would resurrect it in B.
//
// Refusing to guess leaves the id unattributed, which is the safe state: it
// keeps riding until the record's own trip claims it or the 90-day prune
// retires it. Anything else is new, and arrived here because it belongs here.
export function attributeArrivals({ ids = [], tripId, tombstones = {}, elsewhere = [] }) {
  const held = new Set([
    ...Object.keys(asMap(tombstones.expenses)),
    ...Object.keys(asMap(tombstones.settlements)),
  ]);
  const live = new Set(elsewhere.map((rec) => rec?.id).filter(Boolean));
  const out = {};
  for (const id of ids) {
    if (held.has(id) || live.has(id)) continue;
    out[id] = tripId;
  }
  return out;
}

// Attribution for a tombstone that no longer exists is dead weight, and
// dead weight that only ever grows is the bug this feature is fixing.
export function pruneAttribution(tripOf = {}, tombstones = {}) {
  const known = new Set([
    ...Object.keys(asMap(tombstones.expenses)),
    ...Object.keys(asMap(tombstones.settlements)),
  ]);
  const out = {};
  for (const [id, tripId] of Object.entries(asMap(tripOf))) {
    if (known.has(id)) out[id] = tripId;
  }
  return out;
}

const asMap = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});

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
//
// `tombs` is this collection's tombstone map as it stands BEFORE the write
// — see the revive pass at the bottom for why the write needs to see the
// graves it is about to empty.
export function stampCollection(previous = [], next = [], collection, now = Date.now(), tombs = {}) {
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
  // A record present in this write is ALIVE, so a tombstone still naming
  // it is being revoked — an Undo, or an edit that committed while the
  // other phone's delete was landing. The caller clears the tombstone it
  // holds, but that is only half the job: the SAME tombstone is in the
  // cloud document and in every other device's map, and `alive()` buries
  // anything stamped at or below it. Nothing above knows that number —
  // the record is absent from `previous`, so neither wall time nor the
  // Lamport anchor has ever seen it, and the delete was stamped on the
  // deleting device's clock, which can be minutes ahead of this one. So
  // the revive was silently undone by the very next sync, after the user
  // had watched the row save. Climbing one tick past the grave is what
  // makes "an expense I saw confirmed never disappears" hold end to end.
  const revived = stamped.map((rec) => {
    const grave = tombs?.[rec?.id];
    if (!Number.isFinite(grave) || stampOf(rec) > grave) return rec;
    return { ...rec, updatedAt: grave + 1 };
  });

  const live = new Set(next.map((r) => r?.id));
  const deleted = [...before.keys()].filter((id) => !live.has(id));
  return { stamped: revived, deleted };
}

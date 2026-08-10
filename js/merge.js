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
//
// That applies to all THREE collections. It used to be written here as
// though it were general and applied only to expenses and settlements: the
// members list rode inside the trip record as one all-or-nothing field, so
// an absent member row carried no evidence of anything and "removed" and
// "not heard about yet" were the same bytes. Both readings were taken, in
// opposite directions, and after ADR-0022 made access derive from the
// roster a merge accident became an access-control accident. Members are
// now a collection like the others (ADR-0024), with one difference spelled
// out at `finalDeletes` below.

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
//
// `finalDeletes` turns off revive-on-later-edit for this collection. See
// the comment on `alive` below for why the roster needs it and an expense
// must not have it.
export function mergeCollection(local = [], remote = [], localTombs = {}, remoteTombs = {},
  { finalDeletes = false } = {}) {
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
  //
  // …unless the delete is FINAL, which is what a removed member gets. The
  // revive rule assumes a later edit came from a PERSON, and for an expense
  // it did. Member rows are rewritten by housekeeping nobody asked for:
  // linkAccount and applyProfile both restamp somebody's row as a side
  // effect of syncing, and that is precisely how trip deletion came back
  // from the dead twice before v1.38 made it final. A removal that any
  // co-member's background sync can undo is not a removal.
  //
  // Nothing can be left pointing at a finally-dead id, which is what makes
  // this safe rather than merely blunt: planAddMember mints a fresh
  // crypto.randomUUID() for a re-added person, so they come back as a new
  // row rather than colliding with the grave, and removability() refuses to
  // remove anybody who appears in an expense or a settlement, so no live
  // record can reference one. The grave itself is retired at the 90-day TTL
  // like every other.
  const alive = (rec) => {
    const grave = tombstones[rec.id];
    if (!Number.isFinite(grave)) return true;
    return finalDeletes ? false : grave < stampOf(rec);
  };

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

// The roster, merged like any other collection — with one allowance for
// the rows that already exist.
//
// Every member row on every device today has no `updatedAt`, and a service
// worker reaches a phone on its SECOND open, so an old build's roster has
// to merge against a new one's for at least one launch. An old build has
// exactly one way of saying "I edited somebody's name": it restamps the
// TRIP record. So a row with no stamp of its own is judged by the record it
// rides on, which is the only evidence there is about when it was last
// written, and is the same number on both devices.
//
// Used for the COMPARISON only. Writing the inherited stamp onto the row
// would make every legacy trip look changed on the first sync after the
// upgrade and restamp the lot — ADR-0017, and the reason the rows come back
// out as the objects they went in as.
//
// Note what this does NOT do: it never decides PRESENCE. A row missing from
// one side is news, not a removal, and a grave is final (see mergeCollection).
export function mergeRoster(localTrip = {}, remoteTrip = {}, localTombs = {}, remoteTombs = {}) {
  const origin = new Map();
  const dated = (trip) => (trip?.members ?? []).map((m) => {
    if (!m || Number.isFinite(m.updatedAt)) return m;
    const judged = { ...m, updatedAt: stampOf(trip) };
    origin.set(judged, m);
    return judged;
  });
  const out = mergeCollection(
    dated(localTrip), dated(remoteTrip), localTombs, remoteTombs, { finalDeletes: true });
  return { merged: out.merged.map((m) => origin.get(m) ?? m), tombstones: out.tombstones };
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
  return {
    expenses: mine(tombstones.expenses),
    settlements: mine(tombstones.settlements),
    // Member graves need none of the machinery above. A member exists
    // inside exactly one trip document, so the map is keyed by trip from
    // the moment it is written — attribution is inherent, there is nothing
    // to guess, and no trip's document can carry another trip's roster
    // history. That is the 1 MB ceiling problem, solved by the shape.
    members: asMap(asMap(tombstones.members)[tripId]),
  };
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

// The same job for the roster: stamp the member rows that actually changed
// and bury the ones that left, by diffing the trips about to be written
// against the trips currently stored.
//
// It is a diff and not a call at the removal site for the reason ADR-0008
// exists. js/app.js mutates trip.members in five places — the trip
// editor's reconcile, two removals in the member sheet, applyProfile and
// linkAccount — and the site that forgets is the site that ships. There is
// nothing here for a sixth site to forget.
//
// Returns { trips, tombstones, changed }, where `tombstones` is the whole
// { [tripId]: { [memberId]: removedAt } } map and `changed` says whether it
// moved (a caller that writes it unconditionally would restamp nothing,
// but would spend a storage write per keystroke).
export function stampRoster(previous = [], next = [], now = Date.now(), tombs = {},
  ttl = TOMBSTONE_TTL_MS) {
  const before = new Map(previous.filter((t) => t?.id).map((t) => [t.id, t]));
  const graves = { ...asMap(tombs) };
  let changed = false;

  const trips = next.map((trip) => {
    if (!trip?.id || !Array.isArray(trip.members)) return trip;
    const held = new Map((Array.isArray(before.get(trip.id)?.members)
      ? before.get(trip.id).members : []).filter((m) => m?.id).map((m) => [m.id, m]));
    // The Lamport anchor records already get, per trip: wall time when it
    // is ahead of everything this device has seen, one tick past history
    // when it is not. A device with a slow clock must still be able to win.
    const seen = [...held.values()].reduce((max, m) => Math.max(max, stampOf(m)), 0);
    const stamp = Math.max(now, seen + 1);

    let touched = false;
    const members = trip.members.map((m) => {
      if (!m?.id) return m;
      const was = held.get(m.id);
      // A row this device has not stored before: keep the stamp it
      // arrived with (it is whoever wrote it, and overwriting that makes a
      // stale edit look like the newest one), or give it today's if it has
      // none — a row somebody just typed, or one from an older build.
      if (!was) {
        if (Number.isFinite(m.updatedAt)) return m;
        touched = true;
        return { ...m, updatedAt: stamp };
      }
      // Unchanged rows are returned EXACTLY as they came, including with
      // no updatedAt at all. Every trip in existence today has unstamped
      // rows, and stamping them on the first save after the upgrade would
      // change every trip record on this device and hand it a win over a
      // genuine edit made on the other phone — ADR-0014/0017, the failure
      // this project keeps relearning. An unstamped row reads as 0:
      // oldest possible, and never deleted without a grave.
      if (!recordChanged(was, m, "members")) return m;
      touched = true;
      return { ...m, updatedAt: stampOf(m) > stampOf(was) ? m.updatedAt : stamp };
    });

    const live = new Set(trip.members.map((m) => m?.id));
    const gone = [...held.keys()].filter((id) => !live.has(id));
    if (gone.length) {
      const mine = { ...asMap(graves[trip.id]) };
      // One tick past the row being buried, never raw wall time: a row
      // last written by a phone whose clock runs ahead would otherwise be
      // undeletable — the grave loses the merge and the person returns.
      // And never below a grave we already hold, which is how a removal
      // that arrived from another device keeps ITS timestamp.
      for (const id of gone) {
        mine[id] = Math.max(now, stampOf(held.get(id)) + 1, Number(mine[id]) || 0);
      }
      graves[trip.id] = mine;
      changed = true;
    }
    return touched ? { ...trip, members } : trip;
  });

  if (!changed) return { trips, tombstones: asMap(tombs), changed: false };

  // MEMBER GRAVES ARE NEVER PRUNED. Decided by the owner, 10 Aug 2026.
  //
  // They inherited the 90-day TTL from expenses by accident rather than by
  // decision, and the TTL is solving a problem members do not have. An
  // expense grave is one of potentially hundreds per trip, so retiring them
  // matters. A member grave is one id and one timestamp: measured, two
  // hundred removals in a trip's entire life cost 5.4 KB, half a percent of
  // Firestore's document limit. Real trips remove one or two people, ever.
  //
  // What the TTL bought in exchange for those bytes: remove somebody in
  // January, and a co-member's tablet that stays shut until May syncs its
  // stale member list with nothing left to contradict it. The removed
  // person returns — row, uid, read and write access, notifications — and
  // nobody is told. "Removed until somebody's iPad wakes up" is not a
  // property you can explain to the person who did the removing.
  //
  // A genuine re-add is unaffected and this was checked rather than assumed:
  // planAddMember (js/roster.js) mints a fresh crypto.randomUUID() for the
  // new row, so the old grave names an id nobody carries any more.
  return { trips, tombstones: asMap(graves), changed: true };
}

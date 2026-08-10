import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeCollection, mergeTombstones, pruneTombstones, pruneAttribution,
  tripTombstones, recordChanged,
  stampCollection, TOMBSTONE_TTL_MS } from "../js/merge.js";

const rec = (id, updatedAt, extra = {}) => ({ id, updatedAt, ...extra });
const ids = (list) => list.map((r) => r.id);
const byId = (list) => [...list].sort((a, b) => (a.id < b.id ? -1 : 1));

// ---------- last-write-wins ----------

test("the newer edit of a record wins", () => {
  const local = [rec("t1", 100, { name: "Bali" })];
  const remote = [rec("t1", 200, { name: "Bali 2026" })];
  const { merged } = mergeCollection(local, remote);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].name, "Bali 2026");
});

test("an older remote edit never clobbers a newer local one", () => {
  const local = [rec("t1", 900, { name: "mine" })];
  const remote = [rec("t1", 100, { name: "theirs" })];
  assert.equal(mergeCollection(local, remote).merged[0].name, "mine");
});

test("records with no updatedAt are treated as oldest", () => {
  const local = [{ id: "t1", name: "legacy" }];
  const remote = [rec("t1", 1, { name: "stamped" })];
  assert.equal(mergeCollection(local, remote).merged[0].name, "stamped");
});

test("records missing an id are skipped, not crashed on", () => {
  const { merged } = mergeCollection([{ name: "no id" }, rec("t1", 5)], [null, undefined]);
  assert.deepEqual(ids(merged), ["t1"]);
});

// ---------- ordering ----------

test("local drag-order survives a merge; remote-only records append", () => {
  const local = [rec("c", 10), rec("a", 10), rec("b", 10)]; // user's chosen order
  const remote = [rec("a", 5), rec("z", 5), rec("b", 5)];
  assert.deepEqual(ids(mergeCollection(local, remote).merged), ["c", "a", "b", "z"]);
});

// ---------- deletes ----------

test("a delete propagates instead of the record resurrecting", () => {
  const local = [rec("e1", 100)];
  const remote = [];
  const { merged } = mergeCollection(local, remote, {}, { e1: 200 });
  assert.deepEqual(merged, []);
});

test("without tombstones a delete would silently undo itself", () => {
  // Same shapes as above, minus the tombstone — proves the tombstone is
  // what does the work, not the empty remote.
  const { merged } = mergeCollection([rec("e1", 100)], []);
  assert.deepEqual(ids(merged), ["e1"]);
});

test("an edit made after a delete brings the record back", () => {
  const { merged } = mergeCollection([rec("e1", 300, { name: "revived" })], [], {}, { e1: 200 });
  assert.equal(merged.length, 1);
  assert.equal(merged[0].name, "revived");
});

test("a simultaneous delete and edit resolves to the delete", () => {
  const { merged } = mergeCollection([rec("e1", 200)], [], {}, { e1: 200 });
  assert.deepEqual(merged, []);
});

test("tombstones merge to the newest deletedAt and ride along in the result", () => {
  assert.deepEqual(mergeTombstones({ a: 5, b: 9 }, { a: 7, c: 1 }), { a: 7, b: 9, c: 1 });
  const { tombstones } = mergeCollection([], [], { x: 1 }, { y: 2 });
  assert.deepEqual(tombstones, { x: 1, y: 2 });
});

test("tombstones older than the TTL are pruned, recent ones kept", () => {
  const now = 1_000_000_000_000;
  const tombs = { old: now - TOMBSTONE_TTL_MS - 1, fresh: now - 1000, bad: NaN };
  assert.deepEqual(pruneTombstones(tombs, now), { fresh: now - 1000 });
});

// ---------- convergence ----------

test("both phones reach the same set no matter who syncs first", () => {
  // Two devices edit the same trip offline, each adds one expense, and one
  // deletes a third. Merging in either direction must agree.
  const phoneA = [rec("e1", 300, { name: "A wins" }), rec("e2", 100)];
  const phoneB = [rec("e1", 200, { name: "B loses" }), rec("e3", 100)];
  const tombsA = { e9: 500 };
  const tombsB = {};
  const ab = mergeCollection(phoneA, phoneB, tombsA, tombsB);
  const ba = mergeCollection(phoneB, phoneA, tombsB, tombsA);
  assert.deepEqual(byId(ab.merged), byId(ba.merged));
  assert.deepEqual(ab.tombstones, ba.tombstones);
  assert.deepEqual(ids(byId(ab.merged)), ["e1", "e2", "e3"]);
  assert.equal(ab.merged.find((r) => r.id === "e1").name, "A wins");
});

test("merging twice changes nothing the second time", () => {
  const local = [rec("a", 10), rec("b", 20)];
  const remote = [rec("b", 30), rec("c", 5)];
  const once = mergeCollection(local, remote);
  const twice = mergeCollection(once.merged, remote, once.tombstones);
  assert.deepEqual(twice.merged, once.merged);
});

// ---------- change detection + stamping ----------

test("a real edit counts as a change; key order alone does not", () => {
  assert.ok(recordChanged({ id: "t1", name: "a" }, { id: "t1", name: "b" }, "trips"));
  assert.ok(!recordChanged({ id: "t1", name: "a", x: 1 }, { x: 1, id: "t1", name: "a" }, "trips"));
  // updatedAt itself must never count, or every write would loop forever
  assert.ok(!recordChanged({ id: "t1", updatedAt: 1 }, { id: "t1", updatedAt: 999 }, "trips"));
});

test("typing in the converter does not mark a trip as changed", () => {
  // lastEdit churns on every keystroke and means nothing to another device.
  const before = { id: "t1", name: "Bali", lastEdit: null };
  const after = { id: "t1", name: "Bali", lastEdit: { code: "IDR", amount: 450000 } };
  assert.ok(!recordChanged(before, after, "trips"));
  const { stamped } = stampCollection([{ ...before, updatedAt: 50 }], [after], "trips", 999);
  assert.equal(stamped[0].updatedAt, 50, "stamp must not move");
});

test("stamping: new records stamped, edited records restamped, quiet ones left alone", () => {
  const previous = [
    { id: "a", name: "keep", updatedAt: 10 },
    { id: "b", name: "edit me", updatedAt: 10 },
  ];
  const next = [
    { id: "a", name: "keep", updatedAt: 10 },
    { id: "b", name: "edited", updatedAt: 10 },
    { id: "c", name: "brand new" },
  ];
  const { stamped, deleted } = stampCollection(previous, next, "expenses", 500);
  assert.equal(stamped.find((r) => r.id === "a").updatedAt, 10);
  assert.equal(stamped.find((r) => r.id === "b").updatedAt, 500);
  assert.equal(stamped.find((r) => r.id === "c").updatedAt, 500);
  assert.deepEqual(deleted, []);
});

test("stamping backfills records saved before sync existed", () => {
  const { stamped } = stampCollection([{ id: "a", name: "legacy" }], [{ id: "a", name: "legacy" }], "trips", 700);
  assert.equal(stamped[0].updatedAt, 700);
});

test("stamping reports which ids disappeared, so deletes become tombstones", () => {
  const previous = [{ id: "a", updatedAt: 1 }, { id: "b", updatedAt: 1 }];
  const { stamped, deleted } = stampCollection(previous, [{ id: "a", updatedAt: 1 }], "expenses", 500);
  assert.deepEqual(deleted, ["b"]);
  assert.deepEqual(ids(stamped), ["a"]);
});

// ---------- stamping must not corrupt records arriving from sync ----------

test("a record pulled from another device keeps ITS timestamp, not ours", () => {
  // Overwriting this with "now" would make a stale remote edit look like
  // the newest one, quietly inverting last-write-wins.
  const { stamped } = stampCollection([], [rec("e1", 100, { name: "from phone B" })], "expenses", 999);
  assert.equal(stamped[0].updatedAt, 100);
});

test("a newer incoming version keeps its own stamp; a local edit gets a fresh one", () => {
  const previous = [rec("e1", 100, { name: "old" })];
  // arriving from sync: already stamped later than what we hold
  const pulled = stampCollection(previous, [rec("e1", 300, { name: "newer" })], "expenses", 999);
  assert.equal(pulled.stamped[0].updatedAt, 300, "trust the sync stamp");
  // edited locally: same stamp as stored, different content → restamp now
  const edited = stampCollection(previous, [rec("e1", 100, { name: "typed here" })], "expenses", 999);
  assert.equal(edited.stamped[0].updatedAt, 999, "local edits stamp now");
});

test("a locally created record with no stamp still gets one", () => {
  const { stamped } = stampCollection([], [{ id: "new", name: "just made" }], "expenses", 555);
  assert.equal(stamped[0].updatedAt, 555);
});

// ---------- clocks on two devices are never in step ----------

test("a fresh edit outranks what it replaces even on a slow clock", () => {
  // Two phones never agree on the time. With plain last-write-wins, the
  // device whose clock is behind can NEVER win: its edits are stamped
  // older than the data they're replacing and get silently discarded —
  // so one direction of syncing works and the other never does.
  const seen = [rec("t1", 5_000_000, { name: "from the fast device" })];
  const edited = [rec("t1", 5_000_000, { name: "edited on the slow device" })];
  const { stamped } = stampCollection(seen, edited, "trips", 1_000_000); // clock is behind
  assert.ok(stamped[0].updatedAt > 5_000_000,
    "a new edit must beat everything already seen, whatever the clock says");
});

test("a normal clock still produces ordinary wall-clock stamps", () => {
  const { stamped } = stampCollection([rec("t1", 10)], [rec("t1", 10, { name: "x" })], "trips", 900);
  assert.equal(stamped[0].updatedAt, 900, "no inflation when the clock is ahead of history");
});

test("the anchor comes from history, not from the record being written", () => {
  // A record arriving from sync carries its own stamp and must keep it.
  const { stamped } = stampCollection([], [rec("new", 7_000_000)], "expenses", 1000);
  assert.equal(stamped[0].updatedAt, 7_000_000);
});

// ---------- a record written back over its own grave ----------

test("a revived record is stamped above the tombstone that buried it", () => {
  // A record present in a write is ALIVE — but "alive" only travels if its
  // stamp outranks the tombstone, and that tombstone was written on
  // another device whose clock can be minutes ahead of this one. The
  // record is absent from `previous`, so neither wall time nor the Lamport
  // anchor knows anything about the grave it is climbing out of.
  const grave = 9_000_000;
  const { stamped } = stampCollection([], [rec("e1", 100, { name: "back" })],
    "expenses", 1000, { e1: grave });
  assert.ok(stamped[0].updatedAt > grave,
    "or the very next merge buries it again, silently");
});

test("a record with no tombstone is stamped exactly as before", () => {
  const { stamped } = stampCollection([rec("e1", 100)], [rec("e1", 100, { name: "x" })],
    "expenses", 900, { e2: 9_000_000 });
  assert.equal(stamped[0].updatedAt, 900, "somebody else's grave is not ours");
});

// ---------- ties must converge ----------

test("two devices with the SAME stamp agree on one winner", () => {
  // Real data from two devices in the field: every trip carried the identical
  // updatedAt, because the Lamport anchor gives every record changed in
  // one write the same stamp — and both devices anchor off the same
  // ceiling. With a strict "newer wins", a tie means each device keeps
  // its OWN copy, pushes it, and they never converge: archived on one,
  // unarchived on the other, forever.
  const mac = [rec("t1", 500, { name: "trip", archived: true })];
  const android = [rec("t1", 500, { name: "trip", archived: false })];
  const fromMac = mergeCollection(mac, android).merged[0];
  const fromAndroid = mergeCollection(android, mac).merged[0];
  assert.deepEqual(fromMac, fromAndroid, "both sides must pick the same record");
});

test("a real difference in stamps still decides it", () => {
  const older = [rec("t1", 100, { name: "old" })];
  const newer = [rec("t1", 900, { name: "new" })];
  assert.equal(mergeCollection(older, newer).merged[0].name, "new");
  assert.equal(mergeCollection(newer, older).merged[0].name, "new");
});

test("identical records tie harmlessly", () => {
  const a = [rec("t1", 500, { name: "same" })];
  const b = [rec("t1", 500, { name: "same" })];
  assert.deepEqual(mergeCollection(a, b).merged, mergeCollection(b, a).merged);
});

test("a stamp bumped elsewhere isn't knocked back down locally", () => {
  // Same content, higher stamp from the cloud: keep the higher one, or
  // this device re-adopts the cloud copy on every single sync.
  const { stamped } = stampCollection([rec("t1", 500, { name: "x" })], [rec("t1", 900, { name: "x" })], "trips", 100);
  assert.equal(stamped[0].updatedAt, 900);
});

// ---------- a deletion belongs to one trip (TC-3) ----------

test("a trip only sees the deletions that happened in it", () => {
  const tombs = {
    expenses: { a1: 10, b1: 20 },
    settlements: { a2: 30, b2: 40 },
    tripOf: { a1: "A", b1: "B", a2: "A", b2: "B" },
  };
  assert.deepEqual(tripTombstones(tombs, "A"), { expenses: { a1: 10 }, settlements: { a2: 30 } });
  assert.deepEqual(tripTombstones(tombs, "B"), { expenses: { b1: 20 }, settlements: { b2: 40 } });
  assert.deepEqual(tripTombstones(tombs, "C"), { expenses: {}, settlements: {} });
});

test("a deletion nobody attributed still applies everywhere", () => {
  // Every tombstone written before this feature existed is unattributed,
  // and the record that could have said which trip it was in is gone.
  // Guessing wrong resurrects an expense somebody deleted, so an unknown
  // owner keeps the old behaviour — it rides on every trip until the
  // 90-day prune retires it.
  const legacy = { expenses: { old: 10 }, settlements: {} };
  assert.deepEqual(tripTombstones(legacy, "A").expenses, { old: 10 });
  assert.deepEqual(tripTombstones(legacy, "B").expenses, { old: 10 });
  assert.deepEqual(tripTombstones({}, "A"), { expenses: {}, settlements: {} });
});

test("attribution is dropped with the tombstone it describes", () => {
  // Otherwise the index outlives every entry in it and becomes the new
  // thing that grows without bound.
  const kept = pruneAttribution(
    { a1: "A", gone: "B" },
    { expenses: { a1: 10 }, settlements: {} }
  );
  assert.deepEqual(kept, { a1: "A" });
});

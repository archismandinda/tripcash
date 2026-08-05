import { test } from "node:test";
import assert from "node:assert/strict";
import { mergeCollection, mergeTombstones, pruneTombstones, recordChanged,
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

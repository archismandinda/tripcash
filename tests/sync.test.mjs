import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPayload, mergePayload, payloadChanged, applyPayload, SCHEMA } from "../js/sync.js";

const trip = (over = {}) => ({ id: "t1", name: "Bali", currencies: ["IDR"], updatedAt: 100, ...over });
const exp = (id, updatedAt, over = {}) => ({ id, tripId: "t1", name: id, homeValue: 100, updatedAt, ...over });
const pay = (over = {}) => ({
  schema: SCHEMA, trip: trip(), memberUids: ["u1"], ownerUid: "u1",
  expenses: [], settlements: [], tombstones: { expenses: {}, settlements: {} }, ...over,
});
const ids = (list) => list.map((r) => r.id).sort();

// ---------- building what we upload ----------

test("the converter's in-progress amount never leaves the device", () => {
  const p = buildPayload({
    trip: trip({ lastEdit: { code: "IDR", amount: 450000 } }),
    expenses: [], settlements: [], tombstones: {}, uid: "u1",
  });
  assert.equal(p.trip.lastEdit, undefined);
  assert.equal(p.trip.name, "Bali");
});

test("signing in puts you on the trip's access list", () => {
  const p = buildPayload({ trip: trip(), expenses: [], settlements: [], tombstones: {}, uid: "u1" });
  assert.deepEqual(p.memberUids, ["u1"]);
  assert.equal(p.ownerUid, "u1");
  // and doesn't duplicate you on the next run
  const again = buildPayload({ trip: { ...trip(), memberUids: ["u1"] }, expenses: [], settlements: [], tombstones: {}, uid: "u1" });
  assert.deepEqual(again.memberUids, ["u1"]);
});

// ---------- merging against the server ----------

test("a trip the server has never seen uploads as-is", () => {
  const local = pay({ expenses: [exp("e1", 5)] });
  const merged = mergePayload(local, null);
  assert.deepEqual(ids(merged.expenses), ["e1"]);
});

test("the newer version of the trip's own details wins", () => {
  const local = pay({ trip: trip({ name: "Bali", updatedAt: 100 }) });
  const remote = pay({ trip: trip({ name: "Bali 2026", updatedAt: 200 }) });
  assert.equal(mergePayload(local, remote).trip.name, "Bali 2026");
  assert.equal(mergePayload(remote, local).trip.name, "Bali 2026");
});

test("expenses added on two phones both survive", () => {
  const local = pay({ expenses: [exp("mine", 10)] });
  const remote = pay({ expenses: [exp("theirs", 20)] });
  assert.deepEqual(ids(mergePayload(local, remote).expenses), ["mine", "theirs"]);
});

test("an expense deleted on one phone does not come back from the server", () => {
  const local = pay({ expenses: [], tombstones: { expenses: { e1: 500 }, settlements: {} } });
  const remote = pay({ expenses: [exp("e1", 100)] });
  const merged = mergePayload(local, remote);
  assert.deepEqual(merged.expenses, []);
  assert.equal(merged.tombstones.expenses.e1, 500, "the tombstone rides along for other devices");
});

test("an expense edited after a delete is genuinely restored", () => {
  const local = pay({ expenses: [], tombstones: { expenses: { e1: 100 }, settlements: {} } });
  const remote = pay({ expenses: [exp("e1", 300, { name: "revived" })] });
  const merged = mergePayload(local, remote);
  assert.equal(merged.expenses.length, 1);
  assert.equal(merged.expenses[0].name, "revived");
});

test("settlements merge on the same rules as expenses", () => {
  const local = pay({ settlements: [{ id: "s1", updatedAt: 10, amount: 500 }] });
  const remote = pay({ settlements: [{ id: "s1", updatedAt: 90, amount: 900 }, { id: "s2", updatedAt: 5 }] });
  const merged = mergePayload(local, remote);
  assert.equal(merged.settlements.find((s) => s.id === "s1").amount, 900);
  assert.deepEqual(ids(merged.settlements), ["s1", "s2"]);
});

test("access lists only ever grow — nobody is silently evicted", () => {
  const local = pay({ memberUids: ["u1"] });
  const remote = pay({ memberUids: ["u1", "u2"] });
  assert.deepEqual(mergePayload(local, remote).memberUids.sort(), ["u1", "u2"]);
  // even when it's the local side that knows about the newcomer
  assert.deepEqual(mergePayload(remote, local).memberUids.sort(), ["u1", "u2"]);
});

test("both phones converge on the same trip regardless of who syncs first", () => {
  const a = pay({ trip: trip({ name: "A", updatedAt: 300 }), expenses: [exp("e1", 300, { name: "A wins" }), exp("e2", 10)] });
  const b = pay({ trip: trip({ name: "B", updatedAt: 200 }), expenses: [exp("e1", 200, { name: "B loses" }), exp("e3", 10)] });
  const ab = mergePayload(a, b);
  const ba = mergePayload(b, a);
  assert.deepEqual(ids(ab.expenses), ids(ba.expenses));
  assert.equal(ab.trip.name, ba.trip.name);
  assert.equal(ab.expenses.find((e) => e.id === "e1").name, "A wins");
});

// ---------- avoiding pointless writes ----------

test("an unchanged trip costs no write", () => {
  const remote = pay({ expenses: [exp("e1", 5)] });
  const merged = mergePayload(pay({ expenses: [exp("e1", 5)] }), remote);
  assert.equal(payloadChanged(merged, remote), false);
});

test("any real difference does earn a write", () => {
  const remote = pay({ expenses: [exp("e1", 5)] });
  assert.equal(payloadChanged(mergePayload(pay({ expenses: [exp("e1", 5), exp("e2", 9)] }), remote), remote), true);
  assert.equal(payloadChanged(pay(), null), true, "first upload always writes");
});

// ---------- folding the result back into local storage ----------

test("merged data replaces this trip's records and leaves other trips alone", () => {
  const merged = mergePayload(pay({ expenses: [exp("e1", 5)] }), null);
  const out = applyPayload({
    merged, tripId: "t1",
    trips: [trip(), { id: "t2", name: "Prague" }],
    expenses: [exp("old", 1), { id: "other", tripId: "t2", updatedAt: 1 }],
    settlements: [{ id: "s-other", tripId: "t2", updatedAt: 1 }],
    tombstones: {},
  });
  assert.deepEqual(ids(out.expenses), ["e1", "other"], "t1 replaced, t2 untouched");
  assert.deepEqual(ids(out.settlements), ["s-other"]);
  assert.equal(out.trips.length, 2);
});

test("a trip shared from another device appears locally", () => {
  const merged = mergePayload(pay({ trip: trip({ id: "t9", name: "Shared" }) }), null);
  const out = applyPayload({
    merged, tripId: "t9", trips: [], expenses: [], settlements: [], tombstones: {},
  });
  assert.equal(out.trips.length, 1);
  assert.equal(out.trips[0].id, "t9");
  assert.equal(out.trips[0].name, "Shared");
});

test("syncing doesn't wipe the amount you're mid-way through typing", () => {
  const merged = mergePayload(pay(), null);
  const out = applyPayload({
    merged, tripId: "t1",
    trips: [trip({ lastEdit: { code: "IDR", amount: 450000 } })],
    expenses: [], settlements: [], tombstones: {},
  });
  assert.deepEqual(out.trips[0].lastEdit, { code: "IDR", amount: 450000 });
});

test("incoming records are stamped with the trip they belong to", () => {
  const merged = mergePayload(pay({ expenses: [{ id: "e1", updatedAt: 5 }] }), null);
  const out = applyPayload({ merged, tripId: "t1", trips: [trip()], expenses: [], settlements: [], tombstones: {} });
  assert.equal(out.expenses[0].tripId, "t1");
});

test("tombstones from the server are kept locally so the delete sticks here too", () => {
  const merged = mergePayload(
    pay(),
    pay({ expenses: [], tombstones: { expenses: { gone: 900 }, settlements: {} } })
  );
  const out = applyPayload({ merged, tripId: "t1", trips: [trip()], expenses: [], settlements: [], tombstones: { expenses: { older: 1 } } });
  assert.equal(out.tombstones.expenses.gone, 900);
  assert.equal(out.tombstones.expenses.older, 1, "existing tombstones survive");
});

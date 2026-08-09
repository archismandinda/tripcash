// The orchestration that folds a synced payload into local state.
//
// Written BEFORE the logic moved out of app.js, to pin what it does
// today rather than what a refactor happens to leave behind. Every case
// here is a bug that actually shipped and reached a real phone.
import { test } from "node:test";
import assert from "node:assert/strict";
import { absorbPayload } from "../js/absorb.js";
import { buildPayload, mergePayload, applyPayload } from "../js/sync.js";

const ACCOUNT = { uid: "A", email: "archi@x.com" };

const trip = (over = {}) => ({
  id: "t1", name: "Goa", currencies: ["INR"], updatedAt: 100,
  members: [{ id: "me", name: "Archi", uid: "A" }, { id: "bo", name: "Bo" }],
  ...over,
});
const exp = (id, updatedAt, over = {}) => ({
  id, tripId: "t1", name: id, amount: 10, code: "INR", homeValue: 100,
  paidBy: "bo", split: { mode: "equal", parts: { me: 1, bo: 1 } },
  createdAt: 1, updatedAt, ...over,
});

// The state this device holds, and what absorbing does to it.
const absorb = (merged, state) => absorbPayload({
  merged, tripId: "t1", account: ACCOUNT,
  trips: state.trips ?? [trip()],
  expenses: state.expenses ?? [],
  settlements: state.settlements ?? [],
  tombstones: state.tombstones ?? {},
  money: () => "",
  buildPayload, mergePayload, applyPayload,
});

const payloadOf = (state) => buildPayload({
  trip: state.trips[0], expenses: state.expenses ?? [],
  settlements: state.settlements ?? [], tombstones: state.tombstones ?? {}, uid: "A",
});

test("an expense saved during the round trip is not destroyed", () => {
  // ADR-0019. syncNow applied the payload it had SENT over whatever the
  // user had done since; the next write then tombstoned the missing
  // record as a deletion and propagated that to every device.
  const sent = payloadOf({ trips: [trip()], expenses: [exp("e1", 100)] });
  const returned = mergePayload(sent, null);          // what the server gave back

  const now = { trips: [trip()], expenses: [exp("e1", 100), exp("e2", 500)] };
  const out = absorb(returned, now);

  assert.deepEqual(out.expenses.map((e) => e.id).sort(), ["e1", "e2"]);
});

test("an edit made during the round trip wins on its stamp", () => {
  const sent = payloadOf({ trips: [trip()], expenses: [exp("e1", 100, { name: "Lunch" })] });
  const returned = mergePayload(sent, null);
  const out = absorb(returned, { trips: [trip()], expenses: [exp("e1", 900, { name: "Lunch with Bo" })] });
  assert.equal(out.expenses[0].name, "Lunch with Bo");
});

test("a delete made during the round trip stays deleted", () => {
  const sent = payloadOf({ trips: [trip()], expenses: [exp("e1", 100)] });
  const returned = mergePayload(sent, null);
  const out = absorb(returned, {
    trips: [trip()], expenses: [],
    tombstones: { expenses: { e1: 500 }, settlements: {} },
  });
  assert.deepEqual(out.expenses, []);
});

test("the tombstone map comes back for the caller to write FIRST", () => {
  // Writing it after the saves clobbered any deletion those saves had
  // just recorded. The order is part of the contract, so it is returned
  // rather than performed.
  const out = absorb(mergePayload(payloadOf({ trips: [trip()], expenses: [] }), null), {
    trips: [trip()], expenses: [], tombstones: { expenses: { gone: 42 }, settlements: {} },
  });
  assert.equal(out.tombstones.expenses.gone, 42, "an existing tombstone must survive");
});

test("receipts orphaned by a remote delete are reported for sweeping", () => {
  // deleteAttachment only ever ran for deletes made HERE, so a photo
  // deleted on another phone stayed in IndexedDB for ever.
  const withShot = exp("e1", 100, { attachment: { name: "bill.jpg" } });
  const remote = { ...payloadOf({ trips: [trip()], expenses: [] }),
    tombstones: { expenses: { e1: 900 }, settlements: {} } };
  const out = absorb(remote, { trips: [trip()], expenses: [withShot] });
  assert.deepEqual(out.expenses, []);
  assert.deepEqual(out.orphanedReceipts, ["e1"]);
});

test("a receipt whose expense survives is NOT swept", () => {
  const withShot = exp("e1", 100, { attachment: { name: "bill.jpg" } });
  const out = absorb(mergePayload(payloadOf({ trips: [trip()], expenses: [withShot] }), null),
    { trips: [trip()], expenses: [withShot] });
  assert.deepEqual(out.orphanedReceipts, []);
});

test("a trip we have never seen announces itself, exactly once", () => {
  const shared = { ...payloadOf({ trips: [trip({ name: "Manali" })], expenses: [] }) };
  const first = absorbPayload({
    merged: shared, tripId: "t1", account: ACCOUNT,
    trips: [], expenses: [], settlements: [], tombstones: {},
    money: () => "", buildPayload, mergePayload, applyPayload,
  });
  assert.deepEqual(first.arrival, { id: "t1", name: "Manali" });

  // Second time round we hold it, so it is no longer news.
  const again = absorb(shared, { trips: first.trips, expenses: [] });
  assert.equal(again.arrival, null);
});

test("someone else's expense becomes a notice; your own does not", () => {
  const before = { trips: [trip()], expenses: [] };
  const remote = payloadOf({ trips: [trip()], expenses: [exp("e1", 500, { paidBy: "bo" })] });
  assert.equal(absorb(remote, before).notices.length, 1);

  const mineOnly = payloadOf({ trips: [trip()], expenses: [exp("e2", 500, { paidBy: "me" })] });
  assert.deepEqual(absorb(mineOnly, before).notices, []);
});

test("a deleted trip short-circuits everything", () => {
  const out = absorb({ schema: 1, deleted: true, deletedAt: 900, memberUids: ["A"] },
    { trips: [trip()], expenses: [exp("e1", 100)] });
  assert.deepEqual(out, { deleted: true });
});

test("absorbing twice changes nothing the second time", () => {
  const remote = payloadOf({ trips: [trip()], expenses: [exp("e1", 500)] });
  const once = absorb(remote, { trips: [trip()], expenses: [] });
  const twice = absorb(remote, { trips: once.trips, expenses: once.expenses,
    settlements: once.settlements, tombstones: once.tombstones });
  assert.deepEqual(twice.expenses, once.expenses);
  assert.deepEqual(twice.notices, [], "and says nothing the second time");
  assert.equal(twice.arrival, null);
});

test("nothing is mutated in place — the caller decides when to commit", () => {
  const state = { trips: [trip()], expenses: [exp("e1", 100)] };
  const snapshot = JSON.parse(JSON.stringify(state));
  absorb(mergePayload(payloadOf(state), null), state);
  assert.deepEqual(state, snapshot);
});

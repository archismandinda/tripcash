import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Minimal localStorage stub so store.js runs under Node.
const backing = new Map();
globalThis.localStorage = {
  getItem: (k) => (backing.has(k) ? backing.get(k) : null),
  setItem: (k, v) => backing.set(k, String(v)),
  removeItem: (k) => backing.delete(k),
};

const store = await import("../js/store.js");

beforeEach(() => backing.clear());

test("settings default sensibly when nothing is stored", () => {
  assert.equal(store.getSettings().homeCurrency, "INR");
  assert.equal(store.getSettings().activeTripId, null);
});

test("corrupt JSON never breaks reads", () => {
  backing.set("tripcash:settings", "{not json!!");
  backing.set("tripcash:trips", "[[[[");
  backing.set("tripcash:rates", "garbage");
  assert.equal(store.getSettings().homeCurrency, "INR");
  assert.deepEqual(store.getTrips(), []);
  assert.equal(store.getRates(), null);
});

test("settings patch merges with existing values", () => {
  store.setSettings({ homeCurrency: "USD" });
  store.setSettings({ activeTripId: "abc" });
  const s = store.getSettings();
  assert.equal(s.homeCurrency, "USD");
  assert.equal(s.activeTripId, "abc");
});

test("malformed trip records are filtered out", () => {
  backing.set(
    "tripcash:trips",
    JSON.stringify([
      { id: "1", name: "Good", currencies: ["EUR"] },
      { id: 42, name: "Bad id" },
      null,
      "nope",
    ])
  );
  const trips = store.getTrips();
  assert.equal(trips.length, 1);
  assert.equal(trips[0].name, "Good");
});

test("non-array trips value falls back to empty list", () => {
  backing.set("tripcash:trips", JSON.stringify({ oops: true }));
  assert.deepEqual(store.getTrips(), []);
});

test("rates round-trip and reject malformed payloads", () => {
  const payload = { base: "USD", fetchedAt: 1700000000000, rates: { EUR: 0.9 } };
  store.setRates(payload);
  assert.deepEqual(store.getRates(), payload);
  backing.set("tripcash:rates", JSON.stringify({ base: "USD" })); // missing fields
  assert.equal(store.getRates(), null);
});

// ---------- sync bookkeeping (phase D3) ----------

test("saving stamps updatedAt only on records that really changed", () => {
  const trip = (over = {}) => ({ id: "t1", name: "Bali", currencies: ["IDR"], ...over });
  store.setTrips([trip()]);
  const first = store.getTrips()[0].updatedAt;
  assert.ok(Number.isFinite(first), "new record is stamped");

  store.setTrips([trip()]); // identical save (e.g. an unrelated re-render)
  assert.equal(store.getTrips()[0].updatedAt, first, "quiet save must not restamp");

  store.setTrips([trip({ name: "Bali 2026" })]);
  assert.ok(store.getTrips()[0].updatedAt >= first, "a real edit restamps");
});

test("converter keystrokes never restamp the trip", () => {
  const trip = { id: "t1", name: "Bali", currencies: ["IDR"] };
  store.setTrips([trip]);
  const before = store.getTrips()[0].updatedAt;
  store.setTrips([{ ...trip, lastEdit: { code: "IDR", amount: 450000 } }]);
  assert.equal(store.getTrips()[0].updatedAt, before);
});

test("deleting a record leaves a tombstone so the delete can sync", () => {
  store.setExpenses([
    { id: "e1", tripId: "t1", name: "Lunch", amount: 1, homeValue: 1, paidBy: "me", split: { parts: {} } },
    { id: "e2", tripId: "t1", name: "Taxi", amount: 1, homeValue: 1, paidBy: "me", split: { parts: {} } },
  ]);
  assert.deepEqual(store.getTombstones(), {}, "nothing deleted yet");
  store.setExpenses([
    { id: "e1", tripId: "t1", name: "Lunch", amount: 1, homeValue: 1, paidBy: "me", split: { parts: {} } },
  ]);
  assert.ok(Number.isFinite(store.getTombstones().expenses?.e2), "e2 is tombstoned");
  assert.equal(store.getTombstones().expenses?.e1, undefined, "surviving record is not");
});

test("tombstones are namespaced per collection", () => {
  store.setTrips([{ id: "t1", name: "A", currencies: ["INR"] }]);
  store.setSettlements([{ id: "s1", tripId: "t1", from: "me", to: "a", amount: 5, createdAt: 1 }]);
  store.setTrips([]);
  store.setSettlements([]);
  const tombs = store.getTombstones();
  assert.ok(Number.isFinite(tombs.trips?.t1));
  assert.ok(Number.isFinite(tombs.settlements?.s1));
});

test("a corrupt tombstone blob falls back to empty", () => {
  backing.set("tripcash:tombstones", "[not an object");
  assert.deepEqual(store.getTombstones(), {});
  backing.set("tripcash:tombstones", "[1,2,3]");
  assert.deepEqual(store.getTombstones(), {});
});

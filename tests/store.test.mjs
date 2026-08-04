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

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
const { mergeCollection } = await import("../js/merge.js");

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

// ---------- stamps have to come back to the caller ----------

test("saving hands back the stamped records", () => {
  // The upload is built from what the app holds in MEMORY. If the stamp
  // only ever lands in localStorage, an edited trip is pushed carrying
  // its pre-edit stamp, ties with the cloud copy it should replace, and
  // loses — archiving a trip undid itself seconds later (ADR-0016).
  const stamped = store.setTrips([{ id: "t1", name: "Bali", currencies: ["IDR"] }]);
  assert.ok(Number.isFinite(stamped[0].updatedAt), "setTrips must return stamps");

  const edited = store.setTrips([{ ...stamped[0], archived: true }]);
  assert.ok(edited[0].updatedAt > stamped[0].updatedAt, "an edit must stamp higher");
  assert.equal(store.getTrips()[0].updatedAt, edited[0].updatedAt, "memory and storage agree");
});

test("expenses and settlements hand back stamps too", () => {
  const e = store.setExpenses([{ id: "e1", tripId: "t1", name: "Lunch", amount: 1,
    homeValue: 1, paidBy: "m1", split: { parts: {} } }]);
  assert.ok(Number.isFinite(e[0].updatedAt));
  const s = store.setSettlements([{ id: "s1", tripId: "t1", from: "m1", to: "m2",
    amount: 5, createdAt: 1 }]);
  assert.ok(Number.isFinite(s[0].updatedAt));
});

test("archiving survives the round trip to the cloud", () => {
  // The whole sequence, as the app runs it: load into memory, edit in
  // memory, persist, then build the upload FROM MEMORY and merge it
  // against the copy already in the cloud (which still has the old
  // stamp). Before the stamps came back into memory, the upload tied
  // with the cloud copy and the archive was silently undone.
  store.setTrips([{ id: "t1", name: "testmac", currencies: ["IDR"] }]);
  const cloud = store.getTrips()[0];

  const memory = store.getTrips();            // a fresh page load
  memory[0].archived = true;                  // user archives
  const stamped = store.setTrips(memory);
  for (const t of memory) t.updatedAt = stamped.find((s) => s.id === t.id).updatedAt;

  const winner = mergeCollection([memory[0]], [cloud]).merged[0];
  assert.equal(winner.archived, true, "the archive must outrank the cloud's stale copy");
});

// ---------- deletes, and undoing them ----------

test("undoing a delete clears the tombstone, so it stays undone", () => {
  const pay1 = { id: "p1", tripId: "t1", from: "m1", to: "m2", amount: 500, createdAt: 1 };
  const kept = store.setSettlements([pay1])[0];

  store.setSettlements([]);                       // user deletes it
  assert.ok(store.getTombstones().settlements?.p1, "the delete must be able to travel");

  store.setSettlements([kept]);                   // user taps Undo
  assert.equal(store.getTombstones().settlements?.p1, undefined,
    "a record present in the write is alive and cannot also be deleted");

  // Without the clear, this merge silently re-deleted it: the restored
  // record keeps its original stamp and the tombstone outranks it.
  const { merged } = mergeCollection(store.getSettlements(), [],
    store.getTombstones().settlements ?? {}, {});
  assert.deepEqual(merged.map((r) => r.id), ["p1"]);
});

test("a tombstone outranks the record it buries, whatever this clock says", () => {
  // A record stamped ahead of us — a fast phone, or a clock offset not
  // learnt yet — used to be undeletable: the delete lost the merge and
  // the record came straight back.
  const future = Date.now() + 10 * 60_000;
  backing.set("tripcash:expenses", JSON.stringify([{ id: "e1", tripId: "t1", name: "Lunch",
    amount: 1, homeValue: 1, paidBy: "m1", split: { parts: {} }, updatedAt: future }]));
  const buried = store.getExpenses()[0];
  store.setExpenses([]);
  assert.ok(store.getTombstones().expenses.e1 > future, "must outrank what it buries");
  assert.deepEqual(mergeCollection([buried], [], store.getTombstones().expenses, {}).merged, []);
});

test("a record the validator rejects is not mistaken for a deletion", () => {
  // One partially written record used to delete itself for everybody.
  backing.set("tripcash:expenses", JSON.stringify([
    { id: "good", tripId: "t1", name: "Lunch", amount: 1, homeValue: 1,
      paidBy: "m1", split: { parts: {} } },
    { id: "broken", tripId: "t1", name: "Dinner", amount: 2, homeValue: null,
      paidBy: "m1", split: { parts: {} } },
  ]));
  const readable = store.getExpenses();
  assert.deepEqual(readable.map((e) => e.id), ["good"], "still filtered from rendering");

  store.setExpenses(readable);
  assert.equal(store.getTombstones().expenses?.broken, undefined, "but NOT deleted");
  assert.equal(JSON.parse(backing.get("tripcash:expenses")).length, 2, "and still stored");
});

// ---------- preferences share the records' clock ----------

test("preferences stamp in server time, like every other record", () => {
  // On raw Date.now() a device with a slow clock could never change the
  // home currency: its edit stamped older than the copy it replaced.
  store.setSettings({ clockOffset: 240_000 });
  const before = Date.now();
  const after = store.setSettings({ homeCurrency: "USD" });
  assert.ok(after.prefsUpdatedAt >= before + 240_000, "the offset must be applied");
});

test("a stamp the caller supplies is not overwritten", () => {
  // Absorbing the other device's preferences passes their stamp through
  // on purpose. Overwriting it made this device the newest writer, so it
  // pushed them straight back.
  store.setSettings({ homeCurrency: "INR" });
  const out = store.setSettings({ homeCurrency: "JPY", prefsUpdatedAt: 1234 });
  assert.equal(out.prefsUpdatedAt, 1234);
});

test("a storage failure is reported, not swallowed", () => {
  // Safari Private Browsing throws on every setItem. The row rendered,
  // the stamp came back, and a day of expenses vanished with the tab.
  const good = globalThis.localStorage.setItem;
  let told = 0;
  store.setStorageFailureHandler(() => told++);
  globalThis.localStorage.setItem = () => { throw new Error("QuotaExceededError"); };
  try {
    store.setSettings({ homeCurrency: "USD" });
    assert.equal(told, 1, "the user has to be told");
    store.setSettings({ homeCurrency: "EUR" });
    assert.equal(told, 1, "but once per run of failures, not per keystroke");
  } finally {
    globalThis.localStorage.setItem = good;
    store.setStorageFailureHandler(null);
  }
});

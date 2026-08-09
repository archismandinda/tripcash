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

test("a revived record outranks the tombstone the cloud still holds", () => {
  // TC-1 AC2, the whole chain. The other phone's delete lands mid-save:
  // absorb writes its tombstone here and drops the record, then 1.5 s
  // later Save commits and commitExpense puts the record back. Locally
  // that looks right — the write clears the tombstone and the row is on
  // screen. But the CLOUD document still carries the other phone's
  // tombstone, stamped on ITS clock, and nothing raised the revived
  // record above it: with that phone minutes ahead, the very next sync
  // buried the expense again, with no toast, after the user had watched
  // it save.
  const lunch = { id: "e1", tripId: "t1", name: "Lunch", amount: 1, homeValue: 1,
    paidBy: "m1", split: { parts: {} } };
  const held = store.setExpenses([lunch])[0];

  const cloudDeletedAt = Date.now() + 5 * 60_000; // their clock, five minutes fast
  store.setTombstones({ expenses: { e1: cloudDeletedAt } }); // absorb: tombstones first
  store.setExpenses([]);                                     // …then the merged list
  assert.ok(store.getTombstones().expenses.e1 >= cloudDeletedAt,
    "recording our own delete must not lower a tombstone we already hold");

  const revived = store.setExpenses([{ ...held, name: "Lunch (edited)", amount: 2 }])[0];
  assert.equal(store.getTombstones().expenses?.e1, undefined, "alive on this device");

  // The push: what we hold, merged against the cloud copy that still has it buried.
  const { merged } = mergeCollection([revived], [],
    store.getTombstones().expenses ?? {}, { e1: cloudDeletedAt });
  assert.deepEqual(merged.map((r) => r.id), ["e1"],
    "an expense the user saw confirmed must not vanish at the next sync");
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

// ---------- a deletion belongs to one trip, and ages out (TC-3) ----------

const { tripTombstones, TOMBSTONE_TTL_MS } = await import("../js/merge.js");
const { buildPayload } = await import("../js/sync.js");

const spend = (id, tripId) => ({ id, tripId, name: id, amount: 1, homeValue: 1,
  paidBy: "m1", split: { parts: {} } });

test("a deleted record remembers which trip it belonged to", () => {
  // The record being buried is the ONLY thing that still knows. Read it
  // at delete time or the answer is gone for good — which is why the
  // whole map used to be uploaded to every trip.
  store.setExpenses([spend("e1", "t1"), spend("e2", "t2")]);
  store.setExpenses([spend("e1", "t1")]);
  const tombs = store.getTombstones();
  assert.equal(tombs.tripOf?.e2, "t2");
  assert.deepEqual(Object.keys(tripTombstones(tombs, "t1").expenses), []);
  assert.deepEqual(Object.keys(tripTombstones(tombs, "t2").expenses), ["e2"]);
});

test("undoing a delete forgets the attribution too", () => {
  const kept = store.setSettlements([{ id: "p1", tripId: "t7", from: "m1", to: "m2",
    amount: 5, createdAt: 1 }])[0];
  store.setSettlements([]);
  assert.equal(store.getTombstones().tripOf?.p1, "t7");
  store.setSettlements([kept]);
  assert.equal(store.getTombstones().tripOf?.p1, undefined,
    "a live record must leave nothing behind pointing at its grave");
});

test("500 deletions over 200 days leave one trip carrying only its own, recent ones", () => {
  // The failure this closes: the map only ever grew, on every trip at
  // once, and Firestore's 1 MB document ceiling has nothing behind it —
  // once a trip hits it, every push for that trip fails for ever.
  const DAY = 24 * 60 * 60 * 1000;
  const TRIPS = ["A", "B", "C"];
  const DAYS_AGO = [200, 150, 120, 100, 60, 30, 10, 1]; // well clear of the 90-day line
  const expected = [];

  for (let i = 0; i < 500; i++) {
    const daysAgo = DAYS_AGO[Math.floor((i * DAYS_AGO.length) / 500)];
    const tripId = TRIPS[i % 3];
    // clockOffset is what writeSynced stamps by, so shifting it walks the
    // whole delete path — stamp, tombstone and prune — through real time.
    store.setSettings({ clockOffset: -daysAgo * DAY });
    store.setExpenses([spend(`e${i}`, tripId)]);
    store.setExpenses([]);
    if (tripId === "A" && daysAgo * DAY < TOMBSTONE_TTL_MS) expected.push(`e${i}`);
  }

  const payload = buildPayload({
    trip: { id: "A", name: "Goa", currencies: ["INR"] },
    expenses: [], settlements: [], tombstones: store.getTombstones(), uid: "u1",
  });
  assert.deepEqual(Object.keys(payload.tombstones.expenses).sort(), expected.sort());
  assert.ok(expected.length > 0 && expected.length < 500 / 3, "and it really is a subset");
});

test("an old flat tombstone map still buries, on every trip, and restamps nothing", () => {
  // The shape on disk today is { expenses: { id: deletedAt } } with no
  // owner. Losing those would resurrect deletes; restamping the trips to
  // migrate them is ADR-0014/0017's exact failure — merely launching the
  // app would out-rank a real edit made on the other phone.
  const buried = Date.now() - 60_000;
  backing.set("tripcash:tombstones",
    JSON.stringify({ expenses: { legacy: buried }, settlements: {} }));
  backing.set("tripcash:trips", JSON.stringify([
    { id: "A", name: "Goa", currencies: ["INR"], updatedAt: 100 },
    { id: "B", name: "Hanoi", currencies: ["VND"], updatedAt: 100 },
  ]));

  const held = store.getTrips();
  const stamped = store.setTrips(held); // the app starts and saves
  assert.deepEqual(stamped.map((t) => t.updatedAt), [100, 100], "a launch must not restamp");

  const tombs = store.getTombstones();
  for (const id of ["A", "B"]) {
    const p = buildPayload({ trip: held.find((t) => t.id === id),
      expenses: [], settlements: [], tombstones: tombs, uid: "u1" });
    assert.equal(p.tombstones.expenses.legacy, buried,
      "an unattributed delete has to keep travelling everywhere");
  }
  assert.deepEqual(
    mergeCollection([{ id: "legacy", tripId: "A", updatedAt: buried - 1 }], [],
      tripTombstones(tombs, "A").expenses, {}).merged,
    [], "and it still buries the record it was written for");
});

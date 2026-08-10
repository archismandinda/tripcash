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
const { initialHomeCurrency } = await import("../js/insights.js");
const { SYNCED_SETTINGS, pickSynced } = await import("../js/prefs.js");

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

// ---------- the money a first launch opens in ----------
//
// The default was INR for every new install on earth, and nothing
// derived anything from the device. Deriving it is easy; the whole
// difficulty is doing it EXACTLY ONCE, on a device that has never held
// this app, without ever out-ranking a choice somebody actually made.

test("the raw settings record can tell 'chose INR' from 'never chose'", () => {
  // getSettings() cannot: it merges the defaults in, so both come back
  // as INR. Deriving off that reading would re-base the home currency of
  // every long-standing user who never opened Settings.
  assert.equal(store.storedSettings(), null, "nothing stored is not the same as the defaults");
  assert.equal(store.getSettings().homeCurrency, "INR");

  backing.set("tripcash:settings", JSON.stringify({ theme: "dark" }));
  assert.deepEqual(store.storedSettings(), { theme: "dark" }, "no defaults merged in");
  assert.equal(store.getSettings().homeCurrency, "INR", "…while getSettings() still says INR");
});

test("a genuinely new install opens in the money of the device's country", () => {
  // Exactly what boot() does, composed the same way: read the device's
  // two signals, work out a currency, offer it to storage.
  store.seedHomeCurrency(initialHomeCurrency({ locale: "pt-BR" }));
  assert.equal(store.getSettings().homeCurrency, "BRL");
});

test("an existing user's settle-up currency is never re-based under them", () => {
  // Silently re-basing somebody's home currency is a worse bug than the
  // one this fixes: every home value in a shared ledger is snapshotted
  // against it.
  backing.set("tripcash:settings", JSON.stringify({ theme: "dark" }));
  store.seedHomeCurrency("BRL");
  assert.equal(store.getSettings().homeCurrency, "INR",
    "a record with no homeCurrency key at all is still somebody who has been here");

  backing.clear();
  backing.set("tripcash:settings", JSON.stringify({ homeCurrency: "USD" }));
  store.seedHomeCurrency("BRL");
  assert.equal(store.getSettings().homeCurrency, "USD");

  // A device restored from a backup that kept its trips but not its
  // settings has still been here — its trips' home values prove it.
  backing.clear();
  backing.set("tripcash:trips", JSON.stringify([{ id: "t1", name: "Goa", currencies: ["INR"] }]));
  store.seedHomeCurrency("BRL");
  assert.equal(store.getSettings().homeCurrency, "INR");
});

test("the derived home currency loses to a real choice made elsewhere", () => {
  // ADR-0017: an automatic write must never out-rank a deliberate one.
  // The stamp is what decides that, so the derived write supplies
  // prefsUpdatedAt itself and setSettings leaves it alone. Without the
  // explicit field syncedChanged() is true, this device stamps NOW, and
  // a phone that merely launched in Brazil would push BRL over the home
  // currency the person actually chose on their laptop.
  store.seedHomeCurrency(initialHomeCurrency({ locale: "pt-BR" }));
  assert.equal(store.getSettings().homeCurrency, "BRL");
  assert.ok(!store.getSettings().prefsUpdatedAt,
    `the derivation stamped ${store.getSettings().prefsUpdatedAt}`);

  // The trap, stated: the same write without the field does stamp.
  store.setSettings({ homeCurrency: "EUR" });
  assert.ok(store.getSettings().prefsUpdatedAt > 0, "a deliberate change still stamps");
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

// ---------- has this device ever held a trip? (TC5-2) ----------
//
// The pitch a stranger is shown (js/landing.js) must never reach somebody
// who has used the app and deleted everything — that is a traveller
// between trips, and explaining the app to them is an app that does not
// know its own user. Nothing could answer the question: the trips list
// only says what is here NOW, and `beaconsSent` cannot stand in because
// it is gated on the analytics opt-in.

test("a device that has ever held a trip remembers it after every trip is gone", () => {
  assert.equal(store.getSettings().tripEverCreated, false, "a device fresh out of the box");
  store.setTrips([{ id: "t1", name: "Goa", currencies: ["INR"] }]);
  assert.equal(store.getSettings().tripEverCreated, true);

  store.setTrips([]);
  assert.deepEqual(store.getTrips(), []);
  // The whole point: the flag records that this device has been used, and
  // being used is not something that can stop having happened.
  assert.equal(store.getSettings().tripEverCreated, true, "deleting every trip must not forget");
});

test("saving nothing is not having had something", () => {
  store.setTrips([]);
  assert.equal(store.getSettings().tripEverCreated, false);
});

test("the flag describes this device, so it neither travels nor stamps", () => {
  // A derived field riding on a synced record is ADR-0017: a phone that
  // has had trips would tell a brand-new laptop it had too, and the
  // laptop's owner would never be told what the app is.
  assert.ok(!SYNCED_SETTINGS.includes("tripEverCreated"));
  store.setTrips([{ id: "t1", name: "Goa", currencies: ["INR"] }]);
  assert.equal(pickSynced(store.getSettings()).tripEverCreated, undefined);
  // …and writing it must not make this device the newest writer of
  // preferences it never touched.
  assert.equal(store.getSettings().prefsUpdatedAt, undefined);
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

// ---------- the roster is a collection too (ADR-0024 part 2) ----------
//
// Member stamps and member graves are written by DIFFING here, never at the
// removal site. js/app.js mutates trip.members in five places —
// mergeEditedMembers, two filter-removals in the member sheet, applyProfile
// and linkAccount — and ADR-0008 exists because no mutation site can be
// trusted to remember.
const withMembers = (members, over = {}) =>
  ({ id: "t1", name: "Bali", currencies: ["IDR"], members, ...over });

test("removing a member records a grave under that member's trip", () => {
  store.setTrips([withMembers([{ id: "m-asha", name: "Asha" }, { id: "m-bala", name: "Bala" }])]);
  const before = store.getTrips()[0].members.find((m) => m.id === "m-bala").updatedAt;
  store.setTrips([withMembers([{ id: "m-asha", name: "Asha" }])]);

  const graves = store.getTombstones().members;
  assert.deepEqual(Object.keys(graves), ["t1"], "keyed by trip, so attribution is inherent");
  assert.ok(graves.t1["m-bala"] > before,
    "a grave must outrank the row it buries or the merge hands the person back");
});

test("a member's grave never leaves its own trip's document", () => {
  store.setTrips([
    withMembers([{ id: "m-a", name: "Asha" }, { id: "m-b", name: "Bala" }]),
    withMembers([{ id: "m-c", name: "Priya" }, { id: "m-d", name: "Rahul" }], { id: "t2" }),
  ]);
  store.setTrips([
    withMembers([{ id: "m-a", name: "Asha" }]),
    withMembers([{ id: "m-c", name: "Priya" }], { id: "t2" }),
  ]);
  const tombs = store.getTombstones();
  assert.deepEqual(Object.keys(tripTombstones(tombs, "t1").members), ["m-b"]);
  assert.deepEqual(Object.keys(tripTombstones(tombs, "t2").members), ["m-d"]);
});

test("a new or edited member row is stamped; an untouched one is left exactly as it was", () => {
  // Every trip in existence today has rows with no updatedAt. Stamping
  // them on the first save after the upgrade would restamp every trip on
  // this device and hand it a win over a genuine edit made on the other
  // phone — ADR-0014/0017, the failure this project keeps relearning.
  backing.set("tripcash:trips", JSON.stringify([
    withMembers([{ id: "m-a", name: "Asha" }, { id: "m-b", name: "Bala" }], { updatedAt: 100 }),
  ]));
  const held = store.getTrips();
  const launched = store.setTrips(held);
  assert.equal(launched[0].updatedAt, 100, "a launch must not restamp the trip");
  assert.deepEqual(launched[0].members, [{ id: "m-a", name: "Asha" }, { id: "m-b", name: "Bala" }],
    "nor invent history for rows nobody touched");

  const edited = store.setTrips([withMembers([
    { id: "m-a", name: "Asha Dutta" },
    { id: "m-b", name: "Bala" },
    { id: "m-c", name: "Priya" },
  ], { updatedAt: 100 })])[0].members;
  assert.ok(Number.isFinite(edited[0].updatedAt), "the renamed row is stamped");
  assert.equal(edited[1].updatedAt, undefined, "and the one beside it still is not");
  assert.ok(Number.isFinite(edited[2].updatedAt), "a row added here is stamped");
});

test("a member's grave outranks a row stamped ahead of this device's clock", () => {
  // The removed row was last written by a phone whose clock runs fast (or
  // whose Lamport anchor is higher). A grave on raw wall time would lose
  // to it and the person would come straight back.
  //
  // Read the clock ONCE. This called Date.now() to build the row and again
  // in the assertion, so a single millisecond passing between them raised
  // the bar above the stamp the grave was actually computed from, and the
  // test failed roughly one run in three. A flaky test in the one feature
  // whose whole subject is stamp ordering is worse than no test: it teaches
  // you to re-run rather than to look.
  const ahead = Date.now() + 60_000;
  backing.set("tripcash:trips", JSON.stringify([
    withMembers([{ id: "m-a", name: "Asha" },
      { id: "m-b", name: "Bala", updatedAt: ahead }], { updatedAt: 100 }),
  ]));
  store.setTrips([withMembers([{ id: "m-a", name: "Asha" }], { updatedAt: 100 })]);
  assert.ok(store.getTombstones().members.t1["m-b"] > ahead);
});

test("a member grave outlives the 90-day line — removed means removed", () => {
  // This test used to assert the opposite, and the old assertion is quoted
  // below because it encoded a real defect rather than a decision. Member
  // graves inherited the 90-day TTL from expenses, where hundreds per trip
  // make retiring them worthwhile. A member grave is one id and one
  // timestamp; two hundred of them cost 5.4 KB.
  //
  //   was: assert.deepEqual(Object.keys(...members.t1), ["m-c"]);
  //        i.e. the 100-day-old grave for Bala had been forgotten
  //
  // What that bought: remove somebody in January, and a co-member's tablet
  // opened in May syncs its stale member list with nothing left to
  // contradict it. Bala comes back with read, write and notifications, and
  // nobody is told. Owner's decision, 10 Aug 2026: keep them for the life
  // of the trip.
  const DAY = 24 * 60 * 60 * 1000;
  store.setSettings({ clockOffset: -100 * DAY });
  store.setTrips([withMembers([{ id: "m-a", name: "Asha" }, { id: "m-b", name: "Bala" }])]);
  store.setTrips([withMembers([{ id: "m-a", name: "Asha" }])]);
  assert.ok(store.getTombstones().members.t1["m-b"], "buried 100 days ago");

  store.setSettings({ clockOffset: 0 });
  store.setTrips([withMembers([{ id: "m-a", name: "Asha" }, { id: "m-c", name: "Priya" }])]);
  store.setTrips([withMembers([{ id: "m-a", name: "Asha" }])]);
  assert.deepEqual(
    Object.keys(store.getTombstones().members.t1).sort(), ["m-b", "m-c"],
    "the 100-day-old grave is still there beside today's"
  );
});

test("expense graves are still pruned at 90 days — only members changed", () => {
  // The point of the decision was that members are unlike expenses, so the
  // decision must not have leaked into expenses. Hundreds of expense graves
  // per trip is the case the TTL exists for.
  const DAY = 24 * 60 * 60 * 1000;
  store.setSettings({ clockOffset: -100 * DAY });
  const expense = (id) => ({
    id, tripId: "t1", name: "Lunch", amount: 1, homeValue: 1,
    paidBy: "me", split: { parts: {} },
  });
  store.setExpenses([expense("e-old")]);
  store.setExpenses([]);
  assert.ok(store.getTombstones().expenses?.["e-old"], "buried 100 days ago");

  store.setSettings({ clockOffset: 0 });
  store.setExpenses([expense("e-new")]);
  store.setExpenses([]);
  assert.deepEqual(Object.keys(store.getTombstones().expenses ?? {}), ["e-new"],
    "the 100-day-old expense grave is gone, as it should be");
});

test("js/app.js knows nothing about the member tombstone map", async () => {
  // Five mutation sites, and the one that forgets is the one that ships.
  // The diff in store.js is the only writer, so there is nothing for a
  // sixth site to forget.
  const { readFileSync } = await import("node:fs");
  const src = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  // Any way of reaching the map — `tombstones.members`,
  // `getTombstones().members`, `tombs?.members` — plus the function that
  // writes it. app.js hands store.js the whole map and reads none of it.
  assert.equal(src.match(/[Tt]ombstones(\(\))?\??\.members/g), null,
    "js/app.js must not reach into the member tombstone map");
  for (const needle of ["stampRoster", "mergeRoster"]) {
    assert.ok(!src.includes(needle), `js/app.js must not mention ${needle}`);
  }
});

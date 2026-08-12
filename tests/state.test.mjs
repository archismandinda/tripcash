// js/state.js — the one owner of in-memory state.
//
// The extraction that created this module was a mechanical move with
// three landmines, and each test here is one of them:
//
//  1. ALIASING IS LOAD-BEARING. Callers hold references to records
//     across saves (the archive toast's Undo, the member-linking pass in
//     syncNow). restamp() must write stamps INTO the existing objects;
//     replacing them leaves those callers writing to a copy nothing
//     reads — Undo silently doing nothing.
//  2. saveTrips() re-reads ONE field (tripEverCreated) from disk, never
//     the record — on a device where writes fail, re-reading wholesale
//     would revert preferences the person can still see on screen.
//  3. The after-save hook must fire exactly where scheduleSync() fired
//     when these functions lived in app.js — saveTrips/saveExpenses/
//     saveSettlements always, updateSettings only when a SYNCED
//     preference changed, saveNotices for the bell and nothing else.

import { test, beforeEach } from "node:test";
import assert from "node:assert/strict";

// Minimal localStorage stub so store.js (and therefore state.js) runs
// under Node — the same stub tests/store.test.mjs uses.
const backing = new Map();
globalThis.localStorage = {
  getItem: (k) => (backing.has(k) ? backing.get(k) : null),
  setItem: (k, v) => backing.set(k, String(v)),
  removeItem: (k) => backing.delete(k),
};

const store = await import("../js/store.js");
const { state, restamp, saveTrips, saveExpenses, saveSettlements, saveNotices,
  updateSettings, onSaved } = await import("../js/state.js");

const fired = [];
onSaved((kind) => fired.push(kind));

beforeEach(() => {
  backing.clear();
  fired.length = 0;
  state.settings = store.getSettings();
  state.trips = [];
  state.expenses = [];
  state.settlements = [];
  state.notices = [];
});

// ---------- 1. aliasing ----------

test("a save keeps every record's identity — references held across it stay live", () => {
  const goa = { id: "t1", name: "Goa", currencies: ["INR"], archived: false };
  state.trips = [goa];
  saveTrips();
  assert.equal(state.trips[0], goa,
    "the array may be rebuilt; the OBJECTS may not — Undo writes through a held reference");
  assert.ok(goa.updatedAt > 0,
    "…and the store's stamp must have landed on that same object (ADR-0016)");
});

test("the stamp the store writes comes back into the record the upload is built from", () => {
  const goa = { id: "t1", name: "Goa", currencies: ["INR"] };
  state.trips = [goa];
  saveTrips();
  const stampedAs = goa.updatedAt;
  const onDisk = JSON.parse(backing.get("tripcash:trips"))[0].updatedAt;
  assert.equal(stampedAs, onDisk,
    "memory and storage must agree, or every edit pushes with its pre-edit stamp and loses");
});

test("restamp writes into existing objects, never replaces them", () => {
  const records = [{ id: "a", updatedAt: 1 }, { id: "b", updatedAt: 1 }];
  const held = records[0];
  restamp(records, [{ id: "a", updatedAt: 99 }]);
  assert.equal(records[0], held);
  assert.equal(held.updatedAt, 99);
  assert.equal(records[1].updatedAt, 1, "a record the store did not stamp is left alone");
});

// ---------- 2. one field back, not the record ----------

test("saveTrips refreshes tripEverCreated and nothing else", () => {
  state.settings = { ...state.settings, homeCurrency: "THB", tripEverCreated: false };
  state.trips = [{ id: "t1", name: "Goa", currencies: ["THB"] }];
  saveTrips();
  assert.equal(state.settings.tripEverCreated, true,
    "the save wrote the flag; this launch has to know");
  assert.equal(state.settings.homeCurrency, "THB",
    "an unsaved in-memory preference must not be reverted by a trip save");
});

// ---------- 3. the hook fires where scheduleSync fired ----------

test("every collection save fires the hook once, named", () => {
  state.trips = [{ id: "t1", name: "Goa", currencies: ["INR"] }];
  saveTrips();
  saveExpenses();
  saveSettlements();
  saveNotices([]);
  assert.deepEqual(fired, ["trips", "expenses", "settlements", "notices"]);
});

test("updateSettings fires only when a synced preference changed", () => {
  updateSettings({ lastSyncAt: 123 });          // device-local — no push
  assert.deepEqual(fired, [], "a local-only settings write must not schedule a sync");
  updateSettings({ pinnedTripId: "t1" });       // travels — push
  assert.deepEqual(fired, ["settings"]);
  assert.equal(state.settings.pinnedTripId, "t1", "…and the write itself landed in memory");
});

test("saving with no hook registered still saves — state.js is a leaf", () => {
  onSaved(null);
  try {
    state.trips = [{ id: "t1", name: "Goa", currencies: ["INR"] }];
    saveTrips(); // must not throw
    assert.equal(JSON.parse(backing.get("tripcash:trips")).length, 1);
  } finally {
    onSaved((kind) => fired.push(kind));
  }
});

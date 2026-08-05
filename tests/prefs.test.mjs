import { test } from "node:test";
import assert from "node:assert/strict";
import { pickSynced, syncedChanged, mergePrefs, prunePrefs, SYNCED_SETTINGS } from "../js/prefs.js";

// ---------- what travels and what doesn't ----------

test("pinning a trip is a preference that follows you between devices", () => {
  // The reported bug: pinned on the phone, not pinned on the laptop.
  assert.ok(SYNCED_SETTINGS.includes("pinnedTripId"));
  const out = pickSynced({ pinnedTripId: "t1", homeCurrency: "INR", markupPct: 3 });
  assert.equal(out.pinnedTripId, "t1");
});

test("device-only state never leaves the device", () => {
  const out = pickSynced({
    pinnedTripId: "t1",
    activeTripId: "t9", theme: "dark", syncHint: true,
    lastSyncAt: 123, pendingJoin: "t7", detailTipShown: true,
  });
  assert.deepEqual(Object.keys(out), ["pinnedTripId"]);
});

test("undefined values aren't shipped as nulls", () => {
  assert.deepEqual(pickSynced({ homeCurrency: "INR" }), { homeCurrency: "INR" });
});

// ---------- knowing when to bump the stamp ----------

test("a real preference change registers; unrelated writes don't", () => {
  const base = { homeCurrency: "INR", pinnedTripId: "t1" };
  assert.ok(syncedChanged(base, { ...base, pinnedTripId: "t2" }));
  assert.ok(syncedChanged(base, { ...base, homeCurrency: "USD" }));
  // Opening a different trip card is not a preference change — if it
  // counted, every tap would win the next merge.
  assert.ok(!syncedChanged(base, { ...base, activeTripId: "t9" }));
  assert.ok(!syncedChanged(base, { ...base, lastSyncAt: Date.now() }));
  assert.ok(!syncedChanged(base, { ...base }));
});

// ---------- merging ----------

test("the most recent change wins", () => {
  const phone = { pinnedTripId: "t1", updatedAt: 200 };
  const laptop = { pinnedTripId: "t2", updatedAt: 100 };
  assert.equal(mergePrefs(laptop, phone).pinnedTripId, "t1");
  assert.equal(mergePrefs(phone, laptop).pinnedTripId, "t1");
});

test("unpinning propagates just like pinning", () => {
  // null is a real value here, not "no opinion" — otherwise unpinning on
  // one device would be quietly undone by the other.
  const unpinned = { pinnedTripId: null, updatedAt: 300 };
  const pinned = { pinnedTripId: "t1", updatedAt: 100 };
  assert.equal(mergePrefs(pinned, unpinned).pinnedTripId, null);
});

test("a device with no preferences yet takes what the server has", () => {
  const remote = { homeCurrency: "USD", updatedAt: 5 };
  assert.deepEqual(mergePrefs(null, remote), remote);
  assert.deepEqual(mergePrefs({ homeCurrency: "INR" }, null), { homeCurrency: "INR" });
  assert.equal(mergePrefs(null, null), null);
});

test("an unstamped local preference loses to a stamped remote one", () => {
  const local = { homeCurrency: "INR" };
  const remote = { homeCurrency: "USD", updatedAt: 1 };
  assert.equal(mergePrefs(local, remote).homeCurrency, "USD");
});

// ---------- pruning ----------

test("a pin pointing at a deleted trip is dropped", () => {
  assert.equal(prunePrefs({ pinnedTripId: "gone" }, ["t1"]).pinnedTripId, null);
  assert.equal(prunePrefs({ pinnedTripId: "t1" }, ["t1"]).pinnedTripId, "t1");
  assert.deepEqual(prunePrefs({ homeCurrency: "INR" }, []), { homeCurrency: "INR" });
});

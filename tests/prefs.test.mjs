import { test } from "node:test";
import assert from "node:assert/strict";
import { pickSynced, syncedChanged, mergePrefs, prunePrefs, clockOffsetFrom, clockPlan, SYNCED_SETTINGS } from "../js/prefs.js";

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

// ---------- agreeing on the time ----------

test("a device learns how far its clock is from the server's", () => {
  // Anchoring locally isn't enough: a device whose clock runs ahead can
  // overwrite a change it has never seen, because its stamps are
  // inflated. Stamping in server time makes them comparable.
  assert.equal(clockOffsetFrom(1_000_180_000, 1_000_000_000), 180_000); // 3 min fast server
  assert.equal(clockOffsetFrom(1_000_000_000, 1_000_180_000), -180_000);
  assert.equal(clockOffsetFrom(1_000_000_000, 1_000_000_000), 0);
});

test("a nonsense reading is ignored rather than corrupting every stamp", () => {
  assert.equal(clockOffsetFrom(undefined, 1_000_000_000), 0);
  assert.equal(clockOffsetFrom(NaN, 1_000_000_000), 0);
  assert.equal(clockOffsetFrom(1_000_000_000, undefined), 0);
  // Beyond any believable skew — a corrupt value, not a wrong clock.
  assert.equal(clockOffsetFrom(1_000_000_000 + 400 * 864e5, 1_000_000_000), 0);
});

test("the offset is device-local and must never sync", () => {
  // Shipping one device's correction to another would double the error.
  assert.ok(!SYNCED_SETTINGS.includes("clockOffset"));
  assert.deepEqual(pickSynced({ clockOffset: 5000, homeCurrency: "INR" }), { homeCurrency: "INR" });
});

// ---------- ties, here too ----------

test("two devices with the same prefs stamp agree on one winner", () => {
  // The exact defect ADR-0015 fixed for records, still live in prefs
  // until v1.44. A tie meant "prefer mine" on BOTH devices — permanent
  // disagreement. Reachable because a device that has never changed a
  // travelling preference carries updatedAt 0.
  const mac = { homeCurrency: "USD", updatedAt: 0 };
  const android = { homeCurrency: "EUR", updatedAt: 0 };
  assert.deepEqual(mergePrefs(mac, android), mergePrefs(android, mac));
});

test("a push token identifies one browser and must never sync", () => {
  // Shipping it would have every device claiming every other device's
  // token — and one phone turning notifications off would silence them
  // all. Same reasoning as clockOffset.
  assert.ok(!SYNCED_SETTINGS.includes("pushToken"));
  assert.deepEqual(pickSynced({ pushToken: "abc", homeCurrency: "INR" }), { homeCurrency: "INR" });
});

test("neither half of the push registration ever syncs", () => {
  assert.ok(!SYNCED_SETTINGS.includes("pushToken"));
  assert.ok(!SYNCED_SETTINGS.includes("pushTokenUid"));
  assert.deepEqual(
    pickSynced({ pushToken: "abc", pushTokenUid: "u1", homeCurrency: "INR" }),
    { homeCurrency: "INR" }
  );
});

// ---------- knowing the offset before stamping anything ----------

const probe = (serverMillis, localAt) => ({
  serverAt: { toMillis: () => serverMillis },
  localAt,
});

test("a device with no probe of its own must ask before it stamps", () => {
  // The hole TC-1 was left with: 0 was returned for "never asked", and 0
  // is also a real answer, so a first sync stamped as though it had
  // checked. On a fresh phone whose peer runs fast, an expense the user
  // watched confirm was buried by a tombstone stamped in the future.
  assert.deepEqual(clockPlan(undefined, "me"), { do: "probe" });
  assert.deepEqual(clockPlan({}, "me"), { do: "probe" });
  // Somebody ELSE'S probe is not this device's answer — applying it makes
  // the skew worse, which is the whole reason clocks is keyed per device.
  assert.deepEqual(clockPlan({ other: probe(1_000_180_000, 1_000_000_000) }, "me"), { do: "probe" });
});

test("a probe that was never resolved is not an answer either", () => {
  // serverTimestamp() reads back null until the server has acknowledged.
  assert.deepEqual(clockPlan({ me: { serverAt: null, localAt: 1 } }, "me"), { do: "probe" });
  assert.deepEqual(clockPlan({ me: { serverAt: { toMillis: () => NaN }, localAt: 1 } }, "me"), { do: "probe" });
  assert.deepEqual(clockPlan({ me: probe(1_000_000_000, undefined) }, "me"), { do: "probe" });
});

test("its own resolved probe is the answer, skew and all", () => {
  assert.deepEqual(clockPlan({ me: probe(1_000_180_000, 1_000_000_000) }, "me"),
    { do: "use", offset: 180_000 });
  // Agreeing with the server is a real answer, and must be reported as
  // one — this is exactly the case the old code could not distinguish.
  assert.deepEqual(clockPlan({ me: probe(1_000_000_000, 1_000_000_000) }, "me"),
    { do: "use", offset: 0 });
});

test("an absurd reading is used as zero, not as an answer to distrust", () => {
  // Same conservatism as clockOffsetFrom: corrupting every future stamp
  // is worse than falling back to the local clock.
  // Over a year apart — a dead battery's 1970 clock, not real skew.
  const aYearAndABit = 400 * 24 * 60 * 60 * 1000;
  assert.deepEqual(clockPlan({ me: probe(1_000_000_000 + aYearAndABit, 1_000_000_000) }, "me"),
    { do: "use", offset: 0 });
  // …but a genuinely large-yet-plausible skew is still applied.
  const elevenDays = 11 * 24 * 60 * 60 * 1000;
  assert.deepEqual(clockPlan({ me: probe(1_000_000_000 + elevenDays, 1_000_000_000) }, "me"),
    { do: "use", offset: elevenDays });
});

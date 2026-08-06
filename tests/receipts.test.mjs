import { test } from "node:test";
import assert from "node:assert/strict";
import { needsFetch, isPendingUpload } from "../js/receipts.js";

const blob = { size: 1234 }; // shape is all these decisions look at

// ---------- when to pull from the cloud ----------

test("no cloud copy means nothing to fetch", () => {
  assert.equal(needsFetch(null, { name: "r.jpg", type: "image/jpeg" }), false);
  assert.equal(needsFetch(null, undefined), false);
});

test("a cloud copy we don't have locally is fetched", () => {
  assert.equal(needsFetch(null, { cloudAt: 100 }), true);
  assert.equal(needsFetch({ name: "meta-only, no blob" }, { cloudAt: 100 }), true);
});

test("a local copy as fresh as the cloud is left alone", () => {
  assert.equal(needsFetch({ blob, cloudAt: 100 }, { cloudAt: 100 }), false);
  assert.equal(needsFetch({ blob, cloudAt: 150 }, { cloudAt: 100 }), false);
});

test("a replaced receipt (newer cloudAt) is re-fetched", () => {
  // Someone re-attached a clearer photo on another phone. Without the
  // staleness check this device would show the old receipt forever.
  assert.equal(needsFetch({ blob, cloudAt: 100 }, { cloudAt: 200 }), true);
});

test("the uploader's own copy is not re-downloaded", () => {
  // After upload the device stamps its local record with the same
  // cloudAt — fetching back what it just sent would be a wasted read.
  const stamped = { blob, cloudAt: 500 };
  assert.equal(needsFetch(stamped, { cloudAt: 500 }), false);
});

test("a local blob from before sync existed counts as current, not stale", () => {
  // Old records have no cloudAt on the local copy. If the metadata has
  // none either, there is nothing newer to fetch.
  assert.equal(needsFetch({ blob }, { name: "r.jpg" }), false);
});

// ---------- what still needs uploading ----------

test("a receipt saved offline is pending until it reaches the cloud", () => {
  assert.equal(isPendingUpload({ attachment: { name: "r.jpg", type: "image/jpeg" } }), true);
  assert.equal(isPendingUpload({ attachment: { name: "r.jpg", cloudAt: 100 } }), false);
});

test("expenses without receipts are never pending", () => {
  assert.equal(isPendingUpload({ name: "Lunch" }), false);
  assert.equal(isPendingUpload(null), false);
});

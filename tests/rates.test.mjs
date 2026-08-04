import { test } from "node:test";
import assert from "node:assert/strict";

// store.js is imported (transitively) and needs localStorage under Node.
const backing = new Map();
globalThis.localStorage ??= {
  getItem: (k) => (backing.has(k) ? backing.get(k) : null),
  setItem: (k, v) => backing.set(k, String(v)),
  removeItem: (k) => backing.delete(k),
};

const { isFresh, ageString, MAX_AGE_MS } = await import("../js/rates.js");

const NOW = 1700000000000;

test("freshness window is 6 hours", () => {
  assert.equal(isFresh({ fetchedAt: NOW - MAX_AGE_MS + 1000 }, NOW), true);
  assert.equal(isFresh({ fetchedAt: NOW - MAX_AGE_MS - 1000 }, NOW), false);
  assert.equal(isFresh(null, NOW), false);
});

test("age strings read naturally", () => {
  assert.equal(ageString(NOW - 30_000, NOW), "just now");
  assert.equal(ageString(NOW - 34 * 60_000, NOW), "34m ago");
  assert.equal(ageString(NOW - 2 * 3_600_000, NOW), "2h ago");
  assert.equal(ageString(NOW - 3 * 86_400_000, NOW), "3d ago");
});

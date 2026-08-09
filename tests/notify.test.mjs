// The Cloud Function's "is this worth interrupting someone for?" rule.
// Pure, so it's tested here even though it runs server-side — an
// unnecessary notification is how people turn notifications off, and
// that failure is invisible until nobody has them on any more.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";

const { describe: say } = createRequire(import.meta.url)("../functions/notify.js");

const exp = (id, over = {}) => ({ id, name: "Dinner", amount: 450000, code: "VND", ...over });
const doc = (over = {}) => ({ trip: { name: "Vietnam", members: [{ id: "m1" }] },
  expenses: [], settlements: [], ...over });

test("a new expense is announced with its own currency", () => {
  const out = say(doc(), doc({ expenses: [exp("x1")] }));
  assert.equal(out.body, "Dinner · ₫450,000");
});

test("several at once collapse into one line", () => {
  const out = say(doc(), doc({ expenses: [exp("x1"), exp("x2"), exp("x3")] }));
  assert.equal(out.body, "3 new expenses");
});

test("editing an existing expense says NOTHING", () => {
  // The most important case. Renames, re-splits, reorders and receipt
  // uploads all rewrite the document; none is worth a buzz.
  const before = doc({ expenses: [exp("x1")] });
  const after = doc({ expenses: [exp("x1", { name: "Dinner (fixed)", amount: 460000 })] });
  assert.equal(say(before, after), null);
});

test("a trip renamed, reordered, or merely re-synced says nothing", () => {
  assert.equal(say(doc(), doc({ trip: { name: "Vietnam trip", members: [{ id: "m1" }] } })), null);
  assert.equal(say(doc(), doc()), null);
});

test("a deleted trip is not a notification", () => {
  assert.equal(say(doc({ expenses: [exp("x1")] }), { deleted: true }), null);
  assert.equal(say(doc(), null), null);
});

test("payments and new members are worth knowing", () => {
  assert.equal(say(doc(), doc({ settlements: [{ id: "p1" }] })).body, "A payment was recorded");
  const joined = say(doc(), doc({ trip: { name: "Vietnam", members: [{ id: "m1" }, { id: "m2" }] } }));
  assert.equal(joined.body, "Someone was added to the trip");
});

test("a member LEAVING is not announced", () => {
  const before = doc({ trip: { name: "V", members: [{ id: "m1" }, { id: "m2" }] } });
  assert.equal(say(before, doc({ trip: { name: "V", members: [{ id: "m1" }] } })), null);
});

test("an expense wins over a payment in the same write", () => {
  // Both can land together after an offline stretch; lead with the money
  // that was spent, not the housekeeping.
  const out = say(doc(), doc({ expenses: [exp("x1")], settlements: [{ id: "p1" }] }));
  assert.equal(out.body, "Dinner · ₫450,000");
});

test("a malformed record still produces a sentence rather than crashing", () => {
  // This runs server-side on data written by clients of any age. An
  // exception here is a notification nobody ever gets, silently.
  // Intl separates with a non-breaking space; normalise before comparing.
  const flat = (s) => s.replace(/\u00a0/g, " ");
  assert.equal(flat(say(doc(), doc({ expenses: [exp("x1", { code: "ZZZ" })] })).body), "Dinner · ZZZ 450,000");
  assert.equal(say(doc(), doc({ expenses: [exp("x1", { code: "ab" })] })).body, "Dinner · 450000 ab");
  assert.equal(say(doc(), doc({ expenses: [exp("x1", { name: "", amount: null })] })).body, "New expense");
  assert.equal(say(doc(), doc({ expenses: [null, exp("x1")] })).body, "Dinner · ₫450,000");
  assert.equal(say({}, { trip: {} }), null);
});

test("the very first trip arriving reads as an invitation", () => {
  const out = say(null, doc({ trip: { name: "Vietnam", members: [{ id: "m1" }] } }));
  assert.equal(out.body, "You were added to a trip");
});

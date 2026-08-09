// Committing a saved expense into the ledger. Every case here is the
// fourth appearance of ADR-0019: a value read before an await, written
// after it, while the user's other phone was a concurrent writer.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { commitExpense, resolveCreatedAt } from "../js/ledger.js";

const exp = (id, over = {}) => ({ id, tripId: "T1", name: id, amount: 10, ...over });

test("an edit replaces the record in place and leaves every neighbour alone", () => {
  const before = [exp("a"), exp("b"), exp("c")];
  const record = exp("b", { name: "Dinner, corrected" });
  const out = commitExpense({ expenses: before, record, editingId: "b" });

  assert.equal(out.expenses.length, 3, "an edit adds nothing and drops nothing");
  assert.equal(out.expenses[1], record, "and it lands where it already was");
  assert.equal(out.expenses[0], before[0], "untouched rows must be the SAME objects —");
  assert.equal(out.expenses[2], before[2], "re-created rows restamp and re-push for nothing");
  assert.equal(out.revived, false);
});

test("an expense deleted on the other phone mid-save comes back, not lost", () => {
  // The regression pin. `expenses.map(e => e.id === id ? record : e)` over
  // a list a snapshot had already emptied of that id matched nothing, so
  // the edit evaporated: no error, no toast, and a receipt already written
  // to IndexedDB left pointing at nobody.
  const before = [exp("a"), exp("c")]; // "b" was deleted during the awaits
  const record = exp("b", { name: "Dinner" });
  const out = commitExpense({ expenses: before, record, editingId: "b" });

  assert.equal(out.expenses.filter((e) => e.id === "b").length, 1, "exactly once");
  assert.equal(out.revived, true, "and the caller can tell it had to be revived");
});

test("a double-tap on Save cannot produce two rows for one expense", () => {
  const before = [exp("a"), exp("b")];
  const record = exp("b", { name: "Taxi" });
  const out = commitExpense({ expenses: before, record, editingId: null });

  assert.equal(out.expenses.filter((e) => e.id === "b").length, 1);
  assert.equal(out.expenses.length, 2, "a new save of a known id is still an edit");
  assert.equal(out.revived, false, "nothing was revived — it was there all along");
});

test("another trip's ledger is not even touched", () => {
  const before = [exp("a"), exp("x", { tripId: "T2" }), exp("b"), exp("y", { tripId: "T2" })];
  const record = exp("b", { name: "Lunch" });
  const out = commitExpense({ expenses: before, record, editingId: "b" });

  const others = out.expenses.filter((e) => e.tripId !== record.tripId);
  assert.equal(others.length, 2, "same count for the other trip");
  assert.equal(others[0], before[1], "and the very same objects");
  assert.equal(others[1], before[3]);
});

test("an expense that arrived mid-flight survives the commit", () => {
  // commitExpense is a pure function of what it is HANDED. If app.js
  // passes live state, a record a snapshot added during the awaits is
  // still there afterwards — which is the whole point of ADR-0019.
  const before = [exp("a")];
  const afterSnapshot = [...before, exp("fromOtherPhone")];
  const record = exp("new");
  const out = commitExpense({ expenses: afterSnapshot, record, editingId: null });

  assert.deepEqual(out.expenses.map((e) => e.id), ["a", "fromOtherPhone", "new"]);
});

test("with no When and the previous record gone, createdAt still lands on a real time", () => {
  const fallback = 1786288422005;
  assert.equal(resolveCreatedAt({ when: null, previous: undefined, fallback }), fallback);
  assert.ok(Number.isFinite(resolveCreatedAt({ when: null, previous: undefined, fallback })));
  // …and the two rules that come first, in order.
  assert.equal(resolveCreatedAt({ when: 111, previous: { createdAt: 222 }, fallback }), 111);
  assert.equal(resolveCreatedAt({ when: null, previous: { createdAt: 222 }, fallback }), 222);
});

test("saveExpense no longer rebuilds the ledger by hand", () => {
  // app.js is io only (D7). If this branching ever comes back it will be
  // a second, untested copy of the rule above — which is how every bug
  // the owner personally hit was made.
  const src = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const start = src.indexOf("async function saveExpense()");
  assert.ok(start > 0, "saveExpense must still exist");
  const body = src.slice(start, src.indexOf("\n}\n", start));

  assert.ok(!body.includes("expenses.map("), "no hand-rolled edit branch");
  assert.ok(!body.includes("[...expenses,"), "no hand-rolled append branch");
  assert.equal(body.split("commitExpense(").length - 1, 1, "exactly one commit");
});

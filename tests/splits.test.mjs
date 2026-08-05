import { test } from "node:test";
import assert from "node:assert/strict";
import { splitValid, shareFraction, shareOf, tripBalances, settleUp, expenseCuts, equalSplit } from "../js/splits.js";

const MEMBERS = [{ id: "me", name: "You" }, { id: "a", name: "Rohan" }, { id: "b", name: "Priya" }];

const exp = (over = {}) => ({
  id: "e1", tripId: "t1", type: "food", name: "Lunch",
  amount: 890, code: "CZK", homeValue: 3000, paidBy: "me",
  split: equalSplit(MEMBERS), createdAt: Date.UTC(2026, 7, 5, 12),
  ...over,
});

test("equal split divides evenly among included members", () => {
  const e = exp();
  assert.ok(Math.abs(shareOf(e, "me") - 1000) < 1e-9);
  assert.ok(Math.abs(shareOf(e, "a") - 1000) < 1e-9);
  assert.ok(Math.abs(shareOf(e, "b") - 1000) < 1e-9);
});

test("excluding a member sends their share to the others", () => {
  const e = exp({ split: { mode: "equal", parts: { me: 1, a: 1 } } });
  assert.equal(shareOf(e, "me"), 1500);
  assert.equal(shareOf(e, "b"), 0);
});

test("percent split follows the percentages", () => {
  const e = exp({ split: { mode: "percent", parts: { me: 50, a: 30, b: 20 } } });
  assert.equal(shareOf(e, "me"), 1500);
  assert.equal(shareOf(e, "a"), 900);
  assert.equal(shareOf(e, "b"), 600);
});

test("shares split uses ratios (2:1:1)", () => {
  const e = exp({ split: { mode: "shares", parts: { me: 2, a: 1, b: 1 } } });
  assert.equal(shareOf(e, "me"), 1500);
  assert.equal(shareOf(e, "a"), 750);
});

test("splitValid gates bad splits", () => {
  assert.ok(splitValid(equalSplit(MEMBERS)));
  assert.ok(splitValid({ mode: "percent", parts: { me: 60, a: 40 } }));
  assert.ok(!splitValid({ mode: "percent", parts: { me: 60, a: 30 } })); // 90 ≠ 100
  assert.ok(!splitValid({ mode: "equal", parts: {} }));
  assert.ok(!splitValid({ mode: "shares", parts: { me: 0, a: 0 } }));
  assert.ok(!splitValid(null));
  // negative weights are ignored, not counted
  assert.equal(shareFraction({ mode: "shares", parts: { me: -5, a: 1 } }, "a"), 1);
});

test("balances: paid minus share nets to zero across the trip", () => {
  const expenses = [
    exp({ homeValue: 3000, paidBy: "me" }),                              // each owes 1000
    exp({ id: "e2", homeValue: 1200, paidBy: "a",
      split: { mode: "equal", parts: { me: 1, a: 1 } } }),               // me/a owe 600
  ];
  const b = tripBalances(expenses, MEMBERS);
  assert.ok(Math.abs(b.me.net - (3000 - 1600)) < 1e-9);   // paid 3000, owes 1600
  assert.ok(Math.abs(b.a.net - (1200 - 1600)) < 1e-9);    // paid 1200, owes 1600
  assert.ok(Math.abs(b.b.net - (0 - 1000)) < 1e-9);
  const sum = Object.values(b).reduce((s, x) => s + x.net, 0);
  assert.ok(Math.abs(sum) < 1e-6, "nets must sum to zero");
});

test("settleUp produces at most N−1 transfers that clear all debts", () => {
  const b = { me: 1400, a: -400, b: -1000 };
  const t = settleUp(b);
  assert.ok(t.length <= 2);
  const paid = {};
  for (const x of t) {
    paid[x.from] = (paid[x.from] ?? 0) - x.amount;
    paid[x.to] = (paid[x.to] ?? 0) + x.amount;
  }
  // Net flow through transfers must equal each member's balance:
  // creditors receive exactly what they're owed, debtors pay exactly their debt.
  for (const id of Object.keys(b)) {
    assert.ok(Math.abs((paid[id] ?? 0) - b[id]) < 0.02, `${id} cleared`);
  }
});

test("settleUp: balanced books need no transfers", () => {
  assert.deepEqual(settleUp({ me: 0, a: 0.004, b: -0.004 }), []);
});

test("cuts aggregate by type, member, currency, and day", () => {
  const expenses = [
    exp({ homeValue: 3000, type: "food", code: "CZK" }),
    exp({ id: "e2", homeValue: 5000, type: "stay", code: "EUR", createdAt: Date.UTC(2026, 7, 6, 9) }),
  ];
  const c = expenseCuts(expenses, MEMBERS);
  assert.equal(c.total, 8000);
  assert.equal(c.count, 2);
  assert.equal(c.byType.food, 3000);
  assert.equal(c.byType.stay, 5000);
  assert.equal(c.byCurrency.CZK, 3000);
  assert.equal(c.byDay["2026-08-05"], 3000);
  assert.equal(c.byDay["2026-08-06"], 5000);
  assert.ok(Math.abs(c.byMember.me - (1000 + 5000 / 3)) < 1e-9);
});

// ---------- settle-up payments ----------

test("a recorded payment shifts nets: payer up, receiver down", () => {
  const expenses = [exp({ homeValue: 3000, paidBy: "me" })]; // a and b each owe me 1000
  const b = tripBalances(expenses, MEMBERS, [
    { from: "a", to: "me", amount: 1000 },
  ]);
  assert.ok(Math.abs(b.a.net) < 1e-9, "a is square after paying");
  assert.ok(Math.abs(b.me.net - 1000) < 1e-9, "me is now owed only b's share");
  assert.equal(b.a.sent, 1000);
  assert.equal(b.me.received, 1000);
  const sum = Object.values(b).reduce((s, x) => s + x.net, 0);
  assert.ok(Math.abs(sum) < 1e-6, "nets still sum to zero");
});

test("full repayment by everyone leaves nothing to settle", () => {
  const expenses = [exp({ homeValue: 3000, paidBy: "me" })];
  const b = tripBalances(expenses, MEMBERS, [
    { from: "a", to: "me", amount: 1000 },
    { from: "b", to: "me", amount: 1000 },
  ]);
  assert.deepEqual(settleUp(b), []);
});

test("partial repayment shrinks the suggested transfer", () => {
  const expenses = [exp({ homeValue: 3000, paidBy: "me" })];
  const b = tripBalances(expenses, MEMBERS, [
    { from: "a", to: "me", amount: 400 },
  ]);
  const t = settleUp(b);
  const fromA = t.find((x) => x.from === "a");
  assert.ok(Math.abs(fromA.amount - 600) < 1e-9);
});

test("payments from unknown members are ignored, not crashing", () => {
  const expenses = [exp({ homeValue: 3000, paidBy: "me" })];
  const b = tripBalances(expenses, MEMBERS, [
    { from: "ghost", to: "me", amount: 500 },
  ]);
  assert.ok(Math.abs(b.me.net - (3000 - 1000 - 500)) < 1e-9); // received still counts
});

test("overpayment flips who is owed: the overpayer becomes a creditor", () => {
  const expenses = [exp({ id: "e1", homeValue: 900, paidBy: "me",
    split: { mode: "equal", parts: { me: 1, a: 1, b: 1 } } })]; // a owes 300
  const b = tripBalances(expenses, MEMBERS, [
    { from: "a", to: "me", amount: 500 }, // paid 200 too much
  ]);
  assert.ok(Math.abs(b.a.net - 200) < 1e-9, "a is now owed the extra 200");
  const t = settleUp(b);
  const toA = t.filter((x) => x.to === "a").reduce((s, x) => s + x.amount, 0);
  assert.ok(Math.abs(toA - 200) < 1e-9, "transfers give a the 200 back");
});

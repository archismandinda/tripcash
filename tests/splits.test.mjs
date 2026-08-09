import { test } from "node:test";
import assert from "node:assert/strict";
import { splitValid, shareFraction, shareOf, tripBalances, settleUp, expenseCuts, equalSplit, allocate , reassignMember} from "../js/splits.js";

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

// ---------- the books must always balance ----------

test("balances still sum to zero when an expense names a member who was removed", () => {
  // Reachable with two devices: member lists merge as part of the whole
  // trip record, so one phone can remove Cy while the other logs a
  // dinner Cy paid for. Cy's money then moved through no balance row at
  // all — the nets stopped summing to zero and settle-up returned fewer
  // transfers than the trip needed, printing "All settled 🎉" while real
  // money was outstanding.
  const members = [{ id: "a", name: "Amy" }, { id: "b", name: "Bo" }];
  const expenses = [{
    id: "e1", tripId: "t1", homeValue: 3000, paidBy: "c",
    split: { mode: "equal", parts: { a: 1, b: 1, c: 1 } },
  }];
  const balances = tripBalances(expenses, members);
  const sum = Object.values(balances).reduce((t, b) => t + b.net, 0);
  assert.ok(Math.abs(sum) < 0.01, `nets must cancel, got ${sum}`);
  assert.equal(balances.c.paid, 3000, "the payer is on the books");

  const transfers = settleUp(balances);
  const moved = transfers.reduce((t, x) => t + x.amount, 0);
  assert.ok(Math.abs(moved - 2000) < 0.01, `2000 is owed to the payer, got ${moved}`);
});

test("a member who only appears in a payment still balances", () => {
  const balances = tripBalances([], [{ id: "a", name: "Amy" }],
    [{ from: "a", to: "gone", amount: 500 }]);
  const sum = Object.values(balances).reduce((t, b) => t + b.net, 0);
  assert.ok(Math.abs(sum) < 0.01, `nets must cancel, got ${sum}`);
});

test("a trip with everyone present is unchanged", () => {
  const members = [{ id: "a", name: "Amy" }, { id: "b", name: "Bo" }];
  const expenses = [{ id: "e1", tripId: "t1", homeValue: 100, paidBy: "a",
    split: { mode: "equal", parts: { a: 1, b: 1 } } }];
  assert.deepEqual(Object.keys(tripBalances(expenses, members)), ["a", "b"]);
});

// ---------- days are the days you were living in ----------

test("an expense is filed under the local day, not the UTC one", () => {
  // 2:30am IST is still the previous day in UTC, so every late-night bar
  // tab landed in the "By day" chart on a day its own row disagreed with.
  const at = new Date(2026, 7, 5, 2, 30).getTime(); // local 5 Aug, 02:30
  const cuts = expenseCuts([{ id: "e1", tripId: "t1", homeValue: 100, paidBy: "a",
    code: "INR", type: "food", createdAt: at, split: { parts: { a: 1 } } }], [{ id: "a", name: "A" }]);
  assert.deepEqual(Object.keys(cuts.byDay), ["2026-08-05"]);
});

test("settle-up drops arithmetic residue but never real money", () => {
  // A flat "ignore anything under 1" was swallowing up to a whole
  // Kuwaiti dinar (~₹270) and calling the trip settled. Only amounts
  // that cannot be paid at all — below one minor unit — are dropped.
  assert.deepEqual(settleUp({ a: { net: 0.004 }, b: { net: -0.004 } }, 2), [], "residue");
  assert.equal(settleUp({ a: { net: 0.6 }, b: { net: -0.6 } }, 2).length, 1, "60 paise is owed");
  assert.equal(settleUp({ a: { net: 0.6 }, b: { net: -0.6 } }, 3).length, 1, "0.6 KWD certainly is");
  assert.deepEqual(settleUp({ a: { net: 0.4 }, b: { net: -0.4 } }, 0), [], "no fractional yen");
  assert.equal(settleUp({ a: { net: 250 }, b: { net: -250 } }, 2).length, 1);
});

// ---------- the column has to add up ----------

test("split amounts sum exactly to the total", () => {
  // Three equal ways used to show 33.33 + 33.33 + 33.33 = 99.99.
  const cuts = allocate(100, { a: 1, b: 1, c: 1 }, 2);
  assert.equal(Object.values(cuts).reduce((t, v) => t + v, 0), 100);
  assert.deepEqual(Object.values(cuts).sort(), [33.33, 33.33, 33.34]);
});

test("it adds up at zero decimals too", () => {
  // A ¥100,000 three-way split visibly lost a yen.
  const cuts = allocate(100000, { a: 1, b: 1, c: 1 }, 0);
  assert.equal(Object.values(cuts).reduce((t, v) => t + v, 0), 100000);
});

test("uneven weights are respected and still add up", () => {
  const cuts = allocate(100, { a: 50, b: 30, c: 20 }, 2);
  assert.deepEqual(cuts, { a: 50, b: 30, c: 20 });
  const odd = allocate(10, { a: 1, b: 2 }, 2);
  assert.equal(odd.a + odd.b, 10);
});

test("nobody excluded gets an allocation", () => {
  assert.deepEqual(allocate(90, { a: 1, b: 0, c: 2 }, 2), { a: 30, c: 60 });
  assert.deepEqual(allocate(90, {}, 2), {});
  assert.deepEqual(allocate(null, { a: 1 }, 2), {});
});

// ---------- handing a member's history to someone else ----------

test("reassigning moves what they paid and what they owed", () => {
  const expenses = [
    { id: "e1", homeValue: 300, paidBy: "gone", split: { mode: "equal", parts: { gone: 1, b: 1, c: 1 } } },
    { id: "e2", homeValue: 90, paidBy: "b", split: { mode: "equal", parts: { b: 1, c: 1 } } },
  ];
  const out = reassignMember("gone", "b", expenses, []);
  assert.equal(out.touched, 1, "the untouched expense stays untouched");
  assert.equal(out.expenses[0].paidBy, "b");
  assert.deepEqual(out.expenses[0].split.parts, { b: 2, c: 1 }, "weights add — b now carries both shares");
  assert.deepEqual(out.expenses[1], expenses[1]);
  assert.equal(expenses[0].paidBy, "gone", "the input is not mutated");
});

test("the books still balance after a reassignment", () => {
  // The whole point: removing someone must not lose or invent money.
  const members = [{ id: "a" }, { id: "b" }, { id: "gone" }];
  const expenses = [
    { id: "e1", homeValue: 300, paidBy: "gone", split: { mode: "equal", parts: { a: 1, b: 1, gone: 1 } } },
    { id: "e2", homeValue: 150, paidBy: "a", split: { mode: "equal", parts: { a: 1, gone: 1 } } },
  ];
  const before = tripBalances(expenses, members);
  assert.ok(Math.abs(Object.values(before).reduce((t, x) => t + x.net, 0)) < 0.01);

  const out = reassignMember("gone", "b", expenses, []);
  const after = tripBalances(out.expenses, [{ id: "a" }, { id: "b" }]);
  assert.ok(Math.abs(Object.values(after).reduce((t, x) => t + x.net, 0)) < 0.01, "still sums to zero");
  assert.equal(after.a.net.toFixed(2), before.a.net.toFixed(2), "an uninvolved member is unaffected");
  assert.equal(
    after.b.net.toFixed(2),
    (before.b.net + before.gone.net).toFixed(2),
    "b absorbs exactly what gone was owed or owed"
  );
});

test("payments follow the member, and a payment between the two cancels", () => {
  const pays = [
    { id: "p1", from: "gone", to: "a", amount: 100 },
    { id: "p2", from: "b", to: "gone", amount: 50 },  // becomes b → b
    { id: "p3", from: "a", to: "c", amount: 20 },
  ];
  const out = reassignMember("gone", "b", [], pays);
  assert.deepEqual(out.settlements.map((p) => p.id), ["p1", "p3"], "the self-payment is dropped");
  assert.equal(out.settlements[0].from, "b");
});

test("reassigning to yourself, or to nobody, changes nothing", () => {
  const e = [{ id: "e1", homeValue: 10, paidBy: "a", split: { parts: { a: 1 } } }];
  assert.equal(reassignMember("a", "a", e, []).touched, 0);
  assert.equal(reassignMember("a", null, e, []).touched, 0);
  assert.deepEqual(reassignMember("a", "a", e, []).expenses, e);
});

test("transfers are payable amounts, not raw floats", () => {
  // "Pay Bo ₹1133.3333333333333" is not an instruction anyone can follow.
  const t = settleUp({ a: { net: 1133.3333333333333 }, b: { net: -1133.3333333333333 } }, 2);
  assert.equal(t[0].amount, 1133.33);
  assert.equal(settleUp({ a: { net: 100.6 }, b: { net: -100.6 } }, 0)[0].amount, 101);
});

test("an expense that splits with nobody still balances", () => {
  // Unreachable from the UI, but a record from another client or an
  // older schema would otherwise leave its whole value attributed to no
  // one — and settle-up would quietly under-report.
  const members = [{ id: "a" }, { id: "b" }];
  const balances = tripBalances(
    [{ id: "e1", homeValue: 500, paidBy: "a", split: { mode: "equal", parts: {} } }],
    members
  );
  const sum = Object.values(balances).reduce((t, x) => t + x.net, 0);
  assert.ok(Math.abs(sum) < 0.01, `nets must cancel, got ${sum}`);
  assert.equal(balances.a.net, 0, "the payer covered it themselves");
  assert.deepEqual(settleUp(balances, 2), []);
});

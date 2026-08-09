import { test } from "node:test";
import assert from "node:assert/strict";
import { splitValid, shareFraction, shareOf, tripBalances, settleUp, roundedNets, expenseCuts, equalSplit, allocate , reassignMember} from "../js/splits.js";

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

// ---------- settle-up has to be able to FINISH ----------
//
// Marking every suggested transfer paid used to hand back a fresh
// transfer, forever, on any 0-decimal home currency (JPY, VND, IDR, KRW,
// HUF, ISK): the row was rounded to whole yen but the ledger behind it
// was decremented by the unrounded amount, so half a yen of residue was
// left behind, and a hardcoded 0.01 threshold called half a yen a debt.
// Two members, ¥3 → ¥2, then ¥1 the other way, then ¥1 back, on and on.
// "All settled 🎉" was unreachable.

// Money moves: paying someone raises your net, receiving lowers yours —
// the same arithmetic tripBalances does for a recorded settlement.
const settled = (nets, transfers) => {
  const out = { ...nets };
  for (const t of transfers) {
    out[t.from] = (out[t.from] ?? 0) + t.amount;
    out[t.to] = (out[t.to] ?? 0) - t.amount;
  }
  return out;
};

test("marking the suggested transfer paid reaches All settled at 0 decimals", () => {
  assert.equal(settleUp({ a: { net: 1.5 }, b: { net: -1.5 } }, 0).length, 1);

  // The same thing through the real books: ¥3 dinner, split two ways.
  const members = [{ id: "a" }, { id: "b" }];
  const expenses = [{ id: "e1", homeValue: 3, paidBy: "a",
    split: { mode: "equal", parts: { a: 1, b: 1 } } }];
  const first = settleUp(tripBalances(expenses, members), 0);
  assert.equal(first.length, 1, "one transfer to make");
  const after = tripBalances(expenses, members, first.map((t) => ({ ...t })));
  assert.deepEqual(settleUp(after, 0), [], "and then the trip is settled");
});

test("settle-up never consumes a debt without a transfer to match", () => {
  // A transfer that rounded to zero was dropped from the list but still
  // subtracted from both ledgers. Five members owing ¥0.4 each wiped out
  // the payer's whole ¥2 and printed "All settled 🎉" over it — the same
  // silent swallow the v1.45 note says was removed.
  const b = { a: 2, b: -0.4, c: -0.4, d: -0.4, e: -0.4, f: -0.4 };
  const moved = settleUp(b, 0).reduce((t, x) => t + x.amount, 0);
  assert.equal(moved, 2, "¥2 is owed, so ¥2 moves");
});

test("an exact half unit rounds toward moving less money", () => {
  // The one free choice in rounding a net is at an exact half, and it
  // decides whether settle-up can terminate at all. Rounding ¥1.5 up to
  // ¥2 leaves the payer ¥0.5 in credit, which rounds up again next time
  // and sends ¥1 back — the oscillation. Rounding the half down settles
  // for ¥1 and leaves residue nobody can pay, which is the end of it.
  assert.equal(settleUp({ a: { net: 1.5 }, b: { net: -1.5 } }, 0)[0].amount, 1);
  assert.equal(settleUp({ a: { net: 2.5 }, b: { net: -2.5 } }, 0)[0].amount, 2);
  assert.deepEqual(settleUp({ a: { net: 0.5 }, b: { net: -0.5 } }, 0), []);
  // Not a licence to under-pay generally: anything above the half is owed.
  assert.equal(settleUp({ a: { net: 100.6 }, b: { net: -100.6 } }, 0)[0].amount, 101);
});

test("the books close to inside one minor unit — half is not always reachable", () => {
  // Transfers are whole minor units, so each member's leftover is their
  // net minus an integer, and those integers must sum to zero. For nets
  // (0.4, 0.4, −0.8) yen the nearest integers are (0, 0, −1) — they do
  // NOT sum to zero, so SOME member has to end up more than half a yen
  // out. Brute force says the best any plan can do is 0.6; that is what
  // settle-up leaves, and it is why the guarantee below is "under one
  // minor unit", not "half of one".
  const nets = { a: 0.4, b: 0.4, c: -0.8 };
  const left = settled(nets, settleUp(nets, 0));
  const worst = Math.max(...Object.values(left).map(Math.abs));

  let best = Infinity;
  for (let fa = -3; fa <= 3; fa++) for (let fb = -3; fb <= 3; fb++) {
    const fc = -(fa + fb); // whole units, and money is neither made nor lost
    best = Math.min(best, Math.max(
      Math.abs(nets.a + fa), Math.abs(nets.b + fb), Math.abs(nets.c + fc)));
  }
  assert.ok(best > 0.5, `no plan holds everyone to half a yen; best is ${best}`);
  assert.ok(worst <= best + 1e-9, `settle-up leaves ${worst}, the best being ${best}`);
});

test("settle-up settles any books in one round", () => {
  // 2,000 random trips: 1,000 whose nets are independent floats, and
  // 1,000 whose nets came out of the BOOKS. The three things that have to
  // be true of every one of them: it terminates (a second pass finds
  // nothing), nobody is left holding more than the currency can pay, and
  // no money is created or destroyed on the way.
  //
  // The second generator is the one that earns its keep, and this test
  // shipped without it. `raw[i] - mean` scatters every remainder to its
  // own arbitrary place, so the largest-remainder rounding inside
  // settle-up is never once asked to choose between EQUALS — and choosing
  // between equals is the only thing that can make a second round
  // necessary (the SNAP note in splits.js is about nothing else). Real
  // books do little else: every share of one expense is an exact k/n of
  // the same 2-decimal number, so a table of four arrives as four
  // remainders that are the same real number and differ only in the last
  // bits of the float. Certifying convergence over floats alone certifies
  // it over a distribution the app cannot produce.
  //
  // The large home values are deliberate rather than padding. The wider a
  // number, the coarser its last bits, so that is where a tie is likeliest
  // to come apart — and nothing stops somebody putting a ₹8,00,000 group
  // booking on a trip, with a percent split putting 100 shares under it.
  let seed = 20260810;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  // Nets as tripBalances makes them: raw k/n fractions of a 2-decimal
  // home value, which is what shareOf returns — not whole minor units.
  const ledgerNets = (ids, decimals) => {
    const members = ids.map((id) => ({ id }));
    // Trip sizes from a street snack to a very large group booking. The
    // ceiling is expressed in MINOR UNITS on purpose: what strains the
    // arithmetic is how many minor units a net is, so ₹1 crore and 10^9
    // dong are one problem, not two. It stops below 10^9 of them because
    // that is where the guarantee itself stops — past there a double
    // cannot tell a tie from a real difference and no tolerance can fix
    // it, which is written down beside TIE in splits.js.
    const ceiling = pick([2e4, 9e5, 4e7, 5e8]) / 10 ** decimals;
    const expenses = Array.from({ length: 1 + Math.floor(rand() * 3) }, (_, i) => {
      const mode = pick(["equal", "shares", "percent"]);
      const parts = {};
      if (mode === "percent") {
        let rest = 100;
        ids.forEach((id, k) => {
          const w = k === ids.length - 1 ? rest : Math.max(1, Math.floor(rand() * (rest - (ids.length - 1 - k))));
          parts[id] = w;
          rest -= w;
        });
      } else {
        for (const id of ids) if (rand() < 0.8) parts[id] = mode === "equal" ? 1 : 1 + Math.floor(rand() * 9);
        if (!Object.keys(parts).length) parts[ids[0]] = 1;
      }
      return {
        id: `e${i}`,
        homeValue: Math.round(rand() * ceiling * 100) / 100,
        paidBy: pick(members).id,
        split: { mode, parts },
      };
    });
    const bal = tripBalances(expenses, members);
    return Object.fromEntries(ids.map((id) => [id, bal[id].net]));
  };

  // Nets that sum to zero, and the mean makes thirds and sevenths, so
  // most of these do not land on a round unit.
  const floatNets = (ids) => {
    const raw = ids.map(() => (rand() - 0.5) * pick([2, 20, 2000]));
    const mean = raw.reduce((a, b) => a + b, 0) / ids.length;
    return Object.fromEntries(ids.map((id, i) => [id, raw[i] - mean]));
  };

  for (let trip = 0; trip < 2000; trip++) {
    const decimals = pick([0, 2, 3]);
    const minor = 10 ** -decimals;
    const n = 3 + Math.floor(rand() * 4);
    const ids = Array.from({ length: n }, (_, i) => `m${i}`);
    const nets = trip % 2 ? ledgerNets(ids, decimals) : floatNets(ids);
    const where = `trip ${trip} (${decimals}dp, ${trip % 2 ? "ledger" : "float"} nets): ${JSON.stringify(nets)}`;

    const transfers = settleUp(nets, decimals);
    const live = ids.filter((id) => nets[id] !== 0).length;
    assert.ok(transfers.length <= Math.max(0, live - 1), `at most N−1 transfers · ${where}`);
    for (const t of transfers) {
      assert.ok(t.amount > 0, `no empty rows · ${where}`);
      // A whole number of minor units. The tolerance has to travel with
      // the number: 1e-6 flat is 1e-6 of a COUNT of minor units, and at
      // ₹1.5 crore that count is 1.5e10, where a double cannot resolve
      // 1e-6 at all — the same fixed-epsilon trap splits.js keeps warning
      // about, one level up in the test.
      const units = t.amount / minor;
      assert.ok(Math.abs(units - Math.round(units)) < 1e-6 + Math.abs(units) * Number.EPSILON * 64,
        `${t.amount} is payable · ${where}`);
    }

    const left = settled(nets, transfers);
    for (const id of ids) {
      assert.ok(Math.abs(left[id]) < minor - 1e-9,
        `${id} left with ${left[id]}, under one minor unit · ${where}`);
    }
    assert.deepEqual(settleUp(left, decimals), [], `nothing left to do · ${where}`);

    const owed = ids.reduce((t, id) => t + Math.max(0, nets[id]), 0);
    const moved = transfers.reduce((t, x) => t + x.amount, 0);
    assert.ok(Math.abs(moved - owed) <= 0.5 * minor * n + Math.abs(owed) * Number.EPSILON * 64,
      `moved ${moved} against ${owed} owed · ${where}`);
  }
});

test("a tie the floats disagree about is still a tie", () => {
  // The remainders that decide largest-remainder rounding were compared by
  // snapping them onto a grid a millionth of a minor unit wide. A grid is
  // not a tolerance: two remainders that are the SAME real number and
  // 3e-8 apart as floats land in one bucket or in two, depending only on
  // where in a bucket they happen to sit. Halves and quarters sit at the
  // middle of one, which is what the power-of-two grid was chosen for —
  // but the books deal in ninths and twenty-sevenths and hundredths, and
  // those land anywhere, edges included.
  //
  // Split the tie and the first round hands its spare minor unit to one
  // member while the second round hands it to another, so the residues
  // stop cancelling and a phantom ₹0.01 comes back — the row v1.45 and
  // the SNAP note above it were both about.
  //
  // A ₹7,70,336.13 group booking, split 4/86/4/1/1/4 percent, every
  // suggested transfer marked paid.
  const members = ["m0", "m1", "m2", "m3", "m4", "m5"].map((id) => ({ id }));
  const expenses = [{ id: "e1", homeValue: 770336.13, paidBy: "m0",
    split: { mode: "percent", parts: { m0: 4, m1: 86, m2: 4, m3: 1, m4: 1, m5: 4 } } }];

  const first = settleUp(tripBalances(expenses, members), 2);
  const after = tripBalances(expenses, members, first.map((t, i) => ({ id: `p${i}`, ...t })));
  assert.deepEqual(settleUp(after, 2), [], "the booking settles, and stays settled");
  for (const [id, net] of Object.entries(roundedNets(after, 2))) {
    assert.equal(net, 0, `${id} is still shown owing ${net} after All settled`);
  }
});

test("marking every transfer paid settles the REAL books in one round", () => {
  // The property test above hands settle-up nets built by hand, which are
  // clean floats. The books hand it thirds and sevenths straight out of
  // shareOf, and then hand back its own rounded transfers as recorded
  // payments — nets carrying the arithmetic noise of everything that made
  // them. Three friends and one ₹100 dinner: b and c each pay ₹33.33, and
  // the ₹0.0067 of residue left over used to come back as a phantom
  // "c → a ₹0.01", because the remainders that decide the rounding tied
  // in real arithmetic but differed by 1.7e-13 as floats, so the "round
  // the half toward the smaller net" rule never fired.
  const settleRound = (expenses, members, payments, decimals) =>
    settleUp(tripBalances(expenses, members, payments), decimals);
  const asPayments = (transfers) => transfers.map((t, i) => ({ id: `p${i}`, ...t }));

  const three = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const dinner = [{ id: "e1", homeValue: 100, paidBy: "a",
    split: { mode: "equal", parts: { a: 1, b: 1, c: 1 } } }];
  const first = settleRound(dinner, three, [], 2);
  assert.equal(first.length, 2, "two friends owe the payer");
  assert.deepEqual(settleRound(dinner, three, asPayments(first), 2), [],
    "and then ₹100 three ways is settled");

  // 600 ordinary trips: 2–8 members, a few equal-split expenses, on a
  // 0-, 2- and 3-decimal home currency.
  let seed = 20260810;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  for (let trip = 0; trip < 600; trip++) {
    const decimals = pick([0, 2, 3]);
    const n = 2 + Math.floor(rand() * 7);
    const members = Array.from({ length: n }, (_, i) => ({ id: `m${i}` }));
    const expenses = Array.from({ length: 1 + Math.floor(rand() * 5) }, (_, i) => {
      const parts = {};
      for (const m of members) if (rand() < 0.8) parts[m.id] = 1;
      if (!Object.keys(parts).length) parts[members[0].id] = 1;
      return {
        id: `e${i}`,
        homeValue: Math.round(rand() * pick([100, 5000, 200000]) * 100) / 100,
        paidBy: pick(members).id,
        split: { mode: "equal", parts },
      };
    });
    const where = `trip ${trip} (${decimals}dp, ${n} members)`;

    const transfers = settleRound(expenses, members, [], decimals);
    const left = settleRound(expenses, members, asPayments(transfers), decimals);
    assert.deepEqual(left, [], `one round settles it · ${where}`);
  }
});

test("the balances list agrees with settle-up — nobody is chased for a phantom payment", () => {
  // TC-2: the summary sheet printed "All settled 🎉" and, in the balances
  // section directly beneath it, a row reading "owes ¥1". The transfer
  // list rounds to whole minor units; the balances row was judged against
  // a hardcoded 0.01, which is a hundredth of a YEN — so the sub-minor-unit
  // residue settle-up is allowed to leave read as a real debt. ¥2 split
  // three ways, with every suggested transfer marked paid.
  const members = [{ id: "a" }, { id: "b" }, { id: "c" }];
  const expenses = [{ id: "e1", homeValue: 2, paidBy: "a",
    split: { mode: "equal", parts: { a: 1, b: 1, c: 1 } } }];
  const first = settleUp(tripBalances(expenses, members), 0);
  const after = tripBalances(expenses, members, first.map((t, i) => ({ id: `p${i}`, ...t })));

  assert.deepEqual(settleUp(after, 0), [], "settle-up says the trip is closed");
  const rows = roundedNets(after, 0);
  for (const id of ["a", "b", "c"]) {
    assert.equal(rows[id], 0, `${id} is still shown owing ${rows[id]} after All settled`);
  }
});

test("every balances row is exactly what the transfers move for that member", () => {
  // The stronger form of the rule, and the guard against over-correcting
  // it: a row may not be silenced just because it is small. A member's
  // printed net has to equal the money settle-up actually asks them to
  // hand over or collect — 1,000 random trips across 0-, 2- and
  // 3-decimal currencies, at scales where real debts and pure rounding
  // residue both occur.
  let seed = 20260811;
  const rand = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const pick = (arr) => arr[Math.floor(rand() * arr.length)];

  for (let trip = 0; trip < 1000; trip++) {
    const decimals = pick([0, 2, 3]);
    const n = 2 + Math.floor(rand() * 6);
    const ids = Array.from({ length: n }, (_, i) => `m${i}`);
    const raw = ids.map(() => (rand() - 0.5) * pick([2, 20, 2000]));
    const mean = raw.reduce((a, b) => a + b, 0) / n;
    // Nets that sum to zero the way real books do, with thirds and
    // sevenths in them rather than tidy units.
    const nets = Object.fromEntries(ids.map((id, i) => [id, raw[i] - mean]));
    const where = `trip ${trip} (${decimals}dp, ${n} members): ${JSON.stringify(nets)}`;

    const rows = roundedNets(nets, decimals);
    const moved = Object.fromEntries(ids.map((id) => [id, 0]));
    for (const t of settleUp(nets, decimals)) {
      moved[t.from] -= t.amount;
      moved[t.to] += t.amount;
    }
    for (const id of ids) {
      assert.ok(Math.abs(rows[id] - moved[id]) < 1e-9,
        `${id} row says ${rows[id]}, transfers move ${moved[id]} · ${where}`);
    }
  }
});

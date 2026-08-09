// What an expense is worth. Every case here is a bug that shipped.
import { test } from "node:test";
import assert from "node:assert/strict";
import { priceExpense, currencyOptions, whyBlocked } from "../js/pricing.js";

const RATES = { INR: 1, EUR: 0.011, JPY: 1.8, THB: 0.4 };
const saved = (over = {}) => ({
  id: "e1", amount: 100, code: "EUR", homeValue: 9090.91, homeCode: "INR", ...over,
});

test("editing anything OTHER than the money keeps the original snapshot", () => {
  // Renaming an expense three weeks later used to re-price a dinner
  // everyone had already settled around, at today's rate.
  const out = priceExpense({
    previous: saved(), amount: 100, code: "EUR", homeCurrency: "INR", rates: RATES,
  });
  assert.equal(out.homeValue, 9090.91);
  assert.equal(out.locked, true, "and the sheet must SAY it is locked");
});

test("changing the amount re-prices; changing the currency re-prices", () => {
  assert.equal(priceExpense({ previous: saved(), amount: 200, code: "EUR",
    homeCurrency: "INR", rates: RATES }).locked, false);
  assert.equal(priceExpense({ previous: saved(), amount: 100, code: "THB",
    homeCurrency: "INR", rates: RATES }).locked, false);
});

test("changing the HOME currency re-prices — the value is in that currency", () => {
  const out = priceExpense({ previous: saved(), amount: 100, code: "EUR",
    homeCurrency: "JPY", rates: RATES });
  assert.equal(out.locked, false);
  assert.ok(Math.abs(out.homeValue - (100 / 0.011) * 1.8) < 0.01);
});

test("a new expense is always priced fresh", () => {
  const out = priceExpense({ previous: null, amount: 50, code: "EUR",
    homeCurrency: "INR", rates: RATES });
  assert.equal(out.locked, false);
  assert.ok(Math.abs(out.homeValue - 50 / 0.011) < 0.01);
});

test("no rates means no value — never a guess", () => {
  assert.equal(priceExpense({ previous: null, amount: 50, code: "EUR",
    homeCurrency: "INR", rates: null }).homeValue, null);
  // …but an untouched existing expense still knows what it's worth.
  assert.equal(priceExpense({ previous: saved(), amount: 100, code: "EUR",
    homeCurrency: "INR", rates: null }).homeValue, 9090.91);
});

test("a corrupt stored value is re-priced rather than trusted", () => {
  const out = priceExpense({ previous: saved({ homeValue: null }), amount: 100,
    code: "EUR", homeCurrency: "INR", rates: RATES });
  assert.equal(out.locked, false);
  assert.ok(Number.isFinite(out.homeValue));
});

// ---------- the picker ----------

test("the expense's own currency is always offered, even if the trip dropped it", () => {
  // Drop EUR from a trip that has EUR expenses and the option list had
  // no match: the browser selected the first entry while the record kept
  // EUR, so retyping the amount saved ¥25 as €25. A 180x error with the
  // wrong currency on screen throughout.
  const opts = currencyOptions("EUR", ["JPY", "USD"], "INR");
  assert.equal(opts[0], "EUR", "and first, so it is what's selected");
  assert.deepEqual(opts, ["EUR", "JPY", "USD", "INR"]);
});

test("no duplicates when the currency is already on the trip or is home", () => {
  assert.deepEqual(currencyOptions("JPY", ["JPY", "USD"], "INR"), ["JPY", "USD", "INR"]);
  assert.deepEqual(currencyOptions("INR", ["INR"], "INR"), ["INR"]);
  assert.deepEqual(currencyOptions(undefined, ["JPY"], "INR"), ["JPY", "INR"]);
});

// ---------- the disabled Save button IS the error message ----------

test("Save says what it is waiting for, in the order you'd fill the form", () => {
  const base = { name: "Dinner", amount: 100, homeValue: 9090, paidBy: "me", splitValid: true };
  assert.equal(whyBlocked(base), "");
  assert.equal(whyBlocked({ ...base, name: "  " }), "Name this expense");
  assert.equal(whyBlocked({ ...base, amount: 0 }), "Enter an amount");
  assert.equal(whyBlocked({ ...base, amount: null }), "Enter an amount");
  assert.equal(whyBlocked({ ...base, homeValue: null }), "Need rates once — go online");
  assert.equal(whyBlocked({ ...base, paidBy: "" }), "Choose who paid");
  assert.equal(whyBlocked({ ...base, splitValid: false }), "Fix the split");
});

test("a negative amount is not an amount", () => {
  assert.equal(whyBlocked({ name: "x", amount: -5, homeValue: 1, paidBy: "me", splitValid: true }),
    "Enter an amount");
});

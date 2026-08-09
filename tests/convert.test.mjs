import { test } from "node:test";
import assert from "node:assert/strict";
import { convert, applyMarkup, parseAmount, formatAmount, plainAmount, groupInput, dedupe } from "../js/convert.js";

// Rates are always against one base (USD here, rates[USD] === 1).
const RATES = { USD: 1, EUR: 0.9, CZK: 22.5, HUF: 360, INR: 83.1 };

test("converts through the base currency", () => {
  assert.equal(convert(100, "EUR", "CZK", RATES), (100 / 0.9) * 22.5);
  assert.equal(convert(1, "USD", "INR", RATES), 83.1);
  assert.equal(convert(83.1, "INR", "USD", RATES), 1);
});

test("round-trips without drift beyond float noise", () => {
  const there = convert(1234.56, "EUR", "HUF", RATES);
  const back = convert(there, "HUF", "EUR", RATES);
  assert.ok(Math.abs(back - 1234.56) < 1e-9);
});

test("returns null for unknown currencies or bad amounts", () => {
  assert.equal(convert(100, "XXX", "EUR", RATES), null);
  assert.equal(convert(100, "EUR", "XXX", RATES), null);
  assert.equal(convert(NaN, "EUR", "CZK", RATES), null);
  assert.equal(convert(100, "EUR", "CZK", null), null);
});

test("street-rate markup reduces the received amount", () => {
  assert.equal(applyMarkup(200, 3), 194);
  assert.equal(applyMarkup(200, 0), 200);
});

test("parseAmount accepts human input, commas are separators", () => {
  assert.equal(parseAmount("1,234.56"), 1234.56);
  assert.equal(parseAmount("1,234"), 1234);
  assert.equal(parseAmount("12."), 12);
  assert.equal(parseAmount(".5"), 0.5);
  assert.equal(parseAmount(" 42 "), 42);
  assert.equal(parseAmount("0"), 0);
});

test("groupInput live-formats while preserving typed decimals", () => {
  assert.equal(groupInput("1234567", "en-US"), "1,234,567");
  assert.equal(groupInput("1234.5", "en-US"), "1,234.5");
  assert.equal(groupInput("12.", "en-US"), "12.");   // trailing dot kept mid-typing
  assert.equal(groupInput("0.75", "en-US"), "0.75");
  assert.equal(groupInput(".5", "en-US"), ".5");
  assert.equal(groupInput("1,234", "en-US"), "1,234"); // idempotent
  assert.equal(groupInput("007", "en-US"), "7");
});

test("parseAmount rejects garbage", () => {
  assert.equal(parseAmount(""), null);
  assert.equal(parseAmount("abc"), null);
  assert.equal(parseAmount("1.2.3"), null);
  assert.equal(parseAmount("-5"), null);
  assert.equal(parseAmount("1e5"), null);
  assert.equal(parseAmount("."), null);
});

test("formats per currency convention", () => {
  assert.equal(formatAmount(1234.567, "EUR", "en-US"), "1,234.57");
  assert.equal(formatAmount(1234.567, "HUF", "en-US"), "1,235"); // whole numbers
  assert.equal(formatAmount(1234.567, "JPY", "en-US"), "1,235");
  assert.equal(formatAmount(1.23456, "KWD", "en-US"), "1.235"); // 3-decimal dinar
  assert.equal(formatAmount(NaN, "EUR", "en-US"), "");
});

test("plainAmount keeps whole numbers intact", () => {
  assert.equal(plainAmount(1000, "EUR"), "1000");
  assert.equal(plainAmount(1234.5, "EUR"), "1234.5");
  assert.equal(plainAmount(1234.5, "HUF"), "1235");
});

test("dedupe preserves order — France + Netherlands → one EUR", () => {
  assert.deepEqual(dedupe(["EUR", "EUR", "CZK", "HUF", "EUR"]), ["EUR", "CZK", "HUF"]);
});

// ---------- a comma is not always a thousands separator ----------

test("a decimal comma is read as a decimal point, not 100x the amount", () => {
  // Reported by audit: "12,50" typed on a European or Vietnamese keyboard
  // became 1250, and in an expense that number is snapshotted into
  // everyone's debt permanently.
  assert.equal(parseAmount("12,50"), 12.5);
  assert.equal(parseAmount("0,5"), 0.5);
  assert.equal(parseAmount("1.234,56"), 1234.56);
  assert.equal(parseAmount("1,234.56"), 1234.56);
});

test("grouping still parses as grouping", () => {
  assert.equal(parseAmount("1,234"), 1234);      // 3 digits after = a group
  assert.equal(parseAmount("1,20,000"), 120000); // Indian grouping
  assert.equal(parseAmount("12,345,678"), 12345678);
});

test("the field shows the same number the app computed", () => {
  // groupInput and parseAmount must agree, or you type one amount and
  // the app charges another.
  for (const typed of ["12,50", "1.234,56", "1,234", "1,20,000", "0,5"]) {
    const shown = groupInput(typed, "en-IN");
    assert.equal(parseAmount(shown), parseAmount(typed), `disagreed on "${typed}"`);
  }
});

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

test("separators follow the locale, never the shape of the text", () => {
  // v1.45 inferred them from the text: a lone comma with 1-2 trailing
  // digits was read as a decimal point. That misread the app's OWN
  // output — backspacing "1,234" to "1,23" gave 1.23 for an amount meant
  // as 1234, a 1000x error. the project's internal notes had recorded this exact
  // conflict as the reason not to do it.
  // A lone group separator trailed by 1-2 digits is a DECIMAL point:
  // grouping never produces that shape, so reading it as grouping was a
  // 100x error on any European price. v1.49 asserted 123 here.
  assert.equal(parseAmount("1,23", "en-IN"), 1.23);
  assert.equal(parseAmount("1,234", "en-US"), 1234);
  assert.equal(parseAmount("1.234", "de-DE"), 1234);
  assert.equal(parseAmount("1.234,56", "de-DE"), 1234.56);
  assert.equal(parseAmount("1,234.56", "en-US"), 1234.56);
  assert.equal(parseAmount("1,20,000", "en-IN"), 120000);
});

test("THE invariant: the field's own output re-parses to the same number", () => {
  // If this ever fails, the app shows one number and charges another.
  // On dot-grouping locales v1.45 turned our own "1.000.000" into null.
  for (const locale of ["en-IN", "en-US", "de-DE", "fr-FR", "vi-VN", "pt-BR"]) {
    for (const typed of ["1234", "1000000", "12345.6", "0.5", "12", "1234567.89"]) {
      const shown = groupInput(typed, locale);
      assert.equal(parseAmount(shown, locale), parseAmount(typed, locale),
        `${locale} disagreed on "${typed}" (showed "${shown}")`);
    }
  }
});

test("a European price typed on any keypad reads as the price", () => {
  // "2,50" from a menu means two-fifty everywhere. Grouping never leaves
  // two digits, so this shape cannot be grouping — and crucially it is a
  // shape groupInput cannot emit, so reading it as a decimal can never
  // misread the app's own output.
  assert.equal(parseAmount("2,50", "en-IN"), 2.5);
  assert.equal(parseAmount("2,50", "en-US"), 2.5);
  assert.equal(parseAmount("2,50", "de-DE"), 2.5);
  assert.equal(parseAmount("1234.50", "de-DE"), 1234.5, "a typed dot on a comma locale");
  // Real grouping is still grouping.
  assert.equal(parseAmount("1,234", "en-US"), 1234);
  assert.equal(parseAmount("1.234", "de-DE"), 1234);
  assert.equal(parseAmount("12,345,678", "en-US"), 12345678);
});

test("non-Latin digits are read, not rejected", () => {
  // Intl formats ar-EG in Arabic-Indic digits, which parseAmount's
  // ASCII-only test rejected — so the field froze after one keystroke
  // and no expense above 9 units could be entered at all.
  assert.equal(parseAmount("١٢٣٤", "ar-EG"), 1234);
  assert.equal(parseAmount("১,২৩৪", "bn-IN"), 1234);
});

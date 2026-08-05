import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSharedText, parsePaymentQR } from "../js/parse.js";
import { lakhGloss, slipCheck, pocketRule, pocketExamples, currencyForTimeZone, stampText } from "../js/insights.js";
import { formatAmount, localeFor } from "../js/convert.js";

// ---------- shared text ----------

test("parses an amount with an explicit currency code", () => {
  assert.deepEqual(parseSharedText("the transfer is 4,500 CZK"), { amount: 4500, code: "CZK" });
  assert.deepEqual(parseSharedText("EUR 38.50 per night"), { amount: 38.5, code: "EUR" });
});

test("parses currency symbols, preferring what's on screen", () => {
  assert.deepEqual(parseSharedText("that'll be €38"), { amount: 38, code: "EUR" });
  assert.deepEqual(parseSharedText("1450 Ft"), { amount: 1450, code: "HUF" });
  // "kr" is Swedish, Norwegian, Danish and Icelandic — the trip decides.
  assert.equal(parseSharedText("500 kr", ["NOK"]).code, "NOK");
  assert.equal(parseSharedText("500 kr", ["DKK"]).code, "DKK");
});

test("a bare number parses with no currency attached", () => {
  assert.deepEqual(parseSharedText("just 250 for the taxi"), { amount: 250, code: null });
});

test("text with no number yields nothing", () => {
  assert.equal(parseSharedText("see you tomorrow!"), null);
  assert.equal(parseSharedText(""), null);
  assert.equal(parseSharedText(undefined), null);
});

// ---------- payment QR codes ----------

test("reads an EMVCo merchant QR (currency tag 53, amount tag 54)", () => {
  // [id][2-digit length][value]: 53→currency 764 (THB), 54→amount "420.50"
  const payload = "000201" + "010211" + "5303764" + "5406420.50" + "6304ABCD";
  assert.deepEqual(parsePaymentQR(payload), { amount: 420.5, code: "THB" });
});

test("an EMVCo code with no amount still reveals the currency", () => {
  const payload = "000201010211" + "5303360" + "6304ABCD"; // 360 = IDR
  const out = parsePaymentQR(payload);
  assert.equal(out.code, "IDR");
  assert.equal(out.amount, null);
});

test("reads a UPI link", () => {
  assert.deepEqual(parsePaymentQR("upi://pay?pa=shop@bank&am=250.00&cu=INR"), { amount: 250, code: "INR" });
});

test("a non-payment QR falls back to plain text parsing", () => {
  assert.deepEqual(parsePaymentQR("Total: 890 CZK"), { amount: 890, code: "CZK" });
  assert.equal(parsePaymentQR("https://example.com/menu"), null);
});

// ---------- Indian formatting ----------

test("INR groups the Indian way, other currencies don't", () => {
  assert.equal(localeFor("INR"), "en-IN");
  assert.equal(formatAmount(120000, "INR"), "1,20,000.00");
  assert.equal(formatAmount(120000, "EUR", "en-US"), "120,000.00");
});

test("lakh and crore glosses appear only when they help", () => {
  assert.equal(lakhGloss(99999), "");
  assert.equal(lakhGloss(120000), "1.2 lakh");
  assert.equal(lakhGloss(100000), "1 lakh");
  assert.equal(lakhGloss(12000000), "1.2 crore");
  assert.equal(lakhGloss(NaN), "");
});

// ---------- decimal-slip guard ----------

test("flags an order-of-magnitude outlier against the trip's own history", () => {
  const samples = [1200, 900, 1500, 1100];
  assert.equal(slipCheck({ amount: 1300, homeAmount: 320, samples }), null);
  const hit = slipCheck({ amount: 50000, homeAmount: 12000, samples });
  assert.equal(hit.reason, "outlier");
  assert.equal(hit.suggestion, 5000);
});

test("flags a very large home-currency amount even with no history", () => {
  const hit = slipCheck({ amount: 500000, homeAmount: 120000, samples: [] });
  assert.equal(hit.reason, "big");
  assert.equal(hit.suggestion, 50000);
});

test("stays quiet on normal amounts and thin history", () => {
  assert.equal(slipCheck({ amount: 5000, homeAmount: 1200, samples: [] }), null);
  assert.equal(slipCheck({ amount: 90000, homeAmount: 900, samples: [100, 200] }), null);
  assert.equal(slipCheck({ amount: 0, homeAmount: 0, samples: [] }), null);
});

// ---------- pocket rule ----------

test("picks a memorable multiplier within 3%", () => {
  const r = pocketRule(3.6); // 1 CZK ≈ ₹3.6
  assert.equal(r.op, "×");
  assert.ok(r.errorPct <= 3, `error ${r.errorPct}`);
  assert.ok([3.5, 3.6].includes(r.factor), `factor ${r.factor}`);
});

test("uses division when the rate is small", () => {
  const r = pocketRule(0.25); // 1 HUF ≈ ₹0.25 → "÷ 4"
  assert.equal(r.op, "÷");
  assert.equal(r.factor, 4);
});

test("examples scale to the currency's magnitude", () => {
  const big = pocketExamples(0.25); // forint: thousands
  assert.equal(big[0].local, 1000);
  assert.ok(Math.abs(big[0].home - 250) < 1);
  const small = pocketExamples(109); // euro: single units
  assert.equal(small[0].local, 1);
  assert.equal(pocketRule(0), null);
  assert.deepEqual(pocketExamples(-1), []);
});

// ---------- permission-free location ----------

test("maps device timezones to currencies via city and country data", () => {
  assert.equal(currencyForTimeZone("Europe/Budapest"), "HUF");
  assert.equal(currencyForTimeZone("Europe/Prague"), "CZK");
  assert.equal(currencyForTimeZone("Asia/Bangkok"), "THB");
  assert.equal(currencyForTimeZone("Asia/Kolkata"), "INR");
  assert.equal(currencyForTimeZone("Asia/Calcutta"), "INR"); // legacy zone name
  assert.equal(currencyForTimeZone("Asia/Ho_Chi_Minh"), "VND"); // prefix match
  assert.equal(currencyForTimeZone("Europe/Zagreb"), "EUR"); // override
  assert.equal(currencyForTimeZone("Asia/Tokyo"), "JPY");
});

test("the fetch stamp names the exact time and the reader's timezone", () => {
  const at = Date.UTC(2026, 7, 5, 8, 2); // 5 Aug 2026, 08:02 UTC
  const s = stampText(at, { locale: "en-GB", timeZone: "Asia/Kolkata" });
  assert.match(s, /5 Aug 2026/);
  assert.match(s, /13:32/); // UTC+5:30, en-GB is 24-hour
  assert.match(s, /Asia\/Kolkata/);
  const prague = stampText(at, { locale: "en-GB", timeZone: "Europe/Prague" });
  assert.match(prague, /10:02/); // UTC+2
  assert.match(prague, /Europe\/Prague/);
  assert.equal(stampText(NaN), "");
});

test("unknown or malformed timezones resolve to nothing", () => {
  assert.equal(currencyForTimeZone("Antarctica/Troll"), null);
  assert.equal(currencyForTimeZone("UTC"), null);
  assert.equal(currencyForTimeZone(""), null);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { parseSharedText, parsePaymentQR } from "../js/parse.js";
import { lakhGloss, slipCheck, pocketRule, pocketExamples, currencyForTimeZone, stampText,
  toDatetimeLocal, fromDatetimeLocal, initialHomeCurrency } from "../js/insights.js";
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

test("shared text is read in the format the person shared it in", () => {
  // Text arriving from another app is written by a human, in whatever
  // format their phone and their country use. Pinning it to en-US read a
  // German "1.500 EUR" as one and a half euros — a thousandfold error,
  // landing in a shared ledger where the home value is snapshotted at
  // save and never re-priced.
  assert.deepEqual(parseSharedText("1.500 EUR", [], "de-DE"), { amount: 1500, code: "EUR" });
  assert.deepEqual(parseSharedText("Total 1.234,56 EUR", [], "de-DE"), { amount: 1234.56, code: "EUR" });
  assert.deepEqual(parseSharedText("€1.234,56", [], "de-DE"), { amount: 1234.56, code: "EUR" });
  // A bare number takes the same route.
  assert.deepEqual(parseSharedText("dinner was 1.500", [], "de-DE"), { amount: 1500, code: null });
  // …and the en-US reading of the same shapes is untouched.
  assert.deepEqual(parseSharedText("1,500 EUR", [], "en-US"), { amount: 1500, code: "EUR" });
  assert.deepEqual(parseSharedText("Total 1,234.56 EUR", [], "en-US"), { amount: 1234.56, code: "EUR" });
  assert.deepEqual(parseSharedText("€1,234.56", [], "en-US"), { amount: 1234.56, code: "EUR" });
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

test("machine formats read the same on every device", () => {
  // UPI "am=" and EMVCo tag 54 are dot-decimal with no grouping, by
  // specification. Reading them in the device's locale turned "1234.50"
  // into 123450 on any comma-decimal phone; that must stay impossible
  // whatever locale the rest of the app is working in.
  const emv = "000201" + "010211" + "5303356" + "54061234.50" + "6304ABCD"; // 356 = INR
  for (const locale of ["de-DE", "pt-BR", "id-ID", "en-US"]) {
    assert.deepEqual(parsePaymentQR("upi://pay?pa=asha@example&am=1234.50&cu=INR", [], locale),
      { amount: 1234.5, code: "INR" }, `UPI under ${locale}`);
    assert.deepEqual(parsePaymentQR(emv, [], locale),
      { amount: 1234.5, code: "INR" }, `EMVCo under ${locale}`);
  }
});

test("the QR fallback to free text keeps the caller's locale", () => {
  // A photographed menu or receipt is not a payment code, so it lands in
  // parseSharedText — which is human text again, and must not inherit
  // the machine pin on the way through.
  assert.deepEqual(parsePaymentQR("Total: 1.500 EUR", [], "de-DE"), { amount: 1500, code: "EUR" });
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

// ---------- what money a first launch opens in ----------

test("a first launch opens in the money of the country the device is set to", () => {
  // The bug: every new install on earth opened in INR, because that was
  // the stored default and nothing derived anything.
  assert.equal(initialHomeCurrency({ locale: "pt-BR" }), "BRL");
  assert.equal(initialHomeCurrency({ locale: "de-DE" }), "EUR");
});

test("with no country in the locale, the timezone answers", () => {
  // "en" alone says nothing about where anybody is. The timezone is the
  // same permission-free signal the HERE badge already uses.
  assert.equal(initialHomeCurrency({ locale: "en", timeZone: "Europe/Lisbon" }), "EUR");
});

test("the locale beats the timezone, deliberately", () => {
  // This is a TRAVEL app. The timezone says where you are standing, and
  // the home currency is the one setting that must not follow the plane:
  // somebody in Ho Chi Minh City for a fortnight has not stopped settling
  // up in dollars. The locale is the closest thing the device has to a
  // statement about where the money comes from.
  assert.equal(initialHomeCurrency({ locale: "en-US", timeZone: "Asia/Ho_Chi_Minh" }), "USD");
});

test("a device that says nothing useful keeps the old default", () => {
  // INR stops being the assumption and becomes the fallback — the answer
  // when both signals are silent, not the answer before either is asked.
  assert.equal(initialHomeCurrency({}), "INR");
  assert.equal(initialHomeCurrency({ locale: "xx-ZZ" }), "INR");
  assert.equal(initialHomeCurrency(), "INR");
  assert.equal(initialHomeCurrency({ locale: "en", fallback: "USD" }), "USD");
});

test("the app derives it once, at the head of boot, from two signals only", () => {
  // The wiring is the half no behaviour test can see (tests/callsites.mjs
  // is here for the same reason), and this one has to be right about
  // WHEN as well as what: after anything has written settings, the
  // derivation would be looking at a record this launch created.
  const SRC = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
  const calls = SRC.split("\n").filter((l) => l.includes("seedHomeCurrency("));
  assert.equal(calls.length, 1, `seedHomeCurrency is called ${calls.length} times`);
  assert.match(calls[0], /initialHomeCurrency\(/, "the currency is worked out by the pure module");
  assert.match(calls[0], /settings =/, "…and the answer has to come back into memory");

  const boot = SRC.slice(SRC.indexOf("function boot()"), SRC.indexOf("\n}\n", SRC.indexOf("function boot()")));
  assert.ok(boot.includes("seedHomeCurrency("), "it belongs at the head of boot()");
  assert.ok(boot.indexOf("seedHomeCurrency(") < boot.indexOf("renderInvitation()"),
    "…before the first render, and before anything else writes settings");

  // The two signals, named. No user agent, no geolocation, no network:
  // a currency guess is not worth a permission prompt, and a request
  // that has to succeed before the first paint is a broken first launch
  // on a bad connection.
  assert.match(SRC, /const DEVICE_LOCALE = new Intl\.NumberFormat\(\)\.resolvedOptions\(\)\.locale/);
  assert.match(SRC, /const DEVICE_TZ = new Intl\.DateTimeFormat\(\)\.resolvedOptions\(\)\.timeZone/);
  assert.match(calls[0], /locale: DEVICE_LOCALE/);
  assert.match(calls[0], /timeZone: DEVICE_TZ/);
  assert.ok(!/geolocation/.test(SRC), "location is a permission prompt, not a signal");
});

test("nothing is read from the environment behind the caller's back", () => {
  // currencyForTimeZone() falls back to the device's own timezone when
  // asked for nothing; this must not, or the "locale only" case would
  // silently answer with wherever the machine happens to be — a
  // different answer on every device, and untestable.
  const SRC = readFileSync(new URL("../js/insights.js", import.meta.url), "utf8");
  const body = SRC.slice(SRC.indexOf("export function initialHomeCurrency"),
    SRC.indexOf("\n}\n", SRC.indexOf("export function initialHomeCurrency")));
  assert.ok(!/Intl\./.test(body), "the two signals are arguments, not lookups");
  assert.equal(initialHomeCurrency({ locale: "en", timeZone: undefined }), "INR");
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

// ---------- expense timestamps (datetime-local round trip) ----------

test("timestamp survives a round trip through the datetime-local format", () => {
  const ts = new Date(2026, 7, 5, 14, 31).getTime(); // local 5 Aug 2026, 14:31
  assert.equal(toDatetimeLocal(ts), "2026-08-05T14:31");
  assert.equal(fromDatetimeLocal("2026-08-05T14:31"), ts);
});

test("datetime-local helpers reject garbage", () => {
  assert.equal(toDatetimeLocal(NaN), "");
  assert.equal(toDatetimeLocal(undefined), "");
  assert.equal(fromDatetimeLocal(""), null);
  assert.equal(fromDatetimeLocal(null), null);
  assert.equal(fromDatetimeLocal("not-a-date"), null);
});

test("single-digit months, days, hours and minutes are zero-padded", () => {
  const ts = new Date(2026, 0, 3, 4, 5).getTime();
  assert.equal(toDatetimeLocal(ts), "2026-01-03T04:05");
});

// ---------- auth error messages (phase D3.2) ----------

test("auth errors are translated into something a human can act on", async () => {
  const { authErrorMessage } = await import("../js/firebase.js");
  assert.match(authErrorMessage("auth/invalid-credential"), /don't match/);
  assert.match(authErrorMessage("auth/email-already-in-use"), /sign in instead/);
  assert.match(authErrorMessage("auth/weak-password"), /6 characters/);
  assert.match(authErrorMessage("auth/network-request-failed"), /connection/);
  // A provider that was never switched on in the console is a setup
  // mistake, not a user mistake — say so plainly.
  assert.match(authErrorMessage("auth/operation-not-allowed"), /isn't switched on/);
});

test("a cancelled sign-in popup is not reported as an error", () => {
  // The user changed their mind. Shouting "Sign-in failed!" would be wrong.
  return import("../js/firebase.js").then(({ authErrorMessage }) => {
    assert.equal(authErrorMessage("auth/popup-closed-by-user"), "");
    assert.equal(authErrorMessage("auth/cancelled-popup-request"), "");
  });
});

test("an unrecognised auth code still yields a usable message", async () => {
  const { authErrorMessage } = await import("../js/firebase.js");
  assert.ok(authErrorMessage("auth/some-future-code").length > 0);
  assert.ok(authErrorMessage(undefined).length > 0);
});

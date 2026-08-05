// Derived intelligence over the conversion basics: Indian number glosses, the
// decimal-slip guard, memorable pocket rules, and permission-free location.

import { CURRENCIES, ALL_CODES } from "./currencies.js";

const trim1 = (n) => n.toFixed(1).replace(/\.0$/, "");

// "1.2 lakh" / "3 crore" — how an Indian reader actually says a big number.
// Empty below a lakh, where plain grouping reads fine.
export function lakhGloss(value) {
  if (!Number.isFinite(value) || value < 1e5) return "";
  if (value >= 1e7) return `${trim1(value / 1e7)} crore`;
  return `${trim1(value / 1e5)} lakh`;
}

function median(values) {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

// Catch a slipped zero before it reaches an ATM keypad. Fires only on
// order-of-magnitude surprises so it stays rare enough to be believed.
// Returns { reason, suggestion } or null.
export function slipCheck({ amount, homeAmount, samples = [], bigThreshold = 1e5 }) {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const typical = median(samples.filter((v) => Number.isFinite(v) && v > 0));
  if (samples.length >= 3 && typical > 0 && amount >= typical * 10) {
    return { reason: "outlier", suggestion: amount / 10 };
  }
  if (Number.isFinite(homeAmount) && homeAmount >= bigThreshold) {
    return { reason: "big", suggestion: amount / 10 };
  }
  return null;
}

// A multiplier you can hold in your head. Uses division for small rates
// ("÷ 4" beats "× 0.25"), and picks the simplest factor within 3%.
const STEPS = [1, 0.5, 0.25, 0.1, 0.05, 0.01];
export function pocketRule(rate) {
  if (!Number.isFinite(rate) || rate <= 0) return null;
  const divide = rate < 0.5;
  const base = divide ? 1 / rate : rate;
  for (const step of STEPS) {
    const factor = Math.round(base / step) * step;
    if (factor <= 0) continue;
    const errorPct = (Math.abs(factor - base) / base) * 100;
    if (errorPct <= 3) {
      return { op: divide ? "÷" : "×", factor: Number(factor.toFixed(2)), errorPct };
    }
  }
  return { op: divide ? "÷" : "×", factor: Number(base.toFixed(2)), errorPct: 0 };
}

// Round local amounts worth memorising, scaled so the first one is ~100 of
// the home currency.
export function pocketExamples(rate, count = 4) {
  if (!Number.isFinite(rate) || rate <= 0) return [];
  const magnitude = Math.pow(10, Math.round(Math.log10(100 / rate)));
  return [1, 2, 5, 10].slice(0, count).map((m) => ({
    local: m * magnitude,
    home: m * magnitude * rate,
  }));
}

// Timezones whose city/country isn't in the currency data, or that use a
// legacy name. Everything else resolves from the cities we already ship.
const TZ_OVERRIDES = {
  "Asia/Calcutta": "INR", "Asia/Kolkata": "INR", "Asia/Katmandu": "NPR",
  "Asia/Kathmandu": "NPR", "Europe/Tirane": "ALL", "Europe/Zagreb": "EUR",
  "Europe/Bratislava": "EUR", "Europe/Ljubljana": "EUR", "Europe/Riga": "EUR",
  "Europe/Vilnius": "EUR", "Europe/Tallinn": "EUR", "Asia/Nicosia": "EUR",
  "Europe/Monaco": "EUR", "Europe/Andorra": "EUR", "Europe/Podgorica": "EUR",
  "Asia/Rangoon": "MMK", "Asia/Saigon": "VND", "Asia/Macau": "HKD",
  "Europe/Isle_of_Man": "GBP", "Europe/Jersey": "GBP", "Europe/Guernsey": "GBP",
  "Africa/Marrakech": "MAD", "Asia/Dacca": "BDT",
};

// Where you are, with no permission prompt and no network: the device
// timezone names a city, and the currency data already knows its cities.
export function currencyForTimeZone(tz) {
  const zone = tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (typeof zone !== "string" || !zone.includes("/")) return null;
  if (TZ_OVERRIDES[zone]) return TZ_OVERRIDES[zone];
  const place = zone.split("/").pop().replace(/_/g, " ").toLowerCase();
  const names = (code) => [
    ...(CURRENCIES[code].cities ?? []),
    ...CURRENCIES[code].countries,
  ].map((s) => s.toLowerCase());
  for (const code of ALL_CODES) {
    if (names(code).includes(place)) return code;
  }
  // "Asia/Ho_Chi_Minh" vs our "Ho Chi Minh City"
  for (const code of ALL_CODES) {
    if (names(code).some((n) => n.startsWith(place))) return code;
  }
  return null;
}

// Exactly when the rates were fetched, in the reader's own timezone —
// "5 Aug 2026, 1:32 pm · GMT+5:30 · Asia/Calcutta".
export function stampText(fetchedAt, { locale, timeZone } = {}) {
  if (!Number.isFinite(fetchedAt)) return "";
  const tz = timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const date = new Date(fetchedAt);
  const when = date.toLocaleString(locale, {
    day: "numeric", month: "short", year: "numeric",
    hour: "numeric", minute: "2-digit", timeZone: tz,
  });
  const abbr = new Intl.DateTimeFormat(locale, { timeZone: tz, timeZoneName: "short" })
    .formatToParts(date).find((p) => p.type === "timeZoneName")?.value ?? "";
  return `${when} · ${abbr} · ${tz}`;
}

// Country label for the detected currency, for the "you're in X" prompt.
export function placeLabel(tz) {
  const zone = tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  return typeof zone === "string" && zone.includes("/")
    ? zone.split("/").pop().replace(/_/g, " ")
    : "";
}

// Derived intelligence over the conversion basics: Indian number glosses, the
// decimal-slip guard, memorable pocket rules, and permission-free location.

import { CURRENCIES, ALL_CODES, currencyForRegion } from "./currencies.js";

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

// The region subtag of a BCP 47 tag: "pt-BR" → "BR", "zh-Hans-CN" → "CN",
// "en" → null. Read by hand rather than with Intl.Locale, which throws on
// tags this will be handed straight off a device.
//
// The stop at a one-character subtag is the whole reason this is not a
// regex: "-u-" and friends open an extension, and "en-u-ca-buddhist"
// would otherwise offer "ca" as a country.
function regionOf(locale) {
  if (typeof locale !== "string") return null;
  for (const part of locale.replace(/_/g, "-").split("-").slice(1)) {
    if (part.length === 1) break;
    if (/^[A-Za-z]{2}$/.test(part)) return part.toUpperCase();
    if (/^\d{3}$/.test(part)) return null; // UN M.49 ("es-419") names no country
  }
  return null;
}

// What money a brand-new install should open in, from what the device
// already says about itself. Both signals are ARGUMENTS: nothing is read
// from Intl in here, so this is testable and gives the same answer on
// every machine (js/app.js does the reading — ADR-0001's split).
//
// The TIMEZONE beats the locale, and an earlier version of this had it the
// other way round.
//
// The old reasoning was that a travel app must not let the home currency
// follow the plane — somebody spending a fortnight in Vietnam has not
// stopped settling up at home. That is sound about RE-deriving and wrong
// here, because this runs once, as a first-launch default, and people
// install an app at home far more often than mid-trip.
//
// What it cost: `en-US` is the world's default phone language, set on
// hundreds of millions of devices outside America. Reported from an Indian
// phone in Asia/Calcutta that opened on USD, and the same bug gave GBP
// users dollars. A language tag says what somebody reads; a timezone says
// where the phone is. Only one of those is a claim about location.
//
// The locale still answers when there is no timezone, and the caller's
// fallback ("INR" in js/store.js) when the device says nothing at all —
// that value is the last resort, not the answer for everybody on earth.
export function initialHomeCurrency({ locale, timeZone, fallback = "INR" } = {}) {
  // Only when one was handed over: currencyForTimeZone() reads the
  // device's own zone when asked for nothing, which would make this
  // depend on the machine it runs on.
  const byZone = typeof timeZone === "string" ? currencyForTimeZone(timeZone) : null;
  if (byZone) return byZone;
  return currencyForRegion(regionOf(locale)) ?? fallback;
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

// Timestamp ↔ <input type="datetime-local"> value ("2026-08-05T14:31"),
// always in the device's local time — what the input natively speaks.
export function toDatetimeLocal(ts) {
  if (!Number.isFinite(ts)) return "";
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
    `T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function fromDatetimeLocal(value) {
  if (typeof value !== "string" || !value) return null;
  const ts = new Date(value).getTime(); // bare "YYYY-MM-DDTHH:mm" parses as local time
  return Number.isFinite(ts) ? ts : null;
}

// Country label for the detected currency, for the "you're in X" prompt.
export function placeLabel(tz) {
  const zone = tz ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  return typeof zone === "string" && zone.includes("/")
    ? zone.split("/").pop().replace(/_/g, " ")
    : "";
}

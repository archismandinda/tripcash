// Pure conversion + formatting logic. No DOM, no storage — unit-testable.

import { CURRENCIES } from "./currencies.js";

// rates maps currency code → units per 1 base currency (rates[base] === 1).
// Any conversion goes through the base: amount / rates[from] * rates[to].
export function convert(amount, from, to, rates) {
  const rFrom = rates?.[from];
  const rTo = rates?.[to];
  if (!Number.isFinite(amount) || !rFrom || !rTo) return null;
  return (amount / rFrom) * rTo;
}

// Street-exchange markup: you receive pct% less than mid-market.
export function applyMarkup(value, pct) {
  if (!Number.isFinite(value) || !Number.isFinite(pct)) return value;
  return value * (1 - pct / 100);
}

// Work out what a comma MEANS before stripping it.
//
// Commas were unconditionally treated as thousands separators, which is
// right for "1,234" but silently multiplies a European or Vietnamese
// amount by 100: "12,50" became 1250. In the converter that only costs a
// second look; in an expense it is snapshotted into everyone's debt.
//
// The rules are the unambiguous ones only:
//  - both separators present: the LAST one is the decimal point, so
//    "1.234,56" and "1,234.56" both mean 1234.56;
//  - one comma with 1 or 2 digits after it and none before a dot: a
//    decimal point ("12,50" = 12.5). Grouping always leaves exactly 3.
//  - anything else — "1,234", "1,20,000" — stays grouping.
export function canonicalAmount(text) {
  const s = String(text).replace(/\s/g, "");
  const lastComma = s.lastIndexOf(",");
  const lastDot = s.lastIndexOf(".");
  if (lastComma >= 0 && lastDot >= 0) {
    const decimal = lastComma > lastDot ? "," : ".";
    return s.split(decimal === "," ? "." : ",").join("").replace(",", ".");
  }
  if (lastComma >= 0 && s.indexOf(",") === lastComma && /^\d*,\d{1,2}$/.test(s)) {
    return s.replace(",", ".");
  }
  return s.replace(/,/g, "");
}

// Parse user-typed amount. Accepts "1,234.56", "12.", ".5", "12,50".
// Returns a finite number ≥ 0, or null if the text isn't a usable amount.
export function parseAmount(text) {
  if (typeof text !== "string") return null;
  const s = canonicalAmount(text);
  if (!/^\d*\.?\d*$/.test(s) || s === "." || s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Live-format a partially typed amount with grouping separators, leaving the
// decimal part exactly as typed ("1234.5" → "1,234.5", "12." → "12.").
// Input must already be a valid parseAmount string.
export function groupInput(text, locale) {
  // Same reading of the separators as parseAmount, or the field would
  // show one number while the app computed another.
  const s = canonicalAmount(text);
  const dot = s.indexOf(".");
  let intPart = dot === -1 ? s : s.slice(0, dot);
  const rest = dot === -1 ? "" : s.slice(dot);
  intPart = intPart.replace(/^0+(?=\d)/, "");
  const grouped = intPart
    ? new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Number(intPart))
    : "";
  return grouped + rest;
}

// Grouping conventions that differ from the device default. INR uses the
// Indian system: 1,20,000 rather than 120,000.
const LOCALES = { INR: "en-IN" };
export const localeFor = (code) => LOCALES[code];

// Format per-currency: HUF/JPY etc. whole numbers, dinars 3dp, most 2dp.
export function formatAmount(value, code, locale) {
  if (!Number.isFinite(value)) return "";
  const decimals = CURRENCIES[code]?.decimals ?? 2;
  return new Intl.NumberFormat(locale ?? localeFor(code), {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

// Unformatted plain-number string (for editing a field in place).
export function plainAmount(value, code) {
  if (!Number.isFinite(value)) return "";
  const decimals = CURRENCIES[code]?.decimals ?? 2;
  // Trim trailing zeros only after the decimal point ("1234.50" → "1234.5").
  return value.toFixed(decimals).replace(/(\.\d*?)0+$/, "$1").replace(/\.$/, "");
}

// Deduplicate currency codes, preserving first-seen order.
export function dedupe(codes) {
  return [...new Set(codes)];
}

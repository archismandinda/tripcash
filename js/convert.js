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

// Parse user-typed amount. Accepts "1,234.56", "12.", "3,5" (comma decimal).
// Returns a finite number ≥ 0, or null if the text isn't a usable amount.
export function parseAmount(text) {
  if (typeof text !== "string") return null;
  let s = text.trim().replace(/\s/g, "");
  if (!s) return null;
  // Both separators present → comma is a thousands separator; comma alone → decimal.
  if (s.includes(".") ) s = s.replace(/,/g, "");
  else s = s.replace(/,/g, ".");
  if (!/^\d*\.?\d*$/.test(s) || s === "." || s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Format per-currency: HUF/JPY etc. whole numbers, dinars 3dp, most 2dp.
export function formatAmount(value, code, locale) {
  if (!Number.isFinite(value)) return "";
  const decimals = CURRENCIES[code]?.decimals ?? 2;
  return new Intl.NumberFormat(locale, {
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

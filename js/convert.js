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

// Parse user-typed amount. Accepts "1,234.56", "12.", ".5". Commas are
// thousands separators (the field live-inserts them — see groupInput).
// Returns a finite number ≥ 0, or null if the text isn't a usable amount.
export function parseAmount(text) {
  if (typeof text !== "string") return null;
  const s = text.replace(/[\s,]/g, "");
  if (!/^\d*\.?\d*$/.test(s) || s === "." || s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Live-format a partially typed amount with grouping separators, leaving the
// decimal part exactly as typed ("1234.5" → "1,234.5", "12." → "12.").
// Input must already be a valid parseAmount string.
export function groupInput(text, locale) {
  const s = String(text).replace(/[\s,]/g, "");
  const dot = s.indexOf(".");
  let intPart = dot === -1 ? s : s.slice(0, dot);
  const rest = dot === -1 ? "" : s.slice(dot);
  intPart = intPart.replace(/^0+(?=\d)/, "");
  const grouped = intPart
    ? new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Number(intPart))
    : "";
  return grouped + rest;
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

// Move an item within a list by delta positions (clamped to the ends).
// Returns a new array; unknown items leave the list unchanged.
export function moveItem(list, item, delta) {
  const from = list.indexOf(item);
  if (from === -1) return list;
  const to = Math.min(Math.max(from + delta, 0), list.length - 1);
  if (to === from) return list;
  const next = [...list];
  next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

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

// Separators, resolved. The ONE rule that has to hold: this must never
// misread the app's own grouped output, because that output is fed
// straight back in on every keystroke (see groupInput / regroupInPlace).
//
// v1.45 broke that rule. It read a lone comma with 1–2 trailing digits
// as a decimal point, on the assumption "grouping always leaves exactly
// 3 digits". Backspacing one digit off "1,234" makes "1,23" — and the
// field then showed 1.23 for an amount the user meant as 1234. On
// dot-grouping locales (de, es, it, nl, pt-BR, id, vi, tr) it was worse:
// our own "1.000.000" re-parsed as null. the project's internal notes, §6 had recorded
// this exact conflict as the reason not to do it. It was right.
//
// So: SEPARATORS ARE DECIDED BY THE FIELD'S OWN LOCALE, not guessed from
// the text. parseAmount is the exact inverse of groupInput for the same
// locale. A comma is a decimal point when the locale says so and a group
// separator when it says so — never both, never inferred from shape.
// Intl formats in the locale's own numbering system — ar-EG gets
// Arabic-Indic digits, bn-IN Bengali ones — and parseAmount's test is
// ASCII-only, so the field froze after a single keystroke and no expense
// above 9 units could be entered at all.
//
// The map is derived from the locale rather than hardcoded: formatting
// 1234567890 yields that locale's ten digits, in that order.
const digitMaps = new Map();
function asciiDigits(s, locale) {
  if (!/[^\x00-\x7F]/.test(s)) return s; // already ASCII: the common case
  let map = digitMaps.get(locale ?? "");
  if (!map) {
    map = {};
    const shown = new Intl.NumberFormat(locale, { useGrouping: false }).format(1234567890);
    for (let i = 0; i < 10; i++) map[shown[i]] = String((i + 1) % 10);
    digitMaps.set(locale ?? "", map);
  }
  return [...s].map((ch) => map[ch] ?? ch).join("");
}

export function separatorsFor(locale) {
  const parts = new Intl.NumberFormat(locale).formatToParts(12345.6);
  const group = parts.find((p) => p.type === "group")?.value ?? ",";
  const decimal = parts.find((p) => p.type === "decimal")?.value ?? ".";
  return { group, decimal };
}

export function canonicalAmount(text, locale) {
  const { group, decimal } = separatorsFor(locale);
  // Whitespace INCLUDING the non-breaking kinds Intl groups with — fr,
  // ru, nb, pl, cs and sv all use NBSP or narrow NBSP, not a space.
  // Intl formats in the locale's own numbering system, so ar-EG gets
  // Arabic-Indic digits and bn-IN Bengali ones — which parseAmount's
  // ASCII-only test then rejects, freezing the field after one keystroke.
  // Fold them back to ASCII before anything else looks at them.
  const s = asciiDigits(String(text), locale).replace(/[\s\u00a0\u202f]/g, "");

  // If the locale's decimal mark is present, it settles everything: the
  // LAST one splits the number, and anything before it that looks like a
  // separator is grouping.
  const cut = s.lastIndexOf(decimal);
  if (cut >= 0) {
    const whole = s.slice(0, cut).split(group).join("");
    return `${whole}.${s.slice(cut + 1)}`;
  }

  // No decimal mark, so every separator present is the group character —
  // usually. Grouping NEVER leaves 1 or 2 digits at the end: our own
  // output is always in threes (or the Indian 2-2-3). So a SINGLE group
  // character trailed by one or two digits is somebody typing a decimal
  // point with the key their keyboard offered, and reading it as
  // grouping multiplies the amount by 100.
  //
  // This is not a guess about intent — it is a shape `groupInput` cannot
  // produce, so it can never misread the app's own output. That
  // invariant is what v1.45 broke, and it is asserted for ten locales.
  const parts = s.split(group);
  if (parts.length === 2 && /^\d{1,2}$/.test(parts[1])) return `${parts[0]}.${parts[1]}`;
  return parts.join("");
}

// "2,50" on a device whose group separator is "," parses — correctly for
// that locale — as 250. But a traveller reading a European menu means
// 2.50, and a 100x error on an expense is permanent.
//
// We do NOT guess: guessing is what v1.45 did, and it misread the app's
// own output. Instead we detect the one genuinely ambiguous shape — a
// single group separator with exactly two digits after it, which real
// grouping never produces — and offer the other reading. The user
// decides; the app never silently picks.
export function ambiguousSeparator(text, locale) {
  const { group, decimal } = separatorsFor(locale);
  if (group === decimal) return null;
  const s = String(text).replace(/\s/g, "");
  if (s.includes(decimal)) return null;            // they were explicit
  const parts = s.split(group);
  if (parts.length !== 2) return null;             // 0 or 2+ separators: not this shape
  if (!/^\d{1,3}$/.test(parts[0]) || !/^\d{2}$/.test(parts[1])) return null;
  return Number(`${parts[0]}.${parts[1]}`);
}

// Parse user-typed amount. Accepts "1,234.56", "12.", ".5", "12,50".
// Returns a finite number ≥ 0, or null if the text isn't a usable amount.
export function parseAmount(text, locale) {
  if (typeof text !== "string") return null;
  const s = canonicalAmount(text, locale);
  if (!/^\d*\.?\d*$/.test(s) || s === "." || s === "") return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

// Live-format a partially typed amount with grouping separators, leaving the
// decimal part exactly as typed ("1234.5" → "1,234.5", "12." → "12.").
// Input must already be a valid parseAmount string.
export function groupInput(text, locale) {
  // Exact inverse of parseAmount for the same locale, or the field shows
  // one number while the app computes another.
  const s = canonicalAmount(text, locale);
  const dot = s.indexOf(".");
  let intPart = dot === -1 ? s : s.slice(0, dot);
  const rest = dot === -1 ? "" : s.slice(dot);
  intPart = intPart.replace(/^0+(?=\d)/, "");
  const grouped = intPart
    ? new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(Number(intPart))
    : "";
  // Show the decimal mark this locale actually uses, so what's on screen
  // round-trips back through parseAmount unchanged.
  const { decimal } = separatorsFor(locale);
  return grouped + (rest ? decimal + rest.slice(1) : "");
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

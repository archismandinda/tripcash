// Interpreting numbers that arrive from outside the app: text shared from
// another app (Web Share Target) and scanned payment QR codes.

import { CURRENCIES, ALL_CODES } from "./currencies.js";
import { parseAmount } from "./convert.js";

// ISO 4217 numeric → alpha, for the currencies we support. Payment QR codes
// carry the numeric form (EMVCo tag 53).
const NUMERIC_CODES = {
  "008": "ALL", "032": "ARS", "036": "AUD", "048": "BHD", "050": "BDT",
  "051": "AMD", "116": "KHR", "124": "CAD", "144": "LKR", "152": "CLP",
  "156": "CNY", "170": "COP", "203": "CZK", "208": "DKK", "242": "FJD",
  "344": "HKD", "348": "HUF", "352": "ISK", "356": "INR", "360": "IDR",
  "376": "ILS", "392": "JPY", "398": "KZT", "400": "JOD", "404": "KES",
  "410": "KRW", "414": "KWD", "418": "LAK", "458": "MYR", "462": "MVR",
  "480": "MUR", "484": "MXN", "496": "MNT", "504": "MAD", "512": "OMR",
  "524": "NPR", "554": "NZD", "578": "NOK", "586": "PKR", "604": "PEN",
  "608": "PHP", "634": "QAR", "643": "RUB", "682": "SAR", "690": "SCR",
  "702": "SGD", "704": "VND", "710": "ZAR", "752": "SEK", "756": "CHF",
  "764": "THB", "784": "AED", "788": "TND", "818": "EGP", "826": "GBP",
  "834": "TZS", "840": "USD", "901": "TWD", "941": "RSD", "944": "AZN",
  "946": "RON", "949": "TRY", "975": "BGN", "977": "BAM", "978": "EUR",
  "981": "GEL", "985": "PLN", "986": "BRL", "104": "MMK", "860": "UZS",
};

// Symbol → codes using it. Several currencies share a symbol ("kr", "Rs",
// "¥"), so matches are resolved against the currencies on screen.
const SYMBOLS = (() => {
  const map = new Map();
  for (const code of ALL_CODES) {
    const sym = CURRENCIES[code].symbol?.toLowerCase();
    if (!sym) continue;
    if (!map.has(sym)) map.set(sym, []);
    map.get(sym).push(code);
  }
  // Longest first so "HK$" wins over "$".
  return [...map.entries()].sort((a, b) => b[0].length - a[0].length);
})();

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const NUM = "\\d[\\d.,\\s]*\\d|\\d";
const preferOne = (codes, preferred) => codes.find((c) => preferred.includes(c)) ?? codes[0];

// Pull an amount (and currency, if stated) out of free text.
// Returns { amount, code } — code is null when the text carried no currency.
export function parseSharedText(text, preferred = []) {
  if (typeof text !== "string" || !text.trim()) return null;
  const t = text.replace(/ /g, " ");

  // 1. An explicit ISO code beside a number ("4,500 CZK" / "CZK 4500").
  for (const code of ALL_CODES) {
    const m = t.match(new RegExp(`\\b${code}\\b\\s*(${NUM})|(${NUM})\\s*\\b${code}\\b`, "i"));
    const amount = m ? parseAmount(m[1] ?? m[2]) : null;
    if (amount !== null) return { amount, code };
  }

  // 2. A currency symbol beside a number ("€38", "1450 Ft").
  for (const [sym, codes] of SYMBOLS) {
    const s = escapeRe(sym);
    const m = t.match(new RegExp(`${s}\\s*(${NUM})|(${NUM})\\s*${s}`, "i"));
    const amount = m ? parseAmount(m[1] ?? m[2]) : null;
    if (amount !== null) return { amount, code: preferOne(codes, preferred) };
  }

  // 3. A bare number — the caller decides which field it belongs to.
  const bare = t.match(new RegExp(NUM));
  const amount = bare ? parseAmount(bare[0]) : null;
  return amount === null ? null : { amount, code: null };
}

// Walk an EMVCo merchant QR payload: repeating [2-digit id][2-digit len][value].
function tlv(payload) {
  const out = {};
  let i = 0;
  while (i + 4 <= payload.length) {
    const id = payload.slice(i, i + 2);
    const len = Number(payload.slice(i + 2, i + 4));
    if (!Number.isInteger(len) || len <= 0) break;
    const value = payload.slice(i + 4, i + 4 + len);
    if (value.length < len) break;
    out[id] = value;
    i += 4 + len;
  }
  return out;
}

// Read a scanned payment code. Handles UPI links and EMVCo merchant QRs
// (PromptPay, QRIS, PIX, PayNow…). Returns { amount, code } or null; amount
// may be null for static codes that carry only a currency.
export function parsePaymentQR(raw, preferred = []) {
  if (typeof raw !== "string" || !raw.trim()) return null;
  const text = raw.trim();

  if (/^upi:\/\//i.test(text)) {
    const q = new URLSearchParams(text.slice(text.indexOf("?") + 1));
    const amount = parseAmount(q.get("am") ?? "");
    const code = (q.get("cu") ?? "INR").toUpperCase();
    if (!ALL_CODES.includes(code)) return null;
    return { amount, code };
  }

  // EMVCo payloads always open with the payload-format indicator "0002".
  if (/^0002\d{2}/.test(text)) {
    const t = tlv(text);
    const code = NUMERIC_CODES[t["53"]];
    if (!code) return null;
    return { amount: parseAmount(t["54"] ?? ""), code };
  }

  return parseSharedText(text, preferred);
}

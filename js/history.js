// 30-day rate history for the per-currency chart.
// Source: Frankfurter (ECB reference rates) — free, keyless, but only ~30
// major currencies. Pairs outside that set simply have no chart (see ADR-0004).

import { getHistoryCache, setHistoryCache } from "./store.js";

export const HISTORY_CODES = new Set([
  "AUD", "BGN", "BRL", "CAD", "CHF", "CNY", "CZK", "DKK", "EUR", "GBP",
  "HKD", "HUF", "IDR", "ILS", "INR", "ISK", "JPY", "KRW", "MXN", "MYR",
  "NOK", "NZD", "PHP", "PLN", "RON", "SEK", "SGD", "THB", "TRY", "USD", "ZAR",
]);

export const historySupported = (base, quote) =>
  HISTORY_CODES.has(base) && HISTORY_CODES.has(quote);

const MAX_AGE_MS = 12 * 60 * 60 * 1000;

const iso = (d) => d.toISOString().slice(0, 10);

// Returns { series: [[dateStr, rate], …], live } or null (unsupported pair /
// never fetched and offline). Series is sorted by date, ~22 ECB trading days.
export async function loadHistory(base, quote, now = Date.now()) {
  if (!historySupported(base, quote)) return null;
  const key = `${base}->${quote}`;
  const cache = getHistoryCache();
  const hit = cache[key];
  if (hit && now - hit.fetchedAt < MAX_AGE_MS) return { series: hit.series, live: true };
  try {
    const end = new Date(now);
    const start = new Date(now - 30 * 24 * 60 * 60 * 1000);
    const url = `https://api.frankfurter.dev/v1/${iso(start)}..${iso(end)}?base=${base}&symbols=${quote}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const series = Object.entries(data.rates ?? {})
      .map(([date, r]) => [date, r[quote]])
      .filter(([, v]) => Number.isFinite(v))
      .sort((a, b) => (a[0] < b[0] ? -1 : 1));
    if (series.length < 2) throw new Error("empty series");
    cache[key] = { fetchedAt: now, series };
    setHistoryCache(cache);
    return { series, live: true };
  } catch {
    return hit ? { series: hit.series, live: false } : null;
  }
}

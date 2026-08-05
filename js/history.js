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
// One fetch per pair covers every range: a cold request to this service takes
// 4–16s, so asking again per range is what made charts look broken.
const WINDOW_DAYS = 365;
const TIMEOUT_MS = 25000;

const iso = (d) => d.toISOString().slice(0, 10);

// Trim a full series down to the requested window. Trading days only, so a
// short window can be sparse — never return fewer than two points to plot.
export function sliceDays(series, days, now = Date.now()) {
  const cutoff = iso(new Date(now - days * 24 * 60 * 60 * 1000));
  const within = series.filter(([date]) => date >= cutoff);
  return within.length >= 2 ? within : series.slice(-2);
}

// Returns { series: [[dateStr, rate], …], live } or null (unsupported pair /
// never fetched and offline). Series is sorted by date, ECB trading days only.
async function fetchSeries(base, quote, now) {
  const end = new Date(now);
  const start = new Date(now - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const url = `https://api.frankfurter.dev/v1/${iso(start)}..${iso(end)}?base=${base}&symbols=${quote}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  const series = Object.entries(data.rates ?? {})
    .map(([date, r]) => [date, r[quote]])
    .filter(([, v]) => Number.isFinite(v))
    .sort((a, b) => (a[0] < b[0] ? -1 : 1));
  if (series.length < 2) throw new Error("empty series");
  return series;
}

export async function loadHistory(base, quote, days = 30, now = Date.now()) {
  if (!historySupported(base, quote)) return null;
  const key = `${base}->${quote}`;
  const cache = getHistoryCache();
  const hit = cache[key];
  const usable = hit?.series?.length >= 2;
  if (usable && now - hit.fetchedAt < MAX_AGE_MS) {
    return { series: sliceDays(hit.series, days, now), live: true };
  }
  // The upstream is slow when its cache is cold and fast once warmed, so a
  // second attempt usually succeeds where the first timed out.
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const series = await fetchSeries(base, quote, now);
      cache[key] = { fetchedAt: now, series };
      setHistoryCache(cache);
      return { series: sliceDays(series, days, now), live: true };
    } catch {
      // fall through to the retry, then to whatever we already have
    }
  }
  return usable ? { series: sliceDays(hit.series, days, now), live: false } : null;
}

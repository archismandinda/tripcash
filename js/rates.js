// Live rate fetching with a 6-hour freshness window and cache fallback.
// API: open.er-api.com — free, no key, 160+ currencies, daily updates.

import { getRates, setRates } from "./store.js";

const API_URL = "https://open.er-api.com/v6/latest/USD";
export const MAX_AGE_MS = 6 * 60 * 60 * 1000;

export function isFresh(cached, now = Date.now()) {
  return !!cached && now - cached.fetchedAt < MAX_AGE_MS;
}

async function fetchLive() {
  const res = await fetch(API_URL);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  if (data.result !== "success" || typeof data.rates !== "object") {
    throw new Error("bad payload");
  }
  const payload = { base: data.base_code, fetchedAt: Date.now(), rates: data.rates };
  setRates(payload);
  return payload;
}

// Returns { data, live } — data is the freshest rates we could get (cached
// object or null), live is false when we're running on cache/offline.
export async function loadRates() {
  const cached = getRates();
  if (isFresh(cached)) return { data: cached, live: true };
  try {
    return { data: await fetchLive(), live: true };
  } catch {
    return { data: cached, live: false }; // offline or API down → silent fallback
  }
}

// Human age string for the status bar: "just now", "34m ago", "2h ago", "3d ago".
export function ageString(fetchedAt, now = Date.now()) {
  const mins = Math.floor((now - fetchedAt) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

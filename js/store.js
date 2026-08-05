// All localStorage access lives here. Every read is guarded so corrupt or
// missing data falls back to safe defaults instead of breaking the app.

const KEYS = {
  settings: "tripcash:settings",
  trips: "tripcash:trips",
  rates: "tripcash:rates",
  history: "tripcash:history",
  expenses: "tripcash:expenses",
  settlements: "tripcash:settlements",
};

function read(key, fallback) {
  try {
    const raw = globalThis.localStorage.getItem(key);
    if (raw == null) return fallback;
    const parsed = JSON.parse(raw);
    return parsed ?? fallback;
  } catch {
    return fallback;
  }
}

function write(key, value) {
  try {
    globalThis.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage full or unavailable — the app keeps working in memory.
  }
}

const DEFAULT_SETTINGS = {
  homeCurrency: "INR",
  activeTripId: null,
  markupOn: false,
  markupPct: 3,
  theme: "auto", // "auto" | "light" | "dark"
  pinnedTripId: null, // pinned trip always opens expanded on launch
};

export function getSettings() {
  const s = read(KEYS.settings, {});
  return { ...DEFAULT_SETTINGS, ...(typeof s === "object" && s !== null ? s : {}) };
}

export function setSettings(patch) {
  const next = { ...getSettings(), ...patch };
  write(KEYS.settings, next);
  return next;
}

export function getTrips() {
  const t = read(KEYS.trips, []);
  if (!Array.isArray(t)) return [];
  // Keep only well-formed trips so one bad record can't break rendering.
  return t.filter(
    (trip) =>
      trip && typeof trip.id === "string" && typeof trip.name === "string" &&
      Array.isArray(trip.currencies)
  );
}

export function setTrips(trips) {
  write(KEYS.trips, trips);
}

export function getRates() {
  const r = read(KEYS.rates, null);
  if (!r || typeof r.base !== "string" || typeof r.fetchedAt !== "number" ||
      typeof r.rates !== "object" || r.rates === null) return null;
  return r;
}

export function setRates(payload) {
  write(KEYS.rates, payload);
}

// Trip expenses (see js/splits.js for the shape). One flat array with
// tripId on each record, so deleting a trip can sweep its expenses.
export function getExpenses() {
  const e = read(KEYS.expenses, []);
  if (!Array.isArray(e)) return [];
  return e.filter(
    (x) =>
      x && typeof x.id === "string" && typeof x.tripId === "string" &&
      typeof x.name === "string" && Number.isFinite(x.amount) &&
      Number.isFinite(x.homeValue) && typeof x.paidBy === "string" &&
      x.split && typeof x.split.parts === "object"
  );
}

export function setExpenses(expenses) {
  write(KEYS.expenses, expenses);
}

// Settle-up payments members made to each other, in home currency.
// { id, tripId, from, to, amount, createdAt } — flat like expenses, so
// deleting a trip can sweep them the same way.
export function getSettlements() {
  const s = read(KEYS.settlements, []);
  if (!Array.isArray(s)) return [];
  return s.filter(
    (p) =>
      p && typeof p.id === "string" && typeof p.tripId === "string" &&
      typeof p.from === "string" && typeof p.to === "string" &&
      Number.isFinite(p.amount) && p.amount > 0 && Number.isFinite(p.createdAt)
  );
}

export function setSettlements(settlements) {
  write(KEYS.settlements, settlements);
}

// 30-day chart cache: { "EUR->INR": { fetchedAt, series: [[date, rate], …] } }
export function getHistoryCache() {
  const h = read(KEYS.history, {});
  return typeof h === "object" && h !== null && !Array.isArray(h) ? h : {};
}

export function setHistoryCache(cache) {
  // Keep only the 8 most recently fetched pairs so the cache stays small.
  const entries = Object.entries(cache)
    .filter(([, v]) => v && typeof v.fetchedAt === "number" && Array.isArray(v.series))
    .sort((a, b) => b[1].fetchedAt - a[1].fetchedAt)
    .slice(0, 8);
  write(KEYS.history, Object.fromEntries(entries));
}

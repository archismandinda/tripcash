// All localStorage access lives here. Every read is guarded so corrupt or
// missing data falls back to safe defaults instead of breaking the app.

import { stampCollection, pruneTombstones, pruneAttribution } from "./merge.js";
import { syncedChanged } from "./prefs.js";

const KEYS = {
  settings: "tripcash:settings",
  trips: "tripcash:trips",
  rates: "tripcash:rates",
  history: "tripcash:history",
  expenses: "tripcash:expenses",
  settlements: "tripcash:settlements",
  tombstones: "tripcash:tombstones",
  notices: "tripcash:notices",
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

// A write that fails must be HEARD. Safari's Private Browsing throws on
// every setItem, and a full quota does the same: the row rendered, the
// stamp came back, and a day of expenses was gone when the tab closed
// without anyone being told. This project's own lesson list opens with
// "a silent failure cost two round trips" — this was the biggest one
// left, and it was on the write path for money.
let onWriteFailure = null;
export function setStorageFailureHandler(fn) {
  onWriteFailure = fn;
}

let warned = false;

function write(key, value) {
  try {
    globalThis.localStorage.setItem(key, JSON.stringify(value));
    warned = false;
    return true;
  } catch (err) {
    // The app keeps working in memory — but this session is now the only
    // copy, so say so. Once per run of failures, not once per keystroke.
    if (!warned) {
      warned = true;
      onWriteFailure?.(err);
    }
    return false;
  }
}

const DEFAULT_SETTINGS = {
  homeCurrency: "INR",
  activeTripId: null,
  markupOn: false,
  markupPct: 3,
  theme: "auto", // "auto" | "light" | "dark"
  pinnedTripId: null, // pinned trip always opens expanded on launch
  syncHint: false, // was this device signed in? gates loading the Firebase SDK
};

export function getSettings() {
  const s = read(KEYS.settings, {});
  return { ...DEFAULT_SETTINGS, ...(typeof s === "object" && s !== null ? s : {}) };
}

export function setSettings(patch) {
  const before = getSettings();
  const next = { ...before, ...patch };
  // Stamp only when a preference that TRAVELS changed. Stamping on every
  // settings write — opening a trip card, recording a sync time — would
  // make this device win every merge for no reason.
  //
  // Two details, both of which were wrong until v1.44:
  //  - Server time, like every other stamp (ADR-0014). On raw Date.now()
  //    a device with a slow clock could never change the home currency:
  //    its edit stamped older than the copy it was replacing and lost.
  //  - A stamp the CALLER supplied wins. Absorbing the other device's
  //    preferences passes their stamp through deliberately; overwriting
  //    it with "now" made this device the newest writer, so it pushed
  //    them straight back and every exchange escalated.
  if (syncedChanged(before, next) && patch.prefsUpdatedAt === undefined) {
    // Server time AND above anything we've already seen — the same
    // Lamport anchor records get (merge.js). Without it a device whose
    // clock runs slow stamps its edit older than the value it is
    // replacing and can never change the home currency: the other
    // device's copy wins every merge and applyPrefs reverts it. The
    // offset is 0 until at least two sync round trips, so this is the
    // normal state on a new device, not an exotic one.
    const seen = Number(before.prefsUpdatedAt) || 0;
    next.prefsUpdatedAt = Math.max(Date.now() + (next.clockOffset ?? 0), seen + 1);
  }
  write(KEYS.settings, next);
  return next;
}

// One definition of "renderable" per collection, shared by the read
// (which filters) and the write (which must NOT treat a filtered record
// as a deletion).
const VALID = {
  trips: (t) =>
    !!t && typeof t.id === "string" && typeof t.name === "string" &&
    Array.isArray(t.currencies),
  expenses: (x) =>
    !!x && typeof x.id === "string" && typeof x.tripId === "string" &&
    typeof x.name === "string" && Number.isFinite(x.amount) &&
    Number.isFinite(x.homeValue) && typeof x.paidBy === "string" &&
    !!x.split && typeof x.split.parts === "object",
  settlements: (p) =>
    !!p && typeof p.id === "string" && typeof p.tripId === "string" &&
    typeof p.from === "string" && typeof p.to === "string" &&
    Number.isFinite(p.amount) && p.amount > 0 && Number.isFinite(p.createdAt),
};

export function getTrips() {
  const t = read(KEYS.trips, []);
  // Keep only well-formed trips so one bad record can't break rendering.
  return Array.isArray(t) ? t.filter(VALID.trips) : [];
}

// ---------- sync bookkeeping (phase D3) ----------
//
// Every synced collection is written through here: records get an updatedAt
// only when they actually changed, and vanished ids become tombstones. One
// choke point means a new feature can't accidentally ship unsyncable data.

// Records the read-time validators reject are still REAL — they are just
// not renderable. They have to survive a save, or the next write diffs
// against them, sees them missing, and tombstones them: one partially
// written record would delete itself for everybody, permanently.
function keepUnreadable(previous, records, collection) {
  const isValid = VALID[collection];
  const kept = new Set(records.map((r) => r?.id));
  const orphans = previous.filter((r) => r?.id && !kept.has(r.id) && !isValid(r));
  return orphans.length ? [...records, ...orphans] : records;
}

// The in-app notification list. Device-local: what you have already read
// on your phone is not something your laptop needs to know.
export function getNotices() {
  const n = read(KEYS.notices, []);
  return Array.isArray(n) ? n : [];
}

export function setNotices(list) {
  write(KEYS.notices, list);
}

export function getTombstones() {
  const t = read(KEYS.tombstones, {});
  return typeof t === "object" && t !== null && !Array.isArray(t) ? t : {};
}

export function setTombstones(tombs) {
  write(KEYS.tombstones, tombs);
}

function writeSynced(key, collection, records) {
  // Stamp in SERVER time. Two devices' wall clocks differ by minutes,
  // and with "newest wins" that means the faster one silently overwrites
  // the slower one's edits — including edits it never saw (ADR-0014).
  const now = Date.now() + (getSettings().clockOffset ?? 0);
  const previous = read(key, []);
  const held = Array.isArray(previous) ? previous : [];
  const tombs = getTombstones();
  const { stamped, deleted } =
    stampCollection(held, keepUnreadable(held, records, collection), collection, now,
      tombs[collection] ?? {});
  write(key, stamped);
  // A record present in this write is ALIVE, so it cannot also be
  // deleted. Clearing its tombstone is what makes Undo stick: the
  // restored record keeps its original stamp (nothing about it changed),
  // and a tombstone outranks anything stamped at or before it — so
  // without this the payment reappears on screen and is deleted again by
  // the very next merge, while on the other phone it never returns.
  const revived = stamped.map((r) => r?.id).filter((id) => tombs[collection]?.[id] != null);

  if (deleted.length || revived.length) {
    const all = tombs;
    const mine = { ...(all[collection] ?? {}) };
    // Which trip's document each deletion belongs in. Recorded HERE and
    // nowhere else, because the record we are about to bury is the last
    // thing that knows — and not knowing is what made every trip's
    // document carry every other trip's deletions.
    const owner = { ...(all.tripOf ?? {}) };
    for (const id of revived) { delete mine[id]; delete owner[id]; }
    const wasThere = new Map(held.filter((r) => r?.id).map((r) => [r.id, r]));
    for (const id of deleted) {
      // A tombstone must outrank the record it buries, so it goes on the
      // SAME clock the records use — one tick past the record being
      // deleted, not raw wall time. A record stamped ahead of this
      // device (a fast phone, or a clock offset not learnt yet) was
      // otherwise undeletable: the delete was written, lost the merge,
      // and the record came straight back.
      // …and never BELOW a tombstone we already hold for this id. A delete
      // arriving from another device is recorded here first and the record
      // dropped from the list, so the next write sees the id vanish and
      // rewrites the tombstone from scratch — on THIS clock, throwing away
      // however far ahead theirs was. That erased the only record of when
      // the delete really happened, and left a revive stamped between the
      // two tombstones: alive here, buried by the copy still in the cloud.
      const buried = Number(wasThere.get(id)?.updatedAt) || 0;
      mine[id] = Math.max(now, buried + 1, Number(mine[id]) || 0);
      const owns = wasThere.get(id)?.tripId;
      if (typeof owns === "string") owner[id] = owns;
    }
    const next = { ...all, [collection]: pruneTombstones(mine, now) };
    setTombstones({ ...next, tripOf: pruneAttribution(owner, next) });
  }
  return stamped;
}

// Returns the STAMPED records. Callers must keep what they hold in
// memory in step with this — see saveTrips() in app.js.
export function setTrips(trips) {
  return writeSynced(KEYS.trips, "trips", trips);
}

// Drop a trip and everything in it WITHOUT recording a deletion.
//
// Deliberately not setTrips(): that path treats a vanished id as a delete
// and writes a tombstone, and syncNow re-asserts trip tombstones to the
// cloud on every later sync. This is the path for a device that has been
// removed from a trip (TC-4) — it has lost the trip, it has not deleted
// it. Tombstoning here would mean that a device wrongly locked out, or
// one whose access was later restored, would destroy the trip for
// everybody else the moment it could write again.
export function forgetTrip(id) {
  const rest = (key, match) => {
    const held = read(key, []);
    write(key, Array.isArray(held) ? held.filter((r) => !match(r)) : []);
  };
  rest(KEYS.trips, (t) => t?.id === id);
  rest(KEYS.expenses, (e) => e?.tripId === id);
  rest(KEYS.settlements, (s) => s?.tripId === id);
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
  return Array.isArray(e) ? e.filter(VALID.expenses) : [];
}

export function setExpenses(expenses) {
  return writeSynced(KEYS.expenses, "expenses", expenses);
}

// Settle-up payments members made to each other, in home currency.
// { id, tripId, from, to, amount, createdAt } — flat like expenses, so
// deleting a trip can sweep them the same way.
export function getSettlements() {
  const s = read(KEYS.settlements, []);
  return Array.isArray(s) ? s.filter(VALID.settlements) : [];
}

export function setSettlements(settlements) {
  return writeSynced(KEYS.settlements, "settlements", settlements);
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

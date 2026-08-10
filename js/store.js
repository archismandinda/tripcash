// All localStorage access lives here. Every read is guarded so corrupt or
// missing data falls back to safe defaults instead of breaking the app.

import { stampCollection, stampRoster, pruneTombstones, pruneAttribution } from "./merge.js";
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
  // Has a trip ever been on this device? Not "is there one now" — the
  // trips list already answers that, and it answers it wrong for the one
  // person who needs a different screen: somebody who has used the app
  // and deleted everything is a traveller between trips, not a stranger
  // to be sold the app again (js/landing.js). Deliberately not synced and
  // never cleared; see setTrips.
  tripEverCreated: false,
  landingDismissed: false, // "Just the converter" — this device, for good
};

export function getSettings() {
  const s = read(KEYS.settings, {});
  return { ...DEFAULT_SETTINGS, ...(typeof s === "object" && s !== null ? s : {}) };
}

// The record as it is actually stored, with NO defaults merged in —
// null when this device has never written one.
//
// getSettings() cannot answer that question, and it is the only question
// that matters before deriving anything: it merges DEFAULT_SETTINGS, so
// "chose INR" and "never chose" come back identical. An unreadable
// record still counts as a record ({}), because somebody whose settings
// are corrupt has still been here.
export function storedSettings() {
  let raw = null;
  try {
    raw = globalThis.localStorage.getItem(KEYS.settings);
  } catch {
    return null;
  }
  if (raw == null) return null;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// Open a brand-new install in the money the device already implies
// (js/insights.js works out which). Returns the settings either way, so
// the caller can keep its copy in step.
//
// Two things this must not do, both of them worse than the default it
// replaces:
//
//  - Run twice, or on anything but a device that has never held this
//    app. "New" is therefore "no settings record AND no trips record",
//    not "homeCurrency is still INR" — that also describes every
//    long-standing user who never opened Settings, and re-basing their
//    home currency would re-base what every settle-up is counted in.
//  - Out-rank a real choice (ADR-0017). prefsUpdatedAt is supplied, so
//    setSettings does not stamp: a new phone that derives EUR and then
//    signs into an account whose home currency is INR must end on INR,
//    not push EUR to every other device the person owns.
export function seedHomeCurrency(code) {
  const settings = getSettings();
  if (!code || code === settings.homeCurrency) return settings;
  if (storedSettings() !== null || read(KEYS.trips, null) !== null) return settings;
  return setSettings({ homeCurrency: code, prefsUpdatedAt: settings.prefsUpdatedAt ?? 0 });
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
  let incoming = keepUnreadable(held, records, collection);
  // The roster is a collection too (ADR-0024): member rows carry their own
  // stamps and their removals their own graves, and both are worked out by
  // DIFFING here rather than at the removal site. js/app.js mutates
  // trip.members in five places and ADR-0008 exists because the site that
  // forgets is the site that ships.
  const roster = collection === "trips"
    ? stampRoster(held, incoming, now, tombs.members ?? {})
    : null;
  if (roster) incoming = roster.trips;
  const { stamped, deleted } =
    stampCollection(held, incoming, collection, now, tombs[collection] ?? {});
  write(key, stamped);
  // A record present in this write is ALIVE, so it cannot also be
  // deleted. Clearing its tombstone is what makes Undo stick: the
  // restored record keeps its original stamp (nothing about it changed),
  // and a tombstone outranks anything stamped at or before it — so
  // without this the payment reappears on screen and is deleted again by
  // the very next merge, while on the other phone it never returns.
  const revived = stamped.map((r) => r?.id).filter((id) => tombs[collection]?.[id] != null);

  // Deliberately NOT extended to members: a member's removal is final
  // within the TTL (see mergeCollection's `finalDeletes`). The revive above
  // exists so a person's Undo sticks; a member row is put back by
  // housekeeping nobody asked for, and planAddMember mints a fresh id for a
  // genuine re-add, so there is nothing here for an Undo to want.

  let next = tombs;
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
    const scoped = { ...all, [collection]: pruneTombstones(mine, now) };
    next = { ...scoped, tripOf: pruneAttribution(owner, scoped) };
  }
  if (roster?.changed) next = { ...next, members: roster.tombstones };
  if (next !== tombs) setTombstones(next);
  return stamped;
}

// Returns the STAMPED records. Callers must keep what they hold in
// memory in step with this — see saveTrips() in app.js.
export function setTrips(trips) {
  const stamped = writeSynced(KEYS.trips, "trips", trips);
  // The one write that is never undone. It is asked of what was HANDED
  // IN, not of `stamped`: keepUnreadable can carry a half-written record
  // through a save of an empty list, and a record nothing can render is
  // not a trip this device ever had.
  //
  // It rides on the save rather than on the create flow because a trip
  // arriving from another device is this device being used too — and a
  // flag written on one path is a flag the other paths forget, which is
  // the exact shape of the invite bug in js/coldopen.js.
  if (trips.length && !getSettings().tripEverCreated) setSettings({ tripEverCreated: true });
  return stamped;
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

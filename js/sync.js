// Sync orchestration (phase D3.3). Pure functions over plain objects —
// the network lives in js/firestore.js — so "what should the merged trip
// look like?" is answered here and unit-tested with a fake remote.
//
// One document per trip carries the trip, its expenses, its settlements
// and its tombstones (ADR-0009); the record-level conflict rules come
// from js/merge.js (ADR-0008).

import { mergeCollection, mergeTombstones } from "./merge.js";

export const SCHEMA = 1;

const stampOf = (rec) => (Number.isFinite(rec?.updatedAt) ? rec.updatedAt : 0);

// Device-local trip fields that must never be uploaded: `lastEdit` is the
// converter's in-progress amount, session-only since v1.21.
const DEVICE_ONLY = ["lastEdit"];

const union = (a = [], b = []) => [...new Set([...a, ...b].filter(Boolean))];

const emptyTombs = (t = {}) => ({
  expenses: t.expenses ?? {},
  settlements: t.settlements ?? {},
});

// Everything this device knows about one trip, in the shape we store.
export function buildPayload({ trip, expenses, settlements, tombstones, uid }) {
  const clean = { ...trip };
  for (const field of DEVICE_ONLY) delete clean[field];
  return {
    schema: SCHEMA,
    trip: clean,
    memberUids: union(trip.memberUids, uid ? [uid] : []),
    ownerUid: trip.ownerUid ?? uid ?? null,
    expenses,
    settlements,
    tombstones: emptyTombs(tombstones),
  };
}

// Reconcile what we have with what the server has. Remote may be null
// (first upload of this trip). Never destructive: a record only vanishes
// because a tombstone outranks it, never because one side hadn't heard
// of it yet.
export function mergePayload(local, remote) {
  if (!remote) return { ...local, schema: SCHEMA };

  // The trip's own fields (name, currencies, members…) are one record.
  const trip = stampOf(remote.trip) > stampOf(local.trip) ? remote.trip : local.trip;

  const expenses = mergeCollection(
    local.expenses, remote.expenses ?? [],
    local.tombstones.expenses, emptyTombs(remote.tombstones).expenses
  );
  const settlements = mergeCollection(
    local.settlements, remote.settlements ?? [],
    local.tombstones.settlements, emptyTombs(remote.tombstones).settlements
  );

  return {
    schema: SCHEMA,
    trip,
    // Membership only ever grows here — dropping a uid would silently
    // evict someone whose own device simply hadn't synced yet.
    memberUids: union(local.memberUids, remote.memberUids),
    ownerUid: remote.ownerUid ?? local.ownerUid ?? null,
    expenses: expenses.merged,
    settlements: settlements.merged,
    tombstones: {
      expenses: expenses.tombstones,
      settlements: settlements.tombstones,
    },
  };
}

// Is it worth spending a write? Comparing the merged result against what
// the server already had keeps quiet devices from burning quota.
export function payloadChanged(merged, remote) {
  if (!remote) return true;
  return JSON.stringify(normalise(merged)) !== JSON.stringify(normalise(remote));
}

function normalise(payload) {
  const byId = (list = []) => [...list].sort((a, b) => (a.id < b.id ? -1 : 1));
  return {
    trip: sortKeys(payload.trip ?? {}),
    memberUids: [...(payload.memberUids ?? [])].sort(),
    ownerUid: payload.ownerUid ?? null,
    expenses: byId(payload.expenses).map(sortKeys),
    settlements: byId(payload.settlements).map(sortKeys),
    tombstones: sortKeys(emptyTombs(payload.tombstones)),
  };
}

function sortKeys(value) {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortKeys(value[k])]));
  }
  return value;
}

// Fold a merged payload back into the flat local collections. Expenses
// and settlements for OTHER trips are passed through untouched.
export function applyPayload({ merged, tripId, trips, expenses, settlements, tombstones }) {
  const nextTrip = {
    ...merged.trip,
    id: tripId,
    memberUids: merged.memberUids,
    ownerUid: merged.ownerUid,
  };
  const known = trips.some((t) => t.id === tripId);
  return {
    trips: known
      ? trips.map((t) => (t.id === tripId ? { ...nextTrip, lastEdit: t.lastEdit ?? null } : t))
      : [...trips, nextTrip], // a trip shared with us from another device
    expenses: [
      ...expenses.filter((e) => e.tripId !== tripId),
      ...merged.expenses.map((e) => ({ ...e, tripId })),
    ],
    settlements: [
      ...settlements.filter((s) => s.tripId !== tripId),
      ...merged.settlements.map((s) => ({ ...s, tripId })),
    ],
    tombstones: {
      ...tombstones,
      expenses: mergeTombstones(tombstones.expenses ?? {}, merged.tombstones.expenses),
      settlements: mergeTombstones(tombstones.settlements ?? {}, merged.tombstones.settlements),
    },
  };
}

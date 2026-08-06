// Preferences that belong to the PERSON, not the device (phase D3.8).
// Pure — the storage and network live elsewhere.
//
// Settings were entirely device-local, so pinning a trip on a laptop did
// nothing on a phone. Home currency and the street-rate markup had the
// same problem; they just hadn't been noticed yet.
//
// These sync through a document of your own (`users/{uid}`), NOT through
// the trip: a trip document is shared, so pinning one there would pin it
// for everyone else on the trip too.

// What follows you between devices. Everything omitted stays local, and
// deliberately so:
//   activeTripId  — which card is open right now, per device
//   theme         — dark on a phone, light on a laptop is a fair choice
//   syncHint, lastSyncAt, pendingJoin, placeDismissed, detailTipShown
//                 — bookkeeping for this device only
export const SYNCED_SETTINGS = [
  "homeCurrency",
  "pinnedTripId",
  "markupOn",
  "markupPct",
  "rangeDays",
  // Who you are, kept once rather than retyped by every person who adds
  // you to a trip. Your device copies these into your member row on each
  // trip you're part of.
  "profileName",
  "profilePhone",
];

export function pickSynced(settings = {}) {
  const out = {};
  for (const key of SYNCED_SETTINGS) {
    if (settings[key] !== undefined) out[key] = settings[key];
  }
  return out;
}

// Did anything worth syncing actually change? Used to decide whether to
// bump the stamp — without this, every unrelated settings write would
// look like a fresh preference change and win every merge.
export function syncedChanged(before = {}, after = {}) {
  return SYNCED_SETTINGS.some((key) => before[key] !== after[key]);
}

// Last write wins, same rule as everything else (ADR-0008). Preferences
// are small and rarely contested — the person changing them is usually
// holding one device at a time.
export function mergePrefs(local, remote) {
  const l = Number.isFinite(local?.updatedAt) ? local.updatedAt : 0;
  const r = Number.isFinite(remote?.updatedAt) ? remote.updatedAt : 0;
  if (!remote) return local ?? null;
  if (!local) return remote;
  return r > l ? remote : local;
}

// A pinned trip that no longer exists (deleted on another device) would
// leave the home screen pinned to nothing.
export function prunePrefs(prefs, tripIds = []) {
  if (!prefs?.pinnedTripId) return prefs;
  return tripIds.includes(prefs.pinnedTripId)
    ? prefs
    : { ...prefs, pinnedTripId: null };
}

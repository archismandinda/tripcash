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
  "profilePhoto", // small data URL; your face follows you too
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

// How far this device's clock is from the server's.
//
// Anchoring stamps above local history (the Lamport rule in merge.js)
// only helps once a device has SEEN the other's value. A device whose
// clock runs ahead can still overwrite a change it never saw, because
// its stamps are inflated by the skew alone. Stamping in server time
// removes the skew, so every device's stamps are comparable.
//
import { winsOver } from "./merge.js";

// Deliberately conservative: an unreadable or absurd reading yields 0
// (use the local clock) rather than corrupting every future stamp.
const MAX_BELIEVABLE_SKEW = 365 * 24 * 60 * 60 * 1000;

export function clockOffsetFrom(serverMillis, localMillis) {
  if (!Number.isFinite(serverMillis) || !Number.isFinite(localMillis)) return 0;
  const offset = serverMillis - localMillis;
  return Math.abs(offset) > MAX_BELIEVABLE_SKEW ? 0 : offset;
}

// Last write wins, same rule as everything else (ADR-0008) — including
// the tie rule (ADR-0015). This used to be a bare `r > l`, which on a
// tie means "prefer mine" on BOTH devices: permanent disagreement, the
// same defect that cost five releases at the record level. Ties are
// reachable here because a device that has never changed a travelling
// preference carries updatedAt 0.
export function mergePrefs(local, remote) {
  if (!remote) return local ?? null;
  if (!local) return remote;
  return winsOver(remote, local) ? remote : local;
}

// A pinned trip that no longer exists (deleted on another device) would
// leave the home screen pinned to nothing.
export function prunePrefs(prefs, tripIds = []) {
  if (!prefs?.pinnedTripId) return prefs;
  return tripIds.includes(prefs.pinnedTripId)
    ? prefs
    : { ...prefs, pinnedTripId: null };
}

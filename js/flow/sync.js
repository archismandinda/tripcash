// The sync machinery: what arrives from the other phone, what goes back,
// and what a trip this device can no longer reach does to the screen.
//
// Second story of the app.js decomposition (after js/state.js). Nothing
// here is new — every function below was a top-level function in
// js/app.js at v1.78.0 and is reproduced with its comments intact. The
// acceptance criterion was zero behavioural change, so the only edits
// are the ones the module boundary forces:
//
//  - `account` was a module-level `let` in js/app.js, reassigned on every
//    auth change. ES modules cannot share a rebindable `let`, so it is
//    read through currentAccount(), registered at boot.
//  - `syncing` and `syncNow` belong to the half of the sync loop that
//    has NOT moved yet (D-3), and are likewise read through hooks.
//  - the one DOM read (`dialog[open]`) is injected as sheetOpen(), so
//    this file reaches for no document at all — see tests/ownership.test.mjs.
//  - `await import("./x.js")` became `await import("../x.js")`. This file
//    is js/flow/sync.js and the payload module is js/sync.js: left alone,
//    absorbRemote would have lazily imported ITSELF.
//
// THE SEAM, and it is the whole story: `suppressPush` is shared with the
// syncNow that stayed behind. An exported mutable binding cannot work
// across ES modules — an importer gets the value, never the variable — so
// syncNow reaches the latch through withPushSuppressed() below, which
// reproduces its save-and-restore geometry exactly. Get that wrong and
// you get back one of the two bugs the comments here describe: the
// ping-pong loop, or the latch stuck on for the life of the tab.

import { state, saveTrips, saveExpenses, saveSettlements, updateSettings } from "../state.js";
import * as store from "../store.js";
import { absorbPayload } from "../absorb.js";
import { locksAfter } from "../roster.js";
import { failureSentence } from "../failure.js";
import { formatAmount, localeFor } from "../convert.js";
import { deleteAttachments } from "../attach.js";
import { toast } from "../ui.js";

// ---------- what app-side land supplies ----------
//
// One registration, made in boot() beside the onSaved hook, so this
// module never imports js/app.js. Each name is spelled here exactly as
// it was spelled inside the moved code, so every call site below is the
// line that was in js/app.js.
//
//  currentAccount     — the live `account` binding: null, or { uid, email }
//  isSyncing          — the live `syncing` flag; flushPush re-arms on it
//  syncNow            — the push/pull loop itself (still js/app.js, D-3)
//  renderTrips        — repaint the home screen
//  renderAccount      — repaint the account card / sync note
//  noteEvents         — file notifications
//  applyPrefs         — what an incoming preferences snapshot does
//  deleteCloudReceipt — best-effort cloud blob cleanup
//  sheetOpen          — is any <dialog> on screen right now
let currentAccount = () => null;
let isSyncing = () => false;
let syncNow = async () => false;
let renderTrips = () => {};
let renderAccount = () => {};
let noteEvents = () => {};
let applyPrefs = () => {};
let deleteCloudReceipt = () => {};
let sheetOpen = () => false;

export function configure(hooks) {
  ({ currentAccount, isSyncing, syncNow, renderTrips, renderAccount, noteEvents,
    applyPrefs, deleteCloudReceipt, sheetOpen } = hooks);
}

// Remove a trip and everything hanging off it from THIS device.
// `alsoCloud` is false when the delete arrived from another device —
// that device already cleaned up the shared copies.
export function purgeTripLocally(id, { alsoCloud = false } = {}) {
  if (!state.trips.some((t) => t.id === id)) return false;
  state.trips = state.trips.filter((t) => t.id !== id);
  const swept = state.expenses.filter((e) => e.tripId === id);
  state.expenses = state.expenses.filter((e) => e.tripId !== id); // sweep the trip's ledger
  state.settlements = state.settlements.filter((p) => p.tripId !== id);
  saveTrips();          // records the local trip tombstone (store.js)
  saveExpenses();
  saveSettlements();
  deleteAttachments(swept.filter((e) => e.attachment).map((e) => e.id))
    .catch(() => { /* silent: an unswept blob costs nothing, and the delete already happened */ });
  if (alsoCloud) for (const e of swept.filter((x) => x.attachment)) deleteCloudReceipt(id, e.id);
  if (state.settings.pinnedTripId === id) state.settings = updateSettings({ pinnedTripId: null });
  if (state.settings.activeTripId === id) {
    state.settings = store.setSettings({ activeTripId: state.trips[0]?.id ?? null });
  }
  return true;
}

// Which trips this device cannot write to. Device-local by construction:
// it lives in settings, and SYNCED_SETTINGS is an allowlist that does not
// name it (tests/prefs.test.mjs). One phone locked out must not make the
// person's laptop read-only.
export const lockedTrips = () => state.settings.lockedTripIds ?? [];

// Record what a read of the trip document just proved. locksAfter()
// returns the same array when nothing changed, so a probe that only
// confirms what we already know costs no write and no repaint.
export function noteAccess(tripId, access) {
  const next = locksAfter(lockedTrips(), tripId, access);
  if (next === lockedTrips()) return false;
  state.settings = store.setSettings({ lockedTripIds: next });
  return true;
}

// This device can neither write to the trip nor read it. That is all it
// knows; see evictionFrom in roster.js for why it is not enough to
// conclude anybody was removed. The trip STAYS, with everything on it,
// and goes read-only until a later sync can read the document again.
export function applyLockout({ tripId, notice }) {
  if (!noteAccess(tripId, "denied")) return; // already known — say it once
  noteEvents([notice]);
  // Said out loud as well as filed. Controls quietly going inert with no
  // explanation is the same silence this whole change is about.
  toast(notice.text);
  renderTrips();
}

// Can this account READ the trip? The only evidence that separates "this
// device cannot reach the trip" from "the rules refused this write for
// some other reason" — and getting it wrong used to throw away a trip.
//
// Three answers, not two, because the two callers need opposite biases
// and a boolean can only serve one of them: "unknown" is offline or any
// other failure, and it must never be read as proof in either direction.
export async function readAccess(tripId) {
  try {
    const { fetchTripById } = await import("../firestore.js");
    await fetchTripById(tripId);
    return "ok";
  } catch (err) {
    // silent: the answer IS what this function returns. Saying anything
    // here would speak twice about one refusal — the callers decide what
    // it means and report that.
    return err?.code === "permission-denied" ? "denied" : "unknown";
  }
}

// The charitable reading of that probe, for deciding whether to lock:
// anything short of an outright refusal counts as readable, so a lost
// connection can never look like lost access.
export const stillReadable = async (tripId) => (await readAccess(tripId)) !== "denied";

// ----- live updates (phase D3.7) -----
//
// Inbound: Firestore pushes changes while the app is open.
// Outbound: local edits schedule a push a few seconds later, so the other
// phone sees them without anyone tapping Sync. "Live" has to mean both
// directions or it just looks broken from the other side.

let unwatch = null;        // stops the Firestore listener
let pushTimer = null;      // debounce for outbound pushes
// Short on purpose. It exists only to collapse converter keystrokes into
// one push; anything longer and a discrete action (archiving a trip,
// say) sits unsent while you switch to your other device to look for it.
export const PUSH_DELAY_MS = 1200;
let suppressPush = false;  // set while absorbing a snapshot, to stop ping-pong
let liveDirty = false;     // a snapshot arrived while a sheet was open
let liveRenderTimer = null;

let unwatchPrefs = null;

// The listener is not attached, so nothing from the other phone arrives
// on its own. That is a CONDITION, not an event, and it has to be held
// as state rather than painted once: `#sync-note` lives inside
// <dialog id="settings-sheet">, so the sentence is written while the
// sheet is shut and nobody can see it, and every renderAccount() that
// passes no note sets `noteEl.textContent = note` unconditionally.
// openSettings() calls renderAccount() with no arguments — so going to
// look at the warning was the act that erased it, and a silent syncNow
// or a foregrounded tab erased it before that. Held here, renderAccount
// re-derives it on every render until live updates actually come back.
let liveFault = null;

// renderAccount is app-side and stayed in js/app.js, but it reads both of
// these on every paint: `unwatch` decides between "Live — changes appear
// as they happen" and the last-synced line, and `liveFault` is the
// standing condition it re-derives. They cross the boundary as reads,
// never as writes — the condition still ends only where it always did,
// inside startLiveUpdates/stopLiveUpdates.
export function liveAttached() {
  return !!unwatch;
}

export function liveFaultNote() {
  return liveFault;
}

export async function startLiveUpdates() {
  if (unwatch || !currentAccount()) return;
  try {
    const { watchMyTrips, watchPrefs } = await import("../firestore.js");
    unwatch = await watchMyTrips(currentAccount().uid, absorbRemote, () => {
      unwatch = null; // listener dropped; manual sync is still there
    });
    unwatchPrefs ??= await watchPrefs(currentAccount().uid, applyPrefs, () => {
      unwatchPrefs = null;
    });
    // Attached — so the condition is over. It has to be able to end, or
    // a phone that lost signal for a moment carries the warning for the
    // rest of the session (visibilitychange and sign-in both retry).
    if (liveFault) { liveFault = null; renderAccount(); }
  } catch (err) {
    // Not a toast. If the listener never attaches, nothing from the
    // other phone arrives for as long as this app stays open — that is a
    // standing condition, and it belongs on the sync note where it stays
    // visible, next to the Sync now button that is the way round it.
    console.warn("[tripcash] live updates unavailable", err?.code ?? err);
    liveFault = failureSentence({ op: "live-updates", code: err?.code, online: navigator.onLine });
    renderAccount({ note: liveFault, bad: true });
  }
}

export function stopLiveUpdates() {
  unwatch?.();
  unwatch = null;
  unwatchPrefs?.();
  unwatchPrefs = null;
  // Signed out (or shutting down): there is nothing left to be live
  // about, so the warning must not outlive the thing it describes.
  liveFault = null;
}

// A change arrived from someone else's phone.
// Silence is how the expensive bugs in this project have always hidden.
// A sync step that throws says so — once, not per record.
let faultSpoken = false;
function reportSyncFault(where, err) {
  console.error(`[tripcash] sync fault in ${where}`, err);
  if (faultSpoken) return;
  faultSpoken = true;
  toast("Something went wrong syncing. Your data is safe on this device.");
  setTimeout(() => { faultSpoken = false; }, 30_000);
}

// The same job as reportSyncFault, for everything that is not the sync
// loop — and the ONLY place outside it where a failure becomes a toast.
// The sentence belongs to js/failure.js, so a second call site cannot
// invent a second wording; that is exactly how sendInvite came to speak
// about a refused invite write while inviteEveryone said nothing.
// `into` collects the failure instead of speaking it, for a caller that
// covers several people in one run: there is one #toast element and a
// second call replaces the first outright, so a per-person toast means
// only the last person's outcome survives. The collected faults go to
// inviteRunSentence, which is where "what a whole run says" lives —
// still js/failure.js, so this stays the one place with the wording.
export function reportFailure(op, err, { into, name } = {}) {
  console.warn(`[tripcash] ${op} failed`, err?.code ?? err);
  const fault = { op, code: err?.code, online: navigator.onLine, name };
  if (into) { into.push(fault); return; }
  const say = failureSentence(fault);
  // No sentence means js/failure.js has never heard of this op, i.e. a
  // typo. Loud in the console, silent on screen — better than wrong.
  if (say) toast(say);
}

// Fold a payload into local state — safely.
//
// TWO bugs lived in the old version of this, and both destroyed data:
//
// 1. The push loop built its payload, awaited a network transaction
//    (0.5–5s on a phone), then applied the result WHOLESALE. applyPayload
//    replaces a trip's records outright, so anything the user saved
//    during that await was filtered out — and, because the save had
//    already recorded it, the next write tombstoned it as a deletion and
//    propagated that to every device. You saw "Expense added", saw the
//    row, and lost it everywhere.
//
//    So the returned payload is re-merged against whatever local state
//    is CURRENT at this moment, rather than the snapshot we sent. The
//    merge is a union, so an expense added mid-flight survives.
//
// 2. The tombstone map was written from a read taken BEFORE the saves,
//    clobbering any tombstone those saves had just recorded. It is now
//    written first, so writeSynced's own tombstones layer on top.
export function absorbInto(merged, tripId, { buildPayload, mergePayload, applyPayload }) {
  // The decision lives in js/absorb.js, pure and tested. This is only
  // the io: apply what it decided, in the order it returned.
  const out = absorbPayload({
    merged, tripId, trips: state.trips, expenses: state.expenses, settlements: state.settlements,
    tombstones: store.getTombstones(),
    account: currentAccount(),
    money: (e) => (Number.isFinite(e.amount) && e.code
      ? `${formatAmount(e.amount, e.code, localeFor(e.code))} ${e.code}` : ""),
    buildPayload, mergePayload, applyPayload,
  });
  if (out.deleted) return { deleted: true };

  state.trips = out.trips;
  state.expenses = out.expenses;
  state.settlements = out.settlements;
  store.setTombstones(out.tombstones); // BEFORE the saves, not after
  saveTrips();
  saveExpenses();
  saveSettlements();

  if (out.orphanedReceipts.length) {
    deleteAttachments(out.orphanedReceipts)
      .catch(() => { /* silent: sweeping blobs whose expense is already gone; nothing on screen changes */ });
  }
  noteEvents(out.notices);
  if (out.arrival?.name) absorbArrivals.push(out.arrival);
  return { deleted: false, reconciled: out.reconciled };
}

// Trips discovered by the sync currently running, announced once it
// finishes. Collected here because absorbInto is called from two places.
let absorbArrivals = [];

// syncNow clears this at the top of a run and reads it back at the end.
// Both halves are here rather than exported as a binding, for the same
// reason suppressPush is: an importer would get the array, not the
// variable, and `absorbArrivals = []` would be invisible to it.
export function resetArrivals() {
  absorbArrivals = [];
}

export function absorbedArrivals() {
  return absorbArrivals;
}

async function absorbRemote(tripId, remote) {
  const { buildPayload, mergePayload, applyPayload, payloadChanged } = await import("../sync.js");
  const trip = state.trips.find((t) => t.id === tripId);
  const local = trip ? buildPayload({
    trip,
    expenses: state.expenses.filter((e) => e.tripId === tripId),
    settlements: state.settlements.filter((s) => s.tripId === tripId),
    tombstones: store.getTombstones(),
    uid: currentAccount()?.uid,
  }) : null;
  const merged = local ? mergePayload(local, remote) : remote;

  // Writing what we just received must not schedule a push straight back,
  // or two phones bounce the same trip between them forever.
  //
  // try/finally is not decoration: applyPayload throws on a trip
  // document missing `tombstones` or `expenses` — exactly the raw
  // pass-through above for a trip this device has never seen. Without
  // the finally, one such document latched suppressPush ON and this
  // device silently never pushed again until the app was reloaded.
  let removed = false;
  try {
    suppressPush = true;
    if (merged?.deleted) {
      removed = purgeTripLocally(tripId);
    } else {
      absorbInto(merged, tripId, { buildPayload, mergePayload, applyPayload });
    }
  } catch (err) {
    reportSyncFault("absorb", err);
    return;
  } finally {
    suppressPush = false;
  }
  if (merged?.deleted) {
    if (removed) queueLiveRender();
    return;
  }

  // ...unless the merge produced something the server doesn't have yet
  // (our offline edit winning over theirs). Then it genuinely must go up.
  if (local && payloadChanged(merged, remote)) scheduleSync();
  queueLiveRender();
}

// The other holder of the latch is syncNow, which stayed in js/app.js
// (story D-3). Its version is NOT absorbRemote's: it snapshots the
// previous value and restores THAT, because a syncNow absorb can run
// inside an absorbRemote that already set the latch, and clearing it
// outright would let the saves of the outer absorb push straight back.
// Reproduced here so the two geometries stay two geometries.
export function withPushSuppressed(fn) {
  const wasSuppressed = suppressPush;
  suppressPush = true;
  try {
    return fn();
  } finally {
    suppressPush = wasSuppressed;
  }
}

// Never redraw underneath an open sheet — someone mid-way through typing
// an expense would lose their place. Redraw when they're done instead.
//
// Exported for no caller: js/app.js queues nothing itself, it only
// flushes (the `close` listener on every dialog.sheet). The pair is the
// rule, though — queue defers, flush retries — and half a rule cannot be
// driven, so tests/flow-sync.test.mjs reaches it here.
export function queueLiveRender() {
  liveDirty = true;
  clearTimeout(liveRenderTimer);
  liveRenderTimer = setTimeout(flushLiveRender, 400);
}

export function flushLiveRender() {
  if (!liveDirty) return;
  if (sheetOpen()) return; // retried on close
  liveDirty = false;
  renderTrips();
}

// Local edits go up on their own, shortly. Debounced because saveTrips()
// fires on every keystroke of the converter — a burst collapses into one
// push, which usually finds nothing changed and costs a single read.
export function scheduleSync() {
  if (!currentAccount() || suppressPush) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(flushPush, PUSH_DELAY_MS);
}

export function flushPush() {
  clearTimeout(pushTimer);
  pushTimer = null;
  if (!currentAccount() || suppressPush) return;
  // syncNow refuses to run while another sync is in flight. Dropping the
  // push there meant an edit made during a slow sync sat local until
  // some unrelated save happened to trigger another one — the "I changed
  // it on my phone and it never arrived" report, again.
  if (isSyncing()) {
    pushTimer = setTimeout(flushPush, PUSH_DELAY_MS);
    return;
  }
  syncNow({ silent: true });
}

// The one owner of in-memory state.
//
// The four collections (and the notices list) used to be module-level
// `let` bindings in js/app.js, reassigned all over the file. ES modules
// cannot share a rebindable `let`, so extracting anything that touches
// them meant first putting them somewhere every module can both read AND
// replace: one shared `state` object, never itself reassigned — only its
// properties are. `state.trips = next` is the new spelling of what used
// to be `trips = next`.
//
// Two invariants this module inherits, both learnt the expensive way:
//
//  - Never call store.setTrips/setExpenses/setSettlements directly. Go
//    through saveTrips()/saveExpenses()/saveSettlements(), which restamp
//    memory — bypassing them re-opens ADR-0016 (a stamp that reached
//    storage but not memory, so every edit pushed with its pre-edit
//    stamp and lost the merge it was meant to win).
//
//  - Object identity survives a save. restamp() writes stamps INTO the
//    existing records rather than replacing them, because callers hold
//    references across saves. The ARRAY binding is what gets replaced;
//    the records are not.

import * as store from "./store.js";
import { pickSynced, syncedChanged } from "./prefs.js";

export const state = {
  settings: store.getSettings(),
  trips: store.getTrips(),
  expenses: store.getExpenses(),
  settlements: store.getSettlements(),
  notices: store.getNotices(),
};

// What happens AFTER a save — scheduling a push, repainting the bell —
// is the composition root's business, not this module's: state is a
// leaf, and importing the sync machinery here would drag the whole
// Firebase surface into every module that only wants to read a trip.
// app.js registers one listener at boot; the hook fires exactly where
// scheduleSync()/renderBell() were called when these functions lived in
// app.js — same call sites, same guards. In particular the settings
// hook fires only when a SYNCED preference changed, and the suppressPush
// gate stays inside scheduleSync itself, untouched.
let savedHook = null;
export function onSaved(fn) {
  savedHook = fn;
}
const fireSaved = (kind) => savedHook?.(kind);

// The store stamps updatedAt as it persists (js/store.js). Those stamps
// MUST come back into memory, because the upload is built from the
// in-memory records — a trip still carrying its pre-edit stamp gets
// pushed as though nothing happened, ties with the copy already in the
// cloud, and loses. That is exactly how archiving a trip appeared to
// undo itself seconds later, with no refresh involved (ADR-0016).
//
// Copied field by field rather than swapping the array: several callers
// hold a reference to a trip across the save (the archive toast's Undo,
// the member-linking pass in syncNow), and replacing the objects would
// leave them writing to a copy nothing reads.
export function restamp(records, stamped) {
  const fresh = new Map(stamped.map((r) => [r?.id, r?.updatedAt]));
  for (const rec of records) {
    if (fresh.has(rec?.id)) rec.updatedAt = fresh.get(rec.id);
  }
}

export function saveTrips() {
  restamp(state.trips, store.setTrips(state.trips));
  // The save is also where "this device has held a trip" is written
  // down (js/store.js), and `state.settings` here is a snapshot taken at
  // boot. Unrefreshed, the flag is true on disk and false in memory for
  // the rest of the launch — so somebody who makes a trip, changes their
  // mind and deletes it is shown the pitch for an app they have just
  // used. Same shape as ADR-0016: what is in memory drifting from what
  // was persisted.
  //
  // That one field, not the whole record. Re-reading everything would
  // mean that on a device where writes are failing (Private Browsing, a
  // full disk) saving a trip quietly reverted preferences the person can
  // still see on screen.
  state.settings = { ...state.settings, tripEverCreated: store.getSettings().tripEverCreated };
  fireSaved("trips"); // local edits make their own way up (scheduleSync)
}

export function saveExpenses() {
  restamp(state.expenses, store.setExpenses(state.expenses));
  fireSaved("expenses");
}

export function saveSettlements() {
  restamp(state.settlements, store.setSettlements(state.settlements));
  fireSaved("settlements");
}

export function saveNotices(next) {
  state.notices = next;
  store.setNotices(state.notices);
  fireSaved("notices"); // the bell badge repaints from the list
}

// Settings writes that carry a travelling preference must also schedule a
// push — otherwise pinning a trip changes nothing on your other device.
export function updateSettings(patch) {
  const before = pickSynced(state.settings);
  state.settings = store.setSettings(patch);
  if (syncedChanged(before, pickSynced(state.settings))) fireSaved("settings");
  return state.settings;
}

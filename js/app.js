// TripCash — state + event wiring. Views live in ui.js, logic in convert.js,
// storage in store.js, rate fetching in rates.js.

import { CURRENCIES, ALL_CODES, searchCurrencies, matchLabel, tripMatchesQuery } from "./currencies.js";
import { convert, applyMarkup, parseAmount, formatAmount, groupInput, dedupe, localeFor,
  ambiguousSeparator } from "./convert.js";
import * as store from "./store.js";
import { loadRates, ageString } from "./rates.js";
import { loadHistory, historySupported } from "./history.js";
import { renderChart, formatRate } from "./chart.js";
import { parseSharedText, parsePaymentQR } from "./parse.js";
import { lakhGloss, slipCheck, pocketRule, pocketExamples, currencyForTimeZone, placeLabel, stampText,
  toDatetimeLocal, fromDatetimeLocal } from "./insights.js";
import { scanSupported, startScan } from "./scan.js";
import { splitValid, shareOf, tripBalances, settleUp, expenseCuts, equalSplit,
  referencedMembers, allocate, reassignMember } from "./splits.js";
import { putAttachment, getAttachment, deleteAttachment, deleteAttachments, prepareAttachment } from "./attach.js";
import { $, fieldRow, tripCard, filterChip, resultItem, pickedChip, toast, ICONS,
  EXPENSE_TYPES, typeEmoji, typeLabel, expenseRow, memberChip, escapeHtml } from "./ui.js";
import { selfMemberId, linkAccount, memberLabel, memberStatus, normaliseEmail as normEmail,
  nameFromEmail, LEGACY_SELF } from "./members.js";
import { pickSynced, syncedChanged, mergePrefs, prunePrefs, clockOffsetFrom } from "./prefs.js";
import { pushBlocker, pushGranted, enablePush, disablePush } from "./push.js";

// THE version string. Bump here on every release, alongside VERSION in
// sw.js — nowhere else. It used to be typed into index.html twice, and
// two hand-maintained copies drift.
export const APP_VERSION = "v1.51.0";
import { initialsFrom } from "./members.js";
import { normalisePhone, whatsappNumber, applyProfile, canEditDetails } from "./members.js";

let settings = store.getSettings();
let trips = store.getTrips();
let expenses = store.getExpenses();
let settlements = store.getSettlements();
let ratesInfo = { data: null, live: false }; // filled by refreshRates()

// The last-edited field is the single source of truth for all conversions.
let lastEdit = null; // { code, amount }
let placeCode = null; // currency of wherever the device thinks it is

// Trip-list view state (session-only; a fresh launch shows everything)
let tripQuery = "";
let tripFilterCode = null; // one currency chip at a time
let viewArchived = false;
let activeTab = "convert"; // "convert" | "ledger", per session

// ---------- helpers ----------

const activeTrip = () => trips.find((t) => t.id === settings.activeTripId) ?? null;

// Home currency first, then the trip's currencies (deduped against home).
function visibleCodes() {
  const trip = activeTrip();
  if (!trip) return [];
  return dedupe([settings.homeCurrency, ...trip.currencies]);
}

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
function restamp(records, stamped) {
  const fresh = new Map(stamped.map((r) => [r?.id, r?.updatedAt]));
  for (const rec of records) {
    if (fresh.has(rec?.id)) rec.updatedAt = fresh.get(rec.id);
  }
}

function saveTrips() {
  restamp(trips, store.setTrips(trips));
  scheduleSync(); // local edits make their own way up
}

// ---------- converter screen ----------

// Which trips the current search + filter chips let through.
function visibleTrips() {
  return trips.filter(
    (t) =>
      !!t.archived === viewArchived &&
      tripMatchesQuery(t, tripQuery) &&
      (!tripFilterCode || t.currencies.includes(tripFilterCode))
  );
}

// Search box + chips: one chip per currency present in the current view,
// plus an Archived toggle whenever anything is archived.
function renderTripTools() {
  const tools = $("#trip-tools");
  // Keep tools visible whenever anything is archived — the Archived chip
  // is the only door back to an archived trip, even with one trip total.
  tools.hidden = trips.length < 2 && !trips.some((t) => t.archived);
  const row = $("#trip-filters");
  row.innerHTML = "";
  const archivedCount = trips.filter((t) => t.archived).length;
  // Don't strand the user in an archived view that just emptied out.
  if (viewArchived && archivedCount === 0) viewArchived = false;
  if (archivedCount) {
    row.appendChild(filterChip(`Archived · ${archivedCount}`, "__archived", viewArchived));
  }
  const pool = trips.filter((t) => !!t.archived === viewArchived);
  const codes = dedupe(pool.flatMap((t) => t.currencies)).sort();
  for (const code of codes) row.appendChild(filterChip(code, code, tripFilterCode === code));
  $("#trip-search-clear").hidden = !tripQuery;
}

// Rebuild the trip-card list and put the tabbed panel inside the open card.
function renderTrips() {
  const list = $("#trips");
  const panel = $("#panel-host");
  $("#main").appendChild(panel); // park BEFORE clearing, or the panel is destroyed
  panel.hidden = true;
  list.innerHTML = "";
  renderTripTools();
  const open = activeTrip();
  const shown = visibleTrips();
  for (const trip of shown) {
    list.appendChild(tripCard(trip, trip === open, trip.id === settings.pinnedTripId));
  }
  if (!shown.length && trips.length) {
    const archivedCount = trips.filter((t) => t.archived).length;
    const msg = document.createElement("div");
    msg.className = "no-trips-match";
    msg.textContent = viewArchived && !archivedCount
      ? "No archived trips"
      : (!viewArchived && !tripQuery && !tripFilterCode && trips.every((t) => t.archived)
        ? `${archivedCount === 1 ? "Your trip is" : "All trips are"} archived — tap the Archived chip above`
        : "No trips match");
    list.appendChild(msg);
  }
  $("#empty-state").hidden = trips.length > 0;
  $("#new-trip-btn").hidden = trips.length === 0;
  const openCardBody = open && list.querySelector(`.trip-card[data-trip="${CSS.escape(open.id)}"] .trip-card-body`);
  if (openCardBody) {
    openCardBody.appendChild(panel);
    panel.hidden = false;
    syncTab();
  }
  renderFields();
  updatePlaceStrip();
}

// Show whichever tab is active and (re)render its content.
function syncTab() {
  for (const b of document.querySelectorAll("#trip-tabs [data-tab]")) {
    b.classList.toggle("on", b.dataset.tab === activeTab);
  }
  $("#converter-panel").hidden = activeTab !== "convert";
  $("#ledger-panel").hidden = activeTab !== "ledger";
  if (activeTab === "ledger") renderLedger();
}

function renderFields() {
  const trip = activeTrip();
  $("#markup-row").hidden = !trip;
  const box = $("#fields");
  box.innerHTML = "";
  if (!trip) return;
  for (const code of visibleCodes()) {
    box.appendChild(fieldRow(code, code === settings.homeCurrency));
  }
  // Mark the currency of wherever the device says we are. On the home row
  // that's redundant (and would crowd the HOME badge), so skip it.
  if (placeCode && placeCode !== settings.homeCurrency) {
    const label = box.querySelector(`.field[data-code="${CSS.escape(placeCode)}"] .field-code`);
    label?.insertAdjacentHTML("beforeend", '<span class="here-badge">HERE</span>');
  }
  // Restore this trip's last-entered amount, if any.
  lastEdit = trip.lastEdit && CURRENCIES[trip.lastEdit.code] ? trip.lastEdit : null;
  if (lastEdit && !visibleCodes().includes(lastEdit.code)) lastEdit = null;
  if (lastEdit) {
    const src = fieldInput(lastEdit.code);
    if (src) {
      src.value = formatAmount(lastEdit.amount, lastEdit.code);
      fitAmount(src);
    }
  }
  recompute();
}

const fieldInput = (code) => document.querySelector(`#fields input[data-code="${CSS.escape(code)}"]`);

// Long amounts step down in size so digits never clip. Measured, not
// guessed: try each size until the text actually fits the input.
function fitAmount(input) {
  const row = input.closest(".field") ?? input;
  for (const size of ["", "long", "xlong", "xxlong"]) {
    input.classList.remove("long", "xlong", "xxlong");
    if (size) input.classList.add(size);
    // +1: scrollWidth rounds up while clientWidth rounds down.
    // Check the input (flex-sized layouts) and the row (content-sized inputs).
    if (input.scrollWidth <= input.clientWidth + 1 && row.scrollWidth <= row.clientWidth + 1) break;
  }
}

// Recalculate every field except the source. Derived fields are written
// programmatically, which never fires "input" events → no circular updates.
function recompute() {
  const rates = ratesInfo.data?.rates;
  for (const input of document.querySelectorAll("#fields input")) {
    const code = input.dataset.code;
    if (lastEdit && code === lastEdit.code) continue; // source field: leave user text alone
    if (!lastEdit || !rates) {
      input.value = "";
    } else {
      let v = convert(lastEdit.amount, lastEdit.code, code, rates);
      // Markup truth is the visible toggle — displayed math can never silently
      // disagree with what the switch shows.
      if (v !== null && $("#markup-toggle").checked) v = applyMarkup(v, settings.markupPct);
      input.value = v === null ? "" : formatAmount(v, code);
    }
    input.dataset.prev = input.value;
    fitAmount(input);
  }
  // Mark the source-of-truth row so it's obvious which number drives the rest.
  for (const row of document.querySelectorAll("#fields .field")) {
    row.classList.toggle("source", !!lastEdit && row.dataset.code === lastEdit.code);
  }
  $("#clear-all").hidden = !lastEdit;
  $("#to-expense").hidden = !lastEdit;
  updateGloss();
  updateSlipWarning();
}

// Big rupee amounts read better as "1.2 lakh" than as a row of digits, so the
// INR row's subtitle becomes the gloss once the number gets large.
function updateGloss() {
  for (const row of document.querySelectorAll("#fields .field")) {
    const c = CURRENCIES[row.dataset.code];
    const nameEl = row.querySelector(".field-name");
    if (!c || !nameEl) continue;
    const gloss = row.dataset.code === "INR"
      ? lakhGloss(parseAmount(row.querySelector("input").value) ?? 0)
      : "";
    nameEl.textContent = gloss
      ? `≈ ${c.symbol}${gloss}`
      : `${c.symbol ? c.symbol + " · " : ""}${c.name}`;
  }
}

// A slipped zero at an ATM is expensive; warn on order-of-magnitude surprises.
function updateSlipWarning() {
  const el = $("#slip-warn");
  const rates = ratesInfo.data?.rates;
  if (!lastEdit || !rates) {
    el.hidden = true;
    return;
  }
  const home = settings.homeCurrency;
  const homeAmount = lastEdit.code === home
    ? lastEdit.amount
    : convert(lastEdit.amount, lastEdit.code, home, rates);
  const samples = activeTrip()?.samples?.[lastEdit.code] ?? [];
  const hit = slipCheck({ amount: lastEdit.amount, homeAmount, samples });
  if (!hit) {
    el.hidden = true;
    return;
  }
  const gloss = lakhGloss(homeAmount);
  const shown = `${CURRENCIES[home].symbol}${formatAmount(homeAmount, home)}`;
  el.hidden = false;
  el.textContent = `That's ${gloss ? `${CURRENCIES[home].symbol}${gloss}` : shown}` +
    ` — did you mean ${formatAmount(hit.suggestion, lastEdit.code)} ${lastEdit.code}?`;
}

// Remember committed amounts (on blur, not per keystroke) so the guard knows
// what "normal" looks like for this trip.
function recordSample(code, amount) {
  const trip = activeTrip();
  if (!trip || !Number.isFinite(amount) || amount <= 0) return;
  trip.samples = trip.samples ?? {};
  trip.samples[code] = [...(trip.samples[code] ?? []), amount].slice(-12);
  saveTrips();
}

// One tap resets every field (instead of deleting digit by digit).
function clearAll() {
  lastEdit = null;
  persistLastEdit();
  recompute(); // no source → every field empties
  document.querySelector("#fields input:focus")?.blur(); // dismiss keyboard too
}

function onFieldInput(input) {
  const text = input.value;
  if (text.trim() === "") {
    lastEdit = null;
    persistLastEdit();
    recompute();
    input.dataset.prev = "";
    fitAmount(input);
    return;
  }
  const amount = parseAmount(text);
  if (amount === null) {
    // Non-numeric keystroke: revert to the previous good value, change nothing.
    input.value = input.dataset.prev ?? "";
    return;
  }
  regroupInPlace(input, text);
  input.dataset.prev = input.value;
  fitAmount(input);
  lastEdit = { code: input.dataset.code, amount };
  persistLastEdit();
  recompute();
}

// Re-insert thousands separators into the field being typed in, keeping the
// caret next to the same digit it was on.
// The converter's rows format per currency (INR uses the Indian system);
// everything else follows the device. Whatever it is, parseAmount and
// groupInput must be handed the SAME one or the field shows one number
// while the app computes another.
const amountLocale = (code) => localeFor(code);

function regroupInPlace(input, text) {
  const next = groupInput(text, amountLocale(input.dataset.code));
  if (next === text) return;
  const caret = input.selectionStart ?? text.length;
  const digitsBeforeCaret = text.slice(0, caret).replace(/,/g, "").length;
  input.value = next;
  let pos = 0, seen = 0;
  while (pos < next.length && seen < digitsBeforeCaret) {
    if (next[pos] !== ",") seen++;
    pos++;
  }
  input.setSelectionRange(pos, pos);
}

// Remember the trip's last amount so values survive restarts + trip switches.
function persistLastEdit() {
  const trip = activeTrip();
  if (!trip) return;
  trip.lastEdit = lastEdit;
  saveTrips();
}

// Commit a drag-reorder: place `code` at `targetIndex` within the visible
// non-home list, and store that order on the trip (home stays pinned first).
function commitReorder(code, targetIndex) {
  const trip = activeTrip();
  if (!trip || code === settings.homeCurrency) return;
  const displayed = visibleCodes().slice(1).filter((c) => c !== code);
  displayed.splice(targetIndex, 0, code);
  trip.currencies = trip.currencies.includes(settings.homeCurrency)
    ? [settings.homeCurrency, ...displayed]
    : displayed;
  saveTrips();
  renderFields();
}

// Drag-and-drop reorder via the grip on each non-home row. The dragged row
// follows the pointer; siblings slide out of the way with transforms only —
// the DOM is reordered once, on drop.
function enableRowDrag() {
  const fields = $("#fields");
  let drag = null;

  fields.addEventListener("pointerdown", (e) => {
    const handle = e.target.closest(".drag-handle");
    if (!handle) return;
    const row = handle.closest(".field");
    const rows = [...fields.querySelectorAll(".field:not(.home)")];
    if (rows.length < 2) return;
    e.preventDefault();
    handle.setPointerCapture(e.pointerId);
    const idx = rows.indexOf(row);
    drag = { row, rows, idx, target: idx, step: row.offsetHeight + 10, startY: e.clientY };
    row.classList.add("dragging");
    buzz(8);
  });

  fields.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dy = e.clientY - drag.startY;
    drag.row.style.transform = `translateY(${dy}px) scale(1.02)`;
    const target = Math.min(Math.max(drag.idx + Math.round(dy / drag.step), 0), drag.rows.length - 1);
    if (target === drag.target) return;
    drag.target = target;
    for (let i = 0; i < drag.rows.length; i++) {
      const r = drag.rows[i];
      if (r === drag.row) continue;
      let shift = 0;
      if (drag.idx < target && i > drag.idx && i <= target) shift = -drag.step;
      else if (drag.idx > target && i >= target && i < drag.idx) shift = drag.step;
      r.style.transform = shift ? `translateY(${shift}px)` : "";
    }
  });

  const drop = () => {
    if (!drag) return;
    const { row, rows, idx, target } = drag;
    drag = null;
    row.classList.remove("dragging");
    for (const r of rows) r.style.transform = "";
    if (target !== idx) {
      buzz(8);
      commitReorder(row.dataset.code, target);
    }
  };
  fields.addEventListener("pointerup", drop);
  fields.addEventListener("pointercancel", drop);
}

// Drag a trip card by its grip to reorder the list. Cards vary in height
// (one may be expanded), so slots come from the cards' original midpoints
// rather than a fixed step.
function enableTripDrag() {
  const list = $("#trips");
  let drag = null;

  list.addEventListener("pointerdown", (e) => {
    const handle = e.target.closest(".trip-drag");
    if (!handle) return;
    const card = handle.closest(".trip-card");
    const cards = [...list.querySelectorAll(".trip-card")];
    if (cards.length < 2) return;
    e.preventDefault();
    try { handle.setPointerCapture(e.pointerId); } catch { /* synthetic pointers */ }
    drag = {
      card, cards,
      idx: cards.indexOf(card),
      target: cards.indexOf(card),
      startY: e.clientY,
      mids: cards.map((c) => { const r = c.getBoundingClientRect(); return r.top + r.height / 2; }),
      shift: card.getBoundingClientRect().height + 10, // + list gap
    };
    card.classList.add("dragging");
    buzz(8);
  });

  list.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dy = e.clientY - drag.startY;
    drag.card.style.transform = `translateY(${dy}px)`;
    const center = drag.mids[drag.idx] + dy;
    let target = 0;
    for (let i = 0; i < drag.mids.length; i++) {
      if (i !== drag.idx && center > drag.mids[i]) target++;
    }
    if (target === drag.target) return;
    drag.target = target;
    drag.cards.forEach((c, i) => {
      if (c === drag.card) return;
      let s = 0;
      if (drag.idx < target && i > drag.idx && i <= target) s = -drag.shift;
      else if (drag.idx > target && i >= target && i < drag.idx) s = drag.shift;
      c.style.transform = s ? `translateY(${s}px)` : "";
    });
  });

  const drop = () => {
    if (!drag) return;
    const { card, cards, idx, target } = drag;
    drag = null;
    card.classList.remove("dragging");
    for (const c of cards) c.style.transform = "";
    if (target !== idx) {
      const [moved] = trips.splice(idx, 1);
      trips.splice(target, 0, moved);
      saveTrips();
      buzz(8);
      renderTrips();
    }
  };
  list.addEventListener("pointerup", drop);
  list.addEventListener("pointercancel", drop);
}

// ---------- rates + status bar ----------

function renderStatus() {
  const el = $("#status");
  const cached = ratesInfo.data;
  $("#status-row").hidden = false;
  $("#status-stamp").textContent = cached ? `Fetched ${stampText(cached.fetchedAt)}` : "";
  if (!cached) {
    el.classList.add("offline");
    $("#offline-dot").hidden = false;
    $("#status-text").textContent = "No rates yet — go online once to load them";
    return;
  }
  const age = ageString(cached.fetchedAt);
  const offline = !ratesInfo.live || !navigator.onLine;
  el.classList.toggle("offline", offline);
  $("#offline-dot").hidden = !offline;
  $("#status-text").textContent = offline
    ? `Offline — using rates from ${age}`
    : `Rates as of ${age}`;
}

// `force` is a user-tapped refresh: fetch even if the cache is still fresh.
async function refreshRates(force = false) {
  const chip = $("#status");
  chip.classList.add("busy");
  const before = ratesInfo.data?.fetchedAt;
  ratesInfo = await loadRates(force);
  chip.classList.remove("busy");
  renderStatus();
  recompute();
  if (!force) return;
  const updated = ratesInfo.data?.fetchedAt !== before;
  if (ratesInfo.live && updated) toast("Rates updated just now");
  else if (ratesInfo.live) toast("Already up to date");
  else toast(navigator.onLine ? "Rate service unreachable — using cached" : "You're offline — using cached rates");
}

// ---------- trip editor ----------

// Expand a card (or collapse it when it's already the open one).
function toggleTrip(id) {
  settings = store.setSettings({ activeTripId: settings.activeTripId === id ? null : id });
  renderTrips();
}

// Swipe-left target: archive (or unarchive, in the archived view).
function toggleArchive(id) {
  const trip = trips.find((t) => t.id === id);
  if (!trip) return;
  const archiving = !trip.archived;
  trip.archived = archiving;
  if (archiving) {
    if (settings.pinnedTripId === id) settings = updateSettings({ pinnedTripId: null });
    if (settings.activeTripId === id) settings = store.setSettings({ activeTripId: null });
  }
  saveTrips();
  buzz(8);
  renderTrips();
  toast(archiving ? `Archived “${trip.name}”` : `Restored “${trip.name}”`, {
    actionLabel: "Undo",
    onAction: () => {
      // Look it up again rather than closing over `trip`. A snapshot
      // arriving inside the toast window rebuilds the trips array, and
      // writing to the object we captured would update a copy nothing
      // reads — Undo silently doing nothing.
      const now = trips.find((t) => t.id === id);
      if (!now) return;
      now.archived = !archiving;
      saveTrips();
      renderTrips();
    },
  });
}

// Horizontal swipe on a card head reveals and triggers Archive/Unarchive.
// Vertical intent bails out early so scrolling stays natural.
function enableTripSwipe() {
  const list = $("#trips");
  let sw = null;

  list.addEventListener("pointerdown", (e) => {
    // Swipe starts anywhere on the head except the reorder grip.
    const head = e.target.closest(".trip-card-head");
    if (!head || e.target.closest(".trip-drag")) return;
    const card = head.closest(".trip-card");
    sw = { card, slot: card.closest(".trip-slot"), id: card.dataset.trip,
      x0: e.clientX, y0: e.clientY, dx: 0, active: false };
  });

  list.addEventListener("pointermove", (e) => {
    if (!sw) return;
    const dx = e.clientX - sw.x0;
    const dy = e.clientY - sw.y0;
    if (!sw.active) {
      if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        sw.active = true;
        sw.card.classList.add("swiping");
        sw.slot.classList.add("swiping");
        try { sw.card.setPointerCapture(e.pointerId); } catch { /* synthetic */ }
      } else if (Math.abs(dy) > 12) {
        sw = null; // vertical scroll wins
        return;
      }
    }
    if (sw?.active) {
      sw.dx = Math.min(0, dx); // left only
      sw.card.style.transform = `translateX(${sw.dx}px)`;
    }
  });

  const end = () => {
    if (!sw) return;
    const { card, slot, id, dx, active } = sw;
    sw = null;
    card.classList.remove("swiping");
    slot.classList.remove("swiping");
    card.style.transform = "";
    if (active) card.dataset.swiped = "1"; // swallow the click that follows
    if (active && dx < -80) toggleArchive(id);
  };
  list.addEventListener("pointerup", end);
  list.addEventListener("pointercancel", end);
}

// One trip can be pinned: it always opens expanded when the app launches.
function togglePin(id) {
  const pinning = settings.pinnedTripId !== id;
  settings = updateSettings({ pinnedTripId: pinning ? id : null });
  if (pinning) settings = store.setSettings({ activeTripId: id }); // show what pinning means
  renderTrips();
  toast(pinning ? "Pinned — this trip opens expanded on launch" : "Unpinned");
}

// Editor state: which trip is being edited (null = new) + picked codes
// + a buffered member list (so members work for brand-new trips too).
let editorId = null;
let editorPicked = [];
let editorMembers = [];

function openEditor(trip) {
  editorId = trip?.id ?? null;
  editorPicked = trip ? [...trip.currencies] : [];
  editorMembers = trip?.members?.length
    ? structuredClone(trip.members)
    : [{ id: "me", name: "You" }];
  $("#editor-member-name").value = "";
  renderEditorMembers();
  $("#editor-title").textContent = trip ? "Edit trip" : "New trip";
  $("#editor-name").value = trip?.name ?? "";
  $("#editor-search").value = "";
  $("#editor-manage").hidden = !trip; // duplicate/archive/delete exist only for saved trips
  // Archive gets a visible home here — the swipe gesture alone is
  // undiscoverable, and archived data must never look deleted.
  $("#editor-archive").textContent = trip?.archived ? "Unarchive trip" : "Archive trip";
  renderEditor();
  $("#editor-sheet").showModal();
  if (!trip) $("#editor-name").focus(); // new trip: start typing the name right away
}

// Member chips in the trip editor. "You" is fixed; members with recorded
// expenses can't be removed.
function renderEditorMembers() {
  const box = $("#editor-members");
  box.innerHTML = "";
  for (const m of editorMembers) {
    // Settlements count too. The member editor was taught this; this
    // copy of the same check was not, so someone who only appears in a
    // recorded repayment could still be removed here.
    const used = editorId && (
      expenses.some((e) => e.tripId === editorId &&
        (e.paidBy === m.id || e.split.parts[m.id] > 0)) ||
      settlements.some((p) => p.tripId === editorId && (p.from === m.id || p.to === m.id))
    );
    // Anyone may be removed except yourself — you can't leave your own
    // trip by accident, and expenses must be reassigned first.
    const removable = m.id !== selfMemberId(editorMembers, account) && !used;
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip" + (removable ? "" : " locked");
    chip.dataset.mrm = removable ? m.id : "";
    chip.dataset.mwhy = removable ? "" : (used ? "used" : "self");
    chip.textContent = removable ? `${m.name} ✕` : m.name;
    box.appendChild(chip);
  }
}

// A locked chip explains itself when tapped. The member editor already
// had the wording; the trip editor — where you first try to remove
// someone — silently did nothing.
function explainLockedMember(why) {
  toast(why === "self"
    ? "You can't remove yourself from your own trip."
    : "They're in this trip's books — open them from Members to hand it over and remove them.");
}

function addEditorMember() {
  const name = $("#editor-member-name").value.trim();
  if (!name) return;
  // Two people called "Bo" are indistinguishable everywhere in the UI,
  // and settle-up ends up instructing you to pay yourself. The ids are
  // distinct, so the maths was never wrong — the screen was.
  const clash = editorMembers.some((m) => m.name.toLowerCase() === name.toLowerCase());
  if (clash) {
    toast(`Already someone called “${name}” — add a surname or initial.`);
    return;
  }
  editorMembers.push({ id: crypto.randomUUID(), name });
  $("#editor-member-name").value = "";
  renderEditorMembers();
  $("#editor-member-name").focus();
}

function renderEditor() {
  // A trip without a currency is meaningless — Save stays off until one is
  // picked, and says so: a dead button can't explain itself any other way.
  const save = $("#editor-save");
  save.disabled = editorPicked.length === 0;
  save.textContent = save.disabled ? "Pick a currency" : (editorId ? "Save trip" : "Create trip");
  $("#search-clear").hidden = !$("#editor-search").value;
  const pickedBox = $("#editor-picked");
  pickedBox.innerHTML = "";
  for (const code of editorPicked) pickedBox.appendChild(pickedChip(code));
  const results = $("#editor-results");
  results.innerHTML = "";
  const query = $("#editor-search").value;
  const codes = searchCurrencies(query).slice(0, 30);
  for (const code of codes) {
    results.appendChild(resultItem(code, editorPicked.includes(code), matchLabel(code, query)));
  }
  if (!codes.length) {
    const li = document.createElement("li");
    li.className = "no-results";
    li.textContent = `No matches for “${query.trim()}”`;
    results.appendChild(li);
  }
}

function toggleEditorCode(code) {
  // Adding a currency dedupes automatically: France + Netherlands → one EUR.
  editorPicked = editorPicked.includes(code)
    ? editorPicked.filter((c) => c !== code)
    : dedupe([...editorPicked, code]);
  renderEditor();
}

function saveEditor() {
  const name = $("#editor-name").value.trim() || `Trip ${trips.length + 1}`;
  if (editorPicked.length === 0) return; // Save is disabled; belt and braces
  if (editorId) {
    const trip = trips.find((t) => t.id === editorId);
    // It can genuinely be gone: absorbRemote purges a trip deleted on
    // another device immediately, and only the REDRAW waits for this
    // sheet to close. Saving used to throw here and leave the sheet
    // open with no explanation.
    if (!trip) {
      closeEditor();
      toast("That trip was deleted on another device.");
      return;
    }
    trip.name = name;
    trip.currencies = dedupe(editorPicked);
    // editorMembers is a clone taken when the sheet OPENED. A member
    // added on another phone since then is written into the trip
    // immediately (only the redraw waits for this sheet to close), so
    // assigning the snapshot deleted them — with a fresh stamp, which
    // then won the merge and deleted them everywhere. Keep anyone this
    // sheet never saw; the editor only speaks for what it showed.
    const shown = new Set(editorMembers.map((m) => m.id));
    const arrived = (trip.members ?? []).filter((m) => !shown.has(m.id));
    trip.members = [...editorMembers, ...arrived];

  } else {
    const trip = { id: crypto.randomUUID(), name, currencies: dedupe(editorPicked),
      members: editorMembers, createdAt: Date.now() };
    trips.push(trip);
    settings = store.setSettings({ activeTripId: trip.id });
  }
  saveTrips();
  $("#editor-sheet").close();
  renderTrips();
}

// Remove a trip and everything hanging off it from THIS device.
// `alsoCloud` is false when the delete arrived from another device —
// that device already cleaned up the shared copies.
function purgeTripLocally(id, { alsoCloud = false } = {}) {
  if (!trips.some((t) => t.id === id)) return false;
  trips = trips.filter((t) => t.id !== id);
  const swept = expenses.filter((e) => e.tripId === id);
  expenses = expenses.filter((e) => e.tripId !== id); // sweep the trip's ledger
  settlements = settlements.filter((p) => p.tripId !== id);
  saveTrips();          // records the local trip tombstone (store.js)
  saveExpenses();
  saveSettlements();
  deleteAttachments(swept.filter((e) => e.attachment).map((e) => e.id)).catch(() => {});
  if (alsoCloud) for (const e of swept.filter((x) => x.attachment)) deleteCloudReceipt(id, e.id);
  if (settings.pinnedTripId === id) settings = updateSettings({ pinnedTripId: null });
  if (settings.activeTripId === id) {
    settings = store.setSettings({ activeTripId: trips[0]?.id ?? null });
  }
  return true;
}

function deleteTrip(id) {
  const doomed = trips.find((t) => t.id === id);
  if (!doomed) return;
  purgeTripLocally(id, { alsoCloud: true });
  // Without this the cloud copy survives and the next sync restores the
  // trip — on this device AND everyone else's.
  pushTripTombstone(id, doomed);
  $("#editor-sheet").close();
  renderTrips();
  // Every other destructive action says something. This one — the
  // largest — said nothing at all, so the screen just changed.
  toast(`Deleted “${doomed.name}”`);
}

// Replace the trip's cloud document with a tombstone. If it fails
// (offline, mid-flight), the LOCAL tombstone recorded by purgeTripLocally
// makes every later sync try again — see syncNow's pull loop.
async function pushTripTombstone(id, trip) {
  if (!account) return;
  try {
    const { buildPayload, tombstonePayload } = await import("./sync.js");
    const { syncTrip } = await import("./firestore.js");
    const payload = buildPayload({
      trip, expenses: [], settlements: [], tombstones: {}, uid: account.uid,
    });
    await syncTrip(id, tombstonePayload(payload, store.getTombstones().trips?.[id] ?? Date.now()));
  } catch { /* retried by the next sync */ }
}

function duplicateTrip(id) {
  const src = trips.find((t) => t.id === id);
  if (!src) return;
  // Duplicating is a TEMPLATE action — "same currencies, same people,
  // fresh ledger" — not a re-share. Carrying the members' `uid` and
  // `email` across meant the copy was created in the cloud already
  // shared with everyone on the original, and each of them got a push
  // saying they'd been added to a trip they'd never heard of.
  //
  // The names come along, because that's the point. The account links do
  // not: whoever duplicated it can invite people again deliberately.
  const copy = {
    id: crypto.randomUUID(),
    name: `${src.name} copy`,
    currencies: [...src.currencies],
    members: structuredClone(src.members ?? []).map((m) => {
      const { uid, email, ...rest } = m;
      return m.id === selfMemberId(src.members ?? [], account) ? m : rest;
    }),
    createdAt: Date.now(),
    lastEdit: null,
  };
  trips.push(copy);
  settings = store.setSettings({ activeTripId: copy.id }); // open the copy
  saveTrips();
  $("#editor-sheet").close();
  renderTrips();
  toast(`Duplicated “${src.name}”`);
}

// In-sheet confirm: first tap arms the button ("Sure?"), second tap deletes.
function armDelete() {
  const trip = trips.find((t) => t.id === editorId);
  if (!trip) return;
  // Arming used to just relabel this button, so a double-tap deleted the
  // trip — and the label never said what was about to go. A delete is
  // FINAL (ADR-0013): it takes the expenses, the settlements and the
  // receipts, on every device, with no undo. It gets its own target.
  const mine = expenses.filter((e) => e.tripId === editorId);
  const pays = settlements.filter((p) => p.tripId === editorId).length;
  const shots = mine.filter((e) => e.attachment).length;
  const bits = [
    mine.length && `${mine.length} ${mine.length === 1 ? "expense" : "expenses"}`,
    pays && `${pays} ${pays === 1 ? "payment" : "payments"}`,
    shots && `${shots} ${shots === 1 ? "receipt" : "receipts"}`,
  ].filter(Boolean);
  // The count used to REPLACE "This can't be undone" — so the warning
  // disappeared exactly when there was something to lose. Both, always.
  $("#confirm-title").textContent = `Delete “${trip.name}”?`;
  $("#confirm-body").textContent =
    (bits.length ? `${bits.join(", ")} go with it. ` : "") +
    "Everyone on this trip loses it too, and this can't be undone.";
  $("#confirm-sheet").showModal();
}

// ---------- sync / account (phase D3.2) ----------
//
// Signing in IS the opt-in: no account, no network calls, no SDK. The
// Firebase modules are imported lazily inside these handlers so a
// signed-out user never downloads them.

let account = null; // { uid, email } once signed in

function renderAccount({ note = "", bad = false } = {}) {
  const signedIn = !!account;
  $("#sync-out").hidden = signedIn;
  $("#sync-in").hidden = !signedIn;
  // Someone opened an invite link but isn't signed in yet. A toast is
  // gone in seconds; this is the only thing telling them what to do, so
  // it stays put until they act on it.
  const awaitingJoin = !signedIn && !!settings.pendingJoin;
  $("#join-prompt").hidden = !awaitingJoin;
  renderPushRow();

  const unverified = signedIn && account.emailVerified === false;
  if (signedIn) {
    $("#sync-email").textContent = account.email ?? "Signed in";
    if (document.activeElement?.id !== "profile-name") $("#profile-name").value = settings.profileName ?? "";
    if (document.activeElement?.id !== "profile-phone") $("#profile-phone").value = settings.profilePhone ?? "";
    $("#sync-when").textContent = unwatch
      ? "Live — changes appear as they happen"
      : (settings.lastSyncAt ? `Last synced ${ageString(settings.lastSyncAt)}` : "Not synced yet");
    // Invites are only honoured for verified addresses (see the rules),
    // so an unverified account would silently never receive them.
    $("#resend-verify").hidden = !unverified;
    // Verifying is now only needed for shared trips to find you on their
    // own; an invite link works without it. Say so, so an email that
    // never arrives isn't a dead end.
    if (unverified && !note) {
      note = "Verify your email so shared trips find you automatically. Not needed if someone sends you an invite link.";
    }
  }
  renderProfileButton();
  renderProfileHead();
  const noteEl = $("#sync-note");
  noteEl.hidden = !note;
  noteEl.textContent = note;
  noteEl.classList.toggle("bad", bad);
}

const syncBusy = (on) => document.querySelector(".sync-card").classList.toggle("busy", on);

// "It said nothing and stayed signed out" is the worst possible outcome —
// it happened once (v1.24, no listener attached) and must never be silent
// again. If a sign-in reports success but leaves no session, say so.
function reportIncompleteSignIn(ok, user) {
  if (ok && !user) {
    renderAccount({ note: "Sign-in didn't complete. Try again — if it keeps failing, tell Claude.", bad: true });
  }
}

// Wrap any auth call: one place for the spinner, the friendly error text,
// and the "remember to reconnect on next launch" hint.
// Returns { ok, user } — callers must not assume ok means signed in.
async function runAuth(fn) {
  const { authErrorMessage, currentUser } = await import("./firebase.js");
  syncBusy(true);
  renderAccount({ note: "Working…" });
  try {
    await connectAuth(); // the state listener must exist BEFORE we sign in
    await fn();
    // Read the session straight back rather than waiting on the listener,
    // so the UI can never sit there still saying "Continue with Google"
    // after a sign-in that actually worked.
    const user = await currentUser();
    onAccountChange(user);
    return { ok: true, user };
  } catch (err) {
    const msg = authErrorMessage(err?.code);
    renderAccount(msg ? { note: msg, bad: true } : {});
    return { ok: false, user: null };
  } finally {
    syncBusy(false);
  }
}

// ----- sharing a trip (phase D3.4) -----
//
// Access is controlled by email: the invited address goes on the trip,
// and Firestore's rules let that person in once they sign in with it.
// DELIVERY is deliberately not automated — the app hands the invite to
// the phone's own share sheet, so it arrives from a person the recipient
// already knows rather than from a service they've never heard of.
// (Sending mail or WhatsApp from a server would need the paid plan.)

let shareTripId = null;

const inviteLink = (tripId) =>
  `${location.origin}${location.pathname}?join=${encodeURIComponent(tripId ?? "")}`;

// Written per-recipient: naming the wrong person's address is worse than
// no message at all, and how they sign in is their business — the only
// thing that matters is WHICH address.
const inviteMessage = (email, tripId) => {
  const trip = trips.find((t) => t.id === tripId);
  return `I've added you to "${trip?.name}" on TripCash — we each log what we spend ` +
    `and it works out who owes whom at the end.\n\n` +
    `Sign in with ${email} and the trip will be there:\n${inviteLink(tripId)}`;
};

async function shareInviteTo(email, tripId, phone) {
  const text = inviteMessage(email, tripId ?? shareTripId);
  // Straight to their chat when we know the number — no contact picker,
  // no choosing the wrong Rahul.
  const number = whatsappNumber(phone);
  if (number) {
    window.open(`https://wa.me/${number}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
    return;
  }
  if (navigator.share) {
    try {
      await navigator.share({ title: "TripCash", text });
    } catch { /* dismissed — not an error */ }
    return;
  }
  // No share sheet (desktop): WhatsApp Web is the next best thing.
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
}

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
const PUSH_DELAY_MS = 1200;
let suppressPush = false;  // set while absorbing a snapshot, to stop ping-pong
let liveDirty = false;     // a snapshot arrived while a sheet was open
let liveRenderTimer = null;

let unwatchPrefs = null;

async function startLiveUpdates() {
  if (unwatch || !account) return;
  try {
    const { watchMyTrips, watchPrefs } = await import("./firestore.js");
    unwatch = await watchMyTrips(account.uid, absorbRemote, () => {
      unwatch = null; // listener dropped; manual sync is still there
    });
    unwatchPrefs ??= await watchPrefs(account.uid, applyPrefs, () => {
      unwatchPrefs = null;
    });
  } catch { /* offline or refused — the app works regardless */ }
}

function stopLiveUpdates() {
  unwatch?.();
  unwatch = null;
  unwatchPrefs?.();
  unwatchPrefs = null;
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
function absorbInto(merged, tripId, { buildPayload, mergePayload, applyPayload }) {
  const held = trips.find((t) => t.id === tripId);
  const current = held ? buildPayload({
    trip: held,
    expenses: expenses.filter((e) => e.tripId === tripId),
    settlements: settlements.filter((s) => s.tripId === tripId),
    tombstones: store.getTombstones(),
    uid: account?.uid,
  }) : null;
  const reconciled = current ? mergePayload(current, merged) : merged;

  if (reconciled?.deleted) return { deleted: true };

  const next = applyPayload({
    merged: reconciled, tripId, trips, expenses, settlements,
    tombstones: store.getTombstones(),
  });
  // Receipts for expenses a remote tombstone just removed. Nothing else
  // sweeps them: deleteAttachment only ran for deletes made HERE, so a
  // photo deleted on another phone stayed in IndexedDB on this one for
  // ever, on every device that had ever seen it.
  const surviving = new Set(next.expenses.map((e) => e.id));
  const orphaned = expenses
    .filter((e) => e.tripId === tripId && e.attachment && !surviving.has(e.id))
    .map((e) => e.id);
  if (orphaned.length) deleteAttachments(orphaned).catch(() => {});
  trips = next.trips;
  expenses = next.expenses;
  settlements = next.settlements;
  store.setTombstones(next.tombstones); // BEFORE the saves, not after
  saveTrips();
  saveExpenses();
  saveSettlements();
  return { deleted: false, reconciled };
}

async function absorbRemote(tripId, remote) {
  const { buildPayload, mergePayload, applyPayload, payloadChanged } = await import("./sync.js");
  const trip = trips.find((t) => t.id === tripId);
  const local = trip ? buildPayload({
    trip,
    expenses: expenses.filter((e) => e.tripId === tripId),
    settlements: settlements.filter((s) => s.tripId === tripId),
    tombstones: store.getTombstones(),
    uid: account?.uid,
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

// Never redraw underneath an open sheet — someone mid-way through typing
// an expense would lose their place. Redraw when they're done instead.
function queueLiveRender() {
  liveDirty = true;
  clearTimeout(liveRenderTimer);
  liveRenderTimer = setTimeout(flushLiveRender, 400);
}

function flushLiveRender() {
  if (!liveDirty) return;
  if (document.querySelector("dialog[open]")) return; // retried on close
  liveDirty = false;
  renderTrips();
}

// Local edits go up on their own, shortly. Debounced because saveTrips()
// fires on every keystroke of the converter — a burst collapses into one
// push, which usually finds nothing changed and costs a single read.
function scheduleSync() {
  if (!account || suppressPush) return;
  clearTimeout(pushTimer);
  pushTimer = setTimeout(flushPush, PUSH_DELAY_MS);
}

function flushPush() {
  clearTimeout(pushTimer);
  pushTimer = null;
  if (!account || suppressPush) return;
  // syncNow refuses to run while another sync is in flight. Dropping the
  // push there meant an edit made during a slow sync sat local until
  // some unrelated save happened to trigger another one — the "I changed
  // it on my phone and it never arrived" report, again.
  if (syncing) {
    pushTimer = setTimeout(flushPush, PUSH_DELAY_MS);
    return;
  }
  syncNow({ silent: true });
}


// Settings writes that carry a travelling preference must also schedule a
// push — otherwise pinning a trip changes nothing on your other device.
function updateSettings(patch) {
  const before = pickSynced(settings);
  settings = store.setSettings(patch);
  if (syncedChanged(before, pickSynced(settings))) scheduleSync();
  return settings;
}

// ----- who you are, visible without opening anything (v1.39) -----
//
// Sign-in state used to live behind the Settings gear, so a device that
// quietly signed out looked completely normal — you could add trips for
// days believing they were syncing. The avatar in the top bar is now the
// indicator, and an unexpected sign-out gets a strip you can't miss.

// `el.hidden = x` silently does nothing on an <svg> — it's an SVGElement,
// not an HTMLElement. Toggling the ATTRIBUTE works for both, and this is
// the second time that has caught us (see the SVG gotcha in
// PROJECT_CONTEXT), so every avatar layer goes through it.
const setHidden = (el, on) => {
  if (!el) return;
  if (on) el.setAttribute("hidden", "");
  else el.removeAttribute("hidden");
};

const avatarImage = () => settings.profilePhoto || account?.photoURL || "";
const avatarName = () => settings.profileName || account?.displayName || account?.email || "";

function renderProfileButton() {
  const img = $("#profile-avatar");
  const initials = $("#profile-initials");
  const anon = $("#profile-anon");
  const src = account ? avatarImage() : "";
  const letters = account ? initialsFrom(avatarName()) : "";

  setHidden(img, !src);
  if (src && img.src !== src) img.src = src;
  setHidden(initials, !!src || !letters);
  initials.textContent = letters;
  setHidden(anon, !!src || !!letters);

  // This device HAD an account and no longer does — the state that let
  // trips pile up unsynced for days. Worth stronger wording and colour
  // than a device that has simply never signed in.
  const droppedOut = !account && !!settings.syncHint;

  // The badge marks "there's something to do here" and stays put whether
  // or not the prompt below has been dismissed — it's the quiet,
  // permanent indicator. Amber when something actually went wrong,
  // accent when you've simply never signed in.
  setHidden($("#profile-dot"), !!account);
  $("#profile-dot").classList.toggle("warn", droppedOut);
  $("#profile-btn").setAttribute("aria-label",
    account ? `Profile — signed in as ${avatarName()}`
      : droppedOut ? "Profile — signed out, not syncing" : "Profile — not signed in, tap to sync");

  // The prompt is dismissable, so it can appear for everyone signed out
  // without nagging anyone. Signing in clears the dismissal, so a session
  // that drops later speaks up again.
  $("#signed-out-text").textContent = droppedOut
    ? "Signed out — changes on this device aren't syncing."
    : "Not signed in — your trips stay on this device only.";
  setHidden($("#signed-out-strip"), !!account || !!settings.noticeDismissed);
}

// The profile header inside Settings.
function renderProfileHead() {
  const src = account ? avatarImage() : "";
  const letters = account ? initialsFrom(avatarName()) : "";
  const img = $("#avatar-big-img");
  setHidden(img, !src);
  if (src && img.src !== src) img.src = src;
  setHidden($("#avatar-big-initials"), !!src || !letters);
  $("#avatar-big-initials").textContent = letters;
  setHidden($("#avatar-big-anon"), !!src || !!letters);
  setHidden($("#avatar-edit"), !account);
  $("#profile-who-name").textContent = account
    ? (avatarName() || "Signed in")
    : "Not signed in";
  $("#profile-who-sub").textContent = account
    ? (account.email ?? "")
    : "Your trips stay on this device until you sign in.";
}

async function pickAvatar(file) {
  if (!file) return;
  try {
    const { avatarDataUrl } = await import("./attach.js");
    settings = updateSettings({ profilePhoto: await avatarDataUrl(file) });
    renderProfileButton();
    renderProfileHead();
    toast("Picture updated");
  } catch {
    toast("Couldn't use that image");
  }
}

// ----- receipts in the cloud (phase D3.5) -----
//
// Local IndexedDB is what the UI reads; the cloud is the backing copy.
// attachment.cloudAt on the expense record (which syncs) is how devices
// know a copy exists and whether theirs is stale.

// Local first; reach for the cloud only when the record says there's a
// copy we don't have. Returns { blob? , url?, name, type } — a device
// that has never seen the file gets a URL, which is enough to show it.
// Throws so the caller can say WHY, rather than a shrug.
async function fetchReceipt(expense) {
  const local = await getAttachment(expense.id).catch(() => null);
  const { needsFetch } = await import("./receipts.js");
  if (!needsFetch(local, expense.attachment) || !account) return local;

  const { receiptUrl, cacheableBlob } = await import("./receipts.js");
  const url = await receiptUrl(expense.tripId, expense.id);
  const meta = { name: expense.attachment.name, type: expense.attachment.type,
    cloudAt: expense.attachment.cloudAt };
  // Keep a copy for offline, but never block showing the receipt on it.
  cacheableBlob(url).then((blob) => {
    if (blob) putAttachment(expense.id, { ...meta, blob }).catch(() => {});
  });
  return { ...meta, url };
}

// A receipt can be a local blob or a remote URL; both display the same.
function receiptSrc(rec) {
  if (rec?.blob) {
    const url = URL.createObjectURL(rec.blob);
    attachUrls.push(url);
    return url;
  }
  return rec?.url ?? "";
}

// Why a receipt wouldn't open, in words worth reading.
async function explainReceiptFailure(err, expense) {
  const { storageErrorMessage, isPendingUpload } = await import("./receipts.js");
  if (!account) return "Sign in to see receipts added on another device.";
  if (isPendingUpload(expense)) {
    return "This receipt hasn't reached the cloud yet — open TripCash on the device that added it and let it sync.";
  }
  return storageErrorMessage(err?.code);
}

// Push one expense's receipt up and stamp the record so every device —
// including this one — knows the cloud copy's age. Never throws: an
// offline upload is simply retried by the next sync.
async function uploadReceiptFor(expenseId, { loud = false } = {}) {
  if (!account) return;
  try {
    const expense = expenses.find((e) => e.id === expenseId);
    if (!expense?.attachment) return;
    const rec = await getAttachment(expenseId);
    if (!rec?.blob) return; // metadata synced in but the blob lives elsewhere
    const { uploadReceipt } = await import("./receipts.js");
    await uploadReceipt(expense.tripId, expenseId, rec);
    const cloudAt = Date.now();
    await putAttachment(expenseId, { ...rec, cloudAt }).catch(() => {});
    expenses = expenses.map((e) =>
      e.id === expenseId ? { ...e, attachment: { ...e.attachment, cloudAt } } : e);
    saveExpenses(); // propagates cloudAt so other phones can fetch it
  } catch (err) {
    // Silence here is what made this hard to diagnose the first time.
    if (loud) {
      const { storageErrorMessage } = await import("./receipts.js");
      toast(storageErrorMessage(err?.code));
    }
  }
}

// Anything saved while offline or before sign-in catches up here.
async function uploadPendingReceipts() {
  if (!account) return;
  const { isPendingUpload } = await import("./receipts.js");
  for (const e of expenses.filter(isPendingUpload)) {
    await uploadReceiptFor(e.id);
  }
}

// Best-effort cloud cleanup; an orphaned object costs ~nothing and must
// never block the delete that triggered it.
function deleteCloudReceipt(tripId, expenseId) {
  if (!account) return;
  import("./receipts.js").then(({ deleteReceipt }) =>
    deleteReceipt(tripId, expenseId)).catch(() => {});
}

// ----- preferences that follow you between devices (phase D3.8) -----

// Apply an incoming set of preferences and redraw whatever they affect.
// Pinning, home currency and the street-rate markup all change what's on
// screen, so this can't just write to storage and hope.
function applyPrefs(prefs) {
  if (!prefs) return;
  // Deliberately NOT pruned here. This runs from a live snapshot, and
  // the two Firestore listeners are independent: the small prefs
  // document usually arrives before the trip it pins. Pruning against a
  // trip list that hasn't caught up wiped the pin and pushed the wipe
  // back, unpinning it on the device that had just pinned it. A pin
  // pointing at a trip we don't hold simply matches nothing when we
  // render; it is cleaned up after a full pull instead.
  const before = pickSynced(settings);
  if (!syncedChanged(before, { ...before, ...pickSynced(prefs) })) return;
  settings = store.setSettings({ ...pickSynced(prefs), prefsUpdatedAt: prefs.updatedAt });
  $("#markup-toggle").checked = !!settings.markupOn;
  $("#markup-pct").value = String(settings.markupPct);
  syncMarkupRow();
  renderTrips();
}

async function syncPrefs() {
  if (!account) return;
  const { fetchPrefs, savePrefs } = await import("./firestore.js");
  const local = { ...pickSynced(settings), updatedAt: settings.prefsUpdatedAt ?? 0 };
  const remote = await fetchPrefs(account.uid);

  // Learn this device's clock offset from the server stamp we wrote last
  // time. Without it, a device running fast overwrites changes it has
  // never seen, purely because its stamps are inflated (ADR-0014).
  // Read back OUR OWN probe from last time to learn this device's offset.
  const mine = remote?.clocks?.[deviceId()];
  const serverAt = mine?.serverAt?.toMillis?.();
  if (Number.isFinite(serverAt) && Number.isFinite(mine?.localAt)) {
    const offset = clockOffsetFrom(serverAt, mine.localAt);
    if (offset !== (settings.clockOffset ?? 0)) {
      settings = store.setSettings({ clockOffset: offset }); // device-local, never synced
    }
  }

  const winner = mergePrefs(local, remote);
  if (winner === remote) applyPrefs(remote);
  // Write when the preferences changed OR when this device has no clock
  // probe yet — otherwise the offset is never learnt at all, which is
  // exactly how the first attempt at this ended up doing nothing.
  const needsProbe = !mine;
  if (winner !== remote && JSON.stringify(winner) !== JSON.stringify(remote)) {
    await savePrefs(account.uid, winner, {
      deviceId: deviceId(), clocks: remote?.clocks, email: normEmail(account.email),
    });
  } else if (needsProbe || remote?.email !== normEmail(account.email)) {
    await savePrefs(account.uid, winner, {
      deviceId: deviceId(), clocks: remote?.clocks, email: normEmail(account.email),
    });
  }
}

// ----- push notifications (phase D4) -----
//
// Live updates only run while the app is OPEN (ADR-0012). This is the
// only way to hear that someone added an expense while it's closed.
// Opt-in per device, and per device is the right grain: notifications on
// your phone, silence on the laptop you left at the hotel.

// `pushToken` is device-local — it identifies THIS browser, so syncing it
// would have every device claiming every other device's token.
function renderPushRow() {
  const row = $("#push-row");
  const note = $("#push-note");
  if (!account) { setHidden(row, true); setHidden(note, true); return; }

  const blocker = pushBlocker();
  setHidden(row, !!blocker);
  setHidden(note, !blocker);
  note.textContent = blocker;

  const on = !!settings.pushToken && pushGranted();
  const btn = $("#push-toggle");
  btn.textContent = on ? "On" : "Turn on";
  btn.classList.toggle("on", on);
  btn.setAttribute("aria-pressed", String(on));
  $("#push-sub").textContent = on
    ? "You'll hear about new expenses on shared trips"
    : "When someone adds an expense to a shared trip";
}

async function togglePush() {
  if (!account) return;
  const btn = $("#push-toggle");
  const wasOn = !!settings.pushToken;
  btn.disabled = true;
  try {
    const { savePushToken, removePushToken } = await import("./firestore.js");
    if (wasOn) {
      // Our stored token is the authoritative one. disablePush used to
      // mint a fresh token to report back, and we deleted THAT key —
      // leaving the real, rotated registration in Firestore for ever.
      await removePushToken(account.uid, settings.pushToken).catch(() => {});
      await disablePush();
      settings = store.setSettings({ pushToken: null });
      toast("Notifications off for this device");
    } else {
      // Straight from the tap: Safari discards a permission prompt that
      // isn't in a user gesture, without saying so.
      const token = await enablePush();
      if (!token) {
        // Declined is not a failure — say what it means and stop.
        renderPushRow();
        toast("Notifications stay off. You can turn them on here any time.");
        return;
      }
      await savePushToken(account.uid, token);
      settings = store.setSettings({ pushToken: token, pushTokenUid: account.uid });
      toast("Notifications on for this device");
    }
  } catch {
    toast("Couldn't change notifications — try again in a moment.");
  } finally {
    btn.disabled = false;
    renderPushRow();
  }
}

// A token can be rotated by the browser at any time; the copy the server
// holds then points at nothing. Re-registering on each launch is cheap
// and keeps the two in step.
async function refreshPushToken() {
  if (!account || !settings.pushToken || !pushGranted() || pushBlocker()) return;
  try {
    const token = await enablePush();
    if (!token) return;
    const { savePushToken, removePushToken } = await import("./firestore.js");
    // Re-claim under the CURRENT account even when the token itself
    // hasn't changed. A session can be replaced rather than ended (a
    // sign-in redirect returning a different Google account), and the
    // early-return here used to leave the registration filed under the
    // previous uid — so the new user's device received the previous
    // user's trip notifications and none of their own.
    if (token !== settings.pushToken || settings.pushTokenUid !== account.uid) {
      if (settings.pushTokenUid && settings.pushTokenUid !== account.uid) {
        await removePushToken(settings.pushTokenUid, settings.pushToken).catch(() => {});
      } else if (token !== settings.pushToken) {
        await removePushToken(account.uid, settings.pushToken).catch(() => {});
      }
      await savePushToken(account.uid, token);
      settings = store.setSettings({ pushToken: token, pushTokenUid: account.uid });
    }
  } catch { /* offline, or permission pulled — the row re-renders anyway */ }
}

// Land on the trip the notification was about. It may not be here yet —
// the notification can easily beat the sync that carries the trip — so
// pull first, then open whatever arrived.
function openTripFromNotification(tripId) {
  const show = () => {
    if (!trips.some((t) => t.id === tripId)) return false;
    settings = store.setSettings({ activeTripId: tripId });
    renderTrips();
    document.querySelector(`.trip-card[data-trip="${CSS.escape(tripId)}"]`)
      ?.scrollIntoView({ block: "center", behavior: "smooth" });
    return true;
  };
  if (show()) return;
  syncNow({ silent: true }).then(show);
}

// A stable id for THIS device, so its clock probe is its own. Local only.
function deviceId() {
  if (!settings.deviceId) settings = store.setSettings({ deviceId: crypto.randomUUID() });
  return settings.deviceId;
}

// Your name and number belong to you, so YOUR device is what writes them
// into your member row — on every trip you're part of. Whoever added you
// only ever typed a placeholder so they could send the invite.
function pushProfileToTrips() {
  if (!account?.uid) return;
  const profile = { name: settings.profileName, phone: settings.profilePhone ?? "" };
  let touched = false;
  trips = trips.map((t) => {
    if (!t.members?.some((m) => m.uid === account.uid)) return t;
    const members = applyProfile(t.members, account.uid, profile);
    if (JSON.stringify(members) === JSON.stringify(t.members)) return t;
    touched = true;
    return { ...t, members };
  });
  if (!touched) return;
  saveTrips();
  renderTrips();
}

// ----- syncing (phase D3.3) -----

let syncing = false;

// Push every local trip through the merge, then pull down any trip this
// account can see that this device doesn't have yet.
async function syncNow({ silent = false } = {}) {
  if (!account || syncing) return false;
  syncing = true;
  if (!silent) renderAccount({ note: "Syncing…" });
  try {
    const { buildPayload, mergePayload, applyPayload } = await import("./sync.js");
    const { syncTrip, fetchMyTrips, fetchInvitedTrips } = await import("./firestore.js");
    let trouble = null; // first per-trip failure, reported at the end

    const arrivals = [];
    const absorb = (merged, tripId) => {
      if (merged?.deleted) { purgeTripLocally(tripId); return; }
      // Someone shared this with us and we've never seen it before. That
      // is the single most important thing a sync can discover, and it
      // used to just appear at the bottom of the trip list with no
      // announcement of any kind.
      if (!trips.some((t) => t.id === tripId)) {
        const name = merged?.trip?.name;
        if (name) arrivals.push({ id: tripId, name });
      }
      // Re-merges against state as it is NOW, not as it was when this
      // trip's upload began — see absorbInto.
      absorbInto(merged, tripId, { buildPayload, mergePayload, applyPayload });
    };

    for (const trip of [...trips]) {
      // NOTE: attaching this account to a member row used to happen HERE,
      // before the upload — and `saveTrips()` restamped the trip with the
      // current time. That handed a stale local copy a fresh stamp, so it
      // won the merge below and wiped out whatever the other device had
      // genuinely changed (archiving a trip, most visibly). Housekeeping
      // must never out-rank a real edit: it now runs AFTER the merge,
      // against content that is up to date. See ADR-0014.
      let merged;
      try {
        merged = await syncTrip(trip.id, buildPayload({
        trip,
        expenses: expenses.filter((e) => e.tripId === trip.id),
        settlements: settlements.filter((s) => s.tripId === trip.id),
        // Re-read per trip: absorbing one trip can add tombstones that
        // the next trip's upload should already carry.
        // Tombstones are keyed by record id only, so all of them ride
        // along. Ids are UUIDs (no cross-trip collisions) and the 90-day
        // prune keeps the list bounded — cheaper than tracking which
        // trip a long-deleted record used to belong to.
        tombstones: store.getTombstones(),
        uid: account.uid,
        }));
      } catch (err) {
        // One trip that can't sync must not stop every other trip — and
        // must not stop the PULL below, or a trip made on the other
        // device would never arrive here.
        trouble ??= err;
        continue;
      }
      absorb(merged, trip.id);

      // Now that this trip is current, claim our member row on it. Any
      // restamp here rides on merged content, so it can't erase anyone.
      const fresh = trips.find((t) => t.id === trip.id);
      if (fresh) {
        const linked = linkAccount(ensureMembers(fresh), account, {
          isOwner: !fresh.ownerUid || fresh.ownerUid === account.uid,
        });
        if (linked !== fresh.members) {
          fresh.members = linked;
          saveTrips(); // pushed on the next pass, carrying merged content
        }
      }
    }

    const { tombstonePayload, isDeleted } = await import("./sync.js");
    for (const { id, payload } of await fetchMyTrips(account.uid)) {
      if (trips.some((t) => t.id === id)) continue; // already handled above
      try {
        // Already settled in the cloud — nothing to say, and re-writing
        // it on every sync forever would be pure waste.
        if (isDeleted(payload)) continue;
        const deletedHere = store.getTombstones().trips?.[id];
        if (deletedHere) {
          // We deleted this and the cloud hasn't caught up. Re-assert it
          // rather than restoring what we just threw away.
          await syncTrip(id, tombstonePayload(payload, deletedHere));
          continue;
        }
        absorb(payload, id);
      } catch (err) {
        trouble ??= err; // this one trip only
      }
    }

    // Trips someone invited this address to. Accepting means writing our
    // own uid onto the trip, which the rules permit only for a verified
    // invited address — so this can't be used to join uninvited.
    //
    // Deliberately non-fatal: looking for invitations is a bonus on top
    // of syncing your own trips, and it needs a newer rules version than
    // pushing does. If it's refused, YOUR data has still synced — saying
    // "sync failed" here would be both alarming and untrue.
    let inviteNote = "";
    try {
      const { joinIfInvited } = await import("./sync.js");
      for (const { id, payload } of await fetchInvitedTrips(account.email)) {
        if (trips.some((t) => t.id === id)) continue;
        const joined = joinIfInvited(payload, account);
        absorb(await syncTrip(id, joined), id);
      }
    } catch (err) {
      inviteNote = err?.code === "permission-denied"
        ? " Invitations need the updated database rules — everything else synced."
        : " Couldn't check for invitations this time.";
    }

    // A trip opened from an invite link: fetched by id, so it doesn't
    // depend on the search above being permitted, or on a verified email.
    const pending = settings.pendingJoin;
    if (pending && !trips.some((t) => t.id === pending)) {
      try {
        const { fetchTripById } = await import("./firestore.js");
        const { joinIfInvited } = await import("./sync.js");
        const payload = await fetchTripById(pending);
        if (payload) {
          absorb(await syncTrip(pending, joinIfInvited(payload, account)), pending);
          settings = store.setSettings({ pendingJoin: null });
          inviteNote = " Shared trip added.";
        }
      } catch (err) {
        inviteNote = err?.code === "permission-denied"
          ? ` That shared trip isn't open to ${account.email} — ask them to invite this exact address.`
          : " Couldn't open the shared trip — try Sync now again.";
      }
    } else if (pending) {
      settings = store.setSettings({ pendingJoin: null }); // already have it
    }

    await syncPrefs().catch(() => {}); // preferences are a bonus, never fatal
    // Now — and only now — every trip this account can see is in hand, so
    // a pin with no trip behind it really is stale rather than early.
    const kept = prunePrefs(pickSynced(settings), trips.map((t) => t.id));
    if (kept.pinnedTripId !== settings.pinnedTripId) settings = updateSettings(kept);
    pushProfileToTrips();
    await uploadPendingReceipts(); // receipts saved offline catch up here
    settings = store.setSettings({ lastSyncAt: Date.now() });
    renderTrips();
    if (arrivals.length === 1) {
      const [trip] = arrivals;
      toast(`You were added to “${trip.name}”`, {
        actionLabel: "Open",
        onAction: () => openTripFromNotification(trip.id),
      });
      buzz(12);
    } else if (arrivals.length > 1) {
      toast(`${arrivals.length} trips were shared with you`);
      buzz(12);
    }
    if (trouble) {
      // Silence here is how the last two bugs stayed hidden. Say it out
      // loud, but not for a plain lost connection.
      const { syncErrorMessage } = await import("./firestore.js");
      const offline = trouble.code === "unavailable" || !navigator.onLine;
      renderAccount({ note: syncErrorMessage(trouble.code), bad: true });
      if (!offline && !silent) toast(syncErrorMessage(trouble.code));
    } else {
      renderAccount(inviteNote ? { note: `Synced.${inviteNote}` } : {});
    }
    return true;
  } catch (err) {
    const { syncErrorMessage } = await import("./firestore.js");
    renderAccount({ note: syncErrorMessage(err?.code), bad: true });
    return false;
  } finally {
    syncing = false;
  }
}

// Called once we have (or lose) a session — from sign-in, from a redirect
// coming back, and on launch for someone who was already signed in.
// Hand the push registration back BEFORE the session ends.
//
// This used to run from onAccountChange's signed-out branch, which is
// too late: `account` is null by then, so `removePushToken` had no uid
// and the rules would have refused the write regardless. The row sat in
// Firestore for ever, and the only thing stopping delivery was an
// unawaited deleteToken() behind a network call — so an offline sign-out
// left the token fully live. Your trip names and expense amounts then
// pushed to a browser somebody else was now using.
async function releasePushToken() {
  const token = settings.pushToken;
  const uid = account?.uid;
  if (!token) return;
  settings = store.setSettings({ pushToken: null, pushTokenUid: null });
  try {
    const { removePushToken } = await import("./firestore.js");
    if (uid) await removePushToken(uid, token); // while we still have a session
  } catch { /* offline: the server prunes it when FCM reports it dead */ }
  await disablePush();
}

function onAccountChange(next) {
  const wasSignedIn = !!account;
  account = next;
  // syncHint means "this device wants to sync", NOT "is signed in right
  // now". Only an explicit Sign out clears it — so a session that simply
  // expired stays flagged, which is what makes the warning possible.
  if (next && !settings.syncHint) settings = store.setSettings({ syncHint: true });
  // Signing in resets the dismissal so a LATER sign-out speaks up again.
  if (next && settings.noticeDismissed) settings = store.setSettings({ noticeDismissed: false });
  renderAccount();
  if (next) {
    // Freshly signed in (or session restored at launch) → sync straight away.
    if (!wasSignedIn) syncNow({ silent: true });
    startLiveUpdates();
    refreshPushToken();
  } else {
    stopLiveUpdates();
    // Notification cleanup happens in the SIGN-OUT handler, before the
    // session goes: by the time we get here `account` is already null,
    // so there is no uid to write with — and Firestore would refuse the
    // write anyway. All that is left to do is forget the token locally.
    if (wasSignedIn) settings = store.setSettings({ pushToken: null });
  }
}

// Idempotent: the listener is attached exactly once, whether we get here
// from launch (already signed in) or from the first tap on a sign-in
// button. Registering it lazily is what makes a signed-out user free.
let authConnection = null;
function connectAuth() {
  authConnection ??= (async () => {
    const { watchAuth, finishRedirect } = await import("./firebase.js");
    await watchAuth(onAccountChange);
    await finishRedirect(); // no-op unless we just came back from a redirect
  })();
  return authConnection;
}

// ---------- install ----------

// Chrome only shows its own install banner after repeated visits, so catch
// the event and offer an explicit button instead.
let installPrompt = null;
const isInstalled = () =>
  window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;

function wireInstall() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installPrompt = e;
    $("#install-row").hidden = false;
    $("#install-hint").hidden = true;
  });
  window.addEventListener("appinstalled", () => {
    installPrompt = null;
    $("#install-row").hidden = true;
    toast("TripCash installed");
  });
  $("#install-btn").addEventListener("click", async () => {
    if (!installPrompt) return;
    installPrompt.prompt();
    const { outcome } = await installPrompt.userChoice;
    installPrompt = null;
    $("#install-row").hidden = true;
    if (outcome !== "accepted") $("#install-hint").hidden = false;
  });
}

// ---------- settings + theme ----------

// Forced theme wins over the system preference (see the CSS variable blocks).
// The status-bar color follows whatever scheme is actually showing.
const THEME_BG = { light: "#eef2f1", dark: "#0b1210" };
function applyTheme() {
  const t = settings.theme ?? "auto";
  if (t === "auto") delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  for (const meta of document.querySelectorAll('meta[name="theme-color"]')) {
    const auto = meta.media.includes("dark") ? THEME_BG.dark : THEME_BG.light;
    meta.content = t === "auto" ? auto : THEME_BG[t];
  }
  for (const btn of document.querySelectorAll("#theme-seg [data-theme-opt]")) {
    btn.classList.toggle("on", btn.dataset.themeOpt === t);
  }
}

function openSettings() {
  const sel = $("#home-select");
  sel.innerHTML = "";
  for (const code of ALL_CODES) {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = `${CURRENCIES[code].flag} ${code} — ${CURRENCIES[code].name}`;
    opt.selected = code === settings.homeCurrency;
    sel.appendChild(opt);
  }
  applyTheme(); // sync the segmented control
  renderAccount();
  $("#install-row").hidden = !installPrompt;
  $("#install-hint").hidden = !!installPrompt || isInstalled();
  $("#settings-sheet").showModal();
}

// Pull-down-to-dismiss: dragging the grab zone moves the sheet with the
// finger; releasing past the threshold closes it, otherwise it springs back.
function enableSheetPull(dialog) {
  const zone = dialog.querySelector(".grab-zone");
  if (!zone) return;
  let startY = null;
  zone.addEventListener("pointerdown", (e) => {
    startY = e.clientY;
    zone.setPointerCapture(e.pointerId);
    dialog.style.transition = "none";
  });
  zone.addEventListener("pointermove", (e) => {
    if (startY === null) return;
    dialog.style.transform = `translateY(${Math.max(0, e.clientY - startY)}px)`;
  });
  const release = (e) => {
    if (startY === null) return;
    const dy = Math.max(0, e.clientY - startY);
    startY = null;
    dialog.style.transition = "transform 0.18s ease-out";
    if (dy > 90) {
      dialog.style.transform = "translateY(110%)";
      setTimeout(() => {
        dialog.close();
        dialog.style.transform = "";
        dialog.style.transition = "";
      }, 180);
    } else {
      dialog.style.transform = "";
      setTimeout(() => (dialog.style.transition = ""), 200);
    }
  };
  zone.addEventListener("pointerup", release);
  zone.addEventListener("pointercancel", release);
}

// ---------- expense ledger (phase D2) ----------

const homeSym = () => CURRENCIES[settings.homeCurrency]?.symbol ?? "";
const fmtHome = (v) => `${homeSym()}${formatAmount(v, settings.homeCurrency)}`;
const dayLabel = (ts) => {
  const d = new Date(ts);
  const sameYear = d.getFullYear() === new Date().getFullYear();
  return d.toLocaleDateString(undefined, sameYear
    ? { day: "numeric", month: "short" }
    : { day: "numeric", month: "short", year: "numeric" });
};
const timeLabel = (ts) =>
  new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const dayTimeLabel = (ts) => `${dayLabel(ts)}, ${timeLabel(ts)}`;

// Every trip has at least you in it.
// Read-only. It used to WRITE — injecting a member and calling
// saveTrips() — and it is called from renderLedger, nameById, selfId and
// labelFor. A trip arriving with no members would therefore be mutated
// and restamped mid-render, and that stamp would win the next merge and
// push the injected member to everyone. Rendering must never write.
//
// Seeding belongs where a trip is created (openEditor already does it).
const BLANK_SELF = [{ id: LEGACY_SELF, name: "You" }];
function ensureMembers(trip) {
  return trip?.members?.length ? trip.members : BLANK_SELF;
}

// Which member is the person holding THIS device. Never assume "me":
// once a trip is shared, that id belongs to whoever created it, and
// treating it as "the current user" files their spending under his name.
const selfId = (trip = activeTrip()) =>
  trip ? selfMemberId(ensureMembers(trip), account) : null;

// "You" for yourself, their name for everyone else.
const labelFor = (member, trip = activeTrip()) => memberLabel(member, selfId(trip));

const nameById = (trip) => {
  const self = selfId(trip);
  return Object.fromEntries(ensureMembers(trip).map((m) => [m.id, memberLabel(m, self)]));
};

// Money snapshots were taken in whatever the home currency was AT SAVE
// TIME (record.homeCode). If home has changed since, re-express them in
// the current home at today's rate — never show an INR magnitude with a
// $ sign. Falls back to the stored value when rates can't bridge it.
function inCurrentHome(record) {
  const home = settings.homeCurrency;
  if (!record.homeCode || record.homeCode === home) return record;
  const rates = ratesInfo.data?.rates;
  const v = rates ? convert(record.homeValue ?? record.amount, record.homeCode, home, rates) : null;
  // Rates arrive after the first render. Returning the record unchanged
  // would put an INR magnitude in a $ column and let a total add the two
  // together — flag it instead, so the caller can decline to sum.
  if (v === null) return { ...record, homeStale: true };
  return record.homeValue !== undefined
    ? { ...record, homeValue: v, homeCode: home }
    : { ...record, amount: v, homeCode: home };
}

const tripExpenses = (tripId) =>
  expenses.filter((e) => e.tripId === tripId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(inCurrentHome);

function saveExpenses() {
  restamp(expenses, store.setExpenses(expenses));
  scheduleSync();
}

function renderLedger() {
  const trip = activeTrip();
  if (!trip) return;
  const members = ensureMembers(trip);
  const byId = nameById(trip);
  const list = tripExpenses(trip.id);
  const cuts = expenseCuts(list, members);
  // Don't add up two currencies. Until rates arrive, any record saved
  // under a different home currency can't be bridged, so the total would
  // be an INR magnitude and a dollar magnitude summed together.
  const bridging = list.some((e) => e.homeStale);
  $("#ledger-total").textContent = bridging ? "…" : fmtHome(cuts.total);
  $("#ledger-count").textContent = list.length
    ? (bridging
      ? `${list.length} expense${list.length === 1 ? "" : "s"} · converting to ${settings.homeCurrency}…`
      : `${list.length} expense${list.length === 1 ? "" : "s"} · in ${settings.homeCurrency}`)
    : "No expenses yet";
  $("#summary-btn").hidden = !list.length;

  const row = $("#member-row");
  row.innerHTML = "";
  for (const m of members) {
    // Plain labels — a chip styled like the tappable ones but doing
    // nothing on tap reads as "the app is broken".
    const chip = document.createElement("span");
    chip.className = "member-chip static" + (m.uid ? " linked" : "");
    chip.textContent = labelFor(m, trip);
    if (m.uid) chip.title = "Has the trip on their own phone";
    row.appendChild(chip);
  }
  const add = document.createElement("button");
  add.className = "member-chip add";
  add.id = "member-manage";
  add.textContent = "+ Members";
  row.appendChild(add);

  const ul = $("#expense-list");
  ul.innerHTML = "";
  for (const e of list) {
    ul.appendChild(expenseRow(
      { ...e, amountText: formatAmount(e.amount, e.code) },
      byId[e.paidBy] ?? "?",
      `≈ ${fmtHome(e.homeValue)}`,
      dayTimeLabel(e.createdAt)
    ));
  }
  if (!list.length) {
    const empty = document.createElement("li");
    empty.className = "expense-empty";
    empty.textContent = "Log what you spend — splits and settle-up appear here.";
    ul.appendChild(empty);
  }
}

// ----- members sheet -----

function renderMemberSheet() {
  const trip = activeTrip();
  if (!trip) return;
  const self = selfId(trip);
  const ul = $("#m-list");
  ul.innerHTML = "";
  // Every member is a row you can open — that's where a name becomes a
  // person with an account, which is the whole point of this screen.
  for (const m of ensureMembers(trip)) {
    const li = document.createElement("li");
    li.className = "m-row";
    li.innerHTML = `
      <button class="m-open" data-medit="${m.id}">
        <span class="m-meta">
          <span class="m-name">${escapeHtml(memberLabel(m, self))}${m.uid ? ' <span class="m-badge">synced</span>' : ""}</span>
          <span class="m-status">${escapeHtml(memberStatus(m, self))}</span>
        </span>
        <svg class="x-chev" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
      </button>`;
    ul.appendChild(li);
  }
}

// ----- one member: rename, invite, remove -----

let editMemberId = null;

const editingMember = () =>
  ensureMembers(activeTrip() ?? {}).find((m) => m.id === editMemberId) ?? null;

function openMemberEditor(id) {
  const trip = activeTrip();
  if (!trip) return;
  editMemberId = id;
  const m = editingMember();
  if (!m) return;
  const isSelf = m.id === selfId(trip);
  // Their details are theirs once they have an account: whoever added
  // them typed a placeholder to get the invite out, and that placeholder
  // stops being the truth the moment the real person shows up.
  const editable = canEditDetails(m);
  $("#mx-title").textContent = isSelf ? "You" : m.name;
  $("#mx-name").value = m.name;
  $("#mx-email").value = m.email ?? "";
  $("#mx-phone").value = m.phone ?? "";
  $("#mx-name").disabled = !editable;
  $("#mx-phone").disabled = !editable;
  $("#mx-email").disabled = !!m.uid;
  $("#mx-save").hidden = !editable;
  $("#mx-owned-note").hidden = editable;
  $("#mx-owned-note").textContent = isSelf
    ? "Your name and number come from your details in Settings."
    : `${m.name} sets their own name and number.`;
  $("#mx-email-note").textContent = m.uid
    ? "They've opened the trip — this address is now their account."
    : "Add an email and they'll get the trip on their own phone. Leave it blank to keep them as just a name in the split.";
  $("#mx-phone-note").hidden = !editable;
  // Worth sending as soon as we know where to send it.
  $("#mx-send").hidden = (!m.email && !m.phone) || !!m.uid;
  $("#mx-send").textContent = m.phone ? "Send on WhatsApp" : "Send them the invite";
  const inExpenses = expenses.some(
    (e) => e.tripId === trip.id && (e.paidBy === m.id || e.split.parts[m.id] > 0)
  );
  // Payments count too. Removing someone who only appears in a recorded
  // repayment left the summary contradicting itself on one screen: the
  // balances row said they were owed ₹500, settle-up said all settled.
  const inPayments = settlements.some(
    (p) => p.tripId === trip.id && (p.from === m.id || p.to === m.id)
  );
  const used = inExpenses || inPayments;
  $("#mx-remove").hidden = isSelf;
  $("#mx-remove").disabled = used;

  // "Delete those first" was a dead end — there was no reassign tool to
  // point at. Offer the reassignment here instead of describing one.
  const others = ensureMembers(trip).filter((x) => x.id !== m.id);
  const canReassign = used && !isSelf && others.length > 0;
  setHidden($("#mx-reassign"), !canReassign);
  $("#mx-remove-note").textContent = !used || isSelf ? ""
    : canReassign
      ? `${m.name} is already in this trip's books, so someone has to take that over.`
      : "They're in the books and there's nobody to hand it to — add another member first.";
  if (canReassign) {
    const sel = $("#mx-reassign-to");
    sel.innerHTML = "";
    for (const o of others) {
      const opt = document.createElement("option");
      opt.value = o.id;
      opt.textContent = labelFor(o);
      sel.appendChild(opt);
    }
    const n = countInvolvement(trip.id, m.id);
    $("#mx-reassign-note").textContent =
      `${n.expenses} ${n.expenses === 1 ? "expense" : "expenses"}` +
      (n.payments ? ` and ${n.payments} ${n.payments === 1 ? "payment" : "payments"}` : "") +
      " will move over. The totals don't change.";
  }
  $("#member-editor").showModal();
}

function saveMemberEditor() {
  const trip = activeTrip();
  const m = editingMember();
  if (!trip || !m) return;
  const name = $("#mx-name").value.trim();
  const email = normEmail($("#mx-email").value);
  if (!name) return;
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    $("#mx-email-note").textContent = "That doesn't look like an email address.";
    return;
  }
  m.name = name;
  const phone = normalisePhone($("#mx-phone").value);
  if (phone) m.phone = phone;
  else delete m.phone;
  if (!m.uid) {
    if (email) m.email = email;
    else delete m.email;
  }
  saveTrips();
  $("#member-editor").close();
  renderMemberSheet();
  renderLedger();
  syncNow({ silent: true }); // push the invite so they can actually get in
}

// How much of the trip's history one member is holding.
function countInvolvement(tripId, memberId) {
  return {
    expenses: expenses.filter((e) => e.tripId === tripId &&
      (e.paidBy === memberId || Number(e.split?.parts?.[memberId]) > 0)).length,
    payments: settlements.filter((p) => p.tripId === tripId &&
      (p.from === memberId || p.to === memberId)).length,
  };
}

// Hand this member's expenses and payments to someone else, then remove
// them. The maths is in splits.js and is unit-tested; this only decides
// what to persist and what to say afterwards.
function reassignAndRemove() {
  const trip = activeTrip();
  const m = editingMember();
  const toId = $("#mx-reassign-to").value;
  if (!trip || !m || !toId || toId === m.id) return;
  const heir = ensureMembers(trip).find((x) => x.id === toId);
  if (!heir) return;

  // Only this trip's records move; the same member id can't appear in
  // another trip, but filtering keeps the write honest either way.
  const mine = expenses.filter((e) => e.tripId === trip.id);
  const minePays = settlements.filter((p) => p.tripId === trip.id);
  const moved = reassignMember(m.id, toId, mine, minePays);

  expenses = [...expenses.filter((e) => e.tripId !== trip.id), ...moved.expenses];
  settlements = [...settlements.filter((p) => p.tripId !== trip.id), ...moved.settlements];
  trip.members = trip.members.filter((x) => x.id !== m.id);

  saveExpenses();
  saveSettlements();
  saveTrips();
  $("#member-editor").close();
  renderMemberSheet();
  renderLedger();
  if ($("#summary-sheet").open) renderSummaryBody();
  toast(`${m.name} removed — ${heir.name} took over their share.`);
  syncNow({ silent: true });
}

function removeMember() {
  const trip = activeTrip();
  const m = editingMember();
  if (!trip || !m) return;
  trip.members = trip.members.filter((x) => x.id !== m.id);
  saveTrips();
  $("#member-editor").close();
  renderMemberSheet();
  renderLedger();
  syncNow({ silent: true });
}

function addMember(name) {
  const trip = activeTrip();
  const clean = name.trim();
  if (!trip || !clean) return;
  const member = { id: crypto.randomUUID(), name: clean };
  ensureMembers(trip).push(member);
  saveTrips();
  renderMemberSheet();
  renderLedger();
  // If an expense is being edited, fold the new member into its split:
  // included by default in equal mode, weight 0 (assign it yourself) otherwise.
  if (eState && $("#expense-sheet").open) {
    eState.split.parts[member.id] = eState.split.mode === "equal" ? 1 : 0;
    renderExpenseForm();
  }
}

// ----- expense sheet -----

let eState = null; // working copy while the sheet is open
let editExpenseId = null;
let expenseFromConvert = false; // opened via the Convert tab's Expense button
let eAttach = { kind: "none" }; // buffered receipt (see openExpense)
let attachUrls = []; // object URLs to revoke when their sheet closes

// The receipt slot: an add button, or a thumbnail + remove. Rendered apart
// from renderExpenseForm so re-validation doesn't re-fetch the blob.
function renderAttachRow() {
  const row = $("#e-attach");
  for (const u of attachUrls) URL.revokeObjectURL(u);
  attachUrls = [];
  if (eAttach.kind === "none") {
    row.innerHTML = `<button type="button" class="attach-add" id="attach-add">
      ${ICONS.clip} Add a photo or PDF</button>`;
    return;
  }
  const meta = eAttach.kind === "new" ? eAttach.rec : eAttach.meta;
  const isImage = meta.type?.startsWith("image/");
  row.innerHTML = `
    <button type="button" class="attach-thumb" id="attach-view" title="View receipt">
      ${isImage ? '<img alt="Receipt thumbnail">' : '<span class="a-file">📄</span>'}
      <span class="a-name">${escapeHtml(meta.name ?? "Attachment")}</span>
    </button>
    <button type="button" class="mini attach-remove" id="attach-remove" aria-label="Remove receipt">${ICONS.trash}</button>`;
  if (isImage) {
    const img = row.querySelector("img");
    if (eAttach.kind === "new") {
      const url = URL.createObjectURL(eAttach.rec.blob);
      attachUrls.push(url);
      img.src = url;
    } else {
      const expense = expenses.find((e) => e.id === editExpenseId);
      (expense ? fetchReceipt(expense) : getAttachment(editExpenseId)).then((rec) => {
        if (!rec || eAttach.kind !== "existing") return;
        img.src = receiptSrc(rec);
      }).catch(() => { /* the viewer explains it on tap */ });
    }
  }
}

let attachPreparing = null; // saveExpense awaits this — see below

async function pickAttachment(file) {
  if (!file) return;
  $("#e-attach").innerHTML = '<span class="attach-busy">Preparing…</span>';
  let rec = null;
  // Held onto so a Save tapped mid-prepare WAITS instead of silently
  // saving without the receipt (a real race on slow phones).
  const preparing = prepareAttachment(file).catch(() => null);
  attachPreparing = preparing;
  try {
    rec = await preparing;
  } finally {
    if (attachPreparing === preparing) attachPreparing = null;
  }
  if (!rec) {
    toast("That file is too large to store (8 MB max)");
    eAttach = eAttach.kind === "new" ? { kind: "none" } : eAttach;
    renderAttachRow();
    return;
  }
  eAttach = { kind: "new", rec };
  renderAttachRow();
}

// Full-size view: images open in a sheet; anything else downloads.
async function viewAttachment() {
  const expense = expenses.find((e) => e.id === editExpenseId);
  let rec = null;
  try {
    rec = eAttach.kind === "new"
      ? eAttach.rec
      : await (expense ? fetchReceipt(expense) : getAttachment(editExpenseId));
  } catch (err) {
    toast(await explainReceiptFailure(err, expense));
    return;
  }
  if (!rec) {
    toast(await explainReceiptFailure(null, expense));
    return;
  }
  const url = receiptSrc(rec);
  if (rec.type?.startsWith("image/")) {
    $("#attach-title").textContent = rec.name ?? "Receipt";
    $("#attach-body").innerHTML = "";
    const img = document.createElement("img");
    img.src = url;
    img.alt = "Receipt";
    $("#attach-body").appendChild(img);
    $("#attach-sheet").showModal();
  } else if (rec.blob) {
    const a = document.createElement("a");
    a.href = url;
    a.download = rec.name ?? "receipt";
    a.click();
  } else {
    window.open(url, "_blank", "noopener"); // PDF straight from the cloud
  }
}

function openExpense(existing, prefill = null) {
  const trip = activeTrip();
  if (!trip) return;
  const members = ensureMembers(trip);
  editExpenseId = existing?.id ?? null;
  expenseFromConvert = !!prefill;
  eState = existing
    ? structuredClone({ type: existing.type, name: existing.name, desc: existing.description ?? "",
        amount: existing.amount, code: existing.code, paidBy: existing.paidBy, split: existing.split })
    : { type: "food", name: "", desc: "", amount: prefill?.amount ?? null,
        code: prefill?.code
          ?? trip.currencies.find((c) => c !== settings.homeCurrency) ?? trip.currencies[0],
        paidBy: selfId(trip) ?? members[0]?.id, split: equalSplit(members) };
  // Buffered attachment intent — nothing touches IndexedDB until Save.
  // kind: "none" | "existing" (kept as-is) | "new" (freshly picked file)
  eAttach = existing?.attachment
    ? { kind: "existing", meta: existing.attachment }
    : { kind: "none" };
  $("#e-file").value = "";
  $("#expense-title").textContent = existing ? "Edit expense" : "Add expense";
  $("#e-name").value = eState.name;
  $("#e-desc").value = eState.desc;
  const when = $("#e-when");
  when.value = toDatetimeLocal(existing?.createdAt ?? Date.now());
  // A typo'd year used to be accepted and then sorted to the top of the
  // ledger forever. Tomorrow is legitimate (a booking made late at
  // night); 2030 is not.
  when.max = toDatetimeLocal(Date.now() + 36 * 60 * 60 * 1000);
  $("#e-amount").value = eState.amount ? formatAmount(eState.amount, eState.code) : "";
  const sel = $("#e-code");
  sel.innerHTML = "";
  for (const code of dedupe([...trip.currencies, settings.homeCurrency])) {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = code;
    opt.selected = code === eState.code;
    sel.appendChild(opt);
  }
  $("#e-manage").hidden = !existing;
  const del = $("#e-delete");
  del.dataset.armed = "";
  del.classList.remove("confirming");
  del.textContent = "Delete expense";
  renderExpenseForm();
  renderAttachRow();
  $("#expense-sheet").showModal();
  if (!existing) $("#e-name").focus();
}

// What this expense will actually be worth once saved.
//
// An edit that doesn't touch the amount, the currency or the home
// currency KEEPS its original snapshot — that's the whole reason debts
// don't drift when rates move. The sheet has to show that same number,
// or it promises one figure and stores another.
function previewHomeValue() {
  const previous = editExpenseId ? expenses.find((e) => e.id === editExpenseId) : null;
  if (previous && previous.amount === eState.amount && previous.code === eState.code &&
      previous.homeCode === settings.homeCurrency && Number.isFinite(previous.homeValue)) {
    return previous.homeValue;
  }
  const rates = ratesInfo.data?.rates;
  return eState.amount && rates
    ? convert(eState.amount, eState.code, settings.homeCurrency, rates)
    : null;
}

const previewIsLocked = () => {
  const p = editExpenseId ? expenses.find((e) => e.id === editExpenseId) : null;
  return !!p && p.amount === eState.amount && p.code === eState.code &&
    p.homeCode === settings.homeCurrency && Number.isFinite(p.homeValue);
};

// Rebuild the dynamic parts (type chips, payer, split rows) + validation.
function renderExpenseForm() {
  const trip = activeTrip();
  const members = ensureMembers(trip);

  const typeRow = $("#etype-row");
  typeRow.innerHTML = "";
  for (const [key, emoji, label] of EXPENSE_TYPES) {
    const b = document.createElement("button");
    b.className = "type-chip" + (eState.type === key ? " on" : "");
    b.dataset.etype = key;
    b.textContent = `${emoji} ${label}`;
    typeRow.appendChild(b);
  }

  const payer = $("#e-payer");
  payer.innerHTML = "";
  for (const m of members) {
    payer.appendChild(memberChip({ ...m, name: labelFor(m) }, { on: eState.paidBy === m.id, data: "payer" }));
  }
  const addChip = document.createElement("button");
  addChip.className = "member-chip add";
  addChip.id = "e-add-member";
  addChip.type = "button";
  addChip.textContent = "+ Add";
  payer.appendChild(addChip);

  for (const b of document.querySelectorAll("#e-split-mode [data-mode]")) {
    b.classList.toggle("on", eState.split.mode === b.dataset.mode);
  }

  const rows = $("#e-split-rows");
  rows.innerHTML = "";
  const homeAmount = previewHomeValue();
  // Allocated, not divided: three equal ways on ₹100 must still add up
  // to ₹100 on screen. And in the currency you're actually holding as
  // well as the home one — "₹606.81" is no use when the bill is in dong
  // and you're counting notes at the table.
  const showable = homeAmount !== null && splitValid(eState.split);
  const cuts = showable
    ? allocate(homeAmount, eState.split.parts, CURRENCIES[settings.homeCurrency]?.decimals ?? 2)
    : {};
  const ownCuts = showable && eState.code !== settings.homeCurrency
    ? allocate(eState.amount, eState.split.parts, CURRENCIES[eState.code]?.decimals ?? 2)
    : {};
  // Everyone the split NAMES, not just everyone currently on the trip.
  // A member removed on another device while this expense was being
  // written still holds a share; drawing rows for current members only
  // meant the rows summed to less than the total at the top of the
  // sheet, while the note still said "Adds up to 100% ✓".
  const shown = referencedMembers(members, [{ id: "x", split: eState.split, paidBy: eState.paidBy }], []);
  for (const m of shown) {
    const weight = eState.split.parts[m.id] ?? 0;
    const included = weight > 0;
    const li = document.createElement("div");
    li.className = "split-row" + (included ? "" : " off");
    // labelFor, not m.name: every other surface calls you "You", and
    // this row said your real name — in the same sheet as the payer
    // chips, which said "You". Two names for one person reads as two
    // people, and in a shared ledger "is this row me?" is the single
    // most important thing on screen.
    //
    // Escaped because names arrive from other people's phones.
    const name = escapeHtml(m.missing ? m.name : labelFor(m));
    const owesText = included && cuts[m.id] !== undefined
      ? (ownCuts[m.id] !== undefined
        ? `${formatAmount(ownCuts[m.id], eState.code, localeFor(eState.code))} ${eState.code}` +
          `<span class="s-home">${fmtHome(cuts[m.id])}</span>`
        : fmtHome(cuts[m.id]))
      : "";
    if (eState.split.mode === "equal") {
      // A <label>, so the whole 44px row toggles. It used to be a div
      // whose only target was a 19px checkbox — for the one gesture that
      // decides who pays for what.
      li.innerHTML = `
        <input type="checkbox" id="sinc-${m.id}" data-sinc="${m.id}" ${included ? "checked" : ""}>
        <label class="s-name" for="sinc-${m.id}">${name}</label>
        <span class="s-owes">${owesText}</span>`;
    } else {
      const suffix = eState.split.mode === "percent" ? "%" : "×";
      li.innerHTML = `
        <span class="s-name">${name}</span>
        <span class="s-owes">${owesText}</span>
        <input type="text" inputmode="decimal" data-sw="${m.id}" value="${included ? weight : ""}"
          placeholder="0" aria-label="${name} ${suffix}">`;
    }
    rows.appendChild(li);
  }

  const note = $("#e-split-note");
  const valid = splitValid(eState.split);
  if (eState.split.mode === "percent") {
    const total = Object.values(eState.split.parts).reduce((a, b) => a + (Number(b) > 0 ? Number(b) : 0), 0);
    note.textContent = valid ? "Adds up to 100% ✓" : `Adds up to ${total}% — needs 100%`;
  } else {
    note.textContent = valid ? "" : "Include at least one person";
  }
  note.classList.toggle("bad", !valid);

  const preview = $("#e-home-preview");
  // The same decimal-slip guard the converter has carried since v1.9. It
  // matters far more here: the converter is a glance, this is everyone's
  // debt, snapshotted at save.
  const slip = homeAmount !== null
    ? slipCheck({ amount: eState.amount, homeAmount, samples: trip?.samples?.[eState.code] ?? [] })
    : null;
  preview.textContent = homeAmount !== null
    ? (previewIsLocked()
      ? `${fmtHome(homeAmount)} — locked in when this was saved`
      : `≈ ${fmtHome(homeAmount)} at today's rate — locked in when you save`)
    : (eState.amount && !ratesInfo.data?.rates ? "Need rates once (go online) to log expenses" : "");
  const warn = $("#e-slip");
  // The separator reading comes first: it is the bigger error (100x, not
  // 10x) and the one the user can settle at a glance.
  const meant = eState.maybeMeant;
  warn.textContent = meant !== null && meant !== undefined
    ? `Read as ${formatAmount(eState.amount, eState.code, localeFor(eState.code))} ${eState.code}. Did you mean ${formatAmount(meant, eState.code, localeFor(eState.code))}?`
    : slip
      ? `That's ${fmtHome(homeAmount)} — did you mean ${formatAmount(slip.suggestion, eState.code, localeFor(eState.code))}?`
      : "";
  setHidden(warn, !warn.textContent);

  const missing =
    !eState.name.trim() ? "Name this expense"
    : !(Number.isFinite(eState.amount) && eState.amount > 0) ? "Enter an amount"
    : homeAmount === null ? "Need rates once — go online"
    : !eState.paidBy ? "Choose who paid"
    : !valid ? "Fix the split"
    : "";
  const save = $("#e-save");
  save.disabled = !!missing;
  // A disabled button swallows taps entirely, so "why is this dead?" can
  // only be answered on the button itself.
  save.textContent = missing || (editExpenseId ? "Save changes" : "Add expense");
}

async function saveExpense() {
  const trip = activeTrip();
  const rates = ratesInfo.data?.rates;
  const previous = editExpenseId ? expenses.find((e) => e.id === editExpenseId) : null;

  // The home-currency value is a SNAPSHOT taken when the expense was
  // saved — that's the whole reason debts don't drift when rates move.
  // Editing re-converted it unconditionally, so fixing a typo in the
  // name three weeks later silently re-priced a settled dinner at
  // today's rate and moved everyone's balance. Only a change to the
  // amount, the currency, or the home currency justifies a new
  // conversion.
  const keepsValue = previous &&
    previous.amount === eState.amount &&
    previous.code === eState.code &&
    previous.homeCode === settings.homeCurrency &&
    Number.isFinite(previous.homeValue);
  const homeValue = keepsValue
    ? previous.homeValue
    : (rates ? convert(eState.amount, eState.code, settings.homeCurrency, rates) : null);
  if (homeValue === null) {
    toast("Need rates once — tap the rates chip while online");
    return;
  }
  const record = {
    id: editExpenseId ?? crypto.randomUUID(),
    tripId: trip.id,
    type: eState.type,
    name: eState.name.trim(),
    description: eState.desc.trim(),
    amount: eState.amount,
    code: eState.code,
    homeValue,
    homeCode: settings.homeCurrency,
    paidBy: eState.paidBy,
    split: eState.split,
    createdAt: fromDatetimeLocal($("#e-when").value) ?? previous?.createdAt ?? Date.now(),
  };
  // A photo still being processed must land in this save, not vanish.
  if (attachPreparing) await attachPreparing.then(() => new Promise((r) => setTimeout(r, 0)));
  // Commit the buffered receipt before the record points at it.
  const hadAttachment = previous?.attachment;
  try {
    if (eAttach.kind === "new") {
      await putAttachment(record.id, eAttach.rec);
      record.attachment = { name: eAttach.rec.name, type: eAttach.rec.type };
      // Reaches the cloud in the background; Save never waits on signal.
      setTimeout(() => uploadReceiptFor(record.id, { loud: true }), 50);
    } else if (eAttach.kind === "existing") {
      record.attachment = eAttach.meta;
    } else if (hadAttachment) {
      await deleteAttachment(record.id); // receipt was removed in the editor
      deleteCloudReceipt(record.tripId, record.id);
    }
  } catch {
    toast("Couldn't store the receipt — expense saved without it");
  }
  expenses = editExpenseId
    ? expenses.map((e) => (e.id === editExpenseId ? record : e))
    : [...expenses, record];
  saveExpenses();
  $("#expense-sheet").close();
  buzz();
  if (expenseFromConvert && activeTab !== "ledger") {
    activeTab = "ledger"; // show the freshly logged expense
    syncTab();
    toast("Expense added");
  } else {
    renderLedger();
  }
  expenseFromConvert = false;
}

function deleteExpense(id) {
  const gone = expenses.find((e) => e.id === id);
  if (!gone) return;
  expenses = expenses.filter((e) => e.id !== id);
  saveExpenses();
  $("#expense-sheet").close();
  renderLedger();
  toast(`Deleted “${gone.name}”`, {
    actionLabel: "Undo",
    onAction: () => {
      if (expenses.some((e) => e.id === gone.id)) return;
      expenses = [...expenses, gone];
      saveExpenses(); // clears the tombstone, so the delete stays undone
      renderLedger();
    },
    // The receipt is only unrecoverable once the toast has gone, so the
    // blob outlives the record until then. Undo would otherwise restore
    // an expense pointing at an image that had already been swept.
    onExpire: () => {
      if (expenses.some((e) => e.id === gone.id) || !gone.attachment) return;
      deleteAttachment(gone.id).catch(() => {});
      deleteCloudReceipt(gone.tripId, gone.id);
    },
  });
}

// ----- summary sheet -----

const FOLD_CHEV = '<svg class="fold-chev" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>';

// A collapsed-by-default summary section — the sheet stays scannable and
// detail is one tap away. `openFolds` keeps user-opened sections open
// across the re-renders that recording/deleting a payment triggers.
function fold(key, title, inner, openFolds, defaultOpen = false) {
  if (!inner) return "";
  const open = openFolds ? openFolds.has(key) : defaultOpen;
  return `<details class="sum-fold" data-fold="${key}"${open ? " open" : ""}>
    <summary><span class="sum-head">${title}</span>${FOLD_CHEV}</summary>${inner}</details>`;
}

function barRows(entries, labelFor) {
  if (!entries.length) return "";
  const max = Math.max(...entries.map(([, v]) => v));
  return entries.map(([k, v]) => `
    <div class="bar-row">
      <span class="br-label">${labelFor(k)}</span>
      <div class="br-track"><div class="br-fill" style="width:${Math.max(3, (v / max) * 100)}%"></div></div>
      <span class="br-amt">${fmtHome(v)}</span>
    </div>`).join("");
}

const tripSettlements = (tripId) =>
  settlements.filter((p) => p.tripId === tripId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(inCurrentHome);

function saveSettlements() {
  restamp(settlements, store.setSettlements(settlements));
  scheduleSync();
}

// Log a real-world repayment; the settle-up and balances re-derive from it.
// `amount` is already in the home currency; homeCode records which one, so
// a later home-currency switch can re-express it (see inCurrentHome).
function recordPayment(from, to, amount) {
  settlements = [...settlements, {
    id: crypto.randomUUID(), tripId: activeTrip().id, from, to, amount,
    homeCode: settings.homeCurrency, createdAt: Date.now(),
  }];
  saveSettlements();
  buzz();
}

// What one member did on this trip: their part of each expense, then any
// repayments they made or received. Powers the expandable balance rows.
function memberDetailRows(m, list, pays, byId) {
  const rows = [];
  for (const e of list) {
    const share = shareOf(e, m.id);
    const paid = e.paidBy === m.id;
    if (!paid && share <= 0.005) continue;
    const bits = [];
    if (paid) bits.push(`paid ${fmtHome(e.homeValue)}`);
    if (share > 0.005) bits.push(`share ${fmtHome(share)}`);
    rows.push(`<div class="bd-row"><span class="bd-name">${typeEmoji(e.type)} ${escapeHtml(e.name)} · ${dayLabel(e.createdAt)}</span>
      <span class="bd-amts">${bits.join(" · ")}</span></div>`);
  }
  for (const p of pays) {
    if (p.from !== m.id && p.to !== m.id) continue;
    const label = p.from === m.id
      ? `Paid ${escapeHtml(byId[p.to] ?? "?")} back`
      : `Got money from ${escapeHtml(byId[p.from] ?? "?")}`;
    rows.push(`<div class="bd-row"><span class="bd-name">💸 ${label} · ${dayLabel(p.createdAt)}</span>
      <span class="bd-amts">${fmtHome(p.amount)}</span></div>`);
  }
  return rows.join("") || '<div class="bd-row">Not part of any expense yet</div>';
}

function renderSummaryBody() {
  const trip = activeTrip();
  if (!trip) return;
  const list = tripExpenses(trip.id);
  const pays = tripSettlements(trip.id);
  // Anyone the books still reference, including someone removed on
  // another device while an expense of theirs was in flight. Without
  // them the balances don't sum to zero and settle-up under-reports.
  const members = referencedMembers(ensureMembers(trip), list, pays);
  const byId = { ...nameById(trip),
    ...Object.fromEntries(members.filter((m) => m.missing).map((m) => [m.id, m.name])) };
  const balances = tripBalances(list, members, pays);
  const transfers = settleUp(balances, CURRENCIES[settings.homeCurrency]?.decimals ?? 2);
  const cuts = expenseCuts(list, members);
  $("#summary-title").textContent = `${trip.name} — summary`;

  const transferHtml = transfers.length
    ? transfers.map((t) => `
        <div class="sum-transfer">
          <span>${escapeHtml(byId[t.from] ?? "?")} → ${escapeHtml(byId[t.to] ?? "?")}</span>
          <span class="amt">${fmtHome(t.amount)}</span>
          <button class="mark-paid" data-pay-from="${t.from}" data-pay-to="${t.to}"
            data-pay-amt="${t.amount}">Mark paid</button>
        </div>`).join("")
    : (members.length > 1
        ? '<div class="sum-settled">All settled 🎉</div>'
        : '<div class="sum-note">Add members to split expenses.</div>');
  const addPay = members.length > 1
    ? '<button class="sum-add-pay" id="sum-add-pay">+ Record a payment</button>'
    : "";

  // Which folds the user opened — survive the rebuild after edits.
  const openFolds = $("#summary-body").querySelector(".sum-fold")
    ? new Set([...document.querySelectorAll("#summary-body .sum-fold[open]")].map((d) => d.dataset.fold))
    : null;

  const payHtml = pays.length
    ? fold("pays", `Payments recorded · ${pays.length}`,
      pays.map((p) => `
        <div class="sum-pay">
          <span>${escapeHtml(byId[p.from] ?? "?")} → ${escapeHtml(byId[p.to] ?? "?")}</span>
          <span class="sp-when">${dayTimeLabel(p.createdAt)}</span>
          <span class="amt">${fmtHome(p.amount)}</span>
          <button class="mini" data-pdel="${p.id}" aria-label="Delete payment">${ICONS.trash}</button>
        </div>`).join(""), openFolds)
    : "";

  const balHtml = members.length > 1
    ? `<div class="sum-section"><div class="sum-head">Balances — tap a person for details</div>` +
      members.map((m) => {
        const b = balances[m.id];
        const cls = b.net > 0.01 ? "pos" : b.net < -0.01 ? "neg" : "";
        const sign = b.net > 0.01 ? "gets " : b.net < -0.01 ? "owes " : "";
        return `<details class="bal-details">
          <summary><div class="bal-row"><span>${escapeHtml(m.name)}</span>
            <span class="b-sub">paid ${fmtHome(b.paid)} · share ${fmtHome(b.share)}</span>
            <span class="b-net ${cls}">${sign}${fmtHome(Math.abs(b.net))}</span>
            <svg class="bal-chev" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
          </div></summary>
          <div class="bal-exp">${memberDetailRows(m, list, pays, byId)}</div>
        </details>`;
      }).join("") + "</div>"
    : "";

  const sortDesc = (obj) => Object.entries(obj).filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  const days = Object.entries(cuts.byDay).sort((a, b) => (a[0] < b[0] ? -1 : 1));
  $("#summary-body").innerHTML = `
    <div class="sum-section">
      <div class="sum-head">Settle up · in ${settings.homeCurrency}</div>
      ${transferHtml}
      ${addPay}
    </div>
    ${payHtml}
    ${balHtml}
    <div class="sum-section"><div class="sum-head">Total spend</div>
      <div class="ledger-total"><span>${fmtHome(cuts.total)}</span>
      <span class="hint">${cuts.count} expenses · in ${settings.homeCurrency}, converted when each was saved</span></div>
    </div>
    ${fold("cat", "By category", barRows(sortDesc(cuts.byType), (k) => `${typeEmoji(k)} ${typeLabel(k)}`), openFolds, true)}
    ${fold("person", "By person (share)", barRows(sortDesc(cuts.byMember), (k) => escapeHtml(byId[k] ?? "?")), openFolds)}
    ${fold("day", "By day", barRows(days, (k) => dayLabel(k + "T00:00:00")), openFolds)}
  `;
}

function openSummary() {
  renderSummaryBody();
  $("#summary-sheet").showModal();
}

// ----- payment sheet (stacks over the summary) -----

let pState = null;

function openPaymentSheet(prefill = {}) {
  const trip = activeTrip();
  if (!trip) return;
  // Paid in any trip currency (cash in local money is the common case);
  // converted to home at today's rate when saved.
  pState = { from: prefill.from ?? null, to: prefill.to ?? null,
    amount: prefill.amount ?? null, code: settings.homeCurrency };
  const sel = $("#p-code");
  sel.innerHTML = "";
  for (const code of dedupe([settings.homeCurrency, ...trip.currencies])) {
    const opt = document.createElement("option");
    opt.value = code;
    opt.textContent = code;
    opt.selected = code === pState.code;
    sel.appendChild(opt);
  }
  $("#p-amount").value = pState.amount
    ? formatAmount(pState.amount, settings.homeCurrency)
    : "";
  renderPaymentSheet();
  $("#payment-sheet").showModal();
}

// The payment expressed in home currency (what balances are kept in).
function paymentHomeAmount() {
  if (!Number.isFinite(pState.amount) || pState.amount <= 0) return null;
  if (pState.code === settings.homeCurrency) return pState.amount;
  const rates = ratesInfo.data?.rates;
  return rates ? convert(pState.amount, pState.code, settings.homeCurrency, rates) : null;
}

function renderPaymentSheet() {
  const members = ensureMembers(activeTrip());
  const fromRow = $("#p-from");
  fromRow.innerHTML = "";
  for (const m of members) fromRow.appendChild(memberChip({ ...m, name: labelFor(m) }, { on: pState.from === m.id, data: "pfrom" }));
  const toRow = $("#p-to");
  toRow.innerHTML = "";
  for (const m of members) toRow.appendChild(memberChip({ ...m, name: labelFor(m) }, { on: pState.to === m.id, data: "pto" }));
  const same = pState.from && pState.from === pState.to;
  const homeAmount = paymentHomeAmount();
  const foreign = pState.code !== settings.homeCurrency;
  const note = $("#p-note");
  if (same) note.textContent = "Payer and receiver must be different people";
  else if (foreign && homeAmount !== null) note.textContent = `≈ ${fmtHome(homeAmount)} at today's rate — that's what the settle-up uses`;
  else if (foreign && Number.isFinite(pState.amount) && pState.amount > 0) note.textContent = "Need rates once (go online) to convert this";
  else note.textContent = `Cash, UPI, anything — updates the settle-up in ${settings.homeCurrency}.`;
  note.classList.toggle("bad", !!same);
  $("#p-save").disabled = !(pState.from && pState.to && !same && homeAmount !== null);
}

// ---------- currency detail (rate + 30-day chart) ----------

// Chart the tapped currency against home; for the home row itself, chart it
// against USD (or EUR when home is USD) so there's still something to show.
function detailPair(code) {
  const home = settings.homeCurrency;
  if (code !== home) return { base: code, quote: home };
  return { base: home === "USD" ? "EUR" : "USD", quote: home };
}

let detailCode = null;
let detailToken = 0; // ignore stale async chart loads after re-open

const RANGE_LABEL = { 7: "7d", 30: "30d", 90: "90d", 365: "1y" };

async function loadDetailChart(code, days) {
  const token = ++detailToken;
  const { base, quote } = detailPair(code);
  const box = $("#detail-chart");
  const note = $("#detail-note");
  const avg = $("#detail-avg");
  const chg = $("#detail-chg");
  const label = RANGE_LABEL[days] ?? `${days}d`;
  chg.hidden = true;
  avg.textContent = "";
  avg.className = "hint avg-line";
  note.textContent = "";
  for (const b of document.querySelectorAll("#range-seg [data-days]")) {
    b.classList.toggle("on", Number(b.dataset.days) === days);
  }

  const seg = $("#range-seg");
  const supported = historySupported(base, quote);
  setHidden(seg, !supported);
  for (const b of seg.querySelectorAll("[data-days]")) b.disabled = !supported;
  if (!supported) {
    box.innerHTML = '<div class="loading">No history available for this currency</div>';
    note.textContent = "Charts cover ~30 major currencies (ECB data).";
    return;
  }
  box.innerHTML = `<div class="loading">Loading ${label} history…</div>`;
  // The first fetch for a pair can take several seconds; say so rather than
  // letting a working request look like a hang.
  const slowNote = setTimeout(() => {
    if (token === detailToken && !box.querySelector("svg")) {
      box.innerHTML = '<div class="loading">Still loading — this rate service is slow on first use…</div>';
    }
  }, 4000);
  const hist = await loadHistory(base, quote, days);
  clearTimeout(slowNote);
  if (token !== detailToken) return; // superseded by another open/range switch
  if (!hist) {
    // A Retry control, not advice — "pull down" here closes the sheet.
    box.innerHTML = `<div class="loading chart-fail">
      <span>${navigator.onLine ? "Couldn't reach the history service" : "Go online once to load the chart"}</span>
      <button class="place-act" id="chart-retry">Retry</button></div>`;
    return;
  }
  renderChart(box, hist.series);
  const values = hist.series.map(([, v]) => v);
  const first = values[0];
  const last = values[values.length - 1];
  const pct = ((last - first) / first) * 100;
  chg.hidden = false;
  chg.textContent = `${pct >= 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(1)}% · ${label}`;
  chg.className = "chg " + (pct >= 0 ? "up" : "down");
  // Is today's rate above or below the period average? (helps time an exchange)
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const rates = ratesInfo.data?.rates;
  const current = rates ? convert(1, base, quote, rates) : last;
  const diff = ((current - mean) / mean) * 100;
  avg.textContent = `${Math.abs(diff).toFixed(1)}% ${diff >= 0 ? "above" : "below"} the ${label} average`;
  avg.className = "hint avg-line " + (diff >= 0 ? "up" : "down");
  note.textContent = `1 ${base} in ${quote} · ECB rates via Frankfurter${hist.live ? "" : " (cached)"}`;
}

// A multiplier you can carry in your head when the phone stays in your pocket.
function renderPocketRule(code) {
  const el = $("#pocket-rule");
  const home = settings.homeCurrency;
  const rates = ratesInfo.data?.rates;
  const rate = code === home ? null : (rates ? convert(1, code, home, rates) : null);
  const rule = rate === null ? null : pocketRule(rate);
  if (!rule) {
    el.hidden = true;
    return;
  }
  const homeSym = CURRENCIES[home].symbol ?? "";
  const round0 = (v, c) =>
    new Intl.NumberFormat(localeFor(c), { maximumFractionDigits: 0 }).format(v);
  const examples = pocketExamples(rate)
    .map((e) => `<span>${round0(e.local, code)} ${CURRENCIES[code].symbol} ≈ ${homeSym}${round0(e.home, home)}</span>`)
    .join("");
  el.hidden = false;
  el.innerHTML = `
    <div class="pr-head">Pocket rule</div>
    <div class="pr-rule">${code} → ${homeSym} &nbsp;${rule.op} ${rule.factor}</div>
    <div class="pr-ex">${examples}</div>
    <div class="pr-err">Within ${rule.errorPct.toFixed(1)}% of the real rate — screenshot it</div>
  `;
}

function openDetail(code) {
  detailCode = code;
  const c = CURRENCIES[code];
  const { base, quote } = detailPair(code);
  $("#detail-title").textContent = `${c.flag} ${code} — ${c.name}`;
  const rates = ratesInfo.data?.rates;
  const now = rates ? convert(1, base, quote, rates) : null;
  $("#detail-rate-now").textContent = now !== null ? `1 ${base} = ${formatRate(now)} ${quote}` : "No rate yet";
  syncDetailCopy(code);
  renderPocketRule(code);
  $("#detail-sheet").showModal();
  loadDetailChart(code, settings.rangeDays ?? 30);
}

// ---------- amounts arriving from outside (share target, QR scan) ----------

// Put an incoming amount into the right field, exactly as if it were typed.
function applyIncoming(parsed) {
  if (!parsed || !activeTrip()) return false;
  const codes = visibleCodes();
  const { amount, code } = parsed;
  if (code && !codes.includes(code)) {
    toast(`Add ${code} to this trip to convert it`);
    return false;
  }
  if (!Number.isFinite(amount)) {
    if (code) toast(`That code charges in ${code}, with no amount set`);
    return false;
  }
  const target = code
    ?? (lastEdit && codes.includes(lastEdit.code) ? lastEdit.code : settings.homeCurrency);
  const input = fieldInput(target);
  if (!input) return false;
  input.value = formatAmount(amount, target);
  input.dataset.prev = input.value;
  fitAmount(input);
  lastEdit = { code: target, amount };
  persistLastEdit();
  recompute();
  buzz();
  toast(`${formatAmount(amount, target)} ${target}`);
  return true;
}

let stopScan = null;

async function openScan() {
  const note = $("#scan-note");
  const sheet = $("#scan-sheet");
  $("#scan-video").hidden = false;
  note.textContent = "Starting the camera…";
  sheet.showModal();
  try {
    const stop = await startScan($("#scan-video"), (raw) => {
      sheet.close(); // the close handler releases the camera
      if (!applyIncoming(parsePaymentQR(raw, visibleCodes()))) {
        toast("No amount found in that code");
      }
    });
    if (!sheet.open) {
      stop(); // closed while the camera was still starting
      return;
    }
    stopScan = stop;
    note.textContent = "Point at a merchant's QR code — the amount fills in automatically.";
  } catch {
    // Denied or unavailable. The frame keeps looking like a live
    // viewfinder, so say plainly that it isn't one — and say WHERE the
    // permission lives, because "allow camera access" is not actionable
    // if you don't already know that.
    $("#scan-video").hidden = true;
    note.textContent = navigator.userAgent.includes("Mac") || /iPhone|iPad/.test(navigator.userAgent)
      ? "No camera access. Safari → the “aA” or lock icon in the address bar → Website Settings → Camera → Allow, then reopen this."
      : "No camera access. Tap the lock icon in the address bar → Permissions → Camera → Allow, then reopen this.";
  }
}

// ---------- copy ----------

// Tiny haptic tick where supported (Android); silently no-op elsewhere.
// Browsers reject vibration before the first tap (e.g. on a share-target
// load), so skip it rather than trip a console error.
const buzz = (ms = 12) => {
  if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
  navigator.vibrate?.(ms);
};

async function copyText(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    buzz();
    toast(`Copied ${label}`);
  } catch {
    toast("Copy not available");
  }
}

// The detail sheet always has something worth copying: your converted
// amount when you've typed one, otherwise the rate itself. (A greyed-out
// primary button just reads as broken — and since v1.21 the converter
// starts empty on every launch, so it was greyed out most of the time.)
function syncDetailCopy(code) {
  const btn = $("#detail-copy");
  btn.hidden = !detailRateText() && !fieldInput(code)?.value;
  btn.textContent = fieldInput(code)?.value ? "Copy this amount" : "Copy this rate";
}

const detailRateText = () => {
  const text = $("#detail-rate-now").textContent;
  return text && text !== "No rate yet" ? text : "";
};

function copyFromDetail() {
  if (!detailCode) return;
  const value = fieldInput(detailCode)?.value;
  if (value) return copyText(value, `${value} ${detailCode}`);
  const rate = detailRateText();
  if (rate) return copyText(rate, rate);
  toast("No rate to copy yet");
}

// ---------- wiring ----------

function wireEvents() {
  const fields = $("#fields");
  fields.addEventListener("input", (e) => {
    if (e.target.matches("input[data-code]")) onFieldInput(e.target);
  });
  // Select-all on focus so typing replaces the formatted value.
  fields.addEventListener("focusin", (e) => {
    if (e.target.matches("input[data-code]")) e.target.select();
  });
  fields.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-copy]");
    if (btn) openDetail(btn.dataset.copy);
  });
  $("#detail-copy").addEventListener("click", copyFromDetail);
  $("#detail-chart").addEventListener("click", (e) => {
    if (e.target.closest("#chart-retry") && detailCode) {
      loadDetailChart(detailCode, settings.rangeDays ?? 30);
    }
  });
  $("#range-seg").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-days]");
    if (!btn || !detailCode) return;
    settings = updateSettings({ rangeDays: Number(btn.dataset.days) });
    loadDetailChart(detailCode, settings.rangeDays);
  });
  enableRowDrag();
  enableTripDrag();
  enableTripSwipe();

  // Trip search + filter chips
  $("#trip-search").addEventListener("input", (e) => {
    tripQuery = e.target.value;
    renderTrips();
  });
  $("#trip-search-clear").addEventListener("click", () => {
    tripQuery = "";
    $("#trip-search").value = "";
    renderTrips();
    $("#trip-search").focus();
  });
  $("#trip-filters").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-filter]");
    if (!chip) return;
    if (chip.dataset.filter === "__archived") {
      viewArchived = !viewArchived;
      tripFilterCode = null; // chips differ between views
    } else {
      tripFilterCode = tripFilterCode === chip.dataset.filter ? null : chip.dataset.filter;
    }
    renderTrips();
  });

  // The logo must never be a destructive reload — an accidental tap would
  // dump the converter (amounts are session-only) and collapse the trip.
  $("#brand-btn").addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));
  $("#clear-all").addEventListener("click", clearAll);
  // Turn the conversion you're looking at into an expense, prefilled.
  $("#to-expense").addEventListener("click", () => {
    if (lastEdit) openExpense(null, { amount: lastEdit.amount, code: lastEdit.code });
  });

  // Committed amounts (blur), not keystrokes, teach the slip guard.
  fields.addEventListener("change", (e) => {
    if (e.target.matches("input[data-code]")) {
      recordSample(e.target.dataset.code, parseAmount(e.target.value));
    }
  });

  $("#status").addEventListener("click", () => {
    buzz(8);
    refreshRates(true);
  });

  $("#scan-btn").addEventListener("click", openScan);
  // Whichever way the scanner closes — backdrop, pull-down, Escape, a hit —
  // the camera must be released.
  $("#scan-sheet").addEventListener("close", () => {
    stopScan?.();
    stopScan = null;
  });

  $("#place-add").addEventListener("click", () => {
    const trip = activeTrip();
    if (!trip || !placeCode) return;
    trip.currencies = dedupe([...trip.currencies, placeCode]);
    saveTrips();
    $("#place-strip").hidden = true;
    renderTrips();
    toast(`Added ${placeCode}`);
  });
  $("#place-dismiss").addEventListener("click", () => {
    settings = store.setSettings({ placeDismissed: placeCode });
    $("#place-strip").hidden = true;
  });

  // Enter / the keyboard's Done key dismisses the keyboard. Android Chrome
  // doesn't blur on Enter by itself (there's no form to submit). In the
  // member-name fields Done means "Add" — not just keyboard-away.
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
      e.preventDefault();
      if (e.target.id === "editor-member-name") {
        addEditorMember(); // clears + refocuses for the next name
      } else if (e.target.id === "m-name") {
        addMember(e.target.value);
        e.target.value = "";
      } else {
        e.target.blur();
      }
    }
  });
  $("#new-trip-btn").addEventListener("click", () => openEditor(null));
  $("#empty-new-trip").addEventListener("click", () => openEditor(null));
  $("#profile-btn").addEventListener("click", openSettings);
  $("#signed-out-dismiss").addEventListener("click", () => {
    settings = store.setSettings({ noticeDismissed: true });
    renderProfileButton(); // the badge stays; only the prompt goes
  });
  $("#signed-out-fix").addEventListener("click", () => {
    openSettings();
    $("#google-signin")?.scrollIntoView({ block: "center" });
  });
  $("#avatar-edit").addEventListener("click", () => $("#avatar-file").click());
  $("#avatar-file").addEventListener("change", (e) => pickAvatar(e.target.files?.[0]));

  // Trip cards: tap a header to expand/collapse, pin to pin, pencil to edit.
  $("#trips").addEventListener("click", (e) => {
    const swipedCard = e.target.closest(".trip-card");
    if (swipedCard?.dataset.swiped) {
      delete swipedCard.dataset.swiped; // that tap was the tail of a swipe
      return;
    }
    const pin = e.target.closest("[data-pin]");
    if (pin) {
      buzz(8);
      togglePin(pin.dataset.pin);
      return;
    }
    const edit = e.target.closest("[data-edit]");
    if (edit) {
      openEditor(trips.find((t) => t.id === edit.dataset.edit));
      return;
    }
    const head = e.target.closest("[data-toggle-trip]");
    if (head) {
      buzz(8);
      toggleTrip(head.dataset.toggleTrip);
    }
  });

  // ----- ledger wiring -----
  $("#trip-tabs").addEventListener("click", (e) => {
    const b = e.target.closest("[data-tab]");
    if (!b || b.dataset.tab === activeTab) return;
    activeTab = b.dataset.tab;
    syncTab();
  });
  $("#add-expense").addEventListener("click", () => openExpense(null));
  $("#summary-btn").addEventListener("click", openSummary);

  // Summary: mark a suggested transfer paid, record a custom payment,
  // or delete a logged payment (with Undo).
  $("#summary-body").addEventListener("click", (e) => {
    const mark = e.target.closest("[data-pay-from]");
    if (mark) {
      const { payFrom, payTo, payAmt } = mark.dataset;
      openPaymentSheet({ from: payFrom, to: payTo, amount: Number(payAmt) });
      return;
    }
    if (e.target.closest("#sum-add-pay")) {
      openPaymentSheet();
      return;
    }
    const del = e.target.closest("[data-pdel]");
    if (del) {
      const gone = settlements.find((p) => p.id === del.dataset.pdel);
      if (!gone) return;
      settlements = settlements.filter((p) => p.id !== gone.id);
      saveSettlements();
      renderSummaryBody();
      toast("Payment deleted", {
        actionLabel: "Undo",
        onAction: () => {
          if (settlements.some((p) => p.id === gone.id)) return; // already back
          settlements = [...settlements, gone];
          saveSettlements(); // clears the tombstone, so the delete stays undone
          if ($("#summary-sheet").open) renderSummaryBody();
        },
      });
    }
  });

  $("#p-from").addEventListener("click", (e) => {
    const b = e.target.closest("[data-pfrom]");
    if (b) { pState.from = b.dataset.pfrom; renderPaymentSheet(); }
  });
  $("#p-to").addEventListener("click", (e) => {
    const b = e.target.closest("[data-pto]");
    if (b) { pState.to = b.dataset.pto; renderPaymentSheet(); }
  });
  $("#p-amount").addEventListener("input", (e) => {
    pState.amount = parseAmount(e.target.value);
    renderPaymentSheet();
  });
  $("#p-code").addEventListener("change", (e) => {
    pState.code = e.target.value;
    renderPaymentSheet();
  });
  $("#p-save").addEventListener("click", () => {
    const homeAmount = paymentHomeAmount();
    if (homeAmount === null) return; // button is disabled; belt and braces
    recordPayment(pState.from, pState.to, homeAmount);
    $("#payment-sheet").close();
    renderSummaryBody();
    toast("Payment recorded");
  });

  // Receipt slot in the expense sheet
  $("#e-attach").addEventListener("click", (e) => {
    if (e.target.closest("#attach-add")) {
      $("#e-file").click();
    } else if (e.target.closest("#attach-remove")) {
      eAttach = { kind: "none" };
      $("#e-file").value = "";
      renderAttachRow();
    } else if (e.target.closest("#attach-view")) {
      viewAttachment();
    }
  });
  $("#e-file").addEventListener("change", (e) => pickAttachment(e.target.files?.[0]));
  $("#expense-sheet").addEventListener("close", () => {
    for (const u of attachUrls) URL.revokeObjectURL(u);
    attachUrls = [];
  });
  $("#ledger-panel").addEventListener("click", (e) => {
    if (e.target.closest("#member-manage")) {
      renderMemberSheet();
      $("#member-sheet").showModal();
      $("#m-name").focus();
      return;
    }
    const x = e.target.closest("[data-expense]");
    if (x) openExpense(expenses.find((ex) => ex.id === x.dataset.expense));
  });

  $("#m-add").addEventListener("click", () => {
    addMember($("#m-name").value);
    $("#m-name").value = "";
    $("#m-name").focus();
  });
  $("#m-list").addEventListener("click", (e) => {
    const open = e.target.closest("[data-medit]");
    if (open) openMemberEditor(open.dataset.medit);
  });
  $("#mx-save").addEventListener("click", saveMemberEditor);
  $("#mx-remove").addEventListener("click", removeMember);
  $("#mx-reassign-go").addEventListener("click", reassignAndRemove);
  $("#push-toggle").addEventListener("click", togglePush);
  // Reordering was drag-only, so it was unreachable by keyboard and by
  // anyone who can't hold a long press. Tapping the grip moves a trip up
  // one place — slower than dragging, but it exists.
  $("#trips").addEventListener("click", (e) => {
    const grip = e.target.closest("[data-move]");
    if (!grip) return;
    e.stopPropagation();
    const id = grip.dataset.move;
    const at = trips.findIndex((t) => t.id === id);
    if (at <= 0) return;
    [trips[at - 1], trips[at]] = [trips[at], trips[at - 1]];
    saveTrips();
    renderTrips();
    document.querySelector(`[data-move="${CSS.escape(id)}"]`)?.focus();
  }, true);
  $("#mx-send").addEventListener("click", () => {
    const m = editingMember();
    if (!m) return;
    shareInviteTo(m.email ?? "the email you gave them", activeTrip()?.id, m.phone);
  });

  $("#etype-row").addEventListener("click", (e) => {
    const b = e.target.closest("[data-etype]");
    if (b) { eState.type = b.dataset.etype; renderExpenseForm(); }
  });
  $("#e-name").addEventListener("input", (e) => { eState.name = e.target.value; renderExpenseForm(); });
  $("#e-desc").addEventListener("input", (e) => { eState.desc = e.target.value; });
  $("#e-amount").addEventListener("input", (e) => {
    // The converter has had live grouping since v1.6; this field, where a
    // wrong number is permanent, had none. Seeing the number regroup as
    // you type is what tells you how the app read it.
    const raw = e.target.value;
    const amount = parseAmount(raw, amountLocale());
    // Deleting can momentarily produce the same shape as a European
    // decimal ("1,234" backspaced is "1,23"), so only offer the
    // alternative reading when something was actually typed.
    eState.maybeMeant = e.inputType?.startsWith("delete")
      ? null
      : ambiguousSeparator(raw, amountLocale());
    if (amount !== null) regroupInPlace(e.target, raw);
    eState.amount = amount;
    renderExpenseForm();
  });
  // A committed amount teaches the slip guard what "normal" looks like on
  // this trip. It only ever learnt from the converter, so anyone working
  // in the Expenses tab never armed the outlier check at all.
  $("#e-amount").addEventListener("blur", () => recordSample(eState.code, eState.amount));
  $("#e-code").addEventListener("change", (e) => { eState.code = e.target.value; renderExpenseForm(); });
  $("#e-payer").addEventListener("click", (e) => {
    if (e.target.closest("#e-add-member")) {
      renderMemberSheet();
      $("#member-sheet").showModal(); // stacks over the expense sheet
      $("#m-name").focus();
      return;
    }
    const b = e.target.closest("[data-payer]");
    if (b) { eState.paidBy = b.dataset.payer; renderExpenseForm(); }
  });
  $("#e-split-mode").addEventListener("click", (e) => {
    const b = e.target.closest("[data-mode]");
    if (!b || b.dataset.mode === eState.split.mode) return;
    const members = ensureMembers(activeTrip());
    const mode = b.dataset.mode;
    // sensible fresh defaults per mode
    eState.split = mode === "equal"
      ? equalSplit(members)
      : { mode, parts: Object.fromEntries(members.map((m) => [
          m.id, mode === "percent" ? Math.round(100 / members.length) : 1,
        ])) };
    if (mode === "percent") {
      // nudge the first member so the percentages total exactly 100
      const ids = members.map((m) => m.id);
      const total = ids.reduce((s, id) => s + eState.split.parts[id], 0);
      eState.split.parts[ids[0]] += 100 - total;
    }
    renderExpenseForm();
  });
  $("#e-split-rows").addEventListener("change", (e) => {
    const inc = e.target.closest("[data-sinc]");
    if (inc) {
      eState.split.parts[inc.dataset.sinc] = inc.checked ? 1 : 0;
      renderExpenseForm();
    }
  });
  $("#e-split-rows").addEventListener("input", (e) => {
    const w = e.target.closest("[data-sw]");
    if (w) {
      eState.split.parts[w.dataset.sw] = parseAmount(w.value) ?? 0;
      // update validation + owed labels without rebuilding (keeps focus)
      const homeAmount = previewHomeValue();
      const valid = splitValid(eState.split);
      const live = homeAmount !== null && valid
        ? allocate(homeAmount, eState.split.parts, CURRENCIES[settings.homeCurrency]?.decimals ?? 2)
        : {};
      for (const row of document.querySelectorAll("#e-split-rows .split-row")) {
        const input = row.querySelector("[data-sw]");
        if (!input) continue;
        const cut = live[input.dataset.sw];
        // Blanking these while the percentages don't add up hid how far
        // off you were; keep showing the current figures instead.
        row.querySelector(".s-owes").textContent = cut !== undefined ? fmtHome(cut) : "";
        row.classList.toggle("off", !(eState.split.parts[input.dataset.sw] > 0));
      }
      const note = $("#e-split-note");
      if (eState.split.mode === "percent") {
        const total = Object.values(eState.split.parts).reduce((a, b) => a + (Number(b) > 0 ? Number(b) : 0), 0);
        note.textContent = valid ? "Adds up to 100% ✓" : `Adds up to ${total}% — needs 100%`;
      } else {
        note.textContent = valid ? "" : "Include at least one person";
      }
      note.classList.toggle("bad", !valid);
      $("#e-save").disabled = !(
        eState.name.trim() && Number.isFinite(eState.amount) && eState.amount > 0 &&
        valid && eState.paidBy && homeAmount !== null
      );
    }
  });
  $("#e-save").addEventListener("click", saveExpense);
  $("#e-delete").addEventListener("click", (e) => {
    const btn = e.currentTarget;
    if (btn.dataset.armed === "1") {
      deleteExpense(editExpenseId);
      return;
    }
    btn.dataset.armed = "1";
    btn.classList.add("confirming");
    btn.textContent = "Sure? Tap again to delete";
    setTimeout(() => {
      if (!document.body.contains(btn) || btn.dataset.armed !== "1") return;
      btn.dataset.armed = "";
      btn.classList.remove("confirming");
      btn.textContent = "Delete expense";
    }, 2500);
  });

  $("#editor-member-add").addEventListener("click", addEditorMember);
  $("#editor-members").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-mrm]");
    if (!chip) return;
    if (!chip.dataset.mrm) { explainLockedMember(chip.dataset.mwhy); return; }
    editorMembers = editorMembers.filter((m) => m.id !== chip.dataset.mrm);
    renderEditorMembers();
  });

  // Sharing IS managing members now — one list of people, not two.
  $("#editor-share").addEventListener("click", () => {
    if (!editorId) return;
    settings = store.setSettings({ activeTripId: editorId });
    shareTripId = editorId;
    $("#editor-sheet").close();
    renderTrips();
    renderMemberSheet();
    $("#member-sheet").showModal();
  });

  $("#editor-dup").addEventListener("click", () => {
    if (editorId) duplicateTrip(editorId);
  });
  $("#editor-archive").addEventListener("click", () => {
    if (!editorId) return;
    $("#editor-sheet").close();
    toggleArchive(editorId); // renders + toasts with Undo
  });
  $("#editor-delete").addEventListener("click", () => armDelete());
  $("#scan-close").addEventListener("click", () => $("#scan-sheet").close());
  $("#confirm-cancel").addEventListener("click", () => $("#confirm-sheet").close());
  $("#confirm-go").addEventListener("click", () => {
    $("#confirm-sheet").close();
    deleteTrip(editorId);
  });

  $("#editor-search").addEventListener("input", renderEditor);
  $("#search-clear").addEventListener("click", () => {
    const s = $("#editor-search");
    s.value = "";
    renderEditor();
    s.focus();
  });
  $("#editor-picked").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-toggle]");
    if (btn) toggleEditorCode(btn.dataset.toggle);
  });
  $("#editor-results").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-toggle]");
    if (btn) toggleEditorCode(btn.dataset.toggle);
  });
  $("#editor-save").addEventListener("click", saveEditor);

  $("#home-select").addEventListener("change", (e) => {
    const next = e.target.value;
    const was = settings.homeCurrency;
    // Every balance, total and settle-up figure across every trip is
    // expressed in this, and the change follows you to your other
    // devices. Scrolling past it on a native picker shouldn't silently
    // restate what everyone owes.
    const affected = expenses.length;
    if (affected && next !== was) {
      const ok = confirm(
        `Show every amount in ${next} instead of ${was}?\n\n` +
        `${affected} ${affected === 1 ? "expense stays" : "expenses stay"} exactly as recorded — ` +
        `only the currency they're displayed in changes, converted at today's rate.`
      );
      if (!ok) { e.target.value = was; return; }
    }
    settings = updateSettings({ homeCurrency: next });
    renderTrips();
    if (affected && next !== was) toast(`Amounts now shown in ${next}`);
  });

  $("#markup-toggle").addEventListener("change", (e) => {
    settings = updateSettings({ markupOn: e.target.checked });
    syncMarkupRow();
    recompute();
  });
  $("#markup-pct").addEventListener("input", (e) => {
    const pct = parseAmount(e.target.value);
    if (pct !== null && pct <= 100) {
      settings = updateSettings({ markupPct: pct });
      recompute();
    }
  });

  // ----- sync / account -----
  $("#google-signin").addEventListener("click", async () => {
    const { ok, user } = await runAuth(async () => {
      const { signInWithGoogle } = await import("./firebase.js");
      await signInWithGoogle({
        // We're about to leave the page; remember that a sign-in is in
        // flight so the return trip reconnects instead of looking cold.
        onRedirect: () => (settings = store.setSettings({ syncHint: true })),
      });
    });
    reportIncompleteSignIn(ok, user);
  });
  $("#email-toggle").addEventListener("click", () => {
    const form = $("#email-form");
    form.hidden = !form.hidden;
    $("#email-toggle").textContent = form.hidden ? "Use email instead" : "Hide email sign-in";
    if (!form.hidden) $("#sync-email-input").focus();
  });
  $("#email-signin").addEventListener("click", async () => {
    const { ok, user } = await runAuth(async () => {
      const { signInWithEmail } = await import("./firebase.js");
      await signInWithEmail($("#sync-email-input").value.trim(), $("#sync-pass").value);
    });
    reportIncompleteSignIn(ok, user);
  });
  $("#email-create").addEventListener("click", async () => {
    let mailed = null; // null = not attempted, true/false = outcome
    const { ok, user } = await runAuth(async () => {
      const { createAccount, sendVerification } = await import("./firebase.js");
      const created = await createAccount($("#sync-email-input").value.trim(), $("#sync-pass").value);
      // This used to be `.catch(() => {})`. If the send failed — quota,
      // a misconfigured template, a lost session — the user was told
      // nothing at all and simply waited for an email that was never
      // going to arrive. Say which of the two happened.
      try {
        await sendVerification(created);
        mailed = true;
      } catch {
        mailed = false;
      }
    });
    reportIncompleteSignIn(ok, user);
    if (ok && user) {
      renderAccount({
        note: mailed
          ? "Account created. Check your inbox — and your spam folder — for the verification email."
          : "Account created, but the verification email couldn't be sent. You're signed in and syncing; use Resend below.",
        bad: mailed === false,
      });
    }
  });
  // Firebase rate-limits verification mail hard, and tapping repeatedly
  // is the natural response to an email that hasn't arrived yet — which
  // is exactly what gets you blocked. Hold the user's hand instead.
  let verifyReadyAt = 0;
  $("#resend-verify").addEventListener("click", async () => {
    if (Date.now() < verifyReadyAt) {
      renderAccount({ note: "Already sent. Check your spam folder — it can take a few minutes." });
      return;
    }
    const { sendVerification, authErrorMessage } = await import("./firebase.js");
    try {
      await sendVerification();
      verifyReadyAt = Date.now() + 60_000;
      renderAccount({ note: `Sent to ${account?.email}. Check spam if it's not there in a minute.` });
    } catch (err) {
      verifyReadyAt = Date.now() + 60_000;
      renderAccount({
        note: err?.code === "auth/too-many-requests"
          ? "Too many attempts — Firebase has paused these for a bit. The email may already be in your spam folder. You don't need it to open a trip someone sent you a link to."
          : authErrorMessage(err?.code),
        bad: true,
      });
    }
  });
  for (const id of ["#profile-name", "#profile-phone"]) {
    $(id).addEventListener("change", () => {
      settings = updateSettings({
        profileName: $("#profile-name").value.trim(),
        profilePhone: normalisePhone($("#profile-phone").value),
      });
      pushProfileToTrips();
    });
  }
  $("#sync-now").addEventListener("click", async () => {
    syncBusy(true);
    const ok = await syncNow();
    syncBusy(false);
    if (ok) renderAccount({ note: "Up to date." });
  });
  $("#sign-out").addEventListener("click", async () => {
    // Before the session goes, not after — see releasePushToken.
    await releasePushToken();
    const { ok } = await runAuth(async () => {
      const { signOutUser } = await import("./firebase.js");
      await signOutUser();
    });
    // Signing out never touches local data — the trips stay on this phone.
    if (ok) {
      settings = store.setSettings({ syncHint: false }); // deliberate: no warning
      renderProfileButton();
      $("#sync-pass").value = "";
      renderAccount({ note: "Signed out. Your trips are still here on this device." });
    }
  });

  $("#theme-seg").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-theme-opt]");
    if (!btn) return;
    settings = store.setSettings({ theme: btn.dataset.themeOpt });
    applyTheme();
  });

  // Sheets close by tapping the backdrop or pulling down on the handle zone.
  // A true backdrop click targets the dialog ELEMENT itself; clicks on (or
  // keyboard activations of) children must never close the sheet — synthetic
  // clicks carry (0,0) coords that would otherwise read as "outside".
  for (const dialog of document.querySelectorAll("dialog.sheet")) {
    // A live update that arrived while this sheet was open was held back
    // so it couldn't move things under the user's finger. Apply it now.
    dialog.addEventListener("close", () => setTimeout(flushLiveRender, 150));
    dialog.addEventListener("click", (e) => {
      if (e.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      if (outside) dialog.close();
    });
    enableSheetPull(dialog);
  }

  // Coming back to the app after a while: catch up immediately rather
  // than waiting for the next edit. The listener covers everything while
  // we're open, but it may have been torn down in the background.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState !== "visible") {
      // Leaving: send anything pending NOW. A backgrounded tab can have
      // its timers frozen indefinitely, so "in a moment" may mean never
      // — which looks exactly like "archiving didn't sync".
      flushPush();
      return;
    }
    if (!account) return;
    startLiveUpdates();
    syncNow({ silent: true });
  });
  // Belt and braces for a tab being closed or swiped away outright.
  window.addEventListener("pagehide", flushPush);

  // Re-fetch when connectivity returns; keep the age label ticking.
  window.addEventListener("online", refreshRates);
  window.addEventListener("offline", renderStatus);
  setInterval(renderStatus, 60_000);
}

// ---------- boot ----------

// The percent input is inert (dimmed + disabled) while the switch is off.
function syncMarkupRow() {
  const on = $("#markup-toggle").checked;
  $("#markup-pct").disabled = !on;
  $("#markup-row").classList.toggle("off", !on);
}

// Offer the local currency when the device's timezone says we're somewhere
// this trip doesn't cover. No prompt, no GPS, no network.
function updatePlaceStrip() {
  const strip = $("#place-strip");
  strip.hidden = true;
  if (!placeCode || !activeTrip()) return;
  if (visibleCodes().includes(placeCode)) return; // already shown, badged HERE
  if (settings.placeDismissed === placeCode) return;
  $("#place-text").textContent = `Looks like you're in ${placeLabel()} — add ${placeCode}?`;
  strip.hidden = false;
}

// Every sheet gets a close button. There wasn't one anywhere: the only
// exits were a backdrop tap, a 26px pull-down handle, and Esc — and
// phones have no Esc. The worst case was the scanner with camera access
// denied: a black rectangle, one line of grey text, and no control of
// any kind.
// A radiogroup whose children are plain buttons is invalid ARIA, and
// "which one is on?" was carried by a CSS class alone. Rather than
// rewrite five controls, keep the buttons and mark them properly.
function syncSegState(root) {
  for (const b of root.querySelectorAll("button")) {
    const on = b.classList.contains("on");
    if (root.getAttribute("role") === "tablist") {
      b.setAttribute("role", "tab");
      b.setAttribute("aria-selected", String(on));
    } else {
      b.setAttribute("role", "radio");
      b.setAttribute("aria-checked", String(on));
    }
  }
}

// Anything that toggles an `.on` class inside one of these re-announces
// itself, without every call site having to remember.
function watchSegs() {
  const roots = [...document.querySelectorAll('[role="radiogroup"], [role="tablist"]')];
  for (const root of roots) {
    syncSegState(root);
    new MutationObserver(() => syncSegState(root))
      .observe(root, { subtree: true, childList: true, attributeFilter: ["class"] });
  }
}

// Give every sheet the structure the tall ones already had: a fixed
// header, one scrolling middle, fixed actions.
//
// Without it the DIALOG itself scrolled, which broke two things. The
// close button is positioned against the dialog, so it scrolled away —
// on a long sheet like Settings there was no way out at all. And a
// scroll that reaches the end of a dialog CHAINS to the page behind it,
// so the list kept moving under the sheet.
function wrapSheetBodies() {
  for (const sheet of document.querySelectorAll("dialog.sheet")) {
    if (sheet.querySelector(":scope > .sheet-scroll")) continue; // already structured
    const body = document.createElement("div");
    body.className = "sheet-scroll";
    for (const child of [...sheet.children]) {
      if (child.classList.contains("grab-zone") ||
          child.classList.contains("sheet-close") ||
          child.classList.contains("sheet-actions")) continue;
      body.appendChild(child);
    }
    // Before the actions, after the handle.
    sheet.insertBefore(body, sheet.querySelector(":scope > .sheet-actions"));
  }
}

function addSheetCloseButtons() {
  for (const sheet of document.querySelectorAll("dialog.sheet")) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "sheet-close";
    b.setAttribute("aria-label", "Close");
    b.innerHTML = ICONS.close ??
      '<svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>';
    b.addEventListener("click", () => sheet.close());
    sheet.prepend(b);
  }
}

function boot() {
  // Storage refusing writes is not survivable in silence: everything
  // still renders, so the only signal the user gets is losing the lot
  // when they close the tab.
  store.setStorageFailureHandler(() => {
    const priv = "Private Browsing blocks saving. Your trips will vanish when you close this tab.";
    const full = "This device's storage is full — TripCash can't save. Free some space, then reopen.";
    toast(navigator.userAgent.includes("Safari") && !navigator.userAgent.includes("Chrome") ? priv : full);
  });
  $("#app-version").textContent = APP_VERSION;
  addSheetCloseButtons();
  wrapSheetBodies(); // after the close buttons, so they stay outside the scroller
  watchSegs();
  $("#about-version").textContent = APP_VERSION;
  applyTheme();
  renderProfileButton(); // sign-in state visible from the first frame
  $("#markup-toggle").checked = settings.markupOn;
  $("#markup-pct").value = String(settings.markupPct);
  $("#scan-btn").hidden = !scanSupported();
  syncMarkupRow();
  wireEvents();
  wireInstall();
  placeCode = currencyForTimeZone(); // before render: the HERE badge needs it
  // One-time migration to the unified member model (ADR-0011): invites
  // used to live in a list on the trip, separate from its members. Fold
  // each one into an actual member so they appear as a person — and so
  // the derived access list doesn't silently drop them.
  let migrated = false;
  for (const t of trips) {
    for (const email of t.invitedEmails ?? []) {
      const clean = normEmail(email);
      if (!clean) continue;
      const members = t.members ?? (t.members = [{ id: LEGACY_SELF, name: "You" }]);
      if (members.some((m) => normEmail(m.email) === clean)) continue;
      members.push({ id: crypto.randomUUID(), name: nameFromEmail(clean), email: clean });
    }
    // Belt to applyPayload's braces: only a list with something IN it is
    // a migration. `if (t.invitedEmails)` was true for `[]` too, so this
    // "one-time" pass ran on every launch and restamped every trip
    // (ADR-0017).
    if (t.invitedEmails) {
      if (t.invitedEmails.length) migrated = true;
      delete t.invitedEmails;
    }
  }
  if (migrated) saveTrips();

  // Fresh start on every launch: the converter opens with empty boxes.
  // trip.lastEdit still buffers amounts across trip switches WITHIN a
  // session — it just no longer survives a reload.
  for (const t of trips) t.lastEdit = null;
  saveTrips();
  // Launch state: everything collapsed — except a pinned trip, which opens.
  const pinnedValid = settings.pinnedTripId && trips.some((t) => t.id === settings.pinnedTripId);
  settings = store.setSettings({ activeTripId: pinnedValid ? settings.pinnedTripId : null });
  renderTrips();
  refreshRates(); // async; fields fill in as soon as rates arrive

  const params = new URLSearchParams(location.search);

  // Someone shared a trip with us: ?join=<tripId>. Remembered in settings
  // rather than held in the URL, because signing in with Google can
  // navigate away and come back — the id must survive that round trip.
  const joinId = params.get("join");
  if (joinId) {
    history.replaceState(null, "", "./");
    settings = store.setSettings({ pendingJoin: joinId });
    setTimeout(() => {
      toast(settings.syncHint
        ? "Opening the trip shared with you…"
        : "Sign in from Settings to open the trip shared with you", { actionLabel: "Settings", onAction: openSettings });
    }, 900);
  }

  // Tapped a notification: ?trip=<id>. The service worker also posts
  // this to an already-open tab, which won't reload.
  const openTripId = params.get("trip");
  if (openTripId) {
    history.replaceState(null, "", "./");
    openTripFromNotification(openTripId);
  }
  navigator.serviceWorker?.addEventListener("message", (e) => {
    if (e.data?.type === "open-trip" && e.data.tripId) openTripFromNotification(e.data.tripId);
  });

  // Home-screen shortcut deep links (manifest shortcuts): ?action=…
  const action = params.get("action");
  if (action) {
    history.replaceState(null, "", "./");
    if (action === "new-trip") openEditor(null);
    // "trips" (old shortcut): the home screen IS the trip list now — no-op.
  }

  // Text shared into the app from anywhere (Web Share Target).
  const shared = ["text", "title", "url"].map((k) => params.get(k)).filter(Boolean).join(" ");
  if (shared) {
    history.replaceState(null, "", "./");
    if (!trips.length) {
      toast("Create a trip first, then share amounts into it");
    } else {
      // No card open, or the shared currency lives in another trip? Open the
      // best match before applying.
      const probe = parseSharedText(shared, trips.flatMap((t) => t.currencies));
      if (probe?.code && !activeTrip()?.currencies.includes(probe.code) && probe.code !== settings.homeCurrency) {
        const owner = trips.find((t) => !t.archived && t.currencies.includes(probe.code));
        if (owner) {
          settings = store.setSettings({ activeTripId: owner.id });
          renderTrips();
        }
      } else if (!activeTrip()) {
        const first = trips.find((t) => !t.archived);
        if (first) {
          settings = store.setSettings({ activeTripId: first.id });
          renderTrips();
        }
      }
      const parsed = parseSharedText(shared, visibleCodes());
      if (!parsed) toast("Couldn't find an amount in that");
      else applyIncoming(parsed);
    }
  }

  // One-time hint: tapping a currency opens its rate chart (copy lives there).
  if (!settings.detailTipShown && activeTrip()) {
    setTimeout(() => toast("Tip: tap a currency to see its 30-day chart"), 1500);
    settings = store.setSettings({ detailTipShown: true });
  }

  // Restore a previous session — but only for someone who actually signed
  // in before. Everyone else never touches the network for this.
  if (settings.syncHint) connectAuth().catch(() => {});

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

boot();

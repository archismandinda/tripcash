// TripCash — state + event wiring. Views live in ui.js, logic in convert.js,
// storage in store.js, rate fetching in rates.js.

import { CURRENCIES, ALL_CODES, searchCurrencies, matchLabel, tripMatchesQuery } from "./currencies.js";
import { convert, applyMarkup, parseAmount, formatAmount, groupInput, dedupe, localeFor } from "./convert.js";
import * as store from "./store.js";
import { loadRates, ageString } from "./rates.js";
import { loadHistory, historySupported } from "./history.js";
import { renderChart, formatRate } from "./chart.js";
import { parseSharedText, parsePaymentQR } from "./parse.js";
import { lakhGloss, slipCheck, pocketRule, pocketExamples, currencyForTimeZone, placeLabel, stampText,
  toDatetimeLocal, fromDatetimeLocal } from "./insights.js";
import { scanSupported, startScan } from "./scan.js";
import { splitValid, shareOf, tripBalances, settleUp, expenseCuts, equalSplit } from "./splits.js";
import { putAttachment, getAttachment, deleteAttachment, deleteAttachments, prepareAttachment } from "./attach.js";
import { $, fieldRow, tripCard, filterChip, resultItem, pickedChip, toast, ICONS,
  EXPENSE_TYPES, typeEmoji, typeLabel, expenseRow, memberChip, escapeHtml } from "./ui.js";

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

function saveTrips() {
  store.setTrips(trips);
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
function regroupInPlace(input, text) {
  const next = groupInput(text, localeFor(input.dataset.code));
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
    if (settings.pinnedTripId === id) settings = store.setSettings({ pinnedTripId: null });
    if (settings.activeTripId === id) settings = store.setSettings({ activeTripId: null });
  }
  saveTrips();
  buzz(8);
  renderTrips();
  toast(archiving ? `Archived “${trip.name}”` : `Restored “${trip.name}”`, {
    actionLabel: "Undo",
    onAction: () => {
      trip.archived = !archiving;
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
  settings = store.setSettings({ pinnedTripId: pinning ? id : null });
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
  const del = $("#editor-delete");
  del.dataset.armed = "";
  del.classList.remove("confirming");
  del.textContent = "Delete trip";
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
    const used = editorId && expenses.some(
      (e) => e.tripId === editorId && (e.paidBy === m.id || e.split.parts[m.id] > 0)
    );
    const removable = m.id !== "me" && !used;
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.dataset.mrm = removable ? m.id : "";
    chip.textContent = removable ? `${m.name} ✕` : m.name;
    if (!removable) chip.style.opacity = "0.75";
    box.appendChild(chip);
  }
}

function addEditorMember() {
  const name = $("#editor-member-name").value.trim();
  if (!name) return;
  editorMembers.push({ id: crypto.randomUUID(), name });
  $("#editor-member-name").value = "";
  renderEditorMembers();
  $("#editor-member-name").focus();
}

function renderEditor() {
  // A trip without a currency is meaningless — Save stays off until one is picked.
  $("#editor-save").disabled = editorPicked.length === 0;
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
    trip.name = name;
    trip.currencies = dedupe(editorPicked);
    trip.members = editorMembers;
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

function deleteTrip(id) {
  if (!trips.some((t) => t.id === id)) return;
  trips = trips.filter((t) => t.id !== id);
  saveTrips();
  const swept = expenses.filter((e) => e.tripId === id);
  expenses = expenses.filter((e) => e.tripId !== id); // sweep the trip's ledger
  saveExpenses();
  settlements = settlements.filter((p) => p.tripId !== id);
  store.setSettlements(settlements);
  deleteAttachments(swept.filter((e) => e.attachment).map((e) => e.id)).catch(() => {});
  if (settings.pinnedTripId === id) settings = store.setSettings({ pinnedTripId: null });
  if (settings.activeTripId === id) {
    settings = store.setSettings({ activeTripId: trips[0]?.id ?? null });
  }
  $("#editor-sheet").close();
  renderTrips();
}

function duplicateTrip(id) {
  const src = trips.find((t) => t.id === id);
  if (!src) return;
  const copy = {
    id: crypto.randomUUID(),
    name: `${src.name} copy`,
    currencies: [...src.currencies],
    members: structuredClone(src.members ?? []),
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
function armDelete(btn) {
  if (btn.dataset.armed === "1") {
    deleteTrip(editorId);
    return;
  }
  btn.dataset.armed = "1";
  btn.classList.add("confirming");
  btn.textContent = "Sure? Tap again to delete";
  setTimeout(() => {
    if (!document.body.contains(btn) || btn.dataset.armed !== "1") return;
    btn.dataset.armed = "";
    btn.classList.remove("confirming");
    btn.textContent = "Delete trip";
  }, 2500);
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
  const unverified = signedIn && account.emailVerified === false;
  if (signedIn) {
    $("#sync-email").textContent = account.email ?? "Signed in";
    $("#sync-when").textContent = settings.lastSyncAt
      ? `Last synced ${ageString(settings.lastSyncAt)}`
      : "Not synced yet";
    // Invites are only honoured for verified addresses (see the rules),
    // so an unverified account would silently never receive them.
    $("#resend-verify").hidden = !unverified;
    if (unverified && !note) note = "Verify your email to receive trip invites — check your inbox.";
  }
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

let inviteTripId = null;

const inviteTrip = () => trips.find((t) => t.id === inviteTripId) ?? null;

function openInvite(tripId) {
  inviteTripId = tripId;
  const trip = inviteTrip();
  if (!trip) return;
  $("#invite-title").textContent = `Share “${trip.name}”`;
  $("#invite-email").value = "";
  renderInvites();
  $("#invite-sheet").showModal();
}

function renderInvites() {
  const trip = inviteTrip();
  const list = $("#invite-list");
  list.innerHTML = "";
  for (const email of trip?.invitedEmails ?? []) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.dataset.uninvite = email;
    chip.textContent = `${email} ✕`;
    list.appendChild(chip);
  }
  const invited = (trip?.invitedEmails ?? []).length;
  const note = $("#invite-note");
  if (!account) {
    note.textContent = "Sign in from Settings first — sharing needs an account.";
    note.classList.add("bad");
  } else {
    note.classList.remove("bad");
    note.textContent = invited
      ? "They'll need to sign in with exactly this address. Changes sync both ways."
      : "";
  }
  $("#invite-share").disabled = !invited || !account;
  $("#invite-whatsapp").disabled = !invited || !account;
}

function addInvite() {
  const trip = inviteTrip();
  const input = $("#invite-email");
  const email = input.value.trim().toLowerCase();
  if (!trip) return;
  // Deliberately loose: the real gate is the rules matching a verified
  // address, so a typo costs nothing but a chip you can remove.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    $("#invite-note").textContent = "That doesn't look like an email address.";
    $("#invite-note").classList.add("bad");
    return;
  }
  trip.invitedEmails = dedupe([...(trip.invitedEmails ?? []), email]);
  saveTrips();
  input.value = "";
  renderInvites();
  syncNow({ silent: true }); // push the invite so they can actually get in
}

function removeInvite(email) {
  const trip = inviteTrip();
  if (!trip) return;
  trip.invitedEmails = (trip.invitedEmails ?? []).filter((e) => e !== email);
  saveTrips();
  renderInvites();
  syncNow({ silent: true });
}

const inviteMessage = () => {
  const trip = inviteTrip();
  const who = (trip?.invitedEmails ?? [])[0];
  return `I've shared "${trip?.name}" with you on TripCash — our shared trip expenses.\n\n` +
    `Open ${location.origin}${location.pathname} and sign in with ${who} to see it.`;
};

async function shareInvite() {
  const text = inviteMessage();
  // The share sheet is the whole point: one tap to WhatsApp, Messages,
  // Gmail, whatever they actually use.
  if (navigator.share) {
    try {
      await navigator.share({ title: "TripCash", text });
      return;
    } catch {
      return; // user dismissed the sheet; not an error
    }
  }
  try {
    await navigator.clipboard.writeText(text);
    toast("Invite copied — paste it to them");
  } catch {
    toast("Couldn't share on this device");
  }
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
    const { buildPayload, applyPayload } = await import("./sync.js");
    const { syncTrip, fetchMyTrips, fetchInvitedTrips } = await import("./firestore.js");

    const absorb = (merged, tripId) => {
      const next = applyPayload({
        merged, tripId, trips, expenses, settlements, tombstones: store.getTombstones(),
      });
      trips = next.trips;
      expenses = next.expenses;
      settlements = next.settlements;
      saveTrips();
      saveExpenses();
      saveSettlements();
      store.setTombstones(next.tombstones);
    };

    for (const trip of [...trips]) {
      const merged = await syncTrip(trip.id, buildPayload({
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
      absorb(merged, trip.id);
    }

    for (const { id, payload } of await fetchMyTrips(account.uid)) {
      if (trips.some((t) => t.id === id)) continue; // already handled above
      absorb(payload, id);
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

    settings = store.setSettings({ lastSyncAt: Date.now() });
    renderTrips();
    renderAccount(inviteNote ? { note: `Synced.${inviteNote}` } : {});
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
function onAccountChange(next) {
  const wasSignedIn = !!account;
  account = next;
  // A hint in settings so the next launch knows whether to load the SDK
  // at all — signed-out users must never pay for it.
  if (!!next !== settings.syncHint) settings = store.setSettings({ syncHint: !!next });
  renderAccount();
  // Freshly signed in (or session restored at launch) → sync straight away.
  if (next && !wasSignedIn) syncNow({ silent: true });
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
const dayLabel = (ts) =>
  new Date(ts).toLocaleDateString(undefined, { day: "numeric", month: "short" });
const timeLabel = (ts) =>
  new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
const dayTimeLabel = (ts) => `${dayLabel(ts)}, ${timeLabel(ts)}`;

// Every trip has at least "You".
function ensureMembers(trip) {
  if (!trip.members?.length) {
    trip.members = [{ id: "me", name: "You" }];
    saveTrips();
  }
  return trip.members;
}

// Money snapshots were taken in whatever the home currency was AT SAVE
// TIME (record.homeCode). If home has changed since, re-express them in
// the current home at today's rate — never show an INR magnitude with a
// $ sign. Falls back to the stored value when rates can't bridge it.
function inCurrentHome(record) {
  const home = settings.homeCurrency;
  if (!record.homeCode || record.homeCode === home) return record;
  const rates = ratesInfo.data?.rates;
  const v = rates ? convert(record.homeValue ?? record.amount, record.homeCode, home, rates) : null;
  if (v === null) return record;
  return record.homeValue !== undefined
    ? { ...record, homeValue: v, homeCode: home }
    : { ...record, amount: v, homeCode: home };
}

const tripExpenses = (tripId) =>
  expenses.filter((e) => e.tripId === tripId)
    .sort((a, b) => b.createdAt - a.createdAt)
    .map(inCurrentHome);

function saveExpenses() {
  store.setExpenses(expenses);
}

function renderLedger() {
  const trip = activeTrip();
  if (!trip) return;
  const members = ensureMembers(trip);
  const byId = Object.fromEntries(members.map((m) => [m.id, m.name]));
  const list = tripExpenses(trip.id);
  const cuts = expenseCuts(list, members);
  $("#ledger-total").textContent = fmtHome(cuts.total);
  $("#ledger-count").textContent = list.length
    ? `${list.length} expense${list.length === 1 ? "" : "s"} · in ${settings.homeCurrency}`
    : "No expenses yet";
  $("#summary-btn").hidden = !list.length;

  const row = $("#member-row");
  row.innerHTML = "";
  for (const m of members) {
    // Plain labels — a chip styled like the tappable ones but doing
    // nothing on tap reads as "the app is broken".
    const chip = document.createElement("span");
    chip.className = "member-chip static";
    chip.textContent = m.name;
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
  const ul = $("#m-list");
  ul.innerHTML = "";
  for (const m of ensureMembers(trip)) {
    const used = expenses.some(
      (e) => e.tripId === trip.id && (e.paidBy === m.id || e.split.parts[m.id] > 0)
    );
    const li = document.createElement("li");
    li.innerHTML = `<span>${m.name === "You" ? "You" : m.name}</span>` +
      (m.id === "me" ? "" :
        `<button class="mini" data-mdel="${m.id}" ${used ? 'disabled style="opacity:.35"' : ""}
          aria-label="Remove member">${ICONS.trash}</button>`);
    ul.appendChild(li);
  }
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
      getAttachment(editExpenseId).then((rec) => {
        if (!rec || eAttach.kind !== "existing") return;
        const url = URL.createObjectURL(rec.blob);
        attachUrls.push(url);
        img.src = url;
      }).catch(() => {});
    }
  }
}

async function pickAttachment(file) {
  if (!file) return;
  $("#e-attach").innerHTML = '<span class="attach-busy">Preparing…</span>';
  let rec = null;
  try {
    rec = await prepareAttachment(file);
  } catch { /* rec stays null */ }
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
  const rec = eAttach.kind === "new" ? eAttach.rec : await getAttachment(editExpenseId).catch(() => null);
  if (!rec) {
    toast("Couldn't load that receipt");
    return;
  }
  const url = URL.createObjectURL(rec.blob);
  if (rec.type?.startsWith("image/")) {
    attachUrls.push(url); // revoked with the expense sheet's URLs
    $("#attach-title").textContent = rec.name ?? "Receipt";
    $("#attach-body").innerHTML = "";
    const img = document.createElement("img");
    img.src = url;
    img.alt = "Receipt";
    $("#attach-body").appendChild(img);
    $("#attach-sheet").showModal();
  } else {
    const a = document.createElement("a");
    a.href = url;
    a.download = rec.name ?? "receipt";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);
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
        paidBy: "me", split: equalSplit(members) };
  // Buffered attachment intent — nothing touches IndexedDB until Save.
  // kind: "none" | "existing" (kept as-is) | "new" (freshly picked file)
  eAttach = existing?.attachment
    ? { kind: "existing", meta: existing.attachment }
    : { kind: "none" };
  $("#e-file").value = "";
  $("#expense-title").textContent = existing ? "Edit expense" : "Add expense";
  $("#e-name").value = eState.name;
  $("#e-desc").value = eState.desc;
  $("#e-when").value = toDatetimeLocal(existing?.createdAt ?? Date.now());
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
    payer.appendChild(memberChip(m, { on: eState.paidBy === m.id, data: "payer" }));
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
  const rates = ratesInfo.data?.rates;
  const homeAmount = eState.amount && rates
    ? convert(eState.amount, eState.code, settings.homeCurrency, rates)
    : null;
  for (const m of members) {
    const weight = eState.split.parts[m.id] ?? 0;
    const included = weight > 0;
    const li = document.createElement("div");
    li.className = "split-row" + (included ? "" : " off");
    const owed = homeAmount !== null && splitValid(eState.split)
      ? shareOf({ homeValue: homeAmount, split: eState.split }, m.id)
      : null;
    const owesText = owed !== null && included ? fmtHome(owed) : "";
    if (eState.split.mode === "equal") {
      li.innerHTML = `
        <input type="checkbox" data-sinc="${m.id}" ${included ? "checked" : ""} aria-label="Include ${m.name}">
        <span class="s-name">${m.name}</span>
        <span class="s-owes">${owesText}</span>`;
    } else {
      const suffix = eState.split.mode === "percent" ? "%" : "×";
      li.innerHTML = `
        <span class="s-name">${m.name}</span>
        <span class="s-owes">${owesText}</span>
        <input type="text" inputmode="decimal" data-sw="${m.id}" value="${included ? weight : ""}"
          placeholder="0" aria-label="${m.name} ${suffix}">`;
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
  preview.textContent = homeAmount !== null
    ? `≈ ${fmtHome(homeAmount)} at today's rate — locked in when you save`
    : (eState.amount && !rates ? "Need rates once (go online) to log expenses" : "");

  $("#e-save").disabled = !(
    eState.name.trim() && Number.isFinite(eState.amount) && eState.amount > 0 &&
    valid && eState.paidBy && homeAmount !== null
  );
}

async function saveExpense() {
  const trip = activeTrip();
  const rates = ratesInfo.data?.rates;
  const homeValue = rates ? convert(eState.amount, eState.code, settings.homeCurrency, rates) : null;
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
    createdAt: fromDatetimeLocal($("#e-when").value)
      ?? (editExpenseId ? expenses.find((e) => e.id === editExpenseId)?.createdAt : null)
      ?? Date.now(),
  };
  // Commit the buffered receipt before the record points at it.
  const hadAttachment = editExpenseId && expenses.find((e) => e.id === editExpenseId)?.attachment;
  try {
    if (eAttach.kind === "new") {
      await putAttachment(record.id, eAttach.rec);
      record.attachment = { name: eAttach.rec.name, type: eAttach.rec.type };
    } else if (eAttach.kind === "existing") {
      record.attachment = eAttach.meta;
    } else if (hadAttachment) {
      await deleteAttachment(record.id); // receipt was removed in the editor
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
  if (expenses.find((e) => e.id === id)?.attachment) deleteAttachment(id).catch(() => {});
  expenses = expenses.filter((e) => e.id !== id);
  saveExpenses();
  $("#expense-sheet").close();
  renderLedger();
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
  store.setSettlements(settlements);
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
  const members = ensureMembers(trip);
  const byId = Object.fromEntries(members.map((m) => [m.id, m.name]));
  const list = tripExpenses(trip.id);
  const pays = tripSettlements(trip.id);
  const balances = tripBalances(list, members, pays);
  const transfers = settleUp(balances);
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
  for (const m of members) fromRow.appendChild(memberChip(m, { on: pState.from === m.id, data: "pfrom" }));
  const toRow = $("#p-to");
  toRow.innerHTML = "";
  for (const m of members) toRow.appendChild(memberChip(m, { on: pState.to === m.id, data: "pto" }));
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

  if (!historySupported(base, quote)) {
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
    note.textContent = "Camera unavailable — allow camera access for this site and try again.";
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
    settings = store.setSettings({ rangeDays: Number(btn.dataset.days) });
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
  $("#settings-btn").addEventListener("click", openSettings);

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
          settlements = [...settlements, gone];
          saveSettlements();
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
    const del = e.target.closest("[data-mdel]");
    if (!del || del.disabled) return;
    const trip = activeTrip();
    trip.members = trip.members.filter((m) => m.id !== del.dataset.mdel);
    saveTrips();
    renderMemberSheet();
    renderLedger();
  });

  $("#etype-row").addEventListener("click", (e) => {
    const b = e.target.closest("[data-etype]");
    if (b) { eState.type = b.dataset.etype; renderExpenseForm(); }
  });
  $("#e-name").addEventListener("input", (e) => { eState.name = e.target.value; renderExpenseForm(); });
  $("#e-desc").addEventListener("input", (e) => { eState.desc = e.target.value; });
  $("#e-amount").addEventListener("input", (e) => {
    eState.amount = parseAmount(e.target.value);
    renderExpenseForm();
  });
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
      const rates = ratesInfo.data?.rates;
      const homeAmount = eState.amount && rates
        ? convert(eState.amount, eState.code, settings.homeCurrency, rates) : null;
      const valid = splitValid(eState.split);
      for (const row of document.querySelectorAll("#e-split-rows .split-row")) {
        const input = row.querySelector("[data-sw]");
        if (!input) continue;
        const owed = homeAmount !== null && valid
          ? shareOf({ homeValue: homeAmount, split: eState.split }, input.dataset.sw) : null;
        row.querySelector(".s-owes").textContent =
          owed !== null && eState.split.parts[input.dataset.sw] > 0 ? fmtHome(owed) : "";
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
    if (!chip || !chip.dataset.mrm) return;
    editorMembers = editorMembers.filter((m) => m.id !== chip.dataset.mrm);
    renderEditorMembers();
  });

  $("#editor-share").addEventListener("click", () => {
    if (!editorId) return;
    $("#editor-sheet").close();
    openInvite(editorId);
  });
  $("#invite-add").addEventListener("click", addInvite);
  $("#invite-email").addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); addInvite(); }
  });
  $("#invite-list").addEventListener("click", (e) => {
    const chip = e.target.closest("[data-uninvite]");
    if (chip) removeInvite(chip.dataset.uninvite);
  });
  $("#invite-share").addEventListener("click", shareInvite);
  $("#invite-whatsapp").addEventListener("click", () => {
    // wa.me opens WhatsApp with the message ready — no business API,
    // no per-message cost, and it comes from your own number.
    window.open(`https://wa.me/?text=${encodeURIComponent(inviteMessage())}`, "_blank", "noopener");
  });

  $("#editor-dup").addEventListener("click", () => {
    if (editorId) duplicateTrip(editorId);
  });
  $("#editor-archive").addEventListener("click", () => {
    if (!editorId) return;
    $("#editor-sheet").close();
    toggleArchive(editorId); // renders + toasts with Undo
  });
  $("#editor-delete").addEventListener("click", (e) => armDelete(e.currentTarget));

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
    settings = store.setSettings({ homeCurrency: e.target.value });
    renderTrips();
  });

  $("#markup-toggle").addEventListener("change", (e) => {
    settings = store.setSettings({ markupOn: e.target.checked });
    syncMarkupRow();
    recompute();
  });
  $("#markup-pct").addEventListener("input", (e) => {
    const pct = parseAmount(e.target.value);
    if (pct !== null && pct <= 100) {
      settings = store.setSettings({ markupPct: pct });
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
    const { ok, user } = await runAuth(async () => {
      const { createAccount, sendVerification } = await import("./firebase.js");
      await createAccount($("#sync-email-input").value.trim(), $("#sync-pass").value);
      await sendVerification().catch(() => {}); // invites need a verified address
    });
    reportIncompleteSignIn(ok, user);
  });
  $("#resend-verify").addEventListener("click", async () => {
    const { sendVerification } = await import("./firebase.js");
    try {
      await sendVerification();
      renderAccount({ note: "Verification email sent — check your inbox." });
    } catch {
      renderAccount({ note: "Couldn't send it just now. Try again shortly.", bad: true });
    }
  });
  $("#sync-now").addEventListener("click", async () => {
    syncBusy(true);
    const ok = await syncNow();
    syncBusy(false);
    if (ok) renderAccount({ note: "Up to date." });
  });
  $("#sign-out").addEventListener("click", async () => {
    const { ok } = await runAuth(async () => {
      const { signOutUser } = await import("./firebase.js");
      await signOutUser();
    });
    // Signing out never touches local data — the trips stay on this phone.
    if (ok) {
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
    dialog.addEventListener("click", (e) => {
      if (e.target !== dialog) return;
      const r = dialog.getBoundingClientRect();
      const outside = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      if (outside) dialog.close();
    });
    enableSheetPull(dialog);
  }

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

function boot() {
  applyTheme();
  $("#markup-toggle").checked = settings.markupOn;
  $("#markup-pct").value = String(settings.markupPct);
  $("#scan-btn").hidden = !scanSupported();
  syncMarkupRow();
  wireEvents();
  wireInstall();
  placeCode = currencyForTimeZone(); // before render: the HERE badge needs it
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

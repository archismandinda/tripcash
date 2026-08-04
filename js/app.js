// TripCash — state + event wiring. Views live in ui.js, logic in convert.js,
// storage in store.js, rate fetching in rates.js.

import { CURRENCIES, ALL_CODES, searchCurrencies, matchLabel } from "./currencies.js";
import { convert, applyMarkup, parseAmount, formatAmount, groupInput, dedupe } from "./convert.js";
import * as store from "./store.js";
import { loadRates, ageString } from "./rates.js";
import { $, fieldRow, tripListItem, resultItem, pickedChip, toast } from "./ui.js";

let settings = store.getSettings();
let trips = store.getTrips();
let ratesInfo = { data: null, live: false }; // filled by refreshRates()

// The last-edited field is the single source of truth for all conversions.
let lastEdit = null; // { code, amount }

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

function renderFields() {
  const trip = activeTrip();
  $("#trip-name").textContent = trip ? trip.name : "TripCash";
  $("#empty-state").hidden = !!trip;
  $("#markup-row").hidden = !trip;
  const box = $("#fields");
  box.innerHTML = "";
  if (!trip) return;
  for (const code of visibleCodes()) {
    box.appendChild(fieldRow(code, code === settings.homeCurrency));
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

// Long amounts step down in size so they never clip (rows are fixed-height).
function fitAmount(input) {
  input.classList.toggle("long", input.value.length > 11 && input.value.length <= 16);
  input.classList.toggle("xlong", input.value.length > 16);
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
  const next = groupInput(text);
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

// ---------- rates + status bar ----------

function renderStatus() {
  const el = $("#status");
  const cached = ratesInfo.data;
  el.hidden = false;
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

async function refreshRates() {
  ratesInfo = await loadRates();
  renderStatus();
  recompute();
}

// ---------- trip sheets ----------

function openTripSheet() {
  const list = $("#trip-list");
  list.innerHTML = "";
  for (const trip of trips) list.appendChild(tripListItem(trip, trip.id === settings.activeTripId));
  $("#trip-sheet").showModal();
}

// Editor state: which trip is being edited (null = new) + picked codes.
let editorId = null;
let editorPicked = [];

function openEditor(trip) {
  editorId = trip?.id ?? null;
  editorPicked = trip ? [...trip.currencies] : [];
  $("#editor-title").textContent = trip ? "Edit trip" : "New trip";
  $("#editor-name").value = trip?.name ?? "";
  $("#editor-search").value = "";
  renderEditor();
  $("#trip-sheet").close();
  $("#editor-sheet").showModal();
}

function renderEditor() {
  const pickedBox = $("#editor-picked");
  pickedBox.innerHTML = "";
  for (const code of editorPicked) pickedBox.appendChild(pickedChip(code));
  const results = $("#editor-results");
  results.innerHTML = "";
  const query = $("#editor-search").value;
  for (const code of searchCurrencies(query).slice(0, 30)) {
    results.appendChild(resultItem(code, editorPicked.includes(code), matchLabel(code, query)));
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
  if (editorPicked.length === 0) {
    toast("Pick at least one currency");
    return;
  }
  if (editorId) {
    const trip = trips.find((t) => t.id === editorId);
    trip.name = name;
    trip.currencies = dedupe(editorPicked);
  } else {
    const trip = { id: crypto.randomUUID(), name, currencies: dedupe(editorPicked), createdAt: Date.now() };
    trips.push(trip);
    settings = store.setSettings({ activeTripId: trip.id });
  }
  saveTrips();
  $("#editor-sheet").close();
  renderFields();
}

function deleteTrip(id) {
  const trip = trips.find((t) => t.id === id);
  if (!trip || !confirm(`Delete trip “${trip.name}”?`)) return;
  trips = trips.filter((t) => t.id !== id);
  saveTrips();
  if (settings.activeTripId === id) {
    settings = store.setSettings({ activeTripId: trips[0]?.id ?? null });
  }
  openTripSheet(); // re-render list in place
  renderFields();
}

// ---------- settings ----------

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
  $("#settings-sheet").showModal();
}

// ---------- copy ----------

async function copyAmount(code) {
  const value = fieldInput(code)?.value;
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    toast(`Copied ${value} ${code}`);
  } catch {
    toast("Copy not available");
  }
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
    if (btn) copyAmount(btn.dataset.copy);
  });

  $("#trip-btn").addEventListener("click", openTripSheet);
  $("#new-trip-btn").addEventListener("click", () => openEditor(null));
  $("#empty-new-trip").addEventListener("click", () => openEditor(null));
  $("#settings-btn").addEventListener("click", openSettings);

  $("#trip-list").addEventListener("click", (e) => {
    const pick = e.target.closest("[data-pick]");
    const edit = e.target.closest("[data-edit]");
    const del = e.target.closest("[data-del]");
    if (pick) {
      settings = store.setSettings({ activeTripId: pick.dataset.pick });
      $("#trip-sheet").close();
      renderFields();
    } else if (edit) {
      openEditor(trips.find((t) => t.id === edit.dataset.edit));
    } else if (del) {
      deleteTrip(del.dataset.del);
    }
  });

  $("#editor-search").addEventListener("input", renderEditor);
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
    renderFields();
  });

  $("#markup-toggle").addEventListener("change", (e) => {
    settings = store.setSettings({ markupOn: e.target.checked });
    recompute();
  });
  $("#markup-pct").addEventListener("input", (e) => {
    const pct = parseAmount(e.target.value);
    if (pct !== null && pct <= 100) {
      settings = store.setSettings({ markupPct: pct });
      recompute();
    }
  });

  for (const btn of document.querySelectorAll(".close-sheet")) {
    btn.addEventListener("click", () => btn.closest("dialog").close());
  }

  // Re-fetch when connectivity returns; keep the age label ticking.
  window.addEventListener("online", refreshRates);
  window.addEventListener("offline", renderStatus);
  setInterval(renderStatus, 60_000);
}

// ---------- boot ----------

function boot() {
  $("#markup-toggle").checked = settings.markupOn;
  $("#markup-pct").value = String(settings.markupPct);
  wireEvents();
  renderFields();
  refreshRates(); // async; fields fill in as soon as rates arrive

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

boot();

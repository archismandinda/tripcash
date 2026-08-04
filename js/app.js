// TripCash — state + event wiring. Views live in ui.js, logic in convert.js,
// storage in store.js, rate fetching in rates.js.

import { CURRENCIES, ALL_CODES, searchCurrencies, matchLabel } from "./currencies.js";
import { convert, applyMarkup, parseAmount, formatAmount, groupInput, dedupe } from "./convert.js";
import * as store from "./store.js";
import { loadRates, ageString } from "./rates.js";
import { loadHistory, historySupported } from "./history.js";
import { renderChart, formatRate } from "./chart.js";
import { $, fieldRow, tripListItem, resultItem, pickedChip, toast, ICONS } from "./ui.js";

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
  $("#trip-name").textContent = trip ? trip.name : "Choose a trip";
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
    if (target !== idx) commitReorder(row.dataset.code, target);
  };
  fields.addEventListener("pointerup", drop);
  fields.addEventListener("pointercancel", drop);
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
  if (!trip) $("#editor-name").focus(); // new trip: start typing the name right away
}

function renderEditor() {
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
  if (!trips.some((t) => t.id === id)) return;
  trips = trips.filter((t) => t.id !== id);
  saveTrips();
  if (settings.activeTripId === id) {
    settings = store.setSettings({ activeTripId: trips[0]?.id ?? null });
  }
  openTripSheet(); // re-render list in place
  renderFields();
}

// In-sheet confirm: first tap arms the button ("Sure?"), second tap deletes.
function armDelete(btn) {
  if (btn.dataset.armed === "1") {
    deleteTrip(btn.dataset.del);
    return;
  }
  btn.dataset.armed = "1";
  btn.classList.add("confirming");
  btn.textContent = "Sure?";
  setTimeout(() => {
    if (!document.body.contains(btn)) return;
    btn.dataset.armed = "";
    btn.classList.remove("confirming");
    btn.innerHTML = ICONS.trash;
  }, 2500);
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

async function openDetail(code) {
  detailCode = code;
  const token = ++detailToken;
  const c = CURRENCIES[code];
  const { base, quote } = detailPair(code);
  $("#detail-title").textContent = `${c.flag} ${code} — ${c.name}`;
  const rates = ratesInfo.data?.rates;
  const now = rates ? convert(1, base, quote, rates) : null;
  $("#detail-rate-now").textContent = now !== null ? `1 ${base} = ${formatRate(now)} ${quote}` : "No rate yet";
  const chg = $("#detail-chg");
  chg.hidden = true;
  const box = $("#detail-chart");
  const note = $("#detail-note");
  box.innerHTML = '<div class="loading">Loading 30-day history…</div>';
  note.textContent = "";
  $("#detail-sheet").showModal();

  if (!historySupported(base, quote)) {
    box.innerHTML = '<div class="loading">No history available for this currency</div>';
    note.textContent = "Charts cover ~30 major currencies (ECB data).";
    return;
  }
  const hist = await loadHistory(base, quote);
  if (token !== detailToken) return; // sheet was reopened for another currency
  if (!hist) {
    box.innerHTML = '<div class="loading">Go online once to load the chart</div>';
    return;
  }
  renderChart(box, hist.series);
  const first = hist.series[0][1];
  const last = hist.series[hist.series.length - 1][1];
  const pct = ((last - first) / first) * 100;
  chg.hidden = false;
  chg.textContent = `${pct >= 0 ? "▲" : "▼"} ${Math.abs(pct).toFixed(1)}% · 30d`;
  chg.className = "chg " + (pct >= 0 ? "up" : "down");
  note.textContent = `1 ${base} in ${quote}, last 30 days · ECB rates via Frankfurter${hist.live ? "" : " (cached)"}`;
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
    if (btn) openDetail(btn.dataset.copy);
  });
  $("#detail-copy").addEventListener("click", () => {
    if (detailCode) copyAmount(detailCode);
  });
  enableRowDrag();

  $("#brand-btn").addEventListener("click", () => location.reload());
  $("#clear-all").addEventListener("click", clearAll);

  // Enter / the keyboard's Done key dismisses the keyboard. Android Chrome
  // doesn't blur on Enter by itself (there's no form to submit).
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
      e.preventDefault();
      e.target.blur();
    }
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
      armDelete(del);
    }
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
    settings = store.setSettings({ homeCurrency: e.target.value });
    renderFields();
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

  $("#theme-seg").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-theme-opt]");
    if (!btn) return;
    settings = store.setSettings({ theme: btn.dataset.themeOpt });
    applyTheme();
  });

  // Sheets close by tapping the backdrop or pulling down on the handle zone.
  for (const dialog of document.querySelectorAll("dialog.sheet")) {
    dialog.addEventListener("click", (e) => {
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

function boot() {
  applyTheme();
  $("#markup-toggle").checked = settings.markupOn;
  $("#markup-pct").value = String(settings.markupPct);
  syncMarkupRow();
  wireEvents();
  renderFields();
  refreshRates(); // async; fields fill in as soon as rates arrive

  // One-time hint: tapping a currency opens its rate chart (copy lives there).
  if (!settings.detailTipShown && activeTrip()) {
    setTimeout(() => toast("Tip: tap a currency to see its 30-day chart"), 1500);
    settings = store.setSettings({ detailTipShown: true });
  }

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

boot();

// TripCash — state + event wiring. Views live in ui.js, logic in convert.js,
// storage in store.js, rate fetching in rates.js.

import { CURRENCIES, ALL_CODES, searchCurrencies, matchLabel } from "./currencies.js";
import { convert, applyMarkup, parseAmount, formatAmount, groupInput, dedupe, localeFor } from "./convert.js";
import * as store from "./store.js";
import { loadRates, ageString } from "./rates.js";
import { loadHistory, historySupported } from "./history.js";
import { renderChart, formatRate } from "./chart.js";
import { parseSharedText, parsePaymentQR } from "./parse.js";
import { lakhGloss, slipCheck, pocketRule, pocketExamples, currencyForTimeZone, placeLabel, stampText } from "./insights.js";
import { scanSupported, startScan } from "./scan.js";
import { $, fieldRow, tripCard, resultItem, pickedChip, toast, ICONS } from "./ui.js";

let settings = store.getSettings();
let trips = store.getTrips();
let ratesInfo = { data: null, live: false }; // filled by refreshRates()

// The last-edited field is the single source of truth for all conversions.
let lastEdit = null; // { code, amount }
let placeCode = null; // currency of wherever the device thinks it is

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

// Rebuild the trip-card list and put the converter inside the open card.
function renderTrips() {
  const list = $("#trips");
  const panel = $("#converter-panel");
  $("#main").appendChild(panel); // park BEFORE clearing, or the panel is destroyed
  panel.hidden = true;
  list.innerHTML = "";
  const open = activeTrip();
  for (const trip of trips) list.appendChild(tripCard(trip, trip === open));
  $("#empty-state").hidden = trips.length > 0;
  $("#new-trip-btn").hidden = trips.length === 0;
  if (open) {
    list.querySelector(`.trip-card[data-trip="${CSS.escape(open.id)}"] .trip-card-body`).appendChild(panel);
    panel.hidden = false;
  }
  renderFields();
  updatePlaceStrip();
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

// Editor state: which trip is being edited (null = new) + picked codes.
let editorId = null;
let editorPicked = [];

function openEditor(trip) {
  editorId = trip?.id ?? null;
  editorPicked = trip ? [...trip.currencies] : [];
  $("#editor-title").textContent = trip ? "Edit trip" : "New trip";
  $("#editor-name").value = trip?.name ?? "";
  $("#editor-search").value = "";
  $("#editor-manage").hidden = !trip; // duplicate/delete exist only for saved trips
  const del = $("#editor-delete");
  del.dataset.armed = "";
  del.classList.remove("confirming");
  del.textContent = "Delete trip";
  renderEditor();
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
  renderTrips();
}

function deleteTrip(id) {
  if (!trips.some((t) => t.id === id)) return;
  trips = trips.filter((t) => t.id !== id);
  saveTrips();
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
    box.innerHTML = navigator.onLine
      ? '<div class="loading">Couldn\'t reach the history service — pull down and try again</div>'
      : '<div class="loading">Go online once to load the chart</div>';
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

async function copyAmount(code) {
  const value = fieldInput(code)?.value;
  if (!value) return;
  try {
    await navigator.clipboard.writeText(value);
    buzz();
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
  $("#range-seg").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-days]");
    if (!btn || !detailCode) return;
    settings = store.setSettings({ rangeDays: Number(btn.dataset.days) });
    loadDetailChart(detailCode, settings.rangeDays);
  });
  enableRowDrag();

  $("#brand-btn").addEventListener("click", () => location.reload());
  $("#clear-all").addEventListener("click", clearAll);

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
  // doesn't blur on Enter by itself (there's no form to submit).
  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && e.target instanceof HTMLInputElement) {
      e.preventDefault();
      e.target.blur();
    }
  });
  $("#new-trip-btn").addEventListener("click", () => openEditor(null));
  $("#empty-new-trip").addEventListener("click", () => openEditor(null));
  $("#settings-btn").addEventListener("click", openSettings);

  // Trip cards: tap a header to expand/collapse, pencil to edit.
  $("#trips").addEventListener("click", (e) => {
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

  $("#editor-dup").addEventListener("click", () => {
    if (editorId) duplicateTrip(editorId);
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
        const owner = trips.find((t) => t.currencies.includes(probe.code));
        if (owner) {
          settings = store.setSettings({ activeTripId: owner.id });
          renderTrips();
        }
      } else if (!activeTrip()) {
        settings = store.setSettings({ activeTripId: trips[0].id });
        renderTrips();
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

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }
}

boot();

// TripCash — state + event wiring. Views live in ui.js, logic in convert.js,
// storage in store.js, rate fetching in rates.js.

import { CURRENCIES, ALL_CODES, searchCurrencies, matchLabel, tripMatchesQuery } from "./currencies.js";
import { convert, applyMarkup, parseAmount, formatAmount, groupInput, dedupe, localeFor,
  localizeNumber } from "./convert.js";
import * as store from "./store.js";
import { loadRates, ageString } from "./rates.js";
import { loadHistory, historySupported } from "./history.js";
import { renderChart, formatRate } from "./chart.js";
import { parseSharedText, parsePaymentQR } from "./parse.js";
import { lakhGloss, slipCheck, pocketRule, pocketExamples, currencyForTimeZone, placeLabel, stampText,
  toDatetimeLocal, fromDatetimeLocal, initialHomeCurrency } from "./insights.js";
import { scanSupported, startScan } from "./scan.js";
import { splitValid, shareOf, tripBalances, settleUp, roundedNets, expenseCuts, equalSplit,
  referencedMembers, allocate, reassignMember } from "./splits.js";
import { putAttachment, getAttachment, deleteAttachment, deleteAttachments, prepareAttachment } from "./attach.js";
import { $, fieldRow, tripCard, filterChip, resultItem, pickedChip, toast, ICONS,
  EXPENSE_TYPES, typeEmoji, typeLabel, expenseRow, memberChip, escapeHtml } from "./ui.js";
import { selfMemberId, linkAccount, memberLabel, memberStatus, mergeEditedMembers,
  parseMemberInput,
  normaliseEmail as normEmail,
  nameFromEmail, LEGACY_SELF } from "./members.js";
import { pickSynced, syncedChanged, mergePrefs, prunePrefs, clockPlan } from "./prefs.js";
import { pushBlocker, pushGranted, enablePush, disablePush } from "./push.js";
import { absorbPayload } from "./absorb.js";
import { planAddMember, removability, awaitingInvite, evictionFrom } from "./roster.js";
import { priceExpense, currencyOptions, whyBlocked } from "./pricing.js";
import { commitExpense, resolveCreatedAt } from "./ledger.js";
import { beaconFor, shouldSend, isReturn, defaultOptIn, countsInvite, rememberInvite }
  from "./analytics.js";
import { addNotices, unreadCount, markAllRead, pruneNotices, noticeKey, diffTrip,
  noticeTarget, ACCOUNT_SCOPE } from "./notices.js";
import { emailKey, inviteEntry, pendingInvites, spentInvites } from "./invites.js";
import { encodePreview, invitationScreen } from "./invitelink.js";
import { coldOpenView, inviteStanding, lookAroundCodes, promptCount, nextPrompts } from "./coldopen.js";
import { joinOutcome, nextStep, addressRequest, GONE, NOT_VERIFIED } from "./joining.js";
import { installAdvice, shouldOfferInstall, isAppInstalled, engineOf } from "./install.js";
import { shouldAskToPersist, storageRisk, shouldWarn } from "./persist.js";

// THE version string. Bump here on every release, alongside VERSION in
// sw.js — nowhere else. It used to be typed into index.html twice, and
// two hand-maintained copies drift.
export const APP_VERSION = "v1.67.0";
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

// ---------- the cold open (js/invitelink.js, js/coldopen.js) ----------
//
// Read HERE, at module scope, from the URL and nothing else — before
// boot() runs, before any render, before rates, before an account. The
// visitor this screen exists for has no account and may have no signal;
// anything this waited on would be one more way for the link to look
// broken.
//
// It must also be read before boot()'s `history.replaceState(null, "",
// "./")`, which strips ?join= AND the #p= fragment. That strip is
// deliberate (the preview should not enter history or get re-shared),
// which is exactly why the fragment cannot be read after it.
const linkJoinId = new URLSearchParams(location.search).get("join");
const linkFragment = location.hash;
// …and the answer is re-derived rather than frozen, because the
// invitation OUTLIVES the URL. settings.pendingJoin is what survives a
// reload, a reopened PWA and the Google redirect sign-in — and clearing
// it, when the join finally lands, is what takes this screen back down.
const invitationNow = () => invitationScreen({
  joinId: linkJoinId,
  fragment: linkFragment,
  pendingJoin: settings.pendingJoin,
});
// Session-only, and deliberately not persisted: "Have a look around" is
// a detour, not a decision. Opening the same link again invites again.
let inviteDismissed = false;
// How many launches this device has ALREADY opened on the invitation it
// is holding — the app's own behaviour, never the person's (js/coldopen.js).
//
// Frozen for the launch, and that is the load-bearing part. boot() writes
// the incremented count before the app has finished painting; if this were
// re-read from settings afterwards, the third launch would count itself
// and then find it had already asked three times — so the invitation
// would be counted and never shown.
let promptsShown = 0;
// The last join that did NOT land: { do, clearPending, say } from
// js/joining.js, or null. It is what the invitation screen says instead
// of "Join this trip" — see renderInvitation.
let joinProblem = null;
// One decision, three surfaces (js/coldopen.js). Both of these read it,
// so the invitation and the detour away from it cannot disagree about
// whether "No trips yet." is allowed on screen.
//
// `joined` is asked of `trips`, not of a flag: the invitation is over
// when the trip it named is here. Nothing has to remember to say so,
// which is what stopped this screen coming down at all — the URL's
// ?join= is read once at module scope (boot() strips it), so it outlived
// every piece of state that was supposed to end it.
const coldOpen = () => {
  const { show, tripId } = invitationNow();
  return coldOpenView({
    show,
    dismissed: inviteDismissed,
    tripCount: trips.length,
    joined: !!tripId && trips.some((t) => t.id === tripId),
    shown: promptsShown,
    // THIS launch's URL, not settings.pendingJoin. pendingJoin outlives
    // the URL on purpose — it is what carries the invitation through a
    // reload and the Google redirect — so it means "there is an
    // invitation", which is precisely the state the count exists to end.
    // A live ?join= means somebody just tapped the link.
    fromLink: !!linkJoinId,
  });
};
const showingInvite = () => coldOpen() === "invitation";
const lookingAround = () => coldOpen() === "look-around";
// Whether the app is still standing aside for the invitation, which is a
// different question from which surface is up (js/coldopen.js). The
// look-around converter is the preview while there is still an
// invitation behind it, and this device's ordinary home screen once the
// app has stopped asking — and somebody who never signs in and never
// makes a trip stays on it for ever, so anything the cold open takes
// away is taken away for ever.
const inviteUp = () => inviteStanding({ view: coldOpen(), shown: promptsShown, fromLink: !!linkJoinId });

// ---------- helpers ----------

const activeTrip = () => trips.find((t) => t.id === settings.activeTripId) ?? null;

// Home currency first, then the trip's currencies (deduped against home).
// With no trip there is normally no converter at all — except on the
// look-around screen, where the converter IS the screen and nothing has
// chosen its rows for it (js/coldopen.js).
function visibleCodes() {
  const trip = activeTrip();
  if (trip) return dedupe([settings.homeCurrency, ...trip.currencies]);
  if (!lookingAround()) return [];
  return lookAroundCodes({ homeCurrency: settings.homeCurrency, placeCode });
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

// Paint the invitation the link arrived with (the cold-open design note).
//
// Everything here is a CLAIM made by whoever last touched the URL. So:
// textContent only — a trip named `<img src=x onerror=…>` renders as
// that literal text — and not one field is written anywhere. It is
// re-derived from the link on every launch, which is what makes a
// tampered preview harmless: it cannot outlive the tab it arrived in.
function renderInvitation() {
  const showing = showingInvite();
  $("#invite-screen").hidden = !showing;
  // Everything else on this screen is furniture for somebody who already
  // lives here: the not-signed-in warning (about an account they don't
  // have), the rates chip, the bell, the scanner. Hidden by CSS so each
  // one keeps its own owner and comes back untouched on dismissal.
  // It stays hidden through "Have a look around" as well — that person
  // still has no account for the banner to warn them about.
  //
  // But only while the invitation is still up. The same converter is
  // where a visitor with no trips of their own opens the app once it has
  // stopped asking, and hiding all of that from a screen they can never
  // leave hides it for ever — they keep the converter and lose the app.
  document.body.classList.toggle("cold-open", showing || (lookingAround() && inviteUp()));
  if (!showing) return;
  const invitation = invitationNow();
  const named = invitation.show === "invitation";
  $("#invite-by").textContent = named && invitation.by ? `${invitation.by} invited you to` : "";
  $("#invite-by").hidden = !(named && invitation.by);
  $("#invite-name").textContent = named ? invitation.name : "You've been invited to a trip";
  $("#invite-line").textContent = named ? invitation.line : "";
  $("#invite-line").hidden = !(named && invitation.line);

  // A join that did not land. All three sentences used to go to
  // renderAccount(), which writes them into #sync-note — inside the
  // settings sheet, closed, on a path that never opens it. A device that
  // was already signed in therefore got the 900ms "Opening the trip
  // shared with you…" toast and then nothing, ever, while this screen
  // went on offering to join a trip that was gone. This screen is what
  // that person is looking at, so this is where it is said.
  const step = nextStep(joinProblem);
  $("#invite-problem").textContent = joinProblem?.say ?? "";
  $("#invite-problem").hidden = !joinProblem;
  // "Join this trip" opens Settings. Offering it again after the join
  // just failed is the app asking for the thing that failed.
  $("#invite-join").hidden = !!joinProblem;
  $("#invite-next").textContent = step?.label ?? "";
  $("#invite-next").hidden = !step;
  // …and the reassurance underneath it ("the trip appears when you sign
  // in") is a promise we have just broken.
  $("#invite-reassure").hidden = !!joinProblem;
  // The one next step that already has a button on this screen. Two
  // identical offers is worse than one.
  $("#invite-dismiss").hidden = step?.action === "look-around";
}

// Rebuild the trip-card list and put the tabbed panel inside the open card.
function renderTrips() {
  // The invitation is decided from settings.pendingJoin, which syncNow
  // clears the moment the join lands — so this has to be repainted with
  // the list, or the joined trip appears underneath a live invitation.
  renderInvitation();
  const list = $("#trips");
  const panel = $("#panel-host");
  $("#main").appendChild(panel); // park BEFORE clearing, or the panel is destroyed
  panel.hidden = true;
  list.innerHTML = "";
  renderTripTools();
  const open = activeTrip();
  const shown = visibleTrips();
  for (const trip of shown) {
    // selfId is per-device (it depends on who is signed in here), so the
    // card is told rather than working it out — ui.js holds no state.
    const withSelf = { ...trip, selfId: selfMemberId(trip.members ?? [], account) };
    list.appendChild(tripCard(withSelf, trip === open, trip.id === settings.pinnedTripId));
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
  // A link that promised a trip must never land on "No trips yet." and
  // "Create your first trip". That is the app contradicting the person
  // who sent the link, in the largest type on the screen, and the most
  // likely reading of it is that the link is broken.
  // …for exactly as long as there is a link promising one. Once the app
  // has stopped asking, this is somebody with no trips looking at the
  // ordinary home screen, and "Create your first trip" is the only
  // gesture on the page that makes one — without it the converter is all
  // they can ever reach.
  $("#empty-state").hidden = trips.length > 0 || showingInvite() || (lookingAround() && inviteUp());
  $("#new-trip-btn").hidden = trips.length === 0 || showingInvite() || lookingAround();
  // The way back exists only while there is something to go back to.
  // Past the third launch this button was still on screen and pressing
  // it did nothing at all.
  $("#look-around-back").hidden = !(lookingAround() && inviteUp());
  const openCardBody = open && list.querySelector(`.trip-card[data-trip="${CSS.escape(open.id)}"] .trip-card-body`);
  if (openCardBody) {
    openCardBody.appendChild(panel);
    panel.hidden = false;
    $("#trip-tabs").hidden = false;
    syncTab();
  } else if (lookingAround()) {
    // "Have a look around" drops them into the converter (the cold-open design note,
    // AC7). It is the app's daily surface and needs no account, no trip
    // and no network — which is exactly what this person has. The panel
    // stays parked in #main; only the open-trip branch reparents it.
    // Expenses DO need a trip, so that tab is not offered.
    panel.hidden = false;
    $("#trip-tabs").hidden = true;
    $("#converter-panel").hidden = false;
    $("#ledger-panel").hidden = true;
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
  const codes = visibleCodes();
  // Street rate and Clear belong to the fields, so they exist exactly
  // when the fields do — including on the look-around screen, which has
  // rows but no trip.
  $("#markup-row").hidden = !codes.length;
  const box = $("#fields");
  box.innerHTML = "";
  if (!codes.length) return;
  for (const code of codes) {
    box.appendChild(fieldRow(code, code === settings.homeCurrency));
  }
  // Mark the currency of wherever the device says we are. On the home row
  // that's redundant (and would crowd the HOME badge), so skip it.
  if (placeCode && placeCode !== settings.homeCurrency) {
    const label = box.querySelector(`.field[data-code="${CSS.escape(placeCode)}"] .field-code`);
    label?.insertAdjacentHTML("beforeend", '<span class="here-badge">HERE</span>');
  }
  // Restore this trip's last-entered amount, if any. There is no trip to
  // restore from on the look-around screen, and nothing there is written
  // down, so it opens empty.
  lastEdit = trip?.lastEdit && CURRENCIES[trip.lastEdit.code] ? trip.lastEdit : null;
  if (lastEdit && !codes.includes(lastEdit.code)) lastEdit = null;
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
  // "+ Expense" prefills the expense editor from this conversion — so it
  // needs a ledger to put the expense in. The look-around converter has
  // no trip behind it.
  $("#to-expense").hidden = !lastEdit || !activeTrip();
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
      ? lakhGloss(parseAmount(row.querySelector("input").value, amountLocale(row.dataset.code)) ?? 0)
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
  const amount = parseAmount(text, amountLocale(input.dataset.code));
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
  // The moment the app has just done something for THIS person. Not
  // "they typed" — a number with no rates, or a trip with one currency,
  // converts nothing and is not worth interrupting for.
  if (conversionLanded()) offerInstall("first-conversion");
}

// Did that keystroke actually produce a converted amount somewhere else?
function conversionLanded() {
  const source = lastEdit?.code;
  if (!source) return false;
  return [...document.querySelectorAll("#fields input")]
    .some((i) => i.dataset.code !== source && i.value.trim() !== "");
}

// Re-insert thousands separators into the field being typed in, keeping the
// caret next to the same digit it was on.
// The converter's rows format per currency (INR uses the Indian system);
// everything else follows the device. Whatever it is, parseAmount and
// groupInput must be handed the SAME one or the field shows one number
// while the app computes another.
const amountLocale = (code) => localeFor(code);

// Fields that are not money — split weights, the markup percent — and text
// arriving from other apps on this phone. They are written and read in the
// device's own format, so name it rather than passing nothing and hoping:
// an omitted locale is "whatever this device happens to be", which is only
// ever accidentally the same thing.
const DEVICE_LOCALE = new Intl.NumberFormat().resolvedOptions().locale;
// The other thing the device says about itself, read once and passed as an
// argument like the locale (js/insights.js decides what either one means).
const DEVICE_TZ = new Intl.DateTimeFormat().resolvedOptions().timeZone;

function regroupInPlace(input, text) {
  const locale = amountLocale(input.dataset.code);
  const next = groupInput(text, locale);
  if (next === text) return;
  // Count DIGITS, not "everything that isn't a comma". de-DE groups with
  // ".", fr-FR with a narrow non-breaking space — counting those as
  // digits put the caret mid-number, so typing 12345 produced 12354.
  const isDigit = (ch) => /\p{Nd}/u.test(ch);
  const caret = input.selectionStart ?? text.length;
  const digitsBeforeCaret = [...text.slice(0, caret)].filter(isDigit).length;
  input.value = next;
  let pos = 0, seen = 0;
  while (pos < next.length && seen < digitsBeforeCaret) {
    if (isDigit(next[pos])) seen++;
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
let editorOpenedWith = []; // the member list as it was when the sheet opened

function openEditor(trip) {
  editorId = trip?.id ?? null;
  editorPicked = trip ? [...trip.currencies] : [];
  // Who was on the trip when this sheet opened — the only way to tell a
  // deliberate removal from someone another device added since.
  editorOpenedWith = structuredClone(trip?.members ?? []);
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
  // Your own row reads "You" here too. Once an account is linked,
  // linkAccount replaces the "You" placeholder with your real name, so
  // anywhere printing m.name directly started calling you by it.
  const self = selfMemberId(editorMembers, account);
  for (const m of editorMembers) {
    // The SAME gate the member editor uses. These were two copies of one
    // rule, and they drifted: this one didn't know about settlements.
    const gate = editorId
      ? removability(m, { selfId: self,
          ownerUid: trips.find((t) => t.id === editorId)?.ownerUid ?? null,
          expenses: expenses.filter((e) => e.tripId === editorId),
          settlements: settlements.filter((p) => p.tripId === editorId),
          others: editorMembers.length - 1 })
      // A trip being created has no owner yet, and you are it.
      : { removable: m.id !== self, why: m.id === self ? "self" : "" };
    const removable = gate.removable;
    const used = !removable && gate.why !== "self";
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip" + (removable ? "" : " locked");
    chip.dataset.mrm = removable ? m.id : "";
    chip.dataset.mwhy = removable ? "" : (gate.why || "used");
    const label = memberLabel(m, self);
    chip.textContent = removable ? `${label} ✕` : label;
    box.appendChild(chip);
  }
}

// A locked chip explains itself when tapped. The member editor already
// had the wording; the trip editor — where you first try to remove
// someone — silently did nothing.
// The wording comes from the same gate that blocked the removal, so what
// the chip says can never drift from why it is locked.
function explainLockedMember(why) {
  if (why === "self") return toast(removability({ id: "x" }, { selfId: "x" }).message);
  if (why === "owner") {
    return toast(removability({ id: "x", name: "They", uid: "o" },
      { selfId: null, ownerUid: "o" }).message);
  }
  toast(removability({ id: "x", name: "They" },
    { selfId: null, expenses: [{ id: "e", paidBy: "x", split: { parts: { x: 1 } } }], others: 1 }).message);
}

function addEditorMember() {
  const field = $("#editor-member-name");
  const plan = planAddMember(field.value, editorMembers, { signedIn: !!account });
  if (plan.do === "nothing") return;
  if (plan.do === "reject") { toast(plan.say); return; }
  if (plan.do === "invite") {
    plan.target.email = plan.email;   // already here by name: this is their invite
  } else {
    editorMembers.push(plan.member);
  }
  field.value = "";
  renderEditorMembers();
  field.focus();
  if (plan.say) toast(plan.say);
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
  let savedId = null;
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
    trip.members = mergeEditedMembers(editorOpenedWith, editorMembers, trip.members ?? []);

    savedId = editorId;
  } else {
    const trip = { id: crypto.randomUUID(), name, currencies: dedupe(editorPicked),
      members: editorMembers, createdAt: Date.now() };
    trips.push(trip);
    settings = store.setSettings({ activeTripId: trip.id });
    savedId = trip.id;
    // The conversion metric: did somebody who arrived through a shared
    // link go on to start a trip of their own? That number is the whole
    // growth argument, and it cannot be recovered later.
    count("trip_created", { byJoiner: !!settings.hasJoined });
  }
  saveTrips();
  $("#editor-sheet").close();
  renderTrips();
  // A new trip has no id until now, so anyone added with an address gets
  // their invitation here — not left as a field nobody acted on.
  const saved = trips.find((t) => t.id === savedId);
  if (saved) inviteEveryone(saved);
  // The other end of "nothing on a first-ever page view": this is the
  // moment a browser with nothing in it acquires something to lose, and
  // boot() has already been and gone.
  guardStorage();
}

// Everyone on this trip with an address who hasn't been invited yet.
// Idempotent: `invitedAt` records that the invitation actually went out,
// so re-saving a trip doesn't re-send, and a failed send is retried.
async function inviteEveryone(trip) {
  if (!account) return;
  const waiting = awaitingInvite(trip.members ?? []);
  if (!waiting.length) { syncNow({ silent: true }); return; }
  const ok = await syncNow({ silent: true });
  if (!ok) {
    toast("Saved. The invitations go out when you're back online.");
    return;
  }
  const sent = [];
  for (const m of waiting) {
    try {
      const { writeInvite } = await import("./firestore.js");
      const key = await emailKey(m.email);
      if (!key) continue;
      await writeInvite(key, trip.id,
        inviteEntry(trip, settings.profileName || account.email, stampNow()));
      m.invitedAt = stampNow();
      countInvite(m.id);
      sent.push(m.name);
    } catch { /* the trip document still carries the invite; the link works */ }
  }
  if (sent.length) {
    saveTrips();
    toast(sent.length === 1
      ? `${sent[0]} can now open “${trip.name}”`
      : `${sent.length} people can now open “${trip.name}”`);
  }
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

// Somebody took this account off a trip, so it goes — but as a trip we no
// longer HAVE, not as one we deleted. store.forgetTrip skips the tombstone
// that saveTrips would write; see the note there for what re-asserting one
// would do to everybody else's copy.
//
// The decision (was this really an eviction?) is evictionFrom in
// roster.js. This is only the io.
function applyEviction({ tripId, trips: remaining, notice }) {
  trips = remaining;
  const swept = expenses.filter((e) => e.tripId === tripId);
  expenses = expenses.filter((e) => e.tripId !== tripId);
  settlements = settlements.filter((p) => p.tripId !== tripId);
  store.forgetTrip(tripId);
  deleteAttachments(swept.filter((e) => e.attachment).map((e) => e.id)).catch(() => {});
  if (settings.pinnedTripId === tripId) settings = updateSettings({ pinnedTripId: null });
  if (settings.activeTripId === tripId) {
    settings = store.setSettings({ activeTripId: trips[0]?.id ?? null });
  }
  noteEvents([notice]);
  // Said out loud as well as filed. A trip disappearing from the list
  // with no explanation is the same silence this whole change is about.
  toast(notice.text);
}

// Can this account still READ the trip? The only evidence that separates
// "you were removed" from "the rules refused this write for some other
// reason" — and getting that wrong throws away a trip. A missing document
// or a lost connection both count as readable: neither proves anything,
// and the safe answer is to keep the trip and report the failure.
async function stillReadable(tripId) {
  try {
    const { fetchTripById } = await import("./firestore.js");
    await fetchTripById(tripId);
    return true;
  } catch (err) {
    return err?.code !== "permission-denied";
  }
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
    // Verification gates NOTHING in TripCash any more (ADR-0020). It
    // used to gate finding trips shared with you, and that stranded a
    // real user twice — silently, because a refused query says nothing
    // about why. Saying "verify to receive shared trips" would now be
    // false, and telling someone their blocker is optional is worse
    // than saying nothing.
    if (unverified && !note) {
      note = "Verify your email if you'd like to be able to reset your password. Sharing works either way.";
    }
  }
  renderProfileButton();
  renderProfileHead();
  const noteEl = $("#sync-note");
  noteEl.hidden = !note;
  noteEl.textContent = note;
  noteEl.classList.toggle("bad", bad);
}

// Firebase rate-limits verification mail hard, and tapping repeatedly is
// the natural response to an email that hasn't arrived yet — which is
// exactly what gets you blocked. So the cooldown IS the feature, and it
// lives here rather than inside one button's handler: the invitation
// screen offers Resend too (the cold-open failure table), and a second
// copy would be a second cooldown that knows nothing about the first.
// Returns what to say; the caller decides where — Settings paints a note,
// the cold open a toast, because its sheet is closed.
let verifyReadyAt = 0;
async function resendVerification() {
  if (Date.now() < verifyReadyAt) {
    return { note: "Already sent. Check your spam folder — it can take a few minutes." };
  }
  const { sendVerification, authErrorMessage } = await import("./firebase.js");
  try {
    await sendVerification();
    verifyReadyAt = Date.now() + 60_000;
    return { note: `Sent to ${account?.email}. Check spam if it's not there in a minute.` };
  } catch (err) {
    verifyReadyAt = Date.now() + 60_000;
    return {
      note: err?.code === "auth/too-many-requests"
        ? "Too many attempts — Firebase has paused these for a bit. The email may already be in your spam folder. You don't need it to open a trip someone sent you a link to."
        : authErrorMessage(err?.code),
      bad: true,
    };
  }
}

const syncBusy = (on) => document.querySelector(".sync-card").classList.toggle("busy", on);

// "It said nothing and stayed signed out" is the worst possible outcome —
// it happened once (v1.24, no listener attached) and must never be silent
// again. If a sign-in reports success but leaves no session, say so.
function reportIncompleteSignIn(ok, user) {
  if (ok && !user) {
    renderAccount({ note: "Sign-in didn't complete. Try again, or check your connection.", bad: true });
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

// The link carries its own invitation, in the fragment (js/invitelink.js).
// The recipient cannot read the trip — the rules require a signed-in,
// invited caller — so if the link does not say what it is, the first
// screen they see cannot either. A fragment is never sent to a server,
// so this leaks nothing to any log between the two phones.
//
// A NAME, never the sender's address: the fragment is shown to somebody
// who is not signed in, and the address is neither needed nor theirs.
const inviteLink = (tripId) => {
  const trip = trips.find((t) => t.id === tripId);
  const preview = encodePreview({
    name: trip?.name,
    by: settings.profileName || account?.displayName || "",
    members: trip?.members?.length,
    currencies: trip?.currencies,
  });
  return `${location.origin}${location.pathname}?join=${encodeURIComponent(tripId ?? "")}#p=${preview}`;
};

// Written per-recipient: naming the wrong person's address is worse than
// no message at all, and how they sign in is their business — the only
// thing that matters is WHICH address.
const inviteMessage = (email, tripId) => {
  const trip = trips.find((t) => t.id === tripId);
  return `I've added you to "${trip?.name}" on TripCash — we each log what we spend ` +
    `and it works out who owes whom at the end.\n\n` +
    `Sign in with ${email} and the trip will be there:\n${inviteLink(tripId)}`;
};

// Hand a message to whatever this device can send it with. Used by the
// invite, and by the joiner asking to be added under the address they
// actually signed in as — same journey, opposite direction.
async function shareText(text) {
  if (navigator.share) {
    try {
      await navigator.share({ title: "TripCash", text });
    } catch { /* dismissed — not an error */ }
    return;
  }
  // No share sheet (desktop): WhatsApp Web is the next best thing.
  window.open(`https://wa.me/?text=${encodeURIComponent(text)}`, "_blank", "noopener");
}

async function shareInviteTo(email, tripId, phone, memberId) {
  // Counted here, at the moment the message is handed over, rather than
  // after: a share sheet reports nothing about whether it was used, and
  // the other two paths count what was ATTEMPTED too.
  countInvite(memberId);
  const text = inviteMessage(email, tripId ?? shareTripId);
  // Straight to their chat when we know the number — no contact picker,
  // no choosing the wrong Rahul.
  const number = whatsappNumber(phone);
  if (number) {
    window.open(`https://wa.me/${number}?text=${encodeURIComponent(text)}`, "_blank", "noopener");
    return;
  }
  await shareText(text);
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
  // The decision lives in js/absorb.js, pure and tested. This is only
  // the io: apply what it decided, in the order it returned.
  const out = absorbPayload({
    merged, tripId, trips, expenses, settlements,
    tombstones: store.getTombstones(),
    account,
    money: (e) => (Number.isFinite(e.amount) && e.code
      ? `${formatAmount(e.amount, e.code, localeFor(e.code))} ${e.code}` : ""),
    buildPayload, mergePayload, applyPayload,
  });
  if (out.deleted) return { deleted: true };

  trips = out.trips;
  expenses = out.expenses;
  settlements = out.settlements;
  store.setTombstones(out.tombstones); // BEFORE the saves, not after
  saveTrips();
  saveExpenses();
  saveSettlements();

  if (out.orphanedReceipts.length) deleteAttachments(out.orphanedReceipts).catch(() => {});
  noteEvents(out.notices);
  if (out.arrival?.name) absorbArrivals.push(out.arrival);
  return { deleted: false, reconciled: out.reconciled };
}

// Trips discovered by the sync currently running, announced once it
// finishes. Collected here because absorbInto is called from two places.
let absorbArrivals = [];

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
// the project's internal notes), so every avatar layer goes through it.
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
  // NEWER, not merely different. This is a live snapshot, and it used to
  // be applied on difference alone — so a phone running a routine sync
  // could push its older copy, and the laptop's listener would revert
  // the change its user had just made AND knock its stamp down to the
  // older value, so the laptop's own push had nothing left to win with.
  // The change was gone permanently. Exactly ADR-0015's lesson, in the
  // one path the ADR never touched.
  const mine = { ...before, updatedAt: settings.prefsUpdatedAt ?? 0 };
  if (mergePrefs(mine, prefs) !== prefs) return;
  settings = store.setSettings({ ...pickSynced(prefs), prefsUpdatedAt: prefs.updatedAt });
  $("#markup-toggle").checked = !!settings.markupOn;
  $("#markup-pct").value = localizeNumber(settings.markupPct, DEVICE_LOCALE);
  syncMarkupRow();
  renderTrips();
}

// Learn this device's clock offset from the server stamp it wrote, and
// record that it has been learnt. Without it, a device running fast
// overwrites changes it never saw, purely because its stamps are inflated
// (ADR-0014).
//
// `clockKnown` is the point of the flag: an offset of 0 means "this
// device agrees with the server", and it used to be indistinguishable
// from "never asked". Only one of those is safe to stamp on.
function applyClockOffset(clocks) {
  const plan = clockPlan(clocks, deviceId());
  if (plan.do !== "use") return false;
  if (plan.offset !== (settings.clockOffset ?? 0) || !settings.clockKnown) {
    settings = store.setSettings({ clockOffset: plan.offset, clockKnown: true }); // never synced
  }
  return true;
}

// Called BEFORE the first push of a sync, not after it.
//
// Nothing this device writes is comparable with anything another device
// wrote until the offset is known, so on a device that has never asked,
// finding out comes first: write a probe, read it straight back, apply
// it. It costs one extra read and one extra write, once per device for
// as long as that device exists. Every later sync short-circuits on the
// first line.
async function ensureClockOffset() {
  if (!account || settings.clockKnown) return;
  const { fetchPrefs, savePrefs } = await import("./firestore.js");
  const remote = await fetchPrefs(account.uid);
  if (applyClockOffset(remote?.clocks)) return;
  await savePrefs(account.uid, pickSynced(settings), {
    deviceId: deviceId(), clocks: remote?.clocks, email: normEmail(account.email),
  });
  // setDoc resolves once the server has acknowledged, so serverTimestamp()
  // is a real number by the time this read lands.
  applyClockOffset((await fetchPrefs(account.uid))?.clocks);
}

async function syncPrefs() {
  if (!account) return;
  const { fetchPrefs, savePrefs } = await import("./firestore.js");
  const local = { ...pickSynced(settings), updatedAt: settings.prefsUpdatedAt ?? 0 };
  const remote = await fetchPrefs(account.uid);

  const knewOffset = applyClockOffset(remote?.clocks);

  const winner = mergePrefs(local, remote);
  if (winner === remote) applyPrefs(remote);
  // Write when the preferences changed OR when this device has no clock
  // probe yet — otherwise the offset is never learnt at all, which is
  // exactly how the first attempt at this ended up doing nothing.
  const needsProbe = !knewOffset;
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

// ----- notifications you can always reach (phase D5) -----
//
// Push is the unreliable half: iOS delivers it only to an installed PWA,
// permission can be declined, and a phone can be offline all day. This
// list is the reliable half — filled in on every sync from data the
// device already has, so "did someone add me to a trip?" is answerable
// by opening the app.

let notices = store.getNotices();

function saveNotices(next) {
  notices = next;
  store.setNotices(notices);
  renderBell();
}

function noteEvents(events) {
  if (!events.length) return;
  saveNotices(addNotices(notices, events));
}

function renderBell() {
  const bell = $("#bell-btn");
  const count = unreadCount(notices);
  setHidden(bell, false);
  const badge = $("#bell-count");
  badge.textContent = count > 9 ? "9+" : String(count);
  setHidden(badge, count === 0);
  bell.setAttribute("aria-label", count ? `Notifications — ${count} unread` : "Notifications");
}

function openNotices() {
  const body = $("#notices-body");
  const ICON = { trip: "🧳", expense: "💸", payment: "🤝", member: "👋", verify: "✉️",
    join: "🧳", push: "🔔" };
  body.innerHTML = notices.length
    ? notices.map((n) => `
        <button class="notice${n.read ? "" : " unread"}" data-notice="${escapeHtml(noticeKey(n))}"
          data-target="${escapeHtml(n.tripId)}">
          <span class="n-icon" aria-hidden="true">${ICON[n.kind] ?? "🔔"}</span>
          <span class="n-body">
            <span class="n-text">${escapeHtml(n.text)}</span>
            <span class="n-when">${dayTimeLabel(n.at)}</span>
          </span>
        </button>`).join("")
    : `<p class="hint">Nothing yet. When someone adds you to a trip, logs an
       expense or records a payment, it appears here — whether or not
       notifications are switched on.</p>`;
  $("#notices-sheet").showModal();
  // Opening the list IS reading it.
  if (unreadCount(notices)) setTimeout(() => saveNotices(markAllRead(notices)), 1200);
}

// ----- staying up to date -----
//
// An installed PWA on iOS has no address bar, no reload gesture, and is
// suspended rather than killed — so it can sit on an old build
// indefinitely with no way for the user to do anything about it. That
// is not a nice-to-have: it stranded a real device on a build without
// the fix it needed.
async function checkForUpdate({ manual = false } = {}) {
  const note = $("#update-note");
  if (manual) note.textContent = "Checking…";
  try {
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.update();
    // Ask the network directly rather than trusting the worker to have
    // noticed: `no-store` bypasses both the HTTP cache and the SW.
    const res = await fetch(`./js/app.js?v=${Date.now()}`, { cache: "no-store" });
    const latest = (await res.text()).match(/APP_VERSION = "([^"]+)"/)?.[1];
    if (latest && latest !== APP_VERSION) {
      note.textContent = `${APP_VERSION} — ${latest} available`;
      toast(`Update available (${latest})`, { actionLabel: "Reload", onAction: applyUpdate });
      return true;
    }
    note.textContent = `${APP_VERSION} — up to date`;
  } catch {
    note.textContent = `${APP_VERSION} — couldn't check`;
  }
  return false;
}

// Belt and braces: drop the caches and the worker, then reload. Gentler
// approaches leave an iOS PWA on the old build often enough to be worth
// skipping straight to this.
async function applyUpdate() {
  try {
    for (const k of await caches.keys()) await caches.delete(k);
    const reg = await navigator.serviceWorker?.getRegistration();
    await reg?.unregister();
  } catch { /* reload anyway — it can only help */ }
  location.replace(`./?u=${Date.now()}`);
}

// A stable id for THIS device, so its clock probe is its own. Local only.
function deviceId() {
  if (!settings.deviceId) settings = store.setSettings({ deviceId: crypto.randomUUID() });
  return settings.deviceId;
}

// ----- counting seven things (docs/design/INSTRUMENTATION.md) -----
//
// Every decision worth arguing about is in js/analytics.js, where it can
// be tested; this is the send, and the send is deliberately dull.
//
// Two properties this must never lose. It is a plain POST to a Cloud
// Function, NOT the Firebase SDK — a signed-out user still makes zero
// Firebase requests, which is the invariant the whole cold-open depends
// on. And it can never break the app: counting an expense is not worth
// failing to save one, so the whole thing sits inside a try and the
// caller never learns whether anything was sent.
const BEACON_URL = "https://asia-south1-tripcash-7188d.cloudfunctions.net/beacon";

function count(event, extra) {
  try {
    // Asked once, on first use, from the timezone — never a popup, and
    // nothing about the app changes either way.
    if (settings.analyticsOptIn === undefined) {
      settings = store.setSettings({ analyticsOptIn: defaultOptIn() });
    }
    const sent = settings.beaconsSent ?? {};
    if (!shouldSend(event, { optedIn: settings.analyticsOptIn, sent })) return;
    const body = beaconFor(event, { deviceId: deviceId(), version: APP_VERSION, extra });
    if (!body) return;

    const json = JSON.stringify(body);
    // sendBeacon survives the page being closed mid-flight, which is
    // exactly when `link_opened` fires. It refuses bodies over ~64 KB;
    // these are ~80 bytes, and fetch covers the browsers without it.
    const blob = new Blob([json], { type: "application/json" });
    if (!navigator.sendBeacon?.(BEACON_URL, blob)) {
      fetch(BEACON_URL, {
        method: "POST", body: json, keepalive: true,
        headers: { "content-type": "application/json" },
      }).catch(() => {});
    }
    if (event === "first_expense") {
      settings = store.setSettings({ beaconsSent: { ...sent, first_expense: true } });
    }
  } catch {
    // Never surfaced, never retried. A metric is not worth a toast.
  }
}

// The first term of k, counted once per person invited from this device.
//
// Three paths put an invitation in front of somebody — inviteEveryone,
// sendInvite and shareInviteTo — and one member can travel more than one
// of them. Both the decision and the list live in js/analytics.js; this
// is only the read and the write, which is the whole point: the last
// time a rule about invitations was written at the call site it reached
// one of two paths and nothing noticed for ten releases.
//
// Nothing here touches `invitedAt`. That field means the invitation
// actually went out and is what awaitingInvite reads to decide who still
// needs one; setting it from a counter would replace an invitation with
// the record of having counted it.
function countInvite(memberId) {
  const counted = settings.invitesCounted ?? [];
  if (!countsInvite(counted, memberId)) return;
  settings = store.setSettings({ invitesCounted: rememberInvite(counted, memberId) });
  count("invite_sent");
}

// Your name and number belong to you, so YOUR device is what writes them
// into your member row — on every trip you're part of. Whoever added you
// only ever typed a placeholder so they could send the invite.
function pushProfileToTrips(skip = new Set()) {
  if (!account?.uid) return;
  // `?? ""` here meant "I have never opened Settings" was sent as "I
  // deliberately cleared my number" — so signing in destroyed the phone
  // number whoever invited you had typed, on every trip, on everyone's
  // device, and canEditDetails then forbade putting it back. An absent
  // field must stay absent; only a real empty string clears.
  const profile = { name: settings.profileName };
  if (settings.profilePhone !== undefined) profile.phone = settings.profilePhone;
  let touched = false;
  trips = trips.map((t) => {
    // A trip whose sync just failed holds PRE-merge content. Restamping
    // it here would hand that stale copy a fresh stamp, so it wins the
    // next merge and erases whatever the other device changed —
    // ADR-0014's invariant, from a path the ADR didn't cover.
    if (skip.has(t.id)) return t;
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
    // Before anything is stamped and pushed. On every sync but this
    // device's first, it returns without touching the network.
    await ensureClockOffset().catch(() => {});
    const { buildPayload, mergePayload, applyPayload } = await import("./sync.js");
    const { syncTrip, fetchMyTrips } = await import("./firestore.js");
    let trouble = null; // first per-trip failure, reported at the end
    const unsynced = new Set(); // trips whose push failed: content is pre-merge

    absorbArrivals = [];
    // Writing what we just pulled must not schedule a push back — the
    // saves inside absorbInto each call scheduleSync(), so without this
    // EVERY sync armed the next one and the app synced every 1.2s
    // forever, burning the free-tier read quota from an idle tab.
    // absorbRemote has always guarded this; this copy never did.
    const absorb = (merged, tripId) => {
      const wasSuppressed = suppressPush;
      suppressPush = true;
      try {
        absorbOne(merged, tripId);
      } finally {
        suppressPush = wasSuppressed;
      }
    };
    const absorbOne = (merged, tripId) => {
      if (merged?.deleted) { purgeTripLocally(tripId); return; }
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
        // the next trip's upload should already carry. The whole map goes
        // in and buildPayload takes this trip's share of it — passing all
        // of them used to mean every document carried every other trip's
        // deletions until it hit Firestore's 1 MB ceiling.
        tombstones: store.getTombstones(),
        uid: account.uid,
        }));
      } catch (err) {
        // A refusal on ONE trip can mean we were removed from it. That
        // used to surface as "the database turned this down — its access
        // rules may not be set up yet", on every sync, for ever, next to
        // a trip the app still let you add expenses to.
        //
        // The read is what tells the two apart, and it is worth the round
        // trip: the alternative reading of a refused write is "the rules
        // are older than this client", which is the normal state until
        // firestore.rules is published — and in that state the failing
        // device is the one doing the REMOVING.
        const out = evictionFrom({
          code: err?.code, tripId: trip.id, trips,
          stillReadable: err?.code === "permission-denied"
            ? await stillReadable(trip.id) : true,
        });
        if (out.evicted) { applyEviction(out); continue; }
        // One trip that can't sync must not stop every other trip — and
        // must not stop the PULL below, or a trip made on the other
        // device would never arrive here.
        trouble ??= err;
        unsynced.add(trip.id);
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
    // ----- trips waiting for you (ADR-0020) -----
    //
    // ONE join path, used by both the invite index and an invite link.
    // There used to be two, which is how they came to differ: the query
    // path demanded a verified address and the link path didn't, and
    // nothing said so.
    let inviteNote = "";
    let needsVerify = false;
    // The trip a join reached through an invite LINK, so the arrival can
    // be OPENED rather than announced. The cold-open rule: "The trip must be
    // the next thing they see."
    let openedFromLink = null;

    // Every judgement about what an attempt means lives in js/joining.js.
    // It used to live here, in two branches that disagreed — which is
    // how a join against a DELETED trip came to report success and fire
    // count("joined"), and how an invitation that could never succeed
    // came to be retried on every sync for ninety days.
    const joinTrip = async (id) => {
      const { fetchTripById } = await import("./firestore.js");
      const { joinIfInvited } = await import("./sync.js");

      let payload = null;
      let outcome;
      try {
        payload = await fetchTripById(id);          // a single-doc get
        outcome = joinOutcome({ payload, account });
      } catch (err) {
        console.warn("[tripcash] invite read refused", id, err?.code ?? err);
        outcome = joinOutcome({ error: err, account, stage: "read" });
      }

      // The ID token caches email_verified for up to an hour, so re-mint
      // it before concluding anything: verifying in your mail app's
      // browser changes the account instantly and this token not at all.
      if (outcome.do === "verify") {
        try {
          const { refreshVerification } = await import("./firebase.js");
          const fresh = await refreshVerification();
          if (fresh) {
            account = fresh;
            renderAccount();
            outcome = joinOutcome({ payload, account });
          }
        } catch (err) {
          console.warn("[tripcash] couldn't re-check verification", id, err?.code ?? err);
        }
      }
      if (outcome.do === "verify") needsVerify = true;
      if (outcome.do !== "join") return outcome;

      try {
        // `writer` names us explicitly: a join must not restamp lastEditBy
        // (firestore.rules refuses that), so nothing else on the payload
        // says who is writing — and the access list is derived now, so an
        // unnamed joiner is derived straight back out.
        absorb(await syncTrip(id, joinIfInvited(payload, account), { writer: account.uid }), id);

        // Claim our member row IMMEDIATELY, in its own write, rather than
        // waiting for the next sync's push loop to do it. Joining puts our
        // uid on the document but not on any member row, and every other
        // device derives the access list from the member rows — so until
        // this lands, the next push from anyone else drops us again.
        const fresh = trips.find((t) => t.id === id);
        if (fresh) {
          const linked = linkAccount(ensureMembers(fresh), account, {
            isOwner: !fresh.ownerUid || fresh.ownerUid === account.uid,
          });
          if (linked !== fresh.members) {
            fresh.members = linked;
            saveTrips();
            absorb(await syncTrip(id, buildPayload({
              trip: fresh,
              expenses: expenses.filter((e) => e.tripId === id),
              settlements: settlements.filter((s) => s.tripId === id),
              tombstones: store.getTombstones(),
              uid: account.uid,
            })), id);
          }
        }
      } catch (err) {
        // Reaching the write means the READ succeeded, so we are on this
        // document. A refusal here is the rules being older than this
        // client, not the person being signed in as somebody else — so
        // it keeps the invitation and says something that stays true.
        console.warn("[tripcash] join write refused", id, err?.code ?? err);
        return joinOutcome({ error: err, account, stage: "write" });
      }

      // The write can succeed and still leave nothing here: a tombstone
      // absorbs to nothing, and a merge we lose changes nothing. Counting
      // a join with no trip behind it is exactly what poisoned `joined`,
      // the acceptance number this whole path is measured by — so the
      // count sits BEHIND the trip actually being in hand, and the
      // failure returns before it.
      if (!trips.some((t) => t.id === id)) {
        console.warn("[tripcash] join left no trip", id);
        return { do: "gone", clearPending: true, say: GONE };
      }
      // `hasJoined` is what makes a later trip_created countable as a
      // conversion, so it is recorded here rather than inferred.
      if (!settings.hasJoined) settings = store.setSettings({ hasJoined: true });
      count("joined");
      return outcome;
    };

    // Discovery: one read of a document addressed by the hash of our own
    // address. No query, no filter for the rules to prove, no
    // verification — and therefore no way for it to be refused for a
    // reason we can't report.
    const myKey = await emailKey(account.email);
    if (myKey) {
      try {
        const { fetchInvites, dropInvites } = await import("./firestore.js");
        const index = await fetchInvites(myKey);
        const dead = [];
        for (const invite of pendingInvites(index, trips.map((t) => t.id))) {
          try {
            const outcome = await joinTrip(invite.tripId);
            // `clearPending` is the module saying this attempt can never
            // succeed. Anything else — not yet verified, offline — keeps
            // its entry, because those can still come good.
            if (outcome.clearPending) dead.push(invite.tripId);
            if (outcome.do !== "join") {
              console.warn("[tripcash] invitation not joined", invite.tripId, outcome.do);
            }
          } catch (err) {
            // One bad invite must not stop the others, and must not be
            // silent either.
            console.warn("[tripcash] invite failed", invite.tripId, err?.code ?? err);
          }
        }
        // Trips we now hold, PLUS ones we tried and can't have — a
        // deleted trip never enters `trips`, so its entry was re-fetched
        // on every sync for ninety days.
        const spent = [...spentInvites(index, trips.map((t) => t.id)), ...dead];
        if (spent.length) {
          await dropInvites(myKey, spent).catch((err) => {
            // This was `.catch(() => {})`, and the rules refused every
            // one of these writes — silently — for as long as they have
            // existed, which is the other half of the ninety-day retry.
            // See tests-integration/invites-rules.test.mjs.
            console.warn("[tripcash] couldn't clear spent invitations", err?.code ?? err);
          });
        }
      } catch (err) {
        inviteNote = err?.code === "permission-denied"
          ? " Couldn't check for shared trips — the database refused it."
          : " Couldn't check for shared trips this time.";
      }
    }

    // An invite LINK: same join, reached by id instead of the index.
    const pending = settings.pendingJoin;
    if (pending && !trips.some((t) => t.id === pending)) {
      let outcome;
      try {
        outcome = await joinTrip(pending);
      } catch (err) {
        console.warn("[tripcash] join failed", pending, err?.code ?? err);
        outcome = joinOutcome({ error: err, account, stage: "write" });
      }
      // Said once, and then stopped. The old code set a hint line and
      // left pendingJoin alone, so a link sent to somebody else's address
      // was re-fetched and re-refused on every single sync, for ever.
      if (outcome.clearPending) settings = store.setSettings({ pendingJoin: null });
      if (outcome.do === "join") {
        // The cold-open rule: "The trip must be the next thing they see." Not
        // the home screen with the trip somewhere in it, and not a toast
        // offering to take them there.
        settings = store.setSettings({ activeTripId: pending });
        openedFromLink = pending;
        joinProblem = null;
      } else {
        // Three surfaces, because each covers the others' gap. The
        // invitation screen is what this person is looking at
        // (renderInvitation paints joinProblem, with the next step from
        // the same module). The toast reaches them if they took the
        // "Have a look around" detour while this was in flight — and it
        // is the only thing that contradicts the "Opening the trip
        // shared with you…" toast boot() fires at 900ms. The notice is
        // the one that survives a reload.
        //
        // Settings keeps the sentence too (inviteNote), but it is no
        // longer the ONLY place it appears: that sheet is closed, and
        // nothing on this path opens it.
        joinProblem = outcome;
        inviteNote = ` ${outcome.say}`;
        toast(outcome.say);
        // ACCOUNT_SCOPE, not the trip: this sync ends with
        // pruneNotices(notices, trips.map(t => t.id)), and a notice about
        // a trip that never arrived would be deleted a few lines after
        // being written.
        noteEvents([{
          kind: "join", tripId: ACCOUNT_SCOPE, ref: pending, text: outcome.say,
        }]);
      }
    } else if (pending) {
      // Already here — it arrived through the ordinary pull. The link
      // still has to land ON the trip, so open it and then forget it.
      settings = store.setSettings({ pendingJoin: null, activeTripId: pending });
      openedFromLink = pending;
      joinProblem = null;
    }

    // The one remaining verification gate, said out loud — in a notice
    // that survives, not a hint line that scrolls away. The sentence is
    // the module's, so Settings and the invite link cannot say two
    // different things about the same state.
    if (needsVerify) {
      inviteNote = ` ${NOT_VERIFIED}`;
      noteEvents([{
        kind: "verify", tripId: ACCOUNT_SCOPE, ref: account.uid,
        text: "Verify your email to open the trip shared with you",
      }]);
    }

    await syncPrefs().catch(() => {}); // preferences are a bonus, never fatal
    // Now — and only now — every trip this account can see is in hand, so
    // a pin with no trip behind it really is stale rather than early.
    saveNotices(pruneNotices(notices, trips.map((t) => t.id)));
    const kept = prunePrefs(pickSynced(settings), trips.map((t) => t.id));
    if (kept.pinnedTripId !== settings.pinnedTripId) settings = updateSettings(kept);
    pushProfileToTrips(unsynced);
    await uploadPendingReceipts(); // receipts saved offline catch up here
    settings = store.setSettings({ lastSyncAt: Date.now() });
    renderTrips();
    // The card is expanded by settings.activeTripId, set above, so this
    // only has to put it where the eye is.
    if (openedFromLink) {
      document.querySelector(`.trip-card[data-trip="${CSS.escape(openedFromLink)}"]`)
        ?.scrollIntoView({ block: "center", behavior: "smooth" });
    }
    const arrivals = absorbArrivals;
    noteEvents(arrivals.map((t) => ({
      kind: "trip", tripId: t.id, tripName: t.name, ref: "added",
      text: `You were added to ${t.name}`,
    })));
    if (arrivals.length === 1) {
      const [trip] = arrivals;
      // If they came in on an invite link the trip is already open in
      // front of them, so an "Open" button that does nothing is worse
      // than no button at all.
      toast(`You were added to “${trip.name}”`, trip.id === openedFromLink ? {} : {
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

// Wait until the answer to "is this device signed in?" exists.
//
// `account` is written only by onAccountChange, which runs from the auth
// listener — and the listener cannot run until js/firebase.js has been
// dynamically imported and Firebase has restored the session, several
// turns after boot() starts. boot() used to fire connectAuth() without
// awaiting it and then read `account` a microtask later, so every launch
// decided "signed out": a person who WAS signed in got the sentence that
// says their trips have no cloud copy, and the stamp beside it bought
// seven days of silence for the sentence that was true.
//
// Two things this deliberately does not do. It does not decide from
// `settings.syncHint` — that means "this device wants to sync", which is
// also what an expired session looks like, and an expired session has no
// fresh cloud copy. And it does not trust the listener to have fired:
// js/firebase.js registers it and then awaits getRedirectResult, and
// nothing promises an ordering between the two. v1.24 already cost this
// project one sign-in that succeeded while the UI never heard, so the
// settled session is READ BACK, through the single writer.
//
// This is also the one place that holds "only a device that wants a
// session goes looking for one" — a signed-out visitor must never fetch
// the Firebase SDK just to be told about Safari's timer.
async function authSettled() {
  if (!settings.syncHint) return;
  try {
    await connectAuth();
    if (account) return;
    const { currentUser } = await import("./firebase.js");
    const user = await currentUser();
    if (user) onAccountChange(user);
  } catch {
    // Offline, or the CDN is unreachable. `account` then holds whatever
    // the listener managed to say, which is the most that can be known.
  }
}

// ---------- install ----------

// Chrome only shows its own install banner after repeated visits, so catch
// the event and offer an explicit button instead.
//
// WHAT to say is js/install.js's decision, not this file's — the words
// were previously hard-coded in index.html for a browser we could not
// know somebody was running. Everything below reads state and paints;
// the two judgements (what this phone can do, and whether now is a
// moment worth asking at) are both calls into the module.
let installPrompt = null;
// Set by the `appinstalled` event and never cleared. This tab installed
// the app and carries on in the browser, so its display mode stays
// "browser" and the event is the only evidence it will ever hold; see
// isAppInstalled(). Session-scoped on purpose — an app can be
// uninstalled, and a remembered flag would silence the offer for good.
let installedThisSession = false;
const isInstalled = () => isAppInstalled({
  displayModeStandalone: window.matchMedia("(display-mode: standalone)").matches,
  iosStandalone: navigator.standalone === true,
  installedThisSession,
});

const advice = () => installAdvice({
  ua: navigator.userAgent,
  hasPrompt: !!installPrompt,
  installed: isInstalled(),
  // An iPad in Safari's default desktop mode sends a Mac's user agent.
  // This is the only thing that tells them apart, and getting it wrong
  // sends one of them to a menu it does not have.
  touchPoints: navigator.maxTouchPoints ?? 0,
});

// One offer per moment per session. `recompute()` runs on every
// keystroke, so without this the banner would reappear the instant it
// was dismissed. The guard lives HERE and not at the call sites, so a
// third moment cannot be added without inheriting it.
const offeredThisSession = new Set();
// A moment can arrive while a sheet is open — settle-up IS inside one —
// and a fixed banner under a modal backdrop is invisible and untappable.
// So the offer waits, and "offered" below means SHOWN, never merely
// decided: an offer nobody could see must not spend the one chance this
// session had.
let nudgePending = null;
let nudgeTimer = null;

function offerInstall(moment) {
  if (offeredThisSession.has(moment) || nudgePending?.moment === moment) return;
  const { how, say } = advice();
  if (!shouldOfferInstall({
    moment,
    installed: isInstalled(),
    how,
    dismissedAt: settings.installDismissedAt ?? null,
    now: Date.now(),
  })) return;
  nudgePending = { moment, say, how };
  queueInstallNudge();
}

// Never paint inside the caller's own turn, and never trust one reading
// of the DOM. renderSummaryBody() runs a line BEFORE the summary sheet's
// showModal(), so a synchronous paint read "no dialog open", drew the
// banner, and the modal covered it a moment later. A single deferred
// check is not enough either: it just moves the guess. So the paint
// retries until it can actually happen, which depends on a timer and
// nothing else — no event we would have to be sure reaches us.
// (Found by driving the real app. No unit test was going to see it.)
const NUDGE_RETRY_MS = 400;
function queueInstallNudge() {
  clearTimeout(nudgeTimer);
  nudgeTimer = setTimeout(showInstallNudge, NUDGE_RETRY_MS);
}

function showInstallNudge() {
  if (!nudgePending) return;
  if (document.querySelector("dialog[open]")) return queueInstallNudge();
  const { moment, say, how } = nudgePending;
  nudgePending = null;
  offeredThisSession.add(moment); // consumed only now that it is on screen
  $("#install-nudge-say").textContent = say;
  // There is only a button where we hold an event to fire. On iOS and on
  // a Chromium browser that hasn't offered one yet, a button would have
  // to lie about what tapping it does.
  $("#install-nudge-go").hidden = how !== "prompt";
  $("#install-nudge").hidden = false;
}

function hideInstallNudge() {
  clearTimeout(nudgeTimer);
  nudgePending = null;
  $("#install-nudge").hidden = true;
}

// "Not now" is remembered for a week (js/install.js), and DEVICE-LOCAL
// on purpose: see the note beside SYNCED_SETTINGS in js/prefs.js.
function dismissInstallNudge() {
  settings = store.setSettings({ installDismissedAt: Date.now() });
  hideInstallNudge();
}

// Fire the saved event, once. It is single-use — calling prompt() on a
// consumed event throws — so every path that fires it clears it first.
async function firePrompt() {
  if (!installPrompt) return null;
  const e = installPrompt;
  installPrompt = null;
  e.prompt();
  const { outcome } = await e.userChoice;
  return outcome;
}

function wireInstall() {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    installPrompt = e;
    $("#install-row").hidden = false;
    $("#install-hint").hidden = true;
  });
  window.addEventListener("appinstalled", () => {
    // Remember it, don't just react to it: this is the only moment this
    // tab is ever told, and every later question about being installed
    // is answered from here.
    installedThisSession = true;
    installPrompt = null;
    $("#install-row").hidden = true;
    hideInstallNudge();
    toast("TripCash installed");
  });
  $("#install-btn").addEventListener("click", async () => {
    if (!installPrompt) return;
    const outcome = await firePrompt();
    $("#install-row").hidden = true;
    if (outcome !== "accepted") paintInstallHint();
  });
  $("#install-nudge-go").addEventListener("click", async () => {
    const outcome = await firePrompt();
    $("#install-row").hidden = true;
    // Declining the OS dialog is not "not now" — it is a different
    // question, and it must not buy a week of silence it wasn't asked
    // for. The banner goes either way; the stamp only on "Not now".
    hideInstallNudge();
    if (outcome === "accepted") toast("TripCash installed");
  });
  $("#install-nudge-no").addEventListener("click", dismissInstallNudge);
}

// The Settings fallback line: whatever this phone's actual route is,
// or nothing at all when there's a button or it's already installed.
function paintInstallHint() {
  const { how, say } = advice();
  $("#install-hint").textContent = say;
  $("#install-hint").hidden = how === "prompt" || how === "none";
}

// ---------- the seven-day timer (js/persist.js) ----------
//
// WebKit deletes all script-writable storage — localStorage, IndexedDB,
// the service worker registration — after seven days with no interaction
// with the origin, unless the app is installed to the home screen. This
// app works signed out and offline, so for a lot of people the only copy
// of their trip is the one Safari is about to delete.
//
// Everything below is a READING; js/persist.js does the deciding. In
// particular it, and not this file, holds the rule that being signed in
// is a RECOVERY and not a prevention — the local copy still goes, and a
// signed-in person opening the app offline after the timer fires sees an
// empty app. Softening that here would be the same "correct fix in one
// call site" shape that has produced nearly every bug this project has
// shipped.
async function guardStorage() {
  // Being signed in is one of the three readings js/persist.js weighs,
  // and at launch it is the one that is not ready yet. Ask before
  // reading it, never after — see authSettled().
  await authSettled();
  const hasData = trips.length > 0 || expenses.length > 0;
  const supported = typeof navigator.storage?.persist === "function";
  let persisted = false;
  try {
    persisted = (await navigator.storage?.persisted?.()) === true;
    if (shouldAskToPersist({ persisted, supported, hasData })) {
      persisted = (await navigator.storage.persist()) === true;
    }
  } catch {
    // A browser that refuses to answer is read as unprotected, which is
    // the reading that warns rather than the one that stays quiet. There
    // is nothing to tell the user here: the warning below IS the telling.
    persisted = false;
  }
  const installed = isInstalled();
  const risk = storageRisk({
    engine: engineOf(navigator.userAgent),
    installed,
    signedIn: !!account,
    persisted,
    hasData,
    // How THIS device installs, from the module that owns that question.
    // Passed in rather than concatenated afterwards: persist.js builds one
    // sentence around it, so appending a second copy read as an app
    // repeating itself.
    installSay: advice().say,
  });
  if (!shouldWarn(risk, {
    toldAt: settings.storageToldAt ?? 0,
    // The cold open is already answering the question the visitor
    // arrived with. Device-local, like installDismissedAt: dismissing
    // this on a laptop must not silence the phone that is at risk.
    busy: coldOpen() !== "home",
  })) return;
  // One sentence, from the module that owns each half: what is at stake
  // from js/persist.js, and how this particular device installs from
  // js/install.js, which persist.js was handed above. Typing either one
  // here is how #install-hint and js/push.js drifted apart.
  toast(risk.advice);
  settings = store.setSettings({ storageToldAt: Date.now() });
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
  // The switch must show the state that is actually in force. Left in
  // applyPrefs it only ran when signed in, so a signed-out visitor saw
  // an unchecked box while counting was on — the one place this feature
  // cannot afford to be wrong.
  $("#analytics-toggle").checked = settings.analyticsOptIn ?? defaultOptIn();
  $("#install-row").hidden = !installPrompt;
  paintInstallHint();
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
      <button class="m-open" data-medit="${escapeHtml(m.id)}">
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
  // Signed out, the trip has never been uploaded, so the join link in
  // that message resolves to nothing — and the message goes into
  // somebody else's WhatsApp saying it will work.
  $("#mx-send").hidden = (!m.email && !m.phone) || !!m.uid || !account;
  $("#mx-send").textContent = m.phone ? "Send on WhatsApp" : "Send them the invite";
  const gate = removability(m, {
    selfId: self,
    ownerUid: trip.ownerUid ?? null,
    expenses: expenses.filter((e) => e.tripId === trip.id),
    settlements: settlements.filter((p) => p.tripId === trip.id),
    others: ensureMembers(trip).length - 1,
  });
  $("#mx-remove").hidden = isSelf;
  $("#mx-remove").disabled = !gate.removable;
  $("#mx-remove-note").textContent = gate.note;
  const canReassign = !gate.removable && !isSelf && gate.canReassign;
  setHidden($("#mx-reassign"), !canReassign);
  if (canReassign) {
    const sel = $("#mx-reassign-to");
    sel.innerHTML = "";
    for (const o of ensureMembers(trip).filter((x) => x.id !== m.id)) {
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
  // Awaited, and SPOKEN. This used to be a bare silent sync: if the push
  // was refused or the device was offline, the address never reached the
  // trip document, no path could work, and the sheet closed as though
  // everything was fine.
  sendInvite(trip, m);
}

// Put the invitation where the invitee can find it: on the trip (so the
// rules let them in) and in their own invite index (so they know it
// exists without being sent anything).
async function sendInvite(trip, member) {
  if (!account) {
    // Signed out there is nothing to send and nowhere to send it. Say
    // so — the member sheet used to show them as "invited, not opened
    // yet" when no invitation existed and none ever would.
    if (member.email) toast(`Sign in to actually share this trip with ${member.name}.`);
    return;
  }
  // syncNow returns false for "already running" as well as for a real
  // failure, and this read it as offline and gave up. Wait for the
  // in-flight one instead.
  let ok = await syncNow({ silent: true });
  if (!ok && syncing) {
    await new Promise((r) => setTimeout(r, PUSH_DELAY_MS));
    ok = await syncNow({ silent: true });
  }
  if (!ok) {
    toast(`Couldn't share that yet — it'll go out when you're back online.`);
    return;
  }
  if (!member.email) return;                // a name or a phone grants no access
  try {
    const { writeInvite } = await import("./firestore.js");
    const key = await emailKey(member.email);
    if (!key) return;
    await writeInvite(key, trip.id,
      inviteEntry(trip, settings.profileName || account.email, stampNow()));
    // Recorded here too, so inviteEveryone doesn't re-send on every
    // later save of the trip — this path never set it.
    member.invitedAt = stampNow();
    countInvite(member.id);
    saveTrips();
    toast(`${member.name} can now open “${trip.name}”`);
  } catch {
    // The trip document already carries the invitation, so the link
    // still works — only automatic discovery is affected.
    toast(`Added ${member.name}. Send them the invite link so they can open it.`);
  }
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

function addMember(text) {
  const trip = activeTrip();
  if (!trip) return;
  const members = ensureMembers(trip);
  // The SAME decision as the trip editor's field. They used to be two
  // copies that drifted — one warned when signed out and the other
  // didn't, and only one of them could invite at all.
  const plan = planAddMember(text, members, { signedIn: !!account });
  if (plan.do === "nothing") return;
  if (plan.do === "reject") { toast(plan.say); return; }

  const member = plan.do === "invite" ? plan.target : plan.member;
  if (plan.do === "invite") member.email = plan.email;
  else members.push(member);

  saveTrips();
  renderMemberSheet();
  renderLedger();
  if (plan.do === "invite" || plan.invite) sendInvite(trip, member);
  else if (plan.say) toast(plan.say);

  // If an expense is being edited, fold the new member into its split:
  // included by default in equal mode, weight 0 (assign it yourself)
  // otherwise.
  if (plan.do === "add" && eState && $("#expense-sheet").open) {
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
  for (const code of currencyOptions(eState.code, trip.currencies, settings.homeCurrency)) {
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
// The single source for "what is this expense worth". The save, the
// preview and the "locked in" label each had their own copy of this
// rule, and in v1.46.1 the preview promised today's rate while the save
// correctly kept the snapshot.
function priced() {
  const previous = editExpenseId ? expenses.find((e) => e.id === editExpenseId) : null;
  return priceExpense({
    previous,
    amount: eState.amount,
    code: eState.code,
    homeCurrency: settings.homeCurrency,
    rates: ratesInfo.data?.rates,
  });
}
const previewHomeValue = () => priced().homeValue;
const previewIsLocked = () => priced().locked;

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
        <input type="checkbox" id="sinc-${escapeHtml(m.id)}" data-sinc="${escapeHtml(m.id)}" ${included ? "checked" : ""}>
        <label class="s-name" for="sinc-${escapeHtml(m.id)}">${name}</label>
        <span class="s-owes">${owesText}</span>`;
    } else {
      const suffix = eState.split.mode === "percent" ? "%" : "×";
      li.innerHTML = `
        <span class="s-name">${name}</span>
        <span class="s-owes">${owesText}</span>
        <input type="text" inputmode="decimal" data-sw="${escapeHtml(m.id)}" value="${included ? localizeNumber(weight, DEVICE_LOCALE) : ""}"
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
  // The separator prompt is gone: "2,50" now reads as two-fifty on every
  // locale, which is what people mean, so there is nothing to ask.
  warn.textContent = slip
    ? `That's ${fmtHome(homeAmount)} — did you mean ${formatAmount(slip.suggestion, eState.code, localeFor(eState.code))}?`
    : "";
  setHidden(warn, !warn.textContent);

  const missing = whyBlocked({
    name: eState.name, amount: eState.amount, homeValue: homeAmount,
    paidBy: eState.paidBy, splitValid: valid,
  });
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

  const { homeValue } = priced();
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
    createdAt: resolveCreatedAt({
      when: fromDatetimeLocal($("#e-when").value),
      previous,
      fallback: Date.now(),
    }),
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
  // `expenses` is read HERE, on the far side of the awaits above, not from
  // the copy this function opened with — a snapshot lands in that window
  // routinely. ledger.js decides the rest (ADR-0019).
  const committed = commitExpense({ expenses, record, editingId: editExpenseId });
  expenses = committed.expenses;
  saveExpenses();
  // Activation, not volume: the once-ever moment this device stopped
  // being a download and started being a ledger. Counted after the save
  // lands, so it can never claim an expense that was not written. Edits
  // don't count — shouldSend() drops the second one for ever.
  if (!editExpenseId) count("first_expense");
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
  const homeDecimals = CURRENCIES[settings.homeCurrency]?.decimals ?? 2;
  const transfers = settleUp(balances, homeDecimals);
  // What each balances row prints. Same rounding as the transfers above,
  // so the two lists agree about who is settled — see roundedNets.
  const shown = roundedNets(balances, homeDecimals);
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

  // The other moment of value: money that was owed is now settled. The
  // expense count is required as well as the empty transfer list — a
  // brand-new trip with two members and no expenses also renders "All
  // settled 🎉", and nothing has happened there worth keeping the app
  // for. Shows once the sheet closes; see showInstallNudge.
  if (!transfers.length && members.length > 1 && list.length > 0) offerInstall("settled-up");

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
        const net = shown[m.id] ?? 0;
        const cls = net > 0 ? "pos" : net < 0 ? "neg" : "";
        const sign = net > 0 ? "gets " : net < 0 ? "owes " : "";
        return `<details class="bal-details">
          <summary><div class="bal-row"><span>${escapeHtml(byId[m.id] ?? m.name)}</span>
            <span class="b-sub">paid ${fmtHome(b.paid)} · share ${fmtHome(b.share)}</span>
            <span class="b-net ${cls}">${sign}${fmtHome(Math.abs(net))}</span>
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
  // The currency the field is SHOWING, which is what #p-code holds and
  // what the input handler reads it back in. It opens on the home
  // currency, so this was written as settings.homeCurrency — which stopped
  // being the same thing the moment #p-code could change.
  $("#p-amount").value = pState.amount
    ? formatAmount(pState.amount, pState.code)
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
      if (!applyIncoming(parsePaymentQR(raw, visibleCodes(), DEVICE_LOCALE))) {
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
      recordSample(e.target.dataset.code,
        parseAmount(e.target.value, amountLocale(e.target.dataset.code)));
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
  // One action on the invitation screen, and signing in is what HAPPENS
  // when you take it — not what you are asked for first. Settings is
  // where the join prompt and "Continue with Google" already live, and
  // where a failed sign-in can say why; sending people somewhere that
  // cannot report its own failure is how the last invite bug hid.
  $("#invite-join").addEventListener("click", openSettings);
  // "Have a look around": a detour with nothing written down. The next
  // launch re-derives the invitation from the link, so the same link
  // invites again — a preview is not ours to keep.
  $("#invite-dismiss").addEventListener("click", () => {
    inviteDismissed = true;
    // renderTrips repaints the invitation too, and decides all three
    // surfaces from the one rule in coldopen.js — which is what stops
    // this landing back on "No trips yet." / "Create your first trip",
    // the exact screen the invitation exists to replace.
    renderTrips();
  });
  // …and back again. The link is already out of the address bar by now,
  // so without this the detour is a one-way door and the only route back
  // to Join is the original chat message.
  $("#look-around-back").addEventListener("click", () => {
    inviteDismissed = false;
    renderTrips();
  });
  // What to do about a join that failed. The label and the action both
  // come from js/joining.js, so the button cannot offer something the
  // conclusion did not (the cold-open failure table).
  $("#invite-next").addEventListener("click", async () => {
    const action = nextStep(joinProblem)?.action;
    if (action === "look-around") {
      inviteDismissed = true;
      renderTrips();
    } else if (action === "retry") {
      syncNow();
    } else if (action === "resend") {
      const { note } = await resendVerification();
      toast(note);
    } else if (action === "add-address") {
      // They cannot fix this themselves — the address has to go onto the
      // trip, and only somebody already on it can put it there. The trip
      // name is the link's claim, which is all we have: this device was
      // refused the document.
      await shareText(addressRequest({
        email: account?.email,
        tripName: invitationNow().name,
      }));
    }
  });
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
    pState.amount = parseAmount(e.target.value, amountLocale(pState.code));
    renderPaymentSheet();
  });
  $("#p-code").addEventListener("change", (e) => {
    pState.code = e.target.value;
    // Rewrite what's on screen in the new currency's own format. The two
    // ends of this field must agree on one locale: leaving "2,500.00"
    // there after switching to a currency read in a comma-decimal format
    // makes the next keystroke parse to nothing.
    $("#p-amount").value = Number.isFinite(pState.amount)
      ? formatAmount(pState.amount, pState.code)
      : "";
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
    shareInviteTo(m.email ?? "the email you gave them", activeTrip()?.id, m.phone, m.id);
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
    // The field's locale is the EXPENSE currency's — the same one the
    // prefill was formatted with. Reading it back with the device locale
    // made editing an existing INR expense on a European phone parse to
    // null on the first keystroke.
    e.target.dataset.code = eState.code;
    const amount = parseAmount(raw, amountLocale(eState.code));
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
      eState.split.parts[w.dataset.sw] = parseAmount(w.value, DEVICE_LOCALE) ?? 0;
      // update validation + owed labels without rebuilding (keeps focus)
      const homeAmount = previewHomeValue();
      const valid = splitValid(eState.split);
      const live = homeAmount !== null && valid
        ? allocate(homeAmount, eState.split.parts, CURRENCIES[settings.homeCurrency]?.decimals ?? 2)
        : {};
      const liveOwn = homeAmount !== null && valid && eState.code !== settings.homeCurrency
        ? allocate(eState.amount, eState.split.parts, CURRENCIES[eState.code]?.decimals ?? 2)
        : {};
      for (const row of document.querySelectorAll("#e-split-rows .split-row")) {
        const input = row.querySelector("[data-sw]");
        if (!input) continue;
        const cut = live[input.dataset.sw];
        // Blanking these while the percentages don't add up hid how far
        // off you were; keep showing the current figures instead.
        // Both figures, as the full render emits: the cash you hand
        // over, and what it costs you at home. This path used to write
        // the home figure alone, so adjusting a split erased the very
        // number you were adjusting it to work out.
        const own = liveOwn[input.dataset.sw];
        row.querySelector(".s-owes").innerHTML = cut === undefined ? ""
          : (own !== undefined
            ? `${escapeHtml(formatAmount(own, eState.code, localeFor(eState.code)))} ${escapeHtml(eState.code)}` +
              `<span class="s-home">${escapeHtml(fmtHome(cut))}</span>`
            : escapeHtml(fmtHome(cut)));
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
  $("#bell-btn").addEventListener("click", openNotices);
  $("#notices-body").addEventListener("click", (e) => {
    const row = e.target.closest("[data-target]");
    if (!row) return;
    $("#notices-sheet").close();
    const where = noticeTarget({ tripId: row.dataset.target });
    if (where.screen === "settings") {
      openSettings();
      $("#resend-verify")?.scrollIntoView({ block: "center" });
    } else {
      openTripFromNotification(where.tripId);
    }
  });
  $("#update-btn").addEventListener("click", () => checkForUpdate({ manual: true }));
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
  // store.setSettings, not updateSettings: this is a decision about THIS
  // device, and syncing it would mean one phone opting the other in.
  $("#analytics-toggle").addEventListener("change", (e) => {
    settings = store.setSettings({ analyticsOptIn: e.target.checked });
    toast(e.target.checked ? "Counting turned on." : "Counting turned off.");
  });
  $("#markup-pct").addEventListener("input", (e) => {
    const pct = parseAmount(e.target.value, DEVICE_LOCALE);
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
  $("#resend-verify").addEventListener("click", async () => {
    renderAccount(await resendVerification());
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
  // First, before this launch writes a settings record of its own: the
  // whole test for "has this device been here before?" is whether one
  // exists (js/store.js). The default was INR for every new install on
  // earth, which for a travel app is not a default, it is a statement
  // about who the app is for.
  settings = store.seedHomeCurrency(initialHomeCurrency({ locale: DEVICE_LOCALE, timeZone: DEVICE_TZ }));
  // Read before the first paint and held for the launch — the increment
  // is written further down, and re-reading it after that would change
  // the answer halfway through a launch (see `promptsShown`).
  promptsShown = promptCount(settings.invitePrompts, invitationNow().tripId);
  $("#app-version").textContent = APP_VERSION;
  $("#update-note").textContent = APP_VERSION;
  renderBell();
  // iOS Safari does not apply :active to an element unless the document
  // has a touch listener. This app kills the OS tap flash globally
  // (styles.css) and relies entirely on :active for feedback — so on an
  // iPhone every button was completely inert to the touch: no flash, no
  // press state, nothing until the action completed. An empty passive
  // listener is the whole fix.
  document.addEventListener("touchstart", () => {}, { passive: true });
  addSheetCloseButtons();
  wrapSheetBodies(); // after the close buttons, so they stay outside the scroller
  watchSegs();
  $("#about-version").textContent = APP_VERSION;
  applyTheme();
  renderProfileButton(); // sign-in state visible from the first frame
  // Before renderTrips, before rates, before restoring a session: on the
  // first paint, with nothing loaded, the visitor already knows the link
  // worked.
  renderInvitation();
  $("#markup-toggle").checked = settings.markupOn;
  $("#markup-pct").value = localizeNumber(settings.markupPct, DEVICE_LOCALE);
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
  // …and except the trip an invite link names when this device already
  // holds it. That invitation has been answered, so coldOpenView takes
  // the invitation screen down (js/coldopen.js) — and "the trip must be
  // the next thing they see" then means the card, open. syncNow does the
  // same for a join it has just made; this is the offline half, and the
  // path taken every time a second link arrives for a trip already here.
  const invitedTo = invitationNow().tripId;
  const held = invitedTo && trips.some((t) => t.id === invitedTo) ? invitedTo : null;
  settings = store.setSettings({
    activeTripId: held ?? (pinnedValid ? settings.pinnedTripId : null),
    // The one place the count is written, once per launch. Not in
    // renderInvitation() or renderTrips(): those run many times in a
    // single launch — renderTrips calls renderInvitation, every sync
    // repaints, every sheet close repaints — so a counter in either
    // would spend its three asks before the first paint had settled.
    //
    // `asked` is read from the surface this launch actually opened on,
    // so what is recorded is what happened rather than what was
    // intended. Nothing here goes near pendingJoin: after the third
    // launch the app has stopped ASKING, and the trip is as joinable as
    // it ever was through the single join path in syncNow.
    invitePrompts: nextPrompts(settings.invitePrompts, { tripId: invitedTo, answered: !!held, asked: showingInvite(), fromLink: !!linkJoinId }),
  });
  renderTrips();
  refreshRates(); // async; fields fill in as soon as rates arrive

  // Retention, the only one of the six that is about a gap rather than
  // an action: opening again after a month away. Read before the stamp
  // is overwritten, or the gap is always zero.
  if (isReturn(settings.lastOpenAt)) count("returned");
  settings = store.setSettings({ lastOpenAt: Date.now() });

  const params = new URLSearchParams(location.search);

  // Someone shared a trip with us: ?join=<tripId>. Remembered in settings
  // rather than held in the URL, because signing in with Google can
  // navigate away and come back — the id must survive that round trip.
  const joinId = params.get("join");
  if (joinId) {
    // Strips ?join= and the #p= preview together. Both are gone from here
    // on — which is why `invitation` is decided at module scope, above.
    history.replaceState(null, "", "./");
    settings = store.setSettings({ pendingJoin: joinId });
    // Fires before any sign-in, which is the point: the drop-off between
    // "opened the link" and "joined" is invisible from inside Firebase,
    // because a signed-out visitor never touches it.
    count("link_opened");
    // The other half of that number: did the screen manage to NAME the
    // trip, or only offer a generic invitation? The gap between the two
    // is the fragment failing to survive the journey.
    if (invitationNow().show === "invitation") count("trip_seen");
    // The toast that used to stand here said the opposite of the
    // headline ("No trips yet."), 900ms late, at the bottom of the
    // screen. The invitation screen says it properly and immediately.
    // What survives is the one thing that screen cannot know: on a
    // device that is already signed in, the trip is genuinely on its way.
    if (settings.syncHint) {
      setTimeout(() => toast("Opening the trip shared with you…"), 900);
    }
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
    if (e.data?.type === "pushed" && e.data.tripId) {
      // Deduplicated against whatever the next sync works out for
      // itself — see noticeKey.
      noteEvents([{ kind: e.data.kind ?? "push", tripId: e.data.tripId,
        ref: e.data.ref ?? "", text: e.data.body ?? "Something changed on a shared trip" }]);
    }
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
      const probe = parseSharedText(shared, trips.flatMap((t) => t.currencies), DEVICE_LOCALE);
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
      const parsed = parseSharedText(shared, visibleCodes(), DEVICE_LOCALE);
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
  // in before. Everyone else never touches the network for this. Started
  // here and not awaited, so the UI is never held up by the network;
  // whoever needs the ANSWER awaits authSettled() itself.
  authSettled();

  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("./sw.js").catch(() => {});
  }

  // Last, and with no condition of its own: whether there is anything to
  // protect, whether this browser is on a seven-day timer and whether
  // now is a moment to say so are all js/persist.js's to answer.
  guardStorage();
}

boot();

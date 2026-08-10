// DOM builders + small view helpers. No state — app.js owns that.

import { CURRENCIES } from "./currencies.js";
import { memberState } from "./members.js";

export const $ = (sel) => document.querySelector(sel);

// Shared 16px stroke icons so every glyph in the app matches.
const STROKE = 'width="16" height="16" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';
export const ICONS = {
  grip: '<svg width="14" height="18" viewBox="0 0 14 18" aria-hidden="true" fill="currentColor"><circle cx="4" cy="4" r="1.5"/><circle cx="10" cy="4" r="1.5"/><circle cx="4" cy="9" r="1.5"/><circle cx="10" cy="9" r="1.5"/><circle cx="4" cy="14" r="1.5"/><circle cx="10" cy="14" r="1.5"/></svg>',
  pencil: `<svg ${STROKE}><path d="M11.1 2.4l2.5 2.5L5.5 13l-3 .5.5-3z"/></svg>`,
  trash: `<svg ${STROKE}><path d="M2.5 4.5h11M6.5 2.5h3M4 4.5l.7 9.5h6.6l.7-9.5M6.5 7.5v4M9.5 7.5v4"/></svg>`,
  copy: `<svg ${STROKE}><rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5v-2a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/></svg>`,
  spark: '<svg width="12" height="12" viewBox="0 0 16 16" aria-hidden="true" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M1.5 11.5l4-4 3 3 6-6"/><path d="M10.5 4.5H14.5V8.5"/></svg>',
  pin: `<svg ${STROKE}><path d="M9 2.5l4.5 4.5-2.7.7-.7 2.7L5.6 5.9l2.7-.7z"/><path d="M6.7 9.3l-4.2 4.2"/></svg>`,
  clip: `<svg ${STROKE}><path d="M13 7.4l-4.6 4.6a3 3 0 0 1-4.2-4.2L8.8 3a2 2 0 0 1 2.8 2.8L7 10.4a1 1 0 0 1-1.4-1.4l4.2-4.2"/></svg>`,
};

// One converter row: [flag CODE·badge, symbol·name] [amount] [drag grip]
export function fieldRow(code, isHome) {
  const c = CURRENCIES[code] ?? { name: code, symbol: "", flag: "💱", decimals: 2 };
  const row = document.createElement("div");
  row.className = "field" + (isHome ? " home" : "");
  row.dataset.code = code;
  row.innerHTML = `
    <button class="field-label" data-copy="${code}" title="Rate, chart & copy">
      <span class="field-flag">${c.flag}</span>
      <span class="field-meta">
        <span class="field-code">${code}<span class="chart-hint" title="Tap for chart">${ICONS.spark}</span>${isHome ? '<span class="home-badge">HOME</span>' : ""}</span>
        <span class="field-name">${c.symbol ? c.symbol + " · " : ""}${c.name}</span>
      </span>
    </button>
    <span class="cur-sym" aria-hidden="true">${c.symbol ?? ""}</span>
    <input type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done"
           placeholder="0" data-code="${code}" aria-label="Amount in ${c.name}" />
    ${isHome ? "" : `<span class="drag-handle" aria-label="Drag to reorder ${code}">${ICONS.grip}</span>`}
  `;
  return row;
}

// A collapsible trip card. The shared converter panel is reparented into
// `.trip-card-body` of whichever card is open.
// Each card sits in a slot; swiping the card left reveals the slot's
// archive/unarchive action underneath.
// Who is on this trip, without opening it. A tick means the row is held
// by a real signed-in account — the thing that decides whether they will
// actually receive the trip, which was previously invisible until you
// went looking three screens down.
const MEMBER_TITLE = {
  self: "You",
  linked: "on TripCash — they get this trip",
  invited: "invited — hasn't opened it yet",
  name: "name only — won't see the trip",
};

function memberLine(members, selfId) {
  if (!members.length) return "";
  // Six is what fits at 375px before the row wraps to a third line.
  const shown = members.slice(0, 6);
  const rest = members.length - shown.length;
  const chips = shown.map((m) => {
    const state = memberState(m, selfId);
    const label = state === "self" ? "You" : (m.name || "Someone");
    return `<span class="tm tm-${state}" title="${escapeHtml(MEMBER_TITLE[state])}">${escapeHtml(label)}${
      state === "linked" ? '<span class="tm-tick" aria-hidden="true">✓</span>' : ""
    }</span>`;
  }).join("");
  return `<span class="trip-members">${chips}${rest > 0 ? `<span class="tm tm-more">+${rest}</span>` : ""}</span>`;
}

export function tripCard(trip, isOpen, isPinned) {
  const slot = document.createElement("div");
  slot.className = "trip-slot";
  const action = trip.archived ? "Unarchive" : "Archive";
  slot.innerHTML = `
    <div class="swipe-action" aria-hidden="true">${action}</div>
    <section class="trip-card${isOpen ? " open" : ""}${trip.archived ? " archived" : ""}" data-trip="${escapeHtml(trip.id)}">
      <div class="trip-card-head">
        <button class="trip-head-main" data-toggle-trip="${escapeHtml(trip.id)}" aria-expanded="${isOpen}">
          <span class="trip-head-meta">
            <span class="trip-name-text">${escapeHtml(trip.name)}</span>
            <span class="trip-curr">${trip.currencies.join(" · ")}</span>
            ${memberLine(trip.members ?? [], trip.selfId)}
          </span>
          <svg class="trip-chev" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        ${trip.archived ? "" : `<button class="mini trip-pin${isPinned ? " pinned" : ""}" data-pin="${escapeHtml(trip.id)}"
          aria-label="${isPinned ? "Unpin trip" : "Pin trip — opens expanded on launch"}"
          aria-pressed="${isPinned}">${ICONS.pin}</button>`}
        <button class="mini trip-edit" data-edit="${escapeHtml(trip.id)}" aria-label="Edit trip">${ICONS.pencil}</button>
        <button type="button" class="trip-drag" data-move="${escapeHtml(trip.id)}"
          aria-label="Move ${escapeHtml(trip.name)} — drag, or tap to move up">${ICONS.grip}</button>
      </div>
      <div class="trip-card-body"></div>
    </section>
  `;
  return slot;
}

export const EXPENSE_TYPES = [
  ["food", "🍜", "Food"],
  ["transport", "🚕", "Transport"],
  ["stay", "🏨", "Stay"],
  ["activity", "🎟️", "Activities"],
  ["shopping", "🛍️", "Shopping"],
  ["other", "✨", "Other"],
];
export const typeEmoji = (type) =>
  EXPENSE_TYPES.find(([t]) => t === type)?.[1] ?? "✨";
export const typeLabel = (type) =>
  EXPENSE_TYPES.find(([t]) => t === type)?.[2] ?? "Other";

// One row in the expense list.
export function expenseRow(e, memberName, homeText, dayText) {
  const li = document.createElement("li");
  li.innerHTML = `
    <button data-expense="${escapeHtml(e.id)}">
      <span class="x-emoji">${typeEmoji(e.type)}</span>
      <span class="x-meta">
        <span class="x-name">${escapeHtml(e.name)}</span>
        <span class="x-sub">${escapeHtml(memberName)} paid · ${dayText}${e.attachment ? `<span class="x-clip">${ICONS.clip}</span>` : ""}</span>
      </span>
      <span class="x-amts">
        <span class="x-local">${e.amountText} ${e.code}</span>
        <span class="x-home">${homeText}</span>
      </span>
      <svg class="x-chev" width="14" height="14" viewBox="0 0 16 16" aria-hidden="true"><path d="M6 4l4 4-4 4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
    </button>
  `;
  return li;
}

// What ARIA a button inside a radiogroup or tablist should carry, given
// its classes. Written once and read from two directions — a chip built
// here, and a chip whose class flipped later — because a rule about
// selection kept in two places is exactly how this app has shipped bugs.
//
// A group can hold buttons that are not choices: #e-payer ends with the
// "+ Add" chip, which opens the add-member dialog. Marked as a radio it
// is announced as a selectable payer named "+ Add". Those get null.
export function segAria(groupRole, className = "") {
  const classes = new Set(String(className).split(/\s+/));
  if (classes.has("member-chip") && classes.has("add")) return null;
  const on = String(classes.has("on"));
  return groupRole === "tablist"
    ? { role: "tab", attr: "aria-selected", value: on }
    : { role: "radio", attr: "aria-checked", value: on };
}

// Re-mark every button in a group from its current classes. A radiogroup
// whose children are plain buttons is invalid ARIA, and "which one is on?"
// was carried by a CSS class alone — invisible to a screen reader.
export function syncSegState(root) {
  const groupRole = root.getAttribute("role");
  for (const b of root.querySelectorAll("button")) {
    const aria = segAria(groupRole, b.className);
    if (!aria) continue;
    b.setAttribute("role", aria.role);
    b.setAttribute(aria.attr, aria.value);
  }
}

// Selectable person chip (payer picker, member row).
export function memberChip(member, { on = false, data = "member" } = {}) {
  const btn = document.createElement("button");
  btn.className = "member-chip" + (on ? " on" : "");
  btn.dataset[data] = member.id;
  btn.textContent = member.name;
  // Marked at build time as well as by the observer: these rows are
  // rebuilt wholesale on every render, and the frame in between is one a
  // screen reader can land on.
  const aria = segAria("radiogroup", btn.className);
  btn.setAttribute("role", aria.role);
  btn.setAttribute(aria.attr, aria.value);
  return btn;
}

// A toggle chip for the filter row above the trip list.
export function filterChip(label, value, isOn) {
  const btn = document.createElement("button");
  btn.className = "f-chip" + (isOn ? " on" : "");
  btn.dataset.filter = value;
  btn.textContent = label;
  return btn;
}

export function resultItem(code, isPicked, place) {
  const c = CURRENCIES[code];
  // When a search matched a specific place (e.g. city "Paris"), show that
  // instead of the generic country list so the match is self-explanatory.
  const detail = place ?? c.countries.slice(0, 4).join(", ");
  const li = document.createElement("li");
  li.innerHTML = `
    <button data-toggle="${code}">
      <span class="r-flag">${c.flag}</span>
      <span class="r-meta"><span class="r-code">${code}</span>
        <span class="r-detail">${c.name} — ${detail}</span>
      </span>
      <span class="r-sym">${c.symbol}</span>
      ${isPicked ? '<span class="picked-mark">✓</span>' : ""}
    </button>
  `;
  return li;
}

export function pickedChip(code) {
  const c = CURRENCIES[code];
  const btn = document.createElement("button");
  btn.className = "chip";
  btn.dataset.toggle = code;
  btn.type = "button";
  btn.textContent = `${c?.flag ?? ""} ${code} ✕`;
  return btn;
}

const UNDO_MS = 6000;
let toastTimer;
let toastExpire;   // runs when the undo window closes without being used
// toast("Saved") or toast("Archived", { actionLabel: "Undo", onAction: fn })
// `onExpire` fires when an undoable toast times out — the moment the
// thing it offered to undo becomes genuinely unrecoverable.
export function toast(msg, { actionLabel, onAction, onExpire } = {}) {
  // A new toast used to run the previous one's expiry IMMEDIATELY —
  // which, for a deleted expense, is what permanently sweeps the receipt
  // blob. Deleting two in a row finalised the first on the spot. The
  // pending window keeps its own timer and finishes on schedule.
  const previous = toastExpire;
  if (previous) setTimeout(previous, UNDO_MS);
  toastExpire = onExpire ?? null;
  const el = $("#toast");
  // showModal() promotes a dialog into the TOP LAYER, which sits above
  // every z-index in the normal flow — so a toast parented to <body> was
  // drawn underneath any open sheet. Undo was unreachable exactly where
  // it mattered, and receipt-upload failures announced themselves to an
  // empty room. Re-parent into whichever sheet is open (a top-layer
  // element's descendants are in the top layer too), back to <body> when
  // none is.
  const host = document.querySelector("dialog[open]") ?? document.body;
  if (el.parentElement !== host) host.appendChild(el);
  el.textContent = msg;
  el.classList.toggle("has-action", !!actionLabel);
  if (actionLabel) {
    const btn = document.createElement("button");
    btn.className = "toast-act";
    btn.textContent = actionLabel;
    btn.addEventListener("click", () => {
      el.hidden = true;
      toastExpire = null;        // undone, so nothing to clean up
      clearTimeout(toastTimer);
      onAction?.();
    });
    el.appendChild(btn);
  }
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
    const expire = toastExpire;
    toastExpire = null;
    expire?.();
  }, actionLabel ? UNDO_MS : 1700);
}

export function escapeHtml(value) {
  // String(): ids and names arrive from other devices, and a non-string
  // threw here — which killed the entire render, not just one row.
  const s = String(value ?? "");
  return s.replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[ch]);
}

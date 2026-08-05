// DOM builders + small view helpers. No state — app.js owns that.

import { CURRENCIES } from "./currencies.js";

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
};

// One converter row: [flag CODE·badge, symbol·name] [amount] [drag grip]
export function fieldRow(code, isHome) {
  const c = CURRENCIES[code] ?? { name: code, symbol: "", flag: "💱", decimals: 2 };
  const row = document.createElement("div");
  row.className = "field" + (isHome ? " home" : "");
  row.dataset.code = code;
  row.innerHTML = `
    <button class="field-label" data-copy="${code}" title="Tap to copy">
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
export function tripCard(trip, isOpen, isPinned) {
  const slot = document.createElement("div");
  slot.className = "trip-slot";
  const action = trip.archived ? "Unarchive" : "Archive";
  slot.innerHTML = `
    <div class="swipe-action" aria-hidden="true">${action}</div>
    <section class="trip-card${isOpen ? " open" : ""}${trip.archived ? " archived" : ""}" data-trip="${trip.id}">
      <div class="trip-card-head">
        <button class="trip-head-main" data-toggle-trip="${trip.id}" aria-expanded="${isOpen}">
          <span class="trip-head-meta">
            <span class="trip-name-text">${escapeHtml(trip.name)}</span>
            <span class="trip-curr">${trip.currencies.join(" · ")}</span>
          </span>
          <svg class="trip-chev" width="16" height="16" viewBox="0 0 16 16" aria-hidden="true"><path d="M4 6l4 4 4-4" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        ${trip.archived ? "" : `<button class="mini trip-pin${isPinned ? " pinned" : ""}" data-pin="${trip.id}"
          aria-label="${isPinned ? "Unpin trip" : "Pin trip — opens expanded on launch"}"
          aria-pressed="${isPinned}">${ICONS.pin}</button>`}
        <button class="mini trip-edit" data-edit="${trip.id}" aria-label="Edit trip">${ICONS.pencil}</button>
        <span class="trip-drag" aria-label="Drag to reorder ${escapeHtml(trip.name)}">${ICONS.grip}</span>
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
    <button data-expense="${e.id}">
      <span class="x-emoji">${typeEmoji(e.type)}</span>
      <span class="x-meta">
        <span class="x-name">${escapeHtml(e.name)}</span>
        <span class="x-sub">${escapeHtml(memberName)} paid · ${dayText}</span>
      </span>
      <span class="x-amts">
        <span class="x-local">${e.amountText} ${e.code}</span>
        <span class="x-home">${homeText}</span>
      </span>
    </button>
  `;
  return li;
}

// Selectable person chip (payer picker, member row).
export function memberChip(member, { on = false, data = "member" } = {}) {
  const btn = document.createElement("button");
  btn.className = "member-chip" + (on ? " on" : "");
  btn.dataset[data] = member.id;
  btn.textContent = member.name;
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

let toastTimer;
// toast("Saved") or toast("Archived", { actionLabel: "Undo", onAction: fn })
export function toast(msg, { actionLabel, onAction } = {}) {
  const el = $("#toast");
  el.textContent = msg;
  el.classList.toggle("has-action", !!actionLabel);
  if (actionLabel) {
    const btn = document.createElement("button");
    btn.className = "toast-act";
    btn.textContent = actionLabel;
    btn.addEventListener("click", () => {
      el.hidden = true;
      onAction?.();
    });
    el.appendChild(btn);
  }
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), actionLabel ? 5000 : 1700);
}

export function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[ch]);
}

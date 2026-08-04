// DOM builders + small view helpers. No state — app.js owns that.

import { CURRENCIES } from "./currencies.js";

export const $ = (sel) => document.querySelector(sel);

// One converter row: [flag CODE name] [amount input]
export function fieldRow(code, isHome) {
  const c = CURRENCIES[code] ?? { name: code, flag: "💱", decimals: 2 };
  const row = document.createElement("div");
  row.className = "field" + (isHome ? " home" : "");
  row.innerHTML = `
    <button class="field-label" data-copy="${code}" title="Tap to copy">
      <span class="field-flag">${c.flag}</span>
      <span>
        <span class="field-code">${code}</span>
        <span class="field-name">${isHome ? "Home · " + c.name : c.name}</span>
      </span>
    </button>
    <input type="text" inputmode="decimal" autocomplete="off" enterkeyhint="done"
           placeholder="0" data-code="${code}" aria-label="Amount in ${c.name}" />
  `;
  return row;
}

export function tripListItem(trip, isActive) {
  const li = document.createElement("li");
  li.className = isActive ? "active" : "";
  li.innerHTML = `
    <button class="trip-pick" data-pick="${trip.id}">
      ${escapeHtml(trip.name)}
      <span class="trip-curr">${trip.currencies.join(" · ")}</span>
    </button>
    <button class="mini" data-edit="${trip.id}" aria-label="Edit trip">Edit</button>
    <button class="mini" data-del="${trip.id}" aria-label="Delete trip">✕</button>
  `;
  return li;
}

export function resultItem(code, isPicked) {
  const c = CURRENCIES[code];
  const li = document.createElement("li");
  li.innerHTML = `
    <button data-toggle="${code}">
      <span class="r-flag">${c.flag}</span>
      <span><span class="r-code">${code}</span>
        <span class="r-detail">${c.name} — ${c.countries.slice(0, 4).join(", ")}</span>
      </span>
      ${isPicked ? '<span class="picked-mark">✓</span>' : ""}
    </button>
  `;
  return li;
}

export function pickedChip(code) {
  const btn = document.createElement("button");
  btn.className = "chip";
  btn.dataset.toggle = code;
  btn.type = "button";
  btn.textContent = `${CURRENCIES[code]?.flag ?? ""} ${code} ✕`;
  return btn;
}

let toastTimer;
export function toast(msg) {
  const el = $("#toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => (el.hidden = true), 1700);
}

export function escapeHtml(s) {
  return s.replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[ch]);
}

// The three rules that keep a screen reader oriented while the app
// repaints — and, now, while it opens.
//
// All three come out of the same story and all three are decisions, so
// they live here rather than at the call sites that need them — the payer
// row, the expense-type row, and the From/To rows of the payment sheet
// all rebuild the same way, twelve sheets all open the same way, and a
// rule written four times (or fourteen) is this project's most reliable
// source of bugs.
//
// 1. A rebuilt control must get its focus back. `row.innerHTML = ""`
//    deletes the button the user just activated, and the browser then
//    resets focus to <body> — which, inside an open <dialog>, puts the
//    reader's cursor OUTSIDE the sheet. The aria-checked="true" that just
//    became true is written on a fresh node nobody is standing on, so the
//    one thing the row exists to say is the one thing not said.
//
// 2. A live region must not speak until the value it describes has
//    stopped changing. #e-slip guards against typing 250000 for 2500, and
//    it was written on every keystroke: six keys produced four different
//    sentences, three of them suggesting an amount that was already
//    wrong by the time it was spoken.
//
// 3. A sheet must open on its own title. showModal() focuses the first
//    focusable element, and that was the close button in all twelve —
//    so the app's answer to "open Profile" was to say "Close, button".

// ---------- 1. surviving a rebuild ----------

// What identifies a control across a rebuild: its id, or failing that the
// data-* attribute that names what it does (data-payer, data-etype,
// data-pfrom, ...). Null when the element has neither, which is the
// honest answer for a <div> or for <body> — there is nothing to restore.
//
// The attribute NAME is returned separately from its value and is
// validated, because the caller builds a selector out of it and a value
// can be anything a member typed into a name field.
const SAFE_ATTR = /^[a-z][a-z0-9-]*$/;

const kebab = (name) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);

export function focusKey(el) {
  if (!el || typeof el !== "object") return null;
  const id = el.id;
  if (id) return { attr: "id", value: String(id) };
  const data = el.dataset;
  if (!data) return null;
  // Sorted, so an element carrying two data attributes keys on the same
  // one before and after the rebuild.
  for (const name of Object.keys(data).sort()) {
    const value = data[name];
    const attr = `data-${kebab(name)}`;
    if (value && SAFE_ATTR.test(attr)) return { attr, value: String(value) };
  }
  return null;
}

// Is this element the control that key came from? Defined as "it produces
// the same key", so the two halves cannot disagree about which attribute
// counts.
export function matchesKey(el, key) {
  if (!key) return false;
  const k = focusKey(el);
  return !!k && k.attr === key.attr && k.value === key.value;
}

// Runs `render`, and puts focus back on the control that had it if the
// rebuild threw it away.
//
// `dom` is the two things this needs from a document — who has focus, and
// what is in the tree — so the rule can be exercised without one.
//
// Two deliberate non-actions. A render that did not disturb focus is left
// alone: this runs on every keystroke in the name and amount fields, and
// re-focusing a text field mid-word moves the caret. And a control with no
// replacement (a member removed on the other phone while the sheet was
// open) is not approximated by a neighbour: silently landing the reader on
// a DIFFERENT person, in the row that decides who paid, is worse than
// landing them nowhere.
export function preservingFocus(dom, render) {
  const had = dom.activeElement;
  const key = focusKey(had);
  render();
  if (!key || dom.activeElement === had) return;
  for (const el of dom.querySelectorAll(`[${key.attr}]`)) {
    if (matchesKey(el, key)) {
      el.focus();
      return;
    }
  }
}

// ---------- 2. speaking once, about the number that stayed ----------

// Long enough that a burst of typing collapses into one sentence, short
// enough that a pause between digits still gets an answer.
export const SETTLE_MS = 500;

// Wraps a write to a live region so it announces the settled value.
//
// Clearing is immediate and showing waits: nobody needs to hear that a
// warning went away, and a warning that arrives is only worth hearing
// once it is about the number actually in the field. Backspacing out of
// the warning before it settles therefore cancels it outright, which is
// the common case — the typo is noticed by the person making it.
export function slipAnnouncer(write, {
  delay = SETTLE_MS,
  schedule = setTimeout,
  cancel = clearTimeout,
} = {}) {
  let pending = null;
  return function announce(text) {
    if (pending !== null) {
      cancel(pending);
      pending = null;
    }
    if (!text) {
      write("");
      return;
    }
    pending = schedule(() => {
      pending = null;
      write(text);
    }, delay);
  };
}

// ---------- 3. opening on the sheet's own name ----------

// `dialog.showModal()` focuses the first focusable element inside the
// dialog, and every sheet is given a close button, so the first thing
// each of the twelve sheets did on opening was focus the way out of
// itself: a ring around the X on iOS, and "Close, button" spoken before
// the sheet had said what it was.
//
// Where a sheet starts is a decision — which is why it is here and not at
// the fourteen places that used to call showModal(). The map is written
// out rather than derived as `${dialogId}-title` because #member-editor's
// title is #mx-title, and a rule with one exception silently derived is a
// rule that will be wrong about the next sheet too.
export const SHEET_TITLES = new Map([
  ["editor-sheet", "editor-title"],
  ["settings-sheet", "settings-title"],
  ["expense-sheet", "expense-title"],
  ["summary-sheet", "summary-title"],
  ["payment-sheet", "payment-title"],
  ["attach-sheet", "attach-title"],
  ["member-sheet", "member-title"],
  ["member-editor", "mx-title"],
  ["detail-sheet", "detail-title"],
  ["scan-sheet", "scan-title"],
  ["notices-sheet", "notices-title"],
  ["confirm-sheet", "confirm-title"],
]);

// The id to focus when `dialogId` opens, or null for "leave it alone".
//
// `prefer` is an explicit content target and wins: a sheet that exists to
// collect one thing should start on that thing, which is why a brand-new
// expense opens on its name field rather than on the words "Add expense".
// Editing an existing one passes nothing and gets the title.
//
// Null is a real answer, not a fallback. An unknown dialog leaves focus
// where the browser put it rather than guessing at a neighbour — the same
// non-action as a rebuilt control with no replacement above.
export function initialFocus({ dialogId, prefer = null } = {}) {
  if (typeof prefer === "string" && prefer) return prefer;
  return SHEET_TITLES.get(dialogId) ?? null;
}

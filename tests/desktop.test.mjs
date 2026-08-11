// A mouse must not destroy work.
//
// Desktop is this app's least examined surface and two of its defects
// destroyed work outright. `grep -c pointerType js/app.js` was 0: the
// swipe-to-archive gesture had no idea whether the pointer was a finger
// or a mouse, so dragging left across a trip name — which on a laptop is
// what selecting the text looks like — passed the −80px threshold and
// archived the trip. The backdrop handler closed ANY sheet on a click
// outside its rect with no dirty check and no question, and on a
// 1280×800 window that backdrop is two thirds of the screen. Esc was the
// same hole by another door. And one global Enter handler blurred every
// input, so Enter signed nobody in and saved nothing.
//
// The rules live in js/desktop.js and are exercised directly. The WIRING
// is the part that has historically drifted, so it is exercised too: the
// real handler bodies are lifted out of js/app.js and driven with
// synthesised pointer sequences. There is no DOM library in the tree
// (ADR-0001), so they are handed stubs implementing exactly the
// affordances they touch — a handler reaching for more of the DOM fails
// loudly here rather than silently passing.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gestureAllowed, unsavedIn, discardWording, onDismiss, enterAction, enterButton,
  signInDefaultMode, outsideSheet, backdropDismiss } from "../js/desktop.js";
import { initialFocus } from "../js/a11y.js";
import { writeAccess } from "../js/roster.js";
import { whyBlocked } from "../js/pricing.js";
import { splitValid, allocate, referencedMembers } from "../js/splits.js";
import { CURRENCIES } from "../js/currencies.js";
import { EXPENSE_TYPES, escapeHtml } from "../js/ui.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const app = read("js/app.js");
const desktop = read("js/desktop.js");

// ---------- lifting real code out of js/app.js ----------

// The whole `function name(...) { ... }` declaration, braces matched.
function declOf(source, name) {
  const at = source.search(new RegExp(`^function\\s+${name}\\b`, "m"));
  assert.notEqual(at, -1, `js/app.js should declare ${name}`);
  let i = source.indexOf("(", at), depth = 0;
  for (; i < source.length; i++) {
    if (source[i] === "(") depth++;
    else if (source[i] === ")" && --depth === 0) break;
  }
  const open = source.indexOf("{", i);
  depth = 0;
  for (let j = open; j < source.length; j++) {
    if (source[j] === "{") depth++;
    else if (source[j] === "}" && --depth === 0) return source.slice(at, j + 1);
  }
  throw new Error(`${name} has no closing brace`);
}

// Run that declaration with its free variables supplied by hand.
function lift(name, scope) {
  const keys = Object.keys(scope);
  const make = new Function(...keys, `${declOf(app, name)}\nreturn ${name};`);
  return make(...keys.map((k) => scope[k]));
}

// The block that follows a marker line, braces matched — used to read a
// specific wiring site rather than the whole file.
function blockAfter(source, marker) {
  const at = source.indexOf(marker);
  assert.notEqual(at, -1, `js/app.js should contain ${marker}`);
  const open = source.indexOf("{", at);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(at, i + 1);
  }
  throw new Error(`unclosed block after ${marker}`);
}

// ---------- the rule itself ----------

test("only a mouse is refused a touch gesture", () => {
  assert.equal(gestureAllowed({ pointerType: "mouse" }), false);
  assert.equal(gestureAllowed({ pointerType: "touch" }), true);
  assert.equal(gestureAllowed({ pointerType: "pen" }), true);
  // Load-bearing: older browsers and synthesised events send these, and
  // refusing them would kill the gesture on the phones it exists for.
  assert.equal(gestureAllowed({ pointerType: "" }), true);
  assert.equal(gestureAllowed({ pointerType: undefined }), true);
  assert.equal(gestureAllowed({}), true);
  assert.equal(gestureAllowed(), true);
});

// ---------- swipe-to-archive, driven for real ----------

const classList = () => {
  const s = new Set();
  return { add: (c) => s.add(c), remove: (c) => s.delete(c), contains: (c) => s.has(c) };
};

// A pointer sequence over one trip card head: down at 300, move to
// 300+dx, up. Returns the ids toggleArchive was called with, plus what
// the card was actually dragged to — the Archive panel behind it is only
// revealed by that transform, so an untouched transform is the reveal
// not happening.
function swipe({ pointerType, dx, locked = false }) {
  const archived = [];
  const handlers = {};
  const slot = { classList: classList() };
  const card = {
    classList: classList(),
    style: {},
    dataset: { trip: "trip-1" },
    closest: (sel) => (sel === ".trip-slot" ? slot : null),
    setPointerCapture() {},
  };
  const head = { closest: (sel) => (sel === ".trip-card" ? card : null) };
  const target = { closest: (sel) => (sel === ".trip-card-head" ? head : null) };
  const list = { addEventListener: (type, fn) => (handlers[type] = fn) };

  lift("enableTripSwipe", {
    $: (sel) => (sel === "#trips" ? list : null),
    toggleArchive: (id) => archived.push(id),
    gestureAllowed,
    // The REAL rule, so "locked" here means what it means on the phone.
    writeAccess,
    lockedTrips: () => (locked ? ["trip-1"] : []),
  })();

  const at = (x) => ({ target, clientX: x, clientY: 100, pointerId: 7, pointerType });
  handlers.pointerdown(at(300));
  handlers.pointermove(at(300 + dx));
  const dragged = card.style.transform;
  handlers.pointerup(at(300 + dx));
  return { archived, swiped: card.dataset.swiped, dragged };
}

test("dragging a trip name with a mouse selects text — it must not archive", () => {
  assert.deepEqual(swipe({ pointerType: "mouse", dx: -120 }).archived, []);
});

test("the same drag with a finger still archives", () => {
  assert.deepEqual(swipe({ pointerType: "touch", dx: -120 }).archived, ["trip-1"]);
});

test("a short finger drag still does not archive", () => {
  assert.deepEqual(swipe({ pointerType: "touch", dx: -40 }).archived, []);
});

// ---------- and a read-only trip refuses it (S6-1) ----------
//
// Reproduced in a browser against the served tree before this was
// written: a trip in settings.lockedTripIds, its card showing the
// "Read-only" pill and no pencil, dragged 140px left with touch pointers
// → toast `Archived “Goa”`, the card gone from the list, and
// tripcash:trips going archived false→true with updatedAt restamped
// 1786373469324 → 1786376565233. A locked device never pushes, so that
// fresh stamp waits for access to return and then wins the merge against
// every change the co-members made meanwhile (ADR-0014/0016/0017).
//
// openEditor guarded the editor's Archive button. The swipe is the other
// door to the same function, and on a phone it is the primary one.

test("a swipe cannot archive a trip this device may not write to", () => {
  assert.deepEqual(swipe({ pointerType: "touch", dx: -140, locked: true }).archived, []);
});

test("…and it does not offer to, either", () => {
  // The Archive panel sits behind the card and is revealed by dragging
  // the card off it. A card that follows the finger promises an action
  // that will not happen — worse than not moving, because the person
  // repeats the gesture harder.
  assert.equal(swipe({ pointerType: "touch", dx: -140, locked: true }).dragged, undefined);
  assert.equal(swipe({ pointerType: "touch", dx: -140 }).dragged, "translateX(-140px)",
    "…while an ordinary card must still follow the finger");
});

test("the swipe threshold and the swallowed click are untouched", () => {
  // Both were fixes in their own right. A guard added above them must
  // not quietly change what happens below them.
  assert.match(app, /if \(active && dx < -80\) toggleArchive\(id\);/);
  assert.match(app, /if \(active\) card\.dataset\.swiped = "1";/);
  assert.equal(swipe({ pointerType: "touch", dx: -120 }).swiped, "1");
});

// The function itself, not just the gesture that reaches it. Suppressing
// the reveal is what the person sees; this is what stops the write when
// something else finds its way here — which is exactly how this bug
// existed at all, since openEditor already guarded the other door.
function archiveRun({ locked }) {
  const trip = { id: "t-goa", name: "Goa", archived: false };
  const saved = [];
  const toasts = [];
  const run = lift("toggleArchive", {
    trips: [trip],
    settings: { pinnedTripId: null, activeTripId: null },
    updateSettings: (patch) => patch,
    store: { setSettings: (patch) => patch },
    saveTrips: () => saved.push(structuredClone(trip)),
    buzz() {},
    renderTrips() {},
    toast: (msg) => toasts.push(msg),
    writeAccess,
    lockedTrips: () => (locked ? ["t-goa"] : []),
  });
  run("t-goa");
  return { trip, saved, toasts };
}

test("archiving a read-only trip changes nothing and says why", () => {
  const { trip, saved, toasts } = archiveRun({ locked: true });
  assert.equal(trip.archived, false, "the trip must not be archived");
  assert.deepEqual(saved, [], "and nothing may be written — saveTrips restamps updatedAt");
  assert.deepEqual(toasts, [writeAccess("t-goa", ["t-goa"]).why],
    "the person gets the same sentence every other refused write gives them");
});

test("archiving an ordinary trip is untouched by that", () => {
  const { trip, saved, toasts } = archiveRun({ locked: false });
  assert.equal(trip.archived, true);
  assert.equal(saved.length, 1, "…written exactly once");
  assert.equal(saved[0].archived, true, "…with the change in it");
  assert.match(toasts[0], /^Archived/);
});

// ---------- pull-to-dismiss ----------

function pull({ pointerType, dy }) {
  const handlers = {};
  const asked = [];
  let closed = 0;
  const zone = {
    addEventListener: (type, fn) => (handlers[type] = fn),
    setPointerCapture() {},
  };
  const dialog = {
    id: "settings-sheet",
    style: {},
    querySelector: (sel) => (sel === ".grab-zone" ? zone : null),
    close: () => closed++,
  };

  lift("enableSheetPull", {
    gestureAllowed,
    setTimeout: (fn) => fn(),
    dismissSheet: (d, how) => {
      asked.push(how);
      d.close();
      return "close";
    },
  })(dialog);

  const at = (y) => ({ clientY: y, pointerId: 7, pointerType });
  handlers.pointerdown(at(100));
  handlers.pointermove(at(100 + dy));
  handlers.pointerup(at(100 + dy));
  return { closed, asked };
}

test("a mouse drag down the grab zone must not close the sheet", () => {
  assert.equal(pull({ pointerType: "mouse", dy: 120 }).closed, 0);
});

test("a finger drag down the grab zone still closes it", () => {
  assert.equal(pull({ pointerType: "touch", dy: 120 }).closed, 1);
});

test("a short finger drag still springs back", () => {
  assert.equal(pull({ pointerType: "touch", dy: 40 }).closed, 0);
});

// ---------- does this sheet hold work? ----------

const EMPTY_EXPENSE = { name: "", amount: null, description: "", receipt: false };

test("a freshly opened expense sheet holds nothing", () => {
  assert.equal(unsavedIn({ dialogId: "expense-sheet", expense: EMPTY_EXPENSE }), false);
  assert.equal(unsavedIn({ dialogId: "expense-sheet" }), false);
});

test("anything typed into the expense sheet counts as work", () => {
  for (const field of ["name", "amount", "description"]) {
    assert.equal(
      unsavedIn({ dialogId: "expense-sheet", expense: { ...EMPTY_EXPENSE, [field]: "Lunch" } }),
      true,
      `a filled ${field} is work in progress`
    );
  }
  // Whitespace is not work.
  assert.equal(unsavedIn({ dialogId: "expense-sheet", expense: { ...EMPTY_EXPENSE, name: "   " } }), false);
  // A photographed receipt is buffered in memory until Save — losing the
  // sheet loses the photo, and the fridge it came off is long gone.
  assert.equal(unsavedIn({ dialogId: "expense-sheet", expense: { ...EMPTY_EXPENSE, receipt: true } }), true);
});

// An expense opened to be READ arrives with every field already filled,
// so "does it have content?" answers "yes, dirty" about a sheet nobody
// has touched. The editor branch has always compared against what the
// sheet showed when it opened; this one did not.
const OPENED_EXPENSE = { name: "Lunch", amount: 1250, description: "", receipt: true };
const expenseState = (over = {}) => ({ ...OPENED_EXPENSE, ...over, opened: OPENED_EXPENSE });

test("a saved expense opened to be looked at holds nothing", () => {
  assert.equal(unsavedIn({ dialogId: "expense-sheet", expense: expenseState() }), false);
  // Retyping a field to the value it already had is not work either, and
  // the amount arrives back from the field as the number it parsed to.
  assert.equal(unsavedIn({ dialogId: "expense-sheet", expense: expenseState({ name: "  Lunch  " }) }), false);
  assert.equal(unsavedIn({ dialogId: "expense-sheet", expense: expenseState({ amount: "1250" }) }), false);
});

test("changing a saved expense is work worth keeping", () => {
  const dirty = (over) => unsavedIn({ dialogId: "expense-sheet", expense: expenseState(over) });
  assert.equal(dirty({ name: "Lunch and coffee" }), true);
  assert.equal(dirty({ amount: 1300 }), true);
  assert.equal(dirty({ amount: null }), true);
  assert.equal(dirty({ description: "with Bo" }), true);
  // Taking the receipt off is a change; it is applied at Save like the rest.
  assert.equal(dirty({ receipt: false }), true);
});

// The four fields above were the only four the question ever asked
// about, and the sheet collects nine. Correcting who paid for dinner —
// the single likeliest reason anyone opens a saved expense — was thrown
// away on a backdrop click without a word, and a wrong payer points the
// debt at the wrong person for the rest of the trip. Worse for the
// currency: homeValue is snapshotted at Save and deliberately never
// re-priced, so a lost correction there is wrong permanently, on every
// phone.
const FULL_EXPENSE = {
  type: "food", name: "Lunch", amount: 1250, description: "", code: "THB",
  paidBy: "m1", split: { mode: "equal", parts: { m1: 1, m2: 1 } },
  when: "2026-08-10T13:00", receipt: false,
};
const fullState = (over = {}) => ({ ...structuredClone(FULL_EXPENSE), ...over, opened: FULL_EXPENSE });

test("correcting who paid is work worth keeping", () => {
  assert.equal(unsavedIn({ dialogId: "expense-sheet", expense: fullState({ paidBy: "m2" }) }), true);
});

test("every field the expense sheet collects is defended", () => {
  // One case per field, so a field that stops being compared fails by
  // name rather than hiding behind the eight that still work.
  const changed = {
    type: "transport",
    name: "Dinner",
    amount: 1300,
    description: "with Bo",
    code: "EUR",
    paidBy: "m2",
    split: { mode: "equal", parts: { m1: 1, m2: 0 } },
    when: "2026-08-09T13:00",
    receipt: true,
  };
  for (const [field, value] of Object.entries(changed)) {
    assert.equal(
      unsavedIn({ dialogId: "expense-sheet", expense: fullState({ [field]: value }) }),
      true,
      `a changed ${field} must be defended`
    );
  }
  // And the whole point of comparing against what the sheet opened with:
  // an expense opened only to be read is not holding anything.
  assert.equal(unsavedIn({ dialogId: "expense-sheet", expense: fullState() }), false);
});

test("reordering the split's members is not a change", () => {
  // Adding a member mid-edit re-emits `parts` in whatever order the
  // object happens to iterate in. If that reads as dirty, an untouched
  // sheet asks "discard?" — the noise that trains people to click
  // through the one time it matters.
  assert.equal(
    unsavedIn({
      dialogId: "expense-sheet",
      expense: fullState({ split: { mode: "equal", parts: { m2: 1, m1: 1 } } }),
    }),
    false
  );
});

const OPENED = { name: "Goa", currencies: ["INR", "USD"], members: [{ id: "me", name: "Asha" }] };
const editorState = (over = {}) => ({ ...structuredClone(OPENED), opened: OPENED, ...over });

test("an untouched trip editor holds nothing", () => {
  assert.equal(unsavedIn({ dialogId: "editor-sheet", editor: editorState() }), false);
  // Member rows are cloned, so the comparison must not depend on key order.
  assert.equal(
    unsavedIn({
      dialogId: "editor-sheet",
      editor: editorState({ members: [{ name: "Asha", id: "me" }] }),
    }),
    false
  );
});

test("a changed name, currency or member is work worth keeping", () => {
  const dirty = (over) => unsavedIn({ dialogId: "editor-sheet", editor: editorState(over) });
  assert.equal(dirty({ name: "Goa trip" }), true);
  assert.equal(dirty({ currencies: ["INR"] }), true);
  assert.equal(dirty({ currencies: ["INR", "USD", "THB"] }), true);
  assert.equal(dirty({ members: [{ id: "me", name: "Asha" }, { id: "m2", name: "Bo" }] }), true);
  assert.equal(dirty({ members: [{ id: "me", name: "Priya" }] }), true);
});

test("sheets that only show things never ask", () => {
  for (const id of ["summary-sheet", "settings-sheet", "scan-sheet", "attach-sheet", "confirm-sheet"]) {
    assert.equal(unsavedIn({ dialogId: id }), false, `#${id} collects nothing`);
  }
});

// ---------- what a dismissal means ----------

test("only an accidental dismissal of unsaved work asks", () => {
  for (const how of ["backdrop", "escape", "pull"]) {
    assert.equal(onDismiss({ dirty: true, how }), "confirm", `${how} on a dirty sheet must ask`);
    assert.equal(onDismiss({ dirty: false, how }), "close", `${how} on an empty sheet must not`);
  }
  // Pressing a control that says Close is not an accident.
  assert.equal(onDismiss({ dirty: true, how: "close-button" }), "close");
  assert.equal(onDismiss({}), "close");
});

// ---------- the wiring ----------

test("both accidental exits go through the one rule", () => {
  // The backdrop handler used to close ANY sheet unconditionally, and
  // there was no `cancel` listener at all, so Esc was a second copy of
  // the same hole. Both now route to one dismissal helper; asserting
  // that is stronger than asserting each calls onDismiss itself, because
  // two call sites are two places for the rule to drift.
  const backdrop = blockAfter(app, 'dialog.addEventListener("click"');
  const escape = blockAfter(app, 'dialog.addEventListener("cancel"');

  assert.match(backdrop, /dismissSheet\(dialog, "backdrop"\)/, "the backdrop must ask before closing");
  assert.match(escape, /dismissSheet\(dialog, "escape"\)/, "Esc must ask before closing");
  for (const [name, body] of [["backdrop", backdrop], ["cancel", escape]]) {
    assert.equal(body.includes(".close()"), false,
      `the ${name} path must not close a sheet behind the rule's back`);
  }
  assert.match(escape, /preventDefault\(\)/, "Esc's native close has to be stopped when we ask");

  const helper = declOf(app, "dismissSheet");
  assert.match(helper, /onDismiss\(\{/, "dismissSheet is where the rule is consulted");
  assert.equal(app.split("onDismiss({").length - 1, 1, "one caller, so the rule cannot drift");
  // …and the dirty answer is js/desktop.js's too, not a second opinion.
  assert.match(declOf(app, "sheetHasWork"), /unsavedIn\(\{/);
  assert.equal(app.split("unsavedIn({").length - 1, 1);
});

test("pulling a sheet down asks the same question", () => {
  assert.match(declOf(app, "enableSheetPull"), /dismissSheet\(dialog, "pull",/);
});

// ---------- a sheet that moves under the finger is not a backdrop ----------
//
// The trip editor changes HEIGHT while it is open. Putting the caret in
// the currency search turns it into a full-height picking layer (top 0);
// blurring the field with the box still empty collapses it back to an
// 88dvh sheet (top 80 on an iPhone SE). That collapse is the only way
// back to the trip-name field, so it has to stay — but it is triggered
// by the blur that the tap ITSELF causes, and it lands between the
// finger going down and the click being dispatched:
//
//   pointerdown -> sheetTop=0 ... blur -> renderEditor ... click -> sheetTop=80
//
// The dismissal read the rect when the CLICK arrived, so a tap on the
// layer's own title — at a point that was 40px inside the sheet when the
// finger landed — was measured against a sheet that had since moved out
// from under it, and read as a tap on a backdrop that did not exist
// (while picking, the layer is 100dvh and full width: there is no
// backdrop on a phone at all). One tap threw a half-built trip away.
//
// So a dismissal needs both ends of the gesture. Where the finger LANDED
// is the half a re-render cannot revise.

// The real handler, driven with a pointer sequence across a sheet whose
// rect changes in the middle of it. `downRect` is what the sheet was
// when the finger went down, `upRect` what it had become by the click.
function backdropTap({ downRect, upRect = downRect, at, onChild = false }) {
  const dismissed = [];
  const handlers = {};
  let rect = downRect;
  const dialog = {
    addEventListener: (type, fn) => (handlers[type] = fn),
    getBoundingClientRect: () => rect,
  };
  lift("enableBackdropDismiss", {
    dismissSheet: (_d, how) => dismissed.push(how),
    outsideSheet, backdropDismiss,
  })(dialog);
  const ev = () => ({ target: onChild ? { id: "editor-title" } : dialog, clientX: at.x, clientY: at.y });
  handlers.pointerdown?.(ev());
  rect = upRect;
  handlers.click(ev());
  return dismissed;
}

const PICKING = { left: 0, right: 375, top: 0, bottom: 667 };   // the full-height layer
const SHEET = { left: 0, right: 375, top: 80, bottom: 667 };    // .sheet.tall, 88dvh

test("a tap the sheet then shrinks away from is not a backdrop tap", () => {
  // (200,40): the "New trip" title row of the picking layer. Measured in
  // Chromium at 375x667 with touch emulation — pointerdown at sheetTop=0,
  // click at sheetTop=80, and the editor asked to throw the trip away.
  assert.deepEqual(backdropTap({ downRect: PICKING, upRect: SHEET, at: { x: 200, y: 40 } }), [],
    "the sheet moved between the finger landing and the click; that is not a backdrop");
});

test("every point the thumb reaches at the top of the picking layer is safe", () => {
  // The grab handle, the title row, and the label that TELLS the user to
  // pick a currency. All five were reproduced closing the editor.
  for (const at of [{ x: 188, y: 12 }, { x: 60, y: 40 }, { x: 200, y: 40 },
                    { x: 60, y: 78 }, { x: 300, y: 78 }]) {
    assert.deepEqual(backdropTap({ downRect: PICKING, upRect: SHEET, at }), [],
      `(${at.x},${at.y}) was inside the layer when the finger landed`);
  }
});

test("a real tap on the backdrop still dismisses the sheet", () => {
  // The other half: a sheet nobody can dismiss by tapping past it is a
  // different bug. 88dvh leaves 80px of genuine backdrop above the sheet
  // even on a phone, and that tap must still work.
  assert.deepEqual(backdropTap({ downRect: SHEET, at: { x: 200, y: 40 } }), ["backdrop"]);
  assert.deepEqual(backdropTap({ downRect: SHEET, at: { x: 200, y: 700 } }), ["backdrop"]);
});

test("a tap inside the sheet dismisses nothing", () => {
  assert.deepEqual(backdropTap({ downRect: SHEET, at: { x: 200, y: 300 } }), []);
});

test("a click on one of the sheet's children is never a dismissal", () => {
  assert.deepEqual(backdropTap({ downRect: SHEET, at: { x: 200, y: 40 }, onChild: true }), []);
});

test("a click with no pointer behind it dismisses nothing", () => {
  // A synthesised click carries (0,0), which is outside every sheet.
  // The old handler's only defence was that such a click targets the
  // child that was activated; one dispatched at the dialog itself walked
  // straight through. Evidence of a finger is now required.
  const dismissed = [];
  const handlers = {};
  const dialog = {
    addEventListener: (type, fn) => (handlers[type] = fn),
    getBoundingClientRect: () => SHEET,
  };
  lift("enableBackdropDismiss", { dismissSheet: (_d, how) => dismissed.push(how), outsideSheet, backdropDismiss })(dialog);
  handlers.click({ target: dialog, clientX: 0, clientY: 0 });
  assert.deepEqual(dismissed, []);
});

test("app.js asks where the point is in one place, and desktop.js answers", () => {
  // The geometry was written inline as `e.clientY < r.top || …`. Written
  // out a second time — for the pointerdown, say — it is the shape this
  // codebase keeps shipping: one rule in two places, drifting.
  const decl = declOf(app, "enableBackdropDismiss");
  assert.match(decl, /outsideSheet\(/, "the backdrop handler must not measure the rect itself");
  assert.equal(/client[XY]\s*[<>]/.test(app), false,
    "js/app.js compares a click's coordinates against a rect by hand somewhere");
});

// The other half of the same defect: a sheet that moves does not only
// invent a backdrop, it also moves its own controls out from under the
// finger. Measured at 375x667 with touch emulation, the ✕ over the
// currency layer sits at x=321-365, y=8-52; the blur the tap causes
// drops it 80px, the click is re-targeted at the dialog, and the ✕'s own
// listener never runs. Before this it fell through to the backdrop path
// and asked "Throw these changes away?" — the sheet's Close button
// asking the question that is reserved for accidents. After the
// backdropDismiss fix and before this one it did nothing at all, which
// is worse: while picking, the form is display:none, so the ✕ is the
// only labelled way off that layer.
function closeButtonOf() {
  const on = {};
  const closed = [];
  const button = { type: "", className: "", innerHTML: "", setAttribute() {},
    addEventListener: (t, fn) => (on[t] = fn) };
  const sheet = { close: () => closed.push("closed"),
    querySelector: (s) => (s === ":scope > h2" ? { after() {} } : null) };
  lift("addSheetCloseButtons", {
    document: { querySelectorAll: () => [sheet], createElement: () => button },
    ICONS: { close: "<svg></svg>" },
  })();
  return { on, closed };
}

test("the ✕ closes its sheet, and a re-render cannot steal the tap", () => {
  const { on, closed } = closeButtonOf();
  on.click();
  assert.deepEqual(closed, ["closed"], "the ✕ must close its own sheet");
  assert.ok(on.mousedown,
    "the ✕ must hold the focus where it is, or a sheet that re-renders on blur moves out from under the tap");
  let prevented = false;
  on.mousedown({ preventDefault: () => (prevented = true) });
  assert.equal(prevented, true);
});

test("closing by the ✕ is never routed through the accidental path", () => {
  // "backdrop", "escape" and "pull" are what a person did not mean to
  // do. Pressing a control labelled Close is not one of them, and the ✕
  // asking "throw this away?" is how that question stops being read.
  assert.equal(onDismiss({ dirty: true, how: "close-button" }), "close");
  assert.equal(declOf(app, "addSheetCloseButtons").includes("dismissSheet"), false);
});

test("outsideSheet is the whole rect, not just its top edge", () => {
  const r = { left: 10, right: 100, top: 20, bottom: 200 };
  assert.equal(outsideSheet({ clientX: 50, clientY: 10 }, r), true, "above");
  assert.equal(outsideSheet({ clientX: 50, clientY: 210 }, r), true, "below");
  assert.equal(outsideSheet({ clientX: 5, clientY: 100 }, r), true, "left");
  assert.equal(outsideSheet({ clientX: 105, clientY: 100 }, r), true, "right");
  assert.equal(outsideSheet({ clientX: 50, clientY: 100 }, r), false, "inside");
  assert.equal(outsideSheet({ clientX: 10, clientY: 20 }, r), false, "on the corner");
  // No rect is not evidence of being outside one.
  assert.equal(outsideSheet({ clientX: 0, clientY: 0 }), false);
  assert.equal(outsideSheet(), false);
});

// ---------- opening a saved expense, driven for real ----------
//
// The rule above is only half the answer: the sheet has to HAND it what
// it opened with, and openExpense is where that snapshot has to be
// taken. So the real openExpense, sheetHasWork and dismissSheet are
// lifted together and run against one another.

// The expense sheet's module-level state, read out of js/app.js rather
// than restated here — a snapshot the app never declares is a
// ReferenceError in the browser and a passing test in a harness that
// kindly declares it for you.
function expenseSheetState() {
  const at = app.indexOf("// ----- expense sheet -----");
  assert.notEqual(at, -1, "js/app.js should still have an expense-sheet section");
  const lets = app.slice(at, app.indexOf("\nfunction ", at)).split("\n").filter((l) => l.startsWith("let "));
  assert.ok(lets.length, "…declaring the sheet's state");
  return lets.join("\n");
}

// Several declarations sharing that state, plus handles the test needs.
function liftTogether(names, scope, extras = "") {
  const keys = Object.keys(scope);
  const body = [
    expenseSheetState(),
    ...names.map((n) => declOf(app, n)),
    `return { ${[...names, extras].filter(Boolean).join(", ")} };`,
  ].join("\n\n");
  return new Function(...keys, body)(...keys.map((k) => scope[k]));
}

const TRIP = { id: "t1", name: "Goa", currencies: ["INR", "USD"], members: [{ id: "me", name: "Asha" }] };
const SAVED = {
  id: "e1", type: "food", name: "Lunch", description: "", amount: 1250, code: "INR",
  paidBy: "me", split: { mode: "equal", parts: { me: 1 } }, createdAt: 0,
};

function expenseSheet({ locked = false } = {}) {
  const asked = [];
  const els = new Map();
  const $ = (sel) => {
    if (!els.has(sel)) {
      els.set(sel, {
        id: sel.slice(1), value: "", max: "", textContent: "", innerHTML: "", hidden: false,
        open: false, disabled: false, dataset: {},
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        appendChild() {}, focus() {}, querySelector: () => null, querySelectorAll: () => [],
        showModal() { this.open = true; }, close() { this.open = false; },
      });
    }
    return els.get(sel);
  };

  const lifted = liftTogether(
    // openSheet comes along because openExpense opens the sheet through
    // it — lifting the real one keeps this driving the app's own code
    // rather than a stub that opens sheets some other way.
    //
    // So do the three that decide whether Save may fire. This harness
    // used to stub `setExpenseReadOnly() {}` and `renderExpenseForm() {}`,
    // which is precisely why it could not see S6-1's worst bug: the two
    // of them both wrote #e-save.disabled, and openExpense ran them in
    // the order that let the wrong one win.
    ["expenseFields", "openExpense", "openSheet", "sheetHasWork", "dismissSheet",
      "renderExpenseForm", "paintExpenseForm", "paintSaveButton", "setExpenseReadOnly"],
    {
      $,
      document: {
        createElement: () => ({ className: "", dataset: {}, textContent: "", innerHTML: "" }),
        querySelectorAll: () => [],
      },
      settings: { homeCurrency: "INR" },
      activeTrip: () => TRIP,
      ensureMembers: (t) => t.members,
      selfId: () => "me",
      equalSplit: (ms) => ({ mode: "equal", parts: Object.fromEntries(ms.map((m) => [m.id, 1])) }),
      currencyOptions: () => TRIP.currencies,
      toDatetimeLocal: () => "2026-08-10T12:00",
      formatAmount: (n) => String(n),
      renderAttachRow() {},
      // openExpense asks whether this trip may be changed before it
      // offers to change anything (S6-1). The REAL rule is lifted, so
      // an unlocked device gives exactly the ordinary-trip cases these
      // were written as.
      writeAccess,
      lockedTrips: () => (locked ? [TRIP.id] : []),
      toast() {},
      // What paintExpenseForm reaches for. The two that DECIDE anything —
      // whyBlocked and splitValid — are the real ones; the rest only
      // paint, and a stub that paints nothing is honest about that.
      EXPENSE_TYPES,
      whyBlocked,
      splitValid,
      allocate,
      referencedMembers,
      CURRENCIES,
      escapeHtml,
      memberChip: (m) => ({ ...m }),
      labelFor: (m) => m.name,
      // Rates are present and the expense is worth something: whyBlocked
      // then turns on the fields the sheet actually collects, which is
      // what these cases are about.
      previewHomeValue: () => 1000,
      previewIsLocked: () => false,
      localizeNumber: (n) => String(n),
      DEVICE_LOCALE: "en-US",
      localeFor: () => "en-US",
      fmtHome: (n) => `₹${n}`,
      slipCheck: () => null,
      writeExpenseSlip() {},
      announceExpenseSlip() {},
      preservingFocus: (_doc, fn) => fn(),
      editorPicked: [],
      editorMembers: [],
      editorAtOpen: { name: "", currencies: [], members: [] },
      unsavedIn,
      initialFocus,
      onDismiss,
      discardWording,
      askConfirm: (words) => asked.push(words),
    },
    // Typing goes straight at eState because that is all the real input
    // handlers do (`eState.name = e.target.value`), and the receipt is
    // buffered the same way. `joinSplit` is what adding a member mid-edit
    // does to the open sheet (the addMemberFlow tail in js/app.js).
    'sheet: $("#expense-sheet"), typed: (f) => { eState[f[0]] = f[1]; }, '
      + 'receipt: (kind) => { eAttach = { kind }; }, '
      + 'joinSplit: (id) => { eState.split.parts[id] = 1; }'
  );
  return { ...lifted, asked, el: $ };
}

// ---------- what the sheet opens with under the Save button (S6-1) ----------
//
// Reproduced in a browser against the served tree before this was
// written. Ordinary trip, no locks anywhere. Type 500 into the THB row,
// tap "+ Expense": the sheet opens with the amount filled, the Name field
// empty, and the button reading "Name this expense" — its own
// disabled-state label — while `#e-save.disabled` was FALSE. One tap:
// toast "Expense added", and tripcash:expenses gained
// {"name":"", "amount":500, "homeValue":1166.67, …}. The ledger then shows
// a row with an emoji, an amount and no name, and it syncs to everyone.
//
// The window is exactly one tap wide — the first `input` event repaints
// the form and disables the button again — which is the tap a person
// makes when the button is the only thing on screen that looks like a
// next step.

test("a sheet that opens on an empty name opens with Save switched off", () => {
  const s = expenseSheet();
  s.openExpense(null, { amount: 5000, code: "USD" });
  const save = s.el("#e-save");
  assert.equal(save.textContent, "Name this expense",
    "the label must be the reason it is off — a disabled button can say nothing else");
  assert.equal(save.disabled, true,
    "…and the button must actually be off, not merely labelled as though it were");
  assert.equal(save.hidden, false, "it is still the thing to press once there is a name");
});

test("…and comes back on once the name is there", () => {
  // The other half: a guard that never lets go is a sheet nobody can save.
  const s = expenseSheet();
  s.openExpense(null, { amount: 5000, code: "USD" });
  s.typed(["name", "Lunch"]);
  s.renderExpenseForm();
  assert.equal(s.el("#e-save").disabled, false);
  assert.equal(s.el("#e-save").textContent, "Add expense");
});

test("a blank new expense is no different", () => {
  const s = expenseSheet();
  s.openExpense(null);
  assert.equal(s.el("#e-save").disabled, true);
});

test("on a read-only trip Save is gone and cannot be reached by keyboard", () => {
  // Hidden is what the eye gets; disabled is what Enter gets, and Enter
  // in a text field dispatches #e-save directly (see the keydown wiring).
  const s = expenseSheet({ locked: true });
  s.openExpense(SAVED);
  assert.equal(s.el("#e-save").hidden, true);
  assert.equal(s.el("#e-save").disabled, true);
  // …and the sentence explaining it is on screen.
  assert.equal(s.el("#e-locked").hidden, false);
  assert.equal(s.el("#e-locked").textContent, writeAccess(TRIP.id, [TRIP.id]).why);
});

test("a saved expense opened to be looked at closes without a question", () => {
  // Every accidental exit runs through dismissSheet (asserted above), so
  // one of them standing in for all three is the whole class.
  for (const how of ["backdrop", "escape", "pull"]) {
    const s = expenseSheet();
    s.openExpense(SAVED);
    assert.equal(s.sheetHasWork(s.sheet), false, `${how}: an untouched edit sheet holds nothing`);
    assert.equal(s.dismissSheet(s.sheet, how), "close");
    assert.deepEqual(s.asked, [], `${how} must not ask about work nobody did`);
    assert.equal(s.sheet.open, false, `${how} must actually close it`);
  }
});

test("…and so does one that already had a receipt on it", () => {
  const s = expenseSheet();
  s.openExpense({ ...SAVED, attachment: { name: "bill.jpg", type: "image/jpeg" } });
  assert.equal(s.dismissSheet(s.sheet, "backdrop"), "close");
  assert.deepEqual(s.asked, []);
});

test("but changing that expense and then losing the sheet still asks", () => {
  for (const change of [["name", "Lunch and coffee"], ["amount", 1300], ["desc", "with Bo"]]) {
    const s = expenseSheet();
    s.openExpense(SAVED);
    s.typed(change);
    assert.equal(s.dismissSheet(s.sheet, "escape"), "confirm", `an edited ${change[0]} must be defended`);
    assert.equal(s.sheet.open, true, "and the sheet must stay put while the question is up");
    assert.equal(s.asked.length, 1);
  }
});

test("taking the receipt off a saved expense is a change too", () => {
  const s = expenseSheet();
  s.openExpense({ ...SAVED, attachment: { name: "bill.jpg", type: "image/jpeg" } });
  s.receipt("none");
  assert.equal(s.dismissSheet(s.sheet, "backdrop"), "confirm");
});

test("a new expense sheet is unchanged by any of this", () => {
  const blank = expenseSheet();
  blank.openExpense(null);
  assert.equal(blank.dismissSheet(blank.sheet, "backdrop"), "close");

  const typed = expenseSheet();
  typed.openExpense(null);
  typed.typed(["name", "Lunch"]);
  assert.equal(typed.dismissSheet(typed.sheet, "backdrop"), "confirm");

  const photographed = expenseSheet();
  photographed.openExpense(null);
  photographed.receipt("new");
  assert.equal(photographed.dismissSheet(photographed.sheet, "backdrop"), "confirm");
});

test("an amount carried in from the converter is not typed work", () => {
  // "+ Expense" on the Convert tab opens the sheet with the amount
  // already in it. Nothing was typed into the SHEET, and the converter
  // still holds the number, so there is nothing here to lose.
  const s = expenseSheet();
  s.openExpense(null, { amount: 500, code: "USD" });
  assert.equal(s.dismissSheet(s.sheet, "backdrop"), "close");
  assert.deepEqual(s.asked, []);
});

test("correcting a saved expense and then losing the sheet asks too", () => {
  // The four fields the question used to ask about were the four a NEW
  // expense is typed into. These five are the ones you open a SAVED
  // expense to change, and every one of them was thrown away silently.
  for (const change of [["type", "transport"], ["code", "EUR"], ["paidBy", "m2"],
                        ["when", "2026-08-09T13:00"]]) {
    const s = expenseSheet();
    s.openExpense(SAVED);
    s.typed(change);
    assert.equal(s.dismissSheet(s.sheet, "backdrop"), "confirm", `an edited ${change[0]} must be defended`);
    assert.equal(s.sheet.open, true, "and the sheet must stay put while the question is up");
  }
  // Adding a member mid-edit folds them into the open split — a change
  // to how this expense is shared, made through a different sheet.
  const s = expenseSheet();
  s.openExpense(SAVED);
  s.joinSplit("m2");
  assert.equal(s.dismissSheet(s.sheet, "backdrop"), "confirm");
});

test("the snapshot is a copy, not a view of the sheet's own split", () => {
  // js/app.js mutates `eState.split.parts[id]` in place when a member is
  // added mid-edit. A snapshot sharing that object would change with the
  // sheet, so the sheet could never read dirty — the bug would survive
  // the fix and nothing would say so.
  const s = expenseSheet();
  s.openExpense(SAVED);
  const snap = s.expenseFields();
  s.joinSplit("m3");
  assert.equal(snap.split.parts.m3, undefined, "the snapshot must not move with eState");
});

test("the date the person picked lives in eState, not in the DOM", () => {
  // "When" was the one field of the nine that was never in eState at
  // all: openExpense wrote it into the input and saveExpense read it
  // back out at Save. A field the snapshot cannot see is a field the
  // question cannot ask about, and no amount of comparing fixes it.
  assert.match(declOf(app, "openExpense"), /eState\.when = toDatetimeLocal\(/);
  // declOf only matches a plain declaration, and saveExpense is async.
  const save = blockAfter(app, "async function saveExpense");
  assert.match(save, /fromDatetimeLocal\(eState\.when\)/);
  assert.equal(save.includes("#e-when"), false,
    "saveExpense must not read the picker back out of the DOM");
  const wiring = blockAfter(app, '$("#e-when").addEventListener(');
  assert.match(wiring, /eState\.when = /, "and what the person picked has to reach eState");
  // Save no longer reads the field, so an edit that fires neither event
  // would be written back at the value the sheet opened with — silently,
  // and to the date the whole ledger sorts by. Typing a segment fires
  // `input`; committing the native picker fires `change`. The marker is
  // the assertion: drop either event and this stops matching.
  assert.match(blockAfter(app, 'for (const ev of ["input", "change"])'), /#e-when/);
  // The field is written when the sheet opens and read nowhere.
  assert.equal(app.split('$("#e-when").value').length - 1, 1);
});

test("the snapshot and the comparison read the same fields", () => {
  // Two hand-written projections of eState would be the drift this
  // project keeps paying for: a field added to one and not the other is
  // a sheet that is dirty from the moment it opens, or never dirty at all.
  assert.match(declOf(app, "openExpense"), /eOpened = expenseFields\(\)/);
  assert.match(declOf(app, "sheetHasWork"), /expenseFields\(\)/);
  assert.equal(app.split("eAttach?.kind !== \"none\"").length - 1, 1);
});

// The keys of the object literal that starts after `marker`, comments
// stripped. Only ever pointed at flat literals, which both of these are.
function literalKeys(source, marker) {
  const at = source.indexOf(marker);
  assert.notEqual(at, -1, `expected to find ${marker}`);
  const open = source.indexOf("{", at);
  let depth = 0, end = -1;
  for (let i = open; i < source.length && end === -1; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) end = i;
  }
  assert.notEqual(end, -1, `unclosed literal after ${marker}`);
  const body = source.slice(open + 1, end).split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
  return new Set([...body.matchAll(/^\s*([A-Za-z_]\w*)\s*:/gm)].map((m) => m[1]));
}

test("what the sheet snapshots and what the question compares cannot drift", () => {
  // This is the bug itself, not a symptom of it. `expenseFields` listed
  // four fields and eState carried seven; the comparison asked about the
  // four, so changing the payer, the split, the currency or the type of
  // a saved expense was silently discardable. Adding a tenth field to
  // one side and not the other now fails here, by name.
  const projected = literalKeys(declOf(app, "expenseFields"), "return");
  const compared = literalKeys(desktop, "const EXPENSE_FIELDS");
  assert.ok(compared.has("paidBy") && compared.has("split"),
    "the list must be the real one, not an empty match");
  assert.deepEqual([...projected].sort(), [...compared].sort());
  // …and the branch must actually read that list rather than keep its
  // own copy of the answer.
  assert.match(blockAfter(desktop, 'if (dialogId === "expense-sheet")'), /EXPENSE_FIELDS/);
});

// ---------- the confirmation ----------

test("the confirm sheet takes its words and its action from the caller", () => {
  // It was hardwired to deleteTrip(editorId), so nothing else could ever
  // ask a question.
  const go = blockAfter(app, '$("#confirm-go").addEventListener("click"');
  assert.equal(go.includes("deleteTrip("), false,
    "#confirm-go must run whatever it was asked to run, not one hardcoded thing");
  assert.match(read("js/app.js"), /function askConfirm\(/, "one place builds the confirmation");
});

test("deleting a trip still says exactly what it said", () => {
  // That sentence is itself a bug fix: the count used to REPLACE the
  // irreversibility warning, so the warning vanished precisely when
  // there was something to lose. Character for character.
  const arm = declOf(app, "armDelete");
  assert.ok(
    arm.includes('"Everyone on this trip loses it too, and this can\'t be undone."'),
    "the delete warning must survive being moved"
  );
  assert.match(arm, /\$\{bits\.join\(", "\)\} go with it\. /);
  assert.match(arm, /Delete “\$\{trip\.name\}”\?/);
  assert.match(arm, /deleteTrip\(/, "and it must still be what confirming does");
});

// ---------- what Enter means ----------

test("Enter does what it does everywhere else", () => {
  const enter = (inputId) => enterAction({ inputId });
  assert.equal(enter("editor-member-name"), "add-member");
  assert.equal(enter("m-name"), "add-member");
  assert.equal(enter("sync-pass"), "primary");
  assert.equal(enter("sync-email-input"), "primary");
  assert.equal(enter("e-amount"), "primary");
  assert.equal(enter("e-name"), "primary");
  assert.equal(enter("p-amount"), "primary");
  assert.equal(enter("trip-search"), "blur");
  assert.equal(enter("editor-search"), "blur");
  // A field nobody has thought about keeps today's behaviour.
  assert.equal(enter("profile-name"), "blur");
  assert.equal(enterAction({}), "blur");
});

test("the button Enter stands in for cannot be guessed from the DOM", () => {
  // The settings sheet holds three .primary buttons; only one of them is
  // what Enter in the password field means.
  assert.equal(enterButton({ inputId: "sync-pass" }), "email-create");
  assert.equal(enterButton({ inputId: "sync-email-input" }), "email-create");
  assert.equal(enterButton({ inputId: "e-amount" }), "e-save");
  assert.equal(enterButton({ inputId: "e-name" }), "e-save");
  assert.equal(enterButton({ inputId: "p-amount" }), "p-save");
  assert.equal(enterButton({ inputId: "trip-search" }), null);

  const html = read("index.html");
  for (const id of ["email-create", "e-save", "p-save"]) {
    assert.match(html, new RegExp(`id="${id}"`), `index.html must still hold #${id}`);
  }
});

test("in the email form Enter means whichever thing the form is set to do", () => {
  // Both fields mapped to #email-create unconditionally, so on a laptop
  // Enter always meant "create an account" — and a returning user typing
  // their password and pressing Enter was told their own email address
  // is already in use. "I already have one" was on screen the whole
  // time, unreachable by the keyboard's natural gesture.
  for (const inputId of ["sync-pass", "sync-email-input"]) {
    assert.equal(enterButton({ inputId, mode: "signin" }), "email-signin");
    assert.equal(enterButton({ inputId, mode: "create" }), "email-create");
    // A caller written before the mode existed keeps today's behaviour
    // rather than getting null and a keypress that does nothing.
    assert.equal(enterButton({ inputId }), "email-create");
    assert.equal(enterButton({ inputId, mode: "" }), "email-create");
    // Not an object lookup: a mode arriving as "__proto__" must be an
    // unknown mode, not Object.prototype.
    assert.equal(enterButton({ inputId, mode: "__proto__" }), "email-create");
    assert.equal(enterButton({ inputId, mode: "nonsense" }), "email-create");
  }
  // A mode means nothing to any other field; those are single-purpose.
  assert.equal(enterButton({ inputId: "e-amount", mode: "signin" }), "e-save");
  assert.equal(enterButton({ inputId: "trip-search", mode: "signin" }), null);
});

test("the form opens on the thing this device has been here for before", () => {
  // `settings.syncHint` means "this device has wanted to sync" — it is
  // set when a sign-in starts and cleared on sign-out. It is the only
  // honest signal available that somebody has been here before; a device
  // that has never wanted to sync is being asked to make an account.
  assert.equal(signInDefaultMode({ syncHint: true }), "signin");
  assert.equal(signInDefaultMode({ syncHint: false }), "create");
  assert.equal(signInDefaultMode({}), "create");
  assert.equal(signInDefaultMode(), "create");
});

test("the visible primary and what Enter presses are one decision", () => {
  // The bug this whole story is about is a button saying one thing and
  // Enter doing another. They cannot drift if there is one variable, one
  // writer, and one place that asks.
  assert.equal(app.split("enterButton(").length - 1, 1,
    "js/app.js must ask for the Enter target in exactly one place");
  const mode = /enterButton\(\{[^}]*mode:\s*([A-Za-z_$][\w$]*)/.exec(app);
  assert.ok(mode, "…and it must pass a mode, by name, so the assignment below can be counted");
  const writes = [...app.matchAll(new RegExp(`\\b${mode[1]}\\s*=[^=]`, "g"))];
  assert.equal(writes.length, 1,
    `${mode[1]} is assigned in ${writes.length} places; the one writer must also be ` +
    "the thing that paints the primary button, or the two go out of step");
  // That one writer is what moves `primary` onto the selected control.
  const writer = app.slice(0, writes[0].index).lastIndexOf("function ");
  const body = app.slice(writer, app.indexOf("\n}", writes[0].index) + 2);
  assert.match(body, /primary/,
    "the writer must also mark the selected option as the primary button");
  for (const id of ["email-signin", "email-create"]) {
    assert.match(body, new RegExp(`"${id}"`),
      `…and it must be the writer that moves it, for #${id} as well as its sibling`);
  }

  const html = read("index.html");
  assert.match(html, /id="email-mode"[^>]*role="radiogroup"/,
    "index.html must offer the two options explicitly, not hide one behind a guess");
  for (const mode of ["create", "signin"]) {
    assert.match(html, new RegExp(`data-email-mode="${mode}"`), `#email-mode needs a ${mode} option`);
  }
});

test("Enter never fires a button that is switched off", () => {
  // #e-save is disabled whenever the expense is incomplete, and its
  // LABEL is then the reason it is disabled. Enter firing it would be a
  // keypress that visibly does nothing.
  const wiring = blockAfter(app, 'document.addEventListener("keydown"');
  assert.match(wiring, /enterAction\(/, "the keydown handler must ask, not decide");
  assert.match(wiring, /enterButton\(/);
  assert.match(wiring, /\.disabled/, "a disabled primary must not be dispatched");
  assert.match(wiring, /\.click\(\)/);
});

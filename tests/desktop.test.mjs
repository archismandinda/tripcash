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
import { gestureAllowed, unsavedIn, discardWording, onDismiss, enterAction, enterButton }
  from "../js/desktop.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const app = read("js/app.js");

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
// 300+dx, up. Returns the ids toggleArchive was called with.
function swipe({ pointerType, dx }) {
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
  })();

  const at = (x) => ({ target, clientX: x, clientY: 100, pointerId: 7, pointerType });
  handlers.pointerdown(at(300));
  handlers.pointermove(at(300 + dx));
  handlers.pointerup(at(300 + dx));
  return { archived, swiped: card.dataset.swiped };
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

test("the swipe threshold and the swallowed click are untouched", () => {
  // Both were fixes in their own right. A guard added above them must
  // not quietly change what happens below them.
  assert.match(app, /if \(active && dx < -80\) toggleArchive\(id\);/);
  assert.match(app, /if \(active\) card\.dataset\.swiped = "1";/);
  assert.equal(swipe({ pointerType: "touch", dx: -120 }).swiped, "1");
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

function expenseSheet() {
  const asked = [];
  const els = new Map();
  const $ = (sel) => {
    if (!els.has(sel)) {
      els.set(sel, {
        id: sel.slice(1), value: "", max: "", textContent: "", innerHTML: "", hidden: false,
        open: false, dataset: {},
        classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
        appendChild() {}, focus() {}, querySelector: () => null,
        showModal() { this.open = true; }, close() { this.open = false; },
      });
    }
    return els.get(sel);
  };

  const lifted = liftTogether(
    ["expenseFields", "openExpense", "sheetHasWork", "dismissSheet"],
    {
      $,
      document: { createElement: () => ({}) },
      settings: { homeCurrency: "INR" },
      activeTrip: () => TRIP,
      ensureMembers: (t) => t.members,
      selfId: () => "me",
      equalSplit: (ms) => ({ mode: "equal", parts: Object.fromEntries(ms.map((m) => [m.id, 1])) }),
      currencyOptions: () => TRIP.currencies,
      toDatetimeLocal: () => "2026-08-10T12:00",
      formatAmount: (n) => String(n),
      renderExpenseForm() {},
      renderAttachRow() {},
      editorPicked: [],
      editorMembers: [],
      editorAtOpen: { name: "", currencies: [], members: [] },
      unsavedIn,
      onDismiss,
      discardWording,
      askConfirm: (words) => asked.push(words),
    },
    // Typing goes straight at eState because that is all the real input
    // handlers do (`eState.name = e.target.value`), and the receipt is
    // buffered the same way.
    'sheet: $("#expense-sheet"), typed: (f) => { eState[f[0]] = f[1]; }, receipt: (kind) => { eAttach = { kind }; }'
  );
  return { ...lifted, asked };
}

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

test("the snapshot and the comparison read the same fields", () => {
  // Two hand-written projections of eState would be the drift this
  // project keeps paying for: a field added to one and not the other is
  // a sheet that is dirty from the moment it opens, or never dirty at all.
  assert.match(declOf(app, "openExpense"), /eOpened = expenseFields\(\)/);
  assert.match(declOf(app, "sheetHasWork"), /expenseFields\(\)/);
  assert.equal(app.split("eAttach?.kind !== \"none\"").length - 1, 1);
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

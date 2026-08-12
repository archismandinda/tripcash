// The screen-reader contract for the two screens that decide money.
//
// A row of `<button>Priya</button>` with a CSS class for "chosen" is a row
// of unlabelled names to anyone not looking at it: the payer picker, and
// the from/to rows that decide which DIRECTION a settle-up moves. And the
// decimal-slip warning — the one guard against logging 250000 instead of
// 2500 — was a bare <div>, so it existed only for people watching the
// screen. Both are money bugs for a sighted user with VoiceOver on.
//
// ADR-0001 forbids dependencies and there is no DOM library in the tree,
// so the builders are exercised against a stub that implements exactly the
// five affordances they touch, and the markup that cannot be built (static
// HTML, CSS) is read as text — the shape tests/shell.test.mjs uses.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (f) => readFileSync(join(ROOT, f), "utf8");

// The smallest thing memberChip and syncSegState can be handed: className,
// dataset, textContent, setAttribute, getAttribute. Nothing else exists,
// so a builder reaching for more of the DOM fails loudly here.
function stubEl(className = "") {
  const attrs = new Map();
  return {
    className,
    dataset: {},
    textContent: "",
    setAttribute(k, v) { attrs.set(k, String(v)); },
    getAttribute(k) { return attrs.has(k) ? attrs.get(k) : null; },
  };
}
globalThis.document = { createElement: () => stubEl() };

const { memberChip, syncSegState } = await import("../js/ui.js");

// A container of stub buttons that answers the two queries syncSegState
// makes of a group: its own role, and the buttons inside it.
function stubGroup(role, children) {
  return { getAttribute: (k) => (k === "role" ? role : null), querySelectorAll: () => children };
}

test("a payer chip announces whether it is the one selected", () => {
  const on = memberChip({ id: "m1", name: "Priya" }, { on: true, data: "payer" });
  assert.equal(on.getAttribute("role"), "radio");
  assert.equal(on.getAttribute("aria-checked"), "true");

  const off = memberChip({ id: "m2", name: "Rahul" }, { data: "payer" });
  assert.equal(off.getAttribute("role"), "radio");
  assert.equal(off.getAttribute("aria-checked"), "false");
});

test("a payer chip still carries its name and its id", () => {
  const chip = memberChip({ id: "m1", name: "Asha" }, { data: "pfrom" });
  assert.equal(chip.textContent, "Asha");
  assert.equal(chip.dataset.pfrom, "m1");
});

test("the + Add chip is not announced as a fourth person", () => {
  // syncSegState marks every button under a radiogroup, and #e-payer ends
  // with a chip that opens the add-member dialog. Marked as a radio it
  // would be read as a selectable payer called "+ Add".
  const chosen = stubEl("member-chip on");
  const other = stubEl("member-chip");
  const add = stubEl("member-chip add");
  syncSegState(stubGroup("radiogroup", [chosen, other, add]));

  assert.equal(chosen.getAttribute("aria-checked"), "true");
  assert.equal(other.getAttribute("aria-checked"), "false");
  assert.equal(chosen.getAttribute("role"), "radio");
  assert.equal(other.getAttribute("role"), "radio");
  assert.equal(add.getAttribute("role"), null);
  assert.equal(add.getAttribute("aria-checked"), null);
});

test("a tablist still gets tabs, not radios", () => {
  const tab = stubEl("on");
  syncSegState(stubGroup("tablist", [tab]));
  assert.equal(tab.getAttribute("role"), "tab");
  assert.equal(tab.getAttribute("aria-selected"), "true");
  assert.equal(tab.getAttribute("aria-checked"), null);
});

const html = read("index.html");
const tagWithId = (id) => {
  const m = html.match(new RegExp(`<[a-z]+[^>]*\\bid="${id}"[^>]*>`));
  assert.ok(m, `index.html should contain an element with id="${id}"`);
  return m[0];
};

for (const [id, label] of [
  ["e-payer", "Paid by"],
  ["p-from", "From — who paid"],
  ["p-to", "To — who received"],
]) {
  test(`#${id} is a named group, not a loose row of buttons`, () => {
    const tag = tagWithId(id);
    assert.match(tag, /role="radiogroup"/, `#${id} needs role="radiogroup"`);
    // The visible <label> above these rows has no `for` and cannot get
    // one — the row is a div of buttons, not a form control — so the
    // group carries the same words itself.
    assert.match(tag, new RegExp(`aria-label="${label}"`), `#${id} needs aria-label="${label}"`);
  });
}

// Both of them: the expense sheet's and the converter's. Same guard, same
// wording, same 100x mistake — one being silent is the whole defect.
//
// It was role="alert", and that is where the guard turned on the field it
// guards. role="alert" is aria-live="assertive": every rendering
// INTERRUPTS whatever the reader is currently saying, and while you are
// typing into an amount field that is the echo of the digit you just
// pressed. Measured in Chromium: typing 250000 one key at a time
// produced four separate interruptions — "did you mean 25.00?", then
// 250.00, then 2,500.00, then 25,000.00 — of which only the last was
// true, and none of the six digits could be heard.
//
// So the assertion is stronger than it was, not weaker: still a live
// region, and now one that cannot talk over the keystroke. Speaking ONCE
// is the other half, and it belongs to the writer, not the markup —
// see slipAnnouncer below.
// These used to assert that #e-slip and #slip-warn were themselves the live
// regions. That was right about the property and wrong about the element,
// and the difference cost real money: one element serving both channels
// meant the settling delay written for screen readers also delayed the
// VISIBLE warning, so typing 250000 and reaching for Save 350ms later saved
// a 100x amount with nothing on screen. The warning is advisory — Save is
// not blocked — so arriving late is the same as not arriving.
//
// The property is unchanged and now pinned on BOTH halves: the visible one
// must NOT announce (that was the per-keystroke defect), and a hidden one
// must. Strictly more than the single assertion it replaces.
for (const id of ["e-slip", "slip-warn"]) {
  test(`#${id} is seen, not spoken — it is painted on every keystroke`, () => {
    const tag = tagWithId(id);
    assert.doesNotMatch(tag, /aria-live=/, `#${id} paints per keystroke; announcing it would talk over the digits`);
    assert.doesNotMatch(tag, /role="alert"/, `#${id} must not interrupt the character echo`);
  });

  test(`#${id}-live speaks the settled sentence`, () => {
    const tag = tagWithId(`${id}-live`);
    assert.match(tag, /aria-live="polite"/, `#${id}-live must announce`);
    assert.doesNotMatch(tag, /aria-live="assertive"/, `#${id}-live must not interrupt the character echo`);
    // A reader may otherwise speak only the digits that changed rather
    // than the sentence.
    assert.match(tag, /aria-atomic="true"/, `#${id}-live should be read whole`);
    assert.match(tag, /class="sr-only"/, `#${id}-live must not take up space beside the visible warning`);
  });
}

// The regression itself, pinned: the visible warning is written by a
// function with no timer in it, and the delayed announcer writes only to
// the -live regions. If anyone routes the visible paint back through
// slipAnnouncer, this fails.
test("the visible slip warning is painted with no delay", () => {
  const app = read("js/app.js");
  // To the function's own closing brace, not a fixed window — a fixed one
  // ran past it into the announcer definitions below and failed on their
  // use of slipAnnouncer, which is correct there.
  const at = app.indexOf("function paintSlip");
  assert.notEqual(at, -1, "js/app.js should define paintSlip");
  const paint = app.slice(at, app.indexOf("\n}\n", at));
  assert.ok(paint.includes("textContent"), "paintSlip should write the text directly");
  assert.doesNotMatch(paint, /setTimeout|slipAnnouncer|delay/,
    "the visible warning must not be scheduled — a 100x amount reached the ledger that way");
  for (const fn of ["writeConverterSlip", "writeExpenseSlip"]) {
    assert.match(app, new RegExp(`const ${fn} = \\(text\\) => paintSlip`),
      `${fn} must paint directly, not through the announcer`);
  }
  // …and both call sites do both halves.
  assert.equal((app.match(/writeConverterSlip\(slipText\)/g) || []).length, 1);
  assert.equal((app.match(/writeExpenseSlip\(slipText\)/g) || []).length, 1);
});

test("the home-currency preview is a live region", () => {
  assert.match(tagWithId("e-home-preview"), /aria-live="polite"/);
});

const app = read("js/app.js");

// A live region only announces changes to a node that stays put. Replacing
// it — innerHTML on the parent, or a fresh element — leaves the region the
// screen reader is watching behind, silently.
for (const id of ["e-home-preview"]) {
  test(`#${id} is written in place, so the live region survives`, () => {
    const at = app.search(new RegExp(`const \\w+ = \\$\\("#${id}"\\)`));
    assert.notEqual(at, -1, `js/app.js should hold #${id} in a variable to write it`);
    // Only the rest of the enclosing function: these are held in short
    // local names like `el` that mean something else three functions down.
    const end = app.indexOf("\n}\n", at);
    const body = app.slice(at, end === -1 ? app.length : end);
    const name = body.match(/const (\w+) =/)[1];
    assert.match(body, new RegExp(`\\b${name}\\.textContent\\s*=`), `#${id} should be written via textContent`);
    assert.doesNotMatch(body, new RegExp(`\\b${name}\\.innerHTML\\s*=`), `#${id} must not be rebuilt from HTML`);
  });
}

test("a selected chip is not distinguished by colour alone", () => {
  const css = read("styles.css");
  const rule = css.match(/^\s*\.member-chip\.on\s*\{([^}]*)\}/m);
  assert.ok(rule, "styles.css should declare .member-chip.on");
  // WCAG 1.4.1: colour cannot be the only visual means of conveying
  // state. Anything that changes only these is still colour.
  const COLOUR_ONLY = new Set(["color", "background", "background-color", "border-color", "outline-color"]);
  const props = rule[1]
    .split(";")
    .map((d) => d.split(":")[0].trim().toLowerCase())
    .filter(Boolean);
  const nonColour = props.filter((p) => !COLOUR_ONLY.has(p));
  assert.notDeepEqual(nonColour, [], `.member-chip.on differs only in colour: ${props.join(", ")}`);
});

// ---------------------------------------------------------------------
// Choosing a person must not throw the reader out of the sheet
// ---------------------------------------------------------------------
//
// Every one of these rows is rebuilt wholesale when you pick something in
// it: `payer.innerHTML = ""`, then a fresh chip per member. The button
// the user just activated no longer exists, so the browser resets focus
// to <body> — measured in Chromium 390x812, BUTTON "Bo" before, BODY
// after, for #e-payer, #etype-row, #p-from and #p-to alike. (#e-split-mode
// toggles classes instead of rebuilding, and focus stays put: the rebuild
// is the cause, not the platform.)
//
// <body> is outside the open <dialog>, so a VoiceOver/TalkBack cursor
// leaves the expense sheet entirely, and the aria-checked="true" that
// just became true is written on a node nobody is standing on — the one
// thing the row exists to say is the one thing not said. Recovering costs
// a full swipe back through the sheet (13 focusable controls of 23 sit
// ahead of the first payer chip), and recording a settle-up ejects you
// twice, From and To.

const { focusKey, matchesKey, preservingFocus, slipAnnouncer } = await import("../js/a11y.js");

// A stub element that can be focused and can be asked what it is. Same
// five affordances as stubEl, plus id/focus.
function stubControl({ id = "", data = {} } = {}) {
  return { id, dataset: { ...data }, focused: 0, focus() { this.focused++; } };
}

// The two things preservingFocus asks a document: who has focus, and what
// is in the tree. `[data-payer]` / `[id]` are the only selector shapes it
// builds, and it builds them out of a validated attribute name.
function stubDoc(tree) {
  return {
    tree,
    activeElement: null,
    querySelectorAll(sel) {
      const attr = sel.slice(1, -1);
      const key = attr === "id" ? null : attr.slice("data-".length);
      return this.tree.filter((el) => (key ? el.dataset[key] : el.id));
    },
  };
}

test("a control is identified by what it does, not by where it sits", () => {
  assert.deepEqual(focusKey(stubControl({ data: { payer: "m2" } })), { attr: "data-payer", value: "m2" });
  assert.deepEqual(focusKey(stubControl({ id: "sinc-m1", data: { sinc: "m1" } })), { attr: "id", value: "sinc-m1" });
  // Nothing to restore, and saying so is the point: a <div>, or <body>
  // itself, must not be "found" again by matching the first thing that
  // also has nothing.
  assert.equal(focusKey(stubControl()), null);
  assert.equal(focusKey(null), null);
  assert.equal(matchesKey(stubControl(), null), false);
  assert.equal(matchesKey(stubControl(), { attr: "data-payer", value: "m2" }), false);
});

test("the attribute a selector is built from is never taken on trust", () => {
  // The VALUE can be anything a member typed; the NAME is interpolated
  // into a selector, so a dataset key that isn't a plain attribute name
  // is refused rather than escaped.
  assert.equal(focusKey(stubControl({ data: { "bad]sel": "x" } })), null);
  assert.deepEqual(
    focusKey(stubControl({ data: { payer: 'Bo" ]' } })),
    { attr: "data-payer", value: 'Bo" ]' },
  );
});

test("rebuilding the payer row hands focus back to the chip that was chosen", () => {
  // THE BUG. Focus is on Bo, the row is rebuilt, and the node under the
  // cursor is deleted.
  const before = stubControl({ data: { payer: "m2" } });
  const doc = stubDoc([before]);
  doc.activeElement = before;

  preservingFocus(doc, () => {
    doc.tree = ["m1", "m2", "m3"].map((id) => stubControl({ data: { payer: id } }));
    doc.activeElement = null; // what the browser does: focus falls to <body>
  });

  const restored = doc.tree.find((el) => el.dataset.payer === "m2");
  assert.equal(restored.focused, 1, "the chip just chosen should hold focus");
  assert.deepEqual(doc.tree.filter((el) => el.focused).length, 1, "and only that one");
});

test("a render that did not disturb focus does not steal it back", () => {
  // renderExpenseForm runs on every keystroke in #e-name and #e-amount.
  // Those fields are not rebuilt, so there is nothing to restore — and
  // re-focusing a text field mid-word would move the caret.
  const typing = stubControl({ id: "e-amount" });
  const doc = stubDoc([typing]);
  doc.activeElement = typing;
  preservingFocus(doc, () => {});
  assert.equal(typing.focused, 0);
});

test("nothing is focused when the control genuinely went away", () => {
  // A member removed on the other phone mid-edit: the chip has no
  // replacement, and guessing a neighbour would silently move the payer
  // the reader thinks they are on.
  const gone = stubControl({ data: { payer: "m9" } });
  const doc = stubDoc([gone]);
  doc.activeElement = gone;
  preservingFocus(doc, () => {
    doc.tree = [stubControl({ data: { payer: "m1" } })];
    doc.activeElement = null;
  });
  assert.equal(doc.tree[0].focused, 0);
});

// The wiring, which is the half no stub can see. Both painters empty a
// row with innerHTML and rebuild it, so neither may be reachable except
// through the wrapper that puts focus back — restoring at the four click
// handlers instead would be the same rule in four places, which is how
// every bug this project has shipped to a phone was shaped.
const bodyOf = (name) => {
  const at = app.indexOf(`function ${name}(`);
  assert.notEqual(at, -1, `js/app.js should define ${name}`);
  const end = app.indexOf("\n}\n", at);
  return app.slice(at, end === -1 ? app.length : end);
};

for (const [wrapper, painter] of [
  ["renderExpenseForm", "paintExpenseForm"],
  ["renderPaymentSheet", "paintPaymentSheet"],
]) {
  test(`${wrapper} cannot rebuild a row without restoring focus`, () => {
    assert.match(
      bodyOf(wrapper),
      new RegExp(`preservingFocus\\(\\s*document\\s*,\\s*${painter}\\s*\\)`),
      `${wrapper} should run ${painter} inside preservingFocus`,
    );
    const uses = app.match(new RegExp(`\\b${painter}\\b`, "g")) ?? [];
    assert.equal(uses.length, 2, `${painter} must be reached only through ${wrapper}`);
  });
}

// ---------------------------------------------------------------------
// The decimal-slip guard speaks once, about the number that stayed
// ---------------------------------------------------------------------
//
// Six keystrokes (2 5 0 0 0 0, 120ms apart) rendered the warning four
// times. Even made polite, that is four consecutive sentences suggesting
// 25.00, then 250.00, then 2,500.00, then 25,000.00 — three of them
// already false when spoken. No test in the tree counted renderings
// across a burst of input; this one does.

// A clock that only moves when the test says so.
function fakeTimers() {
  const jobs = new Map();
  let seq = 0;
  return {
    schedule: (fn) => { jobs.set(++seq, fn); return seq; },
    cancel: (id) => { jobs.delete(id); },
    settle() { const due = [...jobs.values()]; jobs.clear(); for (const fn of due) fn(); },
  };
}

test("a burst of typing produces one warning, and it is the true one", () => {
  const t = fakeTimers();
  const written = [];
  const announce = slipAnnouncer((text) => written.push(text), { schedule: t.schedule, cancel: t.cancel });

  announce("");
  for (const amount of ["25.00", "250.00", "2,500.00", "25,000.00"]) {
    announce(`That's ₹x — did you mean ${amount}?`);
  }
  t.settle();

  assert.deepEqual(written, ["", "That's ₹x — did you mean 25,000.00?"]);
});

test("a warning typed past and corrected is never announced at all", () => {
  // Backspacing back under the threshold is the common case — the typo is
  // usually caught by the person making it. Clearing is immediate
  // because nobody needs to hear that a warning went away.
  const t = fakeTimers();
  const written = [];
  const announce = slipAnnouncer((text) => written.push(text), { schedule: t.schedule, cancel: t.cancel });

  announce("That's ₹x — did you mean 250.00?");
  assert.deepEqual(written, [], "the warning waits for the amount to settle");
  announce("");
  assert.deepEqual(written, [""], "but clearing it does not");
  t.settle();
  assert.deepEqual(written, [""]);
});

test("both decimal-slip warnings are written through the one announcer", () => {
  // Same guard, two screens: the expense sheet's #e-slip and the
  // converter's #slip-warn. Fixing one and leaving the other is the
  // shape of nearly every bug this project has shipped.
  assert.match(app, /import \{[^}]*\bslipAnnouncer\b[^}]*\} from "\.\/a11y\.js"/);
  assert.equal((app.match(/slipAnnouncer\(/g) ?? []).length, 2, "one announcer per slip region");
  for (const writer of ["writeExpenseSlip", "writeConverterSlip"]) {
    const uses = app.match(new RegExp(`\\b${writer}\\b`, "g")) ?? [];
    assert.equal(uses.length, 2, `${writer} must be reached only through its announcer`);
  }
});

// ---------------------------------------------------------------------
// A sheet opens on its own title, not on the way out of it
// ---------------------------------------------------------------------
//
// `dialog.showModal()` focuses the first focusable element of the dialog,
// and addSheetCloseButtons() put the X there — one `prepend` for all
// twelve sheets. Measured in Chromium at 375x812 on #settings-sheet: the
// active element on open was the .sheet-close button, border-radius
// 999px. Chromium reports `:focus-visible === false` for it so the ring
// is suppressed; WebKit treats focus moved by showModal() as
// focus-visible and draws one, which is the ring on the iPhone screenshot
// this came from. (That half is inferred — there is no Safari here.)
//
// The ring is the smaller half. A screen reader announces the focused
// element, so opening Profile said "Close, button" — the way out of the
// sheet named before the sheet.
//
// Measured after the fix, same 375x812 Chromium, all twelve sheets opened
// through their real controls: focus lands on the sheet's own <h2> every
// time and on .sheet-close never.
//
// The line that used to stand here said a real tap leaves the title
// `:focus-visible === false`, "so the ring is not simply moved from the X
// to the heading". That was measured in Chromium and written as if it
// were the rule. It is false on WebKit, which is the engine the report
// came from: measured on WebKit at 390x844, a real touch tap on
// #profile-btn leaves #settings-title `:focus-visible === true` with a
// 3px ring. Not a quirk of headings or of showModal — WebKit answers
// `:focus-visible === true` for ANY element focused programmatically,
// including a plain <button>, and delaying the focus() past the gesture
// task does not change it. So on WebKit the ring is moved to the heading
// rather than removed, and the only lever left is the SHAPE of the box it
// is drawn around; suppressing it needs an `outline: none`, which the
// last test in this file is here to forbid.

const { initialFocus, SHEET_TITLES } = await import("../js/a11y.js");

// Every <dialog class="sheet"> in the shipped markup, with its opening
// tag and its own <h2>. Parsed rather than listed: a thirteenth sheet
// must not be able to arrive without a title to open on.
const SHEETS = [...html.matchAll(/<dialog\b([^>]*\bclass="sheet[^"]*"[^>]*)>([\s\S]*?)<\/dialog>/g)]
  .map(([, openTag, body]) => ({
    id: openTag.match(/\bid="([^"]+)"/)?.[1],
    openTag,
    h2: body.match(/<h2\b[^>]*>/)?.[0] ?? "",
  }));

test("index.html still holds the twelve sheets these rules are about", () => {
  assert.equal(SHEETS.length, 12);
  assert.ok(SHEETS.every((s) => s.id), "every sheet needs an id to be opened by");
});

test("there is exactly one way to open a sheet", () => {
  // THE WIRING, and the reason this is worth a test at all: fourteen
  // call sites were fourteen chances for the fix to land in thirteen of
  // them. One helper, one place where focus is decided.
  assert.equal(app.split(".showModal()").length - 1, 1,
    "every sheet must open through openSheet(), which is the only caller of showModal()");
  const at = app.indexOf("function openSheet(");
  assert.notEqual(at, -1, "js/app.js should define openSheet");
  const body = app.slice(at, app.indexOf("\n}\n", at));
  assert.match(body, /\.showModal\(\)/, "the one showModal() call belongs to openSheet");
  assert.match(body, /initialFocus\(/, "openSheet must ask a11y.js where to start");
});

test("a sheet starts on its own title", () => {
  assert.equal(initialFocus({ dialogId: "settings-sheet" }), "settings-title");
  assert.equal(initialFocus({ dialogId: "editor-sheet" }), "editor-title");
  assert.equal(initialFocus({ dialogId: "expense-sheet" }), "expense-title");
});

test("a dialog nobody has a title for is left where the browser put it", () => {
  // The same non-action as preservingFocus's missing chip: guessing at a
  // neighbour is how a reader ends up somewhere it was never told about.
  assert.equal(initialFocus({ dialogId: "nonesuch" }), null);
  assert.equal(initialFocus({}), null);
  assert.equal(initialFocus(), null);
  // A table lookup must answer for what is in the table, not for what is
  // on Object.prototype.
  assert.equal(initialFocus({ dialogId: "constructor" }), null);
  assert.equal(initialFocus({ dialogId: "__proto__" }), null);
});

test("a sheet that exists to collect one thing still starts on it", () => {
  // Deliberate, and older than this rule: a brand-new expense opens on
  // the name field so you can type it. An edit has no such field to
  // start in, and opens on the title like everything else.
  assert.equal(initialFocus({ dialogId: "expense-sheet", prefer: "e-name" }), "e-name");
  assert.equal(initialFocus({ dialogId: "expense-sheet", prefer: null }), "expense-title");
  assert.equal(initialFocus({ dialogId: "expense-sheet", prefer: "" }), "expense-title");
});

for (const { id, openTag, h2 } of SHEETS) {
  test(`#${id} has a title to open on, and says its own name`, () => {
    const titleId = h2.match(/\bid="([^"]+)"/)?.[1];
    assert.ok(titleId, `#${id} needs an <h2 id="…">: focus has to have somewhere to land`);
    // Focusable programmatically, never a stop on the way through the
    // sheet — a heading in the tab order is a heading a keyboard user has
    // to tab past on the way to everything else.
    assert.match(h2, /\btabindex="-1"/, `#${id}'s title needs tabindex="-1" to be focusable at all`);
    // The ring is only half of it. Without aria-labelledby the dialog
    // itself is nameless, so a reader entering it announces the focused
    // node and nothing about where it now is.
    assert.match(openTag, new RegExp(`aria-labelledby="${titleId}"`),
      `#${id} needs aria-labelledby="${titleId}"`);
    assert.equal(initialFocus({ dialogId: id }), titleId,
      `a11y.js and index.html disagree about where #${id} opens`);
  });
}

test("the title table names sheets that exist, and only those", () => {
  // Both directions. A renamed sheet leaves an entry pointing at nothing,
  // and that entry is what openSheet would then hand to focus().
  assert.deepEqual([...SHEET_TITLES.keys()].sort(), SHEETS.map((s) => s.id).sort());
});

test("the way out is the next stop after the title, not the first", () => {
  // The close button is inserted after the sheet's own <h2>, so one Tab
  // from the opened title reaches it. Prepending put it ahead of
  // everything — which is exactly how it came to be focused on open.
  const at = app.indexOf("function addSheetCloseButtons(");
  assert.notEqual(at, -1);
  const body = app.slice(at, app.indexOf("\n}\n", at));
  assert.doesNotMatch(body, /\.prepend\(/, "prepending the X makes it the first focusable element");
  assert.match(body, /querySelector\(":scope > h2"\)/, "the X is placed relative to the title");
});

test("the title is not carried off into the scroller", () => {
  // Four sheets already keep their <h2> outside .sheet-scroll because
  // their markup has one; the other eight had theirs moved in at boot.
  // The X is pinned to the sheet, so the title it sits beside — and the
  // one Tab between them — has to be pinned too.
  const at = app.indexOf("function wrapSheetBodies(");
  assert.notEqual(at, -1);
  const body = app.slice(at, app.indexOf("\n}\n", at));
  assert.match(body, /tagName === "H2"/, "the sheet's own title stays a direct child of the dialog");
});

test("the ring around the title stops short of the way out", () => {
  // A focus ring is drawn around the FOCUSED BOX, and every sheet now
  // opens focus on its own <h2>. `.sheet-close` is positioned against the
  // dialog, not against the heading, so a heading that runs the full width
  // of the sheet and reserves the X's 44px as padding INSIDE itself puts
  // the X inside the ring. Measured on WebKit at 390x844: the title's box
  // was 354px wide, the ring ran the whole width of the sheet, and the
  // close button sat inside it — which reads as "the X is selected", the
  // exact impression this story exists to remove.
  //
  // Asserted as a relationship between the two rules rather than as the
  // literal fix: widen the X and the room reserved for it has to grow too.
  const css = read("styles.css");
  const close = css.match(/\.sheet-close \{([^}]*)\}/)?.[1] ?? "";
  const width = Number(close.match(/\bwidth: (\d+)px/)?.[1]);
  assert.ok(width > 0, ".sheet-close should still declare its own width");
  const title = [...css.matchAll(/\.sheet h2 \{([^}]*)\}/g)].map((m) => m[1]).join("\n");
  assert.ok(title, "styles.css should still have a rule for the sheet titles");
  // Room for the X kept OUTSIDE the heading's box…
  const reserved = Number(title.match(/max-width: calc\(100% - (\d+)px\)/)?.[1] ?? 0);
  assert.ok(reserved >= width,
    `the title's box must stop at least ${width}px short of the sheet's right edge`);
  // …and not as padding, which is inside the box and so inside the ring.
  assert.doesNotMatch(title, /padding-right/,
    "space reserved as padding is space inside the focus ring");
  // The title is a flex item of the dialog and stretches by default, so
  // even with the room reserved the ring would still be a bar across the
  // sheet rather than a box around the words.
  assert.match(title, /align-self: flex-start/,
    "the heading's box has to shrink to the words it contains");
});

test("the focus ring is still drawn, and still not suppressed", () => {
  // styles.css records that hiding it shipped once and made the app
  // unusable by keyboard. A sheet opening on its title is the fix; making
  // the ring invisible is the thing that had to be reverted.
  const css = read("styles.css");
  assert.match(css, /outline: 3px solid var\(--accent-strong\)/);
  // Two occurrences: the note recording the revert, and the one rule it
  // survived as — a mouse click does not get a ring. A third is somebody
  // hiding focus again.
  assert.equal((css.match(/outline: none/g) ?? []).length, 2,
    "suppressing focus was tried once and reverted — see the note above :focus-visible");
});

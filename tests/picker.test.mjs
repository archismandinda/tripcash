// The currency search must put its matches where a phone can see them.
//
// Measured on a 375x667 viewport (an iPhone SE), typing "Thai" into the
// new-trip currency search: the input's box was y=388-439, the THB row
// was y=496-563, and the sheet's one scroller reported
// scrollHeight === clientHeight === 426. An iPhone SE's keyboard, plus
// iOS's suggestion bar, plus the sheet's up/down/done accessory bar,
// cover from roughly y=367 down. So the INPUT was already under the
// keyboard, the only match was 128px below that, and the scroller had
// ZERO slack — there was nowhere for a "scroll the match into view" fix
// to scroll TO. It is a layout bug, not a scrolling one, and the owner
// concluded twice that the search was broken.
//
// The fix makes the currency step its own full-height layer with the
// input pinned at the top. That is the only arrangement whose input
// cannot fall under the keyboard however tall the rest of the editor
// grows — matches-above-the-input and per-keystroke scrolling both
// depend on the editor's height staying where it is today.
//
// Which layout is on screen is a DECISION, so it lives in js/picker.js
// and app.js only paints it. The geometry itself cannot be measured from
// node — there is no DOM here and ADR-0001 forbids adding one — so what
// is asserted below is the shape that produces it: the form above the
// search is out of the flow, the sheet is full height, the blank band is
// gone, and no nested scroller appeared. The numbers themselves are
// measured in a real browser and recorded in the sign-off.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { pickerMode, pickedRowVisible } from "../js/picker.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const SRC = read("js/app.js");
const CSS = read("styles.css");
const HTML = read("index.html");

// ---------- the decision ----------

test("an empty box nobody is in is the form", () => {
  assert.equal(pickerMode({ query: "", focused: false }), "form");
});

test("tapping into the box opens the picker before a letter is typed", () => {
  // Otherwise the layer only appears on the first keystroke, so the
  // keyboard comes up over the old layout and the field jumps out from
  // under the caret as soon as you type.
  assert.equal(pickerMode({ query: "", focused: true }), "picking");
});

test("a query holds the picker open after the field is blurred", () => {
  // Tapping a result blurs the field on Android. If that closed the
  // layer you could pick exactly one currency.
  assert.equal(pickerMode({ query: "Thai", focused: false }), "picking");
});

test("whitespace is not a query", () => {
  assert.equal(pickerMode({ query: "   ", focused: false }), "form");
});

test("the picked row exists only when something is picked", () => {
  assert.equal(pickedRowVisible([]), false);
  assert.equal(pickedRowVisible(["THB"]), true);
});

test("picker.js touches no DOM", () => {
  // A decision that reads the document cannot be tested here, which is
  // how the rules that matter ended up untested inside app.js.
  const source = read("js/picker.js");
  for (const forbidden of ["document", "window", "querySelector", "getElementById"]) {
    assert.ok(!source.includes(forbidden), `js/picker.js reaches for ${forbidden}`);
  }
});

test("the mode is view state and never reaches storage", () => {
  // Persisting it would put a keyboard's state in a trip record, and an
  // old client reading it would carry a layout it has no CSS for.
  for (const file of ["js/store.js", "js/prefs.js", "js/sync.js"]) {
    assert.ok(!read(file).includes("picker"), `${file} knows about the picker`);
  }
});

// ---------- the wiring, which is the half nothing else can check ----------

test("app.js decides the picker's mode in exactly one place", () => {
  const calls = SRC.split("\n")
    .filter((l) => l.includes("pickerMode("))
    .filter((l) => !/^\s*(import\b|\/\/|\*)/.test(l));
  assert.equal(calls.length, 1,
    `pickerMode( is called from ${calls.length} places in js/app.js; the mode is decided once`);
});

test("app.js never re-derives the condition pickerMode() owns", () => {
  // The recurring shape in this codebase is one rule written twice. The
  // focus flag is an INPUT to the decision, so app.js may set it and
  // hand it over — and may not test it.
  const offenders = SRC.split("\n")
    .map((line, i) => [i + 1, line])
    // Writing the flag is app.js's job; reading it is not. Take the
    // writes out of the line and see whether the name is still there.
    .map(([n, line]) => [n, line.replace(/(let\s+)?editorSearchFocused\s*=\s*(true|false);/g, "")])
    .filter(([, line]) => line.includes("editorSearchFocused"))
    .filter(([, line]) => !line.includes("pickerMode("));
  assert.deepEqual(offenders, [],
    `js/app.js reads editorSearchFocused outside the call to pickerMode(): ${JSON.stringify(offenders)}`);
});

test("app.js never names a picker mode", () => {
  // It applies what pickerMode() returned; it does not compare against
  // the words. A second copy of the vocabulary is a second copy of the
  // rule waiting to drift.
  assert.ok(!/["']picking["']/.test(SRC), 'js/app.js contains the literal "picking"');
  assert.ok(!/["']form["']/.test(SRC), 'js/app.js contains the literal "form"');
});

test("the picked row's height is driven by pickedRowVisible, not by app.js", () => {
  const line = SRC.split("\n").find((l) => l.includes("pickedRowVisible("));
  assert.ok(line, "js/app.js never calls pickedRowVisible()");
  assert.match(line, /editor-picked/,
    "pickedRowVisible() decides something other than #editor-picked");
});

test("the editor's focus flag is reset when the sheet opens", () => {
  // Left set, the sheet reopens straight into the picking layer with the
  // name field hidden — the first thing a stranger is asked to fill in.
  const open = SRC.slice(SRC.indexOf("function openEditor("), SRC.indexOf("function renderEditorMembers("));
  assert.match(open, /editorSearchFocused\s*=\s*false;/,
    "openEditor() does not clear editorSearchFocused");
});

// ---------- the shape that produces the geometry ----------

test("the form above the search can be taken out of the flow in one move", () => {
  // The name field, the member field and the member chips are what sit
  // between the top of the sheet and the search box. They have to leave
  // together or the input stays below the keyboard line.
  const sheet = HTML.slice(HTML.indexOf('id="editor-sheet"'), HTML.indexOf('id="settings-sheet"'));
  const form = sheet.slice(sheet.indexOf('class="editor-form"'), sheet.indexOf('for="editor-search"'));
  assert.ok(sheet.includes('class="editor-form"'), "the editor's form fields are not wrapped");
  for (const id of ["editor-name", "editor-member-name", "editor-members"]) {
    assert.ok(form.includes(`id="${id}"`), `#${id} is outside .editor-form and will not move`);
  }
  // …and the search and its results must NOT be inside it.
  assert.ok(!form.includes('id="editor-search"'), "#editor-search is inside the block that gets hidden");
});

test("the picking layer is full height and drops the form", () => {
  const layer = CSS.match(/#editor-sheet\[data-pick="picking"\][^{]*\{[^}]*\}/g) ?? [];
  const all = layer.join("\n");
  assert.match(all, /height:\s*100dvh/,
    "the picking layer is not full height, so the input keeps the sheet's top margin");
  assert.match(all, /max-height:\s*100dvh/,
    ".sheet's max-height: 88dvh still caps the layer");
  assert.ok(/#editor-sheet\[data-pick="picking"\]\s+\.editor-form\s*\{[^}]*display:\s*none/.test(CSS),
    "the form above the search is still in the flow while picking");
});

test("the blank band above the first match is gone", () => {
  // styles.css gave .picked min-height: 38px plus 10px of padding whether
  // or not anything was picked, so a ~56px empty band sat between the
  // query and the first result. With the keyboard up that band was the
  // only thing visible under the query, which is exactly what "the
  // results have vanished" looked like.
  // The `hidden` attribute is what removes it, and what makes the
  // attribute beat `.picked { display: flex }` is the floor at the top
  // of styles.css — `[hidden] { display: none !important }` — not a
  // companion rule beside .picked.
  //
  // There was one, `.picked[hidden] { display: none }`, and the comment
  // over it said the attribute "does nothing at all" without it. That
  // was false, and this test asserted the dead rule's presence, so the
  // false claim had a passing test under it. Checked in a browser at
  // 375x667: with the rule deleted from the live CSSOM, a fresh
  // `<div class="picked" hidden>` still computed display:none, height 0.
  // #empty-decoration proves it from the other side — .empty-emoji is
  // display:flex and is hidden by `el.hidden = true` alone.
  //
  // So what is asserted now is the mechanism that is actually load
  // bearing, and that it is stated ONCE: two rules that both hide the
  // row is one of them free to be edited by whoever believes it is the
  // one doing the work.
  // Rules only — the comment above the picked row quotes the floor, and
  // a prose mention of a rule is not the rule.
  const RULES = CSS.replace(/\/\*[\s\S]*?\*\//g, "");
  assert.match(RULES, /\.picked\s*\{[^}]*min-height:\s*38px/,
    "the band this hides is gone, so hiding the row no longer means anything");
  assert.ok(/\[hidden\]\s*\{[^}]*display:\s*none\s*!important/.test(RULES),
    "styles.css must keep the floor that makes `hidden` outrank an author display: rule");
  const floors = RULES.match(/\[hidden\]\s*\{[^}]*\}/g) ?? [];
  assert.deepEqual(floors, ["[hidden] { display: none !important; }"],
    `styles.css hides [hidden] elements in ${floors.length} places: ${floors.join(" / ")}`);
});

test("the picker still has no nested scroller", () => {
  // styles.css has recorded since the picker was written that a scroller
  // inside a bottom sheet is a touch trap, and that one squeezed this
  // very list to a single visible row. The layer changes the sheet's
  // height; it does not add a second scroller.
  const picker = CSS.slice(CSS.indexOf("/* ---------- Currency picker"), CSS.indexOf("/* ---------- Settings"));
  // `overflow: hidden` on a one-line detail is ellipsis, not scrolling;
  // auto and scroll are the ones that make a touch trap.
  assert.ok(!/overflow(-[xy])?:\s*(auto|scroll)/.test(picker),
    "something in the currency picker now scrolls on its own");
  const scrollers = CSS.split("\n").filter((l) => l.includes("overflow-y: auto") && l.includes("sheet"));
  assert.equal(scrollers.length, 1,
    "a bottom sheet has grown a second scroller; .sheet-scroll is meant to be the only one");
});

test("the layer is in the offline shell", () => {
  // Belt and braces beside tests/shell.test.mjs: a module missing from
  // SHELL is a blank app on a plane and nothing else notices.
  assert.match(read("sw.js"), /"\.\/js\/picker\.js"/);
});

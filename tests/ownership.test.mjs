// Who may touch what — the enforcement half of the app.js decomposition.
//
// The decomposition's target is not "smaller files", it is that every
// DOM id has exactly one writer and every decision module touches no DOM
// at all. This file is the scaffold that grows with the extraction: as
// slices land in js/screens/ and js/flow/, adding a module to a manifest
// below is ONE line, and the assertions then cover it.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

// ---------- manifests — each future slice is one added line ----------

// Modules that must not touch the DOM at all. State and decision
// modules belong here the moment they are created.
const DOM_FREE = [
  "js/state.js",
];

// Modules that carry io but paint nothing themselves. A flow talks to
// storage and the network, calls the decision modules, and hands the
// result to a painter it was given — it never addresses an element. This
// is a weaker rule than DOM_FREE above (a flow may ask the platform
// whether it is online) and a strictly stronger one than PAINTERS.
const IO_FLOWS = [
  "js/flow/sync.js",
];

// Modules that may paint. As screens/flows are extracted from app.js,
// each new file joins this list and the exactly-one-writer assertion
// below starts covering it automatically.
const PAINTERS = [
  "js/app.js",
];

// ---------- no DOM in a decision module ----------

// Source with comments and string/template literal BODIES blanked, so a
// comment saying "no document here" cannot fail the test and a template
// interpolation still counts as code.
function codeOnly(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ")
    .replace(/"(?:[^"\\\n]|\\.)*"/g, '""')
    .replace(/'(?:[^'\\\n]|\\.)*'/g, "''");
}

test("a state or decision module reaches for no DOM, ever", () => {
  // `$(` is app.js's own selector helper; the rest are the platform's.
  const REACHES = [/\bdocument\b/, /\bwindow\b/, /\$\(/, /querySelector/,
    /innerHTML/, /getElementById/, /\bnavigator\b/];
  for (const mod of DOM_FREE) {
    const src = codeOnly(read(mod));
    for (const reach of REACHES) {
      assert.doesNotMatch(src, reach,
        `${mod} must stay a leaf: it renders nothing and owns no element`);
    }
  }
});

// …and it must not import anything that does. A leaf that imports the
// sync machinery or the UI drags the whole surface in behind it.
test("js/state.js imports only storage and pure modules", () => {
  const imports = [...read("js/state.js").matchAll(/from "\.\/([a-z-]+\.js)"/g)]
    .map((m) => m[1]);
  assert.deepEqual(imports.sort(), ["prefs.js", "store.js"],
    "state.js is a leaf: store (persistence) and prefs (pure picks) only");
});

// ---------- a flow reaches for no document ----------

test("an io flow touches no DOM, and asks the platform for nothing else", () => {
  // `navigator` is deliberately NOT on this list and everything else
  // from DOM_FREE is. js/flow/sync.js asks `navigator.onLine` — that is a
  // connectivity reading, which js/failure.js takes as an argument
  // precisely so the sentence stays pure; there is no element behind it
  // and no repaint. `document` is a different thing entirely: the one
  // read the moved code had (`dialog[open]`, deciding whether a live
  // update may repaint under an open sheet) is injected as sheetOpen()
  // from boot instead, so this file can be held to the blunt rule rather
  // than to an exception somebody has to remember.
  const REACHES = [/\bdocument\b/, /\bwindow\b/, /\$\(/, /querySelector/,
    /innerHTML/, /getElementById/];
  for (const mod of IO_FLOWS) {
    const src = codeOnly(read(mod));
    for (const reach of REACHES) {
      assert.doesNotMatch(src, reach,
        `${mod} is a flow: it decides and calls, and the screen is somebody else's`);
    }
  }
});

test("nothing outside js/app.js imports js/app.js", () => {
  // A slice that imports the composition root has not been extracted; it
  // has been aliased, and the cycle makes the next extraction harder
  // rather than easier.
  for (const mod of [...DOM_FREE, ...IO_FLOWS]) {
    assert.doesNotMatch(read(mod), /from\s+["'][^"']*app\.js["']/,
      `${mod} imports js/app.js — what it needs must arrive through a hook`);
  }
});

// ---------- every DOM id has exactly one writing module ----------

// The ids a module addresses, read from its selector calls. Covers the
// forms app.js actually uses: $("#id"), querySelector("#id ..."), and
// CSS.escape'd lookups are attribute selectors and carry no static id.
// Comments are stripped so an id in prose is not an id; the strings
// STAY, because the strings are where the ids live.
function idsIn(src) {
  const ids = new Set();
  const noComments = read(src)
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");
  for (const m of noComments.matchAll(/[$.]\s*(?:querySelector(?:All)?)?\(\s*["'`]#([A-Za-z][\w-]*)/g)) {
    ids.add(m[1]);
  }
  return ids;
}

test("each DOM id is addressed by exactly one module", () => {
  const owner = new Map();
  for (const mod of IO_FLOWS) {
    assert.deepEqual([...idsIn(mod)], [],
      `${mod} is a flow and owns no ids; these belong to whoever paints them`);
  }
  for (const mod of PAINTERS) {
    for (const id of idsIn(mod)) {
      assert.ok(!owner.has(id),
        `#${id} is written by both ${owner.get(id)} and ${mod} — one of them owns it`);
      owner.set(id, mod);
    }
  }
  // The scaffold must actually be seeing ids, or a regexp drift turns
  // this into a test of nothing (the getBBox lesson: measure something).
  assert.ok(owner.size >= 100,
    `only ${owner.size} ids found across ${PAINTERS.length} modules — the extractor has stopped seeing them`);
});

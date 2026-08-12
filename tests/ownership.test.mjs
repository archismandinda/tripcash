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

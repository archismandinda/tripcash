// What we tell people we count must be what we count.
//
// The seventh counter (`invite_sent`) shipped in v1.67.0 and the three
// places a user is told about the counters were left saying six: the
// Settings row they read before deciding whether to leave the switch on,
// the README, and PRIVACY.md — which is the published promise, in a
// public repository. Nothing failed, because no test related
// `EVENTS` to a sentence anybody reads.
//
// So this asserts the relation directly, in the shape of
// tests/shell.test.mjs and tests/callsites.test.mjs: it reads the real
// files and compares them to the real list. An eighth counter now fails
// here until all three have been brought along, and the failure names
// the file.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { EVENTS } from "../js/analytics.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

// Disclosure is written for people, so it says "seven", not "7".
const WORDS = ["zero", "one", "two", "three", "four", "five", "six",
  "seven", "eight", "nine", "ten"];
const word = WORDS[EVENTS.length];
assert.ok(word, `EVENTS has grown past this list of number words (${EVENTS.length})`);
const Word = word[0].toUpperCase() + word.slice(1);

// The "## Anonymous counts" section of PRIVACY.md, up to the next heading.
function privacySection() {
  const source = read("PRIVACY.md");
  const at = source.indexOf("## Anonymous counts");
  assert.notEqual(at, -1, "PRIVACY.md should have an Anonymous counts section");
  const end = source.indexOf("\n## ", at + 1);
  return source.slice(at, end === -1 ? source.length : end);
}

test("PRIVACY.md promises the number of counters the app actually has", () => {
  assert.match(
    privacySection(),
    new RegExp(`counts ${word} things, and only ${word}:`),
    `PRIVACY.md is the published privacy promise and the app now sends ` +
    `${EVENTS.length} counters (${EVENTS.join(", ")}). Saying a smaller ` +
    `number is a disclosure gap, not a typo.`
  );
});

test("PRIVACY.md enumerates every counter, one item each", () => {
  // The number alone is not the promise — the list under it is. Bumping
  // the word without adding the item would leave the new counter
  // undisclosed while reading as if it were covered.
  const items = privacySection().match(/^\d+\. /gm) ?? [];
  assert.equal(
    items.length, EVENTS.length,
    `PRIVACY.md lists ${items.length} counted things; js/analytics.js sends ` +
    `${EVENTS.length}: ${EVENTS.join(", ")}`
  );
});

test("the Settings row a user reads names the same number", () => {
  // This is the one that decides whether the switch stays on, so it is
  // the one that matters most and the easiest to forget — it is copy in
  // index.html, nowhere near js/analytics.js.
  const row = read("index.html").match(/Anonymous counts<span>([^<]*)<\/span>/);
  assert.ok(row, "index.html should still have the Anonymous counts setting row");
  assert.match(
    row[1], new RegExp(`^${Word}\\b`),
    `the Settings row says "${row[1]}" while the app sends ${EVENTS.length} counters`
  );
});

test("the README names the same number", () => {
  assert.match(
    read("README.md"),
    new RegExp(`${Word} anonymous counters`),
    `README.md's Privacy section is out of step with js/analytics.js ` +
    `(${EVENTS.length} counters)`
  );
});

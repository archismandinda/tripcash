// The checker, checked.
//
// tests/a11y.test.mjs asserts that the amount row's focus ring is visible —
// AC3, the one criterion its story flags as the trap, because the same
// control shipped once with a 0.12-alpha glow instead of an indicator. The
// test that guards it read styles.css with a `.find()`, which returns the
// FIRST rule with a given selector. CSS resolves ties in the other
// direction: last one wins. So one appended line,
//
//     .field:has(input:focus-visible) { outline: 3px solid var(--accent-glow); }
//
// re-shipped the invisible ring with the suite green — 50 pass, 0 fail,
// 846 across the tree — and a screenshot showed the ring simply gone.
//
// A helper that decides something and is not itself tested is not a guard,
// it is a comment that runs. These are the cases the old one got wrong.

import test from "node:test";
import assert from "node:assert/strict";
import {
  parseRules, declarations, suppressesOutline, visibleOutline, keyCompound,
  outlineRules, parseColour, contrast,
} from "./csscheck.mjs";

const RING = ".field:has(input:focus-visible)";

test("a later rule with the same selector is not invisible to the checker", () => {
  // THE BUG, in the smallest form that reproduces it.
  const rules = parseRules(`
    ${RING} { border-color: var(--accent); outline: 3px solid var(--accent-strong); }
    ${RING} { outline: 3px solid var(--accent-glow); }
  `);
  const found = outlineRules(rules, RING);
  assert.equal(found.length, 2, "both declarations of the ring have to be judged");
  assert.deepEqual(found.map((r) => visibleOutline(r.body).colour),
    ["var(--accent-strong)", "var(--accent-glow)"]);
  // The one that wins is the one a person sees, and it is the last.
  assert.equal(visibleOutline(found.at(-1).body).colour, "var(--accent-glow)");
});

test("a rule that only re-colours the ring still counts as touching it", () => {
  // `outline-color` alone overrides the colour of a shorthand set earlier
  // and never matches `visibleOutline`, so a checker that looks only for
  // the shorthand cannot see it at all.
  const rules = parseRules(`
    ${RING} { outline: 3px solid var(--accent-strong); }
    ${RING} { outline-color: var(--accent-glow); }
  `);
  assert.equal(outlineRules(rules, RING).length, 2);
  assert.equal(visibleOutline(outlineRules(rules, RING).at(-1).body), null,
    "a bare outline-color is not a ring this checker can vouch for");
});

test("rules that say nothing about the outline are not dragged in", () => {
  // Otherwise every future `.field:has(...) { transition: … }` fails a test
  // about focus rings, and a test that fails for unrelated edits is a test
  // people learn to edit rather than read.
  const rules = parseRules(`
    ${RING} { outline: 3px solid var(--accent-strong); }
    ${RING} { transition: box-shadow 0.18s; }
    .field { outline: 3px solid red; }
  `);
  assert.deepEqual(outlineRules(rules, RING).map((r) => r.body),
    ["outline: 3px solid var(--accent-strong);"]);
});

test("every spelling of drawing nothing is still a suppression", () => {
  for (const body of [
    "outline: none;", "outline: 0;", "outline-style: none;",
    "outline-width: 0;", "outline-width: 0px;", "outline-color: transparent;",
  ]) assert.ok(suppressesOutline(body), `${body} should read as a suppression`);
  assert.ok(!suppressesOutline("outline: 3px solid var(--accent-strong);"));
});

test("a ring narrower than a hairline, or made of nothing, is not a ring", () => {
  assert.equal(visibleOutline("outline: 0.5px solid var(--accent-strong);"), null);
  assert.equal(visibleOutline("outline: 3px solid transparent;"), null);
  assert.equal(visibleOutline("outline: none;"), null);
  assert.equal(visibleOutline("box-shadow: 0 0 0 3px var(--accent-glow);"), null);
  assert.deepEqual(visibleOutline("outline: 3px solid var(--accent-strong);"),
    { width: 3, colour: "var(--accent-strong)" });
});

test("comments and at-rules do not become selectors", () => {
  const rules = parseRules(`
    /* .field:has(input:focus-visible) { outline: none; } */
    @media (min-width: 700px) { ${RING} { outline: 3px solid var(--accent-strong); } }
  `);
  assert.deepEqual(rules.map((r) => r.selector), [RING]);
});

test("a selector names the element its last compound names", () => {
  assert.equal(keyCompound(`${RING} input:focus-visible`), "input:focus-visible");
  assert.equal(keyCompound(RING), RING);
  assert.equal(declarations("outline: 3px solid red; ").length, 1);
});

// --- colour ------------------------------------------------------------

test("a translucent colour gets a real ratio, not NaN", () => {
  // The old helper sliced hex digits out of `rgba(45, 212, 191, 0.12)` —
  // parseInt("gb", 16) — so if it had ever reached the value AC3 exists to
  // reject, it would have reported "NaN:1". The failure would have read as
  // a broken test rather than as an invisible focus ring.
  const glow = contrast("rgba(45, 212, 191, 0.12)", "#151f1c");
  assert.ok(Number.isFinite(glow), "the glow must produce a number");
  assert.ok(glow > 1.2 && glow < 1.35,
    `the 0.12 glow on the dark card is ~1.27:1, got ${glow}`);
  assert.ok(glow < 3, "and it is nowhere near the 3:1 WCAG 1.4.11 asks for");
});

test("the ring that shipped instead of the glow clears 3:1 both ways", () => {
  assert.ok(contrast("#2dd4bf", "#151f1c") >= 3);
  assert.ok(contrast("#0a6b62", "#ffffff") >= 3);
});

test("black on white is 21:1, which is the arithmetic sanity check", () => {
  assert.ok(Math.abs(contrast("#000000", "#ffffff") - 21) < 0.01);
  assert.equal(contrast("#fff", "#ffffff"), 1);
});

test("a colour that cannot be read says so instead of answering", () => {
  // null is what lets the caller name the value it choked on. NaN compares
  // false against every threshold, which passes for a failure and reads as
  // a bug in the test.
  assert.equal(contrast("color-mix(in srgb, red, blue)", "#ffffff"), null);
  assert.equal(contrast("var(--accent)", "#ffffff"), null);
  assert.equal(parseColour("rgb(13 148 136 / 0.5)").a, 0.5);
  assert.equal(parseColour("rgba(13, 148, 136, 50%)").a, 0.5);
  assert.equal(parseColour("nonesuch"), null);
  // Compositing needs something opaque to composite onto.
  assert.equal(contrast("#000000", "rgba(0, 0, 0, 0.5)"), null);
});

// The fold, measured — not modelled, and not written into a comment.
//
// The storefront's acceptance criterion was "the call to action is above
// the fold on a 375x667 phone". What shipped to guard it was a cap on the
// pitch's word count, the exact list of <main>'s children, and a rule about
// when the suitcase is drawn. All three are blind to CSS. Appending
//
//     #landing { padding-top: 40px; padding-bottom: 40px; }
//     .landing-title { font-size: 1.6rem; }
//
// to styles.css put #empty-new-trip at 673.8–725.8 on a 667-tall screen —
// the button 58px under the fold, which is the exact defect the story
// existed to remove — and the whole suite stayed green. That regression is
// two ordinary lines: a padding and a font-size. It is what any future
// sprint touching styles.css can do by accident.
//
// So the fold is measured here, in a browser, on the served tree. The
// numbers in tests/landing.test.mjs's sign-off were taken by hand at
// 375x667 with storage cleared; this reproduces them to the decimal
// (#landing 136–344.7, #panel-host 344.7–566.7, #empty-state 566.7–672.7,
// #empty-new-trip 596.7–648.7, page 740 tall), which is the evidence that
// what runs here is the same measurement a person took by looking.
//
// If there is no browser on the machine, these skip out loud rather than
// passing. `npm run preflight` refuses the release in that case: a
// storefront shipped on an unmeasured fold is the thing this file is for.

import test, { before } from "node:test";
import assert from "node:assert/strict";
import { findChrome, layout, stack } from "./chrome.mjs";

// An iPhone SE, which is the phone in this project that has the least room
// and the one the owner tests on. Every number below is CSS pixels.
const WIDTH = 375;
const FOLD = 667;

// The vertical stack a stranger arrives to, top to bottom. Measured whole,
// because the fold is a property of the stack: knowing only that the button
// is too low does not say which block above it grew.
const IDS = [
  "status-row", "landing", "trip-tools", "trips", "panel-host",
  "new-trip-btn", "empty-state", "empty-decoration", "empty-new-trip",
  "landing-dismiss",
];

const chrome = findChrome();
const skip = chrome ? false
  : "no Chrome or Chromium on this machine — set CHROME_PATH to measure the fold";

let m;
before(async () => {
  if (!chrome) return;
  m = await layout({ width: WIDTH, height: FOLD, ids: IDS, settleOn: "empty-new-trip", chrome });
});

test("the measurement is of the screen it claims to be", { skip }, () => {
  // A viewport that is not the one asserted about, or a page caught
  // half-painted, is how a geometry test passes while measuring nothing.
  assert.equal(m.width, WIDTH, `laid out at ${m.width}px wide, not ${WIDTH}`);
  assert.equal(m.fold, FOLD, `viewport is ${m.fold}px tall, not ${FOLD}`);
  assert.ok(m.settled, "the page never finished painting; nothing below measured anything");
  // …and of the right person. The pitch appears for exactly one audience —
  // somebody with no trips who did not arrive through an invitation — and
  // if it stopped appearing, everything below it would rise and the fold
  // assertion would pass for the wrong reason.
  assert.ok(m.boxes.landing?.shown,
    `the pitch is not on screen, so this is not a stranger's first arrival:\n${stack(m)}`);
  assert.ok(!m.boxes["empty-decoration"].shown,
    `the suitcase is drawn under the pitch again — 254px of illustrated emptiness:\n${stack(m)}`);
});

test("a stranger can reach the button without scrolling", { skip }, () => {
  const cta = m.boxes["empty-new-trip"];
  assert.ok(cta?.shown, `#empty-new-trip is not on screen at all:\n${stack(m)}`);
  assert.ok(cta.bottom <= FOLD,
    `the call to action ends at y=${cta.bottom} on a ${FOLD}px screen — ` +
    `${(cta.bottom - FOLD).toFixed(1)}px under the fold.\n` +
    `This is the defect the storefront story exists to remove, and the ` +
    `stack that produced it is:\n${stack(m)}`);
  // Whole, not clipped: half a button above the fold is a button somebody
  // has to guess at.
  assert.ok(cta.top >= 0, `#empty-new-trip starts above the viewport at y=${cta.top}`);
  // 44px is the tap target every platform asks for, and it is the reason
  // this control is worth the vertical budget it costs.
  assert.ok(cta.height >= 44, `the call to action is ${cta.height}px tall`);
});

test("the converter is in the first screenful, because it is the argument", { skip }, () => {
  // The pitch is deliberately a caption, not a takeover: it says the
  // converter below works offline, and the converter being right there —
  // usable with no account and no network — is a demonstration where the
  // sentence is only a promise. A pitch that pushes it off the screen has
  // argued itself out of its own evidence.
  const panel = m.boxes["panel-host"];
  assert.ok(panel?.shown, `the converter is not on screen:\n${stack(m)}`);
  assert.ok(panel.top < FOLD,
    `the converter starts at y=${panel.top}, below the ${FOLD}px fold:\n${stack(m)}`);
});

test("the way out stays after the way in", { skip }, () => {
  // tests/landing.test.mjs pins this in the document's source order. Here
  // it is pinned in the layout, which is the thing a person experiences —
  // `order:` on a flex container, a float, an absolute position or a
  // negative margin all reorder the screen without touching the markup.
  const cta = m.boxes["empty-new-trip"];
  const exit = m.boxes["landing-dismiss"];
  assert.ok(exit?.shown, "the dismiss control is not on screen for a stranger");
  assert.ok(cta.top < exit.top,
    `the exit is drawn at y=${exit.top}, above the call to action at y=${cta.top} — ` +
    `the only control in a stranger's first screenful must not be the way out:\n${stack(m)}`);
});

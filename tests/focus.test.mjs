// The focus indicator, as the renderer paints it.
//
// AC3 says the amount row is the ONE focus indicator and that it has to be
// visible. The trap the story names is that "making the row the single
// indicator while leaving it as that glow re-ships the exact defect", and
// the guard written for it read styles.css with a `.find()` — the FIRST
// rule with a given selector, where CSS applies the LAST. One appended
// line,
//
//     .field:has(input:focus-visible) { outline: 3px solid var(--accent-glow); }
//
// put the ring back to 1.27:1 with 846 tests passing. tests/csscheck.mjs
// closes that door. It cannot close the next one: an override written with
// a DIFFERENT selector — `.field.source:has(input:focus-visible)`, which is
// the row you are typing in and therefore the whole story — wins on
// specificity, and no parser short of a browser resolves that.
//
// So this asks the browser. Same lesson as the app icon, which getBBox()
// said reached r=38.4 and the rasteriser said 45.8: the model and the
// renderer disagreed and only one of them is what a person sees.
//
// Measured here, Chromium 375x667, real mouse click on the second amount
// input, after the theme's 0.18s border transition has settled:
//
//   light  row outline 3px solid rgb(10,107,98) on rgb(238,242,241) — 5.65:1
//   dark   row outline 3px solid rgb(45,212,191) on rgb(11,18,16)   — 10.18:1
//   input  outline-style: none, both themes, focused and not
//   blurred row outline-style: none, both themes — the ring IS the state
//
// The click is not a detail. A scripted `el.focus()` leaves
// `:focus-visible` false in Chromium and the row draws nothing at all —
// which would have read as the defect rather than as the wrong gesture.

import test, { before } from "node:test";
import assert from "node:assert/strict";
import { findChrome, page } from "./chrome.mjs";
import { contrast } from "./csscheck.mjs";

const WIDTH = 375;
const HEIGHT = 667;

// The amount input a person reaches for: the second row, which is the one
// the report that produced this test clicked. (The first is the pinned home
// currency.)
const ROW = 1;

// Point at the centre of that input, plus the state the app is in. Read
// fresh every time: `field-sizing: content` means the box moves when the
// digits change.
const aim = `(() => {
  const inputs = [...document.querySelectorAll("#fields input[data-code]")];
  const input = inputs[${ROW}];
  if (!input) return JSON.stringify({ rows: inputs.length, error: "no amount row to focus" });
  const r = input.getBoundingClientRect();
  return JSON.stringify({ rows: inputs.length, code: input.dataset.code,
    x: r.left + r.width / 2, y: r.top + r.height / 2 });
})()`;

// What the renderer resolved for the row and for the input inside it, and
// what the ring is actually drawn against — the nearest ancestor with
// something opaque in it, since the outline sits OUTSIDE the row.
const observe = `(() => {
  const input = document.querySelectorAll("#fields input[data-code]")[${ROW}];
  const row = input.closest(".field");
  const ring = (el) => {
    const s = getComputedStyle(el);
    return { style: s.outlineStyle, width: parseFloat(s.outlineWidth), colour: s.outlineColor };
  };
  let behind = null;
  for (let el = row.parentElement; el; el = el.parentElement) {
    const c = getComputedStyle(el).backgroundColor;
    const parts = (c.match(/rgba?\\(([^)]+)\\)/)?.[1] ?? "").split(/[,/\\s]+/).filter(Boolean);
    if (parts.length && Number(parts[3] ?? 1) > 0) { behind = c; break; }
  }
  return JSON.stringify({
    focusVisible: input.matches(":focus-visible"),
    focused: document.activeElement === input,
    source: row.classList.contains("source"),
    height: +row.getBoundingClientRect().height.toFixed(1),
    row: ring(row), input: ring(input), behind,
  });
})()`;

// `.field` transitions border-color and background-color over 0.18s, so a
// style read taken straight after flipping the palette returns the value it
// is transitioning AWAY from. Two frames is not enough; the transition is.
const settleTheme = (theme) => `(async () => {
  document.documentElement.dataset.theme = ${JSON.stringify(theme)};
  await new Promise((r) => setTimeout(r, 300));
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
  return JSON.stringify(document.documentElement.dataset.theme);
})()`;

// Typing turns the row into `.field.source`, whose border is ALREADY
// --accent. That is the case AC3 is really about: on the row you are typing
// in, focus and blur used to differ by nothing but the invisible glow.
const type = `(() => {
  const input = document.querySelectorAll("#fields input[data-code]")[${ROW}];
  input.focus();
  input.value = "12";
  input.dispatchEvent(new InputEvent("input", { bubbles: true }));
  input.blur();
  return JSON.stringify(input.closest(".field").classList.contains("source"));
})()`;

const chrome = findChrome();
const skip = chrome ? false
  : "no Chrome or Chromium on this machine — set CHROME_PATH to measure the focus ring";

// theme/state → { blurred, focused }
const seen = {};

before(async () => {
  if (!chrome) return;
  await page({ width: WIDTH, height: HEIGHT, settleOn: "empty-new-trip", chrome },
    async ({ evaluate, click }) => {
      for (const state of ["plain", "source"]) {
        if (state === "source") {
          assert.equal(await evaluate(type), true,
            "typing into an amount should mark its row as the source of truth");
        }
        for (const theme of ["light", "dark"]) {
          // Focus survives the previous pass, so "blurred" would otherwise
          // mean "still focused from the last click".
          await evaluate(`(() => { document.activeElement?.blur(); return JSON.stringify(true); })()`);
          assert.equal(await evaluate(settleTheme(theme)), theme);
          const at = await evaluate(aim);
          assert.ok(!at.error, `${at.error} (found ${at.rows})`);
          const blurred = await evaluate(observe);
          await click(at.x, at.y);
          const focused = await evaluate(observe);
          seen[`${theme}/${state}`] = { at, blurred, focused };
        }
      }
    });
});

const CASES = ["light/plain", "dark/plain", "light/source", "dark/source"];

test("the click really focused the amount, and the browser calls it keyboard focus", { skip }, () => {
  // The premise. If this stops holding, every measurement below is of an
  // unfocused row, and "no ring" would be the correct answer to the wrong
  // question.
  for (const key of CASES) {
    const { at, focused, blurred } = seen[key];
    assert.equal(at.code, "USD", `${key}: expected to click the second amount row`);
    assert.ok(focused.focused, `${key}: the click did not land in the amount input`);
    assert.ok(focused.focusVisible,
      `${key}: the input is focused but not :focus-visible, so no ring is expected — ` +
      `this measures nothing`);
    assert.ok(!blurred.focused, `${key}: the row was already focused before the click`);
    assert.equal(focused.source, key.endsWith("/source"),
      `${key}: the row is not in the state this case is about`);
  }
});

test("focusing an amount draws a ring a person can see", { skip }, () => {
  // WCAG 1.4.11: a non-text indicator needs 3:1 against what it sits on.
  // Whatever rule wins, whatever selector it was written with, whatever
  // file it arrived in — this is the outline the compositor drew.
  for (const key of CASES) {
    const { focused } = seen[key];
    assert.notEqual(focused.row.style, "none",
      `${key}: the focused row draws no outline at all`);
    assert.ok(focused.row.width >= 2,
      `${key}: a ${focused.row.width}px ring on a ${focused.height}px row is not an indicator`);
    const ratio = contrast(focused.row.colour, focused.behind);
    assert.ok(ratio !== null,
      `${key}: cannot read ${focused.row.colour} on ${focused.behind} as colours`);
    assert.ok(ratio >= 3,
      `${key}: the ring is ${focused.row.colour} on ${focused.behind} — ` +
      `${ratio.toFixed(2)}:1, and WCAG 1.4.11 wants 3:1. This is the 0.12-alpha ` +
      `glow defect if that ratio is near 1.`);
  }
});

test("the ring is the difference between focused and not", { skip }, () => {
  // The other half of the trap, and the reason a contrast check alone is
  // not enough: on `.field.source` the border is already --accent, so a row
  // that looks the same focused and blurred has no focus indicator no
  // matter how visible its colours are.
  for (const key of CASES) {
    const { blurred, focused } = seen[key];
    assert.equal(blurred.row.style, "none",
      `${key}: the row already draws an outline while nothing in it is focused`);
    assert.notEqual(focused.row.style, blurred.row.style,
      `${key}: focusing this row changes nothing about it`);
  }
});

test("there is one indicator, and it is the row", { skip }, () => {
  // The input's own ring is what AC3 removed: `field-sizing: content` hugs
  // the digits sideways while `padding: 8px 0` holds the box 14px off the
  // row, so its outline is lopsided by construction. Two rings for one
  // focus is the defect; one lopsided one is what it looked like.
  for (const key of CASES) {
    assert.equal(seen[key].focused.input.style, "none",
      `${key}: the amount input draws its own outline as well as the row's`);
  }
});

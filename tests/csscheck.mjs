// Reading styles.css the way a browser reads it — as far as a parser can.
//
// These helpers used to live inside tests/a11y.test.mjs, which is why they
// were never tested themselves. That mattered: the AC3 contrast test asked
// `RULES.find(r => r.selector === ".field:has(input:focus-visible)")` and
// checked the FIRST declaration it found. CSS uses the LAST one. Appending
//
//     .field:has(input:focus-visible) { outline: 3px solid var(--accent-glow); }
//
// to styles.css — same specificity, later in source, so it wins — put the
// app's primary control back on a 1.27:1 focus indicator with the whole
// suite green. That is the most ordinary way a rule comes back: somebody
// adds a later one.
//
// So the cascade question is answered here, by a function with its own
// tests (tests/csscheck.test.mjs), and a11y.test.mjs asks it rather than
// re-deriving it. Two limits, stated rather than hidden:
//
//   1. This resolves ONE selector against itself — every rule written with
//      the same selector text. It does not compute specificity across
//      different selectors, and it cannot: that is a browser's job.
//   2. Therefore it is not the last word. tests/focus.test.mjs focuses the
//      real input in a real browser and reads the outline the renderer
//      actually paints, which is what a person sees.

// Innermost declaration blocks only: an at-rule prelude never matches,
// because its body contains braces. Keyframe steps do match and are
// harmless — none of them mentions :focus.
export function parseRules(cssText) {
  return [...cssText.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map(([, sel, body]) => ({ selector: sel.trim().replace(/\s+/g, " "), body: body.trim() }))
    .filter((r) => !r.selector.startsWith("@"));
}

export const declarations = (body) =>
  body.split(";").map((d) => d.trim()).filter(Boolean).map((d) => {
    const at = d.indexOf(":");
    return { prop: d.slice(0, at).trim().toLowerCase(), value: d.slice(at + 1).trim() };
  });

// Every spelling of "draw nothing", not just the one the last patch used.
export function suppressesOutline(body) {
  return declarations(body).some(({ prop, value }) => {
    const v = value.toLowerCase();
    if (prop === "outline") return /^(none|0)$/.test(v);
    if (prop === "outline-style") return v === "none";
    if (prop === "outline-width") return /^0(px|em|rem)?$/.test(v);
    if (prop === "outline-color") return v === "transparent";
    return false;
  });
}

// A rule that actually paints a ring, and what colour it paints it.
export function visibleOutline(body) {
  const d = declarations(body).find(({ prop }) => prop === "outline");
  if (!d) return null;
  const m = d.value.match(/^(\d+(?:\.\d+)?)px\s+(solid|dashed|dotted|double)\s+(\S.*)$/);
  if (!m) return null;
  const width = Number(m[1]);
  const colour = m[3].trim();
  if (width < 1 || colour === "transparent") return null;
  return { width, colour };
}

// The last compound of a selector is the element the rule is about:
// `.field:has(input:focus-visible) input:focus-visible` is about the input.
export const keyCompound = (sel) => sel.split(",")[0].trim().split(" ").filter(Boolean).pop();

// EVERY rule written with this selector that says anything about `outline`,
// in source order — so the caller can judge all of them instead of the one
// that happens to come first. Returning the list rather than "the winner"
// is deliberate: `outline-color` on its own overrides only the colour of a
// shorthand set earlier, so the ring a person sees can be assembled from
// more than one rule and no single one of them is the answer.
export function outlineRules(rules, selector) {
  return rules.filter((r) => r.selector === selector
    && declarations(r.body).some(({ prop }) => prop === "outline" || prop.startsWith("outline-")));
}

// --- colour ------------------------------------------------------------
//
// The palette is not all hex. `--accent-glow` is `rgba(13, 148, 136, 0.14)`,
// and the helper this replaces sliced hex digits out of it: parseInt("gb",
// 16) is NaN, so a ring made of the glow — the exact defect AC3 exists to
// prevent — was reported as "NaN:1". A ratio that is not a number reads as
// a broken test, not as a failing indicator. Alpha is composited instead,
// which is what the compositor does and what makes 1.27:1 a real number.

export function parseColour(value) {
  const v = String(value).trim().toLowerCase();
  const hex = v.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);
  if (hex) {
    const h = hex[1].length === 3 ? [...hex[1]].map((c) => c + c).join("") : hex[1];
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: 1 };
  }
  const fn = v.match(/^rgba?\(([^)]+)\)$/);
  if (fn) {
    const parts = fn[1].split(/[,/\s]+/).map((p) => p.trim()).filter(Boolean);
    if (parts.length < 3 || parts.length > 4) return null;
    const [r, g, b] = parts.slice(0, 3).map(Number);
    const a = parts.length === 4 ? Number(parts[3].endsWith("%") ? parseFloat(parts[3]) / 100 : parts[3]) : 1;
    if ([r, g, b, a].some((n) => !Number.isFinite(n))) return null;
    return { r, g, b, a };
  }
  return null;
}

// Straight alpha over an opaque backdrop.
const over = (fg, bg) => ({
  r: fg.a * fg.r + (1 - fg.a) * bg.r,
  g: fg.a * fg.g + (1 - fg.a) * bg.g,
  b: fg.a * fg.b + (1 - fg.a) * bg.b,
  a: 1,
});

const luminance = ({ r, g, b }) => {
  const [R, G, B] = [r, g, b]
    .map((c) => c / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * R + 0.7152 * G + 0.0722 * B;
};

// WCAG contrast of `value` against the opaque `behind` it is drawn on.
// Returns null — never NaN — when either colour cannot be read, so the
// caller can say WHICH value it could not read.
export function contrast(value, behind) {
  const bg = parseColour(behind);
  const fg = parseColour(value);
  if (!bg || !fg || bg.a !== 1) return null;
  const [hi, lo] = [luminance(fg.a === 1 ? fg : over(fg, bg)), luminance(bg)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

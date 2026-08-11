// The offline shell must list every module the app actually loads.
//
// sw.js caches a hand-written SHELL list. Miss one module and the app
// still works online — the network quietly covers for it — so nothing
// looks wrong until someone opens it from the home screen with no
// signal, and then it does not boot at all. That is the worst failure
// mode this app has: invisible in every test, on every dev machine, and
// total for the user.
//
// It has now happened twice (js/ledger.js in sprint 1). Both times the
// module was correctly imported and correctly tested; the only thing
// missing was a line in a list that nothing checked. So walk the real
// import graph from the real entry point and compare.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve, relative } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Every module reachable from index.html's entry script, found the way
// the browser finds them: by following static imports.
function reachableFrom(entry) {
  const seen = new Set();
  const queue = [resolve(ROOT, entry)];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file)) continue;
    seen.add(file);
    const source = readFileSync(file, "utf8");
    // Static `import ... from "./x.js"` and bare `import "./x.js"` only.
    // Dynamic import() is deliberately excluded: those are the lazy
    // Firebase chunks, fetched from gstatic and never in the shell.
    for (const m of source.matchAll(/^\s*import\s+(?:[^'"]*?\bfrom\s*)?["'](\.[^"']+)["']/gm)) {
      queue.push(resolve(dirname(file), m[1]));
    }
  }
  return seen;
}

const shell = () => {
  const source = readFileSync(join(ROOT, "sw.js"), "utf8");
  const block = source.match(/const SHELL\s*=\s*\[([\s\S]*?)\]/);
  assert.ok(block, "sw.js should declare a SHELL array");
  return new Set([...block[1].matchAll(/["'](\.[^"']+)["']/g)].map((m) => m[1]));
};

test("every module the app imports is in the offline shell", () => {
  const listed = shell();
  const missing = [...reachableFrom("js/app.js")]
    .map((f) => `./${relative(ROOT, f)}`)
    .filter((p) => !listed.has(p));
  assert.deepEqual(
    missing,
    [],
    `these modules load at startup but are not cached — the app will not open offline:\n  ${missing.join("\n  ")}`
  );
});

test("the shell lists nothing that does not exist", () => {
  const gone = [...shell()].filter((p) => {
    // "./" is the app document itself, served by index.html — a URL, not
    // a file on disk. Everything else must be a real file.
    if (p.endsWith("/")) return false;
    try {
      readFileSync(join(ROOT, p));
      return false;
    } catch {
      return true;
    }
  });
  // install() uses addAll, which is all-or-nothing: one 404 and the
  // service worker fails to install, so the whole shell is uncached.
  assert.deepEqual(gone, [], `SHELL names files that are not in the repo: ${gone.join(", ")}`);
});

test("the entry script index.html loads is the one we walked", () => {
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  const entries = [...html.matchAll(/<script[^>]*type="module"[^>]*src="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(entries, ["./js/app.js"]);
});

// The import graph above only sees JavaScript. index.html also names
// images, icons, fonts and the manifest by hand, and those go missing
// offline exactly as silently as a module does — worse, actually,
// because a missing icon renders as a broken-image glyph in the topbar
// rather than failing loudly. Every same-origin thing the document
// asks for has to be in the shell.
const documentAssets = () => {
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  return [...new Set([...html.matchAll(/\b(?:src|href)="(\.[^"]+)"/g)].map((m) => m[1]))];
};

test("every asset index.html names is in the offline shell", () => {
  const listed = shell();
  const missing = documentAssets().filter((p) => !listed.has(p));
  assert.deepEqual(
    missing,
    [],
    `index.html asks for these on every load but they are not cached — they break on a plane:\n  ${missing.join("\n  ")}`
  );
});

// The topbar mark used to be icons/icon-192.png squeezed into a 30px
// box: a 3.2x browser downscale of 11-unit strokes, which resamples
// into mottle and is worse the higher the pixel density. The mark is
// drawn now. icon-192.png is still right for the manifest and for
// notifications — neither takes an SVG — so this is scoped to the
// on-screen brand mark and nothing else.
test("the on-screen brand mark is drawn, not a resampled raster", () => {
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  const marks = [...html.matchAll(/<img\b[^>]*>/g)]
    .map((m) => m[0])
    .filter((tag) => /class="[^"]*\bbrand-logo\b[^"]*"/.test(tag))
    .map((tag) => tag.match(/src="([^"]+)"/)?.[1]);
  assert.ok(marks.length >= 2, "expected the topbar and about-card brand marks");
  const raster = marks.filter((src) => !src?.endsWith(".svg"));
  assert.deepEqual(raster, [], `.brand-logo must source the SVG, not a raster: ${raster.join(", ")}`);
});

// The plate's corner is drawn by the SVG. CSS states it a second time
// only because box-shadow is cast from the element BOX and squares off
// without it — so the two must be the same curve, and the CSS one is a
// percentage so it stays the same curve at any size. It was 9px against
// a drawn 6.5625px, which clipped the corners off the mark.
test(".brand-logo's corner is the one icon.svg draws", () => {
  const svg = readFileSync(join(ROOT, "icons/icon.svg"), "utf8");
  const side = Number(svg.match(/viewBox="0 0 (\d+(?:\.\d+)?) /)?.[1]);
  const rx = Number(svg.match(/<rect[^>]*\brx="(\d+(?:\.\d+)?)"/)?.[1]);
  assert.ok(side > 0 && rx > 0, "icon.svg should draw a plate with an rx on a square viewBox");

  const css = readFileSync(join(ROOT, "styles.css"), "utf8");
  const rule = css.match(/\.brand-logo\s*\{([^}]*)\}/);
  assert.ok(rule, "styles.css should have a .brand-logo rule");
  const radius = rule[1].match(/border-radius:\s*([^;]+);/)?.[1].trim();
  assert.ok(radius, ".brand-logo must state the corner, or box-shadow squares off past the plate");
  assert.equal(
    radius,
    `${+((rx / side) * 100).toFixed(4)}%`,
    `border-radius must be icon.svg's rx=${rx} on its ${side} viewBox, as a percentage of the box`
  );
});

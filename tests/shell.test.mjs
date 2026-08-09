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

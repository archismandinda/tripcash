#!/usr/bin/env node
//
// The check that has to happen at the moment of release, and cannot live in
// the test suite.
//
// Three consecutive sprints have ended with a module that js/app.js imports
// sitting untracked in git. A missing ES module does not degrade the app —
// it aborts the whole load, so the release is a blank white page on every
// device. Each time it was caught by a person reading `git status` at the
// right moment, which is not a control.
//
// It cannot be an ordinary test, because a new module is *legitimately*
// untracked for most of the sprint that writes it. Red for three hours a
// day teaches everyone to ignore it. So this runs at the cut:
//
//     npm run preflight
//
// Exit 0 means safe to commit and push. Anything else prints what would
// break and why.

import { readFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, resolve, relative, join } from "node:path";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const sh = (cmd, args) => execFileSync(cmd, args, { cwd: ROOT, encoding: "utf8" });

let failed = 0;
const bad = (title, detail) => {
  failed++;
  console.error(`\n✖ ${title}\n  ${detail.split("\n").join("\n  ")}`);
};
const ok = (title) => console.log(`✔ ${title}`);

// ---------- 1. everything the app imports is in git ----------
//
// Walks the real static-import graph from the entry point, exactly as the
// browser would, so a module cannot be missed by being absent from a list
// someone maintains by hand.
function reachable(entry) {
  const seen = new Set();
  const queue = [resolve(ROOT, entry)];
  while (queue.length) {
    const file = queue.shift();
    if (seen.has(file) || !existsSync(file)) continue;
    seen.add(file);
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/^\s*import\s+(?:[^'"]*?\bfrom\s*)?["'](\.[^"']+)["']/gm)) {
      queue.push(resolve(dirname(file), m[1]));
    }
  }
  return seen;
}

const tracked = new Set(sh("git", ["ls-files"]).split("\n").filter(Boolean));
const imported = [...reachable("js/app.js")].map((f) => relative(ROOT, f));
const untracked = imported.filter((f) => !tracked.has(f));

if (untracked.length) {
  bad("a module the app imports is not in git",
    `The release would be a blank page on every device — a missing ES module\n` +
    `aborts the whole load, it does not degrade.\n\n` +
    untracked.map((f) => `git add ${f}`).join("\n") +
    `\n\nStage them by name. Never git add -A: a sprint may be mid-edit.`);
} else {
  ok(`all ${imported.length} imported modules are tracked`);
}

// ---------- 2. and they are all in the offline shell ----------
const swSrc = readFileSync(join(ROOT, "sw.js"), "utf8");
const shell = new Set([...(swSrc.match(/const SHELL\s*=\s*\[([\s\S]*?)\]/)?.[1] ?? "")
  .matchAll(/["'](\.[^"']+)["']/g)].map((m) => m[1]));
const notCached = imported.filter((f) => !shell.has(`./${f}`));
if (notCached.length) {
  bad("a module the app imports is not in the sw.js SHELL",
    `Works online, blank on a plane — the network covers for it until there\n` +
    `is no network.\n\n` + notCached.map((f) => `  ./${f}`).join("\n"));
} else {
  ok(`all ${imported.length} imported modules are precached`);
}

// ---------- 3. the version moved ----------
//
// An asset or code change shipped under the old cache name reaches devices
// only when stale-while-revalidate happens to notice.
const appVer = readFileSync(join(ROOT, "js/app.js"), "utf8").match(/APP_VERSION = "([^"]+)"/)?.[1];
const swVer = swSrc.match(/const VERSION = "([^"]+)"/)?.[1];
const lastTagged = (() => {
  try {
    return sh("git", ["log", "-1", "--format=%B", "--", "sw.js"]).match(/tripcash-v(\d+)/)?.[0] ?? null;
  } catch { return null; }
})();
const headSw = (() => {
  try {
    return sh("git", ["show", "HEAD:sw.js"]).match(/const VERSION = "([^"]+)"/)?.[1] ?? null;
  } catch { return null; }
})();
const changed = sh("git", ["status", "--short"]).split("\n").filter(Boolean);
const shipping = changed.some((l) => /\b(js\/|index\.html|styles\.css|sw\.js|icons\/|manifest\.json)/.test(l));
if (shipping && headSw && swVer === headSw) {
  bad("something users load has changed but the SW cache version has not",
    `sw.js is still ${swVer}. Devices keep the cached copy until\n` +
    `stale-while-revalidate happens to replace it. Bump it, and APP_VERSION\n` +
    `too if any code changed.`);
} else {
  ok(`cache version ${swVer}, app version ${appVer}`);
}

// ---------- 4. nothing personal ----------
//
// The repo is public. A name or a real address in a comment or a fixture is
// not recoverable once pushed.
const LEAKS = [/archisman/i, /@gmail\.com/i, /@icloud\.com/i, /Documents\/Claude/];
const leaky = [];
for (const f of sh("git", ["ls-files"]).split("\n").filter((f) => /\.(js|mjs|md|html|css|json)$/.test(f))) {
  let src;
  try { src = readFileSync(join(ROOT, f), "utf8"); } catch { continue; }
  for (const re of LEAKS) {
    const hit = src.match(re);
    // The repo URL legitimately contains the account name.
    if (hit && !/archismandinda\.github\.io|archismandinda\/tripcash/.test(src.slice(Math.max(0, hit.index - 40), hit.index + 40))) {
      leaky.push(`${f}: ${hit[0]}`);
      break;
    }
  }
}
if (leaky.length) bad("something personal is about to be published", leaky.join("\n"));
else ok("no personal names, addresses or local paths");

console.log(
  failed
    ? `\n${failed} check${failed > 1 ? "s" : ""} failed — do not release.\n`
    : "\npreflight clean — safe to commit and push.\n"
);
process.exit(failed ? 1 : 0);

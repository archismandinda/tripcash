#!/usr/bin/env node
//
// Undo a bad release.
//
//     node scripts/rollback.mjs            # undo the last commit
//     node scripts/rollback.mjs <sha>      # undo a specific one
//     node scripts/rollback.mjs --dry-run  # show the plan, change nothing
//
// SDLC.md said "there is no rollback procedure". That was never true — for
// a static PWA with no build step, rolling back is just shipping the old
// code forward under a new cache version, at exactly the same latency as
// any other release. What was missing was that nobody had written it down
// or rehearsed it, so at the moment it was needed somebody would have been
// inventing it under pressure.
//
// It deliberately stops before pushing. Deciding to publish is a person's
// call, and this script's whole reason for existing is that the last time
// something reached the CDN without a decision it was a mistake.
//
// WHAT THIS CANNOT UNDO. Devices pick up a new service worker on their
// SECOND open, so a bad release keeps running on real phones for a while
// after this lands. If the bad release wrote something wrong into a
// device's local storage, reverting the code does not unwrite it — that
// needs a migration in the fix, not a revert. Check that before assuming
// this is enough.

import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve, join } from "node:path";

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), "..");
const git = (...a) => execFileSync("git", a, { cwd: ROOT, encoding: "utf8" }).trim();
const args = process.argv.slice(2);
const dry = args.includes("--dry-run");
const target = args.find((a) => !a.startsWith("--")) ?? "HEAD";

const sha = git("rev-parse", "--short", target);
const subject = git("log", "-1", "--format=%s", target);

if (git("status", "--short")) {
  console.error("✖ working tree is dirty. Commit or stash first — a revert on\n" +
                "  top of half-finished work produces a release nobody reviewed.");
  process.exit(1);
}

const swPath = join(ROOT, "sw.js");
const appPath = join(ROOT, "js/app.js");
const cache = readFileSync(swPath, "utf8").match(/const VERSION = "tripcash-v(\d+)"/);
const app = readFileSync(appPath, "utf8").match(/APP_VERSION = "v(\d+)\.(\d+)\.(\d+)"/);
if (!cache || !app) {
  console.error("✖ could not read the current versions from sw.js / js/app.js");
  process.exit(1);
}
const nextCache = `tripcash-v${Number(cache[1]) + 1}`;
const nextApp = `v${app[1]}.${app[2]}.${Number(app[3]) + 1}`;

console.log(`Rolling back ${sha} — ${subject}\n`);
console.log(`  revert       ${sha}`);
console.log(`  cache        tripcash-v${cache[1]} → ${nextCache}`);
console.log(`  app version  v${app[1]}.${app[2]}.${app[3]} → ${nextApp}`);
console.log(`  then         npm test && npm run test:rules && npm run preflight`);
console.log(`  then         you decide whether to push\n`);

if (dry) { console.log("(dry run — nothing changed)"); process.exit(0); }

// --no-commit so the version bumps ride in the same commit as the revert.
// A revert that ships under the old cache name reaches nobody, which is the
// specific way a rollback silently fails to roll anything back.
git("revert", "--no-commit", sha);
writeFileSync(swPath, readFileSync(swPath, "utf8")
  .replace(/const VERSION = "tripcash-v\d+"/, `const VERSION = "${nextCache}"`));
writeFileSync(appPath, readFileSync(appPath, "utf8")
  .replace(/APP_VERSION = "v\d+\.\d+\.\d+"/, `APP_VERSION = "${nextApp}"`));
git("add", "sw.js", "js/app.js");

console.log(`✔ reverted and bumped to ${nextApp} / ${nextCache}, staged but NOT committed.\n`);
console.log(`Next, in order:
  1. npm test && npm run test:rules
  2. Add docs/signoffs/${nextApp}.md — a rollback is a release and needs a
     verdict too, even if it is one line saying what broke.
  3. npm run preflight
  4. git commit  (say what broke, not just "revert")
  5. git push
  6. Verify the live site actually serves ${nextCache} before believing it.

Devices that already have the bad version get this on their SECOND open.`);

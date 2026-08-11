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
// One list of places a browser might be, shared with the test that uses it
// — two copies would drift, and the copy that drifted would be the one
// telling everybody the fold was checked.
import { findChrome } from "../tests/chrome.mjs";

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
const SHIPS = /\b(js\/|index\.html|styles\.css|sw\.js|icons\/|manifest\.json)/;
const changed = sh("git", ["status", "--short"]).split("\n").filter(Boolean);

// Locally the question is "does the tree differ from HEAD". In CI the tree
// IS HEAD, so that question answers itself and the check passed without
// testing anything — the failure mode this whole file exists to prevent.
// There, the question is whether the commit being deployed changed shipping
// files without moving the cache version.
const ciCompare = () => {
  try {
    const files = sh("git", ["diff", "--name-only", "HEAD~1", "HEAD"]).split("\n").filter(Boolean);
    const prev = sh("git", ["show", "HEAD~1:sw.js"]).match(/const VERSION = "([^"]+)"/)?.[1];
    return { shipping: files.some((f) => SHIPS.test(f)), before: prev };
  } catch { return null; }
};

const dirty = changed.length > 0;
const ci = dirty ? null : ciCompare();
const shipping = dirty ? changed.some((l) => SHIPS.test(l)) : !!ci?.shipping;
const previous = dirty ? headSw : ci?.before;

// Both of the above compare against a git ancestor, and that is the wrong
// question twice over. A push can carry several commits and Pages deploys
// the branch tip, so the delta that actually reaches devices is everything
// since the LAST DEPLOY, not HEAD~1..HEAD. Concretely: commit 1 changes
// js/app.js, commit 2 adds the changelog, push both — the parent comparison
// looks only at commit 2, sees no shipping change, and passes while devices
// never receive the update.
//
// This is the third time this one check has asked a question that answered
// itself. So ask production instead. The live site is ground truth: it does
// not care how commits were batched.
const LIVE = "https://tripcash.app";
const fetchLive = async (path) => {
  const res = await fetch(`${LIVE}/${path}?preflight=${Date.now()}`, {
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(`${path} → HTTP ${res.status}`);
  return res.text();
};

// The files a device actually loads. Not every shipping file — the SHELL is
// ~40 entries and this runs on every release — but the four that carry
// essentially all change. A release that touches only an icon and nothing
// here will not be caught; that is a known and stated gap, not an oversight.
const LIVE_FILES = ["index.html", "styles.css", "js/app.js", "sw.js"];

let liveVerdict = null;
try {
  const live = Object.fromEntries(
    await Promise.all(LIVE_FILES.map(async (f) => [f, await fetchLive(f)]))
  );
  const liveCache = live["sw.js"].match(/const VERSION = "(tripcash-v(\d+))"/);
  const localNum = Number(swVer?.match(/v(\d+)$/)?.[1]);
  const differs = LIVE_FILES.filter(
    (f) => live[f] !== readFileSync(join(ROOT, f), "utf8")
  );
  liveVerdict = {
    liveCache: liveCache?.[1],
    liveNum: Number(liveCache?.[2]),
    localNum,
    differs,
  };
} catch (err) {
  // Offline, or the site is down. Do not fail the release for that — say so
  // loudly and fall back, because a check that blocks work when the network
  // hiccups is a check people learn to bypass.
  console.log(`… could not reach ${LIVE} (${err.message}) — falling back to`);
  console.log(`  the git comparison, which cannot see batched pushes.`);
}

if (liveVerdict && liveVerdict.differs.length && !(liveVerdict.localNum > liveVerdict.liveNum)) {
  bad("what devices load has changed, but the cache version has not moved past the live one",
    `Live right now: ${liveVerdict.liveCache}. About to ship: ${swVer}.\n\n` +
    `Different from what is deployed:\n` +
    liveVerdict.differs.map((f) => `  ${f}`).join("\n") +
    `\n\nDevices keep the cached copy until stale-while-revalidate happens to\n` +
    `notice, which is not a delivery mechanism. Bump sw.js VERSION above\n` +
    `${liveVerdict.liveCache}, and APP_VERSION too if any code changed.`);
} else if (liveVerdict) {
  ok(liveVerdict.differs.length
    ? `${swVer} ships past the live ${liveVerdict.liveCache} (${liveVerdict.differs.length} file(s) changed)`
    : `identical to what is live (${liveVerdict.liveCache}) — nothing to deliver`);
} else if (shipping && previous && swVer === previous) {
  bad("something users load has changed but the SW cache version has not",
    `sw.js is still ${swVer}, unchanged from the previous commit.\n` +
    `Devices keep the cached copy until\n` +
    `stale-while-revalidate happens to replace it. Bump it, and APP_VERSION\n` +
    `too if any code changed.`);
} else {
  ok(`cache version ${swVer}, app version ${appVer}`);
}

// ---------- 4. nothing personal ----------
//
// The repo is public. A name or a real address in a comment or a fixture is
// not recoverable once pushed.
// /Users/ was in tests/decisions.test.mjs's list and not in this one, so
// a home-directory path could reach the public repo through any file the
// decisions test does not read. Two copies of one rule, drifted — the
// pattern this project keeps shipping.
const LEAKS = [/archisman/i, /@gmail\.com/i, /@icloud\.com/i, /Documents\/Claude/, /\/Users\//];
const leaky = [];
// This file is skipped: it holds the patterns, so it matches itself. The
// first run flagged "scripts/preflight.mjs: archisman" and was right to —
// the check works, it just cannot be its own subject.
// Files that hold the patterns, and therefore match themselves. The first
// run flagged "scripts/preflight.mjs: archisman" and was right to — the
// check works, it just cannot be its own subject. tests/decisions.test.mjs
// is the same thing for the decisions log. Anything added here must be a
// leak DETECTOR, not merely a file somebody wants to stop being told about.
const DETECTORS = new Set(["scripts/preflight.mjs", "tests/decisions.test.mjs"]);

// Tracked files AND files about to be added. Scanning only what git already
// knows means a brand-new file is invisible to this check on the very
// release that introduces it — which is exactly what happened to
// tests/decisions.test.mjs in v1.71.0: preflight ran while it was still
// untracked, reported clean, and the file shipped unscanned. Same shape as
// the untracked-module blocker check 1 exists for, pointing the other way.
const candidates = [
  ...sh("git", ["ls-files"]).split("\n"),
  ...sh("git", ["ls-files", "--others", "--exclude-standard"]).split("\n"),
];
for (const f of candidates
  .filter((f) => /\.(js|mjs|md|html|css|json)$/.test(f) && !DETECTORS.has(f))) {
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

// ---------- 5. the docs are not making claims that stopped being true ----------
//
// Added because a rule was written into the maintainer's memory saying
// "keep the docs current", and the docs drifted anyway the same afternoon.
// Every drift was mechanical — a count, a version, a link to a file that
// had moved — and a thing a machine can check should not depend on anyone
// remembering.
const docs = sh("git", ["ls-files", "*.md"]).split("\n").filter(Boolean);
const docProblems = [];

for (const f of docs) {
  const src = readFileSync(join(ROOT, f), "utf8");

  // An exact test count in prose is a promise to update it every sprint,
  // and that promise has been broken twice. "700+" is allowed; "699" is not.
  for (const m of src.matchAll(/(\d{3,4})\s+(?:unit\s+)?tests?\b/gi)) {
    const before = src.slice(Math.max(0, m.index - 2), m.index);
    if (!before.includes("+")) {
      docProblems.push(`${f}: claims exactly "${m[0]}" — write it as a floor ("700+ tests") so it cannot rot`);
    }
  }

  // A version named as the CURRENT one has to be current. A version named
  // as history — "this shipped in v1.42.1", which is most of what an ADR
  // is — is a fact about the past and must not be rewritten. The first
  // version of this check flagged fourteen of those, which would have
  // trained everyone to ignore it.
  for (const m of src.matchAll(/(currently|current version|now on|live at|as of)\D{0,24}v(\d+\.\d+\.\d+)/gi)) {
    if (m[2] !== appVer?.replace(/^v/, "")) {
      docProblems.push(`${f}: calls v${m[2]} current; current is ${appVer}`);
    }
  }

  // A relative markdown link to a file that is not there. This has already
  // happened once, when internal docs were moved out of the public repo and
  // twenty-eight references stayed behind pointing at nothing.
  for (const m of src.matchAll(/\]\((?!https?:|#|mailto:)([^)#]+)/g)) {
    const target = resolve(ROOT, dirname(f), m[1]);
    if (!existsSync(target)) docProblems.push(`${f}: links to ${m[1]}, which does not exist`);
  }
}

if (docProblems.length) {
  bad(`${docProblems.length} doc claim${docProblems.length > 1 ? "s" : ""} no longer true`,
    docProblems.slice(0, 20).join("\n"));
} else {
  ok(`${docs.length} docs make no stale claims`);
}

// ---------- 6. the version being shipped is written down ----------
//
// Found by the sprint 5 QA lead, in the gap between checks 3 and 5: this
// script confirms sw.js and app.js agree with EACH OTHER, and confirms the
// docs make no stale claims — but a version documented nowhere makes no
// claim at all, so it passed both. v1.70.0 reached the CDN with CHANGELOG.md
// stopping at 1.69.0. The repo is this project's memory; a release absent
// from it did not happen as far as any future reader is concerned.
const changelog = existsSync(join(ROOT, "CHANGELOG.md"))
  ? readFileSync(join(ROOT, "CHANGELOG.md"), "utf8")
  : "";
const bare = appVer?.replace(/^v/, "");
if (bare && !new RegExp(`^##\\s*\\[v?${bare.replace(/\./g, "\\.")}\\]`, "m").test(changelog)) {
  bad("the version about to ship is in no changelog entry",
    `app.js says ${appVer}; CHANGELOG.md has no "## [${bare}]" heading.\n` +
    `Write what is in this release before it becomes the thing nobody can\n` +
    `reconstruct. An [Unreleased] section does not count — it is not a version.`);
} else {
  ok(`${appVer} is documented in CHANGELOG.md`);
}

// ---------- 7. a human-readable QA verdict exists for this version ----------
//
// On 10 Aug 2026 v1.70.0 was committed, tagged and deployed while its
// sign-off agent was still running — the reviewer's verdict arrived after
// the code was on the CDN. The rule "do not release before sign-off" was
// already written down and was followed by every agent; the one actor it
// did not bind is the one that broke it. So it stops being a rule.
const signoffPath = `docs/signoffs/${appVer}.md`;
if (!existsSync(join(ROOT, signoffPath))) {
  bad("this version has no sign-off on record",
    `${appVer} is about to ship with no ${signoffPath}.\n\n` +
    `That file is the QA lead's verdict: the suites it actually ran with\n` +
    `real numbers, the per-story result, and what it did NOT verify. It is\n` +
    `written at the end of the sprint, by the reviewer, before the release.\n` +
    `If you are reading this because you released ahead of the review, that\n` +
    `is exactly the case this check exists for.`);
} else {
  ok(`${appVer} has a sign-off on record`);
}

// ---------- 8. the gate is still wired to the deploy ----------
//
// Everything above is advisory unless the repository's Pages source is set
// to "GitHub Actions". If it is ever switched back to "Deploy from a
// branch", the site publishes on push regardless of whether any of this
// passed — and nothing anywhere fails to mention it. That was literally the
// state of this project for six sprints.
//
// A control that silently becomes decorative is a shape that has already
// gone wrong here, which is what earns this check its place.
try {
  const build = sh("gh", ["api", "repos/archismandinda/tripcash/pages",
    "--jq", ".build_type"]).trim();
  if (build !== "workflow") {
    bad("Pages is not deploying from the CI gate",
      `Pages build_type is "${build}", not "workflow". The site publishes on\n` +
      `push whether or not anything above passed, so every check in this file\n` +
      `is currently decorative.\n\n` +
      `Fix: repo Settings → Pages → Build and deployment → Source →\n` +
      `"GitHub Actions".`);
  } else {
    ok("Pages deploys from the CI gate, not the branch");
  }
} catch {
  // No gh, not authenticated, or no network. Not a release blocker — but
  // never silent, because "I could not check" and "it is fine" are the two
  // things this file exists to keep apart.
  console.log("… could not read the Pages build type (gh unavailable or");
  console.log("  unauthenticated) — the gate's wiring is UNVERIFIED this run.");
}

// ---------- 9. the screen was measured, not skipped ----------
//
// tests/fold.test.mjs and tests/focus.test.mjs are the only things in this
// project that measure the screen instead of reasoning about it, and they
// need a browser. With no browser they skip — which is the honest answer
// for a contributor's laptop and completely wrong for a release, because a
// skipped test is green.
//
// That distinction is the whole reason this check exists, and both files
// are here because a static guard was already passing while the screen was
// wrong. The storefront's acceptance criterion — the call to action above
// the fold on a 375x667 phone — was guarded by word counts and DOM order,
// all of them blind to CSS, and two ordinary lines in styles.css put the
// button 58px under the fold with the entire suite passing. The focus ring
// was guarded by a rule lookup that read the FIRST rule with a selector
// where CSS applies the LAST, so one appended line put the app's primary
// control back on a 1.27:1 indicator, also with the suite passing.
// Shipping on a screen nothing measured is that state again, wearing a
// green tick.
const browser = findChrome();
if (!browser) {
  bad("the screen was not measured on this machine",
    `tests/fold.test.mjs and tests/focus.test.mjs skip with no Chrome or\n` +
    `Chromium, and a skipped test is indistinguishable from a passing one in\n` +
    `the summary. The storefront would ship on a fold nobody looked at, and\n` +
    `the amount rows on a focus ring nobody looked at.\n\n` +
    `Install Chrome, or point CHROME_PATH at one, then re-run:\n` +
    `  CHROME_PATH=... npm test`);
} else {
  ok(`the fold and the focus ring are measurable here (${browser})`);
}

console.log(
  failed
    ? `\n${failed} check${failed > 1 ? "s" : ""} failed — do not release.\n`
    : "\npreflight clean — safe to commit and push.\n"
);
process.exit(failed ? 1 : 0);

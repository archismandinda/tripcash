// What is actually deployed, and is there a rollout question to ask?
//
// Two decisions, both of which used to be inline in rollout.test.mjs and
// both of which were wrong there:
//
//   1. WHAT IS THE BASELINE. It was `git HEAD`. HEAD is not what is
//      deployed — it is whatever was committed last, so the sprint's own
//      commit became the baseline it was supposed to be measured against.
//      The baseline is now a pinned commit sha, read from
//      docs/deployed-baseline.txt, and this parser refuses a moving ref.
//   2. IS THE COMPARISON MEANINGFUL. When the baseline and the proposal
//      agree there is nothing to publish and no ordering question — which
//      is a real state, reached every time a release lands. That has to be
//      an explicit, spoken skip. Previously it presented as five vacuously
//      passing tests and one assertion failing on a premise, which is the
//      same output a genuinely broken release would produce.
//
// Kept out of js/ deliberately: this is test scaffolding, and anything in
// js/ has to be carried in the service worker's offline shell to a phone
// that will never run it (tests/shell.test.mjs).

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

export const BASELINE_FILE = "docs/deployed-baseline.txt";

// "client" was split into two on 10 Aug 2026 — see the header of
// docs/deployed-baseline.txt. This test measures against the FLOOR: the
// phone that breaks is the one that has not updated, so the newest client
// is the wrong thing to compare against. `client-live` is informational,
// and preflight reads the live site rather than trusting a hand-edited line.
const WHAT = ["client-floor", "rules"];
// file key -> the name the rest of this module uses.
const AS = { "client-floor": "client", rules: "rules" };

// ---------- pure ----------

// The pointer file's text -> { client, rules }, or an error a releaser can
// act on without reading this file. Blank lines and `#` comments ignored.
export function parseBaseline(text, source = BASELINE_FILE) {
  const found = new Map();
  for (const raw of String(text ?? "").split("\n")) {
    const line = raw.replace(/#.*$/, "").trim();
    if (!line) continue;
    const m = line.match(/^(\S+)[ \t]+(\S+)$/);
    if (!m) {
      throw new Error(
        `${source}: cannot read the line "${raw.trim()}". Each entry is ` +
        `"<what> <commit-sha>", one per line, e.g. "client-floor c74d692".`
      );
    }
    const [, what, rev] = m;
    // Recorded for a human, used by nothing: preflight reads the live site
    // rather than trusting a line somebody has to remember to update. It is
    // skipped rather than rejected so the file can carry both facts.
    if (what === "client-live") continue;
    if (!WHAT.includes(what)) {
      throw new Error(
        `${source}: "${what}" is not something that gets deployed. ` +
        `Expected ${WHAT.map((w) => `"${w}"`).join(" and ")}.`
      );
    }
    if (found.has(what)) {
      throw new Error(`${source}: "${what}" is named twice. Only one commit can be deployed.`);
    }
    if (/^HEAD/i.test(rev)) {
      throw new Error(
        `${source}: "${what} ${rev}" — HEAD is not a baseline. It moves the ` +
        `moment this sprint is committed, at which point the release gate is ` +
        `comparing the new ${what} against itself. Name the commit sha that ` +
        `is actually live.`
      );
    }
    if (!/^[0-9a-f]{7,40}$/.test(rev)) {
      throw new Error(
        `${source}: "${what} ${rev}" is not a commit sha. Branches and other ` +
        `moving refs are refused here on purpose — the baseline must still ` +
        `mean the same thing after the next commit lands.`
      );
    }
    found.set(what, rev);
  }
  const missing = WHAT.filter((w) => !found.has(w));
  if (missing.length) {
    throw new Error(
      `${source}: nothing says what ${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} ` +
      `deployed. Add "${missing[0]} <commit-sha>". The client and the rules are ` +
      `published separately and are often different commits, so neither can be ` +
      `guessed from the other.`
    );
  }
  return { client: found.get("client-floor"), rules: found.get("rules") };
}

// Is there an ordering question at all? Only a change to firestore.rules
// creates one: rules and clients deploy separately, so if the rules are not
// moving there is only one thing being deployed and nothing to sequence.
export function rolloutQuestion({ rulesLive, rulesNext }) {
  if (String(rulesLive).trim() === String(rulesNext).trim()) {
    return {
      arises: false,
      reason:
        `firestore.rules is byte-identical to the published revision named in ` +
        `${BASELINE_FILE}, so nothing is being published and there is no order ` +
        `to get wrong. If this release DOES change the rules, that file is stale.`,
    };
  }
  return { arises: true, reason: "firestore.rules is changing" };
}

// ---------- io ----------

const git = (cwd, args) => execFileSync("git", args, { cwd, encoding: "utf8" });

// The baseline, resolved against a real repository. Every failure here is
// fatal and says so: a gate that cannot find its baseline must not report
// that everything is fine.
export function resolveDeployed(cwd = process.cwd()) {
  let text;
  try {
    text = readFileSync(`${cwd}/${BASELINE_FILE}`, "utf8");
  } catch {
    throw new Error(
      `${BASELINE_FILE} is missing. It records the commits that are live — ` +
      `the client on the phones and the rules in the Firebase console — and ` +
      `without it there is nothing to compare this release against.`
    );
  }
  const refs = parseBaseline(text);
  const out = {};
  for (const what of WHAT) {
    const key = AS[what];
    try {
      out[key] = git(cwd, ["rev-parse", "--verify", `${refs[key]}^{commit}`]).trim();
    } catch {
      throw new Error(
        `${BASELINE_FILE} names ${what} ${refs[key]}, which is not a commit in ` +
        `this repository. (A shallow clone will not have it — fetch the full ` +
        `history, or correct the file.)`
      );
    }
  }
  return {
    client: out.client,
    rules: out.rules,
    rulesLive: git(cwd, ["show", `${out.rules}:firestore.rules`]),
    rulesNext: readFileSync(`${cwd}/firestore.rules`, "utf8"),
  };
}

// The deployed client, extracted WHOLE. js/sync.js imports its siblings,
// and a lone copy resolves them against the new tree — which would silently
// test the new client twice and report that everything is fine.
export function extractClient(cwd, sha, into) {
  const dir = into ?? `/tmp/tc-deployed-${sha.slice(0, 12)}`;
  execFileSync("rm", ["-rf", dir]);
  execFileSync("mkdir", ["-p", dir]);
  execFileSync("sh", ["-c", `git archive ${sha} js/ | tar -x -C ${dir}`], { cwd });
  return dir;
}

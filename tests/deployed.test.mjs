// The release gate must survive its own release being committed.
//
// tests-integration/rollout.test.mjs decides whether firestore.rules may be
// published before the client or must follow it. It did that by reading
// "the deployed client" and "the deployed rules" out of `git HEAD`.
//
// HEAD is not what is deployed. It is whatever was committed last. So the
// instant the sprint's own work was committed — the very next thing that
// happens after the work is approved — HEAD became the new client and the
// new rules, the gate started comparing them against themselves, five of
// its six tests went vacuously green and the sixth failed on a premise
// about a client that no longer existed. Nobody saw it during development,
// because before the commit it was green.
//
// That is worse than an ordinary red suite. the project's internal notes, §8d and
// docs/TESTING.md both send the releaser to that file before publishing
// rules, and the failure it guards against is a silent permission-denied on
// the phone of whoever is doing the right thing. A gate that is red for an
// unrelated reason is a gate that gets skipped.
//
// These tests run in the UNIT suite, on purpose: CI runs only
// `node --test tests/*.test.mjs`, so nothing about the emulator suite was
// ever checked anywhere but on a laptop, mid-release.

import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  BASELINE_FILE, parseBaseline, rolloutQuestion, resolveDeployed, extractClient,
} from "../tests-integration/deployed.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// ---------- the pointer file the whole thing hangs off ----------

test("the baseline names a commit for the client and for the rules, separately", () => {
  const b = parseBaseline("client-floor abc1234\nrules def5678\n");
  assert.deepEqual(b, { client: "abc1234", rules: "def5678" });
});

test("comments and blank lines are ignored, including trailing ones", () => {
  const b = parseBaseline("# what is live\n\nclient-floor abc1234  # v1.66.0\nrules def5678\n\n");
  assert.deepEqual(b, { client: "abc1234", rules: "def5678" });
});

test("HEAD is refused as a baseline — it is the defect this file exists for", () => {
  // The old design's baseline, stated as data. There is now no way to write
  // it down, which is the point: the bug is removed rather than handled.
  assert.throws(() => parseBaseline("client-floor HEAD\nrules HEAD\n"), /HEAD is not a baseline/);
  assert.throws(() => parseBaseline("client-floor abc1234\nrules HEAD~1\n"), /HEAD is not a baseline/);
});

test("a branch name is refused too — it moves for the same reason", () => {
  assert.throws(() => parseBaseline("client-floor main\nrules def5678\n"), /not a commit sha/);
});

test("neither half may be left out, because they are published separately", () => {
  assert.throws(() => parseBaseline("client-floor abc1234\n"), /rules is\s+deployed/);
  assert.throws(() => parseBaseline("rules def5678\n"), /client-floor is\s+deployed/);
  assert.throws(() => parseBaseline(""), /client-floor and rules are\s+deployed/);
});

test("a line nobody can act on is rejected with the line in the message", () => {
  assert.throws(() => parseBaseline("client\n"), /cannot read the line "client"/);
  assert.throws(() => parseBaseline("clietn abc1234\n"), /"clietn" is not something that gets deployed/);
  assert.throws(() => parseBaseline("client-floor abc1234\nclient-floor def5678\n"), /named twice/);
});

test("the repository's own baseline file parses and names two real-looking commits", () => {
  // Not resolved against git here: CI checks out shallow, so the commits
  // may genuinely be absent. The emulator suite resolves them for real and
  // fails loudly if it cannot.
  const b = parseBaseline(readFileSync(join(ROOT, BASELINE_FILE), "utf8"));
  assert.match(b.client, /^[0-9a-f]{7,40}$/);
  assert.match(b.rules, /^[0-9a-f]{7,40}$/);
});

// ---------- is there a question to ask ----------

test("no rules change means no ordering question, and it says so", () => {
  const q = rolloutQuestion({ rulesLive: "rules_v1\n", rulesNext: "rules_v1\n" });
  assert.equal(q.arises, false);
  assert.match(q.reason, /nothing is being published/);
});

test("a rules change means the question arises", () => {
  assert.equal(rolloutQuestion({ rulesLive: "rules_v1", rulesNext: "rules_v2" }).arises, true);
});

// ---------- the regression itself ----------

// A throwaway repository standing in for this one: one commit that is
// "released", then a sprint on top of it. Hermetic on purpose — it must not
// depend on this project's own history, which shallow clones do not have.
function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), "tc-baseline-"));
  const run = (...args) => execFileSync("git", args, { cwd: dir, encoding: "utf8" });
  const put = (path, body) => {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), body);
  };
  run("init", "-q", "-b", "main");
  run("config", "user.email", "dev@example.com");
  run("config", "user.name", "dev");

  // The release that is live.
  put("firestore.rules", "RULES AS PUBLISHED\n");
  put("js/sync.js", "export const buildPayload = () => ({ ownerUid: 'seized' });\n");
  run("add", "-A");
  run("commit", "-qm", "the release that is live");
  const released = run("rev-parse", "HEAD").trim();

  // The sprint, uncommitted — exactly the state the developer sees.
  put("firestore.rules", "RULES THE SPRINT WANTS PUBLISHED\n");
  put("js/sync.js", "export const buildPayload = () => ({ ownerUid: null });\n");
  put(BASELINE_FILE, `client-floor ${released}\nrules ${released}\n`);
  return { dir, run, released, cleanup: () => rmSync(dir, { recursive: true, force: true }) };
}

test("committing the sprint does not move the baseline out from under the gate", () => {
  const s = sandbox();
  try {
    const before = resolveDeployed(s.dir);
    assert.equal(before.rulesLive, "RULES AS PUBLISHED\n");
    assert.equal(before.rulesNext, "RULES THE SPRINT WANTS PUBLISHED\n");
    assert.equal(rolloutQuestion(before).arises, true, "the gate has something to compare");

    // What the orchestrator does the moment the work is signed off, and
    // what used to turn this suite red.
    s.run("add", "-A");
    s.run("commit", "-qm", "simulate the sprint shipping");

    const after = resolveDeployed(s.dir);
    assert.equal(after.rulesLive, "RULES AS PUBLISHED\n", "the published rules did not change by being committed over");
    assert.equal(after.rulesNext, "RULES THE SPRINT WANTS PUBLISHED\n");
    assert.equal(rolloutQuestion(after).arises, true, "the gate still has something to compare");
    assert.deepEqual(after, before, "the whole comparison is unchanged by the commit");
  } finally {
    s.cleanup();
  }
});

test("the deployed CLIENT is the released one too, not the tree it is being compared with", () => {
  const s = sandbox();
  try {
    s.run("add", "-A");
    s.run("commit", "-qm", "simulate the sprint shipping");
    const { client } = resolveDeployed(s.dir);
    const dir = extractClient(s.dir, client, join(s.dir, ".extracted"));
    // Not the sprint's client. This is the assertion that used to hold only
    // while the work was uncommitted.
    assert.match(readFileSync(join(dir, "js/sync.js"), "utf8"), /ownerUid: 'seized'/);
  } finally {
    s.cleanup();
  }
});

test("a baseline naming a commit that does not exist is fatal, never a quiet pass", () => {
  const s = sandbox();
  try {
    writeFileSync(join(s.dir, BASELINE_FILE), "client-floor 0123456789abcdef0123456789abcdef01234567\nrules 0123456\n");
    assert.throws(() => resolveDeployed(s.dir), /not a commit in\s+this repository/);
  } finally {
    s.cleanup();
  }
});

test("a missing baseline file is fatal, and says what it was for", () => {
  const s = sandbox();
  try {
    rmSync(join(s.dir, BASELINE_FILE));
    assert.throws(() => resolveDeployed(s.dir), /is missing/);
  } finally {
    s.cleanup();
  }
});

// ---------- and the gate itself may not go back to reading HEAD ----------

test("rollout.test.mjs takes its baseline from the pointer file and from nowhere else", () => {
  // The bug was one word. Both halves of it — `git show HEAD:` and
  // `git archive HEAD` — lived in that file, and the fix only holds while
  // the definition of "deployed" stays in one place.
  const source = readFileSync(join(ROOT, "tests-integration/rollout.test.mjs"), "utf8");
  const code = source.replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(code, /\bHEAD\b/, "rollout.test.mjs must not resolve anything against HEAD");
  assert.match(code, /from "\.\/deployed\.mjs"/, "it must use the one resolver");
});

// The decision records, checked as a record rather than as prose.
//
// ADR-0022 stated a property as settled fact — "removal deletes the ROW,
// and a row the winner no longer carries is never rebuilt" — that holds
// only when the remover's record wins the stamp. Five sprints and a
// seven-lane audit then asked whether the code did what ADR-0022 said,
// instead of whether ADR-0022 was right. Nothing could catch that, because
// nothing read docs/ at all.
//
// So the parts of a decision record that a machine CAN check are checked
// here, in tests/, not in scripts/preflight.mjs: CI runs tests/*.test.mjs
// and nothing else, and docs/deployed-baseline.txt exists because a gate
// that only ever ran on one laptop is a gate nobody runs.
//
// Three of these are structural — an ADR nobody indexed is an ADR nobody
// finds, and a supersession recorded on one side only is a reader trusting
// whichever file they opened. The rest hold ADR-0024 to the things it was
// written to carry, and hold ADR-0022's false sentence in place: it is
// annotated, never deleted. The index says the records written after a
// decision turned out wrong are the useful ones, and a quietly corrected
// ADR teaches nothing.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
// A printed reproduction is checked by running it, not by reading it.
import { mergePayload } from "../js/sync.js";
import { evictionFrom } from "../js/roster.js";

const DIR = new URL("../docs/decisions/", import.meta.url);
const read = (name) => readFileSync(new URL(name, DIR), "utf8");
const RECORDS = readdirSync(DIR).filter((f) => /^\d{4}-.+\.md$/.test(f)).sort();
const README = read("README.md");

// Prose in these files is hard-wrapped, so a sentence to look for is
// routinely split across two lines. Matching the raw text found nothing and
// reported the sentence as deleted — the failure this file exists to catch,
// announced for the wrong reason, which is its own kind of useless.
const flow = (src) => src.replace(/\s+/g, " ");

// ---------- the index ----------

test("every decision record is in the index", () => {
  assert.ok(RECORDS.length >= 24, `only ${RECORDS.length} records found`);
  for (const file of RECORDS) {
    assert.ok(
      README.includes(file),
      `docs/decisions/${file} is not linked from README.md — an ADR nobody ` +
      `indexed is one nobody reads before touching the thing it decides`
    );
  }
});

test("the index does not link records that are not there", () => {
  const present = new Set(RECORDS);
  for (const m of README.matchAll(/\((\d{4}-[^)]+\.md)\)/g)) {
    assert.ok(present.has(m[1]), `README.md links ${m[1]}, which does not exist`);
  }
});

// ---------- the supersession, recorded on BOTH sides ----------

test("ADR-0024 exists and says what it supersedes", () => {
  const adr = flow(read("0024-the-roster-is-a-collection.md"));
  assert.match(adr, /Supersedes ADR-0022/);
});

test("ADR-0022 says it was superseded, under its own title", () => {
  const adr = read("0022-removal-revokes-access.md");
  assert.match(flow(adr), /Superseded by ADR-0024/);
  // Directly under the title, because a reader who stops after the first
  // screen is the reader this line exists for.
  const lines = adr.split("\n").slice(0, 6).join("\n");
  assert.match(flow(lines), /Superseded by ADR-0024/,
    "the supersession is somewhere in 0022 but not at the top, where it is read");
});

test("the false sentence in ADR-0022 is annotated in place, never deleted", () => {
  const adr = flow(read("0022-removal-revokes-access.md"));
  const claim = "a row the winner no longer carries is never rebuilt";
  const at = adr.indexOf(claim);
  assert.notEqual(at, -1,
    "the sentence ADR-0024 corrects has been removed from ADR-0022. Leave it: " +
    "a record that was quietly edited teaches nothing about how it went wrong");
  const around = adr.slice(at, at + 700);
  assert.match(around, /false/i, "the claim is not marked false where it is made");
  assert.match(around, /0024/, "the claim is marked false with no pointer to ADR-0024");
});

// ---------- what ADR-0024 has to carry ----------

test("ADR-0024 names both scenarios, the modules and the functions", () => {
  const adr = flow(read("0024-the-roster-is-a-collection.md"));
  for (const needle of [
    "Scenario A", "Scenario B",
    "js/merge.js", "js/sync.js", "js/roster.js",
    "mergePayload", "mergeCollection", "reconcileClaims", "evictionFrom", "applyEviction",
  ]) {
    assert.ok(adr.includes(needle), `ADR-0024 does not mention ${needle}`);
  }
});

test("ADR-0024 carries the printed reproduction, not a description of one", () => {
  const adr = read("0024-the-roster-is-a-collection.md");
  // Scenario B ends with the third member gone from both derived lists;
  // scenario A ends with the removed member's uid back on memberUids.
  assert.match(adr, /memberUids\s+\["OWNER","BALA"\]/,
    "scenario B's printed result is missing");
  assert.match(adr, /memberUids\s+\["OWNER","BALA","PRIYA"\]/,
    "scenario A's printed result is missing");
  assert.match(adr, /invitedEmails\s+\["asha@example\.com","bala@example\.com"\]/,
    "scenario B's derived invite list is missing — that is the read half of the access loss");
});

// ---------- and carries it from ONE revision ----------
//
// The scenario B block was spliced. Its four merge lines are a run against
// the code as it stood before this record's decision landed; its last line —
// "evicted false lockedOut true retry false trips kept 1" — is a run against
// the code after part 1, pasted into the same fence with nothing saying so.
// No revision prints the block as it stood: before part 1 the same call
// returns evicted true and keeps no trips, and after part 2 the merge above
// it keeps Priya. So a reader who does what this sprint asks — run the
// reproduction instead of trusting it — gets a different answer from either
// revision and concludes the record is wrong again. It also read as the
// mirror image of the harm: the block said nothing was deleted, under a
// heading about a trip being evicted, in a record whose own prose two
// paragraphs later says the client deleted the trip, its expenses, its
// settlements and its receipts.
//
// A printed figure is only worth printing if it can be reproduced, so both
// checks below drive the real modules with the record's own inputs.

// Scenario B, exactly as ADR-0024 states it: Priya was added on Asha's
// phone, Bala was offline through it and then renamed the trip, so his
// record wins the stamp and has never carried her row.
const SCENARIO_B = {
  localStamp: 2000,
  remoteStamp: 2001,
  member: (id, name, uid) => ({ id, name, uid, email: `${name.toLowerCase()}@example.com` }),
};
const payloadB = () => {
  const { member } = SCENARIO_B;
  const asha = member("m1", "Asha", "OWNER");
  const bala = member("m2", "Bala", "BALA");
  const priya = member("m3", "Priya", "PRIYA");
  const pay = (updatedAt, members) => ({
    trip: { id: "t1", name: "Goa", updatedAt, members },
    expenses: [], settlements: [],
    tombstones: { expenses: {}, settlements: {}, members: {} },
  });
  return [pay(SCENARIO_B.localStamp, [asha, bala, priya]),
    pay(SCENARIO_B.remoteStamp, [asha, bala])];
};
const EVICTION_B = {
  code: "permission-denied", tripId: "t1",
  trips: [{ id: "t1", name: "Goa" }], stillReadable: false,
};

const fencesOf = (src) => [...src.matchAll(/```\n([\s\S]*?)```/g)].map((m) => m[1]);

test("ADR-0024's scenario B reproduction is one revision, not two spliced", () => {
  const adr = read("0024-the-roster-is-a-collection.md");
  const block = fencesOf(adr).find((b) => b.includes("SCENARIO B"));
  assert.ok(block, "scenario B's printed reproduction is gone");

  // The fixture below is only evidence if it is the record's own inputs.
  const stamps = [...block.matchAll(/trip\.updatedAt (\d+)/g)].map((m) => Number(m[1]));
  assert.deepEqual(stamps, [SCENARIO_B.localStamp, SCENARIO_B.remoteStamp],
    "the block's stamps have moved away from the inputs this test drives");

  const [local, remote] = payloadB();
  const today = {
    uids: [...mergePayload(local, remote).memberUids].sort(),
    eviction: evictionFrom(EVICTION_B),
  };

  const printedUids = JSON.parse(block.match(/memberUids\s+(\[[^\]]*\])/)[1]).sort();
  const printedEvicted = block.match(/evicted (true|false)/)[1] === "true";
  const printedKept = Number(block.match(/trips kept (\d+)/)[1]);

  // Either half may be the older run — a record about a defect SHOULD print
  // the broken behaviour. What it may not do is print one half from each,
  // because then the block as a whole is something nobody can reproduce.
  const mergeIsToday = printedUids.join() === today.uids.join();
  const evictionIsToday =
    printedEvicted === today.eviction.evicted && printedKept === today.eviction.trips.length;
  const say = (yes) => (yes ? "IS" : "is NOT");
  assert.equal(mergeIsToday, evictionIsToday,
    `scenario B's block mixes revisions: its merge output ${say(mergeIsToday)} what the ` +
    `code returns today, and its evictionFrom line ${say(evictionIsToday)}. Print one run, ` +
    "and label which revision it came from.");

  // And it must agree with its own heading. The block exists to show the
  // harm — a device that heard nothing evicting somebody nobody removed —
  // so if it prints the pre-fix merge it has to print the pre-fix eviction
  // that followed from it, trip deleted and all.
  if (!mergeIsToday) {
    assert.equal(printedEvicted, true,
      "the merge lines show Priya off the access list, so the phone concluded " +
      "removal — printing `evicted false` there understates the harm the " +
      "record was written to hold on to");
    assert.equal(printedKept, 0, "pre-fix, the trip was deleted; the block keeps it");
  }
});

test("ADR-0024's post-fix eviction figures are what the code actually returns", () => {
  const adr = read("0024-the-roster-is-a-collection.md");
  // The reproducible-today answer has to be in the record too, labelled, or
  // a reader running the block gets a result the record never mentions.
  const line = adr.match(
    /with part 1 landed:\s*\n\s*evicted (\w+)\s+lockedOut (\w+)\s+retry (\w+)\s+trips kept (\d+)/
  );
  assert.ok(line,
    "ADR-0024 prints a pre-fix reproduction and never says what the same call " +
    "returns now. Label it `evictionFrom() — with part 1 landed:` and print it");

  const now = evictionFrom(EVICTION_B);
  assert.equal(line[1], String(now.evicted), "the record's `evicted` is not what evictionFrom returns");
  assert.equal(line[2], String(now.lockedOut), "the record's `lockedOut` is not what evictionFrom returns");
  assert.equal(line[3], String(now.retry), "the record's `retry` is not what evictionFrom returns");
  assert.equal(Number(line[4]), now.trips.length,
    "the record's kept-trip count is not what evictionFrom returns — part 1's whole " +
    "point is that the trip survives");
});

test("ADR-0024 says why the property was false, not only that it was", () => {
  const adr = flow(read("0024-the-roster-is-a-collection.md"));
  // The reason is one sentence js/merge.js opens with, and it is applied to
  // expenses and settlements but never to the members list.
  assert.match(adr, /tombstone/i);
  assert.match(adr, /has not heard|hadn't heard|has not yet heard/i);
});

test("ADR-0024 records the two parts of the decision in the order they land", () => {
  const adr = flow(read("0024-the-roster-is-a-collection.md"));
  const first = adr.indexOf("1. Eviction stops deleting");
  const second = adr.indexOf("2. The roster becomes a collection");
  assert.notEqual(first, -1, "part one of the decision is not stated");
  assert.notEqual(second, -1, "part two of the decision is not stated");
  assert.ok(first < second,
    "the parts are in the wrong order — non-destructive eviction has to land " +
    "first, or every merge accident is still destroying somebody's ledger " +
    "while the collection work is being written");
});

// ---------- the repo is public ----------
//
// scripts/preflight.mjs runs this check over `git ls-files`, so a decision
// record is invisible to it for exactly as long as it is new — which is the
// whole of the sprint that writes it, and the only time anyone is pasting a
// reproduction into one.
test("no decision record leaks a real person, address or local path", () => {
  const LEAKS = [/archisman/i, /@gmail\.com/i, /@icloud\.com/i, /Documents\/Claude/, /\/Users\//];
  for (const file of [...RECORDS, "README.md"]) {
    const src = read(file);
    for (const re of LEAKS) {
      const hit = src.match(re);
      const near = hit ? src.slice(Math.max(0, hit.index - 40), hit.index + 40) : "";
      if (hit && /archismandinda\.github\.io|archismandinda\/tripcash/.test(near)) continue;
      assert.equal(hit, null, `docs/decisions/${file} contains "${hit?.[0]}"`);
    }
  }
});

// The suite runs in a pinned environment, and the pin reaches this process.
//
// `npm test` has read `LC_ALL=en_US.UTF-8 LANG=en_US.UTF-8 node --test` since
// a currency-parsing bug turned out to depend on the device locale. The
// TIMEZONE was never pinned beside it — and js/insights.js has derived the
// opening currency pair from the device timezone, not the locale, since the
// sprint that fixed an Indian phone opening on USD.
//
// So the suite's answer depended on which chair it was run from. Measured
// with `TZ=<zone> LC_ALL=en_US.UTF-8 node --test tests/*.test.mjs`, before
// this pin existed — 876 tests:
//
//   Asia/Kolkata        876 pass     UTC                 875 pass, 1 fail
//   Asia/Tokyo          876 pass     America/New_York    875 pass, 1 fail
//   Australia/Sydney    876 pass     America/Los_Angeles 875 pass, 1 fail
//   Africa/Nairobi      876 pass     Europe/London       875 pass, 1 fail
//   Asia/Dubai          876 pass     Europe/Berlin       875 pass, 1 fail
//   America/Sao_Paulo   876 pass     Pacific/Auckland    875 pass, 1 fail
//   Asia/Kathmandu      876 pass     Pacific/Chatham     874 pass, 2 fail
//                                    Pacific/Midway      874 pass, 2 fail
//                                    Pacific/Kiritimati  874 pass, 2 fail
//
// UTC is the column that matters: it is what CI runs, and a green suite on
// one laptop against a red gate on the runner is how v1.76.0 came to be
// committed, pushed and not deployed.
//
// Three different tests are in that right-hand column, which is the part
// worth knowing. Only one of them is the story anybody was told:
//
//   focus.test.mjs     the second amount row is not USD where the zone's own
//                      currency is USD, or where the zone names no city
//   splits.test.mjs    byDay is bucketed by the LOCAL day and the fixture is
//                      written in Date.UTC, so they agree from UTC−9 to
//                      UTC+11:59 and nowhere else
//   analytics.test.mjs asserts defaultOptIn(undefined) === true, and
//                      `undefined` is what makes that function read the
//                      machine — so it asserts "this laptop is not in
//                      Europe", and in Europe it is false BY DESIGN
//
// This pin fixes the first and buries the other two. That is what a pin
// does, and it is why the sweep in docs/TESTING.md is written down: the
// suite is now reproducible, the code underneath it is not zone-independent,
// and nothing here can tell the difference.
//
// Pinning is the same remedy as the locale, in the same place, for the same
// reason: the suite must give one answer, and it must be the answer CI gets.
// It is not a claim that the zone below is the right one to develop in — it
// is a claim that there has to be exactly one.
//
// Why a real city zone and not UTC. `Intl` on a phone names a city; "UTC"
// has no "/" in it, so currencyForTimeZone() returns null for it and
// initialHomeCurrency() falls through to the locale. tests/focus.test.mjs
// and tests/fold.test.mjs boot the actual app in Chrome, and under TZ=UTC
// they would boot it down the fallback branch — a configuration essentially
// no device is in, and specifically not the branch the app takes on a phone.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { currencyForTimeZone } from "../js/insights.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const script = pkg.scripts?.test ?? "";

// The zone the suite is pinned to, read out of the script rather than
// written down twice — a second copy here would be the exact drift this
// project keeps paying for.
const PINNED = script.match(/(?:^|\s)TZ=(\S+)/)?.[1] ?? null;

// Two spellings of one zone ("Asia/Kolkata" and its legacy alias
// "Asia/Calcutta") must not read as a broken pin: ICU normalises aliases
// and does not agree with itself across versions about which way. Formatting
// the same instant in both is the question actually being asked.
const at = (tz) => new Intl.DateTimeFormat("en-US",
  { timeZone: tz, dateStyle: "short", timeStyle: "long" }).format(0);

test("npm test pins the timezone as well as the locale", () => {
  assert.match(script, /(?:^|\s)LC_ALL=\S+/,
    "the locale pin has gone — currency parsing differs by locale and this " +
    "suite has caught bugs that only appear in comma-decimal ones");
  assert.match(script, /(?:^|\s)LANG=\S+/, "LANG is the other half of the locale pin");
  assert.ok(PINNED,
    "package.json's test script does not pin TZ. It pins LC_ALL and LANG for " +
    "the same reason, and the timezone decides the opening currency pair " +
    "(js/insights.js), so the suite answers differently on every machine.");
  // Order matters: an assignment after the command is an argument, not an
  // environment variable.
  assert.ok(script.indexOf("TZ=") < script.indexOf("node"),
    `TZ= must come before the command it pins, got: ${script}`);
});

test("the pin reached this process", () => {
  // A pin written down and not in effect is worse than none: the suite
  // reports the environment it claims rather than the one it measured in.
  // This is also what a bare `node --test tests/*.test.mjs` trips over, on
  // purpose — that invocation is unpinned and is not the suite.
  assert.ok(PINNED, "nothing is pinned, so nothing can have reached here");
  const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
  assert.equal(at(resolved), at(PINNED),
    `this process is in ${resolved}, not the pinned ${PINNED}. Run \`npm test\`; ` +
    "a bare `node --test` measures whatever zone this machine happens to be in.");
});

test("the pinned zone is one a phone could report", () => {
  // Load-bearing, and the failure it prevents is mystifying otherwise:
  // tests/focus.test.mjs clicks the SECOND amount row and names the currency
  // it expects there. That row is chosen by js/coldopen.js from the home
  // currency, which initialHomeCurrency() takes from the timezone. Change
  // this pin to a zone that names no city — "UTC", "Etc/GMT+12" — and the
  // app boots down the locale fallback, the second row becomes a different
  // currency, and focus.test.mjs fails with a currency mismatch that says
  // nothing about timezones at all.
  //
  // The guard is not ceremony. currencyForTimeZone(null) reads THIS MACHINE's
  // zone — `tz ?? Intl…timeZone` — so with nothing pinned this assertion
  // passed by measuring the laptop it ran on, which is the defect the whole
  // file is about, reproduced inside the file about it.
  assert.ok(PINNED, "nothing is pinned, so there is no zone to judge");
  assert.ok(currencyForTimeZone(PINNED),
    `TZ=${PINNED} names no city currencyForTimeZone() knows, so the app under ` +
    "test boots on the locale fallback instead of the timezone — which is not " +
    "the branch a phone takes. Pin a zone that resolves to a currency.");
});

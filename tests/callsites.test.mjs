// The locale a number is READ in must be the locale it was WRITTEN in.
//
// convert.js has been right about this for six locales since v1.49, and
// tests/convert.test.mjs proves it. What no test could see is whether the
// app ever passes the locale. Five call sites in js/app.js did not, so on
// any comma-decimal phone the app parsed its own output with the wrong
// separators: "2,500.00" (the INR prefill) came back null, "1,20,000"
// (the lakh row's own output) came back null, and a split share typed as
// "2,50" came back 250. The rule was correct and the wiring was not —
// which is this project's recurring shape, and the only thing that
// catches it is a test that reads the real source.
//
// Built like tests/shell.test.mjs: it asserts a shape, not a behaviour,
// because the shape is the part nothing else can check.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { awaitingInvite } from "../js/roster.js";
import { countsInvite, rememberInvite } from "../js/analytics.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

const lineOf = (source, index) => source.slice(0, index).split("\n").length;

// Count the arguments of the call whose "(" is at `open`, ignoring commas
// nested inside further calls, arrays, objects and template expressions.
function topLevelArgs(source, open) {
  let depth = 0, commas = 0, seen = false, quote = null;
  const templates = [];
  for (let i = open; i < source.length; i++) {
    const ch = source[i];
    if (quote) {
      if (ch === "\\") { i++; continue; }
      if (ch === quote) { quote = null; continue; }
      // `${` opens an expression: real code again until the matching "}".
      if (quote === "`" && ch === "$" && source[i + 1] === "{") {
        templates.push(quote);
        quote = null;
        depth++;
        i++;
      }
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") { quote = ch; seen = true; continue; }
    if (ch === "(" || ch === "[" || ch === "{") { depth++; continue; }
    if (ch === ")" || ch === "]" || ch === "}") {
      depth--;
      if (depth === 0) break;
      if (ch === "}" && templates.length) quote = templates.pop();
      continue;
    }
    if (ch === "," && depth === 1) { commas++; continue; }
    if (!/\s/.test(ch)) seen = true;
  }
  return seen ? commas + 1 : 0;
}

function callsOf(file, name) {
  const source = read(file);
  return [...source.matchAll(new RegExp(`\\b${name}\\(`, "g"))].map((m) => {
    const open = m.index + m[0].length - 1;
    return { file, line: lineOf(source, m.index), args: topLevelArgs(source, open) };
  });
}

// The body of `name`, found by matching braces from its opening one.
function bodyOf(source, name) {
  const at = source.search(new RegExp(`function\\s+${name}\\b`));
  assert.notEqual(at, -1, `${name} should exist`);
  // Past the parameter list first: a default like `prefill = {}` would
  // otherwise be mistaken for the body.
  let i = source.indexOf("(", at), params = 0;
  for (; i < source.length; i++) {
    if (source[i] === "(") params++;
    else if (source[i] === ")" && --params === 0) break;
  }
  const open = source.indexOf("{", i);
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) return source.slice(open, i + 1);
  }
  throw new Error(`${name} has no closing brace`);
}

test("every parseAmount call names the locale its text was written in", () => {
  const bare = callsOf("js/app.js", "parseAmount").filter((c) => c.args < 2);
  assert.deepEqual(
    bare.map((c) => `${c.file}:${c.line}`),
    [],
    "a one-argument parseAmount reads whatever locale the DEVICE happens to " +
    "use, which is never the locale the field was written in:\n  " +
    bare.map((c) => `${c.file}:${c.line} — called with ${c.args} argument(s)`).join("\n  ")
  );
});

test("parse.js never parses free text in an unstated locale", () => {
  const bare = callsOf("js/parse.js", "parseHuman").filter((c) => c.args < 2);
  assert.deepEqual(
    bare.map((c) => `${c.file}:${c.line}`),
    [],
    "shared text and QR payloads are parsed in different formats; each call " +
    "must say which:\n  " +
    bare.map((c) => `${c.file}:${c.line} — called with ${c.args} argument(s)`).join("\n  ")
  );
});

test("en-US is pinned to the machine formats and nowhere else", () => {
  // UPI "am=" and EMVCo tag 54 are dot-decimal by specification, so they
  // are parsed in a fixed locale on purpose. Free human text is not, and
  // pinning it read a German "1.500 EUR" as one and a half euros.
  const source = read("js/parse.js");
  const decl = source.match(/^.*\bparseMachine\b.*$/m);
  assert.ok(decl, "js/parse.js should declare parseMachine");
  assert.ok(decl[0].includes('"en-US"'), "parseMachine is where the pin belongs");
  assert.equal(
    source.replace(decl[0], "").includes("en-US"),
    false,
    'js/parse.js pins "en-US" somewhere other than parseMachine'
  );
  assert.equal(
    bodyOf(source, "parseSharedText").includes("en-US"),
    false,
    "parseSharedText must read free text in the caller's locale"
  );
});

test("the payment sheet writes and reads #p-amount in one locale", () => {
  // Both ends of this field used to disagree: it was written in the home
  // currency's locale and read in the device's. With home INR on a de-DE
  // phone the sheet opened showing "2,500.00", that string parsed to
  // null, and Save was disabled for ever with nothing on screen saying
  // why. Whatever currency #p-code holds, both ends must follow it.
  const source = read("js/app.js");
  const open = bodyOf(source, "openPaymentSheet");
  assert.match(open, /#p-amount[\s\S]*?formatAmount\(pState\.amount,\s*pState\.code\)/,
    "openPaymentSheet must prefill #p-amount in the currency the field is showing");
  assert.match(source, /#p-amount[^\n]*addEventListener[\s\S]{0,200}?parseAmount\([^\n]*amountLocale\(pState\.code\)/,
    "#p-amount must be read back in the locale it was written in");
  assert.match(source, /#p-code[^\n]*addEventListener[\s\S]{0,400}?#p-amount/,
    "changing #p-code must rewrite #p-amount in the new currency's locale");
});

// ---------- every invitation reaches the same counter ----------
//
// v1.56 added `invitedAt` and wired it into ONE of two invite paths.
// There are three here, so the counter is written once, in one helper,
// and each path is asserted to reach it. A second copy of the send would
// be a second copy of the dedupe rule, and that is how the first term of
// k quietly starts measuring something else.

test("invite_sent is counted in exactly one place", () => {
  const source = read("js/app.js");
  assert.equal(
    source.split(`count("invite_sent"`).length - 1, 1,
    "one call site, or the dedupe rule exists twice"
  );
});

test("all three ways of inviting somebody reach that one place", () => {
  const source = read("js/app.js");
  for (const fn of ["inviteEveryone", "sendInvite", "shareInviteTo"]) {
    assert.ok(
      bodyOf(source, fn).includes("countInvite("),
      `${fn} puts an invitation in front of somebody and must count it`
    );
  }
  // …and the member sheet's Send button is what reaches shareInviteTo.
  assert.match(source, /#mx-send[\s\S]{0,400}?shareInviteTo\(/,
    "the member sheet's Send button must still go through shareInviteTo");
});

test("counting an invitation must never stop one being sent", () => {
  // `invitedAt` means the invitation actually WENT OUT, and awaitingInvite
  // reads it to decide who still needs one. If the counter set it, a
  // member counted on the share path would never have their invite
  // written to the index — the count would replace the invitation.
  const source = read("js/app.js");
  assert.equal(bodyOf(source, "countInvite").includes("invitedAt"), false,
    "the counter must not touch invitedAt");

  const member = { id: "m1", email: "bo@example.com" };
  const counted = rememberInvite([], member.id);
  assert.deepEqual(counted, ["m1"]);
  assert.equal(countsInvite(counted, member.id), false, "counted once");
  assert.deepEqual(awaitingInvite([member]), [member],
    "recording the count leaves the member still awaiting a real invitation");
});

test("on a comma-decimal device the app cannot read its own INR output", () => {
  // Why the call sites above matter, demonstrated rather than asserted:
  // run convert.js in a process whose device locale is German. This is
  // the state a European traveller's phone is in permanently.
  const script = `
    import { formatAmount, parseAmount, localeFor } from ${JSON.stringify(join(ROOT, "js/convert.js"))};
    const shown = formatAmount(2500, "INR");
    console.log(JSON.stringify({
      device: new Intl.NumberFormat().resolvedOptions().locale,
      shown,
      deviceRead: parseAmount(shown),
      fieldRead: parseAmount(shown, localeFor("INR")),
    }));
  `;
  for (const device of ["de_DE.UTF-8", "fr_FR.UTF-8", "pt_BR.UTF-8", "id_ID.UTF-8"]) {
    const out = execFileSync(process.execPath, ["--input-type=module", "-e", script], {
      env: { ...process.env, LC_ALL: device, LANG: device },
      encoding: "utf8",
    });
    const r = JSON.parse(out);
    assert.equal(r.shown, "2,500.00", `${device}: the prefill is written in en-IN`);
    assert.equal(r.deviceRead, null, `${device}: reading it in the device locale must be the broken path`);
    assert.equal(r.fieldRead, 2500, `${device}: reading it in the field's own locale must round-trip`);
  }
});

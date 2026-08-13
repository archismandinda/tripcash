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

// ---------- every catch makes a decision a reviewer can see ----------
//
// Three read-only lanes reported that this app fails silently. It is
// half true, and the half that is true is the dangerous half. Most of
// js/app.js's catches are correctly reasoned and carry a comment saying
// so; what did not exist was a RULE. Each one was decided by hand, one
// at a time, and the ones nobody got round to are the ones nobody hears:
// `sendInvite` toasts a refused invite write, `inviteEveryone` catches
// the identical failure with an empty block two thousand lines away.
//
// So this does not demand thirty toasts. It demands that every catch
// either speaks or opens with a `silent:` comment saying why it
// deliberately does not. That allowlist of reasons IS the deliverable —
// a reviewer can read the judgements instead of guessing which were made
// and which were merely forgotten.

// Comments, string contents and regex bodies replaced by spaces, offsets
// preserved. Without this a `{` inside a comment breaks the brace
// matching below, and a `catch` written INSIDE a comment (js/app.js has
// five, two of them whole `.catch(() => {})` snippets being quoted) is
// scanned as though it were code.
function maskLiterals(source) {
  const out = source.split("");
  const blank = (from, to) => {
    for (let i = from; i < to; i++) if (out[i] !== "\n") out[i] = " ";
  };
  let i = 0, prev = "";       // prev = last significant code character
  const stack = [];           // template-literal nesting: "t" text, "e" ${}
  // Consume template text from `i`, stopping at ` or ${.
  const template = () => {
    let j = i;
    while (j < source.length) {
      if (source[j] === "\\") { j += 2; continue; }
      if (source[j] === "`") { blank(i, j); i = j + 1; stack.pop(); return; }
      if (source[j] === "$" && source[j + 1] === "{") { blank(i, j); i = j; return; }
      j++;
    }
    blank(i, j); i = j;
  };
  while (i < source.length) {
    const ch = source[i], two = source.slice(i, i + 2);
    if (two === "//") {
      const end = source.indexOf("\n", i);
      blank(i, end === -1 ? source.length : end); i = end === -1 ? source.length : end;
    } else if (two === "/*") {
      const end = source.indexOf("*/", i + 2);
      const to = end === -1 ? source.length : end + 2;
      blank(i, to); i = to;
    } else if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < source.length && source[j] !== ch) { if (source[j] === "\\") j++; j++; }
      blank(i + 1, j); i = j + 1; prev = ch;
    } else if (ch === "`") {
      stack.push("t"); i++; prev = "`"; template();
    } else if (ch === "}" && stack[stack.length - 1] === "e") {
      stack.pop(); i++; template();
    } else if (ch === "$" && source[i + 1] === "{" && stack[stack.length - 1] === "t") {
      stack.push("e"); i += 2; prev = "{";
    } else if (ch === "/" && /[(,=:[!&|?{};+\-*%~^<>]/.test(prev || "(")) {
      let j = i + 1, cls = false;                    // a regex literal
      while (j < source.length && source[j] !== "\n") {
        const c = source[j];
        if (c === "\\") { j += 2; continue; }
        if (c === "[") cls = true;
        else if (c === "]") cls = false;
        else if (c === "/" && !cls) break;
        j++;
      }
      blank(i + 1, j); i = j + 1; prev = "/";
    } else {
      if (!/\s/.test(ch)) prev = ch;
      i++;
    }
  }
  return out.join("");
}

const SPEAKS = ["toast(", "reportFailure(", "reportSyncFault(", "renderAccount(", "note.textContent"];

// The reason a catch block gives for staying quiet, or "" if it gives
// none. The allowlist of reasons is this whole lint's deliverable, so
// what counts as a reason is a rule in its own right and is tested
// directly below rather than trusted.
function silentReason(block) {
  const m = /^\{\s*(\/\/|\/\*)[ \t]*silent:([\s\S]*)$/.exec(block);
  if (!m) return "";
  const rest = m[2];
  // Stop at the end of the comment, or the block's own text — a `*/` or
  // the rest of the file — counts as the reason.
  const end = m[1] === "//" ? rest.indexOf("\n") : rest.indexOf("*/");
  return (end === -1 ? rest : rest.slice(0, end)).trim();
}

// Twelve non-whitespace characters is about three words: enough to say
// something, and past anything that got there by accident. The bar used
// to be one non-space character after "silent:", which `/* silent: */`
// met with the `*` of its own terminator — an empty annotation that
// passed, in the one test whose entire point is that the reasons are on
// record.
const MIN_REASON = 12;
const isAnnotated = (block) => silentReason(block).replace(/\s/g, "").length >= MIN_REASON;

// Both shapes that discard a failure: a `catch (e) { … }` clause, and a
// `.catch(() => { … })` handler. An arrow with an EXPRESSION body is a
// third shape and a different thing — `.catch(() => null)` substitutes a
// value the caller must then deal with, rather than swallowing anything
// — so it is exempt only while that expression is a bare literal.
const LITERAL = /^(null|undefined|false|true|0|""|''|``|\[\]|\{\})$/;

function catchSites(source, file = "js/app.js") {
  const code = maskLiterals(source);
  const lineOf = (i) => code.slice(0, i).split("\n").length;
  const blockAt = (from) => {
    let depth = 0;
    for (let i = from; i < code.length; i++) {
      if (code[i] === "{") depth++;
      else if (code[i] === "}" && --depth === 0) return [from, i + 1];
    }
    throw new Error(`unclosed block at ${lineOf(from)}`);
  };
  const skipSpace = (i) => { while (/\s/.test(code[i])) i++; return i; };
  const closeOf = (open) => {
    let depth = 0;
    for (let i = open; i < code.length; i++) {
      if (code[i] === "(") depth++;
      else if (code[i] === ")" && --depth === 0) return i;
    }
    throw new Error(`unclosed call at ${lineOf(open)}`);
  };

  const sites = [];
  for (const m of code.matchAll(/\bcatch\b/g)) {
    const at = m.index;
    const line = lineOf(at);
    let i = skipSpace(at + "catch".length);
    if (code[at - 1] === ".") {                       // .catch(handler)
      assert.equal(code[i], "(", `${file}:${line}: .catch with no argument`);
      const end = closeOf(i);
      const arrow = code.indexOf("=>", i);
      assert.ok(arrow !== -1 && arrow < end,
        `${file}:${line}: this lint only understands arrow handlers`);
      const body = skipSpace(arrow + 2);
      if (code[body] !== "{") {
        const expr = source.slice(body, end).trim();
        assert.match(expr, LITERAL,
          `${file}:${line}: an expression handler may only substitute a literal — ` +
          `anything else is a failure being handled somewhere a reviewer cannot see it`);
        continue;
      }
      sites.push({ line, range: blockAt(body) });
      continue;
    }
    if (code[i] === "(") i = skipSpace(closeOf(i) + 1);  // catch (err)
    assert.equal(code[i], "{", `${file}:${line}: catch with no block`);
    sites.push({ line, range: blockAt(i) });
  }
  return sites.map((s) => ({
    line: s.line,
    // Read the SPEAKING check off masked code so a mention of toast() in
    // a comment cannot pass for one; read the annotation off the source,
    // because the annotation is a comment.
    speaks: SPEAKS.some((t) => code.slice(...s.range).includes(t)),
    annotated: isAnnotated(source.slice(...s.range)),
  }));
}


test("an empty excuse is not a decision on record", () => {
  // The test below is only as good as what it accepts as a reason, and
  // what it accepted was the closing `*/`: the old predicate asked for
  // one non-space character after "silent:", and `/* silent: */` has
  // one — the `*`. So the single annotation that says nothing at all was
  // the single annotation the lint could not catch, in the test whose
  // entire deliverable is that the reasons are readable.
  for (const empty of [
    "{ /* silent: */ }",
    "{ /*silent: */ }",
    "{ // silent:\n }",
    "{ /* silent: no */ }",
    "{ /* silent: */ nothing here is the reason */ }",
  ]) {
    assert.equal(isAnnotated(empty), false, `an empty reason passed: ${JSON.stringify(empty)}`);
  }
  for (const real of [
    "{ /* silent: an unswept blob costs nothing, and the delete already happened */ }",
    "{ // silent: the failure IS the answer this function returns\n }",
    "{\n  /* silent: local housekeeping — the eviction is spoken below */\n}",
  ]) {
    assert.equal(isAnnotated(real), true, `a real reason was refused: ${JSON.stringify(real)}`);
  }
  // A catch that says nothing at all is still what this is looking for.
  assert.equal(isAnnotated("{ }"), false);
  assert.equal(isAnnotated("{ /* not a silent annotation at all */ }"), false);
});

// The lint's scope, and it must GROW with the decomposition. Every
// story moves catches out of js/app.js; if the list did not grow with
// them, the lint's coverage would shrink one story at a time while its
// name went on saying js/app.js. D-2 took five catches into
// js/flow/sync.js — the absorb loop, the listener, the access probe and
// two blob sweeps — and every one of them is a failure a person can hit.
const LINTED = [
  ["js/app.js", 45],       // ~50 catch sites; the floor proves the scanner still sees them
  ["js/flow/sync.js", 4],  // 5 after D-2
];

test("the catch scanner reads its sources as code, not as text", () => {
  // If masking ever breaks, every assertion below goes quietly vacuous.
  // These are the two things that would show it.
  for (const [file, floor] of LINTED) {
    const masked = maskLiterals(read(file));
    for (const [open, close] of [["{", "}"], ["(", ")"]]) {
      let depth = 0, lowest = 0;
      for (const ch of masked) {
        if (ch === open) depth++;
        else if (ch === close) lowest = Math.min(lowest, --depth);
      }
      assert.equal(depth, 0, `masked ${file} has unbalanced ${open}${close}`);
      assert.equal(lowest, 0, `masked ${file} closes a ${open} it never opened`);
    }
    assert.ok(catchSites(read(file), file).length >= floor,
      `${file} should hold at least ${floor} catch sites; finding fewer means the scanner stopped working`);
  }
});

test("no failure on a user path is discarded without a decision on record", () => {
  const mute = LINTED.flatMap(([file]) =>
    catchSites(read(file), file).filter((s) => !s.speaks && !s.annotated)
      .map((s) => `${file}:${s.line}`));
  assert.deepEqual(
    mute,
    [],
    "these catches throw a failure away and say nothing. Each must either " +
    `call one of ${SPEAKS.join(" ")} or begin with a "silent: <reason>" ` +
    "comment saying why this one is deliberately quiet:\n  " +
    mute.join("\n  ")
  );
});

test("the wording of a failure exists once, inside reportFailure", () => {
  // reportFailure moved to js/flow/sync.js with the rest of the sync
  // machinery (story D-2). The rule it enforces is unchanged, and so is
  // the function: only the file it is read out of moved.
  const body = bodyOf(read("js/flow/sync.js"), "reportFailure");
  assert.equal(body.split("toast(").length - 1, 1,
    "reportFailure is the one place a failure becomes a toast; a second " +
    "call here means a second wording, which is how sendInvite and " +
    "inviteEveryone drifted apart in the first place");
  assert.match(body, /failureSentence\(/,
    "the sentence itself belongs to js/failure.js, not to app.js");
});

test("no sibling of reportFailure writes its own copy of a failure sentence", () => {
  // The test above pins reportFailure to ONE toast. It cannot see a
  // catch two thousand lines away typing the same explanation out again,
  // which is what sendInvite did: its catch toasted "Added Bo. Send them
  // the invite link so they can open it." while js/failure.js already
  // owned that sentence under op `invite`. Two copies of one wording is
  // the state sendInvite and inviteEveryone were in when this file was
  // written; op `invite` exists so there is one.
  // Both halves of the split: the invite paths are still in js/app.js,
  // reportFailure itself is now in js/flow/sync.js, and a retyped copy
  // in either file is the same drift.
  for (const file of ["js/app.js", "js/flow/sync.js"]) {
    assert.equal(read(file).includes("Send them the invite link"), false,
      `${file} is writing an invite failure in its own words — the sentence ` +
      'belongs to js/failure.js, reached through reportFailure("invite", err)');
  }
  // …and the sentence must have MOVED, not been deleted. Otherwise the
  // assertion above is satisfied by saying nothing at all, which is the
  // failure mode this whole file exists to catch.
  assert.match(read("js/failure.js"), /send them the invite link/i,
    "js/failure.js must still be the place that says it");
});

test("neither invite path skips somebody it could not hash an address for", () => {
  // emailKey answers "" when crypto.subtle is missing. Both paths then
  // dropped the member — `continue` in inviteEveryone, `return` in
  // sendInvite — leaving invitedAt unset, so the member sheet read
  // "invited, not opened yet" for ever and nothing was ever sent.
  const source = read("js/app.js");
  const lines = source.split("\n");
  const bad = [];
  lines.forEach((text, i) => {
    if (!text.includes("emailKey(")) return;
    for (const next of lines.slice(i + 1, i + 4)) {
      if (/\b(continue|return)\s*;/.test(next) && !next.includes("reportFailure(")) {
        bad.push(`js/app.js:${i + 1} — skips out at "${next.trim()}"`);
      }
    }
  });
  assert.deepEqual(bad, [], `a member dropped in silence:\n  ${bad.join("\n  ")}`);
});

test("the app says so when it cannot install its own service worker", () => {
  // "Trips, cash, no signal needed" is the promise on the tin. A failed
  // registration is that promise quietly not applying, and the person
  // finds out on the plane.
  assert.match(
    read("js/app.js"),
    /serviceWorker\s*\n?\s*\.register\([^)]*\)[\s\S]{0,120}?reportFailure\("service-worker"/,
    "the service-worker registration must report its failure"
  );
});

test("a listener that never attached is a standing condition, not an event", () => {
  // If startLiveUpdates fails, the other phone's changes never arrive at
  // all — for as long as the app stays open. A toast that fades after
  // four seconds is the wrong surface for that; the sync note, which
  // syncNow already uses and which stays on screen, is the right one.
  const body = bodyOf(read("js/flow/sync.js"), "startLiveUpdates");
  assert.match(body, /renderAccount\(\{[\s\S]{0,240}?bad:\s*true/,
    "startLiveUpdates must set the sync note when the listener does not attach");
  assert.match(body, /failureSentence\(\{\s*op:\s*"live-updates"/,
    "and the wording must come from js/failure.js like everything else");
  assert.equal(body.includes("toast("), false,
    "a standing condition must not be announced as a passing event");
});

test("both buttons that mean \"sign me in\" go the same way", () => {
  // Signing in lives at the BOTTOM of the settings sheet — below the
  // avatar, the theme picker, the home currency and the install row. So
  // opening the sheet is not landing on signing in: "Join this trip"
  // put somebody who had just tapped a friend's invitation in front of a
  // sheet titled Profile whose first control is a theme picker.
  //
  // #signed-out-fix — a lower-stakes prompt on the home screen — already
  // scrolled #google-signin into view. One rule, two call sites, one of
  // them doing half of it, is precisely the drift this file exists for.
  const src = read("js/app.js");
  const body = bodyOf(src, "openSignIn");
  assert.match(body, /openSettings\(\)/, "the sheet still has to open");
  assert.match(body, /#google-signin[\s\S]{0,80}scrollIntoView/,
    "…and land on the thing the person actually came for");

  for (const id of ["invite-join", "signed-out-fix"]) {
    assert.match(src, new RegExp(`\\$\\("#${id}"\\)[\\s\\S]{0,200}?openSignIn`),
      `#${id} must go through openSignIn, not re-implement it`);
  }

  // Nobody else may write the rule out a second time.
  const elsewhere = src.split("\n")
    .map((line, i) => ({ line, at: i + 1 }))
    .filter(({ line }) => /#google-signin"\)\s*\?*\.?\s*scrollIntoView/.test(line))
    .filter(({ line }) => !body.includes(line));
  assert.deepEqual(elsewhere.map((e) => `js/app.js:${e.at}`), [],
    "scrolling to #google-signin belongs to openSignIn alone:\n  " +
    elsewhere.map((e) => `js/app.js:${e.at} — ${e.line.trim()}`).join("\n  "));
});

// ---------- being locked out must not delete the ledger (S6-1) ----------

// Whichever name it goes by. The body that reacts to a refused write was
// called applyEviction while it deleted things; a name is not the point,
// what it destroys is.
function bodyOfAny(source, names) {
  const found = names.find((n) => new RegExp(`function\\s+${n}\\b`).test(source));
  assert.ok(found, `the source should declare one of ${names.join(", ")}`);
  return bodyOf(source, found);
}

test("a refused write destroys nothing that belongs to the person", () => {
  // evictionFrom() keeps the trip now, but keeping it in the returned
  // list is worth nothing if the io still sweeps everything hanging off
  // it. This is the io, read as source, because no unit test can see it:
  // the three lines below deleted the trip record without a tombstone,
  // the trip's expenses and settlements, and every receipt blob — on the
  // strength of one refused write and one refused read, which is equally
  // what a co-member's stale device dropping this row in a merge looks
  // like.
  const body = bodyOfAny(read("js/flow/sync.js"), ["applyLockout", "applyEviction"]);
  for (const destroys of ["store.forgetTrip(", "deleteAttachments(", ".tripId !== tripId"]) {
    assert.equal(body.includes(destroys), false,
      `being locked out of a trip must not run ${destroys}`);
  }
});

test("every screen that offers a write on a trip asks whether it may", () => {
  // Read-only that is painted in one place and not the other is this
  // project's recurring bug, and there are five places that paint or
  // perform a change to a trip's books. Each asks writeAccess(); none
  // decides for itself.
  const src = read("js/app.js");
  for (const fn of [
    "renderTrips",        // the card: no pencil into rename/archive/delete
    "renderLedger",       // Add expense, and the sentence saying why not
    "recompute",          // "+ Expense" on the converter — the second Add expense
    "renderSummaryBody",  // Mark paid, + Record a payment, delete a payment
    "openExpense",        // opening one to read is fine; editing it is not
    "openEditor",         // the trip editor is rename/duplicate/delete
    "saveExpense",        // the keyboard reaches #e-save without a click
    "paintSaveButton",    // it owns #e-save, so it owns whether Save may fire
    // The list used to stop at openEditor, which guards ONE of the two
    // doors into archiving: the editor's Archive button. The other is a
    // left swipe on the card — the primary way to archive on a phone —
    // and it reached toggleArchive directly, so a trip whose own card
    // says "Read-only" in three places archived anyway, and restamped
    // its updatedAt on a device that never pushes.
    "toggleArchive",
    // And the sprint-6 sign-off found the same shape one layer out:
    // syncNow skipped locked trips with `continue` BEFORE adding them to
    // its unsynced set, then handed that set to pushProfileToTrips as the
    // list to skip — so a locked trip was not in it. Editing your display
    // name while locked out restamped your stale copy of that trip, and
    // when the lock lifted it won the merge and erased a co-member's
    // rename or archive. ADR-0014's exact failure, from the one path the
    // skip set exists to close. This list not naming it is what let it
    // through, which is the same reason toggleArchive is above.
    "pushProfileToTrips",
  ]) {
    assert.match(bodyOf(src, fn), /writeAccess\(/,
      `${fn} paints or performs a write and must ask writeAccess() first`);
  }
});

test("whether Save may fire is decided in exactly one place", () => {
  // openExpense paints the form (which disables #e-save while the name is
  // empty) and THEN called setExpenseReadOnly(false), whose body did
  // `$("#e-save").disabled = on` — re-enabling it. Its comment said "the
  // form painter owns this the rest of the time"; it ran after the
  // painter. So the sheet opened from "+ Expense" with the amount already
  // in it, the button reading its own disabled label "Name this expense",
  // and one tap put a nameless expense into the shared ledger.
  //
  // Writing this test found a THIRD writer: the split-weight handler
  // re-derived whyBlocked's five conditions by hand and set `disabled`
  // without touching the label, so the button could read "Fix the split"
  // and be perfectly clickable. Several writers is the whole defect, so
  // the assertion is that there is one.
  // Counting assignments would miss `const s = $("#e-save"); s.disabled =
  // …` two lines later, so what is counted is who gets HOLD of the
  // button at all.
  const src = read("js/app.js");
  const holders = src.split("\n")
    .map((line, i) => ({ line: line.trim(), at: i + 1 }))
    // A comment quoting the old code — the paragraph above
    // paintSaveButton does exactly that — is not a call site.
    .filter(({ line }) => !line.startsWith("//"))
    .filter(({ line }) => line.includes('$("#e-save")'));
  const inside = bodyOf(src, "paintSaveButton");
  const strays = holders.filter((w) => !inside.includes(w.line))
    // Wiring the click through to saveExpense is not painting it.
    .filter((w) => !w.line.includes("addEventListener"));
  assert.deepEqual(strays.map((w) => `js/app.js:${w.at}`), [],
    "#e-save belongs to paintSaveButton alone — a second place that reaches " +
    "for it is a second copy of the rule, and whichever runs last wins:\n  " +
    strays.map((w) => `js/app.js:${w.at} — ${w.line}`).join("\n  "));

  // …and that one place must still set both. `hidden` is what the eye
  // gets, `disabled` is what Enter gets, and Enter in a text field
  // dispatches this button without anybody touching it.
  for (const prop of ["hidden", "disabled"]) {
    assert.match(inside, new RegExp(`\\.${prop}\\s*=`), `paintSaveButton must set ${prop}`);
  }
  assert.match(inside, /writeAccess\(/, "…from the access rule, not from completeness alone");
  // …and the reason it is off comes from the pure module rather than
  // being spelled out again here, which is what the split-weight handler
  // was doing.
  assert.match(inside, /whyBlocked\(/);
});

test("the Read-only badge is not inside the box that clamps the name", () => {
  // .trip-name-text is `-webkit-line-clamp: 2; overflow: hidden`. The
  // badge lived inside it, so a two-line trip name pushed the badge past
  // the clamped box and it was clipped away entirely — leaving a card
  // identical to a writable one except for a missing pencil. Measured at
  // 375px: "Southeast Asia backpacking trip, winter 2027 with the whole
  // family" put the badge's top at 361.8px against a box ending at 334px.
  const ui = read("js/ui.js");
  const at = ui.indexOf('class="trip-name-text"');
  assert.notEqual(at, -1, "js/ui.js should still build the trip name element");
  const close = ui.indexOf("</span>", at);
  assert.equal(ui.slice(at, close).includes("trip-lock"), false,
    "the badge must sit beside the clamped name, not inside it");

  // …and the clamp must still be on the name alone. Moving it up to the
  // wrapper would clip the badge again from the other direction.
  const css = read("styles.css");
  const rule = css.slice(0, css.indexOf("-webkit-line-clamp"));
  const selector = rule.slice(rule.lastIndexOf("}") + 1).trim().split("{")[0].trim();
  assert.equal(selector, ".trip-name-text",
    "only the name itself may be clamped");
});

// Flat CSS rules, in source order: [{ selectors, body }]. styles.css has
// no nesting and no @media blocks around the rules read below.
function cssRules(css) {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("}")
    .map((chunk) => {
      const at = chunk.indexOf("{");
      if (at === -1) return null;
      return {
        selectors: chunk.slice(0, at).split(",").map((s) => s.trim()).filter(Boolean),
        body: chunk.slice(at + 1),
      };
    })
    .filter(Boolean);
}

test("dimming a read-only expense dims the affordance, not the answer", () => {
  // The read-only sheet disables every control in it and drops them to
  // opacity 0.6. The comment above that rule says "The VALUES stay at
  // full strength" — but the rule that preserves them names `input` and
  // `select`, and who paid and how it was split are CHIPS. Measured from
  // painted pixels at 375px, the selected chip against the card behind
  // it: 6.47:1 → 2.79:1 in light, 9.10:1 → 4.13:1 in dark, for 12.8px
  // text that needs 4.5:1. They are the two facts the sheet still opens
  // to show, and they were the least legible things in it.
  const rules = cssRules(read("styles.css"));
  const dim = rules.findIndex((r) =>
    r.selectors.some((s) => s.startsWith("#expense-sheet.readonly")) && /opacity:\s*0\.6/.test(r.body));
  assert.notEqual(dim, -1, "the read-only dimming rule should still exist");

  for (const chip of [".member-chip.on", ".type-chip.on", ".seg > button.on"]) {
    const exempt = rules.slice(dim + 1).some((r) =>
      r.selectors.some((s) => s.startsWith("#expense-sheet.readonly") && s.includes(chip))
      && /opacity:\s*1\b/.test(r.body));
    assert.ok(exempt, `${chip} carries an answer and must not be dimmed to 0.6`);
  }
});

test("a read-only split still shows who is in it", () => {
  // Two things flattened these boxes to 1.14:1 between checked and
  // unchecked, against teal-on-white on a writable sheet. One was ours —
  // `background: var(--card-2)` on every disabled input, which overrides
  // the native checked paint. The other is the browser: `accent-color`
  // is ignored once a control is disabled, so removing our background is
  // not enough and the checked state has to be drawn.
  const rules = cssRules(read("styles.css"));
  const bg = rules.find((r) =>
    r.selectors.some((s) => /^#expense-sheet\.readonly .*input:disabled/.test(s))
    && /background:\s*var\(--card-2\)/.test(r.body));
  assert.ok(bg, "the disabled-field fill rule should still exist");
  assert.ok(
    bg.selectors.every((s) => !/input:disabled\s*$/.test(s)),
    'that fill must exclude checkboxes — it paints over the tick'
  );

  const checked = rules.find((r) =>
    r.selectors.some((s) => s.includes("#expense-sheet.readonly") && s.includes(':checked')));
  assert.ok(checked, "a read-only checked box must be painted, not left to the disabled default");
  assert.match(checked.body, /var\(--accent\)/,
    "…in the same accent a writable sheet uses, so the two read alike");
});

test("the card's way into editing a trip closes with the lock", () => {
  // ui.js holds no state, so app.js tells the card. The pencil opens the
  // sheet with Delete trip in it.
  assert.match(read("js/ui.js"), /trip\.locked[\s\S]{0,120}?trip-edit/,
    "tripCard must not offer the edit pencil on a read-only trip");
});

test("why a trip is read-only is written once, in the pure module", () => {
  // Two copies of a sentence is two sentences the moment one is edited,
  // and the wording is the whole user-facing part of this state.
  assert.match(read("js/roster.js"), /Read-only on this device/);
  for (const rel of ["js/app.js", "js/ui.js", "index.html"]) {
    assert.equal(/Read-only on this device/.test(read(rel)), false,
      `${rel} must print writeAccess().why, not its own copy of it`);
  }
});

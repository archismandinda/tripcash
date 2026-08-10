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

// Both shapes that discard a failure: a `catch (e) { … }` clause, and a
// `.catch(() => { … })` handler. An arrow with an EXPRESSION body is a
// third shape and a different thing — `.catch(() => null)` substitutes a
// value the caller must then deal with, rather than swallowing anything
// — so it is exempt only while that expression is a bare literal.
const LITERAL = /^(null|undefined|false|true|0|""|''|``|\[\]|\{\})$/;

function catchSites(source) {
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
      assert.equal(code[i], "(", `js/app.js:${line}: .catch with no argument`);
      const end = closeOf(i);
      const arrow = code.indexOf("=>", i);
      assert.ok(arrow !== -1 && arrow < end,
        `js/app.js:${line}: this lint only understands arrow handlers`);
      const body = skipSpace(arrow + 2);
      if (code[body] !== "{") {
        const expr = source.slice(body, end).trim();
        assert.match(expr, LITERAL,
          `js/app.js:${line}: an expression handler may only substitute a literal — ` +
          `anything else is a failure being handled somewhere a reviewer cannot see it`);
        continue;
      }
      sites.push({ line, range: blockAt(body) });
      continue;
    }
    if (code[i] === "(") i = skipSpace(closeOf(i) + 1);  // catch (err)
    assert.equal(code[i], "{", `js/app.js:${line}: catch with no block`);
    sites.push({ line, range: blockAt(i) });
  }
  return sites.map((s) => ({
    line: s.line,
    // Read the SPEAKING check off masked code so a mention of toast() in
    // a comment cannot pass for one; read the annotation off the source,
    // because the annotation is a comment.
    speaks: SPEAKS.some((t) => code.slice(...s.range).includes(t)),
    annotated: /^\{\s*(\/\/|\/\*)[ \t]*silent:[ \t]+\S/.test(source.slice(...s.range)),
  }));
}


test("the catch scanner reads js/app.js as code, not as text", () => {
  // If masking ever breaks, every assertion below goes quietly vacuous.
  // These are the two things that would show it.
  const masked = maskLiterals(read("js/app.js"));
  for (const [open, close] of [["{", "}"], ["(", ")"]]) {
    let depth = 0, lowest = 0;
    for (const ch of masked) {
      if (ch === open) depth++;
      else if (ch === close) lowest = Math.min(lowest, --depth);
    }
    assert.equal(depth, 0, `masked js/app.js has unbalanced ${open}${close}`);
    assert.equal(lowest, 0, `masked js/app.js closes a ${open} it never opened`);
  }
  assert.ok(catchSites(read("js/app.js")).length >= 45,
    "js/app.js has ~50 catch sites; finding fewer means the scanner stopped working");
});

test("no failure in js/app.js is discarded without a decision on record", () => {
  const mute = catchSites(read("js/app.js")).filter((s) => !s.speaks && !s.annotated);
  assert.deepEqual(
    mute.map((s) => `js/app.js:${s.line}`),
    [],
    "these catches throw a failure away and say nothing. Each must either " +
    `call one of ${SPEAKS.join(" ")} or begin with a "silent: <reason>" ` +
    "comment saying why this one is deliberately quiet:\n  " +
    mute.map((s) => `js/app.js:${s.line}`).join("\n  ")
  );
});

test("the wording of a failure exists once, inside reportFailure", () => {
  const body = bodyOf(read("js/app.js"), "reportFailure");
  assert.equal(body.split("toast(").length - 1, 1,
    "reportFailure is the one place a failure becomes a toast; a second " +
    "call here means a second wording, which is how sendInvite and " +
    "inviteEveryone drifted apart in the first place");
  assert.match(body, /failureSentence\(/,
    "the sentence itself belongs to js/failure.js, not to app.js");
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
  const body = bodyOf(read("js/app.js"), "startLiveUpdates");
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

// What a stranger who typed the address is told.
//
// js/landing.js was written, complete, and then wired to nothing: no
// import, no line in the offline shell, no test file. So the one screen
// that is this app's entire storefront — there is no App Store listing,
// no other page that says what this is, what it costs or where the data
// goes — was still 🧳 "No trips yet." above "Create your first trip",
// which is a statement about an empty database.
//
// Two halves are tested here and they fail differently:
//
//  - the module's own reasons, called directly. Cheap, and they pin the
//    branch ORDER, which is the part a later edit silently changes.
//  - the wiring, read out of js/app.js's real source and evaluated. That
//    is the half that has never been the reliable one in this project —
//    every bug the owner personally hit was a correct module with a
//    call site that disagreed with it — so app.js's own visibility
//    expression is run against the four audiences here, the same shape
//    tests/coldopen.test.mjs uses.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { landingState, emptyLine, emptyDecoration, PITCH } from "../js/landing.js";
import { SYNCED_SETTINGS } from "../js/prefs.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const SRC = read("js/app.js");
const HTML = read("index.html");

// ---------- the module, by its own reasons ----------

test("the pitch is for exactly one person: nobody invited them and they have never had a trip", () => {
  assert.deepEqual(landingState({}), { show: true, why: "first arrival, no invitation" });
});

test("everybody else already has a better answer than a pitch", () => {
  // A link that named a trip and the friend who sent it beats any prose
  // this screen could write, and two explanations stacked is worse than
  // either alone.
  assert.deepEqual(landingState({ coldOpen: true }),
    { show: false, why: "an invitation is already on screen" });
  // Anybody with a trip has passed this point.
  assert.deepEqual(landingState({ trips: [{ id: "t1" }] }),
    { show: false, why: "they already have trips" });
  // Used it and deleted everything: a traveller between trips, not a
  // stranger. They need a way back in, not an explanation of the app.
  assert.deepEqual(landingState({ createdEver: true }),
    { show: false, why: "they have used it before" });
  assert.deepEqual(landingState({ dismissed: true }),
    { show: false, why: "they asked for just the converter" });
});

test("the invitation outranks every other reason to stay quiet", () => {
  // Branch order is a decision, not an accident: the reason reported has
  // to be the true one, because it is what the next person reads when
  // they wonder why the pitch did not appear.
  assert.equal(
    landingState({ coldOpen: true, trips: [{ id: "t1" }], createdEver: true, dismissed: true }).why,
    "an invitation is already on screen"
  );
});

// ---------- the line under it ----------

test("the empty area says what to do, and to the stranger it says nothing", () => {
  assert.equal(emptyLine({ createdEver: true }),
    "Nothing on the go right now. Start the next one whenever you like.");
  assert.equal(emptyLine({ signedIn: true }), "Trips you are added to will appear here.");
  // The pitch directly above is already carrying this moment.
  assert.equal(emptyLine({}), "");
  // Recognition beats explanation: somebody who has had trips here is
  // told that, not that trips might arrive.
  assert.equal(emptyLine({ createdEver: true, signedIn: true }),
    "Nothing on the go right now. Start the next one whenever you like.");
});

test("the copy is frozen data, in one place", () => {
  assert.ok(Object.isFrozen(PITCH));
  assert.ok(Object.isFrozen(PITCH.lines));
  assert.ok(Object.isFrozen(PITCH.assurances));
  // The three objections a stranger has about a money app. Fewer is a
  // question left unanswered; more is a wall of text on the screen with
  // the least attention to spend.
  assert.equal(PITCH.assurances.length, 3);
});

// ---------- the wiring, read out of js/app.js ----------

const lineWith = (marker) => {
  const found = SRC.split("\n").find((l) => l.includes(marker));
  assert.ok(found, `expected js/app.js to contain ${marker}`);
  return found;
};

// The right-hand side of an assignment in app.js, as an expression.
const rhs = (marker) => {
  const line = lineWith(marker);
  return line.slice(line.indexOf(marker) + marker.length).replace(/;\s*$/, "");
};

test("app.js asks each question once, so there is nowhere for a second answer to live", () => {
  // The same shape as the expense-field drift that cost TC5-1: a rule
  // stated in two places is a rule that will disagree with itself.
  assert.equal((SRC.match(/\blandingState\(/g) ?? []).length, 1);
  assert.equal((SRC.match(/\bemptyLine\(/g) ?? []).length, 1);
});

// app.js's own line, run against a described visitor.
const landingHidden = ({ trips = [], inviteUp = false, settings = {} }) =>
  Function("trips", "inviteUp", "settings", "landingState",
    `return (${rhs('$("#landing").hidden =')});`)(trips, () => inviteUp, settings, landingState);

test("the stranger, and only the stranger, is told what this is", () => {
  assert.equal(landingHidden({}), false, "somebody with nothing stored gets the pitch");
  // The other three audiences see nothing new.
  assert.equal(landingHidden({ trips: [{ id: "t1" }] }), true);
  assert.equal(landingHidden({ inviteUp: true }), true, "the invitation is already answering this");
  assert.equal(landingHidden({ settings: { tripEverCreated: true } }), true);
  assert.equal(landingHidden({ settings: { landingDismissed: true } }), true);
});

// …and the line underneath, from the same source.
const emptyText = ({ settings = {}, account = null }) =>
  Function("settings", "account", "emptyLine",
    `return (${rhs("const nudge = ")});`)(settings, account, emptyLine);

test("the empty area is written from the module, not authored in the page", () => {
  // "No trips yet." was the whole storefront for anybody who typed the
  // address. It is not a sentence any of these three people need.
  assert.ok(!HTML.includes("No trips yet."),
    "index.html must not carry the line — it is decided per person, in js/landing.js");
  assert.match(lineWith('$("#empty-line").textContent'), /nudge/);
  // Hidden rather than empty: a <p> with no text still takes vertical
  // space above the one button on the screen that makes a trip.
  assert.match(lineWith('$("#empty-line").hidden'), /!nudge/);

  assert.equal(emptyText({}), "");
  assert.equal(emptyText({ settings: { tripEverCreated: true } }),
    "Nothing on the go right now. Start the next one whenever you like.");
  assert.equal(emptyText({ account: { uid: "u1" } }), "Trips you are added to will appear here.");
});

// ---------- the pitch is text, and it is above the converter ----------

// The body of a top-level function in app.js, by brace matching.
function bodyOf(name) {
  const at = SRC.search(new RegExp(`function\\s+${name}\\b`));
  assert.notEqual(at, -1, `js/app.js should declare ${name}`);
  let i = SRC.indexOf("{", SRC.indexOf(")", at)), depth = 0;
  for (let j = i; j < SRC.length; j++) {
    if (SRC[j] === "{") depth++;
    else if (SRC[j] === "}" && --depth === 0) return SRC.slice(i, j + 1);
  }
  assert.fail(`${name} is not brace-balanced`);
}

test("every word of the pitch reaches the page as text, never as markup", () => {
  const body = bodyOf("paintLanding");
  assert.doesNotMatch(body, /innerHTML|outerHTML|insertAdjacentHTML/,
    "the storefront must not be a place markup can arrive through");
  for (const field of ["PITCH.title", "PITCH.lines", "PITCH.assurances", "PITCH.dismiss",
    // The call to action too. It is the pitch's own, it lives on the
    // button below the converter that already exists for it, and it has
    // to suit both the first-timer and the traveller between trips —
    // "Create your first trip" under "Nothing on the go right now" is
    // the app contradicting itself.
    "PITCH.action"]) {
    assert.ok(body.includes(field), `${field} is written but never painted`);
  }
  assert.match(body, /textContent/);
});

test("the copy lives in the module and nowhere else", () => {
  for (const words of [PITCH.title, ...PITCH.lines, ...PITCH.assurances, PITCH.dismiss,
    PITCH.action]) {
    assert.ok(!HTML.includes(words), `index.html re-states the pitch: "${words}"`);
  }
});

test("the pitch sits above the converter, not over it", () => {
  // It is deliberately not a takeover. The converter below works with no
  // account and no network, and demonstrating that beats promising it —
  // so the pitch has to be the caption, which means being authored
  // before the panel and before the call to action.
  const at = (id) => {
    const i = HTML.indexOf(`id="${id}"`);
    assert.notEqual(i, -1, `index.html must have #${id}`);
    return i;
  };
  for (const below of ["panel-host", "new-trip-btn", "empty-state"]) {
    assert.ok(at("landing") < at(below), `#landing is authored after #${below}`);
  }
});

// ---------- the flag the save writes has to come BACK ----------

test("a trip made and deleted in one launch is not a stranger any more", () => {
  // js/store.js sets tripEverCreated as it persists, but app.js's
  // `settings` is a snapshot taken at boot. Left unrefreshed, the flag is
  // true on disk and false in memory for the rest of the launch — so
  // somebody who creates a trip, changes their mind and deletes it is
  // sold the app all over again, on the same screen they just used. That
  // is the in-memory copy drifting from what was persisted, which is
  // ADR-0016 wearing different clothes.
  const body = bodyOf("saveTrips");
  const stored = { homeCurrency: "INR", tripEverCreated: false };
  const store = {
    setTrips: (list) => { if (list.length) stored.tripEverCreated = true; return list; },
    getSettings: () => ({ ...stored }),
  };
  const run = (settings, trips) =>
    Function("store", "trips", "restamp", "scheduleSync", "settings",
      `${body.slice(1, -1)}; return settings;`)(store, trips, () => {}, () => {}, settings);

  assert.equal(run({ homeCurrency: "INR", tripEverCreated: false }, [{ id: "t1" }]).tripEverCreated,
    true, "the save wrote it; this launch has to know");

  // …and it must pull back that flag and not the whole record. On a
  // device where writes are failing (Safari Private Browsing, a full
  // disk) what is stored is BEHIND what the person is looking at, and
  // re-reading it wholesale would revert an unsaved home currency in the
  // middle of saving a trip.
  stored.homeCurrency = "INR";
  assert.equal(run({ homeCurrency: "THB", tripEverCreated: false }, [{ id: "t1" }]).homeCurrency,
    "THB", "a settings write that failed must not be undone by a trip save");
});

// ---------- "Just the converter" ----------

test("the dismissal is a decision, so it is written down and it is this device's", () => {
  const wiring = SRC.slice(SRC.indexOf('$("#landing-dismiss").addEventListener'));
  assert.ok(wiring, "nothing listens to the dismiss control");
  const handler = wiring.slice(0, wiring.indexOf("});") + 3);
  assert.match(handler, /landingDismissed: true/);
  assert.match(handler, /store\.setSettings/, "it must go through js/store.js, not localStorage");
  // Unlike "Have a look around" on the invitation — a detour, kept in
  // memory only — this one survives the reload, because "I do not want
  // the sales pitch" is not a question worth asking twice.
  assert.ok(!SYNCED_SETTINGS.includes("landingDismissed"),
    "it describes this screen on this device; another device has its own first arrival");
});

// ---------- the trim: something to press, not 61 words to read ----------
//
// The owner's report was "isn't attractive enough, too much text". Measured
// at 375x667 with storage cleared, on the build that produced it: the pitch
// was 61 words filling y=157-469, the call to action sat at y=870 — 203px
// under the fold — and the only button in the first screenful was the ghost
// "Just the converter" at y=427, which is the way OUT. A storefront whose
// one visible control is the exit.

const words = (s) => s.trim().split(/\s+/).filter(Boolean).length;

test("the storefront is a screenful to press, not a screenful to read", () => {
  assert.ok(words(PITCH.title) <= 8,
    `the title is ${words(PITCH.title)} words: "${PITCH.title}"`);
  const body = PITCH.lines.reduce((n, line) => n + words(line), 0);
  assert.ok(body <= 20,
    `the pitch is ${body} words; 41 of them is what pushed the button 203px under the fold`);
  for (const chip of PITCH.assurances) {
    assert.ok(words(chip) <= 6,
      `"${chip}" is ${words(chip)} words — these are read at a glance, not read`);
  }
});

test("the words shrink; the three promises do not", () => {
  // The three things a stranger wants to know about a money app before
  // touching it. The trim is allowed to make them shorter and is not
  // allowed to quietly drop one — and /device/i is the only one of the
  // three that is about their money rather than their convenience.
  for (const [claim, re] of [["an account", /account/i], ["working offline", /offline/i],
    ["where the data goes", /device/i]]) {
    assert.ok(PITCH.assurances.some((chip) => re.test(chip)),
      `the trim dropped the promise about ${claim}: ${JSON.stringify(PITCH.assurances)}`);
  }
});

// ---------- 254px of illustrated emptiness under a pitch ----------

test("the suitcase is a decision, and the pitch already made the point", () => {
  // #empty-state spent 254px on a suitcase and a blank line — blank
  // because emptyLine() correctly returns "" for a stranger, the pitch
  // above having already said it. Nobody wrote that whitespace; it is
  // what two correct decisions do when they meet, which is exactly the
  // kind of thing that has to become one decision.
  assert.equal(emptyDecoration({ pitchShown: true }), false);
  assert.equal(emptyDecoration({ pitchShown: false }), true);
  // Everybody who is not being sold the app still gets the empty state
  // they always had.
  assert.equal(emptyDecoration({}), true);
});

test("the decoration is painted from the module, once, off the pitch that is really on screen", () => {
  assert.equal((SRC.match(/\bemptyDecoration\(/g) ?? []).length, 1,
    "a second call site is a second answer waiting to disagree");
  // …and it reads the section app.js has just decided about, rather than
  // re-deciding it. Run app.js's own expression against both worlds.
  const decorationHidden = (landingHidden) =>
    Function("$", "emptyDecoration", `return (${rhs('$("#empty-decoration").hidden =')});`)(
      () => ({ hidden: landingHidden }), emptyDecoration);
  assert.equal(decorationHidden(false), true, "pitch on screen → no illustration of emptiness");
  assert.equal(decorationHidden(true), false, "no pitch → the empty state is all there is");
});

// ---------- the way in comes before the way out ----------

const at = (id) => {
  const i = HTML.indexOf(`id="${id}"`);
  assert.notEqual(i, -1, `index.html must have #${id}`);
  return i;
};

test("the call to action precedes the exit, and there is still exactly one of it", () => {
  assert.ok(at("empty-new-trip") < at("landing-dismiss"),
    "the only control in a stranger's first screenful must not be the way out");
  // One button, moved — not a second one added. `invitedAt` wired into
  // one of two invite paths, removability written twice: a duplicated
  // control is this project's most reliable bug shape.
  assert.equal((HTML.match(/id="empty-new-trip"/g) ?? []).length, 1);
  assert.equal((SRC.match(/PITCH\.action/g) ?? []).length, 1,
    "the call to action is labelled in exactly one place");
  assert.equal((SRC.match(/addEventListener\("click", \(\) => openEditor\(null\)\)/g) ?? []).length, 2,
    "#new-trip-btn and #empty-new-trip are the two doors there have ever been");
});

test("the exit stays secondary, and it still leaves with the pitch it belongs to", () => {
  assert.match(HTML.slice(at("landing-dismiss") - 120, at("landing-dismiss") + 60), /class="ghost"/);
  assert.match(HTML.slice(at("empty-new-trip") - 120, at("empty-new-trip") + 60), /class="primary"/);
  // It has left <section id="landing">, so it no longer rides on that
  // section's hidden attribute and has to be told — from the one place
  // the question was already answered, not by asking landingState twice.
  assert.match(lineWith('$("#landing-dismiss").hidden'), /\$\("#landing"\)\.hidden/);
  assert.match(HTML.slice(at("landing-dismiss"), at("landing-dismiss") + 80), /hidden/,
    "it must start hidden, or every visitor with trips sees a stray ghost button");
});

// ---------- the rates timestamp: out of the way, not out of the app ----------

test("the exact fetch time is one tap away, not the second thing a stranger reads", () => {
  // "Fetched Aug 11, 2026, 3:25 PM · GMT+5:30 · Asia/Calcutta" was the
  // SECOND thing on a stranger's screen. It exists for a good reason —
  // a stale rate in a money app has to be inspectable — so it is folded
  // behind the chip it describes, not deleted.
  assert.match(lineWith('$("#status-stamp").textContent'), /stampText/,
    "the string must still be produced");
  assert.match(HTML.slice(at("status-stamp"), at("status-stamp") + 80), /hidden/,
    "…and must not be on the page before anybody asked for it");
  const line = lineWith('$("#status-stamp").hidden');
  const from = SRC.indexOf('$("#status").addEventListener');
  assert.notEqual(from, -1, "nothing listens to the rates chip");
  const handler = SRC.slice(from, SRC.indexOf("});", from) + 3);
  const flag = line.match(/hidden\s*=\s*!(\w+)/)?.[1];
  assert.ok(flag, `#status-stamp's visibility must come from a named flag: ${line.trim()}`);
  // The flag is allowed to be DERIVED — there is nothing to show until
  // there is a rate to stamp — so follow it back to the one the tap
  // sets, and require the tap to actually set it rather than merely
  // mention it.
  const source = SRC.match(new RegExp(`const\\s+${flag}\\s*=\\s*([^;\\n]+)`))?.[1] ?? flag;
  const names = [...source.matchAll(/[A-Za-z_$][\w$]*/g)].map(([n]) => n);
  assert.ok(names.some((n) => new RegExp(`\\b${n}\\s*=\\s*true\\b`).test(handler)),
    `tapping the chip must be what reveals ${flag} — one tap, or it is gone rather than folded`);
});

test("the chip's aria-expanded says exactly what the stamp's visibility says", () => {
  // Two expressions of one state, and they disagreed:
  //
  //   $("#status-stamp").hidden = !stampAsked || !cached;
  //   el.setAttribute("aria-expanded", String(stampAsked));
  //
  // `stampAsked` never goes back to false, so from the first tap onward
  // the app's most-tapped control is announced "Refresh exchange rates,
  // expanded, button" and pressing it collapses nothing. On a first
  // launch with no rates yet — the offline traveller this app is for —
  // it claims to be expanded while aria-controls points at an element
  // that is still hidden.
  //
  // Asserting the two are the same IDENTIFIER, not merely both correct
  // today: this codebase's signature bug is one rule written twice.
  const shown = lineWith('$("#status-stamp").hidden').match(/hidden\s*=\s*!(\w+)\s*;/)?.[1];
  const said = lineWith('"aria-expanded"').match(/"aria-expanded",\s*String\((\w+)\)/)?.[1];
  assert.ok(shown, "#status-stamp's visibility must be one named flag, negated once");
  assert.equal(said, shown,
    `the chip says aria-expanded=${said} while the stamp is shown when ${shown} — one state, two answers`);
});

// ---------- the fold ----------
//
// The fold itself is measured in tests/fold.test.mjs, in a browser, on the
// served tree. It used to be measured by hand and written into a comment
// here — the belief being that CI has no browser, which is not true: the
// runner image ships Chrome, and `npm run preflight` refuses a release from
// a machine that has none, so a skipped measurement cannot reach the CDN
// looking green.
//
// That distinction earned itself. The guards in this file are the budget
// the measurement rested on — word caps, DOM order, the decoration rule —
// and every one of them is blind to CSS. Appending a padding and a
// font-size to styles.css put the call to action 58px under the fold with
// every other test still passing. A measurement is not a test; it is a number
// somebody once took.
//
// What belongs here is the structural half, which a browser is a slow way
// to ask about: nothing new may be put between a stranger's arrival and the
// button.

const VOID = /^(area|base|br|col|embed|hr|img|input|link|meta|param|source|track|wbr)$/i;

function mainStack() {
  const open = HTML.indexOf("<main");
  const body = HTML.slice(HTML.indexOf(">", open) + 1, HTML.indexOf("</main>"))
    .replace(/<!--[\s\S]*?-->/g, "");
  const ids = [];
  let depth = 0;
  for (const [, close, tag, attrs] of body.matchAll(/<(\/?)([a-zA-Z][\w-]*)([^>]*)>/g)) {
    if (close) { depth--; continue; }
    if (VOID.test(tag) || attrs.trimEnd().endsWith("/")) continue;
    if (depth === 0) ids.push(attrs.match(/\bid="([^"]+)"/)?.[1] ?? `<${tag}>`);
    depth++;
  }
  return ids;
}

test("nothing new may be put between a stranger's arrival and the button", () => {
  // The whole vertical stack, in order, because the fold is a property of
  // the stack and not of any one block in it. A block inserted anywhere
  // above #empty-state spends the budget the measurement was taken at,
  // and it will do it silently.
  assert.deepEqual(mainStack(), [
    "invite-screen",     // the other front door; hidden unless a link brought them
    "landing",           // the pitch: title, lines, three chips
    "trip-tools",        // hidden with no trips
    "trips",             // empty with no trips
    "panel-host",        // the converter — the argument, and it must stay above the fold
    "look-around-back",  // hidden with no invitation
    "new-trip-btn",      // hidden with no trips
    "empty-state",       // …which is where the one call to action lives
    "landing-dismiss",   // and the way out comes last, on purpose
  ]);
});

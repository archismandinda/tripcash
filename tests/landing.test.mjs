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
import { landingState, emptyLine, PITCH } from "../js/landing.js";
import { SYNCED_SETTINGS } from "../js/prefs.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");
const SRC = read("js/app.js");
// saveTrips moved to js/state.js in the D-1 extraction; the wiring tests
// that lift it follow it there. The assertions are unchanged.
const STATE_SRC = read("js/state.js");
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

// app.js's own line, run against a described visitor. The collections
// live on the shared `state` object now (js/state.js), so that is what
// the harness injects.
const landingHidden = ({ trips = [], inviteUp = false, settings = {} }) =>
  Function("state", "inviteUp", "landingState",
    `return (${rhs('$("#landing").hidden =')});`)({ trips, settings }, () => inviteUp, landingState);

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
  Function("state", "account", "emptyLine",
    `return (${rhs("const nudge = ")});`)({ settings }, account, emptyLine);

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

// The body of a top-level function, by brace matching. app.js unless the
// function moved to js/state.js (the D-1 extraction).
function bodyOf(name, src = SRC, where = "js/app.js") {
  const at = src.search(new RegExp(`function\\s+${name}\\b`));
  assert.notEqual(at, -1, `${where} should declare ${name}`);
  let i = src.indexOf("{", src.indexOf(")", at)), depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === "{") depth++;
    else if (src[j] === "}" && --depth === 0) return src.slice(i, j + 1);
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
  const body = bodyOf("saveTrips", STATE_SRC, "js/state.js");
  const stored = { homeCurrency: "INR", tripEverCreated: false };
  const store = {
    setTrips: (list) => { if (list.length) stored.tripEverCreated = true; return list; },
    getSettings: () => ({ ...stored }),
  };
  const run = (settings, trips) =>
    Function("store", "state", "restamp", "fireSaved",
      `${body.slice(1, -1)}; return state.settings;`)(store, { settings, trips }, () => {}, () => {});

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

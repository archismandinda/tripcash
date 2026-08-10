// A failure the person can hear.
//
// Three read-only reviews concluded that this app says nothing when
// something fails. Checked against the tree, that is half true, and the
// half that is true is the dangerous half: receipts, sign-in, the
// scanner, the sync loop and the payment sheet all speak properly, but
// each of them was decided by hand, one catch at a time. There was no
// rule, so the catches nobody got round to are exactly the ones nobody
// notices.
//
// The clearest proof is a pair. `sendInvite` catches a refused
// `writeInvite` and says "Added Bo. Send them the invite link so they can
// open it." `inviteEveryone` catches the identical failure with an empty
// block, and because its only toast is guarded by `if (sent.length)` the
// whole run finishes having said nothing at all. One rule, two call
// sites, drifted apart — ADRs 0014–0019 wearing different clothes.
//
// So the wording moves into js/failure.js and the two paths are RUN here,
// lifted out of js/app.js and given stub io, rather than grepped. A grep
// can show that a function mentions reportFailure; only running it can
// show that a person hears something.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { failureSentence, inviteRunSentence, OPS } from "../js/failure.js";
import { emailKey, inviteEntry } from "../js/invites.js";
import { awaitingInvite } from "../js/roster.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP = readFileSync(join(ROOT, "js/app.js"), "utf8");

// ---------- the module ----------

test("every op it admits to knowing has a sentence", () => {
  assert.ok(OPS.length > 0, "OPS must list the operations this module can speak for");
  for (const op of OPS) {
    for (const code of [undefined, "permission-denied", "unavailable", "wat"]) {
      for (const online of [true, false]) {
        const say = failureSentence({ op, code, online });
        assert.equal(typeof say, "string", `${op}/${code}/${online} produced no sentence`);
        assert.ok(say.trim().length > 0, `${op}/${code}/${online} produced an empty sentence`);
      }
    }
  }
});

test("an op it has never heard of gets no sentence at all", () => {
  // A typo must be a loud missing sentence, never a quiet wrong one.
  assert.equal(failureSentence({ op: "invitte", code: "permission-denied" }), null);
  assert.equal(failureSentence({ op: "", code: "unavailable" }), null);
  assert.equal(failureSentence({}), null);
  assert.equal(failureSentence(), null);
});

test("a refusal and a lost connection are not the same sentence", () => {
  // They have different next steps, so they cannot share wording. This
  // is the pair the story names.
  const refused = failureSentence({ op: "invite", code: "permission-denied" });
  const offline = failureSentence({ op: "invite", code: "unavailable", online: false });
  assert.notEqual(refused, offline);
  assert.match(offline, /offline/i, "the offline sentence must say so");
});

test("a sentence names what the person can do next", () => {
  // Not a style rule. "Something went wrong" is precisely the message
  // that leaves somebody believing an invitation went out.
  for (const op of OPS) {
    const say = failureSentence({ op });
    assert.ok(/ — |: /.test(say),
      `${op}: a sentence must carry a next step after the dash, not just a diagnosis: ${say}`);
    assert.equal(/error|failed|exception|null|undefined/i.test(say), false,
      `${op}: says it in the app's words, not the person's: ${say}`);
  }
});

test("offline is a state, not an error, wherever it is asked about", () => {
  // navigator.onLine false must reach the same wording as the code that
  // means the same thing, or two devices in the same state hear
  // different explanations.
  for (const op of OPS) {
    assert.equal(
      failureSentence({ op, code: "unavailable", online: true }),
      failureSentence({ op, code: undefined, online: false }),
      `${op}: "the backend is unreachable" and "this device is offline" are one state`,
    );
  }
});

// ---------- js/app.js's own invite paths, run ----------

// Lifted out of the real source and given stubs, the way
// tests/persist.test.mjs runs guardStorage. `reportFailure` is optional
// on purpose: before the fix it does not exist, so an unfixed js/app.js
// runs here unchanged and fails on what it SAYS rather than on a
// missing function.
function sourceOf(name, { optional = false } = {}) {
  const m = APP.match(new RegExp(`\\n(?:async )?function ${name}\\([\\s\\S]*?\\n\\}\\n`));
  if (!m && optional) return "";
  assert.ok(m, `js/app.js must keep ${name} as one top-level function`);
  return m[0];
}

function lift(entry, deps) {
  const body = [sourceOf("reportFailure", { optional: true }), sourceOf(entry)]
    .join("\n")
    // The only io the lifted code reaches for that isn't a parameter.
    .replace(/await import\("\.\/firestore\.js"\)/g, "await loadFirestore()");
  const keys = Object.keys(deps);
  return new Function(...keys, `${body}\nreturn ${entry};`)(...keys.map((k) => deps[k]));
}

// `subtle: null` is the browser with no crypto.subtle — an insecure
// origin, or a WebView that withholds it. emailKey then answers "" and
// both invite paths used to skip the person without a word.
function inviteHarness({ writeInvite, subtle = globalThis.crypto?.subtle, syncOk = true }) {
  const spoken = [];
  return {
    spoken,
    deps: {
      account: { uid: "u1", email: "asha@example.com" },
      settings: { profileName: "Asha" },
      syncing: false,
      PUSH_DELAY_MS: 0,
      awaitingInvite,
      inviteEntry,
      emailKey: (email) => emailKey(email, subtle),
      failureSentence,
      inviteRunSentence,
      syncNow: async () => syncOk,
      loadFirestore: async () => ({ writeInvite }),
      toast: (msg) => spoken.push(msg),
      stampNow: () => 1000,
      countInvite: () => {},
      saveTrips: () => {},
      navigator: { onLine: true },
      console: { warn: () => {}, error: () => {} },
    },
  };
}

const goa = (members) => ({ id: "t1", name: "Goa", members });
const bo = () => ({ id: "m1", name: "Bo", email: "bo@example.com" });

test("saving a trip whose invitations are all refused says so", async () => {
  // The bug, exactly: `sent` stays empty, the only toast is guarded by
  // `if (sent.length)`, and the function returns having said nothing.
  const h = inviteHarness({ writeInvite: async () => { throw { code: "permission-denied" }; } });
  await lift("inviteEveryone", h.deps)(goa([bo()]));
  assert.equal(h.spoken.length, 1,
    `the whole run spoke ${h.spoken.length} times; the person is left believing Bo was invited`);
  assert.match(h.spoken[0], /invite link/i,
    "and it must name the next step — the trip document still carries the invite, so the link works");
});

test("a working invitation still says the one thing it always said", async () => {
  // The fix must not add a second voice to the path that already worked.
  const h = inviteHarness({ writeInvite: async () => {} });
  const trip = goa([bo()]);
  await lift("inviteEveryone", h.deps)(trip);
  assert.deepEqual(h.spoken, ["Bo can now open “Goa”"]);
  assert.equal(trip.members[0].invitedAt, 1000, "a sent invitation is recorded as sent");
});

test("a browser that cannot hash an address says so on BOTH invite paths", async () => {
  // emailKey answers "" with no crypto.subtle, and both paths then
  // skipped the person in silence — `continue` in one, `return` in the
  // other — leaving invitedAt unset, so the member sheet showed them as
  // invited and awaiting a reply for ever.
  const everyone = inviteHarness({ writeInvite: async () => {}, subtle: null });
  const trip = goa([bo()]);
  await lift("inviteEveryone", everyone.deps)(trip);
  assert.equal(everyone.spoken.length, 1, "inviteEveryone skipped Bo without a word");
  assert.equal(trip.members[0].invitedAt, undefined,
    "nothing was sent, so nothing may be recorded as sent");

  const one = inviteHarness({ writeInvite: async () => {}, subtle: null });
  await lift("sendInvite", one.deps)(goa([bo()]), bo());
  assert.equal(one.spoken.length, 1, "sendInvite skipped Bo without a word");

  assert.deepEqual(everyone.spoken, one.spoken,
    "one failure, one sentence — the two paths must not describe it differently");
});

test("the sentence the invite paths speak is the module's, not a retyped copy", async () => {
  const h = inviteHarness({ writeInvite: async () => { throw { code: "permission-denied" }; } });
  await lift("inviteEveryone", h.deps)(goa([bo()]));
  assert.equal(h.spoken[0], failureSentence({ op: "invite", code: "permission-denied" }));
});

// ---------- what a WHOLE RUN says ----------
//
// Saving a trip invites everybody on it at once, so one run can both
// succeed and fail — and ui.js paints every toast into a single #toast
// element (`el.textContent = msg`, ui.js), so a run that speaks per
// person keeps only its last word. Every invite test above this line
// uses ONE member, which is exactly why nothing caught that.

const priya = () => ({ id: "m2", name: "Priya", email: "priya@example.com" });

test("a run with nothing to report says nothing", () => {
  // Returning null rather than "" so a caller can stay quiet without
  // deciding for itself what quiet looks like.
  assert.equal(inviteRunSentence({ tripName: "Goa" }), null);
  assert.equal(inviteRunSentence(), null);
});

test("a run that only worked says exactly what it always said", () => {
  assert.equal(inviteRunSentence({ tripName: "Goa", sent: ["Bo"] }), "Bo can now open “Goa”");
  assert.equal(inviteRunSentence({ tripName: "Goa", sent: ["Bo", "Priya"] }),
    "2 people can now open “Goa”");
});

test("the failure is never left behind the success", () => {
  const say = inviteRunSentence({
    tripName: "Goa",
    sent: ["Priya"],
    failed: [{ op: "invite", code: "permission-denied", name: "Bo" }],
  });
  assert.ok(say.startsWith(failureSentence({ op: "invite", code: "permission-denied" })),
    `the failure comes first — it is the half with something left to do: ${say}`);
  assert.ok(say.includes("Bo"), `and it names whose invitation did not go out: ${say}`);
  assert.ok(say.includes("Priya can now open “Goa”"),
    `without dropping the one that did: ${say}`);
});

test("the same failure for four people is one explanation, not four", () => {
  const say = inviteRunSentence({
    tripName: "Goa",
    failed: ["Bo", "Priya", "Rahul", "Asha"].map((name) => ({ op: "invite", name })),
  });
  for (const name of ["Bo", "Priya", "Rahul", "Asha"]) {
    assert.ok(say.includes(name), `${name} is not named: ${say}`);
  }
  assert.equal(say.split("send them the invite link").length - 1, 1,
    `one explanation carrying four names, not four copies of it: ${say}`);
});

test("two different failures stay two different explanations", () => {
  // A refused write and a browser with no crypto.subtle have different
  // next steps, so merging them under one heading would lose one.
  const say = inviteRunSentence({
    tripName: "Goa",
    failed: [
      { op: "invite", code: "permission-denied", name: "Bo" },
      { op: "invite-key", name: "Priya" },
    ],
  });
  assert.ok(say.includes(failureSentence({ op: "invite", code: "permission-denied" })), say);
  assert.ok(say.includes(failureSentence({ op: "invite-key" })), say);
  assert.ok(say.includes("Bo") && say.includes("Priya"), say);
});

test("a run of one needs no name, and an unknown op gets no sentence", () => {
  // "That invitation" has an unambiguous subject when there was one.
  assert.equal(inviteRunSentence({ tripName: "Goa", failed: [{ op: "invite", name: "Bo" }] }),
    failureSentence({ op: "invite" }));
  // And a typo stays a loud missing sentence rather than a quiet wrong one.
  assert.equal(inviteRunSentence({ tripName: "Goa", failed: [{ op: "invitte", name: "Bo" }] }), null);
});

test("offline reaches the run sentence like everywhere else", () => {
  assert.match(
    inviteRunSentence({ tripName: "Goa", failed: [{ op: "invite", online: false, name: "Bo" }] }),
    /offline/i,
  );
});

// ---------- js/app.js's invite run, with one refusal in it ----------

test("a run that half worked cannot end on the half that worked", async () => {
  // THE BUG. reportFailure fired for Bo, then the success toast for
  // Priya replaced it, and the person was left looking at "Priya can now
  // open “Goa”" with Bo's invitedAt unset and no invitation sent. Worse
  // than the all-failed case above: a visible success reads as
  // confirmation, so they close the sheet believing both went out.
  //
  // Both orderings, because the bug is not about who comes first.
  for (const members of [[bo(), priya()], [priya(), bo()]]) {
    let n = 0;
    const h = inviteHarness({
      writeInvite: async () => { n += 1; if (n === 1) throw { code: "permission-denied" }; },
    });
    const [refused, delivered] = members;
    await lift("inviteEveryone", h.deps)(goa(members));

    assert.equal(h.spoken.length, 1,
      `the run spoke ${h.spoken.length} times into one #toast; all but the last are erased`);
    const onScreen = h.spoken[h.spoken.length - 1];
    assert.ok(onScreen.includes(refused.name),
      `nothing on screen names ${refused.name}, whose invitation did not go out: ${onScreen}`);
    assert.match(onScreen, /invite link/i,
      `…nor what to do about it: ${onScreen}`);
    assert.equal(onScreen.includes(`${refused.name} can now open`), false,
      `it tells them ${refused.name} was invited, and nothing was sent: ${onScreen}`);
    assert.ok(onScreen.includes(`${delivered.name} can now open “Goa”`),
      `and the invitation that DID go out is still worth saying: ${onScreen}`);

    assert.equal(refused.invitedAt, undefined, "nothing sent, so nothing recorded as sent");
    assert.equal(delivered.invitedAt, 1000, "…and the one that was sent is recorded");
  }
});

test("an all-refused run names everybody, once", async () => {
  // The secondary half: five refusals used to be the same anonymous
  // sentence five times, so even here nobody could tell which
  // invitation to chase.
  const h = inviteHarness({ writeInvite: async () => { throw { code: "permission-denied" }; } });
  const names = ["Bo", "Priya", "Rahul", "Asha"];
  const members = names.map((name, i) => ({
    id: `m${i}`, name, email: `${name.toLowerCase()}@example.com`,
  }));
  await lift("inviteEveryone", h.deps)(goa(members));

  assert.equal(h.spoken.length, 1, "one run, one sentence");
  for (const name of names) {
    assert.ok(h.spoken[0].includes(name), `${name} is not named: ${h.spoken[0]}`);
  }
  assert.equal(members.some((m) => m.invitedAt), false, "nothing went out");
});

// ---------- the live-updates note, which is a CONDITION ----------
//
// AC6 asked for a standing condition instead of a fading toast and got
// something visible less often than a toast. `#sync-note` is a <p> inside
// <dialog id="settings-sheet">, so startLiveUpdates wrote its sentence
// into a closed sheet — and renderAccount's last lines run
// unconditionally (`noteEl.hidden = !note; noteEl.textContent = note`),
// so every caller passing no note erases it. openSettings() calls
// renderAccount() with no arguments, which made GOING TO LOOK at the
// warning the act that removed it; the silent syncNow at the end of
// every sync, and every foregrounded tab, got there first.
//
// A one-shot write cannot be tested by grepping for the write, so the
// real functions are run and then rendered again.

const HTML = readFileSync(join(ROOT, "index.html"), "utf8");

// Module state, lifted from the source. If it is not there it is
// declared here instead — the same trick `optional` plays for
// reportFailure above, so an unfixed js/app.js runs unchanged and fails
// on what the person is left looking at rather than on a missing
// variable.
function stateOf(name) {
  const m = APP.match(new RegExp(`\\nlet ${name} = [^\\n]*`));
  return m ? `${m[0]};` : `let ${name} = null;`;
}

// Everything renderAccount touches on an element, and nothing else, so a
// render reaching further fails here rather than silently passing.
function stubEl() {
  const classes = new Set();
  return {
    hidden: false,
    textContent: "",
    value: "",
    classList: { toggle(c, on) { if (on) classes.add(c); else classes.delete(c); } },
    get bad() { return classes.has("bad"); },
  };
}

function accountHarness(opts = {}) {
  const els = new Map();
  const $ = (sel) => {
    if (!els.has(sel)) els.set(sel, stubEl());
    return els.get(sel);
  };
  const deps = {
    $,
    account: { uid: "u1", email: "asha@example.com", emailVerified: true },
    settings: { profileName: "Asha", lastSyncAt: 900 },
    renderPushRow: () => {},
    renderProfileButton: () => {},
    renderProfileHead: () => {},
    ageString: () => "a minute ago",
    document: { activeElement: null },
    failureSentence,
    navigator: { onLine: true },
    console: { warn: () => {}, error: () => {} },
    absorbRemote: () => {},
    applyPrefs: () => {},
    loadFirestore: async () => {
      // The listener that will not attach: an out-of-date rules
      // deployment, or no signal at the moment the app opened.
      if (opts.attachFails !== false) throw { code: "permission-denied" };
      return { watchMyTrips: async () => () => {}, watchPrefs: async () => () => {} };
    },
  };
  const body = [
    stateOf("liveFault"),
    "let unwatch = null; let unwatchPrefs = null;",
    sourceOf("renderAccount"),
    sourceOf("startLiveUpdates"),
    sourceOf("stopLiveUpdates"),
  ].join("\n").replace(/await import\("\.\/firestore\.js"\)/g, "await loadFirestore()");
  const keys = Object.keys(deps);
  const api = new Function(...keys, `${body}
    return { renderAccount, startLiveUpdates, stopLiveUpdates, note: () => $("#sync-note") };`,
  )(...keys.map((k) => deps[k]));
  return { ...api, opts };
}

const LIVE_DOWN = failureSentence({ op: "live-updates", code: "permission-denied" });

test("the live-updates sentence is written into a closed sheet", () => {
  // The premise everything below rests on. If #sync-note ever moves out
  // of a dialog, this is the test that should say so.
  const inDialogs = new Set();
  for (const [block] of HTML.matchAll(/<dialog\b[\s\S]*?<\/dialog>/g)) {
    for (const m of block.matchAll(/\bid="([^"]+)"/g)) inDialogs.add(m[1]);
  }
  assert.ok(inDialogs.has("sync-note"),
    "#sync-note is inside a sheet, so anything written there is written where nobody is looking");
});

test("going to look at the live-updates warning does not erase it", async () => {
  const h = accountHarness();
  await h.startLiveUpdates();
  assert.equal(h.note().textContent, LIVE_DOWN, "a listener that never attached must say so");
  assert.equal(h.note().hidden, false);

  // What openSettings() does — js/app.js's own way of opening the sheet
  // the note lives in — is renderAccount() with no arguments.
  h.renderAccount();
  assert.equal(h.note().textContent, LIVE_DOWN,
    "the sheet opened and the warning was gone: the act of looking wiped it");
  assert.equal(h.note().hidden, false);
  assert.equal(h.note().bad, true, "and it is still the bad kind of note");
});

test("an ordinary silent sync does not erase it either", async () => {
  // renderAccount(inviteNote ? {…} : {}) runs at the end of EVERY
  // successful syncNow, silent ones included — and signing in fires one
  // moments after startLiveUpdates, so on the commonest path of all the
  // sentence never survived long enough to be read.
  const h = accountHarness();
  await h.startLiveUpdates();
  h.renderAccount({});
  assert.equal(h.note().textContent, LIVE_DOWN);
});

test("something with its own thing to say still gets to say it", async () => {
  const h = accountHarness();
  await h.startLiveUpdates();
  h.renderAccount({ note: "Syncing…" });
  assert.equal(h.note().textContent, "Syncing…", "an explicit note outranks the standing one");
  h.renderAccount();
  assert.equal(h.note().textContent, LIVE_DOWN, "…and the condition is still true afterwards");
});

test("the warning ends when live updates actually come back", async () => {
  // It has to be able to end. visibilitychange and sign-in both retry,
  // and a phone that lost signal for a moment must not carry the warning
  // for the rest of the session.
  const h = accountHarness();
  await h.startLiveUpdates();
  assert.equal(h.note().textContent, LIVE_DOWN);
  h.opts.attachFails = false;
  await h.startLiveUpdates();
  assert.equal(h.note().textContent, "", "attached, so there is nothing left to warn about");
  assert.equal(h.note().hidden, true);
});

test("signing out takes the warning with it", async () => {
  // Nothing to be live about, so a warning about live updates would be
  // describing something that no longer exists.
  const h = accountHarness();
  await h.startLiveUpdates();
  h.stopLiveUpdates();
  h.renderAccount();
  assert.equal(h.note().hidden, true);
  assert.equal(h.note().textContent, "");
});

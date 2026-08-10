// The seven-day timer, and who it takes data from.
//
// Every case here is a real person on a real phone. The one that matters
// most is the last-but-one: an iPhone, opened from a shared link, never
// installed, never signed in. That person's trip is deleted by Safari
// after a week away and nothing in the app currently tells them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { shouldAskToPersist, storageRisk, shouldWarn } from "../js/persist.js";
import { engineOf, installAdvice } from "../js/install.js";
import { SYNCED_SETTINGS } from "../js/prefs.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP = readFileSync(join(ROOT, "js/app.js"), "utf8");

// ---------- asking the browser for protection ----------

test("ask once there is something to protect, and never once granted", () => {
  assert.equal(shouldAskToPersist({ persisted: false, hasData: true }), true);
  assert.equal(shouldAskToPersist({ persisted: true, hasData: true }), false,
    "already granted — asking again is noise");
});

test("do not ask on a first-ever page view", () => {
  // Browsers weigh engagement. The request most likely to be REFUSED is
  // the one made before the person has done anything, and some engines
  // will not reconsider a refusal.
  assert.equal(shouldAskToPersist({ hasData: false }), false);
});

test("do not ask where the API does not exist", () => {
  assert.equal(shouldAskToPersist({ supported: false, hasData: true }), false);
});

// ---------- who is actually at risk ----------

const iphone = { engine: "webkit", hasData: true };

test("an uninstalled, signed-out iPhone is going to lose the trip", () => {
  // The whole reason this module exists.
  //
  // This used to assert /Home Screen/ against a sentence hardcoded here.
  // That assertion pinned the drift it was meant to prevent: js/install.js
  // carried its own copy of the same advice, and on a Mac BOTH were wrong
  // in different words — Safari on macOS has no Home Screen. The wording
  // now comes from install.js, which owns "how do you install on this
  // device", so what is asserted is that this module uses that answer
  // rather than inventing one.
  const say = installAdvice({ ua: IPHONE_UA }).say;
  const risk = storageRisk({ ...iphone, installed: false, signedIn: false, installSay: say });
  assert.equal(risk.atRisk, true);
  assert.equal(risk.severity, "loss");
  assert.match(risk.advice, /7 days|week away/);
  assert.ok(risk.advice.includes(say), "the advice must carry install.js's own sentence");
  assert.match(say, /Add to Home Screen/, "…which on an iPhone is the Share sheet");
  assert.match(risk.why, /7 days/);
});

test("a Mac is never told to use a Home Screen it does not have", () => {
  // The bug that made this module take the sentence as an argument.
  // macOS Safari is WebKit, so the seven-day timer applies and the person
  // IS at risk — but it has no ⋮ menu and no Add to Home screen. It has
  // File → Add to Dock. Telling them otherwise reads as an app that does
  // not know what it is running on.
  const MAC_SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
  const { how, say } = installAdvice({ ua: MAC_SAFARI, touchPoints: 0 });
  assert.equal(how, "mac-dock");
  assert.match(say, /Add to Dock/);
  assert.doesNotMatch(say, /Home screen|Home Screen|⋮/);

  const risk = storageRisk({ engine: engineOf(MAC_SAFARI), hasData: true, installSay: say });
  assert.equal(risk.atRisk, true, "desktop Safari has the same seven-day timer");
  assert.doesNotMatch(risk.advice, /Home Screen/);
  assert.ok(risk.advice.includes("Add to Dock"));

  // …and an iPad in desktop mode reports the SAME user agent, so the
  // touch-points probe is the only thing that tells them apart.
  assert.equal(installAdvice({ ua: MAC_SAFARI, touchPoints: 5 }).how, "ios-share");
});

test("installed to the home screen is genuinely safe, and says why", () => {
  // A home-screen app is not part of Safari and keeps its own counter.
  const risk = storageRisk({ ...iphone, installed: true, signedIn: false });
  assert.equal(risk.atRisk, false);
  assert.match(risk.why, /own clock/);
  // Installed and signed out is still safe — installation is the fix,
  // not the account.
  assert.equal(storageRisk({ ...iphone, installed: true, signedIn: true }).atRisk, false);
});

test("signed in on an uninstalled iPhone is RECOVERABLE, not safe", () => {
  // The tempting bug: treat a cloud copy as "no problem". The local copy
  // is still deleted, so this person opens the app on a plane after the
  // timer fires and sees nothing. Calling that safe would be a lie of
  // exactly the kind this project has had to apologise for before.
  const risk = storageRisk({ ...iphone, installed: false, signedIn: true });
  assert.equal(risk.atRisk, true);
  assert.equal(risk.severity, "recoverable");
  assert.match(risk.advice, /backed up/);
});

test("nothing stored yet means nothing to warn about", () => {
  // Do not greet a first-time visitor with a data-loss warning about
  // data they do not have.
  assert.equal(storageRisk({ engine: "webkit", hasData: false }).atRisk, false);
});

test("elsewhere it is eviction under pressure, not a timer — and it is ranked that way", () => {
  const chrome = storageRisk({ engine: "blink", hasData: true, persisted: false });
  assert.equal(chrome.severity, "unlikely");
  assert.equal(storageRisk({ engine: "blink", hasData: true, persisted: true }).atRisk, false);
});

// ---------- how often to say it ----------

test("a warning nobody has seen is shown; one seen this week is not", () => {
  const risk = storageRisk({ ...iphone });
  assert.equal(shouldWarn(risk, { toldAt: 0 }), true);
  const now = 1_700_000_000_000;
  assert.equal(shouldWarn(risk, { toldAt: now - 1000, now }), false, "told a second ago");
  assert.equal(shouldWarn(risk, { toldAt: now - 8 * 24 * 3600_000, now }), true,
    "eight days later, and they are still one week from losing it");
});

test("the merely-unlikely case never interrupts anyone", () => {
  // A warning shown on every launch is a warning people learn to dismiss
  // without reading — which costs us the one that mattered.
  const mild = storageRisk({ engine: "blink", hasData: true, persisted: false });
  assert.equal(shouldWarn(mild, { toldAt: 0 }), false);
});

test("no risk, no warning", () => {
  assert.equal(shouldWarn(storageRisk({ ...iphone, installed: true }), { toldAt: 0 }), false);
  assert.equal(shouldWarn(null, { toldAt: 0 }), false);
});

test("a week's silence, then it is worth saying again", () => {
  // The interval spelled out from both sides, because the dismissal is
  // the only thing standing between this person and a nag on every
  // launch — and a nag is how the one warning that mattered gets
  // dismissed unread.
  const now = 1_700_000_000_000;
  const day = 24 * 3600_000;
  const loss = storageRisk({ ...iphone });
  assert.equal(loss.severity, "loss");
  assert.equal(shouldWarn(loss, { toldAt: now - 8 * day, now }), true);
  assert.equal(shouldWarn(loss, { toldAt: now - day, now }), false);
});

test("the cold open is never interrupted", () => {
  // The invitation screen answers one question — did the link work? — and
  // asks for nothing. A data-loss warning over it greets somebody whose
  // friend has just promised them a trip with a threat about Safari,
  // before the app has done a single useful thing for them.
  const loss = storageRisk({ ...iphone });
  assert.equal(shouldWarn(loss, { busy: true }), false);
  assert.equal(shouldWarn(loss, { busy: false }), true);
});

// ---------- the dismissal belongs to this device ----------

test("dismissing the warning on a laptop does not silence the phone", () => {
  // The phone is the device at risk: it is the one running WebKit, and
  // the laptop is where somebody signs in. Sync the stamp and one
  // impatient tap on the safe device buys a week of silence on the one
  // about to lose a week in Vietnam.
  assert.ok(!SYNCED_SETTINGS.includes("storageToldAt"),
    "storageToldAt must stay device-local");
});

// ---------- app.js is io only: the wiring, run ----------
//
// The module was written, commented and covered by these tests, and
// imported by nothing. Everything above passed the whole time the data
// loss was live. So these run app.js's OWN guardStorage(), lifted out of
// the source and given stub globals — a grep can show the call exists,
// only this can show what it does.

const IPHONE_UA = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const ANDROID_UA = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";

const ASHA = { uid: "u1", email: "asha@example.com" };

// `account` is a LIVE binding here, exactly as it is in js/app.js: null
// until the auth listener writes it, and the listener cannot run until
// js/firebase.js has been dynamically imported and Firebase has finished
// restoring the session — several turns after boot() starts.
//
// The previous version of this harness handed `account` in as a fixed
// value, which quietly assumed the very thing that was broken: boot()
// fired the restore WITHOUT awaiting it, so every launch decided "signed
// out" and a signed-in iPhone was told its trips had no cloud copy. So
// the stub below models the delay, and every case runs in boot()'s own
// order — restore fired and not awaited, then guardStorage().
async function runGuard({
  trips = [{ id: "t1" }], expenses = [], ua = IPHONE_UA, signedIn = false,
  installed = false, persisted = false, supported = true, cold = "home", toldAt = 0,
  listenerFires = true,
} = {}) {
  const source = APP.match(/\nasync function guardStorage\(\) \{\n[\s\S]*?\n\}\n/);
  assert.ok(source, "js/app.js must keep guardStorage as one top-level async function");
  // Absent until the fix, so an unfixed js/app.js runs here unchanged and
  // fails on what it SAYS rather than on a missing function.
  const settle = APP.match(/\nasync function authSettled\(\) \{\n[\s\S]*?\n\}\n/)?.[0] ?? "";
  const log = { toasts: [], persistCalls: 0, saved: [], restores: 0 };
  const storage = { persisted: async () => persisted };
  // A browser with no Storage API at all is the `supported: false` case.
  if (supported) storage.persist = async () => { log.persistCalls += 1; return true; };
  const scope = new Function(
    "trips", "expenses", "navigator", "settings", "store", "toast",
    "isInstalled", "advice", "coldOpen",
    "shouldAskToPersist", "storageRisk", "shouldWarn", "engineOf",
    "restore", "loadFirebase",
    `
    let account = null;
    // The real onAccountChange is the only writer of \`account\`, and it
    // is called from the auth listener, never from boot()'s own turn.
    function onAccountChange(next) { account = next; }
    let authConnection = null;
    function connectAuth() {
      authConnection ??= restore(onAccountChange);
      return authConnection;
    }
    ${settle.replace(/import\("\.\/firebase\.js"\)/g, "loadFirebase()")}
    ${source[0]}
    return { guardStorage, connectAuth, accountNow: () => account };
    `,
  )(
    trips, expenses,
    { userAgent: ua, storage },
    { storageToldAt: toldAt, syncHint: signedIn },
    { setSettings: (patch) => { log.saved.push(patch); return { storageToldAt: toldAt, syncHint: signedIn, ...patch }; } },
    (msg) => log.toasts.push(msg),
    () => installed,
    () => installAdvice({ ua, hasPrompt: false, installed }),
    () => cold,
    shouldAskToPersist, storageRisk, shouldWarn, engineOf,
    async (onAccountChange) => {
      log.restores += 1;
      // A dynamic import from a CDN plus a session restore. One macrotask
      // is the smallest honest model of it; the real thing is far longer.
      await new Promise((r) => setTimeout(r, 0));
      if (signedIn && listenerFires) onAccountChange(ASHA);
    },
    async () => ({ currentUser: async () => (signedIn ? ASHA : null) }),
  );
  // boot()'s tail, in boot()'s order: the restore is fired and NOT
  // awaited (a device that never signed in never touches the network for
  // it), and guardStorage() is called straight afterwards.
  if (signedIn) scope.connectAuth().catch(() => {});
  await scope.guardStorage();
  return log;
}

test("a first-ever page view is asked for nothing and told nothing", () => {
  // Browsers weigh engagement, and the request most likely to be refused
  // for good is the one made before the person has done anything. The
  // warning is equally pointless: there is no data to lose yet.
  return runGuard({ trips: [], expenses: [] }).then((log) => {
    assert.equal(log.persistCalls, 0);
    assert.deepEqual(log.toasts, []);
    assert.deepEqual(log.saved, []);
  });
});

test("an uninstalled, signed-out iPhone with a trip on it is warned, in the module's words", async () => {
  const log = await runGuard({ trips: [{ id: "t1" }] });
  assert.equal(log.persistCalls, 1, "protection is requested once there is something to protect");
  assert.equal(log.toasts.length, 1);
  const risk = storageRisk({ engine: "webkit", hasData: true, persisted: true, installSay: installAdvice({ ua: IPHONE_UA }).say });
  assert.ok(log.toasts[0].includes(risk.advice), `toast was: ${log.toasts[0]}`);
  // …and the install instruction beside it is js/install.js's sentence,
  // not a second copy of it typed into app.js.
  assert.ok(log.toasts[0].includes(installAdvice({ ua: IPHONE_UA }).say), log.toasts[0]);
  assert.deepEqual(Object.keys(log.saved[0] ?? {}), ["storageToldAt"]);
});

test("expenses count as data even before the trip does", async () => {
  // hasData is "is there anything of theirs in here", and an expense is
  // the week in Vietnam this story is about.
  const log = await runGuard({ trips: [], expenses: [{ id: "e1" }] });
  assert.equal(log.persistCalls, 1);
  assert.equal(log.toasts.length, 1);
});

test("the signed-in iPhone is still warned", async () => {
  // The tempting bug: treat an account as safety. The local copy is
  // still deleted, so this person opens the app offline after the timer
  // fires and sees an empty app.
  const risk = storageRisk({ engine: "webkit", installed: false, signedIn: true, hasData: true, installSay: installAdvice({ ua: IPHONE_UA }).say });
  assert.equal(risk.severity, "recoverable");
  assert.ok(risk.advice.length > 0);
  const log = await runGuard({ signedIn: true });
  assert.equal(log.toasts.length, 1, "a cloud copy is a recovery, not a prevention");
  assert.ok(log.toasts[0].includes(risk.advice), log.toasts[0]);
});

test("a signed-in iPhone is never told at launch that it has no cloud copy", async () => {
  // The bug this harness was rebuilt for. boot() fired the session
  // restore without awaiting it, and `account` is written by the auth
  // listener — which cannot run until js/firebase.js has been imported.
  // guardStorage() was a single microtask behind, so `signedIn` was
  // false on EVERY launch: this person was told the "loss" sentence,
  // whose own `why` says "there is no cloud copy", when there is one.
  const loss = storageRisk({ engine: "webkit", hasData: true, installed: false, signedIn: false });
  const log = await runGuard({ signedIn: true });
  assert.equal(
    log.toasts.some((t) => t.includes(loss.advice)), false,
    `told a signed-in device its trips are not backed up:\n  ${log.toasts.join("\n  ")}`,
  );
});

test("and the wrong sentence does not buy seven days of silence", async () => {
  // guardStorage stamps storageToldAt the moment it warns, so warning
  // with the wrong severity is not one bad toast — it is the correct
  // sentence made unreachable for a week, every week.
  const log = await runGuard({ signedIn: true });
  const recoverable = storageRisk({ engine: "webkit", hasData: true, installed: false, signedIn: true, installSay: installAdvice({ ua: IPHONE_UA }).say });
  assert.ok(log.toasts[0]?.includes(recoverable.advice), log.toasts[0]);
  assert.deepEqual(Object.keys(log.saved[0] ?? {}), ["storageToldAt"],
    "the stamp is spent on the sentence the module actually chose");
});

test("the session is read back, not waited for on a callback", async () => {
  // js/firebase.js registers the listener and then awaits
  // getRedirectResult; nothing promises the listener has fired by the
  // time that resolves. The project already paid for this once (v1.24 →
  // v1.25: a sign-in that succeeded server-side while the UI never
  // heard). So the settled session is READ, and `account` is a cache.
  const recoverable = storageRisk({ engine: "webkit", hasData: true, installed: false, signedIn: true, installSay: installAdvice({ ua: IPHONE_UA }).say });
  const log = await runGuard({ signedIn: true, listenerFires: false });
  assert.equal(log.toasts.length, 1);
  assert.ok(log.toasts[0].includes(recoverable.advice), log.toasts[0]);
});

test("a device that never signed in still touches no network at launch", async () => {
  // The other half of the rule: waiting for a session must not conjure
  // one. syncHint is what says this device wants to sync at all, and a
  // signed-out visitor must never fetch 260 KB of Firebase to be told
  // about Safari.
  const log = await runGuard({ signedIn: false });
  assert.equal(log.restores, 0, "guardStorage loaded the SDK for someone who never signed in");
  assert.equal(log.toasts.length, 1, "and is still warned — it is the case the module exists for");
});

test("installed to the home screen is left alone", async () => {
  const log = await runGuard({ installed: true });
  assert.deepEqual(log.toasts, []);
  assert.equal(log.persistCalls, 1, "still worth asking — it costs nothing and is not iOS-only");
});

test("the invitation screen is never interrupted", async () => {
  for (const cold of ["invitation", "look-around"]) {
    const log = await runGuard({ cold });
    assert.deepEqual(log.toasts, [], `warned over the ${cold} screen`);
    assert.deepEqual(log.saved, [], "and did not spend the week's one warning on a screen nobody saw it on");
  }
});

test("somebody told this week is not told again", async () => {
  const day = 24 * 3600_000;
  assert.deepEqual((await runGuard({ toldAt: Date.now() - day })).toasts, []);
  assert.equal((await runGuard({ toldAt: Date.now() - 8 * day })).toasts.length, 1);
});

test("an Android phone is asked for persistence and left in peace", async () => {
  // Chromium evicts under storage pressure, not on a timer, and
  // persistence exempts it. That is not the same emergency and must not
  // wear the same toast.
  const log = await runGuard({ ua: ANDROID_UA });
  assert.equal(log.persistCalls, 1);
  assert.deepEqual(log.toasts, []);
});

test("nothing is asked of a browser that has already granted it, or cannot", async () => {
  assert.equal((await runGuard({ persisted: true })).persistCalls, 0);
  assert.equal((await runGuard({ supported: false })).persistCalls, 0);
});

// ---------- the wiring exists at all ----------

test("app.js imports the module and asks it, from two dumb call sites", () => {
  assert.ok(APP.includes('from "./persist.js"'), "js/app.js must import the decision");
  const calls = [...APP.matchAll(/^\s*guardStorage\(\);\s*$/gm)];
  assert.equal(calls.length, 2,
    `guardStorage() is called from ${calls.length} places; it belongs at the end of boot() and on the trip-editor save`);
});

test("waiting for the session is one rule, in one place", () => {
  // boot() carried its own copy of "restore a session only if this
  // device wants one" while guardStorage read `account` raw. Two writings
  // of one rule is the shape behind nearly every bug this project has
  // shipped, so there is now a single function and both go through it.
  assert.ok(/\nasync function authSettled\(\) \{/.test(APP),
    "js/app.js must resolve the session in one named place");
  const bare = [...APP.matchAll(/^\s*if \(settings\.syncHint\) connectAuth\(/gm)];
  assert.deepEqual(bare.map((m) => m[0].trim()), [],
    "boot() must not keep its own copy of the syncHint gate");
  const guard = APP.match(/\nasync function guardStorage\(\) \{\n[\s\S]*?\n\}\n/)?.[0] ?? "";
  assert.ok(/await authSettled\(\)/.test(guard),
    "guardStorage decides on being signed in and must wait for the answer");
});

test("persistence is requested exactly once, and only when the module says so", () => {
  const asks = [...APP.matchAll(/navigator\.storage\.persist\(/g)];
  assert.equal(asks.length, 1, `navigator.storage.persist( appears ${asks.length} times in js/app.js`);
  const guard = APP.match(/\nasync function guardStorage\(\) \{\n[\s\S]*?\n\}\n/)?.[0] ?? "";
  assert.ok(guard.includes("navigator.storage.persist("), "the request must live inside guardStorage");
  assert.ok(/if \(shouldAskToPersist\(\{[\s\S]{0,120}\}\)\)/.test(guard),
    "the request must be guarded by shouldAskToPersist");
  assert.ok(/busy: coldOpen\(\) !== "home"/.test(guard),
    "the cold open must be passed as busy, not re-decided here");
});

test("the storage sentence lives in js/persist.js and the install one in js/install.js", () => {
  // Two copies of one sentence is how #install-hint and js/push.js drifted.
  for (const phrase of ["Home Screen", "Add to Home"]) {
    assert.ok(!APP.includes(phrase), `js/app.js carries "${phrase}" — the words belong in the modules`);
  }
});

test("the offline shell carries js/persist.js", () => {
  // Miss this and the app opens fine online and does not boot at all
  // from the home screen with no signal — which is the very device this
  // module exists for. tests/shell.test.mjs walks the real import graph;
  // this is the belt beside its braces.
  const sw = readFileSync(join(ROOT, "sw.js"), "utf8");
  assert.ok(sw.includes('"./js/persist.js"'), "sw.js SHELL must list js/persist.js");
});

test("js/persist.js still refuses to sniff the user agent", () => {
  // Its header forbids it: a wrong guess in there either nags every
  // Android user or silently fails every iPhone one. engineOf() in
  // js/install.js is the one place that reads a user agent for this.
  const src = readFileSync(join(ROOT, "js/persist.js"), "utf8");
  for (const token of ["navigator", "userAgent", "AppleWebKit", "window", "document"]) {
    assert.ok(!src.includes(token), `js/persist.js must not mention ${token}`);
  }
});

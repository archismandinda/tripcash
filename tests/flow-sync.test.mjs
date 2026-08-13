// js/flow/sync.js — the sync machinery, after it left js/app.js (D-2).
//
// The extraction's acceptance criterion was zero behavioural change, so
// these are characterization tests: each one pins a decision that was
// inline and untestable at v1.78.0, and each one describes a bug the
// comments in the moved code say this app has actually shipped.
//
//  1. A live update must never repaint under an open sheet. Someone
//     halfway through typing an expense had the ground moved. The rule
//     is a PAIR — queueLiveRender defers, the sheet's close event
//     flushes — and half of it is worth nothing.
//  2. scheduleSync must do nothing while the push is suppressed. Writing
//     what a snapshot just delivered used to schedule a push straight
//     back, and two phones bounced one trip between them for ever.
//  3. flushPush must RE-ARM while a sync is in flight rather than
//     dropping the push. Dropping it meant an edit made during a slow
//     sync sat local until some unrelated save happened to trigger
//     another one — "I changed it on my phone and it never arrived".
//  4. The latch is shared with the syncNow that stayed in js/app.js.
//     withPushSuppressed restores the SNAPSHOT, not `false`, because a
//     syncNow absorb can run inside an absorbRemote that already set it;
//     clearing it outright would let the outer absorb's saves push back.
//  5. The seam is only as good as its wiring, so the hooks boot()
//     registers are compared, by name, against the ones the module
//     destructures. A hook missing from either side is a silent
//     undefined at the far end of a sync.

import { test, beforeEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => readFileSync(join(ROOT, rel), "utf8");

// The same localStorage stub tests/state.test.mjs uses — js/flow/sync.js
// imports js/state.js, which reads the store at module load.
const backing = new Map();
globalThis.localStorage = {
  getItem: (k) => (backing.has(k) ? backing.get(k) : null),
  setItem: (k, v) => backing.set(k, String(v)),
  removeItem: (k) => backing.delete(k),
};

const flow = await import("../js/flow/sync.js");
const { configure, scheduleSync, flushPush, queueLiveRender, flushLiveRender,
  withPushSuppressed, PUSH_DELAY_MS } = flow;

// Everything app-side land supplies, as spies.
const calls = { syncNow: 0, renderTrips: 0 };
let account = { uid: "u1", email: "asha@example.com" };
let syncing = false;
let sheetOpen = false;

function wire() {
  configure({
    currentAccount: () => account,
    isSyncing: () => syncing,
    syncNow: () => { calls.syncNow++; },
    renderTrips: () => { calls.renderTrips++; },
    renderAccount: () => {},
    noteEvents: () => {},
    applyPrefs: () => {},
    deleteCloudReceipt: () => {},
    sheetOpen: () => sheetOpen,
  });
}

// Enabled ONCE for the whole file, deliberately. Re-enabling between
// tests hands the module a timer handle minted by the previous mock
// clock, and node's clearTimeout then deletes whatever now sits at that
// handle's remembered queue position — so the NEXT timer armed silently
// never fires and every timing assertion goes vacuously green. That is a
// harness defect, not a product one, and it cost half an hour here.
mock.timers.enable({ apis: ["setTimeout"] });
const tick = (ms) => mock.timers.tick(ms);

beforeEach(() => {
  account = { uid: "u1", email: "asha@example.com" };
  syncing = false;
  sheetOpen = false;
  wire();
  // Leave no timer armed by the previous test: flushPush cancels the
  // pending push, flushLiveRender consumes a pending repaint, and the
  // tick expires anything still in the queue.
  flushPush();
  flushLiveRender();
  tick(PUSH_DELAY_MS * 10);
  flushLiveRender();
  calls.syncNow = 0;
  calls.renderTrips = 0;
});

// ---------- 1. never repaint under an open sheet ----------

test("a live update that arrives while a sheet is open does not repaint", () => {
  sheetOpen = true;
  queueLiveRender();
  tick(PUSH_DELAY_MS * 2); // long past the 400ms the queue arms
  assert.equal(calls.renderTrips, 0,
    "the home screen was rebuilt under an open sheet — this is somebody losing their place mid-expense");
});

test("…and it lands the moment the sheet closes", () => {
  sheetOpen = true;
  queueLiveRender();
  tick(1000);
  assert.equal(calls.renderTrips, 0);
  // What js/app.js's `close` listener does, 150ms later.
  sheetOpen = false;
  flushLiveRender();
  assert.equal(calls.renderTrips, 1,
    "the update was deferred and then never applied — the other phone's change is invisible until something else repaints");
});

test("a deferred update is applied once, not once per snapshot", () => {
  sheetOpen = true;
  queueLiveRender();
  queueLiveRender();
  queueLiveRender();
  sheetOpen = false;
  flushLiveRender();
  flushLiveRender();
  assert.equal(calls.renderTrips, 1, "three snapshots and two flushes are still one repaint");
});

test("with no sheet open the queued repaint happens on its own", () => {
  queueLiveRender();
  assert.equal(calls.renderTrips, 0, "it is debounced, not immediate");
  tick(400);
  assert.equal(calls.renderTrips, 1);
});

// ---------- 2. scheduleSync's two guards ----------

// Both guards are written out twice — once in scheduleSync, once in
// flushPush — so asserting only that syncNow was not called cannot tell
// which of the two held. That is precisely the drift this project keeps
// shipping, so the timer itself is what gets counted.
function armed(fn) {
  const real = globalThis.setTimeout;
  let n = 0;
  globalThis.setTimeout = (...a) => { n++; return real(...a); };
  try { fn(); } finally { globalThis.setTimeout = real; }
  return n;
}

test("scheduleSync does nothing at all while signed out", () => {
  account = null;
  assert.equal(armed(() => scheduleSync()), 0,
    "a signed-out device armed a push timer — flushPush's own guard is the only thing left stopping it");
  tick(PUSH_DELAY_MS * 3);
  assert.equal(calls.syncNow, 0, "a signed-out device must never reach the network");
});

test("scheduleSync does nothing while the push is suppressed", () => {
  // What absorbing a snapshot looks like from here: a save fires the
  // onSaved hook, which is scheduleSync.
  withPushSuppressed(() => {
    assert.equal(armed(() => scheduleSync()), 0,
      "absorbing a snapshot armed a push back at the phone that sent it");
  });
  tick(PUSH_DELAY_MS * 3);
  assert.equal(calls.syncNow, 0,
    "writing what the other phone just sent pushed it straight back — that is the ping-pong loop");
});

test("…and scheduling works again the moment the latch lifts", () => {
  withPushSuppressed(() => { scheduleSync(); });
  scheduleSync();
  tick(PUSH_DELAY_MS);
  assert.equal(calls.syncNow, 1,
    "the latch stayed on after the absorb finished — this device never pushes again until reload");
});

test("an ordinary save pushes once, after the debounce and not before", () => {
  scheduleSync();
  tick(PUSH_DELAY_MS - 1);
  assert.equal(calls.syncNow, 0, "a converter keystroke must not be a network call");
  tick(1);
  assert.equal(calls.syncNow, 1);
});

test("a burst of saves collapses into one push", () => {
  for (let i = 0; i < 20; i++) { scheduleSync(); tick(50); }
  tick(PUSH_DELAY_MS);
  assert.equal(calls.syncNow, 1, "twenty keystrokes must cost one read, not twenty");
});

// ---------- 3. flushPush re-arms while a sync is in flight ----------

test("flushPush waits its turn instead of dropping the push", () => {
  syncing = true;
  flushPush();
  assert.equal(calls.syncNow, 0, "one sync at a time");
  tick(PUSH_DELAY_MS);
  assert.equal(calls.syncNow, 0, "still in flight, so still waiting");
  tick(PUSH_DELAY_MS * 4);
  assert.equal(calls.syncNow, 0, "…and it keeps waiting rather than giving up");
  syncing = false;
  tick(PUSH_DELAY_MS);
  assert.equal(calls.syncNow, 1,
    "the edit made during a slow sync was dropped — it sits local until some unrelated save pushes it");
});

test("flushPush is immediate when nothing is in flight — a backgrounding tab cannot wait", () => {
  // visibilitychange and pagehide both call this directly, because a
  // backgrounded tab can have its timers frozen indefinitely.
  scheduleSync();
  flushPush();
  assert.equal(calls.syncNow, 1, "leaving the app must send what is pending NOW");
  tick(PUSH_DELAY_MS * 3);
  assert.equal(calls.syncNow, 1, "…and the timer it cancelled must not fire a second one");
});

test("flushPush respects both guards too", () => {
  account = null;
  flushPush();
  withPushSuppressed(() => { flushPush(); });
  tick(PUSH_DELAY_MS * 3);
  assert.equal(calls.syncNow, 0);
});

// ---------- 4. the latch's geometry, which is the seam ----------

test("withPushSuppressed restores what it found, not `false`", () => {
  // The nesting that makes this matter: syncNow's absorb can run inside
  // an absorbRemote that has already set the latch. Restoring `false`
  // there would let the rest of the outer absorb push back.
  withPushSuppressed(() => {
    withPushSuppressed(() => {});
    // Still inside the outer suppression, so this must not arm anything.
    scheduleSync();
  });
  tick(PUSH_DELAY_MS * 3);
  assert.equal(calls.syncNow, 0,
    "the inner absorb cleared the outer one's latch — the ping-pong loop, one level down");
});

test("the latch lifts even when the absorb throws", () => {
  // applyPayload throws on a trip document missing `tombstones` — the
  // raw pass-through for a trip this device has never seen. Without the
  // finally, one such document latched suppressPush ON and the device
  // silently never pushed again until the app was reloaded.
  assert.throws(() => withPushSuppressed(() => { throw new Error("bad payload"); }), /bad payload/);
  scheduleSync();
  tick(PUSH_DELAY_MS);
  assert.equal(calls.syncNow, 1, "a thrown absorb left this device unable to push for the rest of the session");
});

test("withPushSuppressed hands back what its function returned", () => {
  assert.equal(withPushSuppressed(() => 42), 42);
});

// ---------- 5. the wiring, read out of the real source ----------

test("boot registers exactly the hooks the flow module destructures", () => {
  // The whole seam is one call. A name on one side and not the other is
  // an `undefined` reached minutes later, inside a sync, with nothing on
  // screen to say so — this project's signature failure, in the one
  // place D-2 created for it.
  const flowSrc = read("js/flow/sync.js");
  const appSrc = read("js/app.js");

  const wanted = flowSrc.match(/export function configure\(hooks\) \{\s*\(\{([\s\S]*?)\}\s*=\s*hooks\);/);
  assert.ok(wanted, "js/flow/sync.js must keep configure as one destructuring assignment");
  const wantedNames = wanted[1].split(",").map((s) => s.trim()).filter(Boolean).sort();

  const given = appSrc.match(/configureSync\(\{([\s\S]*?)\n\s*\}\);/);
  assert.ok(given, "js/app.js's boot must register the hooks in one configureSync call");
  const givenNames = [...given[1].matchAll(/^\s*([A-Za-z][\w]*)\s*[:,]/gm)]
    .map((m) => m[1]).sort();

  assert.deepEqual(givenNames, wantedNames,
    "the hooks boot() passes and the hooks js/flow/sync.js reads have drifted apart");
  assert.ok(wantedNames.length >= 9,
    `only ${wantedNames.length} hooks parsed — the scanner has stopped seeing them`);
});

test("the flow module never imports the composition root", () => {
  // Belt and braces beside tests/ownership.test.mjs: a static import of
  // js/app.js would make this a rename rather than an extraction, and a
  // DYNAMIC one would slip past a static import walk entirely.
  assert.doesNotMatch(read("js/flow/sync.js"), /["'][^"']*\bapp\.js["']/,
    "js/flow/sync.js must reach app-side land only through configure()");
});

test("the lazy imports point out of js/flow, not at this file", () => {
  // js/flow/sync.js and js/sync.js are different modules with the same
  // basename. `await import("./sync.js")` inside the flow file resolves
  // to ITSELF — absorbRemote would then destructure buildPayload off a
  // module that has none, and every incoming snapshot would throw.
  // Comments stripped first: the file's own header explains the trap in
  // the words that would otherwise trip this scanner.
  const src = read("js/flow/sync.js")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/\/\/[^\n]*/g, " ");
  const bad = [...src.matchAll(/import\("(\.\/[^"]+)"\)/g)].map((m) => m[1]);
  assert.deepEqual(bad, [],
    `these lazy imports resolve inside js/flow/: ${bad.join(", ")}`);
  assert.match(src, /import\("\.\.\/sync\.js"\)/,
    "absorbRemote must reach the payload module at js/sync.js");
});

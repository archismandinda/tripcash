// The seven-day timer, and who it takes data from.
//
// Every case here is a real person on a real phone. The one that matters
// most is the last-but-one: an iPhone, opened from a shared link, never
// installed, never signed in. That person's trip is deleted by Safari
// after a week away and nothing in the app currently tells them.

import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldAskToPersist, storageRisk, shouldWarn } from "../js/persist.js";

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
  const risk = storageRisk({ ...iphone, installed: false, signedIn: false });
  assert.equal(risk.atRisk, true);
  assert.equal(risk.severity, "loss");
  assert.match(risk.advice, /Home Screen/);
  assert.match(risk.why, /7 days/);
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

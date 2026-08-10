// Can a phone still running the LIVE client (v1.63.0) write once the new
// rules are published? This is the rollout window: rules go up first, and
// devices update on their second open. If the answer is no, publishing
// breaks the owner's own phones until they happen to reopen the app.
import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc } from "firebase/firestore";

const env = await initializeTestEnvironment({
  projectId: "compat-check",
  firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
});

// Exactly what the LIVE client's buildPayload emits (js/sync.js@968e81f).
const livePayload = (uid, extra = {}) => ({
  name: "Vietnam", ownerUid: uid, memberUids: [uid], invitedEmails: [],
  members: [{ id: "m1", name: "Asha" }], expenses: [], settlements: [],
  tombstones: { expenses: {}, settlements: {} }, updatedAt: 1, ...extra,
});

test("a live-client device can still create a trip", async () => {
  const a = env.authenticatedContext("A", { email: "a@x.com", email_verified: true }).firestore();
  await assertSucceeds(setDoc(doc(a, "trips/t1"), livePayload("A")));
});

test("a live-client device can still write a trip it already owns", async () => {
  const a = env.authenticatedContext("A", { email: "a@x.com", email_verified: true }).firestore();
  await assertSucceeds(setDoc(doc(a, "trips/t1"), livePayload("A", { name: "Vietnam — Dec", updatedAt: 2 })));
});

test("a live-client MEMBER can still write a trip owned by someone else", async () => {
  await env.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), "trips/t2"), livePayload("A", { memberUids: ["A", "B"] }));
  });
  const b = env.authenticatedContext("B", { email: "b@x.com", email_verified: true }).firestore();
  await assertSucceeds(setDoc(doc(b, "trips/t2"), livePayload("A", { memberUids: ["A", "B"], updatedAt: 3 })));
});

test("the new rule still bites: nobody can drop the owner", async () => {
  const b = env.authenticatedContext("B", { email: "b@x.com", email_verified: true }).firestore();
  await assertFails(setDoc(doc(b, "trips/t2"), livePayload("A", { memberUids: ["B"], updatedAt: 4 })));
});

test("the new rule still bites: nobody can seize ownership", async () => {
  const b = env.authenticatedContext("B", { email: "b@x.com", email_verified: true }).firestore();
  await assertFails(setDoc(doc(b, "trips/t2"), livePayload("B", { memberUids: ["A", "B"], updatedAt: 5 })));
});

test("removal now works — a member CAN drop a non-owner", async () => {
  const a = env.authenticatedContext("A", { email: "a@x.com", email_verified: true }).firestore();
  await assertSucceeds(setDoc(doc(a, "trips/t2"), livePayload("A", { memberUids: ["A"], updatedAt: 6 })));
});

// The one case where the live client and the new rules DISAGREE, which is
// why TC2-3 ships the client first and publishes the rules only afterwards
// (ADR-0023). Every payload the live client sends carries `ownerUid: <its
// own uid>` — that is the defect — so its push to a document that has no
// owner is now refused. The rules are right to refuse it; the point of
// this test is that the refusal is known, bounded and ordered, rather than
// discovered on a phone during the two-open window.
const ownerless = (extra = {}) => {
  const p = livePayload("A", { memberUids: ["A", "B"], ...extra });
  delete p.ownerUid;             // the whole point of the fixture
  return p;
};

test("a live-client device CANNOT write a trip that has no owner", async () => {
  await env.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), "trips/legacy"), ownerless());
  });
  const b = env.authenticatedContext("B", { email: "b@x.com", email_verified: true }).firestore();
  // What v1.65's buildPayload emits for this trip: ownerUid = B, because
  // the stored document has none and the old code filled the gap with
  // whoever was pushing. Under the new rules that is a seizure, refused.
  await assertFails(setDoc(doc(b, "trips/legacy"), livePayload("B", { memberUids: ["A", "B"], updatedAt: 9 })));
  // So publish the rules FIRST and this device stops syncing that trip
  // until its second open. Publish the CLIENT first and nothing breaks:
  // the fixed client sends the stored value back (below), which the old
  // rules and the new rules both accept.
  await assertSucceeds(setDoc(doc(b, "trips/legacy"), ownerless({ updatedAt: 10 })));
});

test("…and the trip is still readable and writable by its members meanwhile", async () => {
  // The refusal above is confined to the push. Nobody is locked out, and
  // a device that has updated works normally on the same document.
  const a = env.authenticatedContext("A", { email: "a@x.com", email_verified: true }).firestore();
  await assertSucceeds(getDoc(doc(a, "trips/legacy")));
  await assertSucceeds(setDoc(doc(a, "trips/legacy"), ownerless({ name: "Vietnam — Dec", updatedAt: 11 })));
});

test.after(() => env.cleanup());

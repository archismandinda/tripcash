// In which order may the rules and the client be shipped?
//
// Rules and clients are deployed separately, and a service worker only
// reaches a phone on its SECOND open. So there is always a window where
// one is new and the other is old, in whichever direction we choose. This
// file establishes which direction is survivable, because getting it
// wrong means every push from the owner's own phones is refused and the
// only visible symptom is that syncing has stopped.
//
// It was written after noticing that TC2-3's fix changes the meaning of a
// field the DEPLOYED client is still writing. The rules-first order that
// was correct for sprint 1 is not correct for sprint 2, and nothing would
// have said so.
//
// WHAT "DEPLOYED" MEANS, AND WHY IT IS WRITTEN DOWN RATHER THAN GUESSED.
// The deployed client and the deployed rules come from the commits pinned
// in docs/deployed-baseline.txt — not from the tip of the branch. The tip
// is not what is deployed; it is whatever was committed last. This file
// used to read it anyway, so the moment the sprint it was gating got
// committed the baseline became the sprint itself: every assertion below
// turned vacuously true, the one premise that could not be vacuous failed,
// and the release gate went red for a reason unrelated to the release.
// Both halves are pinned separately because they go live separately —
// ADR-0023 ships the client and publishes the rules days later, and
// throughout that window they are different commits.
//
// The client is extracted whole, not file by file: js/sync.js imports its
// siblings, and a lone copy resolves them against the NEW tree — which
// would silently test the new client twice and report that everything is
// fine. (tests-integration/deployed.mjs does both, and is unit-tested by
// tests/deployed.test.mjs, which CI actually runs.)

import test from "node:test";
import assert from "node:assert/strict";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { initializeTestEnvironment, assertSucceeds, assertFails } from "@firebase/rules-unit-testing";
import { doc, setDoc } from "firebase/firestore";
import { BASELINE_FILE, resolveDeployed, extractClient, rolloutQuestion } from "./deployed.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// Fatal if it cannot be resolved. A gate that has lost its baseline must
// say so, not report that everything is fine.
const deployed = resolveDeployed(ROOT);
const RULES_LIVE = deployed.rulesLive;   // published, per the pinned commit
const RULES_NEXT = deployed.rulesNext;   // what the sprint wants published

// There is only an ordering question when firestore.rules is changing.
// When it is not, this whole file has nothing to compare and says so out
// loud — six skips with a reason, rather than six passes that mean nothing.
const question = rolloutQuestion(deployed);
const skip = question.arises ? false : question.reason;
if (skip) {
  console.error(`\n  rollout: nothing to check — ${skip}\n`);
}

// Both clients' buildPayload, imported for real rather than reimplemented
// — a hand-copied payload would pass this test and prove nothing.
const buildDeployed = question.arises
  ? (await import(`${extractClient(ROOT, deployed.client)}/js/sync.js`)).buildPayload
  : null;
const { buildPayload: buildNext } = await import("../js/sync.js");

const env = async (rules, projectId) =>
  initializeTestEnvironment({
    projectId,
    firestore: { rules, host: "127.0.0.1", port: 8080 },
  });

const TRIP = { id: "t1", name: "Goa", currencies: ["INR"], members: [{ id: "m1", name: "Asha", uid: "A" }] };
const args = (over = {}) => ({
  trip: TRIP, expenses: [], settlements: [], tombstones: {}, uid: "A", ...over,
});

// Seed a trip document with NO ownerUid — a trip created before the field
// existed. This is the only shape where the two clients disagree, and the
// whole question is what happens to one.
async function seedOwnerless(e, tripId = "t1") {
  await e.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), `trips/${tripId}`), {
      name: "Goa", memberUids: ["A"], invitedEmails: [], members: TRIP.members,
      expenses: [], settlements: [], tombstones: { expenses: {}, settlements: {} },
      updatedAt: 1,
    });
  });
}

const as = (e, uid) => e.authenticatedContext(uid, { email: "asha@example.com", email_verified: true }).firestore();

// ---------- the direction that breaks ----------

test("RULES FIRST would refuse the deployed client on an ownerless trip", { skip }, async () => {
  // The deployed client builds ownerUid as `trip.ownerUid ?? uid`, so on a
  // trip that has never had one it nominates ITSELF. The new keepsOwner()
  // pins the field unconditionally, and null != "A".
  const e = await env(RULES_NEXT, "rollout-rules-first");
  await seedOwnerless(e);
  const payload = buildDeployed(args());
  // If this premise ever stops holding, the deployed client no longer has
  // the defect this file's conclusion is built on — a later release has
  // gone out. That is not a bug in the release being gated: re-derive the
  // conclusion below, and check docs/deployed-baseline.txt is current.
  assert.equal(payload.ownerUid, "A",
    `the client pinned in ${BASELINE_FILE} nominates itself — this is the premise`);
  await assertFails(setDoc(doc(as(e, "A"), "trips/t1"), payload));
  await e.cleanup();
});

test("…and the same client is fine on a trip that already has an owner", { skip }, async () => {
  // Which is why this is a narrow window and not a total outage: only
  // trips predating ownerUid are affected.
  const e = await env(RULES_NEXT, "rollout-owned");
  await e.withSecurityRulesDisabled(async (c) => {
    await setDoc(doc(c.firestore(), "trips/t2"), {
      name: "Goa", ownerUid: "A", memberUids: ["A"], invitedEmails: [], members: TRIP.members,
      expenses: [], settlements: [], tombstones: { expenses: {}, settlements: {} }, updatedAt: 1,
    });
  });
  const payload = buildDeployed(args({ trip: { ...TRIP, id: "t2", ownerUid: "A" } }));
  await assertSucceeds(setDoc(doc(as(e, "A"), "trips/t2"), payload));
  await e.cleanup();
});

// ---------- the direction that works ----------

test("CLIENT FIRST: the new client is accepted by the rules already published", { skip }, async () => {
  // The new client sends back whatever the document already carries and
  // never invents an owner, so it satisfies the OLD keepsOwner() too —
  // which short-circuited to true on an ownerless document anyway.
  const e = await env(RULES_LIVE, "rollout-client-first-old");
  await seedOwnerless(e);
  const payload = buildNext(args());
  assert.equal(payload.ownerUid, null, "the new client never nominates anyone");
  await assertSucceeds(setDoc(doc(as(e, "A"), "trips/t1"), payload));
  await e.cleanup();
});

test("…and by the new rules as well", { skip }, async () => {
  const e = await env(RULES_NEXT, "rollout-client-first-new");
  await seedOwnerless(e);
  await assertSucceeds(setDoc(doc(as(e, "A"), "trips/t1"), buildNext(args())));
  await e.cleanup();
});

test("the new client can still create a trip under BOTH rule sets", { skip }, async () => {
  // Creation is the other place ownership is decided, and the new rules
  // added ownsWhatItCreates(). A client that could sync but not create
  // would be a subtler version of the same outage.
  for (const [name, rules] of [["published", RULES_LIVE], ["next", RULES_NEXT]]) {
    const e = await env(rules, `rollout-create-${name}`);
    await assertSucceeds(setDoc(doc(as(e, "A"), "trips/t9"),
      buildNext(args({ trip: { ...TRIP, id: "t9" } }))));
    await e.cleanup();
  }
});

test("the deployed client can also still create, so nobody is stranded mid-rollout", { skip }, async () => {
  // It nominates itself as owner on create, which ownsWhatItCreates()
  // permits precisely because the author IS the owner it names.
  const e = await env(RULES_NEXT, "rollout-create-deployed");
  await assertSucceeds(setDoc(doc(as(e, "A"), "trips/t8"),
    buildDeployed(args({ trip: { ...TRIP, id: "t8" } }))));
  await e.cleanup();
});

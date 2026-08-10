// The whole invitation journey, end to end, against the emulator —
// using the REAL merge logic from js/sync.js and the REAL firestore.rules.
//
// Every one of the three invitation bugs seen on a real phone would
// have failed here first:
//   1. an unverified invitee's SEARCH is refused (v1.53.0)
//   2. a verified invitee's search succeeds (v1.53.1, once the token is
//      re-minted — modelled here by issuing a token with the true claim)
//   3. the invitee's own device is what puts them into memberUids
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initializeTestEnvironment, assertFails } from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc, collection, query, where, getDocs } from "firebase/firestore";
import { buildPayload, mergePayload, joinIfInvited } from "../js/sync.js";
import { emailKey, pendingInvites } from "../js/invites.js";
import { webcrypto } from "node:crypto";

const key = (email) => emailKey(email, webcrypto.subtle);

let env;
// Every test starts from an empty database. Without this, a test where B
// joins leaves memberUids [A,B] — and the next test's seed, written as A
// with memberUids [A], is refused by keepsEveryone(). The rules are
// right; the harness was wrong.
import { beforeEach } from "node:test";
beforeEach(async () => { await env?.clearFirestore(); });

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "tripcash-flow",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
  });
});
after(async () => { await env?.cleanup(); });

const ASHA = { uid: "A", email: "owner@example.com" };
const SECOND = { uid: "B", email: "second@example.com" };

const ctx = (who, verified = true) =>
  env.authenticatedContext(who.uid, { email: who.email, email_verified: verified });

// What the app does when the owner creates a trip and adds a second
// account's address as a member.
async function archiCreatesTripInviting(second) {
  const trip = {
    id: "t-flow", name: "Manali", currencies: ["INR"], createdAt: 1, updatedAt: 1,
    members: [
      { id: "me", name: "Asha", uid: ASHA.uid, email: ASHA.email },
      { id: "m2", name: "Second", email: second.email },
    ],
  };
  const payload = buildPayload({ trip, expenses: [], settlements: [], tombstones: {}, uid: ASHA.uid });
  await setDoc(doc(ctx(ASHA).firestore(), "trips/t-flow"), payload);
  return payload;
}

describe("someone adds you to a trip by email", () => {
  test("the trip carries the invitation the moment it is created", async () => {
    const payload = await archiCreatesTripInviting(SECOND);
    assert.ok(payload.invitedEmails.includes(SECOND.email), "the address must be on the document");
    assert.deepEqual(payload.memberUids, [ASHA.uid], "the invitee is NOT a member yet — this is the crux");
  });

  test("an UNVERIFIED invitee DISCOVERS it — the case that was broken", async () => {
    // This is the whole point of ADR-0020. The second account
    // was unverified, then verified-with-a-stale-token, and both times
    // nothing happened and nothing said why. Verification now gates
    // nothing, so this must pass with email_verified FALSE.
    const payload = await archiCreatesTripInviting(SECOND);

    // The inviter leaves an entry in the invitee's index.
    const inviterDb = ctx(ASHA).firestore();
    await setDoc(doc(inviterDb, `invites/${await key(SECOND.email)}`),
      { trips: { "t-flow": { name: "Manali", invitedBy: "Asha", at: Date.now() } } });

    const db = ctx(SECOND, false).firestore();

    // 1. discover — ONE document read, addressed by our own identity
    const index = await getDoc(doc(db, `invites/${await key(SECOND.email)}`));
    assert.ok(index.exists(), "the invite index must be readable unverified");
    const waiting = pendingInvites(index.data(), []);
    assert.deepEqual(waiting.map((w) => w.tripId), ["t-flow"]);

    // 2. …and reading it is permitted unverified, so nothing about
    //    discovery is silently refused. JOINING needs a verified
    //    address (v1.58.1) — see the rules suite.
    const remote = (await getDoc(doc(db, `trips/${waiting[0].tripId}`))).data();
    assert.ok(remote, "isInvited() must permit the get");
    assert.ok(remote.invitedEmails.includes(SECOND.email));
  });

  test("an invite LINK opens the trip; joining it needs a verified address", async () => {
    await archiCreatesTripInviting(SECOND);
    const unverified = ctx(SECOND, false).firestore();
    const byId = await getDoc(doc(unverified, "trips/t-flow")); // fetchTripById
    assert.ok(byId.exists(), "a direct read by id must be permitted unverified");
    // `writer` is how the joiner names themselves. A join may not restamp
    // lastEditBy — joinOnly() refuses that — so with the access list
    // derived from members (TC-4), an unnamed joiner is merged straight
    // back off the trip they are joining.
    const join = (payload) =>
      mergePayload(joinIfInvited(payload, SECOND), payload, undefined, { writer: SECOND.uid });
    await assertFails(setDoc(doc(unverified, "trips/t-flow"), join(byId.data())));

    const verified = ctx(SECOND, true).firestore();
    const fresh = (await getDoc(doc(verified, "trips/t-flow"))).data();
    await setDoc(doc(verified, "trips/t-flow"), join(fresh));
    assert.deepEqual((await getDoc(doc(verified, "trips/t-flow"))).data().memberUids.sort(), ["A", "B"]);
  });

  test("someone who was never invited cannot use the link path either", async () => {
    await archiCreatesTripInviting(SECOND);
    const db = env.authenticatedContext("Z", { email: "zed@x.com", email_verified: true }).firestore();
    await assertFails(getDoc(doc(db, "trips/t-flow")));
  });
});

describe("the function's recipients", () => {
  test("the invitee is reachable through the address on their user doc", async () => {
    // The Cloud Function resolves invitedEmails -> uid this way. If the
    // account never records its address, the one notification that
    // matters ("you were added to a trip") cannot be delivered at all.
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), `users/${SECOND.uid}`),
        { email: SECOND.email, pushTokens: { tok: { at: 1 } } });
    });
    const payload = await archiCreatesTripInviting(SECOND);
    await env.withSecurityRulesDisabled(async (c) => {
      const hits = await getDocs(
        query(collection(c.firestore(), "users"), where("email", "in", payload.invitedEmails)));
      const uids = hits.docs.map((d) => d.id);
      assert.ok(uids.includes(SECOND.uid), "the invitee must be resolvable from their address");
    });
  });
});

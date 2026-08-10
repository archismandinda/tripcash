// The invite index, exercised for real against firestore.rules.
//
// This file exists because of a cleanup that has never once worked.
//
// `dropInvites()` (js/firestore.js) removes the entries an invitee has
// finished with, by writing `{trips: {<id>: deleteField()}}` with
// merge:true. The `invites/{key}` update rule required
//
//     request.resource.data.trips.keys().hasAll(resource.data.trips.keys())
//
// which is false the moment a key is REMOVED — so every one of those
// writes was refused, and the refusal was swallowed by a `.catch(() => {})`
// at the call site. Nothing in the app or the console ever said a word.
//
// The cost is not a stale document. `pendingInvites()` re-offers every
// entry in the index on every sync, and an invitation that can never
// succeed (deleted trip, wrong address) is therefore retried for the
// full ninety-day TTL, on every device, for ever.
//
// The rule was right about the danger and wrong about who it applied to.
// Anyone signed in may ADD an entry to anyone's index — that is
// deliberate and load-bearing (ADR-0020: you must be able to invite
// someone whose account you cannot read). What must not happen is a
// stranger EMPTYING your index, which would silently destroy every
// invitation waiting for you. But the key's owner already holds
// `allow delete` on the whole document, so forbidding them a partial
// removal protected nothing at all.
//
// Run: npm run test:rules
import { test, before, after, describe } from "node:test";
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment, assertSucceeds, assertFails,
} from "@firebase/rules-unit-testing";
import { doc, setDoc, getDoc, deleteField } from "firebase/firestore";
import { webcrypto } from "node:crypto";
import { emailKey } from "../js/invites.js";

const key = (email) => emailKey(email, webcrypto.subtle);

const OWNER = "priya@example.com";
const STRANGER = "rahul@example.com";

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "tripcash-test",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
  });
});

after(async () => { await env?.cleanup(); });

const as = (uid, email) => env.authenticatedContext(uid, { email, email_verified: true });

// Two invitations waiting for the owner, written the way an inviter
// writes them.
async function seed(k, trips = { t1: { name: "Goa", at: 1 }, t2: { name: "Kyoto", at: 2 } }) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), `invites/${k}`), { trips });
  });
}

describe("the invitee tidying their own index", () => {
  test("the exact write dropInvites() makes is allowed", async () => {
    const k = await key(OWNER);
    await seed(k);
    const db = as("P", OWNER).firestore();
    // Byte for byte what js/firestore.js sends: deleteField() under
    // merge:true. Testing anything else would prove nothing about the
    // call that was actually being refused.
    await assertSucceeds(
      setDoc(doc(db, `invites/${k}`), { trips: { t1: deleteField() } }, { merge: true })
    );
    const after = await getDoc(doc(db, `invites/${k}`));
    // And it really went: an allowed write that changes nothing would
    // leave the ninety-day retry loop exactly where it was.
    if (after.data().trips.t1 !== undefined) throw new Error("t1 survived the delete");
    if (after.data().trips.t2 === undefined) throw new Error("t2 was collateral damage");
  });

  test("they may empty it completely — every entry can be spent at once", async () => {
    const k = await key(OWNER);
    await seed(k);
    const db = as("P", OWNER).firestore();
    await assertSucceeds(setDoc(
      doc(db, `invites/${k}`),
      { trips: { t1: deleteField(), t2: deleteField() } },
      { merge: true }
    ));
  });
});

describe("a stranger", () => {
  test("may still ADD an invitation — that is the whole point of ADR-0020", async () => {
    // You must be able to invite someone whose account you cannot read.
    // If this ever starts failing, invitations stop being delivered and
    // the app has no way to notice.
    const k = await key(OWNER);
    await seed(k);
    const db = as("R", STRANGER).firestore();
    await assertSucceeds(
      setDoc(doc(db, `invites/${k}`), { trips: { t3: { name: "Lisbon", at: 3 } } }, { merge: true })
    );
  });

  test("may not remove an entry from somebody else's index", async () => {
    const k = await key(OWNER);
    await seed(k);
    const db = as("R", STRANGER).firestore();
    await assertFails(
      setDoc(doc(db, `invites/${k}`), { trips: { t1: deleteField() } }, { merge: true })
    );
  });

  test("may not empty somebody else's index by rewriting it", async () => {
    const k = await key(OWNER);
    await seed(k);
    const db = as("R", STRANGER).firestore();
    await assertFails(setDoc(doc(db, `invites/${k}`), { trips: {} }));
  });

  test("may not swap an entry out while adding one", async () => {
    // The failure this guards against is a stranger who "adds" an
    // invitation and takes a real one away in the same write.
    const k = await key(OWNER);
    await seed(k);
    const db = as("R", STRANGER).firestore();
    await assertFails(setDoc(
      doc(db, `invites/${k}`),
      { trips: { t2: { name: "Kyoto", at: 2 }, t3: { name: "Lisbon", at: 3 } } }
    ));
  });
});

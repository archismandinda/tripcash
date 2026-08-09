// Rules, exercised for real against the Firestore emulator.
//
// This file exists because three separate invitation bugs shipped in a
// row, each found by the owner on a real phone, because nothing here
// could be tested without signing in as him. It can now: the emulator
// takes throwaway accounts and evaluates the ACTUAL firestore.rules.
//
// Run: npm run test:rules   (starts the emulator itself)
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment, assertSucceeds, assertFails,
} from "@firebase/rules-unit-testing";
import {
  doc, getDoc, setDoc, deleteDoc, collection, query, where, getDocs,
} from "firebase/firestore";
import { emailKey } from "../js/invites.js";
import { webcrypto } from "node:crypto";

const key = (email) => emailKey(email, webcrypto.subtle);

let env;

before(async () => {
  env = await initializeTestEnvironment({
    projectId: "tripcash-test",
    firestore: { rules: readFileSync("firestore.rules", "utf8"), host: "127.0.0.1", port: 8080 },
  });
});

after(async () => { await env?.cleanup(); });

// A signed-in context whose token carries the claims the rules read.
const as = (uid, email, verified = true) =>
  env.authenticatedContext(uid, { email, email_verified: verified });

const tripDoc = (over = {}) => ({
  schema: 1,
  trip: { id: "t1", name: "Goa", currencies: ["INR"], updatedAt: 1, members: [
    { id: "m1", name: "Archi", email: "archi@x.com", uid: "A" },
    { id: "m2", name: "Bo", email: "bo@x.com" },
  ]},
  memberUids: ["A"],
  invitedEmails: ["archi@x.com", "bo@x.com"],
  ownerUid: "A",
  expenses: [], settlements: [], tombstones: { expenses: {}, settlements: {} },
  lastEditBy: "A",
  ...over,
});

async function seed(data = tripDoc()) {
  await env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "trips/t1"), data);
  });
}

describe("a member", () => {
  test("reads and writes their own trip", async () => {
    await seed();
    const db = as("A", "archi@x.com").firestore();
    await assertSucceeds(getDoc(doc(db, "trips/t1")));
    await assertSucceeds(setDoc(doc(db, "trips/t1"), tripDoc({ trip: { ...tripDoc().trip, name: "Goa 2026" } })));
  });

  test("cannot evict anyone", async () => {
    await seed(tripDoc({ memberUids: ["A", "B"] }));
    const db = as("A", "archi@x.com").firestore();
    await assertFails(setDoc(doc(db, "trips/t1"), tripDoc({ memberUids: ["A"] })));
  });

  test("cannot hard-delete the document", async () => {
    await seed();
    await assertFails(deleteDoc(doc(as("A", "archi@x.com").firestore(), "trips/t1")));
  });
});

describe("an invitee", () => {
  test("can read the trip and join it", async () => {
    await seed();
    const db = as("B", "bo@x.com").firestore();
    await assertSucceeds(getDoc(doc(db, "trips/t1")));
    await assertSucceeds(setDoc(doc(db, "trips/t1"), tripDoc({ memberUids: ["A", "B"] })));
  });

  test("READING works unverified; joining does not", async () => {
    // The balance struck in v1.58.1. Discovery and reading stay open —
    // that is ADR-0020, and it is what stopped invitations failing
    // silently. Joining does not, because joining grants full write on
    // a shared ledger, and an unverified account can be registered on
    // anyone's address.
    //
    // The v1.29 objection (a verification gate stranded a real invitee)
    // is answered by WHERE the gate now sits: a refused query says
    // nothing and cannot be reported; a refused join is a deliberate
    // action the app explains on the spot.
    await seed();
    const db = as("B", "bo@x.com", false).firestore();
    await assertSucceeds(getDoc(doc(db, "trips/t1")));
    await assertFails(setDoc(doc(db, "trips/t1"), tripDoc({ memberUids: ["A", "B"] })));
  });

  test("cannot change anything but the membership list", async () => {
    await seed();
    const db = as("B", "bo@x.com").firestore();
    // Rewriting the ledger…
    await assertFails(setDoc(doc(db, "trips/t1"), tripDoc({
      memberUids: ["A", "B"], expenses: [{ id: "x", name: "theirs", updatedAt: 9 }],
    })));
    // …renaming it…
    await assertFails(setDoc(doc(db, "trips/t1"), tripDoc({
      memberUids: ["A", "B"], trip: { ...tripDoc().trip, name: "hijacked" },
    })));
    // …or destroying it.
    await assertFails(setDoc(doc(db, "trips/t1"), {
      schema: 1, deleted: true, deletedAt: 9,
      memberUids: ["A", "B"], invitedEmails: tripDoc().invitedEmails, ownerUid: "A",
    }));
  });
});

describe("a stranger", () => {
  test("cannot read, write or delete", async () => {
    await seed();
    const db = as("Z", "zed@x.com").firestore();
    await assertFails(getDoc(doc(db, "trips/t1")));
    await assertFails(setDoc(doc(db, "trips/t1"), tripDoc({ memberUids: ["A", "Z"] })));
    await assertFails(deleteDoc(doc(db, "trips/t1")));
  });

  test("cannot enumerate trips", async () => {
    await seed();
    const db = as("Z", "zed@x.com").firestore();
    await assertFails(getDocs(query(collection(db, "trips"), where("memberUids", "array-contains", "A"))));
  });
});

describe("finding trips shared with you (ADR-0020)", () => {
  test("NOBODY can search trips by invited address any more", async () => {
    // That query is gone. It could be refused for a reason the client
    // couldn't see, and it stranded a legitimate user twice. Verified or
    // not, it is now denied — discovery is the invite index below.
    await seed();
    for (const verified of [true, false]) {
      const db = as("B", "bo@x.com", verified).firestore();
      await assertFails(getDocs(
        query(collection(db, "trips"), where("invitedEmails", "array-contains", "bo@x.com"))));
    }
  });

  test("a member can still list their own trips", async () => {
    await seed();
    const db = as("A", "archi@x.com").firestore();
    await assertSucceeds(getDocs(
      query(collection(db, "trips"), where("memberUids", "array-contains", "A"))));
  });
});

describe("the invite index", () => {
  test("you read your own key — UNVERIFIED, which is the whole point", async () => {
    const db = as("B", "bo@x.com", false).firestore();
    await assertSucceeds(getDoc(doc(db, `invites/${await key("bo@x.com")}`)));
  });

  test("and nobody else's, however verified they are", async () => {
    const db = as("B", "bo@x.com", true).firestore();
    await assertFails(getDoc(doc(db, `invites/${await key("archi@x.com")}`)));
  });

  test("case and spacing don't produce a different key", async () => {
    const db = as("B", "Bo@X.com ", false).firestore();
    // The token's address is lowercased by the rules; the client
    // lowercases before hashing. They must agree or an invite exists
    // that can never be found.
    await assertSucceeds(getDoc(doc(db, `invites/${await key("bo@x.com")}`)));
  });

  test("anyone signed in may leave an invite — it grants nothing on its own", async () => {
    const k = await key("bo@x.com");
    const inviter = as("A", "archi@x.com").firestore();
    await assertSucceeds(setDoc(doc(inviter, `invites/${k}`), { trips: { t1: { name: "Goa", at: 1 } } }));
    // …and cannot read it back.
    await assertFails(getDoc(doc(inviter, `invites/${k}`)));
    // A stranger may ADD alongside what's there, but the trip itself is
    // still gated by isInvited(), so the entry buys them nothing.
    const zed = as("Z", "zed@x.com").firestore();
    await assertSucceeds(setDoc(doc(zed, `invites/${k}`),
      { trips: { t1: { name: "Goa", at: 1 }, evil: { name: "Nope", at: 1 } } }));
    await seed();
    await assertFails(getDoc(doc(zed, "trips/t1")));
  });

  test("signed out, you can neither read nor write the index", async () => {
    const db = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(db, `invites/${await key("bo@x.com")}`)));
    await assertFails(setDoc(doc(db, `invites/${await key("bo@x.com")}`), { trips: {} }));
  });
});

describe("your own user document", () => {
  test("is yours alone, both ways", async () => {
    await env.withSecurityRulesDisabled(async (ctx) => {
      await setDoc(doc(ctx.firestore(), "users/A"), { email: "archi@x.com", pushTokens: { t1: {} } });
    });
    await assertSucceeds(getDoc(doc(as("A", "archi@x.com").firestore(), "users/A")));
    // Push tokens live here. Nobody else may read them.
    await assertFails(getDoc(doc(as("B", "bo@x.com").firestore(), "users/A")));
    await assertFails(setDoc(doc(as("B", "bo@x.com").firestore(), "users/A"), { pushTokens: {} }));
  });
});

describe("the invite index cannot be emptied by a stranger", () => {
  test("a stranger may add, but never remove or hard-delete", async () => {
    // `allow write` covers delete, so the ownership check above it was
    // moot: anyone who could compute your key — i.e. anyone who knows
    // your address — could wipe every invitation waiting for you, with
    // nothing to report. ADR-0020's own nightmare.
    const k = await key("bo@x.com");
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), `invites/${k}`), { trips: { t1: { name: "Goa", at: 1 } } });
    });
    const zed = as("Z", "zed@x.com").firestore();
    await assertFails(deleteDoc(doc(zed, `invites/${k}`)));
    await assertFails(setDoc(doc(zed, `invites/${k}`), { trips: {} }));
    // Adding an invitation is still allowed — you must be able to invite
    // someone whose account you cannot read.
    await assertSucceeds(setDoc(doc(zed, `invites/${k}`),
      { trips: { t1: { name: "Goa", at: 1 }, t2: { name: "Manali", at: 2 } } }));
  });
});

describe("joining grants full write, so joining needs a verified address", () => {
  test("an UNVERIFIED invitee cannot join — and so cannot escalate", async () => {
    // joinOnly() only gated the FIRST write: the join puts you in
    // memberUids, and from the second write isMember() permits
    // everything. An unverified account on any member's address plus a
    // forwarded link could rewrite the ledger or tombstone the trip.
    await seed();
    const db = as("B", "bo@x.com", false).firestore();
    await assertSucceeds(getDoc(doc(db, "trips/t1")));           // reading is fine
    await assertFails(setDoc(doc(db, "trips/t1"), tripDoc({ memberUids: ["A", "B"] })));
  });

  test("a VERIFIED invitee joins, and only then may edit", async () => {
    await seed();
    const db = as("B", "bo@x.com", true).firestore();
    await assertSucceeds(setDoc(doc(db, "trips/t1"), tripDoc({ memberUids: ["A", "B"] })));
    await assertSucceeds(setDoc(doc(db, "trips/t1"),
      tripDoc({ memberUids: ["A", "B"], trip: { ...tripDoc().trip, name: "Goa 2026" } })));
  });

  test("the escalation is closed: no join, no destroy", async () => {
    await seed();
    const db = as("IMP", "bo@x.com", false).firestore();
    await assertFails(setDoc(doc(db, "trips/t1"), {
      schema: 1, deleted: true, deletedAt: 99,
      memberUids: ["A", "IMP"], invitedEmails: tripDoc().invitedEmails, ownerUid: "A",
    }));
  });
});

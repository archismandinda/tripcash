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
import { buildPayload, mergePayload, joinIfInvited } from "../js/sync.js";
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
    { id: "m1", name: "Asha", email: "asha@x.com", uid: "A" },
    { id: "m2", name: "Bo", email: "bo@x.com" },
  ]},
  memberUids: ["A"],
  invitedEmails: ["asha@x.com", "bo@x.com"],
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
    const db = as("A", "asha@x.com").firestore();
    await assertSucceeds(getDoc(doc(db, "trips/t1")));
    await assertSucceeds(setDoc(doc(db, "trips/t1"), tripDoc({ trip: { ...tripDoc().trip, name: "Goa 2026" } })));
  });

  test("cannot write ITSELF off the trip", async () => {
    // This test used to read "cannot evict anyone", and that blanket ban
    // is what made removal cosmetic (TC-4) — see the removal suite below.
    // The one uid a write may never drop is its own author's: the rules
    // judge a write by the document it produces, so a payload that leaves
    // its writer out is one the writer can never undo.
    await seed(tripDoc({ memberUids: ["A", "B"], ownerUid: "B" }));
    const db = as("A", "asha@x.com").firestore();
    await assertFails(setDoc(doc(db, "trips/t1"), tripDoc({ memberUids: ["B"], ownerUid: "B" })));
  });

  test("cannot hard-delete the document", async () => {
    await seed();
    await assertFails(deleteDoc(doc(as("A", "asha@x.com").firestore(), "trips/t1")));
  });
});

// Removal used to be defeated twice over: buildPayload never dropped a uid,
// and keepsEveryone() refused any write that did. Both layers had to go, and
// only these five checks say whether the access actually ended — the client
// half is unit-tested, but "can they still read the ledger?" is a question
// only the real rules can answer.
describe("removing somebody actually takes their access away (TC-4)", () => {
  // What the trip looks like AFTER the owner removes Bo: the member row
  // goes, so both derived lists lose them (ADR-0011) — the uid off
  // memberUids and the address off invitedEmails. Leaving the address on
  // would keep isInvited() true and the trip readable.
  const withoutBo = (over = {}) => tripDoc({
    trip: { ...tripDoc().trip, members: [{ id: "m1", name: "Asha", email: "asha@x.com", uid: "A" }] },
    memberUids: ["A"],
    invitedEmails: ["asha@x.com"],
    ...over,
  });

  test("a member may now drop somebody else's uid", async () => {
    await seed(tripDoc({ memberUids: ["A", "B"] }));
    const db = as("A", "asha@x.com").firestore();
    await assertSucceeds(setDoc(doc(db, "trips/t1"), withoutBo()));
  });

  test("but never the trip's owner", async () => {
    // Everyone else can be removed and re-added; the owner is the anchor
    // that makes that possible. Drop them and there is nobody the rules
    // guarantee can let anyone back in.
    await seed(tripDoc({ memberUids: ["A", "B"], ownerUid: "A" }));
    const db = as("B", "bo@x.com").firestore();
    await assertFails(setDoc(doc(db, "trips/t1"),
      tripDoc({ memberUids: ["B"], ownerUid: "A" })));
  });

  test("once removed, they can no longer READ the trip", async () => {
    await seed(withoutBo());
    await assertFails(getDoc(doc(as("B", "bo@x.com").firestore(), "trips/t1")));
  });

  test("once removed, they can no longer WRITE to it either", async () => {
    // The whole point. Until now a removed member kept `allow update`:
    // they could rewrite the ledger or tombstone the trip for everybody.
    await seed(withoutBo());
    const db = as("B", "bo@x.com").firestore();
    await assertFails(setDoc(doc(db, "trips/t1"), withoutBo({ memberUids: ["A", "B"] })));
  });

  test("and the door didn't open for anyone else on the way", async () => {
    await seed(withoutBo());
    const db = as("Z", "zed@x.com").firestore();
    await assertFails(getDoc(doc(db, "trips/t1")));
    await assertFails(setDoc(doc(db, "trips/t1"), withoutBo({ memberUids: ["A", "Z"] })));
  });
});

describe("an invitee", () => {
  test("can read the trip and join it", async () => {
    await seed();
    const db = as("B", "bo@x.com").firestore();
    await assertSucceeds(getDoc(doc(db, "trips/t1")));
    await assertSucceeds(setDoc(doc(db, "trips/t1"), tripDoc({ memberUids: ["A", "B"] })));
  });

  // joinOnly() demands `tombstones` come back byte for byte, and the
  // client does not hand the fetched document straight to setDoc: it runs
  // it through joinIfInvited AND mergePayload, exactly as syncTrip does.
  // So any field mergePayload ADDS to the tombstone map is a field the
  // joiner is now changing — and every trip document in the cloud today
  // was written before member graves existed. The failure would be a
  // permission-denied on the phone of somebody accepting an invitation,
  // during the one launch the two builds coexist, with nothing on screen
  // to say why.
  test("…through the real client path, against a document written before member graves", async () => {
    await seed(); // tombstones: { expenses: {}, settlements: {} } — today's shape
    const ctx = as("B", "bo@x.com");
    const db = ctx.firestore();
    const remote = (await getDoc(doc(db, "trips/t1"))).data();
    const merged = mergePayload(
      joinIfInvited(remote, { uid: "B", email: "bo@x.com" }), remote, Date.now(),
      { writer: "B" },
    );
    assert.deepEqual(merged.tombstones, remote.tombstones,
      "a join must not rewrite the tombstone map — the rules pin it");
    await assertSucceeds(setDoc(doc(db, "trips/t1"), merged));
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
    const db = as("A", "asha@x.com").firestore();
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
    await assertFails(getDoc(doc(db, `invites/${await key("asha@x.com")}`)));
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
    const inviter = as("A", "asha@x.com").firestore();
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
      await setDoc(doc(ctx.firestore(), "users/A"), { email: "asha@x.com", pushTokens: { t1: {} } });
    });
    await assertSucceeds(getDoc(doc(as("A", "asha@x.com").firestore(), "users/A")));
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

// The rules are not the whole story. They ACCEPT the eviction below —
// the owner is kept, the author is kept — so the only thing standing
// between a joined member and permanent lockout is what the client
// derives. This runs the real buildPayload/mergePayload through the real
// rules, which is the only way to see that (TC-4).
describe("a co-member's offline edit cannot evict a joined member (TC-4)", () => {
  const members = (boUid) => [
    { id: "m1", name: "Asha", email: "asha@x.com", uid: "A" },
    { id: "m2", name: "Bo", email: "bo@x.com", ...(boUid ? { uid: boUid } : {}) },
  ];
  const build = (trip, uid) =>
    buildPayload({ trip, expenses: [], settlements: [], tombstones: {}, uid });

  test("the whole two-device walkthrough", async () => {
    // 1–2. Bo joins and joinTrip claims his member row, so the cloud
    //      document carries members[m2].uid = "B".
    const cloud = build(
      { id: "t1", name: "Goa", currencies: ["INR"], updatedAt: 2000, ownerUid: "A", members: members("B") },
      "B",
    );
    assert.deepEqual(cloud.memberUids.sort(), ["A", "B"]);
    await seed(cloud);

    // 3. Asha's phone was offline through all of that. His copy of Bo's
    //    row still has no uid. He renames the trip, so his record stamps
    //    newer, and syncs.
    const stale = build(
      { id: "t1", name: "Goa trip", currencies: ["INR"], updatedAt: 3000, ownerUid: "A", members: members(null) },
      "A",
    );
    const merged = mergePayload(stale, cloud);
    assert.equal(merged.trip.name, "Goa trip", "his rename is a real edit and still wins");
    assert.deepEqual(merged.memberUids.sort(), ["A", "B"], "but it takes nobody's access");

    // 4. The rules would have taken the eviction. Nothing there saves Bo.
    const owner = as("A", "asha@x.com").firestore();
    await assertSucceeds(setDoc(doc(owner, "trips/t1"), merged));

    // 5. Bo still reads, still writes, and his live-update query still
    //    finds the trip — which is what actually stops arriving.
    const bo = as("B", "bo@x.com").firestore();
    await assertSucceeds(getDoc(doc(bo, "trips/t1")));
    const mine = await getDocs(query(collection(bo, "trips"), where("memberUids", "array-contains", "B")));
    assert.equal(mine.size, 1, "his live updates keep arriving");
    await assertSucceeds(setDoc(doc(bo, "trips/t1"),
      mergePayload(build({ ...merged.trip, updatedAt: 4000 }, "B"), merged)));
  });
});

// A trip whose document predates ownerUid. keepsOwner() short-circuited to
// TRUE whenever the STORED document had no owner, so anybody on such a trip
// could name themselves owner in one ordinary background push — and, being
// pinned by the very rule that was supposed to protect the creator, then
// evict the creator with a second one. Sprint 1 shipped "the trip owner
// cannot be removed by anyone else"; on every pre-ownerUid trip that rule
// was protecting whoever synced first. ADR-0023.
describe("a trip too old to have an owner (TC2-3)", () => {
  const legacyMembers = [
    { id: "m1", name: "Asha", email: "asha@x.com", uid: "A" },
    { id: "m2", name: "Bo", email: "bo@x.com", uid: "B" },
  ];
  // Deliberately built field by field rather than from tripDoc(): the
  // point of the document is the field it does NOT have.
  const legacy = (over = {}) => ({
    schema: 1,
    trip: { id: "L1", name: "Goa", currencies: ["INR"], updatedAt: 1, members: legacyMembers },
    memberUids: ["A", "B"],
    invitedEmails: ["asha@x.com", "bo@x.com"],
    expenses: [], settlements: [], tombstones: { expenses: {}, settlements: {} },
    lastEditBy: "A",
    ...over,
  });

  const seedLegacy = (data = legacy()) => env.withSecurityRulesDisabled(async (ctx) => {
    await setDoc(doc(ctx.firestore(), "trips/L1"), data);
  });

  test("nobody can name themselves owner of it — not even its creator", async () => {
    await seedLegacy();
    // Step one of the seizure, and the only step that ever mattered: this
    // SUCCEEDED before TC2-3, which made every later step ordinary.
    const bo = as("B", "bo@x.com").firestore();
    await assertFails(setDoc(doc(bo, "trips/L1"), legacy({ ownerUid: "B", lastEditBy: "B" })));
    // And symmetrically. It is tempting to let the creator claim what is
    // morally theirs, but nothing in the document says who that is — the
    // rules cannot tell Asha from Bo here, which is the whole reason
    // ownership cannot be inferred (ADR-0023).
    const asha = as("A", "asha@x.com").firestore();
    await assertFails(setDoc(doc(asha, "trips/L1"), legacy({ ownerUid: "A" })));
    // So the document is still ownerless, and still readable by both.
    await assertSucceeds(getDoc(doc(asha, "trips/L1")));
    await assertSucceeds(getDoc(doc(bo, "trips/L1")));
  });

  test("so removal stays symmetric — nobody on it is pinned", async () => {
    await seedLegacy();
    const bo = as("B", "bo@x.com").firestore();
    // The seizure is refused (above), so Bo is an ordinary member. He can
    // still remove Asha — members may remove each other, that is TC-4 and
    // it has not changed — but the trip is symmetric now: Asha can do
    // exactly the same to him, and no rule pins either of them.
    await assertSucceeds(setDoc(doc(bo, "trips/L1"), legacy({
      trip: { id: "L1", name: "Goa", currencies: ["INR"], updatedAt: 2, members: [legacyMembers[1]] },
      memberUids: ["B"], invitedEmails: ["bo@x.com"], lastEditBy: "B",
    })));
    await assertFails(getDoc(doc(as("A", "asha@x.com").firestore(), "trips/L1")));
    // The reverse, from the same starting point.
    await seedLegacy();
    const asha = as("A", "asha@x.com").firestore();
    await assertSucceeds(setDoc(doc(asha, "trips/L1"), legacy({
      trip: { id: "L1", name: "Goa", currencies: ["INR"], updatedAt: 2, members: [legacyMembers[0]] },
      memberUids: ["A"], invitedEmails: ["asha@x.com"],
    })));
    await assertFails(getDoc(doc(bo, "trips/L1")));
  });

  test("and it stays an ordinary, usable trip", async () => {
    // The blunt answer to a trip that predates ownership is that it stays
    // ownerless for ever. That must cost its members nothing: renaming,
    // spending and removing all still work. removability() in js/roster.js
    // is already gated on a known ownerUid, so the app promises nothing
    // here it cannot keep.
    await seedLegacy();
    const bo = as("B", "bo@x.com").firestore();
    await assertSucceeds(setDoc(doc(bo, "trips/L1"), legacy({
      trip: { id: "L1", name: "Goa 2026", currencies: ["INR"], updatedAt: 3, members: legacyMembers },
      expenses: [{ id: "e1", name: "Ferry", homeValue: 400, updatedAt: 3 }],
      lastEditBy: "B",
    })));
    // …and a stranger is no better off than before.
    const zed = as("Z", "zed@x.com").firestore();
    await assertFails(getDoc(doc(zed, "trips/L1")));
    await assertFails(setDoc(doc(zed, "trips/L1"), legacy({ memberUids: ["A", "B", "Z"] })));
  });

  test("a new trip may only be created with YOURSELF as its owner", async () => {
    // The other half of the pin. Making ownerUid immutable on update is
    // worth nothing if the document can simply be created naming somebody
    // else — every trip a device uploads would otherwise be an
    // opportunity to hand ownership to an account of its choosing.
    const bo = as("B", "bo@x.com").firestore();
    await assertFails(setDoc(doc(bo, "trips/new1"), legacy({ ownerUid: "A" })));
    await assertSucceeds(setDoc(doc(bo, "trips/new2"), legacy({ ownerUid: "B" })));
    // Creating one with no owner at all is still allowed: that is what a
    // client too old to know about ownership does, and refusing it would
    // break a device we would rather keep working.
    await assertSucceeds(setDoc(doc(bo, "trips/new3"), legacy()));
  });
});

describe("the funnel counters", () => {
  test("nobody can read or write them from a client", async () => {
    // Written only by the Cloud Function through the admin SDK, which
    // bypasses rules. There is nothing per-person in there, but a
    // readable funnel is still nobody else's business.
    await env.withSecurityRulesDisabled(async (c) => {
      await setDoc(doc(c.firestore(), "stats/2026-08-10"), { joined: 3 });
    });
    const db = as("A", "asha@x.com").firestore();
    await assertFails(getDoc(doc(db, "stats/2026-08-10")));
    await assertFails(setDoc(doc(db, "stats/2026-08-10"), { joined: 9999 }));
    const out = env.unauthenticatedContext().firestore();
    await assertFails(getDoc(doc(out, "stats/2026-08-10")));
    await assertFails(setDoc(doc(out, "stats/2026-08-10"), { joined: 9999 }));
  });
});

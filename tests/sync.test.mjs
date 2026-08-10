import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPayload, mergePayload, payloadChanged, applyPayload, joinIfInvited,
  tombstonePayload, isDeleted, SCHEMA } from "../js/sync.js";
import { tripTombstones, TOMBSTONE_TTL_MS } from "../js/merge.js";

const trip = (over = {}) => ({ id: "t1", name: "Bali", currencies: ["IDR"], updatedAt: 100, ...over });
const exp = (id, updatedAt, over = {}) => ({ id, tripId: "t1", name: id, homeValue: 100, updatedAt, ...over });
const pay = (over = {}) => ({
  schema: SCHEMA, trip: trip(), memberUids: ["u1"], ownerUid: "u1",
  expenses: [], settlements: [], tombstones: { expenses: {}, settlements: {} }, ...over,
});
const ids = (list) => list.map((r) => r.id).sort();

// ---------- building what we upload ----------

test("the converter's in-progress amount never leaves the device", () => {
  const p = buildPayload({
    trip: trip({ lastEdit: { code: "IDR", amount: 450000 } }),
    expenses: [], settlements: [], tombstones: {}, uid: "u1",
  });
  assert.equal(p.trip.lastEdit, undefined);
  assert.equal(p.trip.name, "Bali");
});

test("signing in puts you on the trip's access list", () => {
  const p = buildPayload({ trip: trip(), expenses: [], settlements: [], tombstones: {}, uid: "u1" });
  assert.deepEqual(p.memberUids, ["u1"]);
  // This test used to assert `p.ownerUid === "u1"` as well, and that
  // assertion encoded the defect TC2-3 exists to remove: it said a push
  // may appoint its own author owner. See the next test for what that
  // cost and where minting moved to (ADR-0023). It is replaced, not
  // dropped — ownership is now pinned to null here and proved elsewhere.
  assert.equal(p.ownerUid, null);
  // and doesn't duplicate you on the next run
  const again = buildPayload({ trip: { ...trip(), memberUids: ["u1"] }, expenses: [], settlements: [], tombstones: {}, uid: "u1" });
  assert.deepEqual(again.memberUids, ["u1"]);
});

test("a push never appoints an owner — it has not read the document yet", () => {
  // buildPayload used to default ownerUid to whoever was pushing. On a
  // trip whose stored document has no ownerUid, keepsOwner() waved that
  // through, so the first device to sync became the PINNED, unremovable
  // owner of somebody else's trip — and could then evict the person who
  // created it, with two ordinary background writes and nothing on
  // screen. Sprint 1's "the owner cannot be removed" was protecting the
  // wrong person on every such trip.
  //
  // buildPayload runs before the transaction reads the document. It
  // cannot tell "this trip has no owner" from "I have not looked", and a
  // guess between those two is exactly the seizure. So it never guesses.
  const p = buildPayload({
    trip: { id: "t1", members: [] }, expenses: [], settlements: [], tombstones: {}, uid: "U",
  });
  assert.equal(p.ownerUid, null);
  // The writer is still on the access list: the rules judge a write by
  // the document it produces, so a payload missing its own author is a
  // payload nobody could ever have sent.
  assert.deepEqual(p.memberUids, ["U"]);
});

test("the FIRST upload of a trip is the one place an owner can be minted", () => {
  // remote === null is the only moment anything can PROVE no owner
  // exists: there is no document. Everywhere else "it has no owner" is
  // only ever "I have not read one".
  const local = pay({ ownerUid: null, lastEditBy: "U" });
  assert.equal(mergePayload(local, null).ownerUid, "U");
  // The joiner is passed explicitly, because joinOnly() in
  // firestore.rules refuses a write that restamps lastEditBy — the same
  // reason `writer` exists at all.
  assert.equal(
    mergePayload({ ...local, lastEditBy: null }, null, Date.now(), { writer: "J" }).ownerUid, "J");
  // An owner the record already carries is never overwritten.
  assert.equal(mergePayload({ ...local, ownerUid: "A" }, null).ownerUid, "A");
});

test("a trip already in the cloud without an owner stays without one", () => {
  // The blunt half of ADR-0023. The rules now pin ownerUid on every
  // update, so any value other than the stored one is refused — and here
  // the stored one is nothing. Inventing one would either be refused for
  // ever (a trip that can never sync again) or, under the old rules, be
  // the seizure itself.
  const remote = { ...pay(), ownerUid: undefined };
  assert.equal(mergePayload(pay({ ownerUid: null, lastEditBy: "U" }), remote).ownerUid, null);
  // …including when THIS device's own trip record still carries a stale
  // claim written by the version that minted owners locally. The stored
  // document is the authority on who owns it; nothing local outranks it.
  assert.equal(mergePayload(pay({ ownerUid: "U", lastEditBy: "U" }), remote).ownerUid, null);
});

// ---------- merging against the server ----------

test("a trip the server has never seen uploads as-is", () => {
  const local = pay({ expenses: [exp("e1", 5)] });
  const merged = mergePayload(local, null);
  assert.deepEqual(ids(merged.expenses), ["e1"]);
});

test("the newer version of the trip's own details wins", () => {
  const local = pay({ trip: trip({ name: "Bali", updatedAt: 100 }) });
  const remote = pay({ trip: trip({ name: "Bali 2026", updatedAt: 200 }) });
  assert.equal(mergePayload(local, remote).trip.name, "Bali 2026");
  assert.equal(mergePayload(remote, local).trip.name, "Bali 2026");
});

test("expenses added on two phones both survive", () => {
  const local = pay({ expenses: [exp("mine", 10)] });
  const remote = pay({ expenses: [exp("theirs", 20)] });
  assert.deepEqual(ids(mergePayload(local, remote).expenses), ["mine", "theirs"]);
});

test("an expense deleted on one phone does not come back from the server", () => {
  const local = pay({ expenses: [], tombstones: { expenses: { e1: 500 }, settlements: {} } });
  const remote = pay({ expenses: [exp("e1", 100)] });
  // Stamps in this file are a toy clock starting at zero, so `now` has to
  // come from the same clock or the 90-day prune calls them all ancient.
  const merged = mergePayload(local, remote, 1000);
  assert.deepEqual(merged.expenses, []);
  assert.equal(merged.tombstones.expenses.e1, 500, "the tombstone rides along for other devices");
});

test("an expense edited after a delete is genuinely restored", () => {
  const local = pay({ expenses: [], tombstones: { expenses: { e1: 100 }, settlements: {} } });
  const remote = pay({ expenses: [exp("e1", 300, { name: "revived" })] });
  const merged = mergePayload(local, remote);
  assert.equal(merged.expenses.length, 1);
  assert.equal(merged.expenses[0].name, "revived");
});

test("settlements merge on the same rules as expenses", () => {
  const local = pay({ settlements: [{ id: "s1", updatedAt: 10, amount: 500 }] });
  const remote = pay({ settlements: [{ id: "s1", updatedAt: 90, amount: 900 }, { id: "s2", updatedAt: 5 }] });
  const merged = mergePayload(local, remote);
  assert.equal(merged.settlements.find((s) => s.id === "s1").amount, 900);
  assert.deepEqual(ids(merged.settlements), ["s1", "s2"]);
});

test("somebody who is still on the trip is never dropped by a merge", () => {
  // This test USED to assert the opposite conclusion — "access lists only
  // ever grow" — and that growth is what made removal cosmetic (TC-4):
  // the uid could not be dropped, so the person kept full write on the
  // ledger and kept getting notified. Access now tracks the member list,
  // exactly as invitedEmails already did. What must still hold is that
  // somebody who IS a member survives whichever side the merge starts
  // from.
  const members = [{ id: "m1", uid: "u1" }, { id: "m2", uid: "u2" }];
  const local = pay({ trip: trip({ members }), memberUids: ["u1"] });
  const remote = pay({ trip: trip({ members }), memberUids: ["u1", "u2"] });
  assert.deepEqual(mergePayload(local, remote).memberUids.sort(), ["u1", "u2"]);
  assert.deepEqual(mergePayload(remote, local).memberUids.sort(), ["u1", "u2"]);
});

// ---------- removing somebody actually removes them (TC-4) ----------

test("a uid with no member row is not carried forward", () => {
  // Removal was cosmetic: buildPayload unioned the trip's existing
  // memberUids into every push, so a uid that had once been on the list
  // could never leave it. The person stayed readable, writable and
  // notifiable for ever, and there was nothing the owner could do about
  // it from the app.
  const p = buildPayload({
    trip: { members: [{ id: "m1", uid: "u1" }], memberUids: ["u1", "u2"] },
    expenses: [], settlements: [], tombstones: {}, uid: "u1",
  });
  assert.deepEqual(p.memberUids, ["u1"], "u2 has no member row, so u2 has no access");
});

test("a push can never lock out its own author or the trip's owner", () => {
  // Two uids are not the roster's to drop. The rules refuse a write whose
  // author isn't on the new list, so a payload missing its writer is a
  // payload that can never be sent; and a trip that loses its owner has
  // nobody left who is guaranteed to be able to let anyone back in.
  const p = buildPayload({
    trip: { members: [{ id: "m1", uid: "u1" }], memberUids: ["u1"], ownerUid: "u1" },
    expenses: [], settlements: [], tombstones: {}, uid: "u9",
  });
  assert.deepEqual(p.memberUids.sort(), ["u1", "u9"]);
  assert.equal(p.ownerUid, "u1");
});

test("a removal made here wins, and it is the grave that carries it", () => {
  // This test used to express the removal as a bare missing row, and to
  // assert that winning the trip record's stamp was what made it stick.
  // Both halves are corrected, not weakened: the removal still removes
  // (same assertions), but ADR-0024 established that an absent row is
  // evidence of nothing — the same bytes as "this device has not heard".
  // The evidence is the grave, and it works whichever record wins.
  const removed = [{ id: "m1", uid: "u1" }];
  const both = [{ id: "m1", uid: "u1" }, { id: "m2", uid: "u2" }];
  const grave = { expenses: {}, settlements: {}, members: { m2: 800 } };
  const local = pay({ trip: trip({ updatedAt: 900, members: removed }),
    memberUids: ["u1"], tombstones: grave });
  const remote = pay({ trip: trip({ updatedAt: 100, members: both }), memberUids: ["u1", "u2"] });
  const merged = mergePayload(local, remote);
  assert.equal(merged.trip.updatedAt, 900, "the local trip record is the winner");
  assert.deepEqual(merged.memberUids, ["u1"], "and the roster decides who has access");

  // …and it no longer depends on winning: the same removal against a
  // remote record that wins the stamp is still a removal.
  const losing = mergePayload(
    pay({ trip: trip({ updatedAt: 100, members: removed }), memberUids: ["u1"], tombstones: grave }),
    pay({ trip: trip({ updatedAt: 900, members: both }), memberUids: ["u1", "u2"] }),
  );
  assert.deepEqual(losing.memberUids, ["u1"], "which is the whole point of ADR-0024");
});

test("…and the remote list survives intact when the remote trip record wins", () => {
  // The mirror image, and the reason the derivation reads the WINNER
  // rather than the local side: a device whose members list is stale must
  // not be able to evict people by losing the merge.
  const stale = [{ id: "m1", uid: "u1" }];
  const both = [{ id: "m1", uid: "u1" }, { id: "m2", uid: "u2" }];
  const local = pay({ trip: trip({ updatedAt: 100, members: stale }), memberUids: ["u1"] });
  const remote = pay({ trip: trip({ updatedAt: 900, members: both }), memberUids: ["u1", "u2"] });
  const merged = mergePayload(local, remote);
  assert.equal(merged.trip.updatedAt, 900, "the remote trip record is the winner");
  assert.deepEqual(merged.memberUids.sort(), ["u1", "u2"]);
});

test("a stale copy of a joined member's row cannot evict them", () => {
  // The hole ADR-0022's "reduced to the gap between two consecutive
  // writes" missed: the row was ALREADY claimed and it still happens.
  //
  // Bo joined; joinTrip claimed his member row, so the cloud document has
  // members[m2].uid = "B". Asha's phone was offline and never pulled that
  // join — his copy of Bo's row still has no uid — and then he renamed the
  // trip, so HIS trip record is the newer one. Deriving access from the
  // winner alone drops Bo, and permanently: the rules accept that write
  // (owner kept, writer kept), every push of Bo's is refused afterwards,
  // and because his address is still on invitedEmails he can STILL read
  // the document — so evictionFrom() concludes "not evicted" and he gets
  // the generic "the database turned this down" for ever, on a trip
  // nobody removed him from. Asha's device cannot re-learn the uid
  // either, because its own record keeps winning.
  //
  // A missing uid on a row that is still there is not a removal. It is
  // out-of-date news about somebody whose row is right in front of you.
  const stale = [{ id: "m1", uid: "A", email: "asha@x.com" },
    { id: "m2", email: "bo@x.com" }];
  const joined = [{ id: "m1", uid: "A", email: "asha@x.com" },
    { id: "m2", uid: "B", email: "bo@x.com" }];
  const local = pay({
    trip: trip({ updatedAt: 3000, name: "Goa trip", members: stale }),
    memberUids: ["A"], ownerUid: "A", lastEditBy: "A",
  });
  const remote = pay({
    trip: trip({ updatedAt: 2000, name: "Goa", members: joined }),
    memberUids: ["A", "B"], ownerUid: "A", lastEditBy: "B",
  });

  const merged = mergePayload(local, remote);
  assert.equal(merged.trip.name, "Goa trip", "the rename still wins — this is not about the edit");
  assert.deepEqual(merged.memberUids.sort(), ["A", "B"],
    "a member who never left must not be evicted by a co-member's offline edit");
  assert.equal(merged.trip.members.find((m) => m.id === "m2").uid, "B",
    "and the winning record re-learns the claim, or the very next push evicts him again");

  // Whichever side syncs first, and however many times.
  const other = mergePayload(remote, local);
  assert.deepEqual(other.memberUids.sort(), ["A", "B"]);
  assert.deepEqual(mergePayload(merged, merged).memberUids.sort(), ["A", "B"]);
});

test("a removed member is still removed, even holding a claim we've seen", () => {
  // The line the fix above must not cross. A claim is folded onto a row
  // that is still there; it is not a way back for one that is buried.
  // (The removal is a grave now — see the note on the removal test above.)
  const removed = [{ id: "m1", uid: "u1" }];
  const both = [{ id: "m1", uid: "u1" }, { id: "m2", uid: "u2" }];
  const local = pay({ trip: trip({ updatedAt: 900, members: removed }), memberUids: ["u1"],
    tombstones: { expenses: {}, settlements: {}, members: { m2: 800 } } });
  const remote = pay({ trip: trip({ updatedAt: 100, members: both }), memberUids: ["u1", "u2"] });
  const merged = mergePayload(local, remote);
  assert.deepEqual(merged.memberUids, ["u1"]);
  assert.deepEqual(merged.trip.members, removed, "and the row is not resurrected either");
});

test("the owner and the writer survive the merge too, member row or not", () => {
  const local = pay({
    trip: trip({ updatedAt: 900, members: [{ id: "m1", uid: "u1" }] }),
    memberUids: ["u1"], ownerUid: "owner", lastEditBy: "writer",
  });
  const merged = mergePayload(local, pay({ ownerUid: "owner" }));
  assert.deepEqual(merged.memberUids.sort(), ["owner", "u1", "writer"]);
});

test("both phones converge on the same trip regardless of who syncs first", () => {
  const a = pay({ trip: trip({ name: "A", updatedAt: 300 }), expenses: [exp("e1", 300, { name: "A wins" }), exp("e2", 10)] });
  const b = pay({ trip: trip({ name: "B", updatedAt: 200 }), expenses: [exp("e1", 200, { name: "B loses" }), exp("e3", 10)] });
  const ab = mergePayload(a, b);
  const ba = mergePayload(b, a);
  assert.deepEqual(ids(ab.expenses), ids(ba.expenses));
  assert.equal(ab.trip.name, ba.trip.name);
  assert.equal(ab.expenses.find((e) => e.id === "e1").name, "A wins");
});

// ---------- avoiding pointless writes ----------

test("an unchanged trip costs no write", () => {
  const remote = pay({ expenses: [exp("e1", 5)] });
  const merged = mergePayload(pay({ expenses: [exp("e1", 5)] }), remote);
  assert.equal(payloadChanged(merged, remote), false);
});

test("any real difference does earn a write", () => {
  const remote = pay({ expenses: [exp("e1", 5)] });
  assert.equal(payloadChanged(mergePayload(pay({ expenses: [exp("e1", 5), exp("e2", 9)] }), remote), remote), true);
  assert.equal(payloadChanged(pay(), null), true, "first upload always writes");
});

// Member order is per-device state, deliberately: mergeRoster keeps the
// LOCAL order and appends the rows only the remote had, exactly as trips
// and expenses do. So two phones that each learned about somebody in a
// different order hold the same roster in a different sequence, for ever,
// and neither is wrong. What must not happen is that difference reading as
// news: expenses and settlements are id-sorted before the comparison for
// precisely this reason, and the roster was made a collection without
// being added to the same list.
test("the order members are listed in is per-device, so it earns no write", () => {
  const asha = { id: "m-asha", uid: "u1", name: "Asha" };
  const bo = { id: "m-bo", uid: "u2", name: "Bo" };
  // Both sides go through buildPayload, so the derived access lists match
  // and the ONLY difference left between the two payloads is the sequence.
  const upload = (members) => buildPayload({
    trip: trip({ ownerUid: "u1", members }), expenses: [], settlements: [],
    tombstones: {}, uid: "u1",
  });
  const remote = mergePayload(upload([asha, bo]), null);
  const merged = mergePayload(upload([bo, asha]), remote);
  assert.deepEqual(merged.trip.members.map((m) => m.id), ["m-bo", "m-asha"],
    "the merge keeps this device's order — that part is intended");
  assert.equal(payloadChanged(merged, remote), false,
    "…but a different order is not a change worth a write");
});

// The failure the line above prevents, driven end to end through the real
// device loop: build → merge → push-if-changed → apply, on two phones.
//
// How a person gets here without ever going offline: this phone holds
// [Asha, Bo]; the other adds Priya, which arrives by live snapshot; this
// phone adds Rahul and saves, so mergeEditedMembers hands back
// [Asha, Bo, Rahul, Priya] while the other phone holds
// [Asha, Bo, Priya, Rahul]. Two people adding somebody to a shared trip
// between syncs is the ordinary case the roster merge exists to serve.
//
// With order counted as a difference both devices push every cycle, each
// push wakes the other's snapshot, and app.js pushes back — the ~3,000
// writes an hour against a 50k/day free tier that v1.57 already fixed
// once, plus a change notification to everybody on a trip nobody is
// editing.
test("two phones that each added somebody stop writing once they agree", () => {
  const asha = { id: "m-asha", uid: "u1", name: "Asha" };
  const bo = { id: "m-bo", uid: "u2", name: "Bo" };
  const priya = { id: "m-priya", uid: "u3", name: "Priya" };
  const rahul = { id: "m-rahul", uid: "u4", name: "Rahul" };

  const phone = (uid, members) => ({
    uid, trips: [trip({ ownerUid: "u1", members })], expenses: [], settlements: [], tombstones: {},
  });
  const one = phone("u1", [asha, bo, rahul, priya]);
  const two = phone("u2", [asha, bo, priya, rahul]);
  const build = (d) => buildPayload({
    trip: d.trips[0], expenses: d.expenses, settlements: d.settlements,
    tombstones: d.tombstones, uid: d.uid,
  });

  let cloud = mergePayload(build(one), null, NOW, { writer: one.uid });
  let writes = 1;
  for (let round = 1; round <= 5; round++) {
    for (const d of [two, one]) {
      const merged = mergePayload(build(d), cloud, NOW, { writer: d.uid });
      if (payloadChanged(merged, cloud)) { cloud = merged; writes += 1; }
      Object.assign(d, applyPayload({
        merged, tripId: "t1", trips: d.trips, expenses: d.expenses,
        settlements: d.settlements, tombstones: d.tombstones,
      }));
    }
    assert.ok(writes <= 2, `round ${round}: ${writes} writes — the phones are bouncing the trip`);
  }
  // Both still hold everybody; only the sequence differs, and that is fine.
  for (const d of [one, two]) {
    assert.deepEqual(d.trips[0].members.map((m) => m.id).sort(),
      ["m-asha", "m-bo", "m-priya", "m-rahul"]);
  }
});

// ---------- folding the result back into local storage ----------

test("merged data replaces this trip's records and leaves other trips alone", () => {
  const merged = mergePayload(pay({ expenses: [exp("e1", 5)] }), null);
  const out = applyPayload({
    merged, tripId: "t1",
    trips: [trip(), { id: "t2", name: "Prague" }],
    expenses: [exp("old", 1), { id: "other", tripId: "t2", updatedAt: 1 }],
    settlements: [{ id: "s-other", tripId: "t2", updatedAt: 1 }],
    tombstones: {},
  });
  assert.deepEqual(ids(out.expenses), ["e1", "other"], "t1 replaced, t2 untouched");
  assert.deepEqual(ids(out.settlements), ["s-other"]);
  assert.equal(out.trips.length, 2);
});

test("a trip shared from another device appears locally", () => {
  const merged = mergePayload(pay({ trip: trip({ id: "t9", name: "Shared" }) }), null);
  const out = applyPayload({
    merged, tripId: "t9", trips: [], expenses: [], settlements: [], tombstones: {},
  });
  assert.equal(out.trips.length, 1);
  assert.equal(out.trips[0].id, "t9");
  assert.equal(out.trips[0].name, "Shared");
});

test("syncing doesn't wipe the amount you're mid-way through typing", () => {
  const merged = mergePayload(pay(), null);
  const out = applyPayload({
    merged, tripId: "t1",
    trips: [trip({ lastEdit: { code: "IDR", amount: 450000 } })],
    expenses: [], settlements: [], tombstones: {},
  });
  assert.deepEqual(out.trips[0].lastEdit, { code: "IDR", amount: 450000 });
});

test("incoming records are stamped with the trip they belong to", () => {
  const merged = mergePayload(pay({ expenses: [{ id: "e1", updatedAt: 5 }] }), null);
  const out = applyPayload({ merged, tripId: "t1", trips: [trip()], expenses: [], settlements: [], tombstones: {} });
  assert.equal(out.expenses[0].tripId, "t1");
});

test("tombstones from the server are kept locally so the delete sticks here too", () => {
  const merged = mergePayload(
    pay(),
    pay({ expenses: [], tombstones: { expenses: { gone: 900 }, settlements: {} } }),
    1000 // the toy clock again — see the note above
  );
  const out = applyPayload({ merged, tripId: "t1", trips: [trip()], expenses: [], settlements: [], tombstones: { expenses: { older: 1 } } });
  assert.equal(out.tombstones.expenses.gone, 900);
  assert.equal(out.tombstones.expenses.older, 1, "existing tombstones survive");
});

// ---------- invites (phase D3.4) ----------

test("the access lists are derived from the trip's members", () => {
  // One list of people, not a members list and a separate invite list
  // that can drift apart (ADR-0011).
  const p = buildPayload({
    trip: { ...trip(), members: [
      { id: "me", name: "Asha", email: "  Asha@Example.COM ", uid: "u1" },
      { id: "p1", name: "Priya", email: "priya@example.com" },
      { id: "r1", name: "Rahul" },
    ] },
    expenses: [], settlements: [], tombstones: {}, uid: "u1",
  });
  assert.deepEqual(p.invitedEmails.sort(), ["asha@example.com", "priya@example.com"]);
  assert.deepEqual(p.memberUids, ["u1"], "a name-only member grants nobody access");
});

test("the invite list tracks the members it was derived from", () => {
  // It used to be a growing union of both sides. That could never be
  // corrected: fix a typo'd address and the typo stayed on the list, so
  // the wrong person kept the right to join — and boot turned every
  // stale address back into a member on the next launch (v1.44).
  //
  // memberUids stays a union; access already granted must not be yanked
  // from someone whose phone hasn't synced. An INVITE is different: it
  // is an intention, and intentions get changed.
  const withInvite = pay({ trip: trip({ members: [
    { id: "m1", name: "Me" }, { id: "m2", name: "Bo", email: "bo@x.com" },
  ] }) });
  const corrected = pay({ trip: trip({ updatedAt: 900, members: [
    { id: "m1", name: "Me" }, { id: "m2", name: "Bo", email: "bo@example.com" },
  ] }) });
  const merged = mergePayload(corrected, withInvite);
  assert.deepEqual(merged.invitedEmails, ["bo@example.com"], "the typo is gone");
});

test("accepting an invite adds you to the trip without removing anyone", () => {
  const invited = pay({ memberUids: ["u1"], invitedEmails: ["friend@x.com"] });
  const joined = joinIfInvited(invited, { uid: "u2", email: "Friend@X.com" });
  assert.deepEqual(joined.memberUids.sort(), ["u1", "u2"]);
  assert.deepEqual(joined.invitedEmails, ["friend@x.com"], "the invite list is left intact");
});

test("you can't join a trip you were never invited to", () => {
  const other = pay({ memberUids: ["u1"], invitedEmails: ["someone-else@x.com"] });
  assert.deepEqual(joinIfInvited(other, { uid: "u2", email: "me@x.com" }), other);
  // and with no invite list at all
  assert.deepEqual(joinIfInvited(pay(), { uid: "u2", email: "me@x.com" }), pay());
});

test("joining twice is a no-op", () => {
  const p = pay({ memberUids: ["u1", "u2"], invitedEmails: ["friend@x.com"] });
  assert.deepEqual(joinIfInvited(p, { uid: "u2", email: "friend@x.com" }), p);
});

test("a missing uid or email can't accidentally join anything", () => {
  const p = pay({ invitedEmails: ["friend@x.com"] });
  assert.deepEqual(joinIfInvited(p, { uid: null, email: "friend@x.com" }), p);
  assert.deepEqual(joinIfInvited(p, { uid: "u2", email: null }), p);
  assert.deepEqual(joinIfInvited(p, { uid: "u2", email: "" }), p);
});

test("the derived invite list is NOT written onto the local trip record", () => {
  // It is rebuilt from members on every upload, so a local copy is dead
  // weight — and it was worse than dead. The field reappearing on the
  // record made boot's one-time invite migration fire on EVERY launch,
  // restamping every trip, so merely opening the app out-ranked a real
  // edit made on the other phone (ADR-0017).
  const merged = mergePayload(pay({ invitedEmails: ["friend@x.com"] }), null);
  const out = applyPayload({ merged, tripId: "t1", trips: [trip()], expenses: [], settlements: [], tombstones: {} });
  assert.equal("invitedEmails" in out.trips[0], false);
  assert.deepEqual(out.trips[0].memberUids, ["u1"], "access still persists — buildPayload feeds on it");
});

test("inviting someone counts as worth a write", () => {
  const remote = pay({ invitedEmails: [] });
  const merged = mergePayload(pay({ trip: trip({ updatedAt: 900, members: [
    { id: "m1", name: "New", email: "new@x.com" },
  ] }) }), remote);
  assert.deepEqual(merged.invitedEmails, ["new@x.com"]);
  assert.equal(payloadChanged(merged, remote), true);
});

// ---------- deleting a trip (v1.37) ----------

test("a deleted trip is marked, not removed, so the delete can travel", () => {
  // A missing document is indistinguishable from one this device hasn't
  // seen yet — the other phone would "helpfully" recreate it.
  const t = tombstonePayload(pay({ memberUids: ["u1", "u2"] }), 500);
  assert.equal(t.deleted, true);
  assert.equal(t.deletedAt, 500);
  assert.deepEqual(t.memberUids, ["u1", "u2"], "access must survive or the rules reject the write");
  assert.equal(t.expenses, undefined, "the contents go");
  assert.ok(isDeleted(t));
  assert.ok(!isDeleted(pay()));
});

test("a delete from another device wins over the copy we still hold", () => {
  const local = pay({ trip: trip({ updatedAt: 100 }), expenses: [exp("e1", 50)] });
  const remote = tombstonePayload(pay(), 500);
  const merged = mergePayload(local, remote);
  assert.ok(isDeleted(merged), "our stale copy must not resurrect it");
  assert.equal(merged.deletedAt, 500);
});

test("deleting a trip is final — a later stamp cannot revive it", () => {
  // This USED to revive the trip, and that was the bug: routine
  // housekeeping on the other device (linking an account to a member
  // row, writing a profile) legitimately restamps the trip with the
  // current time, which out-dated the delete and brought it back
  // although nobody had edited anything.
  const housekept = pay({ trip: trip({ updatedAt: 900, name: "Bali" }) });
  assert.ok(isDeleted(mergePayload(housekept, tombstonePayload(pay(), 500))));
});

test("a simultaneous delete and edit resolves to the delete", () => {
  const merged = mergePayload(pay({ trip: trip({ updatedAt: 500 }) }), tombstonePayload(pay(), 500));
  assert.ok(isDeleted(merged));
});

test("access lists still merge through a delete", () => {
  // u2 joined on their own device around the time u1 deleted it; they
  // must stay on the document or the rules reject every later write.
  const merged = mergePayload(
    pay({ memberUids: ["u1"] }),
    { ...tombstonePayload(pay({ memberUids: ["u2"] }), 500) }
  );
  assert.deepEqual(merged.memberUids.sort(), ["u1", "u2"]);
});

test("re-writing an unchanged tombstone costs no write", () => {
  const remote = tombstonePayload(pay(), 500);
  assert.equal(payloadChanged(mergePayload(pay({ trip: trip({ updatedAt: 1 }) }), remote), remote), false);
});

test("pushing a delete isn't undone by the live copy still in the cloud", () => {
  // This is what actually happens when you delete: we WRITE a tombstone
  // while the cloud still holds the live trip. If the merge only looks
  // for a delete on the remote side, the live copy wins and the
  // tombstone erases itself — the delete never lands, and the trip
  // returns on a later pull.
  const merged = mergePayload(
    tombstonePayload(pay({ memberUids: ["u1"] }), 500),
    pay({ trip: trip({ updatedAt: 100 }), expenses: [exp("e1", 50)] })
  );
  assert.ok(isDeleted(merged), "the delete must survive the round trip");
  assert.equal(merged.deletedAt, 500);
  assert.deepEqual(merged.memberUids, ["u1"]);
});

test("a newer cloud copy cannot undo the delete we're pushing either", () => {
  const merged = mergePayload(
    tombstonePayload(pay(), 500),
    pay({ trip: trip({ updatedAt: 900, name: "Restamped elsewhere" }) })
  );
  assert.ok(isDeleted(merged), "the delete must hold from whichever side it arrives");
});

test("records inside a trip DO still revive on a later edit", () => {
  // Finality applies to the trip itself, not to expenses — those are
  // only ever restamped by a person actually editing them.
  const merged = mergePayload(
    pay({ expenses: [exp("e1", 300, { name: "revived" })] }),
    pay({ expenses: [], tombstones: { expenses: { e1: 200 }, settlements: {} } })
  );
  assert.equal(merged.expenses.length, 1);
  assert.equal(merged.expenses[0].name, "revived");
});

test("two devices deleting at once agree on the later delete", () => {
  const merged = mergePayload(tombstonePayload(pay(), 300), tombstonePayload(pay(), 700));
  assert.ok(isDeleted(merged));
  assert.equal(merged.deletedAt, 700);
});

// ---------- two devices, one stamp ----------

test("archiving converges even when both devices stamped the same moment", () => {
  // The archive bug, reproduced end to end. Mac archives; Android hasn't
  // heard, and its copy carries the identical updatedAt (see the tie note
  // in js/merge.js). Sync both ways round and they must land on the same
  // trip — whichever one — rather than each keeping its own.
  const mac = pay({ trip: trip({ archived: true, updatedAt: 500 }) });
  const android = pay({ trip: trip({ archived: false, updatedAt: 500 }) });

  const cloud = mergePayload(mac, android);       // Mac pushes
  const back = mergePayload(android, cloud);      // Android pulls
  assert.equal(back.trip.archived, cloud.trip.archived);

  // …and it stays put: syncing again changes nothing on either side.
  assert.ok(!payloadChanged(mergePayload(back, cloud), cloud));
  assert.ok(!payloadChanged(mergePayload(cloud, cloud), cloud));
});

// ---------- who wrote this (push notifications, D4) ----------

test("the author rides along without touching the trip record", () => {
  // The function needs to know who to SKIP — nobody wants a notification
  // about their own typing. But an author field ON the trip record would
  // restamp it every push and hand a device that merely synced a merge
  // win, which is exactly ADR-0017.
  const p = buildPayload({ trip: trip(), expenses: [], settlements: [], tombstones: {}, uid: "u1" });
  assert.equal(p.lastEditBy, "u1");
  assert.equal(p.trip.lastEditBy, undefined, "never on the record");
});

test("changing only the author is not worth a write", () => {
  // Otherwise every device would rewrite the document just by syncing.
  const remote = pay({ lastEditBy: "u2" });
  const merged = mergePayload(pay({ lastEditBy: "u1" }), remote);
  assert.equal(merged.lastEditBy, "u1");
  assert.equal(payloadChanged(merged, remote), false);
});

test("the author survives a merge that has nothing local to go on", () => {
  const merged = mergePayload({ ...pay(), lastEditBy: null }, pay({ lastEditBy: "u2" }));
  assert.equal(merged.lastEditBy, "u2");
});

// ---------- the read-modify-write race (v1.49) ----------

test("an expense saved while a sync is in flight is not destroyed", () => {
  // syncNow builds a payload, awaits a network transaction (seconds on a
  // phone), then applies the RESULT. applyPayload replaces a trip's
  // records wholesale, so anything saved during the await was filtered
  // out — and the next write tombstoned it as a deletion and propagated
  // that everywhere. The fix is to re-merge against state as it is when
  // the transaction returns, not as it was when it began.
  const e1 = exp("e1", 100);
  const sent = pay({ expenses: [e1] });                 // snapshot we uploaded
  const returned = mergePayload(sent, null);            // what came back

  const e2 = exp("e2", 200);                            // saved mid-flight
  const now = pay({ expenses: [e1, e2] });

  const reconciled = mergePayload(now, returned);
  assert.deepEqual(ids(reconciled.expenses), ["e1", "e2"], "the mid-flight save must survive");
});

test("a mid-flight save wins even against a stale copy of itself", () => {
  const before = exp("e1", 100, { name: "Lunch" });
  const returned = mergePayload(pay({ expenses: [before] }), null);
  const edited = exp("e1", 900, { name: "Lunch with Bo" }); // edited mid-flight
  const reconciled = mergePayload(pay({ expenses: [edited] }), returned);
  assert.equal(reconciled.expenses[0].name, "Lunch with Bo");
});

test("a delete made mid-flight is not resurrected by the returning payload", () => {
  const gone = exp("e1", 100);
  const returned = mergePayload(pay({ expenses: [gone] }), null);
  // The user deleted it while the transaction was open: it's absent
  // locally and carries a tombstone stamped after its own updatedAt.
  const now = pay({ expenses: [], tombstones: { expenses: { e1: 500 }, settlements: {} } });
  const reconciled = mergePayload(now, returned);
  assert.deepEqual(ids(reconciled.expenses), [], "the delete must stick");
});

// ---------- what an invitee is allowed to change (v1.49.1) ----------

test("accepting an invite changes memberUids and NOTHING else", () => {
  // firestore.rules now enforces this (joinOnly). If the client ever
  // starts changing another field on the join path, invites break
  // silently for everyone — the v1.29 failure, again. This test is the
  // client-side half of that contract.
  const trip = { id: "t1", name: "Goa", currencies: ["INR"], updatedAt: 5, members: [
    { id: "m1", name: "Asha", email: "a@x.com", uid: "A" },
    { id: "m2", name: "Bo", email: "b@x.com" }, // invited, hasn't opened it yet
  ]};
  const remote = buildPayload({ trip, expenses: [], settlements: [], tombstones: {}, uid: "A" });
  // `writer` is the device doing the write. On every other path it is
  // lastEditBy, but a join must NOT restamp lastEditBy — joinOnly() in
  // firestore.rules refuses that — so the joiner has to be named
  // explicitly or the derivation below drops them straight back out.
  const merged = mergePayload(joinIfInvited(remote, { uid: "B", email: "b@x.com" }), remote,
    undefined, { writer: "B" });

  for (const field of ["trip", "expenses", "settlements", "tombstones", "deleted",
                       "deletedAt", "ownerUid", "invitedEmails", "schema", "lastEditBy"]) {
    assert.deepEqual(merged[field] ?? null, remote[field] ?? null, `${field} must not change`);
  }
  assert.deepEqual(merged.memberUids.sort(), ["A", "B"]);
});

// ---------- one trip's deletions stay in one trip's document (TC-3) ----------

// A clock that looks like a real one: the TTL is measured in days, so
// stamps down at the epoch (1, 500, 900…) are all "56 years old".
const NOW = 1_700_000_000_000;
const DAY = 24 * 60 * 60 * 1000;

test("a trip's document carries only its own deletions", () => {
  // getTombstones() is ONE map for the whole account, and it used to be
  // copied wholesale into every trip. The Goa document listed every
  // expense ever deleted in Vietnam, on every push, for ever — and
  // Firestore's 1 MB per-document ceiling is a wall with nothing behind
  // it: once hit, that trip can never be pushed again.
  const tombstones = {
    expenses: { aGone: NOW - 1000, bGone: NOW - 2000 },
    settlements: { aPaid: NOW - 3000, bPaid: NOW - 4000 },
    tripOf: { aGone: "t1", bGone: "t2", aPaid: "t1", bPaid: "t2" },
  };
  const p = buildPayload({
    trip: trip(), expenses: [], settlements: [], tombstones, uid: "u1",
  });
  assert.deepEqual(p.tombstones.expenses, { aGone: NOW - 1000 });
  assert.deepEqual(p.tombstones.settlements, { aPaid: NOW - 3000 });
});

test("a tombstone past its 90 days is dropped on the merge path", () => {
  // store.js prunes at 90 days, but applyPayload re-imported the remote
  // map straight back into the global one, so a pruned entry returned
  // from the cloud on the very next sync. Nothing ever shrank.
  const old = NOW - TOMBSTONE_TTL_MS - DAY;
  const local = pay({ tombstones: { expenses: { keep: NOW - DAY }, settlements: {} } });
  const remote = pay({ tombstones: {
    expenses: { keep: NOW - 2 * DAY, expired: old }, settlements: {},
  } });
  const merged = mergePayload(local, remote, NOW);
  assert.deepEqual(merged.tombstones.expenses, { keep: NOW - DAY },
    "expired dropped; the survivor keeps the NEWER of the two stamps");
});

test("pruning cannot resurrect what it forgets", () => {
  // The prune has to run AFTER the burial, not before it, or the merge
  // that drops the tombstone is the same merge that hands the record back.
  const fresh = pay({
    expenses: [], tombstones: { expenses: { e1: NOW - DAY }, settlements: {} },
  });
  const stillHasIt = pay({ expenses: [exp("e1", NOW - 2 * DAY)] });
  const buried = mergePayload(fresh, stillHasIt, NOW);
  assert.deepEqual(buried.expenses, [], "a live tombstone still buries its record");

  // …and once the tombstone has aged out and neither side holds the
  // record any more, forgetting it must not bring anything back.
  const forgotten = mergePayload(
    pay({ tombstones: { expenses: { e1: NOW - TOMBSTONE_TTL_MS - DAY }, settlements: {} } }),
    pay({ expenses: [] }),
    NOW
  );
  assert.deepEqual(forgotten.expenses, []);
  assert.deepEqual(forgotten.tombstones.expenses, {});

  // The ordering case that actually bites: the tombstone has expired AND
  // the other side is still holding the record. Bury first and it goes;
  // forget first and a 90-day-old delete undoes itself.
  const stale = mergePayload(
    pay({ tombstones: {
      expenses: { e1: NOW - TOMBSTONE_TTL_MS - DAY }, settlements: {},
    } }),
    pay({ expenses: [exp("e1", NOW - TOMBSTONE_TTL_MS - 2 * DAY)] }),
    NOW
  );
  assert.deepEqual(stale.expenses, [], "buried before it is forgotten, not after");
});

test("absorbing one trip's payload never writes another trip's deletions", () => {
  const local = {
    expenses: { bGone: NOW - 1000 }, settlements: { bPaid: NOW - 1000 },
    tripOf: { bGone: "t2", bPaid: "t2" },
  };
  // t1's document still carries bGone, because a pre-fix device put it
  // there. Absorbing it must not re-file the delete under t1 — that would
  // be the same map travelling between trips again, the long way round.
  const merged = mergePayload(
    pay(),
    pay({ tombstones: {
      expenses: { aGone: NOW - 500, bGone: NOW - 1000 }, settlements: {},
    } }),
    NOW
  );
  const out = applyPayload({
    merged, tripId: "t1", trips: [trip()], expenses: [], settlements: [],
    tombstones: local,
  });
  assert.deepEqual(tripTombstones(out.tombstones, "t2"), tripTombstones(local, "t2"),
    "the other trip's deletions are left exactly as they were");
  assert.deepEqual(tripTombstones(out.tombstones, "t1"),
    { expenses: { aGone: NOW - 500 }, settlements: {}, members: {} },
    "and only this trip's arrive");
});

test("scoping and pruning cost no write on an unchanged remote", () => {
  // v1.57's quota bug: every sync scheduled another one. A payload that
  // differs from the server for a reason nobody edited — a tombstone
  // scoped out here but present there — is the same failure wearing a
  // different hat.
  const synced = trip({ memberUids: ["u1"], ownerUid: "u1" });
  let state = {
    trips: [synced],
    expenses: [exp("e1", NOW - 5000)],
    settlements: [],
    tombstones: {
      expenses: { aGone: NOW - 1000, bGone: NOW - 1000 },
      settlements: {},
      tripOf: { aGone: "t1", bGone: "t2" },
    },
  };
  const build = (s) => buildPayload({
    trip: s.trips.find((t) => t.id === "t1"),
    expenses: s.expenses.filter((e) => e.tripId === "t1"),
    settlements: s.settlements.filter((x) => x.tripId === "t1"),
    tombstones: s.tombstones, uid: "u1",
  });
  // The cloud copy predates the fix, so it still holds the other trip's
  // deletion. This device no longer sends it — and that difference must
  // not read as "something changed" on every single sync for ever.
  const base = mergePayload(build(state), null, NOW);
  const remote = { ...base, tombstones: {
    ...base.tombstones,
    expenses: { ...base.tombstones.expenses, bGone: NOW - 1000 },
  } };

  for (const pass of [1, 2]) {
    const merged = mergePayload(build(state), remote, NOW);
    assert.equal(payloadChanged(merged, remote), false, `pass ${pass} must not earn a write`);
    state = { ...state, ...applyPayload({ merged, tripId: "t1", ...state }) };
  }
});

// An id with no `tripOf` entry rides on EVERY trip's payload (see
// tripTombstones) — that is what keeps a pre-upgrade delete working. So a
// tombstone turning up in trip A's document is not evidence that the delete
// happened in trip A: it may simply be one of ours, riding. Stamping it "A"
// anyway mis-files it for good AND stops it ever reaching the document of the
// trip it really happened in — the deletion is lost, and the record comes back
// on every device, including the one that deleted it.
test("a delete that predates attribution still reaches its own trip's document", () => {
  const tA = trip({ id: "A", name: "Goa" });
  const tB = trip({ id: "B", name: "Vietnam" });
  const doc = (t) => ({
    schema: SCHEMA, trip: t, expenses: [], settlements: [],
    tombstones: { expenses: {}, settlements: {} }, memberUids: ["u1"], ownerUid: "u1",
  });
  const docs = { A: doc(tA), B: doc(tB) };
  // x lived in trip B and was deleted here before tripOf existed, so the
  // tombstone is unattributed and B's document never heard about it.
  const x = exp("x", NOW - 2 * DAY, { tripId: "B" });

  // Exactly syncNow's loop: build -> merge -> apply, per trip, with the
  // tombstone map re-read between trips.
  const syncPass = (dev) => {
    for (const t of [tA, tB]) {
      const local = buildPayload({
        trip: t, expenses: dev.expenses.filter((e) => e.tripId === t.id),
        settlements: [], tombstones: dev.tombstones, uid: "u1",
      });
      docs[t.id] = mergePayload(local, docs[t.id], NOW);
      Object.assign(dev, applyPayload({
        merged: docs[t.id], tripId: t.id, trips: dev.trips,
        expenses: dev.expenses, settlements: dev.settlements, tombstones: dev.tombstones,
      }));
    }
  };

  const d1 = { trips: [tA, tB], expenses: [], settlements: [],
    tombstones: { expenses: { x: NOW - DAY }, settlements: {} } };
  syncPass(d1);
  assert.deepEqual(d1.tombstones.tripOf, {},
    "trip A was pushed first, but it is not where the delete happened");
  assert.deepEqual(docs.B.tombstones.expenses, { x: NOW - DAY },
    "the delete must still reach trip B's document — it rides until it is claimed");

  // The other phone was offline through all of that and still holds x.
  const d2 = { trips: [tA, tB], expenses: [x], settlements: [],
    tombstones: { expenses: {}, settlements: {}, tripOf: {} } };
  syncPass(d2);
  assert.deepEqual(d2.expenses, [], "the delete buries the record on the phone that missed it");

  syncPass(d1);
  assert.deepEqual(d1.expenses, [], "and never comes back on the phone that made it");
});

test("a legacy document's borrowed deletions are not re-filed under the trip they arrive in", () => {
  const tA = trip({ id: "A", name: "Goa" });
  const tB = trip({ id: "B", name: "Vietnam" });
  // A pre-upgrade device deleted x in trip B and pushed only trip A, so trip
  // A's document carries the whole account's map — the old behaviour.
  const legacyDocA = {
    schema: SCHEMA, trip: tA, expenses: [], settlements: [],
    tombstones: { expenses: { x: NOW - DAY }, settlements: {} },
    memberUids: ["u1"], ownerUid: "u1",
  };
  // This device never heard about the delete and still holds x, alive, in B.
  const liveX = exp("x", NOW - 2 * DAY, { tripId: "B" });
  let tombstones = { expenses: {}, settlements: {}, tripOf: {} };
  let expenses = [liveX];

  const mergedA = mergePayload(
    buildPayload({ trip: tA, expenses: [], settlements: [], tombstones, uid: "u1" }),
    legacyDocA, NOW,
  );
  ({ expenses, tombstones } = applyPayload({
    merged: mergedA, tripId: "A", trips: [tA, tB], expenses, settlements: [], tombstones,
  }));
  assert.deepEqual(tombstones.tripOf, {},
    "the live record in trip B is proof this delete is only passing through A");

  const mergedB = mergePayload(
    buildPayload({
      trip: tB, expenses: expenses.filter((e) => e.tripId === "B"),
      settlements: [], tombstones, uid: "u1",
    }),
    { ...legacyDocA, trip: tB, tombstones: { expenses: {}, settlements: {} } }, NOW,
  );
  assert.deepEqual(mergedB.expenses, [], "x stays deleted in the trip it was deleted in");
});

// ---------- the roster is a collection (ADR-0024 part 2) ----------
//
// Members used to ride on the trip record as one all-or-nothing LWW field,
// so the whole roster was decided by a single comparison between two trip
// records and an absent row carried no evidence of anything. "This row was
// removed" and "this device has not heard about this row yet" were the same
// bytes. Both readings are wrong in opposite directions, and both were
// reproduced against the real mergePayload before this section existed —
// see ADR-0024 for the printed output.
//
// Member ids are their own thing (`m-*`) and never the uid: uids identify
// ACCOUNTS, and a member row exists long before anyone signs in.
const ROW = {
  asha: { id: "m-asha", name: "Asha", email: "asha@example.com", uid: "OWNER" },
  bala: { id: "m-bala", name: "Bala", email: "bala@example.com", uid: "BALA" },
  priya: { id: "m-priya", name: "Priya", email: "priya@example.com", uid: "PRIYA" },
};
// A payload the way buildPayload produces one, with the roster on the trip
// and the access lists DERIVED from it (ADR-0022) — a fixture that hand-set
// those to [] would make payloadChanged true for a reason of its own and
// hide the one being tested.
const roster = (members, over = {}) => ({
  schema: SCHEMA,
  trip: { id: "t1", name: "Bali", currencies: ["IDR"], members, updatedAt: 1000, ...(over.trip ?? {}) },
  lastEditBy: over.lastEditBy ?? null,
  memberUids: [...new Set(["OWNER", ...members.map((m) => m.uid).filter(Boolean)])],
  invitedEmails: members.map((m) => m.email).filter(Boolean),
  ownerUid: "OWNER",
  expenses: [], settlements: [],
  tombstones: { expenses: {}, settlements: {}, members: {}, ...(over.tombstones ?? {}) },
});
const rowIds = (payload) => (payload.trip.members ?? []).map((m) => m.id);

// SCENARIO B — a device that has not heard wins the stamp and evicts
// somebody nobody removed. The expensive direction: Priya loses write
// access, and because invitedEmails derives from the same record she loses
// the convenience path back in too.
test("a joiner survives a co-member's phone that has never heard of her", () => {
  const remote = roster([ROW.asha, ROW.bala, ROW.priya], { trip: { updatedAt: 1000 } });
  const local = roster([ROW.asha, ROW.bala], { trip: { updatedAt: 2000 } });

  const merged = mergePayload(local, remote, 3000, { writer: "BALA" });

  assert.deepEqual(rowIds(merged), ["m-asha", "m-bala", "m-priya"],
    "absence is not removal — only a tombstone removes");
  assert.deepEqual([...merged.memberUids].sort(), ["BALA", "OWNER", "PRIYA"]);
  assert.ok(merged.invitedEmails.includes("priya@example.com"),
    "and she keeps the read path back in");
});

// SCENARIO A — the remover loses the stamp, so the removal is undone in
// silence. Priya took Bala off the trip and the cloud carries her grave for
// his row; Asha's phone was offline through it and edited the trip after.
test("a removal survives a co-member's stale phone", () => {
  const remote = roster([ROW.asha, ROW.priya], {
    trip: { updatedAt: 5000 },
    tombstones: { members: { "m-bala": 5000 } },
  });
  const local = roster([ROW.asha, ROW.bala, ROW.priya], { trip: { updatedAt: 6000 } });

  const merged = mergePayload(local, remote, 6000, { writer: "OWNER" });

  assert.deepEqual(rowIds(merged), ["m-asha", "m-priya"], "the removal sticks");
  assert.deepEqual([...merged.memberUids].sort(), ["OWNER", "PRIYA"]);
  assert.ok(!merged.invitedEmails.includes("bala@example.com"));
});

// Without this the whole feature computes the right answer and never writes
// it: normalise() runs everything through emptyTombs(), which used to drop
// every key that was not expenses or settlements, so a removal-only change
// was invisible to the change detector.
test("a removal on its own is worth a write", () => {
  const remote = roster([ROW.asha, ROW.priya], { trip: { updatedAt: 5000 } });
  const local = roster([ROW.asha, ROW.priya], {
    trip: { updatedAt: 5000 },
    tombstones: { members: { "m-bala": 5000 } },
  });
  const merged = mergePayload(local, remote, 6000, { writer: "OWNER" });
  assert.deepEqual(merged.tombstones.members, { "m-bala": 5000 });
  assert.equal(payloadChanged(merged, remote), true,
    "the only difference is a member tombstone, and it still has to reach the cloud");
});

// Removal is FINAL per member id, deliberately unlike an expense. An
// expense revives on a later edit because a person meant to edit it; a
// member row is restamped by HOUSEKEEPING nobody asked for — applyProfile
// and linkAccount write into rows as a side effect of syncing, which is
// ADR-0014/0017 and is exactly how trip deletion had to be made final.
test("housekeeping cannot restamp a removed member back onto the trip", () => {
  const restamped = { ...ROW.bala, updatedAt: 9999, name: "Bala Sen", phone: "+919876543210" };
  const remote = roster([ROW.asha, ROW.priya], {
    trip: { updatedAt: 5000 },
    tombstones: { members: { "m-bala": 1000 } },
  });
  const local = roster([ROW.asha, restamped, ROW.priya], { trip: { updatedAt: 6000 } });

  const merged = mergePayload(local, remote, 9999, { writer: "OWNER" });
  assert.deepEqual(rowIds(merged), ["m-asha", "m-priya"]);
  assert.ok(!merged.memberUids.includes("BALA"));
});

// Every trip in existence today has rows with no updatedAt at all, and a
// service worker reaches a phone on its SECOND open — so an old build's
// roster has to merge against a new one's without either side losing
// people. stampOf() reads a missing stamp as 0: oldest possible, never
// deleted. Pinning that rather than guessing is ADR-0023's lesson.
test("rows from before this feature existed are kept, once, and never buried", () => {
  const bare = (id, name) => ({ id, name });
  const both = roster([bare("m-1", "Asha"), bare("m-2", "Bala")]);
  const same = mergePayload(both, { ...both }, 3000, { writer: "OWNER" });
  assert.deepEqual(rowIds(same), ["m-1", "m-2"], "the same unstamped row, exactly once");

  const older = roster([bare("m-1", "Asha")], { trip: { updatedAt: 9000 } });
  const kept = mergePayload(older, both, 3000, { writer: "OWNER" });
  assert.deepEqual(rowIds(kept), ["m-1", "m-2"],
    "a row only the loser carries is news, not a removal");

  // …and the same in the other direction, from the winner's side.
  const alsoKept = mergePayload(both, { ...older, trip: { ...older.trip, updatedAt: 9000 } },
    3000, { writer: "OWNER" });
  assert.deepEqual(rowIds(alsoKept), ["m-1", "m-2"]);
});

test("a member tombstone past its 90 days is dropped on the merge path", () => {
  const remote = roster([ROW.asha], {
    trip: { updatedAt: 5000 },
    tombstones: { members: { "m-bala": NOW - 91 * DAY, "m-priya": NOW - 89 * DAY } },
  });
  const local = roster([ROW.asha], { trip: { updatedAt: 5000 } });
  const merged = mergePayload(local, remote, NOW, { writer: "OWNER" });
  assert.deepEqual(Object.keys(merged.tombstones.members), ["m-priya"]);
});

test("pruning a member tombstone cannot resurrect the member it forgets", () => {
  // The grave is one tick past the TTL and the stale phone still carries
  // the row. Pruning BEFORE mergeCollection has used it would make the
  // merge that forgets the delete the merge that hands the person back.
  const remote = roster([ROW.asha], {
    trip: { updatedAt: 5000 },
    tombstones: { members: { "m-bala": NOW - TOMBSTONE_TTL_MS - 1 } },
  });
  const local = roster([ROW.asha, ROW.bala], { trip: { updatedAt: 6000 } });
  const merged = mergePayload(local, remote, NOW, { writer: "OWNER" });
  assert.deepEqual(rowIds(merged), ["m-asha"], "forgotten, not undone");
  assert.deepEqual(merged.tombstones.members ?? {}, {});
});

// joinOnly() in firestore.rules requires `tombstones` to come back
// unchanged, and syncTrip runs the fetched document through mergePayload
// rather than echoing it — so an empty map added here is a field the
// JOINER is changing, on every trip document that exists today. That is a
// permission-denied on the phone of somebody accepting an invitation,
// during the one launch the two builds coexist. Caught in the emulator
// against the real rules (tests-integration/rules.test.mjs); pinned here
// too because CI runs only tests/*.test.mjs.
test("a trip with no removals in it is written exactly as older builds wrote it", () => {
  const clean = roster([ROW.asha, ROW.priya]);
  const merged = mergePayload(clean, { ...clean }, 3000, { writer: "OWNER" });
  assert.deepEqual(Object.keys(merged.tombstones).sort(), ["expenses", "settlements"]);
  assert.deepEqual(
    Object.keys(buildPayload({
      trip: { id: "t1", name: "Bali", currencies: ["IDR"], members: [ROW.asha] },
      expenses: [], settlements: [], tombstones: {}, uid: "OWNER",
    }).tombstones).sort(),
    ["expenses", "settlements"]);
  // …and it appears the moment there is something to say.
  const removed = mergePayload(
    roster([ROW.asha], { tombstones: { members: { "m-priya": 2000 } } }), { ...clean },
    3000, { writer: "OWNER" });
  assert.deepEqual(removed.tombstones.members, { "m-priya": 2000 });
});

// reconcileClaims survives the change and still earns its place: a `uid` is
// a CLAIM written once by that account's own device, so a row that wins on
// stamp while missing one has not removed anybody — it has not heard.
test("a uid claim is folded onto the row that won without it", () => {
  const unclaimed = { id: "m-priya", name: "Priya", email: "priya@example.com", updatedAt: 600 };
  const claimed = { ...ROW.priya, updatedAt: 500 };
  const remote = roster([ROW.asha, unclaimed], { trip: { updatedAt: 5000 } });
  const local = roster([ROW.asha, claimed], { trip: { updatedAt: 6000 } });
  const merged = mergePayload(local, remote, 7000, { writer: "OWNER" });
  assert.equal(merged.trip.members.find((m) => m.id === "m-priya").uid, "PRIYA");
  assert.ok(merged.memberUids.includes("PRIYA"));
});

test("a trip's document carries only its own member graves", () => {
  const p = buildPayload({
    trip: { id: "t1", name: "Bali", currencies: ["IDR"], members: [ROW.asha] },
    expenses: [], settlements: [],
    tombstones: { members: { t1: { "m-bala": 5000 }, t2: { "m-x": 4000 } } },
    uid: "OWNER",
  });
  assert.deepEqual(p.tombstones.members, { "m-bala": 5000 });
});

test("an arriving member grave is filed under the trip it arrived in", () => {
  const merged = roster([ROW.asha], { tombstones: { members: { "m-bala": 5000 } } });
  const out = applyPayload({
    merged, tripId: "t1", trips: [{ id: "t1", name: "Bali", currencies: ["IDR"] }],
    expenses: [], settlements: [],
    tombstones: { expenses: {}, settlements: {}, members: { t2: { "m-x": 4000 } } },
  });
  assert.deepEqual(out.tombstones.members, { t1: { "m-bala": 5000 }, t2: { "m-x": 4000 } });
});

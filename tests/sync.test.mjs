import { test } from "node:test";
import assert from "node:assert/strict";
import { buildPayload, mergePayload, payloadChanged, applyPayload, joinIfInvited,
  tombstonePayload, isDeleted, SCHEMA } from "../js/sync.js";

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
  assert.equal(p.ownerUid, "u1");
  // and doesn't duplicate you on the next run
  const again = buildPayload({ trip: { ...trip(), memberUids: ["u1"] }, expenses: [], settlements: [], tombstones: {}, uid: "u1" });
  assert.deepEqual(again.memberUids, ["u1"]);
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
  const merged = mergePayload(local, remote);
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

test("access lists only ever grow — nobody is silently evicted", () => {
  const local = pay({ memberUids: ["u1"] });
  const remote = pay({ memberUids: ["u1", "u2"] });
  assert.deepEqual(mergePayload(local, remote).memberUids.sort(), ["u1", "u2"]);
  // even when it's the local side that knows about the newcomer
  assert.deepEqual(mergePayload(remote, local).memberUids.sort(), ["u1", "u2"]);
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
    pay({ expenses: [], tombstones: { expenses: { gone: 900 }, settlements: {} } })
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
      { id: "me", name: "Archi", email: "  Archi@Gmail.COM ", uid: "u1" },
      { id: "p1", name: "Priya", email: "priya@gmail.com" },
      { id: "r1", name: "Rahul" },
    ] },
    expenses: [], settlements: [], tombstones: {}, uid: "u1",
  });
  assert.deepEqual(p.invitedEmails.sort(), ["archi@gmail.com", "priya@gmail.com"]);
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

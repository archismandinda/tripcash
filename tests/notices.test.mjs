import { test } from "node:test";
import assert from "node:assert/strict";
import { addNotices, unreadCount, markAllRead, markRead, pruneNotices,
  noticeKey, diffTrip, NOTICE_TTL_MS ,
  noticeTarget, ACCOUNT_SCOPE} from "../js/notices.js";

const n = (over = {}) => ({ kind: "expense", tripId: "t1", ref: "e1", text: "Dinner", ...over });

test("the same event heard twice is recorded once", () => {
  // A push and the sync that follows it describe the same thing. Two
  // rows for one dinner makes the list untrustworthy.
  const once = addNotices([], [n()], 1000);
  const twice = addNotices(once, [n()], 2000);
  assert.equal(twice.length, 1);
  assert.equal(twice[0].at, 1000, "the first hearing wins");
});

test("different events on the same trip are separate", () => {
  const out = addNotices([], [n({ ref: "e1" }), n({ ref: "e2" }), n({ kind: "payment", ref: "p1" })], 1);
  assert.equal(out.length, 3);
});

test("newest first, and unread is countable", () => {
  const out = addNotices(addNotices([], [n({ ref: "old" })], 1000), [n({ ref: "new" })], 5000);
  assert.deepEqual(out.map((x) => x.ref), ["new", "old"]);
  assert.equal(unreadCount(out), 2);
  assert.equal(unreadCount(markAllRead(out)), 0);
  assert.equal(unreadCount(markRead(out, noticeKey(out[0]))), 1);
});

test("stale notices age out and the list stays bounded", () => {
  const ancient = [{ ...n({ ref: "x" }), at: 0 }];
  assert.deepEqual(addNotices(ancient, [], NOTICE_TTL_MS + 1), []);
  const many = Array.from({ length: 140 }, (_, i) => n({ ref: `e${i}` }));
  assert.equal(addNotices([], many, 1).length, 100);
});

test("notices for a deleted trip are dropped", () => {
  const out = addNotices([], [n({ tripId: "gone" }), n({ tripId: "t1", ref: "e9" })], 1);
  assert.deepEqual(pruneNotices(out, ["t1"]).map((x) => x.tripId), ["t1"]);
});

// ---------- what changed, worked out on the device ----------

test("someone else's expense is news; your own is not", () => {
  const members = [{ id: "me", name: "You" }, { id: "them", name: "Bo" }];
  const before = { trip: { members }, expenses: [], settlements: [] };
  const after = { trip: { members }, settlements: [],
    expenses: [{ id: "e1", name: "Dinner", paidBy: "them" },
               { id: "e2", name: "Taxi", paidBy: "me" }] };
  const out = diffTrip({ tripId: "t1", tripName: "Goa", before, after, selfId: "me" });
  assert.equal(out.length, 1);
  assert.equal(out[0].text, "Bo added Dinner to Goa");
});

test("an unchanged trip says nothing", () => {
  const same = { expenses: [{ id: "e1", name: "Dinner", paidBy: "them" }], settlements: [] };
  assert.deepEqual(diffTrip({ tripId: "t1", tripName: "Goa", before: same, after: same, selfId: "me" }), []);
});

test("a trip seen for the first time reports everything in it", () => {
  const after = { expenses: [{ id: "e1", name: "Dinner", paidBy: "them" }], settlements: [{ id: "p1", from: "them" }] };
  const out = diffTrip({ tripId: "t1", tripName: "Goa", before: null, after, selfId: "me" });
  assert.deepEqual(out.map((x) => x.kind), ["expense", "payment"]);
});

// ---------- the sentences people actually read ----------

const trip = (members) => ({ trip: { members }, expenses: [], settlements: [] });

test("an expense names who paid and how much", () => {
  const members = [{ id: "me", name: "You" }, { id: "bo", name: "Bo" }];
  const out = diffTrip({
    tripId: "t1", tripName: "Goa", selfId: "me",
    before: trip(members),
    after: { ...trip(members), expenses: [{ id: "e1", name: "Dinner", paidBy: "bo" }] },
    money: () => "₹1,200",
  });
  assert.equal(out[0].text, "Bo added Dinner · ₹1,200 to Goa");
});

test("a payment says who paid whom, and knows when it's you", () => {
  const members = [{ id: "me", name: "You" }, { id: "bo", name: "Bo" }];
  const out = diffTrip({
    tripId: "t1", tripName: "Goa", selfId: "me",
    before: trip(members),
    after: { ...trip(members), settlements: [{ id: "p1", from: "bo", to: "me" }] },
  });
  assert.equal(out[0].text, "Bo recorded a payment to you in Goa");
});

test("someone joining a trip you're on is worth knowing", () => {
  const before = trip([{ id: "me", name: "You" }]);
  const after = trip([{ id: "me", name: "You" }, { id: "cy", name: "Cy" }]);
  const out = diffTrip({ tripId: "t1", tripName: "Goa", before, after, selfId: "me" });
  assert.deepEqual(out.map((x) => x.text), ["Cy was added to Goa"]);
});

test("a trip seen for the first time doesn't announce every member", () => {
  // "You were added to Goa" already covers it — listing all five people
  // as separate notices would bury it.
  const after = trip([{ id: "me", name: "You" }, { id: "cy", name: "Cy" }]);
  const out = diffTrip({ tripId: "t1", tripName: "Goa", before: null, after, selfId: "me" });
  assert.deepEqual(out.filter((x) => x.kind === "member"), []);
});

test("an unnamed actor never leaks a raw id", () => {
  const after = { ...trip([{ id: "me", name: "You" }]), expenses: [{ id: "e1", name: "Taxi", paidBy: "unknown-uid" }] };
  const out = diffTrip({ tripId: "t1", tripName: "Goa", before: trip([{ id: "me", name: "You" }]), after, selfId: "me" });
  assert.equal(out[0].text, "Someone added Taxi to Goa");
});

test("account notices route to Settings, trip notices to the trip", () => {
  assert.deepEqual(noticeTarget({ tripId: ACCOUNT_SCOPE }), { screen: "settings" });
  assert.deepEqual(noticeTarget({ tripId: "t1" }), { screen: "trip", tripId: "t1" });
});

test("an account notice outlives every trip", () => {
  const list = [{ kind: "verify", tripId: ACCOUNT_SCOPE, ref: "u1", text: "Verify your email", at: 1 },
                { kind: "expense", tripId: "gone", ref: "e1", text: "x", at: 1 }];
  assert.deepEqual(pruneNotices(list, []).map((n) => n.kind), ["verify"]);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { addNotices, unreadCount, markAllRead, markRead, pruneNotices,
  noticeKey, diffTrip, NOTICE_TTL_MS } from "../js/notices.js";

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
  const before = { expenses: [], settlements: [] };
  const after = { expenses: [{ id: "e1", name: "Dinner", paidBy: "them" },
                             { id: "e2", name: "Taxi", paidBy: "me" }], settlements: [] };
  const out = diffTrip({ tripId: "t1", tripName: "Goa", before, after, selfId: "me" });
  assert.equal(out.length, 1);
  assert.match(out[0].text, /Dinner was added to Goa/);
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

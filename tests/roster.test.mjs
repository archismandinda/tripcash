// Adding, inviting and removing people — the area that failed the owner
// five times running.
//
// Every case here is a report he actually made, or a state the UI
// described wrongly. Both "add member" fields now go through one
// function, so the drift that caused most of these cannot recur.
import { test } from "node:test";
import assert from "node:assert/strict";
import { planAddMember, removability, awaitingInvite, evictionFrom } from "../js/roster.js";
import { ACCOUNT_SCOPE } from "../js/notices.js";

const me = { id: "me", name: "You" };
const bo = { id: "b1", name: "Bo" };
const priya = { id: "p1", name: "Priya", email: "priya@x.com" };
const plan = (text, members, opts = {}) =>
  planAddMember(text, members, { newId: "NEW", ...opts });

// ---------- an address is an invitation ----------

test("typing an email adds someone AND invites them", () => {
  // The bug behind "I added the 2nd account and it got nothing": both
  // add-fields took a name and nothing else, so this produced a
  // name-only row that granted no access and invited nobody.
  const out = plan("second@example.com", [me], { signedIn: true });
  assert.equal(out.do, "add");
  assert.equal(out.invite, true);
  assert.deepEqual(out.member, { id: "NEW", name: "Second", email: "second@example.com" });
  assert.match(out.say, /will get this trip/);
});

test("signed out it still adds them, and says the invite isn't going anywhere", () => {
  const out = plan("second@example.com", [me], { signedIn: false });
  assert.equal(out.do, "add");
  assert.equal(out.invite, false, "nothing to send and nowhere to send it");
  assert.match(out.say, /Sign in to actually share/);
});

test("a plain name is just a name — no invitation, nothing claimed", () => {
  const out = plan("Rahul", [me], { signedIn: true });
  assert.deepEqual(out.member, { id: "NEW", name: "Rahul" });
  assert.equal(out.invite, false);
  assert.equal(out.say, "");
});

test("a phone number is not an invitation", () => {
  // It grants no access, so promising one would be a lie.
  const out = plan("98765 43210", [me], { signedIn: true });
  assert.equal(out.member.phone, "+919876543210");
  assert.equal(out.invite, false);
});

// ---------- the duplicate-name trap ----------

test("an address for someone already here BY NAME invites them", () => {
  // This used to be refused with "add a surname or initial" — which
  // creates a second person and splits the ledger across two rows. The
  // commonest real flow: add friends as names, then invite one.
  const out = plan("bo@x.com", [me, bo], { signedIn: true });
  assert.equal(out.do, "invite");
  assert.equal(out.target, bo);
  assert.equal(out.email, "bo@x.com");
  assert.match(out.say, /Bo will get this trip/);
});

test("…and signed out, says so rather than pretending", () => {
  const out = plan("bo@x.com", [me, bo], { signedIn: false });
  assert.equal(out.do, "invite");
  assert.match(out.say, /Sign in to actually share/);
});

test("a genuine name clash is still refused", () => {
  const out = plan("Bo", [me, bo], { signedIn: true });
  assert.equal(out.do, "reject");
  assert.match(out.say, /add a surname or initial/);
});

test("someone who already has an address isn't re-invited under a second one", () => {
  assert.equal(plan("priya@other.com", [me, priya], { signedIn: true }).do, "reject");
  assert.equal(plan("PRIYA@X.com", [me, priya], { signedIn: true }).do, "reject");
});

test("empty input does nothing at all", () => {
  assert.deepEqual(plan("   ", [me]), { do: "nothing" });
  assert.deepEqual(plan(null, [me]), { do: "nothing" });
});

// ---------- who may be removed ----------

const expenseBy = (id) => ({ id: "e1", paidBy: id, split: { parts: { [id]: 1 } } });

test("somebody with nothing on the books can just go", () => {
  assert.deepEqual(removability(bo, { selfId: "me", others: 1 }),
    { removable: true, why: "", note: "" });
});

test("you can never remove yourself", () => {
  const out = removability(me, { selfId: "me", others: 2 });
  assert.equal(out.removable, false);
  assert.equal(out.why, "self");
});

test("somebody in an expense is blocked, and pointed at the reassign tool", () => {
  const out = removability(bo, { selfId: "me", expenses: [expenseBy("b1")], others: 2 });
  assert.equal(out.removable, false);
  assert.equal(out.canReassign, true);
  assert.match(out.note, /someone has to take that over/);
});

test("somebody in a PAYMENT only is blocked too", () => {
  // This check lived in one copy of the rule and not the other, so
  // removing them left the summary contradicting itself on one screen:
  // the balances row said they were owed ₹500, settle-up said settled.
  const out = removability(bo, {
    selfId: "me", settlements: [{ from: "b1", to: "me", amount: 500 }], others: 2,
  });
  assert.equal(out.removable, false);
  assert.equal(out.why, "payments");
});

test("nobody else can take the owner off the trip", () => {
  // The rules keep the owner's UID, so this write SUCCEEDED and left
  // them still able to open a trip they no longer appeared on — gone
  // from the members sheet and out of every split, silently, on a trip
  // where they had not spent anything yet.
  const owner = { id: "a1", name: "Asha", uid: "A" };
  const out = removability(owner, { selfId: "b1", ownerUid: "A", others: 2 });
  assert.equal(out.removable, false);
  assert.equal(out.why, "owner");
  assert.match(out.message, /Asha/);
});

test("the owner is still told they can't remove themselves", () => {
  // Same person, their own phone: "only they can leave it" would be
  // nonsense addressed to the person it names.
  const owner = { id: "a1", name: "Asha", uid: "A" };
  const out = removability(owner, { selfId: "a1", ownerUid: "A", others: 2 });
  assert.equal(out.why, "self");
});

test("a member who merely shares the owner's row id is not protected", () => {
  // Protection keys off the linked ACCOUNT, not the local member id —
  // those are independent, and every device makes up its own ids.
  const bo2 = { id: "b1", name: "Bo", uid: "B" };
  assert.equal(removability(bo2, { selfId: "me", ownerUid: "A", others: 2 }).removable, true);
});

test("a trip too old to have an owner locks nobody", () => {
  // ownerUid predates none of these trips being shared, so it can be
  // absent. Inventing an owner would lock a row nothing can explain.
  const anyone = { id: "b1", name: "Bo", uid: "B" };
  assert.equal(removability(anyone, { selfId: "me", ownerUid: null, others: 2 }).removable, true);
  assert.equal(removability({ id: "x", name: "No account" },
    { selfId: "me", ownerUid: "A", others: 2 }).removable, true);
});

test("with nobody to hand it to, say that instead of offering a tool", () => {
  const out = removability(bo, { selfId: "me", expenses: [expenseBy("b1")], others: 0 });
  assert.equal(out.canReassign, false);
  assert.match(out.note, /nobody to hand it to/);
});

// ---------- being removed, from the other side (TC-4) ----------

const goa = { id: "t1", name: "Goa" };
const evict = (over = {}) =>
  evictionFrom({ code: "permission-denied", tripId: "t1", trips: [goa, { id: "t2", name: "Bali" }], ...over });

test("a refused trip we still hold means we were removed from it", () => {
  const out = evict();
  assert.equal(out.evicted, true);
  assert.equal(out.tripId, "t1");
});

test("and it says which trip, by name — not 'the database turned this down'", () => {
  // That generic line is what an evicted device showed, on every sync,
  // for ever: an access-rules warning about a database, for something
  // that is really "somebody took you off the trip". The notice is
  // account-scoped on purpose — pruneNotices drops anything belonging to
  // a trip that is gone, which is exactly what this trip now is.
  const { notice } = evict();
  assert.match(notice.text, /Goa/);
  assert.equal(notice.tripId, ACCOUNT_SCOPE);
  assert.equal(notice.ref, "t1");
});

test("the trip is dropped from local state, and nothing else is", () => {
  const out = evict();
  assert.deepEqual(out.trips.map((t) => t.id), ["t2"]);
});

test("an evicted device stops pushing that trip instead of fighting back", () => {
  // Retrying is worse than useless: every sync spends a refused write and
  // reports a failure the user cannot act on.
  const out = evict();
  assert.equal(out.retry, false);
  assert.equal(out.trips.some((t) => t.id === "t1"), false, "gone from the push loop too");
});

test("a refusal we can still READ through is NOT an eviction", () => {
  // The dangerous case, and the reason this needs evidence rather than an
  // error code. Until the owner publishes the new rules, an ordinary
  // removal makes every push fail with permission-denied on a trip the
  // writer can still read perfectly well — and treating that as "you were
  // removed" would throw away the trip of the very person doing the
  // removing.
  const out = evict({ stillReadable: true });
  assert.equal(out.evicted, false);
  assert.equal(out.retry, true);
  assert.deepEqual(out.trips.map((t) => t.id), ["t1", "t2"]);
});

test("any other failure leaves the trip exactly where it is", () => {
  for (const code of ["unavailable", "deadline-exceeded", undefined]) {
    const out = evict({ code });
    assert.equal(out.evicted, false, `${code} must not delete anything`);
    assert.deepEqual(out.trips.map((t) => t.id), ["t1", "t2"]);
  }
  // …and neither does a refusal for a trip this device doesn't hold.
  assert.equal(evict({ tripId: "t9" }).evicted, false);
});

// ---------- who still needs telling ----------

test("only people with an address who haven't been told yet", () => {
  const members = [
    me,                                                   // no address
    { id: "b1", name: "Bo", email: "bo@x.com" },          // waiting
    { id: "p1", name: "Priya", email: "p@x.com", invitedAt: 5 }, // already sent
  ];
  assert.deepEqual(awaitingInvite(members).map((m) => m.id), ["b1"]);
  // Idempotent: a trip re-saved doesn't re-send to everyone.
  assert.deepEqual(awaitingInvite(members.map((m) => ({ ...m, invitedAt: 1 }))), []);
});

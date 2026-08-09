// Adding, inviting and removing people — the area that failed the owner
// five times running.
//
// Every case here is a report he actually made, or a state the UI
// described wrongly. Both "add member" fields now go through one
// function, so the drift that caused most of these cannot recur.
import { test } from "node:test";
import assert from "node:assert/strict";
import { planAddMember, removability, awaitingInvite } from "../js/roster.js";

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

test("with nobody to hand it to, say that instead of offering a tool", () => {
  const out = removability(bo, { selfId: "me", expenses: [expenseBy("b1")], others: 0 });
  assert.equal(out.canReassign, false);
  assert.match(out.note, /nobody to hand it to/);
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

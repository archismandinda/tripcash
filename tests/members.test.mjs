import { test } from "node:test";
import assert from "node:assert/strict";
import { selfMemberId, linkAccount, memberLabel, deriveMemberUids, deriveInvitedEmails,
  memberStatus, nameFromEmail, nameFromAccount, normalisePhone, whatsappNumber, LEGACY_SELF } from "../js/members.js";

const me = { id: "me", name: "You" };
const rahul = { id: "r1", name: "Rahul" };
const priya = { id: "p1", name: "Priya", email: "priya@gmail.com" };

// ---------- who am I ----------

test("signed out, you are the original member", () => {
  assert.equal(selfMemberId([me, rahul], null), "me");
});

test("signed in, you are whoever carries your account", () => {
  const members = [{ ...me, uid: "uidA" }, rahul];
  assert.equal(selfMemberId(members, { uid: "uidA" }), "me");
});

test("an invited person is themselves, NOT the trip's creator", () => {
  // The bug this whole change exists to kill: before, every device
  // thought the member id "me" was them, so Priya opening Archisman's
  // trip saw herself as him — and her expenses were filed under him.
  const members = [{ ...me, uid: "uidA", name: "Archisman" }, priya];
  assert.equal(selfMemberId(members, { uid: "uidP", email: "priya@gmail.com" }), "p1");
});

test("email match identifies you even before your account is linked", () => {
  assert.equal(selfMemberId([me, priya], { uid: "uidP", email: "PRIYA@Gmail.com" }), "p1");
});

test("signed in but unknown to this trip, you are nobody in it", () => {
  assert.equal(selfMemberId([me, rahul], { uid: "stranger", email: "x@y.com" }), null);
});

test("a trip with no legacy member still resolves someone", () => {
  assert.equal(selfMemberId([rahul], null), "r1");
  assert.equal(selfMemberId([], null), null);
});

// ---------- linking an account to a person ----------

test("the creator claims their own row and gets a real name", () => {
  const out = linkAccount([me, rahul], { uid: "uidA", email: "archi@gmail.com" }, { isOwner: true });
  assert.equal(out[0].uid, "uidA");
  assert.equal(out[0].name, "Archi", "placeholder 'You' becomes a real name");
  assert.equal(out[0].id, LEGACY_SELF, "id must never change — expenses point at it");
  assert.equal(out[1].name, "Rahul");
});

test("someone joining a shared trip does NOT steal the creator's row", () => {
  const members = [{ ...me, uid: "uidA", name: "Archi" }, priya];
  const out = linkAccount(members, { uid: "uidP", email: "priya@gmail.com" }, { isOwner: false });
  assert.equal(out[0].uid, "uidA", "creator untouched");
  assert.equal(out[1].uid, "uidP", "joiner lands on their own invited row");
});

test("linking is idempotent", () => {
  const members = [{ ...me, uid: "uidA" }];
  assert.deepEqual(linkAccount(members, { uid: "uidA" }, { isOwner: true }), members);
});

test("an existing name is never overwritten by linking", () => {
  const named = [{ id: "me", name: "Archisman" }];
  const out = linkAccount(named, { uid: "uidA", email: "archi@gmail.com" }, { isOwner: true });
  assert.equal(out[0].name, "Archisman");
});

test("joining with no matching row adds one rather than silently vanishing", () => {
  const out = linkAccount([me, rahul], { uid: "uidX", email: "zoya@gmail.com" }, { isOwner: false });
  assert.equal(out.length, 3);
  assert.equal(out[2].uid, "uidX");
  assert.equal(out[2].name, "Zoya");
});

test("signed out changes nothing", () => {
  assert.deepEqual(linkAccount([me], null, { isOwner: true }), [me]);
});

// ---------- labels ----------

test("your own row reads You; everyone else reads their name", () => {
  assert.equal(memberLabel(priya, "p1"), "You");
  assert.equal(memberLabel(priya, "me"), "Priya");
});

test("names are derived readably from an address", () => {
  assert.equal(nameFromEmail("priya@gmail.com"), "Priya");
  assert.equal(nameFromEmail(""), "Someone");
});

// ---------- the access lists the rules check ----------

test("access lists are derived from members, so they can't drift", () => {
  const members = [{ ...me, uid: "uidA", email: "a@x.com" }, priya, rahul];
  assert.deepEqual(deriveMemberUids(members), ["uidA"]);
  assert.deepEqual(deriveInvitedEmails(members).sort(), ["a@x.com", "priya@gmail.com"]);
});

test("a name-only member grants nobody access", () => {
  assert.deepEqual(deriveMemberUids([rahul]), []);
  assert.deepEqual(deriveInvitedEmails([rahul]), []);
});

// ---------- status copy ----------

test("status explains plainly what each member is", () => {
  assert.match(memberStatus(rahul, "me"), /won't see the trip/);
  assert.match(memberStatus(priya, "me"), /invited, not opened yet/);
  assert.match(memberStatus({ ...priya, uid: "u" }, "me"), /has the trip/);
  assert.match(memberStatus(priya, "p1"), /this is you/);
});

// ---------- real names from the account ----------

test("a signed-in account contributes its real name, not a guess", () => {
  const out = linkAccount([me], { uid: "u1", email: "archi@gmail.com", displayName: "Archisman Dinda" },
    { isOwner: true });
  assert.equal(out[0].name, "Archisman Dinda");
});

test("without a display name we still fall back to the address", () => {
  const out = linkAccount([me], { uid: "u1", email: "archi@gmail.com" }, { isOwner: true });
  assert.equal(out[0].name, "Archi");
  assert.equal(nameFromAccount({ displayName: "   ", email: "zoya@x.com" }), "Zoya");
});

// ---------- phone numbers: for reaching, not identifying ----------

test("a bare Indian mobile gets its country code so wa.me works", () => {
  assert.equal(normalisePhone("9876543210"), "+919876543210");
  assert.equal(normalisePhone("98765 43210"), "+919876543210");
  // Written with the domestic trunk prefix, as people actually do.
  assert.equal(normalisePhone("098765-43210"), "+919876543210");
  assert.equal(normalisePhone("0 98765 43210"), "+919876543210");
});

test("an explicit country code is always respected", () => {
  assert.equal(normalisePhone("+44 7700 900123"), "+447700900123");
  assert.equal(normalisePhone("+1 (555) 010-9999"), "+15550109999");
});

test("a long number without a plus is treated as already international", () => {
  assert.equal(normalisePhone("919876543210"), "+919876543210");
});

test("junk yields nothing rather than a broken link", () => {
  assert.equal(normalisePhone(""), "");
  assert.equal(normalisePhone("  "), "");
  assert.equal(normalisePhone("not a number"), "");
  assert.equal(normalisePhone(null), "");
});

test("WhatsApp links carry bare digits", () => {
  assert.equal(whatsappNumber("+91 98765 43210"), "919876543210");
  assert.equal(whatsappNumber("9876543210"), "919876543210");
});

test("a phone number alone doesn't grant anyone access", () => {
  const phoneOnly = [{ id: "r1", name: "Rahul", phone: "+919876543210" }];
  assert.deepEqual(deriveMemberUids(phoneOnly), []);
  assert.deepEqual(deriveInvitedEmails(phoneOnly), []);
  assert.match(memberStatus(phoneOnly[0], "me"), /not invited yet/);
});

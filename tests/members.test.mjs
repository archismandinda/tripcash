import { test } from "node:test";
import assert from "node:assert/strict";
import { selfMemberId, linkAccount, memberLabel, deriveMemberUids, deriveInvitedEmails,
  memberStatus, nameFromEmail, nameFromAccount, normalisePhone, whatsappNumber,
  applyProfile, canEditDetails, initialsFrom, LEGACY_SELF , memberState, mergeEditedMembers, parseMemberInput} from "../js/members.js";

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

test("signed out, nobody is 'you' unless a member actually says so", () => {
  // This used to fall back to members[0]. Add your friends before
  // yourself and the app called Alice "You": every "You paid", every
  // balance and every settle-up row referred to her, and she couldn't
  // be removed because self never can be. Silently wrong, unfixable
  // from the UI, and the DEFAULT state — the app works signed out.
  assert.equal(selfMemberId([rahul], null), null);
  assert.equal(selfMemberId([rahul, me], null), LEGACY_SELF, "found by id, not position");
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

test("joining with no matching row leaves the trip alone", () => {
  // It used to append. That made removal impossible and let a second
  // account on the same device inject itself into the first's trips.
  // Anyone who legitimately reached this trip has a row carrying their
  // address — that is what let them in — so case 1 covers real arrivals.
  const out = linkAccount([me, rahul], { uid: "uidX", email: "zoya@gmail.com" }, { isOwner: false });
  assert.deepEqual(out, [me, rahul]);
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

// ---------- your details are yours (v1.35) ----------

test("your own profile replaces the placeholder someone typed for you", () => {
  // Archisman invited "Priya" and guessed her number. Once she signs in,
  // her own name and number win — in his copy of the trip too.
  const members = [{ id: "me", name: "Archi", uid: "uidA" },
                   { id: "p1", name: "Priya", email: "priya@gmail.com", phone: "+919999999999", uid: "uidP" }];
  const out = applyProfile(members, "uidP", { name: "Priya Sharma", phone: "98765 43210" });
  assert.equal(out[1].name, "Priya Sharma");
  assert.equal(out[1].phone, "+919876543210");
  assert.deepEqual(out[0], members[0], "nobody else is touched");
});

test("an empty profile leaves the placeholder alone rather than blanking it", () => {
  const members = [{ id: "p1", name: "Priya", uid: "uidP", phone: "+911111111111" }];
  const out = applyProfile(members, "uidP", { name: "   " });
  assert.equal(out[0].name, "Priya");
  assert.equal(out[0].phone, "+911111111111");
});

test("clearing your number deliberately does remove it", () => {
  const members = [{ id: "p1", name: "Priya", uid: "uidP", phone: "+911111111111" }];
  const out = applyProfile(members, "uidP", { name: "Priya", phone: "" });
  assert.equal(out[0].phone, undefined);
});

test("a profile can't reach into a row that isn't yours", () => {
  const members = [{ id: "r1", name: "Rahul" }, { id: "p1", name: "Priya", uid: "uidP" }];
  assert.deepEqual(applyProfile(members, "uidP", { name: "Priya S" })[0], members[0]);
  assert.deepEqual(applyProfile(members, null, { name: "Nope" }), members);
});

test("you may label someone with no account, but not rewrite a real person", () => {
  assert.ok(canEditDetails({ id: "r1", name: "Rahul" }));
  assert.ok(!canEditDetails({ id: "p1", name: "Priya", uid: "uidP" }));
});

// ---------- avatar initials ----------

test("initials come from a name, an address, or nothing at all", () => {
  assert.equal(initialsFrom("Archisman Dinda"), "AD");
  assert.equal(initialsFrom("archi.d@gmail.com"), "AD");
  assert.equal(initialsFrom("priya@gmail.com"), "PR");
  assert.equal(initialsFrom("Zoya"), "ZO");
  assert.equal(initialsFrom(""), "");
  assert.equal(initialsFrom(null), "");
});

// ---------- the four states a member can be in ----------

test("member state is one word both the card and the list can use", () => {
  // What the trip card shows must agree with what the member sheet says,
  // or the tick means one thing in one place and another elsewhere.
  assert.equal(memberState({ id: "me", name: "You" }, "me"), "self");
  assert.equal(memberState({ id: "p1", name: "Priya", uid: "u1", email: "p@x.com" }, "me"), "linked");
  assert.equal(memberState({ id: "p1", name: "Priya", email: "p@x.com" }, "me"), "invited");
  assert.equal(memberState({ id: "r1", name: "Rahul" }, "me"), "name");
  assert.equal(memberState({ id: "r1", name: "Rahul", phone: "+919876543210" }, "me"), "name",
    "a phone number doesn't grant access, so it isn't an invitation");
  assert.equal(memberState(null, "me"), "name");
});

test("only a linked member earns the tick", () => {
  // The tick answers "will this person actually receive the trip?" —
  // which was previously invisible until three screens down.
  const linked = { id: "p1", name: "Priya", uid: "u1" };
  const invited = { id: "p2", name: "Bo", email: "bo@x.com" };
  assert.equal(memberState(linked, "me"), "linked");
  assert.notEqual(memberState(invited, "me"), "linked");
});

// ---------- editing a trip while another device is editing it ----------

test("removing a member in the editor actually removes them", () => {
  // v1.50.0 kept everyone absent from the edited list, to protect
  // members another device had just added. That made a deliberate
  // removal indistinguishable from an arrival, so removing somebody did
  // nothing at all — reported from a real trip with no expenses on it.
  const openedWith = [me, rahul, priya];
  const edited = [me, priya];                 // Rahul removed in the sheet
  const current = [me, rahul, priya];         // nothing changed elsewhere
  const out = mergeEditedMembers(openedWith, edited, current);
  assert.deepEqual(out.map((m) => m.id), ["me", "p1"]);
});

test("a member added on another device while the sheet was open survives", () => {
  const openedWith = [me, rahul];
  const edited = [me, rahul];                 // untouched here
  const zoya = { id: "z1", name: "Zoya" };
  const current = [me, rahul, zoya];          // arrived from the other phone
  const out = mergeEditedMembers(openedWith, edited, current);
  assert.deepEqual(out.map((m) => m.id), ["me", "r1", "z1"]);
});

test("both at once: a removal sticks and an arrival survives", () => {
  // The case that proves the third list is necessary. Rahul and Zoya are
  // BOTH absent from `edited` and present in `current`; only one of them
  // was ever on screen.
  const openedWith = [me, rahul];
  const edited = [me];                        // Rahul removed
  const zoya = { id: "z1", name: "Zoya" };
  const current = [me, rahul, zoya];          // Zoya arrived meanwhile
  const out = mergeEditedMembers(openedWith, edited, current);
  assert.deepEqual(out.map((m) => m.id), ["me", "z1"]);
});

test("edits made in the sheet win over the copy on the trip", () => {
  const openedWith = [{ id: "r1", name: "Rahul" }];
  const edited = [{ id: "r1", name: "Rahul Sharma", email: "r@x.com" }];
  const out = mergeEditedMembers(openedWith, edited, [{ id: "r1", name: "Rahul" }]);
  assert.deepEqual(out, edited);
});

test("a brand-new trip has nothing to reconcile", () => {
  assert.deepEqual(mergeEditedMembers([], [me], []), [me]);
  assert.deepEqual(mergeEditedMembers(), []);
});

// ---------- adding somebody, from the place you actually add them ----------

test("an email typed into the member field is an invitation, not a name", () => {
  // The whole reported failure: "I added the second account as a member
  // and it got nothing." The field only took names, so it made a
  // name-only member — no access, no invite, and indistinguishable from
  // having invited them.
  const out = parseMemberInput("  Second@Example.com ");
  assert.equal(out.kind, "email");
  assert.equal(out.email, "second@example.com", "lowercased to match invitedEmails and the rules");
  assert.equal(out.name, "Second");
});

test("a phone number is recognised, and is NOT an invitation", () => {
  const out = parseMemberInput("98765 43210");
  assert.equal(out.kind, "phone");
  assert.equal(out.phone, "+919876543210");
});

test("an ordinary name stays an ordinary name", () => {
  assert.deepEqual(parseMemberInput("Rahul"), { kind: "name", name: "Rahul" });
  assert.deepEqual(parseMemberInput("Anne-Marie O'Brien"), { kind: "name", name: "Anne-Marie O'Brien" });
  assert.equal(parseMemberInput("   "), null);
  assert.equal(parseMemberInput(null), null);
});

test("something that merely contains an @ isn't treated as an address", () => {
  assert.equal(parseMemberInput("Bo @ the hostel").kind, "name");
  assert.equal(parseMemberInput("bo@x").kind, "name", "no TLD: not a usable address");
});

// ---------- linking must never invent a person ----------

test("an account that matches nothing does NOT get a member row", () => {
  // Appending here made removal impossible: a removed member's uid stays
  // in memberUids for ever, so on THEIR device nothing matched and they
  // were put straight back — and their push propagated it to everyone.
  const members = [{ id: "m1", name: "Archi", uid: "A", email: "a@x.com" }];
  const out = linkAccount(members, { uid: "B", email: "bo@x.com" }, { isOwner: false });
  assert.deepEqual(out, members);
  assert.equal(out, members, "same reference — nothing to save, so nothing restamps");
});

test("a second account on the same device does not join the first's trips", () => {
  // It used to resolve as "You" in someone else's private trip, log
  // expenses into it, and then report the refused push as a database
  // misconfiguration.
  const archisTrip = [{ id: "m1", name: "Archi", uid: "A", email: "a@x.com" }];
  const out = linkAccount(archisTrip, { uid: "B", email: "second@example.com" }, { isOwner: true });
  assert.equal(out, archisTrip);
  assert.deepEqual(deriveMemberUids(out), ["A"]);
});

test("a genuine invitee still lands on their own row", () => {
  const members = [{ id: "m1", name: "Archi", uid: "A" }, { id: "m2", name: "Bo", email: "bo@x.com" }];
  const out = linkAccount(members, { uid: "B", email: "BO@x.com" }, { isOwner: false });
  assert.equal(out[1].uid, "B");
  assert.equal(out[0].uid, "A", "and nobody else moves");
});

test("a profile with no phone field leaves the one on file alone", () => {
  // Distinct from clearing it. The caller used to send `phone: ""` for
  // "I never set one", so signing in destroyed the number the inviter
  // had typed — on every trip, on everyone's phone.
  const members = [{ id: "p1", name: "Priya", uid: "u1", phone: "+919876543210" }];
  assert.equal(applyProfile(members, "u1", { name: "Priya S" })[0].phone, "+919876543210");
  // …while an explicit empty string still clears, as the test above pins.
  assert.equal(applyProfile(members, "u1", { name: "P", phone: "" })[0].phone, undefined);
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { webcrypto } from "node:crypto";
import { emailKey, inviteEntry, pendingInvites, spentInvites, INVITE_TTL_MS } from "../js/invites.js";

const subtle = webcrypto.subtle;

test("the key is a hash of the lowercased address", async () => {
  // Lowercased because that is how invitedEmails is stored and how the
  // rules compare it. A case mismatch here means an invite that exists
  // and can never be found.
  const a = await emailKey("Second@Example.com", subtle);
  const b = await emailKey("  second@example.com ", subtle);
  assert.equal(a, b);
  assert.match(a, /^[0-9a-f]{64}$/);
  assert.notEqual(a, await emailKey("other@example.com", subtle));
});

test("no address, no key — and never a key that means 'everyone'", async () => {
  assert.equal(await emailKey("", subtle), "");
  assert.equal(await emailKey(null, subtle), "");
  // null, not undefined — an explicit undefined takes the default.
  assert.equal(await emailKey("a@x.com", null), "", "no crypto: fail closed, never a shared key");
});

test("an entry names the trip and nothing more", () => {
  const e = inviteEntry({ name: "Manali", members: [{ id: "m1" }] }, "Archisman", 500);
  assert.deepEqual(e, { name: "Manali", invitedBy: "Archisman", at: 500 });
  assert.equal(e.members, undefined, "the index is readable by the invitee before they join");
});

test("only trips this device hasn't got are pending", () => {
  const index = { trips: { t1: { name: "Goa", at: 100 }, t2: { name: "Manali", at: 100 } } };
  assert.deepEqual(pendingInvites(index, ["t1"], 200).map((x) => x.tripId), ["t2"]);
  assert.deepEqual(pendingInvites(index, ["t1", "t2"], 200), []);
  assert.deepEqual(pendingInvites(null, [], 200), []);
});

test("a stale invite is neither offered nor kept", () => {
  const index = { trips: { old: { name: "X", at: 0 } } };
  const now = INVITE_TTL_MS + 1;
  assert.deepEqual(pendingInvites(index, [], now), []);
  assert.deepEqual(spentInvites(index, [], now), ["old"]);
});

test("an invite is spent once the trip is held", () => {
  const index = { trips: { t1: { name: "Goa", at: 100 }, t2: { name: "M", at: 100 } } };
  assert.deepEqual(spentInvites(index, ["t1"], 200), ["t1"]);
});

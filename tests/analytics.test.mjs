// What we count, and what we must never send.
import { test } from "node:test";
import assert from "node:assert/strict";
import { beaconFor, shouldSend, isReturn, defaultOptIn, countsInvite, rememberInvite,
  EVENTS, RETURN_AFTER_MS } from "../js/analytics.js";

test("a beacon carries six fields at most, and nothing identifying", () => {
  const b = beaconFor("joined", { deviceId: "dev-1", version: "v1.63.0", at: 500 });
  assert.deepEqual(b, { e: "joined", d: "dev-1", v: "v1.63.0", t: 500 });
  // The whole risk of analytics in a money app is scope creep, so this
  // asserts the shape rather than trusting future callers.
  assert.deepEqual(Object.keys(b).sort(), ["d", "e", "t", "v"]);
});

test("an invitation is a beacon of exactly the same shape", () => {
  // The first term of k. It carries no more than any other event does —
  // notably not who was invited, which is the whole reason this is a
  // count and not a log.
  const b = beaconFor("invite_sent", { deviceId: "dev-1", version: "v1.67.0", at: 500 });
  assert.deepEqual(b, { e: "invite_sent", d: "dev-1", v: "v1.67.0", t: 500 });
  assert.deepEqual(Object.keys(b).sort(), ["d", "e", "t", "v"]);
});

test("nothing a caller adds can widen the payload", () => {
  const b = beaconFor("joined", {
    deviceId: "dev-1", version: "v1",
    extra: { tripName: "Goa", amount: 1200, email: "a@x.com", tripId: "t1" },
  });
  const serialised = JSON.stringify(b);
  for (const leak of ["Goa", "1200", "a@x.com", "t1"]) {
    assert.ok(!serialised.includes(leak), `${leak} must never reach the wire`);
  }
  // The invite path is the one with an email and a name in its hand at
  // the moment it counts, so it is the one most able to leak them.
  const inv = beaconFor("invite_sent", {
    deviceId: "d", version: "v1",
    extra: { tripId: "t1", email: "asha@example.com", name: "Asha", memberId: "m1" },
  });
  const sent = JSON.stringify(inv);
  for (const leak of ["t1", "asha@example.com", "Asha", "m1"]) {
    assert.ok(!sent.includes(leak), `${leak} must never reach the wire`);
  }
});

test("the one permitted extra is the conversion flag, and only a boolean", () => {
  assert.equal(beaconFor("trip_created", { deviceId: "d", extra: { byJoiner: true } }).j, 1);
  assert.equal(beaconFor("trip_created", { deviceId: "d", extra: { byJoiner: false } }).j, 0);
  assert.equal(beaconFor("trip_created", { deviceId: "d", extra: { byJoiner: "yes" } }).j, undefined);
  // …and it is meaningless on any other event.
  assert.equal(beaconFor("joined", { deviceId: "d", extra: { byJoiner: true } }).j, undefined);
});

test("an unknown event is dropped, not invented", () => {
  assert.equal(beaconFor("nonsense", { deviceId: "d" }), null);
  assert.equal(beaconFor("joined", { deviceId: "" }), null);
  // Was six. The seventh was a decision, taken deliberately: k = invites
  // × acceptance × conversion, and the six measured acceptance and
  // conversion against a denominator nobody was counting. Without the
  // first term the other two mean nothing, so an eighth still needs an
  // argument this good.
  assert.equal(EVENTS.length, 7,
    "seven numbers. k = invites x acceptance x conversion; adding an eighth is a decision, not a tweak");
});

test("opting out actually stops everything", () => {
  for (const e of EVENTS) assert.equal(shouldSend(e, { optedIn: false }), false);
});

test("once-ever events are sent once", () => {
  assert.equal(shouldSend("first_expense", { optedIn: true, sent: {} }), true);
  assert.equal(shouldSend("first_expense", { optedIn: true, sent: { first_expense: 1 } }), false);
  // Repeatable ones stay repeatable.
  assert.equal(shouldSend("joined", { optedIn: true, sent: { joined: 1 } }), true);
});

test("inviting a second person counts, so invite_sent is never once-ever", () => {
  // k's first term is HOW MANY invitations, not whether one was ever
  // sent. Treating it like first_expense would cap the numerator at one
  // per device and make the ratio it feeds meaningless.
  assert.equal(shouldSend("invite_sent", { optedIn: true }), true);
  assert.equal(shouldSend("invite_sent", { optedIn: true }), true);
  assert.equal(shouldSend("invite_sent", { optedIn: true }), true);
  assert.equal(
    shouldSend("invite_sent", { optedIn: true, sent: { first_expense: true, invite_sent: true } }),
    true
  );
  assert.equal(shouldSend("invite_sent", { optedIn: false }), false);
});

test("the same person is only counted as one invitation", () => {
  // Three code paths put an invitation in front of somebody, and a
  // member can go through more than one of them (invited on save, then
  // the Send button pressed again). The dedupe is a decision, so it
  // lives here rather than as a condition repeated at each call site.
  assert.equal(countsInvite([], "m1"), true);
  assert.equal(countsInvite(["m1"], "m1"), false);
  assert.equal(countsInvite(["m2"], "m1"), true);
  // A member with no id cannot be deduped, so counting them would count
  // them for ever.
  assert.equal(countsInvite([], undefined), false);

  assert.deepEqual(rememberInvite(["a"], "b"), ["a", "b"]);
  assert.deepEqual(rememberInvite(["a", "b"], "a"), ["a", "b"]);
  // The list is device-local and unbounded otherwise; the oldest ids are
  // the ones least likely to be invited again.
  assert.deepEqual(rememberInvite(["a", "b", "c"], "d", 3), ["b", "c", "d"]);
});

test("a return is a gap, not a visit", () => {
  const now = 1_000_000_000_000;
  assert.equal(isReturn(now - RETURN_AFTER_MS - 1, now), true);
  assert.equal(isReturn(now - 1000, now), false);
  assert.equal(isReturn(undefined, now), false, "a first-ever open is not a return");
});

test("Europe is off by default; elsewhere is on", () => {
  assert.equal(defaultOptIn("Europe/Berlin"), false);
  assert.equal(defaultOptIn("Europe/London"), false);
  assert.equal(defaultOptIn("Asia/Calcutta"), true);
  assert.equal(defaultOptIn("America/New_York"), true);
  assert.equal(defaultOptIn(undefined), true);
});

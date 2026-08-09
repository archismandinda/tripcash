// What we count, and what we must never send.
import { test } from "node:test";
import assert from "node:assert/strict";
import { beaconFor, shouldSend, isReturn, defaultOptIn, EVENTS, RETURN_AFTER_MS }
  from "../js/analytics.js";

test("a beacon carries six fields at most, and nothing identifying", () => {
  const b = beaconFor("joined", { deviceId: "dev-1", version: "v1.63.0", at: 500 });
  assert.deepEqual(b, { e: "joined", d: "dev-1", v: "v1.63.0", t: 500 });
  // The whole risk of analytics in a money app is scope creep, so this
  // asserts the shape rather than trusting future callers.
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
  assert.equal(EVENTS.length, 6, "six numbers. adding a seventh is a decision, not a tweak");
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

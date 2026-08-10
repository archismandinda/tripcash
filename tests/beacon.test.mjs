// The counting endpoint, which is unauthenticated by necessity.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
const { planBeacon, dayOf, LIMITS } = createRequire(import.meta.url)("../functions/beacon.js");

const body = (o) => JSON.stringify(o);
const NOW = Date.parse("2026-08-10T04:00:00Z");

test("a well-formed beacon becomes a counter increment and nothing else", () => {
  const out = planBeacon(body({ e: "joined", d: "dev-1", v: "v1.63.0", t: NOW }), { now: NOW });
  assert.deepEqual(out, { ok: true, day: "2026-08-10", event: "joined", field: "joined", joiner: false });
  // The device id is used to rate-limit and then discarded — it must not
  // appear in what gets stored.
  assert.equal(JSON.stringify(out).includes("dev-1"), false);
});

test("an invitation is counted, so acceptance has a denominator", () => {
  // Both ends keep their own allowlist, and an event the server has not
  // heard of is dropped as unknown-event — silently, from the client's
  // point of view. So the client's seventh name means nothing until this
  // set has it too.
  const out = planBeacon(body({ e: "invite_sent", d: "dev-1", v: "v1.67.0" }), { now: NOW });
  assert.deepEqual(out, {
    ok: true, day: dayOf(NOW), event: "invite_sent", field: "invite_sent", joiner: false,
  });
  assert.equal(JSON.stringify(out).includes("dev-1"), false);
});

test("trip_created splits by whether the creator had joined first", () => {
  const asJoiner = planBeacon(body({ e: "trip_created", d: "d", j: 1 }), { now: NOW });
  assert.equal(asJoiner.field, "trip_created_by_joiner");
  const asFirst = planBeacon(body({ e: "trip_created", d: "d" }), { now: NOW });
  assert.equal(asFirst.field, "trip_created");
});

test("an unknown event is refused, so a typo can't become a metric", () => {
  assert.equal(planBeacon(body({ e: "sneaky", d: "d" })).why, "unknown-event");
  assert.equal(planBeacon(body({ e: "", d: "d" })).why, "unknown-event");
});

test("junk and oversized bodies are refused without throwing", () => {
  assert.equal(planBeacon("not json").why, "malformed");
  assert.equal(planBeacon("null").why, "malformed");
  assert.equal(planBeacon(undefined).why, "size");
  assert.equal(planBeacon("x".repeat(LIMITS.MAX_BODY + 1)).why, "size");
  assert.equal(planBeacon(body({ e: "joined" })).why, "device");
  assert.equal(planBeacon(body({ e: "joined", d: "x".repeat(65) })).why, "device");
});

test("one device cannot flood the counters all day", () => {
  const ok = planBeacon(body({ e: "joined", d: "d" }), { now: NOW, seenToday: LIMITS.MAX_PER_DEVICE_PER_DAY - 1 });
  assert.equal(ok.ok, true);
  const capped = planBeacon(body({ e: "joined", d: "d" }), { now: NOW, seenToday: LIMITS.MAX_PER_DEVICE_PER_DAY });
  assert.equal(capped.why, "rate");
});

test("the day is UTC, so every device agrees which bucket it is", () => {
  assert.equal(dayOf(Date.parse("2026-08-10T23:59:59Z")), "2026-08-10");
  assert.equal(dayOf(Date.parse("2026-08-11T00:00:01Z")), "2026-08-11");
});

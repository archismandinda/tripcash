// The counting end of the funnel (see docs/design/INSTRUMENTATION.md).
//
// Pure — no Firebase, no network — so what we accept, what we reject and
// what we store is unit-tested. index.js does the io.
//
// This endpoint is UNAUTHENTICATED, because it has to be: the two events
// that matter most fire before anyone signs in. Everything below exists
// because of that.

// Both ends keep their own copy, and an event only one of them knows
// about is dropped here as unknown-event — silently, as far as the
// client can tell. So a name added to js/analytics.js is not shipped
// until this set has it AND this function is deployed.
const EVENTS = new Set([
  "invite_sent", "link_opened", "trip_seen", "joined", "first_expense",
  "trip_created", "returned",
]);

const MAX_BODY = 512;          // a beacon is ~80 bytes; anything larger is not ours
const MAX_PER_DEVICE_PER_DAY = 50;

// The day a beacon belongs to, in UTC. Counting is aggregate, so which
// midnight is arbitrary — it only has to be the SAME arbitrary one
// everywhere.
export const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

/**
 * What to do with an incoming beacon.
 *
 * Returns { ok: false, why } or
 *         { ok: true, day, event, field, joiner }
 *
 * `field` is the counter to increment. Nothing from the request is ever
 * stored verbatim — the device id is used to rate-limit and is then
 * discarded, so the stored data is counts and nothing else. There is
 * nothing to leak and nothing to subpoena.
 */
export function planBeacon(raw, { now = Date.now(), seenToday = 0 } = {}) {
  if (typeof raw !== "string" || raw.length > MAX_BODY) return { ok: false, why: "size" };

  let body;
  try { body = JSON.parse(raw); } catch { return { ok: false, why: "malformed" }; }
  if (!body || typeof body !== "object") return { ok: false, why: "malformed" };

  // An unknown name would silently become a new metric. Reject it; the
  // client drops them too, so anything arriving here is not our client.
  if (!EVENTS.has(body.e)) return { ok: false, why: "unknown-event" };
  if (typeof body.d !== "string" || !body.d || body.d.length > 64) return { ok: false, why: "device" };

  // Anyone can post here, so anyone can inflate our numbers. The cap
  // makes that tedious rather than impossible — which is the honest
  // ceiling for an open endpoint, and why these numbers are directional
  // and never contractual.
  if (seenToday >= MAX_PER_DEVICE_PER_DAY) return { ok: false, why: "rate" };

  const joiner = body.e === "trip_created" && (body.j === 1 || body.j === true);
  return {
    ok: true,
    day: dayOf(now),
    event: body.e,
    // trip_created splits two ways because the split IS the conversion
    // metric — a trip created by someone who first joined another is the
    // loop closing.
    field: joiner ? "trip_created_by_joiner" : body.e,
    joiner,
  };
}

export const LIMITS = { MAX_BODY, MAX_PER_DEVICE_PER_DAY };

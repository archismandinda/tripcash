// Six numbers, and nothing else (see docs/design/INSTRUMENTATION.md).
//
// Pure. Building a payload and deciding whether to send one are
// decisions; the send itself is one line in the caller.
//
// The constraint that shaped this: the two most important events —
// a link being opened, and the trip being seen — happen BEFORE anyone
// signs in. So this cannot go through the Firestore SDK, and it must
// never become a reason to load it. A signed-out user still makes zero
// Firebase requests.

// Every event this app will ever send. An unknown name is dropped rather
// than sent: a typo that silently becomes a new metric is worse than a
// missing one, and the server rejects them anyway.
export const EVENTS = Object.freeze([
  "link_opened",    // opened with ?join=
  "trip_seen",      // the invitation screen rendered a named trip
  "joined",         // a join write succeeded          -> acceptance
  "first_expense",  // this device's first expense ever
  "trip_created",   // a trip was created              -> conversion
  "returned",       // opened 30+ days after the last open
]);

export const RETURN_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

// Analytics is off by default where consent is required, on elsewhere.
// Nobody is asked twice, and nothing about the app changes if they say
// no — the switch has to be genuinely free to decline.
const CONSENT_REQUIRED = /^(AT|BE|BG|HR|CY|CZ|DK|EE|FI|FR|DE|GR|HU|IE|IT|LV|LT|LU|MT|NL|PL|PT|RO|SK|SI|ES|SE|IS|LI|NO|GB|CH)$/;

export function defaultOptIn(timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  // Region from the timezone, because asking for location to decide
  // whether we may count page views would be absurd.
  const region = String(timeZone ?? "").split("/")[0];
  const european = region === "Europe" || CONSENT_REQUIRED.test(String(timeZone ?? ""));
  return !european;
}

// What actually goes on the wire. Deliberately tiny, and deliberately
// impossible to widen by accident: anything not on this list is dropped,
// so a future caller cannot slip a trip name or an amount in.
export function beaconFor(event, { deviceId, version, at = Date.now(), extra } = {}) {
  if (!EVENTS.includes(event)) return null;
  if (!deviceId) return null;
  const payload = { e: event, d: String(deviceId), v: String(version ?? ""), t: at };
  // The single permitted extra: whether a trip's creator had previously
  // joined somebody else's. It is the conversion metric, and it is a
  // boolean.
  if (event === "trip_created" && typeof extra?.byJoiner === "boolean") {
    payload.j = extra.byJoiner ? 1 : 0;
  }
  return payload;
}

// Should this be sent at all?
export function shouldSend(event, { optedIn, sent = {} } = {}) {
  if (!optedIn) return false;
  if (!EVENTS.includes(event)) return false;
  // Once-ever events. Sending `first_expense` twice would make the
  // number mean nothing, and `returned` is defined by a gap, not a visit.
  if (event === "first_expense") return !sent.first_expense;
  return true;
}

// Has enough time passed since the last open to count as a return?
export const isReturn = (lastOpenAt, now = Date.now()) =>
  Number.isFinite(lastOpenAt) && now - lastOpenAt >= RETURN_AFTER_MS;

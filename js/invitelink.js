// What an invite link says about itself — the cold open.
//
// firestore.rules require a signed-in, invited caller for EVERY read, and
// that rule is right: it is what stops trip ids being enumerated. So an
// anonymous visitor who has just tapped a link cannot be shown the trip
// from the database, no matter how the screen is written. The invitation
// therefore has to travel inside the link:
//
//     https://<host>/?join=<tripId>#p=<base64url({n,by,m,c})>
//
// In the FRAGMENT, deliberately. A fragment is never sent to a server, so
// the trip name and the inviter's name stay out of every hosting log,
// referrer header and access log between the two phones. It also renders
// instantly, offline, with no auth and no rules change.
//
// **It is a claim, not a fact.** Anyone can edit a URL, so nothing here
// may be persisted, and nothing may be joined, spent or seen on its
// strength: joining still needs a real session, a real invitation and a
// real document read. This module's job is to make the claim safe to
// SHOW — bounded in size, guaranteed not to throw, and plain text that
// app.js writes with textContent.
//
// The one thing it must never do is give up. A missing or mangled
// fragment falls back to a generic invitation; it never returns "show
// nothing" while there is a ?join= to explain, because the empty home
// screen ("No trips yet." / "Create your first trip") tells somebody who
// was promised a trip that their link is broken.

// Bounds, applied on the way out AND on the way in. The outbound ones
// keep the link pasteable into a chat message; the inbound ones are the
// ones that matter, because a hand-written link obeys nothing.
const MAX_NAME = 60;
const MAX_BY = 40;
const MAX_CODES = 4;
const MAX_CODE = 8;
const MAX_MEMBERS = 999; // a trip is a few people, not a population
// Long enough for any preview this module can produce, short enough that
// a fragment cannot be used to make the first screen do work.
const MAX_ENCODED = 1200;

const clampText = (value, max) =>
  typeof value === "string" ? value.trim().slice(0, max) : "";

const clampCount = (value) => {
  const n = Math.floor(Number(value));
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_MEMBERS) : 0;
};

const clampCodes = (value) =>
  (Array.isArray(value) ? value : [])
    .filter((c) => typeof c === "string" && c.trim())
    .map((c) => c.trim().slice(0, MAX_CODE))
    .slice(0, MAX_CODES);

// base64url: URL-safe alphabet, padding stripped. "+/=" all mean
// something else inside a URL fragment.
function toBase64Url(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(text) {
  const padded = text.replace(/-/g, "+").replace(/_/g, "/")
    .padEnd(Math.ceil(text.length / 4) * 4, "=");
  const binary = atob(padded); // throws on anything outside the alphabet
  return Uint8Array.from(binary, (ch) => ch.charCodeAt(0));
}

// The preview an inviter's device puts in the link. Short keys because
// this ends up in a message somebody reads.
export function encodePreview({ name, by, members, currencies } = {}) {
  const payload = {};
  const n = clampText(name, MAX_NAME);
  const b = clampText(by, MAX_BY);
  const m = clampCount(members);
  const c = clampCodes(currencies);
  if (n) payload.n = n;
  if (b) payload.by = b;
  if (m) payload.m = m;
  if (c.length) payload.c = c;
  // TextEncoder first: btoa() throws outright on any character above
  // U+00FF, so a trip called "Kyōto" would otherwise mean the inviter
  // cannot produce a link at all.
  return toBase64Url(new TextEncoder().encode(JSON.stringify(payload)));
}

// The preview a visitor's device reads out of the link. Returns null for
// anything it cannot vouch for, and throws for nothing: this runs on the
// very first paint, before any error handling exists to catch it.
export function decodePreview(text) {
  if (typeof text !== "string" || !text || text.length > MAX_ENCODED) return null;
  let data;
  try {
    // fatal: invalid UTF-8 must be rejected, not silently turned into
    // replacement characters and shown to somebody as a trip name.
    const json = new TextDecoder("utf-8", { fatal: true }).decode(fromBase64Url(text));
    data = JSON.parse(json);
  } catch {
    return null;
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) return null;
  const name = clampText(data.n, MAX_NAME);
  // No name, no invitation. Everything else is decoration; the name is
  // the whole reason this screen is worth showing.
  if (!name) return null;
  return {
    name,
    by: clampText(data.by, MAX_BY),
    members: clampCount(data.m),
    currencies: clampCodes(data.c),
  };
}

// "4 people · INR, THB" — omitted entirely rather than half-written,
// because "0 people" reads as a bug and undoes the reassurance the whole
// screen exists to give.
function summaryLine({ members, currencies }) {
  const parts = [];
  if (members === 1) parts.push("1 person");
  else if (members > 1) parts.push(`${members} people`);
  if (currencies.length) parts.push(currencies.join(", "));
  return parts.join(" · ");
}

// The payload lives under `p` in the fragment, so the fragment stays a
// place other things could be added later without ambiguity.
function previewParam(fragment) {
  if (typeof fragment !== "string") return "";
  return new URLSearchParams(fragment.replace(/^#/, "")).get("p") ?? "";
}

// The single decision this screen rests on. Three outcomes, and the one
// that does not exist is "none while there is a ?join=" — see the note at
// the top of the file.
//
// `pendingJoin` is why this takes two sources instead of one. boot() runs
// `history.replaceState(null, "", "./")`, which strips ?join= and #p=
// together, so the SECOND load of the app has neither and the URL alone
// says there is no invitation. What survives is settings.pendingJoin, and
// every ordinary thing an invitee does reaches that state: pull to
// refresh, reopen the installed PWA, have the tab evicted while going to
// the inbox for a verification mail, or come back from the Google
// *redirect* sign-in that installed PWAs fall back to. Without it, the
// second load of the app said "No trips yet." to somebody whose device
// was still holding their invitation.
//
// The URL wins when it has one: tapping a second invitation while the
// first is still pending must show the trip that was just tapped.
//
// The FRAGMENT belongs to the link it arrived in, and is only read when
// the id came from the URL too. A preview is a claim, and a claim about
// one trip is no evidence at all about another.
//
// `tripId` is that same precedence applied once, so the caller never
// works it out again — and it is what lets the screen come DOWN. The
// invitation was believed to expire with settings.pendingJoin; it does
// not, because app.js reads `?join=` once at module scope (it has to —
// boot() strips the URL) and keeps handing it back. On the very load that
// does the joining, a live joinId outranks a cleared pendingJoin and the
// answer stayed "invitation" for the rest of the session, leaving "Join
// this trip" on screen over a trip already joined. What actually ends an
// invitation is the trip arriving, which the caller can see for itself
// once it knows WHICH trip to look for.
export function invitationScreen({ joinId, fragment, pendingJoin } = {}) {
  const tripId = joinId || pendingJoin || null;
  if (!joinId) return pendingJoin ? { show: "generic", tripId } : { show: "none", tripId: null };
  const preview = decodePreview(previewParam(fragment));
  if (!preview) return { show: "generic", tripId };
  return {
    show: "invitation",
    tripId,
    name: preview.name,
    by: preview.by,
    line: summaryLine(preview),
  };
}

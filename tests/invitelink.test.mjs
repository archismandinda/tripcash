// The cold open: what the invite link says about itself, and what the
// app is allowed to do with it.
//
// The link is the ONLY thing an anonymous visitor has. firestore.rules
// require a signed-in, invited caller for every read, so the trip cannot
// be fetched to introduce itself — the invitation has to travel inside
// the URL. That makes the preview a CLAIM written by whoever last
// touched the link, which is why half of these tests are about what the
// app must refuse to do with it: never persist it, never render it as
// markup, never let a malformed one fall through to "No trips yet."

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { encodePreview, decodePreview, invitationScreen } from "../js/invitelink.js";

const SRC = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const HTML = readFileSync(new URL("../index.html", import.meta.url), "utf8");

// Deliberately NOT the module's own encoder: a round trip that only ever
// talks to itself proves nothing about what a real link contains.
const b64url = (text) => Buffer.from(text, "utf8").toString("base64url");
const frag = (text) => `#p=${b64url(text)}`;

// The one line containing a marker, so a test can assert what guards it.
function lineWith(src, marker) {
  const line = src.split("\n").find((l) => l.includes(marker));
  assert.ok(line, `expected app.js to contain ${marker}`);
  return line;
}

// The body of a top-level function declaration, up to its closing brace
// at column 0 (same trick as tests/ledger.test.mjs).
function bodyOf(src, decl) {
  const start = src.indexOf(decl);
  assert.ok(start > 0, `expected app.js to declare ${decl}`);
  return src.slice(start, src.indexOf("\n}\n", start));
}

// ---------- encode / decode ----------

test("a preview survives the round trip, including non-ASCII", () => {
  // btoa() throws on anything above U+00FF, so the bytes have to be
  // UTF-8 encoded first. Trip names are the single most likely place for
  // a non-Latin character to appear, and a throw here means the inviter
  // cannot even produce a link.
  const out = decodePreview(encodePreview({ name: "Kyōto 🏯", by: "Priya" }));
  assert.equal(out.name, "Kyōto 🏯");
  assert.equal(out.by, "Priya");
});

test("members and currencies come back as they went in", () => {
  const out = decodePreview(encodePreview({
    name: "Goa", by: "Asha", members: 4, currencies: ["INR", "THB"],
  }));
  assert.deepEqual(out, { name: "Goa", by: "Asha", members: 4, currencies: ["INR", "THB"] });
});

test("a preview is base64url — safe in a fragment, no padding", () => {
  const encoded = encodePreview({ name: "Sølv & Sønn?", by: "Bo" });
  assert.match(encoded, /^[A-Za-z0-9_-]*$/);
});

test("rubbish decodes to null, and never throws", () => {
  // Every one of these is reachable: a link truncated by a chat app, a
  // link somebody edited by hand, a link built by a future version.
  const junk = [
    "",
    "not-base64!!",
    b64url("[]"),              // valid JSON, wrong shape
    b64url('{"n":123}'),       // a name that is not a name
    b64url("x".repeat(50_000)), // 50 kB: a fragment used as a weapon
    b64url("{"),               // truncated JSON
    undefined,
    null,
    42,
  ];
  for (const text of junk) {
    assert.equal(decodePreview(text), null, `should be null: ${String(text).slice(0, 24)}`);
  }
});

test("a huge preview cannot be built either — everything is clamped", () => {
  const encoded = encodePreview({
    name: "x".repeat(500),
    by: "y".repeat(500),
    members: 4,
    currencies: ["INR", "THB", "EUR", "USD", "GBP", "JPY", "AUD"],
  });
  // A link has to survive being pasted into a chat message.
  assert.ok(encoded.length < 400, `expected a short link, got ${encoded.length}`);
  const out = decodePreview(encoded);
  assert.equal(out.name.length, 60);
  assert.equal(out.by.length, 40);
  assert.equal(out.currencies.length, 4);
});

test("a member count is a non-negative integer, whatever was passed", () => {
  const count = (members) => decodePreview(encodePreview({ name: "Goa", members })).members;
  assert.equal(count(-3), 0);
  assert.equal(count(2.7), 2);
  assert.equal(count("4"), 4);
  assert.equal(count(NaN), 0);
  assert.equal(count(undefined), 0);
  assert.equal(count("lots"), 0);
});

test("a hand-written preview is clamped on the way IN as well", () => {
  // encodePreview's limits only bind the inviter's device. The clamps
  // that matter are the ones applied to what arrives.
  const out = decodePreview(b64url(JSON.stringify({
    n: "z".repeat(400), by: "q".repeat(400), m: -7, c: ["AAA", 5, "BBB", "CCC", "DDD", "EEE"],
  })));
  assert.equal(out.name.length, 60);
  assert.equal(out.by.length, 40);
  assert.equal(out.members, 0);
  // The non-string is dropped BEFORE the cap, not counted against it —
  // otherwise one junk entry silently costs a real currency its place.
  assert.deepEqual(out.currencies, ["AAA", "BBB", "CCC", "DDD"]);
});

// ---------- which screen ----------

test("a well-formed link names the trip and who sent it", () => {
  const screen = invitationScreen({
    joinId: "trip-1",
    fragment: frag(JSON.stringify({ n: "Goa", by: "Priya", m: 4, c: ["INR", "THB"] })),
  });
  assert.equal(screen.show, "invitation");
  assert.equal(screen.name, "Goa");
  assert.equal(screen.by, "Priya");
  assert.equal(screen.line, "4 people · INR, THB");
});

test("a missing or broken fragment still gets an invitation, never the home screen", () => {
  for (const fragment of ["", undefined, "#", "#p=", "#p=not-base64!!", "#nonsense", frag("[]")]) {
    assert.equal(invitationScreen({ joinId: "trip-1", fragment }).show, "generic",
      `fragment ${JSON.stringify(fragment)} should still show an invitation`);
  }
});

test("no ?join means no invitation screen at all", () => {
  assert.equal(invitationScreen({ joinId: null, fragment: frag('{"n":"Goa"}') }).show, "none");
  assert.equal(invitationScreen({ joinId: "" }).show, "none");
  assert.equal(invitationScreen({}).show, "none");
});

// ---------- the invitation outlives the URL ----------
//
// boot() runs history.replaceState(null, "", "./"), which strips ?join=
// and #p= together — so the SECOND load of the app has neither, and the
// URL alone says there is no invitation. What survives is
// settings.pendingJoin, and every ordinary thing an invitee does reaches
// this path: pull-to-refresh, reopening the installed PWA, the tab being
// evicted while they go to their inbox for a verification mail, and
// coming back from the Google *redirect* sign-in that installed PWAs
// fall back to. Every one of those used to land on "No trips yet."

test("a remembered join still shows an invitation once the URL is gone", () => {
  // The exact state after one reload: no query, no fragment, pendingJoin
  // still set.
  assert.equal(invitationScreen({ joinId: null, fragment: "", pendingJoin: "abc-123" }).show, "generic");
});

test("the link in the address bar outranks the one being remembered", () => {
  // Tapping a second invitation while the first is still pending must
  // show the trip that was just tapped, not the one left over.
  const screen = invitationScreen({
    joinId: "trip-new",
    fragment: frag(JSON.stringify({ n: "Goa", by: "Asha" })),
    pendingJoin: "trip-old",
  });
  assert.equal(screen.show, "invitation");
  assert.equal(screen.name, "Goa");
});

test("a remembered join is never named by a fragment that is not its own", () => {
  // The preview belongs to the link it arrived in. A fragment sitting in
  // the address bar for any other reason is not evidence about the trip
  // this device is waiting on, and naming a trip on no evidence is the
  // one thing this module must not do.
  const screen = invitationScreen({
    joinId: null,
    fragment: frag(JSON.stringify({ n: "Somewhere else", by: "Nobody" })),
    pendingJoin: "abc-123",
  });
  assert.equal(screen.show, "generic");
  assert.equal(screen.name, undefined);
});

test("nothing pending and nothing in the URL is still no invitation", () => {
  assert.equal(invitationScreen({ joinId: null, pendingJoin: null }).show, "none");
  assert.equal(invitationScreen({ joinId: "", pendingJoin: "" }).show, "none");
});

// ---------- which trip the invitation is about ----------
//
// The precedence above (URL first, then pendingJoin) decides the SCREEN.
// It has to decide the TRIP too, in the same breath, because that is what
// lets the screen come down: an invitation to a trip that is now on this
// device has been answered. Working it out again at the call site is the
// same rule in two places, and the two would disagree the moment somebody
// taps a second link with a first one still pending.

test("the invitation names the trip it is an invitation to", () => {
  assert.equal(invitationScreen({ joinId: "t-goa", fragment: frag('{"n":"Goa"}') }).tripId, "t-goa");
  assert.equal(invitationScreen({ joinId: "t-goa" }).tripId, "t-goa"); // generic, still a trip
  assert.equal(invitationScreen({ joinId: null, pendingJoin: "t-old" }).tripId, "t-old");
  assert.equal(invitationScreen({ joinId: "t-new", pendingJoin: "t-old" }).tripId, "t-new");
});

test("no invitation is about no trip", () => {
  assert.equal(invitationScreen({}).tripId, null);
  assert.equal(invitationScreen({ joinId: "", pendingJoin: "" }).tripId, null);
});

test("the app re-derives the invitation from what it remembered", () => {
  // The wiring half. The module can answer this correctly and still be
  // asked the wrong question: app.js must hand it pendingJoin, and must
  // not freeze the answer — the screen also has to come DOWN by itself
  // when the join finally lands and pendingJoin is cleared.
  const at = SRC.indexOf("invitationScreen(");
  assert.match(SRC.slice(at, at + 260), /pendingJoin:\s*settings\.pendingJoin/,
    "invitationScreen must be told what this device is still waiting to join");
  assert.match(SRC, /function renderTrips\(\)\s*\{[\s\S]{0,400}?renderInvitation\(\)/,
    "renderTrips must repaint the invitation, or a joined trip appears underneath a live one");
});

test("the empty home screen is unreachable from an invite link", () => {
  // This is the whole point of the story: a friend promised a trip, so
  // whatever else happens the first screen must not say there isn't one.
  const fragments = ["", "#", "#p=", "#p=!!!", "#p=" + "A".repeat(9000),
    frag("[]"), frag('{"n":123}'), frag("{"), frag(JSON.stringify({ n: "Goa" }))];
  for (const fragment of fragments) {
    assert.notEqual(invitationScreen({ joinId: "any-id", fragment }).show, "none");
  }
});

test("the summary line is left out rather than left half-written", () => {
  const line = (obj) => invitationScreen({ joinId: "t", fragment: frag(JSON.stringify(obj)) }).line;
  assert.equal(line({ n: "Goa" }), "");
  assert.equal(line({ n: "Goa", m: 1 }), "1 person");
  assert.equal(line({ n: "Goa", c: ["INR"] }), "INR");
  assert.equal(line({ n: "Goa", m: 2, c: ["INR"] }), "2 people · INR");
});

test("a tampered name is carried as text, tags and all", () => {
  // The module must not sanitise it into something that looks safe —
  // it stays exactly what it is, and app.js renders it with textContent.
  const screen = invitationScreen({
    joinId: "t", fragment: frag(JSON.stringify({ n: "<img src=x onerror=alert(1)>" })),
  });
  assert.equal(screen.show, "invitation");
  assert.equal(screen.name, "<img src=x onerror=alert(1)>");
});

// ---------- the wiring in app.js (D7: assert it, don't assume it) ----------

test("the invitation is decided from the URL before anything renders", () => {
  // Before renderTrips, before refreshRates, before connectAuth: with no
  // account and no network there is nothing to wait for, and every one
  // of those can fail.
  const decided = SRC.indexOf("invitationScreen(");
  assert.ok(decided > 0, "app.js must call invitationScreen");
  assert.ok(decided < SRC.indexOf("function boot()"),
    "the invitation must be decided at module scope, not inside boot()");
});

test("the fragment is read before replaceState throws it away", () => {
  // history.replaceState(null, "", "./") strips ?join= AND #p= — which
  // is correct (the preview should not enter history or be re-shared),
  // but it means anything that reads the fragment afterwards reads
  // nothing at all.
  const hash = SRC.indexOf("location.hash");
  assert.ok(hash > 0, "app.js must read location.hash");
  assert.ok(hash < SRC.indexOf('history.replaceState(null, "", "./")'));
});

test('"No trips yet" is unreachable while an invitation is showing', () => {
  assert.match(lineWith(SRC, '$("#empty-state").hidden'), /showingInvite\(\)/);
  assert.match(lineWith(SRC, '$("#new-trip-btn").hidden'), /showingInvite\(\)/);
});

test("the invitation screen exists in the shell, hidden by default", () => {
  assert.match(HTML, /id="invite-screen"[^>]*hidden/);
  for (const id of ["invite-by", "invite-name", "invite-line", "invite-join", "invite-dismiss"]) {
    assert.ok(HTML.includes(`id="${id}"`), `index.html should carry #${id}`);
  }
});

test("the preview is written as text, never as markup", () => {
  const body = bodyOf(SRC, "function renderInvitation()");
  assert.ok(!body.includes("innerHTML"), "the preview comes from a URL — no innerHTML");
  assert.match(body, /#invite-name"\)\.textContent/);
  assert.match(body, /#invite-by"\)\.textContent/);
});

test("nothing the link claims is ever persisted", () => {
  // A claim that reaches storage becomes indistinguishable from a fact,
  // and would then survive the reload that is supposed to re-derive it.
  const paint = bodyOf(SRC, "function renderInvitation()");
  assert.ok(!/setSettings\(|\bsave[A-Za-z]*\(|localStorage/.test(paint),
    "renderInvitation must not write anything");
  for (const line of SRC.split("\n")) {
    if (!/setSettings\(|\bsave[A-Za-z]*\(/.test(line)) continue;
    assert.ok(!/\binvitation\.|decodePreview\(/.test(line), `a preview field is being saved: ${line.trim()}`);
  }
  // And the fields are only ever touched in the one function that paints
  // them, so a future call site cannot quietly take a different route.
  for (const m of SRC.matchAll(/invitation\.(name|by|line)\b/g)) {
    assert.ok(paint.includes(m[0]), `${m[0]} is read outside renderInvitation`);
  }
});

test("looking around dismisses the invitation without recording anything", () => {
  const start = SRC.indexOf('$("#invite-dismiss")');
  assert.ok(start > 0, "the dismiss button must be wired");
  const handler = SRC.slice(start, SRC.indexOf("});", start));
  assert.ok(!/setSettings\(|\bsave[A-Za-z]*\(|localStorage/.test(handler),
    "dismissing must persist nothing — the same link must invite again");
});

test("the link carries its preview, and pendingJoin still survives it", () => {
  const link = lineWith(SRC, "?join=${encodeURIComponent");
  assert.ok(SRC.slice(SRC.indexOf("const inviteLink"), SRC.indexOf("const inviteMessage"))
    .includes("encodePreview("), "inviteLink must attach the preview fragment");
  assert.ok(link.includes("?join="), "…without dropping ?join=");
  // cold-open criterion 7, existing behaviour: the id must outlive the
  // Google redirect, so it goes to settings and not the URL.
  assert.ok(SRC.includes("store.setSettings({ pendingJoin: joinId })"));
});

// What the app shows the person who tapped an invite link — and, in
// particular, what it shows them after they tap "Have a look around".
//
// The story exists to delete one screen: "No trips yet." above "Create
// your first trip", shown to somebody a friend has just promised a trip
// to. The invitation screen removed it from the FIRST thing they see.
// The second-chance path put it straight back: dismissing the invitation
// re-rendered a home screen that, with no trips, is exactly those two
// strings. the cold-open design note says the button "drops them into the converter",
// and the converter only existed reparented inside an open trip card.
//
// So the three surfaces are one decision, in one place, with one rule
// each: the invitation while there is one to accept; the converter when
// it has been waved away and this device has nothing of its own; the
// ordinary home screen otherwise.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { coldOpenView, lookAroundCodes } from "../js/coldopen.js";

const SRC = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");

// ---------- which surface ----------

test("an invitation nobody has answered yet is the whole screen", () => {
  assert.equal(coldOpenView({ show: "invitation", dismissed: false, tripCount: 0 }), "invitation");
  assert.equal(coldOpenView({ show: "generic", dismissed: false, tripCount: 0 }), "invitation");
  // Having trips of your own does not make an unanswered invitation
  // disappear — it is still the one question the person arrived with.
  assert.equal(coldOpenView({ show: "invitation", dismissed: false, tripCount: 3 }), "invitation");
});

test('"Have a look around" reaches the converter, never the empty state', () => {
  // THE BUG. This is the second-chance path for somebody not ready to
  // commit, and it used to hand them the exact screen AC1 names as the
  // failure. Both kinds of invitation take the same detour.
  assert.equal(coldOpenView({ show: "invitation", dismissed: true, tripCount: 0 }), "look-around");
  assert.equal(coldOpenView({ show: "generic", dismissed: true, tripCount: 0 }), "look-around");
});

test("somebody who already has trips gets their own home screen back", () => {
  // Their trips are not a demoralising screen, they are the point. The
  // look-around converter is only for a device with nothing in it.
  assert.equal(coldOpenView({ show: "invitation", dismissed: true, tripCount: 1 }), "home");
});

// ---------- the invitation has to come DOWN ----------
//
// THE BUG. The invitation was believed to expire with settings.pendingJoin
// — "clearing it, when the join finally lands, is what takes this screen
// back down". It does not. app.js reads `?join=` ONCE, at module scope,
// before boot() strips it out of the address bar, and hands that same id
// to invitationScreen() for the rest of the session. A joinId beats a
// cleared pendingJoin, so on the very load that does the joining the
// answer stays "invitation" for ever.
//
// Measured on the live tree at 375x812, in the exact state a successful
// link-join leaves behind: the invitation still occupied the top 378px of
// the page, "Join this trip" — which opens Settings — sat at y=122 over a
// trip already joined, and the page could not be scrolled far enough to
// clear it (scrollY 208 of a possible 207). `body.cold-open` was still
// applied, so the rates row, the trip search, the bell and the scan
// button stayed gone for the rest of the session.

test("an invitation whose trip is now on this device has been answered", () => {
  // Nothing is left to ask. "Join this trip" over a joined trip is a
  // stale call to action, and the cold-open chrome belongs to a decision
  // that has now been made.
  assert.equal(coldOpenView({ show: "invitation", dismissed: false, tripCount: 1, joined: true }), "home");
  assert.equal(coldOpenView({ show: "generic", dismissed: false, tripCount: 1, joined: true }), "home");
});

test("a join that has NOT landed keeps the invitation up", () => {
  // The three failure cases are the other half of the same screen: the
  // trip never arrives, so the invitation stays — and it is the surface
  // that has to explain itself.
  assert.equal(coldOpenView({ show: "invitation", dismissed: false, tripCount: 3, joined: false }), "invitation");
  assert.equal(coldOpenView({ show: "generic", dismissed: false, tripCount: 0, joined: false }), "invitation");
});

test("no invitation means nothing about the home screen changes", () => {
  for (const tripCount of [0, 1, 5]) {
    for (const dismissed of [false, true]) {
      assert.equal(coldOpenView({ show: "none", dismissed, tripCount }), "home",
        `show:none dismissed:${dismissed} trips:${tripCount}`);
    }
  }
  assert.equal(coldOpenView(), "home"); // and it never throws on nothing
});

test("the empty state is unreachable for anyone holding an invite link", () => {
  // Said as the property rather than the cases, because this is the one
  // thing the story is for: while there is an invitation on this device,
  // no path through these three surfaces reaches the ordinary empty home
  // screen. "home" with no trips IS "No trips yet."
  for (const show of ["invitation", "generic"]) {
    for (const dismissed of [false, true]) {
      // `joined` is included because a trip that landed is a trip in the
      // list — so it must never be the thing that produces an EMPTY home
      // screen, however it was worked out at the call site.
      for (const joined of [false, true]) {
        const view = coldOpenView({ show, dismissed, tripCount: 0, joined });
        assert.notEqual(view, "home",
          `show:${show} dismissed:${dismissed} joined:${joined} fell through to the empty state`);
      }
    }
  }
});

// ---------- what the converter shows with no trip ----------

test("the look-around converter always has something to convert between", () => {
  // One row converts nothing, and a converter that cannot convert is a
  // worse advertisement than the screen it replaced.
  for (const home of ["INR", "USD", "EUR", "JPY", "GBP"]) {
    for (const place of [null, "", "THB", home]) {
      const codes = lookAroundCodes({ homeCurrency: home, placeCode: place });
      assert.ok(codes.length >= 2, `${home}/${place} gave ${codes.length} row(s)`);
      assert.equal(codes[0], home, "the home currency leads, as it does everywhere else");
      assert.equal(new Set(codes).size, codes.length, `duplicate rows: ${codes}`);
    }
  }
});

test("where the device thinks it is becomes the second row", () => {
  // Same signal the HERE badge uses: a timezone, no permission prompt.
  assert.deepEqual(lookAroundCodes({ homeCurrency: "INR", placeCode: "THB" }), ["INR", "THB"]);
});

test("with nowhere to go it falls back to something, not to nothing", () => {
  assert.deepEqual(lookAroundCodes({ homeCurrency: "INR", placeCode: null }), ["INR", "USD"]);
  assert.deepEqual(lookAroundCodes({ homeCurrency: "USD", placeCode: "USD" }), ["USD", "EUR"]);
});

test("a missing home currency does not produce an empty converter", () => {
  const codes = lookAroundCodes({});
  assert.ok(codes.length >= 2, `expected rows, got ${JSON.stringify(codes)}`);
  assert.equal(new Set(codes).size, codes.length);
});

// ---------- the wiring in app.js (D7: assert it, don't assume it) ----------

test("the two strings the story deletes are hidden on the look-around screen too", () => {
  const line = (marker) => {
    const found = SRC.split("\n").find((l) => l.includes(marker));
    assert.ok(found, `expected app.js to contain ${marker}`);
    return found;
  };
  // "No trips yet." / "Create your first trip" live in #empty-state, and
  // #new-trip-btn is the same offer in a smaller font.
  assert.match(line('$("#empty-state").hidden'), /showingInvite\(\)/);
  assert.match(line('$("#empty-state").hidden'), /lookingAround\(\)/);
  assert.match(line('$("#new-trip-btn").hidden'), /showingInvite\(\)/);
  assert.match(line('$("#new-trip-btn").hidden'), /lookingAround\(\)/);
});

test("looking around actually reveals the converter", () => {
  // #panel-host is parked back into #main and hidden at the top of every
  // renderTrips, and only the open-trip-card branch ever un-hid it — so
  // with no trips there was no converter on the page at all. Assert the
  // branch exists, and that it does not offer Expenses, which need a trip.
  const body = SRC.slice(SRC.indexOf("function renderTrips()"),
    SRC.indexOf("\n}\n", SRC.indexOf("function renderTrips()")));
  assert.match(body, /lookingAround\(\)/, "renderTrips must handle the look-around surface");
  const branch = body.slice(body.indexOf("lookingAround()"));
  assert.match(branch, /panel\.hidden = false/, "the converter panel must be shown");
  assert.match(branch, /#trip-tabs"\)\.hidden = true/, "Expenses need a trip — don't offer the tab");
});

test("the converter has rows without a trip, and only while looking around", () => {
  const body = SRC.slice(SRC.indexOf("function visibleCodes()"),
    SRC.indexOf("\n}\n", SRC.indexOf("function visibleCodes()")));
  assert.match(body, /lookAroundCodes\(/, "visibleCodes is the one place rows are decided");
  assert.match(body, /lookingAround\(\)/, "…and an ordinary trip-less home screen still has none");
});

test("looking around is a detour, not a one-way door", () => {
  // AC7 also says the invitation is still there afterwards. It survives
  // the next launch by itself (settings.pendingJoin), but WITHIN the
  // session the dismissal used to be final: the invitation screen was
  // gone, the link had already been stripped out of the address bar, and
  // the only way back was the original chat message.
  const HTML = readFileSync(new URL("../index.html", import.meta.url), "utf8");
  assert.match(HTML, /id="look-around-back"[^>]*hidden/,
    "the way back must exist in the shell, hidden by default");
  const body = SRC.slice(SRC.indexOf("function renderTrips()"),
    SRC.indexOf("\n}\n", SRC.indexOf("function renderTrips()")));
  assert.match(body, /#look-around-back"\)\.hidden = !lookingAround\(\)/,
    "…and be offered on exactly the screen it belongs to");
  const at = SRC.indexOf('$("#look-around-back").addEventListener');
  assert.ok(at > 0, "the way back must be wired");
  const handler = SRC.slice(at, SRC.indexOf("});", at));
  assert.match(handler, /inviteDismissed = false/, "it must put the invitation back");
  assert.ok(!/setSettings\(|\bsave[A-Za-z]*\(|localStorage/.test(handler),
    "going back is not a decision either — it records nothing");
});

test("nothing about looking around is written down", () => {
  // A preview is a claim, and a detour is not a decision: the same link
  // must invite again on the next launch. `inviteDismissed` is the only
  // state involved and it is session-only.
  assert.match(SRC, /let inviteDismissed = false/);
  for (const line of SRC.split("\n")) {
    if (!/setSettings\(|\bsave[A-Za-z]*\(|localStorage/.test(line)) continue;
    assert.ok(!/inviteDismissed|lookingAround\(\)/.test(line),
      `looking around is being persisted: ${line.trim()}`);
  }
});

test("app.js works out `joined` from the trip being in hand, not from a flag", () => {
  // A flag set on the success path is a flag the failure paths forget —
  // which is how the invitation survived its own join. The trip being in
  // `trips` is not something anything has to remember to write down.
  const at = SRC.indexOf("coldOpenView({");
  assert.ok(at > 0, "app.js must ask coldopen.js which surface to show");
  const call = SRC.slice(at, SRC.indexOf("})", at));
  assert.match(call, /joined:/, "coldOpenView must be told whether the invitation was answered");
  assert.match(call, /trips\.some\(/, "…and that must be derived from the trip actually being here");
  assert.match(call, /tripId/, "…for the trip the invitation is about (invitelink.js decides which)");
});

test("the cold-open chrome comes back with the rest of the app", () => {
  // The rates row, trip search, the bell and the scan button are all
  // hidden by `body.cold-open` (styles.css). It is toggled in exactly one
  // place, from the same two helpers that decide the surface — so a
  // joiner cannot be left in cold-open chrome for the rest of the session.
  const hits = SRC.split("\n").filter((l) => l.includes('classList.toggle("cold-open"'));
  assert.equal(hits.length, 1, `body.cold-open is toggled in ${hits.length} places`);
  assert.match(hits[0], /showing|showingInvite\(\)/);
  assert.match(hits[0], /lookingAround\(\)/);
});

test("an expense cannot be started from a converter with no trip behind it", () => {
  // "+ Expense" prefills the expense editor from the current conversion,
  // and there is no ledger to put it in.
  const line = SRC.split("\n").find((l) => l.includes('$("#to-expense").hidden'));
  assert.ok(line, "expected app.js to hide #to-expense");
  assert.match(line, /activeTrip\(\)/);
});

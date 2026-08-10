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
import { coldOpenView, inviteStanding, lookAroundCodes, promptCount, nextPrompts, INVITE_PROMPTS } from "../js/coldopen.js";

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

// ---------- the invitation has to STOP ASKING ----------
//
// THE OTHER HALF, found in sprint 2's sign-off. Everything above is about
// one launch. Across launches the invitation never went away at all:
// somebody who taps a link and does not sign in gets it on EVERY launch,
// with `body.cold-open` taking away the search box, the filter chips, the
// bell, the scanner, the rates row and the New trip button, and their own
// trips visible underneath it. The one-tap escape is session-only by
// design (a detour is not a decision), so it comes straight back.
//
// So the question is asked a fixed number of times and then dropped. What
// is written down is how many times the app ASKED — never that anybody
// dismissed it, which is the assertion at the bottom of this file and
// which does not move.

test("an invitation still worth asking about is still asked", () => {
  assert.equal(coldOpenView({ show: "invitation", shown: 0 }), "invitation");
  assert.equal(coldOpenView({ show: "invitation", shown: 2 }), "invitation");
});

test("after three launches the app stops asking and gives itself back", () => {
  // Three, not one: an invitation somebody has not got round to is worth
  // repeating. Three, not for ever: at some point the honest reading is
  // that they are not going to, and the app is holding a screen they
  // cannot make go away over the app they came to use.
  assert.equal(coldOpenView({ show: "invitation", shown: 3, tripCount: 2 }), "home");
  assert.equal(coldOpenView({ show: "invitation", shown: 9, tripCount: 0 }), "look-around");
});

test("opening the link again is somebody asking again", () => {
  // The only signal that outranks the count, and it is deliberately
  // blunt: a URL carrying ?join= on THIS launch means the person has
  // just tapped the invitation, whatever this device decided before.
  assert.equal(coldOpenView({ show: "invitation", shown: 9, fromLink: true }), "invitation");
  assert.equal(coldOpenView({ show: "generic", shown: 9, fromLink: true }), "invitation");
});

test("a count cannot resurrect an invitation that was answered", () => {
  // `joined` still comes first. The count is about a question nobody has
  // answered; this one has been.
  assert.equal(coldOpenView({ show: "invitation", shown: 9, joined: true, tripCount: 1 }), "home");
  assert.equal(coldOpenView({ show: "invitation", shown: 0, joined: true, tripCount: 1 }), "home");
});

test("the invitation asks exactly three times, then leaves", () => {
  // The property rather than the cases: this is the whole story, and it
  // is the composition of the two functions — neither one of them alone
  // can be read as "asks three times".
  let record = null;
  const views = [];
  for (let launch = 0; launch < 6; launch++) {
    const shown = promptCount(record, "t1");
    const view = coldOpenView({ show: "invitation", tripCount: 1, shown });
    views.push(view);
    record = nextPrompts(record, { tripId: "t1", asked: view === "invitation" });
  }
  assert.deepEqual(views,
    ["invitation", "invitation", "invitation", "home", "home", "home"]);
  assert.equal(record.shown, INVITE_PROMPTS,
    "the count stops climbing once the app has stopped asking");
  assert.equal(INVITE_PROMPTS, 3);
});

test("tapping the link again starts the three over", () => {
  let record = { tripId: "t1", shown: 9 };
  const view = coldOpenView({ show: "invitation", tripCount: 1,
    shown: promptCount(record, "t1"), fromLink: true });
  assert.equal(view, "invitation");
  record = nextPrompts(record, { tripId: "t1", asked: true, fromLink: true });
  assert.deepEqual(record, { tripId: "t1", shown: 1 },
    "the launch that carried the link is the first of the new three");
});

// ---------- what is counted, and against which invitation ----------

test("the count belongs to one invitation, not to the device", () => {
  assert.equal(promptCount({ tripId: "t1", shown: 2 }, "t1"), 2);
  // A different trip is a different question, asked by a different
  // person: it gets its own three.
  assert.equal(promptCount({ tripId: "t1", shown: 2 }, "t2"), 0);
  assert.equal(promptCount(null, "t1"), 0);
  assert.equal(promptCount({ tripId: "t1", shown: 2 }, null), 0);
  // Settings survive from older builds and can be edited by hand.
  assert.equal(promptCount({ tripId: "t1", shown: "lots" }, "t1"), 0);
  assert.equal(promptCount("nonsense", "t1"), 0);
  assert.equal(promptCount(), 0);
});

test("only a launch that actually asked is counted", () => {
  // renderInvitation() and renderTrips() run many times in a launch. The
  // thing being counted is launches, so the count moves once, at the
  // moment the surface for this launch is decided.
  assert.deepEqual(nextPrompts(null, { tripId: "t1", asked: true }), { tripId: "t1", shown: 1 });
  assert.deepEqual(nextPrompts({ tripId: "t1", shown: 2 }, { tripId: "t1", asked: true }),
    { tripId: "t1", shown: 3 });
  // Past the cap the app is no longer asking — and the count must SURVIVE
  // that, or the next launch reads zero and asks all over again.
  assert.deepEqual(nextPrompts({ tripId: "t1", shown: 3 }, { tripId: "t1", asked: false }),
    { tripId: "t1", shown: 3 });
});

test("nothing is remembered about an invitation that is over", () => {
  // No invitation on this device at all, and an invitation that has been
  // answered, both leave nothing behind: a count kept for a trip already
  // joined is a count that would silence the next link for it.
  assert.equal(nextPrompts({ tripId: "t1", shown: 2 }, { tripId: null, asked: false }), null);
  assert.equal(nextPrompts({ tripId: "t1", shown: 2 },
    { tripId: "t1", answered: true, asked: false }), null);
  assert.equal(nextPrompts(null, {}), null);
  assert.equal(nextPrompts(), null);
});

test("a second invitation is counted from zero, not from the first one's total", () => {
  assert.deepEqual(nextPrompts({ tripId: "t1", shown: 9 }, { tripId: "t2", asked: true }),
    { tripId: "t2", shown: 1 });
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
  // …and be offered on exactly the screen it belongs to — which is the
  // look-around converter WHILE there is still an invitation behind it.
  // Past the third launch the same converter is an ordinary home screen,
  // the invitation is over, and this button was on screen doing nothing.
  assert.match(body, /#look-around-back"\)\.hidden = !\(lookingAround\(\) && inviteUp\(\)\)/);
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

// ---------- counting the asks (the wiring, which is the risky half) ----------

test("the count is written in exactly one place, and that place is boot()", () => {
  // Once per LAUNCH. renderInvitation() and renderTrips() both run many
  // times in a single launch — renderTrips calls renderInvitation, every
  // sync repaints, every sheet close repaints — so a counter incremented
  // in either would burn its three asks before the first paint settled.
  const lines = SRC.split("\n");
  const writes = lines.filter((l) => /invitePrompts\s*[:=][^=]/.test(l));
  assert.equal(writes.length, 1,
    `invitePrompts is written on ${writes.length} lines:\n${writes.join("\n")}`);
  assert.match(writes[0], /nextPrompts\(/, "what to remember is js/coldopen.js's decision");

  const boot = SRC.slice(SRC.indexOf("function boot()"),
    SRC.indexOf("\n}\n", SRC.indexOf("function boot()")));
  assert.ok(boot.includes(writes[0].trim()), "the one write belongs in boot()");
  for (const fn of ["function renderInvitation()", "function renderTrips()"]) {
    const body = SRC.slice(SRC.indexOf(fn), SRC.indexOf("\n}\n", SRC.indexOf(fn)));
    assert.ok(!/invitePrompts/.test(body), `${fn} must not touch the counter`);
  }
});

test("counting the asks cannot disturb the join", () => {
  // settings.pendingJoin is what makes the invitation survive a reload
  // and what the single join path in syncNow reads. The counter shares a
  // settings record with it and must not so much as mention it: the trip
  // stays joinable on the fourth launch and every launch after it, the
  // app has just stopped asking about it.
  const write = SRC.split("\n").find((l) => /invitePrompts\s*[:=][^=]/.test(l));
  assert.ok(write, "expected app.js to write invitePrompts");
  assert.ok(!/pendingJoin/.test(write), `the counter also writes pendingJoin: ${write.trim()}`);
});

test("the surface is told the count and where this launch came from", () => {
  const at = SRC.indexOf("coldOpenView({");
  const call = SRC.slice(at, SRC.indexOf("})", at));
  assert.match(call, /shown:/, "coldOpenView must know how many times it has asked");
  assert.match(call, /fromLink:/, "…and whether this launch carried the link");
  // From the URL of THIS launch, not from settings.pendingJoin — which
  // outlives the URL by design and would therefore mean "there is an
  // invitation", i.e. exactly the state the count exists to end.
  assert.match(call, /fromLink: !!linkJoinId/);
});

test("the count is frozen for the launch, not re-read after it is written", () => {
  // boot() writes the incremented count before the app has finished
  // painting. If coldOpen() read storage each time, the third launch
  // would count itself and then decide it had already asked three times
  // — the invitation would be counted and never shown.
  const at = SRC.indexOf("coldOpenView({");
  const call = SRC.slice(at, SRC.indexOf("})", at));
  assert.ok(!/settings\.invitePrompts/.test(call),
    "the surface must read the launch's frozen count, not the record it is about to overwrite");
});

test("the app is whole again once it has stopped asking", () => {
  // `body.cold-open` is what takes the app away, and it is toggled from
  // showingInvite() || lookingAround() alone (asserted above). So the
  // view being "home" IS the chrome coming back — provided these are the
  // things cold-open hides, which is what the second half checks.
  assert.equal(coldOpenView({ show: "invitation", shown: INVITE_PROMPTS, tripCount: 1 }), "home");
  const CSS = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  for (const id of ["#signed-out-strip", "#status-row", "#trip-tools", "#bell-btn", "#scan-btn"]) {
    assert.match(CSS, new RegExp(`\\.cold-open ${id}[,\\s]`),
      `${id} is hidden by something other than .cold-open`);
  }
  // …and the New trip button, which is hidden in js/app.js instead.
  const line = SRC.split("\n").find((l) => l.includes('$("#new-trip-btn").hidden'));
  assert.match(line, /showingInvite\(\)/);
  assert.match(line, /lookingAround\(\)/);
});

// ---------- …including for the person the story is about ----------
//
// THE BUG, and it is the other half of the one above. "The app is whole
// again" was written against the SURFACE — `body.cold-open` came from
// `showingInvite() || lookingAround()` — and the look-around converter is
// two different screens wearing one name. While the invitation is still
// up it is a preview, with a way back to the invitation, and the app
// standing aside for it is right. Once the app has stopped asking it is
// this device's ordinary home screen, and standing aside is for ever.
//
// Measured on the live tree, fourth launch after `?join=`, no sign-in and
// no trip: `body.className === "cold-open"`, and #trip-tools, #bell-btn,
// #scan-btn, #status-row, #signed-out-strip, #empty-state and
// #new-trip-btn all computed `display: none`. `invitePrompts` was frozen
// at `{shown:3}`, so every later launch was identical — no gesture
// anywhere on the page could create a trip, and "Back to the invitation"
// was on screen doing nothing, because there was no invitation left to
// go back to.
//
// So which surface is up and whether the app is standing aside for the
// invitation are two questions, and only the first of them was asked.

test("the app stops standing aside when it stops asking", () => {
  // The invitation itself, obviously.
  assert.equal(inviteStanding({ view: "invitation", shown: 0 }), true);
  assert.equal(inviteStanding({ view: "invitation", shown: 9, fromLink: true }), true);
  // The detour away from a live invitation: still a preview, and the way
  // back to the invitation is still on the page.
  assert.equal(inviteStanding({ view: "look-around", shown: 0 }), true);
  assert.equal(inviteStanding({ view: "look-around", shown: INVITE_PROMPTS - 1 }), true);
  // The same converter once the app has stopped asking is not a preview
  // of anything — it is where this device now opens.
  assert.equal(inviteStanding({ view: "look-around", shown: INVITE_PROMPTS }), false);
  assert.equal(inviteStanding({ view: "look-around", shown: 9 }), false);
  // …unless the person has just tapped the link again, which is the one
  // signal that outranks the count everywhere else too.
  assert.equal(inviteStanding({ view: "look-around", shown: 9, fromLink: true }), true);
  // The ordinary home screen never was the cold open.
  assert.equal(inviteStanding({ view: "home", shown: 0 }), false);
  assert.equal(inviteStanding({ view: "home", shown: 0, fromLink: true }), false);
  assert.equal(inviteStanding(), false);
});

test("a visitor with no trips of their own gets the app back too", () => {
  // The property, over launches, for the exact person this story is
  // written about: arrived from a friend's link, did not sign in, has no
  // trips. They keep the converter — that is the win, and AC6 — and the
  // app around it comes back on the same launch it comes back for
  // everybody else.
  let record = null;
  const launches = [];
  for (let launch = 0; launch < 6; launch++) {
    const shown = promptCount(record, "t1");
    const view = coldOpenView({ show: "invitation", tripCount: 0, shown });
    launches.push([view, inviteStanding({ view, shown })]);
    record = nextPrompts(record, { tripId: "t1", asked: view === "invitation" });
  }
  assert.deepEqual(launches, [
    ["invitation", true], ["invitation", true], ["invitation", true],
    ["look-around", false], ["look-around", false], ["look-around", false],
  ], "the converter stays; the app standing aside for the invitation does not");
});

test("the three lines that take the app away are guarded by the invitation, not the surface", () => {
  // D7: assert the wiring. Each of these was written against
  // lookingAround() alone, which is true on both look-around screens.
  const line = (marker) => {
    const found = SRC.split("\n").find((l) => l.includes(marker));
    assert.ok(found, `expected app.js to contain ${marker}`);
    return found;
  };
  for (const marker of ['classList.toggle("cold-open"', '$("#empty-state").hidden',
    '$("#look-around-back").hidden']) {
    assert.match(line(marker), /inviteUp\(\)/,
      `${marker} still takes the app away on a look-around screen with no invitation behind it`);
  }
  // …and that guard is coldopen.js's decision, not the same rule written
  // out a second time in app.js, which is how it drifts.
  const def = SRC.split("\n").find((l) => /const inviteUp =/.test(l));
  assert.ok(def, "expected app.js to define inviteUp");
  assert.match(def, /inviteStanding\(/);
  assert.ok(!/INVITE_PROMPTS/.test(SRC), "app.js must not count the asks itself");
});

test("there is no way back to an invitation that is over", () => {
  // "Back to the invitation" sets inviteDismissed = false and repaints.
  // Past the third launch that changes nothing at all — the button was
  // on screen, and pressing it did nothing. Measured.
  assert.equal(coldOpenView({ show: "invitation", dismissed: false, tripCount: 0, shown: 3 }),
    "look-around");
  assert.equal(inviteStanding({ view: "look-around", shown: 3 }), false);
});

test("one phone's three launches do not silence another", () => {
  // The count is about a screen this device has already shown. Syncing
  // it would mean a laptop that was opened three times takes the
  // invitation off the phone the link was actually tapped on.
  const PREFS = readFileSync(new URL("../js/prefs.js", import.meta.url), "utf8");
  const list = PREFS.slice(PREFS.indexOf("export const SYNCED_SETTINGS"),
    PREFS.indexOf("];", PREFS.indexOf("export const SYNCED_SETTINGS")));
  assert.ok(!/invitePrompts/.test(list), "invitePrompts must stay device-local");
});

test("an expense cannot be started from a converter with no trip behind it", () => {
  // "+ Expense" prefills the expense editor from the current conversion,
  // and there is no ledger to put it in.
  const line = SRC.split("\n").find((l) => l.includes('$("#to-expense").hidden'));
  assert.ok(line, "expected app.js to hide #to-expense");
  assert.match(line, /activeTrip\(\)/);
});

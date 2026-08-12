// What an attempted join concludes — and what app.js is allowed to do
// with that conclusion.
//
// Two demonstrated defects live here, both on the highest-leverage path
// in the product (the cold-open design note — the first thirty seconds of
// somebody who tapped an invite link in WhatsApp):
//
//  1. joinTrip never checked whether the trip was a TOMBSTONE. Firestore
//     answers a deleted trip with `{deleted:true, invitedEmails:[…]}` —
//     a real document, readable, and `joinIfInvited` cheerfully adds our
//     uid to it. The return value was discarded, so `hasJoined` was set,
//     `count("joined")` fired, and Settings said "Shared trip added."
//     for a trip that does not exist. That last part is not cosmetic:
//     `joined` is the acceptance number the whole growth loop is judged
//     on, so a false success does not merely mislead a person, it
//     poisons the measurement that decides what gets built next.
//
//  2. Every invitation that can NEVER succeed was retried for ninety
//     days. The wrong-address branch set a hint line and left
//     `settings.pendingJoin` in place, so the refused read ran again on
//     every single sync, for ever, saying the same thing each time.
//
// Hence the shape of joinOutcome: one pure function, five conclusions,
// and `clearPending` says out loud whether this attempt can ever work.
// A judgement written inline in app.js is a judgement that gets written
// twice — the invite index and the invite link are two call sites, and
// they have already drifted apart once (the query path demanded a
// verified address and the link path didn't).

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { joinOutcome, nextStep, addressRequest, GONE, NOT_VERIFIED, UNREACHABLE } from "../js/joining.js";
import { syncErrorMessage } from "../js/firestore.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP = readFileSync(join(ROOT, "js/app.js"), "utf8");
const HTML = readFileSync(join(ROOT, "index.html"), "utf8");
// Comments are allowed to NAME the bugs below — that is most of what
// they are for — so the "how many times is this called" assertions read
// the code only. (Crude on purpose: it also truncates "https://…" inside
// strings, which none of these assertions care about.)
const CODE = APP.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");

const asha = { uid: "A", email: "asha@example.com", emailVerified: true };
const live = (over = {}) => ({
  schema: 1,
  trip: { id: "t1", name: "Goa" },
  memberUids: ["Z"],
  invitedEmails: ["asha@example.com"],
  ...over,
});

// ---------- the false success ----------

test("a tombstoned trip is gone, and says so — it is not a join", () => {
  assert.deepEqual(
    joinOutcome({ payload: { deleted: true, deletedAt: 1 }, account: asha }),
    { do: "gone", clearPending: true, say: "This trip isn't available any more." }
  );
});

test("a tombstone still carrying our invitation is still gone", () => {
  // This is the exact document Firestore returns for a deleted trip:
  // tombstonePayload() preserves invitedEmails, because the rules refuse
  // any write that drops an existing member. So "am I invited?" is TRUE
  // on a trip that no longer exists — which is precisely how the old
  // code talked itself into a join.
  const out = joinOutcome({
    payload: { deleted: true, deletedAt: 1, memberUids: ["Z"], invitedEmails: ["asha@example.com"] },
    account: asha,
  });
  assert.equal(out.do, "gone");
  assert.equal(out.clearPending, true);
});

test("a trip that isn't there at all is gone too", () => {
  assert.deepEqual(
    joinOutcome({ payload: null, account: asha }),
    { do: "gone", clearPending: true, say: "This trip isn't available any more." }
  );
});

test("a readable trip we were never invited to is gone, not an error", () => {
  // No blame, no dead end — the cold-open failure table's third row deliberately gives the
  // same sentence to "deleted" and "not actually invited", because from
  // the outside they are the same thing and neither is the reader's fault.
  const out = joinOutcome({ payload: live({ invitedEmails: ["bo@example.com"] }), account: asha });
  assert.equal(out.do, "gone");
  assert.equal(out.clearPending, true);
});

test("a live invitation for a verified address is a join", () => {
  assert.equal(joinOutcome({ payload: live(), account: asha }).do, "join");
});

test("someone who is already a member joins without being re-invited", () => {
  const out = joinOutcome({
    payload: live({ memberUids: ["A"], invitedEmails: [] }),
    account: { ...asha, emailVerified: false },
  });
  assert.equal(out.do, "join");
});

// ---------- the endless retry ----------

test("a refused read means the wrong address, and it can never succeed", () => {
  const out = joinOutcome({
    error: { code: "permission-denied" },
    account: { uid: "R", email: "rahul@example.com", emailVerified: true },
  });
  assert.equal(out.do, "wrong-address");
  assert.equal(out.clearPending, true);
  assert.ok(out.say.includes("rahul@example.com"), `no address in: ${out.say}`);
});

test("the wrong-address sentence survives an account with no address", () => {
  // Never render the word "undefined" at somebody who just tapped a link.
  const out = joinOutcome({ error: { code: "permission-denied" }, account: null });
  assert.equal(out.do, "wrong-address");
  assert.ok(out.say.length > 0);
  assert.ok(!/undefined|null/.test(out.say), out.say);
});

test("not yet verified keeps the invitation — that one can still succeed", () => {
  const out = joinOutcome({ payload: live(), account: { ...asha, emailVerified: false } });
  assert.equal(out.do, "verify");
  assert.equal(out.clearPending, false);
  assert.equal(out.say, NOT_VERIFIED);
});

test("being offline keeps the invitation too", () => {
  const out = joinOutcome({ error: { code: "unavailable" }, account: asha });
  assert.equal(out.do, "unreachable");
  assert.equal(out.clearPending, false);
  assert.equal(out.say, UNREACHABLE);
});

test("a refused WRITE is not a wrong address — we had just read the trip", () => {
  // Reaching the write means the read succeeded, so we are a member or
  // an invitee on this very document. A refusal here is the rules being
  // older than this client (the normal state until firestore.rules is
  // republished), not the person being signed in as somebody else.
  // Telling them to switch accounts would send them somewhere useless.
  const out = joinOutcome({ error: { code: "permission-denied" }, stage: "write", account: asha });
  assert.notEqual(out.do, "wrong-address");
  assert.equal(out.clearPending, false);
});

// ---------- three sentences, all different, none of them database talk ----------

test("the three failure cases say three different things", () => {
  const wrong = joinOutcome({ error: { code: "permission-denied" }, account: asha }).say;
  const verify = joinOutcome({ payload: live(), account: { ...asha, emailVerified: false } }).say;
  const gone = joinOutcome({ payload: null, account: asha }).say;
  const said = [wrong, verify, gone];
  for (const s of said) assert.ok(s && s.trim().length > 0, `empty sentence: ${JSON.stringify(s)}`);
  assert.equal(new Set(said).size, 3, `sentences collided: ${JSON.stringify(said)}`);
  assert.equal(gone, GONE);
});

test("none of them is the database's own excuse", () => {
  // "The database turned this down — its access rules may not be set up
  // yet" is a sentence about OUR infrastructure. The person reading it
  // tapped a link a friend sent them in WhatsApp and has never heard of
  // TripCash. It is the single least useful thing we could say.
  const db = syncErrorMessage("permission-denied");
  for (const input of [
    { error: { code: "permission-denied" }, account: asha },
    { payload: live(), account: { ...asha, emailVerified: false } },
    { payload: null, account: asha },
  ]) {
    assert.notEqual(joinOutcome(input).say, db);
  }
});

test("only a join is a join", () => {
  const dos = [
    joinOutcome({ payload: null, account: asha }).do,
    joinOutcome({ error: { code: "permission-denied" }, account: asha }).do,
    joinOutcome({ error: { code: "unavailable" }, account: asha }).do,
    joinOutcome({ payload: live(), account: { ...asha, emailVerified: false } }).do,
  ];
  assert.ok(!dos.includes("join"), `a failure claimed success: ${dos.join(", ")}`);
});

test("it never throws, whatever it is handed", () => {
  // It runs on the cold-open path, where the only alternative to an
  // answer is a silent app.
  for (const input of [undefined, {}, { payload: 7 }, { account: 3 }, { error: "boom" },
                       { payload: { invitedEmails: null, memberUids: null }, account: asha }]) {
    const out = joinOutcome(input);
    assert.equal(typeof out.do, "string");
    assert.equal(typeof out.clearPending, "boolean");
  }
});

// ---------- a sentence with nothing to do about it is a dead end ----------
//
// cold-open acceptance criterion 5: "Each of the three failure cases produces its own
// sentence and a next step." The sentences existed; not one of them had a
// next step, and the wrong-address case — the one where the person is
// most obviously stuck — offered nothing at all.

test("every conclusion that is not a join offers something to do next", () => {
  for (const outcome of [
    joinOutcome({ payload: null, account: asha }),                                   // gone
    joinOutcome({ error: { code: "permission-denied" }, account: asha }),            // wrong address
    joinOutcome({ error: { code: "unavailable" }, account: asha }),                  // unreachable
    joinOutcome({ payload: live(), account: { ...asha, emailVerified: false } }),    // verify
  ]) {
    const step = nextStep(outcome);
    assert.ok(step, `${outcome.do} is a dead end`);
    assert.ok(step.label && step.label.trim().length > 0, `${outcome.do} has an unlabelled button`);
    assert.ok(step.action && step.action.trim().length > 0, `${outcome.do} has a button that does nothing`);
  }
});

test("a join needs no next step — the trip IS the next step", () => {
  assert.equal(nextStep(joinOutcome({ payload: live(), account: asha })), null);
  assert.equal(nextStep(null), null);
  assert.equal(nextStep({}), null);
});

test("the three failure cases offer three different next steps", () => {
  // the cold-open failure table, one row at a time: add this address / resend /
  // offer the converter. A single generic "Try again" for all three is
  // the same dead end wearing a button.
  const steps = [
    nextStep({ do: "wrong-address" }),
    nextStep({ do: "verify" }),
    nextStep({ do: "gone" }),
  ];
  assert.equal(new Set(steps.map((s) => s.action)).size, 3, JSON.stringify(steps));
  assert.equal(new Set(steps.map((s) => s.label)).size, 3, JSON.stringify(steps));
});

test("asking to be added names the address the person is actually using", () => {
  const text = addressRequest({ email: "Rahul@Example.com ", tripName: "Goa" });
  assert.match(text, /rahul@example\.com/);
  assert.match(text, /Goa/);
});

test("the request survives an unknown address and an unnamed trip", () => {
  // The trip name is a claim carried by the link and may be missing
  // entirely (a generic invitation), and an account may report no
  // address. Neither may put "undefined" into a message somebody sends
  // to a friend.
  for (const args of [{}, { email: "" }, { tripName: "Goa" }, { email: "bo@example.com" },
                      { email: null, tripName: null }]) {
    const text = addressRequest(args);
    assert.ok(text.trim().length > 0, `empty message for ${JSON.stringify(args)}`);
    assert.ok(!/undefined|null/.test(text), text);
  }
});

// ---------- where the sentence lands ----------
//
// THE BUG. All three sentences were handed to renderAccount(), which
// writes them to `#sync-note` — a <p> inside <dialog id="settings-sheet">,
// closed. Nothing on the join path opens that sheet, and there was no
// notice either. So an already-signed-in device (the commonest device to
// receive a second invite link) got a toast promising "Opening the trip
// shared with you…" 900ms after launch and then silence for ever, under
// an invitation screen still offering to join a trip that is gone.

// Every id that lives inside a <dialog>, i.e. every id that is invisible
// unless something opens the sheet it is in.
function idsInsideDialogs(html) {
  const ids = new Set();
  for (const [block] of html.matchAll(/<dialog\b[\s\S]*?<\/dialog>/g)) {
    for (const m of block.matchAll(/\bid="([^"]+)"/g)) ids.add(m[1]);
  }
  return ids;
}

test("the failure is said on the page, not into a closed sheet", () => {
  const buried = idsInsideDialogs(HTML);
  assert.ok(buried.has("sync-note"),
    "scanner sanity: #sync-note is inside the settings sheet — that is the bug");
  assert.ok(HTML.includes('id="invite-problem"'),
    "the invitation screen needs somewhere to say what went wrong");
  assert.ok(!buried.has("invite-problem"), "#invite-problem must not be inside a dialog");
  assert.ok(HTML.includes('id="invite-next"'), "…and the next step needs a button");
  assert.ok(!buried.has("invite-next"), "#invite-next must not be inside a dialog");
  assert.match(CODE, /#invite-problem"\)/, "app.js must write the outcome's sentence there");
  assert.match(CODE, /#invite-next"\)/, "app.js must offer the next step there");
});

test("the stale “Join this trip” button goes when the join has failed", () => {
  // It opens Settings. Offering it for a trip that is gone, or for an
  // invitation sent to an address this device is not signed in as, is the
  // app asking the person to do again the thing that just failed.
  const at = CODE.indexOf("function renderInvitation()");
  assert.ok(at > 0, "could not find renderInvitation");
  const body = CODE.slice(at, CODE.indexOf("\n}\n", at));
  assert.match(body, /#invite-join"\)\.hidden/, "the Join button must be hidden on a failure");
});

test("the invite-link path says it out loud, and leaves a record", () => {
  // Three surfaces, because each covers the other's gap: the invitation
  // screen (which is what is in front of this person), a toast (in case
  // they took the look-around detour while the sync was in flight), and
  // a notice, which is the only one that survives a reload.
  const from = CODE.indexOf("const pending = state.settings.pendingJoin");
  const to = CODE.indexOf("if (needsVerify)");
  assert.ok(from > 0 && to > from, "could not locate the invite-link block in app.js");
  const region = CODE.slice(from, to);
  assert.match(region, /toast\(/, "a failed join must say so where the person is looking");
  assert.match(region, /noteEvents\(/, "…and leave something that outlives the toast");
  assert.match(region, /outcome\.say|joinProblem/, "…in the module's words, not a second set");
});

test("a join notice cannot be pruned away by the trip that never arrived", () => {
  // syncNow ends with pruneNotices(notices, trips.map(t => t.id)), which
  // drops any notice whose tripId is not a trip we hold. A "this trip
  // isn't available any more" notice filed under the dead trip's id would
  // be deleted a few lines after it was written. ACCOUNT_SCOPE survives.
  const from = CODE.indexOf("const pending = state.settings.pendingJoin");
  const to = CODE.indexOf("if (needsVerify)");
  const region = CODE.slice(from, to);
  const at = region.indexOf("noteEvents(");
  assert.ok(at > 0, "no notice on the invite-link path");
  assert.match(region.slice(at, at + 400), /ACCOUNT_SCOPE/,
    "file it against the account, or pruneNotices deletes it moments later");
});

test("every next step app.js can be handed actually goes somewhere", () => {
  for (const conclusion of ["wrong-address", "verify", "gone", "unreachable"]) {
    const { action } = nextStep({ do: conclusion });
    assert.ok(CODE.includes(`"${action}"`),
      `nothing in app.js handles the "${action}" next step (from ${conclusion})`);
  }
});

test("asking for another verification mail is one piece of code", () => {
  // Firebase rate-limits these hard and tapping repeatedly is the natural
  // response to an email that has not arrived — so the cooldown is the
  // whole point, and a second copy of this in the invitation screen would
  // be a second cooldown that knows nothing about the first.
  const hits = [...CODE.matchAll(/await sendVerification\(\)/g)];
  assert.equal(hits.length, 1, `the resend is asked for in ${hits.length} places in app.js`);
  assert.equal([...CODE.matchAll(/let verifyReadyAt/g)].length, 1,
    "one cooldown, not one per button");
  assert.equal([...CODE.matchAll(/verifyReadyAt = Date\.now\(\)/g)].length, 2,
    "…armed on both answers, or a failure lets the next tap through immediately");
});

// ---------- the wiring, which is where every one of these bugs lived ----------

test("app.js decides nothing about joining on its own", () => {
  assert.ok(APP.includes('from "./joining.js"'), "app.js must import the decision");
  assert.ok(/joinOutcome\(/.test(APP), "app.js must call joinOutcome");
});

test('count("joined") happens once, and only behind a trip that really landed', () => {
  const hits = [...CODE.matchAll(/count\("joined"\)/g)];
  assert.equal(hits.length, 1, `count("joined") is called ${hits.length} times`);
  const before = CODE.slice(Math.max(0, hits[0].index - 900), hits[0].index);
  assert.ok(
    before.includes("!state.trips.some((t) => t.id === id)"),
    "count(\"joined\") must be guarded by the trip actually being in `trips`"
  );
  assert.ok(
    before.includes('do: "gone"'),
    "the guard must RETURN gone rather than fall through to the count"
  );
});

test("an outcome that can never succeed clears pendingJoin", () => {
  // The whole of defect 2: the wrong-address catch set a hint line and
  // left pendingJoin alone, so the refused read repeated on every sync.
  assert.ok(
    /outcome\.clearPending[\s\S]{0,200}pendingJoin: null/.test(APP),
    "the invite-link block must clear pendingJoin from the outcome, not from a success"
  );
});

test("a join reached by link OPENS the trip", () => {
  // The cold-open rule: "The trip must be the next thing they see." A toast with
  // a tap-to-open action is one more thing to find, on the one screen
  // where nothing may be left to find.
  assert.ok(
    /openedFromLink[\s\S]{0,400}activeTripId/.test(APP) ||
    /activeTripId: pending/.test(APP),
    "the invite-link join must set activeTripId to the joined trip"
  );
});

test("nothing on this path swallows an error in silence", () => {
  // Bare `catch {}` cost this project two round trips of diagnosis
  // (receipts, sync). On the invite path it cost ninety days of retries.
  const from = CODE.indexOf("const joinTrip = async");
  const to = CODE.indexOf("if (needsVerify)");
  assert.ok(from > 0 && to > from, "could not locate the join path in app.js");
  const region = CODE.slice(from, to);
  assert.ok(
    !/\.catch\(\s*\([^)]*\)\s*=>\s*\{\s*\}\s*\)/.test(region),
    "a .catch(() => {}) on the join path — the dropInvites failure that made this story exist was invisible for exactly this reason"
  );
  assert.ok(!/catch\s*(\([^)]*\))?\s*\{\s*\}/.test(region), "empty catch block");
});

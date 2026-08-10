// Which of the three opening surfaces the app shows, and what the
// converter has in it when there is no trip. Pure; app.js does the io.
//
// WHY THIS IS A MODULE AND NOT A COUPLE OF IFS INSIDE renderTrips():
//
// The whole cold open exists to delete one screen — "No trips yet."
// above "Create your first trip", shown to somebody a friend has just
// promised a trip to. The invitation screen removed it from the FIRST
// thing they see, and the second-chance path put it straight back:
// "Have a look around" called renderInvitation() + renderTrips(), and
// renderTrips with no trips IS those two strings, plus the not-signed-in
// banner and the rates chip that the same spec calls furniture.
//
// The rule "the empty home screen is unreachable from an invite link"
// was therefore written in one place (the invitation) and not the other
// (the detour away from it), which is this project's oldest shape of
// bug. It is now one function, and every path through it is asserted in
// tests/coldopen.test.mjs.
//
// the cold-open design note says the button "drops them into the converter" — the
// app's genuinely useful daily surface, which needs no account, no trip
// and no network. But the converter only exists reparented inside an
// open trip card, so with no trips there was nothing to reveal. Hence
// lookAroundCodes(): what the converter shows when no trip is choosing
// for it.

// A converter with one row converts nothing, and a converter that cannot
// convert is a worse advertisement than the screen it replaced. These
// are only ever reached when the device has told us nothing about where
// it is; the order is "most likely to be recognised by anyone".
const FALLBACKS = ["USD", "EUR", "GBP"];
const DEFAULT_HOME = "USD";

// How many launches an unanswered invitation is worth.
//
// Three, and the two directions it is balanced against are both real.
// One would mean a person who tapped a link on the bus, put the phone
// away and opened the app that evening never sees the invitation again.
// For ever — which is what shipped — means somebody who is not going to
// sign in has a screen they cannot dismiss sitting over their own trips,
// with the search box, the filter chips, the bell, the scanner, the
// rates row and the New trip button all taken away by `body.cold-open`,
// on every launch, until they delete the app.
export const INVITE_PROMPTS = 3;

// `show` is invitationScreen()'s verdict (js/invitelink.js): "invitation"
// when the link named the trip, "generic" when it did not, "none" when
// there is no invitation on this device at all.
//
// `dismissed` is session-only, deliberately: a detour is not a decision,
// so the same link invites again on the next launch.
//
// `shown` is how many launches this device has ALREADY opened on this
// invitation — never how many times it was waved away. That distinction
// is the whole ethic of this file: what is written down is the app's own
// behaviour, so the person is never recorded as having decided anything.
//
// `fromLink` is whether THIS launch's URL carried ?join=. It outranks the
// count, bluntly and on purpose: tapping the link again is somebody
// asking again, and an app that answered "you've had your three" to a
// live tap would be wrong in the one case it can actually be sure about.
//
// `joined` is the invitation being ANSWERED: the trip it named is on this
// device now. It is deliberately not a flag anybody sets — the caller
// looks for the trip (invitationScreen tells it which one), because a
// flag written on the success path is a flag the failure paths forget,
// and that is the shape this exact bug had.
// Is the app still asking? One clause, one place, because both the
// surface and the chrome around it turn on it and they must never
// disagree about which launch was the last one.
const stillAsking = (shown, fromLink) => !!fromLink || shown < INVITE_PROMPTS;

export function coldOpenView({ show = "none", dismissed = false, tripCount = 0, joined = false,
  shown = 0, fromLink = false } = {}) {
  if (show === "none") return "home";
  // Answered. Nothing is left to ask, and "Join this trip" — which opens
  // the Settings sheet — over a trip already joined is a stale call to
  // action sitting on top of the thing the person came for. It also puts
  // the app back into ordinary chrome: `body.cold-open` hides the rates
  // row, the trip search, the bell and the scanner, and a joiner used to
  // keep all of that hidden until the next launch.
  //
  // `tripCount` is belt-and-braces on the one property this module
  // exists for: while an invitation is outstanding, nothing here reaches
  // the empty home screen. A joined trip IS a trip, so the guard only
  // ever fires on a caller that has miscounted.
  if (joined && tripCount > 0) return "home";
  // An unanswered invitation is the one question the person arrived
  // with, whether or not they already have trips of their own — until
  // the app has asked it enough times, which is the same outcome as
  // waving it away and is deliberately written as falling through to it.
  // A live tap on the link is never that: it is the question being asked
  // afresh, and it comes back at full strength.
  if (!dismissed && stillAsking(shown, fromLink)) return "invitation";
  // Waved away, or asked and asked. Somebody with trips gets their own home screen back —
  // that is not a demoralising screen, it is the point of the app.
  // Somebody with nothing gets the converter, because the alternative is
  // the two strings this whole story exists to delete.
  return tripCount > 0 ? "home" : "look-around";
}

// Whether the app is standing aside for the invitation — `body.cold-open`
// and everything else the cold open takes off the page.
//
// This is NOT the same question as which surface is up, and reading it
// off the surface is what shipped: `look-around` is two different screens
// wearing one name. While the invitation is still up, the converter is a
// preview with a way back to it, and the app stepping out of the way is
// the point. Once the app has stopped asking, the very same converter is
// this device's ordinary home screen — and for somebody who arrived from
// a friend's link, did not sign in and has no trips of their own,
// `tripCount` is 0 for ever, so `look-around` is for ever, so the search
// box, the filter chips, the bell, the scanner, the rates row, the
// not-signed-in strip and every gesture that creates a trip were gone for
// ever too. They kept the converter and lost the app.
//
// Asked of the VIEW rather than of the invitation again, so there is one
// place where a launch stops counting: `stillAsking`.
export function inviteStanding({ view = "home", shown = 0, fromLink = false } = {}) {
  if (view === "invitation") return true;
  if (view !== "look-around") return false;
  return stillAsking(shown, fromLink);
}

// ---------- the count, which is the only thing written down ----------
//
// The record is `settings.invitePrompts = { tripId, shown }` — one
// invitation at a time, keyed by the trip it is about, because a second
// link from a different friend is a different question and deserves its
// own three. It is device-local (NOT in SYNCED_SETTINGS): it describes a
// screen THIS device has already put in front of somebody, and syncing
// it would let a laptop opened three times take the invitation off the
// phone the link was actually tapped on.

// How many times this device has already opened on the invitation for
// `tripId`. Zero for anything it cannot vouch for — a record about
// another trip, a shape from an older build, a hand-edited settings
// blob. Erring low means asking once more; erring high means never
// asking at all, which is the failure this cannot risk.
export function promptCount(record, tripId) {
  if (!record || typeof record !== "object" || !tripId) return 0;
  if (record.tripId !== tripId) return 0;
  const shown = Number(record.shown);
  return Number.isInteger(shown) && shown > 0 ? shown : 0;
}

// What to remember after a launch — the whole write, computed once, so
// the caller stores the answer rather than working one out.
//
// `asked` is "the surface this launch opened on was the invitation", and
// nothing else: the count is of times the APP ASKED. It must keep
// counting nothing rather than reset once it has stopped asking, or the
// next launch reads zero and the three start over for ever.
export function nextPrompts(record, { tripId = null, answered = false, asked = false,
  fromLink = false } = {}) {
  // Over, both ways it can be over: no invitation on this device at all,
  // or the trip it named is here now. Leaving a count behind for an
  // answered invitation would silence the next link that named the same
  // trip — the one case where somebody is definitely asking again.
  if (!tripId || answered) return null;
  // The reset lives here and only here. coldOpenView already ignores the
  // count on a link launch, so this is the one place that has to agree
  // with it about what a fresh tap means.
  const already = fromLink ? 0 : promptCount(record, tripId);
  return { tripId, shown: already + (asked ? 1 : 0) };
}

// The converter's rows with no trip behind them: home first (as
// everywhere else in the app), then wherever the device thinks it is —
// the same timezone signal the HERE badge uses, so no permission prompt
// and nothing to wait for.
export function lookAroundCodes({ homeCurrency, placeCode } = {}) {
  const home = typeof homeCurrency === "string" && homeCurrency ? homeCurrency : DEFAULT_HOME;
  const codes = [home];
  if (typeof placeCode === "string" && placeCode && placeCode !== home) codes.push(placeCode);
  if (codes.length < 2) codes.push(FALLBACKS.find((c) => c !== home));
  return codes;
}

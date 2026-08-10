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

// `show` is invitationScreen()'s verdict (js/invitelink.js): "invitation"
// when the link named the trip, "generic" when it did not, "none" when
// there is no invitation on this device at all.
//
// `dismissed` is session-only, deliberately: a detour is not a decision,
// so the same link invites again on the next launch.
//
// `joined` is the invitation being ANSWERED: the trip it named is on this
// device now. It is deliberately not a flag anybody sets — the caller
// looks for the trip (invitationScreen tells it which one), because a
// flag written on the success path is a flag the failure paths forget,
// and that is the shape this exact bug had.
export function coldOpenView({ show = "none", dismissed = false, tripCount = 0, joined = false } = {}) {
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
  // with, whether or not they already have trips of their own.
  if (!dismissed) return "invitation";
  // Waved away. Somebody with trips gets their own home screen back —
  // that is not a demoralising screen, it is the point of the app.
  // Somebody with nothing gets the converter, because the alternative is
  // the two strings this whole story exists to delete.
  return tripCount > 0 ? "home" : "look-around";
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

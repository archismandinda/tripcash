// What somebody sees when they arrive knowing nothing.
//
// There are two ways into this app and until now only one was answered.
// Somebody who taps a shared link gets the cold open, which names the trip
// and who invited them. Somebody who simply types the address — because a
// friend mentioned it, or a search found it — lands on a converter and the
// words "No trips yet."
//
// That is a statement about absence. It does not say what the app is, what
// it costs, whether an account is required, or where the data goes. With no
// App Store listing there is no page anywhere else that answers those
// either: this IS the storefront, and it was answering none of them.
//
// The decision is here and the painting is in app.js, for the usual reason
// — every rule this project has written twice has drifted.

// The words, in one place, because they are the product for the thirty
// seconds this screen owns.
//
// Deliberately not a full-screen takeover. The converter is directly below
// and it works immediately with no account, which is the strongest thing
// this app can say about itself; burying it behind a splash to explain it
// in prose would be replacing a demonstration with a promise.
export const PITCH = Object.freeze({
  // What it is, before what it does. Somebody who has just arrived is
  // deciding whether to spend another ten seconds.
  title: "Split travel costs. Convert without signal.",
  // Two sentences, and they are capped at twenty words between them by
  // tests/landing.test.mjs. The first draft was two paragraphs and the
  // owner's report was "too much text"; measured at 375x667, the pitch
  // ran y=157-469 and the button it was arguing for ended up at y=870,
  // 203px under the fold. Prose that pushes the thing it is selling off
  // the screen is arguing against itself. The second sentence points AT
  // the converter rather than describing it, because it is right there.
  lines: Object.freeze([
    "Log what everyone spends, in any currency. TripCash works out who owes whom.",
    "The converter below works offline.",
  ]),
  // The three objections a stranger has about a money app, answered before
  // they are asked. Each is literally true of this app, which is the only
  // reason they are worth printing — so the third keeps its qualifier
  // even though it costs three of the six words a chip is allowed. "Your
  // data never leaves this device" stops being true the moment somebody
  // signs in, and a money app does not get to round that off.
  assurances: Object.freeze([
    "No account needed",
    "Works offline",
    "Device-only unless you sign in",
  ]),
  action: "Start a trip",
  // For somebody not ready to commit to anything. It does not hide the
  // pitch for ever — see `dismissed` below.
  dismiss: "Just the converter",
});

// Should the pitch be shown at all?
//
// The bar is high because this screen costs attention from people who do
// not need it. It appears for exactly one audience: somebody who has never
// had a trip on this device and did not arrive through an invitation.
export function landingState({
  trips = [],
  coldOpen = false,
  createdEver = false,
  dismissed = false,
} = {}) {
  // The invitation already answers "what is this", with a specific trip and
  // a name attached — which is a better answer than any pitch. Two
  // explanations stacked is worse than either alone.
  if (coldOpen) return { show: false, why: "an invitation is already on screen" };

  // Anybody with a trip has passed this point. Showing them a pitch would
  // be an app that does not know its own user.
  if (trips.length > 0) return { show: false, why: "they already have trips" };

  // They have used it and deleted everything — a returning traveller
  // between trips, not a stranger. They need a way back in, not a sales
  // pitch about what the app is.
  if (createdEver) return { show: false, why: "they have used it before" };

  if (dismissed) return { show: false, why: "they asked for just the converter" };

  return { show: true, why: "first arrival, no invitation" };
}

// What the empty area under the pitch should say.
//
// "No trips yet." is a fact about the database. These say what to do, and
// they differ by person: the stranger has already read the pitch above and
// needs the shortest possible nudge, while the returning traveller needs
// recognition rather than explanation.
export function emptyLine({ createdEver = false, signedIn = false } = {}) {
  if (createdEver) return "Nothing on the go right now. Start the next one whenever you like.";
  if (signedIn) return "Trips you are added to will appear here.";
  return "";   // the pitch above is already carrying this moment
}

// …and whether to draw the suitcase above it.
//
// The empty state is an illustration of emptiness: a 108px suitcase, a
// line, and 80px of padding. For somebody with no trips and no pitch that
// is the screen doing its job. Directly underneath a pitch written to
// replace exactly that sentence it is 254px of nothing, and it put the one
// button on the page 203px below the fold on a 375x667 phone.
//
// Nobody wrote that whitespace. `emptyLine()` correctly returns "" for a
// stranger BECAUSE the pitch has already spoken, and #empty-state
// correctly renders for anybody with no trips — two right answers whose
// sum is wrong. So the sum is a decision now, and it lives here with the
// other one rather than as an `if` in app.js.
export function emptyDecoration({ pitchShown = false } = {}) {
  return !pitchShown;
}

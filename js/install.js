// How this phone installs a web app, and whether now is the moment to
// say so. Pure: the user agent is an ARGUMENT, never read from here.
//
// Why this module exists at all. The instruction lived in two places:
// index.html's `#install-hint` said "In Chrome tap ⋮ → Add to Home
// screen", shown whenever no `beforeinstallprompt` event had arrived —
// and that event is Chromium-only, so it has never fired on iOS Safari.
// The result: the sentence naming a browser they are not running, and a
// menu their browser does not have, was shown to precisely the people it
// could not help. js/push.js had the right words all along, because push
// on iOS only works from an installed app and somebody had to get it
// right somewhere. One rule, two copies, the wrong copy on the phone
// that needed it. If you split this again, that is what comes back.
//
// Everything variable is a plain string here so the tests can hold the
// wording; app.js paints it and does not compose it.

// A phone is a browser we cannot feature-detect from the outside: on iOS
// EVERY browser is WebKit, so Chrome and Firefox for iPhone install
// exactly the way Safari does — through the Share sheet — and neither
// can ever hand us `beforeinstallprompt`. Which is why this branch keys
// off the platform and not off the browser name, and why the sentence
// deliberately does not name a browser at all.
const IOS = /iPhone|iPad|iPod/i;

// Known gap, written down rather than guessed at: iPadOS 13+ reports
// itself as "Macintosh; Intel Mac OS X" in Safari's default desktop
// mode, so an iPad lands on "menu" below. The ⋮ sentence is wrong there
// too, but it is wrong for one uncommon device instead of every iPhone,
// and the honest fix needs a touch-points probe, which is a global.
// If that probe ever exists, pass its RESULT in as an argument.

// The one browser family that claims WebKit without being it: every
// Chromium browser inherited Safari's "AppleWebKit … Safari" tokens and
// added its own name on top, so the ABSENCE of a Chromium name is the
// signal. Gecko claims neither token. This is the only user-agent
// pattern in the project beside IOS above, and both live here because
// js/persist.js's header forbids sniffing inside it — a wrong guess
// there nags every Android user or silently fails every iPhone one.
const CHROMIUM = /Chrome|Chromium|Edg|OPR|SamsungBrowser/i;

// A Mac, which may or may not be an iPad pretending. Safari on macOS has
// no ⋮ menu and no "Add to Home screen" — it has File → Add to Dock
// (Safari 17+). Telling a Mac user to open a menu that does not exist is
// the one failure worse than saying nothing, because it reads as an app
// that does not know what it is running on.
const MAC = /Macintosh|Mac OS X/i;

// Which rendering engine is behind this user agent: "webkit" or "other".
//
// It is the ENGINE that decides storage policy, not the browser name.
// WebKit deletes all script-writable storage after seven days with no
// interaction with the origin, and on iOS every browser is WebKit — so
// Chrome (CriOS) and Firefox (FxiOS) for iPhone inherit the timer along
// with everything else. Desktop Safari is WebKit too; the timer is not
// an iPhone feature, though installing is only a real escape on a phone.
//
// The iPadOS gap above applies here and lands the RIGHT way round: an
// iPad in desktop mode reads as a Mac running Safari, which is still
// WebKit, so the storage answer is correct even though installAdvice()
// on that same device still says "menu". Unknown agents are "other"
// deliberately — claiming WebKit would warn every unrecognised device
// about a timer it does not have.
export function engineOf(ua = "") {
  const agent = typeof ua === "string" ? ua : "";
  if (IOS.test(agent)) return "webkit";
  if (CHROMIUM.test(agent)) return "other";
  return agent.includes("AppleWebKit") ? "webkit" : "other";
}

const SAY = {
  // The button does the work; the words only have to say what it is for.
  prompt: "One tap and TripCash lives on your home screen.",
  // No browser named on purpose — see the IOS note above.
  "ios-share": "Tap the Share button, then Add to Home Screen.",
  // The same route, for somebody signed out who already has trips here.
  //
  // On iOS a home-screen app gets its OWN storage, separate from Safari's.
  // So the sequence this app actively recommends — use it in Safari, log a
  // trip, follow the install prompt — ends in an app with no trips in it.
  // The Safari copy is not destroyed, which makes this recoverable rather
  // than fatal, but nothing on screen said so and "my expenses are gone" is
  // indistinguishable from data loss to the person it happens to. Found by
  // the owner on an iPhone SE: home currency read correctly in the
  // installed app and wrongly in Safari, because the installed app had no
  // stored settings at all.
  //
  // Signing in first is the real fix for that person, so the sentence leads
  // with it. A signed-in device re-syncs into the installed app and loses
  // nothing, which is why this only replaces the sentence when signed out.
  //
  // REWRITTEN 11 Aug 2026 after a blind review of the release that added
  // it. Two things were wrong with the first version, both because it was
  // written as if it were the whole message. It is not: js/persist.js pastes
  // it onto the end of its own sentence, and on the exact audience this was
  // written for that produced:
  //
  //   "Safari deletes this app's data after a week away. Sign in first, or
  //    the installed app starts empty — on iPhone it gets separate storage,
  //    so trips saved here stay in Safari."
  //
  // The second half reassures about the thing the first half warns about,
  // and "stay in Safari" is false: they stay for seven days, and installing
  // is what stops you opening Safari, which is what starts the clock. It
  // also said "on iPhone" to an iPad, which the header of this file forbids.
  //
  // So: give the REASON without making any claim about where data lives or
  // how long it lasts. That is true standing alone and true concatenated.
  "ios-share-fresh-start":
    "Sign in first — the installed app starts with its own storage. Then "
    + "tap the Share button and Add to Home Screen.",
  // The fallback for a Chromium phone that has not offered us the event
  // yet (it wants repeat visits first). This is the ONE place ⋮ belongs.
  menu: "Open the browser menu (⋮) and choose Add to Home screen.",
  // macOS Safari. Named explicitly because it is the ONLY route where the
  // browser must be named — "Add to Dock" lives in a menu no other
  // browser has, and getting it wrong on a Mac is what this route exists
  // to stop.
  "mac-dock": "In Safari, choose File → Add to Dock.",
  none: "",
};

// Is TripCash already on this phone, as far as this tab can tell?
//
// Three signals, all ARGUMENTS, because the io layer owns the reading of
// them. The third one is the entire reason this function exists: the tab
// that PERFORMS the install goes on running in the browser, its display
// mode stays "browser" for the rest of its life, and no later reading of
// it will ever say otherwise. Its only evidence is the `appinstalled`
// event it has already been handed — so somebody has to remember that it
// arrived, or the next good moment tells the person who has just
// installed TripCash to install TripCash.
export function isAppInstalled({
  displayModeStandalone = false,
  iosStandalone = false,
  installedThisSession = false,
} = {}) {
  return Boolean(displayModeStandalone || iosStandalone || installedThisSession);
}

// What to tell the person holding THIS phone.
//   how: "prompt"    — we hold a beforeinstallprompt event; show a button
//        "ios-share" — Share sheet; there is no button we can offer
//        "menu"      — browser menu; there is no button we can offer
//        "none"      — already installed; say nothing at all
export function installAdvice({
  ua = "", hasPrompt = false, installed = false, touchPoints = 0,
  // Whether this device has anything to lose, and whether it is anywhere
  // else. Only iOS uses them, and only together — see "ios-share-fresh-start".
  hasData = false, signedIn = false,
} = {}) {
  // Installed wins over everything, including holding the event: an
  // already-installed app being told to install itself is the one
  // outcome that reads as broken rather than merely unhelpful.
  if (installed) return { how: "none", say: "" };
  if (hasPrompt) return { how: "prompt", say: SAY.prompt };
  const how = routeFor(String(ua ?? ""), touchPoints);
  // Deliberately narrow. Only the iOS route, only signed out, only with
  // something to lose: a device with no trips loses nothing by installing,
  // and a signed-in one re-syncs. Warning either of them would be the
  // signed-out strip's mistake again — telling somebody about a risk that
  // is not theirs, in the sentence meant to get them to act.
  if (how === "ios-share" && hasData && !signedIn) {
    return { how, say: SAY["ios-share-fresh-start"] };
  }
  return { how, say: SAY[how] };
}

// Which of the three manual routes this device actually has.
//
// The iPadOS gap the header describes is closed here, and only here: an
// iPad in Safari's default desktop mode is indistinguishable from a Mac
// by user agent alone, so the tiebreak is the touch-points probe the
// header asked a caller to pass in. A Mac reports 0; an iPad reports 5.
// Getting it wrong sends an iPad user to a File menu it does not have,
// or a Mac user to a Share sheet it does not have — so when the probe is
// missing (0), prefer the Mac reading, because a real iPad in desktop
// mode is rarer than a Mac and the Mac sentence is the safer wrong
// answer: File → Add to Dock exists on both recent macOS and nowhere
// harmful.
function routeFor(ua, touchPoints) {
  if (IOS.test(ua)) return "ios-share";
  if (MAC.test(ua) && !CHROMIUM.test(ua) && ua.includes("AppleWebKit")) {
    return Number(touchPoints) > 1 ? "ios-share" : "mac-dock";
  }
  return "menu";
}

// A dismissal is worth a week. Long enough that "not now" means
// something; short enough that somebody who genuinely wanted it later
// gets asked again on the next trip.
export const INSTALL_SNOOZE_MS = 7 * 24 * 60 * 60 * 1000;

// The only moments worth asking at: something the app did for THIS
// person has just worked. the conversion design note — an installed app
// survives the six months between trips, a browser tab does not.
//
// "invitation" is listed here as an explicit non-moment so that the ban
// is a value in the code rather than an absence anybody could fill in.
export const OFFER_MOMENTS = Object.freeze(["first-conversion", "settled-up"]);

// `how` defaults to "menu" because every browser has a menu: not being
// told how is not a reason to stay silent. Only "none" — already
// installed — is.
export function shouldOfferInstall({
  moment,
  installed = false,
  how = "menu",
  dismissedAt = null,
  now = Date.now(),
} = {}) {
  // the cold-open design note is explicit: the invitation screen answers one question
  // and asks for nothing. Anything not on the list is refused the same
  // way, so a new call site has to come here and be argued for.
  if (!OFFER_MOMENTS.includes(moment)) return false;
  if (installed) return false;
  if (how === "none") return false;
  // A stamp from the future (clock skew, or a device whose clock ran
  // ahead) silences it rather than firing immediately: over-asking is
  // the failure mode that costs this app, staying quiet is not.
  if (Number.isFinite(dismissedAt) && now - dismissedAt < INSTALL_SNOOZE_MS) return false;
  return true;
}

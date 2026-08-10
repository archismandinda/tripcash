// Whether this device is about to lose the trips on it.
//
// TripCash is offline-first and works signed out, which means that for a
// lot of people the ONLY copy of their trip is in this browser's local
// storage. That is fine everywhere except WebKit, where it is not.
//
// Safari deletes all script-writable storage — localStorage, IndexedDB,
// service worker registrations, the lot — after seven days with no user
// interaction with the origin. It is not a quota policy that fires under
// pressure; it is a timer, and it takes everything.
// https://webkit.org/blog/14403/updates-to-storage-policy/
//
// So the failure looks like this: somebody opens a shared link in Safari
// on an iPhone, logs a week in Vietnam, never signs in because the app
// promised they would not have to, comes back ten days later, and the
// trip is gone. Silently. That is the precise opposite of what this app
// says about itself on its own front page.
//
// There are exactly three things that prevent it, and this module exists
// to say which of them are in place:
//
//   1. INSTALLED to the home screen. A home-screen web app is not part
//      of Safari and keeps its own counter, so the seven-day timer does
//      not apply. On WebKit this is the real fix, and the only complete
//      one — which is why "add to home screen" is a data-safety feature
//      here, not a growth nicety.
//   2. SIGNED IN, so there is a copy in the cloud to come back to. This
//      is a recovery, not a prevention: the local copy still goes.
//   3. PERSISTENT STORAGE granted. Genuinely protective on Chromium and
//      Firefox. WebKit's support is partial and it does not exempt an
//      uninstalled site from the seven-day rule, so it must never be
//      treated as sufficient there.
//
// Everything here is a pure function of facts the caller measures. No
// user-agent sniffing lives in this file: "is this WebKit" is something
// the caller establishes and passes in, because a wrong guess here would
// either nag every Android user or silently fail every iPhone one.

// Should we ask the browser to protect this origin's storage?
//
// Asking is free, idempotent and cannot make anything worse, but it is
// pointless once granted and it must not be asked before there is
// anything to protect — browsers weigh engagement, and a request made on
// a first-ever page view is the one most likely to be refused, after
// which some engines will not reconsider.
export function shouldAskToPersist({ persisted = false, supported = true, hasData = false } = {}) {
  return supported && !persisted && hasData;
}

// Is the only copy of this person's data one timer away from deletion?
//
// `engine` is "webkit" or anything else. `installed` means running as a
// standalone home-screen app. `signedIn` means there is a cloud copy.
export function storageRisk({
  engine = "other",
  installed = false,
  signedIn = false,
  persisted = false,
  hasData = false,
} = {}) {
  const safe = (why) => ({ atRisk: false, why, advice: "", severity: "none" });
  if (!hasData) return safe("nothing to lose yet");
  if (installed) return safe("installed to the home screen — its storage has its own clock");
  if (engine === "webkit") {
    // Signed in is a recovery, not a prevention: the local copy is still
    // deleted, and a signed-in person who opens the app offline after
    // the timer fires sees an empty app until they get signal. Saying
    // "you're safe" there would be a lie of exactly the kind this
    // project keeps having to apologise for.
    return signedIn
      ? {
          atRisk: true,
          severity: "recoverable",
          why: "Safari clears a site's data after 7 days away, and this isn't installed",
          advice: "Your trips are backed up to your account, but add TripCash to your Home Screen to keep them on this phone too.",
        }
      : {
          atRisk: true,
          severity: "loss",
          why: "Safari clears a site's data after 7 days away, this isn't installed, and there is no cloud copy",
          advice: "Add TripCash to your Home Screen to keep your trips — otherwise Safari deletes them after a week away.",
        };
  }
  // Chromium and Firefox evict under storage pressure rather than on a
  // timer, and persistence exempts you from it. Uninstalled and
  // unpersisted is worth mentioning once; it is not the same emergency.
  if (!persisted) {
    return {
      atRisk: true,
      severity: "unlikely",
      why: "storage is not marked persistent, so the browser may clear it if the device runs out of space",
      advice: signedIn
        ? ""
        : "Install TripCash or sign in, and your trips are safe even if the phone runs low on space.",
    };
  }
  return safe("storage is persistent");
}

// How loudly to say it, and how often.
//
// A warning that appears on every launch is a warning people learn to
// dismiss without reading, and this one only matters at the moment it is
// actionable. "loss" is the only case worth interrupting anybody for.
export function shouldWarn(risk, { toldAt = 0, now = Date.now(), every = 7 * 24 * 60 * 60 * 1000 } = {}) {
  if (!risk?.atRisk || !risk.advice) return false;
  if (risk.severity === "unlikely") return false;
  return !Number.isFinite(toldAt) || toldAt <= 0 || now - toldAt >= every;
}

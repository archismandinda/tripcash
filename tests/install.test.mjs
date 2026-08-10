// What to say about installing, and when it is worth saying it.
//
// This existed twice and one copy was wrong. `#install-hint` in
// index.html told everybody who had no `beforeinstallprompt` event to
// "In Chrome tap ⋮ → Add to Home screen" — and `beforeinstallprompt` is
// a Chromium event that has never fired on iOS Safari, so the ONE group
// guaranteed to read that sentence was the group it was wrong for.
// Meanwhile js/push.js already carried the correct iPhone wording,
// because push on iOS needs an installed app and somebody had to get it
// right there. Same rule, two places, one wrong: the project's working agreement, rule 3.
//
// So the sentence lives here, once, and the tests below hold it there.

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { installAdvice, shouldOfferInstall, isAppInstalled, engineOf, INSTALL_SNOOZE_MS, OFFER_MOMENTS }
  from "../js/install.js";
import { SYNCED_SETTINGS } from "../js/prefs.js";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const APP = readFileSync(join(ROOT, "js/app.js"), "utf8");

const IPHONE = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPHONE_CHROME = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) CriOS/126.0 Mobile/15E148 Safari/604.1";
const ANDROID = "Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Mobile Safari/537.36";
const DESKTOP = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36";
const IPAD = "Mozilla/5.0 (iPad; CPU OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
const IPHONE_FIREFOX = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) FxiOS/127.0 Mobile/15E148 Safari/605.1.15";
const MAC_SAFARI = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Safari/605.1.15";
const ANDROID_FIREFOX = "Mozilla/5.0 (Android 14; Mobile; rv:127.0) Gecko/127.0 Firefox/127.0";
const WINDOWS_FIREFOX = "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:127.0) Gecko/20100101 Firefox/127.0";

// ---------- which engine, which is what the seven-day timer follows ----------
//
// js/persist.js refuses to sniff: a wrong guess there either nags every
// Android user or silently fails every iPhone one, and the module's own
// header says the caller establishes this. This file already owns every
// sentence that depends on reading a user agent, so it owns the reading.

test("every browser on iOS is WebKit, because iOS gives them no choice", () => {
  // Chrome and Firefox for iPhone are Safari wearing a hat: same engine,
  // same storage policy, same seven-day timer.
  for (const ua of [IPHONE, IPAD, IPHONE_CHROME, IPHONE_FIREFOX]) {
    assert.equal(engineOf(ua), "webkit", ua);
  }
});

test("desktop Safari is WebKit too — the timer is not an iPhone feature", () => {
  assert.equal(engineOf(MAC_SAFARI), "webkit");
});

test("Chromium and Gecko are not WebKit, whatever tokens they inherited", () => {
  // Every Chromium browser still says "AppleWebKit ... Safari" for
  // historical reasons, so the absence of "Chrome" is the real signal.
  for (const ua of [DESKTOP, ANDROID, ANDROID_FIREFOX, WINDOWS_FIREFOX]) {
    assert.equal(engineOf(ua), "other", ua);
  }
});

test("an unreadable user agent is not claimed as WebKit", () => {
  // Guessing "webkit" would warn every unknown device about a Safari
  // timer it does not have; guessing wrong the other way costs nothing
  // that installing does not already fix.
  for (const ua of ["", undefined, null, {}]) assert.equal(engineOf(ua), "other");
  assert.equal(engineOf(), "other");
});

// ---------- what this phone can actually do ----------

test("an iPhone is told about Share, and never about Chrome", () => {
  const out = installAdvice({ ua: IPHONE, hasPrompt: false, installed: false });
  assert.equal(out.how, "ios-share");
  assert.ok(out.say.includes("Add to Home Screen"), out.say);
  // The two things that were on this phone's screen yesterday and made
  // no sense on it: a browser it isn't running, and that browser's menu.
  assert.ok(!out.say.includes("Chrome"), out.say);
  assert.ok(!out.say.includes("⋮"), out.say);
});

test("every browser on iOS gets the iOS route, because they are all WebKit", () => {
  // Chrome on iPhone is Safari wearing a hat. It cannot install anything
  // itself; the Share sheet is still the only way in.
  const out = installAdvice({ ua: IPHONE_CHROME, hasPrompt: false, installed: false });
  assert.equal(out.how, "ios-share");
  assert.ok(!out.say.includes("Chrome"), out.say);
});

test("a phone that handed us the prompt gets the button", () => {
  assert.equal(installAdvice({ ua: ANDROID, hasPrompt: true }).how, "prompt");
  assert.equal(installAdvice({ ua: DESKTOP, hasPrompt: true }).how, "prompt");
});

test("Android without the event falls back to the browser menu", () => {
  const out = installAdvice({ ua: ANDROID, hasPrompt: false, installed: false });
  assert.equal(out.how, "menu");
  assert.ok(out.say.includes("⋮"), out.say);
});

test("an installed app is offered nothing, whatever it is running", () => {
  for (const ua of [IPHONE, IPHONE_CHROME, ANDROID, DESKTOP, "", undefined]) {
    assert.deepEqual(installAdvice({ ua, installed: true }), { how: "none", say: "" });
    // …and the prompt being in hand does not override having it already.
    assert.deepEqual(installAdvice({ ua, installed: true, hasPrompt: true }), { how: "none", say: "" });
  }
});

test("the advice reads no globals — the ua is an argument", () => {
  const src = readFileSync(join(ROOT, "js/install.js"), "utf8");
  for (const global of ["navigator", "window", "document", "globalThis", "matchMedia", "localStorage"]) {
    assert.ok(!new RegExp(`\\b${global}\\b`).test(src), `js/install.js must not touch ${global}`);
  }
});

// ---------- when it is worth saying ----------

test("the invitation screen is never the moment", () => {
  // The cold-open rule: the first screen answers "did the link work?" and
  // nothing else. An install prompt there asks somebody to commit to an
  // app they have not yet seen do anything.
  for (const installed of [true, false]) {
    for (const how of ["prompt", "ios-share", "menu", "none"]) {
      for (const dismissedAt of [null, undefined, 0, 1, Date.now(), Date.now() - 30 * 86400000]) {
        assert.equal(
          shouldOfferInstall({ moment: "invitation", installed, how, dismissedAt, now: Date.now() }),
          false,
          `invitation offered with ${JSON.stringify({ installed, how, dismissedAt })}`,
        );
      }
    }
  }
});

test("a moment of value is the moment", () => {
  const now = Date.now();
  for (const moment of ["first-conversion", "settled-up"]) {
    for (const how of ["prompt", "ios-share", "menu"]) {
      assert.equal(shouldOfferInstall({ moment, installed: false, how, dismissedAt: null, now }), true,
        `${moment} / ${how}`);
    }
    assert.equal(shouldOfferInstall({ moment, installed: false, how: "none", dismissedAt: null, now }), false);
    assert.equal(shouldOfferInstall({ moment, installed: true, how: "prompt", dismissedAt: null, now }), false);
  }
});

test("an unknown moment offers nothing", () => {
  assert.equal(shouldOfferInstall({ moment: "boot", installed: false, how: "prompt" }), false);
  assert.equal(shouldOfferInstall({}), false);
});

test("no is a no for a week", () => {
  const now = Date.now();
  assert.equal(INSTALL_SNOOZE_MS, 7 * 24 * 60 * 60 * 1000);
  assert.equal(shouldOfferInstall({ moment: "first-conversion", dismissedAt: now - 6 * 24 * 3600 * 1000, now }), false);
  assert.equal(shouldOfferInstall({ moment: "first-conversion", dismissedAt: now - 8 * 24 * 3600 * 1000, now }), true);
  // The boundary itself, spelled out so a later `>` vs `>=` cannot drift.
  assert.equal(shouldOfferInstall({ moment: "settled-up", dismissedAt: now - INSTALL_SNOOZE_MS, now }), true);
  assert.equal(shouldOfferInstall({ moment: "settled-up", dismissedAt: now - INSTALL_SNOOZE_MS + 1, now }), false);
});

test("a dismissal stamped in the future still silences it", () => {
  // Clock skew, or a stamp restored from a device whose clock ran ahead.
  // Nagging is the failure mode that costs the app; staying quiet is not.
  const now = Date.now();
  assert.equal(shouldOfferInstall({ moment: "first-conversion", dismissedAt: now + 86400000, now }), false);
});

test("already installed beats any dismissal stamp", () => {
  const now = Date.now();
  for (const dismissedAt of [null, undefined, 0, now, now - 400 * 86400000]) {
    assert.equal(shouldOfferInstall({ moment: "first-conversion", installed: true, dismissedAt, now }), false);
  }
});

// ---------- the rule exists in exactly one place ----------

test("only js/install.js knows the words", () => {
  const files = ["index.html", "sw.js", "styles.css"];
  for (const name of readdirSync(join(ROOT, "js"))) {
    if (name.endsWith(".js") && name !== "install.js") files.push(join("js", name));
  }
  for (const rel of files) {
    const src = readFileSync(join(ROOT, rel), "utf8");
    for (const phrase of ["Add to Home Screen", "Add to Home screen", "⋮"]) {
      assert.ok(!src.includes(phrase),
        `${rel} carries "${phrase}" — it belongs in js/install.js only, or it will drift again`);
    }
  }
  const mine = readFileSync(join(ROOT, "js/install.js"), "utf8");
  assert.ok(mine.includes("Add to Home Screen") && mine.includes("⋮"));
});

test("push.js gets the iPhone sentence from the module, not from memory", () => {
  const src = readFileSync(join(ROOT, "js/push.js"), "utf8");
  assert.ok(src.includes('from "./install.js"'), "push.js must import the sentence");
  assert.ok(/installAdvice\(/.test(src), "push.js must call installAdvice");
});

// ---------- the dismissal belongs to this device ----------

test("dismissing on a laptop does not silence the phone", () => {
  // The whole point of the nudge is that it reaches a phone. Sync the
  // stamp and one impatient tap on a desktop browser — where the app is
  // least useful installed — buys a week of silence on the device where
  // it matters most.
  assert.ok(!SYNCED_SETTINGS.includes("installDismissedAt"),
    "installDismissedAt must stay device-local");
});

// ---------- app.js is io only ----------

test("app.js decides nothing about installing on its own", () => {
  assert.ok(APP.includes('from "./install.js"'), "app.js must import the decision");
  assert.ok(/installAdvice\(/.test(APP), "app.js must ask what this phone can do");
  assert.ok(/shouldOfferInstall\(/.test(APP), "app.js must ask whether to offer");
});

test("the offer is marked at a moment of value, and only there", () => {
  const moments = [...APP.matchAll(/offerInstall\(\s*"([a-z-]+)"/g)].map((m) => m[1]);
  assert.deepEqual(new Set(moments), new Set(["first-conversion", "settled-up"]),
    `app.js marks ${JSON.stringify(moments)}`);
});

const fnBody = (name) => {
  const from = APP.indexOf(`function ${name}(`);
  assert.ok(from > 0, `js/app.js has no ${name}()`);
  const rest = APP.slice(from);
  return rest.slice(0, rest.indexOf("\n}\n"));
};

test("the same moment cannot nag twice in one session", () => {
  // The nudge is a banner, not a toast: shown twice in one sitting it
  // reads as a bug. The guard has to be inside offerInstall, not at the
  // call sites — recompute() runs on every keystroke.
  assert.ok(/offeredThisSession/.test(fnBody("offerInstall")),
    "offerInstall must remember which moments it has already offered");
});

test("an offer nobody saw does not spend the session's one chance", () => {
  // "Offered" has to mean SHOWN. When it meant "decided", an offer that
  // was correctly withheld under an open sheet was still counted, and
  // the moment was gone for the rest of the session.
  assert.ok(!/offeredThisSession\.add/.test(fnBody("offerInstall")),
    "offerInstall must not mark a moment consumed before it is on screen");
  assert.ok(/offeredThisSession\.add/.test(fnBody("showInstallNudge")),
    "the moment is consumed where the banner is actually painted");
});

test("the banner is never painted inside the caller's own turn", () => {
  // renderSummaryBody() runs one line BEFORE the summary sheet's
  // showModal(). A synchronous paint therefore read "no dialog open",
  // drew the banner, and the modal covered it a moment later. A single
  // deferred check only moves the guess, so the paint retries until it
  // can really happen. Found by driving the real app; no unit test was
  // ever going to see it.
  const offer = fnBody("offerInstall");
  assert.ok(!/\bshowInstallNudge\(/.test(offer),
    "offerInstall must not paint directly — go through the queue");
  assert.ok(/queueInstallNudge\(/.test(offer), "offerInstall must queue the paint");
  assert.ok(/setTimeout\(showInstallNudge/.test(fnBody("queueInstallNudge")),
    "the queue must land on a later task, after the caller has finished");
  const show = fnBody("showInstallNudge");
  assert.ok(/dialog\[open\]/.test(show), "showInstallNudge must refuse to draw under a modal");
  assert.ok(/dialog\[open\][^\n]*queueInstallNudge/.test(show),
    "a refused paint must re-queue itself, not depend on an event arriving");
});

test("accepting fires the saved event exactly once, from one place", () => {
  // A beforeinstallprompt event is single-use: prompt() on a consumed
  // one throws. There are now two accept paths (the Settings row and
  // the nudge), which is exactly the shape that has produced every
  // drift bug in this project — so both go through one function, and
  // that function drops the event BEFORE firing it.
  const calls = [...APP.matchAll(/\.prompt\(\)/g)];
  assert.equal(calls.length, 1, `.prompt() is called ${calls.length} times; it must be called from one place`);
  const before = APP.slice(Math.max(0, calls[0].index - 400), calls[0].index);
  assert.ok(/installPrompt = null/.test(before),
    "installPrompt must be cleared before prompt() is called, not after the await");
  // The Settings button still exists and still guards on having one.
  assert.ok(/#install-btn[\s\S]{0,200}if \(!installPrompt\) return;/.test(APP),
    "the Settings install button must keep its no-prompt guard");
});

test("the dismiss handler stamps the device-local key", () => {
  assert.ok(/installDismissedAt:/.test(APP), "app.js must record the dismissal");
  assert.ok(/#install-nudge/.test(APP), "app.js must wire the nudge element");
  const html = readFileSync(join(ROOT, "index.html"), "utf8");
  assert.ok(html.includes('id="install-nudge"'), "index.html must carry the nudge");
});

// ---------- being installed is not only a display mode ----------
//
// The whole install flow was correct except for the one fact it ran on.
// The tab that PERFORMS the install stays `display-mode: browser` for
// the rest of its life, so the reading app.js took said "not installed"
// a second after it had toasted "TripCash installed" — and the next
// moment of value told the person who had just installed TripCash to
// install TripCash, by opening a menu to add an app already on their
// home screen. Every test above asserted on the pure function, which
// was right; nothing asserted that app.js ever handed it `true`.

test("the tab that did the installing counts as installed", () => {
  // Its only evidence is the appinstalled event it already received.
  assert.equal(isAppInstalled({ installedThisSession: true }), true);
  assert.equal(isAppInstalled({ displayModeStandalone: true }), true);
  assert.equal(isAppInstalled({ iosStandalone: true }), true);
  assert.equal(isAppInstalled({}), false);
  assert.equal(isAppInstalled(), false);
});

test("an install this session silences the very next moment of value", () => {
  const installed = isAppInstalled({ displayModeStandalone: false, installedThisSession: true });
  assert.deepEqual(installAdvice({ ua: ANDROID, installed }), { how: "none", say: "" });
  for (const moment of OFFER_MOMENTS) {
    assert.equal(shouldOfferInstall({ moment, installed, how: "menu", dismissedAt: null }), false,
      `${moment} offered to somebody who installed the app a minute ago`);
  }
});

// app.js's own isInstalled(), lifted out of the source and run against
// stub globals. A grep could only show the flag is mentioned; this shows
// it is part of the answer — a mistyped key would leave isAppInstalled
// falling back to its default and the bug exactly where it was.
function appIsInstalled({ displayMode = "browser", iosStandalone = false, installedThisSession = false }) {
  const m = APP.match(/const isInstalled = \(\) =>([\s\S]*?);\n/);
  assert.ok(m, "js/app.js must keep isInstalled as one expression, so this test can run it");
  return new Function("window", "navigator", "installedThisSession", "isAppInstalled",
    `return (() =>${m[1]})();`)(
    { matchMedia: (q) => ({ matches: q.includes("standalone") && displayMode === "standalone" }) },
    { standalone: iosStandalone },
    installedThisSession,
    isAppInstalled,
  );
}

test("app.js tells the module about an install it watched happen", () => {
  assert.equal(appIsInstalled({}), false, "a plain browser tab is not installed");
  assert.equal(appIsInstalled({ displayMode: "standalone" }), true);
  assert.equal(appIsInstalled({ iosStandalone: true }), true);
  // The bug, in one line: display-mode is still "browser" in this tab.
  assert.equal(appIsInstalled({ installedThisSession: true }), true,
    "app.js still reads 'not installed' in the tab that just installed the app");
});

test("the appinstalled event is remembered, not merely acknowledged", () => {
  const wire = fnBody("wireInstall");
  const from = wire.indexOf('"appinstalled"');
  assert.ok(from > 0, "app.js must listen for appinstalled");
  const handler = wire.slice(from, wire.indexOf("});", from));
  assert.ok(/installedThisSession = true/.test(handler),
    "the appinstalled handler hides the row and toasts, but records nothing — "
    + "so the next offerInstall() asks again");
});

test("nothing but js/install.js decides what installed means", () => {
  // js/push.js carried the second copy: the same two globals OR'd
  // together, for the iPhone branch of pushBlocker(). Two copies of one
  // rule is how this app has produced nearly every bug it has shipped.
  const combined = /\.matches[\s\S]{0,60}\|\|[\s\S]{0,60}navigator\.standalone/;
  for (const rel of ["js/app.js", "js/push.js"]) {
    const src = readFileSync(join(ROOT, rel), "utf8");
    assert.ok(!combined.test(src), `${rel} works out for itself what "installed" means`);
    assert.ok(/isAppInstalled\(/.test(src), `${rel} must ask js/install.js instead`);
  }
});

test("the offline shell carries the new module", () => {
  // Belt and braces next to tests/shell.test.mjs: a module missing from
  // SHELL only fails on a home-screen launch with no signal.
  const sw = readFileSync(join(ROOT, "sw.js"), "utf8");
  assert.ok(sw.includes('"./js/install.js"'), "sw.js SHELL must list js/install.js");
});

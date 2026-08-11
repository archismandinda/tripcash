# Testing

Two suites. Both must pass before anything ships.

```bash
npm test             # 700+ unit tests — no network, no emulator
npm run test:rules   # the REAL firestore.rules, in the Firestore emulator
```

Almost all of `npm test` needs no browser. Two files do: `fold.test.mjs`
measures the landing screen in headless Chrome, and `focus.test.mjs` clicks
an amount and reads the focus ring the renderer actually painted. See
**[The fold](#the-fold)** and **[The focus ring](#the-focus-ring)** — both
skip out loud where there is no browser, and `npm run preflight` refuses a
release from such a machine.

## The unit suite

Pure modules only, which is why it is fast and worth trusting. It is
**environment-pinned** — `TZ=Asia/Kolkata LC_ALL=en_US.UTF-8` in the npm
script — and neither half may be removed. `Intl` decides the separators, so
six money tests silently flip under a German locale; `Intl` also decides
what the device claims about where it is, and `js/insights.js` opens a new
install on the currency of its TIMEZONE.

The timezone half was missing until it cost a release. Measured across
zones with the locale already pinned, three tests answered differently
depending on which chair the suite was run from — and one of them failed
in UTC, which is what CI runs, so a green suite on a laptop met a red gate
on the runner and v1.76.0 sat committed and undeployed. The numbers and
the reasoning are in the header of `tests/environment.test.mjs`, which now
fails if either half of the pin goes missing or fails to take effect.

That last part is why a bare `node --test tests/*.test.mjs` is refused: it
is not this suite, it is this suite in whatever zone the machine happens to
be in. Vary one axis on purpose and leave the other pinned — to reproduce a
locale bug:

```bash
TZ=Asia/Kolkata LC_ALL=de_DE.UTF-8 node --test tests/*.test.mjs
```

and to check whether something depends on the zone, vary that instead:

```bash
for z in UTC America/New_York Europe/Berlin Pacific/Auckland; do
  TZ=$z LC_ALL=en_US.UTF-8 node --test tests/*.test.mjs; done
```

That sweep always reports `environment.test.mjs` failing — that is the pin
noticing it has been overridden, and it is the one result to ignore. What
you are reading is whether any OTHER file appears, and which zones it
appears in.

Worth doing before adding any test that touches a date, a day boundary or a
place. A pin makes the suite reproducible; it does not make the code
zone-independent, and it hides a zone-dependent fixture exactly as well as
it fixes one. Two are hidden right now, both known and neither fixed by the
pin: `analytics.test.mjs` asserts that a device with no timezone argument
opts into analytics, which is only true off the machine it was written on
and is false in Europe by design; and `splits.test.mjs` checks `byDay`
bucketing with `Date.UTC` fixtures against a function that deliberately
buckets by the LOCAL day, so it agrees only from UTC−9 to UTC+11:59 and
never crosses the boundary the function exists for.

## The fold

`tests/fold.test.mjs` loads the served tree in headless Chrome at 375x667
with empty storage and measures where things land. It exists because the
landing screen's acceptance criterion is a geometric one — the call to
action above the fold on the smallest phone here — and everything guarding
it was blind to CSS. Appending

```css
#landing { padding-top: 40px; padding-bottom: 40px; }
.landing-title { font-size: 1.6rem; }
```

to `styles.css` put that button 58px under the fold with the entire suite
green. A padding and a font-size. **A measurement written into a comment is
not a test**; the same lesson as the app icon that shipped clipped because
`getBBox()` and the rasteriser disagreed about where its ink ended.

`tests/chrome.mjs` is the harness: a static server, Chrome in headless
mode, and CDP over a hand-rolled WebSocket. No dependencies — this project
has none (ADR-0001) and a browser-driver package plus its download is not a
devDependency worth carrying for one screen. It serves the tree unmodified;
a page with an extra script in it is a different page.

It looks for Chrome or Chromium in the usual places, and `CHROME_PATH` is
the last word both ways:

```bash
CHROME_PATH=/path/to/chrome npm test
```

With no browser these files **skip**, which is the honest answer on a laptop
that has none and completely wrong for a release — a skipped test reads as
green. So `npm run preflight` fails when it cannot find a browser. CI needs
nothing extra: the GitHub runner image ships Chrome.

## The focus ring

`tests/focus.test.mjs` clicks the second amount input at 375x667, in both
palettes and on a row that has been typed into, and reads what the
compositor resolved: the row's `outline-style`, its width, its colour, the
colour behind it, and whether the input inside it drew a second ring.

It exists because the static check could not see the ordinary way the
defect returns. `tests/a11y.test.mjs` asked styles.css whether the amount
row draws a visible ring, using `.find()` on a selector — the FIRST rule
with that text, where CSS applies the LAST. One appended line,

```css
.field:has(input:focus-visible) { outline: 3px solid var(--accent-glow); }
```

put the app's primary control back on a 1.27:1 focus indicator with the
whole suite green and no ring on the screen. `tests/csscheck.mjs` now
answers that question properly — every rule written with that selector, not
the first — and has its own tests, because a helper that decides something
and is never itself tested is a comment that runs.

What it still cannot do is resolve specificity across DIFFERENT selectors.
`.field.source:has(input:focus-visible)` — the row you are typing in, which
is the case the criterion is really about — beats the rule that draws the
ring, and no parser short of a browser knows that. The browser does. Both
mutations fail now; only the second one needs this file.

Two things it establishes rather than assumes, because getting either wrong
would make the measurement meaningless: the click must land in the input
(`:focus-visible` is a heuristic about how focus ARRIVED, and a scripted
`el.focus()` does not satisfy it in Chromium — the row then draws nothing,
which reads exactly like the defect), and `.field` transitions
`border-color` over 0.18s, so a style read taken straight after flipping the
palette returns the colour it is transitioning away from.

## The rules suite

`tests-integration/` runs the actual `firestore.rules` file against the
Firestore emulator with throwaway accounts, and asserts what a member, an
invitee, an unverified invitee and a stranger can each do.

**It exists because three invitation bugs shipped in a row that nothing
could catch without signing in as the owner.** Anything touching rules,
invites or access gets tested here first.

### The JDK trap

The emulator needs **JDK 21+**. It will otherwise refuse to start with
`firebase-tools no longer supports Java version before 21`.

`/usr/libexec/java_home -v 21+` is not a reliable way to find one: it
returns an *older* JDK rather than failing, and Homebrew's `openjdk` is
keg-only so `java_home` never sees it at all. The npm script therefore
points at `/usr/local/opt/openjdk` directly. If that path is wrong on
your machine:

```bash
brew install openjdk
```

then fix `JAVA_HOME` in the `test:rules` script.

Note also that `A=x B=$A` in a single command prefix expands `B` against
the OLD `A` — the script exports them on separate statements for that
reason.

### Writing a rules test

Each test starts from an empty database (`beforeEach` → `clearFirestore`).
Without it, a test where B joins leaves `memberUids: ["A","B"]`, and the
next test's seed — written as A with `memberUids: ["A"]` — is refused by
`keepsEveryone()`. The rules are right; the harness was wrong.

## What neither suite covers

- **`js/app.js`** — io and DOM. Kept as thin as possible for exactly this
  reason ([CONTRIBUTING.md](../CONTRIBUTING.md)).
- **The browser, nearly all of it.** `fold.test.mjs` measures one screen's
  geometry and `focus.test.mjs` one control's focus ring; nothing else is
  driven. After deploying, drive the live build
  and confirm the version in the header first — a service worker will
  happily serve you the previous release.
  (On the maintainer's Mac a local server has failed to read a tree under
  `~/Documents`, which is macOS withholding folder access from whichever
  app launched it rather than a property of the path: the fold harness's
  own server was verified reading that same tree. If a machine does deny
  it, the measurement fails saying the page never painted — it does not
  quietly pass.)
- **Real devices.** Two bugs got through everything above because they
  only exist on a phone: iOS delivers web push solely to an installed
  PWA, and iOS Safari does not apply `:active` at all unless the document
  has a touch listener — so every button looked dead on an iPhone while
  working perfectly on desktop.
- **The Cloud Function end to end.** `functions/notify.js` is pure and
  unit-tested; delivery is not.

## Before any release that touches `firestore.rules`

```bash
npm run test:rules
```

That suite includes `rollout.test.mjs`, which answers a question no other
test does: **may the rules ship before the client, or must the client go
first?**

The answer is not fixed. It depends on the change and it has already
reversed once between two consecutive releases. Rules and clients deploy
separately, and a service worker only reaches a device on its second
open, so there is always a window where one side is old — and if the
order is wrong, every push from the older side is refused with a
`permission-denied` that no user ever sees. Syncing just stops.

The test reads the live rules and the live client out of the commits
pinned in [`deployed-baseline.txt`](deployed-baseline.txt) and runs them
against the proposed ones, so it compares what is genuinely deployed
rather than a copy that can drift.

**Keep that file current — it is the whole gate.** It names two commits,
because the client and the rules go live in separate acts and are
routinely different commits (ADR-0023 ships the client and publishes the
rules days later). Update each line at the moment that half actually
goes live, not when it is committed.

It used to read `git HEAD` instead, and that was wrong in a way worth
remembering: `HEAD` is not what is deployed, it is whatever was committed
last. So the gate was accurate only while the work it was gating sat
uncommitted. Committing it — the next thing that happens after sign-off —
made the sprint its own baseline: five of the six tests became vacuously
true, the sixth failed on a premise about a client that no longer
existed, and the release gate went red for a reason unrelated to the
release. Nobody noticed during development, because before the commit it
was green.

If the rules are not changing, the file skips itself and says so, rather
than passing six tests that compare nothing.

`tests/deployed.test.mjs` covers the baseline resolution in the **unit**
suite deliberately: CI runs only `tests/*.test.mjs`, so before that
nothing about this gate was checked anywhere except a laptop, mid-release.

# Testing

Two suites. Both must pass before anything ships.

```bash
npm test             # 316 unit tests — no network, no browser, no emulator
npm run test:rules   # the REAL firestore.rules, in the Firestore emulator
```

## The unit suite

Pure modules only, which is why it is fast and worth trusting. It is
**locale-pinned** (`LC_ALL=en_US.UTF-8` in the npm script) — do not
remove that. Six money tests silently flip under a German locale, because
`Intl` decides the separators, so an unpinned suite is green or red
depending on whose laptop runs it.

To reproduce a locale bug on purpose:

```bash
LC_ALL=de_DE.UTF-8 node --test tests/*.test.mjs
```

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
- **The browser.** After deploying, drive the live build and confirm the
  version in the header first — a service worker will happily serve you
  the previous release. A local server cannot run from `~/Documents`;
  macOS blocks it.
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

The test reads the live rules and the live client out of `git HEAD` and
runs them against the proposed ones, so it compares what is genuinely
deployed rather than a copy that can drift.

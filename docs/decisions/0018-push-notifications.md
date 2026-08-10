# ADR-0018: Push notifications, and the first server-side code

Date: 2026-08-09 · Status: accepted

## Context
Live updates (ADR-0012) only run while the app is open. Closing the tab
ends them, so the case the whole feature exists for — "someone added an
expense while I wasn't looking" — was exactly the one it couldn't cover.

Web push cannot be done from the page alone: a browser will not let one
client send to another. Something server-side has to hold the sender
credential and decide who to tell.

## Decision
**Firebase Cloud Messaging, driven by one Firestore trigger.** A single
Cloud Function (`functions/index.js`) watches `trips/{tripId}`, diffs
before against after, and sends to every member except the author.

**This is the first server code in the repo, and ADR-0001 still holds.**
"No build step, no runtime dependencies" is about the PWA: what the
browser downloads is still hand-written ES modules with nothing bundled.
`functions/` is a separate deployable with its own `package.json`, and
its `node_modules` never reach the client.

**Data-only messages, rendered by our own service worker.** The
alternative — a `notification` payload that FCM displays itself — means
two code paths for one notification, and a second service worker
(`firebase-messaging-sw.js`) fighting ours for the scope that holds the
app shell cache. The browser requires a visible notification per push
anyway, so the handler has to exist regardless; having it own the whole
job is simpler and keeps one worker.

**The author rides in `lastEditBy`, top-level and excluded from change
detection.** Putting it on the trip record would restamp the record on
every push and hand a device that merely synced a merge win — ADR-0017,
which this project has now learnt three times. It is also left out of
`payloadChanged`, so a change of author never costs a write on its own.

**The token is device-local, like `clockOffset`.** Syncing it would have
every device claiming every other device's token, and one phone turning
notifications off would silence them all.

**Silence is the default, and most changes stay silent.** Only genuinely
new expenses, new payments and new members notify. Edits, renames and
reorders don't. A notification you didn't need is how people turn
notifications off entirely.

## Consequences
- Setup needs three things only the project owner can do: generate the Web Push
  key, deploy the function, and grant permission per device. See
  `docs/PUSH.md`. The switch hides itself until the key exists rather
  than offering a toggle that can only fail.
- **iOS delivers web push only to an installed PWA** (16.4+). In a Safari
  tab the API exists and permission can be granted, and nothing is ever
  delivered — so the app detects that case and says so.
- Cost is a rounding error (a few hundred invocations against a free tier
  of two million), and `maxInstances: 3` caps the blast radius of a bug.
- Dead tokens are pruned when FCM reports them, or every send retries a
  corpse forever.
- Signing out drops the token: the next person to use that browser is not
  on those trips.

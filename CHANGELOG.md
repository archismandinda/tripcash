# Changelog

All notable changes to TripCash are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

## [1.68.0] - 2026-08-10

Sprint 3. The Cloud Function was deployed first, because `functions/beacon.js`
gained `invite_sent` and until it was live the server dropped every one of
those beacons as `unknown-event`, silently.

### Fixed
- **Money is parsed in the number format the person is actually using.** The
  payment amount and the split shares were parsed with no locale at all, so
  on any comma-decimal device — most of Europe, Latin America, Indonesia — a
  share typed as `2,50` entered the ledger as `250`. Because the
  home-currency value is snapshotted when an expense is saved and
  deliberately never re-priced, that number was wrong permanently, on every
  phone on the trip, and nobody would find out until settle-up produced
  nonsense. A prefilled payment amount could also fail to parse back at all,
  leaving Save silently dead with the number still on screen.

  `tests/convert.test.mjs` had proved the conversion module correct across
  six locales for months. It never tested a CALL SITE, which is exactly how
  this survived. `tests/callsites.test.mjs` now reads the real source and
  fails if any call omits its locale.
- **A signed-out iPhone no longer loses a week of expenses in silence.**
  WebKit deletes all script-writable storage after seven days without
  interaction unless the app is on the home screen. `js/persist.js` was
  written, tested, and imported by nothing — the module that knew this was
  dead code while the data loss was live. Now wired, and
  `navigator.storage.persist()` is actually called.
- **macOS Safari was told to open a ⋮ menu it does not have.** Two modules
  each carried their own copy of "add it to your Home Screen", and on a Mac
  both were wrong in different words — Safari there has File → Add to Dock.
  `js/install.js` now owns the question and `js/persist.js` is handed the
  answer. The iPad-in-desktop-mode gap is closed with a touch-points probe:
  an iPad sends a Mac's user agent and nothing else tells them apart.
- **Home currency follows the device** instead of being Indian Rupees for
  every new user on earth. Written unstamped, so a currency the app guessed
  always loses to one a person chose (ADR-0017).

### Added
- **A seventh counter: an invitation was sent.** Without it `k = invites ×
  acceptance × conversion` was missing its first term, so the
  instrumentation shipped in 1.66.0 could not answer the one question it
  exists to answer. `PRIVACY.md` updated in the same change — the promise
  and the code have to move together, and `tests/disclosure.test.mjs` now
  fails if they drift.


## [1.67.0] - 2026-08-10

Sprint 2. **Release order is the reverse of 1.65.0: this client ships
FIRST, and `firestore.rules` is published only afterwards.** Getting it
backwards refuses every push from any phone still on the old build, on any
trip created before `ownerUid` existed, with a `permission-denied` no user
ever sees — syncing simply stops. Proved in the emulator by
`tests-integration/rollout.test.mjs`, which runs the *published* rules and
the *deployed* client against the proposed ones. See ADR-0023.

### Added
- **The cold open.** Tapping an invite link now names the trip and who
  invited you — "Priya invited you to Kyōto 🏯 · 4 people · INR, THB" —
  before asking for anything. It used to show "No trips yet. / Create your
  first trip", which is the opposite of what the sender promised, and it
  was the largest drop in the funnel. The preview travels in the link's own
  fragment (`js/invitelink.js`), so it renders with no account and no
  network. It is a claim, not a fact: nothing decoded from a link is ever
  persisted, and the name is written with `textContent`, so a trip called
  `<img src=x onerror=…>` renders as literal text.
- **A join now lands on the trip**, or says which of three things went
  wrong, on the screen the person is actually looking at (`js/joining.js`).
  It used to write the explanation into a settings panel that was closed.
- **Install advice that matches the phone** (`js/install.js`). The old hint
  said "In Chrome tap ⋮ → Add to Home screen" to everybody, including
  iPhone users who have no such menu — and the event behind it is
  Chromium-only, so it had never fired on iOS Safari at all. Also stops
  telling people who have just installed TripCash to install TripCash.

### Fixed
- **Ownership of a trip can no longer be seized** (ADR-0023). On any trip
  created before `ownerUid` existed, `keepsOwner()` short-circuited to true,
  so a member could name themselves owner in one ordinary background push,
  be pinned there by that same rule, and evict the person who created the
  trip with a second. Reproduced against the currently published rules —
  seize succeeded, evict succeeded, the creator lost read access — and
  refused at step one by the new ones. `buildPayload` no longer nominates
  its own author; minting an owner is confined to the first upload, the one
  moment anything can prove there is no owner to displace.
- **A join against a deleted trip reported success**, set `hasJoined`, and
  counted an acceptance — poisoning the one number the growth loop is
  measured by.
- **An invitation that could never succeed was retried on every sync for
  ninety days.** The cleanup meant to stop it was refused by the rules,
  and the refusal was swallowed at the call site.

### Changed
- Comments and tests no longer cite design documents that are not in this
  repository. They were moved out when the repo was made public; the
  citations stayed, and pointed at paths that 404 for every reader.
- ADR-0023's evidence paragraph corrected. It described the old-rules
  compatibility check as reasoned rather than executed; it is executed, and
  an ADR that understates its own evidence invites someone to redo the work.


## [1.66.0] - 2026-08-10

### Added
- **Six anonymous counters, wired up.** The beacon endpoint shipped in
  1.65.0 with nothing calling it, so the app had no idea whether anyone
  used it. `js/app.js` now counts a share link being opened, an
  invitation being shown, a join, a device's first-ever expense, a trip
  being created (with one flag: was the creator someone who had
  previously joined), and a return after 30+ days.

  Two properties this is built to keep. It is a plain POST to a Cloud
  Function, NOT the Firebase SDK — a signed-out visitor still makes zero
  Firebase requests, which the whole share-link flow depends on. And it
  cannot break the app: counting an expense is not worth failing to save
  one, so the send is wrapped and the caller never learns whether
  anything went.

  What goes on the wire is a hard allowlist in `js/analytics.js`: event,
  a random device id, the app version, a timestamp. No trip names, no
  member names, no amounts, no currencies, no addresses. The server
  stores per-day totals only.

- **A switch for it**, in Settings. Off by default in the UK, EU and EEA;
  on elsewhere; never a popup, and nothing about the app changes either
  way. The switch is rendered from the state actually in force — it was
  briefly wired into a function that only runs when signed in, which
  would have shown a signed-out visitor an unchecked box while counting
  was on.

- `PRIVACY.md`, `SECURITY.md`, `CONTRIBUTING.md`, `LICENSE` and issue
  templates. An app that asks people to trust it with money should answer
  these before it is asked.

### Fixed
- **An error message told users to "tell Claude"** if sign-in kept
  failing, which meant nothing to them. It now says something they can
  act on.

### Changed
- The repository is public-facing: internal working documents and
  business strategy moved out of it, and every personal name, real email
  address and local path scrubbed from code, comments, tests and history
  of the changelog. Test fixtures use neutral names and the reserved
  `@example.com` domain.


## [1.65.0] - 2026-08-10

### Fixed
- **Nobody but the owner can take the owner off a trip.** `firestore.rules`
  already pinned the owner's UID, so their ACCESS was never at risk —
  which is exactly what made this quiet. The write succeeded, because the
  rules police `memberUids` and this deletes a row from `members`: the
  owner stayed able to open a trip they had vanished from, gone from the
  members sheet and out of every split, with no notice on either phone.
  Reachable on any trip where the owner had not spent anything yet, which
  is every trip on its first day. The disabled Remove button now says why
  instead of being a dead control. Found by the sprint 1 sign-off.
- **A device now knows its clock offset BEFORE it stamps anything.** The
  probe was write-now, read-back-NEXT-time, and it was read after the
  trips had already been pushed — so a device's first sync (new phone,
  reinstall, new account on an old phone) always stamped at offset 0. And
  0 is not "no skew", it is "not asked yet"; the old code could not tell
  those apart. `clockPlan()` returns either "probe" or an offset rather
  than conflating them, and `ensureClockOffset()` writes a probe and reads
  it straight back before the first push — one extra read and write, once
  per device for as long as that device exists.

  Replaying the sign-off's own scenario against the real merge rules
  reproduces the loss and then clears it: with the peer's clock 30s ahead,
  a save made 2s AFTER a delete was stamped 28s BEFORE it and was buried;
  5 minutes ahead, 298s before it. Both now stamp in server time and the
  save survives, which is what "an expense you saw confirmed never
  disappears" requires end to end.
- **`js/ledger.js` shipped.** It was untracked while `js/app.js` imported
  it, so the next deploy would have 404'd on startup and the app would not
  have booted at all. It was also missing from the `sw.js` SHELL, the
  quieter half of the same bug: online the network covers for it, and the
  app only fails to open from the home screen with no signal.

### Added
- **The beacon endpoint** (`functions/beacon.js`, `functions/index.js`),
  deployed as function **v1.64.0** — which is why the app has no 1.64.0:
  `functions/` is a separate deployable with its own version (ADR-0001).
  It answers 204 to everything, stores per-day COUNTS and nothing else,
  and `stats/{day}` is denied to every client in `firestore.rules`. See
  `docs/design/INSTRUMENTATION.md`. The call sites in `js/app.js` are not
  wired yet — that is next.
- `tests/shell.test.mjs` — walks the real import graph from `index.html`'s
  entry script and asserts every reachable module is in the offline SHELL
  (and that the SHELL names nothing that would 404 `addAll`, which is
  all-or-nothing). Verified by deleting the `ledger.js` line and watching
  it fail by name. Nothing checked that list before; it had now been
  missed twice.
- `tests-integration/compat.test.mjs` — six emulator tests proving a phone
  still running the previous release can create, and write, and write a
  trip owned by someone else under the NEW rules. The rollout order is
  rules first and clients update on their second open, so there is always
  a window where the live client meets the new rules; publishing without
  checking it would break the owner's own phones with nothing on screen to
  explain it.


### Fixed
- **A co-member's offline edit silently and permanently stripped a joined
  member's write access (TC-4).** ADR-0022 made both access lists derive
  from the WINNING trip record's members, and listed the remaining
  exposure as "the gap between two consecutive writes from the same
  device" because `joinTrip` claims the joiner's member row immediately.
  That was wrong: the gap is not on the joiner's device at all, it is on
  everybody else's.

  Bo joins; the cloud document now has `members[m2].uid = "B"`. Asha's
  phone is offline and never pulls that join, so his copy of Bo's row
  still has no uid. He renames the trip — an ordinary edit — and his
  record stamps newer, so it wins the merge and `memberUids` is derived
  from a members list where Bo is a name and an address and nothing else.
  The rules take that write: the owner is still on it and so is its
  author. From then on every push of Bo's is refused, and his
  `memberUids array-contains` query returns nothing, so live updates stop
  too.

  Worse, it could not be reported or repaired. `invitedEmails` is derived
  from the same stale members list and still holds Bo's address, so the
  document stays READABLE — and `evictionFrom()` concludes "not evicted"
  from exactly that, correctly, since a refused write is equally what an
  out-of-date rules deployment looks like. So Bo got the generic "the
  database turned this down" on every sync, for ever, on a trip nobody
  removed him from. And nothing healed it: Asha's record is the merge
  winner, so the claim was gone from both sides.

  A member row's `uid` is not an ordinary edited field — it is a CLAIM,
  written once, by that account's own device. A winner missing one has
  not removed anybody; it has not heard yet. `mergePayload` now folds the
  losing record's claims onto the winner before deriving access
  (`reconcileClaims` in sync.js), so the winning record re-learns the uid
  and the next push keeps it. Removal is untouched, because removal takes
  the whole ROW away and a row the winner no longer carries is never
  rebuilt here — only rows both sides still have are filled in. Proven
  against the real `firestore.rules` on the emulator: the eviction write
  the rules would have accepted no longer happens, and Bo keeps read,
  write and his live-update query.

- **The first sync after the upgrade filed every old deletion under
  whichever trip happened to go first, and lost the ones still on their
  way to the cloud.** TC-3's scoping rests on `tombstones.tripOf`, and on
  one deliberate gap in it: a deletion recorded before that map existed
  has no owner, so it rides on EVERY trip's payload until the 90-day
  prune retires it. Guessing its owner would resurrect somebody's
  expense.

  `applyPayload` then stamped every id in a trip's merged payload as
  belonging to that trip — including the riders, which are in the payload
  precisely because they belong to no trip yet. So the very first push
  after upgrading turned "rides on every trip" into "attributed to trip
  A", permanently, on the strength of nothing but push order. A delete
  that had not yet reached the cloud was then excluded from its own
  trip's document for ever: the next device to sync still held the
  record, nothing in that document buried it, and it came back — on
  every phone, including the one that deleted it. Deleting it again did
  nothing, because the second delete was attributed the same wrong way.
  The same thing happened on the way in: a pre-upgrade cloud document
  carries the whole account's map, so absorbing trip A's document claimed
  trip B's deletions for A.

  `attributeArrivals` in merge.js now files only genuine arrivals. An id
  we already hold is not evidence — an unattributed tombstone comes back
  in every document by design — and neither is one whose record we still
  hold alive in another trip, which is proof the document was carrying it
  for somebody else. Both stay unattributed, which is the safe state:
  they keep riding until the trip they belong to claims them or the TTL
  retires them. A delete genuinely made on another device still lands
  attributed on the first sync, so documents still carry only their own
  history.

- **A tie the arithmetic could not quite see brought the phantom ₹0.01
  back on large trips.** TC-2 once more, and the same shape as the two
  entries below it: settle-up's largest-remainder rounding has one free
  choice, at an exact tie between two remainders, and getting that choice
  wrong is the only thing that can make a second settling round
  necessary. Real nets tie constantly — every share of one expense is an
  exact k/n of the same 2-decimal number — but as floats those equal
  values differ in their last bits, so the tie has to be recognised
  loosely.

  It was recognised by snapping each remainder onto a grid a millionth of
  a minor unit wide. A grid is not a tolerance: it moves the point where
  two numbers stop counting as equal, it does not remove it. Halves and
  quarters land mid-bucket, which is what the power-of-two grid was
  chosen for, but the books deal in ninths, twenty-sevenths and
  hundredths, and those land anywhere — including hard against a bucket
  edge, where a few parts in 10^8 of noise puts equal shares on opposite
  sides. A ₹7,70,336.13 group booking split 4/86/4/1/1/4 percent did
  exactly that: the first round handed its spare paise to one member and
  the second round handed it to another, the residues stopped
  cancelling, and marking every transfer paid produced one more ₹0.01 to
  pay. `wholeUnits()` in splits.js now compares remainders against that
  millionth as an actual tolerance, re-ordering each run of equals by the
  existing tie-break (smaller net first, so a half still rounds toward
  moving less money) rather than letting the noise order them. The
  regrouping is done to an already-sorted list on purpose: "within a
  millionth of" is not transitive, and a sort handed a comparator that is
  not a total order may return anything at all — ADR-0015's lesson,
  one layer down.

  This moved the wall out by about 100×: books that used to need a second
  round from around ₹10 lakh in a single expense now settle in one up to
  about ₹1 crore per net. It does not remove the wall, and the limit is
  now written down beside the tolerance in splits.js — past roughly 10^9
  minor units in one net, a double cannot tell a tie from a real
  difference. Raising the tolerance further would only push the wall into
  the gap between remainders that genuinely differ (a percent split puts
  those 0.01 apart), trading a rare extra round for a wrong split, so it
  is left where it is.

  **The test is the other half of this fix, and was the actual defect.**
  The property test certifying "settle-up settles any books in one round"
  generated nets as `raw[i] - mean` over independent random floats. Those
  never tie: every remainder lands in its own arbitrary place, so 1,000
  trips exercised the one branch that matters exactly zero times, and the
  guarantee was certified over a distribution the app cannot produce. It
  now runs 2,000 trips — half float nets, half nets built by
  `tripBalances` from equal, shares and percent splits of 2-decimal home
  values, across trip sizes from a street snack to a very large group
  booking — with the same assertions. Two of those assertions had their
  own fixed epsilons (`1e-6` on a *count* of minor units, meaningless
  once the count reaches 10^10) and now carry a tolerance that travels
  with the number. A deterministic regression test pins the ₹7,70,336.13
  booking, because at these odds the random arm alone would have caught
  the bug on only about 2% of seeds.

- **The summary sheet said "All settled 🎉" while the Balances section
  right below it chased a member for ¥1.** TC-2 again, on the other
  list. A JPY trip, ¥2 split three ways, both suggested transfers marked
  paid: settle-up correctly reported nothing left to move, and the
  balances row underneath printed "owes ¥1" for the same trip. The story
  goal is that nobody is chased for a phantom last payment; the transfer
  list settled, the balances list did not.

  The two lists were rounding differently. Settle-up works in whole minor
  units of the home currency, and the residue it is allowed to leave
  behind is anything under one of them. The balances row classified the
  same net against a hardcoded `net > 0.01 ? "gets" : net < -0.01 ?
  "owes"` in app.js — and 0.01 is a hundredth of a rupee, a hundredth of
  a yen, and a hundredth of a dinar. On a 0-decimal currency the residue
  settle-up is entitled to leave is up to a hundred times that threshold,
  so it read as a real debt and `formatAmount` rounded it up to a whole
  visible yen. The same fixed-epsilon mistake, for the same reason, as
  the flat `>= 1` removed from `settleUp` in v1.45.

  Half a minor unit would not have fixed it either: half is not always
  reachable — nets of 0.4/0.4/−0.8 yen have no whole-unit plan holding
  everyone to 0.5 — so the row would still have chased the 0.6 the books
  legitimately close on. Instead the balances row now reads the net from
  the new `roundedNets()` in splits.js, which shares one internal
  `unitNets()` helper with `settleUp` — so both lists round once, the
  same way, and a row can say "owes" only when there is a transfer asking
  for it, for exactly that amount. Verified over 1,000 generated trips
  across 0-, 2- and 3-decimal currencies. Small debts are still shown: a
  whole minor unit is a whole minor unit, and only arithmetic residue
  disappears. app.js keeps no money threshold of its own.

- **Marking every suggested transfer paid left one phantom ₹0.01 behind,
  so the trip needed a second settle-up round.** TC-2's AC2 held only on
  0-decimal currencies. Three friends, one ₹100 dinner, equal split: b
  and c each pay ₹33.33, and the ₹0.0067 of residue came back as
  "c → a ₹0.01" — a transfer to someone who had just been paid. Around
  a fifth of ordinary 2- and 3-decimal trips did this; on 3 decimals it
  could take three rounds.

  `wholeUnits()` (splits.js) hands the leftover minor units to the
  largest remainders, breaking a tie toward the SMALLER net so a half
  rounds down and the residue dies out — the rule that made "All
  settled 🎉" reachable at all. But it detected ties with `===`, and the
  nets it judges do not come from real arithmetic: `tripBalances` builds
  them out of raw fractions and then subtracts settle-up's own rounded
  transfers back off them as recorded payments. Three remainders that
  are all exactly 2/3 arrive 1.7e-13 apart, so the tie never fired, the
  spare unit went to whoever float noise sorted first, and a transfer
  was invented. Largest-remainder rounding only just closes the books,
  and the tie is exactly where it is tightest — which is why a missed
  one costs a whole extra round.

  Remainders are now compared on a grid a millionth of a minor unit
  wide: far below any money, millions of times coarser than the noise of
  adding up a trip, and a power of two so remainders that really are
  exact halves sit at the middle of a bucket rather than on its edge.
  Over 24,000 generated books the second settle-up round went from 6,929
  violations to none; over 20,000 trips each at 0, 2 and 3 decimals,
  every trip now settles in one round (was up to 8). Unchanged: at most
  N−1 transfers, residue still under one minor unit (worst 0.875), and
  no fixed money threshold anywhere.

- **An expense you watched save came back for one sync and then
  disappeared for good.** TC-1's revive (AC2) held on screen and nowhere
  else. When a delete made on the other phone landed mid-save,
  `commitExpense()` put the expense back and `store` cleared the
  tombstone here — but nothing raised the record ABOVE that tombstone,
  and the copy in the cloud document still carried it. `mergeCollection`'s
  `alive()` buries anything stamped at or below a tombstone, and the
  revived record's Lamport stamp is `max(now, highest stamp in previous
  + 1)`: it is absent from `previous`, so its own pre-delete stamp is
  invisible, and `stampCollection` never looked at the grave it was
  emptying. The revive therefore survived only while wall time happened
  to beat the other device's clock — measured, it held at 0–1400 ms of
  skew and lost from 1500 ms up, so it came down to whether that phone's
  clock offset had been learnt yet. The user got no toast either way.

  Two fixes, both needed:
  - `stampCollection()` (merge.js) now takes the collection's tombstone
    map and stamps a revived record one tick past its own grave. A
    record present in a write is alive; this is what makes "alive"
    travel. Same rule as the tombstone itself, which has climbed one
    tick past the record it buries since v1.44.
  - `writeSynced()` (store.js) no longer LOWERS a tombstone it already
    holds. A remote delete is recorded first and the record dropped from
    the list, so the next write saw the id vanish and rewrote the
    tombstone on this clock — discarding however far ahead theirs was,
    and leaving a revive stamped between the two: alive here, buried by
    the cloud.

  Undo of a delete already pushed was wrong the same way, and is fixed
  by the same change. Verified at 0 ms to 5 minutes of skew and across
  50 ms–5 s save gaps, with and without a learnt `clockOffset`.

- **⚠️ Removing somebody from a trip was cosmetic — they kept reading,
  editing and being notified.** Their row left the members sheet and
  nothing else changed. `buildPayload()` unioned the trip's stored
  `memberUids` into every push, so a uid that reached the list could
  never leave it, and `firestore.rules`' `keepsEveryone()` refused any
  write that dropped one — two independent layers, each sufficient on
  its own, with no way past either from the app. A removed person
  therefore kept `allow update` on the trip document: they could read
  every expense, rewrite the ledger, tombstone the whole trip, and
  `functions/index.js` kept pushing every change to their phone. Their
  own device saw a trip it was still a member of and put the member row
  straight back, then propagated the resurrection to everyone (the
  failure already documented in `members.js` case 3).

  `memberUids` is now derived from the WINNING trip record's members —
  the same rule `invitedEmails` has followed since v1.44, and for the
  same reason: a list that only grows can never be corrected. Three uids
  are exempt: the writer (the rules judge a write by the document it
  produces, so a payload without its own author is one nobody could have
  sent), the owner (`keepsOwner()`, new — everyone else can be removed
  and invited back, and the owner is who makes that possible;
  `ownerUid` is pinned at the same time or seizing it and then evicting
  the real owner is two ordinary writes), and the joiner, who must be
  named explicitly because `joinOnly()` forbids a join from restamping
  `lastEditBy`. Deriving from the WINNER and not from the local side is
  what stops a phone with a stale members list evicting people by losing
  the merge. No Cloud Function change: it sends to `after.memberUids`,
  and that list now shrinks. ADR-0022, amending ADR-0011.

  **`firestore.rules` must be published BEFORE this ships.** The
  relaxation is backwards-compatible; the client alone, against the old
  rules, makes every push after a removal fail with `permission-denied`.

- **An evicted device said "the database turned this down — its access
  rules may not be set up yet", on every sync, for ever.** It went on
  showing the trip and letting you add expenses to it, none of which
  could ever leave the phone. `evictionFrom()` (roster.js) now turns the
  refusal into a decision: the trip is dropped from local state and a
  notice names it, and the device stops retrying instead of spending a
  refused write per sync. The trip is *forgotten* (`store.forgetTrip`),
  not deleted — `setTrips` records a local trip tombstone and `syncNow`
  re-asserts those to the cloud, so a device that had merely lost access
  would otherwise destroy the trip for everybody the moment it could
  write again. A refused write is not on its own evidence of removal: it
  is also what an out-of-date rules deployment looks like, and in that
  state the failing device belongs to the person doing the removing —
  so eviction is concluded only when the document cannot be READ either.
  Joining a trip now also claims the joiner's member row in its own
  write straight away, rather than on the next sync's push loop, so
  another device's push cannot derive the list without them in between.

- **Every trip's cloud document carried every OTHER trip's deletions, and
  the pile only ever grew.** `store.getTombstones()` is a single global
  map keyed by collection, and `buildPayload()` copied it wholesale into
  each trip document — so the Goa document listed the id of every expense
  ever deleted in Vietnam, and both grew in step for as long as the
  account was used. The 90-day prune in `store.writeSynced` could not
  hold the line either: `mergeTombstones` never prunes and `applyPayload`
  re-imported the remote map straight back into the global one, so a
  pruned entry returned from the cloud on the very next sync. Firestore's
  1 MB per-document ceiling is a wall with nothing behind it — once a
  trip reaches it, every push for that trip fails for good and there is
  nothing the owner can do about it from the app.

  A deletion now belongs to the trip it happened in. `store.js` records
  that at the moment of deletion (`tombstones.tripOf`), reading it off
  the record being buried — the only thing that still knows, and once
  it is gone the answer is unrecoverable, which is why the whole map used
  to travel. `buildPayload` sends a trip only its own share
  (`tripTombstones` in merge.js), `mergePayload` prunes at the 90-day TTL
  *after* the burial rather than before it (forgetting first would mean
  the merge that drops a tombstone is the merge that hands the record
  back), and `applyPayload` files an incoming delete under the trip whose
  document it arrived in, so it cannot leak back out through the pull
  path.

  The stored shape is a superset of the old one, so nothing migrates and
  no trip is restamped — an unattributed id from before this change keeps
  the old behaviour and rides on every trip until the prune retires it,
  because guessing wrong resurrects an expense somebody deleted. Scoping
  a tombstone out of a document a pre-fix device already wrote does not
  count as a change, so this costs no extra writes (the v1.57 quota bug,
  deliberately not reintroduced). 12 new tests, including 500 deletions
  spread over 200 days across 3 trips driven through the real delete
  path.
- **"All settled 🎉" was unreachable on a 0-decimal home currency, and
  settle-up could swallow real debt.** `settleUp()` printed a transfer
  rounded to what the currency can pay but subtracted the UNROUNDED
  amount from the ledger behind it, and judged the leftover against a
  hardcoded 0.01 — which is a hundredth of a rupee, but a hundredth of a
  *hundred* yen. Two members and a ¥3 dinner suggested ¥2, then ¥1 back
  the other way, then ¥1 again, for as long as anyone kept tapping Mark
  paid: JPY, VND, IDR, KRW, HUF and ISK trips could never close. The
  other direction was worse and silent — when the rounded transfer came
  out as zero the row was dropped but both ledgers were still
  decremented, so five people owing ¥0.4 each cancelled a ¥2 debt and
  the app declared the trip settled.

  Settle-up now works entirely in whole minor units — yen, paise, fils —
  the only money anyone can actually hand over. Nets are rounded to
  whole units largest-remainder style, so what is owed still equals what
  is due (rounding each net alone invents or destroys a unit and leaves
  a side that can never clear), and every debt is decremented by exactly
  the transfer that paid it. An exact half rounds toward moving *less*
  money: that tie is the only free choice in the rounding, and taking it
  upward is precisely what made the oscillation. What survives is under
  one minor unit per person — arithmetic residue, not a debt. Half a
  unit is not always reachable and no algorithm can get there: for nets
  of (0.4, 0.4, −0.8) yen the nearest whole units are (0, 0, −1), which
  do not sum to zero, so somebody must end up 0.6 out. Five new tests,
  including 1,000 random trips that must all settle in one round.
- **An expense saved while a sync was in flight could vanish.**
  `saveExpense()` read the record it was editing and built the new one
  BEFORE three awaits (the photo prepare, and the IndexedDB write or
  delete), then committed with
  `editId ? expenses.map(...) : [...expenses, record]`. If a live
  snapshot landed in that window carrying a delete made on the other
  phone, `.map()` matched nothing and the edit was thrown away — no
  error, no toast, no trace — leaving the receipt just written to
  IndexedDB pointing at a record that no longer existed. A push is
  scheduled 1.2 s after every save, so the window was open almost
  continuously.

  The expense now always ends up in the ledger, once. Losing one is
  worse than resurrecting one: a resurrected expense is on screen and
  can be deleted again, a lost one is discovered weeks later when the
  trip is being settled, if ever.

  This was the fourth appearance of the shape ADR-0019 was written
  about, and every earlier variant destroyed data on a real phone.

### Changed
- **Where a saved expense goes is now a tested decision.**
  `js/ledger.js` — `commitExpense()` and `resolveCreatedAt()`, 7 tests.
  It is a pure function of what it is handed, so it cannot hold a
  pre-await snapshot; `app.js` passes live state at the moment of the
  write and paints the result. Two behaviours came out of the move: a
  record that reappears under a different route can no longer produce a
  duplicate row, and untouched rows are the same objects they were, so
  an edit doesn't restamp and re-push the whole ledger.
- With this, `app.js` decides nothing in the ledger path either —
  absorption, membership, pricing and now the commit are all pure.

## [1.63.0] - 2026-08-10

### Changed
- **What an expense is worth is now one tested rule.** `js/pricing.js`.
  The snapshot rule — only a change to the amount, the currency or the
  home currency re-prices an expense — was written out three times, in
  the save, the preview and the "locked in" label. In v1.46.1 they
  disagreed: the sheet promised today's rate while the save correctly
  kept the original. The currency-option list moved with it; leaving out
  the expense's own currency is what turned ¥25 into €25.
- With this, `app.js` no longer decides anything about sync absorption,
  membership or pricing. The three areas that produced every bug found
  in testing are pure and tested; `app.js` reads inputs and paints
  outcomes.

## [1.62.0] - 2026-08-10

### Changed
- **Adding, inviting and removing people is now one tested decision.**
  `js/roster.js`. Both "add member" fields and both copies of the
  removability rule were separate implementations of the same thing, and
  they had already drifted: only one warned when signed out, only one
  could invite at all, and only one knew that a recorded payment counts.
  Five of the owner's reports came from that drift. They now share one
  function, so it cannot recur. 15 tests.
- The reason shown on a locked member chip comes from the same gate that
  locked it, so the explanation can't disagree with the rule.

## [1.61.0] - 2026-08-10

### Changed
- **Sync absorption is now a tested decision, not inline plumbing.**
  `js/absorb.js` takes the state as it is and returns the state as it
  should be, plus the effects to perform and the order to perform them
  in. `app.js` only carries them out.

  This is the code that produced four data-loss bugs in a fortnight —
  applying a stale snapshot over a mid-flight save, clobbering the
  tombstone map, leaking receipts, and letting a shared trip arrive
  silently. All four were wiring, not logic: the merge rules underneath
  were right the whole time, and the wiring was the part that couldn't
  be tested. 11 tests now pin it, one per bug that reached a phone.

## [1.60.0] - 2026-08-10

### Fixed
- **Buttons gave no response to a tap on iPhone.** The app kills the OS
  tap flash globally — it paints a rectangle that ignores border-radius —
  and relies on each control's own `:active` state instead. But **iOS
  Safari does not apply `:active` unless the document has a touch
  listener**, so on an iPhone there was no flash, no press state and no
  feedback of any kind: a tap looked exactly like a miss. An empty
  passive `touchstart` listener is the entire fix.
- **Half the controls had no press state to fall back on** — member
  chips, type chips, segment buttons, tabs, expense rows, Mark paid, the
  bell. There is now a floor for every button, with the hand-written
  states still taking precedence.

## [1.59.2] - 2026-08-10

### Fixed
- **Your own row now reads "You" everywhere.** Signing in replaces the
  "You" placeholder with your real display name — which is right, since
  that is what everyone else sees — but two screens printed it back to
  you: the balances list in the summary, and the member chips in the
  trip editor. Everywhere else already said "You", so the same person
  appeared under two names in one sheet.

## [1.59.1] - 2026-08-10

**UI QA sweep.**

### Fixed
- **An expense could be re-saved in a currency you never chose.** Remove
  a currency from a trip that has expenses in it — or let another member
  do it — and those expenses opened with a DIFFERENT currency selected
  while the row behind still read the old one. Retyping the amount saved
  it in the original: ¥25 became €25, a 180× error, with the wrong
  currency on screen throughout. The picker now always offers the
  expense's own currency.
- **Delete trip looked exactly like Save.** `.primary.danger` had no
  style at all, so the button that destroys a trip on every member's
  phone rendered in the app's Save-green, full width, at thumb height —
  with "Keep it" a faint grey row above it.
- **Settle-up now says who pays whom.** The name column was the only
  element allowed to shrink, so at 320px rows read "You …" with no way
  to see the recipient — on the app's headline screen.
- **Adjusting a split no longer erases the local-currency figure.** One
  keystroke replaced "12 JPY / ₹6.71" with "₹12.07" — losing the number
  you were adjusting the split to work out.
- Notices for deleted trips are pruned, instead of sitting in the unread
  badge and doing nothing when tapped.
- Signed out, the "Send them the invite" button is hidden — the trip has
  never been uploaded, so the link it sends resolves to nothing.

## [1.59.0] - 2026-08-10

**Accounts and access.** Requires a rules publish AND a function deploy.

### Security
- **Joining a trip now requires a verified email address.** Reading and
  discovery do not. `joinOnly()` only ever gated the FIRST write — the
  join itself makes you a member, and from the second write everything
  was permitted. An unverified account registered on any member's
  address, plus a forwarded invite link, could rewrite the ledger or
  tombstone the trip for everyone. The v1.29 objection is answered by
  where the gate sits: a refused query says nothing, a refused join is
  explained on the spot.
- **Push no longer trusts a self-written email.** The function resolved
  invitees through a `users` field each account writes for itself, so
  claiming any participant's address subscribed you to that trip — every
  expense description and amount, on your lock screen. It now resolves
  through Firebase Auth, which the client cannot forge.

### Fixed
- **Removing a member is now permanent.** Their uid stays on the access
  list for ever, so on THEIR device nothing matched and a fallback
  branch put them straight back — and their push propagated it. That
  branch invented member rows; it now does nothing.
- **A second account signing in on the same device** injected itself
  into the first account's trips, where it resolved as "You" and could
  log expenses — then reported the refused push as "the database turned
  this down". Same branch.
- **Adding someone's email when they're already on the trip by name now
  invites them**, instead of refusing and advising a surname — which
  created a duplicate person and split the ledger across two rows.
- **Signing in no longer erases the phone number** whoever invited you
  typed, from every trip on every device.
- An invitation attempted while a sync was already running is retried
  rather than reported as "you're offline" and dropped.
- An index entry for a trip that was deleted, or that this account
  cannot open, is pruned instead of being re-fetched for ninety days.
- Adding someone by email while signed out says so, rather than showing
  them as "invited" when no invitation exists or ever will.

## [1.58.0] - 2026-08-10

**Sync QA.** Requires a rules publish.

### Fixed
- **Every sync scheduled the next one, forever.** Absorbing what a sync
  pulled calls the same saves a user edit does, and each one schedules a
  push — so an idle signed-in tab re-synced every 1.2 seconds, about
  3,000 times an hour, against a free tier of 50k reads a day. When it
  ran out, sync stopped working on every device until midnight.
  `absorbRemote` had always guarded this; the copy inside `syncNow`
  never did.
- **A change to your home currency could be reverted permanently.** The
  live preferences listener applied whatever arrived if it merely
  DIFFERED, without checking whether it was newer — so a phone running a
  routine sync could overwrite the laptop's change and knock its stamp
  below the older value, leaving nothing to win with. ADR-0015's lesson,
  in the one path the ADR never touched.
- **Profile housekeeping restamped trips whose sync had failed**, handing
  pre-merge content a fresh stamp so it won the next merge and erased
  the other device's edit. ADR-0014, from a path it didn't cover.
- **A stranger could empty your invite index.** `allow write` covers
  delete, which overrode the ownership check above it — so anyone who
  knows your address could wipe every invitation waiting for you, with
  nothing to report. Updates may now only ADD.
- Invitations are stamped on the server clock. Written from a phone
  whose clock was behind, an invite was classified as expired by the
  recipient and then deleted as spent — so re-inviting wrote the same
  dead entry again.
- The Members-sheet invite path records `invitedAt`, so a trip save
  doesn't re-send to everyone already invited.

## [1.57.0] - 2026-08-10

**Amount entry, from a QA sweep.** Every finding here is a locale bug in
code shipped in v1.45–v1.49.

### Fixed
- **Typing an amount scrambled the digits** on any locale that doesn't
  group with an ASCII comma — de, es, it, nl, pt-BR, id, vi, tr (group
  with ".") and fr, ru, nb, pl, cs, sv (non-breaking space). The caret
  counted "everything that isn't a comma" as a digit, so typing 12345
  produced **12354** and 12345678 produced **12356874**. Silently, into
  an expense.
- **The converter's INR row showed one number and computed another.** It
  parsed with the device locale and regrouped with the currency's — the
  exact mismatch the comment above it forbids. On a European device,
  typing 12345 into the INR row stored **1.2345**.
- **A scanned QR code inflated the amount 100×** on comma-decimal
  devices. UPI and EMVCo amounts are dot-decimal by specification and
  were being read with the device locale.
- **A typed "." was swallowed on comma-decimal locales**: `1234.50`
  became **123450**. A lone separator trailed by one or two digits is
  now read as a decimal point — a shape our own formatter cannot emit,
  so it can never misread the app's own output.
- **Amount entry was impossible on ar, fa, bn, mr, ne, my.** Our own
  formatter emits those locales' digits and the parser was ASCII-only,
  so the field froze after one keystroke.
- **Editing an INR expense blanked the amount** on a European device.
- **Stored XSS**: member, trip and expense ids are written straight into
  `innerHTML` attributes and come from a synced document, so any
  co-member controlled them. Now escaped, and `escapeHtml` no longer
  throws on a non-string — which took the whole ledger render with it.
- The test suite silently assumed an en-US machine; six money tests
  flipped under a German locale. It now pins its own locale.

## [1.56.0] - 2026-08-10

### Fixed
- **Adding a member could not invite anybody.** Both "add member" fields
  accepted a NAME and nothing else, so adding someone from the obvious
  place produced a name-only member — which grants no access, sends no
  invitation, and looks exactly like having invited them. This, not
  push and not verification, is why "I added them and they got nothing"
  kept happening.
- Those fields now take **a name or an email**. An address is treated as
  an invitation: the member is created with it, the trip is pushed, and
  the invite is written to their index — with a toast naming who can now
  open the trip. `invitedAt` records that it actually went out, so
  re-saving doesn't re-send and a failed send is retried.

## [1.55.1] - 2026-08-10

### Fixed
- **Removing a member did nothing.** A regression from v1.50.0: that
  release stopped the editor clobbering a member another device had just
  added, by keeping everyone absent from the edited list — which made a
  deliberate removal indistinguishable from an arrival, so the removed
  member was put straight back. Telling them apart needs the member list
  as it was when the sheet OPENED, which the editor now records.

## [1.55.0] - 2026-08-10

**Invitations, rebuilt.** ADR-0020. Requires a rules publish.

### Changed
- **Discovery is now one document read**, addressed by the hash of your
  own email — not a query the database can refuse without saying why.
  That query, and the verified-email gate on it, are deleted.
- **Verification gates nothing.** It never guarded anything real: an
  unverified invitee could already read and join a trip by link. It only
  ever gated a convenience search, and it stranded a real user twice.
- **An invitee now discovers a trip unverified, with no link, on their
  first sync** — the commonest real case, which never worked.
- **One join path** for the index and the link. Two is how they came to
  differ in the first place.
- Adding someone's email now reports what happened — "Bo can now open
  Goa", or that it will go out when you're back online. It used to be a
  silent background sync.

### Added
- `npm run test:rules` — the real `firestore.rules` in the Firestore
  emulator, with throwaway accounts, asserting what a member, an
  invitee, an unverified invitee and a stranger can each do. 21
  assertions. All three invitation bugs would have failed here first.

## [1.54.0] - 2026-08-09

### Added
- **Members on the collapsed trip card.** A tick marks a member whose
  row is held by a real signed-in account — i.e. someone who will
  actually receive the trip. Invited-but-not-opened is dashed; a
  name-only member is plain. It was previously invisible until three
  screens down.

## [1.53.1] - 2026-08-09

### Fixed
- **A verified account was still refused as unverified.** Firestore
  rules read the `email_verified` claim inside the ID token, and
  Firebase caches that token for up to an hour — so verifying in your
  mail app's browser changed nothing here until the token happened to
  expire. Nothing in the app ever called `reload()` or forced a token
  refresh, so the invite search kept failing long after the user had
  done everything right. Sync now re-checks before searching, and
  Settings gains **"I've verified — check now"**.

## [1.53.0] - 2026-08-09

### Fixed
- **Found why shared trips never arrived.** Searching for trips you were
  invited to reveals ids you were never told, so the rules require a
  **verified** address for that search — the invite *link* path
  deliberately doesn't. An unverified account was therefore refused, and
  the app reported it as *"Invitations need the updated database
  rules"*: the wrong cause, and nothing the user could act on. It now
  says to verify, and files a notification that opens Settings.

### Changed
- **The bell is always in the header**, beside the profile icon. Hiding
  it until something arrived meant the one place that answers "did
  anything happen?" was itself invisible until something had.
- **Notifications say who, what and how much** — "Bo added Dinner ·
  ₹1,200 to Goa", "Bo recorded a payment to you in Goa", "Cy was added
  to Goa" — with an icon per kind. An unknown actor reads "Someone"; a
  raw uid never reaches the screen.
- Tapping routes correctly: trip notices open that trip (syncing first
  if this device hasn't got it), account notices open Settings.

## [1.52.0] - 2026-08-09

### Added
- **Notifications list, with a bell and an unread badge.** Push is the
  unreliable half of "tell me what happened" — iOS delivers it only to
  an installed PWA, permission can be declined, and a phone can be
  offline all day. This is the reliable half: every event is recorded on
  the next sync, from data the device already has, whether or not a push
  arrived. So "did someone add me to a trip?" is answerable by opening
  the app, which is the one thing a user can always do.
- **An update control that works on an installed iOS PWA.** Settings →
  App version → Check. A home-screen PWA has no address bar, no reload
  gesture, and is suspended rather than killed, so it can sit on an old
  build indefinitely — which is exactly what happened to the iPhone SE.
  Checking compares against the network directly, and applying drops the
  caches and the worker rather than hoping.

## [1.51.0] - 2026-08-09

### Fixed
- **Being added to a trip told you nothing.** The function sent only to
  `memberUids` — and you are not in that list until you open the trip,
  so the person invited was the one person never notified. Accounts now
  record their own address on their user document, and invitees are
  resolved through it. Verified: a trip created by the second account
  reaches both of the first account's devices, and skips its author.
- **A trip arriving from someone else now announces itself** — it used
  to appear silently at the bottom of the list. Tap Open to jump to it.
- **Sheets no longer scroll the page behind them**, and the close button
  can't scroll out of reach. Every sheet now has the fixed
  header / scrolling middle / fixed actions structure the tall ones
  already had; the Settings sheet in particular was scrolling itself,
  taking its own ✕ with it.

## [1.50.2] - 2026-08-09

### Fixed
- **Avatar initials sat off-centre.** `display: block` in a
  higher-specificity rule beat the `display: grid` that does the
  centring, so `place-items` had nothing to act on. Also compensated the
  trailing letter-spacing, which nudges centred text left of true
  centre — visible on two letters in a 44px circle.

## [1.50.1] - 2026-08-09

### Fixed
- **Creating an account said nothing about the verification email.** The
  send was wrapped in `.catch(() => {})`, and `sendVerification` also
  returned `false` silently when it re-read the session and lost the
  race with account creation — so a failure looked exactly like a
  success and you waited for mail that was never sent. The user object
  is now passed straight through, and the outcome is reported either
  way.
- The Cloud Function carries a version constant, because `firebase
  deploy` can decide the source is unchanged when it isn't, and a
  silently skipped deploy looks identical to a successful one.

## [1.50.0] - 2026-08-09

**UI/UX and the last of the audit.** Third batch.

### Fixed
- **Signed out, the app called the trip's first member "You".** Add your
  friends before yourself and every "You paid", every balance and every
  settle-up row referred to Alice — and she couldn't be removed, because
  self never can be. Nobody is "you" now unless a member says so.
- **Split rows called you by your real name** while the payer chips in
  the same sheet said "You".
- **The delete-trip confirmation dropped "this can't be undone"** exactly
  when there were expenses to lose — the count replaced the warning
  instead of joining it. It now names the payments and receipts too.
- **Deleting two expenses in a row finalised the first one instantly**,
  destroying its receipt before the undo window had run.
- **The trip editor wrote a snapshot from when it opened** over any
  member who arrived while it was open — and restamped it, so the
  deletion won the merge and travelled.
- **Preferences got the Lamport anchor** records have had since v1.41. A
  slow clock could never change the home currency: the edit stamped
  older than the value it replaced and was reverted.
- **Receipts orphaned in IndexedDB** when an expense was deleted on
  another device.
- **`ensureMembers` wrote and synced from inside a render** — a trip
  arriving with no members was mutated, restamped, and pushed.
- An expense whose split names nobody no longer breaks the balances.
- Totals no longer add two currencies together in the moment before
  rates arrive.

### Changed
- **Amount is the first field in the expense sheet.** It was below two
  optional fields and a photo picker, half-hidden by the action bar.
- **Changing home currency asks first**, and says what will and won't
  change.
- Disabled buttons look disabled; the disabled primary — which carries
  the "why is this dead?" message — went from 2.07:1 to 4.79:1.
- Long member names ellipsise in settle-up rather than wrapping to five
  lines.
- Tapping the grip moves a trip up one place, so reordering isn't
  drag-only.
- Header buttons and the dismiss ✕ reach 44px; the home-currency picker
  stops clipping under its own chevron.

## [1.49.0] - 2026-08-09

**Data loss and amount parsing.** First batch from the second audit.

### Fixed
- **An expense saved while a sync was in flight was destroyed — and
  deleted on every other device.** The push loop applied the payload it
  had sent minutes earlier, wholesale, over whatever the user had done
  since; the next write then tombstoned the missing record as a
  deletion. Absorbing now re-merges against state as it is when the
  transaction returns.
- **The tombstone map was written from a read taken before the saves**,
  erasing any deletion those saves had just recorded.
- **One malformed trip document silently killed outbound sync for the
  session.** `suppressPush` was set without `try/finally`, so a throw
  latched it on and this device never pushed again until reload.
- **Amount separators follow the locale instead of being guessed.**
  v1.45 read a lone comma with 1–2 trailing digits as a decimal point,
  which misread the app's *own* output: backspacing "1,234" to "1,23"
  gave 1.23 for an amount meant as 1234, and on dot-grouping locales
  (de, es, it, nl, pt-BR, id, vi, tr) our own "1.000.000" re-parsed as
  null. The project's internal notes had recorded this exact conflict as the reason
  not to do it, and was right.
- A European price typed on an Indian keypad ("2,50") is now *offered*
  the other reading rather than silently assumed either way.
- **Split rows summed to less than the total** when a split named a
  member removed on another device, while still reporting "Adds up to
  100% ✓".
- **Settle-up no longer hides real money.** The flat "ignore under 1"
  swallowed up to a whole Kuwaiti dinar (~₹270) and called the trip
  settled. Only amounts below one minor unit — which cannot be paid at
  all — are dropped, and transfers are rounded to payable figures.
- A push scheduled during an in-flight sync is retried instead of
  dropped.
- The decimal-slip guard now learns from the expense field, not only the
  converter, and its calibration survives a sync.
- The trip editor's member-removal check now considers settlements, as
  the member editor's already did.

## [1.48.2] - 2026-08-09

### Fixed
- **`messagingSenderId` had a transposed digit** (3144… for 3143…). It
  is the GCP project number, and FCM refuses a token request that
  doesn't match — so push could never have worked. Caught because the
  Cloud Functions deploy printed the real project number and it
  disagreed with the config. Nothing else was affected: Firestore and
  Auth key off `projectId` and `apiKey`, which is why sync, sharing and
  receipts have worked throughout.

## [1.48.1] - 2026-08-09

### Added
- The Web Push key is configured, so the notifications switch now
  appears (Settings → Synced). Still needs the Cloud Function deployed
  before anything is actually sent — see `docs/PUSH.md` step 2.

## [1.48.0] - 2026-08-09

### Added
- **Push notifications (phase D4).** Live updates only run while the app
  is open, so the case the feature exists for — someone adding an expense
  while you weren't looking — was the one it couldn't cover. A Cloud
  Function watches each trip and tells every member except the author.
  Opt-in per device, off by default (ADR-0018).
- Tapping a notification opens that trip, pulling it first if this device
  hasn't synced it yet.

### Notes
- **Needs three setup steps only the project owner can do** — generate the Web
  Push key, deploy the function, grant permission per device. See
  `docs/PUSH.md`. Until the key exists the switch stays hidden rather
  than offering a toggle that can only fail.
- **On iPhone this requires the app on the Home Screen** (iOS 16.4+). In
  a Safari tab the API exists and permission can even be granted, but
  nothing is ever delivered — the app detects that and says so.
- Only new expenses, payments and members notify. Edits, renames and your
  own changes stay silent.

## [1.47.0] - 2026-08-09

### Added
- **Reassign and remove a member.** A member in any expense used to be
  locked into the trip permanently — one default split was enough, and
  the only way out was to delete or re-split every expense they touched,
  one at a time. Open them from Members, choose who takes over, and
  their expenses and payments move across. Totals don't change, and the
  balances still sum to zero. A repayment between the two cancels out.

### Removed
- **Copy sync diagnostics.** It existed to catch one specific class of
  sync bug; those are fixed and covered by tests now.

## [1.46.1] - 2026-08-09

### Fixed
- The expense sheet previewed today's rate while saving (correctly) kept
  the value locked in when the expense was first saved. One definition
  now feeds the preview, the split rows and the save.

## [1.46.0] - 2026-08-09

**UI/UX and safety.** Batch 3 of the audit findings.

### Fixed
- **Undo was unreachable.** Toasts were parented to `<body>`, and
  `showModal()` puts sheets in the top layer above every z-index — so
  every toast fired from a sheet, including Undo and the receipt-upload
  failures, was drawn underneath it.
- **Deleting a trip needed one tap too few.** Both taps landed on the
  same button, so an ordinary double-tap destroyed the trip, its
  expenses, its settlements and its receipts, for everyone, with no
  undo. It now has its own confirm naming the trip and the count.
- **Deleting an expense has an Undo** — deleting a *payment* had one; the
  record carrying the amount, payer, split and receipt did not.
- **Long expense names drew straight through their own amounts.** The
  name was an inline box, so `nowrap`/`overflow`/`ellipsis` were inert.
  193px of overlap at 375px, on the ledger's main screen.
- **Storage failures are surfaced.** Safari Private Browsing throws on
  every write; the app rendered normally and lost the lot on close.
- Duplicate member names are refused — settle-up printed "Bo → Bo".
- Dates show the year when it isn't this year; future dates are capped.
- Locked member chips explain themselves instead of doing nothing.

### Changed
- **Every sheet has a close button.** There were none — exits were a
  backdrop tap, a 26px handle, or Esc, which phones don't have. The
  camera-denied scanner had no controls at all, and now says where the
  permission actually lives.
- **Disabled Save buttons say what they're waiting for.** A disabled
  button swallows taps, so the button is the only place to answer it.
- **Contrast**: "gets ₹816" was 3.30:1, "Mark paid" 3.57:1, and transfer
  cards 1.05:1 against the sheet. Now 4.78, 6.07 and 3.25.
- **Focus rings restored** for keyboard users — the old ring composited
  to about 1.17:1.
- **Touch targets** raised toward 44px across chips, toggles, tabs, the
  search clear and the split row; the converter's amount input no longer
  collapses to a 21px sliver between two controls that navigate away.
- `interactive-widget=resizes-content`, so the keyboard stops covering
  the Save button at the bottom of every tall sheet.
- Selector groups expose real `radio`/`tab` roles and checked state;
  the toast is a live region. Nothing in the app was announced before.
- Chart range buttons hide on a panel that can never show anything.

## [1.45.0] - 2026-08-09

**Money correctness.** Batch 2 of the audit findings.

### Fixed
- **A decimal comma no longer multiplies an expense by 100.** "12,50"
  was read as 1250 — and in an expense that number is snapshotted into
  everyone's debt permanently. Commas are now resolved the unambiguous
  way ("1.234,56" and "1,234.56" both mean 1234.56); grouping still
  parses as grouping.
- **The expense amount field gets the converter's protections** it never
  had: live thousands grouping, and the decimal-slip warning.
- **"All settled 🎉" can no longer hide outstanding money.** If an
  expense or payment named someone the trip no longer lists, their money
  passed through no balance row, the nets stopped summing to zero, and
  settle-up under-reported. Everyone the books reference is now on them.
- **Editing an expense no longer re-prices it at today's rate.** Fixing
  a typo in the name three weeks later silently moved everyone's
  balance. Only a change to the amount, currency or home currency
  triggers a fresh conversion.
- **Split amounts add up.** Largest-remainder allocation, so three equal
  ways on ₹100 shows ₹100, not ₹99.99 — and a ¥100,000 three-way split
  stops losing a yen.
- A member named only by a recorded payment can't be removed any more;
  the summary used to contradict itself on one screen.
- "By day" files expenses under the local date. Anything before 05:30
  IST was filed under the previous day while its own row disagreed.
- Member names are escaped in split rows — an apostrophe corrupted the
  row, and names arrive from other people's phones.

### Changed
- Split rows show the amount **in the currency you're paying in**, with
  the home value underneath. "₹606.81" is no use when you're counting
  dong at the table.
- The whole split row toggles inclusion, not just a 19px checkbox.
- Settle-up no longer emits trivial transfers (₹1.49 and the like).
- Percent/shares amounts stay visible while the split is invalid, so you
  can see how far off you are.

## [1.44.0] - 2026-08-09

**Sync and data-integrity fixes from an independent audit.** Batch 1 of
several; these are the ones that could lose or corrupt data.

### Fixed
- **Opening the app no longer out-ranks an edit made elsewhere.** A
  derived field written back onto every trip made a "one-time" migration
  fire on every launch, restamping everything (ADR-0017).
- **Undo of a deleted payment sticks.** The tombstone survived the undo,
  so the payment reappeared and was deleted again at the next sync. A
  record present in a write is now alive by definition.
- **A record stamped ahead of this device can be deleted.** Tombstones
  used raw wall time while records use the Lamport clock, so a fast
  phone's expense was undeletable and came straight back.
- **A malformed record no longer deletes itself for everyone.** Records
  the read-time validator rejects were invisible to the save, which read
  them as deletions and tombstoned them.
- **Preferences merge like everything else** — the same tie rule as
  records (ADR-0015), on the same server clock (ADR-0014). A slow clock
  could not change the home currency; a tie diverged permanently.
- **A cancelled or mistyped invite is actually cancelled.** The invite
  list was a union that only grew, so a corrected address kept the old
  one — and stale addresses came back as members who took a share of
  every new split.
- Absorbing the other device's preferences no longer makes this device
  the newest writer and pushes them straight back.
- Pinning is no longer wiped by a prefs snapshot that arrives before the
  trip it points at.
- Saving the trip editor no longer throws if the trip was deleted on
  another device while the sheet was open.
- Undo closures look their record up again instead of writing to an
  object a sync has already replaced.
- The converter's decimal-slip samples are device-local, so typing an
  amount no longer restamps and re-uploads the shared trip.
- Concurrent preference writes no longer drop the other device's clock
  probe (`setDoc` now merges).

## [1.43.2] - 2026-08-09

### Added
- **The version is on the home screen**, next to the wordmark — no need
  to open Settings to see which build you're running. After five
  releases chasing one bug, "am I actually testing the new code?" has to
  be answerable at a glance.

### Changed
- One canonical version string (`APP_VERSION` in `js/app.js`), rendered
  into the header, the About card and the diagnostics dump. It was typed
  into `index.html` by hand, twice.

## [1.43.1] - 2026-08-09

**The other half of the archive bug** — the reason it came back on the
same device, seconds later, with no refresh.

### Fixed
- **The stamp written to storage now reaches memory.** Saving stamped a
  copy; the upload was built from the original, so every edit to an
  existing record was pushed carrying its *pre-edit* stamp. It tied with
  the copy already in the cloud and lost. Archiving undid itself
  (ADR-0016).

### Changed
- Sync diagnostics list trips by **id**, not name. Two trips may
  legitimately share a name, and printing names alone made that look
  like one trip contradicting itself.

## [1.43.0] - 2026-08-09

**The archive bug, fixed at the root.** Diagnostics from both devices
showed every trip carrying the *identical* `updatedAt`. Under
"newest wins", identical is not newest — so each device kept its own
copy, pushed it, and the two never agreed. Archived on the Mac,
unarchived on Android, forever.

### Fixed
- **Ties now resolve the same way on every device.** When two copies of
  a record share a timestamp, both devices pick the same winner (a
  stable comparison of the record itself) instead of each keeping its
  own. Applies to trips, expenses and settlements alike.
- A record that comes back from the cloud with a higher timestamp but
  identical content keeps the higher one, instead of being knocked back
  down locally and re-fetched on every sync.

### Notes
- Ties are common, not exotic: every record written in one go shares a
  stamp, and the Lamport anchor makes two devices land on the same
  number. See ADR-0015.

## [1.42.1] - 2026-08-09

**The archive problem is NOT fixed yet.** This release fixes a broken
part of the previous attempt and adds a way to see what's actually
happening, because three fixes based on reasoning have now missed.

### Fixed
- The clock correction added in 1.42.0 barely worked. It only recorded a
  reading when your preferences happened to change — so usually never —
  and it compared against a timestamp written by *whichever* device
  touched preferences last, meaning one device could apply the other's
  correction to itself and make the mismatch worse. Each device now keeps
  its own reading and takes one immediately.

### Added
- **Copy sync diagnostics** in the profile section: device, sign-in
  state, clock correction, and every trip's archived state and edit time
  — both as this device sees them and as they exist in your account.
  Run it on both devices when something disagrees and the difference is
  visible instead of guessed at.

## [1.42.0] - 2026-08-09

### Fixed
- **Archiving a trip didn't reach the other device, and undid itself on
  a refresh.** Two separate causes, both letting an out-of-date copy
  overwrite a real change:

  1. Your two devices disagree about the time. v1.41 improved this but
     only once a device had already seen the other's change; a device
     running ahead could still overwrite something it had never seen.
     Both devices now stamp their changes using **the server's clock**,
     so whoever edited last genuinely wins.

  2. When syncing, the app quietly tags each trip with who you are — and
     it did that *before* fetching the latest version. That made an
     out-of-date copy look freshly edited, so it won and wiped out the
     archive. That tagging now happens after fetching, so it can never
     overwrite anyone's work.

  The same flaw could have discarded any edit from the slower device —
  renaming a trip, editing an expense, changing a split. Archiving is
  simply where it showed up.

## [1.41.0] - 2026-08-09

### Fixed
- **Changes made on one device could be silently discarded by the
  other** — most visibly, archiving a trip on the Mac never reached the
  phone while the reverse worked fine.

  When two devices disagree about which change is newer, TripCash kept
  the newer one — judged by each device's own clock. But two devices
  never agree on the time to the second, and the one running slightly
  behind could **never win**: its edits were marked as older than the
  data they were replacing, so the other device threw them away. That's
  why syncing appeared to work in one direction only.

  Edits are now marked as newer than everything that device has already
  seen, rather than trusting its clock alone. Whichever device you use,
  and whatever its clock says, your latest change wins.

## [1.40.1] - 2026-08-09

### Fixed
- **Changes could sit unsent when you switched away from the app.** Your
  edits waited a few seconds before being sent, so they'd batch up nicely
  — but if you made a change and immediately switched to your other
  device, a backgrounded phone can freeze that timer indefinitely, and
  the change never left. Archiving a trip and going straight to the other
  device to check is exactly that pattern.

  The app now sends anything pending the moment you leave it, and the
  wait before sending is much shorter.

## [1.40.0] - 2026-08-09

### Added
- **Every signed-out device now says so**, not just one whose session
  dropped. The prompt is dismissable, so it can tell you once without
  becoming a nag — and the wording matches your situation: "changes on
  this device aren't syncing" if you were signed in and got signed out,
  "your trips stay on this device only" if you simply never signed in.
- **The profile icon carries a badge whenever you're signed out**, and it
  stays even after dismissing the prompt — a quiet, permanent reminder
  that there's something to act on. Amber when something went wrong,
  accent-coloured when you've just never signed in.
- Signing in clears the dismissal, so if a session drops later you're
  told again rather than silently.

## [1.39.1] - 2026-08-09

### Fixed
- The profile picture rendered enormously, spilling out of the top bar,
  and the plain person outline stayed visible on top of it. Two causes:
  the button had been getting its size from the gear icon it replaced, so
  once that became a picture nothing constrained it; and hiding the
  outline silently did nothing because it's an SVG, which ignores the
  property the rest of the app uses. Both fixed — the avatar now matches
  the scan button beside it.

## [1.39.0] - 2026-08-09

The reason trips "wouldn't sync" turned out to be a signed-out device
that gave no sign of it. That's now impossible to miss.

### Added
- **The settings gear is now your profile picture** — your Google photo,
  or your initials, or a plain person outline when you're not signed in.
  You can tell at a glance, every time you open the app.
- **A device that has signed out says so, loudly.** If TripCash was
  signed in on this device and the session has since dropped, a strip
  across the top reads "Signed out — changes on this device aren't
  syncing", with a Sign in button. No more adding trips for days
  believing they're being saved to your account.
- Settings now opens on a **Profile** section: your picture, your name
  and the account you're signed in as, before any settings.
- You can set **your own picture** instead of the Google one. It follows
  you to your other devices like the rest of your details.

### Notes
- Someone who has never signed in gets no warning and no badge — the
  app is offline-first by design and nagging would be wrong. The plain
  person outline already says where they stand.
- Signing out deliberately is silent too. The warning is only for a
  session that ended without you asking.

## [1.38.1] - 2026-08-08

### Fixed
- **One trip that couldn't sync stopped every other trip from syncing**,
  including new ones made on another device. Each trip is now handled
  independently, so a single problem can't strand the rest.
- Trips deleted long ago were being re-written to the cloud on every
  single sync, forever. Once a deletion has settled it's left alone.

### Changed
- A sync that partly fails now says so instead of quietly reporting
  success. Silence is how the last few problems stayed hidden.

## [1.38.0] - 2026-08-08

### Fixed
- **A deleted trip could still come back when the other device was
  open.** Deleting used to lose to any later change to the trip — the
  idea being that if someone edited a trip after you deleted it, their
  work shouldn't vanish. But the other device performs routine
  housekeeping on every sync (attaching your account to your member row,
  writing your name and number into it), and that legitimately counts as
  changing the trip. It was stamped as happening *after* your delete, so
  the trip was restored — although nobody had edited anything.

  **Deleting a trip is now final.** It stays deleted on every device, no
  matter what else is happening. A delete you can't rely on is worse
  than having no undo.

- Deleting an *expense* still behaves as before: if someone genuinely
  edits one after you delete it, their edit wins. Expenses are only ever
  restamped by a person actually editing them, so the problem above
  doesn't apply to them.

## [1.37.2] - 2026-08-08

### Fixed
- **A receipt uploaded on one device wouldn't open on another** — the
  paperclip showed, but tapping it did nothing useful. The app fetched
  receipts by a method that requires the storage bucket to be configured
  for cross-origin access with a command-line tool. The device that took
  the photo reads its own copy and never noticed; any *other* device
  couldn't fetch at all. Receipts are now loaded by download URL, which
  needs no such setup, and are still cached locally afterwards so they
  work offline.
- PDFs added on another device now open in a new tab instead of failing
  to download.

### Changed
- **Receipt problems now say what's wrong.** Every failure used to be
  silent, which is exactly why this took a round trip to diagnose. You'll
  now see the actual reason — "this receipt hasn't reached the cloud yet,
  open TripCash on the device that added it", "sign in to see receipts
  added on another device", or a rules/connection problem — and an upload
  that fails right after saving says so instead of pretending it worked.

## [1.37.1] - 2026-08-08

### Fixed
- **Deleting a trip still brought it back after a few refreshes.** The
  v1.37.0 fix marked the trip as deleted, but the mark was destroyed on
  its way to the cloud: sending it meant reconciling it against the live
  copy still stored there, and only the incoming side was checked for a
  deletion — so the live copy won and the deletion was erased before it
  ever landed. Locally the trip stayed gone until the other device
  touched the trip, at which point it reappeared. That's the "delete it,
  refresh two or three times, it's back" you'd see.

  A deletion is now recognised from either side, so it survives being
  sent and the trip goes for good on both devices. A trip genuinely
  edited *after* a deletion still comes back, with its expenses intact.

## [1.37.0] - 2026-08-07

### Fixed
- **Deleting a trip didn't stick — it came back on both devices.**
  Deleting only removed the trip from the phone you did it on; the cloud
  copy was never touched, so the very next sync found it still there,
  decided this device was missing it, and restored it. Your other device
  never heard about the deletion at all.

  A deleted trip is now marked as deleted in the cloud rather than simply
  removed, because a missing document is indistinguishable from one a
  device hasn't seen yet — the other phone would have recreated it. The
  mark travels, so the trip disappears everywhere and stays gone.

  If the deletion can't reach the cloud (offline, or you close the app
  too quickly), this device remembers and re-asserts it on every later
  sync rather than quietly restoring the trip.

- As before, an edit made *after* a delete brings the trip back — the
  same rule expenses already followed — so a genuine "I deleted this by
  mistake, then someone renamed it" resolves the way you'd expect.

## [1.36.0] - 2026-08-06

Phase D3.5 — receipts reach the cloud. **Needs `storage.rules` published
in the console (Storage → Rules — a separate editor from Firestore's).**

### Added
- Signed in, receipts now upload to your account: right after you save
  an expense, with a catch-up on every sync for anything saved offline.
  Lose the phone and the receipts survive with the trip.
- On your other devices (and trip members' phones), the 📎 marker shows
  immediately; the photo itself downloads the first time it's opened and
  is kept locally after that.
- Re-attach a clearer photo and other devices notice theirs is stale and
  fetch the new one.
- Access control reuses the trip's member list — the storage rules read
  the same membership the database rules enforce.

### Fixed
- Tapping Save while a just-picked photo was still being processed
  silently saved the expense **without** the receipt. Save now waits for
  the photo to finish preparing.

### Notes
- Signed out, nothing changes: receipts stay purely local and the app
  makes no network requests — verified.
- Verified against the live bucket that anonymous access is refused;
  the signed-in upload/download path needs a real session to confirm.

## [1.35.1] - 2026-08-06

### Fixed
- Placeholder text in form fields rendered almost as bright as real
  text, so empty fields looked full of grey junk — most visible on the
  new "Your name" / "Your phone" fields in Settings. Placeholders are
  now clearly dim hints, consistently across every sheet, and example
  values follow the app's "e.g." convention.

## [1.35.0] - 2026-08-06

No rules change needed.

### Changed
- **Your name and phone number are now yours.** Settings has a "Your
  name" and "Your phone" — set them once and they appear on every trip
  you're part of, on everyone's phone. Change your number and it updates
  everywhere instead of going stale in each trip separately.
- Whoever adds you can still type a name and number, because that's how
  they send you the invite in the first place. The moment you sign in,
  your own details replace their placeholder.
- You can rename and set a number for someone **who has no account** —
  that's the only way they get a name at all. You can't rewrite the
  details of someone who does; the editor says so and shows them
  read-only.

## [1.34.0] - 2026-08-06

No rules change needed.

### Added
- **Phone numbers on members.** Add one and "Send on WhatsApp" opens
  their chat directly — no contact picker, no picking the wrong Rahul.
  Indian numbers can be typed however you normally write them
  ("098765 43210", "98765 43210"); add a country code for anywhere else.
- **Real names from accounts.** Someone signing in with Google now
  appears under the name on their account rather than a guess made from
  their email address. A name you typed yourself is never overwritten.

### Notes
- A phone number is only ever used to message someone. Identity stays on
  email — signing in by phone would mean paid SMS verification for every
  new person, which isn't worth it (ADR-0010).
- Phone numbers are part of the trip, so everyone on that trip can see
  them. That's the same visibility as their name.

## [1.33.0] - 2026-08-06

**Needs `firestore.rules` re-published** — one new block for your own
preferences.

### Fixed
- **Pinning a trip on one device did nothing on another.** Settings were
  entirely device-local, so pinning never left the machine you did it on.
  Home currency, the street-rate markup and the chart range had exactly
  the same problem and would have surfaced next.

### Added
- Your preferences now follow you: pinned trip, home currency,
  street-rate switch and percentage, chart range. Change any of them on
  one device and the other updates live.
- They live in a document only you can read — not on the trip, because a
  trip is shared and pinning it would otherwise pin it for everyone.
- A pin pointing at a trip deleted elsewhere is cleared rather than
  leaving the home screen pinned to nothing.

### Notes
- What stays device-local, deliberately: which trip card is open, the
  light/dark theme (a phone and a laptop can reasonably differ), and
  internal bookkeeping. Opening a trip card is not a preference and
  won't overwrite your other device.

## [1.32.0] - 2026-08-06

Live updates (ADR-0012). No rules change needed.

### Added
- **Changes now appear as they happen.** When you're signed in and the
  app is open, an expense someone else adds shows up on your screen on
  its own — no tapping Sync.
- **Your own changes leave on their own too**, a few seconds after you
  make them. A listener alone would mean edits arrive but never depart,
  so the other person would still see nothing.
- Settings shows **"Live — changes appear as they happen"** while the
  connection is up, instead of when you last synced.
- Returning to the app after a while catches up immediately rather than
  waiting for your next edit.

### Notes
- An update that lands while you're mid-way through typing an expense is
  held back until you close the sheet, so nothing moves under your
  finger.
- Signed out, none of this runs and the app makes no network calls at
  all — verified.

## [1.31.0] - 2026-08-05

Members and accounts are now one thing (ADR-0011). No rules change needed.

### Fixed
- **Shared trips filed everyone's spending under the trip's creator.**
  The current user was a fixed id stored inside the trip, so once shared,
  every phone thought the creator was them: a person who joined saw
  themselves labelled as him, and each expense they added was recorded as
  paid by him. Who "you" are is now worked out per device.

### Added
- A member can carry an email. Add one and the trip reaches their phone;
  leave it blank and they stay a name in the split exactly as before —
  perfect for someone who'll never install the app.
- The Members screen is now the one place people live: tap anyone to
  rename them, add or change their email, send them their invite, or
  remove them. Each row says plainly whether they'll see the trip.
- Anyone on a trip can add and manage members, not just whoever made it.

### Changed
- The separate "Share trip" invite list is gone — sharing is a property
  of a person now, so inviting Rahul and adding Rahul are one action.
  Existing invites become members automatically on first launch.
- Removing someone takes them out of the splits but doesn't cut off a
  trip they already have. Members named in an expense still can't be
  removed until those expenses are reassigned.

## [1.30.0] - 2026-08-05

### Changed
- Each invited person now gets their own **Send** button, and the message
  names *their* address. Previously one shared message went to everyone
  quoting whichever address was invited first — so the second person was
  told to sign in as the first.
- Rewrote the invite message: shorter, explains what TripCash actually
  does, and simply states which address to sign in with instead of
  insisting on "Continue with Google". How they sign in is their choice.

## [1.29.0] - 2026-08-05

All three from a real invitee's first run. **Needs `firestore.rules`
re-published.**

### Fixed
- **The password box looked like it wanted your Google password.** It now
  says "TripCash password", "Pick a password — 6+ characters", and spells
  out that this makes a separate TripCash account and cannot see your
  Google account. "Continue with Google" is clearly the recommended path.
- **An invited person signed in and still didn't see the trip.** Invites
  relied on their app *searching* for trips naming their address, which
  needed a verified email — and verification mail wasn't arriving. The
  invite link now carries the trip itself, so their app opens it directly:
  no search, and no dependency on email being delivered. Searching still
  exists as a convenience for verified accounts.
- **Verification emails: repeated taps got the sender blocked.** The
  resend button now waits a minute between sends, points at the spam
  folder, and explains that verification isn't needed at all to open a
  trip from an invite link.
- Someone arriving on an invite link now sees a banner in Settings that
  stays put until they sign in, instead of a toast that vanishes.

### Security
- Accepting an invite by link no longer requires a verified email —
  knowing the trip's link is itself the secret. Searching for invitations
  still does require verification, so nobody can register with someone
  else's address and go looking for their trips.

## [1.28.0] - 2026-08-05

### Fixed
- Sync reported "the database turned this down" even though it had
  worked. v1.27 added a search for trips you've been invited to, which
  needs the updated database rules; when that search was refused it
  aborted the whole sync, including the parts that had already
  succeeded. Looking for invitations is now a separate, optional step —
  your own trips sync regardless, and the message says plainly that only
  invitations are waiting on the rules.

## [1.27.0] - 2026-08-05

Phase D3.4 — share a trip with someone else. **Needs the updated
`firestore.rules` published before invites work.**

### Added
- **Share trip** in the trip editor: invite people by the email address
  they sign in with. They see the trip and its expenses as soon as they
  sign in, and changes flow both ways from then on.
- **Send the invite** hands the message to your phone's share sheet —
  WhatsApp, Messages, Gmail, whatever you use — plus a direct **Send on
  WhatsApp** button. The invite comes from you, not from a robot.
- Pending invites are listed and removable, so a typo is visible rather
  than silently doing nothing.
- Invites are only honoured for verified email addresses, so nobody can
  sign up using someone else's address to reach their trip. Accounts made
  with email and password get a verification mail automatically, with a
  resend button in Settings.

## [1.26.0] - 2026-08-05

Phase D3.3 — trips actually sync. **Requires the Firestore rules from
`firestore.rules` to be published in the Firebase console first.**

### Added
- Signed in, your trips, expenses and settle-up payments sync to your
  account: automatically when you sign in, and on demand via **Sync now**
  in Settings, which shows when it last ran.
- Edits made on two phones both survive. For the same record edited in
  two places, the most recent edit wins; a deletion sticks instead of the
  record reappearing from the other device.
- A trip that exists in your account but not on this phone is pulled
  down — the groundwork for sharing a trip with someone (D3.4).
- Each trip is stored as one document and written inside a transaction,
  so two phones syncing at once can't overwrite each other (ADR-0009).
- Sync failures are explained in plain language and never lose local
  data — offline, out of quota, or rules not published all say so.

### Fixed
- Records arriving from another device kept their own edit time instead
  of being restamped on arrival. Without this, a stale edit pulled from
  the server would have looked like the newest one and could overwrite a
  genuinely newer local change.

## [1.25.0] - 2026-08-05

### Fixed
- **Signing in appeared to do nothing.** The listener that updates the
  screen after a successful sign-in was only attached at launch *if you
  were already signed in* — so on a first-ever sign-in nothing was
  listening. Google actually signed you in and the app was never told.
  Now: the listener is attached before any sign-in attempt, and the
  session is read straight back afterwards rather than waiting to be
  told, so the screen can't disagree with reality.
- A sign-in that leaves no session now says so instead of failing
  silently — the worst version of this bug was that it said nothing.
- Google sign-ins that fall back to a full-page redirect (the normal path
  in an installed iPhone app) now mark the sign-in as in-flight first, so
  the session is picked up when the page comes back instead of being
  dropped.

## [1.24.0] - 2026-08-05

Phase D3.2 — you can now sign in. Nothing syncs yet (that's D3.3); this
is the account layer underneath it.

### Added
- A **Sync across devices** card in Settings: continue with Google, or
  sign in / create an account with an email and password. Signing out
  never touches your trips — they stay on the device either way.
- The Firebase code is fetched from Google's CDN only when you actually
  sign in (~260 KB). Signed out, the app makes no Firebase requests at
  all and stays exactly as offline-capable as before — verified.
- Google sign-in falls back from a popup to a full-page redirect where
  popups don't work, which is the normal case in an installed PWA on
  iPhone.
- Sign-in failures are explained in plain language ("That email and
  password don't match") instead of Firebase's error codes.

## [1.23.0] - 2026-08-05

### Fixed
- Trip editor: the member chips ("You", names you add) sat flush against
  the bottom of the "Add a member" box and read as overlapping it.
- Currency detail sheet: "Copy this amount" was greyed out whenever the
  converter was empty — which, since v1.21 clears it on every launch, was
  most of the time. The button now copies the rate itself ("1 USD =
  95.351 INR") when there's no amount to copy, so it's never a dead CTA.

### Added
- Firebase project connection details committed (`js/firebase-config.js`)
  for phase D3.2. Public by design — see the note in that file.

## [1.22.0] - 2026-08-05

Phase D3.1 — groundwork for syncing trips across devices. No visible
change; this is the data plumbing that has to exist before any cloud
code, because timestamps can't be invented after the fact.

### Added
- Every trip, expense and settlement now records when it last really
  changed (`updatedAt`), and deletions leave a tombstone — without one, a
  deleted expense would come back from the dead on the next sync.
- `js/merge.js`: pure last-write-wins merge rules with tombstone handling
  (ADR-0008), unit-tested independently of any backend — including that
  two phones merging in either order reach the same answer.
- Stamping happens inside store.js by diffing against what's stored, so
  no current or future mutation site can forget to do it. Typing in the
  converter deliberately doesn't count as a change.

## [1.21.0] - 2026-08-05

Mobile UI/UX overhaul driven by an independent audit (21 findings) plus
owner-reported iPhone issues.

### Fixed
- **Trip editor**: the currency results list was squeezed to ~one visible
  row (worse under the iOS keyboard). The editor body is now one scroll
  area with a sticky currency search — results get the whole sheet.
- **QR scanner now works on iPhones**: iOS has no BarcodeDetector, so the
  button never appeared there. A vendored jsQR decoder (ADR-0007) now
  kicks in wherever the native API is missing; Android keeps the native
  path and never loads the fallback.
- **Home-currency switch no longer mislabels money**: stored snapshots
  (expenses AND recorded payments) are re-expressed in the new home
  currency at current rates instead of showing INR magnitudes behind a
  $ sign.
- Archiving your only trip no longer strands it: the Archived chip stays
  visible whenever anything is archived, with a pointer message.
- Converter's Expense/Clear buttons were clipped off-card below ~430px
  (unusable at 320-360px); the row now wraps.
- Converter rows no longer overflow on narrow phones (320-374px): the
  currency long-name and chart glyph are shed before digits shrink.
- iOS auto-zoom on focus eliminated: all inputs/selects are ≥16px.
- Long toasts wrap instead of clipping off both screen edges.
- Chart failure state now has a Retry button (the old copy suggested a
  pull-down — which closes the sheet).
- Chrome's default focus ring no longer flashes around sheet bodies.

### Changed
- **Summary decluttered**: Payments recorded and the By category/person/
  day breakdowns are collapsible sections (category open by default);
  open state survives re-renders. Settle up, balances, and total stay
  up front.
- Payments can be recorded in any trip currency; converted to home at
  today's rate on save (with a live ≈ preview).
- "Archive trip" button added to the trip editor — the swipe gesture is
  no longer the only way in.
- Enter/Done in a member-name field adds the member instead of just
  closing the keyboard.
- Ledger member chips are plain labels now (they looked tappable but did
  nothing).
- The logo no longer reloads the app (an accidental tap dumped converter
  state); it scrolls to top.
- Touch targets widened toward 44pt (clear buttons, grips, trash icons,
  rates chip); smallest text tier bumped; "Tap to copy" tooltip corrected;
  Copy disabled when the field is empty.

## [1.20.0] - 2026-08-05

### Changed
- The converter starts empty on every launch/refresh: a trip's last-entered
  amount no longer survives a reload. Amounts still carry across trip
  switches within a session.

## [1.19.0] - 2026-08-05

### Added
- Expense timestamps: rows show date **and time** ("Aug 5, 4:40 PM"), and
  the expense editor has an editable "When" field (defaults to now) so
  expenses can be backdated to when they actually happened.
- Receipts: every expense can carry one photo or PDF. Photos are
  downscaled (≤1600 px JPEG) and stored in IndexedDB — localStorage can't
  hold images — so receipts work fully offline; the expense list marks
  rows with a paperclip; thumbnails in the editor open a full-size viewer
  (PDFs download). Receipts are deleted with their expense or trip.
- Settle-up payments: "Mark paid" on each suggested transfer and a
  "+ Record a payment" button log real-world repayments (any amount —
  partial payments shrink the remaining transfer, overpayments flip the
  direction). Balances and the settle-up re-derive from expenses minus
  payments; a "Payments recorded" section lists them with delete + Undo.
  When everyone has paid everyone: "All settled 🎉". Stored in
  `tripcash:settlements`, swept on trip delete, math unit-tested.
- Balances are expandable: tap a person to see every expense they were
  part of (what they paid, their share) and the payments they made or
  received.

### Fixed
- The currency selector's focus highlight in the expense editor was
  clipped at the sheet's right edge (the scroll container cut it off);
  the selector also now uses the same accent ring as text fields.

### Changed
- Trip search placeholder now mentions members (member-name search has
  worked since 1.15.0 — it just never said so).

## [1.18.0] - 2026-08-05

### Added
- Members can now be added everywhere they're needed: a Members section in
  the trip editor (works while creating a brand-new trip too, with
  removable chips — "You" and members with expenses stay put), and a
  "+ Add" chip right inside the expense editor's Paid-by row (the new
  member immediately joins the payer options and the split).
- Duplicating a trip now copies its members.

### Changed
- The settle-up section is explicitly labelled with your home currency
  ("Settle up · in INR"). Settlements were always computed in the home
  currency from the locked-in snapshots — expenses in any mix of
  currencies settle as rupee transfers between members.

## [1.17.0] - 2026-08-05

### Added
- "+ Expense" button in the Convert tab: turns the conversion you're
  looking at into an expense — the editor opens prefilled with that amount
  and currency, you add name/type/description/split, and on save the app
  switches to the Expenses tab to show it. The converter keeps your typed
  amount.
- A chevron on each expense row hints that tapping opens it for editing
  (editing and two-tap deletion shipped in v1.16).

## [1.16.0] - 2026-08-05

### Added — Phase D2: the trip ledger
- Every open trip now has two tabs: **Convert** (unchanged) and **Expenses**.
- **Members**: add people to a trip ("You" is always there); members with
  recorded expenses can't be removed. Trip search finds members.
- **Expenses**: type (🍜🚕🏨🎟️🛍️✨), name, optional description, amount in
  any trip currency, and who paid. The INR value is locked in at save time
  so debts never drift with exchange rates; a live preview shows it before
  saving. Edit re-snapshots; delete is a two-tap confirm.
- **Splits**: equal (with include/exclude checkboxes), percentages
  (validated to 100%), or shares (ratios like 2:1:1) — with each person's
  owed amount shown live while you type.
- **Trip summary**: minimized settle-up transfers ("Rohan → You ₹272"),
  per-member balances (paid · share · net), and spending cuts by category,
  person, and day — all in INR, all fully offline.
- Deleting a trip sweeps its expenses.

### Fixed
- Activating a button inside any sheet via keyboard could close the sheet
  (synthetic clicks carry (0,0) coordinates, which read as a backdrop tap).

## [1.15.1] - 2026-08-05

### Fixed
- Swipe-to-archive did nothing on real phones: without `touch-action: pan-y`
  the browser claimed the horizontal touch gesture and cancelled our
  pointer events (mouse-based tests never go through that pipeline, which
  is why it passed verification). Also, a swipe can now start anywhere on
  the card head — including over the pin/edit buttons — not just the title.

## [1.15.0] - 2026-08-05

### Added
- Swipe a trip card left to archive it (Undo in the toast). Archived trips
  leave the main list; an "Archived · n" chip above the list switches to
  them, where a left swipe unarchives. Archiving unpins/collapses the trip.
- Trip search bar: matches trip names, currency codes and names, members
  (once trips have them), and the countries/cities of the trip's currencies
  — so "prague" finds your CZK trip.
- Currency filter chips above the list — tap one to see only trips
  containing that currency.

## [1.14.0] - 2026-08-05

### Added
- Trip cards can be dragged by their grip to reorder the list; the order
  is saved.

### Changed
- The app now always launches with every trip collapsed — except a pinned
  trip, which opens expanded. (Previously the last-open trip reopened.)
- In the trip editor, Save is disabled until at least one currency is
  picked, and the label now says a currency is required.

## [1.13.0] - 2026-08-05

### Added
- Pin a trip: a pin button on each trip card. The pinned trip always opens
  expanded when the app launches, whatever you had open last; you can still
  switch freely during a session. One pin at a time; deleting a pinned trip
  clears the pin.

## [1.12.0] - 2026-08-05

### Changed — home screen restructure (phase D1 of the shared-trips plan)
- All trips now live on the home screen as collapsible cards; tap a card to
  expand it and its converter opens in place. One card open at a time, and
  the open card is remembered across restarts.
- The trip-switcher pill and trip-list sheet are gone; Duplicate and Delete
  (two-tap confirm) moved into the trip editor, and New trip sits under the
  cards.
- Sharing text into the app now auto-opens the trip that contains the
  shared currency.

### Fixed
- Tapping rounded buttons no longer flashes a square highlight extending
  past the control (native tap-highlight disabled; every control has its
  own pressed state).

## [1.11.0] - 2026-08-05

### Fixed
- Charts frequently showed "History service is busy". The service wasn't
  failing — it takes 4–16 s for a currency pair it hasn't served recently,
  and the client gave up at 10 s. Three changes:
  - the timeout is now 25 s, and a failed attempt is retried once (the
    upstream is fast on the second try once its cache is warm);
  - **one fetch per currency pair now covers every range** — a year is
    fetched once and 7d/30d/90d/1y are sliced from it, so switching ranges
    costs no network at all (was up to four separate slow requests);
  - when the service can't be reached, a previously loaded chart is shown
    from cache and labelled "(cached)" instead of an error.
- Slow first loads now say "Still loading — this rate service is slow on
  first use" rather than looking hung.

## [1.10.0] - 2026-08-05

### Added
- **Tap the rates chip to fetch live rates now** — bypasses the 6-hour
  freshness window, spins while fetching, and reports the outcome honestly
  ("Rates updated just now" / "Already up to date" / "Rate service
  unreachable — using cached" / "You're offline — using cached rates").
- **Exact fetch timestamp** under the chip, in your own timezone:
  "Fetched Aug 5, 2026, 2:17 PM · GMT+5:30 · Asia/Calcutta".
- **Install button in Settings.** Chrome only shows its own install banner
  after repeated visits, so the app now captures the install event and
  offers an explicit button, with a fallback hint (⋮ → Add to Home screen)
  when the browser doesn't support prompting.

## [1.9.0] - 2026-08-05

### Added
- **Share into TripCash**: the app registers as an Android share target, so
  selecting "4,500 CZK" in any app and hitting Share fills the CZK field.
  Understands ISO codes and symbols; a currency the trip doesn't cover says
  so instead of converting the wrong thing. Works offline.
- **Scan a payment QR**: camera button (shown only where the browser can
  decode barcodes) reads merchant codes — EMVCo (PromptPay, QRIS, PIX,
  PayNow) and UPI links — and fills in the amount and currency. Fully
  offline; the camera is released on every exit path, and a camera that
  won't start times out with a clear message rather than a black box.
- **Decimal-slip guard**: an amber strip warns on order-of-magnitude
  surprises ("That's ₹5.5 lakh — did you mean 500 EUR?"), calibrated to the
  amounts you actually enter on this trip. Never blocks input.
- **Indian number formatting**: INR groups the Indian way (1,20,000) and
  large amounts carry a "≈ ₹2.7 lakh" gloss.
- **Pocket rule**: each currency's detail sheet shows a memorable multiplier
  ("CZK → ₹ × 4.5"), round-number examples, and its error margin — made to
  be screenshotted so you don't need the app at all.
- **Where you are, with no permission prompt**: the device timezone marks
  the local currency HERE, or offers to add it to the trip. No GPS, no
  dialog, no network, and dismissable per currency.

## [1.8.2] - 2026-08-05

### Fixed
- The chart's scrub pointer (vertical line + dot) was invisible on devices:
  SVG elements don't support the `hidden` property, so the line was stuck
  display:none while the tooltip (a normal HTML element) worked — which is
  also why automated checks missed it. The pointer elements are now always
  rendered and simply repositioned.

## [1.8.1] - 2026-08-05

### Added
- A small trend-line icon next to every currency code hints that tapping
  the row opens its chart.

### Changed
- Chart scrubbing is now an obvious pointer: a solid accent-colored
  vertical line that starts on the latest data point, follows your finger
  (even if it drifts off the chart), and stays where you leave it on touch;
  mouse hover-out returns it to the latest point.

## [1.8.0] - 2026-08-05

### Added
- Chart ranges: 7d / 30d / 90d / 1y toggle on the currency detail sheet;
  the chosen range is remembered and each range caches separately.
- "X% above/below the period average" line under the rate — a quick signal
  for whether today is a good day to exchange.
- Android home-screen shortcuts: long-press the TripCash icon for
  "New trip" and "Switch trip".
- Duplicate-trip button in the trip list; subtle haptic ticks on copy and
  drag-reorder (where the device supports vibration).

### Fixed
- History and rate fetches now time out (10–12 s) instead of pinning
  "Loading…" when the rate service is struggling, with an honest
  "service is busy" message while online.

## [1.7.1] - 2026-08-05

### Added
- "Clear" button (appears next to Street rate whenever amounts are entered):
  one tap resets every field and dismisses the keyboard.

### Fixed
- Pressing the keyboard's Done/Enter key now closes the keyboard on Android
  Chrome (inputs blur on Enter; there is no form, so Chrome never did it
  by itself).

## [1.7.0] - 2026-08-05

### Added
- 30-day rate chart per currency: tap any currency row to open a detail
  sheet with the current rate, a ▲/▼ 30-day change badge, and a scrubbable
  line chart (drag to see any day's rate). Home row charts against USD.
- History from ECB reference rates via Frankfurter, cached 12 h per pair so
  previously viewed charts work offline. Currencies outside the ~30-major
  ECB set show a clear "no history" note. (ADR-0004)

### Changed
- Copy moved into the detail sheet ("Copy this amount"); the one-time tip
  now points at the chart.

## [1.6.0] - 2026-08-05

### Added
- Amounts now carry their currency symbol right next to the digits
  ("₹ 10,981.80") so they read as money, not bare numbers; the symbol dims
  when the field is empty. (On browsers without content-sized inputs the
  plain right-aligned number is kept.)
- Tapping the TripCash logo/name refreshes the app.

## [1.5.0] - 2026-08-05

### Added
- Theme toggle in Settings: Auto (follow system) / Light / Dark, persisted;
  the Android status bar color follows the chosen theme.
- Drag-and-drop reorder: grab the grip on any currency row and drag; rows
  animate out of the way. Replaces the ▲▼ buttons.
- Sheets now close by tapping outside or pulling down on the grab handle.
- Currency symbols shown everywhere: field rows ("₹ · Indian Rupee") and a
  symbol chip in the picker.
- Brand typography: self-hosted Manrope (matches the icon's rounded
  geometry, real tabular numerals), ~40 KB, precached for offline.
- Search box with leading icon and a clear button; labeled inputs in the
  trip editor; "No matches" message for empty search results.
- One-time hint that tapping a currency label copies the amount.

### Changed
- Settings redesigned: grouped cards, segmented theme control, about card.
- Trip deletion uses an in-sheet two-tap confirm instead of a browser popup.

### Fixed (from an independent UI audit)
- Search text no longer renders under the magnifier icon (CSS specificity).
- First-run empty state renders at the right size and centered (same bug).
- Long amounts can no longer clip digits: font size now steps down based on
  measured overflow, with a fourth smaller tier.
- All amounts share one right-align axis (home row matched the drag gutter).
- Street-rate % input is disabled and dimmed while the switch is off.
- AA contrast for filled buttons in light mode; larger tap targets for
  theme buttons and trip edit/delete; currency names no longer truncated;
  long trip names clamp to two lines.

## [1.4.0] - 2026-08-05

### Added
- Reorder currencies: ▲▼ buttons on each row move a currency up or down; the
  order is saved per trip. The home currency stays pinned on top.
- In-app branding: TripCash logo + wordmark header, trip switcher as its own
  pill control, and a brand footer in Settings.

## [1.3.0] - 2026-08-05

### Changed — UI/UX revamp
- Source-of-truth indicator: the field you last edited is highlighted with an
  accent edge and tint, so it's always clear which number drives the others.
- Number-first typography: larger tabular-numeral amounts that automatically
  shrink for very long values instead of clipping.
- Rates status is now a pill chip with a green (live) / amber (cached or
  offline) dot; HOME badge replaces the "Home ·" text label.
- Street rate uses a real switch control; bottom sheets gained a grab handle,
  slide-up animation, and blurred backdrop (disabled under reduced-motion).
- Refined light/dark palettes with layered surfaces and soft shadows;
  Android status bar now matches the app theme in both schemes.

## [1.2.0] - 2026-08-05

### Added
- Trip currency search now matches major travel cities ("Paris" → EUR,
  "Bangkok" → THB, ~250 cities), and the picker shows the matched place so
  it's clear why a currency appeared.

## [1.1.0] - 2026-08-05

### Added
- The field being typed in now live-formats with thousands separators
  ("1234567" → "1,234,567") while keeping the caret in place and leaving
  typed decimals untouched.

### Changed
- A typed comma is now always a thousands separator, never a decimal point
  ("3,5" no longer parses as 3.5) — required for live grouping.

### Fixed
- Service worker precache now bypasses the HTTP cache (`cache: "no-cache"`),
  so a new version can no longer pin stale files served from the browser's
  HTTP cache during an update.

## [1.0.0] - 2026-08-05

### Added
- Multi-field converter: one field per trip currency + pinned home currency;
  editing any field live-updates all others through a single USD base.
- Trips: create, edit, delete, switch; searchable currency picker matching
  country names and currency codes; automatic currency dedup (France +
  Netherlands → one EUR).
- Persistence: settings, trips, and each trip's last-entered amount survive
  restarts (namespaced localStorage with corruption-safe reads).
- Live rates from open.er-api.com, refreshed on open when older than 6 hours;
  "Rates as of X ago" status with explicit offline/cached indicator.
- Full offline support: service-worker app-shell cache + localStorage rate
  cache; app works with no network after first load.
- PWA install: manifest, standalone display, 192/512/maskable icons.
- Street-rate markup toggle (−N% on derived amounts) and tap-to-copy on
  currency labels.
- Per-currency formatting via Intl.NumberFormat (HUF/JPY whole numbers,
  dinars 3 decimals, others 2).
- Unit test suite (17 tests, Node built-in runner) + GitHub Actions CI.

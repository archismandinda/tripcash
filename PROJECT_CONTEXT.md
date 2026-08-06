# TripCash — Project Context

**Single source of truth for any session picking up this project. Read this
first; if it disagrees with the code, reconcile from the repo and update it.**

## 1. What we're building
A mobile-first PWA travel-money app for Archisman (Indian traveller, home
currency INR). Started as a multi-currency converter; now growing into a
Splitwise-style shared trip ledger (approved plan, phases D2/D3 pending).
Live at **https://archismandinda.github.io/tripcash/** · repo
`archismandinda/tripcash` · currently **v1.35.0** (SW cache v42).

**Goal:** shareable personal tool — personal-tool scope but with a real unit
suite + CI because it may be shared.

## 2. Feature inventory (all shipped and live-verified)
- **Converter**: per-trip currency fields + pinned INR home row; typing in
  any field live-converts the rest (single USD base, never pairwise);
  live comma grouping with caret preservation; en-IN grouping + lakh/crore
  gloss for INR; symbols beside amounts (field-sizing:content, graceful
  fallback); measured font step-down so digits never clip; street-rate −N%
  toggle; one-tap Clear; decimal-slip guard (order-of-magnitude warnings
  calibrated on the trip's own `samples`).
- **Trips (home screen)**: all trips as accordion cards, converter reparents
  into the open card (`#converter-panel` — must be parked back into `#main`
  before clearing `#trips`, or it gets destroyed); one open at a time;
  launch state = all collapsed except the pinned trip; pin button per card;
  drag-reorder cards by grip (midpoint-based, variable heights);
  **swipe-left to archive** (Undo toast), Archived filter chip, unarchive by
  swipe in archived view (auto-returns when it empties); search bar
  (matches name / currency code+name / members / countries+cities via
  currency data → `tripMatchesQuery` in currencies.js); currency filter
  chips; editor sheet gates Save until ≥1 currency, has Duplicate + two-tap
  Delete.
- **Expense ledger (D2)**: each open trip has Convert/Expenses tabs
  (`#panel-host` is what reparents into the open card). Members per trip
  ("You" fixed; addable in the trip editor — buffered for new trips —, in
  the ledger's "+ Members", and inline via "+ Add" in the expense sheet's
  payer row, which stacks the member sheet and folds the new member into
  the open split). Expenses: type/name/desc/amount/any trip currency/payer;
  **home-currency value snapshotted at save** (homeValue + homeCode) so
  debts never drift; edit re-snapshots; two-tap delete; "+ Expense" button
  in the Convert tab prefills the editor from the current conversion and
  lands on the Expenses tab after save. Splits: equal (include/exclude),
  percent (gated to 100), shares — live per-member amounts. Summary sheet:
  "Settle up · in <home>" minimized transfers (greedy, ≤N−1), balances,
  cuts by category/person/day. Pure math in `js/splits.js` (unit-tested);
  storage `tripcash:expenses`; deleting a trip sweeps its expenses.
- **Ledger v1.19 additions**: expense rows show date+time; editable "When"
  (datetime-local) field backdates expenses. One receipt (photo/PDF) per
  expense — blobs in IndexedDB (`tripcash-files`/`attachments`, key =
  expense id, photos downscaled ≤1600px JPEG via `js/attach.js`), record
  carries only `attachment:{name,type}`; 📎 in list, thumbnail + viewer
  sheet in editor, swept on expense/trip delete. **Settle-up payments**:
  `tripcash:settlements` records {from,to,amount(home),createdAt};
  `tripBalances(expenses, members, payments)` nets them out; summary has
  Mark-paid per transfer (opens prefilled payment sheet), "+ Record a
  payment" (custom/partial), "Payments recorded" list w/ delete+Undo,
  "All settled 🎉" when clear. Balances rows are `<details>` — expand to
  see the member's expenses + payments.
- **Rates**: open.er-api.com, 6h freshness, tap-the-chip force refresh with
  honest outcome toasts, exact fetch timestamp with GMT offset + IANA zone,
  offline indicator; 10–12s fetch timeouts.
- **Charts**: tap a currency row → detail sheet: rate, ▲/▼ change badge,
  % above/below period average, pocket rule (memorable multiplier +
  examples), scrubbable SVG chart with persistent crosshair; 7d/30d/90d/1y
  sliced locally from ONE year-long Frankfurter fetch per pair (upstream is
  4–16s cold, <1s warm — 25s timeout + one retry; cached 12h, max 8 pairs).
- **Platform**: installable PWA (+ explicit Install button in Settings —
  Chrome's own banner needs repeat visits); Web Share Target (GET) parses
  amounts/currencies out of shared text and auto-opens the owning
  non-archived trip; payment-QR scanner (BarcodeDetector on Android,
  vendored jsQR fallback on iOS/WebKit — ADR-0007, lazy `js/vendor/jsqr.js`;
  EMVCo TLV tags 53/54 + UPI links; camera timeout + guaranteed release);
  timezone-based
  "you're here" (no permission, `currencyForTimeZone`); manifest shortcut
  (New trip); haptics (guarded by userActivation); light/dark/auto theme;
  sheets close via backdrop tap or pull-down; native tap-highlight disabled.

## 3. Stack & conventions
- Vanilla HTML/CSS/JS ES modules, no build step, no package-managed runtime
  deps (ADR-0001; ADR-0007 allows vendored single files — currently only
  `js/vendor/jsqr.js`).
- **Files**: `js/app.js` (state+wiring, the big one) · `js/ui.js` (DOM
  builders, ICONS) · `js/attach.js` (IndexedDB receipt blobs — the ONE
  exception to "store.js owns storage", which is localStorage-only) ·
  `js/store.js` (ALL localStorage access + sync stamping) ·
  `js/merge.js` (pure LWW/tombstone merge rules, D3) ·
  `js/convert.js` (pure math) · `js/currencies.js` (static data + search) ·
  `js/rates.js` · `js/history.js` + `js/chart.js` (charts) · `js/parse.js`
  (share/QR parsing) · `js/insights.js` (gloss, slip guard, pocket rule,
  timezone) · `js/scan.js` (camera) · `sw.js` · `fonts/` (self-hosted
  Manrope; keep offline promise — never hotlink assets).
- **localStorage** (all `tripcash:`-prefixed, corruption-guarded in store.js):
  - `settings` → homeCurrency, activeTripId (= open card), pinnedTripId,
    markupOn/markupPct, theme, rangeDays, placeDismissed, detailTipShown
  - `trips` → [{ id, name, currencies[], createdAt, lastEdit, samples,
    archived, members? (D2) }] — `lastEdit` is session-only since v1.20:
    boot() nulls it on every launch, so the converter always opens empty
    (it still buffers amounts across trip switches within a session)
  - `rates` → { base:"USD", fetchedAt, rates }
  - `history` → chart cache, key `BASE->QUOTE`, {fetchedAt, series}
  - `settlements` → [{ id, tripId, from, to, amount (home ccy), createdAt }]
  - `tombstones` → { trips|expenses|settlements: { id: deletedAt } } (D3.1,
    pruned after 90d) — deletes must leave a trace or sync resurrects them
  - trips/expenses/settlements each carry `updatedAt`, stamped by store.js
    on real changes only (see ADR-0008); never stamp in app.js by hand
- **Tests**: `node --test tests/*.test.mjs` (160 tests; the `--test dir/`
  form breaks on Node 24 — keep the glob). CI runs on every push.
- **SW discipline**: bump `VERSION` in sw.js every release (currently v42);
  precache uses `cache:"no-cache"` requests; runtime is
  stale-while-revalidate so stale clients self-heal one visit later.
  Clients see a new release only on their SECOND open ("open the app twice").
- **SVG gotcha**: `.hidden` property doesn't exist on SVGElement — never
  toggle it there (bit us in v1.8.2).
- **Invite design (v1.29, after a real invitee got stuck)**: joining goes
  through the LINK (`?join=<tripId>` → `pendingJoin` in settings, survives
  the Google redirect → single-document `get`). Never make the primary
  path depend on a Firestore *query* (may not be provable to the rules
  engine) or on transactional email being delivered (it often isn't).
  Verification now gates only the convenience search, not joining.
- **Firestore query gotcha (hit 2026-08-05, v1.27)**: rules are not
  filters — a query is refused unless its constraints *prove* the rule is
  satisfied. Shipping a query on a new field (`invitedEmails`) before the
  matching rule was published failed the whole sync. Two lessons: (1) a
  client change that needs new rules must tolerate the old ones, and
  (2) optional/discovery steps get their own try/catch so they can never
  fail the operation a user actually cares about.
- **Firestore rules gotcha (hit 2026-08-05)**: `resource` is null for a
  document that doesn't exist, so `allow read: ... resource.data.x` denies
  the transaction's opening `tx.get()` on a NEW trip — sync appears to
  work (nothing to push) until the first trip is created, then fails with
  permission-denied. Split `get` (allow `resource == null`) from `list`
  (always require membership, so nobody can enumerate trips).
- **Auth gotcha (v1.24 → fixed v1.25)**: `onAuthStateChanged` was only
  registered at launch for already-signed-in devices, so a first-ever
  sign-in succeeded server-side and the UI never heard about it. Rule:
  attach the listener before the sign-in call, AND read `currentUser()`
  back afterwards — never let the screen depend solely on a callback
  having fired. Any "succeeded but no session" case must say so out loud.
- **Touch gotcha**: custom swipe/drag surfaces need `touch-action`
  (`pan-y` for horizontal gestures) or Android fires pointercancel and the
  gesture dies — AND mouse-based Playwright tests won't catch it. Verify
  touch gestures with CDP `Input.dispatchTouchEvent` (+
  `Emulation.setTouchEmulationEnabled`), which runs the real gesture
  pipeline (bit us in v1.15.1).

## 4. Dev & release workflow
1. Dev server: `preview_start` with launch.json config "tripcash"
   (python3 http.server :8321). **Stop it when verification is done.**
2. Verify in Playwright; to defeat stale caches during dev: unregister SWs,
   delete caches, reload (sometimes needs CDP `Network.setCacheDisabled`
   for the browser HTTP cache).
3. Release: bump sw VERSION + about-card version string, CHANGELOG entry,
   commit (Co-Authored-By Claude line), `git push` (remote is SSH as
   collaborator archismandindaops — HTTPS PAT can't push workflows).
4. **Never sleep for the CDN** — poll:
   `until curl -s <live>/sw.js?cb=$RANDOM | grep -q tripcash-vNN; do sleep 5; done`
5. Live-verify with fresh eyes (expect the two-visit update lag; a mixed
   old-HTML/new-JS state can appear transiently between visits).

## 5. Phase roadmap
- [x] v1 walking skeleton → deploy → CI (see git history, all 2026-08-05)
- [x] Phase A: chart ranges + vs-average + platform polish (v1.8.0)
- [x] Phase C: share target, QR scan, slip guard, pocket rule, timezone
      location (v1.9.0)
- [x] Phase D1: home screen as trip cards (v1.12.0) + pin (v1.13.0) +
      collapsed launch, drag-reorder, Save gating (v1.14.0) + archive,
      search, filters (v1.15.0)
- [x] **Phase D2 — done (v1.16.0, verified 2026-08-05)**: members, expenses
      with INR snapshot-at-entry, equal/percent/shares splits with live
      validation, summary (settle-up + balances + cuts). Pure math in
      `js/splits.js` (unit-tested); expenses in `tripcash:expenses`;
      Convert/Expenses tabs inside the open trip card (`#panel-host`
      reparents now, not `#converter-panel`).
- Phase D3 (approved, ADR-0005) — **re-scoped 2026-08-05**: ADR-0005 predates
  receipts (v1.19 blobs) and settlements (v1.19), so D3 is now four steps
  instead of one, and receipt sync is explicitly out (see D3.5).
  - [x] **D3.1 — done (v1.22.0)**: sync-ready local data. Per-record
        `updatedAt`, deletion tombstones, and pure LWW merge rules in
        `js/merge.js` (ADR-0008), stamped inside store.js so no mutation
        site can forget. 23 merge tests + 5 store tests; zero UI change.
        Deliberately landed BEFORE any Firebase code — retrofitting
        timestamps onto data already in the cloud means guessing history.
  - [x] **D3.2 — done (v1.24.0)**: Firebase project `tripcash-7188d` live
        (Google + email/password providers on, `archismandinda.github.io`
        authorized, Firestore created in asia-south1, Production rules).
        Sign-in card in Settings; `js/firebase.js` lazy-imports the SDK
        from gstatic ONLY on opt-in (verified: zero Firebase requests
        while signed out). `settings.syncHint` gates restoring a session
        on launch. Google popup→redirect fallback for installed PWAs.
        Firebase error codes mapped to plain English (unit-tested).
  - [x] **D3.3 — DONE, live-verified by Archisman 2026-08-05** (v1.26.0):
        one
        Firestore doc per trip (ADR-0009) holding trip + expenses +
        settlements + tombstones, written in a transaction. Pure
        orchestration in `js/sync.js` (17 tests, fake remote); thin
        adapter in `js/firestore.js`. Auto-syncs on sign-in, plus a
        "Sync now" button. `firestore.rules` published (needed one fix —
        see the rules gotcha in §3). Confirmed on a real device: a trip
        created locally uploads and appears in the Firestore console.
        **Still unproven: the pull half.** Nobody has yet signed in on a
        SECOND device and watched a trip arrive — that is the actual
        point of the feature and should be exercised before D3.4.
  - [x] **D3.4 — done (v1.27.0), needs rules re-published**: invite by
        verified email (`invitedEmails` on the trip; rules match it
        against `request.auth.token.email`), delivery via the device's
        own share sheet + a `wa.me` link — no server, no paid plan
        (ADR-0010). Rules also forbid evicting existing members.
  - [ ] **D3.5 — APPROVED by Archisman 2026-08-05**: receipts to Cloud
        Storage. He has agreed to upgrade to Blaze (card on file);
        realistic cost ≈ ₹0/month within the 5 GB free allowance. Note
        the free storage quota only applies to us-central1/us-west1/
        us-east1 buckets — Mumbai would bill from byte one (pennies).
        Blocked on him doing the upgrade (billing is human-only).

## 6. Decisions log
- ADR-0001 vanilla static stack · ADR-0002 open.er-api over Frankfurter for
  live rates · ADR-0003 node:test + shared ES modules · ADR-0004 chart
  history via Frankfurter (ECB ~30 currencies; others show "no history") ·
  ADR-0005 cross the no-backend line with Firebase for shared trips (D2
  local-first ships before D3 sync) · ADR-0006 receipt blobs in IndexedDB
  (localStorage can't hold photos), records keep only {name,type} ·
  ADR-0007 vendored jsQR so the scanner exists on iOS (lazy-loaded;
  Android keeps native BarcodeDetector) · ADR-0008 sync = last-write-wins
  per record + deletion tombstones, stamped inside store.js so no
  mutation site can forget (`js/merge.js`, pure + unit-tested).
- Deliberately NOT adopted from the 2026-08-05 UI audit: decimal-comma
  parsing ("1,5"→1.5 conflicts with live comma grouping, see v1.7 note)
  and auto-reopening the last trip on launch (owner chose collapsed
  launch + empty converter).
- Markup math reads the visible toggle, not cached state.
- Expense amounts will snapshot home-currency value at entry (D2).

## 7. Backlog / parked
- Banknote cheat sheet per currency; share-trip-as-URL; flash-card mode;
  backup/restore export.
- From the UI audit, parked: filter the ledger by member (chips are plain
  labels for now); first-use hint for swipe-to-archive.
- Cut deliberately: push rate alerts (needs server), home-screen widgets
  (impossible for PWA on Android), tipping database (stale-data burden),
  price-tag OCR (TextDetector never shipped; WASM OCR too heavy).

## 8. Manual tasks (Archisman)
- Phone check after any release: open the installed app twice → Settings
  shows the new version. Try: type + ✓ key closes keyboard; swipe a trip
  left to archive; scan a real payment QR (never machine-verified with a
  physical camera). For v1.19: attach a receipt straight from the phone
  camera (never machine-verified with real camera capture), and check the
  "When" date-time picker feels right on Android.
- For v1.21 on the iPhone: the scan button should now appear in Safari —
  scan a real payment QR there (the jsQR fallback has never touched a
  physical camera); create a trip and confirm the currency list scrolls
  comfortably with the keyboard up; open a summary and try the
  collapsible sections.
### ⏳ BLOCKING D3.2 — finish the Firebase setup (only Archisman can do this)

Claude must never create accounts or accept terms. **Cost: ₹0** — free "Spark"
plan, no card. If the console ever asks you to upgrade to "Blaze" or add a
payment method, **stop and tell Claude** — nothing in this phase needs it.

**✅ DONE 2026-08-05**: project `tripcash-7188d` created, web app registered,
config captured into `js/firebase-config.js`. (Gemini + Google Analytics were
left enabled — harmless; the app never loads Analytics.) On the "Add Firebase
SDK" screen just click **Continue to console** — the npm/script-tag choice
there doesn't apply to us, we load the SDK straight from Google's CDN.

**⬜ STILL TO DO — turn on sign-in**

⚠️ The console was redesigned — there is **no "Build" menu** any more. The
sidebar now has product categories (Databases & Storage / Security / AI
services / …). Don't write nav instructions from memory; use direct URLs,
which have stayed stable, or the sidebar's "Search for products" box.

1. Open **Authentication → Sign-in method** directly:
   `https://console.firebase.google.com/u/0/project/tripcash-7188d/authentication/providers`
   (First visit shows a **Get started** button — click it.)
2. Click **Email/Password** → toggle **Enable** on (leave "Email link"
   off) → **Save**.
3. Click **Add new provider** → **Google** → toggle **Enable** on → pick
   your own email as "support email" if asked → **Save**.
4. Open **Authentication → Settings → Authorized domains**:
   `https://console.firebase.google.com/u/0/project/tripcash-7188d/authentication/settings`
   **Add domain** → `archismandinda.github.io`
   ⚠️ Skip this and Google sign-in fails on the live site with a "domain
   not authorised" error, even though everything else looks right.

**⬜ STILL TO DO — publish the Firestore access rules (blocks all syncing)**

Open `https://console.firebase.google.com/u/0/project/tripcash-7188d/firestore/rules`
→ select everything in the editor → paste the contents of `firestore.rules`
from this repo → **Publish**. Until this is done every sync fails with
"the database turned this down"; the app keeps working offline regardless.

**✅ DONE — create the database**

5. Open Firestore directly:
   `https://console.firebase.google.com/u/0/project/tripcash-7188d/firestore`
   Click **Create database**.
6. Location: choose **asia-south1 (Mumbai)** — closest, so the app feels
   fastest. This **cannot be changed later**.
7. Starting mode: choose **Production mode** (locked down). Test mode
   leaves the data readable by anyone on the internet for 30 days. Click
   **Create**. The database rejects everything until Claude supplies the
   rules — expected and correct.

**When you're done:** tell Claude the sign-in providers and database are
ready. Claude will then wire up sign-in and hand you the exact access rules
to paste into the Firestore **Rules** tab.

- If receipt photos should sync across phones too, say so — that needs
  Firebase's paid Blaze plan (pay-per-use, would likely be pennies at our
  volume, but it needs a card on file). Not doing it unless you ask.

## 9a. Testing note for D3.3 (read before starting)
Claude can verify the sign-in *plumbing* without an account (probe with
bogus credentials: `auth/invalid-credential` proves the provider is on,
`auth/operation-not-allowed` proves it isn't). But Claude must not create
accounts or enter Archisman's credentials, so anything needing a live
session — i.e. all of D3.3's push/pull — has to be confirmed by him on a
real device, or via the Firebase emulator if that's ever worth the setup.

## 8b. Pending manual tasks (Archisman) — as of v1.27.0
1. **Re-publish `firestore.rules`** (invites won't work until then).
2. **Upgrade the Firebase project to Blaze** for receipt sync (D3.5) —
   billing is human-only. Set a budget alert (~₹100) at the same time.
3. **Pick a free domain** — see §7 backlog; js.org and is-a.dev both
   need a pull request, so Claude can prepare it but Archisman submits
   it from his own GitHub account.

## 8c. Live-update invariants (don't break these — ADR-0012)
- `suppressPush` must wrap any write that comes FROM a snapshot, or two
  phones bounce the same trip forever. Push afterwards only when
  `payloadChanged(merged, remote)`.
- Never `renderTrips()` while `dialog[open]` — defer via `queueLiveRender`
  and flush on the sheet's close event.
- `saveTrips()` fires per keystroke (it persists `lastEdit`), so the
  outbound push must stay debounced.

## 9. Next step
Sync is live and verified in the upload direction. **Before building on
it, prove the download direction**: sign in on a second browser/device
and confirm the trip arrives intact. That is the half nobody has tested.

Then **D3.4 — trip invites**. Design note for whoever picks this up:
invite-by-email needs a way to turn an email into a uid, which means
either a `users/{uid}` collection readable by strangers (leaky) or Cloud
Functions (**Blaze — paid, needs Archisman's OK**). Invite-by-link is
free and simpler: an `invites/{code}` doc naming the trip, plus a rule
letting a signed-in holder of a valid code add their own uid to that
trip's `memberUids`. Prefer the link unless he asks otherwise.
Receipts stay local (D3.5).

Sync is opt-in and must never become a precondition for using the app
offline — signed out, TripCash makes zero Firebase requests.

Also worth knowing: Playwright verification gotchas live in §3/§4
(touch-action + CDP touch testing, `context().route` must be undone with
`context().unrouteAll()` — a page-level unroute does NOT clear it and the
leftover route silently kills all SW network traffic).

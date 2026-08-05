# TripCash — Project Context

**Single source of truth for any session picking up this project. Read this
first; if it disagrees with the code, reconcile from the repo and update it.**

## 1. What we're building
A mobile-first PWA travel-money app for Archisman (Indian traveller, home
currency INR). Started as a multi-currency converter; now growing into a
Splitwise-style shared trip ledger (approved plan, phases D2/D3 pending).
Live at **https://archismandinda.github.io/tripcash/** · repo
`archismandinda/tripcash` · currently **v1.19.0** (SW cache v26).

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
  non-archived trip; payment-QR scanner (BarcodeDetector; EMVCo TLV tags
  53/54 + UPI links; camera timeout + guaranteed release); timezone-based
  "you're here" (no permission, `currencyForTimeZone`); manifest shortcut
  (New trip); haptics (guarded by userActivation); light/dark/auto theme;
  sheets close via backdrop tap or pull-down; native tap-highlight disabled.

## 3. Stack & conventions
- Vanilla HTML/CSS/JS ES modules, no build step, no runtime deps (ADR-0001).
- **Files**: `js/app.js` (state+wiring, the big one) · `js/ui.js` (DOM
  builders, ICONS) · `js/attach.js` (IndexedDB receipt blobs — the ONE
  exception to "store.js owns storage", which is localStorage-only) ·
  `js/store.js` (ALL localStorage access) ·
  `js/convert.js` (pure math) · `js/currencies.js` (static data + search) ·
  `js/rates.js` · `js/history.js` + `js/chart.js` (charts) · `js/parse.js`
  (share/QR parsing) · `js/insights.js` (gloss, slip guard, pocket rule,
  timezone) · `js/scan.js` (camera) · `sw.js` · `fonts/` (self-hosted
  Manrope; keep offline promise — never hotlink assets).
- **localStorage** (all `tripcash:`-prefixed, corruption-guarded in store.js):
  - `settings` → homeCurrency, activeTripId (= open card), pinnedTripId,
    markupOn/markupPct, theme, rangeDays, placeDismissed, detailTipShown
  - `trips` → [{ id, name, currencies[], createdAt, lastEdit, samples,
    archived, members? (D2) }]
  - `rates` → { base:"USD", fetchedAt, rates }
  - `history` → chart cache, key `BASE->QUOTE`, {fetchedAt, series}
  - `settlements` → [{ id, tripId, from, to, amount (home ccy), createdAt }]
- **Tests**: `node --test tests/*.test.mjs` (67 tests; the `--test dir/`
  form breaks on Node 24 — keep the glob). CI runs on every push.
- **SW discipline**: bump `VERSION` in sw.js every release (currently v26);
  precache uses `cache:"no-cache"` requests; runtime is
  stale-while-revalidate so stale clients self-heal one visit later.
  Clients see a new release only on their SECOND open ("open the app twice").
- **SVG gotcha**: `.hidden` property doesn't exist on SVGElement — never
  toggle it there (bit us in v1.8.2).
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
- [ ] Phase D3 (approved, ADR-0005): Firebase Auth (Google + email) +
      Firestore sync + trip invites. **Archisman must create the Firebase
      project himself** (accounts are human-only); Spark tier ₹0.

## 6. Decisions log
- ADR-0001 vanilla static stack · ADR-0002 open.er-api over Frankfurter for
  live rates · ADR-0003 node:test + shared ES modules · ADR-0004 chart
  history via Frankfurter (ECB ~30 currencies; others show "no history") ·
  ADR-0005 cross the no-backend line with Firebase for shared trips (D2
  local-first ships before D3 sync) · ADR-0006 receipt blobs in IndexedDB
  (localStorage can't hold photos), records keep only {name,type}.
- Markup math reads the visible toggle, not cached state.
- Expense amounts will snapshot home-currency value at entry (D2).

## 7. Backlog / parked
- Banknote cheat sheet per currency; share-trip-as-URL; flash-card mode;
  backup/restore export.
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
- When D3 starts: create the Firebase project (guided steps will be added
  here at that time).

## 9. Next step
**Phase D3** (approved, ADR-0005): Firebase Auth (Google + email) +
Firestore sync + trip invites, layered over the local-first data.
Blocked on a human step: Archisman must create the Firebase project
(give click-by-click instructions when starting). Keep the converter and
ledger fully usable signed-out; sync is opt-in.

Also worth knowing: Playwright verification gotchas live in §3/§4
(touch-action + CDP touch testing, `context().route` must be undone with
`context().unrouteAll()` — a page-level unroute does NOT clear it and the
leftover route silently kills all SW network traffic).

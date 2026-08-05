# TripCash — Project Context

**Single source of truth for any session picking up this project. Read this
first; if it disagrees with the code, reconcile from the repo and update it.**

## 1. What we're building
A mobile-first PWA travel-money app for Archisman (Indian traveller, home
currency INR). Started as a multi-currency converter; now growing into a
Splitwise-style shared trip ledger (approved plan, phases D2/D3 pending).
Live at **https://archismandinda.github.io/tripcash/** · repo
`archismandinda/tripcash` · currently **v1.15.0**.

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
  builders, ICONS) · `js/store.js` (ALL localStorage access) ·
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
- **Tests**: `node --test tests/*.test.mjs` (50 tests; the `--test dir/`
  form breaks on Node 24 — keep the glob). CI runs on every push.
- **SW discipline**: bump `VERSION` in sw.js every release (currently v21);
  precache uses `cache:"no-cache"` requests; runtime is
  stale-while-revalidate so stale clients self-heal one visit later.
  Clients see a new release only on their SECOND open ("open the app twice").
- **SVG gotcha**: `.hidden` property doesn't exist on SVGElement — never
  toggle it there (bit us in v1.8.2).

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
- [ ] **Phase D2 (NEXT, approved)**: members per trip, expenses (type/name/
      description/amount/currency/payer), splits (equal | percent | shares),
      trip summary (net balances → simplified who-pays-whom, cuts by
      category/member/currency/day). All local-first. Snapshot home-currency
      value at expense entry so debts don't drift with rates. New key
      `tripcash:expenses`. Search already matches `trip.members`.
- [ ] Phase D3 (approved, ADR-0005): Firebase Auth (Google + email) +
      Firestore sync + trip invites. **Archisman must create the Firebase
      project himself** (accounts are human-only); Spark tier ₹0.

## 6. Decisions log
- ADR-0001 vanilla static stack · ADR-0002 open.er-api over Frankfurter for
  live rates · ADR-0003 node:test + shared ES modules · ADR-0004 chart
  history via Frankfurter (ECB ~30 currencies; others show "no history") ·
  ADR-0005 cross the no-backend line with Firebase for shared trips (D2
  local-first ships before D3 sync).
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
  physical camera).
- When D3 starts: create the Firebase project (guided steps will be added
  here at that time).

## 9. Next step
Say **"next phase"** → build Phase D2 (members + expenses + splits +
summary) under the quality bar, phased checkpoint first.

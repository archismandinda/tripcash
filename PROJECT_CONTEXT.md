# TripCash — Project Context

## 1. What we're building
A mobile-first PWA travel currency converter. You create named "Trips" (e.g.
"Central Europe" = EUR + CZK + HUF), and the main screen shows one amount field
per currency plus your home currency (INR by default). Typing in any field
instantly recalculates all the others — every field is both input and output.
Works fully offline after first load, installable on Android via
Add to Home Screen.

**Goal:** shareable personal tool (built to personal-tool scope, but with an
automated test suite + CI since it may be shared).

**MVP user stories — all shipped in v1.0.0:**
- As a traveller I pick countries or currencies for a trip; duplicates collapse
  automatically (France + Netherlands → one EUR field).
- I can save multiple named trips, switch between them, and everything
  (trips, active trip, last amounts) survives closing the app.
- I type in any currency field and see all others update live, with no
  convert button.
- I can use the app with no signal, on rates cached from the last fetch, and
  the app clearly tells me how old the rates are and when I'm offline.
- I can toggle a "street rate" markdown (−N%) to preview worse-than-mid-market
  cash exchange, and tap a currency label to copy the amount.

## 2. Stack, versions, conventions
- **Stack:** vanilla HTML/CSS/JS (ES modules), no build step, no dependencies.
  Deployable as plain static files. See ADR-0001.
- **Rates API:** `https://open.er-api.com/v6/latest/USD` — free, keyless,
  160+ currencies, daily refresh. See ADR-0002.
- **Tests:** Node built-in test runner (`node --test tests/*.test.mjs`),
  no test dependencies. Dev machine: Node 24.16.0; CI: Node 20. See ADR-0003.
- **CI:** GitHub Actions (`.github/workflows/ci.yml`) runs the suite on push.
- **localStorage keys** (all namespaced, all reads guarded with fallbacks):
  - `tripcash:settings` → `{ homeCurrency, activeTripId, markupOn, markupPct,
    theme, rangeDays, placeDismissed }`
  - `tripcash:trips` → `[{ id, name, currencies[], createdAt, lastEdit,
    samples }]` (samples feed the decimal-slip guard)
  - `tripcash:history` → per-pair chart series, 8 most recent
  - `tripcash:rates` → `{ base: "USD", fetchedAt, rates: {code: perUSD} }`
- **Conversion model:** single base currency (USD). Any edit converts
  input → base → every other field. Pairwise rates are never stored.
- **File map:** `index.html` (single page) · `styles.css` · `js/app.js` (state
  + wiring) · `js/ui.js` (DOM builders) · `js/store.js` (all storage) ·
  `js/rates.js` (fetch/cache/age) · `js/convert.js` (pure math, unit-tested) ·
  `js/currencies.js` (static data: ~70 currencies, country names for search) ·
  `js/history.js` + `js/chart.js` (ECB rate charts, ADR-0004) ·
  `js/parse.js` (share-target text + payment-QR parsing) ·
  `js/insights.js` (lakh gloss, slip guard, pocket rule, timezone location) ·
  `js/scan.js` (camera + BarcodeDetector) ·
  `sw.js` (app-shell cache, stale-while-revalidate) · `manifest.json` · `icons/` · `fonts/` (self-hosted Manrope).
- **When shipping any file change:** bump `VERSION` in `sw.js`. The SW also
  revalidates every cached file in the background on each visit
  (stale-while-revalidate), so clients heal even if a deploy races the CDN. The precache uses `cache: "no-cache"`
  requests — keep it that way, or GitHub Pages' 10-minute HTTP cache can pin
  stale files into the new SW cache (bit us in v1.1.0).
- Local dev server: `.claude/launch.json` config "tripcash"
  (python3 http.server on port 8321). Stop it once verification is done.
- **After pushing, don't sleep for CDN propagation** — poll for the real
  thing instead, which normally passes within seconds:
  `until curl -s <url>/sw.js | grep -q "tripcash-vNN"; do sleep 5; done`
  (a fixed wait is both slower and weaker; the SW's no-cache precache and
  background revalidation already make a stale edge self-heal).

## 3. Phase roadmap
- [x] v1 walking skeleton + full feature set — **done** (all checks green,
      verified end-to-end 2026-08-05)
- [x] Deploy to GitHub Pages — **done** (live at
      https://archismandinda.github.io/tripcash/, verified 2026-08-05:
      zero failed requests, SW scope correct, reload served from SW cache,
      166 currencies, trip/convert/persistence all green)
- [x] Push CI workflow — **done** (first run green, 2026-08-05; pushes go
      over SSH as collaborator archismandindaops, commits authored as
      archismandinda)
- [ ] Post-deploy check on a real Android phone (install, offline test) —
      Archisman's phone, steps in §6 tasks 5–6
- [x] Phase A: chart ranges + vs-average signal + platform polish — **done**
      (v1.8.0, verified 2026-08-05 incl. graceful handling of a flaky
      Frankfurter upstream via fetch timeouts)
- [x] Phase C: share target, payment-QR scan, slip guard + Indian numbers,
      pocket rule, timezone location — **done** (v1.9.0, verified 2026-08-05;
      QR pipeline tested with a stubbed camera/decoder — the physical camera
      still needs a check on Archisman's phone)
- [ ] Phase B: expense log + trip budget (approved, not started)

## 4. Decisions log
- ADR-0001 — Vanilla JS static site instead of the usual Expo/React stack.
- ADR-0002 — open.er-api.com over Frankfurter (currency coverage).
- ADR-0003 — Node built-in test runner + ES modules shared browser/Node.
- ADR-0004 — Rate history via Frankfurter (ECB), partial coverage accepted.
- (in-code) Markup math reads the visible toggle, not cached state, so the
  displayed conversion can never silently disagree with the switch.

## 5. Backlog / parked ideas
- Banknote cheat sheet per currency (Tier 1 candidate, not yet scheduled).
- Share trip as URL; flash-card mode; backup/restore export (Tier 2).
- Cut on purpose: rate alerts (needs push backend), home-screen widget
  (impossible for PWA), tipping-norms database (stale-data burden).

## 6. Manual tasks — deploy to GitHub Pages (Archisman)

1. ~~Create the repo~~ — **done** (archismandinda/tripcash exists).
2. ~~Push the code~~ — **done** (pushed without the CI workflow; see task 7).
3. **Turn on Pages:** in the repo on github.com → **Settings** → **Pages**
   (left sidebar) → under "Build and deployment", Source: **Deploy from a
   branch**, Branch: **main**, folder **/(root)** → **Save**.
4. **Wait ~1 minute**, then open `https://archismandinda.github.io/tripcash/`.
   You'll know it worked when the TripCash screen loads and the status line
   shows "Rates as of just now".
5. **Install on your Android phone:** open that URL in Chrome on the phone →
   tap the **⋮** menu → **Add to Home screen** (may say "Install app") →
   **Install**. The TripCash icon appears on your home screen and opens
   full-screen like a native app.
6. **Offline check on the phone:** open the app once online, then turn on
   airplane mode and reopen it — it should load, show your trip, and display
   "Offline — using rates from …".
7. ~~Enable CI~~ — **done** (archismandindaops added as collaborator; CI
   workflow pushed, first run green).

## 7. Open questions / next step
**Next step:** install it on the Android phone (§6 task 5) and run the
airplane-mode check (task 6). CI push waits on the collaborator invite
(task 7).

# Changelog

All notable changes to TripCash are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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

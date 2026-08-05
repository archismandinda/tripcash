# Changelog

All notable changes to TripCash are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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

# Changelog

All notable changes to TripCash are documented here.
Format: [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

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
- **Needs three setup steps only Archisman can do** — generate the Web
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

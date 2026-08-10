# Privacy

TripCash is a money app. What it knows about you should be short enough
to read in full, so here it is in full.

## Without an account

Everything stays on your device. Trips, expenses, members, receipts and
settings live in your browser's own storage and are never uploaded.

Two things leave your device even signed out:

- **Exchange rates** are fetched from a public rates API. The request
  carries no identifier and says nothing about you beyond that somebody
  asked for today's rates.
- **Anonymous counts**, described below, which you can switch off.

The app makes **no requests to Firebase at all** until you sign in. That
is deliberate and enforced in the code: the Firebase SDK is not even
downloaded for a signed-out visitor.

## With an account

Signing in adds syncing and sharing, and nothing else. What is stored:

| | |
|---|---|
| Your trips | name, currencies, members, expenses, settlements |
| Your account | email address, display name, profile photo if your provider supplies one |
| Receipts | only the ones you attach, in your own storage area |
| Device state | a per-device clock reading used to order edits correctly |

Trip data is readable by the people on that trip and nobody else. This is
enforced by server-side security rules, not by the app being polite —
the rules are in `firestore.rules` in this repository, and they are
tested against a real database emulator on every change.

**Your email address** is stored on your own user document so that people
can invite you by address before you have ever opened the app. Invitations
are addressed by a one-way hash of the address, so the invitation index
cannot be read as a list of who uses TripCash.

## Anonymous counts

The app counts six things, and only six:

1. A share link was opened
2. An invitation screen showed a trip
3. Someone joined a trip
4. A device recorded its first expense, ever
5. A trip was created — with one flag: was it created by someone who had
   previously joined someone else's trip
6. The app was opened again after 30+ days away

Each count carries a random device identifier, the app version and a
timestamp. **No trip names, no member names, no amounts, no currencies,
no email addresses, no IP-based location, no page paths.** The list of
permitted fields is a hard allowlist in `js/analytics.js`, and the server
stores per-day totals only — never individual events.

The identifier is generated on your device and is not linked to your
account. It cannot be used to look you up.

**Switching it off:** Settings → *Anonymous counts*. It defaults to off
in the UK, EU and EEA, and on elsewhere. Nothing about the app changes
either way, and you will never be asked twice.

## What TripCash never does

- No advertising, and no advertising identifiers.
- No third-party analytics, trackers, pixels or embedded SDKs.
- Nothing is sold, shared or brokered. There is no data business here.
- No location access. No contacts access. No microphone. The camera is
  used only when you open the QR scanner, and the image never leaves the
  device.

## Deleting your data

Deleting a trip removes it for everyone on it. Signing out leaves your
local data untouched on the device. To remove your account and everything
attached to it, open an issue or contact the address in `SECURITY.md`.

## Changes

Material changes to this document will be recorded in `CHANGELOG.md`
alongside the release that makes them.

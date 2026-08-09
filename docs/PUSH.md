# Turning push notifications on

The code is written and deployed to GitHub Pages. Three things still need
doing, and **all three need your Google account**, so they're yours — I
can't sign in, deploy, or approve billing on your behalf.

Until step 1 is done the app doesn't show a notifications switch at all;
it checks for the key and stays quiet rather than offering a toggle that
can only fail.

---

## 1. Generate the Web Push key (2 minutes) — ✅ DONE 9 Aug 2026

1. Firebase console → **tripcash-7188d** → ⚙️ **Project settings**
2. **Cloud Messaging** tab
3. Under **Web Push certificates**, click **Generate key pair**
4. Copy the **Key pair** string (long, starts with `B…`)

Then paste it into `js/firebase-config.js`:

```js
export const VAPID_PUBLIC_KEY = "paste-it-here";
```

This key is **public by design** — it identifies the sender to the
browser's push service, exactly like the Firebase config above it. The
private half stays in Firebase and never comes near this repo.

Tell me once it's pasted and I'll commit and deploy it.

---

## 2. Deploy the Cloud Function (5 minutes, first time only)

The function lives in [`functions/index.js`](../functions/index.js). It
watches every trip document and sends a notification when something new
appears — to every member except whoever made the change.

```bash
npm install -g firebase-tools
```

```bash
cd ~/Documents/Claude/tripcash && firebase login
```

The project is pinned in `.firebaserc` (`tripcash-7188d`), so no
`firebase use` step and no `--project` flag — the deploy below targets
the right project on any machine that checks this repo out.

```bash
cd ~/Documents/Claude/tripcash && firebase deploy --only functions
```

The first deploy asks to enable a few Google Cloud APIs (Cloud Functions,
Cloud Build, Artifact Registry, Eventarc). Say yes — they're required, and
they're what the Blaze plan you already have is for.

**Cost:** this fires once per trip write. For a handful of people on a
trip that is a few hundred invocations a month against a free tier of two
million. Expect ₹0. The function is capped at 3 instances so a runaway
loop can't change that.

---

## 3. Turn it on, per device

Settings → under **Synced** → **Notify me on this device** → *Turn on*.

It's per device on purpose: notifications on your phone, silence on the
laptop you left at the hotel.

### On iPhone this only works from the Home Screen

iOS delivers web push **only to an installed PWA**, and only from iOS
16.4. In a normal Safari tab the API exists and permission can even be
granted — nothing is ever delivered.

So: **Share → Add to Home Screen**, open TripCash from that icon, then
turn notifications on. The app checks for this and says so instead of
letting you switch on something that will never fire.

Android and desktop Chrome work in a normal tab.

---

## What you'll actually get

- *Vietnam* — **Dinner · ₫450,000**
- *Vietnam* — **3 new expenses**
- *Vietnam* — **A payment was recorded**
- *Vietnam* — **Someone was added to the trip**

And nothing else. Edits, renames, reorders and your own changes are all
silent — a notification you didn't need is how people end up turning
notifications off entirely.

Tapping one opens that trip. If your phone hasn't synced yet it pulls
first, then opens it.

---

## If nothing arrives

1. **Is the switch actually on?** It reads "On" when registered.
2. **iPhone: opened from the Home Screen icon**, not a Safari tab?
3. **Was it your own change?** The author is skipped, by design. Test
   with two devices, or with someone else on the trip.
4. **Function logs:** `firebase functions:log --only notifyTripChange`
5. **Did the trip actually reach the cloud?** The function triggers on
   the Firestore write, so no sync means no notification. Tap Sync now.

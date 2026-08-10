# Push notifications

**Setup is complete and push is live.** Everything below is kept as the
record of how it was turned on, and as the runbook if it ever has to be
done again — a new Firebase project, a rotated key, a fresh environment.

This file used to open by saying three things still needed doing. They were
done on 9 August 2026 and the file did not say so for a day, which is its
own small lesson: a setup document that outlives its setup starts lying.

**How it stands now:**

- Web Push key generated and committed to `js/firebase-config.js` — public
  by design, exactly like the Firebase config beside it.
- The Cloud Function is deployed to `asia-south1` and verified live.
- Notifications fire on a change to a shared trip, addressed to the members
  and invitees derived from the trip document itself, so removing somebody
  stops their notifications with no separate step.
- Tapping one opens the trip. The link is built from `APP_ORIGIN` in
  `functions/index.js`, which points at `https://tripcash.app` — **if the
  domain ever changes, that constant and a function redeploy change with
  it, or every notification opens the old address.**

**If you redeploy the function, bump `FUNCTION_VERSION` first.** Without a
change in the source the CLI reports "no changes detected" and silently
ships nothing, which looks identical to success.

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

## 2. Deploy the Cloud Function (5 minutes, first time only) — ✅ DONE 9 Aug 2026

The function lives in [`functions/index.js`](../functions/index.js). It
watches every trip document and sends a notification when something new
appears — to every member except whoever made the change.

```bash
npm install -g firebase-tools
```

```bash
firebase login
```

The project is pinned in `.firebaserc` (`tripcash-7188d`), so no
`firebase use` step and no `--project` flag — the deploy below targets
the right project on any machine that checks this repo out.

```bash
firebase deploy --only functions
```

The first deploy asks to enable a few Google Cloud APIs (Cloud Functions,
Cloud Build, Artifact Registry, Eventarc). Say yes — they're required, and
they're what the Blaze plan you already have is for.

**Two hiccups are normal on a first deploy, and both are fixed by simply
running the command again a few minutes later:**

- *"We failed to modify the IAM policy for the project"* — the service
  agents for the APIs it just enabled don't exist yet. Google creates
  them asynchronously.
- *"Permission denied while using the Eventarc Service Agent… Retry the
  deployment in a few minutes"* — same shape, one layer up. Firebase
  says this outright. Nothing to change; waiting is the fix.

It then asks **"How many days do you want to keep container images before
they're deleted?"** — press Enter to accept **1**. Those are build
artefacts; nothing at runtime reads them, and with no policy they
accumulate and cost storage every month.

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

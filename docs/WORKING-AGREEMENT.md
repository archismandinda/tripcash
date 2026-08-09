# How to work on TripCash

Written 10 Aug 2026, after a run of bugs that all reached Archisman's
phone before anyone else saw them. Every rule here is here because
breaking it cost something real.

Archisman is a product manager, not an engineer. He tests on a Mac, an
Android phone and an iPhone SE. **He has said plainly that he does not
want to debug.** That is the constraint everything below serves.

---

## 1. If you can't verify it, say so — don't ship it for him to test

The most expensive failure mode in this project's history was not a bad
fix. It was a **confident claim about something untested**. Five
invitation "fixes" shipped in a row, each correct, each hiding the next,
because the only test available was him on a phone.

- Say "I verified X by doing Y" or "I could not verify this."
- Never say "fixed" about something you only reasoned about.
- An honest gap is worth more than a claim he disproves within the hour.

## 2. Test it yourself first — the tools exist now

```
npm test            # 316 unit tests. Locale-pinned; do not unpin.
npm run test:rules  # Firestore emulator, the REAL firestore.rules, throwaway accounts.
```

`npm run test:rules` exists because three invitation bugs shipped that
nothing could catch without signing in as him. It needs a JDK 21+; the
script finds one. **Anything touching rules, invites or access gets
tested here before he hears about it.**

For UI, drive the LIVE build in the browser after deploying — a local
server cannot run from `~/Documents` (macOS blocks it). Bugs have been
caught this way that no unit test would have found: v1.46.1 existed
because clicking through the deployed app showed the expense sheet
promising today's rate while the save kept the locked-in one.

## 3. Decisions go in pure modules. `app.js` is io only

Every bug he personally hit lived in `js/app.js`. Not one was bad logic —
the pure modules survived two adversarial audits and a five-agent QA
team essentially intact.

The shape was always the same: **the same rule written in more than one
place, drifting apart.**

- `parseAmount`'s locale fixed in `convert.js`, left unfixed in `parse.js`
- the expense field given the converter's protections, with the two ends
  on different locales
- `invitedAt` wired into one of two invite paths
- adding a member implemented twice, removability implemented twice

So: if a decision can be stated as a function of its inputs, it belongs
in a pure module (`absorb`, `roster`, `pricing`, `splits`, `merge`,
`sync`, `members`, `invites`, `notices`). `app.js` reads inputs and
paints outcomes.

**When extracting: write the characterization tests FIRST, against the
existing inline code, and watch them pass before anything moves.** Then a
green suite proves behaviour is unchanged rather than that it compiles.

## 4. Update the docs as part of the change, never after

His instruction, and it is right: the conversation is summarised when
context fills, but the repo is permanent. `PROJECT_CONTEXT.md`,
`CHANGELOG.md` and the ADRs are the memory. A CHANGELOG entry should name
what was actually wrong ("the count replaced the irreversibility
warning"), not "improved the confirm dialog".

## 5. Read PROJECT_CONTEXT before "improving" anything

§6 recorded decimal-comma parsing as *deliberately rejected*, with the
exact reason it would fail. It was adopted anyway in v1.45 and produced
exactly the predicted conflict — the app misreading its own output. The
file said so and nobody read it.

## 6. What only Archisman can do

Never do these for him, and say clearly when they're needed:

- **Publish `firestore.rules`** (console → Firestore → Rules → Publish)
- **Deploy the function** (`firebase deploy --only functions`) — and note
  that `firebase deploy` can report "no changes detected" for source that
  HAS changed; `FUNCTION_VERSION` in `functions/index.js` exists to make
  a silently skipped deploy visible
- Anything involving billing, accounts, credentials, or terms

## 7. Getting a bug report out of him

When he says something is broken, **get the actual state before
theorising**. Five releases of reasoning missed what one dump of
local-vs-cloud values answered instantly. If that class of bug returns,
write the diagnostic again — it is cheaper than another wrong guess.

And check the obvious platform gates first, because two separate reports
turned out to be these:

- iOS delivers web push **only to an installed PWA**, never in a Safari tab
- iOS Safari does not apply `:active` **at all** unless the document has
  a touch listener — every button looked dead on his phone while working
  perfectly on desktop
- An installed iOS PWA has no reload gesture; Settings → App version →
  Check exists solely so a device can get off an old build

## 8. The recurring lesson, in one line

Five ADRs (0014, 0016, 0017, 0019 and the drift above) are the same
sentence wearing different clothes:

> **What you write must be derived from what is true at the moment you
> write it — and the rule must exist in exactly one place.**

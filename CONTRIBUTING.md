# Contributing

The source is public so it can be read and audited. The licence does not
permit redistribution or derivative works, so pull requests that add
features are generally not accepted — but there is plenty that helps.

## Most useful

**Bug reports.** Especially anything involving two devices, going
offline, or money coming out wrong. Those are the failures that matter
here and the hardest to find alone.

**Security reports.** See `SECURITY.md` — privately, please.

**Correctness reports.** If a split, a conversion or a settle-up gives a
number you can show is wrong, that is the highest-value thing you can
send. Include the amounts and the currencies.

## Filing a good bug

Include:

- What you did, what you expected, what happened instead.
- The version — shown next to the TripCash name at the top of the screen.
- Whether more than one device was involved, and whether either was
  offline at the time.
- The currencies in play, if it is about money.

Screenshots help. Please blank out anything you would not want public.

## If you want to change code

Open an issue first and describe the problem you are solving. Small,
focused fixes to real bugs are welcome; please raise them before writing
them, so nobody's time is wasted.

Anything merged must keep the project's two standing rules:

1. **Decisions live in pure modules, tested.** `js/app.js` does io and
   rendering only. Nearly every bug this project has shipped came from a
   rule written in two places and drifting apart.
2. **Nothing ships without a test that would have caught it.** Write the
   test first, watch it fail, then fix it.

Run before proposing anything:

```bash
npm test
npm run test:rules
npm run preflight
```

All three must pass. `preflight` is the release gate — it checks the things
that are only knowable at the moment of a cut: that every module the app
imports is tracked in git and precached for offline use, that the
service-worker cache version moved, and that nothing personal is about to
be published. `npm run test:rules` needs JDK 21+ and the Firebase
emulator — see `docs/TESTING.md`.

# Moving to tripcash.js.org

*Prepared 10 Aug 2026. Ready to submit; blocked only on Archisman.*

`archismandinda.github.io/tripcash` reads as somebody's weekend project.
[js.org](https://js.org) gives free subdomains to JavaScript projects,
which TripCash is — vanilla ES modules, no framework, no build step.

## What is already done

- `CNAME` in the repo root containing `tripcash.js.org`. GitHub Pages
  reads this and starts serving the custom domain as soon as DNS
  resolves. **Harmless until then** — the existing URL keeps working
  either way.

## What Archisman has to do

**1. Submit the PR** (js.org requires it from a real GitHub account):

- Fork `js-org/js.org`
- Edit `cnames_active.js`, adding in alphabetical order:
  ```js
  "tripcash": "archismandinda.github.io/tripcash",
  ```
- Open a PR. Suggested title and body:

> **Add tripcash.js.org**
>
> TripCash is an offline-first PWA for travellers: a multi-currency
> converter that works with no signal, and a shared trip ledger that
> settles up at the end.
>
> Written in vanilla JavaScript — ES modules, no framework, no bundler,
> no runtime dependencies. Source: https://github.com/archismandinda/tripcash
>
> Live now at https://archismandinda.github.io/tripcash/

Review typically takes a few days. They check the site is real, is
JavaScript, and has content — all true.

**2. After it merges**, in the Firebase console:

- **Authentication → Settings → Authorized domains → Add** `tripcash.js.org`.
  **Google sign-in breaks on the new domain without this.**

**3. Tell me**, and I will:

- Update `APP_ORIGIN` in `functions/index.js` — push notification
  click-through links are absolute and currently hardcoded to the
  GitHub Pages origin — and redeploy the function.
- Update `README.md`, `docs/PUSH.md` and the manifest.

## What does not break

- The old URL keeps working. GitHub Pages serves both.
- Existing invite links carry the old origin and continue to resolve.
- Nobody has to reinstall. A device that added the old URL to its home
  screen keeps working; it simply stays on the old origin until
  reinstalled.

## Why not a paid domain

`tripcash.app` or similar would be better for a real launch, and costs
about ₹1,500/year. This is free, takes a week, and is reversible. Worth
revisiting at [Stage 2](../ROADMAP.md) — before spending on a name,
find out whether the loop turns.

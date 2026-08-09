# The domain

*Decision recorded 10 Aug 2026: stay on `github.io` for now.*

`archismandinda.github.io/tripcash` reads as somebody's weekend project.
It is worth fixing — but not yet, and not the way first attempted.

## js.org was the wrong answer, and why

[js.org](https://js.org) gives free subdomains to JavaScript projects, so
it looked ideal. It is not. Their pull request template is explicit:

> Your site content MUST be DIRECTLY related to the JavaScript
> ecosystem/community. **Using JavaScript on your website is not
> justification by itself.** You must explain why your website content,
> not the code, is specifically relevant to other JavaScript developers.

TripCash's content is for travellers. It is written in vanilla JS, which
is precisely the justification they name as insufficient. The honest
reading is that it does not qualify, and the only case that could be made
— "an open-source reference implementation of a no-build-step PWA" —
fails on its own terms too, because the project is not licensed for
reuse.

A PR was prepared and abandoned before submission. **The lesson is worth
more than the domain: check the acceptance criteria of somebody else's
process before starting work inside it.** The same mistake in a rules
file or an app store would have cost far more than twenty minutes.

## What to do instead, and when

**Now: nothing.** Stay on `github.io`. The URL is not what stops people
using TripCash — the [cold-open](COLD-OPEN.md) is, and
[instrumentation](INSTRUMENTATION.md) is what will tell us so. The domain
sat third behind both for good reason.

**At [Stage 1](../ROADMAP.md)**, when there are real users to send
somewhere: buy one. `tripcash.app` or `tripcash.in`, roughly
₹800–1,500/year from Namecheap or Cloudflare. Twenty minutes, no
gatekeeper, and it is what a product heading for a million users wants
anyway. A free subdomain was always a stopgap.

## When that happens, three things break quietly

Recorded now so they are not rediscovered later:

1. **`CNAME` in the repo root.** GitHub Pages reads it to serve a custom
   domain. Removed again for now, since it named a domain we are not
   getting.
2. **Firebase authorized domains.** Console → Authentication → Settings →
   Authorized domains → add the new host. **Google sign-in fails on the
   new origin without it**, and the failure looks like a broken app
   rather than a missing setting.
3. **`APP_ORIGIN` in `functions/index.js`.** Push notification
   click-through links are absolute and hardcoded. Needs updating and a
   function redeploy, or every notification opens the old origin.

The old URL keeps working either way — GitHub Pages serves both — so
existing invite links and home-screen installs do not break.

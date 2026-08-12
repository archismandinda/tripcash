# Accessibility: what is fixed, what is not

*Written 10 Aug 2026 at v1.68.0, alongside the payer-picker fix.*

*Two sections added after QA read the first version of this fix: the
payer picker announced the selection to a cursor that had just been thrown
out of the sheet, and the 100x warning was made so loud it drowned out the
field it guards. Both are recorded here as fixed, with what was measured.*

An accessibility read of the app turned up a list. Two items on it did not
annoy a screen-reader user — they **blocked the task**, and both were on
the screen that decides who owes whom. Those are fixed. The rest are here,
each with a file and a line, because a finding nobody wrote down is a
finding that gets rediscovered a year later by the person it hurt.

Every line number below was checked against the tree at the time of
writing. Anything not verified is in the last section, named as such.

---

## Fixed

### The payer picker did not say who was selected

`memberChip` (`js/ui.js:165`) built a `<button>` whose whole selected
state was a CSS class: `member-chip on`. No role, no `aria-pressed`, no
`aria-checked`. The three rows it fills were bare `<div class="member-row">`
with no group role and no name — the visible `<label>` above each cannot
use `for`, because a row of buttons is not a form control, so it labelled
nothing at all.

A screen reader therefore read a row of unlabelled names with no way to
tell which was chosen. That is not a nuisance: **the payer decides who owes
whom**, and in the payment sheet the two rows decide which *direction* the
money moved. Reversing them silently inverts a debt.

- `memberChip` now sets `role="radio"` and `aria-checked` at build time —
  `js/ui.js:165`.
- `#e-payer` (`index.html:353`), `#p-from` (`index.html:385`) and
  `#p-to` (`index.html:387`) are `role="radiogroup"` with an `aria-label`
  repeating the visible label word for word.
- `syncSegState` re-derives the state whenever a class flips, so a tap
  re-announces without every call site remembering — `js/ui.js:154`.

The decision of *what* ARIA a chip gets is written once, in `segAria`
(`js/ui.js:142`), and read from both directions. It used to live in
`js/app.js`; a build-time copy and an observer copy of the same rule is
the shape of every bug this project has shipped.

### The "+ Add" chip was about to become a fourth person

`syncSegState` marks every `button` under a group, and `#e-payer` ends
with a chip that opens the add-member dialog (`js/app.js:3786`). Marked as
a radio, it is announced as a selectable payer named "+ Add" — a new bug
created by the fix for the old one. `segAria` returns `null` for
`.member-chip.add`, and a test holds that shut.

### Choosing a payer threw the reader out of the sheet

The fix above says which chip is selected. It did not survive the tap that
selects it.

Every one of these rows is rebuilt wholesale when you pick something in
it — `payer.innerHTML = ""`, then a fresh chip per member — so the button
the user just activated no longer exists and the browser resets focus to
`<body>`. Measured in Chromium at 390×812: `BUTTON "Bo"` before, `BODY`
after, for `#e-payer`, `#etype-row`, `#p-from`, `#p-to` and the
equal-split include checkbox alike. `#e-split-mode` toggles classes
instead of rebuilding and focus stays put, which is what proves the
rebuild is the cause rather than the platform.

Two things follow, and the second is the worse one. The
`aria-checked="true"` that just became true is written onto a brand-new
node while the reader's cursor is on a node that has been deleted, so the
one thing the row exists to say is the one thing not said at the moment it
changes. And `<body>` is outside the open `<dialog>`: the cursor leaves
the expense sheet entirely, and 13 of the sheet's 23 focusable controls
sit ahead of the first payer chip. Recording one settle-up ejects the
person twice, once for From and once for To.

- `preservingFocus` (`js/a11y.js`) runs the repaint and puts focus back on
  the control that had it, matched by `id` or by the `data-*` attribute
  that names what it does — never by position.
- It wraps the *repaint*, not the click handlers. `renderExpenseForm` and
  `renderPaymentSheet` are now one line each and `paintExpenseForm` /
  `paintPaymentSheet` are unreachable except through them, held by a test,
  because restoring focus at the four handlers would be the same rule in
  four places.
- A repaint that did not disturb focus is left alone — this runs on every
  keystroke in the name and amount fields, and re-focusing a text field
  mid-word moves the caret. A control with no replacement (a member
  removed on the other phone) is left alone too: landing the reader
  silently on a *different* person, in the row that decides who paid, is
  worse than landing them nowhere.

### The 100x warning was visible only — and then it was too loud

The decimal-slip guard is the one thing standing between a typo and
`250000` being written into a shared ledger and snapshotted at save. It
was a plain `<div>` with text poked into it, so it existed only for people
looking at the screen — including a sighted user with a screen reader on.

It was first fixed with `role="alert"`, and that made the field it guards
unusable. `role="alert"` is `aria-live="assertive"` plus
`aria-atomic="true"`: every rendering *interrupts* whatever the reader is
currently saying, which while typing into an amount field is the echo of
the digit just pressed. Measured in Chromium: typing `250000` one key at a
time, 120 ms apart, produced four separate interruptions — "did you mean
25.00?", then 250.00, then 2,500.00, then 25,000.00 — of which only the
last was true. A blind user could not hear the digits they were entering,
and heard three contradictory suggestions before the right one.

So the guard is now polite, and it waits:

- `#e-slip` (`index.html:342`) and `#slip-warn` (`index.html:118`), the
  converter's copy of the same guard, are `aria-live="polite"
  aria-atomic="true"`. Polite so it can never talk over a keystroke;
  atomic so the sentence is read whole, which is what `role="alert"` was
  giving for free.
- Both are written through `slipAnnouncer` (`js/a11y.js`), which shows a
  warning only once the amount has stopped changing and clears one
  immediately. Nobody needs to hear that a warning went away, and a
  warning is only worth hearing about the number actually in the field.
  Six keystrokes now produce one announcement instead of four; typing past
  the threshold and backspacing under it again produces none at all.
- `#e-home-preview` (`index.html:339`) is `aria-live="polite"`. It carries
  the *"≈ … at today's rate — locked in when you save"* line, which is the
  other half of the same money check.

A live region only speaks if the node the reader is watching stays put, so
a test also pins that `js/app.js` writes all three via `textContent` and
never rebuilds them from HTML.

### Every sheet opened focused on the way out of itself

`dialog.showModal()` focuses the first focusable element inside the
dialog, and `addSheetCloseButtons` prepended the ✕ to every
`dialog.sheet` — so the first focusable element of all twelve sheets was
the close button. Measured in Chromium at 375×812: opening Profile left
`document.activeElement` on `.sheet-close`. A screen reader announces the
focused element, so the app's answer to "open Profile" was **"Close,
button"** — the exit named before the sheet. On iOS it is also visible:
WebKit draws a focus ring around whatever the app focuses, which is what
the report came in as. (Chromium does not.)

Suppressing the ring would have been the wrong fix twice over — it was
tried once before, made the app unusable by keyboard, and had to be
reverted (`styles.css:1001`) — and it would have left the announcement
exactly as wrong.

- Every sheet now has an `<h2 id="…" tabindex="-1">`, the `<dialog>`
  carries `aria-labelledby` pointing at it, and the sheet opens with
  focus on that heading. `tabindex="-1"` so it is focusable
  programmatically without becoming a tab stop.
- Where focus starts is a decision, so it is `initialFocus`
  (`js/a11y.js`), one table of dialog id → title id. `openSheet`
  (`js/app.js`) is the only caller of `showModal()` in the app; there
  were fourteen call sites before, which was fourteen places for this fix
  to be missing from, and a test counts them.
- A sheet that exists to collect one thing still starts on that thing: a
  brand-new expense opens on `#e-name`, a new trip on `#editor-name`, and
  "+ Add"/"+ Members" on `#m-name`. Opening the *same* member sheet from
  "Share trip" — where nobody pressed add — opens on the title.
- The ✕ is now inserted after the heading rather than prepended, so one
  Tab from the opened sheet reaches it. Measured: a real Tab from
  `#settings-title` lands on the close button.
- Measured after the fix, all twelve sheets driven through their real
  controls at 375×812 in Chromium: focus lands on the sheet's own heading
  (or its explicit field) every time, and on `.sheet-close` never. A real
  tap leaves the heading `:focus-visible === false` there, so no ring
  appears where the ✕ used to have one; the keyboard route does draw it.
- **WebKit does not behave that way, and the first version of this note
  said it did.** Measured on WebKit at 390×844: a real touch tap on
  `#profile-btn` leaves `#settings-title` `:focus-visible === true` with
  the 3px ring. It is not about headings or about `showModal()` — WebKit
  answers `:focus-visible === true` for *anything* the app focuses,
  including a plain `<button>`, and moving the `focus()` out of the
  gesture task (`setTimeout`, `requestAnimationFrame`) changes nothing.
  So on an iPhone the ring is moved to the heading rather than removed,
  and the only lever left is the shape of the box it is drawn around,
  because hiding it needs the `outline: none` that is forbidden above.
- **So the heading's box must not contain the ✕.** `.sheet-close` is
  positioned against the dialog; the heading used to reserve its 44px as
  `padding-right`, which is room *inside* the heading's own box — the
  ring ran the full width of the sheet with the close button inside it,
  which reads as "the ✕ is selected". The room is now kept outside the
  box (`max-width: calc(100% - 44px)`) and the box shrinks to the words
  (`align-self: flex-start`; the heading is a flex item of the dialog and
  would otherwise stretch). Measured on WebKit at 390×844, all twelve
  sheets: no title box, plus its 2px outline offset, reaches the close
  button — and a title too long for one line still wraps rather than
  running under it. `tests/a11y.test.mjs` asserts the two rules against
  each other, so widening the ✕ fails until the reserved room grows too.

### Selection was carried by colour alone

`.member-chip.on` (`styles.css:1491`) differed from `.member-chip` in
`background`, `border-color` and `color` and nothing else — WCAG 1.4.1. It
now also draws a 2px inset ring, so "chosen" survives greyscale and
colour-blindness. A ring rather than a leading ✓ because a checkmark
widens the chip and reflows the whole row every time the selection moves.

---

## Not fixed, and why

Ordered by how much they cost the person hitting them.

| # | Finding | Where | Why it is still open |
|---|---|---|---|
| 1 | The radiogroups have no arrow-key navigation and no roving `tabindex`. The ARIA radiogroup pattern expects ← → to move the selection and the group to be one tab stop. | `index.html:112, 225, 331, 353, 355, 385, 387, 460`; `js/ui.js:142` | Every chip is individually focusable and activates with Enter or Space, so the control is fully keyboard-operable (WCAG 2.1.1 holds) — what is missing is the *expected* pattern, which a screen-reader user may wait for. Fixing it changes interaction for everyone and needs testing on a real screen reader, not a stub. |
| 2 | The split validity note ("Adds up to 87% — needs 100%") is not a live region. | `index.html:360`, written at `js/app.js:3857` and again at `js/app.js:4896` | Deliberate for now: the Save button states the same blocker in its own label, and the person is actively editing the field the note is about. Also see the note below — this text is currently written in two places, and making it a live region should wait until it is written in one. |
| 3 | The payment sheet's rate note has the same shape. | `index.html:393` | Same reasoning. It is confirmation, not a warning. |
| 4 | A single global `keydown` handler decides what Enter means, by field id, far away from any of those fields. | `js/app.js:4558` | Two independent reads flagged this. It is a behaviour change across every input in the app; it needs its own story so it can be tested properly. |
| 5 | `#trip-search` has a placeholder and no label. | `index.html:100` | A placeholder is not an accessible name and vanishes on first keystroke. One attribute, but it belongs with a sweep of the remaining label gaps rather than in a fix to the expense sheet. |
| 6 | The tabs are a `tablist` whose panels are not `tabpanel`s and are not referenced by `aria-controls`. | `index.html:112` (tabs), `116` and `135` (panels) | Half a pattern. Completing it is small, but the panels are reparented at runtime into the open trip card, so the ids need checking against that first. |
| 7 | "Has the trip on their own phone" is carried only by a `title` tooltip on a member chip. | `js/app.js:3295` | A `title` is not announced reliably and cannot be reached by touch at all, so this information is invisible to most people already. It needs a visible affordance — a design decision, not an attribute. |
| 8 | On WebKit a finger tap still leaves a focus ring around the sheet's heading, because WebKit reports `:focus-visible === true` for anything the app focuses. | `styles.css:1001` (the ring), `js/app.js` `openSheet` | Accepted, not unnoticed. The ring now hugs the words and cannot reach the ✕, so it reads as "this sheet is called Profile" rather than "the ✕ is selected". Removing it entirely means the app deciding for itself which input moved focus and suppressing the ring for a finger — an `outline: none` that this project has reverted once and now guards with a test, and a rule that would have to cover *every* programmatic `focus()` in the app (`preservingFocus` re-focuses chips the same way), not just the twelve sheets. That is its own story. |

---

## Checked and found to be fine

Recorded so the next reader does not spend the afternoon re-checking:

- Focus styles exist and are correct: a 3px `:focus-visible` outline, and
  `outline: none` for `:focus:not(:focus-visible)`. Keyboard users get a
  ring; mouse users do not.
  **Focusing an amount paints TWO indicators — the row's and the input's
  own — and since the v1.77.0 revert that is the shipped behaviour again.** v1.76.0
  suppressed the inner one with
  `.field:has(input:focus-visible) input:focus-visible`, nested inside the
  same `:has()` so a browser that could not match the selector could not
  match the suppression either and kept some indicator on the app's primary
  control. That rule and `tests/focus.test.mjs` both went out with v1.77.0's
  revert. The doubled ring is PB-27 in the product backlog, still open, and
  the owner has questioned the premise: if the row can only ever hold one
  focusable thing, the row-level indicator may be redundant rather than
  merely doubled.
- Native `<dialog>` returns focus to the element that opened it when it
  closes, so nothing needs to track the opener.
- Split rows are labelled: the equal-split checkbox has a real `<label for>`
  covering the whole 44px row, and the percent/shares inputs carry an
  `aria-label` naming the person — `js/app.js:3840` and `js/app.js:3848`.
- Icon-only controls in the header (scan, notifications, profile, the
  search clear button) all have `aria-label`s.
- Decorative SVG is `aria-hidden="true"` throughout.
- Touch targets: `.member-chip`, `.type-chip` and `.f-chip` are pinned to a
  44px minimum — `styles.css:939`.
- `#toast` is `role="status" aria-live="polite"` and always has been.
- `@media (prefers-reduced-motion: reduce)` is honoured — `styles.css:1977`.

---

## Not verified by anyone

Stated plainly rather than assumed, because an untested claim about
accessibility is worse than no claim:

- **Real screen-reader behaviour.** Everything above is reasoned from the
  markup and exercised against a stub DOM and a browser. Nobody has driven
  this app with VoiceOver on an iPhone or TalkBack on Android.
- **Colour contrast ratios.** No numbers have been measured, in either
  theme. `.hint` text on card backgrounds is the first thing to check.
- **Reflow and zoom at 200%**, and behaviour at the largest system text
  size — the sheets are height-constrained and this has not been tried.
- **Whether a polite live region that goes from `hidden` to visible is
  announced on every combination** of browser and screen reader. It is the
  documented behaviour; what has been observed here is only that the node
  is written once, in place, with the right attributes on it.
- **The 500 ms settle delay**, which is a guess at "the amount has stopped
  changing" and has never been tried by anyone typing with a screen reader
  on. Too short and the warning still arrives mid-number; too long and it
  arrives after the person has moved to the split rows. It is one constant,
  `SETTLE_MS` in `js/a11y.js`.

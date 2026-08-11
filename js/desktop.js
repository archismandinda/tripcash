// What changes when the pointer is not a finger.
//
// Three defects share one cause, so they share one module. A mouse drag
// left across a trip name — which on a laptop is what SELECTING THE TEXT
// looks like — passed the swipe threshold and archived the trip. A click
// on the backdrop, which is most of a desktop window, threw away a
// half-typed expense without asking, and Esc did the same by another
// door. And a single global Enter handler blurred every field, so Enter
// never signed anybody in and never saved anything.
//
// Each of those is a decision about an input device or about whether a
// sheet is holding work. None of them is rendering, so none of them
// belongs in app.js.

// Does a gesture that means something with a finger mean the same thing
// with THIS pointer?
//
// Only a mouse is refused, and everything else is allowed deliberately.
// "" and undefined are what older browsers and synthesised events send;
// refusing those would kill swipe-to-archive on the phones the gesture
// exists for, which is exactly the shape of the touch-action failure
// this project has already shipped once.
export function gestureAllowed({ pointerType } = {}) {
  return pointerType !== "mouse";
}

// ---------- is this sheet holding work? ----------

const text = (v) => (v == null ? "" : String(v).trim());

// Key order is not part of the value. Two clones of the same member row
// can serialise differently, and an unstable comparison here reads as
// "you have unsaved changes" on a sheet nobody touched.
const canon = (v) =>
  JSON.stringify(v, (_k, x) =>
    x && typeof x === "object" && !Array.isArray(x)
      ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => (a < b ? -1 : 1)))
      : x);

const same = (a, b) => canon(a ?? null) === canon(b ?? null);

// Every field the expense sheet collects, and how a change to it is
// recognised. It is a LIST rather than nine hand-written comparisons
// because the four-field version of this was the bug: app.js projected
// four fields, this asked about the same four, and the other five —
// among them who paid and how it was split — could be changed and then
// thrown away on a backdrop click without a word. A field that exists in
// one side's idea of "the sheet" and not the other's is a field nobody
// is defending; tests/desktop.test.mjs compares the two key sets so it
// cannot happen again silently.
//
// The comparison differs by field because the values are different kinds
// of thing, not because the fields are special: text is trimmed (leading
// spaces are not an edit, and the amount comes back as the number it
// parsed to), the split is canonicalised (adding a member re-emits
// `parts` in a new key order, which is not a change), and the receipt is
// a buffered intent whose only state is whether there is one.
export const EXPENSE_FIELDS = {
  type: text,
  name: text,
  description: text,
  amount: text,
  code: text,
  paidBy: text,
  when: text,
  split: canon,
  receipt: Boolean,
};

// Would closing this sheet right now lose something the person typed?
//
// Only the two sheets that hold typed work answer yes. Everything else —
// the summary, the scanner, settings, the receipt viewer — shows things
// rather than collecting them, and a sheet that asks "discard?" when
// there is nothing to discard trains people to click through the one
// time it matters.
//
// Both branches answer "does this differ from what the sheet opened
// with?", never "does this have anything in it?". The difference is the
// whole bug: an expense opened to be READ arrives with a name, an amount
// and often a receipt already in place, so "has content" called an
// untouched sheet dirty and asked to throw away an expense that was
// already saved — beside a Delete button, which is not a question anyone
// should have to parse to close a sheet they only opened to look at.
//
// `opened` is what the sheet SHOWED when it opened, which is not always
// what the stored record held: a brand-new trip opens with you already
// in the member list, and comparing against the stored trip (which has
// nobody in it yet) would call an untouched sheet dirty the other way.
// A missing `opened` therefore means "it opened blank", which is the
// safe reading for a sheet that is collecting something new.
export function unsavedIn({ dialogId = "", expense, editor } = {}) {
  if (dialogId === "expense-sheet") {
    const e = expense ?? {};
    const was = e.opened ?? {};
    // `?? null` so a field the sheet has not filled in reads the same
    // whichever way it is absent — undefined on a fresh sheet, null on a
    // cleared one.
    return Object.entries(EXPENSE_FIELDS)
      .some(([f, as]) => as(e[f] ?? null) !== as(was[f] ?? null));
  }
  if (dialogId === "editor-sheet") {
    const e = editor ?? {};
    const was = e.opened ?? {};
    return (
      (e.name ?? "").trim() !== (was.name ?? "").trim() ||
      !same(e.currencies ?? [], was.currencies ?? []) ||
      !same(e.members ?? [], was.members ?? [])
    );
  }
  return false;
}

// What to call the work that is about to be lost. It lives beside
// unsavedIn deliberately: the sheets that can be dirty and the sentence
// describing what "dirty" means for each are one decision, and splitting
// them across two files is how a third sheet gets a confirmation with
// nothing in it.
const DISCARD = {
  "expense-sheet": {
    title: "Throw this expense away?",
    body: "You've started filling it in. Closing now loses what you typed, and any receipt you attached.",
  },
  "editor-sheet": {
    title: "Throw these changes away?",
    body: "This trip has changes that haven't been saved. Closing now loses them.",
  },
};

export function discardWording(dialogId = "") {
  return DISCARD[dialogId] ?? {
    title: "Throw this away?",
    body: "Closing now loses what you typed.",
  };
}

// ---------- how a sheet is allowed to go away ----------

// The three ways a sheet closes by ACCIDENT. Everything else — the sheet's
// own Close button, Save, Cancel — is a deliberate press on a labelled
// control, and asking "are you sure?" after somebody says "close this"
// is the noise that makes the real question invisible.
const ACCIDENTAL = new Set(["backdrop", "escape", "pull"]);

export function onDismiss({ dirty = false, how = "" } = {}) {
  return dirty && ACCIDENTAL.has(how) ? "confirm" : "close";
}

// Is this point off the sheet? A missing rect is not evidence of
// anything, so it answers no — the cost of a wrong yes is somebody's
// half-typed trip.
export function outsideSheet({ clientX = 0, clientY = 0 } = {}, rect = null) {
  if (!rect) return false;
  return clientX < rect.left || clientX > rect.right
    || clientY < rect.top || clientY > rect.bottom;
}

// Was that a tap on the backdrop, or a tap on a sheet that moved?
//
// A modal dialog's backdrop is not an element, so the only thing telling
// the two apart is where the point is relative to the sheet's rect — and
// the rect is read when the CLICK arrives, which is not when the finger
// landed. A sheet can change size in between: the trip editor collapses
// from a full-height currency layer back to an 88dvh sheet on the blur
// that the tap itself causes, an 80px jump on an iPhone SE. A tap on the
// layer's own title was therefore measured against a sheet that had
// moved out from under it, and one tap threw a half-built trip away.
//
// So a dismissal takes both ends of the gesture. `downOutside` is the
// half a re-render cannot revise, and it is required, not merely
// preferred: no pointer, no dismissal. That also settles the synthesised
// click — (0,0) is outside every sheet, and being outside is no longer
// enough on its own.
export function backdropDismiss({ onDialog = false, downOutside = false, upOutside = false } = {}) {
  return onDialog && downOutside && upOutside;
}

// ---------- what Enter means in a given field ----------
//
// One handler used to call preventDefault() on Enter in every input and
// then blur, so on a laptop Enter did nothing anywhere: not in the
// password field, not in the amount field, not in the payment sheet.
//
// `button` is the id of the control Enter stands in for. It is written
// here rather than found in the DOM because it cannot be derived: the
// settings sheet holds three `.primary` buttons and only one of them is
// what Enter in the password field means.
const SIGN_IN_BUTTONS = new Map([
  ["signin", "email-signin"],
  ["create", "email-create"],
]);

// Which of those two the email form should be set to when it opens.
//
// `settings.syncHint` means "this device has wanted to sync": it is set
// when a sign-in begins and cleared on sign-out. It is not proof of an
// account — nothing on the device is — but it is the only honest signal
// that somebody has been here before, and it is a better guess than
// asking every returning user to create the account they already have.
export function signInDefaultMode({ syncHint = false } = {}) {
  return syncHint ? "signin" : "create";
}

const ENTER = {
  // Done in a member-name field means "add this person", not "hide the
  // keyboard" — the field is filled repeatedly and clears itself.
  "editor-member-name": { action: "add-member" },
  "m-name": { action: "add-member" },
  // The email form does two different jobs with the same two fields, so
  // its Enter cannot be a constant. It was one — #email-create for both
  // fields — which is how somebody who already had an account, typing
  // their password and pressing Enter, was told their own email address
  // is already in use, with "I already have one" sitting on screen
  // unreached. `byMode` is a Map so an unknown mode is unknown rather
  // than something inherited from Object.prototype.
  "sync-email-input": { action: "primary", button: "email-create", byMode: SIGN_IN_BUTTONS },
  "sync-pass": { action: "primary", button: "email-create", byMode: SIGN_IN_BUTTONS },
  "e-name": { action: "primary", button: "e-save" },
  "e-amount": { action: "primary", button: "e-save" },
  "p-amount": { action: "primary", button: "p-save" },
  // A search field filters as you type; there is nothing to submit, so
  // Enter means "I'm done typing, give me the screen back".
  "trip-search": { action: "blur" },
  "editor-search": { action: "blur" },
};

// Anything not named here blurs, which is what every field did before —
// the safe answer for a field whose Enter nobody has thought about.
export function enterAction({ inputId = "" } = {}) {
  return ENTER[inputId]?.action ?? "blur";
}

// The button a 'primary' stands in for, or null. The caller must still
// check that it is enabled: #e-save is disabled whenever the expense is
// incomplete and its LABEL is then the reason, so firing it from Enter
// would be a button that silently does nothing.
//
// `mode` is for a field that stands in front of more than one action.
// An unrecognised or absent mode falls back to the field's single
// answer, which is what every caller written before modes existed gets:
// a keypress that does what it did yesterday, never one that does
// nothing.
export function enterButton({ inputId = "", mode = "" } = {}) {
  const entry = ENTER[inputId];
  if (!entry) return null;
  return entry.byMode?.get(mode) ?? entry.button ?? null;
}

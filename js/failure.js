// One place where a failure becomes a sentence somebody can act on.
//
// This app already speaks up about most of what goes wrong — receipts,
// sign-in, the scanner, the sync loop, the payment sheet. What it did
// not have was a RULE. Every catch in app.js was decided by hand, one at
// a time, so the ones nobody got round to are exactly the ones nobody
// hears about: `sendInvite` toasted a refused invite write while
// `inviteEveryone`, catching the identical failure, finished its whole
// run without saying anything at all. One rule, two call sites, drifted
// apart — the shape behind ADR-0014 through ADR-0019.
//
// The wording is keyed by the OPERATION, not by the error, because what
// somebody has to do next follows from what they were trying to do, not
// from which code Firebase returned. An op this module has never heard
// of returns null, so a typo is a loud missing sentence rather than a
// quiet wrong one.
//
// Three rules for anything added here:
//
//  1. Name it in the person's terms. They were inviting Bo; they were
//     not "writing to the invite index".
//  2. Put the next step in the same sentence. "Something went wrong" is
//     what leaves somebody believing an invitation went out.
//  3. Offline is a state, not an error. It has a different next step, so
//     it gets its own wording — and `unavailable` (the backend could not
//     be reached) and `navigator.onLine === false` are the same state
//     seen from two sides, so they must reach the same words.

const SENTENCES = {
  // A refused or undelivered invite write. In every case that reaches
  // here the trip document itself was pushed first, so the trip already
  // carries the invitation and the invite link genuinely still works —
  // only the automatic discovery half failed.
  invite: {
    say: "That invitation didn't go out on its own — send them the invite link and they can still open the trip.",
    offline: "You're offline, so that invitation hasn't gone out — send them the invite link and they can still open the trip.",
    byCode: {
      "permission-denied": "The database turned that invitation down — send them the invite link and they can still open the trip.",
    },
  },
  // crypto.subtle is missing, so the invite index key cannot be hashed.
  // That is an insecure origin or a locked-down WebView, never something
  // retrying will fix — but the link path does not need it.
  "invite-key": {
    say: "This browser can't prepare invitations — send them the invite link instead and they can still open the trip.",
  },
  // The offline promise on the tin, quietly not applying. Somebody who
  // is told nothing finds out on the plane.
  "service-worker": {
    say: "TripCash couldn't finish setting itself up to work offline — reload it once while you still have signal.",
    offline: "TripCash couldn't set itself up to work offline — open it once more when you have signal, before you need it without.",
  },
  // The Firestore listener never attached, so the other phone's changes
  // will not arrive on their own. A standing condition: the sync note,
  // not a toast.
  "live-updates": {
    say: "Changes from your other devices won't arrive on their own — use Sync now to fetch them.",
    offline: "You're offline, so changes from your other devices won't arrive until you're back on signal.",
  },
};

// Every operation that can be reported. Exported so a test can walk the
// list rather than trusting that each was remembered.
export const OPS = Object.freeze(Object.keys(SENTENCES));

export function failureSentence({ op, code, online = true } = {}) {
  const entry = SENTENCES[op];
  if (!entry) return null;
  if (online === false || code === "unavailable") return entry.offline ?? entry.say;
  return entry.byCode?.[code] ?? entry.say;
}

// "Bo", "Bo and Priya", "Bo, Priya and Rahul".
const nameList = (names) =>
  names.length < 2
    ? (names[0] ?? "")
    : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;

// What a whole RUN of invitations says when it finishes.
//
// Saving a trip invites everybody on it who has an address, so one run
// can both succeed and fail. It used to speak once per person, and
// ui.js paints every toast into a single `#toast` element (`el.textContent
// = msg`) — so the last call wins. A run where Bo was refused and Priya
// went through therefore ended showing "Priya can now open “Goa”", with
// Bo's refusal erased by it. That is worse than the all-failed case:
// a visible success reads as confirmation, so the person closes the
// sheet believing both invitations went out, while Bo has none.
//
// So a run speaks ONCE, and that one sentence covers everybody in it.
// Three rules:
//
//  1. Failures first. They are the half with something left to do.
//  2. Identical failures are one explanation carrying several names, not
//     the same anonymous sentence several times.
//  3. Name who failed as soon as the run touched more than one person.
//     Five refusals used to read as five copies of "That invitation…",
//     so even an all-failed run left nobody knowing which invitation to
//     chase. A run of one needs no name — "that invitation" is the one
//     they just made.
//
// Returns null when there is genuinely nothing to say, so a caller can
// stay quiet without deciding what quiet means.
export function inviteRunSentence({ tripName = "", sent = [], failed = [] } = {}) {
  const named = sent.length + failed.length > 1;
  const parts = [];
  const groups = new Map();
  for (const fault of failed) {
    const say = failureSentence(fault);
    // No sentence means an op this module has never heard of, i.e. a
    // typo — loud in the console, never a quiet wrong sentence here.
    if (!say) continue;
    groups.set(say, [...(groups.get(say) ?? []), fault.name].filter(Boolean));
  }
  for (const [say, who] of groups) {
    parts.push(named && who.length ? `${say} Not invited yet: ${nameList(who)}.` : say);
  }
  if (sent.length) {
    parts.push(sent.length === 1
      ? `${sent[0]} can now open “${tripName}”`
      : `${sent.length} people can now open “${tripName}”`);
  }
  return parts.length ? parts.join(" ") : null;
}

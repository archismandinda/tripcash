// The in-app notification list (phase D5). Pure — no DOM, no storage.
//
// Push is the unreliable half of "tell me what happened": iOS delivers it
// only to an installed PWA, permission can be declined, and a phone can
// be offline for a day. This list is the reliable half. Every event is
// recorded here when the app next syncs, whether or not a push arrived —
// so "somebody added me to a trip" is answerable by opening the app,
// which is the one thing a user can always do.

// Notices that belong to the account rather than any one trip.
export const ACCOUNT_SCOPE = "__account";

export const NOTICE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // a month is plenty
const MAX = 100;

// Same event from two sources — a push AND the sync that follows it —
// must not appear twice. The key is what happened, not when we heard.
export const noticeKey = (n) => `${n.kind}:${n.tripId}:${n.ref ?? ""}`;

export function addNotices(existing = [], incoming = [], now = Date.now()) {
  const out = [...existing];
  const seen = new Set(existing.map(noticeKey));
  for (const n of incoming) {
    if (!n?.kind || !n?.tripId) continue;
    const notice = { read: false, at: now, ...n };
    const key = noticeKey(notice);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(notice);
  }
  // Newest first, capped, and old ones dropped — this is a notification
  // list, not an audit log.
  return out
    .filter((n) => now - (n.at ?? 0) < NOTICE_TTL_MS)
    .sort((a, b) => (b.at ?? 0) - (a.at ?? 0))
    .slice(0, MAX);
}

export const unreadCount = (notices = []) => notices.filter((n) => !n.read).length;

export const markAllRead = (notices = []) => notices.map((n) => ({ ...n, read: true }));

export const markRead = (notices = [], key) =>
  notices.map((n) => (noticeKey(n) === key ? { ...n, read: true } : n));

// Notices for a trip that no longer exists are noise — tapping them can
// only disappoint.
export const pruneNotices = (notices = [], tripIds = []) => {
  const live = new Set(tripIds);
  // Account-level notices ("verify your email") belong to no trip and
  // must survive.
  return notices.filter((n) => n.tripId === ACCOUNT_SCOPE || live.has(n.tripId));
};

// Which screen a notice belongs to. Everything about a trip opens that
// trip; anything about the account opens Settings.
export const noticeTarget = (n) =>
  n?.tripId === ACCOUNT_SCOPE ? { screen: "settings" } : { screen: "trip", tripId: n?.tripId };

// Who did it, in a form worth reading. Members carry names; a bare uid
// never belongs on screen.
function actorName(members = [], { uid, memberId } = {}) {
  const hit = members.find((m) => (uid && m.uid === uid) || (memberId && m.id === memberId));
  const name = hit?.name?.trim();
  return name && name !== "You" ? name : "Someone";
}

// What changed for THIS person between two views of a trip. Runs on the
// device, from data it already has, so it needs no server and no
// permission — and it produces better sentences than the push can,
// because the device knows who everyone is.
export function diffTrip({ tripId, tripName, before, after, selfId, money }) {
  const out = [];
  const members = after?.trip?.members ?? [];
  const amount = (e) => (money ? money(e) : "");

  const knew = new Set((before?.expenses ?? []).map((e) => e?.id));
  for (const e of after?.expenses ?? []) {
    if (!e?.id || knew.has(e.id)) continue;
    if (e.paidBy && e.paidBy === selfId) continue; // your own spending isn't news
    const who = actorName(members, { memberId: e.paidBy });
    const cost = amount(e);
    out.push({ kind: "expense", tripId, tripName, ref: e.id,
      text: `${who} added ${e.name || "an expense"}${cost ? ` · ${cost}` : ""} to ${tripName}` });
  }

  const hadPays = new Set((before?.settlements ?? []).map((p) => p?.id));
  for (const p of after?.settlements ?? []) {
    if (!p?.id || hadPays.has(p.id)) continue;
    if (p.from === selfId) continue;
    const from = actorName(members, { memberId: p.from });
    const to = p.to === selfId ? "you" : actorName(members, { memberId: p.to });
    out.push({ kind: "payment", tripId, tripName, ref: p.id,
      text: `${from} recorded a payment to ${to} in ${tripName}` });
  }

  // Someone new on a trip you are already on.
  const had = new Set((before?.trip?.members ?? []).map((m) => m?.id));
  if (had.size) {
    for (const m of members) {
      if (!m?.id || had.has(m.id) || m.id === selfId) continue;
      out.push({ kind: "member", tripId, tripName, ref: m.id,
        text: `${m.name || "Someone"} was added to ${tripName}` });
    }
  }
  return out;
}

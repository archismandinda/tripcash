// The in-app notification list (phase D5). Pure — no DOM, no storage.
//
// Push is the unreliable half of "tell me what happened": iOS delivers it
// only to an installed PWA, permission can be declined, and a phone can
// be offline for a day. This list is the reliable half. Every event is
// recorded here when the app next syncs, whether or not a push arrived —
// so "somebody added me to a trip" is answerable by opening the app,
// which is the one thing a user can always do.

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
  return notices.filter((n) => live.has(n.tripId));
};

// What changed for THIS person between two views of a trip. Runs on the
// device, from data it already has, so it needs no server and no
// permission — and it produces the same sentences the push does.
export function diffTrip({ tripId, tripName, before, after, selfId }) {
  const out = [];
  const knew = new Set((before?.expenses ?? []).map((e) => e?.id));
  for (const e of after?.expenses ?? []) {
    if (!e?.id || knew.has(e.id)) continue;
    // Your own spending is not news to you.
    if (e.paidBy && e.paidBy === selfId) continue;
    out.push({ kind: "expense", tripId, tripName, ref: e.id,
      text: `${e.name || "New expense"} was added to ${tripName}` });
  }
  const hadPays = new Set((before?.settlements ?? []).map((p) => p?.id));
  for (const p of after?.settlements ?? []) {
    if (!p?.id || hadPays.has(p.id)) continue;
    if (p.from === selfId) continue;
    out.push({ kind: "payment", tripId, tripName, ref: p.id,
      text: `A payment was recorded in ${tripName}` });
  }
  return out;
}

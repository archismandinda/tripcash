// What a trip change is worth saying, if anything. Pure — no Firebase,
// no network — so the decision "is this worth interrupting someone for?"
// is unit-tested like every other rule in this project.
//
// CommonJS because it runs inside the Cloud Function; the tests reach it
// through createRequire.

const byId = (list = []) => new Map(list.filter((r) => r && r.id).map((r) => [r.id, r]));

// Amounts are stored as typed, in the expense's own currency — the one
// the person actually paid in and will recognise on a lock screen.
function formatMoney(amount, code) {
  if (!Number.isFinite(amount) || !code) return "";
  try {
    return new Intl.NumberFormat("en", {
      style: "currency", currency: code, maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${Math.round(amount)} ${code}`; // not a real ISO code
  }
}

// Returns { body } or null. Null means stay silent.
//
// Only genuinely NEW things qualify. An edit to an existing expense, a
// rename, a reorder, a member's phone number being filled in — none of
// that is worth a buzz, and a notification you didn't need is how people
// end up turning notifications off entirely.
function describe(before, after) {
  if (!after || after.deleted) return null;

  const knew = byId(before?.expenses);
  const fresh = (after.expenses ?? []).filter((e) => e && e.id && !knew.has(e.id));
  if (fresh.length === 1) {
    const e = fresh[0];
    const money = formatMoney(e.amount, e.code);
    const name = e.name || "New expense";
    return { body: money ? `${name} · ${money}` : name };
  }
  if (fresh.length > 1) return { body: `${fresh.length} new expenses` };

  // Money actually moving beats housekeeping.
  const hadPays = byId(before?.settlements);
  const newPays = (after.settlements ?? []).filter((p) => p && p.id && !hadPays.has(p.id));
  if (newPays.length) {
    return { body: newPays.length === 1 ? "A payment was recorded" : `${newPays.length} payments recorded` };
  }

  // Someone joining is worth knowing; a name being tidied is not.
  const was = (before?.trip?.members ?? []).length;
  const now = (after.trip?.members ?? []).length;
  if (now > was) return { body: was ? "Someone was added to the trip" : "You were added to a trip" };

  return null;
}

module.exports = { describe, formatMoney };

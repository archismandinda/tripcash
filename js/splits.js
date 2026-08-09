// Expense-splitting math: shares, balances, settle-up, and spending cuts.
// Pure functions over plain data — no DOM, no storage, fully unit-tested.
//
// An expense: { id, tripId, type, name, amount, code, homeValue, paidBy,
//               split: { mode: "equal"|"percent"|"shares",
//                        parts: { [memberId]: weight } }, createdAt }
// homeValue is the home-currency snapshot taken when the expense was saved,
// so debts never drift when exchange rates move.

const EPS = 0.01;

// Below this, a transfer isn't worth making — settle-up was emitting
// rows like "Archisman → Bo ₹1.49 · Mark paid". Rounding residue and
// genuinely trivial debts look identical to the person holding the
// phone, and neither is worth a bank transfer.
const MIN_TRANSFER = 1;

// Total weight of a split (percent parts should total 100).
const totalParts = (split) =>
  Object.values(split?.parts ?? {}).reduce((a, b) => a + (Number(b) > 0 ? Number(b) : 0), 0);

// Is this split usable? (Save should be gated on this.)
export function splitValid(split) {
  if (!split?.parts) return false;
  const total = totalParts(split);
  if (total <= 0) return false;
  if (split.mode === "percent") return Math.abs(total - 100) < 0.5;
  return true;
}

// Fraction (0..1) of an expense that `memberId` owes.
export function shareFraction(split, memberId) {
  const w = Number(split?.parts?.[memberId]);
  if (!(w > 0)) return 0;
  const total = totalParts(split);
  return total > 0 ? w / total : 0;
}

// Member's owed amount in home currency for one expense.
export const shareOf = (expense, memberId) =>
  expense.homeValue * shareFraction(expense.split, memberId);

// Everyone the books actually reference — the trip's members, plus anyone
// still named by an expense or a payment who is no longer listed.
//
// That gap is reachable: member lists merge as part of the whole trip
// record, so one device can remove someone while the other logs an
// expense they paid for. The removed id then had money moving through it
// that no balance row accounted for, so the nets stopped summing to zero
// and settle-up quietly returned fewer transfers than the trip needed —
// "All settled" while real money was outstanding. A placeholder row is
// ugly; silently losing ₹2,000 is worse.
export function referencedMembers(members = [], expenses = [], payments = []) {
  const known = new Set(members.map((m) => m.id));
  const extra = new Map();
  const note = (id) => {
    if (!id || known.has(id) || extra.has(id)) return;
    extra.set(id, { id, name: "Removed member", missing: true });
  };
  for (const e of expenses) {
    note(e.paidBy);
    for (const [id, w] of Object.entries(e.split?.parts ?? {})) if (Number(w) > 0) note(id);
  }
  for (const p of payments) { note(p.from); note(p.to); }
  return extra.size ? [...members, ...extra.values()] : members;
}

// Split a total into per-member amounts that ACTUALLY ADD UP.
//
// shareOf on its own leaves residue: three ways on 100 gives three
// 33.33s that sum to 99.99, and at 0 decimals a ¥100,000 three-way split
// visibly loses a yen. Largest-remainder allocation hands each leftover
// minor unit to whoever was rounded down hardest, so the column on
// screen sums to the number at the top of it.
export function allocate(total, parts = {}, decimals = 2) {
  const ids = Object.keys(parts).filter((id) => Number(parts[id]) > 0);
  const weight = ids.reduce((t, id) => t + Number(parts[id]), 0);
  if (!ids.length || !(weight > 0) || !Number.isFinite(total)) return {};
  const unit = 10 ** decimals;
  const target = Math.round(total * unit);
  const exact = ids.map((id) => (target * Number(parts[id])) / weight);
  const given = exact.map(Math.floor);
  const short = target - given.reduce((a, b) => a + b, 0);
  const neediest = exact
    .map((v, i) => [v - given[i], i])
    .sort((a, b) => b[0] - a[0]);
  for (let k = 0; k < short; k++) given[neediest[k % neediest.length][1]] += 1;
  return Object.fromEntries(ids.map((id, i) => [id, given[i] / unit]));
}

// Per-member { paid, share, sent, received, net } in home currency.
// net > 0 → is owed money. `payments` are settle-up transfers already made
// ({ from, to, amount }): paying someone back raises your net, receiving
// money lowers yours.
export function tripBalances(expenses, members, payments = []) {
  const out = {};
  // Everyone the books reference, not just everyone currently listed —
  // otherwise the nets don't sum to zero. See referencedMembers.
  const all = referencedMembers(members, expenses, payments);
  for (const m of all) out[m.id] = { paid: 0, share: 0, sent: 0, received: 0, net: 0 };
  for (const e of expenses) {
    if (out[e.paidBy]) out[e.paidBy].paid += e.homeValue;
    for (const m of all) out[m.id].share += shareOf(e, m.id);
  }
  for (const p of payments) {
    if (out[p.from]) out[p.from].sent += p.amount;
    if (out[p.to]) out[p.to].received += p.amount;
  }
  for (const id of Object.keys(out)) {
    out[id].net = out[id].paid - out[id].share + out[id].sent - out[id].received;
  }
  return out;
}

// Turn net balances into few transfers: repeatedly match the largest debtor
// with the largest creditor. N members → at most N−1 transfers.
export function settleUp(balances) {
  const debtors = [];
  const creditors = [];
  for (const [id, b] of Object.entries(balances)) {
    const net = typeof b === "number" ? b : b.net;
    if (net < -EPS) debtors.push({ id, amt: -net });
    else if (net > EPS) creditors.push({ id, amt: net });
  }
  const byAmt = (a, b) => b.amt - a.amt;
  const transfers = [];
  while (debtors.length && creditors.length) {
    debtors.sort(byAmt);
    creditors.sort(byAmt);
    const d = debtors[0];
    const c = creditors[0];
    const pay = Math.min(d.amt, c.amt);
    if (pay >= MIN_TRANSFER) transfers.push({ from: d.id, to: c.id, amount: pay });
    d.amt -= pay;
    c.amt -= pay;
    if (d.amt <= EPS) debtors.shift();
    if (c.amt <= EPS) creditors.shift();
  }
  return transfers;
}

// Spending cuts in home currency: total, by category, by member (their
// share), by as-entered currency, and by day (ISO date of createdAt).
export function expenseCuts(expenses, members) {
  const cuts = { total: 0, count: expenses.length, byType: {}, byMember: {}, byCurrency: {}, byDay: {} };
  const all = referencedMembers(members, expenses);
  for (const m of all) cuts.byMember[m.id] = 0;
  for (const e of expenses) {
    cuts.total += e.homeValue;
    cuts.byType[e.type] = (cuts.byType[e.type] ?? 0) + e.homeValue;
    cuts.byCurrency[e.code] = (cuts.byCurrency[e.code] ?? 0) + e.homeValue;
    // The LOCAL day, not the UTC one. toISOString() filed every expense
    // before 05:30 IST under the previous date, so a late-night bar tab
    // appeared in the "By day" chart on a day its own row disagreed with.
    const day = localDay(e.createdAt);
    cuts.byDay[day] = (cuts.byDay[day] ?? 0) + e.homeValue;
    for (const m of all) cuts.byMember[m.id] += shareOf(e, m.id);
  }
  return cuts;
}

// YYYY-MM-DD in the device's own timezone, so it matches the date the
// expense row prints.
export function localDay(ms) {
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return "";
  const pad = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

// Hand everything one member owns to another, so they can be removed.
//
// Without this, one default split locked a member into the trip forever:
// the only way out was to delete or re-split every expense they touched,
// one at a time. Add someone by mistake, log one lunch, and they were in
// your settle-up for the rest of the trip.
//
// Returns new arrays — nothing is mutated — so the caller can persist
// through the normal save path and get the stamping for free.
export function reassignMember(fromId, toId, expenses = [], settlements = []) {
  if (!fromId || !toId || fromId === toId) return { expenses, settlements, touched: 0 };
  let touched = 0;

  const nextExpenses = expenses.map((e) => {
    const paysNow = e.paidBy === fromId;
    const owesNow = Number(e.split?.parts?.[fromId]) > 0;
    if (!paysNow && !owesNow) return e;
    touched++;
    const parts = { ...(e.split?.parts ?? {}) };
    if (owesNow) {
      // Weights ADD. If both were already in the split, the survivor now
      // carries both shares — which is exactly what "they cover it" means.
      parts[toId] = (Number(parts[toId]) || 0) + Number(parts[fromId]);
      delete parts[fromId];
    }
    return { ...e, paidBy: paysNow ? toId : e.paidBy, split: { ...e.split, parts } };
  });

  const nextSettlements = settlements.flatMap((p) => {
    if (p.from !== fromId && p.to !== fromId) return [p];
    touched++;
    const moved = {
      ...p,
      from: p.from === fromId ? toId : p.from,
      to: p.to === fromId ? toId : p.to,
    };
    // Paying yourself is not a payment. A repayment BETWEEN the two
    // members being merged cancels out entirely.
    return moved.from === moved.to ? [] : [moved];
  });

  return { expenses: nextExpenses, settlements: nextSettlements, touched };
}

// Default split: everyone in, equal weights.
export const equalSplit = (members) => ({
  mode: "equal",
  parts: Object.fromEntries(members.map((m) => [m.id, 1])),
});

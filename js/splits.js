// Expense-splitting math: shares, balances, settle-up, and spending cuts.
// Pure functions over plain data — no DOM, no storage, fully unit-tested.
//
// An expense: { id, tripId, type, name, amount, code, homeValue, paidBy,
//               split: { mode: "equal"|"percent"|"shares",
//                        parts: { [memberId]: weight } }, createdAt }
// homeValue is the home-currency snapshot taken when the expense was saved,
// so debts never drift when exchange rates move.

const EPS = 0.01;

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

// Per-member { paid, share, sent, received, net } in home currency.
// net > 0 → is owed money. `payments` are settle-up transfers already made
// ({ from, to, amount }): paying someone back raises your net, receiving
// money lowers yours.
export function tripBalances(expenses, members, payments = []) {
  const out = {};
  for (const m of members) out[m.id] = { paid: 0, share: 0, sent: 0, received: 0, net: 0 };
  for (const e of expenses) {
    if (out[e.paidBy]) out[e.paidBy].paid += e.homeValue;
    for (const m of members) out[m.id].share += shareOf(e, m.id);
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
    transfers.push({ from: d.id, to: c.id, amount: pay });
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
  for (const m of members) cuts.byMember[m.id] = 0;
  for (const e of expenses) {
    cuts.total += e.homeValue;
    cuts.byType[e.type] = (cuts.byType[e.type] ?? 0) + e.homeValue;
    cuts.byCurrency[e.code] = (cuts.byCurrency[e.code] ?? 0) + e.homeValue;
    const day = new Date(e.createdAt).toISOString().slice(0, 10);
    cuts.byDay[day] = (cuts.byDay[day] ?? 0) + e.homeValue;
    for (const m of members) cuts.byMember[m.id] += shareOf(e, m.id);
  }
  return cuts;
}

// Default split: everyone in, equal weights.
export const equalSplit = (members) => ({
  mode: "equal",
  parts: Object.fromEntries(members.map((m) => [m.id, 1])),
});

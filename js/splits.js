// Expense-splitting math: shares, balances, settle-up, and spending cuts.
// Pure functions over plain data — no DOM, no storage, fully unit-tested.
//
// An expense: { id, tripId, type, name, amount, code, homeValue, paidBy,
//               split: { mode: "equal"|"percent"|"shares",
//                        parts: { [memberId]: weight } }, createdAt }
// homeValue is the home-currency snapshot taken when the expense was saved,
// so debts never drift when exchange rates move.

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
    // An expense whose split names nobody would leave its whole value
    // attributed to no one, so the nets stop cancelling and settle-up
    // under-reports. The UI can't produce one (Save is gated on
    // splitValid), but a record from another client or an older schema
    // can. Treat it as the payer covering it themselves: the books
    // stay closed and the expense stays visible, which beats hiding it.
    if (totalParts(e.split) <= 0) {
      if (out[e.paidBy]) out[e.paidBy].share += e.homeValue;
      continue;
    }
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

// Round every net to a whole minor unit, keeping the total the books had.
//
// Rounding each net on its own breaks the one invariant settle-up runs
// on — that what is owed equals what is due. Nets of (0.5, 0.5, −1) yen
// round to (1, 1, −1) and invent a yen, or to (0, 0, −1) and lose one;
// either way the greedy match below leaves a side unclearable. So the
// leftover units are handed out largest-remainder style, exactly as
// allocate() does for a split, and the column adds up again.
//
// TIES DECIDE WHETHER SETTLE-UP CAN TERMINATE AT ALL. An exact half is
// the only place the rounding has a free choice, and taking it upward
// is what made "All settled 🎉" unreachable on 0-decimal currencies:
// ¥1.5 rounded up to a ¥2 transfer, leaving the payer ¥0.5 in credit,
// which rounded up to ¥1 back the other way, forever. Breaking the tie
// toward the SMALLER net rounds a half down instead — the residue is
// then under half a unit on the next pass, rounds to nothing, and the
// trip closes. It also errs toward moving less of somebody's money,
// which is the right way to be wrong by half a yen.
//
// AND THE TIE HAS TO BE RECOGNISABLE. Nets do not arrive as tidy halves:
// tripBalances builds them from raw fractions (a third of a rupee, a
// seventh of a dinar) and then subtracts settle-up's own rounded
// transfers back off them as recorded payments. Three friends and one
// ₹100 dinner leave remainders that are all exactly 2/3 in real
// arithmetic and 1.7e-13 apart as floats — so an exact `===` tie never
// fired, the extra unit went to whoever noise put first, and a phantom
// ₹0.01 transfer came back on the second round. That is not an edge
// case: largest-remainder rounding only just closes the books, and the
// tie is precisely where it is tightest, so a missed tie is the one
// thing that makes a second round necessary.
//
// So remainders are compared loosely — and it has to be a TOLERANCE, not
// a grid. Snapping each remainder onto a grid a millionth of a minor unit
// wide (`Math.round(rem * 2 ** 20)`) reads like a tolerance and is not
// one: it moves the point at which two numbers stop counting as equal, it
// does not remove it. Halves and quarters land mid-bucket, which is what
// a power-of-two grid buys — but the books deal in ninths and
// twenty-sevenths and hundredths, and those land wherever they land,
// bucket edges included. A ₹7,70,336.13 booking split by percent puts
// three shares of the same 4% on opposite sides of one edge: the first
// round gives the spare paise to one of them, the second round gives it
// to another, the residues stop cancelling, and the phantom ₹0.01 is
// back. Wide numbers are exactly where this bites, because the wider the
// number the coarser its last bits.
//
// A millionth of a minor unit is the right SIZE either way — a millionth
// of a paise is not money by any reading, and it is millions of times
// coarser than the noise of adding up an ordinary trip. Comparing against
// it directly is what makes equal remainders compare equal wherever they
// happen to sit.
//
// WHERE THE GUARANTEE STOPS, because it does. The noise grows with the
// size of the books and the tolerance does not, so somewhere they cross.
// Measured, that is around 10^9 minor units in a single net — ₹1 crore,
// or 10^9 dong — beyond which two shares of the same expense can differ
// by more than a millionth of a unit and settle-up may want a second
// round. Raising the tolerance only moves the wall into the gap between
// remainders that are genuinely different (a percent split puts those
// 0.01 apart), which trades a rare extra round for a wrong split, so it
// is left where it is. Same shape as the note below: "under one minor
// unit" is what the books close to, not zero.
const TIE = 2 ** -20;

function wholeUnits(exact) {
  const whole = exact.map(Math.floor);
  const target = Math.round(exact.reduce((a, b) => a + b, 0));
  const short = target - whole.reduce((a, b) => a + b, 0);
  const order = exact
    .map((v, i) => ({ rem: v - whole[i], v, i }))
    .sort((a, b) => (b.rem - a.rem) || (a.v - b.v) || (a.i - b.i));
  // Everything within TIE of the biggest remainder in a run IS that
  // remainder, so inside the run the tie-break decides — smaller net
  // first, which is what rounds a half toward moving less money — and the
  // float noise decides nothing. Re-ordering a sorted run rather than
  // comparing loosely inside the sort is deliberate: "within TIE of" is
  // not transitive, and a sort given a comparator that isn't a total
  // order is free to return anything at all.
  for (let s = 0; s < order.length; ) {
    let e = s + 1;
    while (e < order.length && order[s].rem - order[e].rem <= TIE) e++;
    if (e - s > 1) {
      order.splice(s, e - s, ...order.slice(s, e).sort((a, b) => (a.v - b.v) || (a.i - b.i)));
    }
    s = e;
  }
  for (let k = 0; k < short; k++) whole[order[k].i] += 1;
  return whole;
}

// Turn net balances into few transfers: repeatedly match the largest debtor
// with the largest creditor. N members → at most N−1 transfers.
//
// All of it in whole minor units — yen, paise, fils — because that is
// the only money anyone can actually hand over, and because a ledger
// kept in raw floats while the rows on screen were rounded is what let
// settle-up both loop forever and swallow real debt. Two consequences
// worth keeping: every debt is decremented by exactly the amount of the
// transfer that paid it, and the residue that survives is a fraction of
// a minor unit, which is arithmetic left over rather than money owed.
//
// v1.45 suppressed transfers under a flat `>= 1`, to stop rows like
// "Asha → Bo ₹1.49 · Mark paid". That silently swallowed up to a
// whole Kuwaiti dinar — about ₹270 — and printed "All settled 🎉" over
// it. Any fixed threshold has that problem, because the same number
// means different money in different currencies. Real small debts DO
// appear here — ₹1.49 is not much, but it is somebody's, and the app
// has no business deciding otherwise.
// Every net as a whole number of minor units, keyed by member. The one
// place that rounding happens — settleUp and roundedNets both read it,
// so the transfer list and the balances list can never disagree about
// who is settled or by how much.
function unitNets(balances, decimals) {
  const unit = 10 ** (Number.isFinite(decimals) ? decimals : 2);
  const exact = [];
  for (const [id, b] of Object.entries(balances)) {
    const net = typeof b === "number" ? b : b?.net;
    if (Number.isFinite(net)) exact.push({ id, value: net * unit });
  }
  const whole = wholeUnits(exact.map((r) => r.value));
  return { unit, rows: exact.map((r, i) => ({ id: r.id, amt: whole[i] })) };
}

export function settleUp(balances, decimals = 2) {
  const { unit, rows } = unitNets(balances, decimals);

  const debtors = [];
  const creditors = [];
  for (const r of rows) {
    if (r.amt < 0) debtors.push({ id: r.id, amt: -r.amt });
    else if (r.amt > 0) creditors.push({ id: r.id, amt: r.amt });
  }

  const byAmt = (a, b) => b.amt - a.amt;
  const transfers = [];
  while (debtors.length && creditors.length) {
    debtors.sort(byAmt);
    creditors.sort(byAmt);
    const d = debtors[0];
    const c = creditors[0];
    const pay = Math.min(d.amt, c.amt); // whole units, so never zero
    transfers.push({ from: d.id, to: c.id, amount: pay / unit });
    d.amt -= pay;
    c.amt -= pay;
    if (d.amt === 0) debtors.shift();
    if (c.amt === 0) creditors.shift();
  }
  return transfers;
}

// Each member's net as SETTLE-UP sees it: whole minor units, from the
// same rounding, so { [id]: net } here and the transfer list above are
// two views of one number. Positive is owed money, zero is settled.
//
// The balances list is read against the transfer list directly above it,
// so it cannot round differently. Judging it by a hardcoded |net| > 0.01
// instead printed "All settled 🎉" and, one section below, a row chasing
// somebody for ¥1: 0.01 is a hundredth of a rupee AND a hundredth of a
// yen, so on a 0-decimal currency the sub-minor-unit residue settle-up
// is entitled to leave read as a real debt. Same fixed-epsilon mistake,
// for the same reason, as the flat `>= 1` removed from settleUp in v1.45.
//
// Nor is "half a minor unit" the fix. Half is not always reachable —
// nets of 0.4/0.4/−0.8 yen have no whole-unit plan that holds everyone
// to 0.5 — so a half-unit test would still chase the 0.6 that the books
// legitimately close on. What settle-up leaves is under ONE minor unit,
// and it leaves it precisely because rounding those nets gives zero.
// Round the row the same way and the two lists cannot disagree: a row
// says "owes" exactly when there is a transfer asking for it, for
// exactly that amount. Small debts are still shown — a whole unit is a
// whole unit — only arithmetic residue disappears.
export function roundedNets(balances, decimals = 2) {
  const { unit, rows } = unitNets(balances, decimals);
  return Object.fromEntries(rows.map((r) => [r.id, r.amt / unit]));
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

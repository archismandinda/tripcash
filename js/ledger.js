// Putting a saved expense into the ledger (phase D7).
//
// This is the last decision still inline in app.js's ledger path, and it
// is the fourth appearance of the shape ADR-0019 was written about:
// `saveExpense` read `previous` and built `record`, then awaited three
// times (the photo prepare, the IndexedDB write, the IndexedDB delete)
// before committing with
//
//     expenses = editId ? expenses.map(...) : [...expenses, record]
//
// A live snapshot lands in that window routinely — a push is scheduled
// 1.2 s after every save. If it carried a delete made on the other phone,
// `.map()` matched nothing, the edit was thrown away with no error, no
// toast and no trace, and the receipt just written to IndexedDB was left
// pointing at a record that no longer existed. Every previous variant of
// this shape destroyed data on a real phone.
//
// The rule, and it is deliberately blunt: the expense the user pressed
// Save on ENDS UP IN THE LIST, once, wherever the list happens to be by
// then. Losing an expense is worse than resurrecting one — a resurrected
// one is visible and can be deleted again, a lost one is discovered weeks
// later when the trip is being settled, if ever.

/**
 * Where `record` belongs in `expenses`.
 *
 * Pure, and a function of what it is HANDED — it holds no reference to
 * any list read before an await. app.js must pass live state at the
 * moment of the write, which is the whole of ADR-0019.
 *
 * Returns { expenses, revived }. `revived` means we were editing a record
 * that had been deleted underneath us and put it back.
 */
export function commitExpense({ expenses = [], record, editingId = null }) {
  // Both ids, because they can disagree: `editingId` is the row the sheet
  // opened on, `record.id` is what a concurrent sync may already hold.
  // Matching only one of them leaves the other as a duplicate row.
  const key = editingId ?? record.id;

  const next = [];
  let placed = false;
  for (const e of expenses) {
    if (e.id !== key && e.id !== record.id) {
      next.push(e); // untouched rows stay the SAME objects — a rebuilt
      continue;     // row restamps and re-pushes for no change at all
    }
    if (!placed) {
      next.push(record); // in place: the ledger doesn't reshuffle on an edit
      placed = true;
    }
  }
  if (!placed) next.push(record);

  return { expenses: next, revived: Boolean(editingId) && !placed };
}

/**
 * When the expense happened.
 *
 * An explicit "When" wins; otherwise the expense keeps the moment it
 * originally got. `fallback` is the last resort and must be supplied by
 * the caller (app.js passes `Date.now()`) — reading the clock in here
 * would make the function impure and untestable for the sake of one
 * argument. `previous` may be undefined because the record was deleted
 * on the other phone mid-save; that must still yield a real time, or the
 * revived expense sorts nowhere and its date reads "Invalid Date".
 */
export function resolveCreatedAt({ when, previous, fallback }) {
  if (Number.isFinite(when)) return when;
  if (Number.isFinite(previous?.createdAt)) return previous.createdAt;
  return fallback;
}

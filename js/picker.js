// Which layout the trip editor is showing, and whether the picked row
// has anything to say.
//
// The currency search used to be the fifth control down a bottom sheet,
// which put the field itself under an iPhone SE's keyboard and the first
// match 128px below THAT — with a scroller that had no slack to scroll.
// Reaching the search at all is therefore a layout question, not a
// scrolling one: while somebody is choosing a currency, the currency
// step is the whole sheet and the input is at the top of it.
//
// "While somebody is choosing" is the decision, and it is two inputs, so
// it lives here rather than in a condition inside a render function. It
// is view state: nothing here is ever written to storage or sent to
// another device.

// "form"    — the trip editor as it has always been: name, members, then
//             the currency search near the bottom.
// "picking" — the currency step alone, filling the sheet, input on top.
//
// A caret in the box is enough: waiting for the first keystroke means the
// keyboard rises over the old layout and everything jumps as soon as a
// letter lands. And a query holds the layer open with the box blurred,
// because tapping a result blurs it — collapse there and you could pick
// exactly one currency.
export function pickerMode({ query = "", focused = false } = {}) {
  const typed = String(query ?? "").trim().length > 0;
  return typed || focused ? "picking" : "form";
}

// Whether the row of picked-currency chips is worth any height at all.
// It used to be given 38px of min-height plus 10px of padding
// unconditionally, so an empty row put a blank band between the query and
// the first match — with the keyboard up, the only thing under the query,
// and it read as "the results have vanished".
export function pickedRowVisible(picked) {
  return Array.isArray(picked) && picked.length > 0;
}

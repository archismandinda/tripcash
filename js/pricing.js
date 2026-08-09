// What an expense is worth, and in which currency (phase D7).
//
// Two rules live here, both of which were previously written out several
// times in app.js and drifted every time:
//
//   1. The home-currency value is a SNAPSHOT taken when the expense was
//      saved. That is the whole reason debts don't move when rates do.
//      The rule was duplicated three times — the save, the preview, and
//      the "locked in" label — and in v1.46.1 the preview promised
//      today's rate while the save correctly kept the old one.
//
//   2. The currency picker must always offer the expense's OWN currency.
//      Built from the trip's list alone, an expense whose currency had
//      since been dropped opened with a DIFFERENT currency selected
//      while the row behind it still read the old one; retyping the
//      amount then saved it in the original. ¥25 became €25.

import { convert } from "./convert.js";

/**
 * The value to store, and whether it is the original snapshot.
 *
 * Only a change to the amount, the currency, or the home currency
 * justifies a fresh conversion. Renaming an expense three weeks later
 * must not re-price a dinner everybody has already settled around.
 */
export function priceExpense({ previous, amount, code, homeCurrency, rates }) {
  const unchanged = !!previous &&
    previous.amount === amount &&
    previous.code === code &&
    previous.homeCode === homeCurrency &&
    Number.isFinite(previous.homeValue);

  if (unchanged) return { homeValue: previous.homeValue, locked: true };

  const fresh = amount && rates ? convert(amount, code, homeCurrency, rates) : null;
  return { homeValue: fresh, locked: false };
}

// Every currency this expense could be in — its own FIRST, so a currency
// dropped from the trip (here or on another device) can never leave the
// picker without a matching option, silently selecting the wrong one.
export function currencyOptions(code, tripCurrencies = [], homeCurrency) {
  const seen = new Set();
  return [code, ...tripCurrencies, homeCurrency]
    .filter((c) => c && !seen.has(c) && seen.add(c));
}

// Why Save is disabled — the button's own label, because a disabled
// button swallows taps and can't explain itself any other way.
export function whyBlocked({ name, amount, homeValue, paidBy, splitValid }) {
  if (!String(name ?? "").trim()) return "Name this expense";
  if (!(Number.isFinite(amount) && amount > 0)) return "Enter an amount";
  if (homeValue === null || homeValue === undefined) return "Need rates once — go online";
  if (!paidBy) return "Choose who paid";
  if (!splitValid) return "Fix the split";
  return "";
}

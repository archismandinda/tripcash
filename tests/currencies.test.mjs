import { test } from "node:test";
import assert from "node:assert/strict";
import { searchCurrencies, matchLabel, tripMatchesQuery, ALL_CODES, CURRENCIES } from "../js/currencies.js";

test("searches by city name", () => {
  assert.equal(searchCurrencies("paris")[0], "EUR");
  assert.equal(searchCurrencies("bangkok")[0], "THB");
  assert.equal(searchCurrencies("cusco")[0], "PEN");
  assert.equal(searchCurrencies("budapest")[0], "HUF");
  assert.equal(searchCurrencies("saigon")[0], "VND");
});

test("still searches by country and code", () => {
  assert.equal(searchCurrencies("netherlands")[0], "EUR");
  assert.ok(searchCurrencies("hu").includes("HUF"));
  assert.equal(searchCurrencies("czk")[0], "CZK");
});

test("prefix matches rank before substring matches", () => {
  assert.equal(searchCurrencies("india")[0], "INR");
  assert.ok(searchCurrencies("indo").includes("IDR"));
  // "Oman" is a prefix match for OMR but only a substring inside "Romania"
  const oman = searchCurrencies("oman");
  assert.ok(oman.indexOf("OMR") < oman.indexOf("RON"));
});

test("empty query lists everything; garbage matches nothing", () => {
  assert.equal(searchCurrencies("").length, ALL_CODES.length);
  assert.deepEqual(searchCurrencies("zzzzz"), []);
});

test("matchLabel explains why a code matched", () => {
  assert.equal(matchLabel("EUR", "paris"), "Paris");
  assert.equal(matchLabel("THB", "phuke"), "Phuket");
  assert.equal(matchLabel("EUR", "france"), "France");
  assert.equal(matchLabel("EUR", ""), null);
});

test("trip search matches name, currencies, members, and places", () => {
  const trip = {
    name: "Central Europe",
    currencies: ["EUR", "CZK"],
    members: [{ name: "Rohan" }, "Priya"],
  };
  assert.ok(tripMatchesQuery(trip, "central"));       // name
  assert.ok(tripMatchesQuery(trip, "czk"));           // currency code
  assert.ok(tripMatchesQuery(trip, "koruna"));        // currency name
  assert.ok(tripMatchesQuery(trip, "prague"));        // city via CZK
  assert.ok(tripMatchesQuery(trip, "france"));        // country via EUR
  assert.ok(tripMatchesQuery(trip, "rohan"));         // member object
  assert.ok(tripMatchesQuery(trip, "priya"));         // member string
  assert.ok(tripMatchesQuery(trip, "  PRAGUE  "));    // case + whitespace
  assert.ok(tripMatchesQuery(trip, ""));              // empty matches all
  assert.ok(!tripMatchesQuery(trip, "tokyo"));
  assert.ok(!tripMatchesQuery(trip, "yen"));
  assert.ok(!tripMatchesQuery({ name: "X", currencies: [] }, "prague"));
});

test("every currency entry is well-formed", () => {
  for (const code of ALL_CODES) {
    const c = CURRENCIES[code];
    assert.match(code, /^[A-Z]{3}$/);
    assert.ok(c.name && c.symbol && c.flag);
    assert.ok([0, 2, 3].includes(c.decimals), `${code} decimals`);
    assert.ok(Array.isArray(c.countries) && c.countries.length > 0, `${code} countries`);
  }
});

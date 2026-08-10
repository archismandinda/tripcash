import { test } from "node:test";
import assert from "node:assert/strict";
import { searchCurrencies, matchLabel, tripMatchesQuery, ALL_CODES, CURRENCIES,
  REGION_CURRENCY, currencyForRegion } from "../js/currencies.js";

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

// ---------- what money a country uses ----------
//
// The app opened in INR for every new user on earth, because that is
// what the default settings say and nothing anywhere derived it. This
// map is the first of the two signals that replace the assumption.

test("a country code answers with the money spent there", () => {
  assert.equal(currencyForRegion("BR"), "BRL");
  assert.equal(currencyForRegion("DE"), "EUR");
  assert.equal(currencyForRegion("PT"), "EUR");
  assert.equal(currencyForRegion("GB"), "GBP");
  assert.equal(currencyForRegion("IN"), "INR");
});

test("a region we know nothing about answers nothing, and never throws", () => {
  // The caller has a fallback; a wrong guess it cannot tell from a right
  // one is worse than no answer. "ZZ" is the reserved user-assigned code.
  assert.equal(currencyForRegion("ZZ"), null);
  assert.equal(currencyForRegion(undefined), null);
  assert.equal(currencyForRegion(null), null);
  assert.equal(currencyForRegion(""), null);
  assert.equal(currencyForRegion(42), null);
});

test("the region comes off a locale tag, in whatever case it arrives in", () => {
  // BCP 47 says the region subtag is uppercase, and plenty of tags in the
  // wild are not. A lowercased tag must not silently mean "no answer".
  assert.equal(currencyForRegion("br"), "BRL");
  assert.equal(currencyForRegion("gB"), "GBP");
});

test("every region entry is well-formed", () => {
  // Same shape as the currency well-formedness test below, and the same
  // job: this map is data, so only a test can hold it to its rules.
  const EUROZONE = ["AT", "BE", "HR", "CY", "EE", "FI", "FR", "DE", "GR", "IE",
    "IT", "LV", "LT", "LU", "MT", "NL", "PT", "SK", "SI", "ES"];
  for (const [region, code] of Object.entries(REGION_CURRENCY)) {
    assert.match(region, /^[A-Z]{2}$/, `${region} is not an ISO 3166-1 alpha-2 code`);
    assert.ok(CURRENCIES[code], `${region} points at ${code}, which the app cannot show`);
  }
  for (const member of EUROZONE) {
    assert.equal(REGION_CURRENCY[member], "EUR", `${member} is in the eurozone`);
  }
  // Every currency the app ships is reachable: a code with no region is a
  // currency this feature can never choose, which is a gap nobody would
  // notice until somebody in that country opened the app.
  const reachable = new Set(Object.values(REGION_CURRENCY));
  for (const code of ALL_CODES) {
    assert.ok(reachable.has(code), `no region maps to ${code}`);
  }
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

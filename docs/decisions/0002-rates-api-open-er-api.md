# ADR-0002: open.er-api.com for exchange rates (not Frankfurter)

Date: 2026-08-05 · Status: accepted

## Context
Need a free, keyless rates API. The two obvious candidates were Frankfurter
(ECB data) and open.er-api.com (ExchangeRate-API's open endpoint).

## Decision
`https://open.er-api.com/v6/latest/USD`.

## Rationale
- Frankfurter carries only ~30 ECB currencies — it's missing most Asian,
  African, and Latin American travel destinations (VND, LKR, NPR, EGP, …).
- open.er-api.com covers 160+ currencies, no key, permissive use with an
  attribution link (shown in Settings).
- Both update daily; daily granularity is fine for cash-conversion math.

## Consequences
- Response `result` field is `"success"` (not `"ok"`) — validated in rates.js.
- If the API ever dies, only `fetchLive()` in js/rates.js changes; the cached
  shape `{base, fetchedAt, rates}` is API-agnostic.

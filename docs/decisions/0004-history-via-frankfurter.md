# ADR-0004: Rate history from Frankfurter (ECB), partial coverage accepted

Date: 2026-08-05 · Status: accepted

## Context
The 30-day rate charts need historical data. Our live-rates API
(open.er-api.com) has no history endpoint. Free keyless options with time
series are essentially Frankfurter (ECB reference rates, ~30 major
currencies) or nothing; keyed/paid APIs are against the project's zero-key
constraint.

## Decision
Fetch history from `api.frankfurter.dev` time-series endpoint, charted as
1 UNIT of the tapped currency in the home currency. Pairs outside the ECB
set show a clear "No history available" note instead of a chart. Series are
cached 12 hours in `tripcash:history` (max 8 pairs, LRU by fetch time) so
charts work offline once seen.

## Consequences
- All of the user's common pairs (INR vs EUR/HUF/CZK/JPY/THB/IDR/…) chart
  fine; exotic destinations (VND, LKR, NPR, EGP…) don't.
- ECB publishes trading days only → ~22 points per 30-day window.
- Two rate sources coexist: current values from open.er-api.com, history
  from ECB — small basis differences between the chart's last point and the
  live rate are expected and harmless.

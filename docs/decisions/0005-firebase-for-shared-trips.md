# ADR-0005: Cross the no-backend line — Firebase for shared trips

Date: 2026-08-05 · Status: accepted

## Context
The Splitwise-style feature set (members adding expenses from their own
phones, login with email, Google sign-in, cloud save) cannot be delivered
with static files alone. ADR-0001's "no backend, no accounts" scope served
the converter well but blocks multi-device trips.

## Decision
Adopt Firebase (Auth with Google + email providers, Firestore with offline
persistence) as the sync layer, in a later phase (D3), after the expense
ledger ships fully local-first (D2). Local data remains the source of truth;
sync layers on top. Firebase Spark tier: ₹0 at this scale, no card.

Sequencing: D1 (home-screen trip cards) → D2 (members, expenses, splits,
summary — all local) → D3 (auth + sync + trip invites).

## Consequences
- The app gains a Google-infrastructure dependency and trip data can leave
  the device (only for signed-in users who opt into sync).
- The project owner creates and owns the Firebase project (accounts are a
  human-only task); config keys are public by design, rules enforce access.
- Offline-first is preserved: Firestore's local persistence + our
  localStorage model; the converter never needs an account.
- Expense amounts snapshot their home-currency value at entry time so
  debts don't drift with exchange rates.

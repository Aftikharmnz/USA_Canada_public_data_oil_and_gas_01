# ADR 0002: Canonical latest state plus revision ledger

- Status: accepted
- Date: 2026-07-19

## Context

Official petroleum series add new periods and revise historical observations. Pure append creates duplicates; destructive replacement loses what users and future models knew at an earlier time.

## Decision

Maintain a keyed canonical latest observation set and an append-only revision ledger. Fetch an overlap window, compare normalized logical keys, append a revision event before replacing any changed key, and retain raw retrieval checksums.

## Consequences

- The current dashboard remains simple and correct.
- Source revision delta can be distinguished from period-over-period market change.
- Release-time forecasting vintages can be reconstructed when raw/retrieval retention is sufficient.
- Storage and tests are more involved than a latest-only CSV.


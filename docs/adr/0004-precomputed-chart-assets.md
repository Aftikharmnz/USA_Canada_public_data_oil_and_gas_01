# ADR 0004: Precomputed chart assets

- Status: accepted
- Date: 2026-07-19

## Context

Seasonal bands, deltas, distributions, coverage checks, and source reconciliation are costly and sensitive to methodology. Recomputing them independently in each browser risks inconsistency and large downloads.

## Decision

Compute validated chart slices in the update pipeline. Publish compact, versioned JSON assets with methodology, freshness, geography availability, aggregation lineage, and checksums. The frontend focuses on interaction and presentation.

## Consequences

- Results are reproducible and fast to load.
- Methodology changes trigger deterministic asset rebuilds.
- Assets must be partitioned to avoid repository/site bloat.
- The frontend must reject unsupported asset schema versions rather than guessing.


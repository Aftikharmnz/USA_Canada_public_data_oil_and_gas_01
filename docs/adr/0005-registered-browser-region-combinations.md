# ADR 0005: Registered browser-side regional combinations

- Status: accepted
- Date: 2026-07-20

## Context

Users need ad hoc same-level views such as PADD 1 + PADD 2 or Alberta + Saskatchewan. Prepublishing every possible subset would create a combinatorial asset catalog. Adding already-derived bands, distributions, or prediction-interval endpoints would be mathematically invalid, and broad automatic aggregation authority would risk overlap, suppression, unit, and percentage errors.

## Decision

Keep source-geography assets precomputed, but add compact status-preserving period history and aggregation calibration residuals to those assets. Permit an in-browser combination only when `config/aggregation/custom-geography.json` names the exact country, level, additive series, membership version, member bounds, and complete-coverage rule.

The browser validates mutually exclusive same-level members and compatible schema, series, frequency, unit, scale, period semantics, semantic dimensions, methodology regime, and membership. It sums aligned canonical observations, preserves nonnumeric blocking states, records per-period component lineage, and recomputes all chart statistics. Statistics Canada geography-specific `coordinate` and `vector` identifiers remain component lineage but are not semantic dimensions for same-view compatibility.

For forecasts, compatible component point paths are summed. Component interval bounds are never summed. New empirical 80%/90%/95% prediction intervals require at least 40 component residual sums aligned on both horizon and target period. Forecast failure leaves the combined observed chart available.

Unit conversion is a final display transform after aggregation and interval calibration. The exact barrel/cubic-metre factor and physical dimensions are centralized in `src/lib/units.ts`; canonical public data never changes.

## Consequences

- Users can construct useful regional views without prepublishing every subset.
- The public asset footprint grows by compact history and residual samples but remains partitioned and static-host compatible.
- New series or levels are not automatically combinable; the registry, tests, and documentation must be reviewed together.
- Percentages, overlapping levels, partial coverage, and incompatible forecasts fail closed.
- Precomputed source charts remain reproducible; custom results are deterministic functions of checksummed component assets and a versioned policy.

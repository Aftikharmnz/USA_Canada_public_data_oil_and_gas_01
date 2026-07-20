# ADR 0006: Registered monthly-average rate display

- Status: accepted
- Date: 2026-07-20

## Context

Most Statistics Canada petroleum series are monthly volumes in cubic metres,
while traders commonly compare flows in thousand barrels per day (`kb/d`). A
fixed barrel conversion cannot turn a monthly volume into a daily rate: the
calculation also requires the exact 28, 29, 30, or 31 days in each source
period. Treating all months as equal would distort observations, seasonal
statistics, changes, forecasts, and interval bounds. Point-in-time inventories
must not be divided by days at all.

## Decision

Keep the generic unit engine dimension-safe and continue rejecting ordinary
volume-to-rate conversions. Add one explicit in-memory derivation authorized by
`config/display/monthly-average-rate.json` for registered Statistics Canada
monthly flow/activity series only. For each strict `YYYY-MM` period, calculate:

\[
\operatorname{kb/d}_t =
\frac{\text{cubic metres}_t}
{\text{actual calendar days}_t\times1000\times0.158987294928}.
\]

Transform status-preserving observation history first, then recompute recent
years, seasonal bands, latest comparisons, distributions, histograms, and
change views. Preserve null/status semantics, source checksum, freshness,
dimensions, and aggregation lineage. Reject unregistered series, malformed
periods, missing history, incompatible units, percentages, and ending or
closing stocks.

All regional aggregation and forecast construction remains in canonical
monthly cubic metres. Combined point forecasts and residual-calibrated
prediction intervals are completed first; only the final point and interval
bounds are normalized using each target month's day count. Scale-dependent
model-selection and backtest errors remain labelled in the source monthly-
volume domain because dated evaluation errors are not present in the public
forecast asset.

## Consequences

- Canada flow series can be compared in the trader-standard `kb/d` scale
  without changing or republishing canonical assets.
- Leap February and different month lengths are handled exactly.
- Combined-region values remain reproducible because summation precedes the
  common target-period normalization.
- Ending inventories never appear as rates, and future series require an
  explicit registry review before receiving the derived option.
- Display analytics are rebuilt in the browser from period history rather than
  scaling precomputed monthly-volume statistics.


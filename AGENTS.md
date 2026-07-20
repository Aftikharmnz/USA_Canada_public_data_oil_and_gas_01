# Agent guide

Use this file as the concise operating contract for Codex and other coding agents.

## Source of truth

- Product and status: [`README.md`](README.md)
- Current boundary: [`docs/phase-3-refined-products.md`](docs/phase-3-refined-products.md)
- Current Canada boundary: [`docs/canada-data.md`](docs/canada-data.md)
- Historical Phase 2 boundary: [`docs/phase-2-usa-mvp.md`](docs/phase-2-usa-mvp.md)
- Historical Phase 1 boundary: [`docs/phase-1-scope.md`](docs/phase-1-scope.md)
- System design: [`docs/architecture.md`](docs/architecture.md) and [`docs/adr/`](docs/adr/README.md)
- Entity/field semantics: [`docs/data-contract.md`](docs/data-contract.md)
- Geography and aggregation: [`docs/geography.md`](docs/geography.md)
- Display conversions and period-normalized rate authorization: `src/lib/units.ts` and `config/display/monthly-average-rate.json`
- Series/source definitions: `config/series/*.json` and [`docs/data-catalog.md`](docs/data-catalog.md)
- Calculations: [`docs/methodology.md`](docs/methodology.md)
- Forecasting implementation and future boundary: [`docs/forecasting-roadmap.md`](docs/forecasting-roadmap.md)
- Operations: [`docs/update-runbook.md`](docs/update-runbook.md)

## Required behavior

1. Inspect the relevant registry and docs before editing code.
2. Preserve stable IDs and backwards-compatible public assets unless a migration is documented.
3. Keep the Geography control on every chart and derive its choices from the active series manifest.
4. Expose the smallest official grain, then only validated source-published or computed larger views.
5. Never synthesize unsupported city/local detail or silently relabel a source-defined region.
6. Reject unknown provider geography codes, facet drift, unit drift, duplicate identities, and incompatible asset schemas.
7. Enforce aggregation coverage, units, period alignment, membership version, and lineage; never average percentages.
8. Treat missing, suppressed, withheld, zero, preliminary, and not-applicable as different states.
9. Keep the last-known-good generation deployable when an update fails.
10. Update documentation and tests with contract, active-series, or methodology changes.
11. Never place credentials in code, config, fixtures, logs, docs, generated assets, command arguments, or commits.
12. Treat refined-product parents and children as overlapping views: never stack or add hierarchy levels without a documented reconciliation.
13. Preserve market semantics: product supplied is implied demand, total distillate is broader than road diesel, import PADD is district of entry, and unadjusted net production can be negative.
14. Preserve the 2014-01-01 lower bound for newly onboarded Phase 3 weekly history and the 90 MiB canonical publication guard unless a reviewed storage migration changes them.
15. For Canada, preserve the latest source period separately from the latest numeric period so suppression does not make an old value appear current.
16. Never infer CER capacity or national utilization; a national CER crude-runs sum requires complete same-week coverage of all three registered regions and component lineage.
17. Keep USA and Canada as the primary data pages and Reference as the educational page; `/products/` is only a backwards-compatible USA-Refined entry.
18. Within each country, resolve choices in this order: Crude/Refined, finest available geography level, official geography node, product family, product/activity, measure. Geography must filter every downstream choice.
19. Show registered product/activity leaves before broader registered parents, never invent missing parents, and treat refinery activity under Crude as navigation only.
20. Keep forecasts in separate `forecast_path` records; never overwrite or impute observations, and fail forecast display on checksum/origin/identity mismatch while retaining the observed chart.
21. Refuse to forecast from an older numeric value when the latest source period is nonnumeric, suppressed, withheld, missing, or unavailable.
22. Call the 80%/90%/95% ranges prediction intervals, not confidence intervals. Preserve their empirical/non-guaranteed coverage disclosure.
23. Describe the current forecast phase as univariate statistical forecasting with latest-revised pseudo-out-of-sample evaluation, not machine learning, first-release vintage backtesting, a trading signal, or trading advice.
24. Authorize browser-defined regional combinations only through `config/aggregation/custom-geography.json`; require same-level, mutually exclusive members, complete period coverage, matching metadata, and per-period lineage. Never add precomputed statistics or component interval endpoints.
25. Treat unit selection as display-only. Use the exact barrel/cubic-metre conversion in `src/lib/units.ts`, preserve volume/rate/calendar-day-rate/percent dimensions for fixed-factor conversions, and never convert or aggregate percentages as quantities. The only volume-to-rate display derivation is the positive registry in `config/display/monthly-average-rate.json`: registered Statistics Canada monthly flows use the actual days in each `YYYY-MM`; ending stocks and unregistered series remain ineligible.
26. For a combined forecast, add only compatible component point forecasts and recalibrate 80%/90%/95% prediction intervals from at least 40 residual samples aligned by both horizon and target period. Fail the combined forecast closed without hiding the observed combination.
27. Preserve the Statistics Canada table 25-10-0063-01 hierarchy: total crude -> net field plus synthetic; net field -> light-and-medium, heavy, and non-upgraded bitumen; non-upgraded bitumen = in-situ + mined - sent for further processing. Equivalent products is a separate condensate/pentanes-plus parent. Refinery-input grades overlap their parent, and a dimension-declared member with no fact rows is not a zero or an inferred series.

## Current Phase 3 contract

An active USA series must have verified official route/facet metadata, dimensions, units, period semantics, exact provider geography codes, smallest published geography, larger valid views, aggregation rule, revision behavior, expected release rule, UI labels, fixtures, and contract tests. Unsupported geography levels require user-facing reason text. A refined-product entry also requires manifest display classification, product/component role, parent relationship where applicable, glossary links, and a non-additivity caveat.

There are 39 active USA definitions, presented as 2 Crude and 37 Refined choices: three pre-Phase-3 overview series plus 36 refined-product series across gasoline, distillate, and jet fuel. Primary navigation is `/usa/`, `/canada/`, and `/reference/`; `/products/` remains a legacy alias that renders the USA page initially on Refined. Weekly USA refined-product detail is PADD 1A/1B/1C only for select stocks, otherwise PADD or U.S.; no city/state detail is synthesized. Weekly motor-gasoline exports remain excluded because of the June 2023 definition break. Forecasts are a separate analytical layer; trading signals remain out of scope.

Phase 3 is activated and verified; the current promoted run is provider-free rebuild `analytics-20260720T152511Z` (activation history: `eia-20260719T230756Z`): 39 active definitions, 161,869 canonical observations, 249 public chart assets, ~65 MiB canonical JSON, zero activation revisions, and all refined-product series through `2026-07-10`. Public manifest/asset verification passed. Missing series retain the registry's weekly/monthly bootstrap starts (2014-01-01/2014-01), and `scripts/bootstrap-phase3.ps1` remains a scoped recovery/from-scratch helper for exactly the 36 Phase 3 weekly series. The verified public site is https://aftikharmnz.github.io/USA_Canada_public_data_oil_and_gas_01/. Automated EIA refresh still requires the replacement `EIA_API_KEY` secret.

## Current Canada contract

The Canada dashboard is activated and verified in promoted run `canada-20260720T192043Z`: 51 active definitions (49 Statistics Canada and 2 CER), presented as 22 Crude and 29 Refined choices, with 49,726 canonical observations, 404 verified observed chart assets and matching forecast records, and 21.09 MiB canonical JSON. The merge inserted 10,184 rows, revised 0, and matched 34,946 unchanged rows; Statistics Canada reaches source month `2026-04`, CER reaches week `2026-06-16`, and forecast status is 360 ready, 18 `limited_history`, and 26 unavailable. The previous last-known-good generation was `analytics-20260720T152511Z`; the initial Canada activation was `canada-20260720T000329Z`. Public manifest/asset verification passed locally and the deployed site is https://aftikharmnz.github.io/USA_Canada_public_data_oil_and_gas_01/.

Authoritative definitions are `config/series/canada.json`, `config/geographies/canada.json`, and `docs/canada-data.md`. Statistics Canada choices are per-series province/territory or the source-published Atlantic aggregate plus a source-published Canada value where available. CER publishes exactly three confidentiality regions. National CER crude runs are only a complete three-region computed sum; national CER utilization, city/refinery detail, confidential-cell reconstruction, and province inference are unsupported. Preserve missing, suppressed, and status fields distinctly, and show latest source versus latest numeric periods separately.

The 20 active table 25-10-0063-01 definitions include the five headline balances and 15 crude-detail definitions. Light and medium crude remains one combined source member. The non-upgraded-bitumen processing row is subtractive, not a positive component. Synthetic crude is outside net field production but inside total crude production; equivalent products (condensate plus pentanes plus) is outside total crude production. Total refinery inputs has registered light/medium, heavy, crude-bitumen, and synthetic children. The source declares a condensate-and-pentanes-plus refinery-input member but publishes no fact rows for it, so it remains absent rather than reconstructed. Parent/child links never authorize stacking, and suppressed cells are never inferred from parents or Canada totals.

Use `python -m pipeline.energy_dashboard.cli refresh-canada --dry-run` to inspect the credential-free plan and `python -m pipeline.energy_dashboard.cli refresh-canada --store data/cache/canada --promote-to public/data/canada` for a registry-validated refresh. `.github/workflows/refresh-canada.yml` polls twice on weekdays with bounded retries, no-op suppression, and last-known-good retention. Scheduled freshness stays `unknown` until an expected-period calendar is reviewed; source release timestamps can be unavailable. The exposed EIA key must still be rotated before automated EIA refresh is enabled.

## Current custom geography and units contract

`config/aggregation/custom-geography.json` is the only authorization registry for user-selected regional combinations. It currently permits sums for approved additive USA PADD series, USA monthly crude oil field production across state/producing-area nodes, approved additive Statistics Canada province/territory series, and CER crude runs across its three confidentiality regions. It excludes utilization, product supplied, exports without regional publication, PADD subdistrict mixtures, and every unregistered series. Mutual exclusivity is proven from the registered geography DAG by `src/data/geographyContainment.ts` rather than assumed from a shared `level_id`; a node's atomic membership is itself plus every declared descendant, so Alaska and Alaska South are refused as an overlapping pair while either remains combinable with unrelated regions. Component history is aligned by period and requires 100% coverage; missing or suppressed components yield a nonnumeric combined period rather than a partial sum. Statistics Canada `coordinate` and `vector` are geography-specific lineage identifiers and are normalized only for same-view compatibility; component checksums and IDs remain in aggregation lineage.

All generated chart assets now carry compact status-preserving `history`. The UI recomputes the combined seasonal baseline, recent years, latest diagnostics, distributions, and per-period lineage from that history. Display-unit conversion is presentation-only and uses `src/lib/units.ts`; source values, checksums, and forecasts remain in canonical units. Registered Statistics Canada monthly flows additionally support an in-memory monthly-average `kb/d` view: canonical aggregation and forecast calibration finish first, each observation or target is divided by its own calendar-day count, and displayed analytics are recomputed. Scale-dependent backtest errors remain in source monthly cubic metres.

## Current forecasting contract

`pipeline/energy_dashboard/forecasting.py` publishes schema `1.0.0`, methodology `2026-07-20.4`, and `univariate_statistical_projection` or `fundamentals_augmented_statistical_projection` records. Every manifest geography links its observed asset to a separate forecast asset and records forecast checksum/bytes. Weekly and monthly horizons are both exactly 3 source periods. Six univariate baseline candidates compete by rolling-origin MAE: last observation, recent mean, robust damped trend, additive harmonic trend, seasonal naive, and seasonal average. `pipeline/energy_dashboard/fundamentals.py` adds a registered fundamental net-balance candidate (weekly barrel-accounting identity over same-release production, imports, exports, and product supplied, with an estimated unaccounted term) for national total-distillate and jet stocks only; it competes with no preference, fails closed on any missing driver period, and gasoline is excluded because of the June 2023 exports break. A later disjoint chronological residual window with at least 40 errors per horizon calibrates asymmetric 80%/90%/95% empirical prediction intervals, and a final independent holdout reports MAE, RMSE, bias, directional accuracy, interval coverage, calibrated seasonal-naive MAE, and skill when history permits. Ready records additionally export ordered calibration residuals for exact same-horizon/target-period alignment; these are the only authorized input to combined regional intervals.

Forecast training for `can.statcan.crude.imports.monthly` and `can.statcan.crude.exports.monthly` begins at `2020-01` because of the documented Statistics Canada methodology break. Pre-break observations remain chart history only. Any change to this policy requires a reviewed methodology/build-ID bump, matching tests/docs, and an offline analytics rebuild.

The generated `forecast_summary` in each country manifest is authoritative for the current data vintage. `limited_history` means point forecasts and calibrated intervals exist but an independent final holdout was not available. Unavailable records remain published with a reason; the latest-source-nonnumeric rule protects Canadian suppression semantics.

Backtests use latest stored revised provider values and are labelled `latest_revised_pseudo_out_of_sample`; they do not reconstruct what was known at each historical release. Intervals are empirical prediction intervals with nominal coverage, not confidence intervals or guarantees. Forecasts exclude weather, outages, prices, analyst expectations, and other exogenous features. They are decision support, not trading advice, and this phase is not machine learning.

Changed USA and Canada provider refreshes automatically rebuild both observed and forecast assets with build ID `observed-2026-07-20.1_forecast-2026-07-20.4`. A source no-op creates nothing by default. Use `python -m pipeline.energy_dashboard.cli rebuild-analytics --store <store> --destination <public-data-path>` for a reviewed provider-free methodology/build refresh; it reads the current canonical generation, makes zero provider network calls, validates the complete candidate, and atomically preserves last-known-good behavior.

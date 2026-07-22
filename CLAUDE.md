# Claude Code project guide

This is a navigation and guardrail layer for Claude Code and other coding agents. The canonical product summary is [`README.md`](README.md).

## Read first

1. [`README.md`](README.md)
2. [`docs/phase-4-usa-weekly-breadth.md`](docs/phase-4-usa-weekly-breadth.md)
3. [`docs/architecture.md`](docs/architecture.md)
4. [`docs/data-contract.md`](docs/data-contract.md)
5. [`docs/geography.md`](docs/geography.md)
6. [`config/series/usa.json`](config/series/usa.json) and [`config/geographies/usa.json`](config/geographies/usa.json)
7. For Canada work, [`docs/canada-data.md`](docs/canada-data.md), [`config/series/canada.json`](config/series/canada.json), and [`config/geographies/canada.json`](config/geographies/canada.json)
8. For custom regional combinations or units, [`config/aggregation/custom-geography.json`](config/aggregation/custom-geography.json), [`config/display/monthly-average-rate.json`](config/display/monthly-average-rate.json), [`src/lib/regionAggregation.ts`](src/lib/regionAggregation.ts), and [`src/lib/units.ts`](src/lib/units.ts)

Read [`docs/methodology.md`](docs/methodology.md) and [`docs/forecasting-roadmap.md`](docs/forecasting-roadmap.md) before changing calculations, forecast semantics, horizons, model selection, calibration, or evaluation. Read [`docs/update-runbook.md`](docs/update-runbook.md) before changing credentials, schedules, retries, storage, promotion, or deployment. Record durable architectural decisions under [`docs/adr/`](docs/adr/README.md).

Read [`docs/phase-3-refined-products.md`](docs/phase-3-refined-products.md) or [`docs/phase-2-usa-mvp.md`](docs/phase-2-usa-mvp.md) only when historical behavior or migration context matters.

## Current Phase 4 USA boundary

The USA registry has 67 entries with `activation_status: active`:

- the three Phase 2 overview series: weekly refinery utilization, monthly crude oil production, and weekly total petroleum products supplied;
- 36 weekly refined-product series: 13 stocks, 8 unadjusted refinery/blender net production, 3 product supplied, 9 imports, and 3 exports;
- 28 Phase 4 weekly additions represented by 77 exact source-series keys: weekly crude production, crude inputs and balances, commercial/SPR/inclusive stocks, total-petroleum stocks/trade, five days-of-supply ratios, propane, and residual fuel oil.

Phase 4 is registry-complete but is not a public-data claim until the live workflow succeeds and promotes its observed and forecast assets. The current promoted run remains provider-free rebuild `analytics-20260720T152511Z` (from activation run `eia-20260719T230756Z`) with the prior 39 definitions, 249 public chart assets, 161,869 canonical observations, ~65 MiB canonical JSON, zero revisions, and all 36 Phase 3 refined-product definitions through `2026-07-10`. The verified public site is https://aftikharmnz.github.io/USA_Canada_public_data_oil_and_gas_01/. The replacement `EIA_API_KEY` GitHub secret is configured, and automated refresh has already captured provider updates.

`/usa/` and `/canada/` are the primary country dashboards and `/reference/` explains products and accounting concepts. The legacy `/products/` path renders the unified USA dashboard initially set to Refined and is not primary navigation. The staged USA registry resolves 11 Crude and 56 Refined definitions, with 66 weekly and one monthly; the current promoted USA manifest remains 2 Crude/37 Refined until Phase 4 activation. Canada resolves 22 Crude and 29 Refined definitions. Refinery activity belongs under Crude as a navigation classification only. Gross inputs and operable capacity remain supporting USA refinery series. Forecasting is implemented as a separate, checksum-linked layer and never changes an observation. Trading signals remain out of scope.

Phase 4 geography is exact and per series: weekly crude production exposes Alaska, Lower 48 States, and U.S.; commercial crude stocks expose Cushing, PADD 1-5, and U.S.; imports use district-of-entry PADDs; and national-only flows and ratios are never allocated downward. Cushing is a source-published local node inside PADD 2, so the two overlap. Nine Phase 4 additive PADD quantities are browser-combinable only through `config/aggregation/custom-geography.json`: crude inputs, commercial crude stocks/imports, total imports, propane stocks/imports, and residual stocks/production/imports. Days supply, net imports, exports, product supplied, percentages, and unregistered views are never custom-summed.

The activated propane export key is propane only. Stocks, production, imports, product supplied, and days supply use propane/propylene definitions, so the export selection retains a separate product identity and is not presented as a like-for-like balance component.

The current forecast profile is transparent statistical forecasting, not machine learning: exactly 3 future source periods for both weekly and monthly series, rolling-origin MAE selection among six registered univariate baselines plus — only for national weekly total-distillate and jet stocks — a registered fundamental net-balance candidate built from the same release's production, imports, exports, and product-supplied series through the barrel-accounting identity (`pipeline/energy_dashboard/fundamentals.py`; gasoline excluded because of the June 2023 exports break; fails closed on any missing driver period), a later empirical calibration window, and 80%/90%/95% prediction intervals. "Prediction interval" is required terminology; it is not a confidence interval. Evaluation uses latest-revised pseudo-out-of-sample history rather than reconstructed first-release vintages, and forecasts are decision support rather than trading advice.

Canada is activated and verified in promoted run `canada-20260720T192043Z`: 51 active definitions (49 Statistics Canada and 2 CER), classified as 22 Crude and 29 Refined, with 49,726 canonical observations, 404 verified observed chart assets and matching forecast records, and 21.09 MiB of canonical JSON. The merge inserted 10,184 rows, revised 0, and matched 34,946 unchanged rows. Statistics Canada reaches source month `2026-04`; CER reaches week `2026-06-16`; forecast status is 360 ready, 18 `limited_history`, and 26 unavailable. The previous last-known-good generation was `analytics-20260720T152511Z`, and the initial Canada activation was `canada-20260720T000329Z`. The verified public site is https://aftikharmnz.github.io/USA_Canada_public_data_oil_and_gas_01/.

Canada geography is strictly per series. Statistics Canada exposes the province/territory or Atlantic source aggregate actually published for that coordinate and a source-published Canada total where available. CER exposes exactly Ontario, Quebec & Eastern Canada, and Western Canada. A national CER crude-runs value is a complete three-region computed sum with lineage; there is no national CER utilization because the source has no explicit compatible capacity series. Never infer city, refinery, province, capacity, or confidential values.

Statistics Canada table 25-10-0063-01 defines the crude hierarchy. Total crude production contains net field production and synthetic crude; net field contains the combined light-and-medium category, heavy crude, and non-upgraded bitumen. Non-upgraded bitumen reconciles as in-situ plus mined production minus bitumen sent for further processing, so that processing row is subtractive. Equivalent products is a separate parent for condensate (lease plus plant) and pentanes plus. Grade-specific refinery-input rows overlap total refinery inputs. The source dimension declares a condensate-and-pentanes-plus refinery-input child but the current fact file contains no rows for it; never activate it as zero, infer it as a residual, split combined grade members, or reconstruct suppressed cells.

The UI now supports same-level custom combinations only for additive series explicitly listed in `config/aggregation/custom-geography.json`: approved USA PADD quantities, USA monthly crude oil field production across state/producing-area nodes, approved Statistics Canada province/territory quantities, and CER crude runs. Mutual exclusivity is proven by the registered geography DAG through `src/data/geographyContainment.ts`, never assumed from a shared `level_id`: EIA publishes Alaska South at the same `state_or_area` level as its parent Alaska, so a node covers itself plus every declared descendant and any overlapping selection is refused with the conflicting region named. It loads compact period history from each selected asset, requires matching metadata and complete coverage, preserves suppressed/missing periods, and recomputes every seasonal/statistical view from the summed observations. It never adds precomputed bands, histograms, percentages, or component interval endpoints. Combined forecasts add compatible three-period point forecasts and calibrate new 80%/90%/95% prediction intervals only from at least 40 residual samples aligned by both horizon and target period. If forecast validation fails, the combined observed chart remains visible with a reason.

Display-unit switching is presentation-only. `src/lib/units.ts` is authoritative and uses exactly `1 barrel = 0.158987294928 cubic metres`; fixed-factor conversions keep volume, ordinary daily rates, calendar-day rates, and percentages as separate dimensions. `config/display/monthly-average-rate.json` explicitly authorizes an in-memory monthly-average `kb/d` derivation for Statistics Canada monthly flows, using each period's actual calendar days and excluding stocks. Source assets, checksums, aggregation, forecast fitting, and interval calibration always stay in canonical units. The country selection toolbars are collapsible and retain a compact current-selection summary while sticky.

Refined-product hierarchy is non-additive in the UI: total gasoline contains finished gasoline and motor gasoline blending components; conventional/reformulated are children of finished gasoline; CBOB/RBOB are children of blending components; fuel ethanol is contextual and excluded from MGBC. Total distillate contains sulfur-grade views but is broader than road diesel. Motor-gasoline exports are deliberately inactive because of EIA's June 2023 definition break.

## Implementation map

- `config/series/*.json`: exact upstream coordinates, activation status, semantics, and per-series geography availability.
- `config/geographies/*.json`: stable nodes, source codes, and DAG relationships.
- `config/aggregation/custom-geography.json`: explicit same-level custom-sum authorization and membership version.
- `pipeline/energy_dashboard/eia.py`: credential-safe EIA API v2 pagination/retry client.
- `pipeline/energy_dashboard/registry.py`: strict active-series loading, provider geography resolution, and normalization.
- `pipeline/energy_dashboard/statcan.py` and `statcan_registry.py`: credential-free full-table retrieval, strict archive/header/table validation, registered-coordinate normalization, and source-status preservation.
- `pipeline/energy_dashboard/cer.py` and `canada_registry.py`: strict weekly crude-runs retrieval/normalization and registered CER geography handling.
- `pipeline/energy_dashboard/statcan_refresh.py`: combined Statistics Canada/CER Canada generation orchestration and guarded CER national crude-runs rollup.
- `pipeline/energy_dashboard/storage.py`: canonical merge, revision ledger, immutable generations, and atomic `CURRENT` pointer.
- `pipeline/energy_dashboard/analytics.py`: deterministic public seasonal/delta/distribution assets.
- `src/lib/regionAggregation.ts` and `src/lib/customRegionView.ts`: strict period-level custom sums, recomputed analytics, bottom-up points, and aligned-residual intervals.
- `src/lib/units.ts`: exact, dimension-safe display conversion metadata and arithmetic.
- `src/lib/periodAverageRate.ts`: registered Statistics Canada monthly-flow normalization and recomputed in-memory `kb/d` analytics.
- `pipeline/energy_dashboard/forecasting.py`: standalone univariate forecast assets, rolling-origin selection/calibration/evaluation, and empirical prediction intervals.
- `pipeline/energy_dashboard/rebuild.py`: provider-free rebuild of observed and forecast assets from the current canonical generation.
- `pipeline/energy_dashboard/refresh.py`: registry-to-generation orchestration.
- `src/pages/UsaPage.tsx`: unified USA Crude/Refined and geography-first dashboard.
- `src/pages/CanadaPage.tsx`: unified Canada Crude/Refined and geography-first dashboard.
- `src/pages/RefinedProductsPage.tsx`: backwards-compatible `/products/` wrapper that opens USA on Refined.
- `src/pages/ReferencePage.tsx` and `src/data/referenceGlossary.ts`: searchable product/concept definitions.
- `src/data/forecastAssets.ts`: strict forecast schema, checksum, origin, horizon, and interval validation.
- `src/components/dashboard/SeasonalChart.tsx`: observed seasonal chart plus dashed forecasts, one selected prediction band, diagnostics, tooltip, and accessible table.
- `src/components/dashboard/`: geography, freshness, latest-value, seasonal, distribution, and audit components.

The live runner commands are `refresh-eia`, `refresh-canada`, `rebuild-analytics`, and `promote`; follow the runbook rather than bypassing registry, generation, integrity, publication guards, atomic promotion, or safe retention. Missing USA weekly/monthly series use registry bootstrap starts of 2014-01-01/2014-01; existing USA series use 13-week/10-year overlaps. Canada retrieves and reconciles the registered current source files. Changed provider runs automatically rebuild observed and forecast assets with the current combined build ID. Unchanged runs are skipped; use `rebuild-analytics` for a reviewed provider-free methodology rebuild. Two validated generations are retained after promotion. `.\scripts\bootstrap-phase3.ps1` remains a scoped historical Phase 3 recovery helper, not a Phase 4 bootstrap path. GitHub Pages and the secret-backed EIA workflow are operational. The Phase 1 `plan` command is not a live refresh.

## Non-negotiable invariants

- Every chart renders the Geography control, even when the only valid value is national.
- Geography options come from the active series manifest/availability; do not infer support from another metric.
- Country-page selection order is segment, geography level, official geography node, product family, product/activity, then measure. Geography filters every downstream option.
- Order geography levels finest first and registered product/activity leaves before broader registered parents. Never fabricate a product parent merely to complete the navigation tree.
- When a segment or geography changes, keep a downstream selection only if it remains valid; otherwise choose the first valid compatible option and make the change visible.
- Prefer the smallest official published grain and seek a finer official public source where one exists.
- Never fabricate city, metro, county, province, state, PADD, regional, or national values from a broader figure.
- Do not generalize geography across definitions. Phase 3 PADD 1A/1B/1C detail and Phase 4 Cushing detail exist only for their exact registered stock series; every other view remains at its own source-published grain.
- Never add or stack a product parent with a child. Do not treat CBOB plus RBOB as complete MGBC or relabel RBOB as finished reformulated gasoline.
- Label product supplied as an accounting proxy/implied demand, not measured consumption; label import PADD as district of entry; do not call total distillate pure road diesel.
- Net production can legitimately be negative. Stocks are levels and cannot be combined directly with average-rate flows.
- Unknown source geography codes, facets, units, and schema drift fail closed.
- Unsupported levels are unavailable with an explanation; they never silently return empty data.
- Only `sum`, `ratio_of_sums`, `weighted_average`, or `not_aggregatable` may be registered as aggregation rules.
- Aggregation requires complete time-valid membership, compatible periods/units, and component lineage. Prefer a provider-published total.
- Browser-defined combinations require an exact registry entry, one mutually exclusive geography level, complete aligned component history, and period-level lineage. Never infer authorization from a hierarchy edge or series label.
- Do not add component seasonal statistics or prediction-interval bounds. Recompute statistics from component observations and combined intervals from at least 40 exact aligned residual sums per horizon.
- Unit switching cannot change source data or aggregation arithmetic. Fixed-factor conversions cannot cross physical or semantic dimensions; the sole exception is the registered Statistics Canada monthly-flow average-rate display, which divides each period by its exact calendar days after canonical aggregation and excludes point-in-time stocks.
- Never average utilization percentages; use compatible numerator/denominator sums.
- Keep period-over-period, year-over-year, seasonal, and source-revision changes distinct.
- Preserve missing/suppressed/unavailable states; never coerce them to zero.
- Forecasts remain separate from observed assets and must never impute, overwrite, or relabel an observation.
- Refuse to forecast when the latest source period is nonnumeric, even when an older numeric value exists; forecasting from the older value would conceal suppression or unavailability.
- A forecast must match the observed asset's source checksum, target identity, geography, dimensions, frequency, unit, and latest numeric origin. A mismatch leaves the observed chart usable but the forecast unavailable.
- Preserve the 3-period weekly/monthly horizon, 80%/90%/95% empirical prediction intervals, disjoint chronological selection/calibration/evaluation order, and latest-revised pseudo-out-of-sample disclosure unless a reviewed methodology version changes them.
- Do not call the current forecast phase machine learning, a first-release vintage backtest, a confidence interval, a trading signal, or trading advice.
- For Canada, distinguish the latest source period from the latest numeric period. A newly suppressed source cell must not make an old numeric value look current.
- Treat the Statistics Canada Atlantic aggregate as an overlapping source-published choice, never an extra province to sum.
- Preserve the table 25-10-0063-01 crude and refinery-input hierarchy, including the subtractive bitumen-processing row; a dimension member with no fact rows is absent, not zero or permission to infer a residual.
- Never compute national CER utilization, infer CER capacity, or publish a CER national crude-runs sum unless all three registered regions are present for the same week.
- Preserve the last-known-good generation when any refresh or validation stage fails.
- The browser never receives an API credential or calls a credentialed upstream API.

## Adding or changing a series

Verify current official route metadata and source rows first. Update the series registry, geography nodes/availability, aggregation rule, release/freshness rule, source link, fixtures, tests, and relevant docs together. Activation must fail closed if provider metadata no longer matches the registry.

For a refined product, also update the manifest display classification and glossary `reference_term_ids`, document its parent/component role, and test that the hierarchy cannot be mistaken for additive categories. Do not reactivate weekly motor-gasoline exports as one continuous history unless the June 2023 definition break is represented explicitly.

If an official source exposes finer geography, add exact provider codes and lineage. If it does not, keep the level unavailable and provide user-facing reason text. Do not create an allocation model to fill the gap.

## Credentials and commands

Read the configured replacement credential only from `EIA_API_KEY`; never commit, print, log, screenshot, or embed it in a URL stored as provenance.

Safe validation commands:

```text
pnpm run check
pnpm run build
python -m unittest discover -s tests/pipeline -p "test_*.py" -v
```

From the repository root, these commands print active query plans without network calls:

```text
python -m pipeline.energy_dashboard.cli refresh-eia --dry-run
python -m pipeline.energy_dashboard.cli refresh-canada --dry-run
```

The Canada refresh is credential-free:

```text
python -m pipeline.energy_dashboard.cli refresh-canada --store data/cache/canada --promote-to public/data/canada
```

Follow [`docs/update-runbook.md`](docs/update-runbook.md) for credentialed EIA refresh, Canada polling, bounded windows, promotion, retention, and recovery. The Canada workflow is `.github/workflows/refresh-canada.yml`; it polls twice on weekdays, preserves last-known-good data on failure, and performs no write/deploy on a no-op. Scheduled freshness remains `unknown` without a reviewed expected-period calendar, and provider release time may legitimately be unavailable.

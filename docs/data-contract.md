# Data contract

## Goals

The contract makes values comparable, auditable, revision-aware, geography-aware, and safe to publish as static assets. Provider-specific fields are preserved in raw metadata while stable internal identifiers keep the UI independent of upstream label changes.

## Core entities

### `ProviderMetadata`

| Field | Meaning |
|---|---|
| `id` | Stable lowercase provider ID, for example `eia`, `statcan`, `cer` |
| `name` | Display name |
| `homepage` | Official public landing page |
| `countries` | ISO alpha-3 country codes covered |
| `timezone` | Provider release timezone; timestamps are still stored in UTC |

### `SeriesDefinition`

| Field | Meaning |
|---|---|
| `id` | Stable semantic series ID; never contains a secret |
| `provider_id` | Provider foreign key |
| `metric_id` | Stable concept ID shared by comparable series |
| `name` | User-facing series name |
| `unit` | Canonical display/storage unit |
| `frequency` | `daily`, `weekly`, `monthly`, etc. |
| `aggregation_rule` | One of `sum`, `ratio_of_sums`, `weighted_average`, `not_aggregatable`, with required input references |
| `default_geography_level_id` | Smallest useful official default verified for this series |

Registry extensions include source route/PID, dimensions, period semantics, release/freshness behavior, activation status, caveats, and `geography_availability`.

### `Observation`

| Field | Meaning |
|---|---|
| `provider_id` | Provider foreign key |
| `series_id` | Series foreign key |
| `period` | Canonical reference period label/date, not retrieval date |
| `geography_id` | Stable geography node |
| `value` | Numeric canonical value or null with explicit status |
| `unit` | Canonical unit; must agree with the definition |
| `retrieved_at` | UTC instant when this payload was obtained |
| `source_updated_at` | Provider update instant when explicitly supplied; null otherwise |
| `dimensions` | Canonically ordered product/process/grade/flow and other series dimensions |

The logical observation key is:

```text
(series_id, period, geography_id, canonical_dimensions_hash)
```

`provider_id` is retained for lineage and must agree with the series provider. Duplicate keys in one canonical snapshot are an error.

### `GeographyLevel`

| Field | Meaning |
|---|---|
| `id` | Stable level ID |
| `label` | User-facing label |
| `granularity_rank` | Display ordering only; lower is finer in this project |

### `GeographyNode`

| Field | Meaning |
|---|---|
| `id` | Stable project ID |
| `name` | Display name |
| `level_id` | Geography level foreign key |
| `country_code` | ISO alpha-3 code |
| `parent_ids` | Zero or more larger nodes in the DAG |
| `provider_codes` | Provider-specific codes/labels; never used as the sole stable ID |

### `GeographyAvailability`

| Field | Meaning |
|---|---|
| `metric_id` | Metric binding |
| `series_id` | Optional more-specific series binding; takes precedence |
| `source_geography_ids` | Nodes published directly by the provider |
| `allowed_rollup_geography_ids` | Computable parent nodes after coverage/aggregation validation |

Illustrative registries may use level IDs during discovery when exact node codes are not yet verified. Activation requires resolved node-level availability. All 67 active USA definitions use explicit accepted geography IDs/codes; raw trade aliases such as `NUS-Z00` and `R10-Z00`, weekly production region `R48`, and local stock area `YCUOK` map to stable project nodes rather than becoming ad hoc geographies.

### `RevisionEvent`

Recommended fields:

```text
revision_id
observation_key
old_value
new_value
old_status
new_status
detected_at
retrieval_id
raw_snapshot_checksum
reason_if_known
```

The first observed value is not a revision. A change to a past key is. Corrections from null/suppressed to numeric and numeric to unavailable are revision events too.

### `UpdateManifest`

Recommended fields:

```text
run_id
provider_id
started_at
completed_at
status
retrieval_ids
registry_version
raw_checksums
latest_period_by_series
rows_inserted
rows_revised
rows_unchanged
validation_results
asset_checksums
last_success_at
failure_summary
```

### `ChartAssetManifest`

Contains asset/schema version, series, geography, period range, generation time, observation/revision/freshness summary, source attribution, checksum, and any aggregation lineage. The frontend uses the manifest to avoid presenting stale or incompatible files as current.

### `ForecastAsset`

A forecast is a separate public record, never an `Observation` and never a member of the observed seasonal baseline. The current schema is `1.0.0` and includes:

```text
schema_version
methodology_version
forecast_kind
status and reason
target_series_id and target_view_id
geography_id and canonical dimensions
frequency and unit
generated_at
training_source_checksum
origin
horizon
model
points
prediction_intervals
backtest
limitations
```

`forecast_kind` is `univariate_statistical_projection` or `fundamentals_augmented_statistical_projection` in generated assets. A validated browser-computed regional forecast is labelled `bottom_up_custom_geography_projection` at runtime and is never written over a source geography. `horizon.periods` is exactly 3 for both weekly and monthly assets. Each point has a consecutive horizon, target period, point value, seasonal year/slot, calibration-error count, and nested `80`, `90`, and `95` lower/upper **prediction intervals**. They are not confidence intervals. `prediction_intervals.coverage_guarantee` is false.

`model` records all six candidate IDs/labels, rolling-origin error counts and MAEs, the selected model, `rolling_origin_minimum_mae`, and the selection window. `origin` records the latest numeric value/period, training window/count, information cutoff, data-vintage/source checksum, and latest-stored-provider-value vintage policy. `backtest` records evaluation mode/status/window, MAE, RMSE, bias, directional accuracy, interval coverage, seasonal-naive MAE, skill, and horizon-level diagnostics where an independent holdout exists.

Allowed current statuses are `ok`, `limited_history`, `latest_source_non_numeric`, `insufficient_history`, and `unsupported_frequency`. `limited_history` can contain points and intervals but no independent final holdout. An unavailable status contains no fabricated points and includes a user-facing reason. In particular, `latest_source_non_numeric` prevents an older numeric value from masking a new suppressed, withheld, missing, or unavailable source period.

### USA public asset profile

The USA app uses public schema `1.0.0`. The country manifest lists active series, source attribution, freshness, exact available/unsupported geographies, and local chart-asset paths. Each series entry carries explicit `series_id` and `view_id`; the stable series ID is also the view ID so selectors never depend on a display label. Each chart asset is scoped to one series/geography/canonical-dimension combination and contains:

```text
schema_version
methodology_version
series_id
geography_id
dimensions
frequency
unit
generated_at
source_checksum
history
recent_years
baseline
latest
distribution.levels
distribution.changes
aggregation_lineage
freshness
```

Each manifest geography entry also contains:

```text
forecast_path
forecast_sha256
forecast_bytes
```

The corresponding file uses the observed asset's relative series/geography/dimension key under `forecasts/` rather than `assets/`. The country manifest also includes `asset_build_id`, `forecast_methodology_version`, and `forecast_summary` counts for ready, limited-history, and unavailable records. Current build ID `observed-2026-07-20.1_forecast-2026-07-20.4` binds the observed and forecast methodologies. Forecast records may additionally carry a `fundamentals` object (identity, driver lineage, inclusion status, selection outcome) when the target has a registered accounting-identity candidate; `forecast_kind` is then `fundamentals_augmented_statistical_projection`. Ready forecasts also carry `aggregation_residuals`: ordered actual-minus-calibrated-point samples keyed by horizon and target period, with calibration-window metadata. These samples exist only to recalibrate authorized additive regional combinations and must never be treated as observations.

The forecast's training checksum, target/view, geography, dimensions, frequency, unit, and origin period must agree with the observed asset. The frontend fails the forecast closed on any mismatch while preserving the observed chart. A forecast can never overwrite `recent_years`, change `latest`, or turn a nonnumeric source state into a numeric observation.

Canonical observations and the full revision ledger stay outside the public asset. A future public revision summary must be purpose-built and must not expose internal paths, credentials, credentialed URLs, or unnecessary raw source data. Forecast evaluation mode `latest_revised_pseudo_out_of_sample` means the rolling origins use the latest stored revised provider history; it is not a reconstruction of first-release vintages. Forecasts are decision support, not trading advice, and the current contract does not claim machine learning.

### Optional dashboard classification

An active series can include a public `classification` object:

```text
dashboard_group
product_family_id
product_family_label
product_id
product_label
measure_id
measure_label
component_role
parent_product_id
reference_term_ids
display_order
```

`dashboard_group: refined_products` identifies the Refined definitions consumed by the unified `/usa/` page; Phase 4 uses `dashboard_group: usa_crude` for new crude definitions. `/products/` is only a backwards-compatible wrapper that opens the USA page with Refined selected. `reference_term_ids` must resolve to committed glossary entries. `parent_product_id` and `component_role` describe navigation and double-counting cautions; they do not authorize addition, stacking, or a computed rollup. Classification is optional for older overview entries and does not change the logical observation key.

### Country dashboard selection contract

The primary data routes are `/usa/` and `/canada/`; `/reference/` is the educational surface. The UI resolves manifest entries in this order:

```text
market segment -> geography level -> geography node
-> product family -> product/activity -> measure -> series asset
```

Market segment is `crude` or `refined`. The promoted USA manifest resolves 11 Crude/56 Refined definitions (66 weekly and one monthly) and validates all 67 definitions across 326 observed assets and matching forecast records. Canada resolves 22 Crude/29 Refined definitions (51 definitions: 49 Statistics Canada and 2 CER). Promoted Canada run `canada-20260720T192043Z` validates all 51 definitions across 404 observed assets and matching forecast records. Refinery activity belongs under Crude for navigation only and retains its original metric, unit, source, and observation identity.

Geography levels are ordered by registered granularity rank from finest to broadest. The selected exact geography node filters every later option; family, product/activity, and measure choices must be backed by an available asset for that node. Product/activity ordering traverses only registered `parent_product_id` relationships and places leaves before broader parents. Missing parents are not synthesized. A selection change may preserve later IDs only while they remain compatible; otherwise the UI falls back deterministically to the first valid option.

### Custom geography runtime contract

`config/aggregation/custom-geography.json` authorizes a finite set of same-level additive combinations and records country, level, rule, membership namespace/version, member bounds, complete-coverage requirement, and exact series IDs. A selection of two or more regions is valid only when every selected geography has the same active series asset and the rule explicitly covers that series/level. Phase 4 adds exactly nine PADD-authorized definitions: crude refinery inputs, commercial crude stocks/imports, total petroleum imports, propane stocks/imports, and residual stocks/production/imports. No Phase 4 ratio, net flow, export, product-supplied, or source-region view is implicitly aggregatable.

Generated chart assets publish compact `history` rows with `period`, seasonal `year`/`slot`, numeric-or-null `value`, and source status. The browser aggregates these period rows first, retaining a per-period coverage/lineage record, then recomputes the full chart asset. A computed combination receives a deterministic `computed:<policy>:<members>` geography ID and `origin: computed-rollup`; it is not added to the source manifest. The source checksum is the SHA-256 digest of sorted component checksums. Latest source and latest numeric periods remain distinct.

Statistics Canada public dimensions include geography-specific `coordinate` and `vector` lineage identifiers. For a same-view province/territory combination, those two fields are normalized out of the semantic-dimension compatibility hash, while component geography IDs, asset checksums, and observation keys remain in lineage. All other dimensions must match exactly.

For a combined forecast, all component records must match schema, series, level, unit, frequency, semantic dimensions, methodology, three-period horizon, origin period, and membership. Point values are summed. Prediction intervals are recalibrated from component residual samples intersected on both `(horizon,target_period)`, with at least 40 aligned sums per horizon. Component lower/upper bounds are never added. A mismatch or inadequate residual sample withholds only the combined forecast.

## Identifiers and dimensions

- IDs use lowercase ASCII segments separated by dots for series and colons or underscores for geography/provider codes as defined by implementation.
- Display labels may change without changing IDs.
- Provider codes are data, not internal identity.
- Dimension maps are sorted before hashing and use canonical IDs rather than labels.
- A new concept or incompatible methodology receives a new series ID or an explicit break; it is not silently mapped to an old series.

Refined-product parent/child IDs are overlapping economic concepts, not mutually exclusive dimensions. Total gasoline, finished gasoline, MGBC, conventional/reformulated gasoline, CBOB/RBOB, and total/sulfur-grade distillate must retain their declared component roles. Fuel ethanol is a contextual oxygenate and is not an MGBC child. A user or asset consumer must never infer additivity merely because `parent_product_id` exists.

The Statistics Canada crude hierarchy follows table 25-10-0063-01 exactly. Total crude production has net field production and synthetic crude as children. Net field production has light-and-medium crude, heavy crude, and non-upgraded bitumen as children. Non-upgraded bitumen is the signed reconciliation `in-situ + mined - sent for further processing`; the processing row therefore uses a subtractive component role and must never be stacked as positive production. Equivalent-products production is a separate parent for condensate and pentanes plus, outside total crude production. Condensate combines lease and plant condensate in the source and light-and-medium crude is a combined grade; neither may be split by the application.

Total input to Canadian refineries has grade-specific child views for light-and-medium crude, heavy crude, crude bitumen, and synthetic crude. These are monthly intake volumes, not production, capacity, or utilization. Source dimension metadata also declares a condensate-and-pentanes-plus refinery-input child, but the current fact file contains no observations for it; an empty declaration is not an active series, a zero, or permission to reconstruct suppressed residuals. Parent links remain navigation and disclosure metadata only. Source symbols and latest-source-versus-latest-numeric periods remain authoritative at every hierarchy level.

## Period semantics

Every series defines:

- frequency;
- provider period format;
- whether the date is period start, period end, week ending, month, or publication date;
- provider timezone;
- canonical period conversion;
- duration/average/point-in-time semantics.

Weekly week-ending values must not be grouped with ISO week averages without an explicit alignment rule. Month-end stocks and monthly-average flows are not interchangeable merely because both use `YYYY-MM`.

## Value and missing-state semantics

Never coerce a provider symbol to zero. Canonical status should distinguish at least:

- `observed`;
- `preliminary`;
- `revised` (presentation metadata; the current numeric value remains observed/preliminary as appropriate);
- `missing`;
- `not_available`;
- `not_applicable`;
- `suppressed_or_withheld`;
- `use_with_caution`;
- `computed`.

Raw symbol, provider note IDs, scale factor, and original unit remain in lineage.

For the EIA adapter, null/`NA` maps to `not_available`, `W` to `suppressed_or_withheld`, `-` to `missing`, and `--` to `not_applicable`. Numeric zero remains an observed zero. EIA petroleum routes can return parallel unit rows; the selected unit is part of provider-row identity, and only the registry's exact expected unit enters the canonical series.

## Units

Normalize only with deterministic, documented conversions. Store original value/unit alongside canonical lineage. Volume, flow rate, percentage points, percent change, and price are distinct dimensions:

- barrels and thousand barrels cannot share a value without scaling;
- barrels per day cannot be summed across time to produce barrels without a duration rule;
- percentage-point change is not percent change;
- refinery utilization is a ratio and cannot be summed or simply averaged across regions.

USA market semantics are contract fields, not optional copy: ending stocks are point-in-time levels in thousand barrels; production, product supplied, imports, and exports are weekly average rates in thousand barrels per day. Product supplied is an accounting proxy/implied demand, not measured consumption. Unadjusted net production and net imports can be negative. Import PADD identifies district of entry. Total distillate is broader than road diesel. Commercial crude stocks, SPR stocks, and inclusive crude stocks are overlapping alternate views. Phase 4 days supply uses canonical unit `days` and exact provider unit `DAYS`; it is a source-published ratio and cannot be summed.

The display-unit selector never mutates canonical data. `src/lib/units.ts` uses the exact factor `1 barrel = 0.158987294928 cubic metres` and separately defines volume, ordinary daily-rate, calendar-day-rate, percent, and duration dimensions. A selected display scale applies consistently to cards, axes, tooltips, tables, seasonal statistics, histograms, forecasts, and intervals. The `thousand_barrels_per_day` choice is written out as “Thousand barrels per day” in the selector and abbreviated `kb/d` in compact chart displays. Aggregation and checksum validation always use source units first. Unknown units fail closed; percent and days are source-only and have no cross-dimension display conversion.

`config/display/monthly-average-rate.json` is the sole authorization list for the Canada monthly-average `kb/d` derivation. Registered Statistics Canada monthly flow volumes use their strict `YYYY-MM` Gregorian day count and the exact barrel conversion; history is transformed period by period before every displayed statistic is recomputed. Source checksums, status, freshness, dimensions, and aggregation lineage are retained. Ending/closing stocks, percentages, unregistered series, malformed periods, missing history, and incompatible units fail closed. Forecast point values and bounds use their target period's day count after all canonical forecast and combination calculations; scale-dependent model-selection and backtest metrics remain labelled in source monthly cubic metres.

## Geography semantics

The same control exists for all charts, but validity is series-specific. The smallest official node is preferred; larger values are either provider-published or computed under a registered rule. A geography graph edge is insufficient permission to aggregate. See [geography.md](geography.md).

Every computed geographic observation adds lineage:

```text
aggregation_kind
input_series_ids
component_observation_keys
membership_version
expected_component_count
observed_component_count
coverage_ratio
reconciliation_to_published_total
computed_at
```

## Revision model

The canonical table represents the latest known value. The append-only revision ledger preserves what changed and when the project learned it.

On retrieval:

1. normalize the overlap window;
2. compare each logical key with current canonical state;
3. insert unseen keys;
4. append a revision event before replacing changed keys;
5. leave identical keys untouched except for retrieval evidence;
6. recompute only affected derived assets plus any aggregates/bands that depend on them.

Do not call a normal new period a “revision.”

The registry supplies missing-series bootstrap starts of 2014-01-01 for weekly and 2014-01 for monthly data. Once a current history exists, the runner defaults to a 13-week overlap for weekly series and a 10-year overlap for monthly series. The dedicated Phase 3 helper remains available only for scoped recovery of its 36 historical additions; Phase 4 was activated, and routine updates use the 67-definition all-active registry path. An overlap with no inserted or changed value/status leaves `CURRENT` and the public asset directory untouched by default; retrieval evidence is reported by the run but does not fabricate a new data vintage.

## Time and freshness semantics

Store and label these separately:

| Field | Question answered |
|---|---|
| `period` | What week/month/day does the observation describe? |
| `source_release_at` | When did the provider say it released the data? |
| `source_updated_at` | When did the provider say the dataset changed? |
| `retrieved_at` | When did our system obtain this payload? |
| `generated_at` | When were chart assets built? |
| `deployed_at` | When did the public site artifact go live? |
| `expected_next_release_at` | When do we expect another source opportunity? |

Unknown source timestamps stay null; retrieval time must never masquerade as publication time.

Freshness status is evaluated against the expected release rule and latest period:

- `fresh`: expected period is present and validation passed;
- `due`: expected release window has opened but grace period remains;
- `late`: grace period elapsed without the expected period;
- `error`: retrieval or validation failed and no successful current run exists;
- `unknown`: no reliable schedule/rule has been configured.

`stale` may be used at the asset layer when a formerly fresh asset exceeds its allowed age even if the latest attempt did not error.

## Delta semantics

Each displayed delta names its basis:

- prior-period absolute and percent change;
- year-over-year absolute and percent change;
- percentage-point change for percent/rate metrics;
- source revision delta for the same observation key;
- difference from seasonal median;
- seasonal percentile or z-score.

A source revision delta is never mixed into the market-period delta.

## Validation gates

Deployment-blocking checks include:

- schema and required-field validity;
- known series/provider/geography IDs;
- logical-key uniqueness;
- numeric parsing and missing-state preservation;
- unit/frequency/period compatibility;
- registry-to-provider metadata drift;
- geography availability and provider-code resolution;
- aggregation kind/input requirements;
- exact coverage and membership validity for rollups;
- plausible latest-period advancement;
- unexpected row-count collapse or historical truncation;
- secret-pattern scanning of public assets and logs;
- asset checksums and referential integrity.
- canonical JSON at or below the 90 MiB publication guard.

Plausibility thresholds generate review failures or warnings; they must not silently clip or replace official values.

## Versioning

Use independent versions for registry, canonical schema, and public asset schema. Breaking changes require a migration plan and compatible deployment ordering. The static site should refuse an unsupported asset major version with an explanatory error rather than misrender it.

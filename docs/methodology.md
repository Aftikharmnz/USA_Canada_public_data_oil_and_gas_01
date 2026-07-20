# Analytical methodology

## Principles

- Preserve the provider's economic concept; never improve a chart by changing what the series means.
- Compute statistics at the selected series and geography grain after validation.
- Separate observed/source-published, computed rollup, and future forecast values visually and semantically.
- Keep formulas, baseline windows, exclusions, sample sizes, and data vintages in asset metadata.
- Return “insufficient history” instead of an unstable statistic.

## Phase 3 USA implementation profile

The current deterministic asset builder is `pipeline/energy_dashboard/analytics.py`, with methodology version `2026-07-20.1`. It supports weekly and monthly observations and emits one asset for one series, geography, unit, and canonical dimension set. The same calculations serve the three overview definitions and all 36 activated refined-product definitions; dashboard classification changes navigation, not statistical treatment. Mixed grains, duplicate seasonal coordinates, naive timestamps, and empty/nonnumeric batches fail the build.

The implemented profile is narrower than the full candidate methodology below:

- recent overlay: the latest observed calendar/ISO year and the two preceding years;
- historical baseline: the ten years immediately before those three display years;
- minimum baseline: five complete eligible years;
- monthly completeness: all 12 calendar months have numeric values;
- weekly completeness: numeric ISO weeks 1-52 are present; week 53 remains a distinct optional slot;
- slot statistics: minimum, linearly interpolated Q1/median/Q3, arithmetic mean, maximum, and count;
- latest diagnostics: prior-period and year-over-year absolute/percent changes, baseline median distance, and empirical seasonal percentile;
- distribution samples: all usable levels in the asset history and only consecutive period-over-period changes;
- histogram: Freedman-Diaconis width where the interquartile range permits, square-root fallback, and a maximum of 40 bins;
- candidate fit: Normal only, with a minimum sample of 30, likelihood/AIC, and a Jarque-Bera statistic; the result is explicitly a candidate diagnostic, not a definitive classification.

The public asset records the calculation version, canonical checksum, generation time, frequency/unit, series/geography/dimensions, compact status-preserving period `history`, recent points, baseline eligibility/exclusions, distribution sample period, and any aggregation/freshness metadata supplied by the refresh runner.

The generated component assets use source-published EIA values only. The registered gross-input and capacity series are supporting inputs for a future computed `ratio_of_sums` utilization rollup; the displayed PADD and U.S. percentages are not arithmetic averages and are not recalculated from rounded child percentages. The browser can compute only the explicitly registered same-level additive combinations described below.

### Custom same-level regional sums

`config/aggregation/custom-geography.json` is the authorization boundary. It currently permits selected additive quantities across USA PADDs, Statistics Canada provinces/territories, and CER confidentiality regions for crude runs. It does not permit utilization percentages, mixed geography levels, overlapping PADD/subdistrict or state/special-area nodes, or any unlisted series.

For every source period, the browser aligns all selected component observations and requires 100% coverage. A suppressed, withheld, missing, not-applicable, or unavailable component makes the combined period nonnumeric with the blocking status; it is never treated as zero and no partial sum is shown. Frequency, unit, period semantics, canonical semantic dimensions, observed methodology, asset schema, membership version, and component identity must match. Per-period lineage records every expected component and validation result.

The sum is applied only to canonical period observations. Seasonal bands, recent-year overlays, latest/prior/year-ago deltas, seasonal percentile, level/change distributions, and histograms are recomputed from the combined history. Precomputed component statistics are never added. Statistics Canada `coordinate` and `vector` values differ by geography and remain component lineage identifiers; for a single manifest view they are removed from the semantic-dimension comparison while component geography IDs and checksums remain explicit.

### Display-unit conversion

Unit selection changes presentation only. Canonical history and forecast assets remain in their source unit, and aggregation happens before conversion. `src/lib/units.ts` uses exactly \(1\ \text{barrel}=0.158987294928\ \text{m}^3\). Fixed-factor conversions keep volume, ordinary daily-rate, calendar-day-rate, and percent dimensions separate. Percent remains fixed, and a change in a percent series is labelled in percentage points.

Statistics Canada monthly petroleum flows have one explicit period-normalized display view, authorized only by `config/display/monthly-average-rate.json`. For a registered monthly flow with source volume \(V_t\) in cubic metres and \(d_t\) actual Gregorian calendar days in its `YYYY-MM` period:

\[
\operatorname{kb/d}_t = \frac{V_t}{d_t\times 1000\times 0.158987294928}.
\]

The calculation uses 28, 29, 30, or 31 days as applicable, never a fixed average month. It is labelled **Thousand barrels per day (monthly average)**. The browser transforms status-preserving period history first and then recomputes recent years, seasonal bands, latest deltas and percentiles, changes, distributions, histograms, and fitted diagnostics. Missing or suppressed values remain nonnumeric. Month-end/closing inventories are point-in-time levels and are not eligible; percentages and unknown future series also fail closed.

Regional sums and combined forecasts remain in canonical monthly cubic metres through coverage validation, point summation, aligned-residual calibration, and prediction-interval construction. Only final forecast point values and interval endpoints are divided by their own target month's day count for display. Model-selection and backtest error magnitudes remain explicitly in the source monthly-volume domain because the public forecast record does not include every dated evaluation error needed for exact period-specific normalization.

### Statistics Canada crude hierarchy

Table 25-10-0063-01 publishes overlapping parent and component rows. The
dashboard exposes them as choices, not as independent quantities to stack:

```text
Crude oil production
├─ Net field production
│  ├─ Light and medium crude oil
│  ├─ Heavy crude oil
│  └─ Non-upgraded crude bitumen
│     ├─ In-situ crude bitumen production
│     ├─ Mined crude bitumen production
│     └─ Crude bitumen sent for further processing [subtracted]
└─ Synthetic crude oil production

Equivalent products production [outside crude-oil production]
├─ Condensate
└─ Pentanes plus
```

The source reconciliation is:

\[
\begin{aligned}
\text{crude production} &\simeq \text{net field}+\text{synthetic},\\
\text{net field} &\simeq \text{light/medium}+\text{heavy}+\text{non-upgraded bitumen},\\
\text{non-upgraded bitumen} &\simeq \text{in-situ}+\text{mined}-\text{sent for processing},\\
\text{equivalent products} &\simeq \text{condensate}+\text{pentanes plus}.
\end{aligned}
\]

Published whole-unit rows can differ by one cubic metre because their components
are rounded independently. The app does not manufacture a residual or force an
identity to balance. Saskatchewan equivalent-product children, for example, are
confidential even though the parent is numeric; they remain unavailable. The
grade-specific refinery-input rows are likewise child views of total refinery
inputs. The cube declares a condensate-and-pentanes-plus refinery-input member
but publishes no observation rows for it, so the app does not register or infer
that missing component.

## Implemented forecast methodology

The forecast builder is `pipeline/energy_dashboard/forecasting.py`, with schema `1.0.0` and methodology version `2026-07-20.4`. It creates a separate forecast record for each observed series/geography/dimension asset. The record's `forecast_kind` describes the candidate set that was compared: `univariate_statistical_projection` when only the target's own history competed, or `fundamentals_augmented_statistical_projection` when a registered cross-series accounting-identity candidate also competed (see the fundamental net-balance candidate below). It does not write forecasts into `recent_years`, change a canonical observation, or fill a missing source value. Weekly and monthly records both project exactly the next 3 source periods.

This is an intentionally conservative statistical phase, not machine learning. Most targets use only their own history. The single permitted cross-series extension is a registered physical accounting identity whose driver series share the target's source release; discovered correlations, weather, outages, prices, forward curves, and analyst expectations remain excluded. Forecasts are decision support, not trading advice.

### Eligibility and forecast origin

Rows are ordered by canonical period, and the model uses the latest contiguous numeric tail. The warm-up training block is at least 104 observations for weekly assets and 24 observations for monthly assets. Selection and calibration are separate, so a ready forecast needs at least 159 consecutive weekly observations or 75 consecutive monthly observations in total. A methodology break or long gap can therefore make a forecast unavailable.

Statistics Canada series `can.statcan.crude.imports.monthly` and `can.statcan.crude.exports.monthly` use a reviewed `2020-01` forecast-regime start because the source table changed methodology. Earlier observations remain visible in the historical chart but are excluded from model fitting, selection, calibration, and evaluation; the forecast origin reports this boundary. Changing, adding, or removing a regime boundary requires a reviewed forecasting-methodology/build-ID bump and a provider-free rebuild.

The latest source period must itself be numeric. If the newest source row is suppressed, withheld, missing, not available, or otherwise nonnumeric, the builder returns `latest_source_non_numeric` even when an older numeric value exists. Starting from that older value would silently impute the unavailable current period and make stale information look current. This rule is especially important for Canada, where latest source and latest numeric periods are deliberately distinct.

The origin records the latest numeric period/value, training start/end and count, generation time, information cutoff, observed source checksum as the data-vintage ID, and vintage policy `latest_stored_provider_values_at_generation_time`.

### Candidate baselines

Six deterministic univariate candidates are always evaluated, plus one registered fundamentals candidate where a documented accounting identity applies:

1. **Last observation:** repeat the most recent value.
2. **Recent mean:** repeat the arithmetic mean of the latest 13 weekly or 6 monthly observations.
3. **Robust damped trend:** extrapolate the median consecutive change with damping factor 0.85.
4. **Additive harmonic trend:** fit an additive linear trend plus two deterministic Fourier sine/cosine harmonics, using at most the latest five seasonal cycles and a small ridge term for numerical stability.
5. **Seasonal naive:** repeat the observation one seasonal cycle earlier (52 weeks or 12 months).
6. **Seasonal average:** average as many as five earlier observations from the same seasonal slot, requiring at least two.

The harmonic candidate is additive because these petroleum/refinery series can be zero or negative and should not be forced into a multiplicative or log specification.

### Fundamental net-balance candidate

`pipeline/energy_dashboard/fundamentals.py` registers cross-series driver sets that are documented physical accounting identities, never discovered correlations. The initial registrations are the national weekly refined-product balances for total distillate stocks and kerosene-type jet stocks:

\[
S_{t} = S_{t-1} + 7\,(P_t + I_t - X_t - D_t) + u_t
\]

with stocks \(S\) in thousand barrels, production \(P\), imports \(I\), exports \(X\), and product supplied \(D\) as weekly-average rates in thousand barrels per day, and \(u\) the unaccounted term (blending adjustments, movements outside the registered series, rounding). The candidate projects each future week's net flow with the same-slot seasonal average of the registered flows (up to five prior years, minimum two), estimates \(u\) as the median of the latest 13 observed balance residuals, and accumulates from the origin level. Because every driver shares the target's WPSR release, driver values at or before the rolling origin carry the same information time as the target's own history; the leakage rules and the latest-revised vintage caveat are identical to the univariate candidates.

Scope rules, all fail-closed: national (`us`) level only, because PADD balances do not close without unregistered inter-district movements; every flow term must be an active registered weekly series in thousand barrels per day; a missing or nonnumeric driver value anywhere in the target's contiguous numeric tail withholds the candidate instead of imputing a flow. Total and finished gasoline are deliberately not registered because weekly motor-gasoline exports are inactive (EIA's June 2023 definition break), and a balance that silently absorbs an export term of that size would be misleading. The candidate receives no preference: it competes in the same rolling-origin minimum-MAE selection and is published only when it wins. The forecast record's `fundamentals` block discloses the identity, driver lineage, inclusion status, and whether the candidate was selected.

### Chronological selection, calibration, and evaluation

All comparisons are rolling-origin and preserve time order. Random shuffling is prohibited.

- The target model-selection window is 52 weekly origins or 12 monthly origins. A limited history still reserves at least 13 distinct weekly selection origins or 9 distinct monthly selection origins. The candidate with minimum mean absolute error (MAE) wins.
- A later calibration window uses as many as 104 weekly or 60 monthly origins to collect horizon-specific residuals. Every displayed horizon must have at least 40 calibration errors.
- When enough history remains, a final untouched evaluation window uses 26 weekly or 12 monthly origins.

Selection and calibration are always distinct and chronological. If history can support those blocks but not an independent final holdout, the asset is explicitly `limited_history`; final holdout metrics remain unavailable. This is not silently reported as a fully evaluated model.

The selected raw forecast at horizon (h), \(\hat{x}^{raw}_{t+h}\), is median-bias calibrated using later rolling-origin residuals (e_{o,h}=x_{o+h}-\hat{x}^{raw}_{o,h}):

\[
\hat{x}_{t+h}=\hat{x}^{raw}_{t+h}+Q_{0.50}(e_{\cdot,h})
\]

### Prediction intervals

For each horizon, empirical residual quantiles create central 80%, 90%, and 95% ranges around the raw point forecast:

\[
[L_{h,p},U_{h,p}]
=
[\hat{x}^{raw}_{t+h}+Q_{(1-p)/2}(e_{\cdot,h}),
  \hat{x}^{raw}_{t+h}+Q_{1-(1-p)/2}(e_{\cdot,h})]
\]

Residual distributions need not be symmetric, so the bands can be asymmetric. Each point records the number of calibration errors supporting that horizon. These are **prediction intervals** for future observations, not confidence intervals for an estimated mean or model parameter. Their 80%/90%/95% labels are nominal empirical levels; `coverage_guarantee` is false, and realized holdout coverage can differ materially.

Ready component forecast records also export ordered `actual - published calibrated point` residual samples keyed by both horizon and target period. For a registered custom regional sum, compatible component point forecasts are added horizon by horizon. Component interval endpoints are not additive and are never summed. Instead, the browser intersects every component residual set on the exact `(horizon, target_period)` key, sums each matched residual vector, and applies empirical 10/90, 5/95, and 2.5/97.5 percentiles around the combined point. Every horizon requires at least 40 aligned combined residuals. Any origin, method, checksum, dimension, unit, frequency, membership, horizon, or residual mismatch withholds the combined forecast while retaining the combined observed chart. The custom aggregate has no independent aggregate holdout evaluation, so it is labelled `limited_history` even when component holdouts exist.

The UI overlays the dashed point path and one selected prediction band on the same seasonal chart as observed data. Solid observed lines, historical seasonal bands, and forecast values remain visually and semantically distinct. Hover and the accessible table expose forecast period, point, lower/upper values, level, unit, model, origin, and calibration support.

### Backtest interpretation

When an independent holdout exists, the asset reports overall and horizon-level MAE, root mean squared error (RMSE), bias, directional accuracy, and interval coverage. It also reports seasonal-naive MAE and skill relative to that benchmark:

\[
skill=1-\frac{MAE_{selected}}{MAE_{seasonal\ naive}}
\]

The seasonal-naive benchmark receives its own median calibration from the same calibration block before its holdout MAE is computed, so the comparison is apples to apples. Positive skill indicates lower MAE than seasonal naive on that holdout; it is not a return, probability of profit, or trading signal. Directional accuracy is likewise descriptive and does not account for market prices, timing, costs, or risk.

Evaluation mode is `latest_revised_pseudo_out_of_sample`. Origins move forward without peeking at later rows, but the historical input is the latest stored revised provider history at generation time. The result does **not** reconstruct first-release vintages and must not be described as a real-time or release-vintage backtest. A future model intended to predict first releases requires an as-of vintage store and publication-time-aligned features.

### Statuses and current coverage

- `ok`: points, empirical intervals, and an independent final holdout are available.
- `limited_history`: points and intervals are available, but no independent final holdout could be reserved.
- `latest_source_non_numeric`: the latest provider period is not numeric, so no point is emitted.
- `insufficient_history`: the numeric tail is too short for defensible calibration.
- `unsupported_frequency`: the asset is not weekly or monthly.

Every manifest geography has a forecast record and checksum; an unavailable record contains its reason rather than a fabricated path. The country manifest's generated `forecast_summary` is the authoritative count for the current data vintage.

### Reproducibility and integrity

Every forecast identifies target series/view, geography, canonical dimensions, frequency/unit, generation time, methodology/schema versions, training source checksum, origin/training window, model candidates and rolling-origin MAEs, selected model, calibration window/counts, points/intervals, backtest metrics, and limitations. The country manifest links it through `forecast_path`, `forecast_sha256`, and `forecast_bytes` beside the observed asset references.

The frontend validates the forecast checksum and target identity against the observed asset and requires the origin period to equal the latest numeric observation. A mismatch hides only the forecast and leaves the observed chart available. Normal changed-data refreshes rebuild both layers automatically. `rebuild-analytics` performs the same rebuild from current canonical generations with no provider network call.

## Refined-product interpretation rules

- Product hierarchy is a navigation/meaning aid, not an aggregation tree. A parent and child must not be added, stacked, or treated as independent contributions.
- Total gasoline is an inclusive headline; finished gasoline and MGBC are children. Conventional/reformulated are children of finished gasoline; CBOB/RBOB are unfinished children of MGBC. Fuel ethanol is contextual and excluded from MGBC.
- Total distillate and its sulfur-grade children overlap. Total distillate includes more uses than on-road diesel, so a chart or delta must retain the EIA distillate label.
- Ending stocks are point-in-time levels in thousand barrels. Production, product supplied, imports, and exports are weekly average rates in thousand barrels per day. Do not put levels and rates on one additive scale or infer a balance without explicit duration and scope rules.
- Product supplied is an accounting balance/proxy for implied demand, not direct consumption. Report its period changes as changes in product supplied.
- Unadjusted refinery/blender net production can be negative. Negative observations are retained and included in statistics; they are not invalidated or clipped merely for being below zero.
- Import regions describe PADD of entry, not final destination. A regional comparison therefore measures entry flows, not regional consumption.
- Weekly motor-gasoline exports are excluded because the June 2023 definition change would split the sample. No seasonal baseline crosses that break silently.

## Seasonal chart

The default seasonal chart overlays the latest three calendar/seasonal years and compares them with a historical baseline.

### Display years

- Show the current year (partial through the latest observation) and the two preceding years as separate lines.
- Never extend a partial year with zeros or carry-forward values.
- Allow the user to hide individual year lines without changing the baseline.

### Baseline window

- Default baseline: the ten complete years immediately before the three displayed years.
- Exclude all displayed years from the baseline to avoid self-comparison.
- Require at least five eligible complete years for a baseline band; otherwise show “insufficient history.”
- Store `baseline_start_year`, `baseline_end_year`, eligible year count, and excluded years in the asset.
- Methodology breaks can shorten the window or split the view. Never build a band across an incompatible break silently.

The Phase 3 registry bounds missing weekly refined-product history from 2014-01-01, and the completed activation preserved that boundary. The builder applies the same eligible-year rules and does not fabricate earlier baseline years. As the latest three display years advance, the available pre-display baseline is manifest-derived and may be shorter than ten years. The asset must expose the actual range and sample count.

### Monthly seasonal slots

Use calendar month 1–12. A complete baseline year has every expected month unless the provider's history explicitly begins/ends midyear and is excluded.

### Weekly seasonal slots

Retain the provider's week-ending date. The current builder converts that ISO date with `date.isocalendar()` and uses its ISO year and week 1-53 as the seasonal coordinate. Week 53 remains distinct; do not force it into week 52 merely to avoid a gap. Holiday-delayed publication affects retrieval time, not the reference week.

### Band statistics

For each seasonal slot across eligible baseline years calculate:

- historical minimum and maximum;
- 25th and 75th percentiles;
- median;
- arithmetic mean;
- sample count.

Default rendering:

- light min–max band;
- darker interquartile band;
- median line;
- optional mean line;
- three recent-year lines above the bands.

The min–max band can be sensitive to outliers, so the interquartile band and sample count must be available. Hover shows the selected year value, baseline min/Q1/median/mean/Q3/max, sample count, unit, geography, source, and retrieval/freshness metadata.

## Latest-value comparisons

For a latest observation \(x_t\):

- absolute period change: \(x_t - x_{t-1}\);
- percent period change: \((x_t/x_{t-1}-1)\times100\), only when the denominator is valid and nonzero;
- year-over-year change: compare with the same seasonal slot in the prior year;
- percentage-point change: \(x_t-x_{t-1}\) for percent/rate metrics;
- seasonal distance: \(x_t - median_{slot}\);
- seasonal percentile: empirical rank within the same baseline slot;
- source revision delta: new minus previously retrieved value for the exact same observation key.

The UI names the comparison period explicitly. “Delta” alone is not a sufficient label.

## Geographic aggregation

Statistics are computed after selecting a source-published value or after a valid rollup. Approved rules are `sum`, `ratio_of_sums`, `weighted_average`, and `not_aggregatable`; formulas and coverage requirements are defined in [geography.md](geography.md).

For utilization, aggregate inputs and capacity first, then divide. Do not average regional utilization percentages. Any computed value retains membership and component observation lineage and is excluded when coverage fails.

## Rolling statistics

Candidate trader-oriented measures:

- rolling mean and median;
- rolling standard deviation/volatility of changes;
- rolling min/max;
- seasonal percentile;
- standard z-score using the same seasonal slot;
- robust z-score using median and median absolute deviation where sample size permits;
- drawdown from rolling/seasonal high for stock or level series;
- rate of change and acceleration with clearly named windows.

Window length is frequency-aware and displayed (for example 4 weeks, 13 weeks, 3 months, 12 months). Do not compare a four-week average with a monthly total without conversion.

For a conventional seasonal z-score:

\[
z_t = \frac{x_t-\mu_{slot}}{\sigma_{slot}}
\]

Return null if standard deviation is zero or the slot lacks the minimum sample. A robust alternative may use \(1.4826 \times MAD\) as the scale and must be labelled robust.

## Distribution view

Provide separate analyses for:

1. **levels**, which answer where observations usually sit but may mix seasonality/trend; and
2. **changes or residuals**, which are often more useful for risk and model diagnostics.

The Phase 3 view keeps level and consecutive-change histograms visible together on a shared count scale. Each facet includes mean, median, sample standard deviation, interquartile range, skewness, excess kurtosis, sample size, sample period, and any supplied exclusions. Empirical density/CDF, box or violin summaries, and Q-Q diagnostics are planned extensions rather than current UI claims.

### Candidate distribution fitting

The current implementation tests only a Normal candidate. A later comparison may add Student-t, lognormal, gamma, and skew-normal. Any expanded comparison must apply these support constraints:

- do not fit lognormal or gamma to non-positive samples without a separately justified transformation;
- do not claim a continuous fit is meaningful for tiny or heavily rounded samples;
- do not pool incompatible methodology regimes;
- require at least 30 usable observations for a displayed candidate fit, with larger samples preferred.

Compare eligible candidates with log-likelihood/AIC and at least one goodness-of-fit diagnostic such as Anderson–Darling, Cramér–von Mises, or Kolmogorov–Smirnov with parameters estimated appropriately. Q–Q plots are preferred for diagnostic detail.

The label is **“best candidate among tested distributions”**, never “the data is [distribution].” Report all tested candidates, sample definition, estimated parameters, statistic/p-value limitations, and selection criterion. “No adequate fit” is a valid outcome.

### Seasonality and trend

Raw level distributions can be dominated by seasonal pattern or structural trend. Offer clearly separated samples such as:

- same seasonal slot across years;
- period-over-period changes;
- year-over-year changes;
- residuals after a documented baseline model.

Do not present residual diagnostics as raw-data behavior.

## Missing, preliminary, and revised data

- Missing/suppressed observations are excluded, never zero-filled by default.
- A connected chart line may visually bridge a single missing point only when the gap is marked; statistical calculations still exclude it.
- Preliminary values are shown with a status indicator.
- Revised values use the current value in charts and expose revision history in hover/detail.
- Imputation, if later introduced for modeling, remains in a separate modeling dataset and is never written back as an observed value.

## Rounding and display

Calculate with normalized full precision, retain provider precision, and round only for display. Hover should expose enough precision to reproduce displayed deltas. Percent and percentage-point changes use distinct suffixes.

## Reproducibility metadata

Every derived asset records methodology version, source/canonical checksum, generation time, series/geography IDs, period window, baseline years, exclusions, aggregation lineage, sample size, and calculation parameters.

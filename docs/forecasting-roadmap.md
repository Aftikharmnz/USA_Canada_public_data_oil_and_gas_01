# Forecasting implementation and roadmap

## Current boundary

Forecasting is now implemented as a separate analytical layer over the validated USA and Canada canonical histories. The current phase is **transparent statistical forecasting**, not machine learning. It compares six univariate baselines — plus, for targets with a registered physical accounting identity, one fundamentals candidate built from cross-series drivers in the same canonical store — calibrates empirical uncertainty from later rolling-origin errors, and overlays the resulting dashed path and one selectable band on the existing seasonal graph.

Weekly and monthly assets both forecast exactly the next 3 source periods. Users can select 80%, 90%, or 95% **prediction intervals**. A prediction interval describes a range for a future observation. It is not a confidence interval for an estimated mean or model parameter, and its nominal coverage is not guaranteed.

Forecasts are decision support, not guaranteed outcomes, personalized financial advice, trading signals, or trading advice. They never replace observed data.

## Implemented production profile

`pipeline/energy_dashboard/forecasting.py` publishes schema `1.0.0` and methodology `2026-07-20.4`. `forecast_kind` is `univariate_statistical_projection` when only univariate candidates competed and `fundamentals_augmented_statistical_projection` when a registered accounting-identity candidate also competed. Each record is linked to exactly one observed chart asset by target identity, geography, canonical dimensions, frequency, unit, and training source checksum.

The six univariate candidate baselines are:

- last observation;
- recent mean;
- robust damped trend;
- additive harmonic trend with a linear trend and two Fourier harmonics;
- seasonal naive;
- same-slot seasonal average.

`pipeline/energy_dashboard/fundamentals.py` additionally registers a **fundamental net-balance** candidate for national weekly total-distillate and kerosene-type jet stocks, built from the registered production, imports, exports, and product-supplied series through the weekly barrel-accounting identity with an estimated unaccounted term. It is a registered physical identity, not a discovered correlation; it competes in the same rolling-origin selection with no preference and is withheld fail-closed whenever any driver period is missing or nonnumeric. Gasoline is deliberately excluded because weekly motor-gasoline exports are inactive (June 2023 definition break). The published record's `fundamentals` block carries the identity, driver lineage, and selection outcome. This is partial progress toward Gate 3 using only same-release registered series; external features still require the full gate.

Candidate choice uses minimum MAE over a chronological rolling-origin selection window. A later rolling-origin window calibrates horizon-specific median corrections and empirical residual quantiles. When enough history remains, a still-later independent holdout reports MAE, RMSE, bias, directional accuracy, 80%/90%/95% interval coverage, seasonal-naive MAE, and skill versus seasonal naive. Full formulas and window sizes are in [the analytical methodology](methodology.md#implemented-forecast-methodology).

`limited_history` means points and calibrated prediction intervals exist, but the history could not also support an independent final holdout. `unavailable` records retain an explicit reason. In particular, the builder refuses to forecast when the latest source period is nonnumeric, even if an older numeric value exists; using the older value would conceal a current suppression, withholding, or unavailable state.

### Combined-region forecasts

Ready records export ordered aggregation residuals defined as actual minus the published calibrated point, keyed by horizon and historical target period. For a custom combination authorized by `config/aggregation/custom-geography.json`, the browser adds compatible component point forecasts for the same three target periods. It does not add component lower/upper interval bounds. It intersects component residuals on both keys, sums each matched residual vector, and computes new empirical 80%/90%/95% quantiles around the combined point. Every horizon requires at least 40 aligned sums. Missing components, different origins/methodologies, checksum or dimension mismatches, or inadequate aligned residuals fail the combined forecast closed while the combined observed chart remains available.

The runtime record is labelled `bottom_up_custom_geography_projection` and `limited_history` because component backtests do not constitute an independent holdout for the aggregate. This is statistical bottom-up coherence for a user-selected additive geography, not a trading strategy, national reconciliation, or machine-learning model.

## What the chart communicates

The seasonal chart keeps three concepts distinct:

- solid lines and seasonal bands are observed or source-derived history;
- the dashed line is the selected model's point forecast;
- the shaded future band is the selected empirical prediction interval.

The chart and accessible table expose the model, origin/information cutoff, horizon, point and bounds, calibration support, and backtest diagnostics. The evaluation disclosure always says that the backtest is latest-revised pseudo-out-of-sample rather than first-release vintage evaluation. A missing, stale, or incompatible forecast does not disable the observed chart.

## Vintage limitation

Rolling-origin evaluation prevents direct look-ahead to later rows, but the current canonical histories contain the provider values most recently stored when the asset is generated. Historical origins therefore see the latest revised form of earlier observations rather than a reconstruction of the exact values available on each historical release date.

The backtest mode is consequently `latest_revised_pseudo_out_of_sample`. It is useful for comparing simple univariate candidates on the current data history, but it can overstate or otherwise distort real-time performance when revisions matter. It must not be described as a release-vintage, first-release, or live trading backtest.

## Forecast glossary

### Forecast origin

The latest numeric observation from which future target periods are projected. It must match the observed asset's latest numeric period.

### Information cutoff

The latest retrieval/information time represented by the generated asset. In the current phase it is not a reconstructed historical release cutoff.

### Prediction interval

An empirically calibrated range for a future observation. The app offers nominal central 80%, 90%, and 95% ranges. Wider nominal levels normally produce wider bands, but realized coverage is measured rather than guaranteed.

### Confidence interval

A range for an estimated quantity such as a mean or model coefficient. The app does not display confidence intervals and must not use this term for its future-value bands.

### Rolling-origin evaluation

A time-ordered procedure that repeatedly trains on data available before an origin and scores later periods. It is used for model selection, residual calibration, and final evaluation without random time-series shuffling.

### Latest-revised pseudo-out-of-sample

A rolling-origin evaluation performed on the latest stored revised history. The temporal split is out-of-sample, but the vintage is not what a forecaster necessarily knew at the historical origin.

### Limited history

Enough consecutive numeric history for point selection and empirical interval calibration, but not enough to reserve a separate final evaluation window.

### Interval coverage

The fraction of evaluated outcomes inside the stated prediction interval. It is a diagnostic, not a guarantee that the next outcome will fall inside the band.

## Automatic generation and integrity

Every changed `refresh-eia` or `refresh-canada` run builds the observed asset and matching standalone forecast together. Country manifests contain `forecast_path`, `forecast_sha256`, and `forecast_bytes` for every geography asset, plus a forecast status summary. Build ID `observed-2026-07-20.1_forecast-2026-07-20.4` binds the two current methodology versions.

A source no-op creates no generation by default. When only analytics or forecasting methodology has changed, operators use `rebuild-analytics` to rebuild from the current canonical generation without provider network calls. Both paths stage, verify, and promote a complete generation atomically, retaining the previous last-known-good generation on failure. Operations are documented in [the update runbook](update-runbook.md#provider-free-analytics-and-forecast-rebuild).

The frontend validates schema, asset checksum, target/view/geography/dimension identity, frequency, unit, horizon sequence, nested interval ordering, and origin alignment. It refuses a mismatched forecast instead of mixing generations.

## Influence of the supplied books

The supplied books informed the conservative structure and the boundaries of this phase; they are not copied into the application, and textbook examples are not treated as production evidence.

- Viviana Fanelli, *Financial Modelling in Commodity Markets* (2020), pp. 34-35, motivated the deterministic sine/cosine harmonic representation of seasonality. Pages 110-113 reinforced chronological out-of-sample testing, and pp. 118-121 informed distribution and residual diagnostics.
- Matthew F. Dixon, Igor Halperin, and Paul Bilokon, *Machine Learning in Finance: From Theory to Practice* (2020), pp. 205-214, informed the use of transparent time-series benchmarks, forecast-error metrics, and walk-forward evaluation without look-ahead.
- Peng Liu, *Quantitative Trading Strategies Using Python* (2023), pp. 197-200, reinforced chronological validation, data-snooping caution, and sensitivity to changing regimes. Those cautions are why the current diagnostics are not promoted as a trading strategy.
- Les Clewlow and Chris Strickland, *Energy Derivatives: Pricing and Risk Management* (2004), pp. 17 and 33-36, informed the treatment of energy seasonality, mean reversion, jumps, and regime risk as reasons for conservative uncertainty disclosure. Its price-process models were not applied directly to physical quantity series.
- Ilia Bouchouev, *Virtual Barrels*, PDF pp. 69-76 and 160-170, informed the warnings about raw inventory nonstationarity, refined-product seasonality, barrel accounting, weak structural signals, and regime dependence. PDF pp. 204-205 and 217 reinforced look-ahead controls.
- Greg Newman, *The World of Oil Derivatives*, PDF pp. 107 and 284, reinforced the distinction between backward-looking physical statistics, expectations, and forward curves. A forward curve is not automatically a forecast and is not an input to this phase.

This implementation deliberately does **not** adopt Gaussian-process models, neural networks, gradient boosting, price diffusion models, exogenous quantamental features, or automated trading rules from the broader literature. Those require stronger data and validation gates. The fundamental net-balance candidate stays inside these boundaries because it is barrel accounting over same-release registered series — the balance framing follows Bouchouev's *Virtual Barrels* treatment of inventories as the physical anchor — rather than a fitted exogenous-feature model.

## Future release-vintage and ML roadmap

The next modeling phase should not begin merely by swapping in a more complex estimator. It needs a stronger information-time contract.

### Gate 1: define the decision problem

For each proposed target, approve:

- the exact value being forecast: level, change, seasonal deviation, or surprise;
- series, geography, product/activity, measure, frequency, origin, and horizon;
- first-release versus latest-revised target policy;
- information cutoff in the provider's release timezone;
- trader decision supported and the risk/evaluation metric.

Product semantics remain binding. Total distillate is not pure road diesel, product supplied is implied demand rather than measured consumption, and parent/child product levels are not additive.

### Gate 2: retain release-time vintages

Build an as-of table that stores each observation value/status as known at every retrieval/release, source publication time, revision sequence, and feature availability. A model intended to predict first releases cannot be trained or evaluated only on final revised history.

### Gate 3: add publication-time-safe features

Potential features include production, imports, exports, runs, utilization, stocks, product supplied, weather, maintenance/outages, transport flows, futures curves, crack spreads, basis, and volatility. Every feature needs source rights, units, geography alignment, release lag, missing-state behavior, and an as-of join rule. Higher-frequency rows cannot be aggregated using information published after the forecast origin.

### Gate 4: benchmark before ML

Retain the current simple candidates and consider exponential smoothing, ETS, ARIMA/SARIMA, and small dynamic regressions. Only then compare regularized linear models, quantile regression, tree ensembles/gradient boosting, regime/state-space models, or sufficiently supported neural sequence models.

A complex model advances only when it improves chronological, decision-relevant metrics consistently across seasons, regimes, horizons, geographies, and vintages—not merely in-sample fit or one favorable window.

### Gate 5: production governance

Future production models require versioned model/feature manifests, archived training-vintage IDs, leakage tests, calibration/error/feature-drift monitoring, baseline fallback, model review, and a final untouched forward test. Any economic simulation must separately disclose market data timing, execution assumptions, transaction costs, liquidity, slippage, and risk limits.

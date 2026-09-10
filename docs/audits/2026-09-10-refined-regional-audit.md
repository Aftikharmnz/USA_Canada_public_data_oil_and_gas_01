# Refresh resilience and refined regional accuracy audit

Audit date: 2026-09-10 UTC (2026-09-09 Edmonton). Scope: current app, promoted USA/Canada assets, refresh-sensitive tests, refined-product numerical displays and regional interaction. This is an engineering/data-semantics audit, not assurance that every provider fact is correct or a trading recommendation.

## Data vintage

- USA: `eia-20260910T044447Z`, 78 definitions, 414 observed assets and 414 forecast records. Weekly series reach 2026-08-28. Monthly availability varies by series and geography; do not label every monthly series current merely because another series has June data.
- Canada: `canada-20260910T044955Z`, 81 definitions, 583 observed assets and 583 forecast records. Statistics Canada reaches June 2026; CER reaches week 2026-08-18. Latest source and latest numeric values remain distinct.
- This audit changes UI, models, validation tests and documentation, not provider observations or public generations. Profiles continue to consume the scheduled, atomically promoted assets.

## Findings addressed

1. Refresh-sensitive tests assumed fixed numbers of available chart/route assets or universally ready forecasts. They now check exact active-registry/manifest identities, valid completed-month coverage and forecast eligibility. Missing/suppressed data and insufficient aligned residuals remain legitimate unavailable states, not forced successes.
2. Canadian pipeline route siblings can legitimately have different latest periods. The route model selects the newest source period and preserves exact missing cells instead of rejecting valid staggered coverage or stale-filling a route. Product, mode, vintage and identity checks remain strict.
3. ECharts' default same-sign stacking displaced historical/forecast bands when the lower bound was negative, and displaced waterfall bars crossing zero. Explicit all-sign stacking corrects the geometry. Actual negative historical bounds occur in 15 USA and 76 Canada observed assets; displayed source values were not rewritten.
4. National weekly balance inputs now reject mixed geography, product, source dimensions, units, vintage, duplicate weeks and invalid value/status combinations. An older complete-week fallback, four-week averaging, caution/preliminary observations and cached inputs are disclosed.
5. New refined regional components validate exact identity, source period and status. Stocks and flows cannot share a summed scale or an unauthorized volume-to-rate conversion. Weekly dates use ISO week-year coordinates, including January dates belonging to the previous ISO year.
6. Browser inspection caught and corrected a stretched expansion-button hit area in the new panel. The shared expanded-card trigger now remains hidden while its modal is open.

## Numerical verification

The promoted-asset audit covers all 694 refined observed charts across 106 definitions (57 USA and 49 Canada). It independently checks latest source/numeric observations, exact adjacent changes and seasonal coordinates; it compares browser-recomputed baseline, distribution and diagnostic outputs with published outputs. Tests are bounded per series rather than one growing country-wide timeout. This demonstrates internal consistency, not independent reconstruction of every source observation or vintage backtest.

Additional regressions cover missing/suppressed periods, negative net inputs, unit/vintage/identity drift, native-monthly precedence, complete weekly-to-monthly coverage, calendar-month daily-rate conversions and comparison controls. Existing forecast and aggregation tests continue to enforce prediction-interval and complete-coverage requirements.

Local release verification: 657 frontend tests across 48 files, TypeScript, 124 Python pipeline tests, internal documentation links and the production GitHub Pages build passed. Browser checks covered Alberta finished gasoline and blending components, British Columbia product preservation, `kb/d` and `bbl/d`, previous-month comparison, expandable charts and Escape, plus PADD 2 finished gasoline in weekly and derived-monthly modes. A narrow viewport was checked and large-value axis labels shortened without changing hover values. The existing large-JavaScript-bundle warning remains a performance optimization opportunity, not a build failure.

## Official-source spot check and source limits

The current [Statistics Canada full 25-10-0081 cube](https://www150.statcan.gc.ca/n1/tbl/csv/25100081-eng.zip) was checked against promoted Alberta June 2026 observations. All ten selected values matched:

| Product | Net production / net inputs | Imports | Exports | Stock change | Ending stocks |
| --- | ---: | ---: | ---: | ---: | ---: |
| Finished motor gasoline | 644,298 | 17 | 0 | 3,209 | 20,507 |
| Motor gasoline blending components | -341,818 (net inputs) | 3,045 | 0 | 31,187 | 337,912 |

All values are source cubic metres for the month; ending stocks are inventory levels, not monthly flows. The negative blending-component net-input value is valid source accounting and is not converted to positive production.

The [Statistics Canada table](https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=2510008101) does not supply provincial product-supplied observations for these products. Its declared net-interregional-receipts dimension has no current fact rows. Provincial demand must not be inferred by subtracting the available terms, allocating Canada demand, or using broader pipeline movements.

[EIA monthly PADD supply/disposition](https://www.eia.gov/dnav/pet/pet_sum_snd_d_r20_mbbl_m_cur.htm) publishes richer refined-product balances than this app currently registers, including exact receipts, exports and product supplied. [EIA methodology](https://www.eia.gov/petroleum/supply/annual/volume2/pdf/psmnotes.pdf) also requires applicable biofuel production, adjustments, refinery/blender inputs and other source terms. Production + imports - exports - stock change alone is not a valid general regional-demand identity.

## User-facing result

Country → Regional profile → Refined now adds an available-components panel for the exact selected region/product. It has historical source-period selection, previous-period comparison, compact independent flow/inventory units, source/status details and an accessible expanded view. Existing seasonal charts remain below. Missing demand and receipt terms are visible, and the panel is labelled **Not a closed balance**.

## Remaining boundaries

- Highest-priority data expansion: onboard reviewed native EIA monthly refined PADD supply/disposition cohorts, starting with finished gasoline and gasoline blending components, with complete source coordinates and storage/contract tests. No new source definition is activated by this UI release.
- A closed Canadian provincial gasoline balance cannot be produced from the current table. Additional compatible official provincial demand and product-specific domestic movement data would need to be verified before claiming closure.
- GitHub-hosted runner failures, provider outages/rate limits, changed provider contracts, concurrency queue cancellation, concurrent data commits and storage guards can still interrupt future runs. No test suite guarantees every future run succeeds. Last-known-good retention and strict rejection of genuine corruption remain intentional.
- Forecast accuracy is statistical and uncertain; the audit does not turn forecasts into guaranteed outcomes or first-release vintage backtests.

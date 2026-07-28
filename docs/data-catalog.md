# Data catalog

## Status and activation rule

The USA registry has 69 definitions with `activation_status: active`: the 67
definitions in the promoted Phase 4 generation plus two registered monthly
PADD origin-destination movement definitions. The active set is 66 weekly plus
three monthly definitions. The two movement definitions add 17 exact crude
route keys and 18 exact total-petroleum-products route keys, all activated in
the current promoted generation. Gross refinery input and operable capacity remain
`verified_supporting_phase_2`, and two generic route candidates remain
illustrative.

The complete USA registry is publicly activated in promoted run `eia-20260728T164833Z`. The run contains all 69 definitions, 217,223 canonical observations, 361 verified observed chart assets, and 361 matching forecast records (722 integrity entries). Canonical JSON is 89,851,624 bytes (85.69 MiB), below the 90 MiB guard. The merge inserted 4,711 rows, revised 0, and matched 8,951 unchanged rows; forecast status is 353 ready, 1 `limited_history`, and 7 unavailable. All 66 weekly definitions reach `2026-07-17`; monthly crude production and the 17 crude PADD routes reach `2026-04`. The total-products movement manifest conservatively reports `2026-03`, with 16 of 18 route assets reaching `2026-04`. Workflow run `30379912166` successfully deployed the matching site. Registry activation remains ingestion eligibility; the generated manifest and asset verification prove publication.

The Canada registry has 69 active definitions: 67 Statistics Canada definitions across tables 25-10-0063-01, 25-10-0077-01, and 25-10-0081-01, plus 2 CER weekly definitions. They are classified as 31 Crude and 38 Refined choices. Promoted local run `canada-20260728T143908Z` contains 60,814 canonical observations, 467 verified observed chart assets with 467 matching forecast records (934 integrity entries), and 29,518,923 bytes (28.15 MiB) of canonical JSON; public assets occupy 12.67 MiB. Its merge inserted 11,088 rows, revised 0, and matched 44,908 unchanged rows. Statistics Canada balance tables 25-10-0063-01 and 25-10-0081-01 reach source month `2026-04`, movement table 25-10-0077-01 reaches `2026-05`, and CER reaches week `2026-06-16`. Forecast status is 360 ready, 74 `limited_history`, and 33 unavailable. The previous last-known-good generation is `canada-20260720T192043Z`; retention keeps the current and previous generations and pruned `analytics-20260720T152511Z`. Registry activation alone means a definition is eligible for ingestion; the promoted manifests and integrity verification prove local publication, not public GitHub Pages deployment.

Activation requires:

- official route, table, or download identity;
- current dimensions/facets and provider codes;
- value field, unit, scale, and frequency;
- period start/end semantics and timezone;
- smallest published geography for each metric/dimension combination;
- provider-published larger geographies and defensible computed rollups;
- missing, suppressed, preliminary, and revision behavior;
- expected release/freshness rule;
- source terms and stable attribution link;
- fixtures and contract tests.

API discovery is part of ingestion. A stale catalog entry must fail closed rather than request a plausible-looking replacement route.

## USA — U.S. Energy Information Administration

Primary documentation: [EIA API v2](https://www.eia.gov/opendata/documentation.php). The API is hierarchical and self-describing; route metadata exposes available frequencies, data fields, and facets. The configured replacement API key is supplied only at runtime through `EIA_API_KEY`.

| Candidate | Official route/page | Frequency | Geography expectation | Aggregation | Current status |
|---|---|---|---|---|---|
| Refinery utilization and inputs | [`petroleum/pnp/wiup`](https://www.eia.gov/opendata/browser/petroleum/pnp/wiup) | Weekly | Selected utilization: five PADDs and U.S. | Published utilization active; gross inputs/capacity verified supporting; any computed utilization uses `ratio_of_sums` | Phase 2 active/supporting |
| Petroleum stocks | [`petroleum/stoc/wstk`](https://www.eia.gov/opendata/browser/petroleum/stoc/wstk) | Weekly | Exact active product slices are PADD/U.S.; five also publish PADD 1A/1B/1C | Source-published only in Phase 3 | Phase 3 refined products active; generic candidate illustrative |
| Refinery/blender net production | [`petroleum/pnp/wprodrb`](https://www.eia.gov/opendata/browser/petroleum/pnp/wprodrb) | Weekly | Active products publish PADD 1-5 and U.S. | Source-published only in Phase 3 | Phase 3 active |
| Imports/exports | [`petroleum/move/wkly`](https://www.eia.gov/opendata/browser/petroleum/move/wkly) | Weekly | Active imports publish PADD/U.S.; active exports are U.S.-only | Source-published only in Phase 3 | Phase 3 selected products active; generic candidate illustrative |
| Product supplied (implied demand) | [`petroleum/cons/wpsup`](https://www.eia.gov/opendata/browser/petroleum/cons/wpsup) | Weekly | Active total-products and refined-product slices are U.S.-only | `not_aggregatable` | Phase 2 overview and Phase 3 products active |
| Weekly petroleum summary | [`petroleum/sum/sndw`](https://www.eia.gov/opendata/browser/petroleum/sum/sndw) | Weekly | Exact Phase 4 series keys expose Alaska/Lower 48/U.S., Cushing/PADD/U.S., PADD/U.S., combined source districts, or U.S.-only according to the measure | Source-published views plus nine explicitly registered additive PADD definitions | Phase 4 active and publicly deployed |
| Crude oil production | [`petroleum/crd/crpdn`](https://www.eia.gov/opendata/browser/petroleum/crd/crpdn) | Monthly | 32 states, 3 special areas, five PADDs, U.S. | Use source-published PADD/U.S. totals; do not sum overlapping special areas | Phase 2 active |
| Inter-PADD movements | [`petroleum/move/ptb`](https://www.eia.gov/opendata/browser/petroleum/move/ptb) | Monthly | Exact shipping-PADD → receiving-PADD corridors | `not_aggregatable`; no invented national total | Crude and total-products definitions registered; see [USA PADD movements](usa-padd-movements.md) |
| Spot/retail prices | EIA petroleum prices routes, selected after metadata review | Daily/weekly/monthly | Market location or route-specific area | Usually `not_aggregatable`; a price needs a justified weight | Later expansion |

### Legacy overview coordinates retained in Phase 4

| Stable series ID | Filters/series identifiers | Expected unit | Verified published geography |
|---|---|---|---|
| `usa.eia.refinery.utilization.weekly` | `W_NA_YUP_R10_PER`, `W_NA_YUP_R20_PER`, `W_NA_YUP_R30_PER`, `W_NA_YUP_R40_PER`, `W_NA_YUP_R50_PER`, `WPULEUS3` | `%` | PADD 1-5 and U.S. |
| `usa.eia.product_supplied.weekly` | series `WRPUPUS2`; expected `duoarea=NUS`, `product=EPP0`, `process=VPP` | `MBBL/D` | U.S. only |
| `usa.eia.crude.production.monthly` | `product=EPC0`, `process=FPF`, then exact unit row `MBBL/D` | `MBBL/D` | 32 states, 3 special areas, PADD 1-5, U.S. |

The crude state rows are Alabama, Alaska, Arizona, Arkansas, California, Colorado, Florida, Idaho, Illinois, Indiana, Kansas, Kentucky, Louisiana, Michigan, Mississippi, Missouri, Montana, Nebraska, Nevada, New Mexico, New York, North Dakota, Ohio, Oklahoma, Pennsylvania, South Dakota, Tennessee, Texas, Utah, Virginia, West Virginia, and Wyoming. The special rows are Alaska South, Federal Offshore - Gulf of America, and Federal Offshore PADD 5.

An audit of the full `EPC0`/`FPF` rate history found exactly the 41 registered EIA `duoarea` values: those 35 state/special rows, five PADD rows, and the United States. This does not authorize summing them together; state/special rows can overlap concepts already represented in official PADD/U.S. totals.

The crude route returns parallel representations in multiple units. The active registry includes `units` in local row identity and selects `MBBL/D` only; other-unit rows are deliberately excluded rather than converted implicitly. Activation fails if the expected unit disappears.

The exact machine-readable query and geography mappings remain authoritative in [`config/series/usa.json`](../config/series/usa.json) and [`config/geographies/usa.json`](../config/geographies/usa.json).

### Phase 3 exact refined-product slices

The 36 active additions are intentionally narrow product/process queries. Each definition validates `period`, `duoarea`, `product`, `process`, provider `series`, and `units` as row identity, plus exact source geography IDs and expected units. Similar labels elsewhere on a route do not enter the series automatically.

| Measure / EIA process | Active product codes | Count | Geography |
|---|---|---:|---|
| Ending stocks / `SAE` | `EPM0`, `EPM0F`, `EPM0C`, `EPM0R`, `EPOBG`, `EPOBGCC`, `EPOBGRR`, `EPOOXE`, `EPD0`, `EPDXL0`, `EPDM10`, `EPD00H`, `EPJK` | 13 | PADD/U.S.; `EPM0`, `EPD0`, `EPDXL0`, `EPDM10`, and `EPD00H` also PADD 1A/1B/1C |
| Unadjusted net production / `YPR` | `EPM0F`, `EPM0C`, `EPM0R`, `EPD0`, `EPDXL0`, `EPDM10`, `EPD00H`, `EPJK` | 8 | PADD 1-5 and U.S. |
| Product supplied / `VPP` | `EPM0F`, `EPD0`, `EPJK` | 3 | U.S. only |
| Imports / `IM0` | `EPM0F`, `EPOBG`, `EPOBGCC`, `EPOBGRR`, `EPOOXE`, `EPD0`, `EPDXL0`, `EPDM10`, `EPJK` | 9 | PADD 1-5 and U.S.; PADD means district of entry |
| Exports / `EEX` | `EPOOXE`, `EPD0`, `EPJK` | 3 | U.S. only |

Product codes used here mean:

| Code | Display concept | Hierarchy note |
|---|---|---|
| `EPM0` | Total motor gasoline | Inclusive headline; contains finished gasoline and MGBC |
| `EPM0F` | Finished motor gasoline | Contains conventional and reformulated finished gasoline |
| `EPM0C` | Conventional motor gasoline | Child of finished gasoline |
| `EPM0R` | Reformulated motor gasoline | Finished reformulated gasoline, not RBOB |
| `EPOBG` | Motor gasoline blending components (MGBC) | Contains CBOB, RBOB, and other blending components |
| `EPOBGCC` | CBOB | Unfinished conventional blendstock; child of MGBC |
| `EPOBGRR` | RBOB | Unfinished reformulated blendstock; child of MGBC |
| `EPOOXE` | Fuel ethanol | Contextual gasoline oxygenate; explicitly not part of MGBC |
| `EPD0` | Total distillate fuel oil | Broader than road diesel |
| `EPDXL0` | Distillate, 0-15 ppm sulfur | Sulfur-grade child of total distillate |
| `EPDM10` | Distillate, over 15-500 ppm sulfur | Sulfur-grade child of total distillate |
| `EPD00H` | Distillate, over 500 ppm sulfur | Sulfur-grade child of total distillate |
| `EPJK` | Kerosene-type jet fuel | Jet-fuel family |

The product hierarchy is descriptive and overlapping. Parent and child rows must not be stacked or added as though mutually exclusive. CBOB plus RBOB does not prove a complete MGBC total; source-published totals remain preferred.

Weekly motor-gasoline exports are intentionally absent. EIA's definition changed in June 2023 when motor gasoline blending component exports moved into total motor gasoline exports. See the [official EIA series note](https://www.eia.gov/dnav/pet/pet_move_wkly_a_epp0_eex_mbblpd_w.htm). A future activation must split or visibly mark the regime rather than place one ten-year seasonal band across it.

Missing weekly/monthly histories use registry bootstrap bounds of 2014-01-01/2014-01. The historical Phase 3 activation selected its 36 weekly definitions from 2014-01-01 and inserted 130,964 observations. Promoted run `eia-20260728T164833Z` contains 217,223 canonical observations; canonical JSON is 85.69 MiB, below the 90 MiB hard guard. Its manifest references 361 observed chart assets and 361 forecast records, records zero activation revisions, and reports `2026-07-17` as the latest period for all 66 weekly definitions. Monthly crude production and the 17 crude movement routes reach `2026-04`; total-products movements conservatively report `2026-03` because two of 18 route assets end there. These counts are a verified activation record, not constants for future runs.

### Phase 4 weekly breadth coordinates

The 28 Phase 4 definitions add 77 exact source-series keys under `/v2/petroleum/sum/sndw/data`. Each definition validates `period`, `duoarea`, provider `series`, `units`, its exact source geographies, and the expected provider unit. The registry, not a label or nearby route member, is authoritative.

| Coverage | Logical definitions | Smallest official geography and larger views |
|---|---:|---|
| Weekly crude production | 1 | Alaska and Lower 48 States; source-published U.S. total |
| Refinery crude inputs | 1 | PADD 1-5; source-published U.S. total |
| Commercial crude stocks excluding SPR | 1 | Cushing; PADD 1-5 and source-published U.S. total |
| SPR and inclusive crude stocks | 2 | U.S. only |
| Commercial crude imports | 1 | PADD 1-5 district of entry; source-published U.S. total |
| Crude exports and net imports | 2 | U.S. only |
| Total crude-plus-products stocks | 2 | U.S. only, with distinct including/excluding-SPR views |
| Total crude-plus-products imports, exports, and net imports | 3 | Imports at PADD 1-5/U.S.; exports and net imports U.S.-only |
| Days of supply | 5 | U.S.-only ratios for crude, gasoline, distillate, jet, and propane |
| Propane | 6 | Stocks at PADD 1 subdistricts, PADD 1-3, source-combined PADD 4&5, and U.S.; imports at PADD 1-3, source-combined PADD 4&5, and U.S.; remaining measures U.S.-only |
| Residual fuel oil | 5 | Stocks, production, and imports at PADD 1-5/U.S.; exports and product supplied U.S.-only |

Only nine Phase 4 definitions authorize browser-defined PADD sums: crude refinery inputs, commercial crude stocks, commercial crude imports, total petroleum imports, propane stocks/imports, and residual stocks/production/imports. The policy registry remains authoritative. Cushing is a contained part of PADD 2, so those two nodes overlap and cannot be combined. Weekly production's Alaska and Lower 48 rows are exact source-published producing areas, not custom-sum authorization. National flows and every days-of-supply ratio remain source-published only.

Commercial crude excluding SPR, SPR, and inclusive crude inventory are overlapping views, as are broad stocks including and excluding SPR. Net imports can be negative and cannot be added to gross imports or exports. Canonical `days` maps to exact provider unit `DAYS`; it is a source-published ratio and never an additive quantity. The current propane stock series excludes propylene at terminals and is not spliced to the older discontinued definition. The activated export key is propane only and remains a separate product from the nearby propane/propylene measures. See [Phase 4 weekly breadth](phase-4-usa-weekly-breadth.md) for exact keys, activation evidence, and continuing publication gates.

### EIA geography cautions

- A route-level `duoarea` value is not automatically equivalent to a state or PADD node; map provider codes explicitly.
- PADD 1 subdistricts do not imply equivalent subdistricts for every PADD.
- Federal offshore and “other states” areas need explicit nodes and double-count protection.
- Some U.S. totals contain adjustments not present in regional components. Prefer the published total and use a component sum only as a reconciliation value.
- A product can be available nationally while the same route has regional data for another product. Availability is per series/facet combination.
- “Product supplied” is an implied-demand accounting measure, not observed end-user consumption. The UI must use that label and definition.
- Unadjusted refinery/blender net production is a net balance and can legitimately be negative; it is not refinery gross output.
- An import PADD is the district of entry, not the consuming region or final destination.
- Cushing commercial crude stocks are the only active USA weekly local/city node; every other weekly series remains at its exact source-published region, PADD, source-region, or U.S. grain.

The [WPSR schedule](https://www.eia.gov/petroleum/supply/weekly/schedule.php) normally releases summary material after 10:30 a.m. Eastern on Wednesday, with holiday exceptions. API availability can lag publication, so a run succeeds only when the expected period appears—not merely when HTTP succeeds.

## Canada — Statistics Canada

Primary programmatic access: [Web Data Service](https://www.statcan.gc.ca/en/developers/wds) and [WDS user guide](https://www.statcan.gc.ca/en/developers/wds/user-guide). The changed-cube/changed-series methods support release discovery; full-table downloads are appropriate for manageable cubes and revision-aware replacement.

| Dataset | Official table | Frequency | Active scope | Geography and aggregation | Current status |
|---|---|---|---|---|---|
| Crude oil and equivalent supply/disposition | [25-10-0063-01](https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=2510006301) | Monthly | 20 definitions: 5 headline balances plus 15 production-grade, bitumen, equivalent-products, and refinery-input detail rows | Per-series published provinces or Atlantic aggregate plus published Canada where available; prefer the published Canada value and preserve suppression | Active and locally verified through source month `2026-04` |
| Petroleum products supply/disposition | [25-10-0081-01](https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=2510008101) | Monthly | 29 definitions across finished gasoline, motor-gasoline blending components, fuel ethanol, distillate, and jet fuel | Per-series published province/territory plus published Canada where available; availability and suppression vary by exact coordinate | Active and locally verified through source month `2026-04` |
| Petroleum and other liquids supply/disposition | [25-10-0081-02](https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=2510008102) | Monthly | Canada and province/territory; use only after overlap with 0081-01 is resolved | Series-specific | Evaluation |
| Inventories held by domestic transporters | [25-10-0075-01](https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=2510007501) | Monthly | Canada/province/territory where published | `sum` subject to scope/coverage | Later expansion |
| Pipeline movements by broad product | [25-10-0077-01](https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=2510007701) | Monthly, not seasonally adjusted | 18 active definitions: nine directional measures for crude oil and equivalents and nine for combined HGLs/RPPs; no individual product splits | Seven Canadian destinations plus one U.S. destination and one U.S.-origin view per product; Canada aggregates overlap provincial routes and are never added to them | Active and promoted through source month `2026-05` |

### Statistics Canada cautions

- “Not all combinations are available” is a data rule, not a transient UI failure. Build availability from observed cube coordinates and metadata.
- Symbols such as unavailable, suppressed, or use-with-caution must remain distinct from numeric zero.
- In 25-10-0063-01, crude-oil production contains net field production and synthetic crude; net field production contains light-and-medium crude, heavy crude, and non-upgraded bitumen. Equivalent products is a separate production parent for condensate and pentanes plus.
- Non-upgraded bitumen reconciles as in-situ production plus mined production **minus** crude bitumen sent for further processing. The processing row is a subtraction, not a positive grade component.
- Light and medium crude is one combined source member. The registry does not split it, infer a density threshold, or map it to a benchmark grade.
- Grade-specific refinery inputs are children of total input to Canadian refineries and must not be added to that parent. They are intake volumes, not capacity or utilization.
- The source dimension declares `Condensate and pentanes plus used as an input in refineries`, but the current full-table fact file has no rows for that member. It remains absent rather than being registered as zero or reconstructed from other cells.
- Table 25-10-0077-01 currently publishes only the `Pipeline` mode. Its source note says marine and rail may be added later, but those modes are outside the current boundary and require separate review if they appear.
- Every 25-10-0077-01 value is a gross directional shipping-region-to-receiving-region movement. Different-province routes are interprovincial, same-province diagonal routes are intraprovincial, opposite directions are not netted, and United States routes represent pipeline movements rather than all-mode customs trade.
- The table's Canada shipping and Canada receiving nodes are source-published aggregates that overlap the provincial route matrix. Do not add them to province routes or reconstruct them from available route cells.
- Movement series are not authorized for browser-defined multi-region sums; use the exact source-published route endpoint or Canada aggregate instead.
- `Crude oil and equivalents` combines bitumen, heavy crude, lease condensate, light crude, and synthetic crude. `Hydrocarbon Gas Liquids (HGLs) and Refined Petroleum Products (RPPs)` combines butane, ethane, pentanes plus, propane, mixed HGLs, motor gasoline, fuel oils, jet fuel, asphalt, and other products. Neither bucket authorizes a grade or individual gasoline/diesel/jet/HGL split.
- Table 25-10-0081-01 declares `Net inter-regional receipts, supply` in dimension metadata but publishes no fact rows for it. It remains absent rather than zero-filled or inferred from the 25-10-0077-01 pipeline matrix.
- Table 25-10-0081 belongs to the post-January-2019 refined-products methodology. Older tables may remain available but must not be spliced without a visible methodology-break treatment.
- Table 25-10-0063 notes methodology changes for imports/exports beginning with January 2020; retain notes and expose breaks where relevant.
- Published Canada totals may include adjustments or confidential values not recoverable from visible provincial rows.
- The Atlantic-provinces row in 25-10-0063-01 overlaps its component provinces. It is a source-published Geography choice, not an additional component for a regional sum.
- `x`, `..`, blank, preliminary, revised, use-with-caution, too-unreliable, terminated, and numeric zero remain distinct source states. Public freshness shows the latest source period separately from the latest numeric period.
- Source row files may not provide an observation-level release timestamp. Do not substitute retrieval time and call it release time.

## Canada — Canada Energy Regulator

Official dataset: [Weekly Crude Run Summary and Data](https://www.cer-rec.gc.ca/en/data-analysis/energy-commodities/crude-oil-petroleum-products/statistics/weekly-crude-run-summary-data/index.html) and the [Open Government dataset record](https://open.canada.ca/data/en/dataset/5c0099e0-7081-404e-a95f-b0541de06630).

| Active series | Frequency | Smallest official geography | Larger choice | Aggregation | Current status |
|---|---|---|---|---|---|
| Refinery crude runs | Weekly observations | Western Canada; Ontario; Quebec & Eastern Canada | Computed Canada reported-region sum only when all three regions exist for the same week | Complete-coverage `sum` with membership and component lineage | Active and locally verified through `2026-06-16` |
| Refinery utilization | Weekly observations | Same three source-published confidentiality regions | None | `not_aggregatable`; never average percentages | Active regionally and locally verified through `2026-06-16` |

CER states that weekly data is aggregated into three regions for confidentiality. Refinery, city, or province values must not be reverse-engineered. The data is voluntary and the provider notes completeness limitations; coverage and source notes must be displayed. The file has no explicit capacity series, so the application does not infer capacity or compute national utilization. Publication/update behavior is detected from the download and latest observation rather than assuming that every weekly observation is uploaded on a fixed weekly API cadence.

## Source-aware geography discovery

For every candidate:

1. enumerate provider geography values from official metadata/data;
2. map each code to a stable `GeographyNode` without losing the provider label;
3. determine availability for the full metric/product/process combination;
4. register source-published parents separately from computed parents;
5. search official catalogs for a legitimate finer source;
6. if none exists, publish an unsupported-level reason;
7. test membership, coverage, and aggregation before offering a larger computed view.

City detail is valuable but is not a default assumption. It appears only when the selected official series actually supports it or a separately documented official source is onboarded.

## Attribution stored with every series

At minimum: provider name, dataset/table name, landing page, route template or PID, provider timezone, retrieval method, source note, terms/attribution link when applicable, and metadata verification timestamp. Credential values and credentialed URLs are never stored.

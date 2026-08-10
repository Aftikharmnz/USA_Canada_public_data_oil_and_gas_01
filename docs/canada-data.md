# Canada data implementation

## Purpose

The Canada dashboard uses public, credential-free Statistics Canada and Canada
Energy Regulator (CER) data. It follows the same immutable-generation,
last-known-good, seasonal-analysis, distribution, delta, and geography-control
contracts as the USA dashboard, while preserving the meanings and geography
boundaries of the Canadian sources.

Machine-readable series and geography definitions remain authoritative in
[`config/series/canada.json`](../config/series/canada.json) and
[`config/geographies/canada.json`](../config/geographies/canada.json).

## Active registry and current verified generation

The source registry contains 81 active definitions: 79 Statistics Canada and
2 CER. They classify as 32 **Crude** and 49 **Refined** choices. Twelve of those
definitions were activated after the current public generation: four propane
balances, six residual-fuel-oil balances, and two closing inventories held by
domestic pipeline transporters. A registry entry is eligible for the next
fail-closed refresh; it is not public evidence until a complete generation,
manifest, asset set, forecasts, and integrity index have been promoted.

Promoted run `canada-20260803T170245Z` remains the last-known-good public
generation and contains the preceding 69-definition cohort: 67 Statistics
Canada series and 2 CER series, presented as 31 **Crude** and 38 **Refined**
choices. Crude includes crude-oil balances, grade and bitumen detail, equivalent
products, refinery activity, and crude/equivalent pipeline movements; placing
refinery activity there is navigation only and does not alter provider
semantics, units, observation identity, or aggregation rules.

The run contains 61,310 canonical observations, 467 verified observed chart
assets with 467 matching forecast records (934 integrity entries), and
29,739,716 bytes (28.36 MiB) of canonical JSON. Public assets occupy 12.78 MiB.
The refresh inserted 35 rows, revised 0, and matched 56,335 unchanged rows. Its
three promoted Statistics Canada cubes (25-10-0063, 25-10-0077, and the shared
25-10-0081 cube) reach source month `2026-05`; the reviewed but not yet promoted
25-10-0075 cube also reaches `2026-05`. CER reaches week `2026-07-21`.
Forecast status is 360 ready, 74 `limited_history`,
and 33 unavailable. The previous last-known-good generation is
`canada-20260731T162758Z`. Retention keeps that generation and the current one.
Public manifest, asset, integrity, and Pages verification passed. Until the
first complete 81-definition refresh is promoted, the site correctly continues
to serve this exact 69-definition last-known-good generation. Any source,
normalization, storage, analytics, or asset failure during the expanded refresh
must leave it untouched.

## Official sources

### Statistics Canada table 25-10-0081 sibling views

[Petroleum products by supply and disposition, monthly](https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=2510008101)
is the current refined-products cube. Its current regime begins in January 2019
and publishes cubic-metre observations for Canada and provinces/territories,
although availability varies by product, measure, geography, and status.

Official views
[25-10-0081-01](https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=2510008101)
and
[25-10-0081-02](https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=2510008102)
are sibling presentations of the same Statistics Canada product and share WDS
PID `25100081`, DOI, full-table archive, headers, and observation coordinates.
The registry therefore has one table specification and the refresh downloads
that archive once. The views are not separate datasets, their rows must never
be added merely because they appear on different landing pages, and a
coordinate already present through one view is not registered again through
the other.

The active registry contains 39 definitions from this shared cube. The original
29 cover trader-relevant balances for finished motor gasoline, motor-gasoline
blending components, fuel ethanol, distillate fuel oil, and kerosene-type jet
fuel. Ten newly activated exact leaves add:

- propane field production, refinery/blender net production, imports, and
  exports; and
- residual fuel oil refinery/blender net production, imports, exports,
  products supplied, ending stocks, and stock change.

Propane field production uses only the six source-declared geographies Canada,
Alberta, British Columbia, Nova Scotia, Ontario, and Saskatchewan. A declared
geography without numeric facts remains unavailable, not zero. The other new
coordinates use their exact source-published national or province/territory
sets. Parent and component product rows overlap; the propane and residual leaves
are never added back to a broader product total without a separate documented
reconciliation.

Important interpretation rules:

- Products supplied is accounting disappearance from the primary supply chain,
  not a direct survey of end-user consumption.
- Propane is the exact Statistics Canada product member; it is not silently
  broadened to a combined propane/propylene concept.
- Residual fuel oil is a finished-product leaf. Its net production can be
  negative, stock change is a signed monthly flow, and ending stocks are a
  month-end level.
- Provincial imports identify the province of entry, not necessarily the final
  processing or consumption location.
- Distillate fuel oil is broader than road diesel.
- Motor-gasoline blending components exclude butane and pentanes plus in this
  table's notes and are not the same as finished gasoline.
- The table does not publish the U.S.-style CBOB/RBOB,
  conventional/reformulated, or sulfur-grade distillate breakouts. The Canada
  interface must not invent those components.
- Canada totals can contain adjustments or confidential contributions that are
  not reconstructible from the visible provinces. Prefer the source-published
  Canada value.
- The shared cube's dimension metadata declares `Net inter-regional receipts,
  supply`, but the current full-table fact file contains no rows for that
  member. It remains absent: the dashboard does not treat it as zero, derive it
  from table 25-10-0077-01, or insert pipeline movements into a
  supply/disposition balance.
- The January 2019 survey-methodology and frame change prevents an invisible
  splice to legacy table 25-10-0041-01.

### Statistics Canada table 25-10-0063-01

[Supply and disposition of crude oil and equivalent](https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=2510006301)
provides monthly cubic-metre observations from January 2016 for Canada,
published provinces, and an Atlantic-provinces aggregate. Headline concepts
include crude production, refinery inputs, imports, exports, and closing
inventory. The active registry contains 20 definitions from this table: the
five original headline concepts plus 15 source-published production and
refinery-input detail rows.

The production hierarchy is exact source metadata, not a stack proposed by the
dashboard:

```text
Crude oil production
|- Net Field production of crude oil
|  |- Light and medium crude oil
|  |- Heavy crude oil
|  `- Non-upgraded production of crude bitumen
|     = In-Situ crude bitumen production
|     + Mined crude bitumen production
|     - Crude bitumen sent for further processing
`- Synthetic crude oil production

Equivalent products production       (separate from crude oil production)
|- Condensate                         (lease and plant condensate together)
`- Pentanes plus
```

Light and medium crude is one combined Statistics Canada member; the app does
not split it or infer density thresholds or benchmark grades. Non-upgraded
bitumen is a reconciliation, not the sum of three positive children. The
further-processing row is explicitly subtractive. Synthetic crude belongs
beneath total crude production but outside net field production. Equivalent
products is a separate parent for condensate and pentanes plus and is not part
of the crude-oil-production parent. In the table's broader balance, total supply
can be calculated from crude-oil production, equivalent-products production,
and imports.

`Input to Canadian refineries` is another source-published parent. Registered
children expose light-and-medium crude, heavy crude, crude bitumen, and
synthetic crude inputs where observations exist. The table's dimension metadata
also declares `Condensate and pentanes plus used as an input in refineries`, but
the current full-table fact file contains no observation rows for that member.
It is therefore not activated, treated as zero, reconstructed from the parent,
or used to force a grade reconciliation. Grade-specific refinery inputs are
monthly intake volumes, not production, capacity, or utilization.

Every parent and child is an overlapping view. The interface orders leaves
before parents for navigation, but `parent_product_id` never authorizes adding
children to a parent. Provincial grade and refinery-input cells can be
suppressed, unavailable, or historically unavailable; those states remain
nonnumeric and are never recovered from a Canada total.

The Atlantic-provinces row overlaps the individual Atlantic provinces. It is a
source-published geography choice, not an extra component to add to those
provinces. For imports and exports, the source documents a January 2020
methodology change: pipeline exports are allocated to the province where they
are loaded and imports to the province of destination, rather than the former
border-clearance treatment. Analytics must not hide this break.

### Statistics Canada table 25-10-0075-01

[Inventories of crude oil and petroleum products held by domestic
transporters, monthly](https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=2510007501)
publishes monthly point stocks by inventory position, transport mode, broad
product, and geography. The reviewed cube begins in January 2020 and uses the
2016 DGUID vintage for Canada, Alberta, British Columbia, Manitoba, Northwest
Territories, Ontario, Quebec, and Saskatchewan. Those codes are explicit
aliases on the existing stable geography nodes; the application does not create
a second 2016 geography hierarchy.

The active registry selects exactly two coordinates:

- closing inventories of **Crude oil and equivalents** held by domestic
  pipeline transporters; and
- closing inventories of the combined **Hydrocarbon Gas Liquids (HGLs) and
  Refined Petroleum Products (RPPs)** bucket held by domestic pipeline
  transporters.

Every normalized observation retains constant semantic dimensions for
`inventory_position=Closing inventories`, `mode_of_transport=Pipeline`, and the
exact source product. These dimensions are registry-derived from pinned row
filters; they do not alter keys for pre-existing Statistics Canada series. A
future source mode or product cannot enter either definition automatically.

These values are month-end stocks inside a transporter custody boundary. They
are not total Canadian commercial inventories, refinery stocks, terminal
capacity, storage capacity, pipeline throughput, receipts, transfers, or
origin-destination movement volumes. The HGL/RPP total cannot be allocated to
propane, gasoline, distillate, jet fuel, or another component. Northwest
Territories HGL/RPP cells can be `..`; they remain not available rather than
zero or an inferred provincial value.

The source also publishes opening inventories. Across the reviewed numeric
history, a month's opening position repeats the previous month's closing
position. Activating both would expose the same stock state twice with a
one-period shift and invite double counting. The first tranche therefore
registers closing inventories only. Opening rows remain source evidence, not a
second active measure, and may be reconsidered only for a documented
reconciliation use case.

Neither transporter-inventory series is in the custom-geography aggregation
registry. The source-published Canada value remains separate and authoritative;
province rows are exact choices, not authorization to synthesize a national
stock. Both definitions are also excluded from monthly-average daily-rate
conversion because dividing a point stock by calendar days has no valid market
meaning.

### Statistics Canada table 25-10-0077-01

[Crude oil and petroleum products movements, by mode of transport and by
product type, monthly](https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=2510007701)
is a non-seasonally-adjusted origin-destination movement matrix from January
2020. Each observation is a monthly cubic-metre volume identified by four
source dimensions:

```text
shipping region
-> receiving region
-> mode of transport
-> broad product type
```

The current cube contains one mode, `Pipeline`. Statistics Canada's note says
marine and rail data may be added later; that is a possible source expansion,
not permission for the application to relabel pipeline observations as
all-mode movements. A new mode must be reviewed and registered separately.

Shipping and receiving are independent geography dimensions. Each currently
contains Canada, Quebec, Ontario, Manitoba, Saskatchewan, Alberta, British
Columbia, Northwest Territories, and the United States. The two endpoints must
remain in every observation's identity:

- a province-to-different-province route is an interprovincial pipeline
  movement;
- a province-to-the-same-province diagonal is a source-published
  intraprovincial movement, not a zero or an interprovincial flow;
- a province-to-United-States or United-States-to-province route is a
  cross-border **pipeline** movement, not total customs exports or imports
  across all transportation modes; and
- opposite directions are separate gross flows and are not silently netted.

`Canada, shipping region` and `Canada, receiving region` are source-published
aggregates that overlap the provincial matrix. They are broader views, not
extra route components. The dashboard therefore does not add a Canada row to
provincial routes, reconstruct a Canada aggregate from visible corridors, or
claim that available province cells reconcile it. Missing and `..` route cells
remain unavailable rather than zero.

Movement series are intentionally absent from the custom-geography aggregation
registry. The ordinary series controls still select one exact source-published
shipping origin (or, for United-States-origin measures, one receiving
destination); the browser does not sum origins into a synthetic route total.

The dashboard renders these series as explicit route observations. For every
`to-*` measure, the geography selector is labelled **Shipping origin** and the
measure supplies the fixed **Receiving destination**. For
`from-united-states`, the geography selector is **Receiving destination** and
the fixed shipping origin is the United States. Loaded asset dimensions must
validate the visible `shipping origin → receiving destination` label and
`Pipeline` mode; a mismatch fails closed.

The dedicated origin-destination explorer joins only sibling movement series
with the same registered product, source vintage, methodology, frequency, and
unit. Its rows are shipping origins and its columns are receiving
destinations, so a cell explicitly reads, for example, `Alberta → Ontario`.
The current registered domestic destination set is Alberta, British Columbia,
Manitoba, Ontario, Quebec, and Saskatchewan; no Northwest-Territories receiving
series is invented. Province-to-United-States and United-States-to-province
pipeline routes are retained as separate cross-border cells. Users can choose
the source month and filter to one origin, one destination, or one exact
corridor; the accompanying ranked bars and accessible table use those same
published route cells.

Missing corridors remain “No published fact” rather than zero. The
source-published Canada aggregate stays outside the matrix and is not summed
with or reconstructed from province routes. A route with no public asset
because its entire retained history is nonnumeric is shown as unavailable; it
is never stale-filled from a different period.

Standard all-mode import balance series use a different national-composition
view. It compares the source-published Canada total with same-period provincial
components registered for additive comparison. The official total remains
authoritative, incomplete components are not stale-filled, and a reconciliation
difference is a diagnostic rather than an invented province. Crude imports use
province of destination from January 2020 onward; refined balance imports retain
their province-of-entry/reporting-province semantics.

The source publishes exactly two broad product buckets:

- **Crude oil and equivalents**: bitumen, heavy crude oil, lease condensate,
  light crude oil, and synthetic crude oil.
- **Hydrocarbon Gas Liquids (HGLs) and Refined Petroleum Products (RPPs)**:
  butane, ethane, pentanes plus, propane, mixed HGLs, motor gasoline, fuel
  oils, jet fuel, asphalt, and other refined petroleum products.

These are combined transportation scopes. Table 25-10-0077-01 does not provide
separate light/heavy/bitumen movement series or separate gasoline, diesel,
jet-fuel, propane, and other HGL/RPP movement series. The HGL/RPP value must not
be presented as a refined-products-only total or allocated to one component.
Likewise, the movement matrix is not a substitute for the empty
`Net inter-regional receipts, supply` member in table 25-10-0081-01 and is not
automatically reconciled to that table's product balances.

### Monthly-average daily-rate display

Statistics Canada publishes these petroleum balances as monthly cubic-metre
volumes. The flow and activity series explicitly registered in
`config/display/monthly-average-rate.json` offer daily-rate choices in
`bbl/d`, `kb/d`, `MMbbl/d`, `m³/d`, and `10³ m³/d`. The browser divides each
observation by that source month's actual 28, 29, 30, or 31 calendar days and
then applies the selected fixed-factor display scale. It recomputes the seasonal band, latest comparisons,
distribution diagnostics, and other displayed statistics from those derived
period values.

The positive registry now contains 70 active Statistics Canada monthly flows.
Its nine additions are all four propane measures plus residual-fuel-oil net
production, imports, exports, products supplied, and stock change. Residual-fuel
ending stocks and both table 25-10-0075-01 transporter closing inventories are
point stocks and remain excluded.

This is a presentation view, not a replacement source series: canonical data,
checksums, regional aggregation, forecast fitting, and interval calibration
stay in monthly cubic metres. Forecast point values and prediction bounds are
converted only after publication using each target month's own day count.
Scale-dependent backtest errors stay labelled in source monthly cubic metres.
Closing inventory and ending stocks are point-in-time levels, so daily-rate
units are not offered for them. Percentages and unregistered future measures
also remain ineligible.

### Canada Energy Regulator weekly crude runs

The CER's [Weekly Crude Run Summary and Data](https://www.cer-rec.gc.ca/en/data-analysis/energy-commodities/crude-oil-petroleum-products/statistics/weekly-crude-run-summary-data/index.html)
publishes refinery crude runs in thousand cubic metres per day and utilization
as a percentage of capacity for three confidentiality regions:

- Ontario;
- Quebec & Eastern Canada; and
- Western Canada.

The report is voluntary and the file is updated periodically rather than being
a guaranteed real-time weekly API. It does not publish refinery, city, or
province detail. The dashboard therefore exposes the three official regions and
does not reverse-engineer smaller geographies.

The active publication window is configured from `2014-01-01` to keep the
canonical/browser history bounded, even though the official CER file contains
older observations. Changing that lower bound requires a reviewed storage and
analytics decision rather than an incidental backfill.

Regional utilization is source-published. The file does not contain an explicit
capacity series, so the application does not publish an inferred capacity or
average regional utilization percentages into a national value. A national
crude-runs total is permitted only when all three compatible regional values are
present for the same week; it is labelled as a computed reported-region sum and
retains component lineage.

## Country-page selection and geography behavior

Every chart keeps the Geography control visible. The Canada page narrows the
manifest in this order:

```text
Crude or Refined
-> finest available geography level
-> exact official geography node
-> Single region or an authorized same-level combination
-> product family
-> product or refinery activity
-> measure
```

The selected geography filters every downstream product and measure. A choice
is shown only when the manifest has a validated source-published or computed
asset at that exact node. Product/activity leaves are listed before broader
registered parents; the UI neither creates missing parents nor treats the
hierarchy as additive.

Combined mode is available only for exact additive series registered in
`config/aggregation/custom-geography.json`. Statistics Canada combinations use
two or more non-overlapping province/territory nodes supported by the same
series; for example, Alberta + Saskatchewan is valid for registered crude
production. The Atlantic aggregate is never selectable as an extra component
because it overlaps provinces. CER combined mode applies to crude runs only,
not utilization. Each combined period requires every selected component;
suppression or absence produces a nonnumeric combined period, never a partial
sum. Seasonal bands and distributions are recomputed from aligned history.

The expansion adds nine exact table 25-10-0081 definitions to this positive
registry: all four propane measures plus residual-fuel net production, imports,
exports, stock change, and ending stocks. Residual-fuel product supplied is
national-only and remains excluded. This custom-aggregation set differs from
the nine new daily-rate-eligible flows: ending stocks can be summed across
complete mutually exclusive provinces but cannot become a rate, while product
supplied can become a national monthly-average rate but cannot be regionally
combined. Both table 25-10-0075 transporter stocks remain excluded from custom
aggregation.

- Statistics Canada monthly product balances generally move from the smallest
  published province/territory observation to the source-published Canada
  total. A suppressed or unavailable coordinate is not offered as if it were a
  zero.
- Table 25-10-0075-01 transporter inventories expose only the eight registered
  source geographies and retain the published Canada stock separately. Their
  provincial availability does not authorize a browser-computed combination.
- Statistics Canada crude series expose only their actual provincial and
  Atlantic-region coordinates, plus the source-published Canada total.
- CER weekly refinery series expose the three confidentiality regions. A Canada
  crude-runs view appears only when its complete-coverage rollup passes.
- City and census-metropolitan-area choices remain visibly unsupported because
  none of these sources publishes compatible observations at those levels.

Parent links in the geography registry organize controls; they do not authorize
aggregation. Source regions belonging to different providers are not treated as
equivalent. In particular, the Statistics Canada province of Ontario and the
CER Ontario confidentiality region retain separate stable identities even when
their display labels resemble each other. National CER utilization remains
absent because no compatible explicit capacity series supports it.

## Missing, suppressed, and revised observations

Statistics Canada values, status symbols, and terminated flags are parsed as
separate fields. In particular, blank observed status, `..` not available, `x`
suppressed for confidentiality, `E` use with caution, `F` too unreliable, `p`
preliminary, and `r` revised are never coerced to numeric zero. Numeric zero
remains a valid observation.

The public cubes can revise prior months and their row files do not include a
release timestamp for every observation. Each refresh therefore downloads and
validates the official current cube, merges exact observation keys, records
changed values/statuses in the revision ledger, and promotes only a completely
validated generation. Exact duplicate provider rows may be deduplicated;
conflicting duplicates fail the run.

Freshness exposes `latest_period` as the latest source row period and
`latest_numeric_period` as the most recent period with a usable numeric value.
`latest_observation_status` explains a current suppressed or withheld source
row. The UI must clearly say when the displayed numeric value is older than the
latest source period. Retrieval/check time and last-success time are separate;
neither is relabelled as provider release time when that timestamp is absent.

## Automated refresh and recovery

Statistics Canada and CER require no secret. The active dry-run plan contains
81 definitions and four Statistics Canada PIDs (`25100063`, `25100075`,
`25100077`, and `25100081`) plus the CER file. Views 25-10-0081-01 and
25-10-0081-02 share PID `25100081`, so they still produce only one full-table
download. The implemented
[`refresh-canada.yml`](../.github/workflows/refresh-canada.yml) workflow polls
at 10:53 and 14:23 Eastern each weekday. Those independent polling
opportunities complement bounded retry attempts inside each client. A
successful HTTP download is insufficient: archive structure, headers, table
identity, dimensions, units, allowed coordinates, latest periods, duplicate
identities, rollup coverage, and chart assets must all validate.

When the source is unchanged, the job leaves the current public generation and
repository untouched. When validation or retrieval fails, the prior Canada
generation remains the last-known-good site. This is also the transition rule
for the first 81-definition refresh: the current 69-definition promoted run
remains public unless all new and existing observations, assets, forecasts, and
integrity entries validate together. Operators can run the same command
manually; there is no separate browser-side API fetch or manual spreadsheet
copy step.

```text
python -m pipeline.energy_dashboard.cli refresh-canada --dry-run
python -m pipeline.energy_dashboard.cli refresh-canada --store data/cache/canada --promote-to public/data/canada --retain-generations 2
```

The dry run performs no network call. A live no-op returns the current run ID
with `changed: false` and performs no generation, commit, build, or deployment.
Scheduled freshness remains `unknown` until a reviewed Statistics Canada/CER
expected-period calendar is implemented; this is intentionally different from
latest-source, latest-numeric, retrieval, and last-success evidence.

See [`update-runbook.md`](update-runbook.md) for commands and recovery, and
[`methodology.md`](methodology.md) for the seasonal bands, deltas, and
distribution calculations applied after selecting a valid geography.

## Deliberate exclusions

- No city, refinery, terminal, or census-metropolitan-area estimates.
- No reconstruction of confidential provincial cells.
- No split of Statistics Canada's combined light-and-medium crude member and no
  inferred density or benchmark-grade mapping.
- No invented condensate-and-pentanes-plus refinery-input observations where
  the table declares the member but publishes no fact rows.
- No invented 25-10-0081-01 net-inter-regional-receipts observations where the
  table declares the member but publishes no fact rows, and no substitution of
  the 25-10-0077-01 pipeline matrix for that missing balance member.
- No double-counting of sibling 25-10-0081-01 and 25-10-0081-02 views; both are
  coordinates from the same WDS PID `25100081` cube.
- No table 25-10-0075-01 opening-inventory duplicate in the first tranche, no
  daily-rate conversion of closing stocks, and no relabelling of transporter
  custody stocks as total commercial inventory, capacity, throughput, or
  movements.
- No marine, rail, truck, or all-mode interpretation of the current
  pipeline-only movement data.
- No individual crude-grade, gasoline, diesel, jet-fuel, or HGL-component
  movement split from either broad 25-10-0077-01 product bucket.
- No silent legacy/current-table splice.
- No inferred CER capacity series or national mean of utilization percentages.
- No product-parent/component stacking.
- No forecasting or trading recommendation in the observed-data layer.

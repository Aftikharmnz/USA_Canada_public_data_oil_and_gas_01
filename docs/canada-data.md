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

## Current verified generation

Promoted local run `canada-20260720T192043Z` contains 51 active definitions:
49 Statistics Canada series and 2 CER series. The country page presents them as
22 **Crude** and 29 **Refined** choices. Crude includes crude-oil balances,
grade and bitumen detail, equivalent products, and refinery activity; placing
refinery activity there is navigation only and does not alter provider
semantics, units, observation identity, or aggregation rules.

The run contains 49,726 canonical observations, 404 verified observed chart
assets with matching forecast records, and 21.09 MiB of canonical JSON. The
activation inserted 10,184 rows, revised 0, and matched 34,946 unchanged rows.
Statistics Canada reaches source month `2026-04`; CER reaches week
`2026-06-16`. Forecast status is 360 ready, 18 `limited_history`, and 26
unavailable. The previous last-known-good generation was
`analytics-20260720T152511Z`, and the initial Canada activation was
`canada-20260720T000329Z`. Public manifest and asset verification passed
locally; this is not evidence of a public GitHub Pages deployment.

## Official sources

### Statistics Canada table 25-10-0081-01

[Petroleum products by supply and disposition, monthly](https://www150.statcan.gc.ca/t1/tbl1/en/tv.action?pid=2510008101)
is the current refined-products cube. Its current regime begins in January 2019
and publishes cubic-metre observations for Canada and provinces/territories,
although availability varies by product, measure, geography, and status.

The dashboard concentrates on trader-relevant balances for finished motor
gasoline, motor-gasoline blending components, fuel ethanol, distillate fuel oil,
and kerosene-type jet fuel. Measures include the compatible subset of refinery
or renewable-fuel production, imports, stock change, refinery/blender inputs,
exports, products supplied, and ending stocks.

Important interpretation rules:

- Products supplied is accounting disappearance from the primary supply chain,
  not a direct survey of end-user consumption.
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

### Monthly-average `kb/d` display

Statistics Canada publishes these petroleum balances as monthly cubic-metre
volumes. The flow and activity series explicitly registered in
`config/display/monthly-average-rate.json` offer **Thousand barrels per day
(monthly average)**. The browser divides each observation by that source
month's actual 28, 29, 30, or 31 calendar days and applies the exact barrel
conversion. It then recomputes the seasonal band, latest comparisons,
distribution diagnostics, and other displayed statistics from those derived
period values.

This is a presentation view, not a replacement source series: canonical data,
checksums, regional aggregation, forecast fitting, and interval calibration
stay in monthly cubic metres. Forecast point values and prediction bounds are
converted only after publication using each target month's own day count.
Scale-dependent backtest errors stay labelled in source monthly cubic metres.
Closing inventory and ending stocks are point-in-time levels, so `kb/d` is not
offered for them. Percentages and unregistered future measures also remain
ineligible.

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

- Statistics Canada monthly product balances generally move from the smallest
  published province/territory observation to the source-published Canada
  total. A suppressed or unavailable coordinate is not offered as if it were a
  zero.
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

Statistics Canada and CER require no secret. The implemented
[`refresh-canada.yml`](../.github/workflows/refresh-canada.yml) workflow polls
at 10:53 and 14:23 Eastern each weekday. Those independent polling
opportunities complement bounded retry attempts inside each client. A
successful HTTP download is insufficient: archive structure, headers, table
identity, dimensions, units, allowed coordinates, latest periods, duplicate
identities, rollup coverage, and chart assets must all validate.

When the source is unchanged, the job leaves the current public generation and
repository untouched. When validation or retrieval fails, the prior Canada
generation remains the last-known-good site. Operators can run the same command
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
- No silent legacy/current-table splice.
- No inferred CER capacity series or national mean of utilization percentages.
- No product-parent/component stacking.
- No forecasting or trading recommendation in the observed-data layer.

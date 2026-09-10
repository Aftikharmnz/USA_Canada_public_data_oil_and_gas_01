# CER petroleum data enrichment

## Purpose and boundary

The Canada page supplements Statistics Canada balances with two additional,
credential-free Canada Energy Regulator (CER) datasets: propane/butane export
reporting and Trans-Northern pipeline throughput. These are separate source
views, not missing terms to insert into a provincial gasoline balance. Registry
activation does not itself prove deployment: the public manifest, asset
integrity index, and canonical `CURRENT` pointer identify the promoted vintage.

The existing two CER weekly refinery definitions remain unchanged. The new
cohort adds 15 monthly definitions, bringing the Canada registry to 96
definitions: 79 Statistics Canada and 17 CER.

## What CER adds

Statistics Canada table 25-10-0081 supplies product balances, but does not give
the selected product's export-province-to-U.S.-PADD split. CER NGL reporting
adds that first-destination distinction for propane and butane. It does not
publish equivalent province/PADD corridors for finished gasoline or a gasoline
blending component in the source activated here.

Statistics Canada table 25-10-0077 describes broad-product pipeline movements
between shipping and receiving regions. Trans-Northern instead supplies
throughput at named pipeline reporting points. Neither dataset can substitute
for the other: throughput at a point is not a province-to-province route matrix,
and a broad refined-products total cannot be allocated to gasoline, diesel, or
jet fuel.

## Propane and butane export reporting

Official sources:

- [Monthly NGL exports CSV](https://www.cer-rec.gc.ca/open/imports-exports/natural-gas-liquids-exports-monthly.csv)
- [NGL export data dictionary](https://www.cer-rec.gc.ca/open/imports-exports/natural-gas-liquids-exports-data-dictionary.csv)
- [Open Government dataset and licence](https://open.canada.ca/data/en/dataset/8cb1d0d0-6ea7-4f6d-b01d-a38fafdcce77)
- [CER propane/butane explanation](https://www.cer-rec.gc.ca/en/data-analysis/energy-commodities/natural-gas-liquids/statistics/propane-butanes-export-summary/)

The CSV is downloaded once per Canada refresh and validated before any series
filtering. Its reviewed encoding is Windows-1252; `Québec` is an exact source
member. Exact header order is:

```text
Period, Year, Month, Product, Origin, Destination / PADD,
Mode of Transportation, Volume (m3), Volume (bbl), Value (CN$),
Value (US$), Price (CN cents/L), Price (US cents/gallon)
```

`Period` is a month-start `MM/01/YYYY` label, not a daily observation. The
separate year and English month fields must agree with it. Known products,
origins, destinations, modes, numeric fields, duplicate identities, encoding,
and headers are validated over the complete file. Schema, unit, or unknown
member drift fails the refresh. An exact duplicate can be deduplicated; two
different rows with the same month/product/origin/destination/mode key cannot.

The retained history begins **January 2016**. This explicit registry boundary
keeps the initial enrichment inside the unchanged canonical-generation growth
guard; it is not a statement that CER history begins in 2016. CER's download
contains observations from January 1990. Extending retained history requires a
reviewed storage and methodology decision.

### Registered source views

All 14 definitions require `Mode of Transportation = Total`, a published source
total across modes. There is one definition per exact product and first export
destination. Each exposes source-published export-origin geographies and the
published Canada total where factual history is available.

The two exact series prefixes are:

```text
can.cer.ngl.propane.exports.
can.cer.ngl.butane.exports.
```

Append the following suffixes to either prefix to obtain the 14 stable IDs:

| Suffix | Exact `Destination / PADD` member |
| --- | --- |
| `total.monthly` | `Total` |
| `padd1.monthly` | `PADD I` |
| `padd2.monthly` | `PADD II` |
| `padd3.monthly` | `PADD III` |
| `padd4.monthly` | `PADD IV` |
| `padd5.monthly` | `PADD V` |
| `other.monthly` | `Other` |

`Other` is CER's non-U.S. destination bucket, not a calculated reconciliation
residual. It is never broken into invented countries. National, total-
destination, and individual destination rows overlap: they are alternative
views and must not be added together.

### Export geography is not production geography

The source origin identifies the **province where exportation occurs**, not
the province where the commodity was produced. This is the reporting concept
in [CER Filing Manual Guide CC, propane/butane section 5(d)](https://www.cer-rec.gc.ca/en/applications-hearings/submit-applications-documents/filing-manuals/filing-manual/filing-manual-guide-cc-import-export-reporting-regulation-requirements.html).

The dictionary's exact origin members are Alberta, British Columbia, Manitoba,
New Brunswick, Newfoundland and Labrador, Northwest Territories, Nova Scotia,
Ontario, Prince Edward Island, Québec, Saskatchewan, Yukon, and Total. The
`Total` member maps to the existing Canada geography; it is not constructed
from province rows. Not every declared origin has facts for every product,
destination, or month. A member with no retained facts is unavailable, not zero.

Destination is the **first reported export destination**, not final consumption.
For example, a shipment reported to PADD III stays in that bucket if it is later
re-exported to Mexico. Export geography is therefore not interchangeable with
Statistics Canada's production geography or its separate balance/reporting
definitions. CER NGL products use a distinct source-family/product identity
in the interface so related views cannot silently collapse into a single
Statistics Canada supply/disposition balance.

### Missing observations and revisions

The inspected CSV has numeric quantities without a separate status column.
Numeric zero is an observation. An absent row is not zero, confidentiality is
not inferred from absence, and unexpected future status text is rejected until
its meaning has been reviewed.

If an origin has retained factual history but lacks a row in the latest file
month, the adapter adds a nonnumeric `missing` marker with `no_source_fact`
lineage. That marker describes source absence; it is not labelled as a
source-published quantity. Latest-source and latest-numeric periods remain
separate, preventing an old number from appearing current and blocking a
forecast from that old endpoint.

Only previous adapter-created absence markers with matching series, origin,
destination, product, mode, unit, and status are carried forward while their
keys remain absent. This lets a new release retain last month's explicit gap
without failing the source-removal guard. A subsequently reported numeric row
replaces the marker through the ordinary revision ledger. Previously numeric
provider rows are never carried forward by the adapter to hide deletion; the
orchestrator still rejects removed factual coordinates in its overlap window.
The adapter does not fill an entire unobserved historical calendar.

Four reviewed March 2022 records have a blank destination: propane, origin
Alberta or Total, mode Railway or Total. They remain validated source records
but are outside every activated destination selector. They are not recoded as
`Other` or added to destination totals. Another blank-destination identity
requires review. The dictionary also declares ethane, but no ethane facts were
present in the verified file; no ethane series is activated. Negative historical
correction rows are validated as signed numbers, not coerced to zero.

### Units and non-additivity

Canonical values are the source's monthly `Volume (m3)` values. Display-only
volume choices use the application's exact barrel/cubic-metre conversion.
CER's separate barrel column uses a rounded factor; it is retained in the
validated download but is not a competing canonical observation.

This first cohort offers **volume units only**, not `bbl/d` or `kb/d` for NGL
exports. The existing positive monthly-average-rate registry is reviewed for
Statistics Canada flows; it does not implicitly authorize a new provider's
volume-to-rate derivation. A later CER rate display needs its own reviewed
contract and tests. Monetary value, export price, and individual transport modes
are not activated by the volume cohort. Neither province combinations nor
destination summation is authorized for these definitions.

## Trans-Northern refined-products throughput

The exact new definition is:

```text
can.cer.pipeline.trans_northern.throughput.monthly
```

Official sources:

- [Trans-Northern CSV](https://www.cer-rec.gc.ca/open/energy/throughput-capacity/trans-northern-throughput-and-capacity.csv)
- [Oil-pipeline dictionary](https://www.cer-rec.gc.ca/open/energy/throughput-capacity/oil-pipeline-data-dictionary.csv)
- [CER pipeline profile](https://apps.cer-rec.gc.ca/PPS/en/pipeline-profiles/trans-northern)
- [Open Government pipeline dataset and licence](https://open.canada.ca/data/en/dataset/dc343c43-a592-4a27-8ee7-c77df56afb34)

This UTF-8 CSV reports monthly average daily throughput for the exact company
`Trans-Northern Pipelines Inc.`, pipeline `Trans-Northern pipeline`, product
`refined petroleum products`, trade type `intracanada`, and direction
`not available`. Retained history starts **January 2014**. Published geography
choices are the pipeline reporting scopes `Montreal-West`, `Nanticoke-East`,
and `system`; they are not province observations or synthetic city statistics.
System and point readings may overlap and are never added.

The native unit is **thousand cubic metres per day**. Fixed-factor daily-rate
choices such as `bbl/d` and `kb/d` are therefore valid without dividing a monthly
volume by days. This differs from the NGL export volume source. Current source
capacity fields are empty; no pipeline capacity or utilization is inferred.
The broad product is not split into gasoline, blending components, distillate,
or jet fuel. Reporting points are logistics context, not evidence closing a
provincial product balance.

## Automated publication and release timing

Both downloads are integrated with the existing Canada CLI and
`.github/workflows/refresh-canada.yml`. The weekday polls at **10:53 and 14:23
America/Toronto** do not require a user download, API key, workbook edit, or a
running local computer. The source clients use bounded retries and byte limits;
the next scheduled poll provides another opportunity after a delayed release.
Pipeline observations are monthly, but CER updates the pipeline files quarterly
or as needed. Poll frequency does not imply weekly or daily source observations.

```text
python -m pipeline.energy_dashboard.cli refresh-canada --dry-run
python -m pipeline.energy_dashboard.cli refresh-canada --store data/cache/canada --promote-to public/data/canada --retain-generations 2
```

A source no-op does not force a new generation or data commit. Changed values,
new months, statuses, and reviewed absence markers enter the same revision-
aware, validated, atomic generation pipeline. Provider failures, drift, invalid
assets, or unchanged storage guards leave the last-known-good deployment intact.
The browser reads published assets; it does not call CER directly. Tests cover
new releases after absent observations as well as late reported replacements.

Live source checks on **September 10, 2026 UTC** found NGL observations through
**May 2026** and Trans-Northern observations through **June 2026**. These are
data-period checks, not claims that every geography has a numeric value in that
month. Open Government catalogue modification dates and HTTP file timestamps
are not substituted for observation periods or provider release timestamps.
The NGL file contained 66,074 rows and 10,335,376 bytes; the activated January
2016 window normalized to 7,684 source observations plus 48 latest-absence
markers across 109 factual series/geography histories. These are a dated review
snapshot, not hard-coded counts for future validation.

## Other CER sources reviewed, not activated here

- [Crude exports by destination](https://www.cer-rec.gc.ca/open/imports-exports/crude-oil-exports-by-destination-monthly.csv)
  adds national exports to PADD I–V and other countries; the separate
  [crude-grade file](https://www.cer-rec.gc.ca/open/imports-exports/crude-oil-exports-by-type-monthly.csv)
  adds national light/medium/heavy export distinctions. Neither file supplies
  a provincial crude-grade-to-PADD matrix.
- [Refined-product exports](https://www.cer-rec.gc.ca/open/imports-exports/refined-petroleum-products-exports-monthly.csv)
  provides national export categories including motor gasoline, middle
  distillate, jet fuel, heavy fuel oil, and partially processed oil. These are
  CER reporting boundaries, not automatic equivalents of Statistics Canada
  leaves, and the CSV does not add province detail.
- [Crude rail-export CSV](https://www.cer-rec.gc.ca/open/energy/canadian-crude-oil-exports-rail-monthly.csv)
  stopped at April 2026 during verification while the current CER webpage/XLS
  reported June 2026. That discrepancy must be resolved before using the CSV as
  a current automated source. CER does not publish provincial or destination
  detail for this confidential rail dataset.
- [LPG underground inventories](https://www.cer-rec.gc.ca/en/data-analysis/energy-commodities/natural-gas-liquids/statistics/liquefied-petroleum-gas-lpg-statistics.html)
  can add propane/butane underground-storage context. Those observations are
  reported on the first of the month and are not total commercial inventory or
  a flow. The current workbook extraction contract is not activated here.
- Other pipeline files, including Trans Mountain, add throughput and capacity
  context but require separate point, product, capacity, and history-break
  review. Trans Mountain classifications changed in May 2024, so an unreviewed
  historical splice is inappropriate.

No CER source reviewed here supplies the missing complete provincial supply,
demand, and net-transfer balance for a specific gasoline blending component.
The application retains that limitation rather than constructing a false
balance from unrelated export and pipeline measurements.

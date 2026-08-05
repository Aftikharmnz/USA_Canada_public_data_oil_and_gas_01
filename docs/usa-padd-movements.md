# USA PADD origin-destination movements

## Boundary

The USA registry includes two active monthly EIA movement definitions:

- `usa.eia.crude.padd_movements.monthly`
- `usa.eia.refined.total_petroleum_products.padd_movements.monthly`

They use the official EIA API v2 route
[`/v2/petroleum/move/ptb/data`](https://www.eia.gov/opendata/browser/petroleum/move/ptb)
and the Petroleum Supply Monthly movement tables. Both are activated in
promoted run `eia-20260805T163902Z`, which passed the complete refresh,
analytics, integrity, size, and Pages-deployment gates in workflow run
`31026239390`.

These are domestic logistics observations. They are separate from:

- weekly PADD imports, whose PADD identifies the district of entry;
- exports and foreign country of origin/destination;
- product supplied or final consumption;
- Canadian Statistics Canada pipeline movements.

## Direction and geography

Every observation has both endpoints. EIA's `duoarea` code is ordered as
**receiving PADD first, shipping PADD second**:

```text
R{destination}0-R{origin}0
```

For example, `R10-R30` means Gulf Coast (PADD 3) → East Coast (PADD 1).
Stable project IDs use the readable opposite order:
`us.padd.route.3-to-1`.

`config/geographies/usa.json` registers all 20 possible directed inter-PADD
nodes at the relational `padd_route` level. A series may use only the exact
subset EIA publishes:

- crude oil: 17 routes;
- total petroleum products: 18 routes.

The missing crude routes are PADD 1→5, 5→1, and 5→4. The missing total-products
routes are PADD 1→4 and 4→1. Their absence is not zero and they must not be
created as empty observations.

Route nodes have no containment parents. A directed edge is not a child region
of either endpoint and cannot participate in custom geographic sums.

## Exact source contract

Both definitions use:

| Field | Contract |
|---|---|
| Frequency | `monthly` |
| Value | Monthly movement volume |
| Unit | `MBBL` / canonical `thousand_barrels` |
| Process | `TNR` |
| Identity | `period`, `duoarea`, `product`, `process`, `series`, `units` |
| Crude product | `EPC0` |
| Total-products product | `EPP0` |
| Bootstrap | `2014-01` |
| Aggregation | `not_aggregatable` |

The exact API `series` allowlists are:

### Crude oil

| Shipping → receiving | `duoarea` | `series` |
|---|---|---|
| 1→2 | `R20-R10` | `MCRMXP2P11` |
| 1→3 | `R30-R10` | `MCRMXP3P11` |
| 1→4 | `R40-R10` | `M_EPC0_TNR_R40-R10_1` |
| 2→1 | `R10-R20` | `MCRMXP1P21` |
| 2→3 | `R30-R20` | `MCRMXP3P21` |
| 2→4 | `R40-R20` | `MCRMXP4P21` |
| 2→5 | `R50-R20` | `MCRMX_R50-R20_1` |
| 3→1 | `R10-R30` | `MCRMXP1P31` |
| 3→2 | `R20-R30` | `MCRMXP2P31` |
| 3→4 | `R40-R30` | `MCRMX_R40-R30_1` |
| 3→5 | `R50-R30` | `MCRMXP5P31` |
| 4→1 | `R10-R40` | `M_EPC0_TNR_R10-R40_1` |
| 4→2 | `R20-R40` | `MCRMXP2P41` |
| 4→3 | `R30-R40` | `MCRMXP3P41` |
| 4→5 | `R50-R40` | `MCRMX_R50-R40_1` |
| 5→2 | `R20-R50` | `MCRMX_R20-R50_1` |
| 5→3 | `R30-R50` | `MCRMXP3P51` |

### Total petroleum products

| Shipping → receiving | `duoarea` | `series` |
|---|---|---|
| 1→2 | `R20-R10` | `MPEMXP2P11` |
| 1→3 | `R30-R10` | `MPEMXP3P11` |
| 1→5 | `R50-R10` | `MPEMXP5P11` |
| 2→1 | `R10-R20` | `MPEMXP1P21` |
| 2→3 | `R30-R20` | `MPEMXP3P21` |
| 2→4 | `R40-R20` | `MPEMXP4P21` |
| 2→5 | `R50-R20` | `MPEMXP5P21` |
| 3→1 | `R10-R30` | `MPEMXP1P31` |
| 3→2 | `R20-R30` | `MPEMXP2P31` |
| 3→4 | `R40-R30` | `MPEMXP4P31` |
| 3→5 | `R50-R30` | `MPEMXP5P31` |
| 4→2 | `R20-R40` | `MPEMXP2P41` |
| 4→3 | `R30-R40` | `MPEMXP3P41` |
| 4→5 | `R50-R40` | `MPEMXP5P41` |
| 5→1 | `R10-R50` | `MPEMXP1P51` |
| 5→2 | `R20-R50` | `MPEMXP2P51` |
| 5→3 | `R30-R50` | `MPEMXP3P51` |
| 5→4 | `R40-R50` | `MTXMX_R40-R50_1` |

Do not derive a series key from a naming pattern. EIA contains legacy and newer
identifier forms in the same table, so the registry must retain this exact
allowlist. The ingestion contract binds every listed `series` key to its
specific `duoarea`; a row with two independently allowed values in the wrong
pair fails normalization instead of being assigned to the wrong route.

## Modes and interpretation

The `ptb` view combines pipeline, tanker, barge, and selected rail movements.
It is the appropriate first view for a directional PADD matrix. EIA also
publishes separate official subroutes for:

- `/v2/petroleum/move/pipe/data` — pipeline;
- `/v2/petroleum/move/tb/data` — tanker and barge;
- `/v2/petroleum/move/rail/data` — selected rail movements between PADDs;
- `/v2/petroleum/move/railNA/data` — rail, including published within-PADD and
  Canada corridors;
- `/v2/petroleum/move/netr/data` — signed net receipts, not an
  origin-destination matrix.

All are monthly/annual, not weekly. EIA states that its weekly surveys do not
capture petroleum movements.

Product-pipeline data can include intermediate movements for systems crossing
more than two PADDs. Crude pipeline data identify shipping and receiving PADDs
without intermediate-PADD movements. Tanker/barge data use reported shipping
and receiving PADDs and can include Panama Canal movements under EIA's table
rules. Rail values are estimates assembled from official and third-party
transport sources. For these reasons:

- never sum every route into a national movement total;
- never infer a continuous terminal-to-terminal path;
- never interpret the receiving PADD as final consumption;
- preserve zero, missing, unavailable, and withheld as distinct states;
- never stack total petroleum products with its component products.

## Activation and storage evidence

Promoted run `eia-20260805T163902Z` contains 17 crude route assets and 18
total-products route assets within 217,582 canonical observations. Fifteen
crude routes reach `2026-05`; routes 3→5 and 5→3 remain at `2026-04`, so the
crude definition conservatively reports `2026-04`. All 18 total-products
routes reach `2026-05`; older route values are never stale-filled into a newer
month. The complete USA generation is 90,001,839 bytes (85.83 MiB), below the
90 MiB promotion guard, and the previous last-known-good generation is
`eia-20260729T175851Z`.

This measured result does not replace the 90 MiB check on every future
promotion. More movement products—such as 0–15 ppm distillate, finished
gasoline, jet fuel, or propane/propylene—require a reviewed storage migration
or an equivalent capacity plan before activation.

## Primary sources

- [EIA Petroleum Supply Monthly](https://www.eia.gov/petroleum/supply/monthly/)
- [EIA Petroleum Supply Monthly explanatory notes](https://www.eia.gov/petroleum/supply/monthly/pdf/psmnotes.pdf)
- [EIA petroleum API movement browser](https://www.eia.gov/opendata/browser/petroleum/move/ptb)
- [EIA petroleum bulk file](https://www.eia.gov/opendata/bulk/PET.zip)

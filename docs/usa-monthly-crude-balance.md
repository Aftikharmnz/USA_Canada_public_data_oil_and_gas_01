# USA monthly crude supply and disposition

## Status

Nine exact EIA Petroleum Supply Monthly (PSM) crude-oil balance definitions are
registered as active, bringing the USA registry to 78 active definitions. The
currently promoted public generation predates this cohort, so the nine views
will appear only after the next complete refresh builds and atomically promotes
their observed and forecast assets.

Activation followed independent verification of every source key against the
official EIA PET bulk archive and a complete 217,582-row migration test of the
reviewed sharded canonical store. Refresh and promotion remain fail-closed: a
partial or invalid cohort cannot replace the last-known-good public generation.

## Official source contract

- Provider: U.S. Energy Information Administration
- Dataset: Petroleum Supply Monthly, crude-oil supply and disposition
- API route: `/v2/petroleum/sum/snd/data`
- Frequency: monthly
- Product facet: `EPC0` (crude oil)
- Smallest registered geography: PADD
- Larger view: source-published United States where the exact measure provides
  one
- Bootstrap lower bound: `2014-01`; older provider history is outside this
  application's activation boundary

Every definition pins `period`, `duoarea`, `product`, `process`, `series`, and
`units` as row identity. A nearby label or newly appearing route member is not
accepted automatically.

| Stable series ID | Process | Unit | Exact provider series |
|---|---|---|---|
| `usa.eia.crude.ending_stocks.monthly` | `SAE` | `MBBL` | `MCRSTP11`, `MCRSTP21`, `MCRSTP31`, `MCRSTP41`, `MCRSTP51`, `MCRSTUS1` |
| `usa.eia.crude.stock_change.monthly` | `SCG` | `MBBL/D` | `MCRSCP12`, `MCRSCP22`, `MCRSCP32`, `MCRSCP42`, `MCRSCP52`, `MCRSCUS2` |
| `usa.eia.crude.imports.monthly` | `IM0` | `MBBL/D` | `MCRIMP12`, `MCRIMP22`, `MCRIMP32`, `MCRIMP42`, `MCRIMP52`, `MCRIMUS2` |
| `usa.eia.crude.exports.monthly` | `EEX` | `MBBL/D` | `MCREXP12`, `MCREXP22`, `MCREXP32`, `MCREXP42`, `MCREXP52`, `MCREXUS2` |
| `usa.eia.crude.refinery_inputs.monthly` | `YIR` | `MBBL/D` | `MCRRIP12`, `MCRRIP22`, `MCRRIP32`, `MCRRIP42`, `MCRRIP52`, `MCRRIUS2` |
| `usa.eia.crude.product_supplied.monthly` | `VPP` | `MBBL/D` | `MCRUPP12`, `MCRUPP22`, `MCRUPP32`, `MCRUPP42`, `MCRUPP52`, `MCRUPUS2` |
| `usa.eia.crude.supply_adjustment.monthly` | `VUA` | `MBBL/D` | `MCRUA_R10_2`, `MCRUA_R20_2`, `MCRUA_R30_2`, `MCRUA_R40_2`, `MCRUA_R50_2`, `MCRUA_NUS_2` |
| `usa.eia.crude.net_receipts.monthly` | `VNR` | `MBBL/D` | `MCRNRP12`, `MCRNRP22`, `MCRNRP32`, `MCRNRP42`, `MCRNRP52` |
| `usa.eia.crude.transfers_to_supply.monthly` | `TVP` | `MBBL/D` | `M_EPC0_TVP_R10_MBBLD`, `M_EPC0_TVP_R20_MBBLD`, `M_EPC0_TVP_R30_MBBLD`, `M_EPC0_TVP_R40_MBBLD`, `M_EPC0_TVP_R50_MBBLD`, `M_EPC0_TVP_NUS_MBBLD` |

Imports and exports use the route's `R10-Z00` through `R50-Z00` provider
codes and `NUS-Z00` for the published national row. Net receipts use the exact
`R10-Z0P` through `R50-Z0P` codes; those aliases resolve to the existing PADD
nodes without changing their geographic meaning. Net receipts has no
registered national source row.

## Market semantics

- PADD imports are district-of-entry observations, not the ultimate consuming
  region or destination.
- Product supplied is implied demand from the accounting balance, not a direct
  measurement of end-user crude consumption.
- Positive stock change is a build and negative stock change is a draw.
- The supply adjustment is a signed balancing term, not physical production or
  trade.
- Net receipts is receipts less shipments with other PADDs across the modes in
  the source definition. It is not the gross directional route matrix already
  registered under `petroleum/move/ptb`.
- Transfers to crude supply is a separate balance term and its registered
  history begins in 2022. Earlier periods remain unavailable, not zero.
- Source-published U.S. observations remain authoritative and are never
  replaced by PADD sums. All nine definitions are positively authorized for
  same-level, mutually exclusive PADD combinations in
  `config/aggregation/custom-geography.json`; every period requires complete
  component coverage and every result remains labelled computed. Net receipts
  has no source-published U.S. row, so even a five-PADD combination is not
  presented as an official national observation.

## First-publication checklist

1. Bootstrap all exact source keys from `2014-01` (or the provider's later
   first observation) and preserve nonnumeric statuses.
2. Confirm exact facet, geography, unit, duplicate-identity, and period checks.
   Confirm the nine definitions remain exact members of the USA PADD custom-
   aggregation policy and retain `aggregation_rule.kind: sum`.
3. Generate observed and separate forecast assets for every published
   geography; do not forecast through a nonnumeric latest source period.
4. Verify the complete staged public manifest and integrity index.
5. Promote atomically while retaining the previous last-known-good generation.

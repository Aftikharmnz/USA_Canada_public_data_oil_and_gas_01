# Phase 4 USA weekly breadth

## Status

Phase 4 expands the USA EIA registry from 39 to 67 active definitions. The 28 additions are contract-complete in `config/series/usa.json` and publicly activated in promoted run `eia-20260722T202149Z` after a registry-validated EIA refresh built and promoted matching observed and forecast assets.

The resulting registry contains 67 active definitions: three legacy overview definitions, 36 Phase 3 refined-product definitions, and 28 Phase 4 additions. Sixty-six are weekly and monthly crude production is the sole monthly definition. Phase 4 contributes 77 exact source-series keys after exposing every registered smallest official geography. Every addition uses EIA API v2 route `/v2/petroleum/sum/sndw/data`, weekly frequency, an exact `series` facet allowlist, explicit `period`/`duoarea`/`series`/`units` identity, an exact provider unit, and exact registered source geography IDs. New history retains the registry-wide `2014-01-01` weekly bootstrap boundary.

The promoted run contains 212,512 canonical observations, 326 observed chart assets, and 326 matching forecast records. Canonical JSON is 87,599,291 bytes (83.54 MiB), below the 90 MiB publication guard. The merge inserted 50,435 rows, revised 0, and matched 7,873 unchanged rows. Forecast status is 325 ready, 1 `limited_history`, and 0 unavailable. All 66 weekly definitions reach `2026-07-17`; monthly crude production reaches `2026-04`. GitHub Actions run `29954739606` succeeded and deployed the matching public site.

## Added definitions

| Area | Logical definitions | Representative source series (complete exact allowlists are in the registry) |
|---|---:|---|
| Weekly crude production | 1 | `WCRFPUS2`, `W_EPC0_FPF_R48_MBBLD`, `W_EPC0_FPF_SAK_MBBLD` |
| Refinery crude inputs | 1 | `WCRRIUS2`, `WCRRIP12`, `WCRRIP22`, `WCRRIP32`, `WCRRIP42`, `WCRRIP52` |
| Commercial crude stocks excluding SPR | 1 | `WCESTUS1`, `WCESTP11`, `WCESTP21`, `WCESTP31`, `WCESTP41`, `WCESTP51`, `W_EPC0_SAX_YCUOK_MBBL` |
| SPR and inclusive crude stocks | 2 | `WCSSTUS1`, `WCRSTUS1` |
| Commercial crude imports | 1 | `WCEIMUS2`, `WCEIMP12`, `WCEIMP22`, `WCEIMP32`, `WCEIMP42`, `WCEIMP52` |
| Crude exports and net imports | 2 | `WCREXUS2`, `WCRNTUS2` |
| Broad crude-plus-products stocks | 2 | `WTTSTUS1`, `WTESTUS1` |
| Broad crude-plus-products trade | 3 | `WTTIMUS2`, `WTTIM_R10-Z00_2`, `WTTIM_R20-Z00_2`, `WTTIM_R30-Z00_2`, `WTTIM_R40-Z00_2`, `WTTIM_R50-Z00_2`, `WTTEXUS2`, `WTTNTUS2` |
| Crude, gasoline, distillate, and jet days of supply | 4 | `W_EPC0_VSD_NUS_DAYS`, `W_EPM0_VSD_NUS_DAYS`, `W_EPD0_VSD_NUS_DAYS`, `W_EPJK_VSD_NUS_DAYS` |
| Propane/propylene stocks, production, imports, product supplied, and days of supply; propane-only exports | 6 | `WPRSTUS1`, `WPRTP_NUS_2`, `WPRIM_NUS-Z00_2`, `W_EPLLPZ_EEX_NUS-Z00_MBBLD`, `WPRUP_NUS_2`, `W_EPLLPZ_VSD_NUS_DAYS` |
| Residual fuel oil stocks, production, imports, exports, and product supplied | 5 | `WRESTUS1`, `WRERPUS2`, `WREIMUS2`, `WREEXUS2`, `WREUPUS2` |
| **Total** | **28** | **77 exact source-series keys; geography variants remain one logical definition per measure.** |

## Geography and aggregation boundary

- Weekly crude production exposes the exact source-published Alaska, Lower 48 States, and United States rows. `R48` is registered as the producing-area node `us.lower48`; the existing `SAK` node remains Alaska. These are not browser-combinable under the custom PADD policy.
- Commercial crude stocks expose Cushing, PADD 1-5, and the U.S. total. `YCUOK` is registered as `us.ok.cushing`, an official local node beneath PADD 2. Cushing is contained within PADD 2 and can never be added to it.
- Nine new definitions are authorized for custom PADD sums: refinery crude inputs, commercial crude stocks, commercial crude imports, total crude-plus-products imports, propane stocks, propane imports, residual-fuel-oil stocks, residual-fuel-oil production, and residual-fuel-oil imports. A sum requires two to five mutually exclusive PADD members, exact metadata compatibility, and complete same-week coverage. The source-published U.S. total remains preferred.
- Propane stocks publish PADD 1A/1B/1C, PADD 1-3, source-combined PADD 4&5, and U.S. rows. Propane imports publish PADD 1-3, source-combined PADD 4&5, and U.S. rows. The combined source area remains distinct from a browser-selected PADD combination.
- Residual-fuel-oil stocks, production, and imports publish PADD 1-5 and U.S. rows; exports and product supplied remain U.S.-only.
- Every other new definition is source-published only. National exports, net imports, product supplied, and days-of-supply ratios are never allocated downward.

## Semantic safeguards

- Commercial crude stocks, SPR stocks, and total crude stocks including SPR are overlapping alternate views. Broad stocks including and excluding SPR also overlap. Parents and components are navigation choices, not stackable quantities.
- Days of supply uses canonical unit `days` and exact provider unit `DAYS`. It is a source-published ratio, not an additive quantity, confidence interval, or forecast of exhaustion.
- Net imports are imports minus exports, can be negative, and must not be added to either gross flow.
- PADD imports represent district of entry rather than destination or consumption region.
- Propane stock series `WPRSTUS1` is the current EPLLPZ/SAXP definition excluding propylene at terminals. The older SAE series including terminal propylene ended in 2020 and is not spliced into the active history.
- Propane export series `W_EPLLPZ_EEX_NUS-Z00_MBBLD` is labelled propane only. It is a separate product selection and must not be treated as having the same boundary as the nearby propane/propylene measures.
- Product supplied remains implied demand rather than directly measured end-user consumption.

## Activation evidence and continuing publication gate

Activation passed the registry, geography, unit, identity, coverage, forecast-link, asset-integrity, 90 MiB, and public deployment checks in run `eia-20260722T202149Z`; workflow run `29954739606` deployed it successfully. Every future public promotion must continue to reject unknown source series, geography codes, units, duplicate identities, missing required PADD coverage, or incompatible schemas. A failed candidate leaves the existing last-known-good generation deployable, and documentation counts must always come from the promoted manifest rather than registry projections.

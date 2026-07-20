# Phase 3 refined-products dashboard and reference

## Status and purpose

Phase 3 is the current USA product boundary and is activated and verified locally. It expands the three-series USA foundation into a unified country dashboard with Crude and Refined segments plus a plain-language reference page. The work remains designed for GitHub Pages, but this working directory is not yet an initialized, connected repository and is not a public service. Its original Canada placeholder boundary has since been superseded by the separately approved and implemented [Canada data contract](canada-data.md).

The promoted local manifest is run `eia-20260719T230756Z`. Public manifest and asset verification passed with all 39 active definitions present.

| Field | Verified result |
|---|---|
| Run ID | `eia-20260719T230756Z` |
| Observations inserted by activation | 130,964 |
| Canonical observations after activation | 161,869 |
| Public chart assets | 249 |
| Canonical JSON size | 65.09 MiB |
| Revision events in activation | 0 |
| Active definitions | 39: 3 overview plus 36 refined products |
| Refined-product latest period | `2026-07-10` for all 36 definitions |
| Public verification | Passed |

A normal all-active overlap poll then attempted run `eia-20260719T231244Z`. It reported `changed: false` with 7,873 unchanged rows, created no promoted manifest, retained 249 assets, and kept `eia-20260719T230756Z` current. This verifies the routine no-churn path after activation.

The machine-readable source of truth is [`config/series/usa.json`](../config/series/usa.json). This document explains the user-visible contract and the assumptions that Codex, Claude Code, and future contributors must preserve.

## Implemented scope

- 39 active USA EIA definitions in total: the three Phase 2 overview series plus 36 classified refined-product series.
- A unified `/usa/` dashboard with 2 Crude and 37 Refined definitions. Its cascade is segment, finest available geography level, exact official geography node, product family, product/activity, then measure.
- A backwards-compatible `/products/` route that renders the same USA dashboard initially set to Refined; it is not a separate primary navigation surface.
- A dedicated `/reference/` glossary with searchable definitions, aliases, trader interpretation, inclusions/exclusions, units, frequency, geography, double-counting cautions, and official source links.
- Primary navigation is USA, Canada, and Reference. USA contains the original overview definitions and all Phase 3 refined-product entries behind the Crude/Refined segment choice.
- Live Canadian ingestion was not part of this USA Phase 3 activation. `/canada/` is now implemented under the separate [Canada data contract](canada-data.md); this document does not define its series or methodology.
- All chart assets use the same seasonal, latest-value, delta, distribution, freshness, provenance, and hover contracts as the Phase 2 dashboard.
- All active definitions are included in automated EIA refresh planning. Public row and asset counts are derived from the generated manifest and must not be hard-coded in documentation or UI logic.

## Active refined-product matrix

All 36 additions are weekly EIA series.

| Measure | Count | Products represented | Published geography boundary |
|---|---:|---|---|
| Ending stocks | 13 | Gasoline hierarchy, fuel ethanol, total/sulfur-grade distillate, kerosene-type jet fuel | Select stock series: PADD 1A/1B/1C, PADD 1-5, U.S.; other stock series: PADD 1-5 and U.S. |
| Unadjusted refinery/blender net production | 8 | Finished/conventional/reformulated gasoline; total and three sulfur-grade distillates; kerosene-type jet fuel | PADD 1-5 and U.S. |
| Product supplied (implied demand) | 3 | Finished gasoline, total distillate, kerosene-type jet fuel | U.S. only |
| Imports | 9 | Finished gasoline, gasoline blending components, CBOB, RBOB, fuel ethanol, total and two sulfur-grade distillates, kerosene-type jet fuel | PADD 1-5 and U.S. |
| Exports | 3 | Fuel ethanol, total distillate, kerosene-type jet fuel | U.S. only |

The product-family counts are 18 gasoline, 13 distillate, and 5 jet-fuel series. Counts describe separate product/measure definitions, not quantities that can be added together.

## Product hierarchy and non-additivity

```text
Total motor gasoline
|- Finished motor gasoline
|  |- Conventional motor gasoline
|  `- Reformulated motor gasoline
`- Motor gasoline blending components (MGBC)
   |- CBOB
   |- RBOB
   `- Other blending components not separately represented here

Fuel ethanol: contextual gasoline oxygenate; not a child of MGBC

Total distillate fuel oil
|- 0-15 ppm sulfur
|- >15-500 ppm sulfur
`- >500 ppm sulfur
```

Parent and child series overlap by design. Never stack a parent with its children, add multiple hierarchy levels, or assume the visible children completely reconcile to the parent. Provider adjustments, other components, rounding, and definition differences can prevent equality. Phase 3 component assets expose source-published observations and never compute product rollups. The browser may compute only the same-level additive PADD combinations explicitly registered in `config/aggregation/custom-geography.json`.

Important meanings:

- **Finished motor gasoline** is suitable for use in spark-ignition engines and includes conventional and reformulated finished gasoline.
- **CBOB** and **RBOB** are unfinished blendstocks intended for later oxygenate blending; RBOB is not the same thing as finished reformulated gasoline.
- **Fuel ethanol** is shown with the gasoline family for market context, but the EIA product taxonomy does not place it inside MGBC.
- **Total distillate fuel oil** is broader than on-road diesel. Depending on sulfur grade and use, it includes diesel, heating oil, and other distillate fuel-oil uses. The UI must not relabel total distillate as pure road-diesel demand.
- **Product supplied** is an accounting-balance proxy commonly called implied demand. It is not a direct measurement of end-user consumption and can be noisy or negative for narrow products/periods.
- **Unadjusted refinery/blender net production** is a net balance, not refinery gross output. Negative values can be valid and must not be clipped.
- **Imports by PADD** identify the district of entry, not the location where the product was ultimately consumed.
- **Stocks** are end-of-week inventory levels. Production, product supplied, imports, and exports are weekly average flow rates; they cannot be added to a stock level without a time-consistent balance calculation.

The `/reference/` route is the user-facing explanation layer. Registry `reference_term_ids` link product selections to the relevant glossary entries; the registry remains authoritative for active-series semantics.

## Geography contract

No Phase 3 weekly refined-product series provides city, county, refinery, or state observations. The finest verified detail is:

- PADD 1 subdistricts 1A, 1B, and 1C for total gasoline stocks, total distillate stocks, and each of the three distillate sulfur-grade stock series;
- PADD 1-5 for the other regional stocks, all production series, and imports;
- United States only for product supplied and exports.

Where PADD or national values are available as manifest nodes, they are EIA-published values. The browser does not replace them with a sum. It can display a separately labelled custom combination of two or more mutually exclusive PADDs for registered additive quantities, with complete period coverage and component lineage. The Geography control must remain visible on every chart. After Crude or Refined is chosen, geography levels are ordered finest to broadest and the selected official node or registered same-level set filters every product family, product/activity, measure, and series choice below it. A segment or geography change must fall back deterministically when a downstream choice is no longer valid and explain unavailable finer levels. Registered product leaves precede broader parents; this ordering never authorizes addition.

For imports, `PADD` means district of entry. It must not be labelled destination, consumption region, or final market.

## History, analytics, and repository size

The registry configures safe missing-series bootstrap bounds of `2014-01-01` for weekly data and `2014-01` for monthly data. The Phase 3 activation used the dedicated helper to select exactly the 36 new weekly definitions from `2014-01-01`. This supplies a practical multi-year seasonal baseline while keeping generated repository data within GitHub-friendly limits. The established Phase 2 histories remain intact. A from-scratch or targeted backfill must preserve these boundaries unless a reviewed storage migration changes the policy.

Canonical publication fails closed if `canonical.json` would exceed 90 MiB. The size gate is a safety boundary, not a target. Operators must inspect manifest-derived byte/row/asset counts after every material onboarding and must not bypass the gate to make a refresh succeed.

Seasonal assets continue to show the latest three years over a historical min-max and interquartile band, with median/mean statistics, explicit sample counts, latest deltas, and level/change distribution diagnostics. Incomplete history returns an explicit insufficient-history state.

## Deliberate exclusions

- Weekly motor-gasoline exports are not active. EIA changed the series definition in June 2023 by moving motor gasoline blending component exports into total motor gasoline exports. A single ten-year seasonal history would silently span incompatible definitions. Onboarding requires either a visible regime split/new stable ID or an explicitly justified post-break series.
- No computed product reconciliation, broader-level allocation, or imputation is included. Custom same-level PADD sums are a separately labelled, registry-authorized analytical view.
- Canada live data is governed separately by [Canada data](canada-data.md). Forecasting, machine-learning models, price signals, portfolio recommendations, and trading strategies remain future approved phases.
- The glossary is educational context, not personalized financial advice and not a substitute for the official EIA definition attached to a series.

## Refresh and deployment boundary

The scheduled refresh loads every registry entry with `activation_status: active`, applies the existing retry/validation/revision/atomic-promotion contract, and leaves the last-known-good generation in place on failure. A missing series uses the registry's frequency-specific bootstrap start; after history exists, a normal refresh uses 13-week weekly or 10-year monthly overlap windows rather than re-downloading the bounded history.

Local activation is complete. For a reviewed recovery or from-scratch recreation of the 36 refined-product histories, run this from an interactive PowerShell session and enter a rotated replacement EIA key at the masked prompt:

```powershell
.\scripts\bootstrap-phase3.ps1
```

The helper verifies that exactly 36 active `introduced_in_phase: 3` definitions were selected, keeps a prompted credential process-scoped, removes it afterward, and invokes the normal atomic promotion. It is retained as an onboarding/recovery tool rather than an outstanding Phase 3 step. Non-interactive runs require `EIA_API_KEY` in their process environment.

GitHub deployment is not complete in this workspace. Before any push or public deployment, the owner must:

1. Rotate the EIA API key exposed in conversation.
2. Initialize or connect the Git repository and review generated-data size.
3. Store only the replacement key as the GitHub Actions secret `EIA_API_KEY`.
4. Push the repository, select GitHub Pages with **GitHub Actions**, and run/verify the refresh and deploy workflows.

Never place a credential in source, configuration, documentation, generated assets, command arguments, logs, screenshots, or Git history.

## Phase 3 definition of done

Phase 3 data activation requires:

- the registry contains the 39 active, metadata-verified definitions described above;
- the generated manifest and every referenced asset pass schema, checksum, byte-count, geography, unit, facet, identity, and credential scans;
- `/usa/`, `/canada/`, `/reference/`, and the legacy `/products/` compatibility entry build as direct routes;
- country pages select Crude/Refined, geography level/node, product family, product/activity, and measure in that order;
- segment and Geography changes load only compatible manifest entries and never preserve an invalid downstream selection silently;
- hierarchy/non-additivity, implied-demand, distillate, net-production, imports, and export-break caveats are visible from the product or reference experience;
- tests and the production build pass; and
- public-service status is not claimed until GitHub setup and deployment have actually succeeded.

All local activation conditions above passed for run `eia-20260719T230756Z`. GitHub repository setup, key rotation, and public Pages deployment remain a separate handoff.

See [the data catalog](data-catalog.md), [data contract](data-contract.md), [geography policy](geography.md), [analytical methodology](methodology.md), and [update runbook](update-runbook.md) for the implementation contracts.

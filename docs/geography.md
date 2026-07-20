# Geography and aggregation contract

## User-facing promise

Every chart has the same Geography control. It exposes the smallest official detail available for the active series and valid larger views. “Available for all charts” means the control is universal; it does not mean every level is valid for every source or metric.

The app must be honest about official granularity. A city label is not a license to estimate city data from state, PADD, province, refinery-region, or national totals.

On each primary country page, users choose Crude or Refined first, then the finest available geography level and an exact official region before selecting a product and measure. The Geography control can be universal without implying that every source or metric supports every level.

## Control behavior

For every active series, the control must:

1. Remain present in a consistent chart-header location.
2. Load options from the active country manifest and registered `GeographyAvailability`, never from a country-wide hard-coded list alone.
3. Order valid options from the smallest official or validated grain to the broadest.
4. Distinguish badges or help text for `source-published` and `computed rollup` values.
5. Disable unsupported levels when their visibility helps explain the data boundary.
6. Explain why a level is disabled and name the smallest available level.
7. After a segment or geography change, preserve a downstream family/product/measure only if an asset at that exact node still supports it; otherwise choose the first valid compatible option and announce the change.
8. Provide keyboard access, a textual selection summary, and non-color status cues.
9. Offer Single/Combined only when the exact series and level has an entry in `config/aggregation/custom-geography.json`; otherwise disable Combined with a reason.
10. Keep all members of a custom combination at one official, mutually exclusive level and filter every downstream product/measure against the entire selected set.

The country-page cascade is:

```text
USA or Canada route
-> Crude or Refined
-> finest available geography level (with broader levels available)
-> exact official geography node
-> product family
-> product/activity (registered leaves before registered parents)
-> measure
```

Selecting a geography filters every downstream choice. For example, selecting a PADD 1 subdistrict can offer only the refined products and measures that publish an asset for that exact subdistrict; it cannot continue to expose finished-gasoline production or U.S.-only product supplied. Conversely, choosing a product never fabricates geography support. `/products/` is only a backwards-compatible USA entry with Refined selected and follows the same cascade.

Example disabled explanation: “City data is not published for EIA weekly refinery utilization. The smallest official geography for this series is PADD.”

## User-selected regional combinations

The Combined control is an explicit analytical view, not a new source-published geography. Its current authorization registry is `config/aggregation/custom-geography.json`, with membership version `2026-07-20.2`. Registered views are limited to:

- compatible additive USA quantities across PADD 1-5;
- USA monthly crude oil field production across state/producing-area nodes;
- compatible additive Statistics Canada quantities across source-published province/territory nodes;
- CER crude runs across two or all three mutually exclusive confidentiality regions.

The registry still excludes PADD 1 subdistrict plus PADD combinations because those levels overlap, and it excludes utilization and every other percentage because no registered numerator/capacity pair authorizes a ratio of sums. Source-published national/PADD/Canada totals remain separate choices and are never silently substituted for a custom sum.

### Containment is decided by the geography DAG, not the level label

State/producing-area sums are authorized only for monthly crude oil field production, and only with an explicit containment guard, because **sharing a `level_id` does not prove two nodes are mutually exclusive**. EIA publishes Alaska South (`us.ak.south`) at the same `state_or_area` level as its declared parent Alaska (`us.ak`), so a naive same-level sum double-counts Alaska South.

`src/data/geographyContainment.ts` therefore derives each node's atomic membership from the registered `parent_ids` closure — a node covers itself plus every descendant — and the aggregation engine rejects any selection whose members share an atom through its existing `overlapping_members` rule. The region picker disables the conflicting option first and names the region it overlaps, so the combination cannot be built in the first place. Alaska South stays individually selectable and remains combinable with any region that does not contain it.

Verification against the current promoted vintage (`2026-04`): the 34 authorized state/producing-area members sum to 13,933 thousand barrels per day against EIA's separately published national 13,934, a 0.007% difference attributable to the source's own rounding. Including Alaska South raises the sum to 13,940 and overstates national production, which is exactly the outcome the containment guard prevents.

Adding any new same-level node requires re-checking `parent_ids` for containment before it may join a registered sum. Do not invent parent edges the source does not publish: the Statistics Canada Atlantic aggregate genuinely contains NB/NL/NS/PE but is published at `source_region` rather than `province_territory`, and mixing levels in one combination is already refused upstream.

For each period the app requires every selected member exactly once, matching frequency, unit, scale, period semantics, schema, semantic dimensions, methodology regime, and membership version. Any absent or nonnumeric component makes that combined period unavailable with its original blocking status. The app recomputes bands and distributions from aligned observations and records component keys/checksums in lineage. It never sums component bands, percent values, histograms, or forecast interval endpoints.

## Official finer-source policy

When users would benefit from smaller geography, source onboarding must search official public catalogs for a legitimate finer-grain series. An alternative source can be added only when its concept, unit, frequency, coverage, methodology, and update license are documented. Its values remain a distinct series unless comparability has been proven.

Allowed:

- show a city/metro series directly published by an official agency;
- show a public facility series when confidentiality and licensing allow it;
- roll exact facility observations to a city if the facility-to-city membership is explicit, time-valid, complete, and the metric is additive;
- offer state and PADD views side by side when each is source-published.

Forbidden:

- allocate PADD demand to cities using population or sales shares and label it observed;
- infer refinery throughput from nameplate capacity and regional utilization;
- divide a national total among provinces/states merely to fill a map;
- treat interpolated, modeled, or imputed values as official observations;
- relabel one provider's “Western Canada” as another provider's statistical western region without a documented equivalence.

Modeled geographic estimates may be explored only in a later, explicitly labeled modeling product with uncertainty and methodology. They cannot enter the observed-data contract.

## Geography graph

The hierarchy is a directed acyclic graph (DAG), not a universal tree. This matters because:

- state/area and PADD are different EIA dimensions;
- PADD 1 has source subdistricts not mirrored across every PADD;
- federal offshore areas do not behave exactly like states;
- Canadian province/territory groupings differ by provider;
- CER refinery regions are confidentiality groupings, not general-purpose statistical regions.

`GeographyNode.parent_ids` records candidate larger views. It does not by itself authorize aggregation. Authorization also requires `GeographyAvailability`, a valid aggregation rule, time-valid membership, and a passing coverage check.

`granularity_rank` orders levels for display only. In the illustrative config, lower numbers are finer and `100` is national. A rank never proves that two levels are comparable or aggregatable.

## Aggregation rules

Only four rule kinds are allowed.

### `sum`

Use for additive quantities such as barrels, cubic metres, barrels per day measured over the same period convention, or counts.

\[
X_{parent,t} = \sum_{i \in members(parent,t)} X_{i,t}
\]

Do not sum rates with incompatible denominators or duplicate overlapping geographies. Prefer the provider-published parent total when available; a component sum can be retained as a reconciliation check.

### `ratio_of_sums`

Use for ratios such as refinery utilization when compatible numerator and denominator observations exist.

\[
R_{parent,t} = \frac{\sum_i N_{i,t}}{\sum_i D_{i,t}}
\]

Never average child percentages arithmetically. The series definition must name `numerator_series_id` and `denominator_series_id`. When the canonical output unit is percent, it must also declare `scale: 100`; the scale may not be inferred silently by the UI.

### `weighted_average`

Use for rates or prices only when an appropriate, same-period weight series is available.

\[
\bar{X}_{parent,t} = \frac{\sum_i w_{i,t}X_{i,t}}{\sum_i w_{i,t}}
\]

The series definition must name `weight_series_id`, define missing-weight behavior, and explain why the weight is economically meaningful.

### `not_aggregatable`

Use when a larger view cannot be derived without changing the concept, when required components/weights are unavailable, or when overlapping source regions would double-count. Only source-published values may then be offered.

## Completeness and coverage gate

A computed parent value is publishable only when all checks pass for that period:

- membership version is known and effective for the period;
- every expected child is present exactly once;
- child geographies are mutually exclusive for the concept;
- no child is withheld, suppressed, not applicable, or unresolved;
- frequency and period boundary semantics match;
- canonical units and scale factors match;
- all required numerator/denominator/weight series are present;
- source-methodology breaks do not cross the calculation;
- the source does not warn that components exclude material included in its total;
- any rounding difference remains within a documented tolerance.

The asset records:

- `expected_component_count`;
- `observed_component_count`;
- `coverage_ratio`;
- `membership_version`;
- component observation keys and values;
- aggregation rule and input series;
- validation result and tolerance;
- published-total reconciliation when available.

Default policy requires `coverage_ratio = 1.0`. A lower threshold must be an explicit methodology decision and must never be used for ratios or market totals merely for convenience. When coverage fails, show the published parent if it exists; otherwise mark the computed view unavailable and explain the missing coverage.

## Published total versus computed rollup

Provider-published totals are preferred because they may include confidential components, adjustments, independent estimates, or unrounded inputs unavailable to the public. The UI labels their origin as source-published.

A computed rollup is useful when no official total exists or for reconciliation. It must retain full lineage and carry a computed badge. If a computed and published total differ beyond tolerance, block the update for that derived asset and investigate; do not silently replace one with the other.

## Availability examples

The active Phase 3 registry availability is shown below. Provider-free promoted run `analytics-20260720T152511Z` contains and verifies all 36 refined-product definitions alongside the three overview definitions.

| Active series | Finest verified source-published view | Larger source-published views | Unavailable levels |
|---|---|---|---|
| EIA weekly refinery utilization | PADD 1-5 | United States | PADD subdistrict, state/area, county, city |
| EIA monthly crude production | 32 states plus Alaska South and two federal-offshore areas | PADD 1-5, United States | PADD subdistrict, county, city |
| EIA weekly total products supplied | United States | None | PADD, PADD subdistrict, state/area, county, city |
| Refined: total gasoline and total/sulfur-grade distillate stocks | PADD 1A/1B/1C | PADD 1-5, United States | State/area, county, city |
| Refined: other gasoline/ethanol/jet stocks | PADD 1-5 | United States | PADD subdistrict, state/area, county, city |
| Refined: unadjusted net production | PADD 1-5 | United States | PADD subdistrict, state/area, county, city |
| Refined: imports | PADD 1-5 (district of entry) | United States | PADD subdistrict, state/area, county, city |
| Refined: product supplied and exports | United States | None | PADD, PADD subdistrict, state/area, county, city |

All active Phase 3 views are provider-published. The app does not calculate PADD/U.S. crude production by summing displayed state/special rows, because special-area overlap and provider adjustments can make that sum unsafe. It does not allocate U.S. product supplied or exports downward. It does not sum PADD 1 subdistrict stocks into a district or add product parent/child series. It uses EIA-published utilization percentages; any future calculated utilization rollup must use compatible input/capacity ratio-of-sums.

EIA's weekly trade route can encode stable areas with raw aliases such as `NUS-Z00` and `R10-Z00`. The geography registry maps these aliases to the same U.S./PADD nodes and rejects unknown codes. A trade PADD is a reporting concept specific to the measure: for imports it is district of entry, not destination or consumption region.

The broader table below remains onboarding guidance for illustrative and future sources.

| Series type | Likely smallest official grain | Larger choices | City behavior |
|---|---|---|---|
| EIA monthly crude production | State/area where published | PADD, U.S. | Disabled unless an official city/facility source is onboarded |
| EIA weekly refinery utilization | Route-specific `duoarea`, commonly PADD/subdistrict | PADD, U.S. | Disabled; do not allocate to refinery cities |
| EIA weekly product supplied | Often U.S. for a selected series | U.S. only | Disabled with national-only explanation |
| EIA weekly refined products | PADD 1 subdistrict for select stocks; otherwise PADD or U.S. | Source-published parent only | Disabled; no city/state allocation |
| Statistics Canada crude supply/disposition | Province/territory or source region for supported combinations | Published region, Canada | Disabled unless a compatible official local table exists |
| CER weekly refinery runs | Three confidentiality regions | Canada if published or complete sum | Refinery/city disabled because source intentionally aggregates |

These are catalog expectations, not a substitute for metadata discovery. The active series registry is authoritative only after verification.

## Change management and tests

Any geography change requires:

1. official metadata or crosswalk evidence;
2. versioned node/provider codes and effective dates when relevant;
3. per-series availability update;
4. aggregation and coverage tests;
5. UI tests for selection, fallback, disabled reason, and screen-reader text;
6. a data-catalog and methodology update if semantics changed.

Tests must prove that unsupported city requests fail closed, an incomplete rollup is not emitted, a ratio uses ratio-of-sums, segment/geography changes cannot retain an invalid downstream choice silently, exact provider-specific geography identities remain distinct, and product/activity leaves precede registered parents.

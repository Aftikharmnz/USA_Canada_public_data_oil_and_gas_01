# Phase 1 scope

> Historical boundary: Phase 1 is complete. The current implementation boundary is [Phase 3 refined products](phase-3-refined-products.md); [Phase 2 USA MVP](phase-2-usa-mvp.md) is also historical.

## Objective

Create a trustworthy foundation for a public, static USA/Canada energy dashboard before scaling the catalog. Phase 1 converts product assumptions into versioned contracts so later ingestion, UI, and forecasting work can proceed without guessing.

## Included

- Static GitHub Pages plus scheduled GitHub Actions architecture.
- USA and Canada application/page shells with shared design primitives.
- A universal Geography control contract for every chart.
- Versioned provider, series, observation, geography, availability, revision, freshness, and manifest concepts.
- Illustrative USA and Canada source registries.
- Illustrative geography hierarchies that support a directed acyclic graph rather than a forced single ladder.
- Ingestion/update scaffolding, validation boundaries, deterministic sample assets, and tests appropriate to the foundation.
- Seasonal-band, delta, distribution, and freshness methodology specifications.
- Documentation and agent entry points for Codex, Claude Code, and human contributors.
- GitHub workflow/deployment skeletons where implemented by the associated workstream.

## Geographic requirement

“The filter should be available for all” means the Geography control is present on every chart in the same location and follows the same interaction model. It does **not** mean every metric offers every level.

For each series, the app must:

1. Discover and register the smallest official published geography.
2. Search for a finer official public source if finer insight is valuable and legally/programmatically accessible.
3. Offer source-published or validated larger views.
4. Disable and explain unsupported levels rather than fabricate them.
5. Block rollups when coverage or membership is incomplete.
6. retain component and membership lineage for every computed rollup.

Examples:

- Monthly U.S. crude production can be state/area-level where EIA publishes it, then PADD and national.
- Weekly refinery utilization may begin at a PADD or source-defined subdistrict rather than a state.
- Weekly EIA product supplied may be national-only for a particular product/series.
- Statistics Canada tables may publish province/territory rows for some combinations but national-only rows for others.
- CER weekly refinery runs are intentionally grouped into three refinery regions for confidentiality; refinery or city values must not be inferred.

## Explicitly not included

- Production activation of every candidate series in the illustrative registries.
- Guaranteed minute-level release latency or an operational SLA.
- A backend database, authenticated user accounts, paid feeds, or server-side application runtime.
- Manufactured city/refinery estimates where no public official observations exist.
- Cross-source splicing without an approved comparability analysis.
- Predictive models, trade recommendations, position sizing, or production signals.
- Exhaustive reading or implementation of the supplied books. That begins only in the approved forecasting phase.

## Phase 1 acceptance criteria

- The repository explains how to build, update, validate, and deploy the foundation without undocumented assumptions.
- No credential value appears in committed files.
- The frontend can represent separate USA and Canada routes and a consistent chart shell.
- Every chart shell can represent valid, disabled, loading, stale, and unavailable geography options.
- Registry examples are valid machine-readable files and include per-series geography/aggregation semantics.
- Contract tests can reject unsupported aggregation, incomplete coverage, duplicate observation keys, incompatible units/periods, and accidental secret-like configuration.
- Freshness distinguishes observation period, source update/release time when known, retrieval time, asset generation time, and site deployment time.
- Failed updates preserve last-known-good assets.

## Exit decision

After Phase 1 review, approve the USA MVP as the next phase. Activate a deliberately small set of EIA series end to end before adding the Canada integrations, then expand only after the update and revision behavior is observed in real releases.

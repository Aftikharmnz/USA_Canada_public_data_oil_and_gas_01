# Configuration registries

`series/` contains source/metric definitions and per-series geography availability. `geographies/` contains level and node DAG examples with provider-code mappings.

These Phase 1 files are illustrative contracts, not proof that each source combination is production-active. `activation_status` must remain `illustrative_phase_1` until current official metadata and fixtures have been verified.

Rules:

- no credentials or credentialed URLs;
- stable internal IDs, provider codes stored separately;
- universal Geography control with series-specific valid options;
- unsupported finer levels include a reason;
- rollups use only `sum`, `ratio_of_sums`, `weighted_average`, or `not_aggregatable`;
- exact node-level availability replaces level placeholders before production activation;
- provider-published totals are distinguished from computed rollups;
- registry and schema changes require tests and documentation updates.


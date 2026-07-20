# ADR 0003: Source-aware geography DAG and universal control

- Status: accepted
- Date: 2026-07-19

## Context

Users want the smallest available detail and larger regional views on every chart. EIA, Statistics Canada, and CER publish different and sometimes metric-specific geographies. A fixed city→state/province→region→country tree would imply detail that does not exist and misrepresent source-defined regions.

## Decision

Render one Geography control on every chart, populated from per-series availability. Model geography as a DAG with provider codes and versioned membership. Seek an official finer-grain source when available; otherwise disable/explain unsupported levels. Never fabricate city/local observations. Computed rollups require an approved rule, complete coverage, compatible periods/units, and component lineage.

## Consequences

- The interaction stays consistent while data boundaries remain honest.
- A metric can be national-only without a special chart layout.
- Onboarding requires more metadata and tests.
- Cross-source regions are not treated as equivalent without evidence.


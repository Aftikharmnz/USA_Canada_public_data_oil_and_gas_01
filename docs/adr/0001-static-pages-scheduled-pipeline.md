# ADR 0001: Static Pages with scheduled ingestion

- Status: accepted
- Date: 2026-07-19

## Context

The product needs a public link, interactive charts, and automatic updates from credentialed and non-credentialed public sources. A browser-only application would expose credentials, duplicate ingestion work for every user, and provide no reliable revision/cache layer.

## Decision

Build a static React/TypeScript site and deploy it to GitHub Pages. Run Python ingestion, validation, derivation, and build jobs in GitHub Actions. Publish only validated chart assets and status manifests. Keep the last-known-good deployment when an update fails.

## Consequences

- Hosting is inexpensive and simple; the app has no server runtime.
- Credentials stay in Actions secrets and never reach the browser.
- Update latency follows scheduled workflow and upstream availability rather than page visits.
- GitHub scheduling is best effort, so retries, safety runs, freshness disclosure, and manual dispatch are required.
- If data/history/SLA requirements outgrow GitHub, ingestion/storage can move while preserving the static asset contract.


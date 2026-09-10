# CER enrichment verification — September 10, 2026 UTC

## Delivered boundary

Added 14 propane/butane export definitions (two products, seven first-destination
views) and Trans-Northern monthly throughput through the existing Canada CLI.
All are distinct Refined source families. See [source contracts](../cer-data.md).
No provincial gasoline balance, capacity, missing value or product split is inferred.

## Real-source ingestion

- Full Canada refresh promoted `canada-20260910T055513Z`: 96 definitions,
  81,123 canonical observations, 695 observed assets and 695 forecast records.
- Inserted 7,942 rows; revised zero; matched 68,056 unchanged overlap rows.
- NGL source: 7,684 retained facts plus 48 explicit latest-absence markers;
  109 factual series/geography views, January 2016–May 2026.
- Trans-Northern: 210 retained rows across three source reporting scopes;
  system history from January 2014, point history from January 2024, through June 2026.
- Canonical JSON: 39,609,838 bytes, growth 4,379,745 bytes; unchanged shard,
  revision, logical-size and 8 MiB growth guards passed.
- Repeated live monthly CER refresh attempted `canada-20260910T060404Z` and
  returned the same CURRENT with `changed: false`, zero insertions/revisions,
  7,670 matched overlap rows and no promotion/pruning.
- `verify-store` validated CURRENT and all indexed shards without provider calls.

Forecasts are 483 ready, 90 limited-history and 122 unavailable. Many export
routes have short or discontinuous histories; absent current facts cannot be
zero-filled or forecast from an earlier numeric endpoint. No interval is guaranteed.

## Regression and browser verification

- 176 Python pipeline tests passed after promotion.
- 693 frontend tests passed, including all new public assets, refined numerical
  history checks, units, profile rendering and exact registry/public cohorts.
- TypeScript and repository-base-path production build passed. Existing Vite
  large-chunk advisory remains non-fatal; no dependency change was needed.
- Local Canada Refined profile rendered Alberta CER propane destination cards
  as seasonal charts, with totals explicitly non-additive with destination detail.
- Alberta total exports: 225,080 m³ in May 2026; switching to kbbl displayed
  1,415.71 kbbl using the application's exact conversion.
- Montreal-West throughput: 7.9 thousand m³/d in June 2026; kb/d displayed 49.69.
  Expanded overlay and source-only monthly frequency worked.
- New profile families omit the generic supply/demand and unrelated broad
  movement panels. Pipeline reporting points are not assigned province parents.
- Successive-release tests preserve prior explicit absence markers while still
  rejecting deletion of previously numeric provider rows. Late source values
  revise missing markers through the ordinary ledger.
- Wrong provider/unit, schema/member drift, conflicting duplicates and failed
  downloads are rejected without replacing last-known-good data.

## Automation and remaining limits

The existing Canada workflow polls at 10:53 and 14:23 America/Toronto on weekdays,
uses bounded source retries and publishes only a changed validated generation.
Each NGL file is fetched once for all destinations. No browser credential or
manual spreadsheet step is introduced. Pipeline observations are monthly but
the file is updated quarterly/as needed. GitHub scheduling and provider release
timing are not instantaneous guarantees.

NGL monthly exports remain volume-only: the positive monthly-average-rate
authorization currently covers Statistics Canada flows, not CER export volumes.
Trans-Northern is natively a daily rate and supports bbl/d and kb/d.

The pipeline adapter stores HTTP Last-Modified separately from the observation
month. Public propagation is implemented and tested; this initial generation
was built before that metadata-only UI propagation change, so its public update
timestamp remains unavailable. Header-only changes intentionally do not force
new generations; a subsequent changed refresh carries source-file update time.

Retention removed the older `canada-20260803T170245Z` local cache generation,
keeping CURRENT and its September 10 predecessor. The removed generation remains
recoverable from repository history. No USA data or source definitions changed.

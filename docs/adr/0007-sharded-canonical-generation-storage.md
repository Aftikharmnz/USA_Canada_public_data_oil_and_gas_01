# ADR 0007: Deterministic sharded canonical generation storage

- Status: accepted
- Date: 2026-08-10

## Context

The USA canonical generation reached 90,001,839 bytes. The former 90 MiB
guard kept one `canonical.json` below GitHub's 100 MiB ordinary-Git file
limit, but it also prevented the reviewed monthly PADD supply/disposition
expansion. Raising that single-file guard would only postpone a guaranteed
publication failure.

The public GitHub Pages contract is already partitioned under `public/data`.
Only the private pipeline generation store needs a new physical layout; the
logical observation keys, revision ledger, browser URLs, and public asset
schemas do not need to change.

## Decision

New generations store canonical observations in deterministic
`series_id/year` shards under `canonical/`, plus a checksummed `index.json`.
Every shard is sorted by canonical observation key and receives a stable name
derived from the series ID and period year. The generation manifest records
the logical canonical checksum and byte count as well as the index checksum
and shard count.

The writer and verifier enforce three independent gates:

- no canonical shard may exceed 16 MiB;
- the logical canonical generation may not exceed 128 MiB; and
- one generation may grow by at most the larger of 10% or 8 MiB relative to
  `CURRENT` without a reviewed code/configuration change.

The still-single-file revision ledger is capped at 16 MiB. Reaching that
boundary requires a reviewed deterministic revision-sharding migration; the
cap prevents an append-only ledger from silently approaching GitHub's
ordinary-file limit.

The reader remains backwards compatible with schema `1.0.0` generations that
contain one `canonical.json`. Schema `1.1.0` generations must use only the
sharded layout. Mixed layouts, missing or extra shards, duplicate keys,
partition drift, row-order drift, identity mismatches, budget violations, and
checksum/byte/count mismatches all fail closed before `CURRENT` or public data
can move. After placing a candidate generation at its immutable final path,
the publisher reads it back through the same verifier before replacing
`CURRENT`.

## Consequences

- A routine revision changes only the affected series/year Git blob instead
  of rewriting the full canonical history.
- The next successful refresh or provider-free analytics rebuild migrates the
  new generation automatically; retained legacy predecessors remain readable.
- GitHub Pages still receives only the existing small, secret-free public
  assets. Git LFS is neither required nor suitable for the Pages payload.
- Sharding removes the per-file bottleneck but does not make repository growth
  unbounded. Aggregate and generation-growth gates remain operational review
  boundaries.
- If canonical history later outgrows these bounded same-repository limits,
  immutable object/release storage can replace the generation store while the
  public asset contract remains stable.

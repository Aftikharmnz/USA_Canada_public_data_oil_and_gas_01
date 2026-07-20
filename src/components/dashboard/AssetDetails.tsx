import { formatDateTime } from "../../lib/formatters";
import type { ManifestGeography, UsaChartAsset, UsaManifestSeries } from "../../types/energyAssets";

export function AssetDetails({
  asset,
  series,
  geography,
}: {
  asset: UsaChartAsset;
  series: UsaManifestSeries;
  geography: ManifestGeography;
}) {
  const lineage = asset.aggregation_lineage;
  return (
    <section className="asset-details" aria-labelledby="asset-details-title">
      <div>
        <p className="section-kicker">Audit trail</p>
        <h2 id="asset-details-title">Source and methodology</h2>
      </div>
      <dl>
        <div><dt>Source</dt><dd>{series.source.url ? <a href={series.source.url} target="_blank" rel="noreferrer">{series.source.name}</a> : series.source.name}</dd></div>
        <div><dt>Geography</dt><dd>{geography.label} · {geography.origin === "computed-rollup" ? "computed rollup" : "source-published"}</dd></div>
        <div><dt>Asset generated</dt><dd>{formatDateTime(asset.generated_at)}</dd></div>
        <div><dt>Methodology</dt><dd>{asset.methodology_version}</dd></div>
        <div><dt>Source checksum</dt><dd><code>{asset.source_checksum.slice(0, 16)}…</code></dd></div>
        {lineage ? (
          <div>
            <dt>Aggregation coverage</dt>
            <dd>
              {typeof lineage.coverage_ratio === "number" ? `${(lineage.coverage_ratio * 100).toFixed(0)}%` : "Recorded"}
              {lineage.membership_version ? ` · membership ${lineage.membership_version}` : ""}
            </dd>
          </div>
        ) : null}
      </dl>
      {series.source.notes ? <p>{series.source.notes}</p> : null}
    </section>
  );
}

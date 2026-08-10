import { formatDateTime } from "../../lib/formatters";
import type { ManifestGeography, UsaChartAsset, UsaManifestSeries } from "../../types/energyAssets";
import { ChartDetailsToggle } from "./ChartDetailsToggle";

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
  const geographyOrigin = geography.origin === "computed-rollup"
    ? "computed rollup"
    : "source-published";
  const coverage = lineage
    ? typeof lineage.coverage_ratio === "number"
      ? `${(lineage.coverage_ratio * 100).toFixed(0)}% coverage`
      : "coverage recorded"
    : null;
  const source = series.source.url ? (
    <a href={series.source.url} target="_blank" rel="noreferrer">{series.source.name}</a>
  ) : series.source.name;
  return (
    <section className="asset-details graph-first-panel" aria-label="Source and methodology">
      <ChartDetailsToggle
        summary={(
          <>
            {source} · {geography.label} · {geographyOrigin} · generated {formatDateTime(asset.generated_at)}
            {coverage ? ` · ${coverage}` : ""}
          </>
        )}
      >
        <dl>
          <div><dt>Source</dt><dd>{source}</dd></div>
          <div><dt>Geography</dt><dd>{geography.label} · {geographyOrigin}</dd></div>
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
      </ChartDetailsToggle>
    </section>
  );
}

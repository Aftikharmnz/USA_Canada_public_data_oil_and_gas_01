import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type {
  ManifestGeography,
  UsaChartAsset,
  UsaManifestSeries,
} from "../../types/energyAssets";
import { AssetDetails } from "./AssetDetails";

describe("AssetDetails graph-first disclosure", () => {
  it("keeps provenance and aggregation coverage visible while collapsing audit metadata", () => {
    const series = {
      source: {
        name: "Statistics Canada",
        url: "https://www150.statcan.gc.ca/",
        notes: "Official source note.",
      },
    } as UsaManifestSeries;
    const geography = {
      geography_id: "ca.ab-sk",
      label: "Alberta + Saskatchewan",
      level_id: "custom",
      level_label: "Custom region",
      origin: "computed-rollup",
      status: "available",
    } satisfies ManifestGeography;
    const asset = {
      generated_at: "2026-08-10T12:00:00Z",
      methodology_version: "test-methodology",
      source_checksum: "0123456789abcdef0123456789abcdef",
      aggregation_lineage: {
        coverage_ratio: 1,
        membership_version: "test-membership",
      },
    } as UsaChartAsset;

    const html = renderToStaticMarkup(
      <AssetDetails asset={asset} series={series} geography={geography} />,
    );
    const hiddenRegionIndex = html.indexOf('class="chart-details-toggle-content"');
    const visible = html.slice(0, hiddenRegionIndex);
    const details = html.slice(hiddenRegionIndex);

    expect(visible).toContain("Statistics Canada");
    expect(visible).toContain("Alberta + Saskatchewan");
    expect(visible).toContain("computed rollup");
    expect(visible).toContain("100% coverage");
    expect(visible).toContain("Show details");
    expect(details).toContain('hidden=""');
    expect(details).toContain("test-methodology");
    expect(details).toContain("0123456789abcdef");
    expect(details).toContain("Official source note.");
  });
});

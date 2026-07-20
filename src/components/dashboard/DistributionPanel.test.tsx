import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { DistributionSample, UsaChartAsset, UsaManifestSeries } from "../../types/energyAssets";
import { DistributionPanel } from "./DistributionPanel";

function sample(mean: number, lower: number, upper: number): DistributionSample {
  return {
    count: 10,
    mean,
    median: mean,
    stddev: 250,
    min: lower,
    q1: lower,
    q3: upper,
    max: upper,
    iqr: upper - lower,
    skewness: 0.1,
    excess_kurtosis: -0.2,
    histogram: [{ lower, upper, count: 10 }],
    fit: null,
  };
}

const asset = {
  frequency: "monthly",
  unit: "thousand_barrels",
  distribution: {
    levels: sample(1_500, 1_000, 2_000),
    changes: sample(100, -500, 500),
  },
} as UsaChartAsset;

const series = {
  view_id: "stocks",
  series_id: "stocks",
  title: "Stocks",
  category: "Inventories",
  unit: "thousand_barrels",
  frequency: "monthly",
  source: { name: "Official source" },
  freshness: { status: "unknown" },
  geographies: [{
    geography_id: "us",
    label: "United States",
    level_id: "national",
    level_label: "Country",
    origin: "source-published",
    status: "available",
    asset_path: "stocks.json",
  }],
  unsupported_levels: [],
} as UsaManifestSeries;

describe("DistributionPanel display units", () => {
  it("converts histogram bounds and summary statistics without changing counts", () => {
    const html = renderToStaticMarkup(
      <DistributionPanel
        asset={asset}
        series={series}
        geographyId="us"
        onGeographyChange={() => undefined}
        displayUnit="million_barrels"
      />,
    );

    expect(html).toContain("1.5 MMbbl");
    expect(html).toContain("1 MMbbl to 2 MMbbl: 10 observations");
    expect(html).toContain("0.1 MMbbl");
    expect(html).toContain("10 observations");
  });
});

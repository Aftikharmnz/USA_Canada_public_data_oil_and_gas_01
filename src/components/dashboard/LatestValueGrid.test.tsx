import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { UsaChartAsset, UsaManifestSeries } from "../../types/energyAssets";
import { LatestValueGrid, latestSourceContext } from "./LatestValueGrid";

const emptyDistribution = {
  count: 0,
  mean: null,
  median: null,
  stddev: null,
  min: null,
  q1: null,
  q3: null,
  max: null,
  iqr: null,
  skewness: null,
  excess_kurtosis: null,
  histogram: [],
  fit: null,
};

const series: UsaManifestSeries = {
  view_id: "can.statcan.crude.closing_inventory.monthly",
  series_id: "can.statcan.crude.closing_inventory.monthly",
  title: "Crude oil closing inventory",
  category: "Inventories",
  unit: "cubic_metres",
  frequency: "monthly",
  source: { name: "Statistics Canada" },
  freshness: {
    status: "unknown",
    latest_period: "2026-04",
    latest_numeric_period: "2017-12",
    latest_observation_status: "mixed",
    checked_at: "2026-07-20T00:03:29Z",
  },
  geographies: [],
  unsupported_levels: [],
};

const asset: UsaChartAsset = {
  schema_version: "1.0.0",
  series_id: "can.statcan.crude.closing_inventory.monthly",
  geography_id: "ca.bc",
  dimensions: {},
  frequency: "monthly",
  unit: "cubic_metres",
  generated_at: "2026-07-20T00:03:29Z",
  source_checksum: "abcdef0123456789",
  freshness: {
    status: "unknown",
    latest_period: "2026-04",
    latest_numeric_period: "2017-12",
    latest_observation_status: "suppressed_or_withheld",
    retrieved_at: "2026-07-20T00:03:29Z",
  },
  recent_years: [],
  baseline: {
    status: "insufficient_history",
    baseline_start_year: null,
    baseline_end_year: null,
    eligible_years: [],
    eligible_year_count: 0,
    excluded_years: [],
    slots: [],
  },
  latest: {
    period: "2017-12",
    value: 554461,
    previous_period: "2017-11",
    absolute_change: -24050,
    percent_change: -4.157,
    year_ago_period: "2016-12",
    yoy_absolute_change: 3027,
    yoy_percent_change: 0.549,
    seasonal_median: null,
    distance_from_seasonal_median: null,
    seasonal_percentile: 100,
  },
  latest_source: {
    period: "2026-04",
    value: null,
    status: "suppressed_or_withheld",
  },
  distribution: { levels: emptyDistribution, changes: emptyDistribution },
  methodology_version: "2026-07-19.1",
  aggregation_lineage: null,
};

describe("LatestValueGrid source-period context", () => {
  it("separates a suppressed source period from the latest numeric value", () => {
    const context = latestSourceContext(asset, series);
    expect(context).toMatchObject({
      sourcePeriod: "2026-04",
      numericPeriod: "2017-12",
      observationStatus: "suppressed or withheld",
      sourcePeriodDiffers: true,
      checkedAt: "2026-07-20T00:03:29Z",
    });

    const html = renderToStaticMarkup(<LatestValueGrid asset={asset} series={series} />);
    expect(html).toContain("Source period Apr 2026 is suppressed or withheld.");
    expect(html).toContain("Latest numeric value shown: Dec 2017.");
    expect(html).toContain("Latest numeric value");
    expect(html).toContain("554,461 m³");
    expect(html).toContain("Show details");
    expect(html).toContain('class="chart-details-toggle-content"');
    expect(html).toContain('hidden=""');
    expect(html).not.toContain("Latest validated observation");

    const collapsedDetails = html.indexOf('class="chart-details-toggle-content"');
    const visible = html.slice(0, collapsedDetails);
    expect(html.indexOf("Source period Apr 2026 is suppressed or withheld.")).toBeLessThan(collapsedDetails);
    expect(visible).toContain("latest 554,461 m³ (Dec 2017)");
    expect(visible).toContain("change -24,050 m³ vs Nov 2017");
  });

  it("keeps a same-period preliminary source status in the visible graph-first summary", () => {
    const preliminaryAsset: UsaChartAsset = {
      ...asset,
      freshness: {
        ...asset.freshness,
        status: asset.freshness?.status ?? "unknown",
        latest_period: "2017-12",
        latest_numeric_period: "2017-12",
        latest_observation_status: "preliminary",
      },
      latest_source: {
        period: "2017-12",
        value: asset.latest.value,
        status: "preliminary",
      },
    };
    const preliminarySeries: UsaManifestSeries = {
      ...series,
      freshness: {
        ...series.freshness,
        status: series.freshness.status,
        latest_period: "2017-12",
        latest_numeric_period: "2017-12",
        latest_observation_status: "preliminary",
      },
    };

    const html = renderToStaticMarkup(
      <LatestValueGrid asset={preliminaryAsset} series={preliminarySeries} />,
    );
    const visible = html.slice(0, html.indexOf('class="chart-details-toggle-content"'));

    expect(visible).toContain("Source Dec 2017");
    expect(visible).toContain("Preliminary");
    expect(visible).not.toContain("latest-source-notice");
  });

  it("converts every level and absolute delta without changing source-period semantics", () => {
    const html = renderToStaticMarkup(
      <LatestValueGrid asset={asset} series={series} displayUnit="million_barrels" />,
    );

    expect(html).toContain("3.487 MMbbl");
    expect(html).toContain("-0.151 MMbbl");
    expect(html).toContain("+0.019 MMbbl");
    expect(html).toContain("Source period Apr 2026 is suppressed or withheld.");
  });

  it("keeps changes in a percentage asset labelled as percentage points", () => {
    const percentAsset = {
      ...asset,
      unit: "percent",
      latest: {
        ...asset.latest,
        value: 92.5,
        absolute_change: -1.2,
        yoy_absolute_change: 2.4,
        distance_from_seasonal_median: 0.5,
      },
    };
    const html = renderToStaticMarkup(
      <LatestValueGrid asset={percentAsset} series={{ ...series, unit: "percent" }} displayUnit="percent" />,
    );

    expect(html).toContain("92.5 %");
    expect(html).toContain("-1.2 percentage points");
    expect(html).toContain("+2.4 percentage points");
  });
});

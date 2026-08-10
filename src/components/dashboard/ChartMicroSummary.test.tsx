import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { UsaChartAsset, UsaManifestSeries } from "../../types/energyAssets";
import { ChartMicroSummary } from "./ChartMicroSummary";

const series = {
  title: "Commercial crude stocks",
  freshness: {
    status: "fresh",
    latest_period: "2026-05",
    latest_numeric_period: "2026-05",
    latest_observation_status: "observed",
  },
} as UsaManifestSeries;

const asset = {
  unit: "thousand_barrels",
  latest: {
    period: "2026-05",
    value: 2_500,
    previous_period: "2026-04",
    absolute_change: 100,
    percent_change: 4.167,
  },
  latest_source: {
    period: "2026-05",
    value: 2_500,
    status: "observed",
  },
  freshness: series.freshness,
} as UsaChartAsset;

describe("ChartMicroSummary", () => {
  it("renders a compact accessible numeric value and period-over-period change", () => {
    const html = renderToStaticMarkup(<ChartMicroSummary asset={asset} series={series} />);

    expect(html).toContain('aria-label="Latest numeric summary for Commercial crude stocks"');
    expect(html).toContain("Latest numeric");
    expect(html).toContain("2,500 kbbl");
    expect(html).toContain("May 2026");
    expect(html).toContain("Period change");
    expect(html).toContain("+100 kbbl");
    expect(html).toContain("+4.2%");
    expect(html).not.toContain("Latest source");
  });

  it("uses the requested display unit for both the level and absolute change", () => {
    const html = renderToStaticMarkup(
      <ChartMicroSummary asset={asset} series={series} displayUnit="million_barrels" />,
    );

    expect(html).toContain("2.5 MMbbl");
    expect(html).toContain("+0.1 MMbbl");
  });

  it("separates a nonnumeric Canadian source period from its older numeric value", () => {
    const canadaAsset = {
      ...asset,
      unit: "cubic_metres",
      latest: {
        ...asset.latest,
        period: "2017-12",
        value: 554_461,
        previous_period: "2017-11",
        absolute_change: -24_050,
        percent_change: -4.157,
      },
      latest_source: {
        period: "2026-05",
        value: null,
        status: "suppressed_or_withheld",
      },
      freshness: {
        status: "unknown",
        latest_period: "2026-05",
        latest_numeric_period: "2017-12",
        latest_observation_status: "suppressed_or_withheld",
      },
    } as UsaChartAsset;
    const canadaSeries = {
      ...series,
      title: "Crude oil closing inventory",
      freshness: canadaAsset.freshness,
    } as UsaManifestSeries;
    const html = renderToStaticMarkup(
      <ChartMicroSummary asset={canadaAsset} series={canadaSeries} />,
    );

    expect(html).toContain("Latest numeric");
    expect(html).toContain("Dec 2017");
    expect(html).toContain("Latest source");
    expect(html).toContain("May 2026");
    expect(html).toContain("suppressed or withheld");
    expect(html).toContain('role="status"');
  });

  it("labels changes in percent assets as percentage points", () => {
    const percentAsset = {
      ...asset,
      unit: "percent",
      latest: {
        ...asset.latest,
        value: 91.2,
        absolute_change: -1.3,
        percent_change: -1.405,
      },
      latest_source: { period: "2026-05", value: 91.2, status: "preliminary" },
    } as UsaChartAsset;
    const html = renderToStaticMarkup(
      <ChartMicroSummary asset={percentAsset} series={{ ...series, unit: "percent" } as UsaManifestSeries} />,
    );

    expect(html).toContain("91.2 %");
    expect(html).toContain("-1.3 percentage points");
    expect(html).toContain("-1.4%");
  });
});

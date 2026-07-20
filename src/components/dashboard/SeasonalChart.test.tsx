import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ForecastAsset, UsaChartAsset, UsaManifestSeries } from "../../types/energyAssets";
import {
  buildChangeEChartsOption,
  buildSeasonalEChartsOption,
  SeasonalChart,
} from "./SeasonalChart";

const asset = {
  schema_version: "1.0.0",
  series_id: "test-series",
  geography_id: "us",
  frequency: "monthly",
  unit: "thousand_barrels",
  generated_at: "2026-01-02T18:00:00Z",
  source_checksum: "a".repeat(64),
  recent_years: [
    { year: 2024, points: [] },
    { year: 2025, points: [{ period: "2025-12", slot: 12, value: 100, status: "observed" }] },
    { year: 2026, points: [] },
  ],
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
    period: "2025-12",
    value: 100,
    previous_period: null,
    absolute_change: null,
    percent_change: null,
    year_ago_period: null,
    yoy_absolute_change: null,
    yoy_percent_change: null,
    seasonal_median: null,
    distance_from_seasonal_median: null,
    seasonal_percentile: null,
  },
  methodology_version: "observed-method",
  aggregation_lineage: null,
  distribution: {},
} as unknown as UsaChartAsset;

const forecast = {
  schema_version: "1.0.0",
  target_view_id: "test-view",
  target_series_id: "test-series",
  geography_id: "us",
  dimensions: {},
  frequency: "monthly",
  unit: "thousand_barrels",
  generated_at: "2026-01-02T18:00:00Z",
  training_source_checksum: "a".repeat(64),
  status: "ok",
  methodology_version: "forecast-method",
  forecast_kind: "univariate_statistical_projection",
  model: {
    model_id: "seasonal_naive",
    label: "Seasonal naive",
    selection_method: "rolling_origin_minimum_mae",
    selection_window: { start: "2023-01", end: "2023-12" },
    candidates: [],
  },
  origin: {
    period: "2025-12",
    value: 100,
    generated_at: "2026-01-02T18:00:00Z",
    information_cutoff: "2026-01-02T17:30:00Z",
    regime_start: "2019-01",
    training_start: "2018-01",
    training_end: "2025-12",
    training_observations: 96,
    data_vintage_id: "a".repeat(64),
    vintage_policy: "latest_stored_provider_values_at_generation_time",
  },
  horizon: { periods: 3, unit: "monthly" },
  points: [
    {
      target_period: "2026-01",
      horizon: 1,
      year: 2026,
      slot: 1,
      value: 102,
      intervals: {
        "80": { lower: 99, upper: 105 },
        "90": { lower: 98, upper: 106 },
        "95": { lower: 97, upper: 107 },
      },
      calibration_errors: 48,
    },
    {
      target_period: "2026-02",
      horizon: 2,
      year: 2026,
      slot: 2,
      value: 103,
      intervals: {
        "80": { lower: 100, upper: 106 },
        "90": { lower: 99, upper: 107 },
        "95": { lower: 98, upper: 108 },
      },
      calibration_errors: 48,
    },
    {
      target_period: "2026-03",
      horizon: 3,
      year: 2026,
      slot: 3,
      value: 104,
      intervals: {
        "80": { lower: 100, upper: 108 },
        "90": { lower: 99, upper: 109 },
        "95": { lower: 98, upper: 110 },
      },
      calibration_errors: 48,
    },
  ],
  prediction_intervals: {
    method: "empirical_rolling_origin_residual_quantiles",
    levels: [80, 90, 95],
    calibration_window: { start: "2024-01", end: "2024-12" },
    calibration_errors: 144,
    minimum_errors_per_horizon: 48,
    coverage_guarantee: false,
  },
  backtest: {
    status: "independent_holdout",
    evaluation_mode: "latest_revised_pseudo_out_of_sample",
    evaluation_window: { start: "2025-01", end: "2025-12" },
    forecast_errors: 24,
    mae: 2,
    rmse: 2.8,
    bias: 0.1,
    directional_accuracy: 0.6,
    interval_coverage: { "80": 0.79, "90": 0.88, "95": 0.96 },
    seasonal_naive_mae: 2.4,
    skill_vs_seasonal_naive: 0.1667,
    by_horizon: [],
  },
  limitations: ["Latest-revised history."],
} as ForecastAsset;

const series = {
  view_id: "test-view",
  series_id: "test-series",
  title: "Test stocks",
  category: "Inventories",
  unit: "thousand_barrels",
  frequency: "monthly",
  source: { name: "Official test source" },
  freshness: { status: "unknown" },
  geographies: [{
    geography_id: "us",
    label: "United States",
    level_id: "national",
    level_label: "Country",
    origin: "source-published",
    status: "available",
    asset_path: "assets/test.json",
    forecast_path: "forecasts/test.json",
  }],
  unsupported_levels: [],
} as UsaManifestSeries;

function optionSeries(option: ReturnType<typeof buildSeasonalEChartsOption>) {
  expect(Array.isArray(option.series)).toBe(true);
  return option.series as Array<Record<string, unknown>>;
}

describe("seasonal forecast chart", () => {
  it("renders only the selected empirical interval and a dashed forecast line", () => {
    const option = buildSeasonalEChartsOption(asset, series.title, forecast, 90);
    const renderedSeries = optionSeries(option);
    const names = renderedSeries.map((item) => item.name);
    expect(names).toContain("90% prediction interval");
    expect(names).not.toContain("80% prediction interval");
    expect(names).not.toContain("95% prediction interval");

    const band = renderedSeries.find((item) => item.name === "90% prediction interval");
    expect(band?.data).toEqual([8, 8, 10, null]);
    const line = renderedSeries.find((item) => item.name === "Forecast 2026");
    expect(line?.data).toEqual([102, 103, 104, null]);
    expect(line?.lineStyle).toMatchObject({ type: "dashed" });
    expect(JSON.stringify(option.aria)).toContain("90 percent empirical prediction interval");
  });

  it("exposes native interval radios, diagnostics, and a semantic forecast table", () => {
    const html = renderToStaticMarkup(
      <SeasonalChart
        asset={asset}
        series={series}
        geographyId="us"
        onGeographyChange={() => undefined}
        forecast={forecast}
      />,
    );
    expect(html).toContain("<fieldset");
    expect(html).toContain("Prediction interval");
    expect(html).toMatch(/checked="" value="90"/);
    expect(html).toContain("Latest-revised pseudo-out-of-sample evaluation");
    expect(html).toContain("Regime start");
    expect(html).toContain("Jan 2019");
    expect(html).toContain("3 monthly periods");
    expect(html).toContain("<table>");
    expect(html).toContain("Lower 90%");
    expect(html).toContain("Jan 2026");
  });

  it("keeps the observed chart visible when no forecast is available", () => {
    const html = renderToStaticMarkup(
      <SeasonalChart
        asset={asset}
        series={series}
        geographyId="us"
        onGeographyChange={() => undefined}
        forecastNotice="Forecast unavailable; observed data remain available."
      />,
    );
    expect(html).toContain("echarts-seasonal");
    expect(html).toContain("Forecast unavailable; observed data remain available.");
    expect(html).not.toContain("Prediction interval</legend>");
  });

  it("converts axes, tooltip values, diagnostics, and forecast bounds for display", () => {
    const option = buildSeasonalEChartsOption(
      asset,
      series.title,
      forecast,
      90,
      "million_barrels",
    );
    const yAxis = option.yAxis as {
      name?: string;
      axisLabel?: { formatter?: (value: number) => string };
    };
    expect(yAxis.name).toBe("MMbbl");
    expect(yAxis.axisLabel?.formatter?.(0.1)).toBe("0.1");
    const convertedLine = optionSeries(option).find((item) => item.name === "Forecast 2026");
    const convertedValues = convertedLine?.data as Array<number | null>;
    expect(convertedValues.slice(0, 3)).toEqual([
      expect.closeTo(0.102, 8),
      expect.closeTo(0.103, 8),
      expect.closeTo(0.104, 8),
    ]);
    expect(convertedValues.at(-1)).toBeNull();
    const tooltip = option.tooltip as { formatter?: (params: unknown) => string };
    expect(tooltip.formatter?.([{ dataIndex: 0 }])).toContain("0.102 MMbbl");

    const html = renderToStaticMarkup(
      <SeasonalChart
        asset={asset}
        series={series}
        geographyId="us"
        onGeographyChange={() => undefined}
        forecast={forecast}
        displayUnit="million_barrels"
        onDisplayUnitChange={() => undefined}
      />,
    );
    expect(html).toContain("Display unit");
    expect(html).toContain("Million barrels");
    expect(html).toContain("0.102 MMbbl");
    expect(html).toContain("0.098 MMbbl");
    expect(html).toContain("0.002 MMbbl");
  });

  it("plots period-normalized forecast points while keeping diagnostics in source units", () => {
    const rateAsset = {
      ...asset,
      unit: "thousand_barrels_per_day",
      methodology_version: "observed-method+monthly-average-rate-2026-07-20.1",
    } as UsaChartAsset;
    const sourceForecast = {
      ...forecast,
      unit: "cubic_metres",
    } as ForecastAsset;
    const displayPoints = forecast.points.map((point, index) => ({
      ...point,
      value: index + 1,
      intervals: {
        "80": { lower: index + 0.8, upper: index + 1.2 },
        "90": { lower: index + 0.7, upper: index + 1.3 },
        "95": { lower: index + 0.6, upper: index + 1.4 },
      },
    }));

    const html = renderToStaticMarkup(
      <SeasonalChart
        asset={rateAsset}
        series={series}
        geographyId="ca"
        onGeographyChange={() => undefined}
        forecast={sourceForecast}
        forecastDisplayPoints={displayPoints}
        displayUnit="thousand_barrels_per_day"
      />,
    );

    expect(html).toContain("1 kb/d");
    expect(html).toContain("0.7 kb/d");
    expect(html).toContain("2 m³");
    expect(html).toContain("backtest error metrics remain in the source monthly Cubic metres domain");
    expect(html).toContain("Monthly-average kb/d divides each source monthly flow");
  });

  it("labels percent changes as percentage points while keeping levels as percent", () => {
    const percentAsset = { ...asset, unit: "percent" } as UsaChartAsset;
    const option = buildChangeEChartsOption(percentAsset, "Utilization", {
      frequency: "monthly",
      points: [{
        period: "2026-02",
        previousPeriod: "2026-01",
        value: 91.3,
        previousValue: 92.5,
        change: -1.2,
        percentChange: -1.297,
      }],
      latest: null,
      skippedGaps: 0,
    }, "percent");
    const yAxis = option.yAxis as { name?: string };
    const tooltip = option.tooltip as { formatter?: (params: unknown) => string };
    const rendered = tooltip.formatter?.([{ dataIndex: 0 }]) ?? "";

    expect(yAxis.name).toBe("percentage points");
    expect(rendered).toContain("1.2 percentage points");
    expect(rendered).toContain("91.3 %");
  });
});

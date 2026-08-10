import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ForecastAsset, UsaChartAsset, UsaManifestSeries } from "../../types/energyAssets";
import {
  buildChangeEChartsOption,
  buildSeasonalEChartsOption,
  changeChartLabels,
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
  classification: {
    dashboard_group: "test",
    product_family_id: "crude-oil",
    product_family_label: "Crude oil",
    product_id: "crude-oil",
    product_label: "Crude oil",
    measure_id: "stocks",
    measure_label: "Stocks",
    component_role: "headline",
    parent_product_id: null,
    reference_term_ids: [],
    display_order: 1,
  },
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
  it("renders graph-first chrome with one collapsed details disclosure", () => {
    const html = renderToStaticMarkup(
      <SeasonalChart
        asset={asset}
        series={series}
        geographyId="us"
        onGeographyChange={() => undefined}
      />,
    );

    expect(html).toContain('class="analysis-panel seasonal-panel graph-first-panel"');
    expect(html).toContain('<h2 id="seasonal-title">Test stocks</h2>');
    expect(html).toContain("United States · Seasonal overlay");
    expect(html).toContain('display-unit-control-micro');
    expect(html).toContain('class="chart-stage"');
    expect(html).toContain('class="chart-micro-summary"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain('hidden=""');
    expect(html.match(/>Show details</g)).toHaveLength(1);
    expect(html).toMatch(/chart-details-toggle-content[^>]*hidden=""[\s\S]*chart-geography/);
  });

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

  it("discloses bottom-up methodology, residual recalibration, holdout status, and limitations for combined forecasts", () => {
    const combinedForecast = {
      ...forecast,
      geography_id: "computed:test-policy:ca-ab+ca-sk",
      status: "limited_history",
      forecast_kind: "bottom_up_custom_geography_projection",
      model: undefined,
      origin: {
        ...forecast.origin,
        period: "2026-04",
        information_cutoff: "2026-04",
      },
      prediction_intervals: {
        ...forecast.prediction_intervals!,
        method: "aligned_component_residual_sum_empirical_quantiles",
        calibration_errors: 40,
        minimum_errors_per_horizon: 40,
      },
      backtest: {
        ...forecast.backtest!,
        status: "not_available",
        evaluation_window: null,
        forecast_errors: 0,
        mae: null,
        rmse: null,
        bias: null,
        directional_accuracy: null,
        interval_coverage: { "80": null, "90": null, "95": null },
        seasonal_naive_mae: null,
        skill_vs_seasonal_naive: null,
      },
      limitations: [
        "Bottom-up point forecasts add the selected regional projections.",
        "This custom combination has no independent aggregate holdout evaluation.",
      ],
    } as ForecastAsset;

    const html = renderToStaticMarkup(
      <SeasonalChart
        asset={asset}
        series={series}
        geographyId={combinedForecast.geography_id}
        onGeographyChange={() => undefined}
        forecast={combinedForecast}
      />,
    );

    expect(html).toContain("Combined regional forecast methodology and limitations");
    expect(html).toContain("Bottom-up component projection");
    expect(html).toContain("Forecast origin period Apr 2026");
    expect(html).toContain("source data through period Apr 2026");
    expect(html).not.toContain("Mar 31, 2026");
    expect(html).toContain("Sum of component forecasts");
    expect(html).toContain("Aligned residual recalibration");
    expect(html).toContain("recalibrated from exact cross-region residual sums aligned by forecast horizon and target period");
    expect(html).toContain("Component interval bounds are never summed");
    expect(html).toContain("No independent aggregate holdout/backtest is available");
    expect(html).toContain("Bottom-up point forecasts add the selected regional projections.");
    expect(html).toContain("This custom combination has no independent aggregate holdout evaluation.");
    expect(html).not.toContain("Directional accuracy");
    expect(html).not.toContain("Vs. seasonal naive");
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
    expect(html.indexOf("Forecast unavailable; observed data remain available.")).toBeLessThan(
      html.indexOf('class="chart-details-toggle-content"'),
    );
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
    expect(html).toContain("Unit");
    expect(html).toContain("MMbbl");
    expect(html).toContain('display-unit-control-micro');
    expect(html).toContain("0.102 MMbbl");
    expect(html).toContain("0.098 MMbbl");
    expect(html).toContain("0.002 MMbbl");
  });

  it("keeps seasonal bands and recent-year overlays in the compact profile layout", () => {
    const profileAsset = {
      ...asset,
      recent_years: [
        { year: 2024, points: [{ period: "2024-01", slot: 1, value: 90, status: "observed" }] },
        { year: 2025, points: [{ period: "2025-01", slot: 1, value: null, status: "suppressed_or_withheld" }] },
        { year: 2026, points: [{ period: "2026-01", slot: 1, value: 100, status: "observed" }] },
      ],
      baseline: {
        status: "ok",
        baseline_start_year: 2014,
        baseline_end_year: 2023,
        eligible_years: [2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022, 2023],
        eligible_year_count: 10,
        excluded_years: [],
        slots: [{
          slot: 1,
          min: 80,
          q1: 85,
          median: 90,
          mean: 91,
          q3: 95,
          max: 110,
          count: 10,
        }],
      },
    } as UsaChartAsset;
    const compactOption = buildSeasonalEChartsOption(
      profileAsset,
      series.title,
      undefined,
      90,
      "million_barrels",
      { density: "compact" },
    );
    const names = optionSeries(compactOption).map((item) => item.name);
    expect(names).toEqual(expect.arrayContaining([
      "Historical range",
      "Middle 50%",
      "Median",
      "Mean",
      "2024",
      "2025",
      "2026",
    ]));
    expect(names).not.toContain("Observed");
    const range = optionSeries(compactOption).find((item) => item.name === "Historical range");
    expect(range?.data).toEqual([expect.closeTo(0.03, 8)]);
    const latestYear = optionSeries(compactOption).find((item) => item.name === "2026");
    expect(latestYear?.data).toEqual([expect.closeTo(0.1, 8)]);
    expect(compactOption.grid).toMatchObject({ bottom: 34, top: 38 });
    expect(compactOption.dataZoom).toHaveLength(1);
    expect((compactOption.dataZoom as Array<{ type?: string }>)[0]?.type).toBe("inside");

    const standardOption = buildSeasonalEChartsOption(profileAsset, series.title);
    expect(standardOption.grid).toMatchObject({ bottom: 78, top: 44 });
    expect(standardOption.dataZoom).toHaveLength(2);

    const tooltip = compactOption.tooltip as { formatter?: (params: unknown) => string };
    expect(tooltip.formatter?.([{ dataIndex: 0 }])).toContain("suppressed or withheld");

    const noBaseline = buildSeasonalEChartsOption(
      asset,
      `${series.title} — United States`,
      undefined,
      90,
      undefined,
      { density: "compact" },
    );
    expect(JSON.stringify(noBaseline.aria)).toContain("Test stocks — United States");
    expect(JSON.stringify(noBaseline.aria)).toContain("Historical seasonal bands are unavailable");
    expect(JSON.stringify(noBaseline.aria)).not.toContain("historical minimum");
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
    expect(html).toContain("Monthly-average daily rates divide each source monthly flow");
  });

  it("labels percent changes as percentage points while keeping levels as percent", () => {
    const percentAsset = { ...asset, unit: "percent" } as UsaChartAsset;
    const percentSeries = {
      ...series,
      title: "Utilization",
      unit: "percent",
      classification: {
        ...series.classification!,
        measure_id: "percent-of-capacity",
        measure_label: "Percent of capacity",
      },
    } as UsaManifestSeries;
    const option = buildChangeEChartsOption(percentAsset, percentSeries, {
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
    const yAxes = option.yAxis as Array<{ name?: string }>;
    const tooltip = option.tooltip as { formatter?: (params: unknown) => string };
    const rendered = tooltip.formatter?.([{ dataIndex: 0 }]) ?? "";
    const renderedSeries = option.series as Array<Record<string, unknown>>;

    expect(yAxes[0]?.name).toBe("percentage points");
    expect(yAxes[1]?.name).toBe("%");
    expect(renderedSeries.map((item) => item.name)).toEqual([
      "Period change",
      "Observed level",
    ]);
    expect(renderedSeries[1]?.data).toEqual([91.3]);
    expect(renderedSeries[0]?.markLine).toMatchObject({
      label: { formatter: "Average -1.2 pp" },
      data: [{ yAxis: -1.2, name: "Average change" }],
    });
    expect(rendered).toContain("1.2 percentage points");
    expect(rendered).toContain("91.3 %");
    expect(rendered).toContain("92.5 %");
    expect(rendered).toContain("Previous level");
  });

  it("keeps USA monthly PADD movements as generic flows despite their thousand-barrel unit", () => {
    const movementAsset = {
      ...asset,
      series_id: "usa.eia.crude.padd_movements.monthly",
      geography_id: "padd-1-to-padd-2",
      unit: "thousand_barrels",
    } as UsaChartAsset;
    const movementSeries = {
      ...series,
      view_id: "usa.eia.crude.padd_movements.monthly",
      series_id: movementAsset.series_id,
      title: "Crude oil movement from PADD 1 to PADD 2",
      classification: {
        ...series.classification!,
        measure_id: "inter-padd-movement",
        measure_label: "Inter-PADD movement",
      },
    } as UsaManifestSeries;
    const labels = changeChartLabels(movementAsset, movementSeries);
    const option = buildChangeEChartsOption(movementAsset, movementSeries, {
      frequency: "monthly",
      points: [{
        period: "2026-02",
        previousPeriod: "2026-01",
        value: 120,
        previousValue: 100,
        change: 20,
        percentChange: 20,
      }],
      latest: null,
      skippedGaps: 0,
    });
    const renderedSeries = option.series as Array<Record<string, unknown>>;
    const html = renderToStaticMarkup(
      <SeasonalChart
        asset={movementAsset}
        series={movementSeries}
        geographyId={movementAsset.geography_id}
        onGeographyChange={() => undefined}
      />,
    );

    expect(labels.positive).toBe("Increase");
    expect(labels.negative).toBe("Decrease");
    expect(labels.title).toBe("Month-over-month change");
    expect(renderedSeries[0]?.name).toBe("Period change");
    expect(html).toContain("Period changes");
    expect(html).not.toContain("Builds &amp; draws");
  });

  it("labels Canadian cubic-metre ending stocks as inventory builds and draws", () => {
    const endingStockAsset = {
      ...asset,
      series_id: "can.statcan.crude.closing_inventory.monthly",
      geography_id: "ca-ab",
      unit: "cubic_metres",
    } as UsaChartAsset;
    const endingStockSeries = {
      ...series,
      view_id: "can.statcan.crude.closing_inventory.monthly",
      series_id: endingStockAsset.series_id,
      title: "Crude oil closing inventory",
      unit: "cubic_metres",
      classification: {
        ...series.classification!,
        measure_id: "ending-stocks",
        measure_label: "Closing inventory",
      },
    } as UsaManifestSeries;
    const labels = changeChartLabels(endingStockAsset, endingStockSeries);
    const option = buildChangeEChartsOption(endingStockAsset, endingStockSeries, {
      frequency: "monthly",
      points: [{
        period: "2026-02",
        previousPeriod: "2026-01",
        value: 120,
        previousValue: 100,
        change: 20,
        percentChange: 20,
      }],
      latest: null,
      skippedGaps: 0,
    });
    const renderedSeries = option.series as Array<Record<string, unknown>>;
    const html = renderToStaticMarkup(
      <SeasonalChart
        asset={endingStockAsset}
        series={endingStockSeries}
        geographyId={endingStockAsset.geography_id}
        onGeographyChange={() => undefined}
      />,
    );

    expect(labels.positive).toBe("Build");
    expect(labels.negative).toBe("Draw");
    expect(labels.title).toContain("stock change");
    expect(renderedSeries[0]?.name).toBe("Build / draw");
    expect(html).toContain("Builds &amp; draws");
    expect(html).not.toContain("Period changes");
  });
});

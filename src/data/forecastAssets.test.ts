import { describe, expect, it } from "vitest";
import type { UsaChartAsset, UsaManifestSeries } from "../types/energyAssets";
import {
  forecastAssetUrl,
  forecastIsRenderable,
  forecastMismatchReason,
  parseForecastAsset,
} from "./forecastAssets";

const checksum = "a".repeat(64);

const evaluation = {
  forecast_errors: 24,
  mae: 2.5,
  rmse: 3.2,
  bias: -0.4,
  directional_accuracy: 0.625,
  interval_coverage: { "80": 0.79, "90": 0.875, "95": 0.96 },
};

export const forecastFixture = {
  schema_version: "1.0.0",
  target_view_id: "usa.eia.refinery.utilization.weekly",
  target_series_id: "usa.eia.refinery.utilization.weekly",
  geography_id: "us.padd.3",
  dimensions: { process: "refinery_utilization" },
  frequency: "monthly",
  unit: "percent",
  generated_at: "2026-01-02T18:00:00Z",
  training_source_checksum: checksum,
  status: "ok",
  methodology_version: "2026-07-20.1",
  forecast_kind: "univariate_statistical_projection",
  model: {
    model_id: "seasonal_naive",
    label: "Seasonal naive",
    selection_method: "rolling_origin_minimum_mae",
    selection_window: { start: "2023-01", end: "2023-12" },
    candidates: [
      { model_id: "seasonal_naive", label: "Seasonal naive", mae: 2.2, forecast_errors: 12 },
    ],
  },
  origin: {
    period: "2025-12",
    value: 91,
    generated_at: "2026-01-02T18:00:00Z",
    information_cutoff: "2026-01-02T17:30:00Z",
    regime_start: "2019-01",
    training_start: "2018-01",
    training_end: "2025-12",
    training_observations: 96,
    data_vintage_id: checksum,
    vintage_policy: "latest_stored_provider_values_at_generation_time",
  },
  horizon: { periods: 3, unit: "monthly" },
  points: [
    {
      target_period: "2026-01",
      horizon: 1,
      year: 2026,
      slot: 1,
      value: 90,
      intervals: {
        "80": { lower: 88, upper: 92 },
        "90": { lower: 87, upper: 93 },
        "95": { lower: 86, upper: 94 },
      },
      calibration_errors: 48,
    },
    {
      target_period: "2026-02",
      horizon: 2,
      year: 2026,
      slot: 2,
      value: 91,
      intervals: {
        "80": { lower: 88.5, upper: 93.5 },
        "90": { lower: 87.5, upper: 94.5 },
        "95": { lower: 86.5, upper: 95.5 },
      },
      calibration_errors: 48,
    },
    {
      target_period: "2026-03",
      horizon: 3,
      year: 2026,
      slot: 3,
      value: 92,
      intervals: {
        "80": { lower: 89, upper: 95 },
        "90": { lower: 88, upper: 96 },
        "95": { lower: 87, upper: 97 },
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
    ...evaluation,
    seasonal_naive_mae: 3,
    skill_vs_seasonal_naive: 0.1667,
    by_horizon: [
      { horizon: 1, ...evaluation },
      { horizon: 2, ...evaluation },
      { horizon: 3, ...evaluation },
    ],
  },
  limitations: [
    "Uses latest stored provider values, not reconstructed first-release vintages.",
  ],
};

function observedFixture(): UsaChartAsset {
  return {
    schema_version: "1.0.0",
    series_id: forecastFixture.target_series_id,
    geography_id: forecastFixture.geography_id,
    dimensions: {},
    frequency: forecastFixture.frequency,
    unit: forecastFixture.unit,
    generated_at: "2026-01-02T18:00:00Z",
    source_checksum: checksum,
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
      period: "2025-12",
      value: 91,
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
    distribution: {
      levels: {} as UsaChartAsset["distribution"]["levels"],
      changes: {} as UsaChartAsset["distribution"]["changes"],
    },
    methodology_version: "2026-07-19.2",
    aggregation_lineage: null,
  };
}

const seriesFixture = {
  view_id: forecastFixture.target_view_id,
  series_id: forecastFixture.target_series_id,
} as UsaManifestSeries;

describe("forecast public asset contract", () => {
  it("parses nested empirical intervals and current backtest metadata", () => {
    const parsed = parseForecastAsset(forecastFixture);
    expect(parsed.points).toHaveLength(3);
    expect(parsed.points[0]?.intervals["95"]).toEqual({ lower: 86, upper: 94 });
    expect(parsed.backtest?.evaluation_mode).toBe("latest_revised_pseudo_out_of_sample");
    expect(parsed.origin.regime_start).toBe("2019-01");
    expect(forecastIsRenderable(parsed)).toBe(true);
  });

  it("accepts the nonnumeric-latest-source unavailable status without points", () => {
    const parsed = parseForecastAsset({
      schema_version: "1.0.0",
      target_view_id: "can.statcan.crude.inventory.monthly",
      target_series_id: "can.statcan.crude.inventory.monthly",
      geography_id: "ca.bc",
      dimensions: {},
      frequency: "monthly",
      unit: "cubic_metres",
      generated_at: "2026-07-20T01:00:00Z",
      training_source_checksum: checksum,
      status: "latest_source_non_numeric",
      methodology_version: "2026-07-20.1",
      forecast_kind: "univariate_statistical_projection",
      reason: "Latest source period is nonnumeric.",
      origin: {
        training_start: "2016-01",
        training_end: "2025-12",
        training_observations: 120,
      },
      points: [],
      limitations: ["Observed values are never imputed or replaced by a forecast."],
    });
    expect(parsed.status).toBe("latest_source_non_numeric");
    expect(forecastIsRenderable(parsed)).toBe(false);
  });

  it("rejects non-nested or incomplete prediction intervals", () => {
    const broken = structuredClone(forecastFixture);
    broken.points[0]!.intervals["95"].lower = 89;
    expect(() => parseForecastAsset(broken)).toThrow(/nested/);

    const incomplete = structuredClone(forecastFixture) as unknown as Record<string, unknown>;
    const points = incomplete.points as Array<Record<string, unknown>>;
    delete (points[0]!.intervals as Record<string, unknown>)["80"];
    expect(() => parseForecastAsset(incomplete)).toThrow(/exactly the 80, 90, and 95/);
  });

  it("rejects a regime start after the forecast origin", () => {
    const broken = structuredClone(forecastFixture);
    broken.origin.regime_start = "2026-01";
    expect(() => parseForecastAsset(broken)).toThrow(/regime_start/);
  });

  it("requires exactly three consecutive source periods and robust calibration", () => {
    const short = structuredClone(forecastFixture);
    short.horizon.periods = 2;
    short.points.pop();
    expect(() => parseForecastAsset(short)).toThrow(/exactly 3 source periods/);

    const gap = structuredClone(forecastFixture);
    gap.points[1]!.target_period = "2026-04";
    gap.points[1]!.slot = 4;
    expect(() => parseForecastAsset(gap)).toThrow(/consecutive source periods/);

    const delayed = structuredClone(forecastFixture);
    delayed.points.forEach((point, index) => {
      point.target_period = `2026-0${index + 2}`;
      point.slot = index + 2;
    });
    expect(() => parseForecastAsset(delayed)).toThrow(/next source period/);

    const weakCalibration = structuredClone(forecastFixture);
    weakCalibration.prediction_intervals.minimum_errors_per_horizon = 39;
    expect(() => parseForecastAsset(weakCalibration)).toThrow(/greater than or equal to 40/);
  });

  it("checks every identity field against the selected observed asset", () => {
    const parsed = parseForecastAsset(forecastFixture);
    const observed = observedFixture();
    expect(forecastMismatchReason(parsed, observed, seriesFixture, observed.geography_id)).toBeNull();
    const mismatches = [
      [{ ...parsed, target_view_id: "another-view" }, /view/],
      [{ ...parsed, target_series_id: "another-series" }, /series/],
      [{ ...parsed, geography_id: "us.padd.2" }, /geography/],
      [{ ...parsed, frequency: "weekly" }, /frequency/],
      [{ ...parsed, unit: "thousand_barrels" }, /unit/],
      [{ ...parsed, training_source_checksum: "b".repeat(64) }, /training data/],
      [{ ...parsed, origin: { ...parsed.origin, period: "2025-11" } }, /origin/],
    ] as const;
    for (const [candidate, expected] of mismatches) {
      expect(forecastMismatchReason(
        candidate,
        observed,
        seriesFixture,
        observed.geography_id,
      )).toMatch(expected);
    }
  });

  it("builds country-relative local paths and rejects remote forecast injection", () => {
    expect(forecastAssetUrl("usa", "forecasts/series/us/data.json")).toBe(
      "/data/usa/forecasts/series/us/data.json",
    );
    expect(() => forecastAssetUrl("canada", "https://example.com/forecast.json")).toThrow(
      /local public files/,
    );
  });

  it("accepts a fundamentals-augmented forecast with a complete disclosure block", () => {
    const fundamentals = {
      status: "candidate_included",
      identity: "stocks[t] = stocks[t-1] + 7 x (production + imports - exports - product supplied) + unaccounted",
      flow_to_level_factor: 7,
      drivers: [
        { role: "production", series_id: "usa.example.production", geography_id: "us" },
        { role: "imports", series_id: "usa.example.imports", geography_id: "us" },
        { role: "exports", series_id: "usa.example.exports", geography_id: "us" },
        { role: "product_supplied", series_id: "usa.example.product_supplied", geography_id: "us" },
      ],
      notes: "National weekly balance.",
      selected: true,
    };
    const parsed = parseForecastAsset({
      ...forecastFixture,
      forecast_kind: "fundamentals_augmented_statistical_projection",
      fundamentals,
    });
    expect(parsed.forecast_kind).toBe("fundamentals_augmented_statistical_projection");
    expect(parsed.fundamentals?.status).toBe("candidate_included");
    expect(parsed.fundamentals?.selected).toBe(true);
    expect(parsed.fundamentals?.drivers).toHaveLength(4);
  });

  it("rejects unknown forecast kinds and augmented records without disclosure", () => {
    expect(() => parseForecastAsset({
      ...forecastFixture,
      forecast_kind: "machine_learning_projection",
    })).toThrow(/Unsupported forecast kind/);
    expect(() => parseForecastAsset({
      ...forecastFixture,
      forecast_kind: "fundamentals_augmented_statistical_projection",
    })).toThrow(/disclose its included driver set/);
    expect(() => parseForecastAsset({
      ...forecastFixture,
      fundamentals: {
        status: "drivers_incomplete",
        identity: "identity",
        flow_to_level_factor: 7,
        drivers: [{ role: "exports", series_id: "x", geography_id: "us" }],
        notes: "n",
      },
    })).toThrow(/exclusion_reason/);
  });
});

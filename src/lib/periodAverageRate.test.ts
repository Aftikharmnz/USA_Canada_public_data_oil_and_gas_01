import { describe, expect, it } from "vitest";
import { BARREL_TO_CUBIC_METRES } from "./units";
import {
  buildMonthlyAverageRateAsset,
  daysInMonthlyPeriod,
  monthlyAverageRateForecastPoints,
  monthlyAverageRateOption,
  monthlyVolumeToKbPerDay,
  supportsMonthlyAverageRate,
} from "./periodAverageRate";
import type { ForecastAsset, UsaChartAsset, UsaManifestSeries } from "../types/energyAssets";

function series(seriesId: string, measureId: string): UsaManifestSeries {
  return {
    view_id: seriesId,
    series_id: seriesId,
    title: "Canadian petroleum flow",
    category: "Supply and disposition",
    unit: "cubic_metres",
    frequency: "monthly",
    source: { name: "Statistics Canada" },
    freshness: { status: "unknown" },
    classification: {
      dashboard_group: "canada_crude",
      product_family_id: "crude-oil",
      product_family_label: "Crude oil",
      product_id: "crude-oil",
      product_label: "Crude oil",
      measure_id: measureId,
      measure_label: measureId,
      component_role: "headline",
      parent_product_id: null,
      reference_term_ids: [],
      display_order: 1,
    },
    geographies: [],
    unsupported_levels: [],
  };
}

function sourceAsset(): UsaChartAsset {
  const oneKbDay = 1_000 * BARREL_TO_CUBIC_METRES;
  return {
    schema_version: "1.0.0",
    series_id: "can.statcan.crude.production.monthly",
    geography_id: "ca.ab",
    dimensions: {},
    frequency: "monthly",
    unit: "cubic_metres",
    generated_at: "2026-07-20T00:00:00Z",
    source_checksum: "a".repeat(64),
    freshness: {
      status: "unknown",
      latest_period: "2024-05",
      latest_numeric_period: "2024-04",
      latest_observation_status: "suppressed_or_withheld",
    },
    history: [
      { period: "2023-02", year: 2023, slot: 2, value: oneKbDay * 28, status: "observed" },
      { period: "2024-02", year: 2024, slot: 2, value: oneKbDay * 29, status: "observed" },
      { period: "2024-03", year: 2024, slot: 3, value: -oneKbDay * 31, status: "use_with_caution" },
      { period: "2024-04", year: 2024, slot: 4, value: oneKbDay * 30, status: "preliminary" },
      { period: "2024-05", year: 2024, slot: 5, value: null, status: "suppressed_or_withheld" },
    ],
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
      period: "2024-04",
      value: oneKbDay * 30,
      previous_period: "2024-03",
      absolute_change: oneKbDay * 61,
      percent_change: -196.77,
      year_ago_period: null,
      yoy_absolute_change: null,
      yoy_percent_change: null,
      seasonal_median: null,
      distance_from_seasonal_median: null,
      seasonal_percentile: null,
    },
    latest_source: { period: "2024-05", value: null, status: "suppressed_or_withheld" },
    distribution: {
      levels: { count: 0, mean: null, median: null, stddev: null, min: null, q1: null, q3: null, max: null, iqr: null, skewness: null, excess_kurtosis: null, histogram: [], fit: null },
      changes: { count: 0, mean: null, median: null, stddev: null, min: null, q1: null, q3: null, max: null, iqr: null, skewness: null, excess_kurtosis: null, histogram: [], fit: null },
    },
    methodology_version: "observed-method",
    aggregation_lineage: null,
  };
}

describe("Canada monthly-average kb/d display", () => {
  it("uses exact Gregorian month lengths, including leap February", () => {
    expect(daysInMonthlyPeriod("2023-02")).toBe(28);
    expect(daysInMonthlyPeriod("2024-02")).toBe(29);
    expect(daysInMonthlyPeriod("2024-01")).toBe(31);
    expect(daysInMonthlyPeriod("2024-04")).toBe(30);
    expect(() => daysInMonthlyPeriod("2024-13")).toThrow(/YYYY-MM/);
    expect(() => daysInMonthlyPeriod("2024-2")).toThrow(/YYYY-MM/);
  });

  it("normalizes a monthly volume with that period's day count", () => {
    const oneKbDay = 1_000 * BARREL_TO_CUBIC_METRES;
    expect(monthlyVolumeToKbPerDay(oneKbDay * 29, "2024-02", "cubic_metres"))
      .toBeCloseTo(1, 12);
    const fixedVolume = oneKbDay * 31;
    expect(monthlyVolumeToKbPerDay(fixedVolume, "2024-01", "cubic_metres"))
      .toBeCloseTo(1, 12);
    expect(monthlyVolumeToKbPerDay(fixedVolume, "2024-04", "cubic_metres"))
      .toBeCloseTo(31 / 30, 12);
  });

  it("authorizes registered flows but not point-in-time inventories", () => {
    const production = series("can.statcan.crude.production.monthly", "production");
    const inventory = series("can.statcan.crude.closing_inventory.monthly", "ending-stocks");
    expect(supportsMonthlyAverageRate(production)).toBe(true);
    expect(monthlyAverageRateOption(production)).toMatchObject({
      id: "thousand_barrels_per_day",
      compactLabel: "kb/d",
      longLabel: "Thousand barrels per day (monthly average)",
    });
    expect(supportsMonthlyAverageRate(inventory)).toBe(false);
    expect(monthlyAverageRateOption(inventory)).toBeNull();
  });

  it("preserves statuses and recomputes chart analytics from normalized history", () => {
    const original = sourceAsset();
    const derived = buildMonthlyAverageRateAsset(original);

    expect(derived.unit).toBe("thousand_barrels_per_day");
    expect(derived.source_checksum).toBe(original.source_checksum);
    expect(derived.history?.map((point) => point.value)).toEqual([
      expect.closeTo(1, 12),
      expect.closeTo(1, 12),
      expect.closeTo(-1, 12),
      expect.closeTo(1, 12),
      null,
    ]);
    expect(derived.history?.at(-1)).toMatchObject({
      period: "2024-05",
      value: null,
      status: "suppressed_or_withheld",
    });
    expect(derived.latest).toMatchObject({
      period: "2024-04",
      value: expect.closeTo(1, 12),
      previous_period: "2024-03",
      absolute_change: expect.closeTo(2, 12),
    });
    expect(derived.latest_source).toMatchObject({
      period: "2024-05",
      value: null,
      status: "suppressed_or_withheld",
    });
    expect(derived.distribution.levels.mean).toBeCloseTo(0.5, 12);
    expect(original.unit).toBe("cubic_metres");
    expect(original.history?.[0]?.value).toBeCloseTo(1_000 * BARREL_TO_CUBIC_METRES * 28, 12);
  });

  it("normalizes forecast points and every interval bound by target month", () => {
    const oneKbDay = 1_000 * BARREL_TO_CUBIC_METRES;
    const forecast = {
      frequency: "monthly",
      unit: "cubic_metres",
      points: [
        {
          target_period: "2024-02",
          horizon: 1,
          year: 2024,
          slot: 2,
          value: oneKbDay * 29,
          intervals: {
            "80": { lower: oneKbDay * 29 * 0.8, upper: oneKbDay * 29 * 1.2 },
            "90": { lower: oneKbDay * 29 * 0.7, upper: oneKbDay * 29 * 1.3 },
            "95": { lower: oneKbDay * 29 * 0.6, upper: oneKbDay * 29 * 1.4 },
          },
          calibration_errors: 40,
        },
        {
          target_period: "2024-04",
          horizon: 2,
          year: 2024,
          slot: 4,
          value: oneKbDay * 30 * 2,
          intervals: {
            "80": { lower: oneKbDay * 30, upper: oneKbDay * 30 * 3 },
            "90": { lower: oneKbDay * 30 * 0.5, upper: oneKbDay * 30 * 3.5 },
            "95": { lower: 0, upper: oneKbDay * 30 * 4 },
          },
          calibration_errors: 40,
        },
      ],
    } as ForecastAsset;

    const points = monthlyAverageRateForecastPoints(forecast);
    expect(points[0]?.value).toBeCloseTo(1, 12);
    expect(points[0]?.intervals["90"]).toEqual({
      lower: expect.closeTo(0.7, 12),
      upper: expect.closeTo(1.3, 12),
    });
    expect(points[1]?.value).toBeCloseTo(2, 12);
    expect(points[1]?.intervals["95"].upper).toBeCloseTo(4, 12);
    expect(forecast.points[0]?.value).toBeCloseTo(oneKbDay * 29, 12);
  });
});


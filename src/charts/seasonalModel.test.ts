import { describe, expect, it } from "vitest";
import { buildSeasonalChartModel, slotLabel } from "./seasonalModel";
import type { ForecastAsset, UsaChartAsset } from "../types/energyAssets";

const asset = {
  frequency: "monthly",
  unit: "thousand_barrels_per_day",
  recent_years: [
    { year: 2026, points: [{ period: "2026-01", slot: 1, value: 110, status: "observed" }] },
  ],
  baseline: {
    status: "ok",
    baseline_start_year: 2013,
    baseline_end_year: 2022,
    eligible_years: [2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022],
    eligible_year_count: 10,
    excluded_years: [],
    slots: [{ slot: 1, min: 80, q1: 90, median: 95, mean: 96, q3: 100, max: 105, count: 10 }],
  },
} as unknown as UsaChartAsset;

const forecast = {
  target_view_id: "test-view",
  target_series_id: "test-series",
  geography_id: "us",
  frequency: "monthly",
  unit: "thousand_barrels_per_day",
  points: [
    {
      target_period: "2026-12",
      horizon: 1,
      year: 2026,
      slot: 12,
      value: 120,
      intervals: {
        "80": { lower: 112, upper: 128 },
        "90": { lower: 108, upper: 132 },
        "95": { lower: 70, upper: 140 },
      },
      calibration_errors: 48,
    },
    {
      target_period: "2027-01",
      horizon: 2,
      year: 2027,
      slot: 1,
      value: 121,
      intervals: {
        "80": { lower: 113, upper: 129 },
        "90": { lower: 109, upper: 133 },
        "95": { lower: 69, upper: 141 },
      },
      calibration_errors: 48,
    },
    {
      target_period: "2027-02",
      horizon: 3,
      year: 2027,
      slot: 2,
      value: 122,
      intervals: {
        "80": { lower: 114, upper: 130 },
        "90": { lower: 110, upper: 134 },
        "95": { lower: 68, upper: 142 },
      },
      calibration_errors: 48,
    },
  ],
} as unknown as ForecastAsset;

describe("seasonal chart model", () => {
  it("includes recent observations outside the historical range in its scale", () => {
    const model = buildSeasonalChartModel(asset);
    expect(model.yMax).toBeGreaterThan(110);
    expect(model.yMin).toBeLessThan(80);
    expect(model.series[0]?.points[0]?.value).toBe(110);
  });

  it("uses readable frequency-aware slot labels", () => {
    expect(slotLabel(1, "monthly")).toBe("Jan");
    expect(slotLabel(12, "monthly")).toBe("Dec");
    expect(slotLabel(53, "weekly")).toBe("W53");
  });

  it("includes every forecast interval extreme in the scale and future slots on the axis", () => {
    const model = buildSeasonalChartModel(asset, forecast);
    expect(model.slots).toEqual([1, 2, 12]);
    expect(model.yMin).toBeLessThan(68);
    expect(model.yMax).toBeGreaterThan(142);
  });

  it("splits forecasts by target year so a year boundary is not connected", () => {
    const model = buildSeasonalChartModel(asset, forecast);
    expect(model.forecastSeries.map((series) => series.year)).toEqual([2026, 2027]);
    expect(model.forecastSeries[0]?.points.map((point) => point.slot)).toEqual([12]);
    expect(model.forecastSeries[1]?.points.map((point) => point.slot)).toEqual([1, 2]);
  });
});

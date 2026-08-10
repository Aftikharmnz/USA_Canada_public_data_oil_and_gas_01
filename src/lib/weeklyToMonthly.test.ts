import { describe, expect, it } from "vitest";

import type { HistoricalObservation, UsaChartAsset } from "../types/energyAssets";
import { buildMonthlyViewFromWeekly } from "./weeklyToMonthly";

const DAY_MS = 86_400_000;

function isoWeek(date: Date): number {
  const copy = new Date(date.getTime());
  const day = copy.getUTCDay() || 7;
  copy.setUTCDate(copy.getUTCDate() + 4 - day);
  const yearStart = Date.UTC(copy.getUTCFullYear(), 0, 1);
  return Math.ceil(((copy.getTime() - yearStart) / DAY_MS + 1) / 7);
}

function weeklyHistory(
  start: string,
  end: string,
  value: (period: string) => number | null,
  status: (period: string) => string = () => "observed",
): HistoricalObservation[] {
  const output: HistoricalObservation[] = [];
  for (let timestamp = Date.parse(`${start}T00:00:00Z`);
    timestamp <= Date.parse(`${end}T00:00:00Z`);
    timestamp += 7 * DAY_MS) {
    const date = new Date(timestamp);
    const period = date.toISOString().slice(0, 10);
    output.push({
      period,
      year: date.getUTCFullYear(),
      slot: isoWeek(date),
      value: value(period),
      status: status(period),
    });
  }
  return output;
}

function asset(
  seriesId: string,
  unit: string,
  history: HistoricalObservation[],
  generatedAt = `${history.at(-1)?.period ?? "2026-08-10"}T12:00:00Z`,
): UsaChartAsset {
  return {
    schema_version: "1.0.0",
    methodology_version: "observed-test",
    series_id: seriesId,
    geography_id: "test-region",
    dimensions: {},
    frequency: "weekly",
    unit,
    generated_at: generatedAt,
    source_checksum: "source-checksum",
    freshness: { status: "fresh", latest_period: history.at(-1)?.period },
    history,
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
      period: history.at(-1)?.period ?? "",
      value: history.at(-1)?.value ?? null,
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
      levels: {
        count: 0, mean: null, median: null, stddev: null, min: null, q1: null,
        q3: null, max: null, iqr: null, skewness: null, excess_kurtosis: null,
        histogram: [], fit: null,
      },
      changes: {
        count: 0, mean: null, median: null, stddev: null, min: null, q1: null,
        q3: null, max: null, iqr: null, skewness: null, excess_kurtosis: null,
        histogram: [], fit: null,
      },
    },
    aggregation_lineage: { original: true },
  };
}

describe("buildMonthlyViewFromWeekly", () => {
  it("splits weekly average rates across month boundaries using exact leap-month days", () => {
    const values: Record<string, number> = {
      "2024-02-02": 100,
      "2024-02-09": 200,
      "2024-02-16": 300,
      "2024-02-23": 400,
      "2024-03-01": 500,
    };
    const source = asset(
      "usa.eia.crude.commercial_imports.weekly",
      "thousand_barrels_per_day",
      weeklyHistory("2024-01-05", "2024-03-01", (period) => values[period] ?? 50),
    );

    const monthly = buildMonthlyViewFromWeekly(source);
    expect(monthly.frequency).toBe("monthly");
    expect(monthly.unit).toBe(source.unit);
    expect(monthly.history?.map((point) => point.period)).toEqual(["2024-01", "2024-02"]);
    expect(monthly.history?.find((point) => point.period === "2024-02")?.value)
      .toBeCloseTo((2 * 100 + 7 * 200 + 7 * 300 + 7 * 400 + 6 * 500) / 29, 12);
    expect(monthly.history?.find((point) => point.period === "2024-02")?.status)
      .toBe("computed");
    expect(monthly.methodology_version).toContain("weekly-to-monthly-2026-08-10.1");

    const lineage = monthly.aggregation_lineage as {
      aggregation_kind: string;
      strategy: string;
      source_aggregation_lineage: { original: boolean };
      period_lineage: Array<{ period: string; covered_days: number; coverage_ratio: number }>;
    };
    expect(lineage).toMatchObject({
      aggregation_kind: "temporal_resample",
      strategy: "rate_day_weighted",
      source_aggregation_lineage: { original: true },
    });
    expect(lineage.period_lineage.find((period) => period.period === "2024-02"))
      .toMatchObject({ covered_days: 29, coverage_ratio: 1 });
  });

  it("withholds a rate month when a contributing split week is nonnumeric", () => {
    const source = asset(
      "usa.eia.crude.commercial_imports.weekly",
      "thousand_barrels_per_day",
      weeklyHistory(
        "2024-01-05",
        "2024-03-01",
        (period) => period === "2024-02-23" ? null : 100,
        (period) => period === "2024-02-23" ? "suppressed_or_withheld" : "observed",
      ),
    );

    const monthly = buildMonthlyViewFromWeekly(source);
    expect(monthly.history?.find((point) => point.period === "2024-01"))
      .toMatchObject({ value: 100, status: "computed" });
    expect(monthly.history?.find((point) => point.period === "2024-02"))
      .toMatchObject({ value: null, status: "suppressed_or_withheld" });
    expect(monthly.latest_source).toMatchObject({
      period: "2024-02",
      value: null,
      status: "suppressed_or_withheld",
    });
    expect(monthly.freshness).toMatchObject({
      latest_period: "2024-02",
      latest_numeric_period: "2024-01",
      latest_observation_status: "suppressed_or_withheld",
    });
  });

  it("requires 100% calendar-day coverage and never renormalizes remaining weeks", () => {
    const history = weeklyHistory("2024-01-05", "2024-03-01", () => 100)
      .filter((point) => point.period !== "2024-02-23");
    const monthly = buildMonthlyViewFromWeekly(asset(
      "usa.eia.crude.commercial_imports.weekly",
      "thousand_barrels_per_day",
      history,
    ));
    expect(monthly.history?.find((point) => point.period === "2024-02"))
      .toMatchObject({ value: null, status: "missing" });
    const lineage = monthly.aggregation_lineage as {
      period_lineage: Array<{ period: string; covered_days: number; coverage_ratio: number }>;
    };
    expect(lineage.period_lineage.find((period) => period.period === "2024-02"))
      .toMatchObject({ covered_days: 22, coverage_ratio: 22 / 29 });
  });

  it("uses the final expected weekly endpoint for percentages rather than averaging them", () => {
    const source = asset(
      "usa.eia.refinery.utilization.weekly",
      "percent",
      weeklyHistory("2024-01-05", "2024-03-01", (period) => ({
        "2024-01-26": 75,
        "2024-02-02": 80,
        "2024-02-09": 82,
        "2024-02-16": 84,
        "2024-02-23": 90,
      })[period] ?? 70),
    );
    const monthly = buildMonthlyViewFromWeekly(source);
    expect(monthly.history).toEqual(expect.arrayContaining([
      expect.objectContaining({ period: "2024-01", value: 75, status: "observed" }),
      expect.objectContaining({ period: "2024-02", value: 90, status: "observed" }),
    ]));
    expect(monthly.history?.some((point) => point.period === "2024-03")).toBe(false);
  });

  it("does not stale-fill a suppressed or absent final snapshot", () => {
    const suppressed = weeklyHistory(
      "2024-01-05",
      "2024-03-01",
      (period) => period === "2024-02-23" ? null : 10,
      (period) => period === "2024-02-23" ? "not_available" : "observed",
    );
    const suppressedMonthly = buildMonthlyViewFromWeekly(asset(
      "usa.eia.crude.days_supply.weekly",
      "days",
      suppressed,
    ));
    expect(suppressedMonthly.history?.find((point) => point.period === "2024-02"))
      .toMatchObject({ value: null, status: "not_available" });

    const absentMonthly = buildMonthlyViewFromWeekly(asset(
      "usa.eia.crude.days_supply.weekly",
      "days",
      suppressed.filter((point) => point.period !== "2024-02-23"),
    ));
    expect(absentMonthly.history?.find((point) => point.period === "2024-02"))
      .toMatchObject({ value: null, status: "missing" });
  });

  it("omits an incomplete latest calendar month", () => {
    const monthly = buildMonthlyViewFromWeekly(asset(
      "usa.eia.crude.commercial_stocks.weekly",
      "thousand_barrels",
      weeklyHistory("2024-01-05", "2024-02-23", () => 100),
    ));
    expect(monthly.history?.map((point) => point.period)).toEqual(["2024-01"]);
  });

  it("publishes a completed snapshot month without waiting for the next weekly endpoint", () => {
    const monthly = buildMonthlyViewFromWeekly(asset(
      "usa.eia.crude.commercial_stocks.weekly",
      "thousand_barrels",
      weeklyHistory("2026-05-01", "2026-06-26", (period) => (
        period === "2026-06-26" ? 125 : 100
      )),
      "2026-07-01T12:00:00Z",
    ));
    expect(monthly.history?.find((point) => point.period === "2026-06"))
      .toMatchObject({ value: 125, status: "observed" });
  });

  it("fails closed for unregistered series and metadata drift", () => {
    const history = weeklyHistory("2024-01-05", "2024-03-01", () => 100);
    expect(() => buildMonthlyViewFromWeekly(asset(
      "usa.eia.unregistered.weekly",
      "thousand_barrels_per_day",
      history,
    ))).toThrow(/not registered/);
    expect(() => buildMonthlyViewFromWeekly(asset(
      "usa.eia.crude.commercial_imports.weekly",
      "thousand_barrels",
      history,
    ))).toThrow(/expected thousand_barrels_per_day/);
  });
});

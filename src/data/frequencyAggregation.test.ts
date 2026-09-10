import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import canadaRegistry from "../../config/series/canada.json";
import usaRegistry from "../../config/series/usa.json";
import {
  supportsWeeklyToMonthlySeries,
  weeklyToMonthlyRegistry,
  weeklyToMonthlyRuleForSeries,
} from "./frequencyAggregation";
import { parseCanadaChartAsset, parseCanadaManifest } from "./canadaAssets";
import { parseUsaChartAsset, parseUsaManifest } from "./usaAssets";
import { buildMonthlyViewFromWeekly } from "../lib/weeklyToMonthly";
import type { UsaChartAsset } from "../types/energyAssets";

interface RegisteredSeries {
  id: string;
  activation_status: string;
  frequency: string;
  unit: string;
}

function activeWeeklySeries(input: { series: RegisteredSeries[] }): RegisteredSeries[] {
  return input.series.filter((series) => (
    series.activation_status === "active" && series.frequency === "weekly"
  ));
}

const countries = [
  {
    name: "USA", root: new URL("../../public/data/usa/", import.meta.url),
    registry: usaRegistry, parseManifest: parseUsaManifest, parseAsset: parseUsaChartAsset,
  },
  {
    name: "Canada", root: new URL("../../public/data/canada/", import.meta.url),
    registry: canadaRegistry, parseManifest: parseCanadaManifest, parseAsset: parseCanadaChartAsset,
  },
].map((country) => ({
  ...country,
  weeklySeries: country.parseManifest(JSON.parse(
    readFileSync(new URL("manifest.json", country.root), "utf8"),
  ) as unknown).series.filter((series) => series.frequency === "weekly"),
}));

// Independent coverage oracle, without running the monthly converter or
// reproducing its values. A new numeric weekly corridor can have no complete
// numeric calendar month yet; that is not a broken provider generation.
function hasNumericCompletedMonth(source: UsaChartAsset): boolean {
  const history = source.history!;
  const strategy = weeklyToMonthlyRuleForSeries(source.series_id)!.strategy;
  const periods = history.map((point) => point.period).sort();
  const first = new Date(`${periods[0]}T00:00:00Z`);
  const last = Date.parse(`${periods.at(-1)}T00:00:00Z`);
  const asOf = Date.parse(source.generated_at);
  const dayMs = 86_400_000;
  const numericDates = new Set<string>();
  for (const point of history.filter((point) => point.value !== null)) {
    const date = Date.parse(`${point.period}T00:00:00Z`);
    for (let offset = 0; offset < (strategy === "rate_day_weighted" ? 7 : 1); offset += 1) {
      numericDates.add(new Date(date - offset * dayMs).toISOString().slice(0, 10));
    }
  }
  for (let start = Date.UTC(first.getUTCFullYear(), first.getUTCMonth(), 1); start <= last;) {
    const date = new Date(start);
    const end = Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0);
    if (end <= asOf) {
      if (strategy === "final_weekly_snapshot") {
        const expected = end - ((new Date(end).getUTCDay() - first.getUTCDay() + 7) % 7) * dayMs;
        if (numericDates.has(new Date(expected).toISOString().slice(0, 10))) return true;
      } else if (end <= last) {
        const days = new Date(end).getUTCDate();
        if (Array.from({ length: days }, (_, index) => (
          new Date(start + index * dayMs).toISOString().slice(0, 10)
        )).every((day) => numericDates.has(day))) return true;
      }
    }
    start = end + dayMs;
  }
  return false;
}

describe("weekly-to-monthly display registry", () => {
  it("covers every active USA weekly series and both active CER weekly series exactly once", () => {
    const active = [
      ...activeWeeklySeries(usaRegistry),
      ...activeWeeklySeries(canadaRegistry),
    ];
    expect(active).toHaveLength(68);
    expect(weeklyToMonthlyRegistry.series).toHaveLength(active.length);
    expect(new Set(weeklyToMonthlyRegistry.series.map((rule) => rule.seriesId))).toEqual(
      new Set(active.map((series) => series.id)),
    );
    for (const series of active) {
      expect(supportsWeeklyToMonthlySeries(series.id)).toBe(true);
      expect(weeklyToMonthlyRuleForSeries(series.id)?.sourceUnit).toBe(series.unit);
    }
  });

  it("authorizes rates for day weighting and keeps stocks, ratios, and percentages as snapshots", () => {
    expect(weeklyToMonthlyRuleForSeries("usa.eia.crude.commercial_imports.weekly"))
      .toMatchObject({ strategy: "rate_day_weighted", sourceUnit: "thousand_barrels_per_day" });
    expect(weeklyToMonthlyRuleForSeries("can.cer.refinery.crude_runs.weekly"))
      .toMatchObject({ strategy: "rate_day_weighted", sourceUnit: "thousand_cubic_metres_per_day" });
    expect(weeklyToMonthlyRuleForSeries("usa.eia.crude.commercial_stocks.weekly"))
      .toMatchObject({ strategy: "final_weekly_snapshot", sourceUnit: "thousand_barrels" });
    expect(weeklyToMonthlyRuleForSeries("usa.eia.crude.days_supply.weekly"))
      .toMatchObject({ strategy: "final_weekly_snapshot", sourceUnit: "days" });
    expect(weeklyToMonthlyRuleForSeries("usa.eia.refinery.utilization.weekly"))
      .toMatchObject({ strategy: "final_weekly_snapshot", sourceUnit: "percent" });
  });

  it("does not authorize native monthly or unknown series", () => {
    expect(supportsWeeklyToMonthlySeries("usa.eia.crude.production.monthly")).toBe(false);
    expect(weeklyToMonthlyRuleForSeries("can.statcan.crude.production.monthly")).toBeNull();
  });

  it.each(countries)("covers the exact active $name weekly cohort", (country) => {
    expect(country.weeklySeries.map((series) => series.series_id).sort()).toEqual(
      activeWeeklySeries(country.registry).map((series) => series.id).sort(),
    );
  });
});

// Bound each timed test to one series while retaining complete geography
// coverage. Growing source history must not create one all-countries timeout.
describe.each(countries)("$name promoted weekly-to-monthly availability", (country) => {
  it.each(country.weeklySeries)("checks every $series_id geography", async (series) => {
    const available = series.geographies.filter((candidate) => candidate.status === "available");
    expect(available.length, series.series_id).toBeGreaterThan(0);
    let checked = 0;
    for (const geography of available) {
      expect(geography.asset_path, `${series.series_id}/${geography.geography_id}`).toBeTruthy();
      const source = country.parseAsset(JSON.parse(
        await readFile(new URL(geography.asset_path!, country.root), "utf8"),
      ) as unknown);
      const hasCoverage = hasNumericCompletedMonth(source);
      if (!hasCoverage) {
        expect(() => buildMonthlyViewFromWeekly(source, series.series_id)).toThrow(
          /^Weekly-to-monthly conversion has no (completed calendar months|numeric completed calendar month)\.$/,
        );
      } else {
        const monthly = buildMonthlyViewFromWeekly(source, series.series_id);
        expect(monthly.frequency).toBe("monthly");
        expect(monthly.unit).toBe(source.unit);
        expect(monthly.history?.length).toBeGreaterThan(0);
        expect(monthly.history?.every((point) => /^\d{4}-\d{2}$/.test(point.period))).toBe(true);
      }
      checked += 1;
    }
    expect(checked).toBe(available.length);
  }, 30_000);
});

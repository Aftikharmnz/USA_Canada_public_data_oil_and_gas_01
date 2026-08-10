import { readFile } from "node:fs/promises";
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

  it("builds a completed monthly view for every promoted weekly asset", async () => {
    const countries = [
      {
        root: new URL("../../public/data/usa/", import.meta.url),
        parseManifest: parseUsaManifest,
        parseAsset: parseUsaChartAsset,
      },
      {
        root: new URL("../../public/data/canada/", import.meta.url),
        parseManifest: parseCanadaManifest,
        parseAsset: parseCanadaChartAsset,
      },
    ];
    let checked = 0;
    let expected = 0;
    for (const country of countries) {
      const manifest = country.parseManifest(JSON.parse(
        await readFile(new URL("manifest.json", country.root), "utf8"),
      ) as unknown);
      for (const series of manifest.series.filter((candidate) => candidate.frequency === "weekly")) {
        const available = series.geographies.filter((candidate) => candidate.asset_path);
        expected += available.length;
        for (const geography of available) {
          const source = country.parseAsset(JSON.parse(
            await readFile(new URL(geography.asset_path!, country.root), "utf8"),
          ) as unknown);
          const monthly = buildMonthlyViewFromWeekly(source, series.series_id);
          expect(monthly.frequency).toBe("monthly");
          expect(monthly.unit).toBe(source.unit);
          expect(monthly.history?.length).toBeGreaterThan(0);
          expect(monthly.history?.every((point) => /^\d{4}-\d{2}$/.test(point.period))).toBe(true);
          checked += 1;
        }
      }
    }
    expect(expected).toBe(292);
    expect(checked).toBe(expected);
  }, 30_000);
});

import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { parsePublicChartAsset, parsePublicManifest } from "../data/usaAssets";
import { usaSeriesDescriptor } from "../data/usaDashboard";
import { canadaMarketSegmentFacet } from "../data/canadaDashboard";
import type { CountryCode } from "../types/catalog";
import { buildChartAssetFromHistory } from "./customChartAnalytics";

const numericStatuses = new Set(["observed", "preliminary", "revised", "computed", "use_with_caution"]);
const nonnumericStatuses = new Set(["missing", "not_available", "not_applicable", "suppressed_or_withheld"]);

function equalNumeric(actual: number | null, expected: number | null, context: string) {
  if (actual === null || expected === null) {
    expect(actual, context).toBe(expected);
  } else {
    // Python uses Decimal for source arithmetic; in-memory display derivations
    // use JS doubles. Compare within a strict relative floating-point tolerance.
    expect(Math.abs(actual - expected), context).toBeLessThanOrEqual(Math.max(1, Math.abs(expected)) * 1e-10);
  }
}

describe.each<CountryCode>(["usa", "canada"])("promoted %s refined-product numerical audit", (country) => {
    const base = resolve(`public/data/${country}`);
    const manifest = parsePublicManifest(JSON.parse(readFileSync(resolve(base, "manifest.json"), "utf8")), country);
    const series = manifest.series.filter((item) => country === "usa"
      ? usaSeriesDescriptor(item)?.segment === "refined"
      : canadaMarketSegmentFacet(item).id === "refined");
    it("has manifest-backed refined-product charts to audit", () => {
      expect(series.length).toBeGreaterThan(0);
      expect(series.some((entry) => entry.geographies.some((geo) => geo.status === "available" && geo.asset_path))).toBe(true);
    });
    it.each(series)("reconciles $series_id with its exact published history", (entry) => {
      for (const geography of entry.geographies.filter((item) => item.status === "available" && item.asset_path)) {
        const asset = parsePublicChartAsset(JSON.parse(readFileSync(resolve(base, geography.asset_path!), "utf8")));
        const context = `${entry.series_id} / ${geography.geography_id}`;
        expect(asset.series_id, context).toBe(entry.series_id);
        expect(asset.geography_id, context).toBe(geography.geography_id);
        expect(asset.frequency, context).toBe(entry.frequency);
        expect(asset.unit, context).toBe(entry.unit);
        expect(asset.history?.length, context).toBeGreaterThan(0);
        for (const point of asset.history!) {
          if (!(numericStatuses.has(point.status) || nonnumericStatuses.has(point.status))
              || (point.value !== null) !== numericStatuses.has(point.status)
              || (point.value !== null && !Number.isFinite(point.value))) {
            throw new Error(`${context} / ${point.period}: contradictory value or status`);
          }
          if (entry.frequency === "monthly") {
            if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(point.period)
                || point.year !== Number(point.period.slice(0, 4))
                || point.slot !== Number(point.period.slice(5, 7))) {
              throw new Error(`${context} / ${point.period}: invalid monthly coordinate`);
            }
          } else if (!/^\d{4}-\d{2}-\d{2}$/.test(point.period) || point.slot < 1 || point.slot > 53) {
            throw new Error(`${context} / ${point.period}: invalid weekly coordinate`);
          }
        }
        const rebuilt = buildChartAssetFromHistory({
          seriesId: asset.series_id, geographyId: asset.geography_id, dimensions: asset.dimensions,
          frequency: asset.frequency, unit: asset.unit, generatedAt: asset.generated_at,
          sourceChecksum: asset.source_checksum, methodologyVersion: asset.methodology_version,
          freshness: asset.freshness, history: asset.history!, aggregationLineage: asset.aggregation_lineage,
        });
        expect(rebuilt.latest_source, context).toEqual(asset.latest_source);
        expect(rebuilt.latest.period, context).toBe(asset.latest.period);
        expect(rebuilt.latest.previous_period, context).toBe(asset.latest.previous_period);
        expect(rebuilt.latest.year_ago_period, context).toBe(asset.latest.year_ago_period);
        for (const key of ["value", "absolute_change", "percent_change", "yoy_absolute_change", "yoy_percent_change", "seasonal_median", "distance_from_seasonal_median", "seasonal_percentile"] as const) {
          equalNumeric(rebuilt.latest[key], asset.latest[key], `${context} / latest.${key}`);
        }
        expect(rebuilt.recent_years, context).toEqual(asset.recent_years);
        expect(rebuilt.baseline.eligible_years, context).toEqual(asset.baseline.eligible_years);
        expect(rebuilt.baseline.status, context).toBe(asset.baseline.status);
        expect(rebuilt.baseline.slots.length, context).toBe(asset.baseline.slots.length);
        for (const [index, slot] of rebuilt.baseline.slots.entries()) {
          const source = asset.baseline.slots[index]!;
          expect(slot.slot, context).toBe(source.slot);
          expect(slot.count, context).toBe(source.count);
          for (const key of ["min", "q1", "median", "mean", "q3", "max"] as const) {
            equalNumeric(slot[key], source[key], `${context} / baseline ${slot.slot} ${key}`);
          }
        }
        for (const sample of ["levels", "changes"] as const) {
          const actual = rebuilt.distribution[sample];
          const expected = asset.distribution[sample];
          expect(actual.count, context).toBe(expected.count);
          for (const key of ["mean", "median", "stddev", "min", "q1", "q3", "max", "iqr", "skewness", "excess_kurtosis"] as const) {
            equalNumeric(actual[key], expected[key], `${context} / ${sample}.${key}`);
          }
          expect(actual.histogram.reduce((sum, bin) => sum + bin.count, 0), context).toBe(actual.count);
        }
      }
    });
});

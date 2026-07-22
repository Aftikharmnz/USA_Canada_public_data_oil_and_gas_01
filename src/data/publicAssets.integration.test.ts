import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseCanadaChartAsset, parseCanadaManifest } from "./canadaAssets";
import { customAggregationPolicy } from "./customAggregation";
import { forecastMismatchReason, parseForecastAsset } from "./forecastAssets";
import { parseUsaChartAsset, parseUsaManifest } from "./usaAssets";
import { buildCustomRegionView } from "../lib/customRegionView";
import {
  buildMonthlyAverageRateAsset,
  monthlyAverageRateForecastPoints,
} from "../lib/periodAverageRate";

const publicRoot = new URL("../../public/data/usa/", import.meta.url);
const canadaPublicRoot = new URL("../../public/data/canada/", import.meta.url);

async function readJson(url: URL): Promise<unknown> {
  return JSON.parse(await readFile(url, "utf8")) as unknown;
}

describe("promoted USA data", () => {
  it("matches the frontend contract for every manifest asset", async () => {
    const manifest = parseUsaManifest(await readJson(new URL("manifest.json", publicRoot)));
    const available = manifest.series.flatMap((series) =>
      series.geographies
        .filter((geography) => geography.status === "available" && geography.asset_path)
        .map((geography) => ({ series, geography })),
    );

    const refinedSeries = manifest.series.filter(
      (series) => series.classification?.dashboard_group === "refined_products",
    );
    const crudeSeries = manifest.series.filter(
      (series) => series.classification?.dashboard_group === "usa_crude",
    );
    const unclassifiedSeries = manifest.series.filter((series) => !series.classification);
    expect(unclassifiedSeries).toHaveLength(3);
    expect(refinedSeries.length).toBeGreaterThanOrEqual(36);
    expect(crudeSeries.length).toBeGreaterThanOrEqual(0);
    if (refinedSeries.length > 0) {
      const familyCounts = refinedSeries.reduce<Record<string, number>>((counts, series) => {
        const familyId = series.classification!.product_family_id;
        counts[familyId] = (counts[familyId] ?? 0) + 1;
        return counts;
      }, {});
      expect(familyCounts.gasoline).toBeGreaterThanOrEqual(18);
      expect(familyCounts.distillate).toBeGreaterThanOrEqual(13);
      expect(familyCounts["jet-fuel"]).toBeGreaterThanOrEqual(5);
    }
    expect(available.length).toBeGreaterThanOrEqual(48);

    for (const { series, geography } of available) {
      const asset = parseUsaChartAsset(
        await readJson(new URL(geography.asset_path!, publicRoot)),
      );
      expect(asset.series_id).toBe(series.series_id);
      expect(asset.geography_id).toBe(geography.geography_id);
      expect(asset.baseline.eligible_years).toHaveLength(
        asset.baseline.eligible_year_count,
      );
      if (geography.forecast_path) {
        const forecast = parseForecastAsset(
          await readJson(new URL(geography.forecast_path, publicRoot)),
        );
        expect(forecastMismatchReason(
          forecast,
          asset,
          series,
          geography.geography_id,
        )).toBeNull();
      }
    }
  }, 30_000);
});

describe("promoted Canada data", () => {
  it("matches the frontend contract for every manifest asset", async () => {
    const manifest = parseCanadaManifest(
      await readJson(new URL("manifest.json", canadaPublicRoot)),
    );
    expect(manifest.series).toHaveLength(51);

    const providerCounts = manifest.series.reduce<Record<string, number>>(
      (counts, series) => {
        counts[series.source.name] = (counts[series.source.name] ?? 0) + 1;
        return counts;
      },
      {},
    );
    expect(providerCounts).toEqual({
      "Canada Energy Regulator": 2,
      "Statistics Canada": 49,
    });

    const available = manifest.series.flatMap((series) =>
      series.geographies
        .filter((geography) => geography.status === "available" && geography.asset_path)
        .map((geography) => ({ series, geography })),
    );
    expect(available).toHaveLength(404);

    const cerUtilization = manifest.series.find(
      (series) => series.series_id === "can.cer.refinery.utilization.weekly",
    );
    expect(cerUtilization).toBeDefined();
    expect(cerUtilization?.geographies.some((geography) => geography.geography_id === "ca"))
      .toBe(false);

    for (const { series, geography } of available) {
      const asset = parseCanadaChartAsset(
        await readJson(new URL(geography.asset_path!, canadaPublicRoot)),
      );
      expect(asset.series_id).toBe(series.series_id);
      expect(asset.geography_id).toBe(geography.geography_id);
      expect(asset.baseline.eligible_years).toHaveLength(
        asset.baseline.eligible_year_count,
      );
      if (geography.forecast_path) {
        const forecast = parseForecastAsset(
          await readJson(new URL(geography.forecast_path, canadaPublicRoot)),
        );
        expect(forecastMismatchReason(
          forecast,
          asset,
          series,
          geography.geography_id,
        )).toBeNull();
      }
    }
  }, 30_000);
});

describe("promoted custom-region examples", () => {
  it.each([
    {
      country: "usa" as const,
      root: publicRoot,
      seriesId: "usa.eia.crude.production.monthly",
      levelId: "padd",
      geographyIds: ["us.padd.1", "us.padd.2"],
    },
    {
      country: "canada" as const,
      root: canadaPublicRoot,
      seriesId: "can.statcan.crude.production.monthly",
      levelId: "province_territory",
      geographyIds: ["ca.ab", "ca.sk"],
    },
  ])("combines $seriesId for the requested regions", async ({
    country,
    root,
    seriesId,
    levelId,
    geographyIds,
  }) => {
    const rawManifest = await readJson(new URL("manifest.json", root));
    const manifest = country === "usa"
      ? parseUsaManifest(rawManifest)
      : parseCanadaManifest(rawManifest);
    const series = manifest.series.find((candidate) => candidate.series_id === seriesId);
    expect(series).toBeDefined();
    const geographies = geographyIds.map((geographyId) => series!.geographies.find(
      (geography) => geography.geography_id === geographyId && geography.level_id === levelId,
    )!);
    expect(geographies.every((geography) => geography?.asset_path && geography?.forecast_path)).toBe(true);
    const assets = await Promise.all(geographies.map(async (geography) => (
      parseUsaChartAsset(await readJson(new URL(geography.asset_path!, root)))
    )));
    const forecasts = await Promise.all(geographies.map(async (geography) => (
      parseForecastAsset(await readJson(new URL(geography.forecast_path!, root)))
    )));
    const policy = customAggregationPolicy(country, series!.view_id, levelId);
    expect(policy).toBeDefined();
    const result = await buildCustomRegionView({
      country,
      series: series!,
      registryPolicy: policy!,
      geographies,
      assets,
      forecasts,
    });

    expect(result.asset.geography_id).toContain("computed:");
    expect(result.asset.aggregation_lineage?.component_geography_ids).toEqual(geographyIds);
    expect(result.asset.history?.length).toBeGreaterThan(100);
    expect(result.forecast?.points).toHaveLength(3);
    expect(result.forecast?.prediction_intervals?.method)
      .toBe("aligned_component_residual_sum_empirical_quantiles");
    if (country === "canada") {
      const rateAsset = buildMonthlyAverageRateAsset(result.asset);
      const rateForecast = monthlyAverageRateForecastPoints(result.forecast!);
      expect(rateAsset.unit).toBe("thousand_barrels_per_day");
      expect(rateAsset.aggregation_lineage?.component_geography_ids).toEqual(geographyIds);
      expect(rateForecast).toHaveLength(3);
      expect(rateForecast.every((point) => Number.isFinite(point.value))).toBe(true);
    }
  }, 30_000);
});

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseCanadaChartAsset, parseCanadaManifest } from "./canadaAssets";
import { customAggregationPolicy } from "./customAggregation";
import { forecastMismatchReason, parseForecastAsset } from "./forecastAssets";
import { parseUsaChartAsset, parseUsaManifest } from "./usaAssets";
import { buildCustomRegionView } from "../lib/customRegionView";
import { buildRegionalContributionModel } from "../charts/regionalContributionModel";
import {
  buildCanadaOriginDestinationModel,
  canadaOriginDestinationAssetPlan,
} from "../charts/canadaOriginDestinationModel";
import {
  buildUsaPaddOriginDestinationModel,
  usaPaddOriginDestinationAssetPlan,
} from "../charts/usaPaddOriginDestinationModel";
import {
  canadaMovementContext,
  movementRouteFromAsset,
} from "./canadaMovement";
import { regionalContributionSpec } from "./regionalContributions";
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
    expect(manifest.series).toHaveLength(69);
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
    expect(refinedSeries).toHaveLength(56);
    expect(crudeSeries).toHaveLength(10);
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
    expect(available).toHaveLength(361);

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

  it.each([
    {
      seriesId: "usa.eia.crude.padd_movements.monthly",
      expectedRoutes: 17,
      absentOrigin: "us.padd.1",
      absentDestination: "us.padd.5",
    },
    {
      seriesId: "usa.eia.refined.total_petroleum_products.padd_movements.monthly",
      expectedRoutes: 18,
      absentOrigin: "us.padd.1",
      absentDestination: "us.padd.4",
    },
  ])("joins the exact $seriesId corridors into a PADD origin-destination matrix", async ({
    seriesId,
    expectedRoutes,
    absentOrigin,
    absentDestination,
  }) => {
    const manifest = parseUsaManifest(
      await readJson(new URL("manifest.json", publicRoot)),
    );
    const series = manifest.series.find((candidate) => (
      candidate.series_id === seriesId
    ));
    expect(series).toBeDefined();
    const plan = usaPaddOriginDestinationAssetPlan(series!);
    expect(plan).toHaveLength(expectedRoutes);
    const loaded = await Promise.all(plan.map(async (item) => ({
      ...item,
      asset: parseUsaChartAsset(
        await readJson(new URL(item.assetPath, publicRoot)),
      ),
    })));
    const model = buildUsaPaddOriginDestinationModel(series!, loaded);
    const expectedLatestPeriod = loaded.flatMap(
      ({ asset }) => asset.history?.map(({ period }) => period) ?? [],
    ).sort().at(-1);
    const latest = model.snapshots.find(
      (snapshot) => snapshot.period === model.latestPeriod,
    )!;

    expect(expectedLatestPeriod).toBeDefined();
    expect(model.origins).toHaveLength(5);
    expect(model.destinations).toHaveLength(5);
    expect(model.routes).toHaveLength(expectedRoutes);
    expect(model.latestPeriod).toBe(expectedLatestPeriod);
    expect(latest.cells.find((cell) => (
      cell.origin.id === absentOrigin
      && cell.destination.id === absentDestination
    ))).toMatchObject({
      routeId: null,
      value: null,
      status: "no_published_fact",
      declared: false,
    });
  }, 30_000);
});

describe("promoted Canada data", () => {
  it("matches the frontend contract for every manifest asset", async () => {
    const manifest = parseCanadaManifest(
      await readJson(new URL("manifest.json", canadaPublicRoot)),
    );
    expect(manifest.series).toHaveLength(69);

    const providerCounts = manifest.series.reduce<Record<string, number>>(
      (counts, series) => {
        counts[series.source.name] = (counts[series.source.name] ?? 0) + 1;
        return counts;
      },
      {},
    );
    expect(providerCounts).toEqual({
      "Canada Energy Regulator": 2,
      "Statistics Canada": 67,
    });

    const available = manifest.series.flatMap((series) =>
      series.geographies
        .filter((geography) => geography.status === "available" && geography.asset_path)
        .map((geography) => ({ series, geography })),
    );
    expect(available).toHaveLength(467);

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
      const movementContext = canadaMovementContext(series);
      if (movementContext) {
        expect(movementRouteFromAsset(series, asset, geography)).not.toBeNull();
      }
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

  it.each([
    {
      seriesId: "can.statcan.crude.pipeline_movements.to_ontario.monthly",
      productLabel: "Crude & equivalents pipeline movements",
      minimumAvailableRoutes: 19,
    },
    {
      seriesId: "can.statcan.refined.hgl_rpp.pipeline_movements.to_ontario.monthly",
      productLabel: "HGL + refined products pipeline movements",
      minimumAvailableRoutes: 14,
    },
  ])("joins the exact $seriesId siblings into a province origin-destination matrix", async ({
    seriesId,
    productLabel,
    minimumAvailableRoutes,
  }) => {
    const manifest = parseCanadaManifest(
      await readJson(new URL("manifest.json", canadaPublicRoot)),
    );
    const active = manifest.series.find(
      (series) => series.series_id === seriesId,
    );
    expect(active).toBeDefined();
    const plan = canadaOriginDestinationAssetPlan(manifest.series, active!);
    // Only source-published routes with an available public asset are loaded.
    // Other dimension-declared routes have no numeric public history and
    // remain unpublished rather than being treated as zero.
    expect(plan).toHaveLength(minimumAvailableRoutes);
    const loaded = await Promise.all(plan.map(async (item) => ({
      ...item,
      asset: parseCanadaChartAsset(
        await readJson(new URL(item.assetPath, canadaPublicRoot)),
      ),
    })));
    const model = buildCanadaOriginDestinationModel(
      manifest.series,
      active!,
      loaded,
    );
    const latestSourcePeriods = new Set(
      loaded.map(({ asset }) => asset.latest_source?.period),
    );

    expect(latestSourcePeriods).toEqual(new Set([model.latestPeriod]));
    expect(model.productLabel).toBe(productLabel);
    expect(model.origins.some((node) => node.label === "Alberta")).toBe(true);
    expect(model.destinations.some((node) => node.label === "Ontario")).toBe(true);
    expect(model.destinations.some((node) => node.label === "United States")).toBe(true);
    expect(model.routes.every(
      (route) => route.originLabel !== "Canada" && route.destinationLabel !== "Canada",
    )).toBe(true);
    expect(model.routes.some(
      (route) => route.originLabel === "Alberta"
        && route.destinationLabel === "British Columbia",
    )).toBe(true);
  }, 30_000);
});

describe("promoted regional import contribution views", () => {
  it.each([
    { country: "usa" as const, root: publicRoot, expectedSeries: 13 },
    { country: "canada" as const, root: canadaPublicRoot, expectedSeries: 6 },
  ])("validates every eligible $country import decomposition", async ({
    country,
    root,
    expectedSeries,
  }) => {
    const rawManifest = await readJson(new URL("manifest.json", root));
    const manifest = country === "usa"
      ? parseUsaManifest(rawManifest)
      : parseCanadaManifest(rawManifest);
    const eligible = manifest.series.flatMap((series) => {
      const spec = regionalContributionSpec(country, series);
      return spec ? [{ series, spec }] : [];
    });
    expect(eligible).toHaveLength(expectedSeries);

    for (const { series, spec } of eligible) {
      expect(spec.components.every(
        (component) => component.geographyId !== spec.nationalGeographyId,
      )).toBe(true);
      expect(spec.components.some(
        (component) => component.geographyId === "ca.statcan.atlantic",
      )).toBe(false);
      const national = parseUsaChartAsset(
        await readJson(new URL(spec.nationalAssetPath, root)),
      );
      const components = await Promise.all(spec.components.map(async (geography) => ({
        geography,
        asset: parseUsaChartAsset(await readJson(new URL(geography.assetPath, root))),
      })));
      const model = buildRegionalContributionModel(series, spec, national, components);
      expect(model.latest.expectedComponentCount).toBe(spec.components.length);
      expect(model.latest.components.every(
        (component) => component.previousPeriod === null
          || component.previousPeriod < model.latest.period,
      )).toBe(true);
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

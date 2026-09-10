import { readFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import usaSeriesRegistry from "../../config/series/usa.json";
import canadaSeriesRegistry from "../../config/series/canada.json";
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
import type { ForecastAsset } from "../types/energyAssets";

const publicRoot = new URL("../../public/data/usa/", import.meta.url);
const canadaPublicRoot = new URL("../../public/data/canada/", import.meta.url);
const usaManifest = parseUsaManifest(JSON.parse(
  readFileSync(new URL("manifest.json", publicRoot), "utf8"),
) as unknown);
const canadaManifest = parseCanadaManifest(JSON.parse(
  readFileSync(new URL("manifest.json", canadaPublicRoot), "utf8"),
) as unknown);
const reviewedUsaPublicSeriesCounts = [69, 78] as const;
const reviewedCanadaPublicSeriesCounts = [69, 81, 96] as const;
const cerExpansionSeriesIds = new Set([
  ...["propane", "butane"].flatMap((product) => (
    ["total", "padd1", "padd2", "padd3", "padd4", "padd5", "other"].map(
      (destination) => `can.cer.ngl.${product}.exports.${destination}.monthly`,
    )
  )),
  "can.cer.pipeline.trans_northern.throughput.monthly",
]);
const canada81ExpansionSeriesIds = new Set([
  "can.statcan.refined.propane.field_production.monthly",
  "can.statcan.refined.propane.net_production.monthly",
  "can.statcan.refined.propane.imports.monthly",
  "can.statcan.refined.propane.exports.monthly",
  "can.statcan.refined.residual_fuel_oil.net_production.monthly",
  "can.statcan.refined.residual_fuel_oil.imports.monthly",
  "can.statcan.refined.residual_fuel_oil.exports.monthly",
  "can.statcan.refined.residual_fuel_oil.product_supplied.monthly",
  "can.statcan.refined.residual_fuel_oil.ending_stocks.monthly",
  "can.statcan.refined.residual_fuel_oil.stock_change.monthly",
  "can.statcan.crude.transporter_inventory.closing.monthly",
  "can.statcan.refined.hgl_rpp.transporter_inventory.closing.monthly",
]);
const usaMonthlyCrudeBalanceSeriesIds = new Set([
  "usa.eia.crude.ending_stocks.monthly",
  "usa.eia.crude.stock_change.monthly",
  "usa.eia.crude.imports.monthly",
  "usa.eia.crude.exports.monthly",
  "usa.eia.crude.refinery_inputs.monthly",
  "usa.eia.crude.product_supplied.monthly",
  "usa.eia.crude.supply_adjustment.monthly",
  "usa.eia.crude.net_receipts.monthly",
  "usa.eia.crude.transfers_to_supply.monthly",
]);
const activeUsaRegistrySeriesIds = usaSeriesRegistry.series
  .filter((series) => series.activation_status === "active")
  .map((series) => series.id)
  .sort();
const reviewedUsaLastKnownGoodSeriesIds = activeUsaRegistrySeriesIds
  .filter((seriesId) => !usaMonthlyCrudeBalanceSeriesIds.has(seriesId));

async function readJson(url: URL): Promise<unknown> {
  return JSON.parse(await readFile(url, "utf8")) as unknown;
}

/** Independent availability oracle: ready components alone do not guarantee
 * that their origins and 40-per-horizon calibration target sets align. */
function combinationHasAlignedForecasts(forecasts: ForecastAsset[]): boolean {
  if (!forecasts.length || forecasts.some((forecast) => (
    !["ok", "limited_history"].includes(forecast.status)
    || forecast.points.length !== 3
    || !forecast.aggregation_residuals
  ))) return false;
  if (new Set(forecasts.map((forecast) => forecast.origin.period)).size !== 1) return false;
  if (new Set(forecasts.map((forecast) => forecast.methodology_version)).size !== 1) return false;
  return [1, 2, 3].every((horizon) => {
    if (new Set(forecasts.map((forecast) => (
      forecast.points.find((point) => point.horizon === horizon)?.target_period
    ))).size !== 1) return false;
    const targetSets = forecasts.map((forecast) => new Set(
      forecast.aggregation_residuals!.samples
        .filter((sample) => sample.horizon === horizon)
        .map((sample) => sample.target_period),
    ));
    return [...targetSets[0]!].filter((target) => (
      targetSets.every((targets) => targets.has(target))
    )).length >= 40;
  });
}

describe("promoted USA data", () => {
  it("matches the exact reviewed manifest cohort", () => {
    const manifest = usaManifest;
    // The checked-in public generation may be the reviewed 69-series LKG or
    // the complete 78-series registry promotion, never a partial transition.
    expect(reviewedUsaPublicSeriesCounts).toContain(manifest.series.length);
    expect(activeUsaRegistrySeriesIds).toHaveLength(78);
    expect(reviewedUsaLastKnownGoodSeriesIds).toHaveLength(69);
    expect(manifest.series.map((series) => series.view_id).sort()).toEqual(
      manifest.series.length === 78
        ? activeUsaRegistrySeriesIds
        : reviewedUsaLastKnownGoodSeriesIds,
    );
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
    expect(refinedSeries.length).toBeGreaterThanOrEqual(56);
    expect(crudeSeries.length).toBeGreaterThanOrEqual(10);
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
    expect(available.length).toBeGreaterThanOrEqual(361);
  });

  // Each independent series gets its own bounded test rather than charging
  // every growing USA observed/forecast history against one 30-second timer.
  it.each(usaManifest.series)("validates every $series_id observed and forecast asset", async (series) => {
    const available = series.geographies.filter((geography) => geography.status === "available");
    for (const geography of available) {
      expect(geography.asset_path).toBeTruthy();
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
  it("matches the reviewed manifest cohort and provider boundary", () => {
    const manifest = canadaManifest;
    // Canada has the same fail-closed transition contract: the reviewed
    // Complete reviewed 69/81-series LKGs or the 96-series CER promotion,
    // never an arbitrary count with missing or substituted series identities.
    expect(reviewedCanadaPublicSeriesCounts).toContain(manifest.series.length);
    const expected = canadaSeriesRegistry.series.filter((series) => (
      series.activation_status === "active"
      && (manifest.series.length === 96 || !cerExpansionSeriesIds.has(series.id))
      && (manifest.series.length !== 69 || !canada81ExpansionSeriesIds.has(series.id))
    ));
    expect(manifest.series.map((series) => series.series_id).sort())
      .toEqual(expected.map((series) => series.id).sort());

    const providerCounts = manifest.series.reduce<Record<string, number>>(
      (counts, series) => {
        counts[series.source.name] = (counts[series.source.name] ?? 0) + 1;
        return counts;
      },
      {},
    );
    expect(providerCounts["Canada Energy Regulator"]).toBe(manifest.series.length === 96 ? 17 : 2);
    expect(providerCounts["Statistics Canada"]).toBe(manifest.series.length === 69 ? 67 : 79);

    const available = manifest.series.flatMap((series) =>
      series.geographies
        .filter((geography) => geography.status === "available" && geography.asset_path)
        .map((geography) => ({ series, geography })),
    );
    expect(available.length).toBeGreaterThanOrEqual(467);

    const cerUtilization = manifest.series.find(
      (series) => series.series_id === "can.cer.refinery.utilization.weekly",
    );
    expect(cerUtilization).toBeDefined();
    expect(cerUtilization?.geographies.some((geography) => geography.geography_id === "ca"))
      .toBe(false);
  });

  it.each(canadaManifest.series)("validates every $series_id observed and forecast asset", async (series) => {
    const available = series.geographies.filter((geography) => geography.status === "available");
    for (const geography of available) {
      expect(geography.asset_path).toBeTruthy();
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
    },
    {
      seriesId: "can.statcan.refined.hgl_rpp.pipeline_movements.to_ontario.monthly",
      productLabel: "HGL + refined products pipeline movements",
    },
  ])("joins the exact $seriesId siblings into a province origin-destination matrix", async ({
    seriesId,
    productLabel,
  }) => {
    const manifest = parseCanadaManifest(
      await readJson(new URL("manifest.json", canadaPublicRoot)),
    );
    const active = manifest.series.find(
      (series) => series.series_id === seriesId,
    );
    expect(active).toBeDefined();
    const plan = canadaOriginDestinationAssetPlan(manifest.series, active!);
    // The registry fixes the product and endpoint meanings, not the number of
    // corridors that will acquire numeric history in future source releases.
    const registeredSiblingIds = new Set(canadaSeriesRegistry.series.filter((series) => (
      series.activation_status === "active"
      && series.table_pid === "25100077"
      && series.display?.product_id === active!.classification?.product_id
      && series.display?.measure_id !== "to-canada"
    )).map((series) => series.id));
    const expectedIdentities = manifest.series.filter((series) => (
      registeredSiblingIds.has(series.series_id)
    )).flatMap((series) => series.geographies.filter((geography) => (
      geography.level_id === "province_territory" && geography.status === "available"
    )).map((geography) => `${series.series_id}/${geography.geography_id}`)).sort();
    expect(expectedIdentities.length).toBeGreaterThan(0);
    expect(plan.map(({ series, geography }) => (
      `${series.series_id}/${geography.geography_id}`
    )).sort()).toEqual(expectedIdentities);
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
    expect(model.latestPeriod).toBe(
      loaded.map(({ asset }) => asset.latest_source!.period).sort().at(-1),
    );
    expect(model.routes.map((route) => route.id).sort()).toEqual(expectedIdentities);
    for (const { series, geography, asset } of loaded) {
      const cell = model.snapshots.find((snapshot) => snapshot.period === model.latestPeriod)!
        .cells.find((candidate) => candidate.routeId === `${series.series_id}/${geography.geography_id}`)!;
      const observation = asset.history!.find((point) => point.period === model.latestPeriod);
      expect(cell.value).toBe(observation?.value ?? null);
      expect(cell.status).toBe(observation?.status ?? "missing");
    }
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
    { country: "usa" as const, root: publicRoot },
    { country: "canada" as const, root: canadaPublicRoot },
  ])("validates every eligible $country import decomposition", async ({
    country,
    root,
  }) => {
    const rawManifest = await readJson(new URL("manifest.json", root));
    const manifest = country === "usa"
      ? parseUsaManifest(rawManifest)
      : parseCanadaManifest(rawManifest);
    const eligible = manifest.series.flatMap((series) => {
      const spec = regionalContributionSpec(country, series);
      return spec ? [{ series, spec }] : [];
    });
    // Eligibility is defined by the promoted manifest and aggregation policy;
    // it grows automatically when a complete reviewed cohort is promoted.
    expect(eligible.length).toBeGreaterThan(0);

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
    expect(Boolean(result.forecast)).toBe(combinationHasAlignedForecasts(forecasts));
    if (result.forecast) {
      expect(result.forecast.points).toHaveLength(3);
      expect(result.forecast.prediction_intervals?.method)
        .toBe("aligned_component_residual_sum_empirical_quantiles");
      for (const point of result.forecast.points) {
        expect(point.value).toBeCloseTo(forecasts.reduce((sum, forecast) => (
          sum + forecast.points.find((component) => component.horizon === point.horizon)!.value
        ), 0), 8);
        expect(point.calibration_errors).toBeGreaterThanOrEqual(40);
      }
    } else {
      expect(result.forecastNotice).toBeTruthy();
    }
    if (country === "canada") {
      const rateAsset = buildMonthlyAverageRateAsset(result.asset);
      expect(rateAsset.unit).toBe("thousand_barrels_per_day");
      expect(rateAsset.aggregation_lineage?.component_geography_ids).toEqual(geographyIds);
      if (result.forecast) {
        const rateForecast = monthlyAverageRateForecastPoints(result.forecast);
        expect(rateForecast).toHaveLength(3);
        expect(rateForecast.every((point) => Number.isFinite(point.value))).toBe(true);
      }
    }
  }, 30_000);
});

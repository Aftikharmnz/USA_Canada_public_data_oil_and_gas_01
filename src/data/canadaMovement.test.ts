import { describe, expect, it } from "vitest";
import type { UsaChartAsset, UsaManifestSeries } from "../types/energyAssets";
import {
  canadaMovementContext,
  movementRouteFromAsset,
  movementRouteLabelFromSelection,
} from "./canadaMovement";
import {
  buildCanadaOriginDestinationModel,
  canadaOriginDestinationAssetPlan,
} from "../charts/canadaOriginDestinationModel";

function series(measureId: string): UsaManifestSeries {
  return {
    view_id: `can.statcan.crude.pipeline_movements.${measureId.replaceAll("-", "_")}.monthly`,
    series_id: `can.statcan.crude.pipeline_movements.${measureId.replaceAll("-", "_")}.monthly`,
    title: "Pipeline movements",
    category: "Energy market",
    unit: "cubic_metres",
    frequency: "monthly",
    source: { name: "Statistics Canada" },
    freshness: { status: "unknown" },
    classification: {
      dashboard_group: "canada_crude",
      product_family_id: "crude-movements",
      product_family_label: "Crude movements",
      product_id: "crude-equivalents-pipeline-movements",
      product_label: "Crude & equivalents pipeline movements",
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

function asset(
  selectedSeries: UsaManifestSeries,
  geographyId: string,
  shipping: string,
  receiving: string,
): UsaChartAsset {
  return {
    schema_version: "1.0.0",
    series_id: selectedSeries.series_id,
    geography_id: geographyId,
    dimensions: {
      shipping_region: `${shipping}, shipping region`,
      receiving_region: `${receiving}, receiving region`,
      mode_of_transport: "Pipeline",
      source_product: "Crude oil and equivalents",
    },
    frequency: "monthly",
    unit: "cubic_metres",
    generated_at: "2026-01-01T00:00:00Z",
    source_checksum: "test",
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
      value: 1,
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
    methodology_version: "test",
    aggregation_lineage: null,
  };
}

describe("Canada movement route semantics", () => {
  it("treats to-* series as a shipping-origin choice and renders an interprovincial route", () => {
    const selectedSeries = series("to-british-columbia");
    const context = canadaMovementContext(selectedSeries)!;
    expect(context).toMatchObject({
      geographyRole: "Shipping origin",
      measureRole: "Receiving destination",
      fixedEndpoint: "British Columbia",
    });
    expect(movementRouteLabelFromSelection(context, "Alberta"))
      .toBe("Alberta → British Columbia");
    expect(movementRouteFromAsset(
      selectedSeries,
      asset(selectedSeries, "ca.ab", "Alberta", "British Columbia"),
      { geography_id: "ca.ab", label: "Alberta" },
    )).toMatchObject({
      label: "Alberta → British Columbia",
      classification: "interprovincial",
    });
  });

  it("treats from-US series as a receiving-destination choice", () => {
    const selectedSeries = series("from-united-states");
    const context = canadaMovementContext(selectedSeries)!;
    expect(context.geographyRole).toBe("Receiving destination");
    expect(movementRouteFromAsset(
      selectedSeries,
      asset(selectedSeries, "ca.on", "United States", "Ontario"),
      { geography_id: "ca.on", label: "Ontario" },
    )).toMatchObject({
      label: "United States → Ontario",
      classification: "pipeline-import",
    });
  });

  it("identifies intraprovincial routes and fails closed on mismatched endpoints", () => {
    const selectedSeries = series("to-alberta");
    expect(movementRouteFromAsset(
      selectedSeries,
      asset(selectedSeries, "ca.ab", "Alberta", "Alberta"),
      { geography_id: "ca.ab", label: "Alberta" },
    )?.classification).toBe("intraprovincial");
    expect(movementRouteFromAsset(
      selectedSeries,
      asset(selectedSeries, "ca.ab", "Saskatchewan", "Alberta"),
      { geography_id: "ca.ab", label: "Alberta" },
    )).toBeNull();
  });

  it("treats Canada-to-Canada as a source-published aggregate", () => {
    const selectedSeries = series("to-canada");
    expect(movementRouteFromAsset(
      selectedSeries,
      asset(selectedSeries, "ca", "Canada", "Canada"),
      { geography_id: "ca", label: "Canada" },
    )).toMatchObject({
      label: "Canada → Canada",
      classification: "source-published-aggregate",
    });
  });

  it("requires literal endpoint facets and the exact registered product", () => {
    const selectedSeries = series("to-alberta");
    const missingSuffix = asset(selectedSeries, "ca.sk", "Saskatchewan", "Alberta");
    missingSuffix.dimensions.shipping_region = "Saskatchewan";
    expect(movementRouteFromAsset(
      selectedSeries,
      missingSuffix,
      { geography_id: "ca.sk", label: "Saskatchewan" },
    )).toBeNull();

    const wrongProduct = asset(selectedSeries, "ca.sk", "Saskatchewan", "Alberta");
    wrongProduct.dimensions.source_product =
      "Hydrocarbon Gas Liquids (HGLs) and Refined Petroleum Products (RPPs)";
    expect(movementRouteFromAsset(
      selectedSeries,
      wrongProduct,
      { geography_id: "ca.sk", label: "Saskatchewan" },
    )).toBeNull();
  });
});

describe("Canada movement source-vintage changes", () => {
  function vintageFixture() {
    const siblings = [series("to-british-columbia"), series("to-ontario")];
    for (const [index, sibling] of siblings.entries()) {
      sibling.geographies = [["ca.ab", "Alberta"], ["ca.bc", "British Columbia"], ["ca.on", "Ontario"]]
        .map(([id, label]) => ({
          geography_id: id!, label: label!, level_id: "province_territory",
          level_label: "Province / territory", origin: "source-published",
          status: id === (index === 0 ? "ca.ab" : "ca.bc") ? "available" : "unavailable",
          ...(id === (index === 0 ? "ca.ab" : "ca.bc")
            ? { asset_path: `${sibling.series_id}/${id}.json` } : {}),
        }));
    }
    const load = (item: ReturnType<typeof canadaOriginDestinationAssetPlan>[number]) => {
      const source = asset(item.series, item.geography.geography_id, item.geography.label,
        canadaMovementContext(item.series)!.fixedEndpoint);
      source.history = [{ period: "2025-12", year: 2025, slot: 12, value: 10, status: "observed" }];
      source.latest = { ...source.latest, value: 10 };
      source.latest_source = { period: "2025-12", value: 10, status: "observed" };
      return { ...item, asset: source };
    };
    return { siblings, load, loaded: canadaOriginDestinationAssetPlan(siblings, siblings[0]!).map(load) };
  }

  it.each([
    { value: 12, status: "observed" },
    { value: null, status: "suppressed_or_withheld" },
  ])("retains staggered route months when the new source point is $status", ({ value, status }) => {
    const { siblings, loaded } = vintageFixture();
    const advanced = loaded[0]!.asset;
    advanced.history!.push({ period: "2026-01", year: 2026, slot: 1, value, status });
    advanced.latest_source = { period: "2026-01", value, status };
    if (value !== null) advanced.latest = { ...advanced.latest, period: "2026-01", value };

    const model = buildCanadaOriginDestinationModel(siblings, siblings[0]!, loaded);
    const newest = model.snapshots.find((snapshot) => snapshot.period === "2026-01")!;
    expect(model.latestPeriod).toBe("2026-01");
    expect(newest.cells.find((cell) => cell.origin.id === "ca.ab" && cell.destination.id === "ca.bc"))
      .toMatchObject({ value, status, declared: true });
    expect(newest.cells.find((cell) => cell.origin.id === "ca.bc" && cell.destination.id === "ca.on"))
      .toMatchObject({ value: null, status: "missing", declared: true });
    expect(model.snapshots.find((snapshot) => snapshot.period === "2025-12")!.numericRouteCount).toBe(2);
  });

  it("loads a newly available registered corridor without a frozen route count", () => {
    const { siblings, loaded, load } = vintageFixture();
    const newGeography = siblings[1]!.geographies.find((geography) => geography.geography_id === "ca.ab")!;
    newGeography.status = "available";
    newGeography.asset_path = `${siblings[1]!.series_id}/ca.ab.json`;
    const plan = canadaOriginDestinationAssetPlan(siblings, siblings[0]!);
    expect(plan).toHaveLength(3);
    const nextLoaded = plan.map(load);
    const model = buildCanadaOriginDestinationModel(siblings, siblings[0]!, nextLoaded);
    expect(model.routes).toHaveLength(3);
    expect(model.snapshots[0]!.cells.find((cell) => cell.origin.id === "ca.ab" && cell.destination.id === "ca.on"))
      .toMatchObject({ value: 10, status: "observed", declared: true });
    expect(() => buildCanadaOriginDestinationModel(siblings, siblings[0]!, loaded))
      .toThrow(/complete set/i);
  });

  it("still rejects incompatible product, source vintage, mode, and duplicate assets", () => {
    for (const mutate of [
      (value: UsaChartAsset) => { value.dimensions.source_product = "Unreviewed product"; },
      (value: UsaChartAsset) => { value.dimensions.mode_of_transport = "Truck"; },
      (value: UsaChartAsset) => { value.generated_at = "2026-01-02T00:00:00Z"; },
    ]) {
      const { siblings, loaded } = vintageFixture();
      mutate(loaded[0]!.asset);
      expect(() => buildCanadaOriginDestinationModel(siblings, siblings[0]!, loaded)).toThrow();
    }
    const { siblings, loaded } = vintageFixture();
    expect(() => buildCanadaOriginDestinationModel(siblings, siblings[0]!, [loaded[0]!, loaded[0]!]))
      .toThrow(/escaped.*plan/i);
  });
});

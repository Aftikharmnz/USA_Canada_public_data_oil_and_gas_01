import { describe, expect, it } from "vitest";
import type { UsaChartAsset, UsaManifestSeries } from "../types/energyAssets";
import {
  canadaMovementContext,
  movementRouteFromAsset,
  movementRouteLabelFromSelection,
} from "./canadaMovement";

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

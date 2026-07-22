import { describe, expect, it } from "vitest";
import type {
  SeriesClassification,
  UsaChartAsset,
  UsaManifestSeries,
} from "../types/energyAssets";
import {
  assetMatchesUsaSelection,
  resolveUsaDashboardSelection,
  usaGeographyLevels,
  usaSegmentSeries,
} from "./usaDashboard";

function geography(
  geographyId: string,
  label: string,
  levelId: string,
  levelLabel: string,
) {
  return {
    geography_id: geographyId,
    label,
    level_id: levelId,
    level_label: levelLabel,
    origin: "source-published" as const,
    status: "available" as const,
    asset_path: `assets/${geographyId}.json`,
  };
}

function classification(overrides: Partial<SeriesClassification>): SeriesClassification {
  return {
    dashboard_group: "refined_products",
    product_family_id: "gasoline",
    product_family_label: "Gasoline",
    product_id: "total-motor-gasoline",
    product_label: "Total motor gasoline",
    measure_id: "stocks",
    measure_label: "Stocks",
    component_role: "headline-total",
    parent_product_id: null,
    reference_term_ids: [],
    display_order: 101,
    ...overrides,
  };
}

function series(
  viewId: string,
  geographies: ReturnType<typeof geography>[],
  seriesClassification?: SeriesClassification,
): UsaManifestSeries {
  return {
    view_id: viewId,
    series_id: viewId,
    title: seriesClassification?.product_label ?? viewId,
    category: "Petroleum",
    unit: "thousand_barrels",
    frequency: "weekly",
    source: { name: "EIA" },
    freshness: { status: "fresh" },
    classification: seriesClassification,
    geographies,
    unsupported_levels: [],
  };
}

const state = geography("us.tx", "Texas", "state_or_area", "State or area");
const subdistrict = geography("us.padd.1a", "New England", "padd_subdistrict", "PADD subdistrict");
const padd = geography("us.padd.1", "East Coast (PADD 1)", "padd", "PADD");
const national = geography("us", "United States", "national", "United States");

const fixture = [
  series("usa.eia.crude.production.monthly", [state, padd, national]),
  series("usa.eia.refinery.utilization.weekly", [padd, national]),
  series("commercial-crude-stocks", [padd, national], classification({
    dashboard_group: "usa_crude",
    product_family_id: "crude-oil",
    product_family_label: "Crude oil",
    product_id: "commercial-crude-stocks",
    product_label: "Commercial crude stocks",
    measure_id: "stocks",
    measure_label: "Stocks",
    component_role: "source-defined-product",
    display_order: 301,
  })),
  series("usa.eia.product_supplied.weekly", [national]),
  series("total-gasoline-stocks", [subdistrict, padd, national], classification({})),
  series("finished-gasoline-stocks", [padd, national], classification({
    product_id: "finished-motor-gasoline",
    product_label: "Finished motor gasoline",
    component_role: "finished-product",
    parent_product_id: "total-motor-gasoline",
    display_order: 201,
  })),
  series("cbob-stocks", [subdistrict, padd, national], classification({
    product_id: "cbob",
    product_label: "CBOB",
    component_role: "blendstock",
    parent_product_id: "motor-gasoline-blending-components",
    display_order: 601,
  })),
  series("cbob-imports", [padd, national], classification({
    product_id: "cbob",
    product_label: "CBOB",
    measure_id: "imports",
    measure_label: "Imports",
    component_role: "blendstock",
    parent_product_id: "motor-gasoline-blending-components",
    display_order: 604,
  })),
  series("fuel-ethanol-stocks", [padd, national], classification({
    product_id: "fuel-ethanol",
    product_label: "Fuel ethanol",
    component_role: "biofuel",
    parent_product_id: null,
    display_order: 801,
  })),
];

describe("USA country-dashboard hierarchy", () => {
  it("divides every active core and classified series into crude or refined", () => {
    expect(usaSegmentSeries(fixture, "crude").map((item) => item.view_id)).toEqual([
      "usa.eia.crude.production.monthly",
      "usa.eia.refinery.utilization.weekly",
      "commercial-crude-stocks",
    ]);
    expect(usaSegmentSeries(fixture, "refined")).toHaveLength(6);
  });

  it("orders segment geography from the finest official level to national", () => {
    expect(usaGeographyLevels(fixture, "crude").map((level) => level.id)).toEqual([
      "state_or_area",
      "padd",
      "national",
    ]);
    expect(usaGeographyLevels(fixture, "refined").map((level) => level.id)).toEqual([
      "padd_subdistrict",
      "padd",
      "national",
    ]);
  });

  it("defaults to the finest geography before resolving product and measure", () => {
    const selection = resolveUsaDashboardSelection(fixture, { segment: "crude" });
    expect(selection.geographyId).toBe("us.tx");
    expect(selection.familyId).toBe("crude-oil");
    expect(selection.productId).toBe("crude-oil");
    expect(selection.measureId).toBe("production");
    expect(selection.series?.view_id).toBe("usa.eia.crude.production.monthly");
  });

  it("filters products and measures to the chosen geography", () => {
    const subdistrictSelection = resolveUsaDashboardSelection(fixture, {
      segment: "refined",
      geographyId: "us.padd.1a",
      familyId: "gasoline",
      productId: "cbob",
      measureId: "imports",
    });
    expect(subdistrictSelection.products.map((item) => item.id)).toEqual([
      "cbob",
      "total-motor-gasoline",
    ]);
    expect(subdistrictSelection.measures.map((item) => item.id)).toEqual(["stocks"]);
    expect(subdistrictSelection.measureId).toBe("stocks");

    const paddSelection = resolveUsaDashboardSelection(fixture, {
      segment: "refined",
      geographyId: "us.padd.1",
      familyId: "gasoline",
      productId: "cbob",
    });
    expect(paddSelection.measures.map((item) => item.id)).toEqual(["stocks", "imports"]);
  });

  it("places component products before broader parent totals", () => {
    const selection = resolveUsaDashboardSelection(fixture, {
      segment: "refined",
      geographyId: "us",
      familyId: "gasoline",
    });
    expect(selection.products.map((item) => item.id)).toEqual([
      "cbob",
      "fuel-ethanol",
      "finished-motor-gasoline",
      "total-motor-gasoline",
    ]);
    expect(selection.products.map((item) => item.hierarchyHeight)).toEqual([0, 0, 0, 1]);
  });

  it("maps classified USA crude views while retaining core-series fallbacks", () => {
    const classifiedCrude = fixture.find((item) => item.view_id === "commercial-crude-stocks");
    expect(classifiedCrude).toBeDefined();
    expect(usaSegmentSeries([classifiedCrude!], "crude")).toEqual([classifiedCrude]);
    expect(usaSegmentSeries([classifiedCrude!], "refined")).toEqual([]);

    const unclassifiedCore = series("usa.eia.refinery.utilization.weekly", [national]);
    expect(usaSegmentSeries([unclassifiedCore], "crude")).toEqual([unclassifiedCore]);
  });

  it("rejects stale chart data from a previous cascade selection", () => {
    const selected = fixture[0];
    expect(assetMatchesUsaSelection(
      { series_id: selected!.series_id, geography_id: "us.tx" } as UsaChartAsset,
      selected,
      "us.tx",
    )).toBe(true);
    expect(assetMatchesUsaSelection(
      { series_id: "another-series", geography_id: "us.tx" } as UsaChartAsset,
      selected,
      "us.tx",
    )).toBe(false);
  });
});

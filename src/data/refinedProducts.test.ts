import { describe, expect, it } from "vitest";
import type { SeriesClassification, UsaChartAsset, UsaManifestSeries } from "../types/energyAssets";
import {
  assetMatchesRefinedSelection,
  productOverlapMessage,
  refinedMeasuresForProduct,
  refinedProductFamilies,
  refinedProductSeries,
  resolveRefinedProductSelection,
} from "./refinedProducts";

function series(
  seriesId: string,
  classification?: SeriesClassification,
  hasAsset = true,
): UsaManifestSeries {
  return {
    view_id: seriesId,
    series_id: seriesId,
    title: classification?.product_label ?? "Core series",
    category: "Petroleum products",
    unit: "thousand_barrels",
    frequency: "weekly",
    source: { name: "EIA" },
    freshness: { status: "fresh" },
    classification,
    geographies: [{
      geography_id: "us",
      label: "United States",
      level_id: "national",
      level_label: "United States",
      origin: "source-published",
      status: hasAsset ? "available" : "unavailable",
      asset_path: hasAsset ? `assets/${seriesId}.json` : undefined,
    }],
    unsupported_levels: [],
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
    component_role: "parent_total",
    parent_product_id: null,
    reference_term_ids: ["total-motor-gasoline", "petroleum-stocks"],
    display_order: 20,
    ...overrides,
  };
}

const fixture = [
  series("core", undefined),
  series("gasoline-stocks", classification({ display_order: 20 })),
  series("gasoline-production", classification({
    measure_id: "production",
    measure_label: "Refinery production",
    reference_term_ids: ["total-motor-gasoline", "refinery-production"],
    display_order: 21,
  })),
  series("finished-gasoline-stocks", classification({
    product_id: "finished-motor-gasoline",
    product_label: "Finished motor gasoline",
    component_role: "component",
    parent_product_id: "total-motor-gasoline",
    reference_term_ids: ["finished-motor-gasoline", "petroleum-stocks"],
    display_order: 30,
  })),
  series("distillate-stocks", classification({
    product_family_id: "distillate",
    product_family_label: "Distillate & diesel",
    product_id: "distillate-fuel-oil",
    product_label: "Distillate fuel oil",
    reference_term_ids: ["distillate-fuel-oil", "petroleum-stocks"],
    display_order: 10,
  })),
  series("unavailable", classification({ product_id: "unavailable" }), false),
];

describe("refined-products manifest model", () => {
  it("filters to classified series with assets and sorts by display order", () => {
    expect(refinedProductSeries(fixture).map((item) => item.series_id)).toEqual([
      "distillate-stocks",
      "gasoline-stocks",
      "gasoline-production",
      "finished-gasoline-stocks",
    ]);
    expect(refinedProductFamilies(fixture).map((item) => item.id)).toEqual([
      "distillate",
      "gasoline",
    ]);
  });

  it("offers only measures that exist for the selected product", () => {
    expect(refinedMeasuresForProduct(fixture, "gasoline", "total-motor-gasoline").map((item) => item.id)).toEqual([
      "stocks",
      "production",
    ]);
    expect(refinedMeasuresForProduct(fixture, "gasoline", "finished-motor-gasoline").map((item) => item.id)).toEqual([
      "stocks",
    ]);
  });

  it("resets invalid downstream product and measure selections", () => {
    const resolved = resolveRefinedProductSelection(fixture, {
      familyId: "distillate",
      productId: "finished-motor-gasoline",
      measureId: "production",
    });
    expect(resolved.productId).toBe("distillate-fuel-oil");
    expect(resolved.measureId).toBe("stocks");
    expect(resolved.series?.series_id).toBe("distillate-stocks");
  });

  it("labels parent-child overlap and never presents it as additive", () => {
    const selected = fixture.find((item) => item.series_id === "finished-gasoline-stocks")!;
    expect(productOverlapMessage(selected, fixture)).toMatch(/component of Total motor gasoline/i);
    expect(productOverlapMessage(selected, fixture)).toMatch(/must not be added/i);
  });

  it("does not match a stale asset from another series or geography", () => {
    const selected = fixture.find((item) => item.series_id === "gasoline-stocks")!;
    expect(assetMatchesRefinedSelection(
      { series_id: "gasoline-production", geography_id: "us" } as UsaChartAsset,
      selected,
      "us",
    )).toBe(false);
    expect(assetMatchesRefinedSelection(
      { series_id: "gasoline-stocks", geography_id: "us.padd.1" } as UsaChartAsset,
      selected,
      "us",
    )).toBe(false);
    expect(assetMatchesRefinedSelection(
      { series_id: "gasoline-stocks", geography_id: "us" } as UsaChartAsset,
      selected,
      "us",
    )).toBe(true);
  });
});

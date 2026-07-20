import { describe, expect, it } from "vitest";
import canadaManifestFixture from "../../public/data/canada/manifest.json";
import type {
  CanadaAssetManifest,
  CanadaManifestSeries,
  SeriesClassification,
} from "../types/energyAssets";
import {
  availableCanadaSeries,
  canadaDatasetFacet,
  canadaDatasetOptions,
  canadaGeographyLevelOptions,
  canadaMarketSegmentFacet,
  canadaSegmentOptions,
  resolveCanadaDashboardSelection,
} from "./canadaDashboard";
import { customAggregationPolicy } from "./customAggregation";

function series(
  viewId: string,
  sourceName: string,
  category: string,
  dashboardGroup?: string,
): CanadaManifestSeries {
  return {
    view_id: viewId,
    series_id: viewId,
    title: viewId,
    category,
    unit: "cubic_metres",
    frequency: "monthly",
    source: { name: sourceName },
    freshness: { status: "fresh" },
    classification: dashboardGroup ? {
      dashboard_group: dashboardGroup,
      product_family_id: "petroleum",
      product_family_label: "Petroleum",
      product_id: "petroleum",
      product_label: "Petroleum",
      measure_id: viewId,
      measure_label: viewId,
      component_role: "headline",
      parent_product_id: null,
      reference_term_ids: [],
      display_order: 1,
    } : undefined,
    geographies: [{
      geography_id: "ca",
      label: "Canada",
      level_id: "national",
      level_label: "Country",
      origin: "source-published",
      status: "available",
      asset_path: `${viewId}.json`,
    }],
    unsupported_levels: [],
  };
}

describe("Canada dataset grouping", () => {
  it("groups classified series by dashboard group instead of market category", () => {
    const options = canadaDatasetOptions([
      series("gasoline-supply", "Statistics Canada", "Supply", "canada_refined_products"),
      series("gasoline-trade", "Statistics Canada", "Trade", "canada_refined_products"),
      series("crude-inventory", "Statistics Canada", "Inventory", "canada_crude"),
      series("cer-runs", "Canada Energy Regulator", "Refining", "canada_refining"),
      series("unclassified", "Statistics Canada", "Legacy inventory"),
    ]);

    expect(options.map((option) => option.label)).toEqual([
      "Refined product balances · Statistics Canada",
      "Crude oil balances · Statistics Canada",
      "Refinery activity · Statistics Canada & CER",
      "Legacy inventory · Statistics Canada",
    ]);
  });

  it("humanizes unknown classified groups with their source", () => {
    const unknown = series(
      "special",
      "Statistics Canada",
      "Supply",
      "canada_special_balances",
    );
    expect(canadaDatasetFacet(unknown).label).toBe(
      "Canada Special Balances · Statistics Canada",
    );
  });
});

function classifiedSeries(
  viewId: string,
  group: string,
  productId: string,
  productLabel: string,
  parentProductId: string | null,
  displayOrder: number,
): CanadaManifestSeries {
  const base = series(viewId, "Statistics Canada", "Balance", group);
  return {
    ...base,
    classification: {
      ...base.classification!,
      product_family_id: "test-family",
      product_family_label: "Test family",
      product_id: productId,
      product_label: productLabel,
      parent_product_id: parentProductId,
      display_order: displayOrder,
    } satisfies SeriesClassification,
    geographies: [{
      geography_id: "ca.ab",
      label: "Alberta",
      level_id: "province_territory",
      level_label: "Province / territory",
      origin: "source-published",
      status: "available",
      asset_path: `${viewId}.json`,
    }],
  };
}

describe("Canada country-dashboard hierarchy", () => {
  const promoted = canadaManifestFixture as unknown as CanadaAssetManifest;
  const promotedSeries = availableCanadaSeries(promoted);

  it("maps the promoted manifest to exactly 22 crude and 29 refined series", () => {
    expect(canadaSegmentOptions(promotedSeries).map((option) => ({
      id: option.id,
      count: option.seriesCount,
    }))).toEqual([
      { id: "crude", count: 22 },
      { id: "refined", count: 29 },
    ]);
  });

  it("exposes source-published crude grades and bitumen leaves before their parents", () => {
    const selection = resolveCanadaDashboardSelection(promotedSeries, {
      segmentId: "crude",
      geographyLevelId: "province_territory",
      geographyId: "ca.ab",
      familyId: "family:crude-oil",
    });
    const productIds = selection.products.map((product) => product.productId);
    expect(productIds).toContain("light-medium-crude-oil");
    expect(productIds).toContain("heavy-crude-oil");
    expect(productIds).toContain("synthetic-crude-oil");
    expect(productIds).toContain("non-upgraded-crude-bitumen");
    expect(productIds).toContain("in-situ-crude-bitumen");
    expect(productIds).toContain("mined-crude-bitumen");
    expect(productIds.indexOf("in-situ-crude-bitumen"))
      .toBeLessThan(productIds.indexOf("non-upgraded-crude-bitumen"));
    expect(productIds.indexOf("net-field-crude-oil"))
      .toBeLessThan(productIds.indexOf("crude-oil"));
  });

  it("authorizes regional sums only for additive crude-detail coordinates", () => {
    for (const seriesId of [
      "can.statcan.crude.production.net_field.monthly",
      "can.statcan.crude.production.light_medium.monthly",
      "can.statcan.crude.production.heavy.monthly",
      "can.statcan.crude.equivalent.production.monthly",
      "can.statcan.crude.refinery_inputs.synthetic.monthly",
    ]) {
      expect(customAggregationPolicy("canada", seriesId, "province_territory"), seriesId)
        .toBeDefined();
    }
    for (const seriesId of [
      "can.statcan.crude.production.synthetic.monthly",
      "can.statcan.crude.production.non_upgraded_bitumen.monthly",
      "can.statcan.crude.production.bitumen_sent_for_processing.monthly",
    ]) {
      expect(customAggregationPolicy("canada", seriesId, "province_territory"), seriesId)
        .toBeUndefined();
    }
  });

  it("places refinery activity under Crude as an explicit navigation assumption", () => {
    const refinery = series(
      "can.cer.refinery.runs.weekly",
      "Canada Energy Regulator",
      "Refinery activity",
      "canada_refining",
    );
    expect(canadaMarketSegmentFacet(refinery).id).toBe("crude");
  });

  it("orders exact Canada geography levels from province to source region to national", () => {
    expect(canadaGeographyLevelOptions(promotedSeries, "crude").map((level) => level.id)).toEqual([
      "province_territory",
      "source_region",
      "national",
    ]);
    expect(canadaGeographyLevelOptions(promotedSeries, "refined").map((level) => level.id)).toEqual([
      "province_territory",
      "national",
    ]);
  });

  it("keeps the Statistics Canada province and CER confidentiality region named Ontario distinct", () => {
    const levels = canadaGeographyLevelOptions(promotedSeries, "crude");
    const province = levels.find((level) => level.id === "province_territory")
      ?.geographies.find((geography) => geography.label === "Ontario");
    const cerRegion = levels.find((level) => level.id === "source_region")
      ?.geographies.find((geography) => geography.label === "Ontario");

    expect(province?.geographyId).toBe("ca.on");
    expect(province?.sourceNames).toEqual(["Statistics Canada"]);
    expect(cerRegion?.geographyId).toBe("ca.cer.ontario");
    expect(cerRegion?.sourceNames).toEqual(["Canada Energy Regulator"]);
  });

  it("defaults to the finest geography and then the first compatible family and product", () => {
    const selection = resolveCanadaDashboardSelection(promotedSeries, { segmentId: "refined" });
    expect(selection.geographyLevelId).toBe("province_territory");
    expect(selection.geographyId).toBe("ca.ab");
    expect(selection.families[0]?.label).toBe("Gasoline");
    expect(selection.products[0]?.productId).toBe("finished-motor-gasoline");
    expect(selection.series?.geographies.some(
      (geography) => geography.geography_id === selection.geographyId,
    )).toBe(true);
  });

  it("does not offer CER utilization at Canada because national utilization is unsupported", () => {
    const selection = resolveCanadaDashboardSelection(promotedSeries, {
      segmentId: "crude",
      geographyLevelId: "national",
      geographyId: "ca",
      familyId: "family:refining",
    });
    expect(selection.families.find((family) => family.id === selection.familyId)?.label)
      .toBe("Refining");
    expect(selection.products.map((product) => product.productId)).toEqual([
      "refinery-crude-runs",
    ]);
    expect(selection.seriesOptions.some(
      (candidate) => candidate.series_id.includes("utilization"),
    )).toBe(false);
  });

  it("orders registered product leaves before parents without inventing an unregistered parent", () => {
    const hierarchy = [
      classifiedSeries("parent", "canada_refined_products", "parent", "Parent", null, 1),
      classifiedSeries("child", "canada_refined_products", "child", "Child", "parent", 50),
      classifiedSeries("orphan", "canada_refined_products", "orphan", "Orphan", "not-active", 60),
    ];
    const selection = resolveCanadaDashboardSelection(hierarchy, { segmentId: "refined" });
    expect(selection.products.map((product) => product.productId)).toEqual([
      "child",
      "orphan",
      "parent",
    ]);
    expect(selection.products.some((product) => product.productId === "not-active")).toBe(false);
  });
});

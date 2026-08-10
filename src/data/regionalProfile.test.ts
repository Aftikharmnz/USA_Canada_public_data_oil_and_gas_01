import { describe, expect, it } from "vitest";
import canadaManifestFixture from "../../public/data/canada/manifest.json";
import usaManifestFixture from "../../public/data/usa/manifest.json";
import type { UsaAssetManifest, UsaManifestSeries } from "../types/energyAssets";
import {
  regionalProfileGeographies,
  regionalProfileMeasuresForFrequency,
  resolveRegionalProfile,
} from "./regionalProfile";
import { usaSeriesDescriptor } from "./usaDashboard";

const usaManifest = usaManifestFixture as unknown as UsaAssetManifest;
const canadaManifest = canadaManifestFixture as unknown as UsaAssetManifest;

const MONTHLY_CRUDE_BALANCE = [
  ["usa.eia.crude.ending_stocks.monthly", "ending-stocks", "Ending stocks", "thousand_barrels"],
  ["usa.eia.crude.stock_change.monthly", "stock-change", "Stock change", "thousand_barrels_per_day"],
  ["usa.eia.crude.imports.monthly", "imports", "Imports", "thousand_barrels_per_day"],
  ["usa.eia.crude.exports.monthly", "exports", "Exports", "thousand_barrels_per_day"],
  ["usa.eia.crude.refinery_inputs.monthly", "refinery-net-inputs", "Refinery and blender net input", "thousand_barrels_per_day"],
  ["usa.eia.crude.product_supplied.monthly", "product-supplied", "Product supplied (implied demand)", "thousand_barrels_per_day"],
  ["usa.eia.crude.supply_adjustment.monthly", "supply-adjustment", "Supply adjustment", "thousand_barrels_per_day"],
  ["usa.eia.crude.net_receipts.monthly", "net-receipts", "Net receipts from other PADDs", "thousand_barrels_per_day"],
  ["usa.eia.crude.transfers_to_supply.monthly", "transfers-to-supply", "Transfers to crude supply", "thousand_barrels_per_day"],
] as const;

function usaManifestWithMonthlyCrudeBalance(): UsaAssetManifest {
  const monthlyTemplate = usaManifest.series.find((series) => (
    series.series_id === "usa.eia.crude.production.monthly"
  ))!;
  const paddTemplate = usaManifest.series.find((series) => (
    series.series_id === "usa.eia.crude.refinery_inputs.weekly"
  ))!;
  const cohortIds = new Set<string>(MONTHLY_CRUDE_BALANCE.map(([seriesId]) => seriesId));
  const cohort: UsaManifestSeries[] = MONTHLY_CRUDE_BALANCE.map(([
    seriesId, measureId, measureLabel, unit,
  ], index) => ({
    ...monthlyTemplate,
    view_id: seriesId,
    series_id: seriesId,
    metric_id: measureId,
    title: measureLabel,
    category: "Crude",
    unit,
    frequency: "monthly",
    classification: {
      dashboard_group: "usa_crude",
      product_family_id: "crude-oil",
      product_family_label: "Crude oil",
      product_id: "crude-oil",
      product_label: "Crude oil",
      measure_id: measureId,
      measure_label: measureLabel,
      component_role: "balance-term",
      parent_product_id: null,
      reference_term_ids: [],
      display_order: 110 + index * 10,
    },
    geographies: paddTemplate.geographies.filter((geography) => (
      geography.level_id === "padd"
      || (seriesId !== "usa.eia.crude.net_receipts.monthly" && geography.geography_id === "us")
    )),
  }));
  return {
    ...usaManifest,
    series: [
      ...usaManifest.series.filter((series) => !cohortIds.has(series.series_id)),
      ...cohort,
    ],
  };
}

describe("regional profile manifest model", () => {
  it("resolves all three unclassified USA core definitions through one descriptor", () => {
    expect(usaSeriesDescriptor(
      usaManifest.series.find((series) => (
        series.series_id === "usa.eia.crude.production.monthly"
      ))!,
    )).toMatchObject({ productId: "crude-oil", measureId: "production" });
    expect(usaSeriesDescriptor(
      usaManifest.series.find((series) => (
        series.series_id === "usa.eia.refinery.utilization.weekly"
      ))!,
    )).toMatchObject({ familyId: "refinery-activity", measureId: "utilization" });
    expect(usaSeriesDescriptor(
      usaManifest.series.find((series) => (
        series.series_id === "usa.eia.product_supplied.weekly"
      ))!,
    )).toMatchObject({ productId: "total-petroleum-products", measureId: "product-supplied" });
  });

  it("enumerates exact geographies but never exposes relational PADD routes as regions", () => {
    const geographies = regionalProfileGeographies(usaManifest);
    expect(geographies.some((geography) => geography.levelId === "padd_route")).toBe(false);
    expect(geographies.some((geography) => geography.geographyId.includes(".route."))).toBe(false);
    expect(geographies.some((geography) => geography.geographyId === "us.padd.2")).toBe(true);
    expect(geographies.some((geography) => geography.geographyId === "us.ok.cushing")).toBe(true);
  });

  it("returns a complete exact-product PADD profile and keeps refinery context separate", () => {
    const profile = resolveRegionalProfile("usa", usaManifest, {
      geographyId: "us.padd.2",
      productId: "finished-motor-gasoline",
    });

    expect(profile.product?.label).toBe("Finished motor gasoline");
    expect(profile.productMeasures.map((measure) => [
      measure.measureId,
      measure.availability,
    ])).toEqual([
      ["stocks", "available"],
      ["production", "available"],
      ["product-supplied", "unavailable"],
      ["imports", "available"],
    ]);
    expect(profile.productMeasures.find(
      (measure) => measure.measureId === "product-supplied",
    )?.reason).toContain("U.S. level only, not by PADD");
    expect(profile.nativeFrequencies).toEqual(["weekly"]);
    expect(profile.refineryContext.map((measure) => [
      measure.series.series_id,
      measure.availability,
    ])).toEqual([
      ["usa.eia.refinery.utilization.weekly", "available"],
      ["usa.eia.crude.refinery_inputs.weekly", "available"],
    ]);
  });

  it("does not offer a product unless at least one exact series is available at the region", () => {
    const cushing = resolveRegionalProfile("usa", usaManifest, {
      geographyId: "us.ok.cushing",
    });
    expect(cushing.products.map((product) => product.productId)).toEqual([
      "commercial-crude-oil",
    ]);
    expect(cushing.productMeasures.map((measure) => [
      measure.measureId,
      measure.availability,
    ])).toEqual([
      ["stocks", "available"],
      ["imports", "unavailable"],
      ["days-of-supply", "unavailable"],
    ]);
    expect(cushing.refineryContext.every(
      (measure) => measure.availability === "unavailable",
    )).toBe(true);
  });

  it("keeps provincial product measures exact and reports national-only demand honestly", () => {
    const alberta = resolveRegionalProfile("canada", canadaManifest, {
      geographyId: "ca.ab",
      productId: "finished-motor-gasoline",
    });

    expect(alberta.productMeasures.map((measure) => [
      measure.measureId,
      measure.availability,
    ])).toEqual([
      ["net-production", "available"],
      ["imports", "available"],
      ["stock-change", "available"],
      ["exports", "available"],
      ["product-supplied", "unavailable"],
      ["ending-stocks", "available"],
    ]);
    expect(alberta.productMeasures.find(
      (measure) => measure.measureId === "product-supplied",
    )?.reason).toContain("does not publish this product/measure coordinate by province");
    expect(alberta.refineryContext).toHaveLength(2);
    expect(alberta.refineryContext.every(
      (measure) => measure.availability === "unavailable",
    )).toBe(true);
    expect(alberta.refineryContext[0]?.reason).toContain(
      "cannot be allocated to individual provinces",
    );
  });

  it("keeps CER confidentiality regions distinct from the similarly named province", () => {
    const geographies = regionalProfileGeographies(canadaManifest);
    const ontarios = geographies.filter((geography) => geography.label === "Ontario");
    expect(ontarios.map((geography) => [
      geography.geographyId,
      geography.levelId,
    ])).toEqual([
      ["ca.on", "province_territory"],
      ["ca.cer.ontario", "source_region"],
    ]);

    const western = resolveRegionalProfile("canada", canadaManifest, {
      geographyId: "ca.cer.western",
    });
    expect(western.products).toEqual([]);
    expect(western.refineryContext.map((measure) => [
      measure.measureId,
      measure.availability,
    ])).toEqual([
      ["crude-runs", "available"],
      ["percent-of-capacity", "available"],
    ]);
  });

  it("never attaches broad movement buckets to an unrelated selected product", () => {
    const alberta = resolveRegionalProfile("canada", canadaManifest, {
      geographyId: "ca.ab",
      productId: "distillate-fuel-oil",
    });
    expect(alberta.productMeasures.every(
      (measure) => !measure.series.series_id.includes("pipeline_movements"),
    )).toBe(true);
    expect(alberta.products.some(
      (product) => product.productId === "hgl-rpp-pipeline-movements",
    )).toBe(true);
  });

  it("prefers an official monthly measure over its weekly-derived monthly counterpart", () => {
    const profile = resolveRegionalProfile("usa", usaManifest, {
      geographyId: "us",
      productId: "crude-oil",
    });
    const weeklyProduction = profile.productMeasures.find((measure) => (
      measure.measureId === "production"
      && measure.series.frequency === "weekly"
      && measure.availability === "available"
    ));
    const nativeMonthlyProduction = profile.productMeasures.find((measure) => (
      measure.measureId === "production"
      && measure.series.frequency === "monthly"
      && measure.availability === "available"
    ));
    expect(weeklyProduction).toBeDefined();
    expect(nativeMonthlyProduction).toBeDefined();

    const monthly = regionalProfileMeasuresForFrequency(
      profile.productMeasures,
      "monthly",
    );
    expect(monthly).toContain(nativeMonthlyProduction);
    expect(monthly).not.toContain(weeklyProduction);

    const weekly = regionalProfileMeasuresForFrequency(
      profile.productMeasures,
      "weekly",
    );
    expect(weekly).toContain(weeklyProduction);
    expect(weekly).not.toContain(nativeMonthlyProduction);
  });

  it("binds all nine native monthly crude-balance measures to the exact PADD profile", () => {
    const manifest = usaManifestWithMonthlyCrudeBalance();
    const profile = resolveRegionalProfile("usa", manifest, {
      geographyId: "us.padd.2",
      productId: "crude-oil",
    });
    const cohortIds = new Set<string>(MONTHLY_CRUDE_BALANCE.map(([seriesId]) => seriesId));
    const cohort = profile.productMeasures.filter((measure) => (
      cohortIds.has(measure.series.series_id)
    ));

    expect(cohort).toHaveLength(9);
    expect(cohort.every((measure) => (
      measure.availability === "available"
      && measure.frequency === "monthly"
      && measure.geography?.geography_id === "us.padd.2"
      && measure.productId === "crude-oil"
    ))).toBe(true);

    const monthly = regionalProfileMeasuresForFrequency(profile.productMeasures, "monthly");
    expect(monthly.filter((measure) => cohortIds.has(
      measure.series.series_id,
    ))).toHaveLength(9);
    expect(monthly.some((measure) => (
      measure.measureId === "exports" && measure.series.frequency === "weekly"
    ))).toBe(false);

    const weekly = regionalProfileMeasuresForFrequency(profile.productMeasures, "weekly");
    expect(weekly.some((measure) => cohortIds.has(
      measure.series.series_id,
    ))).toBe(false);
    expect(profile.productMeasures.some((measure) => (
      measure.series.series_id === "usa.eia.crude.commercial_imports.weekly"
    ))).toBe(false);
  });
});

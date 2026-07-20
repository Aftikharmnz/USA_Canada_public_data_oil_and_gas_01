import { describe, expect, it } from "vitest";
import { compactUnit } from "../lib/formatters";
import {
  canadaDatasetFacet,
  canadaDatasetOptions,
  canadaMeasureFacet,
  canadaMeasureOptions,
  canadaProductFacet,
  canadaProductOptions,
  canadaReferenceEntries,
  canadaSeriesForSelection,
  availableCanadaSeries,
} from "./canadaDashboard";
import {
  parseCanadaChartAsset,
  parseCanadaManifest,
  resolveCanadaAssetUrl,
} from "./canadaAssets";

function classification(
  group: string,
  productId: string,
  productLabel: string,
  measureId: string,
  measureLabel: string,
  displayOrder: number,
) {
  return {
    dashboard_group: group,
    product_family_id: "petroleum",
    product_family_label: "Petroleum",
    product_id: productId,
    product_label: productLabel,
    measure_id: measureId,
    measure_label: measureLabel,
    component_role: "standalone",
    parent_product_id: null,
    reference_term_ids: [],
    display_order: displayOrder,
  };
}

function geography(
  geographyId: string,
  label: string,
  levelId: string,
  levelLabel: string,
  assetPath: string,
) {
  return {
    geography_id: geographyId,
    label,
    level_id: levelId,
    level_label: levelLabel,
    origin: "source-published",
    status: "available",
    asset_path: assetPath,
  };
}

const manifestFixture = {
  schema_version: "1.0.0",
  generated_at: "2026-07-19T20:00:00Z",
  last_success_at: "2026-07-19T20:00:00Z",
  status: "fresh",
  series: [
    {
      view_id: "can.statcan.products.gasoline.sales.monthly",
      series_id: "can.statcan.products.gasoline.sales.monthly",
      metric_id: "petroleum_products_supply_disposition",
      title: "Motor gasoline sales",
      category: "Petroleum product balances",
      unit: "cubic_metres",
      frequency: "monthly",
      source: { name: "Statistics Canada", url: "https://www.statcan.gc.ca/" },
      freshness: { status: "fresh", latest_period: "2026-05" },
      classification: {
        ...classification(
          "canada_refined_products",
          "motor-gasoline",
          "Motor gasoline",
          "sales",
          "Sales",
          10,
        ),
        reference_term_ids: [
          "total-motor-gasoline",
          "statcan-products-supplied",
          "unknown-term-is-ignored",
        ],
      },
      geographies: [
        geography(
          "ca.ab",
          "Alberta",
          "province_territory",
          "Province or territory",
          "assets/can.statcan.products.gasoline.sales.monthly/ca.ab/default.json",
        ),
        geography(
          "ca",
          "Canada",
          "national",
          "Country",
          "assets/can.statcan.products.gasoline.sales.monthly/ca/default.json",
        ),
      ],
      unsupported_levels: [
        { level_id: "city", label: "City", reason: "Statistics Canada does not publish city rows." },
      ],
    },
    {
      view_id: "can.statcan.products.diesel.production.monthly",
      series_id: "can.statcan.products.diesel.production.monthly",
      metric_id: "petroleum_products_supply_disposition",
      title: "Diesel production",
      category: "Petroleum product balances",
      unit: "cubic_metres",
      frequency: "monthly",
      source: { name: "Statistics Canada" },
      freshness: { status: "fresh", latest_period: "2026-05" },
      classification: classification(
        "canada_refined_products",
        "diesel-fuel-oil",
        "Diesel fuel oil",
        "production",
        "Production",
        20,
      ),
      geographies: [
        geography(
          "ca.on",
          "Ontario",
          "province_territory",
          "Province or territory",
          "assets/can.statcan.products.diesel.production.monthly/ca.on/default.json",
        ),
      ],
      unsupported_levels: [],
    },
    {
      view_id: "can.cer.refinery.runs.weekly",
      series_id: "can.cer.refinery.runs.weekly",
      metric_id: "refinery_crude_runs",
      title: "Refinery crude runs",
      category: "Refinery activity",
      unit: "thousand_cubic_metres_per_day",
      frequency: "weekly",
      source: { name: "Canada Energy Regulator" },
      freshness: { status: "due", latest_period: "2026-07-14" },
      classification: classification(
        "canada_refining",
        "crude-oil",
        "Crude oil",
        "refinery-runs",
        "Refinery runs",
        5,
      ),
      geographies: [
        geography(
          "ca.cer.western",
          "Western Canada",
          "source_region",
          "CER confidentiality region",
          "assets/can.cer.refinery.runs.weekly/ca.cer.western/default.json",
        ),
      ],
      unsupported_levels: [],
    },
    {
      view_id: "can.statcan.unclassified.monthly",
      series_id: "can.statcan.unclassified.monthly",
      metric_id: "other_monthly_measure",
      title: "Unclassified published series",
      category: "Other monthly data",
      unit: "cubic_metres",
      frequency: "monthly",
      source: { name: "Statistics Canada" },
      freshness: { status: "unknown" },
      geographies: [
        geography(
          "ca",
          "Canada",
          "national",
          "Country",
          "assets/can.statcan.unclassified.monthly/ca/default.json",
        ),
      ],
      unsupported_levels: [],
    },
  ],
};

const emptyDistribution = {
  count: 0,
  mean: null,
  median: null,
  stddev: null,
  min: null,
  q1: null,
  q3: null,
  max: null,
  iqr: null,
  skewness: null,
  excess_kurtosis: null,
  histogram: [],
  fit: null,
};

describe("Canada public asset contract", () => {
  it("parses monthly provincial and weekly source-region series without filtering group names", () => {
    const manifest = parseCanadaManifest(manifestFixture);
    expect(manifest.series).toHaveLength(4);
    expect(manifest.series[0]?.geographies.map((item) => item.level_id)).toEqual([
      "province_territory",
      "national",
    ]);
    expect(manifest.series[1]?.classification?.dashboard_group).toBe("canada_refined_products");
    expect(manifest.series[2]?.frequency).toBe("weekly");
  });

  it("uses Canada-relative local asset paths and blocks remote paths", () => {
    expect(resolveCanadaAssetUrl("assets/series/ca.ab/data.json")).toBe(
      "/data/canada/assets/series/ca.ab/data.json",
    );
    expect(() => resolveCanadaAssetUrl("https://example.com/data.json")).toThrow(
      /local public files/,
    );
  });

  it("parses the shared chart asset schema for a Canadian unit", () => {
    const asset = parseCanadaChartAsset({
      schema_version: "1.0.0",
      series_id: "can.cer.refinery.runs.weekly",
      geography_id: "ca.cer.western",
      frequency: "weekly",
      unit: "thousand_cubic_metres_per_day",
      generated_at: "2026-07-19T20:00:00Z",
      source_checksum: "abcdef0123456789",
      freshness: {
        status: "unknown",
        latest_period: "2026-07-21",
        latest_numeric_period: "2026-07-14",
        latest_observation_status: "suppressed_or_withheld",
        checked_at: "2026-07-22T01:30:00Z",
      },
      recent_years: [
        { year: 2026, points: [{ period: "2026-07-14", slot: 29, value: 75.2, status: "observed" }] },
      ],
      baseline: {
        status: "insufficient_history",
        baseline_start_year: null,
        baseline_end_year: null,
        eligible_years: [],
        excluded_years: [],
        slots: [],
      },
      latest: {
        period: "2026-07-14",
        value: 75.2,
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
      latest_source: {
        period: "2026-07-21",
        value: null,
        status: "suppressed_or_withheld",
      },
      distribution: { levels: emptyDistribution, changes: emptyDistribution },
      methodology_version: "1.0.0",
      aggregation_lineage: null,
    });
    expect(asset.latest.value).toBe(75.2);
    expect(asset.latest_source).toEqual({
      period: "2026-07-21",
      value: null,
      status: "suppressed_or_withheld",
    });
    expect(asset.freshness).toMatchObject({
      latest_numeric_period: "2026-07-14",
      latest_observation_status: "suppressed_or_withheld",
      checked_at: "2026-07-22T01:30:00Z",
    });
    expect(compactUnit(asset.unit)).toBe("10³ m³/d");
  });

  it("does not infer fresh when only the global status is fresh and no expected period exists", () => {
    const sourceSeries = manifestFixture.series[0]!;
    const manifest = parseCanadaManifest({
      ...manifestFixture,
      status: "fresh",
      series: [{
        ...sourceSeries,
        freshness: { latest_period: "2026-05" },
      }],
    });
    expect(manifest.series[0]?.freshness.status).toBe("unknown");
  });

  it("reports Canada-specific schema failures", () => {
    expect(() => parseCanadaManifest({ ...manifestFixture, schema_version: "2.0.0" })).toThrow(
      /Unsupported Canada manifest schema/,
    );
  });
});

describe("Canada dashboard selection", () => {
  it("keeps every asset-backed series, including unclassified and differently grouped series", () => {
    const series = availableCanadaSeries(parseCanadaManifest(manifestFixture));
    expect(series.map((item) => item.view_id)).toEqual(expect.arrayContaining([
      "can.statcan.products.gasoline.sales.monthly",
      "can.statcan.products.diesel.production.monthly",
      "can.cer.refinery.runs.weekly",
      "can.statcan.unclassified.monthly",
    ]));
  });

  it("narrows a large manifest by dataset, product, and measure", () => {
    const series = availableCanadaSeries(parseCanadaManifest(manifestFixture));
    const datasets = canadaDatasetOptions(series);
    expect(datasets).toHaveLength(3);
    expect(datasets.map((option) => option.label)).toEqual(expect.arrayContaining([
      "Refined product balances · Statistics Canada",
      "Refinery activity · Statistics Canada & CER",
      "Other monthly data · Statistics Canada",
    ]));

    const gasoline = series.find((item) => item.view_id.includes("gasoline"))!;
    const datasetId = canadaDatasetFacet(gasoline).id;
    const products = canadaProductOptions(series, datasetId);
    expect(products.map((option) => option.label)).toEqual([
      "Motor gasoline",
      "Diesel fuel oil",
    ]);

    const productId = canadaProductFacet(gasoline).id;
    const measures = canadaMeasureOptions(series, datasetId, productId);
    expect(measures.map((option) => option.label)).toEqual(["Sales"]);

    const selected = canadaSeriesForSelection(series, {
      datasetId,
      productId,
      measureId: canadaMeasureFacet(gasoline).id,
    });
    expect(selected.map((item) => item.view_id)).toEqual([
      "can.statcan.products.gasoline.sales.monthly",
    ]);
  });

  it("gives unclassified series honest fallback product and measure facets", () => {
    const series = availableCanadaSeries(parseCanadaManifest(manifestFixture));
    const unclassified = series.find((item) => item.view_id.includes("unclassified"))!;
    expect(canadaProductFacet(unclassified).label).toBe("Unclassified published series");
    expect(canadaMeasureFacet(unclassified).label).toBe("other monthly measure");
  });

  it("labels known and unknown classified dataset groups without category fragmentation", () => {
    const series = availableCanadaSeries(parseCanadaManifest(manifestFixture));
    const gasoline = series.find((item) => item.view_id.includes("gasoline"))!;
    const crude = {
      ...gasoline,
      classification: {
        ...gasoline.classification!,
        dashboard_group: "canada_crude",
      },
    };
    const unknown = {
      ...gasoline,
      classification: {
        ...gasoline.classification!,
        dashboard_group: "canada_special_balances",
      },
    };

    expect(canadaDatasetFacet(crude).label).toBe("Crude oil balances · Statistics Canada");
    expect(canadaDatasetFacet(unknown).label).toBe(
      "Canada Special Balances · Statistics Canada",
    );
  });

  it("resolves selected-series reference term IDs to glossary deep links", () => {
    const series = availableCanadaSeries(parseCanadaManifest(manifestFixture));
    const gasoline = series.find((item) => item.view_id.includes("gasoline"))!;
    expect(canadaReferenceEntries(gasoline).map((entry) => entry.id)).toEqual([
      "total-motor-gasoline",
      "statcan-products-supplied",
    ]);
  });
});

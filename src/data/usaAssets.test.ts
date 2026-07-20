import { describe, expect, it } from "vitest";
import {
  parseUsaChartAsset,
  parseUsaManifest,
  publicDataUrl,
  resolveManifestAssetUrl,
} from "./usaAssets";

const manifestFixture = {
  schema_version: "1.0.0",
  generated_at: "2026-07-19T18:00:00Z",
  last_success_at: "2026-07-19T18:00:00Z",
  status: "fresh",
  series: [
    {
      series_id: "usa.eia.refinery.utilization.weekly",
      metric_id: "refinery_utilization",
      title: "Refinery utilization",
      category: "Refining",
      unit: "percent",
      frequency: "weekly",
      source: { name: "U.S. Energy Information Administration" },
      freshness: { status: "fresh", latest_period: "2026-07-17" },
      geographies: [
        {
          geography_id: "usa.padd.3",
          label: "PADD 3",
          level_id: "padd",
          level_label: "Petroleum district",
          origin: "source-published",
          status: "available",
          asset_path: "series/refinery-utilization/padd-3.json",
          forecast_path: "forecasts/refinery-utilization/padd-3.json",
        },
      ],
      unsupported_levels: [
        { level_id: "city", label: "City", reason: "EIA does not publish this weekly measure by city." },
      ],
    },
  ],
};

const distribution = {
  count: 40,
  mean: 1,
  median: 0.5,
  stddev: 2,
  min: -4,
  q1: -0.5,
  q3: 1.5,
  max: 5,
  iqr: 2,
  skewness: 0.2,
  excess_kurtosis: 1.1,
  histogram: { bin_edges: [-4, -2, 0], counts: [4, 12] },
  fit: {
    status: "candidate_diagnostic",
    label: "Normal candidate diagnostic; not definitive",
    best_candidate_among_tested: "normal",
    selection_note: "Only the normal family is tested.",
    tested_candidates: [{ name: "normal", aic: 102.5 }],
  },
};

const chartFixture = {
  schema_version: "1.0.0",
  series_id: "usa.eia.refinery.utilization.weekly",
  geography_id: "usa.padd.3",
  frequency: "weekly",
  unit: "percent",
  generated_at: "2026-07-19T18:00:00Z",
  source_checksum: "abcdef0123456789",
  recent_years: [
    { year: 2026, points: [{ period: "2026-01-02", slot: 1, value: 91.2, status: "observed" }] },
  ],
  baseline: {
    status: "ready",
    baseline_start_year: 2013,
    baseline_end_year: 2022,
    eligible_years: [2013, 2014, 2015, 2016, 2017, 2018, 2019, 2020, 2021, 2022],
    excluded_years: [2023, 2024, 2025],
    slots: [{ slot: 1, min: 80, q1: 84, median: 88, mean: 87, q3: 91, max: 95, count: 10 }],
  },
  latest: {
    period: "2026-01-02",
    value: 91.2,
    previous_period: "2025-12-26",
    absolute_change: 0.8,
    percent_change: 0.88,
    year_ago_period: "2025-01-03",
    yoy_absolute_change: 1.2,
    yoy_percent_change: 1.33,
    seasonal_median: 88,
    distance_from_seasonal_median: 3.2,
    seasonal_percentile: 0.8,
  },
  distribution: { levels: distribution, changes: distribution },
  methodology_version: "1.0.0",
  aggregation_lineage: null,
};

describe("USA public asset contract", () => {
  it("parses series availability and keeps unsupported geography reasons", () => {
    const manifest = parseUsaManifest(manifestFixture);
    expect(manifest.series[0]?.geographies[0]?.geography_id).toBe("usa.padd.3");
    expect(manifest.series[0]?.geographies[0]?.forecast_path).toBe(
      "forecasts/refinery-utilization/padd-3.json",
    );
    expect(manifest.series[0]?.unsupported_levels[0]?.reason).toContain("does not publish");
  });

  it("parses the complete optional refined-product classification", () => {
    const classifiedSeries = {
      ...manifestFixture.series[0],
      series_id: "usa.eia.products.gasoline.stocks.weekly",
      classification: {
        dashboard_group: "refined_products",
        product_family_id: "gasoline",
        product_family_label: "Gasoline",
        product_id: "finished-motor-gasoline",
        product_label: "Finished motor gasoline",
        measure_id: "stocks",
        measure_label: "Stocks",
        component_role: "parent_total",
        parent_product_id: null,
        reference_term_ids: ["finished-motor-gasoline", "petroleum-stocks"],
        display_order: 10,
      },
    };
    const manifest = parseUsaManifest({ ...manifestFixture, series: [classifiedSeries] });
    expect(manifest.series[0]?.classification).toEqual(classifiedSeries.classification);
  });

  it("rejects incomplete refined-product classification metadata", () => {
    const classifiedSeries = {
      ...manifestFixture.series[0],
      classification: {
        dashboard_group: "refined_products",
        product_family_id: "gasoline",
      },
    };
    expect(() => parseUsaManifest({ ...manifestFixture, series: [classifiedSeries] })).toThrow(
      /classification/,
    );
  });

  it("rejects schema versions the frontend does not understand", () => {
    expect(() => parseUsaManifest({ ...manifestFixture, schema_version: "2.0.0" })).toThrow(
      /Unsupported USA manifest schema/,
    );
  });

  it("adapts the canonical refresh asset index into source-aware series views", () => {
    const manifest = parseUsaManifest({
      schema_version: "1.0.0",
      run_id: "run-001",
      generated_at: "2026-07-19T18:00:00Z",
      assets: [
        {
          path: "assets/usa.eia.crude.production.monthly/us.tx/abc.json",
          series_id: "usa.eia.crude.production.monthly",
          geography_id: "us.tx",
          dimensions: { process: "crude" },
          latest_period: "2026-05",
        },
        {
          path: "assets/usa.eia.crude.production.monthly/us/abc.json",
          series_id: "usa.eia.crude.production.monthly",
          geography_id: "us",
          dimensions: { process: "crude" },
          latest_period: "2026-05",
        },
      ],
    });
    expect(manifest.series).toHaveLength(1);
    expect(manifest.series[0]?.geographies.map((item) => item.level_id)).toEqual([
      "state_or_area",
      "national",
    ]);
    expect(manifest.series[0]?.freshness.latest_period).toBe("2026-05");
  });

  it("parses chart statistics without converting missing values to zero", () => {
    const parsed = parseUsaChartAsset({
      ...chartFixture,
      latest: { ...chartFixture.latest, seasonal_median: null },
    });
    expect(parsed.latest.seasonal_median).toBeNull();
    expect(parsed.baseline.slots[0]?.median).toBe(88);
    expect(parsed.baseline.eligible_year_count).toBe(10);
    expect(parsed.distribution.changes.histogram).toHaveLength(2);
    expect(parsed.distribution.changes.fit?.best_candidate_among_tested).toBe("normal");
  });

  it("builds GitHub Pages-safe local paths and blocks remote asset injection", () => {
    expect(publicDataUrl("data/usa/manifest.json", "/energy-monitor/")).toBe(
      "/energy-monitor/data/usa/manifest.json",
    );
    expect(
      resolveManifestAssetUrl(
        "series/refinery-utilization/padd-3.json",
        "/energy-monitor/data/usa/manifest.json",
      ),
    ).toBe("/energy-monitor/data/usa/series/refinery-utilization/padd-3.json");
    expect(() => resolveManifestAssetUrl("https://example.com/asset.json")).toThrow(/local public files/);
  });
});

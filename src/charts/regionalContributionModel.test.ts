import { describe, expect, it } from "vitest";
import type {
  HistoricalObservation,
  UsaChartAsset,
  UsaManifestSeries,
} from "../types/energyAssets";
import type { RegionalContributionSpec } from "../data/regionalContributions";
import { buildRegionalContributionModel } from "./regionalContributionModel";

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

const series: UsaManifestSeries = {
  view_id: "usa.eia.example.imports.weekly",
  series_id: "usa.eia.example.imports.weekly",
  title: "Example imports",
  category: "Imports",
  unit: "thousand_barrels_per_day",
  frequency: "weekly",
  source: { name: "EIA" },
  freshness: { status: "fresh", latest_period: "2026-01-09" },
  classification: {
    dashboard_group: "refined_products",
    product_family_id: "example",
    product_family_label: "Example",
    product_id: "example",
    product_label: "Example",
    measure_id: "imports",
    measure_label: "Imports",
    component_role: "headline",
    parent_product_id: null,
    reference_term_ids: [],
    display_order: 1,
  },
  geographies: [],
  unsupported_levels: [],
};

const spec: RegionalContributionSpec = {
  country: "usa",
  componentLevelId: "padd",
  componentLevelLabel: "PADD district of entry",
  nationalGeographyId: "us",
  nationalLabel: "United States",
  nationalAssetPath: "national.json",
  components: [
    { geographyId: "us.padd.1", label: "PADD 1", assetPath: "padd1.json" },
    { geographyId: "us.padd.2", label: "PADD 2", assetPath: "padd2.json" },
  ],
  title: "PADD contribution to official imports",
  description: "Test",
  geographyDisclosure: "Test",
};

function history(values: Array<number | null>, statuses = ["observed", "observed"]): HistoricalObservation[] {
  return values.map((value, index) => ({
    period: index === 0 ? "2026-01-02" : "2026-01-09",
    year: 2026,
    slot: index + 1,
    value,
    status: statuses[index] ?? "observed",
  }));
}

function asset(
  geographyId: string,
  values: Array<number | null>,
  statuses?: string[],
  overrides: Partial<UsaChartAsset> = {},
): UsaChartAsset {
  return {
    schema_version: "1.0.0",
    series_id: series.series_id,
    geography_id: geographyId,
    dimensions: {},
    frequency: "weekly",
    unit: "thousand_barrels_per_day",
    generated_at: "2026-01-10T00:00:00Z",
    source_checksum: geographyId,
    freshness: { status: "fresh", latest_period: "2026-01-09" },
    history: history(values, statuses),
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
      period: "2026-01-09",
      value: values[1] ?? null,
      previous_period: "2026-01-02",
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
      period: "2026-01-09",
      value: values[1] ?? null,
      status: statuses?.[1] ?? "observed",
    },
    distribution: { levels: emptyDistribution, changes: emptyDistribution },
    methodology_version: "test-1",
    aggregation_lineage: null,
    ...overrides,
  };
}

describe("regional contribution model", () => {
  it("keeps the official total separate and exposes a signed reconciliation diagnostic", () => {
    const model = buildRegionalContributionModel(
      series,
      spec,
      asset("us", [100, 110]),
      [
        { geography: spec.components[0]!, asset: asset("us.padd.1", [60, 70]) },
        { geography: spec.components[1]!, asset: asset("us.padd.2", [40, 39]) },
      ],
    );

    expect(model.latest).toMatchObject({
      period: "2026-01-09",
      nationalValue: 110,
      componentSum: 109,
      complete: true,
      reconciliationDifference: 1,
      numericComponentCount: 2,
      expectedComponentCount: 2,
    });
    expect(model.latest.components.map((component) => component.shareOfNational))
      .toEqual([70 / 110 * 100, 39 / 110 * 100]);
  });

  it("does not stale-fill or reconcile an unavailable current component", () => {
    const model = buildRegionalContributionModel(
      series,
      spec,
      asset("us", [100, 110]),
      [
        { geography: spec.components[0]!, asset: asset("us.padd.1", [60, 70]) },
        {
          geography: spec.components[1]!,
          asset: asset("us.padd.2", [40, null], ["observed", "not_available"]),
        },
      ],
    );

    expect(model.latest.complete).toBe(false);
    expect(model.latest.reconciliationDifference).toBeNull();
    expect(model.latest.componentSum).toBe(70);
    expect(model.latest.components[1]).toMatchObject({
      value: null,
      previousValue: 40,
      status: "not_available",
      shareOfNational: null,
    });
    expect(model.latest.components.every((component) => component.shareOfNational === null))
      .toBe(true);
  });

  it("refuses incompatible units and methodology", () => {
    expect(() => buildRegionalContributionModel(
      series,
      spec,
      asset("us", [100, 110]),
      [
        {
          geography: spec.components[0]!,
          asset: asset("us.padd.1", [60, 70], undefined, { unit: "thousand_barrels" }),
        },
        { geography: spec.components[1]!, asset: asset("us.padd.2", [40, 40]) },
      ],
    )).toThrow(/incompatible frequency or units/i);
  });

  it("refuses incompatible semantic dimensions and value/status pairs", () => {
    expect(() => buildRegionalContributionModel(
      series,
      spec,
      asset("us", [100, 110], undefined, { dimensions: { product: "example" } }),
      [
        {
          geography: spec.components[0]!,
          asset: asset("us.padd.1", [60, 70], undefined, {
            dimensions: { product: "different" },
          }),
        },
        {
          geography: spec.components[1]!,
          asset: asset("us.padd.2", [40, 40], undefined, {
            dimensions: { product: "example" },
          }),
        },
      ],
    )).toThrow(/incompatible source dimensions/i);

    expect(() => buildRegionalContributionModel(
      series,
      spec,
      asset("us", [100, 110]),
      [
        {
          geography: spec.components[0]!,
          asset: asset("us.padd.1", [60, 70], ["observed", "suppressed_or_withheld"]),
        },
        { geography: spec.components[1]!, asset: asset("us.padd.2", [40, 40]) },
      ],
    )).toThrow(/incompatible value\/status pair/i);
  });
});

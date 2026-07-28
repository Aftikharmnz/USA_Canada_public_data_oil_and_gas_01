import { describe, expect, it } from "vitest";
import type {
  HistoricalObservation,
  ManifestGeography,
  UsaChartAsset,
  UsaManifestSeries,
} from "../types/energyAssets";
import {
  buildUsaPaddOriginDestinationModel,
  isUsaPaddMovementSeries,
  usaPaddOriginDestinationAssetPlan,
} from "./usaPaddOriginDestinationModel";

const geographies: ManifestGeography[] = [
  {
    geography_id: "us.padd.route.2-to-1",
    label: "Midwest (PADD 2) → East Coast (PADD 1)",
    level_id: "padd_route",
    level_label: "PADD origin → destination route",
    origin: "source-published",
    status: "available",
    asset_path: "assets/2-to-1.json",
  },
  {
    geography_id: "us.padd.route.1-to-2",
    label: "East Coast (PADD 1) → Midwest (PADD 2)",
    level_id: "padd_route",
    level_label: "PADD origin → destination route",
    origin: "source-published",
    status: "available",
    asset_path: "assets/1-to-2.json",
  },
];

const series: UsaManifestSeries = {
  view_id: "usa.eia.crude.padd_movements.monthly",
  series_id: "usa.eia.crude.padd_movements.monthly",
  title: "Crude oil movements between PADDs",
  category: "Crude",
  unit: "thousand_barrels",
  frequency: "monthly",
  source: { name: "U.S. Energy Information Administration" },
  freshness: { status: "unknown" },
  classification: {
    dashboard_group: "usa_crude",
    product_family_id: "crude-movements",
    product_family_label: "Crude movements",
    product_id: "crude-oil-padd-movements",
    product_label: "Crude oil PADD movements",
    measure_id: "inter-padd-movement",
    measure_label: "Origin → destination movement",
    component_role: "headline",
    parent_product_id: null,
    reference_term_ids: ["inter-padd-movements"],
    display_order: 100,
  },
  geographies,
  unsupported_levels: [],
};

function history(value: number): HistoricalObservation[] {
  return [
    { period: "2026-04", year: 2026, slot: 4, value: value - 1, status: "observed" },
    { period: "2026-05", year: 2026, slot: 5, value, status: "preliminary" },
  ];
}

function asset(
  geography: ManifestGeography,
  duoarea: string,
  value: number,
): UsaChartAsset {
  return {
    series_id: series.series_id,
    geography_id: geography.geography_id,
    unit: series.unit,
    frequency: series.frequency,
    generated_at: "2026-07-28T12:00:00+00:00",
    methodology_version: "test",
    dimensions: {
      duoarea,
      product: "EPC0",
      process: "TNR",
      series: `test-${geography.geography_id}`,
    },
    history: history(value),
  } as unknown as UsaChartAsset;
}

function loaded() {
  const plan = usaPaddOriginDestinationAssetPlan(series);
  return plan.map((item) => ({
    ...item,
    asset: asset(
      item.geography,
      item.geography.geography_id.endsWith("1-to-2")
        ? "R20-R10"
        : "R10-R20",
      item.geography.geography_id.endsWith("1-to-2") ? 12 : 8,
    ),
  }));
}

describe("USA PADD origin-destination model", () => {
  it("recognizes and orders exact route assets", () => {
    expect(isUsaPaddMovementSeries(series)).toBe(true);
    expect(usaPaddOriginDestinationAssetPlan(series).map(
      (item) => item.geography.geography_id,
    )).toEqual([
      "us.padd.route.1-to-2",
      "us.padd.route.2-to-1",
    ]);
  });

  it("pivots directional routes while leaving undeclared cells unpublished", () => {
    const model = buildUsaPaddOriginDestinationModel(series, loaded());
    const latest = model.snapshots.find((snapshot) => snapshot.period === "2026-05")!;

    expect(model.latestPeriod).toBe("2026-05");
    expect(latest.cells.find((cell) => (
      cell.origin.id === "us.padd.1"
      && cell.destination.id === "us.padd.2"
    ))).toMatchObject({
      routeId: "us.padd.route.1-to-2",
      value: 12,
      status: "preliminary",
    });
    expect(latest.cells.find((cell) => (
      cell.origin.id === "us.padd.1"
      && cell.destination.id === "us.padd.3"
    ))).toMatchObject({
      routeId: null,
      value: null,
      status: "no_published_fact",
    });
  });

  it("rejects a reversed or drifted EIA duoarea identity", () => {
    const assets = loaded();
    assets[0] = {
      ...assets[0]!,
      asset: {
        ...assets[0]!.asset,
        dimensions: {
          ...assets[0]!.asset.dimensions,
          duoarea: "R10-R20",
        },
      },
    };
    expect(() => buildUsaPaddOriginDestinationModel(series, assets))
      .toThrow(/dimensions do not match/);
  });
});

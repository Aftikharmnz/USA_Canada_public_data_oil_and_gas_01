import { describe, expect, it } from "vitest";
import type { UsaManifestSeries } from "../types/energyAssets";
import { usaWeeklyFamilyCount, verifiedUsaWeeklySeries } from "./usaWeekly";

function series(
  viewId: string,
  frequency: string,
  familyId?: string,
): UsaManifestSeries {
  return {
    view_id: viewId,
    series_id: viewId,
    title: viewId,
    category: "Test",
    unit: "thousand_barrels",
    frequency,
    source: { name: "Official test source" },
    freshness: { status: "unknown" },
    classification: familyId ? {
      dashboard_group: "refined_products",
      product_family_id: familyId,
      product_family_label: familyId,
      product_id: viewId,
      product_label: viewId,
      measure_id: "stocks",
      measure_label: "Stocks",
      component_role: "component",
      parent_product_id: null,
      reference_term_ids: [],
      display_order: 1,
    } : undefined,
    geographies: [],
    unsupported_levels: [],
  };
}

describe("USA weekly desk series", () => {
  it("keeps only verified manifest views at weekly frequency", () => {
    const input = [
      series("weekly-gasoline", "weekly", "gasoline"),
      series("monthly-crude", "monthly", "crude"),
      series("weekly-distillate", "Weekly", "distillate"),
    ];

    expect(verifiedUsaWeeklySeries(input).map((item) => item.view_id)).toEqual([
      "weekly-gasoline",
      "weekly-distillate",
    ]);
    expect(usaWeeklyFamilyCount(input)).toBe(2);
  });
});

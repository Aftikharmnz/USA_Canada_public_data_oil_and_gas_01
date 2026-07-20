import { describe, expect, it } from "vitest";
import type { UsaChartAsset } from "../types/energyAssets";
import { buildPeriodChangeModel } from "./changeModel";

function weeklyAsset(points: { period: string; value: number | null }[]): UsaChartAsset {
  return {
    frequency: "weekly",
    unit: "thousand_barrels",
    recent_years: [
      {
        year: 2026,
        points: points.map((point, index) => ({ ...point, slot: index + 1, status: "observed" })),
      },
    ],
  } as unknown as UsaChartAsset;
}

describe("buildPeriodChangeModel", () => {
  it("computes changes only between directly consecutive numeric weeks", () => {
    const model = buildPeriodChangeModel(weeklyAsset([
      { period: "2026-01-02", value: 100 },
      { period: "2026-01-09", value: 104 },
      { period: "2026-01-16", value: null },
      { period: "2026-01-23", value: 95 },
      { period: "2026-01-30", value: 90 },
    ]));
    expect(model.frequency).toBe("weekly");
    expect(model.points.map((point) => point.period)).toEqual(["2026-01-09", "2026-01-30"]);
    expect(model.points[0]).toMatchObject({ change: 4, previousPeriod: "2026-01-02" });
    expect(model.points[1]).toMatchObject({ change: -5, previousPeriod: "2026-01-23" });
    expect(model.skippedGaps).toBe(1);
    expect(model.latest?.period).toBe("2026-01-30");
  });

  it("bridges calendar years and never zero-fills a gap", () => {
    const asset = {
      frequency: "weekly",
      unit: "thousand_barrels",
      recent_years: [
        {
          year: 2025,
          points: [{ period: "2025-12-26", slot: 52, value: 200, status: "observed" }],
        },
        {
          year: 2026,
          points: [{ period: "2026-01-02", slot: 1, value: 207, status: "observed" }],
        },
      ],
    } as unknown as UsaChartAsset;
    const model = buildPeriodChangeModel(asset);
    expect(model.points).toHaveLength(1);
    expect(model.points[0]).toMatchObject({
      period: "2026-01-02",
      previousPeriod: "2025-12-26",
      change: 7,
    });
  });

  it("handles monthly assets with month arithmetic", () => {
    const asset = {
      frequency: "monthly",
      unit: "thousand_barrels_per_day",
      recent_years: [
        {
          year: 2025,
          points: [
            { period: "2025-11", slot: 11, value: 50, status: "observed" },
            { period: "2025-12", slot: 12, value: 55, status: "observed" },
          ],
        },
        {
          year: 2026,
          points: [{ period: "2026-01", slot: 1, value: 52, status: "observed" }],
        },
      ],
    } as unknown as UsaChartAsset;
    const model = buildPeriodChangeModel(asset);
    expect(model.frequency).toBe("monthly");
    expect(model.points.map((point) => point.change)).toEqual([5, -3]);
  });
});

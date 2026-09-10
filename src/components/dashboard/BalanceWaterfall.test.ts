import { describe, expect, it } from "vitest";
import type { BarSeriesOption } from "echarts/charts";
import type { WeeklyBalanceModel } from "../../charts/balanceModel";
import { waterfallOption } from "./BalanceWaterfall";

function model(actualChange: number): WeeklyBalanceModel {
  return {
    familyLabel: "Total distillate", week: "2026-07-10", previousWeek: "2026-07-03",
    windowWeeks: 1, stocksLevel: 100000, latestSourceWeek: "2026-07-10",
    usesOlderCompleteWeek: false, sourceStatuses: [],
    components: [
      { role: "production", label: "Net production", sign: 1, ratePerDay: 4000, weeklyVolume: 28000 },
      { role: "imports", label: "Imports", sign: 1, ratePerDay: 200, weeklyVolume: 1400 },
      { role: "exports", label: "Exports", sign: -1, ratePerDay: 1200, weeklyVolume: 8400 },
      { role: "product_supplied", label: "Product supplied", sign: -1, ratePerDay: 3600, weeklyVolume: 25200 },
    ],
    impliedChange: -4200, actualChange, unaccounted: actualChange + 4200,
  };
}

describe("weekly balance waterfall rendering", () => {
  it.each([-4500, 900])("keeps signed waterfall spans anchored when actual change is %s", (actualChange) => {
    const option = waterfallOption(model(actualChange), "thousand_barrels", "thousand_barrels_per_day");
    const [base, visible] = option.series as BarSeriesOption[];
    // Same-sign stacking incorrectly renders positive-height spans above zero
    // whenever their hidden baseline is negative (including every stock draw).
    expect(base!.stackStrategy).toBe("all");
    expect(visible!.stackStrategy).toBe("all");
    const baseline = base!.data as number[];
    const spans = visible!.data as Array<{ value: number }>;
    expect(baseline[6]! + spans[6]!.value).toBe(Math.max(0, actualChange));
    expect(baseline[6]).toBe(Math.min(0, actualChange));
    expect(baseline[5]! + spans[5]!.value).toBe(Math.max(-4200, actualChange));
    expect(baseline[5]).toBe(Math.min(-4200, actualChange));
  });

  it("converts every base and height by the same display-only volume factor", () => {
    const native = waterfallOption(model(-4500), "thousand_barrels", "thousand_barrels_per_day");
    const millions = waterfallOption(model(-4500), "million_barrels", "million_barrels_per_day");
    const [sourceBase, sourceBars] = native.series as BarSeriesOption[];
    const [convertedBase, convertedBars] = millions.series as BarSeriesOption[];
    expect(convertedBase!.data).toEqual((sourceBase!.data as number[]).map((value) => value / 1000));
    const nativeBars = sourceBars!.data as Array<{ value: number }>;
    for (const [index, bar] of (convertedBars!.data as Array<{ value: number }>).entries()) {
      expect(bar.value).toBeCloseTo(nativeBars[index]!.value / 1000);
    }
  });
});

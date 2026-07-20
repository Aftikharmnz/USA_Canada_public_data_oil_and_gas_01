import { describe, expect, it } from "vitest";
import type { UsaChartAsset } from "../types/energyAssets";
import {
  EXCLUDED_BALANCE_FAMILIES,
  REGISTERED_BALANCE_FAMILIES,
  balanceFamilyRegistration,
  buildWeeklyBalanceModel,
} from "./balanceModel";

function asset(
  unit: string,
  points: { period: string; value: number | null }[],
): UsaChartAsset {
  return {
    frequency: "weekly",
    unit,
    recent_years: [
      {
        year: 2026,
        points: points.map((point, index) => ({ ...point, slot: index + 1, status: "observed" })),
      },
    ],
  } as unknown as UsaChartAsset;
}

const weeks = ["2026-06-26", "2026-07-03", "2026-07-10"];

function flows(values: number[]): UsaChartAsset {
  return asset(
    "thousand_barrels_per_day",
    weeks.map((period, index) => ({ period, value: values[index] ?? null })),
  );
}

describe("buildWeeklyBalanceModel", () => {
  it("computes the latest complete balance and its unaccounted residual", () => {
    const model = buildWeeklyBalanceModel("Total distillate", {
      // 100000 -> implied change 7 * (4000 + 200 - 1200 - 3600) = -4200/wk
      stocks: asset("thousand_barrels", [
        { period: weeks[0]!, value: 104500 },
        { period: weeks[1]!, value: 104500 },
        { period: weeks[2]!, value: 100000 },
      ]),
      production: flows([4000, 4000, 4000]),
      imports: flows([200, 200, 200]),
      exports: flows([1200, 1200, 1200]),
      productSupplied: flows([3600, 3600, 3600]),
    });
    expect(model).not.toBeNull();
    expect(model!.week).toBe("2026-07-10");
    expect(model!.previousWeek).toBe("2026-07-03");
    expect(model!.impliedChange).toBeCloseTo(-4200);
    expect(model!.actualChange).toBeCloseTo(-4500);
    expect(model!.unaccounted).toBeCloseTo(-300);
    expect(model!.components.map((component) => component.sign)).toEqual([1, 1, -1, -1]);
  });

  it("falls back to an older week instead of computing a partial balance", () => {
    const model = buildWeeklyBalanceModel("Total distillate", {
      stocks: asset("thousand_barrels", [
        { period: weeks[0]!, value: 104500 },
        { period: weeks[1]!, value: 104000 },
        { period: weeks[2]!, value: 100000 },
      ]),
      production: flows([4000, 4000, 4000]),
      imports: flows([200, 200, 200]),
      // Latest exports week is unavailable, so the balance must use the prior week.
      exports: flows([1200, 1200, null as unknown as number]),
      productSupplied: flows([3600, 3600, 3600]),
    });
    expect(model).not.toBeNull();
    expect(model!.week).toBe("2026-07-03");
  });

  it("returns null when no consecutive complete week pair exists", () => {
    const model = buildWeeklyBalanceModel("Total distillate", {
      stocks: asset("thousand_barrels", [{ period: weeks[2]!, value: 100000 }]),
      production: flows([4000, 4000, 4000]),
      imports: flows([200, 200, 200]),
      exports: flows([1200, 1200, 1200]),
      productSupplied: flows([3600, 3600, 3600]),
    });
    expect(model).toBeNull();
  });

  it("registers only families whose full balance is active, and documents gasoline", () => {
    expect(REGISTERED_BALANCE_FAMILIES.map((family) => family.familyId)).toEqual([
      "distillate",
      "jet-fuel",
    ]);
    expect(balanceFamilyRegistration("gasoline")).toBeUndefined();
    expect(EXCLUDED_BALANCE_FAMILIES.gasoline).toMatch(/June 2023/);
  });
});

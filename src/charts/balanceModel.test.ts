import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import registry from "../../config/series/usa.json";
import { parseUsaChartAsset } from "../data/usaAssets";
import type { UsaChartAsset } from "../types/energyAssets";
import {
  EXCLUDED_BALANCE_FAMILIES,
  REGISTERED_BALANCE_FAMILIES,
  balanceFamilyRegistration,
  buildWeeklyBalanceModel,
} from "./balanceModel";

const weeks = ["2026-06-26", "2026-07-03", "2026-07-10"];
type Role = "stocks" | "production" | "imports" | "exports" | "productSupplied";
const processes: Record<Role, string> = {
  stocks: "SAE", production: "YPR", imports: "IM0", exports: "EEX", productSupplied: "VPP",
};

function asset(role: Role, values: Array<number | null>, periods = weeks): UsaChartAsset {
  const family = REGISTERED_BALANCE_FAMILIES[0]!;
  return {
    schema_version: "1.0.0",
    series_id: family[role],
    geography_id: "us",
    dimensions: { product: family.sourceProduct, process: processes[role] },
    frequency: "weekly",
    unit: role === "stocks" ? "thousand_barrels" : "thousand_barrels_per_day",
    generated_at: "2026-07-15T12:00:00Z",
    methodology_version: "2026-07-20.1",
    source_checksum: `checksum-${role}`,
    recent_years: [{
      year: 2026,
      points: periods.map((period, index) => ({
        period, slot: index + 1, value: values[index] ?? null,
        status: values[index] == null ? "not_available" : "observed",
      })),
    }],
  } as unknown as UsaChartAsset;
}

function assets() {
  return {
    stocks: asset("stocks", [104500, 104500, 100000]),
    production: asset("production", [4000, 4000, 4000]),
    imports: asset("imports", [200, 200, 200]),
    exports: asset("exports", [1200, 1200, 1200]),
    productSupplied: asset("productSupplied", [3600, 3600, 3600]),
  };
}

describe("buildWeeklyBalanceModel", () => {
  it("computes the latest complete balance and its unaccounted residual", () => {
    const model = buildWeeklyBalanceModel("Total distillate", assets());
    expect(model).toMatchObject({
      week: "2026-07-10", previousWeek: "2026-07-03", latestSourceWeek: "2026-07-10",
      usesOlderCompleteWeek: false, sourceStatuses: [],
    });
    expect(model!.impliedChange).toBeCloseTo(-4200);
    expect(model!.actualChange).toBeCloseTo(-4500);
    expect(model!.unaccounted).toBeCloseTo(-300);
    expect(model!.components.map((component) => component.sign)).toEqual([1, 1, -1, -1]);
  });

  it("discloses the newer incomplete source week when showing an older complete balance", () => {
    const input = assets();
    input.exports = asset("exports", [1200, 1200, null]);
    expect(buildWeeklyBalanceModel("Total distillate", input)).toMatchObject({
      week: "2026-07-03", latestSourceWeek: "2026-07-10", usesOlderCompleteWeek: true,
    });
  });

  it("does not hide a suppressed stock endpoint from the latest source date", () => {
    const input = assets();
    input.stocks.recent_years[0]!.points[2]!.value = null;
    input.stocks.recent_years[0]!.points[2]!.status = "suppressed_or_withheld";
    expect(buildWeeklyBalanceModel("Total distillate", input)).toMatchObject({
      week: "2026-07-03", latestSourceWeek: "2026-07-10", usesOlderCompleteWeek: true,
    });
  });

  it("preserves preliminary/caution statuses, observed zeros, and negative net production", () => {
    const input = assets();
    input.production.recent_years[0]!.points[2]!.value = -100;
    input.production.recent_years[0]!.points[2]!.status = "preliminary";
    input.imports.recent_years[0]!.points[2]!.value = 0;
    input.exports.recent_years[0]!.points[2]!.status = "use_with_caution";
    const model = buildWeeklyBalanceModel("Total distillate", input)!;
    expect(model.components[0]!.weeklyVolume).toBe(-700);
    expect(model.components[1]!.weeklyVolume).toBe(0);
    expect(model.sourceStatuses).toEqual(["preliminary", "use_with_caution"]);
  });

  it("returns null when no consecutive complete week pair exists", () => {
    const input = assets();
    input.stocks = asset("stocks", [100000], [weeks[2]!]);
    expect(buildWeeklyBalanceModel("Total distillate", input)).toBeNull();
  });

  it("uses four consecutive rates and endpoints without confusing total and average volume", () => {
    const periods = ["2026-06-12", "2026-06-19", ...weeks];
    const input = assets();
    for (const role of Object.keys(input) as Role[]) {
      const constant = input[role].recent_years[0]!.points[0]!.value;
      input[role] = asset(role, role === "stocks" ? [120000, 115000, 110000, 106000, 100000]
        : Array.from({ length: 5 }, () => constant), periods);
    }
    const model = buildWeeklyBalanceModel("Total distillate", input, 4)!;
    expect(model.previousWeek).toBe("2026-06-12");
    expect(model.impliedChange).toBe(-4200);
    expect(model.actualChange).toBe(-5000);
  });

  it.each([
    ["geography_id", "us.padd.1"],
    ["unit", "cubic_metres"],
    ["frequency", "monthly"],
    ["series_id", "usa.eia.refined.jet.kerosene_type.imports.weekly"],
    ["generated_at", "2026-07-14T12:00:00Z"],
    ["methodology_version", "different-method"],
    ["schema_version", "2.0.0"],
  ])("rejects incompatible %s before computing the balance", (key, value) => {
    const input = assets();
    Object.assign(input.imports, { [key]: value });
    expect(() => buildWeeklyBalanceModel("Total distillate", input)).toThrow(/incompatible/);
  });

  it.each([
    { product: "EPJK", process: "IM0" },
    { product: "EPD0", process: "EEX" },
    { product: "EPD0", process: "IM0", inventory_position: "closing" },
  ])("rejects semantic source dimension drift", (dimensions) => {
    const input = assets();
    input.imports.dimensions = dimensions as Record<string, string>;
    expect(() => buildWeeklyBalanceModel("Total distillate", input)).toThrow(/source dimensions/);
  });

  it("rejects duplicate periods, invalid weekdays, and numeric/suppressed contradictions", () => {
    const input = assets();
    input.exports.recent_years[0]!.points.push({ ...input.exports.recent_years[0]!.points[2]! });
    expect(() => buildWeeklyBalanceModel("Total distillate", input)).toThrow(/duplicate/);
    input.exports = asset("exports", [1200], ["2026-07-11"]);
    expect(() => buildWeeklyBalanceModel("Total distillate", input)).toThrow(/Friday/);
    input.exports = asset("exports", [1200, 1200, 1200]);
    input.exports.recent_years[0]!.points[2]!.status = "suppressed_or_withheld";
    expect(() => buildWeeklyBalanceModel("Total distillate", input)).toThrow(/value\/status/);
  });

  it("rejects an unregistered family and inconsistent latest-source metadata", () => {
    expect(() => buildWeeklyBalanceModel("Gasoline", assets())).toThrow(/not registered/);
    const input = assets();
    input.exports.latest_source = { period: "2026-07-17", value: null, status: "not_available" };
    expect(() => buildWeeklyBalanceModel("Total distillate", input)).toThrow(/latest-source/);
  });

  it("keeps all ten balance roles synchronized with the active source registry", () => {
    expect(REGISTERED_BALANCE_FAMILIES.map((family) => family.familyId)).toEqual(["distillate", "jet-fuel"]);
    expect(balanceFamilyRegistration("gasoline")).toBeUndefined();
    expect(EXCLUDED_BALANCE_FAMILIES.gasoline).toMatch(/June 2023/);
    for (const family of REGISTERED_BALANCE_FAMILIES) {
      for (const role of Object.keys(processes) as Role[]) {
        const definition = registry.series.find((item) => item.id === family[role])!;
        expect(definition.activation_status).toBe("active");
        expect(definition.source.api_query!.expected_facets).toMatchObject({
          product: family.sourceProduct, process: processes[role],
        });
        expect(definition.unit).toBe(role === "stocks" ? "thousand_barrels" : "thousand_barrels_per_day");
        expect(definition.geography_availability.source_geography_ids).toContain("us");
      }
    }
  });

  it.each(REGISTERED_BALANCE_FAMILIES)("validates the promoted $familyId balance and exact arithmetic", (family) => {
    const manifest = JSON.parse(readFileSync(resolve("public/data/usa/manifest.json"), "utf8"));
    const input = Object.fromEntries((Object.keys(processes) as Role[]).map((role) => {
      const series = manifest.series.find((item: { series_id: string }) => item.series_id === family[role]);
      const geography = series.geographies.find((item: { geography_id: string }) => item.geography_id === "us");
      return [role, parseUsaChartAsset(JSON.parse(readFileSync(resolve("public/data/usa", geography.asset_path), "utf8")))];
    })) as Record<Role, UsaChartAsset>;
    const model = buildWeeklyBalanceModel(family.familyLabel, input)!;
    expect(model).not.toBeNull();
    expect(model.impliedChange + model.unaccounted).toBeCloseTo(model.actualChange);
    expect(model.latestSourceWeek >= model.week).toBe(true);
    for (const component of model.components) expect(component.weeklyVolume).toBe(component.ratePerDay * 7);
  });
});

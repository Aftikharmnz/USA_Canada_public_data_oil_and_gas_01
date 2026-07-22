import { describe, expect, it } from "vitest";
import { catalogs, resolveSeriesGeographyAvailability } from "./catalog";

function metricLevels(country: "usa" | "canada", metricId: string) {
  const metric = catalogs[country].metrics.find((candidate) => candidate.id === metricId);
  if (!metric) throw new Error(`Missing test metric: ${metricId}`);
  return metric.geographyLevelIds;
}

describe("source-aware geography availability", () => {
  it("does not imply state data for weekly USA refinery utilization", () => {
    expect(metricLevels("usa", "usa.eia.refinery.utilization.weekly")).toEqual([
      "padd",
      "national",
    ]);
  });

  it("keeps weekly product supplied national when no finer geography is published", () => {
    expect(metricLevels("usa", "usa.eia.product_supplied.weekly")).toEqual(["national"]);
  });

  it("uses CER refinery regions instead of pretending they are provinces", () => {
    expect(metricLevels("canada", "can.cer.refinery.crude_runs.weekly")).toEqual([
      "source_region",
      "national",
    ]);
    const metric = catalogs.canada.metrics.find(
      (candidate) => candidate.id === "can.cer.refinery.crude_runs.weekly",
    );
    expect(metric?.geographyLevelOrigins).toEqual({
      source_region: "source-published",
      national: "source-published",
    });
  });

  it("resolves inline and profiled availability and rejects missing geography contracts", () => {
    const inline = {
      source_geography_level_ids: ["national"],
      allowed_rollup_geography_level_ids: [],
      unsupported_levels: [{ level_id: "city", reason: "Not published." }],
    };
    expect(resolveSeriesGeographyAvailability(
      { geography_profiles: {} },
      { id: "inline", geography_availability: inline },
    )).toBe(inline);

    const profile = {
      source_geography_level_ids: ["province_territory", "national"],
      unsupported_levels: [{ level_id: "city", reason: "Not published." }],
    };
    expect(resolveSeriesGeographyAvailability(
      { geography_profiles: { provinces: profile } },
      { id: "profiled", geography_profile_id: "provinces" },
    )).toBe(profile);

    expect(() => resolveSeriesGeographyAvailability(
      { geography_profiles: {} },
      { id: "missing-profile", geography_profile_id: "unknown" },
    )).toThrow(/missing geography profile "unknown"/);
    expect(() => resolveSeriesGeographyAvailability(
      {},
      { id: "missing-contract" },
    )).toThrow(/must define geography_availability or geography_profile_id/);
  });

  it("orders every metric from its finest supported grain to its broadest", () => {
    for (const catalog of Object.values(catalogs)) {
      for (const metric of catalog.metrics) {
        expect(metric.geographyLevelIds.length).toBeGreaterThan(0);
        const knownLevels = new Set(catalog.geographyLevels.map((level) => level.id));
        expect(metric.geographyLevelIds.every((levelId) => knownLevels.has(levelId))).toBe(true);
        const cityBoundary = metric.unavailableGeographyLevels.find((level) => level.id === "city");
        if (!metric.geographyLevelIds.includes("city")) {
          expect(cityBoundary?.reason.length).toBeGreaterThan(0);
        }
      }
    }
  });
});

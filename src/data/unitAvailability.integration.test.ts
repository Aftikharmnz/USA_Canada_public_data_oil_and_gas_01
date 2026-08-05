import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseCanadaManifest } from "./canadaAssets";
import { canadaMonthlyAverageRateRegistry } from "./canadaRateDisplay";
import { parseUsaManifest } from "./usaAssets";
import { monthlyAverageRateOptions } from "../lib/periodAverageRate";
import { getDisplayUnitOptions } from "../lib/units";

const canadaManifestUrl = new URL("../../public/data/canada/manifest.json", import.meta.url);
const usaManifestUrl = new URL("../../public/data/usa/manifest.json", import.meta.url);

const ordinaryRateUnits = [
  "barrels_per_day",
  "thousand_barrels_per_day",
  "million_barrels_per_day",
  "cubic_metres_per_day",
  "thousand_cubic_metres_per_day",
] as const;

describe("promoted display-unit availability", () => {
  it("offers bbl/d and every compatible rate scale for each USA ordinary-rate series", async () => {
    const manifest = parseUsaManifest(
      JSON.parse(await readFile(usaManifestUrl, "utf8")) as unknown,
    );
    const rateSeries = manifest.series.filter(
      (series) => series.unit === "thousand_barrels_per_day",
    );

    expect(rateSeries).toHaveLength(41);
    for (const series of rateSeries) {
      expect(
        getDisplayUnitOptions(series.unit).map((option) => option.id),
        series.series_id,
      ).toEqual(ordinaryRateUnits);
    }
  });

  it("registers every eligible Statistics Canada monthly flow for every daily-rate scale", async () => {
    const manifest = parseCanadaManifest(
      JSON.parse(await readFile(canadaManifestUrl, "utf8")) as unknown,
    );
    const eligible = manifest.series.filter((series) => (
      series.source.name === "Statistics Canada"
      && series.frequency === "monthly"
      && series.unit === "cubic_metres"
      && series.classification?.measure_id !== "ending-stocks"
    ));
    const registered = new Set(canadaMonthlyAverageRateRegistry.series_ids);

    expect(eligible).toHaveLength(61);
    expect(new Set(eligible.map((series) => series.series_id))).toEqual(registered);
    for (const series of eligible) {
      expect(
        monthlyAverageRateOptions(series).map((option) => option.id),
        series.series_id,
      ).toEqual(ordinaryRateUnits);
    }
  });

  it("keeps point-in-time Canada inventories out of every daily-rate scale", async () => {
    const manifest = parseCanadaManifest(
      JSON.parse(await readFile(canadaManifestUrl, "utf8")) as unknown,
    );
    const inventories = manifest.series.filter(
      (series) => series.classification?.measure_id === "ending-stocks",
    );

    expect(inventories).toHaveLength(6);
    for (const series of inventories) {
      expect(monthlyAverageRateOptions(series), series.series_id).toEqual([]);
    }
  });
});

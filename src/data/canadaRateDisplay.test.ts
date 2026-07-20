import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { parseCanadaManifest } from "./canadaAssets";
import {
  canadaMonthlyAverageRateRegistry,
  isRegisteredMonthlyAverageRateSeries,
} from "./canadaRateDisplay";

const manifestUrl = new URL("../../public/data/canada/manifest.json", import.meta.url);

describe("Canada monthly-average rate registry", () => {
  it("authorizes exactly the current Statistics Canada monthly flow series", async () => {
    const manifest = parseCanadaManifest(JSON.parse(await readFile(manifestUrl, "utf8")) as unknown);
    const authorized = canadaMonthlyAverageRateRegistry.series_ids;
    expect(authorized).toHaveLength(43);
    for (const seriesId of authorized) {
      const series = manifest.series.find((candidate) => candidate.series_id === seriesId);
      expect(series, seriesId).toBeDefined();
      expect(series?.unit).toBe("cubic_metres");
      expect(series?.frequency).toBe("monthly");
      expect(series?.classification?.measure_id).not.toBe("ending-stocks");
    }
  });

  it("fails closed for inventories, CER data, and unknown future series", () => {
    expect(isRegisteredMonthlyAverageRateSeries("can.statcan.crude.closing_inventory.monthly"))
      .toBe(false);
    expect(isRegisteredMonthlyAverageRateSeries("can.cer.refinery.crude_runs.weekly")).toBe(false);
    expect(isRegisteredMonthlyAverageRateSeries("can.statcan.future.measure.monthly")).toBe(false);
  });
});

import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import canadaSeriesRegistry from "../../config/series/canada.json";
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
    expect(authorized).toHaveLength(70);
    const newlyActivated = new Set([
      "can.statcan.refined.propane.field_production.monthly",
      "can.statcan.refined.propane.net_production.monthly",
      "can.statcan.refined.propane.imports.monthly",
      "can.statcan.refined.propane.exports.monthly",
      "can.statcan.refined.residual_fuel_oil.net_production.monthly",
      "can.statcan.refined.residual_fuel_oil.imports.monthly",
      "can.statcan.refined.residual_fuel_oil.exports.monthly",
      "can.statcan.refined.residual_fuel_oil.product_supplied.monthly",
      "can.statcan.refined.residual_fuel_oil.stock_change.monthly",
    ]);
    for (const seriesId of authorized) {
      const series = manifest.series.find((candidate) => candidate.series_id === seriesId);
      if (!series) {
        expect(newlyActivated.has(seriesId), seriesId).toBe(true);
        continue;
      }
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

  it("authorizes the nine new active flows while keeping every stock ineligible", () => {
    const activeIds = new Set(
      canadaSeriesRegistry.series
        .filter((series) => series.activation_status === "active")
        .map((series) => series.id),
    );

    const flowIds = [
      "can.statcan.refined.propane.field_production.monthly",
      "can.statcan.refined.propane.net_production.monthly",
      "can.statcan.refined.propane.imports.monthly",
      "can.statcan.refined.propane.exports.monthly",
      "can.statcan.refined.residual_fuel_oil.net_production.monthly",
      "can.statcan.refined.residual_fuel_oil.imports.monthly",
      "can.statcan.refined.residual_fuel_oil.exports.monthly",
      "can.statcan.refined.residual_fuel_oil.product_supplied.monthly",
      "can.statcan.refined.residual_fuel_oil.stock_change.monthly",
    ];
    expect(flowIds.every((seriesId) => activeIds.has(seriesId))).toBe(true);
    expect(flowIds.every((seriesId) => isRegisteredMonthlyAverageRateSeries(seriesId)))
      .toBe(true);

    const stockIds = [
      "can.statcan.refined.residual_fuel_oil.ending_stocks.monthly",
      "can.statcan.crude.transporter_inventory.closing.monthly",
      "can.statcan.refined.hgl_rpp.transporter_inventory.closing.monthly",
    ];
    expect(stockIds.every((seriesId) => activeIds.has(seriesId))).toBe(true);
    expect(stockIds.every((seriesId) => !isRegisteredMonthlyAverageRateSeries(seriesId)))
      .toBe(true);
  });
});

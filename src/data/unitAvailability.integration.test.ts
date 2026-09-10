import { readFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import canadaSeriesRegistry from "../../config/series/canada.json";
import { parseCanadaManifest } from "./canadaAssets";
import { canadaMonthlyAverageRateRegistry } from "./canadaRateDisplay";
import { parseUsaManifest } from "./usaAssets";
import { monthlyAverageRateOptions } from "../lib/periodAverageRate";
import { getDisplayUnitOptions } from "../lib/units";
import type { UsaManifestSeries } from "../types/energyAssets";

const canadaManifestUrl = new URL("../../public/data/canada/manifest.json", import.meta.url);
const usaManifestUrl = new URL("../../public/data/usa/manifest.json", import.meta.url);

const ordinaryRateUnits = [
  "barrels_per_day",
  "thousand_barrels_per_day",
  "million_barrels_per_day",
  "cubic_metres_per_day",
  "thousand_cubic_metres_per_day",
] as const;

// Source measure semantics are independent of the display authorization registry.
// In particular, signed stock change is a flow; either kind of closing stock is not.
const monthlyFlowMeasures = new Set([
  "production", "field-production", "net-production", "net-inputs",
  "refinery-inputs", "processing-flow", "imports", "exports",
  "product-supplied", "stock-change", "from-united-states",
  "to-alberta", "to-british-columbia", "to-canada", "to-manitoba",
  "to-ontario", "to-quebec", "to-saskatchewan", "to-united-states",
]);
const inventoryMeasures = new Set(["ending-stocks", "transporter-closing-inventory"]);
const expandedCanadaSeriesIds = new Set([
  "can.statcan.refined.propane.field_production.monthly",
  "can.statcan.refined.propane.net_production.monthly",
  "can.statcan.refined.propane.imports.monthly",
  "can.statcan.refined.propane.exports.monthly",
  "can.statcan.refined.residual_fuel_oil.net_production.monthly",
  "can.statcan.refined.residual_fuel_oil.imports.monthly",
  "can.statcan.refined.residual_fuel_oil.exports.monthly",
  "can.statcan.refined.residual_fuel_oil.product_supplied.monthly",
  "can.statcan.refined.residual_fuel_oil.ending_stocks.monthly",
  "can.statcan.refined.residual_fuel_oil.stock_change.monthly",
  "can.statcan.crude.transporter_inventory.closing.monthly",
  "can.statcan.refined.hgl_rpp.transporter_inventory.closing.monthly",
]);
const cerExpansionSeriesIds = new Set([
  ...["propane", "butane"].flatMap((product) => (
    ["total", "padd1", "padd2", "padd3", "padd4", "padd5", "other"].map(
      (destination) => `can.cer.ngl.${product}.exports.${destination}.monthly`,
    )
  )),
  "can.cer.pipeline.trans_northern.throughput.monthly",
]);
const activeCanadaSeries: UsaManifestSeries[] = canadaSeriesRegistry.series
  .filter((series) => series.activation_status === "active")
  .map((series) => ({
    view_id: series.id,
    series_id: series.id,
    title: series.name,
    category: series.display.product_family_label,
    unit: series.unit,
    frequency: series.frequency,
    source: { name: series.provider_id === "statcan" ? "Statistics Canada" : "Canada Energy Regulator" },
    freshness: { status: "unknown" },
    classification: series.display,
    geographies: [],
    unsupported_levels: [],
  }));
const reviewedCanada81Series = activeCanadaSeries.filter(
  (series) => !cerExpansionSeriesIds.has(series.series_id),
);
const reviewedCanadaLkgSeries = reviewedCanada81Series.filter(
  (series) => !expandedCanadaSeriesIds.has(series.series_id),
);

function verifyCanadaUnitAvailability(series: UsaManifestSeries[]) {
  const statcan = series.filter((item) => item.source.name === "Statistics Canada");
  const eligible = statcan.filter((item) => monthlyFlowMeasures.has(item.classification!.measure_id));
  const inventories = statcan.filter((item) => inventoryMeasures.has(item.classification!.measure_id));
  // Unknown future measures need a reviewed semantic decision, not automatic rate eligibility.
  expect(eligible.length + inventories.length).toBe(statcan.length);
  expect(new Set(eligible.map((item) => item.series_id))).toEqual(
    new Set(canadaMonthlyAverageRateRegistry.series_ids.filter((seriesId) => (
      series.some((item) => item.series_id === seriesId)
    ))),
  );
  for (const item of statcan) {
    expect(item.frequency, item.series_id).toBe("monthly");
    expect(item.unit, item.series_id).toBe("cubic_metres");
    expect(monthlyAverageRateOptions(item).map((option) => option.id), item.series_id)
      .toEqual(monthlyFlowMeasures.has(item.classification!.measure_id) ? ordinaryRateUnits : []);
  }
  for (const inventory of inventories) {
    expect(getDisplayUnitOptions(inventory.unit).map((option) => option.id), inventory.series_id)
      .toEqual([
        "barrels", "thousand_barrels", "million_barrels",
        "cubic_metres", "thousand_cubic_metres", "million_cubic_metres",
      ]);
  }
  return { eligible, inventories };
}

describe("promoted display-unit availability", () => {
  it("offers bbl/d and every compatible rate scale for each USA ordinary-rate series", async () => {
    const manifest = parseUsaManifest(
      JSON.parse(await readFile(usaManifestUrl, "utf8")) as unknown,
    );
    const rateSeries = manifest.series.filter(
      (series) => series.unit === "thousand_barrels_per_day",
    );

    expect(rateSeries.length).toBeGreaterThanOrEqual(41);
    for (const series of rateSeries) {
      expect(
        getDisplayUnitOptions(series.unit).map((option) => option.id),
        series.series_id,
      ).toEqual(ordinaryRateUnits);
    }
  });

  it("offers daily-rate scales only for flows in a complete reviewed Canada public cohort", async () => {
    const manifest = parseCanadaManifest(
      JSON.parse(await readFile(canadaManifestUrl, "utf8")) as unknown,
    );
    expect([69, 81, 96]).toContain(manifest.series.length);
    const expected = manifest.series.length === 96
      ? activeCanadaSeries
      : manifest.series.length === 81 ? reviewedCanada81Series : reviewedCanadaLkgSeries;
    expect(manifest.series.map((series) => series.series_id).sort()).toEqual(
      expected.map((series) => series.series_id).sort(),
    );
    verifyCanadaUnitAvailability(manifest.series);
  });

  it.each([
    { cohort: "reviewed 69-series LKG", series: reviewedCanadaLkgSeries, total: 69, flows: 61, stocks: 6 },
    { cohort: "reviewed 81-series LKG", series: reviewedCanada81Series, total: 81, flows: 70, stocks: 9 },
    { cohort: "complete 96-series CER expansion", series: activeCanadaSeries, total: 96, flows: 70, stocks: 9 },
  ])("validates $cohort units before provider data is promoted", ({ series, total, flows, stocks }) => {
    expect(series).toHaveLength(total);
    const { eligible, inventories } = verifyCanadaUnitAvailability(series);
    expect(eligible).toHaveLength(flows);
    expect(inventories).toHaveLength(stocks);
  });

  it("accounts for every authorization and both transporter inventories in the full source registry", () => {
    const flows = activeCanadaSeries.filter((series) => (
      series.source.name === "Statistics Canada"
      && monthlyFlowMeasures.has(series.classification!.measure_id)
    ));
    expect(new Set(flows.map((series) => series.series_id)))
      .toEqual(new Set(canadaMonthlyAverageRateRegistry.series_ids));
    const transporterStocks = activeCanadaSeries.filter(
      (series) => series.classification?.measure_id === "transporter-closing-inventory",
    );
    expect(transporterStocks.map((series) => series.series_id).sort()).toEqual([
      "can.statcan.crude.transporter_inventory.closing.monthly",
      "can.statcan.refined.hgl_rpp.transporter_inventory.closing.monthly",
    ]);
    for (const series of transporterStocks) {
      expect(monthlyAverageRateOptions(series), series.series_id).toEqual([]);
    }
    const futureFlow = {
      ...flows[0]!,
      series_id: "can.statcan.future.production.monthly",
    };
    expect(monthlyAverageRateOptions(futureFlow)).toEqual([]);
    expect(activeCanadaSeries.filter((series) => series.source.name === "Canada Energy Regulator"))
      .toHaveLength(17);
    for (const series of activeCanadaSeries.filter(
      (item) => item.source.name === "Canada Energy Regulator",
    )) {
      expect(monthlyAverageRateOptions(series), series.series_id).toEqual([]);
    }
  });

  it("keeps CER NGL monthly export volumes in volume units and point throughput in rate units", () => {
    const added = activeCanadaSeries.filter((series) => cerExpansionSeriesIds.has(series.series_id));
    expect(new Set(added.map((series) => series.series_id))).toEqual(cerExpansionSeriesIds);
    for (const series of added) {
      expect(monthlyAverageRateOptions(series), series.series_id).toEqual([]);
      if (series.classification?.product_family_id === "cer-ngl-trade") {
        expect(series.unit).toBe("cubic_metres");
        expect(getDisplayUnitOptions(series.unit).every((unit) => unit.dimension === "volume")).toBe(true);
        expect(getDisplayUnitOptions(series.unit).some((unit) => unit.id === "barrels_per_day")).toBe(false);
      } else {
        expect(series.series_id).toBe("can.cer.pipeline.trans_northern.throughput.monthly");
        expect(series.unit).toBe("thousand_cubic_metres_per_day");
        expect(getDisplayUnitOptions(series.unit).map((unit) => unit.id)).toEqual(ordinaryRateUnits);
      }
    }
  });
});

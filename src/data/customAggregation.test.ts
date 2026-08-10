import { describe, expect, it } from "vitest";
import { customAggregationPolicy } from "./customAggregation";

describe("new regional profile aggregation authorization", () => {
  it("authorizes complete additive monthly crude PADD quantities", () => {
    for (const seriesId of [
      "usa.eia.crude.ending_stocks.monthly",
      "usa.eia.crude.stock_change.monthly",
      "usa.eia.crude.imports.monthly",
      "usa.eia.crude.exports.monthly",
      "usa.eia.crude.refinery_inputs.monthly",
      "usa.eia.crude.product_supplied.monthly",
      "usa.eia.crude.supply_adjustment.monthly",
      "usa.eia.crude.net_receipts.monthly",
      "usa.eia.crude.transfers_to_supply.monthly",
    ]) {
      expect(customAggregationPolicy("usa", seriesId, "padd"), seriesId)
        .toBeDefined();
    }
  });

  it("authorizes additive propane and residual-fuel province quantities only", () => {
    for (const seriesId of [
      "can.statcan.refined.propane.field_production.monthly",
      "can.statcan.refined.propane.net_production.monthly",
      "can.statcan.refined.propane.imports.monthly",
      "can.statcan.refined.propane.exports.monthly",
      "can.statcan.refined.residual_fuel_oil.net_production.monthly",
      "can.statcan.refined.residual_fuel_oil.imports.monthly",
      "can.statcan.refined.residual_fuel_oil.exports.monthly",
      "can.statcan.refined.residual_fuel_oil.ending_stocks.monthly",
      "can.statcan.refined.residual_fuel_oil.stock_change.monthly",
    ]) {
      expect(
        customAggregationPolicy("canada", seriesId, "province_territory"),
        seriesId,
      ).toBeDefined();
    }

    expect(customAggregationPolicy(
      "canada",
      "can.statcan.refined.residual_fuel_oil.product_supplied.monthly",
      "province_territory",
    )).toBeUndefined();
    expect(customAggregationPolicy(
      "canada",
      "can.statcan.crude.transporter_inventory.closing.monthly",
      "province_territory",
    )).toBeUndefined();
    expect(customAggregationPolicy(
      "canada",
      "can.statcan.refined.hgl_rpp.transporter_inventory.closing.monthly",
      "province_territory",
    )).toBeUndefined();
  });
});

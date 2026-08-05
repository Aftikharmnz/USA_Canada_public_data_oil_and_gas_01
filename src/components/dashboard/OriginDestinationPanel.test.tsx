import { describe, expect, it } from "vitest";
import {
  buildOriginDestinationModel,
  originDestinationSnapshot,
} from "../../charts/originDestinationModel";
import { BARREL_TO_CUBIC_METRES } from "../../lib/units";
import { originDestinationRankedOption } from "./OriginDestinationPanel";

const period = "2026-01";
const oneKbPerDayMonthlyVolume = 1_000 * BARREL_TO_CUBIC_METRES * 31;
const model = buildOriginDestinationModel({
  id: "canada.test.pipeline.movements",
  title: "Test pipeline movements",
  sourceUnit: "cubic_metres",
  frequency: "monthly",
  productLabel: "Crude oil",
  modeLabel: "Pipeline",
  origins: [{ id: "ca.ab", label: "Alberta" }],
  destinations: [{ id: "ca.on", label: "Ontario" }],
  periods: [period],
  latestPeriod: period,
  routes: [{
    id: "ca.ab-to-ca.on",
    originId: "ca.ab",
    destinationId: "ca.on",
    history: [{
      period,
      year: 2026,
      slot: 1,
      value: oneKbPerDayMonthlyVolume,
      status: "observed",
    }],
  }],
});
const snapshot = originDestinationSnapshot(model);

function firstRouteValue(
  option: ReturnType<typeof originDestinationRankedOption>,
): number {
  const series = Array.isArray(option.series) ? option.series : [option.series];
  const data = (series[0] as { data?: Array<{ value: number | null }> }).data ?? [];
  const value = data[0]?.value;
  if (typeof value !== "number") throw new Error("Expected a numeric ranked-route value.");
  return value;
}

describe("originDestinationRankedOption monthly-average display", () => {
  it("renders bbl/d without throwing and scales route values 1,000x from kb/d", () => {
    const kbPerDay = originDestinationRankedOption(
      model,
      snapshot,
      "thousand_barrels_per_day",
      true,
    );
    const barrelsPerDay = originDestinationRankedOption(
      model,
      snapshot,
      "barrels_per_day",
      true,
    );
    const kbValue = firstRouteValue(kbPerDay);
    const barrelValue = firstRouteValue(barrelsPerDay);

    expect(kbValue).toBeCloseTo(1, 12);
    expect(barrelValue).toBeCloseTo(1_000, 9);
    expect(barrelValue / kbValue).toBeCloseTo(1_000, 12);
  });
});

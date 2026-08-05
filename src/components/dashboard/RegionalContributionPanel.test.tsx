import { describe, expect, it } from "vitest";
import type { RegionalContributionModel } from "../../charts/regionalContributionModel";
import type { RegionalContributionSpec } from "../../data/regionalContributions";
import { BARREL_TO_CUBIC_METRES } from "../../lib/units";
import { regionalContributionOption } from "./RegionalContributionPanel";

const period = "2026-01";
const oneKbPerDayMonthlyVolume = 1_000 * BARREL_TO_CUBIC_METRES * 31;

const component = {
  geographyId: "ca.ab",
  label: "Alberta",
  value: oneKbPerDayMonthlyVolume / 2,
  status: "observed",
  previousPeriod: null,
  previousValue: null,
  shareOfNational: 50,
};

const contributionPeriod = {
  period,
  nationalValue: oneKbPerDayMonthlyVolume,
  nationalStatus: "observed",
  components: [component],
  numericComponentCount: 1,
  expectedComponentCount: 1,
  componentSum: component.value,
  complete: true,
  reconciliationDifference: oneKbPerDayMonthlyVolume - component.value,
};

const model: RegionalContributionModel = {
  periods: [contributionPeriod],
  latest: contributionPeriod,
  sourceUnit: "cubic_metres",
  frequency: "monthly",
  methodologyVersion: "test-monthly-average-rate",
};

const spec: RegionalContributionSpec = {
  country: "canada",
  componentLevelId: "province_territory",
  componentLevelLabel: "province or territory",
  nationalGeographyId: "ca",
  nationalLabel: "Canada",
  nationalAssetPath: "national.json",
  components: [{ geographyId: "ca.ab", label: "Alberta", assetPath: "alberta.json" }],
  title: "Province contribution to official imports",
  description: "Test",
  geographyDisclosure: "Test",
};

function seriesValues(option: ReturnType<typeof regionalContributionOption>): number[][] {
  const series = Array.isArray(option.series) ? option.series : [option.series];
  return series.map((item) => (
    ((item as { data?: Array<number | null> }).data ?? [])
      .filter((value): value is number => typeof value === "number")
  ));
}

describe("regionalContributionOption monthly-average display", () => {
  it("renders bbl/d without throwing and scales values 1,000x from kb/d", () => {
    const kbPerDay = regionalContributionOption(
      model,
      spec,
      "thousand_barrels_per_day",
      true,
    );
    const barrelsPerDay = regionalContributionOption(
      model,
      spec,
      "barrels_per_day",
      true,
    );
    const kbValues = seriesValues(kbPerDay);
    const barrelValues = seriesValues(barrelsPerDay);

    expect(kbValues).toEqual([
      [expect.closeTo(0.5, 12)],
      [expect.closeTo(1, 12)],
    ]);
    expect(barrelValues).toEqual([
      [expect.closeTo(500, 9)],
      [expect.closeTo(1_000, 9)],
    ]);
    expect(barrelValues[0]![0]! / kbValues[0]![0]!).toBeCloseTo(1_000, 12);
    expect(barrelValues[1]![0]! / kbValues[1]![0]!).toBeCloseTo(1_000, 12);
  });
});

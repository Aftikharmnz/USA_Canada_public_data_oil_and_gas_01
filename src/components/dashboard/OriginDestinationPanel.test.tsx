import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  buildOriginDestinationModel,
  originDestinationSnapshot,
} from "../../charts/originDestinationModel";
import { BARREL_TO_CUBIC_METRES } from "../../lib/units";
import {
  OriginDestinationPanel,
  originDestinationRankedOption,
} from "./OriginDestinationPanel";

const period = "2026-01";
const previousPeriod = "2025-12";
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
  periods: [previousPeriod, period],
  latestPeriod: period,
  routes: [{
    id: "ca.ab-to-ca.on",
    originId: "ca.ab",
    destinationId: "ca.on",
    history: [{
      period: previousPeriod,
      year: 2025,
      slot: 12,
      value: oneKbPerDayMonthlyVolume / 2,
      status: "observed",
    }, {
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

  it("keeps route coverage and source-boundary warnings visible while collapsing the exact table", () => {
    const html = renderToStaticMarkup(
      <OriginDestinationPanel
        model={model}
        displayUnit="million_cubic_metres"
        onDisplayUnitChange={() => undefined}
        title="Province movements"
        description="Long route instructions belong in details."
        sourceDisclosure="This view is pipeline only; unavailable routes are not stale-filled."
      />,
    );
    const hiddenRegionIndex = html.indexOf('class="chart-details-toggle-content"');
    const visible = html.slice(0, hiddenRegionIndex);
    const details = html.slice(hiddenRegionIndex);

    expect(visible).toContain("Jan 2026");
    expect(visible).toContain('aria-label="Movement source period"');
    expect(visible).toContain('value="2025-12"');
    expect(visible).toContain("Dec 2025");
    expect(visible).toContain("Crude oil");
    expect(visible).toContain("Pipeline");
    expect(visible).toContain('aria-label="Convert chart values to display unit"');
    expect(visible).toContain("Gross directions are not netted.");
    expect(visible).toContain("missing ≠ zero");
    expect(visible).toContain("pipeline only; overlapping Canada aggregates excluded");
    expect(visible).not.toContain("1</strong> numeric routes");
    expect(visible).not.toContain("Long route instructions belong in details.");
    expect(details).toContain('hidden=""');
    expect(details).toContain("1</strong> numeric routes");
    expect(details).toContain("0</strong> declared routes without a numeric value");
    expect(details).toContain("Long route instructions belong in details.");
    expect(details).toContain("exact-period route observations");
    expect(details).toContain("remain distinct from numeric zero");
    expect(details).toContain("This view is pipeline only");
    expect(details).not.toContain('aria-label="Movement source period"');
  });

  it("uses an explicitly selected historical source period", () => {
    const html = renderToStaticMarkup(
      <OriginDestinationPanel
        model={model}
        initialPeriod={previousPeriod}
        displayUnit="million_cubic_metres"
        title="Province movements"
      />,
    );
    const hiddenRegionIndex = html.indexOf('class="chart-details-toggle-content"');
    const visible = html.slice(0, hiddenRegionIndex);

    expect(visible).toContain('aria-label="Movement source period"');
    expect(visible).toContain('<option value="2025-12" selected="">Dec 2025</option>');
    expect(visible).toContain("Crude oil, Pipeline, Dec 2025");
  });
});

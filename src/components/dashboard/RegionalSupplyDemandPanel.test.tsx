import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import type { RegionalSupplyDemandSnapshotRow } from "../../charts/regionalSupplyDemandModel";
import { BARREL_TO_CUBIC_METRES } from "../../lib/units";
import { supplyDemandDisplayValue, supplyDemandOption } from "./RegionalSupplyDemandPanel";

const dailyVolume = 1_000 * BARREL_TO_CUBIC_METRES;
const row: RegionalSupplyDemandSnapshotRow = {
  seriesId: "can.statcan.refined.gasoline.finished.imports.monthly",
  measureId: "imports", label: "Imports", unit: "cubic_metres", frequency: "monthly",
  isStock: false, isDerived: false, sourceName: "Statistics Canada", sourceChecksum: "a".repeat(64),
  history: [], value: 28 * dailyVolume, status: "observed", previousValue: 31 * dailyVolume,
  previousPeriod: "2026-01", delta: -3 * dailyVolume, latestPeriod: "2026-02",
};

function values(option: ReturnType<typeof supplyDemandOption>) {
  return (option.series as Array<{ data: Array<number | null> }>).map((series) => series.data);
}

describe("regional component comparison display", () => {
  it("normalizes current and previous monthly flows by their own calendar days", () => {
    const option = supplyDemandOption([row], "2026-02", "2026-01", "thousand_barrels_per_day", true);
    expect(values(option)[0]![0]).toBeCloseTo(1, 12);
    expect(values(option)[1]![0]).toBeCloseTo(1, 12);
    const barrels = supplyDemandOption([row], "2026-02", "2026-01", "barrels_per_day", true);
    expect(values(barrels)[0]![0]).toBeCloseTo(1_000, 9);
    expect(values(barrels)[1]![0]).toBeCloseTo(1_000, 9);
  });

  it("retains signed source net inputs and does not negate exports or stack independent terms", () => {
    const inputs = { ...row, label: "Refinery & blender net inputs", measureId: "net-inputs", value: -341_818 };
    const exports = { ...row, measureId: "exports", label: "Exports", value: 3_045 };
    const option = supplyDemandOption([inputs, exports], "2026-02", "2026-01", "cubic_metres", false);
    expect(values(option)).toEqual([[-341_818, 3_045]]);
    expect((option.series as Array<{ stack?: string }>).every((series) => series.stack === undefined)).toBe(true);
  });

  it("keeps suppressed and missing observations null and displays their status in hover text", () => {
    const missing = { ...row, value: null, status: "suppressed_or_withheld" };
    const option = supplyDemandOption([missing], "2026-02", "2026-01", "cubic_metres", true);
    expect(values(option)[0]).toEqual([null]);
    const tooltip = option.tooltip as { renderMode: string; formatter: (params: unknown) => string };
    expect(tooltip.renderMode).toBe("richText");
    expect(tooltip.formatter([{ dataIndex: 0 }])).toContain("suppressed_or_withheld");
    expect(tooltip.formatter([{ dataIndex: 0 }])).not.toContain("Change:");
  });

  it("keeps stock levels volume-only and refuses unregistered daily-rate derivation", () => {
    const stock = { ...row, isStock: true, measureId: "ending-stocks" };
    expect(() => supplyDemandDisplayValue(stock, 100, "2026-02", "barrels_per_day"))
      .toThrow(/Cannot convert/);
    expect(() => supplyDemandDisplayValue({ ...row, seriesId: "unregistered" }, 100, "2026-02", "barrels_per_day"))
      .toThrow(/Cannot convert/);
    expect(supplyDemandDisplayValue(stock, 1_000 * BARREL_TO_CUBIC_METRES, "2026-02", "thousand_barrels"))
      .toBeCloseTo(1, 12);
  });

  it("omits the previous-period series when comparison is switched off", () => {
    expect(values(supplyDemandOption([row], "2026-02", "2026-01", "cubic_metres", false)))
      .toHaveLength(1);
  });

  it("reserves a compact expand hit area and honors the hidden modal trigger", () => {
    const panelCss = readFileSync(new URL("./regionalSupplyDemand.css", import.meta.url), "utf8");
    const sharedCss = readFileSync(new URL("../../styles.css", import.meta.url), "utf8");
    expect(panelCss).toMatch(/\.supply-demand-panel \.profile-expand-button\s*\{\s*inset:\.45rem \.45rem auto auto;/);
    expect(panelCss).toMatch(/\.supply-demand-panel \.profile-card-heading\s*\{\s*padding-right:4\.25rem;/);
    expect(sharedCss).toMatch(/\.profile-expand-button\[hidden\]\s*\{\s*display:\s*none;/);
  });
});

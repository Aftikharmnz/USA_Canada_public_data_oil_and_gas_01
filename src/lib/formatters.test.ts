import { describe, expect, it } from "vitest";
import {
  formatDisplayNumber,
  formatDisplayValue,
  formatPlainNumber,
  formatValue,
} from "./formatters";
import type { DisplayUnitId } from "./units";

describe("magnitude-aware unit formatting", () => {
  it.each<DisplayUnitId>([
    "barrels_per_day",
    "cubic_metres_per_day",
    "thousand_barrels_per_day",
    "million_barrels_per_day",
  ])("never rounds finite nonzero %s values to zero", (unit) => {
    const positive = formatDisplayValue(0.2029, unit, unit);
    const negative = formatDisplayValue(-0.4058, unit, unit);

    expect(positive).not.toMatch(/^0(?:\.0+)?\s/);
    expect(negative).not.toMatch(/^-0(?:\.0+)?\s/);
    expect(Number.parseFloat(positive)).toBeGreaterThan(0);
    expect(Number.parseFloat(negative)).toBeLessThan(0);
  });

  it("uses significant digits for sub-unit bbl/d values in regular and compact contexts", () => {
    expect(formatDisplayValue(0.2029, "barrels_per_day", "barrels_per_day"))
      .toBe("0.203 bbl/d");
    expect(formatDisplayValue(-0.4058, "barrels_per_day", "barrels_per_day"))
      .toBe("-0.406 bbl/d");
    expect(formatDisplayValue(0.2029, "barrels_per_day", "barrels_per_day", true))
      .toBe("0.203 bbl/d");
    expect(formatDisplayNumber(-0.4058, "cubic_metres_per_day", true)).toBe("-0.406");
  });

  it("covers generic and compact number paths used outside source-unit conversions", () => {
    expect(formatValue(0.002029, "kb/d")).toBe("0.00203 kb/d");
    expect(formatValue(-0.004058, "kb/d", true)).toBe("-0.00406 kb/d");
    expect(formatPlainNumber(0.02029, 1)).toBe("0.0203");
    expect(formatPlainNumber(-0.04058, 1)).toBe("-0.0406");
  });

  it("preserves very small magnitudes and normalizes actual negative zero", () => {
    expect(formatDisplayValue(0.0002, "thousand_barrels_per_day", "thousand_barrels_per_day"))
      .toBe("0.0002 kb/d");
    expect(formatDisplayValue(-0.0000002, "million_barrels_per_day", "million_barrels_per_day"))
      .toBe("-2E-7 MMbbl/d");
    expect(formatDisplayValue(-0, "barrels_per_day", "barrels_per_day")).toBe("0 bbl/d");
    expect(formatValue(-0, "barrels_per_day", true)).toBe("0 bbl/d");
    expect(formatPlainNumber(-0, 1)).toBe("0");
  });
});

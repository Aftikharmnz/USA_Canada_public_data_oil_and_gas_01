import { describe, expect, it } from "vitest";
import {
  BARREL_TO_CUBIC_METRES,
  SUPPORTED_CANONICAL_UNITS,
  UnitConversionError,
  convertUnitValue,
  getDisplayUnitOptions,
  getNativeUnitOption,
  getSourceUnitLabel,
  getUnitFormattingMetadata,
  isCanonicalUnit,
  isDisplayUnit,
} from "./units";

describe("unit catalog", () => {
  it("recognizes every current canonical unit and rejects unknown units", () => {
    for (const unit of SUPPORTED_CANONICAL_UNITS) {
      expect(isCanonicalUnit(unit)).toBe(true);
      expect(isDisplayUnit(unit)).toBe(true);
    }

    expect(isCanonicalUnit("million_litres")).toBe(false);
    expect(isDisplayUnit("million_litres")).toBe(false);
  });

  it("provides an explicit native option and source labels", () => {
    const native = getNativeUnitOption("thousand_barrels");

    expect(native).toMatchObject({
      id: "thousand_barrels",
      dimension: "volume",
      compactLabel: "kbbl",
      longLabel: "Thousand barrels",
      isSourceUnit: true,
    });
    expect(getSourceUnitLabel("thousand_barrels")).toBe("Thousand barrels");
    expect(getSourceUnitLabel("thousand_barrels", true)).toBe("kbbl");
    expect(getSourceUnitLabel("provider_special_unit")).toBe("provider special unit");
  });

  it("labels thousand-barrel daily rates with the trader-facing kb/d abbreviation", () => {
    const native = getNativeUnitOption("thousand_barrels_per_day");

    expect(native).toMatchObject({
      id: "thousand_barrels_per_day",
      compactLabel: "kb/d",
      longLabel: "Thousand barrels per day",
      isSourceUnit: true,
    });
    expect(getSourceUnitLabel("thousand_barrels_per_day", true)).toBe("kb/d");
  });

  it("fails closed when an asset carries an unknown canonical unit", () => {
    expect(getDisplayUnitOptions("litres_per_fortnight")).toEqual([]);
    expect(getNativeUnitOption("litres_per_fortnight")).toBeNull();
    expect(getUnitFormattingMetadata("litres_per_fortnight")).toBeNull();
  });

  it("returns only options in the source unit's physical and semantic dimension", () => {
    const volume = getDisplayUnitOptions("cubic_metres");
    const dailyRate = getDisplayUnitOptions("barrels_per_day");
    const calendarDayRate = getDisplayUnitOptions("thousand_barrels_per_calendar_day");

    expect(new Set(volume.map((option) => option.dimension))).toEqual(new Set(["volume"]));
    expect(volume.map((option) => option.id)).toContain("million_cubic_metres");
    expect(volume.map((option) => option.id)).not.toContain("barrels_per_day");

    expect(new Set(dailyRate.map((option) => option.dimension))).toEqual(new Set(["flow_rate"]));
    expect(dailyRate.map((option) => option.id)).toContain("thousand_cubic_metres_per_day");
    expect(dailyRate.map((option) => option.id)).not.toContain("cubic_metres");

    expect(new Set(calendarDayRate.map((option) => option.dimension))).toEqual(
      new Set(["calendar_day_rate"]),
    );
    expect(calendarDayRate.map((option) => option.id)).toContain(
      "cubic_metres_per_calendar_day",
    );
    expect(calendarDayRate.map((option) => option.id)).not.toContain("cubic_metres_per_day");
  });

  it("keeps percent fixed to its source unit", () => {
    expect(getDisplayUnitOptions("percent")).toEqual([
      expect.objectContaining({ id: "percent", isSourceUnit: true }),
    ]);
    expect(convertUnitValue(87.25, "percent", "percent")).toBe(87.25);
  });

  it("keeps days as a source-only duration without cross-unit conversions", () => {
    expect(getDisplayUnitOptions("days")).toEqual([
      expect.objectContaining({
        id: "days",
        dimension: "duration",
        compactLabel: "days",
        longLabel: "Days",
        isSourceUnit: true,
      }),
    ]);
    expect(getSourceUnitLabel("days")).toBe("Days");
    expect(getUnitFormattingMetadata("days")?.numberFormat).toEqual({
      minimumFractionDigits: 0,
      maximumFractionDigits: 1,
      useGrouping: true,
    });
    expect(convertUnitValue(27.4, "days", "days")).toBe(27.4);
    expect(() => convertUnitValue(27.4, "days", "percent")).toThrow(/Cannot convert/);
    expect(() => convertUnitValue(27.4, "days", "thousand_barrels")).toThrow(/Cannot convert/);
  });

  it("exposes number-format metadata alongside unambiguous labels", () => {
    expect(getUnitFormattingMetadata("million_barrels_per_day")).toEqual({
      compactLabel: "MMbbl/d",
      longLabel: "Million barrels per day",
      numberFormat: {
        minimumFractionDigits: 0,
        maximumFractionDigits: 3,
        useGrouping: true,
      },
    });
  });
});

describe("convertUnitValue", () => {
  it("uses the exact barrel-to-cubic-metre constant for volumes", () => {
    expect(convertUnitValue(0.001, "thousand_barrels", "cubic_metres")).toBe(
      BARREL_TO_CUBIC_METRES,
    );
    expect(convertUnitValue(1, "cubic_metres", "barrels")).toBeCloseTo(
      1 / BARREL_TO_CUBIC_METRES,
      12,
    );
  });

  it("converts volume scales in either direction without rounding", () => {
    expect(convertUnitValue(2_500, "thousand_barrels", "million_barrels")).toBe(2.5);
    expect(convertUnitValue(2.5, "million_cubic_metres", "cubic_metres")).toBe(2_500_000);
  });

  it("converts ordinary flow-rate scales and systems", () => {
    expect(convertUnitValue(1, "thousand_barrels_per_day", "barrels_per_day")).toBe(1_000);
    expect(convertUnitValue(1, "thousand_barrels_per_day", "cubic_metres_per_day")).toBe(
      1_000 * BARREL_TO_CUBIC_METRES,
    );
    expect(
      convertUnitValue(1, "thousand_cubic_metres_per_day", "thousand_barrels_per_day"),
    ).toBeCloseTo(1 / BARREL_TO_CUBIC_METRES, 12);
  });

  it("converts calendar-day rates without relabelling them as ordinary daily rates", () => {
    expect(
      convertUnitValue(
        1,
        "thousand_barrels_per_calendar_day",
        "cubic_metres_per_calendar_day",
      ),
    ).toBe(1_000 * BARREL_TO_CUBIC_METRES);
    expect(() =>
      convertUnitValue(
        1,
        "thousand_barrels_per_calendar_day",
        "thousand_barrels_per_day",
      ),
    ).toThrow(UnitConversionError);
  });

  it("preserves null and the sign of negative observations", () => {
    expect(convertUnitValue(null, "thousand_barrels", "cubic_metres")).toBeNull();
    expect(convertUnitValue(-2, "thousand_barrels", "barrels")).toBe(-2_000);
  });

  it("rejects volume-to-rate and percentage conversions", () => {
    expect(() => convertUnitValue(1, "thousand_barrels", "barrels_per_day")).toThrow(
      /Cannot convert/,
    );
    expect(() => convertUnitValue(1, "percent", "thousand_barrels")).toThrow(/Cannot convert/);
  });

  it("rejects unsupported units and non-finite numeric values", () => {
    expect(() => convertUnitValue(1, "litres", "cubic_metres")).toThrow(/Unsupported source/);
    expect(() => convertUnitValue(1, "cubic_metres", "litres")).toThrow(/Unsupported target/);
    expect(() => convertUnitValue(Number.NaN, "cubic_metres", "barrels")).toThrow(/finite/);
    expect(() => convertUnitValue(Number.POSITIVE_INFINITY, "cubic_metres", "barrels")).toThrow(
      /finite/,
    );
  });
});

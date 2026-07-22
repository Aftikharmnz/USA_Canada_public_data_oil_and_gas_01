/** Exact physical conversion used for all petroleum volume displays. */
export const BARREL_TO_CUBIC_METRES = 0.158987294928;

export const SUPPORTED_CANONICAL_UNITS = [
  "thousand_barrels",
  "thousand_barrels_per_day",
  "thousand_barrels_per_calendar_day",
  "barrels_per_day",
  "cubic_metres",
  "thousand_cubic_metres_per_day",
  "percent",
  "days",
] as const;

export type CanonicalUnit = (typeof SUPPORTED_CANONICAL_UNITS)[number];

export type UnitDimension =
  | "volume"
  | "flow_rate"
  | "calendar_day_rate"
  | "percent"
  | "duration";

export type DisplayUnitId =
  | "barrels"
  | "thousand_barrels"
  | "million_barrels"
  | "cubic_metres"
  | "thousand_cubic_metres"
  | "million_cubic_metres"
  | "barrels_per_day"
  | "thousand_barrels_per_day"
  | "million_barrels_per_day"
  | "cubic_metres_per_day"
  | "thousand_cubic_metres_per_day"
  | "barrels_per_calendar_day"
  | "thousand_barrels_per_calendar_day"
  | "million_barrels_per_calendar_day"
  | "cubic_metres_per_calendar_day"
  | "thousand_cubic_metres_per_calendar_day"
  | "percent"
  | "days";

export interface UnitFormattingMetadata {
  /** Compact, unambiguous label for axes, cards, and table columns. */
  compactLabel: string;
  /** Expanded label for controls and accessible descriptions. */
  longLabel: string;
  /** Defaults that can be passed to Intl.NumberFormat. */
  numberFormat: Readonly<{
    minimumFractionDigits: number;
    maximumFractionDigits: number;
    useGrouping: boolean;
  }>;
}

export interface DisplayUnitOption extends UnitFormattingMetadata {
  id: DisplayUnitId;
  dimension: UnitDimension;
  /** True only for the provider/canonical unit carried by the active asset. */
  isSourceUnit: boolean;
}

interface UnitDefinition extends UnitFormattingMetadata {
  dimension: UnitDimension;
  /** Quantity in the dimension's internal conversion base represented by one displayed unit. */
  baseAmountPerUnit: number;
}

const numberFormat = (
  maximumFractionDigits: number,
  minimumFractionDigits = 0,
): UnitFormattingMetadata["numberFormat"] => ({
  minimumFractionDigits,
  maximumFractionDigits,
  useGrouping: true,
});

const UNIT_DEFINITIONS: Record<DisplayUnitId, UnitDefinition> = {
  barrels: {
    dimension: "volume",
    baseAmountPerUnit: BARREL_TO_CUBIC_METRES,
    compactLabel: "bbl",
    longLabel: "Barrels",
    numberFormat: numberFormat(0),
  },
  thousand_barrels: {
    dimension: "volume",
    baseAmountPerUnit: 1_000 * BARREL_TO_CUBIC_METRES,
    compactLabel: "kbbl",
    longLabel: "Thousand barrels",
    numberFormat: numberFormat(2),
  },
  million_barrels: {
    dimension: "volume",
    baseAmountPerUnit: 1_000_000 * BARREL_TO_CUBIC_METRES,
    compactLabel: "MMbbl",
    longLabel: "Million barrels",
    numberFormat: numberFormat(3),
  },
  cubic_metres: {
    dimension: "volume",
    baseAmountPerUnit: 1,
    compactLabel: "m³",
    longLabel: "Cubic metres",
    numberFormat: numberFormat(0),
  },
  thousand_cubic_metres: {
    dimension: "volume",
    baseAmountPerUnit: 1_000,
    compactLabel: "10³ m³",
    longLabel: "Thousand cubic metres",
    numberFormat: numberFormat(2),
  },
  million_cubic_metres: {
    dimension: "volume",
    baseAmountPerUnit: 1_000_000,
    compactLabel: "10⁶ m³",
    longLabel: "Million cubic metres",
    numberFormat: numberFormat(3),
  },
  barrels_per_day: {
    dimension: "flow_rate",
    baseAmountPerUnit: BARREL_TO_CUBIC_METRES,
    compactLabel: "bbl/d",
    longLabel: "Barrels per day",
    numberFormat: numberFormat(0),
  },
  thousand_barrels_per_day: {
    dimension: "flow_rate",
    baseAmountPerUnit: 1_000 * BARREL_TO_CUBIC_METRES,
    compactLabel: "kb/d",
    longLabel: "Thousand barrels per day",
    numberFormat: numberFormat(2),
  },
  million_barrels_per_day: {
    dimension: "flow_rate",
    baseAmountPerUnit: 1_000_000 * BARREL_TO_CUBIC_METRES,
    compactLabel: "MMbbl/d",
    longLabel: "Million barrels per day",
    numberFormat: numberFormat(3),
  },
  cubic_metres_per_day: {
    dimension: "flow_rate",
    baseAmountPerUnit: 1,
    compactLabel: "m³/d",
    longLabel: "Cubic metres per day",
    numberFormat: numberFormat(0),
  },
  thousand_cubic_metres_per_day: {
    dimension: "flow_rate",
    baseAmountPerUnit: 1_000,
    compactLabel: "10³ m³/d",
    longLabel: "Thousand cubic metres per day",
    numberFormat: numberFormat(2),
  },
  barrels_per_calendar_day: {
    dimension: "calendar_day_rate",
    baseAmountPerUnit: BARREL_TO_CUBIC_METRES,
    compactLabel: "bbl/cd",
    longLabel: "Barrels per calendar day",
    numberFormat: numberFormat(0),
  },
  thousand_barrels_per_calendar_day: {
    dimension: "calendar_day_rate",
    baseAmountPerUnit: 1_000 * BARREL_TO_CUBIC_METRES,
    compactLabel: "kbbl/cd",
    longLabel: "Thousand barrels per calendar day",
    numberFormat: numberFormat(2),
  },
  million_barrels_per_calendar_day: {
    dimension: "calendar_day_rate",
    baseAmountPerUnit: 1_000_000 * BARREL_TO_CUBIC_METRES,
    compactLabel: "MMbbl/cd",
    longLabel: "Million barrels per calendar day",
    numberFormat: numberFormat(3),
  },
  cubic_metres_per_calendar_day: {
    dimension: "calendar_day_rate",
    baseAmountPerUnit: 1,
    compactLabel: "m³/cd",
    longLabel: "Cubic metres per calendar day",
    numberFormat: numberFormat(0),
  },
  thousand_cubic_metres_per_calendar_day: {
    dimension: "calendar_day_rate",
    baseAmountPerUnit: 1_000,
    compactLabel: "10³ m³/cd",
    longLabel: "Thousand cubic metres per calendar day",
    numberFormat: numberFormat(2),
  },
  percent: {
    dimension: "percent",
    baseAmountPerUnit: 1,
    compactLabel: "%",
    longLabel: "Percent",
    numberFormat: numberFormat(1),
  },
  days: {
    dimension: "duration",
    baseAmountPerUnit: 1,
    compactLabel: "days",
    longLabel: "Days",
    numberFormat: numberFormat(1),
  },
};

const VOLUME_OPTIONS: readonly DisplayUnitId[] = [
  "barrels",
  "thousand_barrels",
  "million_barrels",
  "cubic_metres",
  "thousand_cubic_metres",
  "million_cubic_metres",
];

const FLOW_RATE_OPTIONS: readonly DisplayUnitId[] = [
  "barrels_per_day",
  "thousand_barrels_per_day",
  "million_barrels_per_day",
  "cubic_metres_per_day",
  "thousand_cubic_metres_per_day",
];

const CALENDAR_DAY_RATE_OPTIONS: readonly DisplayUnitId[] = [
  "barrels_per_calendar_day",
  "thousand_barrels_per_calendar_day",
  "million_barrels_per_calendar_day",
  "cubic_metres_per_calendar_day",
  "thousand_cubic_metres_per_calendar_day",
];

const OPTIONS_BY_DIMENSION: Record<UnitDimension, readonly DisplayUnitId[]> = {
  volume: VOLUME_OPTIONS,
  flow_rate: FLOW_RATE_OPTIONS,
  calendar_day_rate: CALENDAR_DAY_RATE_OPTIONS,
  percent: ["percent"],
  duration: ["days"],
};

export class UnitConversionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UnitConversionError";
  }
}

export function isCanonicalUnit(unit: string): unit is CanonicalUnit {
  return (SUPPORTED_CANONICAL_UNITS as readonly string[]).includes(unit);
}

export function isDisplayUnit(unit: string): unit is DisplayUnitId {
  return Object.hasOwn(UNIT_DEFINITIONS, unit);
}

/**
 * Returns the provider/canonical unit's human-readable label without changing its semantics.
 * Unknown values remain visible instead of being silently mapped to a known unit.
 */
export function getSourceUnitLabel(unit: string, compact = false): string {
  if (!isDisplayUnit(unit)) return unit.replaceAll("_", " ");
  return compact ? UNIT_DEFINITIONS[unit].compactLabel : UNIT_DEFINITIONS[unit].longLabel;
}

/** Valid display choices for a canonical asset unit. Unknown source units fail closed. */
export function getDisplayUnitOptions(sourceUnit: string): readonly DisplayUnitOption[] {
  if (!isCanonicalUnit(sourceUnit)) return [];

  const sourceDefinition = UNIT_DEFINITIONS[sourceUnit];
  return OPTIONS_BY_DIMENSION[sourceDefinition.dimension].map((id) => {
    const definition = UNIT_DEFINITIONS[id];
    return {
      id,
      dimension: definition.dimension,
      compactLabel: definition.compactLabel,
      longLabel: definition.longLabel,
      numberFormat: definition.numberFormat,
      isSourceUnit: id === sourceUnit,
    };
  });
}

export function getNativeUnitOption(sourceUnit: string): DisplayUnitOption | null {
  return getDisplayUnitOptions(sourceUnit).find((option) => option.isSourceUnit) ?? null;
}

export function resolveDisplayUnit(
  sourceUnit: string,
  requested?: string,
): DisplayUnitId | null {
  const options = getDisplayUnitOptions(sourceUnit);
  return options.find((option) => option.id === requested)?.id
    ?? options.find((option) => option.isSourceUnit)?.id
    ?? null;
}

const PAIRED_VOLUME_AND_RATE_UNITS: ReadonlyArray<readonly [DisplayUnitId, DisplayUnitId]> = [
  ["barrels", "barrels_per_day"],
  ["thousand_barrels", "thousand_barrels_per_day"],
  ["million_barrels", "million_barrels_per_day"],
  ["cubic_metres", "cubic_metres_per_day"],
  ["thousand_cubic_metres", "thousand_cubic_metres_per_day"],
];

/** Match a selected volume scale to the equivalent ordinary daily-rate scale, or vice versa. */
export function pairedVolumeRateDisplayUnit(
  unit: DisplayUnitId,
  targetDimension: "volume" | "flow_rate",
): DisplayUnitId | null {
  const pair = PAIRED_VOLUME_AND_RATE_UNITS.find(([volume, rate]) => (
    volume === unit || rate === unit
  ));
  if (!pair) return null;
  return targetDimension === "volume" ? pair[0] : pair[1];
}

export function getUnitFormattingMetadata(unit: string): UnitFormattingMetadata | null {
  if (!isDisplayUnit(unit)) return null;
  const definition = UNIT_DEFINITIONS[unit];
  return {
    compactLabel: definition.compactLabel,
    longLabel: definition.longLabel,
    numberFormat: definition.numberFormat,
  };
}

/**
 * Converts a canonical/display value within one physical and semantic dimension.
 * Volume, ordinary daily rates, calendar-day rates, percentages, and durations never cross dimensions.
 */
export function convertUnitValue(
  value: number | null,
  sourceUnit: string,
  targetUnit: string,
): number | null {
  if (!isDisplayUnit(sourceUnit)) {
    throw new UnitConversionError(`Unsupported source unit: ${sourceUnit}`);
  }
  if (!isDisplayUnit(targetUnit)) {
    throw new UnitConversionError(`Unsupported target unit: ${targetUnit}`);
  }

  const source = UNIT_DEFINITIONS[sourceUnit];
  const target = UNIT_DEFINITIONS[targetUnit];
  if (source.dimension !== target.dimension) {
    throw new UnitConversionError(
      `Cannot convert ${sourceUnit} (${source.dimension}) to ${targetUnit} (${target.dimension})`,
    );
  }

  if (value === null) return null;
  if (!Number.isFinite(value)) {
    throw new UnitConversionError("Unit conversion requires a finite number or null");
  }

  return value * (source.baseAmountPerUnit / target.baseAmountPerUnit);
}

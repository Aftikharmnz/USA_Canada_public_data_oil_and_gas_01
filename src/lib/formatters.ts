import {
  convertUnitValue,
  getUnitFormattingMetadata,
  type DisplayUnitId,
} from "./units";

const unitSuffixes: Record<string, string> = {
  percent: "%",
  barrels: "bbl",
  thousand_barrels: "kbbl",
  million_barrels: "MMbbl",
  thousand_barrels_per_day: "kb/d",
  million_barrels_per_day: "MMbbl/d",
  barrels_per_calendar_day: "bbl/cd",
  thousand_barrels_per_calendar_day: "kbbl/cd",
  million_barrels_per_calendar_day: "MMbbl/cd",
  barrels_per_day: "bbl/d",
  cubic_metres: "m³",
  thousand_cubic_metres: "10³ m³",
  million_cubic_metres: "10⁶ m³",
  cubic_metres_per_day: "m³/d",
  thousand_cubic_metres_per_day: "10³ m³/d",
  cubic_metres_per_calendar_day: "m³/cd",
  thousand_cubic_metres_per_calendar_day: "10³ m³/cd",
  "percentage points": "percentage points",
};

export function compactUnit(unit: string): string {
  return unitSuffixes[unit.toLowerCase()] ?? unit.replaceAll("_", " ");
}

function magnitudeAwareNumber(
  value: number,
  options: Intl.NumberFormatOptions,
  compact: boolean,
): string {
  // Intl preserves the sign bit on negative zero, even though it represents no
  // direction or quantity. Normalize it before any formatting decision.
  const normalized = Object.is(value, -0) ? 0 : value;
  const notation = compact && Math.abs(normalized) >= 10_000 ? "compact" : "standard";
  const formatter = new Intl.NumberFormat("en-US", { ...options, notation });
  const rendered = formatter.format(normalized);
  if (normalized === 0) return rendered;

  const hasVisibleNonzeroDigit = formatter.formatToParts(normalized).some((part) => (
    (part.type === "integer" || part.type === "fraction") && /[1-9]/.test(part.value)
  ));
  if (hasVisibleNonzeroDigit) return rendered;

  // Fixed unit precision can otherwise turn a real small flow into 0 or -0.
  // Fall back to three significant digits; scientific notation keeps extreme
  // magnitudes readable without ever misrepresenting a nonzero value as zero.
  const {
    minimumFractionDigits: _minimumFractionDigits,
    maximumFractionDigits: _maximumFractionDigits,
    minimumSignificantDigits: _minimumSignificantDigits,
    maximumSignificantDigits: _maximumSignificantDigits,
    ...significantOptions
  } = options;
  return new Intl.NumberFormat("en-US", {
    ...significantOptions,
    notation: Math.abs(normalized) < 0.000001 ? "scientific" : "standard",
    maximumSignificantDigits: 3,
  }).format(normalized);
}

export function formatValue(value: number | null, unit: string, compact = false): string {
  if (value === null || !Number.isFinite(value)) return "Not available";
  const maximumFractionDigits = Math.abs(value) < 10 ? 2 : Math.abs(value) < 1000 ? 1 : 0;
  const rendered = magnitudeAwareNumber(value, {
    maximumFractionDigits,
  }, compact);
  return `${rendered} ${compactUnit(unit)}`.trim();
}

export function formatPlainNumber(value: number | null, digits = 1): string {
  if (value === null || !Number.isFinite(value)) return "—";
  return magnitudeAwareNumber(value, { maximumFractionDigits: digits }, false);
}

export function formatPercent(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "Not available";
  return `${value > 0 ? "+" : ""}${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
  }).format(value)}%`;
}

export function formatSignedValue(value: number | null, unit: string): string {
  if (value === null || !Number.isFinite(value)) return "Not available";
  return `${value > 0 ? "+" : ""}${formatValue(value, unit)}`;
}

export function formatDisplayValue(
  value: number | null,
  sourceUnit: string,
  displayUnit: DisplayUnitId,
  compact = false,
): string {
  const converted = convertUnitValue(value, sourceUnit, displayUnit);
  if (converted === null || !Number.isFinite(converted)) return "Not available";
  const metadata = getUnitFormattingMetadata(displayUnit);
  const rendered = magnitudeAwareNumber(
    converted,
    metadata?.numberFormat ?? { maximumFractionDigits: 2 },
    compact,
  );
  return `${rendered} ${metadata?.compactLabel ?? compactUnit(displayUnit)}`.trim();
}

/** Format an already-converted display number without appending its unit label. */
export function formatDisplayNumber(
  value: number | null,
  displayUnit: DisplayUnitId,
  compact = false,
): string {
  if (value === null || !Number.isFinite(value)) return "Not available";
  const metadata = getUnitFormattingMetadata(displayUnit);
  return magnitudeAwareNumber(
    value,
    metadata?.numberFormat ?? { maximumFractionDigits: 2 },
    compact,
  );
}

export function formatSignedDisplayValue(
  value: number | null,
  sourceUnit: string,
  displayUnit: DisplayUnitId,
): string {
  if (value === null || !Number.isFinite(value)) return "Not available";
  return `${value > 0 ? "+" : ""}${formatDisplayValue(value, sourceUnit, displayUnit)}`;
}

export function convertDisplayValue(
  value: number | null,
  sourceUnit: string,
  displayUnit: DisplayUnitId,
): number | null {
  return convertUnitValue(value, sourceUnit, displayUnit);
}

export function formatDateTime(value: string | undefined): string {
  if (!value) return "Not supplied by source";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  }).format(date);
}

export function formatPeriod(value: string | null | undefined): string {
  if (!value) return "Not available";
  if (/^\d{4}-\d{2}$/.test(value)) {
    const [year, month] = value.split("-").map(Number);
    if (year && month) {
      return new Intl.DateTimeFormat("en-US", { month: "short", year: "numeric", timeZone: "UTC" })
        .format(new Date(Date.UTC(year, month - 1, 1)));
    }
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" })
        .format(date);
}

export function deltaDirection(value: number | null): "up" | "down" | "flat" | "unknown" {
  if (value === null || !Number.isFinite(value)) return "unknown";
  if (value > 0) return "up";
  if (value < 0) return "down";
  return "flat";
}

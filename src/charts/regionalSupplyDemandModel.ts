import {
  regionalProfileMeasuresForFrequency,
  type RegionalProfileFrequencyMode,
  type RegionalProfileModel,
  type RegionalProfileSeriesAvailability,
} from "../data/regionalProfile";
import { usaSeriesDescriptor } from "../data/usaDashboard";
import { supportsWeeklyToMonthlySeries } from "../data/frequencyAggregation";
import { eiaRegionalDimensions } from "../lib/eiaRegionalDimensions";
import { getNativeUnitOption, isCanonicalUnit } from "../lib/units";
import { buildMonthlyViewFromWeekly } from "../lib/weeklyToMonthly";
import {
  SUPPORTED_ASSET_SCHEMA,
  type HistoricalObservation,
  type UsaChartAsset,
} from "../types/energyAssets";

export interface RegionalSupplyDemandMeasure {
  measureId: string;
  label: string;
  seriesId: string;
  unit: string;
  frequency: RegionalProfileFrequencyMode;
  isStock: boolean;
  isDerived: boolean;
  history: HistoricalObservation[];
  sourceChecksum: string;
  sourceName: string;
  sourceUrl?: string;
}

export interface RegionalSupplyDemandUnavailable {
  measureId: string;
  label: string;
  reason: string;
  kind: "source-boundary" | "not-registered" | "display-unavailable";
}

export interface RegionalSupplyDemandModel {
  frequency: RegionalProfileFrequencyMode;
  geographyId: string;
  productId: string;
  familyId: string;
  generatedAt: string;
  periods: string[];
  latestPeriod: string | null;
  measures: RegionalSupplyDemandMeasure[];
  unavailable: RegionalSupplyDemandUnavailable[];
  gaps: string[];
}

export interface RegionalSupplyDemandSnapshotRow extends RegionalSupplyDemandMeasure {
  value: number | null;
  status: string;
  previousPeriod: string;
  previousValue: number | null;
  delta: number | null;
  latestPeriod: string | null;
}

export interface RegionalSupplyDemandSnapshot {
  period: string;
  previousPeriod: string;
  rows: RegionalSupplyDemandSnapshotRow[];
}

const DAY_MS = 86_400_000;
const NUMERIC_STATUSES = new Set([
  "observed", "preliminary", "revised", "computed", "use_with_caution",
]);
const NONNUMERIC_STATUSES = new Set([
  "missing", "not_available", "not_applicable", "suppressed_or_withheld",
]);
const STOCK_MEASURES = new Set([
  "stocks", "ending-stocks", "closing-inventory", "transporter-closing-inventory",
]);

function periodTimestamp(period: string, frequency: RegionalProfileFrequencyMode): number {
  const pattern = frequency === "monthly" ? /^\d{4}-\d{2}$/ : /^\d{4}-\d{2}-\d{2}$/;
  const date = new Date(`${period}${frequency === "monthly" ? "-01" : ""}T00:00:00Z`);
  if (!pattern.test(period) || !Number.isFinite(date.getTime())
      || date.getUTCFullYear() < 1000
      || date.toISOString().slice(0, frequency === "monthly" ? 7 : 10) !== period) {
    throw new Error(`Regional comparison has an invalid ${frequency} period: ${period}.`);
  }
  return date.getTime();
}

function previousPeriod(period: string, frequency: RegionalProfileFrequencyMode): string {
  const timestamp = periodTimestamp(period, frequency);
  const date = new Date(timestamp);
  if (frequency === "weekly") return new Date(timestamp - 7 * DAY_MS).toISOString().slice(0, 10);
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() - 1, 1))
    .toISOString().slice(0, 7);
}

function seasonalCoordinate(timestamp: number, frequency: RegionalProfileFrequencyMode): { year: number; slot: number } {
  const date = new Date(timestamp);
  if (frequency === "monthly") return { year: date.getUTCFullYear(), slot: date.getUTCMonth() + 1 };
  // ISO weeks belong to the year containing their Thursday, not necessarily
  // the calendar year of the source week-ending date (e.g. 2021-01-01 = 2020-W53).
  date.setUTCDate(date.getUTCDate() + 4 - (date.getUTCDay() || 7));
  const year = date.getUTCFullYear();
  const start = Date.UTC(year, 0, 1);
  return { year, slot: Math.ceil(((date.getTime() - start) / DAY_MS + 1) / 7) };
}

function validateHistory(asset: UsaChartAsset): HistoricalObservation[] {
  if (!asset.history?.length) {
    throw new Error(`Regional comparison requires status-preserving history for ${asset.series_id}.`);
  }
  const frequency = asset.frequency as RegionalProfileFrequencyMode;
  const seen = new Set<string>();
  const history = asset.history.map((point) => {
    const timestamp = periodTimestamp(point.period, frequency);
    if (seen.has(point.period)) throw new Error(`Regional comparison has duplicate period ${point.period}.`);
    seen.add(point.period);
    const numeric = point.value !== null;
    if ((!NUMERIC_STATUSES.has(point.status) && !NONNUMERIC_STATUSES.has(point.status))
        || numeric !== NUMERIC_STATUSES.has(point.status)
        || (numeric && !Number.isFinite(point.value))) {
      throw new Error(`Regional comparison has incompatible value/status at ${point.period}.`);
    }
    const coordinate = seasonalCoordinate(timestamp, frequency);
    if (point.year !== coordinate.year || point.slot !== coordinate.slot) {
      throw new Error(`Regional comparison has invalid seasonal coordinates at ${point.period}.`);
    }
    if (timestamp > Date.parse(asset.generated_at)) {
      throw new Error(`Regional comparison history extends beyond its generation time at ${point.period}.`);
    }
    return { ...point };
  }).sort((left, right) => left.period.localeCompare(right.period));
  if (frequency === "weekly") {
    const weekdays = new Set(history.map((point) => new Date(periodTimestamp(point.period, frequency)).getUTCDay()));
    if (weekdays.size !== 1) throw new Error("Regional comparison has inconsistent week-ending weekdays.");
  }
  const latest = history.at(-1)!;
  if (asset.latest_source && (asset.latest_source.period !== latest.period
      || asset.latest_source.value !== latest.value || asset.latest_source.status !== latest.status)) {
    throw new Error(`Regional comparison history does not preserve the latest source state for ${asset.series_id}.`);
  }
  return history;
}

function validateIdentity(
  profile: RegionalProfileModel,
  measure: RegionalProfileSeriesAvailability,
  asset: UsaChartAsset,
  generatedAt: string,
): void {
  const series = measure.series;
  const descriptor = profile.country === "usa" ? usaSeriesDescriptor(series) : undefined;
  const productId = descriptor?.productId ?? series.classification?.product_id;
  const familyId = descriptor?.familyId ?? series.classification?.product_family_id;
  const measureId = descriptor?.measureId ?? series.classification?.measure_id;
  if (asset.schema_version !== SUPPORTED_ASSET_SCHEMA
      || measure.productId !== profile.product?.productId
      || productId !== profile.product?.productId
      || familyId !== profile.product?.familyId
      || measureId !== measure.measureId
      || measure.geography?.geography_id !== profile.geography?.geographyId
      || asset.geography_id !== profile.geography?.geographyId
      || asset.series_id !== series.series_id
      || asset.frequency !== series.frequency
      || asset.frequency !== measure.frequency
      || !["weekly", "monthly"].includes(asset.frequency)
      || asset.unit !== series.unit || !isCanonicalUnit(asset.unit)
      || (STOCK_MEASURES.has(measure.measureId) && getNativeUnitOption(asset.unit)?.dimension !== "volume")
      || asset.generated_at !== generatedAt
      || !asset.methodology_version
      || !/^[a-f0-9]{64}$/i.test(asset.source_checksum)) {
    throw new Error(`Regional comparison asset does not match the exact profile identity/vintage for ${series.series_id}.`);
  }
  // Validate geography-bearing monthly EIA source keys before using their rows.
  // Different measures intentionally retain different semantic dimensions.
  if (profile.country === "usa") eiaRegionalDimensions(series, asset.geography_id, asset.dimensions);
}

function addCoverageGaps(
  profile: RegionalProfileModel,
  frequency: RegionalProfileFrequencyMode,
  measures: RegionalSupplyDemandMeasure[],
  unavailable: RegionalSupplyDemandUnavailable[],
): void {
  const national = profile.geography?.levelId === "national";
  const hasMeasure = (id: string) => measures.some((measure) => measure.measureId === id);
  const missing = (measureId: string, label: string, reason: string,
    kind: RegionalSupplyDemandUnavailable["kind"]) => {
    if (!hasMeasure(measureId) && !unavailable.some((item) => item.measureId === measureId)) {
      unavailable.push({ measureId, label, reason, kind });
    }
  };
  const statcanRefined = profile.productMeasures.some((measure) => (
    measure.series.classification?.dashboard_group === "canada_refined_products"
  ));
  if (!national && profile.country === "canada" && statcanRefined) {
    missing("product-supplied", "Product supplied (implied demand)",
      "The current Statistics Canada petroleum balance does not publish provincial product supplied for this selection; Canada demand is not allocated to provinces.", "source-boundary");
    missing("net-receipts", "Net interregional receipts",
      "Statistics Canada table 25-10-0081 declares net interregional receipts but currently publishes no fact rows. Broad pipeline movements cannot replace product-specific balance receipts.", "source-boundary");
  } else {
    missing("product-supplied", "Product supplied (implied demand)",
      !national && profile.country === "usa" && frequency === "weekly"
        ? "EIA weekly product supplied is not published by PADD; national implied demand is not allocated to a regional profile."
        : "No exact product-supplied series is registered and promoted for this selection and frequency. This is an app coverage gap, not proof the provider has no data.",
      !national && profile.country === "usa" && frequency === "weekly" ? "source-boundary" : "not-registered");
    if (!national) missing("net-receipts", "Net interregional receipts",
      frequency === "weekly" && profile.country === "usa"
        ? "EIA weekly surveys do not publish inter-PADD movements. Monthly route context is not a weekly product-balance term."
        : "Product-specific monthly net receipts are not registered and promoted for this selection. The broader petroleum-products route total is not a substitute.",
      frequency === "weekly" && profile.country === "usa" ? "source-boundary" : "not-registered");
  }
}

/**
 * Compare exact registered components at one source period. This is deliberately
 * not a reconciled balance: no totals, residual demand, or missing terms are derived.
 * Callers supply canonical assets in the same order as available frequency-filtered
 * product measures. Display units are applied only after this validation.
 */
export function prepareRegionalSupplyDemand(
  profile: RegionalProfileModel,
  assets: readonly UsaChartAsset[],
  frequency: RegionalProfileFrequencyMode,
  generatedAt: string,
): RegionalSupplyDemandModel {
  if (!profile.product || !profile.geography || !Number.isFinite(Date.parse(generatedAt))) {
    throw new Error("Regional comparison requires an exact product, geography, and generation time.");
  }
  const selected = regionalProfileMeasuresForFrequency(profile.productMeasures, frequency);
  const available = selected.filter((measure) => measure.availability === "available");
  if (available.length !== assets.length) throw new Error("Regional comparison asset coverage does not match the selected measures.");
  const unavailable: RegionalSupplyDemandUnavailable[] = selected
    .filter((measure) => measure.availability === "unavailable")
    .map((measure) => {
      const missingMonthlyDemand = profile.country === "usa" && frequency === "monthly"
        && measure.frequency === "weekly" && measure.measureId === "product-supplied";
      return { measureId: measure.measureId, label: measure.measureLabel,
        reason: missingMonthlyDemand
          ? "The registered weekly product-supplied series is national-only. Native monthly PADD product supplied is not yet registered for this selected product; a derived monthly view does not add it."
          : measure.reason ?? "No validated exact-geography asset is available.",
        kind: missingMonthlyDemand ? "not-registered" as const
          : measure.reason?.includes("no validated chart asset") ? "display-unavailable" as const
            : "source-boundary" as const };
    });
  const measures: RegionalSupplyDemandMeasure[] = [];
  const seenAssets = new Set<string>();
  for (let index = 0; index < available.length; index += 1) {
    const measure = available[index]!;
    const asset = assets[index]!;
    validateIdentity(profile, measure, asset, generatedAt);
    if (seenAssets.has(asset.series_id)) throw new Error(`Regional comparison has duplicate asset ${asset.series_id}.`);
    seenAssets.add(asset.series_id);
    let history = validateHistory(asset);
    const isDerived = frequency === "monthly" && asset.frequency === "weekly";
    if (isDerived) {
      if (!supportsWeeklyToMonthlySeries(asset.series_id)) {
        unavailable.push({ measureId: measure.measureId, label: measure.measureLabel,
          reason: "Monthly display is not registered for this weekly series.", kind: "display-unavailable" });
        continue;
      }
      try {
        history = buildMonthlyViewFromWeekly(asset).history!;
      } catch (error) {
        // Identity, status, dates and overlaps have already been validated. A
        // missing complete month is a display availability state, not a zero.
        if (!(error instanceof Error) || !/no (?:numeric )?completed calendar month/.test(error.message)) throw error;
        unavailable.push({ measureId: measure.measureId, label: measure.measureLabel,
          reason: error.message, kind: "display-unavailable" });
        continue;
      }
    }
    measures.push({ measureId: measure.measureId, label: measure.measureLabel,
      seriesId: asset.series_id, unit: asset.unit, frequency,
      isStock: STOCK_MEASURES.has(measure.measureId), isDerived, history,
      sourceChecksum: asset.source_checksum, sourceName: measure.series.source.name,
      sourceUrl: measure.series.source.url });
  }
  addCoverageGaps(profile, frequency, measures, unavailable);
  const periods = [...new Set(measures.flatMap((measure) => measure.history.map((point) => point.period)))].sort();
  return { frequency, geographyId: profile.geography.geographyId, productId: profile.product.productId,
    familyId: profile.product.familyId, generatedAt, periods, latestPeriod: periods.at(-1) ?? null,
    measures, unavailable, gaps: [...new Set(unavailable.map((item) => item.reason))] };
}

/** Exact-period lookup; a missing current or previous period is never stale-filled. */
export function regionalSupplyDemandSnapshot(
  model: RegionalSupplyDemandModel,
  period: string,
): RegionalSupplyDemandSnapshot {
  const previous = previousPeriod(period, model.frequency);
  if (!model.periods.includes(period)) throw new Error("The selected period is not available in this regional comparison.");
  return { period, previousPeriod: previous, rows: model.measures.map((measure) => {
    const point = measure.history.find((candidate) => candidate.period === period);
    const prior = measure.history.find((candidate) => candidate.period === previous);
    const value = point?.value ?? null;
    const previousValue = prior?.value ?? null;
    return { ...measure, value, status: point?.status ?? "missing", previousPeriod: previous,
      previousValue, delta: value === null || previousValue === null ? null : value - previousValue,
      latestPeriod: measure.history.at(-1)?.period ?? null };
  }) };
}

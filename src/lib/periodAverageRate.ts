import type {
  DisplayUnitId,
  DisplayUnitOption,
} from "./units";
import {
  convertUnitValue,
  getDisplayUnitOptions,
} from "./units";
import { buildChartAssetFromHistory } from "./customChartAnalytics";
import {
  canadaMonthlyAverageRateRegistry,
  isRegisteredMonthlyAverageRateSeries,
} from "../data/canadaRateDisplay";
import type {
  ForecastAsset,
  ForecastPoint,
  PredictionIntervalKey,
  UsaChartAsset,
  UsaManifestSeries,
} from "../types/energyAssets";

export const MONTHLY_AVERAGE_RATE_DISPLAY_METHODOLOGY =
  canadaMonthlyAverageRateRegistry.methodology_version;
export const MONTHLY_AVERAGE_RATE_UNIT = "thousand_barrels_per_day" as const;

const INTERVAL_KEYS: readonly PredictionIntervalKey[] = ["80", "90", "95"];

/**
 * Statistics Canada publishes these observations as monthly volumes. Only
 * flow/activity measures may be normalized into a monthly-average daily rate.
 * Month-end stocks and other point-in-time levels deliberately remain volumes.
 */
export function supportsMonthlyAverageRate(series: UsaManifestSeries): boolean {
  return isRegisteredMonthlyAverageRateSeries(series.series_id)
    && series.frequency.toLowerCase().startsWith("month")
    && series.unit === "cubic_metres";
}

export function monthlyAverageRateOption(
  series: UsaManifestSeries,
): DisplayUnitOption | null {
  return monthlyAverageRateOptions(series).find(
    (option) => option.id === MONTHLY_AVERAGE_RATE_UNIT,
  ) ?? null;
}

/**
 * Every fixed-factor daily-rate scale is valid after the registered monthly
 * volume has been normalized by its own calendar-day count. The canonical
 * in-memory rate remains kb/d; the other choices are display-only scales.
 */
export function monthlyAverageRateOptions(
  series: UsaManifestSeries,
): readonly DisplayUnitOption[] {
  if (!supportsMonthlyAverageRate(series)) return [];
  return getDisplayUnitOptions(MONTHLY_AVERAGE_RATE_UNIT).map((option) => ({
    ...option,
    longLabel: `${option.longLabel} — monthly average`,
    isSourceUnit: false,
  }));
}

export function isMonthlyAverageRateDisplayUnit(
  series: UsaManifestSeries,
  requested: string | undefined,
): requested is DisplayUnitId {
  return monthlyAverageRateOptions(series).some((option) => option.id === requested);
}

/** Exact UTC/Gregorian day count for a strict YYYY-MM source period. */
export function daysInMonthlyPeriod(period: string): number {
  const match = /^(\d{4})-(0[1-9]|1[0-2])$/.exec(period);
  if (!match) {
    throw new Error(`Monthly-average rate requires a YYYY-MM period; received ${period}.`);
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (year < 1000) {
    throw new Error(`Monthly-average rate requires a four-digit Gregorian year; received ${period}.`);
  }
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Convert one source monthly volume to its average thousand-barrel daily rate. */
export function monthlyVolumeToKbPerDay(
  value: number | null,
  period: string,
  sourceUnit: string,
): number | null {
  const days = daysInMonthlyPeriod(period);
  if (sourceUnit !== "cubic_metres") {
    throw new Error(`Monthly-average rate does not support source unit ${sourceUnit}.`);
  }
  const thousandBarrels = convertUnitValue(value, sourceUnit, "thousand_barrels");
  return thousandBarrels === null ? null : thousandBarrels / days;
}

/** Convert a registered monthly volume to any ordinary daily-rate display scale. */
export function monthlyVolumeToAverageRate(
  value: number | null,
  period: string,
  sourceUnit: string,
  displayUnit: DisplayUnitId,
): number | null {
  const kbPerDay = monthlyVolumeToKbPerDay(value, period, sourceUnit);
  return convertUnitValue(kbPerDay, MONTHLY_AVERAGE_RATE_UNIT, displayUnit);
}

/**
 * Build an in-memory rate view from canonical monthly history. Statistics are
 * recomputed after period-specific normalization; precomputed volume bands,
 * deltas, and histogram endpoints are never reused as rate statistics.
 */
export function buildMonthlyAverageRateAsset(asset: UsaChartAsset): UsaChartAsset {
  if (!isRegisteredMonthlyAverageRateSeries(asset.series_id)) {
    throw new Error(`Monthly-average rate is not registered for ${asset.series_id}.`);
  }
  if (!asset.frequency.toLowerCase().startsWith("month")) {
    throw new Error("Monthly-average rate requires a monthly chart asset.");
  }
  if (asset.unit !== "cubic_metres") {
    throw new Error(`Monthly-average rate does not support source unit ${asset.unit}.`);
  }
  if (!asset.history?.length) {
    throw new Error("Monthly-average rate requires status-preserving period history.");
  }

  return buildChartAssetFromHistory({
    seriesId: asset.series_id,
    geographyId: asset.geography_id,
    dimensions: { ...asset.dimensions },
    frequency: asset.frequency,
    unit: MONTHLY_AVERAGE_RATE_UNIT,
    generatedAt: asset.generated_at,
    history: asset.history.map((point) => ({
      ...point,
      value: monthlyVolumeToKbPerDay(point.value, point.period, asset.unit),
    })),
    sourceChecksum: asset.source_checksum,
    methodologyVersion: `${asset.methodology_version}+monthly-average-rate-${MONTHLY_AVERAGE_RATE_DISPLAY_METHODOLOGY}`,
    freshness: asset.freshness,
    aggregationLineage: asset.aggregation_lineage,
  });
}

/**
 * Convert only final published forecast points and bounds. Forecast fitting,
 * regional summation, residual alignment, and interval calibration stay in the
 * canonical monthly-volume domain.
 */
export function monthlyAverageRateForecastPoints(
  forecast: ForecastAsset,
): ForecastPoint[] {
  if (!isRegisteredMonthlyAverageRateSeries(forecast.target_series_id)) {
    throw new Error(`Monthly-average rate is not registered for ${forecast.target_series_id}.`);
  }
  if (!forecast.frequency.toLowerCase().startsWith("month")) {
    throw new Error("Monthly-average forecast display requires a monthly forecast.");
  }
  if (forecast.unit !== "cubic_metres") {
    throw new Error(`Monthly-average forecast display does not support ${forecast.unit}.`);
  }

  return forecast.points.map((point) => ({
    ...point,
    value: monthlyVolumeToKbPerDay(point.value, point.target_period, forecast.unit)!,
    intervals: Object.fromEntries(INTERVAL_KEYS.map((key) => {
      const bounds = point.intervals[key];
      return [key, {
        lower: monthlyVolumeToKbPerDay(bounds.lower, point.target_period, forecast.unit)!,
        upper: monthlyVolumeToKbPerDay(bounds.upper, point.target_period, forecast.unit)!,
      }];
    })) as ForecastPoint["intervals"],
  }));
}

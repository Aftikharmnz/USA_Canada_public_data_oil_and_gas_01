import {
  weeklyToMonthlyRegistry,
  weeklyToMonthlyRuleForSeries,
  type WeeklyToMonthlySeriesRule,
} from "../data/frequencyAggregation";
import type {
  HistoricalObservation,
  UsaChartAsset,
} from "../types/energyAssets";
import { buildChartAssetFromHistory } from "./customChartAnalytics";

const DAY_MS = 86_400_000;

const NUMERIC_STATUSES = new Set([
  "observed",
  "preliminary",
  "revised",
  "computed",
  "use_with_caution",
]);

const NONNUMERIC_STATUS_PRECEDENCE = [
  "suppressed_or_withheld",
  "not_applicable",
  "not_available",
  "missing",
] as const;

const ALL_STATUSES = new Set([
  ...NUMERIC_STATUSES,
  ...NONNUMERIC_STATUS_PRECEDENCE,
]);

interface ValidatedWeeklyPoint extends HistoricalObservation {
  timestamp: number;
}

interface SourceContribution {
  period: string;
  overlap_days: number;
  status: string;
}

interface DerivedMonthlyPeriodLineage {
  period: string;
  expected_days?: number;
  covered_days?: number;
  coverage_ratio?: number;
  expected_final_week_period?: string;
  selected_source_period?: string | null;
  blocking_statuses: string[];
  source_periods: SourceContribution[];
}

interface DerivedHistory {
  history: HistoricalObservation[];
  periodLineage: DerivedMonthlyPeriodLineage[];
}

function parseWeeklyPeriod(period: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(period);
  if (!match) throw new Error(`Weekly-to-monthly conversion requires YYYY-MM-DD periods; received ${period}.`);
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const timestamp = Date.UTC(year, month - 1, day);
  const parsed = new Date(timestamp);
  if (year < 1000
      || parsed.getUTCFullYear() !== year
      || parsed.getUTCMonth() !== month - 1
      || parsed.getUTCDate() !== day) {
    throw new Error(`Weekly-to-monthly conversion received invalid period ${period}.`);
  }
  return timestamp;
}

function dateKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

function monthKey(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 7);
}

function monthStart(timestamp: number): number {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), 1);
}

function nextMonth(timestamp: number): number {
  const date = new Date(timestamp);
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 1);
}

function monthEnd(timestamp: number): number {
  return nextMonth(monthStart(timestamp)) - DAY_MS;
}

function monthDays(timestamp: number): number {
  return new Date(monthEnd(timestamp)).getUTCDate();
}

function monthlyCoordinate(period: string): { year: number; slot: number } {
  return { year: Number(period.slice(0, 4)), slot: Number(period.slice(5, 7)) };
}

function completedMonthStarts(first: number, lastSourcePeriod: number): number[] {
  const output: number[] = [];
  for (let cursor = monthStart(first); monthEnd(cursor) <= lastSourcePeriod; cursor = nextMonth(cursor)) {
    output.push(cursor);
  }
  return output;
}

function completedSnapshotMonthStarts(
  firstSourcePeriod: number,
  lastSourcePeriod: number,
  asOf: number,
): number[] {
  const output: number[] = [];
  const lastSourceMonth = monthStart(lastSourcePeriod);
  for (
    let cursor = monthStart(firstSourcePeriod);
    cursor <= lastSourceMonth && monthEnd(cursor) <= asOf;
    cursor = nextMonth(cursor)
  ) {
    output.push(cursor);
  }
  return output;
}

function blockingStatus(statuses: readonly string[]): string {
  for (const status of NONNUMERIC_STATUS_PRECEDENCE) {
    if (statuses.includes(status)) return status;
  }
  return "missing";
}

function derivedNumericStatus(statuses: readonly string[]): string {
  if (statuses.includes("use_with_caution")) return "use_with_caution";
  if (statuses.includes("preliminary")) return "preliminary";
  return "computed";
}

function validateHistory(
  asset: UsaChartAsset,
  seriesId: string,
  rule: WeeklyToMonthlySeriesRule,
): ValidatedWeeklyPoint[] {
  if (asset.series_id !== seriesId) {
    throw new Error(`Weekly-to-monthly series mismatch: asset ${asset.series_id}, requested ${seriesId}.`);
  }
  if (!asset.frequency.toLowerCase().startsWith("week")) {
    throw new Error("Weekly-to-monthly conversion requires a weekly chart asset.");
  }
  if (asset.unit !== rule.sourceUnit) {
    throw new Error(
      `Weekly-to-monthly conversion expected ${rule.sourceUnit} for ${seriesId}; received ${asset.unit}.`,
    );
  }
  if (!asset.history?.length) {
    throw new Error("Weekly-to-monthly conversion requires status-preserving period history.");
  }

  const periods = new Set<string>();
  const points = asset.history.map((point) => {
    if (periods.has(point.period)) {
      throw new Error(`Weekly-to-monthly history contains duplicate period ${point.period}.`);
    }
    periods.add(point.period);
    if (!ALL_STATUSES.has(point.status)) {
      throw new Error(`Weekly-to-monthly history contains unknown status ${point.status}.`);
    }
    const numeric = point.value !== null;
    if (numeric && !Number.isFinite(point.value)) {
      throw new Error(`Weekly-to-monthly history contains non-finite value at ${point.period}.`);
    }
    if (numeric !== NUMERIC_STATUSES.has(point.status)) {
      throw new Error(`Weekly-to-monthly history has incompatible value/status at ${point.period}.`);
    }
    return { ...point, timestamp: parseWeeklyPeriod(point.period) };
  }).sort((left, right) => left.timestamp - right.timestamp);

  const weekEndingDay = new Date(points[0]!.timestamp).getUTCDay();
  if (points.some((point) => new Date(point.timestamp).getUTCDay() !== weekEndingDay)) {
    throw new Error("Weekly-to-monthly history contains inconsistent week-ending weekdays.");
  }
  return points;
}

function groupedContributions(
  points: readonly ValidatedWeeklyPoint[],
): SourceContribution[] {
  const counts = new Map<string, SourceContribution>();
  for (const point of points) {
    const existing = counts.get(point.period);
    if (existing) {
      existing.overlap_days += 1;
    } else {
      counts.set(point.period, {
        period: point.period,
        overlap_days: 1,
        status: point.status,
      });
    }
  }
  return [...counts.values()].sort((left, right) => left.period.localeCompare(right.period));
}

function buildDayWeightedHistory(points: readonly ValidatedWeeklyPoint[]): DerivedHistory {
  const byDay = new Map<number, ValidatedWeeklyPoint>();
  for (const point of points) {
    for (let offset = 6; offset >= 0; offset -= 1) {
      const timestamp = point.timestamp - offset * DAY_MS;
      if (byDay.has(timestamp)) {
        throw new Error(`Weekly-to-monthly rate coverage overlaps on ${dateKey(timestamp)}.`);
      }
      byDay.set(timestamp, point);
    }
  }

  const coverageStart = points[0]!.timestamp - 6 * DAY_MS;
  const firstFullMonth = new Date(coverageStart).getUTCDate() === 1
    ? monthStart(coverageStart)
    : nextMonth(coverageStart);
  const months = completedMonthStarts(firstFullMonth, points[points.length - 1]!.timestamp);
  const history: HistoricalObservation[] = [];
  const periodLineage: DerivedMonthlyPeriodLineage[] = [];

  for (const start of months) {
    const period = monthKey(start);
    const expectedDays = monthDays(start);
    const sourcePoints: ValidatedWeeklyPoint[] = [];
    const missingDates: string[] = [];
    for (let day = 0; day < expectedDays; day += 1) {
      const timestamp = start + day * DAY_MS;
      const source = byDay.get(timestamp);
      if (source) sourcePoints.push(source);
      else missingDates.push(dateKey(timestamp));
    }

    const nonnumeric = sourcePoints.filter((point) => point.value === null);
    const blockingStatuses = [
      ...new Set([
        ...(missingDates.length ? ["missing"] : []),
        ...nonnumeric.map((point) => point.status),
      ]),
    ];
    const complete = sourcePoints.length === expectedDays && !nonnumeric.length;
    const value = complete
      ? sourcePoints.reduce((sum, point) => sum + point.value!, 0) / expectedDays
      : null;
    const status = complete
      ? derivedNumericStatus(sourcePoints.map((point) => point.status))
      : blockingStatus(blockingStatuses);
    history.push({ period, ...monthlyCoordinate(period), value, status });
    periodLineage.push({
      period,
      expected_days: expectedDays,
      covered_days: sourcePoints.length,
      coverage_ratio: sourcePoints.length / expectedDays,
      blocking_statuses: blockingStatuses,
      source_periods: groupedContributions(sourcePoints),
    });
  }
  return { history, periodLineage };
}

function finalWeekEndingInMonth(month: number, weekday: number): number {
  let timestamp = monthEnd(month);
  while (new Date(timestamp).getUTCDay() !== weekday) timestamp -= DAY_MS;
  return timestamp;
}

function buildSnapshotHistory(
  points: readonly ValidatedWeeklyPoint[],
  asOf: number,
): DerivedHistory {
  const byTimestamp = new Map(points.map((point) => [point.timestamp, point]));
  const weekEndingDay = new Date(points[0]!.timestamp).getUTCDay();
  const months = completedSnapshotMonthStarts(
    points[0]!.timestamp,
    points[points.length - 1]!.timestamp,
    asOf,
  );
  const history: HistoricalObservation[] = [];
  const periodLineage: DerivedMonthlyPeriodLineage[] = [];

  for (const start of months) {
    const period = monthKey(start);
    const expectedTimestamp = finalWeekEndingInMonth(start, weekEndingDay);
    const selected = byTimestamp.get(expectedTimestamp);
    const value = selected?.value ?? null;
    const status = selected?.status ?? "missing";
    history.push({ period, ...monthlyCoordinate(period), value, status });
    periodLineage.push({
      period,
      expected_final_week_period: dateKey(expectedTimestamp),
      selected_source_period: selected?.period ?? null,
      blocking_statuses: value === null ? [status] : [],
      source_periods: selected ? [{
        period: selected.period,
        overlap_days: 1,
        status: selected.status,
      }] : [],
    });
  }
  return { history, periodLineage };
}

/**
 * Build a deterministic, display-only monthly view from a positively registered
 * weekly series. Rates use exact calendar-day weighting. Point/ratio measures
 * use the final registered weekly endpoint in each completed calendar month.
 */
export function buildMonthlyViewFromWeekly(
  asset: UsaChartAsset,
  seriesId = asset.series_id,
): UsaChartAsset {
  const rule = weeklyToMonthlyRuleForSeries(seriesId);
  if (!rule) throw new Error(`Weekly-to-monthly display is not registered for ${seriesId}.`);
  const points = validateHistory(asset, seriesId, rule);
  const generatedAt = Date.parse(asset.generated_at);
  if (!Number.isFinite(generatedAt) || generatedAt < points[points.length - 1]!.timestamp) {
    throw new Error("Weekly-to-monthly conversion requires a valid generation time at or after the latest source period.");
  }
  const derived = rule.strategy === "rate_day_weighted"
    ? buildDayWeightedHistory(points)
    : buildSnapshotHistory(points, generatedAt);
  if (!derived.history.length) {
    throw new Error("Weekly-to-monthly conversion has no completed calendar months.");
  }
  const latestNumeric = [...derived.history].reverse().find((point) => point.value !== null);
  if (!latestNumeric) {
    throw new Error("Weekly-to-monthly conversion has no numeric completed calendar month.");
  }
  const latestSource = derived.history[derived.history.length - 1]!;

  return buildChartAssetFromHistory({
    seriesId: asset.series_id,
    geographyId: asset.geography_id,
    dimensions: { ...asset.dimensions },
    frequency: weeklyToMonthlyRegistry.targetFrequency,
    unit: asset.unit,
    generatedAt: asset.generated_at,
    history: derived.history,
    sourceChecksum: asset.source_checksum,
    methodologyVersion: `${asset.methodology_version}+weekly-to-monthly-${weeklyToMonthlyRegistry.methodologyVersion}`,
    freshness: {
      ...asset.freshness,
      status: asset.freshness?.status ?? "unknown",
      latest_period: latestSource.period,
      latest_numeric_period: latestNumeric.period,
      latest_observation_status: latestSource.status,
      expected_period: undefined,
    },
    aggregationLineage: {
      aggregation_kind: "temporal_resample",
      methodology_version: weeklyToMonthlyRegistry.methodologyVersion,
      source_frequency: weeklyToMonthlyRegistry.sourceFrequency,
      target_frequency: weeklyToMonthlyRegistry.targetFrequency,
      strategy: rule.strategy,
      source_period_semantics: rule.sourcePeriodSemantics,
      week_period_role: weeklyToMonthlyRegistry.weekPeriodRole,
      rate_coverage_window: rule.strategy === "rate_day_weighted"
        ? weeklyToMonthlyRegistry.rateCoverageWindow
        : null,
      coverage_requirement: weeklyToMonthlyRegistry.coverageRequirement,
      source_checksum: asset.source_checksum,
      completion_as_of: asset.generated_at,
      source_aggregation_lineage: asset.aggregation_lineage,
      period_lineage: derived.periodLineage,
    },
  });
}

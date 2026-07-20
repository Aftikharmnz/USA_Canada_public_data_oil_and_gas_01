import type {
  AggregationLineage,
  AssetFreshness,
  BaselineSlot,
  DistributionSample,
  HistoricalObservation,
  UsaChartAsset,
} from "../types/energyAssets";

export const CUSTOM_AGGREGATION_METHODOLOGY_VERSION = "2026-07-20.1";

interface CustomChartAssetInput {
  seriesId: string;
  geographyId: string;
  dimensions: Record<string, string>;
  frequency: string;
  unit: string;
  generatedAt: string;
  history: HistoricalObservation[];
  componentChecksums: Record<string, string>;
  freshness?: AssetFreshness;
  aggregationLineage: AggregationLineage;
}

export interface ChartAssetFromHistoryInput {
  seriesId: string;
  geographyId: string;
  dimensions: Record<string, string>;
  frequency: string;
  unit: string;
  generatedAt: string;
  history: HistoricalObservation[];
  sourceChecksum: string;
  methodologyVersion: string;
  freshness?: AssetFreshness;
  aggregationLineage: AggregationLineage | null;
}

function quantile(values: readonly number[], probability: number): number {
  if (values.length === 1) return values[0]!;
  const ordered = [...values].sort((left, right) => left - right);
  const position = (ordered.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.min(lowerIndex + 1, ordered.length - 1);
  const lower = ordered[lowerIndex]!;
  const upper = ordered[upperIndex]!;
  return lower + (upper - lower) * (position - lowerIndex);
}

function isMonthly(frequency: string): boolean {
  return frequency.toLowerCase().startsWith("month");
}

function completeYear(points: readonly HistoricalObservation[], frequency: string): boolean {
  const numericSlots = new Set(
    points.filter((point) => point.value !== null).map((point) => point.slot),
  );
  if (isMonthly(frequency)) {
    return numericSlots.size === 12
      && Array.from({ length: 12 }, (_, index) => index + 1).every((slot) => numericSlots.has(slot));
  }
  return Array.from({ length: 52 }, (_, index) => index + 1).every(
    (slot) => numericSlots.has(slot),
  );
}

function consecutive(left: string, right: string, frequency: string): boolean {
  if (isMonthly(frequency)) {
    const [leftYear, leftMonth] = left.slice(0, 7).split("-").map(Number);
    const [rightYear, rightMonth] = right.slice(0, 7).split("-").map(Number);
    return Boolean(
      leftYear && leftMonth && rightYear && rightMonth
      && rightYear * 12 + rightMonth === leftYear * 12 + leftMonth + 1,
    );
  }
  const leftDate = new Date(`${left}T00:00:00Z`);
  const rightDate = new Date(`${right}T00:00:00Z`);
  return Number.isFinite(leftDate.getTime())
    && Number.isFinite(rightDate.getTime())
    && rightDate.getTime() - leftDate.getTime() === 604_800_000;
}

function baselineSlots(
  byYear: Map<number, HistoricalObservation[]>,
  eligibleYears: readonly number[],
): BaselineSlot[] {
  const slots = new Set<number>();
  for (const year of eligibleYears) {
    for (const point of byYear.get(year) ?? []) slots.add(point.slot);
  }
  return [...slots].sort((left, right) => left - right).flatMap((slot) => {
    const values = eligibleYears.flatMap((year) => {
      const value = byYear.get(year)?.find((point) => point.slot === slot)?.value;
      return value === null || value === undefined ? [] : [value];
    }).sort((left, right) => left - right);
    if (values.length < 5) return [];
    return [{
      slot,
      min: values[0]!,
      q1: quantile(values, 0.25),
      median: quantile(values, 0.5),
      mean: values.reduce((sum, value) => sum + value, 0) / values.length,
      q3: quantile(values, 0.75),
      max: values[values.length - 1]!,
      count: values.length,
    }];
  });
}

function histogram(values: readonly number[], iqr: number) {
  if (!values.length) return [];
  const ordered = [...values].sort((left, right) => left - right);
  if (ordered[0] === ordered[ordered.length - 1]) {
    return [{ lower: ordered[0]!, upper: ordered[0]!, count: ordered.length }];
  }
  const width = iqr > 0 ? 2 * iqr / Math.cbrt(ordered.length) : 0;
  const span = ordered[ordered.length - 1]! - ordered[0]!;
  const binCount = Math.max(
    1,
    Math.min(40, width > 0 ? Math.ceil(span / width) : Math.ceil(Math.sqrt(ordered.length))),
  );
  const step = span / binCount;
  const counts = Array.from({ length: binCount }, () => 0);
  for (const value of ordered) {
    const index = Math.min(Math.floor((value - ordered[0]!) / step), binCount - 1);
    counts[index] = (counts[index] ?? 0) + 1;
  }
  return counts.map((count, index) => ({
    lower: ordered[0]! + step * index,
    upper: ordered[0]! + step * (index + 1),
    count,
  }));
}

function distribution(
  values: readonly number[],
  periodStart: string,
  periodEnd: string,
): DistributionSample {
  if (!values.length) {
    return {
      status: "insufficient_sample",
      period_start: periodStart,
      period_end: periodEnd,
      count: 0,
      mean: null,
      median: null,
      stddev: null,
      min: null,
      q1: null,
      q3: null,
      max: null,
      iqr: null,
      skewness: null,
      excess_kurtosis: null,
      histogram: [],
      fit: {
        status: "insufficient_sample",
        best_candidate_among_tested: null,
        tested_candidates: [],
        reason: "Insufficient sample for candidate distribution fitting (minimum 30).",
      },
    };
  }
  const ordered = [...values].sort((left, right) => left - right);
  const count = ordered.length;
  const mean = ordered.reduce((sum, value) => sum + value, 0) / count;
  const median = quantile(ordered, 0.5);
  const q1 = quantile(ordered, 0.25);
  const q3 = quantile(ordered, 0.75);
  const stddev = count > 1
    ? Math.sqrt(ordered.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (count - 1))
    : 0;
  const secondMoment = ordered.reduce((sum, value) => sum + (value - mean) ** 2, 0) / count;
  const skewness = secondMoment === 0
    ? null
    : (ordered.reduce((sum, value) => sum + (value - mean) ** 3, 0) / count)
      / secondMoment ** 1.5;
  const excessKurtosis = secondMoment === 0
    ? null
    : (ordered.reduce((sum, value) => sum + (value - mean) ** 4, 0) / count)
      / secondMoment ** 2 - 3;
  const iqr = q3 - q1;
  const varianceMle = ordered.reduce((sum, value) => sum + (value - mean) ** 2, 0) / count;
  const canFit = count >= 30 && varianceMle > 0;
  const logLikelihood = canFit
    ? -0.5 * count * (Math.log(2 * Math.PI * varianceMle) + 1)
    : null;
  return {
    status: "ok",
    period_start: periodStart,
    period_end: periodEnd,
    count,
    mean,
    median,
    stddev,
    min: ordered[0]!,
    q1,
    q3,
    max: ordered[ordered.length - 1]!,
    iqr,
    skewness,
    excess_kurtosis: excessKurtosis,
    histogram: histogram(ordered, iqr),
    fit: canFit && logLikelihood !== null
      ? {
          status: "candidate_diagnostic",
          best_candidate_among_tested: "Normal",
          selection_note: "AIC (single baseline candidate)",
          tested_candidates: [{ name: "Normal", aic: 4 - 2 * logLikelihood }],
          reason: "Normal candidate diagnostic only; not a definitive distribution classification.",
        }
      : {
          status: "insufficient_sample",
          best_candidate_among_tested: null,
          tested_candidates: [],
          reason: "Insufficient sample for candidate distribution fitting (minimum 30).",
        },
  };
}

async function checksum(componentChecksums: Record<string, string>): Promise<string> {
  const canonical = JSON.stringify(
    Object.entries(componentChecksums).sort(([left], [right]) => left.localeCompare(right)),
  );
  const digest = await globalThis.crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical),
  );
  return [...new Uint8Array(digest)]
    .map((value) => value.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Recompute every chart statistic from status-preserving period history.
 *
 * This is shared by browser-defined geography sums and explicitly registered
 * display derivations. Callers remain responsible for validating the history,
 * unit semantics, lineage, and checksum before invoking it.
 */
export function buildChartAssetFromHistory(
  input: ChartAssetFromHistoryInput,
): UsaChartAsset {
  const history = [...input.history].sort((left, right) => left.period.localeCompare(right.period));
  if (!history.length) throw new Error("A combined chart requires period-level component history.");
  if (new Set(history.map((point) => point.period)).size !== history.length) {
    throw new Error("Combined chart history contains duplicate periods.");
  }
  const numeric = history.filter(
    (point): point is HistoricalObservation & { value: number } => point.value !== null,
  );
  if (!numeric.length) throw new Error("A combined chart requires at least one complete numeric period.");
  const anchorYear = Math.max(...history.map((point) => point.year));
  const recentYears = [anchorYear - 2, anchorYear - 1, anchorYear];
  const baselineEnd = recentYears[0]! - 1;
  const baselineStart = baselineEnd - 9;
  const byYear = new Map<number, HistoricalObservation[]>();
  for (const point of history) {
    const year = byYear.get(point.year) ?? [];
    year.push(point);
    byYear.set(point.year, year);
  }
  const eligibleYears = Array.from({ length: 10 }, (_, index) => baselineStart + index)
    .filter((year) => completeYear(byYear.get(year) ?? [], input.frequency));
  const baselineStatus = eligibleYears.length >= 5 ? "ok" : "insufficient_history";
  const slots = baselineStatus === "ok" ? baselineSlots(byYear, eligibleYears) : [];
  const latest = numeric[numeric.length - 1]!;
  const previousCandidate = numeric[numeric.length - 2];
  const previous = previousCandidate && consecutive(
    previousCandidate.period,
    latest.period,
    input.frequency,
  ) ? previousCandidate : undefined;
  const priorYear = byYear.get(latest.year - 1)?.find((point) => point.slot === latest.slot);
  const baseline = slots.find((slot) => slot.slot === latest.slot);
  const seasonalValues = eligibleYears.flatMap((year) => {
    const value = byYear.get(year)?.find((point) => point.slot === latest.slot)?.value;
    return value === null || value === undefined ? [] : [value];
  });
  const values = numeric.map((point) => point.value);
  const changes = numeric.slice(1).flatMap((point, index) => {
    const prior = numeric[index]!;
    return consecutive(prior.period, point.period, input.frequency)
      ? [point.value - prior.value]
      : [];
  });
  const absoluteChange = previous ? latest.value - previous.value : null;
  const yearAgoValue = priorYear?.value ?? null;
  const yoyAbsoluteChange = yearAgoValue === null ? null : latest.value - yearAgoValue;

  return {
    schema_version: "1.0.0",
    methodology_version: input.methodologyVersion,
    series_id: input.seriesId,
    geography_id: input.geographyId,
    dimensions: { ...input.dimensions },
    frequency: input.frequency,
    unit: input.unit,
    generated_at: input.generatedAt,
    source_checksum: input.sourceChecksum,
    freshness: input.freshness,
    history,
    recent_years: recentYears.map((year) => ({
      year,
      points: (byYear.get(year) ?? []).map(({ period, slot, value, status }) => ({
        period,
        slot,
        value,
        status,
      })),
    })),
    baseline: {
      status: baselineStatus,
      baseline_start_year: baselineStatus === "ok" ? baselineStart : null,
      baseline_end_year: baselineStatus === "ok" ? baselineEnd : null,
      eligible_years: eligibleYears,
      eligible_year_count: eligibleYears.length,
      excluded_years: Array.from({ length: 10 }, (_, index) => baselineStart + index)
        .filter((year) => !eligibleYears.includes(year)),
      slots,
    },
    latest: {
      period: latest.period,
      value: latest.value,
      previous_period: previous?.period ?? null,
      absolute_change: absoluteChange,
      percent_change: previous && previous.value !== 0
        ? (latest.value / previous.value - 1) * 100
        : null,
      year_ago_period: priorYear?.period ?? null,
      yoy_absolute_change: yoyAbsoluteChange,
      yoy_percent_change: yearAgoValue !== null && yearAgoValue !== 0
        ? (latest.value / yearAgoValue - 1) * 100
        : null,
      seasonal_median: baseline?.median ?? null,
      distance_from_seasonal_median: baseline ? latest.value - baseline.median : null,
      seasonal_percentile: seasonalValues.length
        ? 100 * seasonalValues.filter((value) => value <= latest.value).length / seasonalValues.length
        : null,
    },
    latest_source: {
      period: history[history.length - 1]!.period,
      value: history[history.length - 1]!.value,
      status: history[history.length - 1]!.status,
    },
    distribution: {
      levels: distribution(values, numeric[0]!.period, numeric[numeric.length - 1]!.period),
      changes: distribution(changes, numeric[0]!.period, numeric[numeric.length - 1]!.period),
    },
    aggregation_lineage: input.aggregationLineage,
  };
}

export async function buildCustomChartAsset(
  input: CustomChartAssetInput,
): Promise<UsaChartAsset> {
  return buildChartAssetFromHistory({
    ...input,
    sourceChecksum: await checksum(input.componentChecksums),
    methodologyVersion: CUSTOM_AGGREGATION_METHODOLOGY_VERSION,
  });
}

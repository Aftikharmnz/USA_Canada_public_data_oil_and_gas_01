import type { UsaChartAsset } from "../types/energyAssets";

/**
 * Consecutive period-over-period changes for the build/draw style bar view.
 *
 * Rules mirror the analytical methodology: a change exists only between two
 * numeric observations in directly consecutive source periods (7 days apart
 * for weekly week-ending data, next calendar month for monthly data). Gaps
 * and nonnumeric observations produce no bar instead of a zero-filled one,
 * and the change is strictly period over period — it is not a year-over-year,
 * seasonal, or revision delta.
 */

export interface PeriodChangePoint {
  period: string;
  previousPeriod: string;
  value: number;
  previousValue: number;
  change: number;
  percentChange: number | null;
}

export interface PeriodChangeModel {
  frequency: "weekly" | "monthly";
  points: PeriodChangePoint[];
  latest: PeriodChangePoint | null;
  skippedGaps: number;
}

function nextConsecutivePeriod(period: string, frequency: "weekly" | "monthly"): string | null {
  if (frequency === "monthly") {
    const match = /^(\d{4})-(\d{2})/.exec(period);
    if (!match) return null;
    let year = Number(match[1]);
    let month = Number(match[2]) + 1;
    if (month === 13) {
      year += 1;
      month = 1;
    }
    return `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}`;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(period)) return null;
  const parsed = new Date(`${period}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  parsed.setUTCDate(parsed.getUTCDate() + 7);
  return parsed.toISOString().slice(0, 10);
}

export function buildPeriodChangeModel(
  asset: UsaChartAsset,
  maxPoints = 110,
): PeriodChangeModel {
  const frequency: "weekly" | "monthly" = asset.frequency.toLowerCase().startsWith("month")
    ? "monthly"
    : "weekly";
  const byPeriod = new Map<string, number>();
  for (const year of asset.recent_years) {
    for (const point of year.points) {
      if (point.value !== null && Number.isFinite(point.value)) {
        byPeriod.set(point.period, point.value);
      }
    }
  }
  const periods = [...byPeriod.keys()].sort();
  const points: PeriodChangePoint[] = [];
  let skippedGaps = 0;
  for (let index = 1; index < periods.length; index += 1) {
    const previousPeriod = periods[index - 1]!;
    const period = periods[index]!;
    if (nextConsecutivePeriod(previousPeriod, frequency) !== period) {
      skippedGaps += 1;
      continue;
    }
    const previousValue = byPeriod.get(previousPeriod)!;
    const value = byPeriod.get(period)!;
    const change = value - previousValue;
    points.push({
      period,
      previousPeriod,
      value,
      previousValue,
      change,
      percentChange: previousValue === 0 ? null : (value / previousValue - 1) * 100,
    });
  }
  const trimmed = points.slice(-maxPoints);
  return {
    frequency,
    points: trimmed,
    latest: trimmed.length ? trimmed[trimmed.length - 1]! : null,
    skippedGaps,
  };
}

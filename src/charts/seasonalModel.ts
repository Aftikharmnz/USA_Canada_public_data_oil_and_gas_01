import type {
  BaselineSlot,
  ForecastAsset,
  ForecastPoint,
  RecentSeasonalYear,
  UsaChartAsset,
} from "../types/energyAssets";

export interface SeasonalSeriesPoint {
  slot: number;
  period: string;
  value: number | null;
  status: string;
}

export interface SeasonalSeriesModel {
  id: string;
  label: string;
  year: number;
  points: SeasonalSeriesPoint[];
}

export interface SeasonalChartModel {
  frequency: string;
  unit: string;
  slots: number[];
  baselineBySlot: Map<number, BaselineSlot>;
  series: SeasonalSeriesModel[];
  forecastSeries: Array<{
    id: string;
    label: string;
    year: number;
    points: ForecastPoint[];
  }>;
  yMin: number;
  yMax: number;
}

function finiteValues(asset: UsaChartAsset, forecast?: ForecastAsset): number[] {
  const baselineValues = asset.baseline.slots.flatMap((slot) => [
    slot.min,
    slot.q1,
    slot.median,
    slot.mean,
    slot.q3,
    slot.max,
  ]);
  const recentValues = asset.recent_years.flatMap((year) =>
    year.points.flatMap((point) => (point.value === null ? [] : [point.value])),
  );
  const forecastValues = forecast?.points.flatMap((point) => [
    point.value,
    point.intervals["80"].lower,
    point.intervals["80"].upper,
    point.intervals["90"].lower,
    point.intervals["90"].upper,
    point.intervals["95"].lower,
    point.intervals["95"].upper,
  ]) ?? [];
  return [...baselineValues, ...recentValues, ...forecastValues].filter(Number.isFinite);
}

function normalizeRecentYear(year: RecentSeasonalYear): SeasonalSeriesModel {
  return {
    id: `year-${year.year}`,
    label: String(year.year),
    year: year.year,
    points: [...year.points].sort((left, right) => left.slot - right.slot),
  };
}

function groupForecastByYear(forecast?: ForecastAsset): SeasonalChartModel["forecastSeries"] {
  if (!forecast?.points.length) return [];
  const byYear = new Map<number, ForecastPoint[]>();
  for (const point of forecast.points) {
    const points = byYear.get(point.year) ?? [];
    points.push(point);
    byYear.set(point.year, points);
  }
  return [...byYear.entries()]
    .sort(([left], [right]) => left - right)
    .map(([year, points]) => ({
      id: `forecast-${year}`,
      label: `Forecast ${year}`,
      year,
      points: [...points].sort((left, right) => left.slot - right.slot),
    }));
}

/** Renderer-neutral model; an ECharts adapter can consume this without changing page state. */
export function buildSeasonalChartModel(
  asset: UsaChartAsset,
  forecast?: ForecastAsset,
): SeasonalChartModel {
  const slots = [...new Set([
    ...asset.baseline.slots.map((slot) => slot.slot),
    ...asset.recent_years.flatMap((year) => year.points.map((point) => point.slot)),
    ...(forecast?.points.map((point) => point.slot) ?? []),
  ])].sort((left, right) => left - right);
  const values = finiteValues(asset, forecast);
  let yMin = values.length ? Math.min(...values) : 0;
  let yMax = values.length ? Math.max(...values) : 1;
  const padding = Math.max((yMax - yMin) * 0.08, Math.abs(yMax) * 0.02, 1);
  yMin -= padding;
  yMax += padding;

  return {
    frequency: asset.frequency,
    unit: asset.unit,
    slots,
    baselineBySlot: new Map(asset.baseline.slots.map((slot) => [slot.slot, slot])),
    series: asset.recent_years.map(normalizeRecentYear).sort((left, right) => left.year - right.year),
    forecastSeries: groupForecastByYear(forecast),
    yMin,
    yMax,
  };
}

export function slotLabel(slot: number, frequency: string): string {
  if (frequency.toLowerCase().startsWith("month")) {
    return new Intl.DateTimeFormat("en-US", { month: "short", timeZone: "UTC" })
      .format(new Date(Date.UTC(2024, Math.max(0, slot - 1), 1)));
  }
  return `W${slot}`;
}

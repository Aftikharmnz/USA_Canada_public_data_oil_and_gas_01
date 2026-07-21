import { useEffect, useId, useMemo, useRef, useState } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import {
  AriaComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsOption } from "echarts";
import { buildPeriodChangeModel, type PeriodChangeModel } from "../../charts/changeModel";
import { buildSeasonalChartModel, slotLabel } from "../../charts/seasonalModel";
import {
  compactUnit,
  convertDisplayValue,
  formatDateTime,
  formatDisplayValue,
  formatPeriod,
  formatPlainNumber,
  formatValue,
} from "../../lib/formatters";
import {
  getSourceUnitLabel,
  getUnitFormattingMetadata,
  resolveDisplayUnit,
  type DisplayUnitId,
} from "../../lib/units";
import type {
  ForecastAsset,
  ForecastPoint,
  PredictionIntervalKey,
  PredictionIntervalLevel,
  UsaChartAsset,
  UsaManifestSeries,
} from "../../types/energyAssets";
import { ChartGeographyControl } from "./ChartGeographyControl";
import { DisplayUnitControl } from "./DisplayUnitControl";
import type { RegionSelectionMode } from "./RegionSelectionControl";

interface SeasonalChartProps {
  asset: UsaChartAsset;
  series: UsaManifestSeries;
  geographyId: string;
  onGeographyChange: (geographyId: string) => void;
  geographyIds?: string[];
  regionMode?: RegionSelectionMode;
  onGeographiesChange?: (geographyIds: string[]) => void;
  onRegionModeChange?: (mode: RegionSelectionMode) => void;
  /** Display-only conversion; observations and forecasts retain their source unit. */
  displayUnit?: DisplayUnitId;
  onDisplayUnitChange?: (unit: DisplayUnitId) => void;
  forecast?: ForecastAsset;
  /** Period-normalized values for plotting only; forecast diagnostics stay in source units. */
  forecastDisplayPoints?: ForecastPoint[];
  forecastNotice?: string;
}

const YEAR_COLORS = ["#7d91a0", "#d98537", "#087f6d"];
const FORECAST_COLORS = ["#4f55bd", "#8749a8", "#315f9e"];
const INTERVAL_LEVELS: PredictionIntervalLevel[] = [80, 90, 95];

echarts.use([
  BarChart,
  LineChart,
  AriaComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

export type SeasonalViewMode = "seasonal" | "changes";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"]/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
  })[character] ?? character);
}

function tooltipDataIndex(params: unknown): number | null {
  const first = Array.isArray(params) ? params[0] : params;
  if (typeof first !== "object" || first === null || !("dataIndex" in first)) return null;
  const value = (first as { dataIndex?: unknown }).dataIndex;
  return typeof value === "number" ? value : null;
}

function formatRatio(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "Not available";
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value * 100)}%`;
}

function formatSkill(value: number | null | undefined): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return "Not available";
  const rendered = new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1,
    signDisplay: "always",
  }).format(value * 100);
  return `${rendered}% MAE skill`;
}

function formattedDisplayValue(
  value: number | null,
  sourceUnit: string,
  displayUnit: DisplayUnitId | null,
): string {
  return displayUnit
    ? formatDisplayValue(value, sourceUnit, displayUnit)
    : formatValue(value, sourceUnit);
}

function axisDisplayValue(
  value: number,
  displayUnit: DisplayUnitId | null,
): string {
  if (!displayUnit) return formatPlainNumber(value);
  const metadata = getUnitFormattingMetadata(displayUnit);
  return new Intl.NumberFormat("en-US", metadata?.numberFormat ?? {
    maximumFractionDigits: 2,
  }).format(value);
}

function numericDisplayValue(
  value: number | null,
  sourceUnit: string,
  displayUnit: DisplayUnitId | null,
): number | null {
  return displayUnit ? convertDisplayValue(value, sourceUnit, displayUnit) : value;
}

function displayUnitLabel(sourceUnit: string, displayUnit: DisplayUnitId | null): string {
  return getUnitFormattingMetadata(displayUnit ?? sourceUnit)?.compactLabel
    ?? compactUnit(displayUnit ?? sourceUnit);
}

export function changeChartLabels(asset: UsaChartAsset): {
  positive: string;
  negative: string;
  title: string;
} {
  const isLevel = asset.unit === "thousand_barrels";
  const cadence = asset.frequency.toLowerCase().startsWith("month") ? "Month" : "Week";
  if (isLevel) {
    return {
      positive: "Build",
      negative: "Draw",
      title: `${cadence}-over-${cadence.toLowerCase()} stock change (build + / draw −)`,
    };
  }
  const unitNote = asset.unit.toLowerCase() === "percent" ? " (percentage points)" : "";
  return {
    positive: "Increase",
    negative: "Decrease",
    title: `${cadence}-over-${cadence.toLowerCase()} change${unitNote}`,
  };
}

export function buildChangeEChartsOption(
  asset: UsaChartAsset,
  seriesTitle: string,
  model: PeriodChangeModel,
  displayUnit?: DisplayUnitId,
): EChartsOption {
  const labels = changeChartLabels(asset);
  const resolvedDisplayUnit = resolveDisplayUnit(asset.unit, displayUnit);
  const percentagePointChanges = asset.unit.toLowerCase() === "percent";
  const formatChange = (value: number | null) => percentagePointChanges
    ? formatValue(value, "percentage points")
    : formattedDisplayValue(value, asset.unit, resolvedDisplayUnit);
  // Stock builds read as supply-heavy (warm color) and draws as tightening
  // (teal); generic rate series keep neutral analytic colors instead.
  const isLevel = asset.unit === "thousand_barrels";
  const positiveColor = isLevel ? "#c0533f" : "#43646a";
  const negativeColor = isLevel ? "#0b7c68" : "#c18541";
  const data = model.points.map((point) => ({
    value: numericDisplayValue(point.change, asset.unit, resolvedDisplayUnit),
    itemStyle: { color: point.change >= 0 ? positiveColor : negativeColor },
  }));
  return {
    animationDuration: 250,
    aria: {
      enabled: true,
      description: `${seriesTitle}. ${labels.title}. Bars above zero are ${labels.positive.toLowerCase()}s and bars below zero are ${labels.negative.toLowerCase()}s. Consecutive source periods only; gaps are omitted, never zero-filled.`,
    },
    grid: { left: 62, right: 26, top: 30, bottom: 78, containLabel: false },
    tooltip: {
      trigger: "axis",
      confine: true,
      backgroundColor: "rgba(11, 49, 59, 0.97)",
      borderWidth: 0,
      textStyle: { color: "#e9f1f2", fontSize: 12 },
      formatter: (params: unknown) => {
        const index = tooltipDataIndex(params);
        if (index === null) return "";
        const point = model.points[index];
        if (!point) return "";
        const direction = point.change >= 0 ? labels.positive : labels.negative;
        const percent = point.percentChange === null
          ? ""
          : `<div class="echarts-tooltip-row"><span>Percent</span><b>${escapeHtml(new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, signDisplay: "always" }).format(point.percentChange))}%</b></div>`;
        return `<div class="echarts-tooltip"><strong>${escapeHtml(formatPeriod(point.period))}</strong>`
          + `<div class="echarts-tooltip-row"><span>${direction}</span><b>${escapeHtml(formatChange(Math.abs(point.change)))}</b></div>`
          + percent
          + `<div class="echarts-tooltip-row"><span>Level</span><b>${escapeHtml(formattedDisplayValue(point.value, asset.unit, resolvedDisplayUnit))}</b></div>`
          + `<div class="echarts-tooltip-row"><span>From</span><b>${escapeHtml(formatPeriod(point.previousPeriod))}</b></div></div>`;
      },
    },
    xAxis: {
      type: "category",
      data: model.points.map((point) => point.period),
      axisLine: { lineStyle: { color: "#b9cbc6" } },
      axisTick: { show: false },
      axisLabel: {
        color: "#71858a",
        fontSize: 10,
        interval: Math.max(0, Math.ceil(model.points.length / 14) - 1),
        formatter: (value: string) => formatPeriod(value),
      },
    },
    yAxis: {
      type: "value",
      name: percentagePointChanges
        ? "percentage points"
        : displayUnitLabel(asset.unit, resolvedDisplayUnit),
      nameLocation: "end",
      nameTextStyle: { color: "#71858a", fontSize: 10, fontWeight: 700 },
      axisLabel: {
        color: "#71858a",
        fontSize: 11,
        formatter: (value: number) => percentagePointChanges
          ? formatPlainNumber(value)
          : axisDisplayValue(value, resolvedDisplayUnit),
      },
      splitLine: { lineStyle: { color: "#e3eae8" } },
    },
    dataZoom: [
      { type: "inside", xAxisIndex: 0, filterMode: "none", zoomOnMouseWheel: "shift", moveOnMouseMove: true },
      {
        type: "slider",
        xAxisIndex: 0,
        filterMode: "none",
        height: 18,
        bottom: 12,
        borderColor: "#d5dfdb",
        backgroundColor: "#f3f6f4",
        fillerColor: "rgba(11,124,104,0.12)",
        handleStyle: { color: "#0b7c68", borderColor: "#0b7c68" },
        textStyle: { color: "#71858a", fontSize: 10 },
      },
    ],
    series: [
      {
        name: labels.title,
        type: "bar",
        data,
        barMaxWidth: 16,
        emphasis: { focus: "series" },
      },
    ],
  };
}

export function buildSeasonalEChartsOption(
  asset: UsaChartAsset,
  seriesTitle: string,
  forecast?: ForecastAsset,
  intervalLevel: PredictionIntervalLevel = 90,
  displayUnit?: DisplayUnitId,
): EChartsOption {
  const resolvedDisplayUnit = resolveDisplayUnit(asset.unit, displayUnit);
  const model = buildSeasonalChartModel(asset, forecast);
  const labels = model.slots.map((slot) => slotLabel(slot, model.frequency));
  const baseline = model.slots.map((slot) => model.baselineBySlot.get(slot));
  const hasBaseline = baseline.some(Boolean);
  const intervalKey = String(intervalLevel) as PredictionIntervalKey;
  const intervalName = `${intervalLevel}% prediction interval`;
  const legendNames = [
    ...(hasBaseline ? ["Historical range", "Middle 50%", "Median", "Mean"] : []),
    ...model.series.map((year) => String(year.year)),
    ...(model.forecastSeries.length ? [intervalName] : []),
    ...model.forecastSeries.map((year) => year.label),
  ];
  const forecastDescription = forecast && model.forecastSeries.length
    ? ` Dashed lines are forecasts from ${formatPeriod(forecast.origin.period)} with a selected ${intervalLevel} percent empirical prediction interval.`
    : "";

  const forecastChartSeries = model.forecastSeries.flatMap((forecastYear, forecastIndex) => {
    const pointsBySlot = new Map(forecastYear.points.map((point) => [point.slot, point]));
    const observedOrigin = asset.recent_years
      .flatMap((year) => year.points.map((point) => ({ ...point, year: year.year })))
      .find((point) => point.period === forecast?.origin.period && point.value !== null);
    const lower = model.slots.map((slot) => numericDisplayValue(
      pointsBySlot.get(slot)?.intervals[intervalKey].lower ?? null,
      asset.unit,
      resolvedDisplayUnit,
    ));
    const width = model.slots.map((slot) => {
      const bounds = pointsBySlot.get(slot)?.intervals[intervalKey];
      return bounds
        ? numericDisplayValue(bounds.upper - bounds.lower, asset.unit, resolvedDisplayUnit)
        : null;
    });
    const color = FORECAST_COLORS[forecastIndex % FORECAST_COLORS.length];
    const stack = `forecast-${forecastYear.year}-${intervalLevel}`;
    return [
      {
        name: `__forecast_base_${forecastYear.year}`,
        type: "line" as const,
        data: lower,
        stack,
        symbol: "none",
        silent: true,
        connectNulls: false,
        lineStyle: { opacity: 0 },
        areaStyle: { opacity: 0 },
        tooltip: { show: false },
        z: 4,
      },
      {
        name: intervalName,
        type: "line" as const,
        data: width,
        stack,
        symbol: "none",
        silent: true,
        connectNulls: false,
        lineStyle: { opacity: 0 },
        areaStyle: { color, opacity: 0.22 },
        emphasis: { disabled: true },
        tooltip: { show: false },
        z: 4,
      },
      {
        name: forecastYear.label,
        type: "line" as const,
        data: model.slots.map((slot) => numericDisplayValue(
          pointsBySlot.get(slot)?.value
            ?? (
              observedOrigin?.year === forecastYear.year && observedOrigin.slot === slot
                ? observedOrigin.value
                : null
            ),
          asset.unit,
          resolvedDisplayUnit,
        )),
        symbol: "diamond",
        symbolSize: 7,
        showSymbol: true,
        connectNulls: false,
        lineStyle: { color, width: 2.7, type: "dashed" as const },
        itemStyle: { color, borderColor: "#fff", borderWidth: 1 },
        emphasis: { focus: "series" as const, scale: 1.35 },
        z: 6,
      },
    ];
  });

  return {
    animationDuration: 300,
    color: ["#d7e4e0", "#8fc7ba", "#43646a", "#c18541", ...YEAR_COLORS],
    aria: {
      enabled: true,
      decal: { show: true },
      description: `${seriesTitle}. Three recent years compared with historical minimum, maximum, interquartile range, median, and mean.${forecastDescription}`,
    },
    grid: { left: 62, right: 26, top: 44, bottom: 78, containLabel: false },
    legend: {
      type: "scroll",
      data: legendNames,
      top: 0,
      left: 0,
      textStyle: { color: "#476168", fontSize: 11 },
      selected: { Mean: false },
    },
    tooltip: {
      trigger: "axis",
      confine: true,
      axisPointer: { type: "line", lineStyle: { color: "#17343a", type: "dashed" } },
      backgroundColor: "rgba(11, 49, 59, 0.97)",
      borderWidth: 0,
      textStyle: { color: "#e9f1f2", fontSize: 12 },
      formatter: (params: unknown) => {
        const index = tooltipDataIndex(params);
        if (index === null) return "";
        const slot = model.slots[index];
        if (slot === undefined) return "";
        const band = model.baselineBySlot.get(slot);
        const recentRows = model.series.map((year, yearIndex) => {
          const point = year.points.find((item) => item.slot === slot);
          const color = YEAR_COLORS[yearIndex % YEAR_COLORS.length];
          return `<div class="echarts-tooltip-row"><span><i style="background:${color}"></i>${year.year}</span><b>${escapeHtml(formattedDisplayValue(point?.value ?? null, asset.unit, resolvedDisplayUnit))}</b></div>`;
        }).join("");
        const forecastRows = model.forecastSeries.flatMap((forecastYear, forecastIndex) => {
          const point = forecastYear.points.find((item) => item.slot === slot);
          if (!point) return [];
          const color = FORECAST_COLORS[forecastIndex % FORECAST_COLORS.length];
          const bounds = point.intervals[intervalKey];
          return [
            `<div class="echarts-tooltip-row echarts-tooltip-forecast"><span><i style="background:${color}"></i>${escapeHtml(`Forecast ${formatPeriod(point.target_period)} · H${point.horizon}`)}</span><b>${escapeHtml(formattedDisplayValue(point.value, asset.unit, resolvedDisplayUnit))}</b></div>`,
            `<div class="echarts-tooltip-row"><span>${intervalLevel}% prediction interval</span><b>${escapeHtml(`${formattedDisplayValue(bounds.lower, asset.unit, resolvedDisplayUnit)} – ${formattedDisplayValue(bounds.upper, asset.unit, resolvedDisplayUnit)}`)}</b></div>`,
          ];
        }).join("");
        const bandRows = band ? [
          ["Maximum", band.max],
          ["Q3", band.q3],
          ["Mean", band.mean],
          ["Median", band.median],
          ["Q1", band.q1],
          ["Minimum", band.min],
        ].map(([label, value]) => `<div class="echarts-tooltip-row"><span>${label}</span><b>${escapeHtml(formattedDisplayValue(value as number, asset.unit, resolvedDisplayUnit))}</b></div>`).join("") : "";
        const baselineFooter = band ? `<small>Historical baseline n=${band.count}</small>` : "";
        const separator = forecastRows || bandRows ? "<hr>" : "";
        return `<div class="echarts-tooltip"><strong>${escapeHtml(slotLabel(slot, model.frequency))}</strong>${recentRows}${separator}${forecastRows}${forecastRows && bandRows ? "<hr>" : ""}${bandRows}${baselineFooter}</div>`;
      },
    },
    xAxis: {
      type: "category",
      data: labels,
      boundaryGap: false,
      axisLine: { lineStyle: { color: "#b9cbc6" } },
      axisTick: { show: false },
      axisLabel: {
        color: "#71858a",
        fontSize: 11,
        interval: model.frequency.toLowerCase().startsWith("week") ? 3 : 0,
      },
    },
    yAxis: {
      type: "value",
      min: numericDisplayValue(model.yMin, asset.unit, resolvedDisplayUnit) ?? model.yMin,
      max: numericDisplayValue(model.yMax, asset.unit, resolvedDisplayUnit) ?? model.yMax,
      name: displayUnitLabel(asset.unit, resolvedDisplayUnit),
      nameLocation: "end",
      nameTextStyle: { color: "#71858a", fontSize: 10, fontWeight: 700 },
      axisLabel: {
        color: "#71858a",
        fontSize: 11,
        formatter: (value: number) => axisDisplayValue(value, resolvedDisplayUnit),
      },
      splitLine: { lineStyle: { color: "#e3eae8" } },
    },
    dataZoom: [
      { type: "inside", xAxisIndex: 0, filterMode: "none", zoomOnMouseWheel: "shift", moveOnMouseMove: true },
      {
        type: "slider",
        xAxisIndex: 0,
        filterMode: "none",
        height: 18,
        bottom: 12,
        borderColor: "#d5dfdb",
        backgroundColor: "#f3f6f4",
        fillerColor: "rgba(11,124,104,0.12)",
        handleStyle: { color: "#0b7c68", borderColor: "#0b7c68" },
        textStyle: { color: "#71858a", fontSize: 10 },
      },
    ],
    series: [
      {
        name: "__range_base",
        type: "line",
        data: baseline.map((slot) => numericDisplayValue(
          slot?.min ?? null,
          asset.unit,
          resolvedDisplayUnit,
        )),
        stack: "historical-range",
        symbol: "none",
        silent: true,
        lineStyle: { opacity: 0 },
        areaStyle: { opacity: 0 },
        tooltip: { show: false },
        z: 0,
      },
      {
        name: "Historical range",
        type: "line",
        data: baseline.map((slot) => numericDisplayValue(
          slot ? slot.max - slot.min : null,
          asset.unit,
          resolvedDisplayUnit,
        )),
        stack: "historical-range",
        symbol: "none",
        lineStyle: { opacity: 0 },
        areaStyle: { color: "#dfe8e5", opacity: 0.78 },
        emphasis: { disabled: true },
        z: 0,
      },
      {
        name: "__iqr_base",
        type: "line",
        data: baseline.map((slot) => numericDisplayValue(
          slot?.q1 ?? null,
          asset.unit,
          resolvedDisplayUnit,
        )),
        stack: "interquartile-range",
        symbol: "none",
        silent: true,
        lineStyle: { opacity: 0 },
        areaStyle: { opacity: 0 },
        tooltip: { show: false },
        z: 1,
      },
      {
        name: "Middle 50%",
        type: "line",
        data: baseline.map((slot) => numericDisplayValue(
          slot ? slot.q3 - slot.q1 : null,
          asset.unit,
          resolvedDisplayUnit,
        )),
        stack: "interquartile-range",
        symbol: "none",
        lineStyle: { opacity: 0 },
        areaStyle: { color: "#8fc7ba", opacity: 0.72 },
        emphasis: { disabled: true },
        z: 1,
      },
      {
        name: "Median",
        type: "line",
        data: baseline.map((slot) => numericDisplayValue(
          slot?.median ?? null,
          asset.unit,
          resolvedDisplayUnit,
        )),
        symbol: "none",
        lineStyle: { color: "#43646a", width: 1.8 },
        z: 2,
      },
      {
        name: "Mean",
        type: "line",
        data: baseline.map((slot) => numericDisplayValue(
          slot?.mean ?? null,
          asset.unit,
          resolvedDisplayUnit,
        )),
        symbol: "none",
        lineStyle: { color: "#c18541", width: 1.5, type: "dashed" },
        z: 2,
      },
      ...model.series.map((year, index) => ({
        name: String(year.year),
        type: "line" as const,
        data: model.slots.map((slot) => numericDisplayValue(
          year.points.find((point) => point.slot === slot)?.value ?? null,
          asset.unit,
          resolvedDisplayUnit,
        )),
        symbol: "circle",
        symbolSize: 5,
        showSymbol: false,
        connectNulls: false,
        lineStyle: { color: YEAR_COLORS[index % YEAR_COLORS.length], width: 2.7 },
        itemStyle: { color: YEAR_COLORS[index % YEAR_COLORS.length] },
        emphasis: { focus: "series" as const, scale: 1.4 },
        z: 5,
      })),
      ...forecastChartSeries,
    ],
  };
}

function EChartsCanvas({ option, ariaLabel }: { option: EChartsOption; ariaLabel: string }) {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<ReturnType<typeof echarts.init> | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const chart = echarts.init(container, undefined, { renderer: "canvas" });
    chartRef.current = chart;
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => chart.resize());
    observer?.observe(container);
    const handleResize = () => chart.resize();
    window.addEventListener("resize", handleResize);
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", handleResize);
      chartRef.current = null;
      chart.dispose();
    };
  }, []);

  useEffect(() => {
    // Seasonal overlays and period-change bars use fundamentally different
    // axes. A full option replacement prevents the prior level scale from
    // clipping every build/draw bar after the user switches chart views.
    chartRef.current?.setOption(option, { notMerge: true });
  }, [option]);

  return <div ref={containerRef} className="echarts-seasonal" role="img" aria-label={ariaLabel} />;
}

function ForecastDiagnostics({
  forecast,
  intervalLevel,
  displayUnit,
  sourceDomainNotice,
}: {
  forecast: ForecastAsset;
  intervalLevel: PredictionIntervalLevel;
  displayUnit: DisplayUnitId | null;
  sourceDomainNotice?: string;
}) {
  const backtest = forecast.backtest;
  const intervalKey = String(intervalLevel) as PredictionIntervalKey;
  if (!forecast.model || !forecast.horizon || !backtest) return null;
  return (
    <aside className="forecast-diagnostics" aria-label="Forecast model and backtest diagnostics">
      <div className="forecast-diagnostics-lead">
        <span>Statistical forecast</span>
        <strong>{forecast.model.label}</strong>
        <small>
          Origin {formatPeriod(forecast.origin.period)} · information through {formatDateTime(forecast.origin.information_cutoff)} · generated {formatDateTime(forecast.generated_at)}
        </small>
      </div>
      <dl>
        {forecast.origin.regime_start ? (
          <div><dt>Regime start</dt><dd>{formatPeriod(forecast.origin.regime_start)}</dd></div>
        ) : null}
        <div><dt>Horizon</dt><dd>{forecast.horizon.periods} {forecast.horizon.unit} periods</dd></div>
        <div><dt>Backtest errors</dt><dd>{backtest.forecast_errors || "Not available"}</dd></div>
        <div><dt>MAE</dt><dd>{formattedDisplayValue(backtest.mae, forecast.unit, displayUnit)}</dd></div>
        <div><dt>RMSE</dt><dd>{formattedDisplayValue(backtest.rmse, forecast.unit, displayUnit)}</dd></div>
        <div><dt>Directional accuracy</dt><dd>{formatRatio(backtest.directional_accuracy)}</dd></div>
        <div><dt>{intervalLevel}% interval coverage</dt><dd>{formatRatio(backtest.interval_coverage[intervalKey])}</dd></div>
        <div><dt>Vs. seasonal naive</dt><dd>{formatSkill(backtest.skill_vs_seasonal_naive)}</dd></div>
      </dl>
      <p>
        {backtest.status === "independent_holdout"
          ? "Latest-revised pseudo-out-of-sample evaluation; this is not a first-release vintage backtest."
          : "No independent holdout was available; treat these projections as a limited-history baseline."}
      </p>
      {sourceDomainNotice ? <p>{sourceDomainNotice}</p> : null}
      {forecast.fundamentals ? <FundamentalsDisclosure forecast={forecast} /> : null}
    </aside>
  );
}

function FundamentalsDisclosure({ forecast }: { forecast: ForecastAsset }) {
  const fundamentals = forecast.fundamentals;
  if (!fundamentals) return null;
  const roleLabels: Record<string, string> = {
    production: "Production",
    imports: "Imports",
    exports: "Exports",
    product_supplied: "Product supplied",
  };
  return (
    <details className="forecast-fundamentals" open={fundamentals.selected === true}>
      <summary>
        {fundamentals.status === "candidate_included"
          ? fundamentals.selected
            ? "Fundamental drivers selected this forecast"
            : "Fundamental drivers competed but were not selected"
          : "Fundamental drivers were withheld for this run"}
      </summary>
      <p className="forecast-fundamentals-identity">
        Registered accounting identity: <code>{fundamentals.identity}</code>
      </p>
      {fundamentals.status === "candidate_included" ? (
        <p>
          The fundamental net-balance candidate projects future net flows from the same-release
          driver series below and accumulates them from the latest stock level, with the
          unaccounted term estimated from recent balance residuals. It competes in the same
          rolling-origin selection as every univariate baseline and is
          {fundamentals.selected ? " currently the minimum-MAE model." : " not currently the minimum-MAE model."}
        </p>
      ) : (
        <p>{fundamentals.exclusion_reason}</p>
      )}
      <ul className="forecast-fundamentals-drivers">
        {fundamentals.drivers.map((driver) => (
          <li key={driver.role}>
            <strong>{roleLabels[driver.role] ?? driver.role}:</strong> <code>{driver.series_id}</code>
          </li>
        ))}
      </ul>
      <p className="forecast-fundamentals-note">{fundamentals.notes} Shared release timing means
        driver values carry the same information time as the target's own history; this remains a
        latest-revised vintage, and the identity is physical accounting, not a discovered correlation.</p>
    </details>
  );
}

export function SeasonalChart({
  asset,
  series,
  geographyId,
  onGeographyChange,
  geographyIds,
  regionMode,
  onGeographiesChange,
  onRegionModeChange,
  displayUnit,
  onDisplayUnitChange,
  forecast,
  forecastDisplayPoints,
  forecastNotice,
}: SeasonalChartProps) {
  const [intervalLevel, setIntervalLevel] = useState<PredictionIntervalLevel>(90);
  const [viewMode, setViewMode] = useState<SeasonalViewMode>("seasonal");
  const intervalControlId = useId();
  const viewControlId = useId();
  const resolvedDisplayUnit = resolveDisplayUnit(asset.unit, displayUnit);
  const chartForecast = useMemo(
    () => forecast && forecastDisplayPoints
      ? { ...forecast, points: forecastDisplayPoints }
      : forecast,
    [forecast, forecastDisplayPoints],
  );
  const forecastDiagnosticsDisplayUnit = forecast
    ? resolveDisplayUnit(forecast.unit, displayUnit)
    : null;
  const forecastSourceDomainNotice = forecast && forecast.unit !== asset.unit
    ? `Model selection, directional accuracy, and backtest error metrics remain in the source monthly ${getSourceUnitLabel(forecast.unit)} domain; the public forecast asset does not contain the dated evaluation errors needed to recompute them as kb/d.`
    : undefined;
  const monthlyAverageRateView = asset.methodology_version.includes("monthly-average-rate-");
  const model = useMemo(() => buildSeasonalChartModel(asset, chartForecast), [asset, chartForecast]);
  const changeModel = useMemo(() => buildPeriodChangeModel(asset), [asset]);
  const changeLabels = useMemo(() => changeChartLabels(asset), [asset]);
  const option = useMemo(
    () => (viewMode === "changes"
      ? buildChangeEChartsOption(asset, series.title, changeModel, resolvedDisplayUnit ?? undefined)
      : buildSeasonalEChartsOption(
          asset,
          series.title,
          chartForecast,
          intervalLevel,
          resolvedDisplayUnit ?? undefined,
        )),
    [asset, changeModel, chartForecast, intervalLevel, resolvedDisplayUnit, series.title, viewMode],
  );

  useEffect(() => {
    setIntervalLevel(90);
  }, [forecast?.target_view_id, forecast?.geography_id, forecast?.generated_at]);

  const viewModes: { id: SeasonalViewMode; label: string; description: string }[] = [
    {
      id: "seasonal",
      label: "Seasonal overlay",
      description: "Recent years vs the historical range, with the statistical forecast.",
    },
    {
      id: "changes",
      label: asset.unit === "thousand_barrels" ? "Builds & draws" : "Period changes",
      description: changeLabels.title,
    },
  ];

  const baselineDescription = asset.baseline.slots.length
    ? `Baseline ${asset.baseline.baseline_start_year ?? "—"}–${asset.baseline.baseline_end_year ?? "—"} · ${asset.baseline.eligible_year_count} complete years`
    : "Historical baseline is not available; observed and validated forecast values remain visible.";
  const chartAriaLabel = forecast
    ? `${series.title} seasonal chart with observed years, ${forecast.model?.label ?? "statistical"} forecasts, and a selected ${intervalLevel}% prediction interval. Interactive legend, hover details, and horizontal zoom are available.`
    : `${series.title} seasonal chart. Interactive legend, hover details, and horizontal zoom are available.`;

  return (
    <section className="analysis-panel seasonal-panel" aria-labelledby="seasonal-title">
      <div className="analysis-panel-heading">
        <div>
          <p className="section-kicker">Seasonal history + forecast</p>
          <h2 id="seasonal-title">Observed values and statistical projection</h2>
          <p>{baselineDescription}</p>
        </div>
        <div className="seasonal-heading-controls">
          <ChartGeographyControl
            series={series}
            geographyId={geographyId}
            onGeographyChange={onGeographyChange}
            geographyIds={geographyIds}
            regionMode={regionMode}
            onGeographiesChange={onGeographiesChange}
            onRegionModeChange={onRegionModeChange}
            compact
            chartLabel="Seasonal history and forecast"
          />
          {resolvedDisplayUnit && onDisplayUnitChange ? (
            <DisplayUnitControl
              sourceUnit={asset.unit}
              value={resolvedDisplayUnit}
              onChange={onDisplayUnitChange}
              compact
            />
          ) : null}
          <fieldset className="chart-view-control">
            <legend>Chart view</legend>
            <div role="group" aria-label="How this series is drawn">
              {viewModes.map((mode) => (
                <label key={mode.id} title={mode.description}>
                  <input
                    type="radio"
                    name={`${viewControlId}-chart-view`}
                    value={mode.id}
                    checked={viewMode === mode.id}
                    onChange={() => setViewMode(mode.id)}
                  />
                  <span>{mode.label}</span>
                </label>
              ))}
            </div>
          </fieldset>
          {forecast && viewMode === "seasonal" ? (
            <fieldset className="forecast-interval-control">
              <legend>Prediction interval</legend>
              <div>
                {INTERVAL_LEVELS.map((level) => (
                  <label key={level}>
                    <input
                      type="radio"
                      name={`${intervalControlId}-prediction-interval`}
                      value={level}
                      checked={intervalLevel === level}
                      onChange={() => setIntervalLevel(level)}
                    />
                    <span>{level}%</span>
                  </label>
                ))}
              </div>
              <output aria-live="polite">Showing {intervalLevel}% prediction interval</output>
            </fieldset>
          ) : null}
        </div>
      </div>

      {viewMode === "seasonal" && forecastNotice ? <p className="forecast-notice" role="status">{forecastNotice}</p> : null}
      {viewMode === "seasonal" && forecast ? (
        <ForecastDiagnostics
          forecast={forecast}
          intervalLevel={intervalLevel}
          displayUnit={forecastDiagnosticsDisplayUnit}
          sourceDomainNotice={forecastSourceDomainNotice}
        />
      ) : null}

      {viewMode === "changes" ? (
        changeModel.points.length ? (
          <>
            <EChartsCanvas
              option={option}
              ariaLabel={`${series.title}. ${changeLabels.title}. Interactive hover and horizontal zoom are available.`}
            />
            <p className="chart-footnote">
              {asset.unit === "thousand_barrels"
                ? "Bars above zero are stock builds; bars below zero are draws."
                : "Bars show the change from the directly preceding source period."}
              {" "}Changes are strictly period over period — distinct from year-over-year, seasonal,
              and source-revision comparisons. Gaps and nonnumeric periods produce no bar and are
              never zero-filled.{changeModel.skippedGaps > 0
                ? ` ${changeModel.skippedGaps} non-consecutive ${changeModel.skippedGaps === 1 ? "boundary was" : "boundaries were"} omitted.`
                : ""}
            </p>
            <details className="accessible-chart-summary">
              <summary>Latest {Math.min(8, changeModel.points.length)} period changes</summary>
              <div className="forecast-table-wrap">
                <table>
                  <caption>{series.title}: {changeLabels.title}</caption>
                  <thead>
                    <tr>
                      <th scope="col">Period</th>
                      <th scope="col">Change</th>
                      <th scope="col">Level</th>
                    </tr>
                  </thead>
                  <tbody>
                    {changeModel.points.slice(-8).reverse().map((point) => (
                      <tr key={point.period}>
                        <th scope="row">{formatPeriod(point.period)}</th>
                        <td>{asset.unit.toLowerCase() === "percent"
                          ? formatValue(point.change, "percentage points")
                          : formattedDisplayValue(point.change, asset.unit, resolvedDisplayUnit)}</td>
                        <td>{formattedDisplayValue(point.value, asset.unit, resolvedDisplayUnit)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          </>
        ) : (
          <p className="insufficient-message">
            No two consecutive numeric source periods are available, so no period-over-period
            change can be computed.
          </p>
        )
      ) : model.slots.length ? (
        <>
          <EChartsCanvas option={option} ariaLabel={chartAriaLabel} />
          <p className="chart-footnote">
            Solid lines are observed values; dashed lines are forecasts. The forecast shading is an empirical prediction interval,
            not certainty or a guarantee. Hover for exact values. Missing observations are not zero-filled.
            {monthlyAverageRateView
              ? " Monthly-average kb/d divides each source monthly flow by that month's exact calendar-day count."
              : ""}
          </p>
          <details className="accessible-chart-summary">
            <summary>Text summary of the latest observed seasonal point</summary>
            {asset.recent_years.map((year) => {
              const point = [...year.points].reverse().find((candidate) => candidate.value !== null);
              const band = point ? model.baselineBySlot.get(point.slot) : undefined;
              return (
                <p key={year.year}>
                  <strong>{year.year}:</strong> {point ? `${formattedDisplayValue(point.value, asset.unit, resolvedDisplayUnit)} in ${slotLabel(point.slot, asset.frequency)}` : "no usable observation"}
                  {band ? `; historical median ${formattedDisplayValue(band.median, asset.unit, resolvedDisplayUnit)} and range ${formattedDisplayValue(band.min, asset.unit, resolvedDisplayUnit)}–${formattedDisplayValue(band.max, asset.unit, resolvedDisplayUnit)}.` : "."}
                </p>
              );
            })}
          </details>
          {chartForecast ? (
            <details className="accessible-chart-summary forecast-table-summary">
              <summary>Forecast values and {intervalLevel}% prediction intervals</summary>
              <div className="forecast-table-wrap">
                <table>
                  <caption>
                    {chartForecast.model?.label ?? "Statistical forecast"}, origin {formatPeriod(chartForecast.origin.period)}
                  </caption>
                  <thead>
                    <tr>
                      <th scope="col">Target period</th>
                      <th scope="col">Horizon</th>
                      <th scope="col">Forecast</th>
                      <th scope="col">Lower {intervalLevel}%</th>
                      <th scope="col">Upper {intervalLevel}%</th>
                    </tr>
                  </thead>
                  <tbody>
                    {chartForecast.points.map((point) => {
                      const bounds = point.intervals[String(intervalLevel) as PredictionIntervalKey];
                      return (
                        <tr key={point.target_period}>
                          <th scope="row">{formatPeriod(point.target_period)}</th>
                          <td>H{point.horizon}</td>
                          <td>{formattedDisplayValue(point.value, asset.unit, resolvedDisplayUnit)}</td>
                          <td>{formattedDisplayValue(bounds.lower, asset.unit, resolvedDisplayUnit)}</td>
                          <td>{formattedDisplayValue(bounds.upper, asset.unit, resolvedDisplayUnit)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </details>
          ) : null}
        </>
      ) : (
        <p className="insufficient-message">The validated asset does not yet contain chartable observed or forecast values.</p>
      )}
    </section>
  );
}

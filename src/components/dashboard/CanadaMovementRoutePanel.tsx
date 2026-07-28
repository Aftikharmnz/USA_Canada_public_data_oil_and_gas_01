import { useEffect, useMemo, useState } from "react";
import * as echarts from "echarts/core";
import { BarChart } from "echarts/charts";
import {
  AriaComponent,
  GridComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsOption } from "echarts";
import {
  buildCanadaMovementModel,
  type CanadaMovementModel,
} from "../../charts/canadaMovementModel";
import type { CanadaMovementContext } from "../../data/canadaMovement";
import { useCountryChartAssets } from "../../hooks/useCountryAssets";
import {
  compactUnit,
  formatPeriod,
  formatValue,
} from "../../lib/formatters";
import { monthlyVolumeToKbPerDay } from "../../lib/periodAverageRate";
import { convertUnitValue, type DisplayUnitId } from "../../lib/units";
import type { UsaManifestSeries } from "../../types/energyAssets";

echarts.use([BarChart, AriaComponent, GridComponent, TooltipComponent, CanvasRenderer]);

const ROUTE_COLORS: Record<string, string> = {
  "ca.ab": "#0072B2",
  "ca.bc": "#E69F00",
  "ca.mb": "#009E73",
  "ca.nt": "#7A5195",
  "ca.on": "#F0E442",
  "ca.qc": "#00A6A6",
  "ca.sk": "#EF5675",
};

interface CanadaMovementRoutePanelProps {
  series: UsaManifestSeries;
  context: CanadaMovementContext;
  displayUnit: DisplayUnitId;
  monthlyAverageRate?: boolean;
}

function displayNumber(
  value: number | null,
  period: string,
  sourceUnit: string,
  displayUnit: DisplayUnitId,
  monthlyAverageRate: boolean,
): number | null {
  if (monthlyAverageRate) {
    if (displayUnit !== "thousand_barrels_per_day") {
      throw new Error("Monthly-average movement display requires kb/d.");
    }
    return monthlyVolumeToKbPerDay(value, period, sourceUnit);
  }
  return convertUnitValue(value, sourceUnit, displayUnit);
}

function displayValue(
  value: number | null,
  period: string,
  sourceUnit: string,
  displayUnit: DisplayUnitId,
  monthlyAverageRate: boolean,
): string {
  return formatValue(
    displayNumber(value, period, sourceUnit, displayUnit, monthlyAverageRate),
    displayUnit,
  );
}

function statusLabel(status: string): string {
  return status.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

export function canadaMovementOption(
  model: CanadaMovementModel,
  context: CanadaMovementContext,
  displayUnit: DisplayUnitId,
  monthlyAverageRate = false,
): EChartsOption {
  const sortedRows = [...model.rows].sort((left, right) => (
    (right.value ?? Number.NEGATIVE_INFINITY) - (left.value ?? Number.NEGATIVE_INFINITY)
    || left.geographyLabel.localeCompare(right.geographyLabel)
  ));
  return {
    animationDuration: 250,
    aria: {
      enabled: true,
      description:
        `Published ${context.geographyRole.toLowerCase()} routes for ${formatPeriod(model.period)}. Missing route facts remain unavailable rather than zero.`,
    },
    grid: { left: 150, right: 26, top: 18, bottom: 44 },
    tooltip: {
      trigger: "item",
      confine: true,
      backgroundColor: "rgba(11, 49, 59, 0.97)",
      borderWidth: 0,
      textStyle: { color: "#e9f1f2", fontSize: 11 },
      formatter: (params: unknown) => {
        if (typeof params !== "object" || params === null || !("dataIndex" in params)) return "";
        const row = sortedRows[(params as { dataIndex: number }).dataIndex];
        if (!row) return "";
        const current = displayValue(
          row.value,
          model.period,
          model.sourceUnit,
          displayUnit,
          monthlyAverageRate,
        );
        let delta = "Not available";
        if (row.value !== null && row.previousValue !== null && row.previousPeriod) {
          const currentNumber = displayNumber(
            row.value,
            model.period,
            model.sourceUnit,
            displayUnit,
            monthlyAverageRate,
          );
          const previousNumber = displayNumber(
            row.previousValue,
            row.previousPeriod,
            model.sourceUnit,
            displayUnit,
            monthlyAverageRate,
          );
          if (currentNumber !== null && previousNumber !== null) {
            const difference = currentNumber - previousNumber;
            delta = `${difference > 0 ? "+" : ""}${formatValue(difference, displayUnit)}`;
          }
        }
        return `<div class="echarts-tooltip"><strong>${row.routeLabel}</strong>`
          + `<div class="echarts-tooltip-row"><span>Published movement</span><b>${current}</b></div>`
          + `<div class="echarts-tooltip-row"><span>Prior-period change</span><b>${delta}</b></div>`
          + `<small>${statusLabel(row.status)} · ${model.mode}</small></div>`;
      },
    },
    xAxis: {
      type: "value",
      name: compactUnit(displayUnit),
      nameLocation: "middle",
      nameGap: 28,
      nameTextStyle: { color: "#71858a", fontSize: 10, fontWeight: 700 },
      axisLabel: {
        color: "#71858a",
        fontSize: 10,
        formatter: (value: number) => new Intl.NumberFormat("en-US", {
          notation: Math.abs(value) >= 10_000 ? "compact" : "standard",
          maximumFractionDigits: 1,
        }).format(value),
      },
      splitLine: { lineStyle: { color: "#e3eae8" } },
    },
    yAxis: {
      type: "category",
      inverse: true,
      data: sortedRows.map((row) => row.routeLabel),
      axisLine: { lineStyle: { color: "#b9cbc6" } },
      axisTick: { show: false },
      axisLabel: {
        color: "#526b71",
        fontSize: 10,
        width: 132,
        overflow: "truncate",
      },
    },
    series: [{
      name: "Published route",
      type: "bar",
      barMaxWidth: 30,
      data: sortedRows.map((row) => ({
        value: displayNumber(
          row.value,
          model.period,
          model.sourceUnit,
          displayUnit,
          monthlyAverageRate,
        ),
        itemStyle: { color: ROUTE_COLORS[row.geographyId] ?? "#7d91a0" },
      })),
    }],
  };
}

function RouteCanvas({
  option,
  ariaLabel,
}: {
  option: EChartsOption;
  ariaLabel: string;
}) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!container) return;
    const chart = echarts.init(container, undefined, { renderer: "canvas" });
    chart.setOption(option);
    const observer = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => chart.resize());
    observer?.observe(container);
    return () => {
      observer?.disconnect();
      chart.dispose();
    };
  }, [container, option]);
  return <div ref={setContainer} className="echarts-movement-routes" role="img" aria-label={ariaLabel} />;
}

export function CanadaMovementRoutePanel({
  series,
  context,
  displayUnit,
  monthlyAverageRate = false,
}: CanadaMovementRoutePanelProps) {
  const geographies = useMemo(
    () => series.geographies.filter(
      (geography) => geography.level_id === "province_territory",
    ),
    [series],
  );
  const availableGeographies = useMemo(
    () => geographies.filter(
      (geography): geography is typeof geography & { asset_path: string } => (
        geography.status === "available" && Boolean(geography.asset_path)
      ),
    ),
    [geographies],
  );
  const paths = useMemo(
    () => availableGeographies.map((geography) => geography.asset_path),
    [availableGeographies],
  );
  const { state, retry } = useCountryChartAssets("canada", paths);
  const built = useMemo(() => {
    if (!("data" in state) || !state.data || state.data.length !== paths.length) {
      return {} as { model?: CanadaMovementModel; error?: string };
    }
    try {
      return {
        model: buildCanadaMovementModel(
          series,
          context,
          availableGeographies.map((geography, index) => ({
            geography,
            asset: state.data![index]!,
          })),
        ),
      };
    } catch (error) {
      return {
        error: error instanceof Error
          ? error.message
          : "The movement route comparison could not be validated.",
      };
    }
  }, [availableGeographies, context, paths.length, series, state]);
  const model = built.model;
  const option = useMemo(
    () => model ? canadaMovementOption(model, context, displayUnit, monthlyAverageRate) : undefined,
    [context, displayUnit, model, monthlyAverageRate],
  );
  const heading = context.direction === "from-united-states"
    ? "Published receiving routes from the United States"
    : `Published shipping origins to ${context.fixedEndpoint}`;

  return (
    <section className="analysis-panel movement-route-panel" aria-labelledby="movement-route-title">
      <div className="analysis-panel-heading">
        <div>
          <p className="section-kicker">Published pipeline route matrix</p>
          <h2 id="movement-route-title">{heading}</h2>
          <p>
            Each bar is one exact Statistics Canada shipping → receiving coordinate.
            It is a pipeline route comparison, not a reconstructed all-mode import total.
          </p>
        </div>
        {model ? (
          <div className="contribution-period-badge">
            <span>Source period</span>
            <strong>{formatPeriod(model.period)}</strong>
          </div>
        ) : null}
      </div>
      {state.status === "loading" && !model ? (
        <p className="forecast-notice" role="status">Loading published route coordinates…</p>
      ) : null}
      {state.status === "error" || built.error ? (
        <div className="contribution-error" role="status">
          <p>{state.status === "error" ? state.error : built.error}</p>
          <button type="button" className="retry-button" onClick={retry}>Try again</button>
        </div>
      ) : null}
      {state.status === "stale" && model ? (
        <p className="contribution-warning" role="status">
          Using the last validated route assets at their displayed source period because the newest
          asset request failed: {state.error}
        </p>
      ) : null}
      {model && option ? (
        <>
          <div className="movement-route-summary">
            <span>{model.numericRouteCount}/{model.declaredRouteCount} declared route coordinates have numeric facts for this exact period</span>
            <span>{model.product} · {model.mode}</span>
          </div>
          <RouteCanvas
            option={option}
            ariaLabel={`${heading} in ${formatPeriod(model.period)}. Missing source coordinates remain unavailable, not zero.`}
          />
          <details className="accessible-chart-summary">
            <summary>Route values and publication status</summary>
            <div className="forecast-table-wrap">
              <table>
                <caption>{formatPeriod(model.period)} · {compactUnit(displayUnit)} · pipeline only</caption>
                <thead>
                  <tr>
                    <th scope="col">Shipping origin → receiving destination</th>
                    <th scope="col">Published movement</th>
                    <th scope="col">Publication status</th>
                    <th scope="col">Route class</th>
                  </tr>
                </thead>
                <tbody>
                  {model.rows.map((row) => (
                    <tr key={row.geographyId}>
                      <th scope="row">{row.routeLabel}</th>
                      <td>{displayValue(
                        row.value,
                        model.period,
                        model.sourceUnit,
                        displayUnit,
                        monthlyAverageRate,
                      )}</td>
                      <td>{statusLabel(row.status)}</td>
                      <td>{row.route?.classification.replaceAll("-", " ") ?? "No published fact"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <p className="chart-footnote">
            Missing route coordinates are not zeros. The source-published Canada aggregate, where
            present, may overlap provincial routes and is deliberately not summed or reconciled here.
            These movements do not reveal terminal-level paths or transit provinces.
          </p>
        </>
      ) : null}
    </section>
  );
}

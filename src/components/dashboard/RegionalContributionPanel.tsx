import { useEffect, useMemo, useState } from "react";
import * as echarts from "echarts/core";
import { BarChart, LineChart } from "echarts/charts";
import {
  AriaComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsOption } from "echarts";
import {
  buildRegionalContributionModel,
  type RegionalContributionModel,
} from "../../charts/regionalContributionModel";
import type { RegionalContributionSpec } from "../../data/regionalContributions";
import { useCountryChartAssets } from "../../hooks/useCountryAssets";
import {
  compactUnit,
  formatDisplayNumber,
  formatPeriod,
  formatValue,
} from "../../lib/formatters";
import { monthlyVolumeToAverageRate } from "../../lib/periodAverageRate";
import {
  convertUnitValue,
  type DisplayUnitId,
} from "../../lib/units";
import type { UsaManifestSeries } from "../../types/energyAssets";

echarts.use([
  BarChart,
  LineChart,
  AriaComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

const REGION_COLORS: Record<string, string> = {
  "ca.ab": "#0072B2",
  "ca.bc": "#E69F00",
  "ca.mb": "#009E73",
  "ca.nb": "#CC79A7",
  "ca.nl": "#56B4E9",
  "ca.ns": "#D55E00",
  "ca.nt": "#7A5195",
  "ca.nu": "#2F4B7C",
  "ca.on": "#F0E442",
  "ca.pe": "#A6761D",
  "ca.qc": "#00A6A6",
  "ca.sk": "#EF5675",
  "ca.yt": "#665191",
  "us.padd.1": "#0072B2",
  "us.padd.2": "#E69F00",
  "us.padd.3": "#009E73",
  "us.padd.4": "#CC79A7",
  "us.padd.5": "#D55E00",
  "us.padd.4-and-5": "#7A5195",
};

interface RegionalContributionPanelProps {
  series: UsaManifestSeries;
  spec: RegionalContributionSpec;
  displayUnit: DisplayUnitId;
  monthlyAverageRate?: boolean;
}

interface BuiltModel {
  model?: RegionalContributionModel;
  error?: string;
}

function displayNumber(
  value: number | null,
  period: string,
  sourceUnit: string,
  displayUnit: DisplayUnitId,
  monthlyAverageRate: boolean,
): number | null {
  if (monthlyAverageRate) {
    return monthlyVolumeToAverageRate(value, period, sourceUnit, displayUnit);
  }
  return convertUnitValue(value, sourceUnit, displayUnit);
}

function formattedDisplayValue(
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

function formattedSignedDisplayValue(
  value: number | null,
  period: string,
  sourceUnit: string,
  displayUnit: DisplayUnitId,
  monthlyAverageRate: boolean,
): string {
  if (value === null) return "Not available";
  return `${value > 0 ? "+" : ""}${formattedDisplayValue(
    value,
    period,
    sourceUnit,
    displayUnit,
    monthlyAverageRate,
  )}`;
}

function formattedDisplayDelta(
  currentValue: number | null,
  currentPeriod: string,
  previousValue: number | null,
  previousPeriod: string | null,
  sourceUnit: string,
  displayUnit: DisplayUnitId,
  monthlyAverageRate: boolean,
): string {
  if (currentValue === null || previousValue === null || !previousPeriod) return "Not available";
  const current = displayNumber(
    currentValue,
    currentPeriod,
    sourceUnit,
    displayUnit,
    monthlyAverageRate,
  );
  const previous = displayNumber(
    previousValue,
    previousPeriod,
    sourceUnit,
    displayUnit,
    monthlyAverageRate,
  );
  if (current === null || previous === null) return "Not available";
  const delta = current - previous;
  return `${delta > 0 ? "+" : ""}${formatValue(delta, displayUnit)}`;
}

function statusLabel(status: string): string {
  return status.replaceAll("_", " ").replace(/\b\w/g, (character) => character.toUpperCase());
}

function percentLabel(value: number | null): string {
  if (value === null || !Number.isFinite(value)) return "Not available";
  return `${new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 }).format(value)}%`;
}

export function regionalContributionOption(
  model: RegionalContributionModel,
  spec: RegionalContributionSpec,
  displayUnit: DisplayUnitId,
  monthlyAverageRate = false,
): EChartsOption {
  const componentSeries = spec.components.map((geography) => ({
    name: geography.label,
    type: "bar" as const,
    stack: "published-components",
    barMaxWidth: 48,
    itemStyle: { color: REGION_COLORS[geography.geographyId] ?? "#7d91a0" },
    emphasis: { focus: "series" as const },
    data: model.periods.map((period) => {
      if (!period.complete) return null;
      const component = period.components.find(
        (candidate) => candidate.geographyId === geography.geographyId,
      );
      return displayNumber(
        component?.value ?? null,
        period.period,
        model.sourceUnit,
        displayUnit,
        monthlyAverageRate,
      );
    }),
  }));
  return {
    animationDuration: 250,
    aria: {
      enabled: true,
      description:
        `${seriesLabel(model.frequency)} import composition. Colored stacked bars are published ${spec.componentLevelLabel} values and the dark line is the separately published national total.`,
    },
    grid: { left: 66, right: 24, top: 88, bottom: 54 },
    legend: {
      type: "scroll",
      top: 8,
      left: 8,
      right: 8,
      itemWidth: 12,
      itemHeight: 8,
      textStyle: { color: "#526b71", fontSize: 10 },
    },
    tooltip: {
      trigger: "axis",
      confine: true,
      backgroundColor: "rgba(11, 49, 59, 0.97)",
      borderWidth: 0,
      textStyle: { color: "#e9f1f2", fontSize: 11 },
      formatter: (params: unknown) => {
        const first = Array.isArray(params) ? params[0] : params;
        if (typeof first !== "object" || first === null || !("dataIndex" in first)) return "";
        const period = model.periods[(first as { dataIndex: number }).dataIndex];
        if (!period) return "";
        const rows = period.components.map((component) => {
          const value = formattedDisplayValue(
            component.value,
            period.period,
            model.sourceUnit,
            displayUnit,
            monthlyAverageRate,
          );
          const detail = component.value === null
            ? statusLabel(component.status)
            : `${percentLabel(component.shareOfNational)} of official total`;
          return `<div class="echarts-tooltip-row"><span>${component.label}</span><b>${value}</b><small>${detail}</small></div>`;
        }).join("");
        return `<div class="echarts-tooltip"><strong>${formatPeriod(period.period)}</strong>`
          + `<div class="echarts-tooltip-row echarts-tooltip-total"><span>Official ${spec.nationalLabel} total</span><b>${formattedDisplayValue(period.nationalValue, period.period, model.sourceUnit, displayUnit, monthlyAverageRate)}</b></div>`
          + rows
          + `<small>${period.numericComponentCount}/${period.expectedComponentCount} component values are numeric for this exact period.</small></div>`;
      },
    },
    xAxis: {
      type: "category",
      data: model.periods.map((period) => formatPeriod(period.period)),
      axisLine: { lineStyle: { color: "#b9cbc6" } },
      axisTick: { show: false },
      axisLabel: { color: "#71858a", fontSize: 10, hideOverlap: true },
    },
    yAxis: {
      type: "value",
      name: compactUnit(displayUnit),
      nameTextStyle: { color: "#71858a", fontSize: 10, fontWeight: 700 },
      axisLabel: {
        color: "#71858a",
        fontSize: 10,
        formatter: (value: number) => formatDisplayNumber(value, displayUnit, true),
      },
      splitLine: { lineStyle: { color: "#e3eae8" } },
    },
    series: [
      ...componentSeries,
      {
        name: `Official ${spec.nationalLabel} total`,
        type: "line",
        symbol: "diamond",
        symbolSize: 8,
        connectNulls: false,
        z: 10,
        lineStyle: { color: "#17343a", width: 2.5 },
        itemStyle: { color: "#17343a" },
        data: model.periods.map((period) => displayNumber(
          period.nationalValue,
          period.period,
          model.sourceUnit,
          displayUnit,
          monthlyAverageRate,
        )),
      },
    ],
  };
}

function seriesLabel(frequency: string): string {
  return frequency.toLowerCase().startsWith("week") ? "Weekly" : "Monthly";
}

function ContributionCanvas({
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
  return (
    <div
      ref={setContainer}
      className="echarts-regional-contribution"
      role="img"
      aria-label={ariaLabel}
    />
  );
}

export function RegionalContributionPanel({
  series,
  spec,
  displayUnit,
  monthlyAverageRate = false,
}: RegionalContributionPanelProps) {
  const paths = useMemo(
    () => [spec.nationalAssetPath, ...spec.components.map((component) => component.assetPath)],
    [spec],
  );
  const { state, retry } = useCountryChartAssets(spec.country, paths);
  const built = useMemo((): BuiltModel => {
    const data = "data" in state ? state.data : undefined;
    if (!data || data.length !== paths.length) return {};
    try {
      return {
        model: buildRegionalContributionModel(
          series,
          spec,
          data[0]!,
          spec.components.map((geography, index) => ({
            geography,
            asset: data[index + 1]!,
          })),
        ),
      };
    } catch (error) {
      return {
        error: error instanceof Error
          ? error.message
          : "The regional contribution model could not be validated.",
      };
    }
  }, [paths.length, series, spec, state]);
  const model = built.model;
  const option = useMemo(
    () => model
      ? regionalContributionOption(model, spec, displayUnit, monthlyAverageRate)
      : undefined,
    [displayUnit, model, monthlyAverageRate, spec],
  );

  return (
    <section className="analysis-panel regional-contribution-panel" aria-labelledby="regional-contribution-title">
      <div className="analysis-panel-heading">
        <div>
          <p className="section-kicker">National import composition</p>
          <h2 id="regional-contribution-title">{spec.title}</h2>
          <p>{spec.description}</p>
        </div>
        {model ? (
          <div className="contribution-period-badge">
            <span>Latest source period</span>
            <strong>{formatPeriod(model.latest.period)}</strong>
          </div>
        ) : null}
      </div>

      {state.status === "loading" && !model ? (
        <p className="forecast-notice" role="status">Loading the official total and regional components…</p>
      ) : null}
      {state.status === "error" || built.error ? (
        <div className="contribution-error" role="status">
          <p>{state.status === "error" ? state.error : built.error}</p>
          <button type="button" className="retry-button" onClick={retry}>Try again</button>
        </div>
      ) : null}
      {state.status === "stale" ? (
        <p className="forecast-notice" role="status">
          Using the last validated regional composition because the newest request failed: {state.error}
        </p>
      ) : null}

      {model && option ? (
        <>
          <div className="contribution-summary-grid">
            <div>
              <span>Official {spec.nationalLabel} total</span>
              <strong>{formattedDisplayValue(
                model.latest.nationalValue,
                model.latest.period,
                model.sourceUnit,
                displayUnit,
                monthlyAverageRate,
              )}</strong>
              <small>{statusLabel(model.latest.nationalStatus)}</small>
            </div>
            <div>
              <span>Published component subtotal</span>
              <strong>{model.latest.numericComponentCount
                ? formattedDisplayValue(
                    model.latest.componentSum,
                    model.latest.period,
                    model.sourceUnit,
                    displayUnit,
                    monthlyAverageRate,
                  )
                : "Not available"}</strong>
            </div>
            <div>
              <span>Numeric coverage</span>
              <strong>
                {model.latest.numericComponentCount}/{model.latest.expectedComponentCount}
              </strong>
            </div>
            <div>
              <span>Official total minus components</span>
              <strong>{model.latest.reconciliationDifference === null
                ? "Not calculated"
                : formattedSignedDisplayValue(
                    model.latest.reconciliationDifference,
                    model.latest.period,
                    model.sourceUnit,
                    displayUnit,
                    monthlyAverageRate,
                  )}</strong>
            </div>
          </div>
          {!model.latest.complete ? (
            <p className="contribution-warning" role="status">
              The latest breakdown is incomplete. Missing, suppressed, or unavailable regions remain
              nonnumeric; its stacked composition is withheld and the published subtotal is not
              presented as a reconstructed national total. Exact known regional values remain in the table.
            </p>
          ) : model.latest.reconciliationDifference !== 0 ? (
            <p className="contribution-note">
              The signed difference is a source reconciliation or rounding diagnostic. It is not an
              invented “Other” region, and no regional value has been adjusted to force equality.
            </p>
          ) : null}
          <ContributionCanvas
            option={option}
            ariaLabel={`${series.title}: stacked source-published ${spec.componentLevelLabel} values with a separate official ${spec.nationalLabel} total line.`}
          />
          <details className="accessible-chart-summary">
            <summary>Latest regional values and shares</summary>
            <div className="forecast-table-wrap">
              <table>
                <caption>
                  {formatPeriod(model.latest.period)} · {compactUnit(displayUnit)} · exact-period source observations
                </caption>
                <thead>
                  <tr>
                    <th scope="col">{spec.componentLevelLabel}</th>
                    <th scope="col">Published value</th>
                    <th scope="col">Share of official total</th>
                    <th scope="col">Change from prior source period</th>
                    <th scope="col">Publication status</th>
                  </tr>
                </thead>
                <tbody>
                  {model.latest.components.map((component) => (
                    <tr key={component.geographyId}>
                      <th scope="row">
                        <span
                          className="contribution-color-key"
                          style={{ backgroundColor: REGION_COLORS[component.geographyId] ?? "#7d91a0" }}
                          aria-hidden="true"
                        />
                        {component.label}
                      </th>
                      <td>{formattedDisplayValue(
                        component.value,
                        model.latest.period,
                        model.sourceUnit,
                        displayUnit,
                        monthlyAverageRate,
                      )}</td>
                      <td>{percentLabel(component.shareOfNational)}</td>
                      <td>{formattedDisplayDelta(
                        component.value,
                        model.latest.period,
                        component.previousValue,
                        component.previousPeriod,
                        model.sourceUnit,
                        displayUnit,
                        monthlyAverageRate,
                      )}</td>
                      <td>{statusLabel(component.status)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
          <p className="chart-footnote">
            {spec.geographyDisclosure} The official national observation remains authoritative.
            Component percentages use that value as the denominator; incomplete components are never
            rescaled to 100%.
          </p>
        </>
      ) : null}
    </section>
  );
}

import { useEffect, useMemo, useState } from "react";
import * as echarts from "echarts/core";
import { BarChart } from "echarts/charts";
import { AriaComponent, GridComponent, LegendComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsOption } from "echarts";
import {
  prepareRegionalSupplyDemand,
  regionalSupplyDemandSnapshot,
  type RegionalSupplyDemandSnapshotRow,
} from "../../charts/regionalSupplyDemandModel";
import {
  regionalProfileMeasuresForFrequency,
  type RegionalProfileModel,
  type RegionalProfileGeography,
  type RegionalProfileFrequencyMode,
} from "../../data/regionalProfile";
import { isRegisteredMonthlyAverageRateSeries } from "../../data/canadaRateDisplay";
import { useCountryChartAssets } from "../../hooks/useCountryAssets";
import { formatDisplayNumber, formatPeriod } from "../../lib/formatters";
import { monthlyAverageRateOptions, monthlyVolumeToAverageRate } from "../../lib/periodAverageRate";
import {
  convertUnitValue, getDisplayUnitOptions, getSourceUnitLabel, resolveDisplayUnit,
  type DisplayUnitId,
} from "../../lib/units";
import type { CountryCode } from "../../types/catalog";
import { ChartDetailsToggle } from "./ChartDetailsToggle";
import { DashboardError, DashboardLoading, LastKnownGoodNotice } from "./DashboardStates";
import { DisplayUnitControl } from "./DisplayUnitControl";
import { ExpandablePanel } from "./ExpandablePanel";
import "./regionalSupplyDemand.css";

echarts.use([BarChart, AriaComponent, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer]);

interface Props {
  country: CountryCode;
  profile: RegionalProfileModel;
  frequency: RegionalProfileFrequencyMode;
  generatedAt: string;
  geographies: readonly RegionalProfileGeography[];
  onGeographyChange: (id: string) => void;
}

export function supplyDemandDisplayValue(
  row: RegionalSupplyDemandSnapshotRow,
  value: number | null,
  period: string,
  displayUnit: DisplayUnitId,
): number | null {
  if (!row.isStock && row.frequency === "monthly" && row.unit === "cubic_metres"
      && isRegisteredMonthlyAverageRateSeries(row.seriesId)
      && getDisplayUnitOptions("thousand_barrels_per_day").some((option) => option.id === displayUnit)) {
    return monthlyVolumeToAverageRate(value, period, row.unit, displayUnit);
  }
  return convertUnitValue(value, row.unit, displayUnit);
}

/** Independent source quantities, never stacked or portrayed as a closed accounting identity. */
export function supplyDemandOption(
  rows: readonly RegionalSupplyDemandSnapshotRow[],
  period: string,
  previousPeriod: string,
  unit: DisplayUnitId,
  comparePrevious: boolean,
): EChartsOption {
  const current = rows.map((row) => supplyDemandDisplayValue(row, row.value, period, unit));
  const previous = rows.map((row) => supplyDemandDisplayValue(row, row.previousValue, previousPeriod, unit));
  const unitLabel = getSourceUnitLabel(unit, true);
  return {
    animation: false,
    aria: { enabled: true, label: { description: `Available components for ${formatPeriod(period)} in ${unitLabel}. Independent source quantities; not a reconciled balance. Missing values are not zero.` } },
    grid: { left: 8, right: 24, top: 38, bottom: 34, containLabel: true },
    legend: { top: 2, textStyle: { fontSize: 10 }, data: [formatPeriod(period), ...(comparePrevious ? [formatPeriod(previousPeriod)] : [])] },
    tooltip: {
      trigger: "axis", renderMode: "richText", confine: true,
      formatter: (params: unknown) => {
        const item = (Array.isArray(params) ? params[0] : params) as { dataIndex?: number } | undefined;
        const index = item?.dataIndex;
        const row = index === undefined ? undefined : rows[index];
        if (!row || index === undefined) return "";
        const value = current[index] ?? null;
        const prior = previous[index] ?? null;
        return [row.label,
          `${formatPeriod(period)}: ${value === null ? row.status : `${formatDisplayNumber(value, unit)} ${unitLabel} · ${row.status}`}`,
          ...(comparePrevious ? [`${formatPeriod(previousPeriod)}: ${prior === null ? "Not available" : `${formatDisplayNumber(prior, unit)} ${unitLabel}`}`] : []),
          ...(value !== null && prior !== null ? [`Change: ${formatDisplayNumber(value - prior, unit)} ${unitLabel}`] : []),
          row.isDerived ? "Monthly view derived from weekly data" : row.sourceName,
        ].join("\n");
      },
    },
    xAxis: { type: "value", name: unitLabel, nameLocation: "middle", nameGap: 24, splitNumber: 4,
      axisLabel: { fontSize: 10, hideOverlap: true, formatter: (value: number) => new Intl.NumberFormat("en", { notation: "compact", maximumFractionDigits: 1 }).format(value) },
      splitLine: { lineStyle: { color: "#e2ece8" } } },
    yAxis: { type: "category", inverse: true, data: rows.map((row) => row.label), axisLabel: { fontSize: 10, width: 160, overflow: "break" }, axisTick: { show: false }, axisLine: { show: false } },
    series: [
      { name: formatPeriod(period), type: "bar", data: current, barMaxWidth: 19, itemStyle: { color: "#078575" }, label: { show: true, position: "right", fontSize: 10, formatter: (params: { data: unknown }) => typeof params.data === "number" ? formatDisplayNumber(params.data, unit) : "" } },
      ...(comparePrevious ? [{ name: formatPeriod(previousPeriod), type: "bar" as const, data: previous, barMaxWidth: 19, itemStyle: { color: "#b3c7c3" } }] : []),
    ],
  };
}

function ComponentChart({ option, label, rows }: { option: EChartsOption; label: string; rows: number }) {
  const [container, setContainer] = useState<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!container) return;
    const chart = echarts.init(container, undefined, { renderer: "canvas" });
    chart.setOption(option);
    const observer = new ResizeObserver(() => chart.resize());
    observer.observe(container);
    return () => { observer.disconnect(); chart.dispose(); };
  }, [container, option]);
  return <div ref={setContainer} className="supply-demand-chart" style={{ minHeight: Math.max(180, rows * 60 + 80) }} role="img" aria-label={label} />;
}

export function RegionalSupplyDemandPanel({ country, profile, frequency, generatedAt, geographies, onGeographyChange }: Props) {
  const available = regionalProfileMeasuresForFrequency(profile.productMeasures, frequency)
    .filter((measure) => measure.availability === "available" && measure.geography?.asset_path);
  const paths = available.map((measure) => measure.geography!.asset_path!);
  const { state, retry } = useCountryChartAssets(country, paths);
  const [requestedPeriod, setRequestedPeriod] = useState("");
  const [requestedFlowUnit, setRequestedFlowUnit] = useState<DisplayUnitId>();
  const [requestedStockUnit, setRequestedStockUnit] = useState<DisplayUnitId>();
  const [comparePrevious, setComparePrevious] = useState(true);
  const prepared = useMemo(() => {
    if (!("data" in state) || !state.data) return {};
    try { return { model: prepareRegionalSupplyDemand(profile, state.data, frequency, generatedAt) }; }
    catch (error) { return { error: error instanceof Error ? error.message : "The component comparison could not be validated." }; }
  }, [profile, state, frequency, generatedAt]);
  const model = prepared.model;
  const period = model?.periods.includes(requestedPeriod) ? requestedPeriod : model?.latestPeriod ?? "";
  const snapshot = model && period ? regionalSupplyDemandSnapshot(model, period) : undefined;
  const flows = snapshot?.rows.filter((row) => !row.isStock && row.unit !== "days" && row.unit !== "percent") ?? [];
  const stocks = snapshot?.rows.filter((row) => row.isStock) ?? [];
  const firstFlow = flows[0];
  const firstStock = stocks[0];
  const flowSeries = available.find((measure) => measure.series.series_id === firstFlow?.seriesId)?.series;
  const rateOptions = flowSeries && flows.every((row) => (
    row.frequency === "monthly" && !row.isStock && isRegisteredMonthlyAverageRateSeries(row.seriesId)
  )) ? monthlyAverageRateOptions(flowSeries) : [];
  const flowUnit = rateOptions.some((option) => option.id === requestedFlowUnit)
    ? requestedFlowUnit!
    : resolveDisplayUnit(firstFlow?.unit ?? "", requestedFlowUnit);
  const stockUnit = resolveDisplayUnit(firstStock?.unit ?? "", requestedStockUnit);
  const periodIndex = model?.periods.indexOf(period) ?? -1;
  const flowOption = useMemo(() => snapshot && flowUnit
    ? supplyDemandOption(flows, period, snapshot.previousPeriod, flowUnit, comparePrevious) : undefined,
  [snapshot, flowUnit, flows, period, comparePrevious]);
  const stockOption = useMemo(() => snapshot && stockUnit
    ? supplyDemandOption(stocks, period, snapshot.previousPeriod, stockUnit, comparePrevious) : undefined,
  [snapshot, stockUnit, stocks, period, comparePrevious]);

  if (!paths.length) return null;
  if (state.status === "loading") return <DashboardLoading label="Loading aligned supply and demand components" />;
  if (state.status === "error" || prepared.error) return <DashboardError title="Component comparison unavailable" message={prepared.error ?? (state.status === "error" ? state.error : "Invalid component data.")} onRetry={retry} />;
  if (!model || !snapshot) return <p className="profile-empty-copy">No comparable source periods are available.</p>;

  return (
    <ExpandablePanel title={`Supply and demand components — ${profile.product?.label} — ${profile.geography?.label}`} className="supply-demand-panel">
      <header className="profile-card-heading graph-first-heading">
        <div className="graph-first-title">
          <h3>Supply &amp; demand components</h3>
          <p className="graph-first-location">{profile.product?.label} · {profile.geography?.label}</p>
        </div>
        <span className="profile-frequency-badge">{frequency} · {flows.some((row) => row.isDerived) || stocks.some((row) => row.isDerived) ? "derived views included" : "source"}</span>
      </header>
      <div className="supply-demand-controls">
        <label>Geography
          <select aria-label="Geography for supply and demand components" value={profile.geography?.geographyId ?? ""} onChange={(event) => onGeographyChange(event.target.value)}>
            {geographies.map((geography) => <option key={geography.geographyId} value={geography.geographyId}>{geography.label}</option>)}
          </select>
        </label>
        <div className="supply-demand-period">
          <button type="button" aria-label="Previous source period" disabled={periodIndex <= 0} onClick={() => setRequestedPeriod(model.periods[periodIndex - 1]!)}>←</button>
          <label>Source period
            <select aria-label="Supply and demand source period" value={period} onChange={(event) => setRequestedPeriod(event.target.value)}>
              {[...model.periods].reverse().map((item) => <option key={item} value={item}>{formatPeriod(item)}</option>)}
            </select>
          </label>
          <button type="button" aria-label="Next source period" disabled={periodIndex >= model.periods.length - 1} onClick={() => setRequestedPeriod(model.periods[periodIndex + 1]!)}>→</button>
          <button type="button" disabled={period === model.latestPeriod} onClick={() => setRequestedPeriod("")}>Latest</button>
        </div>
        <label className="supply-demand-compare"><input type="checkbox" checked={comparePrevious} onChange={(event) => setComparePrevious(event.target.checked)} />Compare previous period</label>
      </div>
      {state.status === "stale" ? <LastKnownGoodNotice error={state.error} /> : null}
      <p className="supply-demand-warning" role="note"><strong>Not a closed balance.</strong> Components are shown independently; missing demand or transfers are not estimated. Source signs are preserved.</p>
      <div className="supply-demand-plots">
        {flowOption && flowUnit && firstFlow ? <section aria-label="Flow components">
          <div className="supply-demand-plot-heading"><h4>Flows &amp; stock change</h4><DisplayUnitControl compact micro sourceUnit={firstFlow.unit} value={flowUnit} onChange={setRequestedFlowUnit} additionalOptions={rateOptions} /></div>
          <ComponentChart option={flowOption} rows={flows.length} label={`${profile.product?.label} flow components in ${profile.geography?.label} for ${formatPeriod(period)}`} />
        </section> : <p className="profile-empty-copy">No flow measures at this selection.</p>}
        {stockOption && stockUnit && firstStock ? <section aria-label="Inventory levels">
          <div className="supply-demand-plot-heading"><h4>Inventory levels · separate scale</h4><DisplayUnitControl compact micro sourceUnit={firstStock.unit} value={stockUnit} onChange={setRequestedStockUnit} /></div>
          <ComponentChart option={stockOption} rows={stocks.length} label={`${profile.product?.label} inventory levels in ${profile.geography?.label} for ${formatPeriod(period)}`} />
        </section> : null}
      </div>
      <div className="supply-demand-coverage" role="status">
        {snapshot.rows.filter((row) => row.value === null).map((row) => <span key={row.seriesId}>{row.label}: {row.status} for {formatPeriod(period)}</span>)}
        {model.unavailable.map((row) => <span key={row.measureId} title={row.reason}>{row.label}: unavailable</span>)}
      </div>
      <ChartDetailsToggle summary="Exact values, changes and source coverage">
        <p className="profile-card-footnote">Every row uses the chosen period, product and official region. No earlier value fills a missing row. Changes in daily-rate display use each month's own day count. Stock levels remain volumes and are never added to flows. Seasonal histories remain in the charts below.</p>
        <ul className="profile-card-footnote">{model.gaps.map((gap) => <li key={gap}>{gap}</li>)}</ul>
        <div className="supply-demand-table-wrap"><table>
          <thead><tr><th>Measure</th><th>{formatPeriod(period)}</th><th>Previous period</th><th>Change</th><th>Status / source</th></tr></thead>
          <tbody>{snapshot.rows.map((row) => {
            const unit = row.unit === "days" || row.unit === "percent" ? resolveDisplayUnit(row.unit) : row.isStock ? stockUnit : flowUnit;
            const value = unit ? supplyDemandDisplayValue(row, row.value, period, unit) : null;
            const prior = unit ? supplyDemandDisplayValue(row, row.previousValue, row.previousPeriod, unit) : null;
            const display = (number: number | null) => unit && number !== null ? `${formatDisplayNumber(number, unit)} ${getSourceUnitLabel(unit, true)}` : "Not available";
            return <tr key={row.seriesId}><th>{row.label}</th><td>{display(value)}</td><td>{display(prior)}</td><td>{display(value !== null && prior !== null ? value - prior : null)}</td><td>{row.status} · {row.sourceUrl ? <a href={row.sourceUrl} target="_blank" rel="noreferrer">{row.sourceName}</a> : row.sourceName}<br /><small>{row.seriesId} · checksum {row.sourceChecksum.slice(0, 10)}…</small></td></tr>;
          })}</tbody>
        </table></div>
      </ChartDetailsToggle>
    </ExpandablePanel>
  );
}

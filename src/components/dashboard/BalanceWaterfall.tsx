import { useEffect, useMemo, useState } from "react";
import * as echarts from "echarts/core";
import { BarChart } from "echarts/charts";
import { GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsOption } from "echarts";
import {
  balanceFamilyRegistration,
  buildWeeklyBalanceModel,
  type WeeklyBalanceModel,
} from "../../charts/balanceModel";
import { fetchUsaChartAsset } from "../../data/usaAssets";
import {
  convertDisplayValue,
  formatDisplayValue,
  formatPeriod,
  formatSignedDisplayValue,
} from "../../lib/formatters";
import {
  getUnitFormattingMetadata,
  pairedVolumeRateDisplayUnit,
  resolveDisplayUnit,
  type DisplayUnitId,
} from "../../lib/units";
import type { UsaAssetManifest, UsaChartAsset } from "../../types/energyAssets";

echarts.use([BarChart, GridComponent, TooltipComponent, CanvasRenderer]);

const POSITIVE_COLOR = "#0b7c68";
const NEGATIVE_COLOR = "#c0533f";
const TOTAL_COLOR = "#43646a";
const UNACCOUNTED_COLOR = "#c18541";

interface BalanceWaterfallProps {
  manifest: UsaAssetManifest;
  familyId: string | undefined;
  /** Display-only conversion applied to both weekly volumes and paired daily rates. */
  displayUnit?: DisplayUnitId;
}

interface LoadedAssets {
  stocks: UsaChartAsset;
  production: UsaChartAsset;
  imports: UsaChartAsset;
  exports: UsaChartAsset;
  productSupplied: UsaChartAsset;
}

function usAssetPath(manifest: UsaAssetManifest, seriesId: string): string | undefined {
  const series = manifest.series.find((item) => item.series_id === seriesId);
  return series?.geographies.find(
    (geo) => geo.geography_id === "us" && geo.status === "available" && geo.asset_path,
  )?.asset_path;
}

function waterfallOption(
  model: WeeklyBalanceModel,
  volumeDisplayUnit: DisplayUnitId,
  rateDisplayUnit: DisplayUnitId,
): EChartsOption {
  interface Step { label: string; base: number; size: number; color: string }
  const steps: Step[] = [];
  let running = 0;
  for (const component of model.components) {
    const delta = component.sign * component.weeklyVolume;
    const next = running + delta;
    steps.push({
      label: component.role === "product_supplied" ? "Product supplied" : component.label.split(" &")[0]!,
      base: Math.min(running, next),
      size: Math.abs(delta),
      color: delta >= 0 ? POSITIVE_COLOR : NEGATIVE_COLOR,
    });
    running = next;
  }
  steps.push({
    label: "Implied stock change",
    base: Math.min(0, model.impliedChange),
    size: Math.abs(model.impliedChange),
    color: TOTAL_COLOR,
  });
  steps.push({
    label: "Unaccounted",
    base: Math.min(model.impliedChange, model.actualChange),
    size: Math.abs(model.unaccounted),
    color: UNACCOUNTED_COLOR,
  });
  steps.push({
    label: "Actual stock change",
    base: Math.min(0, model.actualChange),
    size: Math.abs(model.actualChange),
    color: TOTAL_COLOR,
  });
  const detail = [
    ...model.components.map((component) => ({
      signed: component.sign * component.weeklyVolume,
      note: `${formatDisplayValue(
        component.ratePerDay,
        "thousand_barrels_per_day",
        rateDisplayUnit,
      )} average rate`,
    })),
    { signed: model.impliedChange, note: "Sum of the four flow terms x 7 days" },
    { signed: model.unaccounted, note: "Actual minus implied; blending adjustments, unregistered movements, rounding" },
    { signed: model.actualChange, note: "Published ending stocks difference" },
  ];
  return {
    animationDuration: 250,
    grid: { left: 70, right: 20, top: 18, bottom: 58, containLabel: false },
    tooltip: {
      trigger: "axis",
      confine: true,
      backgroundColor: "rgba(11, 49, 59, 0.97)",
      borderWidth: 0,
      textStyle: { color: "#e9f1f2", fontSize: 12 },
      formatter: (params: unknown) => {
        const first = Array.isArray(params) ? params[0] : params;
        if (typeof first !== "object" || first === null || !("dataIndex" in first)) return "";
        const index = (first as { dataIndex: number }).dataIndex;
        const step = steps[index];
        const info = detail[index];
        if (!step || !info) return "";
        return `<div class="echarts-tooltip"><strong>${step.label}</strong>`
          + `<div class="echarts-tooltip-row"><span>Weekly volume</span><b>${formatSignedDisplayValue(info.signed, "thousand_barrels", volumeDisplayUnit)}</b></div>`
          + `<small>${info.note}</small></div>`;
      },
    },
    xAxis: {
      type: "category",
      data: steps.map((step) => step.label),
      axisLine: { lineStyle: { color: "#b9cbc6" } },
      axisTick: { show: false },
      axisLabel: { color: "#71858a", fontSize: 10, interval: 0, rotate: 18 },
    },
    yAxis: {
      type: "value",
      name: getUnitFormattingMetadata(volumeDisplayUnit)?.compactLabel ?? volumeDisplayUnit,
      nameTextStyle: { color: "#71858a", fontSize: 10, fontWeight: 700 },
      axisLabel: {
        color: "#71858a",
        fontSize: 11,
        formatter: (value: number) => new Intl.NumberFormat(
          "en-US",
          getUnitFormattingMetadata(volumeDisplayUnit)?.numberFormat ?? {
            maximumFractionDigits: 2,
          },
        ).format(value),
      },
      splitLine: { lineStyle: { color: "#e3eae8" } },
    },
    series: [
      {
        name: "__waterfall_base",
        type: "bar",
        stack: "balance",
        data: steps.map((step) => convertDisplayValue(
          step.base,
          "thousand_barrels",
          volumeDisplayUnit,
        )),
        itemStyle: { color: "transparent" },
        emphasis: { disabled: true },
        silent: true,
        tooltip: { show: false },
      },
      {
        name: "Weekly volume",
        type: "bar",
        stack: "balance",
        data: steps.map((step) => ({
          value: convertDisplayValue(step.size, "thousand_barrels", volumeDisplayUnit),
          itemStyle: { color: step.color },
        })),
        barMaxWidth: 46,
      },
    ],
  };
}

function WaterfallCanvas({ option, ariaLabel }: { option: EChartsOption; ariaLabel: string }) {
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
  return <div ref={setContainer} className="echarts-balance" role="img" aria-label={ariaLabel} />;
}

export function BalanceWaterfall({ manifest, familyId, displayUnit }: BalanceWaterfallProps) {
  const registration = balanceFamilyRegistration(familyId);
  const [assets, setAssets] = useState<LoadedAssets | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [windowWeeks, setWindowWeeks] = useState<1 | 4>(1);
  const volumeDisplayUnit = resolveDisplayUnit(
    "thousand_barrels",
    displayUnit
      ? pairedVolumeRateDisplayUnit(displayUnit, "volume") ?? displayUnit
      : undefined,
  ) ?? "thousand_barrels";
  const rateDisplayUnit = resolveDisplayUnit(
    "thousand_barrels_per_day",
    displayUnit
      ? pairedVolumeRateDisplayUnit(displayUnit, "flow_rate")
        ?? (displayUnit === "million_cubic_metres"
          ? "thousand_cubic_metres_per_day"
          : displayUnit)
      : undefined,
  ) ?? "thousand_barrels_per_day";

  useEffect(() => {
    setAssets(null);
    setError(null);
    if (!registration) return;
    const paths = {
      stocks: usAssetPath(manifest, registration.stocks),
      production: usAssetPath(manifest, registration.production),
      imports: usAssetPath(manifest, registration.imports),
      exports: usAssetPath(manifest, registration.exports),
      productSupplied: usAssetPath(manifest, registration.productSupplied),
    };
    if (Object.values(paths).some((path) => !path)) {
      setError("Not every registered balance series has a validated national asset.");
      return;
    }
    const controller = new AbortController();
    void Promise.all(
      Object.entries(paths).map(async ([key, path]) => {
        const state = await fetchUsaChartAsset(path!, controller.signal);
        if (!("data" in state) || !state.data) {
          throw new Error(`The ${key} asset could not be loaded.`);
        }
        return [key, state.data] as const;
      }),
    ).then((entries) => {
      setAssets(Object.fromEntries(entries) as unknown as LoadedAssets);
    }).catch((cause: unknown) => {
      if (controller.signal.aborted) return;
      setError(cause instanceof Error ? cause.message : "The balance assets could not be loaded.");
    });
    return () => controller.abort();
  }, [manifest, registration]);

  const model = useMemo(
    () => (registration && assets
      ? buildWeeklyBalanceModel(registration.familyLabel, assets, windowWeeks)
      : null),
    [assets, registration, windowWeeks],
  );

  if (!registration) return null;

  return (
    <section className="analysis-panel balance-panel" aria-labelledby="balance-title">
      <div className="analysis-panel-heading">
        <div>
          <p className="section-kicker">National weekly balance</p>
          <h2 id="balance-title">{registration.familyLabel}: supply, disposition, and stock change</h2>
          <p>
            Computed from the registered U.S. series through the barrel-accounting identity.
            The unaccounted bar is the honest residual — blending adjustments, movements
            outside the registered series, and rounding — not an error to hide.
          </p>
        </div>
        <fieldset className="balance-window-control">
          <legend>Averaging window</legend>
          <div>
            {[1, 4].map((weeks) => (
              <label key={weeks}>
                <input
                  type="radio"
                  name="balance-window"
                  value={weeks}
                  checked={windowWeeks === weeks}
                  onChange={() => setWindowWeeks(weeks as 1 | 4)}
                />
                <span>{weeks === 1 ? "Latest week" : "4-week average"}</span>
              </label>
            ))}
          </div>
        </fieldset>
      </div>

      {error ? <p className="forecast-notice" role="status">{error}</p> : null}
      {!error && !assets ? <p className="forecast-notice" role="status">Loading the five registered balance series…</p> : null}
      {assets && !model ? (
        <p className="forecast-notice" role="status">
          No week has complete numeric values for every registered balance term, so the
          balance is unavailable rather than partially computed.
        </p>
      ) : null}

      {model ? (
        <>
          <p className="balance-context">
            Week ending {formatPeriod(model.week)}
            {model.windowWeeks > 1 ? ` (average of ${model.windowWeeks} weeks)` : ""} ·
            ending stocks {formatDisplayValue(model.stocksLevel, "thousand_barrels", volumeDisplayUnit)} ·
            actual change {formatSignedDisplayValue(model.actualChange, "thousand_barrels", volumeDisplayUnit)} vs implied {formatSignedDisplayValue(model.impliedChange, "thousand_barrels", volumeDisplayUnit)}
          </p>
          <WaterfallCanvas
            option={waterfallOption(model, volumeDisplayUnit, rateDisplayUnit)}
            ariaLabel={`${registration.familyLabel} weekly balance waterfall: production and imports add supply, exports and product supplied remove it, and the residual between implied and actual stock change is labelled unaccounted.`}
          />
          <details className="accessible-chart-summary">
            <summary>Balance table for week ending {formatPeriod(model.week)}</summary>
            <div className="forecast-table-wrap">
              <table>
                <caption>
                  {registration.familyLabel} national balance, {getUnitFormattingMetadata(volumeDisplayUnit)?.longLabel ?? volumeDisplayUnit} per week
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Term</th>
                    <th scope="col">Average rate ({getUnitFormattingMetadata(rateDisplayUnit)?.compactLabel ?? rateDisplayUnit})</th>
                    <th scope="col">Weekly volume ({getUnitFormattingMetadata(volumeDisplayUnit)?.compactLabel ?? volumeDisplayUnit})</th>
                  </tr>
                </thead>
                <tbody>
                  {model.components.map((component) => (
                    <tr key={component.role}>
                      <th scope="row">{component.label}</th>
                      <td>{formatDisplayValue(component.ratePerDay, "thousand_barrels_per_day", rateDisplayUnit)}</td>
                      <td>{formatSignedDisplayValue(component.sign * component.weeklyVolume, "thousand_barrels", volumeDisplayUnit)}</td>
                    </tr>
                  ))}
                  <tr>
                    <th scope="row">Implied stock change</th>
                    <td>—</td>
                    <td>{formatSignedDisplayValue(model.impliedChange, "thousand_barrels", volumeDisplayUnit)}</td>
                  </tr>
                  <tr>
                    <th scope="row">Unaccounted</th>
                    <td>—</td>
                    <td>{formatSignedDisplayValue(model.unaccounted, "thousand_barrels", volumeDisplayUnit)}</td>
                  </tr>
                  <tr>
                    <th scope="row">Actual stock change</th>
                    <td>—</td>
                    <td>{formatSignedDisplayValue(model.actualChange, "thousand_barrels", volumeDisplayUnit)}</td>
                  </tr>
                </tbody>
              </table>
            </div>
          </details>
          <p className="chart-footnote">
            Product supplied is an accounting proxy for implied demand, not measured consumption.
            Total distillate is broader than road diesel. This identity closes only at the national
            level; district balances would omit unregistered inter-district movements. Gasoline is
            not offered because weekly motor-gasoline exports are inactive (June 2023 definition break).
          </p>
        </>
      ) : null}
    </section>
  );
}

import { useEffect, useMemo, useState } from "react";
import * as echarts from "echarts/core";
import { LineChart } from "echarts/charts";
import {
  AriaComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
} from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsOption } from "echarts";
import { useCountryChartAssets } from "../../hooks/useCountryAssets";
import {
  formatDisplayValue,
  formatPeriod,
  formatPercent,
} from "../../lib/formatters";
import {
  buildMonthlyAverageRateAsset,
  isMonthlyAverageRateDisplayUnit,
  monthlyAverageRateOptions,
  MONTHLY_AVERAGE_RATE_UNIT,
} from "../../lib/periodAverageRate";
import { resolveDisplayUnit, type DisplayUnitId } from "../../lib/units";
import { buildMonthlyViewFromWeekly } from "../../lib/weeklyToMonthly";
import type { CountryCode } from "../../types/catalog";
import type {
  ManifestGeography,
  UsaChartAsset,
  UsaManifestSeries,
} from "../../types/energyAssets";
import { ChartDetailsToggle } from "./ChartDetailsToggle";
import { ChartMicroSummary } from "./ChartMicroSummary";
import { DashboardError, DashboardLoading, LastKnownGoodNotice } from "./DashboardStates";
import { DisplayUnitControl } from "./DisplayUnitControl";
import { ExpandablePanel } from "./ExpandablePanel";
import { latestSourceContext } from "./LatestValueGrid";
import { buildSeasonalEChartsOption } from "./SeasonalChart";

echarts.use([
  LineChart,
  AriaComponent,
  DataZoomComponent,
  GridComponent,
  LegendComponent,
  TooltipComponent,
  CanvasRenderer,
]);

export type ProfileFrequencyMode = "weekly" | "monthly";

interface ProfileMetricCardProps {
  country: CountryCode;
  series: UsaManifestSeries;
  geography: ManifestGeography;
  frequencyMode: ProfileFrequencyMode;
  contextLabel?: string;
}

export function profileLatestSourceNotice(
  asset: UsaChartAsset,
  series: UsaManifestSeries,
) {
  const context = latestSourceContext(asset, series);
  if (!context.sourcePeriodDiffers && asset.latest_source?.value !== null) return null;
  return {
    sourcePeriod: context.sourcePeriod,
    observationStatus: context.observationStatus ?? "not numerically available",
    numericPeriod: asset.latest.period,
  };
}

function ProfileChartCanvas({
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
      className="profile-metric-chart"
      role="img"
      aria-label={ariaLabel}
    />
  );
}

function prepareFrequencyAsset(
  asset: UsaChartAsset,
  series: UsaManifestSeries,
  frequencyMode: ProfileFrequencyMode,
): UsaChartAsset {
  if (frequencyMode === "monthly" && series.frequency.toLowerCase().startsWith("week")) {
    return buildMonthlyViewFromWeekly(asset, series.view_id);
  }
  return asset;
}

export function ProfileMetricCard({
  country,
  series,
  geography,
  frequencyMode,
  contextLabel,
}: ProfileMetricCardProps) {
  const { state, retry } = useCountryChartAssets(
    country,
    geography.asset_path ? [geography.asset_path] : [],
  );
  const [requestedUnit, setRequestedUnit] = useState<DisplayUnitId>();
  const prepared = useMemo(() => {
    if (!("data" in state) || !state.data?.[0]) return {};
    const sourceAsset = state.data[0];
    if (
      sourceAsset.series_id !== series.series_id
      || sourceAsset.geography_id !== geography.geography_id
    ) {
      return {
        error: "The loaded chart asset does not match the selected series and geography.",
      };
    }
    try {
      return { asset: prepareFrequencyAsset(sourceAsset, series, frequencyMode) };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "This frequency view could not be prepared.",
      };
    }
  }, [frequencyMode, series, state]);

  const rateOptions = prepared.asset && frequencyMode === "monthly"
    ? monthlyAverageRateOptions(series)
    : [];
  const rateDisplay = Boolean(
    prepared.asset
    && isMonthlyAverageRateDisplayUnit(series, requestedUnit),
  );
  const displayed = useMemo(() => {
    if (!prepared.asset) return {};
    if (!rateDisplay) return { asset: prepared.asset };
    try {
      return { asset: buildMonthlyAverageRateAsset(prepared.asset) };
    } catch (error) {
      return {
        error: error instanceof Error ? error.message : "The monthly-average rate view is unavailable.",
      };
    }
  }, [prepared.asset, rateDisplay]);

  const sourceUnit = displayed.asset?.unit ?? prepared.asset?.unit ?? series.unit;
  const displayUnit = resolveDisplayUnit(
    sourceUnit,
    rateDisplay ? requestedUnit ?? MONTHLY_AVERAGE_RATE_UNIT : requestedUnit,
  );
  const option = useMemo(
    () => displayed.asset && displayUnit
      ? buildSeasonalEChartsOption(
        displayed.asset,
        `${series.title} — ${geography.label}`,
        undefined,
        90,
        displayUnit,
        { density: "compact" },
      )
      : undefined,
    [displayUnit, displayed.asset, geography.label, series.title],
  );

  const content = (() => {
    if (state.status === "loading") return <DashboardLoading label={`Loading ${series.title}`} />;
    if (state.status === "error") {
      return <DashboardError title="Chart unavailable" message={state.error} onRetry={retry} />;
    }
    if (prepared.error || displayed.error || !displayed.asset || !displayUnit || !option) {
      return (
        <DashboardError
          title="Chart unavailable"
          message={prepared.error ?? displayed.error ?? "No compatible display view is available."}
          onRetry={retry}
        />
      );
    }
    const asset = displayed.asset;
    const derived = frequencyMode === "monthly"
      && series.frequency.toLowerCase().startsWith("week");
    const sourceNotice = profileLatestSourceNotice(asset, series);
    return (
      <>
        <header className="profile-card-heading graph-first-heading">
          <div className="graph-first-title">
            <h3>{series.classification?.measure_label ?? series.title}</h3>
            <p className="graph-first-location">Geography: {geography.label}</p>
          </div>
          <div className="graph-first-actions">
            <span className="profile-frequency-badge">
            {derived ? "Monthly · derived" : `${series.frequency} · source`}
            </span>
            <DisplayUnitControl
              compact
              micro
              sourceUnit={series.unit}
              value={requestedUnit ?? resolveDisplayUnit(series.unit) ?? displayUnit}
              onChange={setRequestedUnit}
              additionalOptions={rateOptions}
            />
          </div>
        </header>
        {state.status === "stale" ? <LastKnownGoodNotice error={state.error} /> : null}
        <div className="chart-stage">
          <ChartMicroSummary asset={asset} series={series} displayUnit={displayUnit} />
          <ProfileChartCanvas
            option={option}
            ariaLabel={`${series.title} seasonal overlay for ${geography.label}: recent years compared with the historical seasonal range.`}
          />
        </div>
        <ChartDetailsToggle summary="Statistics and source notes">
          {sourceNotice ? (
            <div className="profile-source-notice">
              <strong>
                Source {formatPeriod(sourceNotice.sourcePeriod)}:{" "}
                {sourceNotice.observationStatus}
              </strong>
              <span>Latest numeric value shown is {formatPeriod(sourceNotice.numericPeriod)}.</span>
            </div>
          ) : null}
          <div className="profile-card-statline">
            <div>
              <span>Latest numeric</span>
              <strong>{formatDisplayValue(asset.latest.value, asset.unit, displayUnit)}</strong>
              <small>{formatPeriod(asset.latest.period)}</small>
            </div>
            <div>
              <span>Change</span>
              <strong>{formatDisplayValue(asset.latest.absolute_change, asset.unit, displayUnit)}</strong>
              <small>{formatPercent(asset.latest.percent_change)}</small>
            </div>
          </div>
          <p className="profile-card-boundary">
            Product: {series.classification?.product_label ?? series.title}.
          </p>
          {contextLabel ? (
            <p className="profile-card-boundary">Context: {contextLabel}.</p>
          ) : null}
          {series.description ? (
            <p className="profile-card-boundary">{series.description}</p>
          ) : null}
          <p className="profile-card-footnote">
          {derived
            ? "Monthly view derived from complete weekly observations; not an official monthly series."
            : `${geography.label} · ${series.source.name}.`} {asset.baseline.slots.length
            ? "Recent years are overlaid on the historical seasonal range."
            : "Recent years share the seasonal axis; a historical range is unavailable for this series."}
          </p>
        </ChartDetailsToggle>
      </>
    );
  })();

  return (
    <ExpandablePanel
      className="profile-metric-card"
      title={`${series.classification?.measure_label ?? series.title} — ${geography.label}`}
    >
      {content}
    </ExpandablePanel>
  );
}

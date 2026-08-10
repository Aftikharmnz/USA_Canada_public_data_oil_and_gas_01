import { useEffect, useMemo, useState } from "react";
import * as echarts from "echarts/core";
import { BarChart } from "echarts/charts";
import { AriaComponent, GridComponent, TooltipComponent } from "echarts/components";
import { CanvasRenderer } from "echarts/renderers";
import type { EChartsOption } from "echarts";
import {
  buildCanadaOriginDestinationModel,
  canadaOriginDestinationAssetPlan,
} from "../../charts/canadaOriginDestinationModel";
import {
  originDestinationSnapshot,
  type OriginDestinationCell,
  type OriginDestinationModel,
} from "../../charts/originDestinationModel";
import {
  buildUsaPaddOriginDestinationModel,
  usaPaddOriginDestinationAssetPlan,
} from "../../charts/usaPaddOriginDestinationModel";
import { useCountryChartAssets } from "../../hooks/useCountryAssets";
import {
  compactUnit,
  formatDisplayNumber,
  formatDisplayValue,
  formatPeriod,
} from "../../lib/formatters";
import {
  isMonthlyAverageRateDisplayUnit,
  monthlyAverageRateOptions,
  monthlyVolumeToKbPerDay,
  MONTHLY_AVERAGE_RATE_UNIT,
} from "../../lib/periodAverageRate";
import {
  convertUnitValue,
  resolveDisplayUnit,
  type DisplayUnitId,
} from "../../lib/units";
import type { CountryCode } from "../../types/catalog";
import type {
  ManifestGeography,
  UsaAssetManifest,
  UsaChartAsset,
  UsaManifestSeries,
} from "../../types/energyAssets";
import { ChartDetailsToggle } from "./ChartDetailsToggle";
import { DashboardError, DashboardLoading, LastKnownGoodNotice } from "./DashboardStates";
import { DisplayUnitControl } from "./DisplayUnitControl";
import { ExpandablePanel } from "./ExpandablePanel";
import type { ProfileFrequencyMode } from "./ProfileMetricCard";

echarts.use([BarChart, AriaComponent, GridComponent, TooltipComponent, CanvasRenderer]);

interface ProfileMovementCardProps {
  country: CountryCode;
  manifest: UsaAssetManifest;
  region: ManifestGeography;
  segment: "crude" | "refined";
  frequencyMode: ProfileFrequencyMode;
}

interface MovementPlan {
  series?: UsaManifestSeries;
  paths: string[];
  scopeLabel: string;
  boundary?: string;
}

function movementPlan(
  country: CountryCode,
  manifest: UsaAssetManifest,
  region: ManifestGeography,
  segment: "crude" | "refined",
): MovementPlan {
  if (country === "usa") {
    if (region.level_id !== "padd") {
      return {
        paths: [],
        scopeLabel: "PADD movements",
        boundary: "EIA movement routes are published between PADDs; this selected finer geography cannot be allocated to a PADD route.",
      };
    }
    const productId = segment === "crude"
      ? "crude-oil-padd-movements"
      : "total-petroleum-products-padd-movements";
    const series = manifest.series.find(
      (candidate) => candidate.classification?.product_id === productId,
    );
    const plan = series ? usaPaddOriginDestinationAssetPlan(series) : [];
    return {
      series,
      paths: plan.map((item) => item.assetPath),
      scopeLabel: segment === "crude" ? "Crude oil PADD movements" : "Total petroleum-products PADD movements",
      boundary: segment === "refined"
        ? "This source bucket covers total petroleum products; it is logistics context, not a selected-product transfer series."
        : undefined,
    };
  }

  if (region.level_id !== "province_territory") {
    return {
      paths: [],
      scopeLabel: "Province pipeline movements",
      boundary: "Statistics Canada pipeline routes use province/territory endpoints and cannot be mapped to CER confidentiality regions.",
    };
  }
  const productId = segment === "crude"
    ? "crude-equivalents-pipeline-movements"
    : "hgl-rpp-pipeline-movements";
  const series = manifest.series.find(
    (candidate) => candidate.classification?.product_id === productId,
  );
  const plan = series ? canadaOriginDestinationAssetPlan(manifest.series, series) : [];
  return {
    series,
    paths: plan.map((item) => item.assetPath),
    scopeLabel: segment === "crude"
      ? "Crude & equivalents pipeline movements"
      : "HGL + refined-products pipeline movements",
    boundary: segment === "refined"
      ? "This source bucket combines HGL and refined products; it is not a gasoline, diesel, or jet-specific route series."
      : undefined,
  };
}

function buildModel(
  country: CountryCode,
  manifest: UsaAssetManifest,
  plan: MovementPlan,
  assets: readonly UsaChartAsset[],
): OriginDestinationModel | undefined {
  if (!plan.series || !assets.length) return undefined;
  if (country === "usa") {
    const sourcePlan = usaPaddOriginDestinationAssetPlan(plan.series);
    return buildUsaPaddOriginDestinationModel(
      plan.series,
      sourcePlan.map((item, index) => ({ ...item, asset: assets[index]! })),
    );
  }
  const sourcePlan = canadaOriginDestinationAssetPlan(manifest.series, plan.series);
  return buildCanadaOriginDestinationModel(
    manifest.series,
    plan.series,
    sourcePlan.map((item, index) => ({ ...item, asset: assets[index]! })),
  );
}

function routeLabel(cell: OriginDestinationCell, selectedRegionId: string): string {
  return cell.origin.id === selectedRegionId
    ? `To ${cell.destination.shortLabel ?? cell.destination.label}`
    : `From ${cell.origin.shortLabel ?? cell.origin.label}`;
}

export function profileMovementValueForDisplay(
  value: number | null,
  period: string,
  sourceUnit: string,
  monthlyAverageRate: boolean,
): number | null {
  return monthlyAverageRate
    ? monthlyVolumeToKbPerDay(value, period, sourceUnit)
    : value;
}

export interface ProfileMovementRouteCoverage {
  declaredInbound: number;
  declaredOutbound: number;
  numericInbound: number;
  numericOutbound: number;
}

export function profileMovementRouteCoverage(
  cells: readonly OriginDestinationCell[],
  selectedRegionId: string,
): ProfileMovementRouteCoverage {
  const declaredInbound = cells.filter((cell) => (
    cell.declared && cell.destination.id === selectedRegionId
  ));
  const declaredOutbound = cells.filter((cell) => (
    cell.declared && cell.origin.id === selectedRegionId
  ));
  return {
    declaredInbound: declaredInbound.length,
    declaredOutbound: declaredOutbound.length,
    numericInbound: declaredInbound.filter((cell) => cell.value !== null).length,
    numericOutbound: declaredOutbound.filter((cell) => cell.value !== null).length,
  };
}

function routeOption(
  cells: readonly OriginDestinationCell[],
  selectedRegionId: string,
  sourceUnit: string,
  displayUnit: DisplayUnitId,
): EChartsOption {
  const rows = [...cells]
    .filter((cell): cell is OriginDestinationCell & { value: number } => cell.value !== null)
    .sort((left, right) => Math.abs(right.value) - Math.abs(left.value))
    .slice(0, 8);
  return {
    animationDuration: 250,
    aria: {
      enabled: true,
      description: "Largest exact source-published inbound and outbound movement routes for the selected region.",
    },
    grid: { left: 86, right: 18, top: 12, bottom: 36 },
    tooltip: {
      trigger: "item",
      confine: true,
      formatter: (params: unknown) => {
        if (!params || typeof params !== "object" || !("dataIndex" in params)) return "";
        const row = rows[Number((params as { dataIndex: number }).dataIndex)];
        return row
          ? `${routeLabel(row, selectedRegionId)}<br/><strong>${formatDisplayValue(row.value, sourceUnit, displayUnit)}</strong>`
          : "";
      },
    },
    xAxis: {
      type: "value",
      name: compactUnit(displayUnit),
      axisLabel: {
        color: "#71858a",
        fontSize: 9,
        formatter: (value: number) => formatDisplayNumber(value, displayUnit, true),
      },
      splitLine: { lineStyle: { color: "#e5ecea" } },
    },
    yAxis: {
      type: "category",
      inverse: true,
      data: rows.map((row) => routeLabel(row, selectedRegionId)),
      axisLabel: { color: "#526b71", fontSize: 9, width: 75, overflow: "truncate" },
      axisTick: { show: false },
      axisLine: { lineStyle: { color: "#c8d5d2" } },
    },
    series: [{
      type: "bar",
      data: rows.map((row) => ({
        value: convertUnitValue(row.value, sourceUnit, displayUnit),
        itemStyle: {
          color: row.origin.id === selectedRegionId ? "#d78a25" : "#007f6d",
        },
      })),
      barMaxWidth: 22,
    }],
  };
}

function MovementCanvas({
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
      className="profile-movement-chart"
      role="img"
      aria-label={ariaLabel}
    />
  );
}

export function ProfileMovementCard({
  country,
  manifest,
  region,
  segment,
  frequencyMode,
}: ProfileMovementCardProps) {
  const plan = useMemo(
    () => movementPlan(country, manifest, region, segment),
    [country, manifest, region, segment],
  );
  const { state, retry } = useCountryChartAssets(country, plan.paths);
  const [requestedUnit, setRequestedUnit] = useState<DisplayUnitId>();
  const built = useMemo(() => {
    if (!("data" in state) || !state.data || state.data.length !== plan.paths.length) return {};
    try {
      return { model: buildModel(country, manifest, plan, state.data) };
    } catch (error) {
      return { error: error instanceof Error ? error.message : "Movement routes could not be validated." };
    }
  }, [country, manifest, plan, state]);

  if (frequencyMode === "weekly") {
    return (
      <article className="profile-boundary-card">
        <p className="section-kicker">Logistics context</p>
        <h3>Weekly transfers are not published</h3>
        <p>{plan.scopeLabel} is a source-monthly view. It is not interpolated into weekly routes.</p>
      </article>
    );
  }
  if (plan.boundary && !plan.paths.length) {
    return (
      <article className="profile-boundary-card">
        <p className="section-kicker">Logistics context</p>
        <h3>No route view at this geography</h3>
        <p>{plan.boundary}</p>
      </article>
    );
  }
  if (state.status === "loading") return <DashboardLoading label={`Loading ${plan.scopeLabel}`} />;
  if (state.status === "error" || built.error || !built.model) {
    return (
      <DashboardError
        title="Movement routes unavailable"
        message={state.status === "error" ? state.error : built.error ?? "No exact routes are available."}
        onRetry={retry}
      />
    );
  }

  const model = built.model;
  const snapshot = originDestinationSnapshot(model);
  const regionCells = snapshot.cells.filter(
    (cell) => cell.declared && (cell.origin.id === region.geography_id || cell.destination.id === region.geography_id),
  );
  if (!regionCells.length) {
    return (
      <article className="profile-boundary-card">
        <p className="section-kicker">Logistics context</p>
        <h3>No published route rows for {region.label}</h3>
        <p>
          {plan.scopeLabel} contains no declared origin or destination corridor for this exact
          region in the current public asset. An absent route is not treated as zero movement.
        </p>
      </article>
    );
  }
  const sourceUnit = model.sourceUnit;
  const rateOptions = plan.series ? monthlyAverageRateOptions(plan.series) : [];
  const rateDisplay = Boolean(
    plan.series && isMonthlyAverageRateDisplayUnit(plan.series, requestedUnit),
  );
  const displaySourceUnit = rateDisplay ? MONTHLY_AVERAGE_RATE_UNIT : sourceUnit;
  const displayCells = regionCells.map((cell) => ({
    ...cell,
    value: profileMovementValueForDisplay(
      cell.value,
      cell.period,
      sourceUnit,
      rateDisplay,
    ),
  }));
  const routeCoverage = profileMovementRouteCoverage(displayCells, region.geography_id);
  const incompleteRouteCoverage = (
    routeCoverage.numericInbound < routeCoverage.declaredInbound
    || routeCoverage.numericOutbound < routeCoverage.declaredOutbound
  );
  const numericInbound = displayCells.filter(
    (cell): cell is OriginDestinationCell & { value: number } => (
      cell.destination.id === region.geography_id && cell.value !== null
    ),
  );
  const numericOutbound = displayCells.filter(
    (cell): cell is OriginDestinationCell & { value: number } => (
      cell.origin.id === region.geography_id && cell.value !== null
    ),
  );
  const displayUnit = resolveDisplayUnit(displaySourceUnit, requestedUnit)
    ?? resolveDisplayUnit(displaySourceUnit)!;
  const inbound = numericInbound.reduce((sum, cell) => sum + cell.value, 0);
  const outbound = numericOutbound.reduce((sum, cell) => sum + cell.value, 0);
  const option = routeOption(displayCells, region.geography_id, displaySourceUnit, displayUnit);

  return (
    <ExpandablePanel className="profile-movement-card" title={`${region.label} logistics context`}>
      <header className="profile-card-heading graph-first-heading">
        <div className="graph-first-title">
          <h3>Inbound and outbound published routes</h3>
          <p className="graph-first-location">Geography: {region.label}</p>
        </div>
        <div className="graph-first-actions">
        <span className="profile-frequency-badge">Monthly · source</span>
          <DisplayUnitControl
            compact
            micro
            sourceUnit={sourceUnit}
            value={requestedUnit ?? resolveDisplayUnit(sourceUnit) ?? displayUnit}
            onChange={setRequestedUnit}
            additionalOptions={rateOptions}
          />
        </div>
      </header>
      {state.status === "stale" ? <LastKnownGoodNotice error={state.error} /> : null}
      {incompleteRouteCoverage ? (
        <div className="profile-source-notice" role="status">
          <strong>
            Route coverage: {routeCoverage.numericInbound}/{routeCoverage.declaredInbound} inbound{" "}
            and {routeCoverage.numericOutbound}/{routeCoverage.declaredOutbound} outbound rows are numeric.
          </strong>
          <span>Declared nonnumeric or missing routes remain unavailable and are not treated as zero.</span>
        </div>
      ) : null}
      <div className="chart-stage">
        <section
          className="chart-micro-summary profile-movement-micro-summary"
          aria-label={`${formatPeriod(snapshot.period)} movement route summary for ${region.label}`}
        >
          <dl className="chart-micro-summary-grid">
            <div className="chart-micro-summary-item chart-micro-summary-primary">
              <dt>Known inbound</dt>
              <dd>
                <strong>
                  {numericInbound.length
                    ? formatDisplayValue(inbound, displaySourceUnit, displayUnit)
                    : "Unavailable"}
                </strong>
                <span>{routeCoverage.numericInbound}/{routeCoverage.declaredInbound} numeric routes</span>
              </dd>
            </div>
            <div className="chart-micro-summary-item">
              <dt>Known outbound</dt>
              <dd>
                <strong>
                  {numericOutbound.length
                    ? formatDisplayValue(outbound, displaySourceUnit, displayUnit)
                    : "Unavailable"}
                </strong>
                <span>{routeCoverage.numericOutbound}/{routeCoverage.declaredOutbound} numeric routes</span>
              </dd>
            </div>
          </dl>
        </section>
        <MovementCanvas
          option={option}
          ariaLabel={`${plan.scopeLabel} for ${region.label} in ${formatPeriod(snapshot.period)}. ${routeCoverage.numericInbound} of ${routeCoverage.declaredInbound} declared inbound routes and ${routeCoverage.numericOutbound} of ${routeCoverage.declaredOutbound} declared outbound routes are numeric.`}
        />
      </div>
      <ChartDetailsToggle summary="Route totals and source notes">
        <div className="profile-card-statline">
          <div>
            <span>Known inbound</span>
            <strong>
              {numericInbound.length
                ? formatDisplayValue(inbound, displaySourceUnit, displayUnit)
                : "Unavailable"}
            </strong>
            <small>{routeCoverage.numericInbound}/{routeCoverage.declaredInbound} numeric routes</small>
          </div>
          <div>
            <span>Known outbound</span>
            <strong>
              {numericOutbound.length
                ? formatDisplayValue(outbound, displaySourceUnit, displayUnit)
                : "Unavailable"}
            </strong>
            <small>{routeCoverage.numericOutbound}/{routeCoverage.declaredOutbound} numeric routes</small>
          </div>
        </div>
        <p className="profile-card-boundary">Source scope: {plan.scopeLabel}.</p>
        {plan.series?.description ? (
          <p className="profile-card-boundary">{plan.series.description}</p>
        ) : null}
        <p className="profile-card-footnote">
        {formatPeriod(snapshot.period)} · exact gross directions; missing routes are not zero.
        {rateDisplay ? " Daily rates use the actual calendar days in this source month." : ""}
        {plan.boundary ? ` ${plan.boundary}` : ""}
        </p>
      </ChartDetailsToggle>
    </ExpandablePanel>
  );
}

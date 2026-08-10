import {
  formatDisplayValue,
  formatPercent,
  formatPeriod,
  formatSignedDisplayValue,
  formatSignedValue,
  formatValue,
} from "../../lib/formatters";
import { resolveDisplayUnit, type DisplayUnitId } from "../../lib/units";
import type { UsaChartAsset, UsaManifestSeries } from "../../types/energyAssets";
import { latestSourceContext } from "./LatestValueGrid";

export interface ChartMicroSummaryProps {
  asset: UsaChartAsset;
  series: UsaManifestSeries;
  /** Display-only conversion; source observations remain unchanged. */
  displayUnit?: DisplayUnitId;
}

/** Compact latest-value context intended to sit over or immediately beside a chart. */
export function ChartMicroSummary({
  asset,
  series,
  displayUnit,
}: ChartMicroSummaryProps) {
  const latest = asset.latest;
  const sourceContext = latestSourceContext(asset, series);
  const resolvedDisplayUnit = resolveDisplayUnit(asset.unit, displayUnit);
  const latestValue = resolvedDisplayUnit
    ? formatDisplayValue(latest.value, asset.unit, resolvedDisplayUnit)
    : formatValue(latest.value, asset.unit);
  const periodChange = asset.unit.toLowerCase() === "percent"
    ? formatSignedValue(latest.absolute_change, "percentage points")
    : resolvedDisplayUnit
      ? formatSignedDisplayValue(latest.absolute_change, asset.unit, resolvedDisplayUnit)
      : formatSignedValue(latest.absolute_change, asset.unit);
  const sourceIsNonnumeric = asset.latest_source?.value === null;
  const showSourceContext = sourceContext.sourcePeriodDiffers || sourceIsNonnumeric;

  return (
    <section
      className="chart-micro-summary"
      aria-label={`Latest numeric summary for ${series.title}`}
    >
      <dl className="chart-micro-summary-grid">
        <div className="chart-micro-summary-item chart-micro-summary-primary">
          <dt>Latest numeric</dt>
          <dd>
            <strong>{latestValue}</strong>
            <span>{formatPeriod(sourceContext.numericPeriod)}</span>
          </dd>
        </div>
        <div className="chart-micro-summary-item">
          <dt>Period change</dt>
          <dd>
            <strong>{periodChange}</strong>
            <span>{formatPercent(latest.percent_change)}</span>
          </dd>
        </div>
        {showSourceContext ? (
          <div className="chart-micro-summary-item chart-micro-summary-source" role="status">
            <dt>Latest source</dt>
            <dd>
              <strong>{formatPeriod(sourceContext.sourcePeriod)}</strong>
              <span>{sourceContext.observationStatus ?? "not numerically available"}</span>
            </dd>
          </div>
        ) : null}
      </dl>
    </section>
  );
}

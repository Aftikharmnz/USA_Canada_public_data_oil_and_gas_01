import {
  deltaDirection,
  formatDateTime,
  formatDisplayValue,
  formatPercent,
  formatPeriod,
  formatSignedDisplayValue,
  formatSignedValue,
  formatValue,
} from "../../lib/formatters";
import { resolveDisplayUnit, type DisplayUnitId } from "../../lib/units";
import type { UsaChartAsset, UsaManifestSeries } from "../../types/energyAssets";
import { FreshnessBadge } from "./FreshnessBadge";

const observationStatusLabels: Record<string, string> = {
  observed: "observed",
  preliminary: "preliminary",
  missing: "missing",
  not_available: "not available",
  not_applicable: "not applicable",
  suppressed_or_withheld: "suppressed or withheld",
  use_with_caution: "marked use with caution",
  computed: "computed",
  mixed: "mixed publication statuses",
  unknown: "unknown",
};

export function observationStatusLabel(status: string | undefined): string | undefined {
  if (!status) return undefined;
  return observationStatusLabels[status.toLowerCase()]
    ?? status.replaceAll("_", " ").toLowerCase();
}

export function latestSourceContext(asset: UsaChartAsset, series: UsaManifestSeries) {
  const freshness = asset.freshness ?? series.freshness;
  const sourcePeriod = asset.latest_source?.period ?? freshness.latest_period;
  return {
    freshness,
    sourcePeriod,
    numericPeriod: freshness.latest_numeric_period ?? asset.latest.period,
    observationStatus: observationStatusLabel(
      asset.latest_source?.status ?? freshness.latest_observation_status,
    ),
    checkedAt: freshness.checked_at ?? series.freshness.checked_at ?? freshness.retrieved_at,
    sourcePeriodDiffers: Boolean(sourcePeriod && sourcePeriod !== asset.latest.period),
  };
}

interface LatestValueGridProps {
  asset: UsaChartAsset;
  series: UsaManifestSeries;
  /** Display-only conversion; source values and calculations remain in asset.unit. */
  displayUnit?: DisplayUnitId;
}

export function LatestValueGrid({ asset, series, displayUnit }: LatestValueGridProps) {
  const latest = asset.latest;
  const sourceContext = latestSourceContext(asset, series);
  const { freshness } = sourceContext;
  const resolvedDisplayUnit = resolveDisplayUnit(asset.unit, displayUnit);
  const formatLevel = (value: number | null) => resolvedDisplayUnit
    ? formatDisplayValue(value, asset.unit, resolvedDisplayUnit)
    : formatValue(value, asset.unit);
  const formatSignedLevel = (value: number | null) => {
    if (asset.unit.toLowerCase() === "percent") {
      return formatSignedValue(value, "percentage points");
    }
    return resolvedDisplayUnit
      ? formatSignedDisplayValue(value, asset.unit, resolvedDisplayUnit)
      : formatSignedValue(value, asset.unit);
  };
  const seasonalPercentile = latest.seasonal_percentile === null
    ? "Not available"
    : `${Math.round(latest.seasonal_percentile)}th percentile`;
  const sourceStatus = sourceContext.observationStatus
    ? sourceContext.observationStatus.charAt(0).toUpperCase()
      + sourceContext.observationStatus.slice(1)
    : "Unknown";

  return (
    <section className="latest-section" aria-labelledby="latest-release-title">
      <div className="latest-heading">
        <div>
          <p className="section-kicker">Latest available numeric observation</p>
          <h2 id="latest-release-title">{formatPeriod(latest.period)}</h2>
        </div>
        <FreshnessBadge status={freshness.status} />
      </div>

      {sourceContext.sourcePeriodDiffers ? (
        <div className="latest-source-notice" role="status">
          <strong>
            Source period {formatPeriod(sourceContext.sourcePeriod)} is{
              ` ${sourceContext.observationStatus ?? "not numerically available"}`
            }.
          </strong>
          <span>Latest numeric value shown: {formatPeriod(latest.period)}.</span>
        </div>
      ) : null}

      <div className="latest-grid">
        <article className="latest-card latest-card-primary">
          <span>Latest numeric value</span>
          <strong>{formatLevel(latest.value)}</strong>
          <small>{series.title}</small>
        </article>
        <article className={`latest-card delta-${deltaDirection(latest.absolute_change)}`}>
          <span>From {formatPeriod(latest.previous_period)}</span>
          <strong>{formatSignedLevel(latest.absolute_change)}</strong>
          <small>{formatPercent(latest.percent_change)} period over period</small>
        </article>
        <article className={`latest-card delta-${deltaDirection(latest.yoy_absolute_change)}`}>
          <span>From {formatPeriod(latest.year_ago_period)}</span>
          <strong>{formatSignedLevel(latest.yoy_absolute_change)}</strong>
          <small>{formatPercent(latest.yoy_percent_change)} year over year</small>
        </article>
        <article className="latest-card">
          <span>Seasonal position</span>
          <strong>{seasonalPercentile}</strong>
          {latest.seasonal_percentile !== null ? (
            <div
              className="seasonal-percentile-strip"
              role="img"
              aria-label={`The latest value sits at the ${Math.round(latest.seasonal_percentile)}th percentile of the historical baseline for this ${asset.frequency.toLowerCase().startsWith("month") ? "month" : "week"}. 0 is the lowest on record in the baseline; 100 is the highest.`}
            >
              <span className="strip-track">
                <span className="strip-band strip-band-iqr" />
                <span
                  className="strip-marker"
                  style={{ left: `${Math.min(100, Math.max(0, latest.seasonal_percentile))}%` }}
                />
              </span>
              <span className="strip-scale"><em>Low</em><em>Median</em><em>High</em></span>
            </div>
          ) : null}
          <small>{formatSignedLevel(latest.distance_from_seasonal_median)} from median</small>
        </article>
      </div>

      <div className="freshness-strip">
        <span><strong>Source period</strong>{sourceContext.sourcePeriod ? formatPeriod(sourceContext.sourcePeriod) : "Unknown"}</span>
        <span><strong>Source row status</strong>{sourceStatus}</span>
        <span><strong>Latest numeric period</strong>{formatPeriod(sourceContext.numericPeriod)}</span>
        <span><strong>Checked</strong>{formatDateTime(sourceContext.checkedAt)}</span>
        <span><strong>Source release</strong>{formatDateTime(freshness.source_release_at)}</span>
        <span><strong>Expected next</strong>{freshness.expected_next_release_at ? formatDateTime(freshness.expected_next_release_at) : "Unknown"}</span>
      </div>
    </section>
  );
}

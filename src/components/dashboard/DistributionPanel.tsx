import { useState } from "react";
import {
  compactUnit,
  convertDisplayValue,
  formatDisplayValue,
  formatPlainNumber,
  formatValue,
} from "../../lib/formatters";
import { resolveDisplayUnit, type DisplayUnitId } from "../../lib/units";
import type { DistributionSample, UsaChartAsset, UsaManifestSeries } from "../../types/energyAssets";
import { ChartDetailsToggle } from "./ChartDetailsToggle";
import { ChartGeographyControl } from "./ChartGeographyControl";
import { ChartMicroSummary } from "./ChartMicroSummary";
import { DisplayUnitControl } from "./DisplayUnitControl";
import type { RegionSelectionMode } from "./RegionSelectionControl";

interface DistributionPanelProps {
  asset: UsaChartAsset;
  series: UsaManifestSeries;
  geographyId: string;
  onGeographyChange: (geographyId: string) => void;
  geographyIds?: string[];
  regionMode?: RegionSelectionMode;
  onGeographiesChange?: (geographyIds: string[]) => void;
  onRegionModeChange?: (mode: RegionSelectionMode) => void;
  geographyLevelLabel?: string;
  regionLabel?: string;
  /** Display-only conversion; distribution calculations remain in asset.unit. */
  displayUnit?: DisplayUnitId;
  onDisplayUnitChange?: (unit: DisplayUnitId) => void;
}

function selectedLocationLabel(
  series: UsaManifestSeries,
  geographyId: string,
  geographyIds?: readonly string[],
): string {
  const selectedIds = geographyIds?.length ? geographyIds : [geographyId];
  return selectedIds
    .map((id) => series.geographies.find((geography) => geography.geography_id === id)?.label ?? id)
    .join(" + ");
}

function Statistic({ label, value }: { label: string; value: string }) {
  return <div><dt>{label}</dt><dd>{value}</dd></div>;
}

function fitSummary(sample: DistributionSample): string {
  if (!sample.fit) return "No candidate fit supplied";
  return sample.fit.best_candidate_among_tested
    ?? sample.fit.label
    ?? sample.fit.reason
    ?? "No adequate fit among those tested";
}

function selectedFitAic(sample: DistributionSample): number | null {
  const selected = sample.fit?.tested_candidates?.find(
    (candidate) => candidate.name === sample.fit?.best_candidate_among_tested,
  );
  return selected?.aic ?? null;
}

function Histogram({
  sample,
  sourceUnit,
  displayUnit,
  percentagePointChanges,
  sharedMaxCount,
  label,
}: {
  sample: DistributionSample;
  sourceUnit: string;
  displayUnit: DisplayUnitId | null;
  percentagePointChanges: boolean;
  sharedMaxCount: number;
  label: string;
}) {
  if (!sample.histogram.length) {
    return <p className="insufficient-message">No validated histogram is available for this sample.</p>;
  }
  return (
    <div className="histogram" role="group" aria-label={`${label} histogram with ${sample.count} observations`}>
      <div className="histogram-scale"><span>{sharedMaxCount}</span><span>count</span></div>
      <div className="histogram-bars">
        {sample.histogram.map((bin, index) => {
          const formatBinValue = (value: number) => percentagePointChanges
            ? formatValue(value, "percentage points")
            : displayUnit
              ? formatDisplayValue(value, sourceUnit, displayUnit)
              : formatValue(value, sourceUnit);
          const share = sample.count > 0 ? (bin.count / sample.count) * 100 : 0;
          const formattedShare = new Intl.NumberFormat("en-US", {
            maximumFractionDigits: 1,
          }).format(share);
          const binLabel = `${formatBinValue(bin.lower)} to ${formatBinValue(bin.upper)}: ${bin.count} observations (${formattedShare}% of the sample)`;
          return (
            <button
              type="button"
              className="histogram-bin"
              key={`${bin.lower}-${bin.upper}-${index}`}
              style={{ height: `${Math.max(2, (bin.count / sharedMaxCount) * 100)}%` }}
              title={binLabel}
              aria-label={binLabel}
            >
              <span>{bin.count} · {formattedShare}%</span>
            </button>
          );
        })}
      </div>
      <div className="histogram-axis">
        <span>{formatPlainNumber(
          displayUnit
            ? convertDisplayValue(sample.histogram[0]?.lower ?? null, sourceUnit, displayUnit)
            : sample.histogram[0]?.lower ?? null,
        )}</span>
        <strong>{percentagePointChanges
          ? "percentage points"
          : compactUnit(displayUnit ?? sourceUnit)}</strong>
        <span>{formatPlainNumber(
          displayUnit
            ? convertDisplayValue(sample.histogram.at(-1)?.upper ?? null, sourceUnit, displayUnit)
            : sample.histogram.at(-1)?.upper ?? null,
        )}</span>
      </div>
    </div>
  );
}

function DistributionFacet({
  title,
  description,
  sample,
  sourceUnit,
  displayUnit,
  percentagePointChanges = false,
  sharedMaxCount,
}: {
  title: string;
  description: string;
  sample: DistributionSample;
  sourceUnit: string;
  displayUnit: DisplayUnitId | null;
  percentagePointChanges?: boolean;
  sharedMaxCount: number;
}) {
  const aic = selectedFitAic(sample);
  const formatStatistic = (value: number | null) => percentagePointChanges
    ? formatValue(value, "percentage points")
    : displayUnit
      ? formatDisplayValue(value, sourceUnit, displayUnit)
      : formatValue(value, sourceUnit);
  return (
    <article className="distribution-facet" aria-labelledby={`distribution-${title.replaceAll(" ", "-").toLowerCase()}`}>
      <header>
        <h3 id={`distribution-${title.replaceAll(" ", "-").toLowerCase()}`}>{title}</h3>
      </header>

      <Histogram
        sample={sample}
        sourceUnit={sourceUnit}
        displayUnit={displayUnit}
        percentagePointChanges={percentagePointChanges}
        sharedMaxCount={sharedMaxCount}
        label={title}
      />

      <ChartDetailsToggle
        className="distribution-facet-details"
        summary={`${sample.count} observations · statistics and fit`}
      >
        <p>{description}</p>
        <dl className="facet-stats">
          <Statistic label="Mean" value={formatStatistic(sample.mean)} />
          <Statistic label="Median" value={formatStatistic(sample.median)} />
          <Statistic label="Std. deviation" value={formatStatistic(sample.stddev)} />
          <Statistic label="IQR" value={formatStatistic(sample.iqr)} />
          <Statistic label="Skewness" value={formatPlainNumber(sample.skewness, 2)} />
          <Statistic label="Excess kurtosis" value={formatPlainNumber(sample.excess_kurtosis, 2)} />
        </dl>

        <div className="fit-card">
          <span>Best candidate among tested distributions</span>
          <strong>{fitSummary(sample)}</strong>
          {sample.fit?.selection_note ? <small>{sample.fit.selection_note}</small> : null}
          {sample.fit?.tested_candidates?.length ? (
            <small>Tested: {sample.fit.tested_candidates.map((candidate) => candidate.name).join(", ")}</small>
          ) : null}
          {aic !== null ? <small>AIC {formatPlainNumber(aic, 2)}</small> : null}
        </div>

        {sample.exclusions?.length ? (
          <p className="chart-footnote">Excluded: {sample.exclusions.join("; ")}</p>
        ) : null}
      </ChartDetailsToggle>
    </article>
  );
}

export function DistributionPanel({
  asset,
  series,
  geographyId,
  onGeographyChange,
  geographyIds,
  regionMode,
  onGeographiesChange,
  onRegionModeChange,
  geographyLevelLabel,
  regionLabel,
  displayUnit,
  onDisplayUnitChange,
}: DistributionPanelProps) {
  const [localDisplayUnit, setLocalDisplayUnit] = useState<DisplayUnitId>();
  const allCounts = [
    ...asset.distribution.levels.histogram.map((bin) => bin.count),
    ...asset.distribution.changes.histogram.map((bin) => bin.count),
  ];
  const sharedMaxCount = Math.max(...allCounts, 1);
  const resolvedDisplayUnit = resolveDisplayUnit(asset.unit, localDisplayUnit ?? displayUnit);
  const percentagePointChanges = asset.unit.toLowerCase() === "percent";
  const locationLabel = selectedLocationLabel(series, geographyId, geographyIds);
  const changeDisplayUnit = (unit: DisplayUnitId) => {
    if (onDisplayUnitChange) onDisplayUnitChange(unit);
    else setLocalDisplayUnit(unit);
  };

  return (
    <section className="analysis-panel distribution-panel graph-first-panel" aria-labelledby="distribution-title">
      <div className="analysis-panel-heading graph-first-heading">
        <div className="graph-first-title">
          <p className="section-kicker">Distribution diagnostics</p>
          <h2 id="distribution-title">{series.title}</h2>
          <p className="graph-first-location">{locationLabel} · levels and period changes</p>
        </div>
        <div className="graph-first-actions">
          {resolvedDisplayUnit ? (
            <DisplayUnitControl
              sourceUnit={asset.unit}
              value={resolvedDisplayUnit}
              onChange={changeDisplayUnit}
              compact
              micro
            />
          ) : null}
          <ChartDetailsToggle
            className="distribution-options-details"
            summary="Chart options and methodology"
          >
            <ChartGeographyControl
              series={series}
              geographyId={geographyId}
              onGeographyChange={onGeographyChange}
              geographyIds={geographyIds}
              regionMode={regionMode}
              onGeographiesChange={onGeographiesChange}
              onRegionModeChange={onRegionModeChange}
              geographyLevelLabel={geographyLevelLabel}
              regionLabel={regionLabel}
              compact
              chartLabel={`${series.title} distribution comparison`}
            />
            <p>
              Both samples use a shared count scale. Levels show where the market sits; period
              changes reveal the short-term risk shape. Gaps and nonnumeric periods are excluded
              rather than treated as zero.
            </p>
          </ChartDetailsToggle>
        </div>
      </div>

      <div className="chart-stage">
        <ChartMicroSummary asset={asset} series={series} displayUnit={resolvedDisplayUnit ?? undefined} />
        <div className="distribution-facets">
          <DistributionFacet
            title="Raw levels"
            description="The observed series level, including seasonal and structural patterns."
            sample={asset.distribution.levels}
            sourceUnit={asset.unit}
            displayUnit={resolvedDisplayUnit}
            sharedMaxCount={sharedMaxCount}
          />
          <DistributionFacet
            title="Period changes"
            description="Consecutive validated period-to-period movements; gaps are excluded."
            sample={asset.distribution.changes}
            sourceUnit={asset.unit}
            displayUnit={resolvedDisplayUnit}
            percentagePointChanges={percentagePointChanges}
            sharedMaxCount={sharedMaxCount}
          />
        </div>
      </div>

    </section>
  );
}

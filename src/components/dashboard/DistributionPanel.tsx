import {
  compactUnit,
  convertDisplayValue,
  formatDisplayValue,
  formatPlainNumber,
  formatValue,
} from "../../lib/formatters";
import { resolveDisplayUnit, type DisplayUnitId } from "../../lib/units";
import type { DistributionSample, UsaChartAsset, UsaManifestSeries } from "../../types/energyAssets";
import { ChartGeographyControl } from "./ChartGeographyControl";
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
  /** Display-only conversion; distribution calculations remain in asset.unit. */
  displayUnit?: DisplayUnitId;
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
    <div className="histogram" role="img" aria-label={`${label} histogram with ${sample.count} observations`}>
      <div className="histogram-scale"><span>{sharedMaxCount}</span><span>count</span></div>
      <div className="histogram-bars">
        {sample.histogram.map((bin, index) => {
          const formatBinValue = (value: number) => percentagePointChanges
            ? formatValue(value, "percentage points")
            : displayUnit
              ? formatDisplayValue(value, sourceUnit, displayUnit)
              : formatValue(value, sourceUnit);
          const binLabel = `${formatBinValue(bin.lower)} to ${formatBinValue(bin.upper)}: ${bin.count} observations`;
          return (
            <button
              type="button"
              className="histogram-bin"
              key={`${bin.lower}-${bin.upper}-${index}`}
              style={{ height: `${Math.max(2, (bin.count / sharedMaxCount) * 100)}%` }}
              title={binLabel}
              aria-label={binLabel}
            >
              <span>{bin.count}</span>
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
        <div>
          <h3 id={`distribution-${title.replaceAll(" ", "-").toLowerCase()}`}>{title}</h3>
          <p>{description}</p>
        </div>
        <span>{sample.count} observations</span>
      </header>

      <Histogram
        sample={sample}
        sourceUnit={sourceUnit}
        displayUnit={displayUnit}
        percentagePointChanges={percentagePointChanges}
        sharedMaxCount={sharedMaxCount}
        label={title}
      />

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
  displayUnit,
}: DistributionPanelProps) {
  const allCounts = [
    ...asset.distribution.levels.histogram.map((bin) => bin.count),
    ...asset.distribution.changes.histogram.map((bin) => bin.count),
  ];
  const sharedMaxCount = Math.max(...allCounts, 1);
  const resolvedDisplayUnit = resolveDisplayUnit(asset.unit, displayUnit);
  const percentagePointChanges = asset.unit.toLowerCase() === "percent";

  return (
    <section className="analysis-panel distribution-panel" aria-labelledby="distribution-title">
      <div className="analysis-panel-heading">
        <div>
          <p className="section-kicker">Distribution diagnostics</p>
          <h2 id="distribution-title">Levels and changes, viewed together</h2>
          <p>
            Both samples stay visible on a shared count scale. Levels show where the market sits;
            period changes reveal the short-term risk shape.
          </p>
        </div>
        <ChartGeographyControl
          series={series}
          geographyId={geographyId}
          onGeographyChange={onGeographyChange}
          geographyIds={geographyIds}
          regionMode={regionMode}
          onGeographiesChange={onGeographiesChange}
          onRegionModeChange={onRegionModeChange}
          compact
          chartLabel="Distribution comparison"
        />
      </div>

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
    </section>
  );
}

import { useId, useMemo } from "react";
import type { ManifestGeography, UsaManifestSeries } from "../../types/energyAssets";
import {
  RegionSelectionControl,
  type RegionSelectionMode,
} from "./RegionSelectionControl";

interface ChartGeographyControlProps {
  series: UsaManifestSeries;
  geographyId: string;
  onGeographyChange: (geographyId: string) => void;
  geographyIds?: string[];
  regionMode?: RegionSelectionMode;
  onGeographiesChange?: (geographyIds: string[]) => void;
  onRegionModeChange?: (mode: RegionSelectionMode) => void;
  compact?: boolean;
  chartLabel: string;
}

interface LevelOption {
  id: string;
  label: string;
  reason?: string;
  geographies: ManifestGeography[];
}

const FALLBACK_LEVEL_RANK: Record<string, number> = {
  city: 10,
  census_metropolitan_area: 20,
  county: 20,
  state_or_area: 30,
  province_territory: 30,
  padd_subdistrict: 40,
  source_region: 40,
  padd: 50,
  national: 100,
};

function geographyRank(geography: ManifestGeography): number {
  return geography.granularity_rank
    ?? FALLBACK_LEVEL_RANK[geography.level_id]
    ?? Number.MAX_SAFE_INTEGER;
}

function compareGeographies(left: ManifestGeography, right: ManifestGeography): number {
  return geographyRank(left) - geographyRank(right)
    || left.label.localeCompare(right.label)
    || left.geography_id.localeCompare(right.geography_id);
}

export function geographyLevels(series: UsaManifestSeries): LevelOption[] {
  const levels: LevelOption[] = [];
  for (const geography of [...series.geographies].sort(compareGeographies)) {
    let level = levels.find((candidate) => candidate.id === geography.level_id);
    if (!level) {
      level = { id: geography.level_id, label: geography.level_label, geographies: [] };
      levels.push(level);
    }
    level.geographies.push(geography);
  }
  levels.sort((left, right) => {
    const leftRank = Math.min(...left.geographies.map(geographyRank));
    const rightRank = Math.min(...right.geographies.map(geographyRank));
    return leftRank - rightRank || left.label.localeCompare(right.label);
  });
  for (const unsupported of series.unsupported_levels) {
    if (!levels.some((candidate) => candidate.id === unsupported.level_id)) {
      levels.push({
        id: unsupported.level_id,
        label: unsupported.label,
        reason: unsupported.reason,
        geographies: [],
      });
    }
  }
  return levels;
}

export function firstAvailableGeography(series: UsaManifestSeries): ManifestGeography | undefined {
  return [...series.geographies].sort(compareGeographies).find(
    (geography) => geography.status === "available" && Boolean(geography.asset_path),
  );
}

export function ChartGeographyControl({
  series,
  geographyId,
  onGeographyChange,
  geographyIds,
  regionMode,
  onGeographiesChange,
  onRegionModeChange,
  compact = false,
  chartLabel,
}: ChartGeographyControlProps) {
  const controlId = useId();
  const levels = useMemo(() => geographyLevels(series), [series]);
  const selectedIds = geographyIds?.length ? geographyIds : [geographyId];
  const activeGeography = series.geographies.find((item) => item.geography_id === selectedIds[0])
    ?? firstAvailableGeography(series);
  const activeLevel = levels.find((level) => level.id === activeGeography?.level_id)
    ?? levels.find((level) => level.geographies.some((geography) => geography.status === "available"));
  const availableRegions = activeLevel?.geographies.filter(
    (geography) => geography.status === "available" && Boolean(geography.asset_path),
  ) ?? [];

  const handleLevelChange = (levelId: string) => {
    const next = levels.find((level) => level.id === levelId)?.geographies.find(
      (geography) => geography.status === "available" && Boolean(geography.asset_path),
    );
    if (!next) return;
    if (onGeographiesChange) {
      onRegionModeChange?.("single");
      onGeographiesChange([next.geography_id]);
    } else {
      onGeographyChange(next.geography_id);
    }
  };
  const showMultiRegionControl = Boolean(
    geographyIds && regionMode && onGeographiesChange && onRegionModeChange,
  );

  return (
    <div className={`chart-geography ${compact ? "chart-geography-compact" : ""}`}>
      <div className="chart-geography-fields" role="group" aria-label={`${chartLabel} geography`}>
        <label>
          <span>Geography level</span>
          <select value={activeLevel?.id ?? ""} onChange={(event) => handleLevelChange(event.target.value)}>
            {levels.map((level, index) => {
              const isAvailable = level.geographies.some(
                (geography) => geography.status === "available" && Boolean(geography.asset_path),
              );
              return (
                <option key={level.id} value={level.id} disabled={!isAvailable}>
                  {level.label}{index === 0 && isAvailable ? " (finest)" : ""}{!isAvailable ? " — unavailable" : ""}
                </option>
              );
            })}
          </select>
        </label>
        {showMultiRegionControl ? (
          <RegionSelectionControl
            label={activeLevel?.label ?? "Region"}
            mode={regionMode!}
            options={availableRegions.map((geography) => ({
              id: geography.geography_id,
              label: `${geography.label}${geography.origin === "computed-rollup" ? " — computed" : ""}`,
            }))}
            selectedIds={selectedIds}
            onModeChange={onRegionModeChange!}
            onSelectionChange={onGeographiesChange!}
            compact={compact}
            idPrefix={`${controlId}-chart-geography`}
          />
        ) : (
          <label>
            <span>{activeLevel?.label ?? "Region"}</span>
            <select
              value={activeGeography?.geography_id ?? ""}
              onChange={(event) => onGeographyChange(event.target.value)}
            >
              {availableRegions.map((geography) => (
                <option key={geography.geography_id} value={geography.geography_id}>
                  {geography.label}{geography.origin === "computed-rollup" ? " — computed" : ""}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>
      {!compact && series.unsupported_levels.length > 0 ? (
        <details className="geography-boundary">
          <summary>Why finer levels may be disabled</summary>
          <ul>
            {series.unsupported_levels.map((level) => (
              <li key={level.level_id}><strong>{level.label}:</strong> {level.reason}</li>
            ))}
          </ul>
        </details>
      ) : null}
    </div>
  );
}

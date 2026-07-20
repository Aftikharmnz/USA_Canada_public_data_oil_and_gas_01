import { useEffect, useMemo, useState } from "react";
import type {
  CountryCatalog,
  GeographyControlStatus,
  GeographyLevel,
  GeographySelection,
} from "../types/catalog";

interface GeographyFilterProps {
  catalog: CountryCatalog;
  metricId: string;
  onMetricChange: (metricId: string) => void;
  onSelectionChange: (selection: GeographySelection) => void;
  status?: GeographyControlStatus;
}

function getLevel(catalog: CountryCatalog, levelId: string): GeographyLevel {
  const level = catalog.geographyLevels.find((candidate) => candidate.id === levelId);
  if (!level) {
    throw new Error(`Catalog is missing geography level: ${levelId}`);
  }
  return level;
}

export function GeographyFilter({
  catalog,
  metricId,
  onMetricChange,
  onSelectionChange,
  status = "ready",
}: GeographyFilterProps) {
  const metric = catalog.metrics.find((candidate) => candidate.id === metricId) ?? catalog.metrics[0];

  if (!metric) {
    throw new Error(`${catalog.name} catalog must define at least one metric.`);
  }

  const supportedLevels = useMemo(
    () => metric.geographyLevelIds.map((levelId) => getLevel(catalog, levelId)),
    [catalog, metric],
  );
  const finestLevel = supportedLevels[0];

  if (!finestLevel) {
    throw new Error(`${metric.title} must define at least one geography level.`);
  }

  const [requestedLevelId, setRequestedLevelId] = useState(finestLevel.id);
  const activeLevel =
    supportedLevels.find((candidate) => candidate.id === requestedLevelId) ?? finestLevel;
  const [requestedRegionId, setRequestedRegionId] = useState(activeLevel.regions[0]?.id ?? "");
  const activeRegion =
    activeLevel.regions.find((candidate) => candidate.id === requestedRegionId) ??
    activeLevel.regions[0];

  useEffect(() => {
    setRequestedLevelId(finestLevel.id);
    setRequestedRegionId(finestLevel.regions[0]?.id ?? "");
  }, [finestLevel.id, finestLevel.regions]);

  useEffect(() => {
    if (!activeRegion) return;
    onSelectionChange({
      metricId: metric.id,
      metricTitle: metric.title,
      levelId: activeLevel.id,
      levelLabel: activeLevel.label,
      regionId: activeRegion.id,
      regionLabel: activeRegion.label,
      origin: metric.geographyLevelOrigins[activeLevel.id] ?? "source-published",
    });
  }, [
    activeLevel.id,
    activeLevel.label,
    activeRegion,
    metric.geographyLevelOrigins,
    metric.id,
    metric.title,
    onSelectionChange,
  ]);

  const handleLevelChange = (levelId: string) => {
    const nextLevel = getLevel(catalog, levelId);
    setRequestedLevelId(nextLevel.id);
    setRequestedRegionId(nextLevel.regions[0]?.id ?? "");
  };
  const controlsDisabled = status === "loading" || status === "unavailable";
  const statusMessage = {
    ready: null,
    loading: "Geography metadata is loading.",
    stale: "Geography metadata is usable but its freshness window has passed.",
    unavailable: "Geography metadata is currently unavailable; the last valid selection is retained.",
  }[status];

  return (
    <section
      className="geography-filter"
      aria-labelledby={`${catalog.code}-filter-title`}
      aria-busy={status === "loading"}
      data-status={status}
    >
      <div className="filter-heading">
        <div>
          <p className="section-kicker">Universal data controls</p>
          <h2 id={`${catalog.code}-filter-title`}>Metric and geography</h2>
        </div>
        <span className="availability-badge">Finest available: {finestLevel.label}</span>
      </div>

      <div className="filter-grid">
        <label className="field">
          <span>Metric</span>
          <select
            value={metric.id}
            disabled={controlsDisabled}
            onChange={(event) => onMetricChange(event.target.value)}
          >
            {catalog.metrics.map((candidate) => (
              <option key={candidate.id} value={candidate.id}>
                {candidate.title}
              </option>
            ))}
          </select>
          <small>{metric.frequency} · {metric.unit}</small>
        </label>

        <label className="field">
          <span>Geography level</span>
          <select
            value={activeLevel.id}
            disabled={controlsDisabled}
            onChange={(event) => handleLevelChange(event.target.value)}
          >
            {supportedLevels.map((level, index) => (
              <option key={level.id} value={level.id}>
                {level.label}{index === 0 ? " · finest" : ""}
              </option>
            ))}
            {metric.unavailableGeographyLevels.length > 0 ? (
              <optgroup label="Unavailable for this metric">
                {metric.unavailableGeographyLevels.map((level) => (
                  <option key={level.id} value={`unavailable:${level.id}`} disabled>
                    {level.label} · unavailable
                  </option>
                ))}
              </optgroup>
            ) : null}
          </select>
          <small>Only levels published for this metric are listed.</small>
        </label>

        <label className="field">
          <span>{activeLevel.regionLabel}</span>
          <select
            value={activeRegion?.id ?? ""}
            disabled={controlsDisabled}
            onChange={(event) => setRequestedRegionId(event.target.value)}
          >
            {activeLevel.regions.map((region) => (
              <option key={region.id} value={region.id}>
                {region.label}
              </option>
            ))}
          </select>
          <small>{activeLevel.description}</small>
        </label>
      </div>

      <div className="scope-row" aria-label="Available geography levels">
        <span>Available scope</span>
        {supportedLevels.map((level, index) => (
          <span className="scope-chip" key={level.id}>
            {level.label}{index === 0 ? " (smallest)" : ""} ·{
              metric.geographyLevelOrigins[level.id] === "computed-rollup" ? " computed" : " published"
            }
          </span>
        ))}
      </div>

      {statusMessage ? <p className="filter-status" role="status">{statusMessage}</p> : null}
      <div className="filter-note">
        <strong>Unavailable detail</strong>
        <ul>
          {metric.unavailableGeographyLevels.map((level) => (
            <li key={level.id}><span>{level.label}:</span> {level.reason}</li>
          ))}
        </ul>
      </div>
    </section>
  );
}

import { useMemo, useState } from "react";
import { AssetDetails } from "../components/dashboard/AssetDetails";
import { CollapsibleToolbar } from "../components/dashboard/CollapsibleToolbar";
import {
  DashboardError,
  DashboardLoading,
  LastKnownGoodNotice,
} from "../components/dashboard/DashboardStates";
import { DistributionPanel } from "../components/dashboard/DistributionPanel";
import { DisplayUnitControl } from "../components/dashboard/DisplayUnitControl";
import { FreshnessBadge } from "../components/dashboard/FreshnessBadge";
import { LatestValueGrid } from "../components/dashboard/LatestValueGrid";
import {
  RegionSelectionControl,
  type RegionSelectionMode,
} from "../components/dashboard/RegionSelectionControl";
import { SeasonalChart } from "../components/dashboard/SeasonalChart";
import {
  availableCanadaSeries,
  canadaHasCompatibleCombination,
  canadaReferenceEntries,
  resolveCanadaDashboardSelection,
  type CanadaDashboardSelectionRequest,
  type CanadaGeographyOption,
} from "../data/canadaDashboard";
import { customAggregationPolicy } from "../data/customAggregation";
import { overlappingSelection } from "../data/geographyContainment";
import {
  forecastIsRenderable,
  forecastMismatchReason,
} from "../data/forecastAssets";
import { useCanadaManifest } from "../hooks/useCanadaAssets";
import { useCountryChartAssets, useCountryForecastAssets } from "../hooks/useCountryAssets";
import { useCustomRegionView } from "../hooks/useCustomRegionView";
import { compactUnit, formatDateTime } from "../lib/formatters";
import {
  buildMonthlyAverageRateAsset,
  monthlyAverageRateForecastPoints,
  monthlyAverageRateOption,
  MONTHLY_AVERAGE_RATE_UNIT,
} from "../lib/periodAverageRate";
import { appPath } from "../lib/routes";
import { resolveDisplayUnit, type DisplayUnitId } from "../lib/units";
import type {
  CanadaAssetManifest,
  CanadaManifestSeries,
  ForecastPoint,
  UsaChartAsset,
} from "../types/energyAssets";

interface MonthlyRateDisplayView {
  asset?: UsaChartAsset;
  forecastPoints?: ForecastPoint[];
  assetError?: string;
  forecastError?: string;
}

function errorMessage(error: unknown): string {
  return error instanceof Error
    ? error.message
    : "The monthly-average rate view could not be prepared.";
}

function geographyBoundaryMessage(series: CanadaManifestSeries): string {
  if (series.frequency.toLowerCase().includes("week")) {
    return "CER weekly refinery observations stop at three confidentiality regions; province, refinery, and city values are not inferred.";
  }
  return "Statistics Canada monthly balances expose province or territory and larger views only where the table publishes or validates them; city values are not inferred.";
}

function componentRoleLabel(role: string | undefined): string {
  if (role === "component") return "component";
  if (role === "contextual") return "context";
  if (role === "parent") return "broader parent";
  if (role === "subtraction") return "subtractive flow";
  if (role === "headline") return "headline product";
  return "source-defined product";
}

function geographyOptionLabel(option: CanadaGeographyOption): string {
  const sourceLabel = option.sourceNames.join(" / ");
  const originLabel = option.origins.length > 1
    ? "published / computed by series"
    : option.origins[0] === "computed-rollup"
      ? "computed rollup"
      : "source-published";
  return `${option.label} · ${sourceLabel} · ${originLabel}`;
}

function CanadaReferenceLinks({ series }: { series: CanadaManifestSeries }) {
  const entries = canadaReferenceEntries(series);

  return (
    <div className="products-reference-links" aria-label="Related terminology">
      <strong>Related definitions</strong>
      {entries.length ? entries.map((entry) => (
        <a key={entry.id} href={`${appPath("reference")}#${entry.id}`}>
          {entry.term}
        </a>
      )) : (
        <a href={appPath("reference")}>Open definitions</a>
      )}
    </div>
  );
}

function CanadaDashboard({ manifest }: { manifest: CanadaAssetManifest }) {
  const eligibleSeries = useMemo(() => availableCanadaSeries(manifest), [manifest]);
  const [requested, setRequested] = useState<CanadaDashboardSelectionRequest>({});
  const [filtersCollapsed, setFiltersCollapsed] = useState(false);
  const [regionMode, setRegionMode] = useState<RegionSelectionMode>("single");
  const [requestedDisplayUnit, setRequestedDisplayUnit] = useState<DisplayUnitId>();
  const selection = useMemo(
    () => resolveCanadaDashboardSelection(eligibleSeries, requested),
    [eligibleSeries, requested],
  );
  const series = selection.series;
  const selectedGeographies = series
    ? selection.geographyIds.flatMap((geographyId) => {
        const geography = series.geographies.find((candidate) => (
          candidate.geography_id === geographyId
          && candidate.level_id === selection.geographyLevelId
          && candidate.status === "available"
          && candidate.asset_path
        ));
        return geography ? [geography] : [];
      })
    : [];
  const geography = selectedGeographies[0];
  const combined = regionMode === "combined" && selectedGeographies.length > 1;
  const aggregationPolicy = series
    ? customAggregationPolicy("canada", series.view_id, selection.geographyLevelId)
    : undefined;
  const assetPaths = selectedGeographies.flatMap((candidate) => candidate.asset_path ? [candidate.asset_path] : []);
  const forecastPaths = selectedGeographies.length
    && selectedGeographies.every((candidate) => candidate.forecast_path)
    ? selectedGeographies.map((candidate) => candidate.forecast_path!)
    : [];
  const { state: assetState, retry: retryAsset } = useCountryChartAssets("canada", assetPaths);
  const { state: forecastState } = useCountryForecastAssets("canada", forecastPaths);
  const loadedAssets = "data" in assetState ? assetState.data : undefined;
  const sourceAssets = loadedAssets?.length === selectedGeographies.length
    && loadedAssets.every((asset, index) => (
      asset.series_id === series?.series_id
      && asset.geography_id === selectedGeographies[index]?.geography_id
    ))
    ? loadedAssets
    : undefined;
  const loadedForecasts = "data" in forecastState ? forecastState.data : undefined;
  const sourceForecasts = loadedForecasts?.length === selectedGeographies.length
    && loadedForecasts.every((forecast, index) => (
      forecast.target_view_id === series?.view_id
      && forecast.geography_id === selectedGeographies[index]?.geography_id
    ))
    ? loadedForecasts
    : undefined;
  const customViewState = useCustomRegionView({
    country: "canada",
    enabled: combined,
    series,
    policy: aggregationPolicy,
    geographies: selectedGeographies,
    assets: sourceAssets,
    forecasts: sourceForecasts,
  });

  if (!series || !geography) {
    return (
      <DashboardError
        title="No validated Canada series is available"
        message="The manifest loaded, but it did not provide a compatible Crude or Refined series at an official geography."
        onRetry={() => window.location.reload()}
      />
    );
  }

  const chooseSegment = (segmentId: typeof selection.segmentId) => {
    setRequested({ segmentId });
    setRegionMode("single");
  };

  const chooseGeographyLevel = (geographyLevelId: string) => {
    setRequested({
      segmentId: selection.segmentId,
      geographyLevelId,
    });
    setRegionMode("single");
  };

  const chooseGeography = (geographyId: string) => {
    setRequested({
      segmentId: selection.segmentId,
      geographyLevelId: selection.geographyLevelId,
      geographyIds: [geographyId],
    });
    setRegionMode("single");
  };

  const chooseGeographies = (geographyIds: string[]) => {
    const selected = new Set(geographyIds);
    const orderedIds = selection.geographies
      .filter((geography) => selected.has(geography.geographyId))
      .map((geography) => geography.geographyId);
    setRequested((current) => ({
      ...current,
      segmentId: selection.segmentId,
      geographyLevelId: selection.geographyLevelId,
      geographyId: undefined,
      geographyIds: orderedIds,
    }));
  };

  const chooseRegionMode = (mode: RegionSelectionMode) => {
    if (mode === "single") {
      setRegionMode("single");
      chooseGeographies([selection.geographyIds[0] ?? selection.geographyId]);
      return;
    }
    if (!aggregationPolicy) return;
    const first = selection.geographyIds[0] ?? selection.geographyId;
    const second = selection.geographies.find((candidate) => (
      candidate.geographyId !== first
      && canadaHasCompatibleCombination(
        eligibleSeries,
        selection.segmentId,
        selection.geographyLevelId,
        [first, candidate.geographyId],
      )
    ));
    if (!second) return;
    setRegionMode("combined");
    chooseGeographies([first, second.geographyId]);
  };

  const chooseProduct = (productId: string) => {
    setRequested({
      segmentId: selection.segmentId,
      geographyLevelId: selection.geographyLevelId,
      geographyIds: selection.geographyIds,
      familyId: selection.familyId,
      productId,
    });
  };

  const chooseFamily = (familyId: string) => {
    setRequested({
      segmentId: selection.segmentId,
      geographyLevelId: selection.geographyLevelId,
      geographyIds: selection.geographyIds,
      familyId,
    });
  };

  const chooseMeasure = (measureId: string) => {
    setRequested({
      segmentId: selection.segmentId,
      geographyLevelId: selection.geographyLevelId,
      geographyIds: selection.geographyIds,
      familyId: selection.familyId,
      productId: selection.productId,
      measureId,
    });
  };

  const chooseSeries = (seriesId: string) => {
    setRequested({
      segmentId: selection.segmentId,
      geographyLevelId: selection.geographyLevelId,
      geographyIds: selection.geographyIds,
      familyId: selection.familyId,
      productId: selection.productId,
      measureId: selection.measureId,
      seriesId,
    });
  };

  const chooseChartGeography = (geographyId: string) => {
    const next = series.geographies.find(
      (candidate) => candidate.geography_id === geographyId
        && candidate.status === "available"
        && candidate.asset_path,
    );
    if (!next) return;
    setRequested({
      segmentId: selection.segmentId,
      geographyLevelId: next.level_id,
      geographyIds: [next.geography_id],
      familyId: selection.familyId,
      productId: selection.productId,
      measureId: selection.measureId,
      seriesId: series.view_id,
    });
    setRegionMode("single");
  };

  const singleAsset = sourceAssets?.[0];
  const asset = combined
    ? customViewState.status === "ready" ? customViewState.data.asset : undefined
    : singleAsset;
  const displayGeography = combined && customViewState.status === "ready"
    ? customViewState.data.geography
    : geography;
  const forecastCandidate = sourceForecasts?.[0];
  const forecastMismatch = forecastCandidate && asset
    && !combined
    ? forecastMismatchReason(forecastCandidate, asset, series, geography.geography_id)
    : null;
  const forecast = combined
    ? customViewState.status === "ready" ? customViewState.data.forecast : undefined
    : forecastCandidate && !forecastMismatch && forecastIsRenderable(forecastCandidate)
      ? forecastCandidate
      : undefined;
  const forecastNotice = combined
    ? customViewState.status === "ready"
      ? customViewState.data.forecastNotice
      : customViewState.status === "error"
        ? `${customViewState.error} Observed component data remain unchanged.`
        : "Validating bottom-up regional forecasts and aligned residualsâ€¦"
    : !geography.forecast_path
    ? "No validated statistical forecast has been published for this exact selection."
    : forecastMismatch
      ? `${forecastMismatch} Observed data remain available while the forecast refreshes.`
      : forecastCandidate && !forecastIsRenderable(forecastCandidate)
        ? forecastCandidate.reason ?? "This series does not yet have enough consecutive history for a calibrated forecast."
        : forecastState.status === "error"
          ? "The forecast could not be loaded; observed data remain available."
          : forecastState.status === "stale"
            ? "Using the last validated matching forecast because the newest forecast request failed."
            : forecastState.status === "loading"
              ? "Checking for the latest validated forecast…"
              : undefined;
  const averageRateOption = monthlyAverageRateOption(series);
  const averageRateRequested = Boolean(
    averageRateOption && requestedDisplayUnit === MONTHLY_AVERAGE_RATE_UNIT,
  );
  const monthlyRateView: MonthlyRateDisplayView = (() => {
    if (!averageRateRequested || !asset) return { asset };
    let derivedAsset: UsaChartAsset;
    try {
      derivedAsset = buildMonthlyAverageRateAsset(asset);
    } catch (error) {
      return { asset, assetError: errorMessage(error) };
    }
    if (!forecast) return { asset: derivedAsset };
    try {
      return {
        asset: derivedAsset,
        forecastPoints: monthlyAverageRateForecastPoints(forecast),
      };
    } catch (error) {
      return {
        asset: derivedAsset,
        forecastError: errorMessage(error),
      };
    }
  })();
  const displayAsset = monthlyRateView.asset;
  const averageRateActive = averageRateRequested
    && !monthlyRateView.assetError
    && displayAsset?.unit === MONTHLY_AVERAGE_RATE_UNIT;
  const displayUnit = resolveDisplayUnit(
    displayAsset?.unit ?? asset?.unit ?? series.unit,
    averageRateActive ? requestedDisplayUnit : undefined,
  );
  const displayForecast = averageRateActive && monthlyRateView.forecastError
    ? undefined
    : forecast;
  const displayForecastNotice = averageRateActive && monthlyRateView.forecastError
    ? `${monthlyRateView.forecastError} The observed monthly-average view remains available.`
    : forecastNotice;
  const unitHelpText = averageRateOption
    ? averageRateActive
      ? "Monthly average: source monthly volume divided by that month's exact calendar-day count; canonical data remain cubic metres."
      : "Source data remain monthly cubic metres; kb/d is available as a monthly average using each month's exact calendar-day count."
    : series.frequency.toLowerCase().startsWith("month")
      && series.unit === "cubic_metres"
      && series.classification?.measure_id === "ending-stocks"
      ? "kb/d is unavailable because this is a point-in-time inventory, not a monthly flow."
      : undefined;
  const sourceLink = series.source.url;
  const selectedSegment = selection.segments.find(
    (option) => option.id === selection.segmentId,
  );
  const selectedProduct = selection.products.find(
    (option) => option.id === selection.productId,
  );

  return (
    <>
      <CollapsibleToolbar
        ariaLabel="Canada market filters"
        className="products-toolbar canada-dashboard-toolbar"
        collapsed={filtersCollapsed}
        contentId="canada-market-filter-content"
        onCollapsedChange={setFiltersCollapsed}
        summary={`${selectedSegment?.label ?? selection.segmentId} / ${selectedGeographies.map((item) => item.label).join(" + ")} / ${selectedProduct?.label ?? series.title} / ${selection.measures.find((item) => item.id === selection.measureId)?.label ?? series.title}`}
      >
        <div className="products-toolbar-heading">
          <div>
            <p className="section-kicker">Canadian market view</p>
            <h2 id="canada-market-view-title">Start with Crude or Refined, then move from fine to broad</h2>
            <p>
              Choose the finest official geography first. Every later product and measure option
              is guaranteed to have data at that exact source geography.
            </p>
          </div>
          <div className="toolbar-freshness">
            <FreshnessBadge status={series.freshness.status} />
            <small>Manifest built {formatDateTime(manifest.generated_at)}</small>
          </div>
        </div>

        <div className="products-filter-grid canada-filter-grid canada-hierarchy-grid">
          <div className="series-field canada-segment-control">
            <span>1 · Market segment</span>
            <div className="sample-tabs canada-segment-tabs" role="group" aria-label="Canadian market segment">
              {selection.segments.map((option) => (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={option.id === selection.segmentId}
                  onClick={() => chooseSegment(option.id)}
                >
                  {option.label}{option.seriesCount ? ` (${option.seriesCount})` : ""}
                </button>
              ))}
            </div>
            <small>{selectedSegment?.description}</small>
          </div>

          <label className="series-field">
            <span>2 · Geography level</span>
            <select
              value={selection.geographyLevelId}
              onChange={(event) => chooseGeographyLevel(event.target.value)}
            >
              {selection.geographyLevels.map((option, index) => (
                <option key={option.id} value={option.id}>
                  {option.label}{index === 0 ? " (finest available)" : ""}
                </option>
              ))}
            </select>
            <small>Ordered from the smallest published grain to Canada.</small>
          </label>

          <RegionSelectionControl
            idPrefix="canada-market"
            label="3 / Official region"
            mode={regionMode}
            selectedIds={selection.geographyIds}
            onModeChange={chooseRegionMode}
            onSelectionChange={chooseGeographies}
            combinedDisabledReason={aggregationPolicy
              ? undefined
              : "This exact series and geography level is not registered as an additive quantity."}
            options={selection.geographies.map((option) => {
              const alreadySelected = selection.geographyIds.includes(option.geographyId);
              // Registered Canadian levels are disjoint today, but the same
              // containment guard applies so an overlapping source aggregate can
              // never be summed with a region it already contains.
              const overlaps = alreadySelected
                ? undefined
                : overlappingSelection("canada", selection.geographyIds, option.geographyId);
              const overlapLabel = overlaps
                ? selection.geographies.find((item) => item.geographyId === overlaps)?.label ?? overlaps
                : undefined;
              const incompatible = !alreadySelected
                && !overlaps
                && !canadaHasCompatibleCombination(
                  eligibleSeries,
                  selection.segmentId,
                  selection.geographyLevelId,
                  [...selection.geographyIds, option.geographyId],
                );
              return {
                id: option.geographyId,
                label: geographyOptionLabel(option),
                disabled: regionMode === "combined" && (Boolean(overlaps) || incompatible),
                disabledReason: overlapLabel
                  ? `${geographyOptionLabel(option)} overlaps ${overlapLabel}; adding both would double-count the same territory.`
                  : "No active series can combine this region with the current selection.",
              };
            })}
          />

          <label className="series-field">
            <span>4 · Product family</span>
            <select value={selection.familyId} onChange={(event) => chooseFamily(event.target.value)}>
              {selection.families.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
            <small>Only families available at the selected geography are offered.</small>
          </label>

          <label className="series-field">
            <span>5 · Product or activity</span>
            <select value={selection.productId} onChange={(event) => chooseProduct(event.target.value)}>
              {selection.products.map((option) => (
                <option key={option.id} value={option.id}>
                  {option.label} · {componentRoleLabel(option.componentRole)}
                </option>
              ))}
            </select>
            <small>
              {selectedProduct?.familyLabel ?? series.category} · most specific components first
            </small>
          </label>

          <label className="series-field">
            <span>6 · Market measure</span>
            <select value={selection.measureId} onChange={(event) => chooseMeasure(event.target.value)}>
              {selection.measures.map((option) => (
                <option key={option.id} value={option.id}>{option.label}</option>
              ))}
            </select>
            <small>{compactUnit(series.unit)} · {series.frequency}</small>
          </label>

          {selection.seriesOptions.length > 1 ? (
            <label className="series-field">
              <span>7 · Published series</span>
              <select value={series.view_id} onChange={(event) => chooseSeries(event.target.value)}>
                {selection.seriesOptions.map((candidate) => (
                  <option key={candidate.view_id} value={candidate.view_id}>
                    {candidate.title} · {candidate.frequency}
                  </option>
                ))}
              </select>
              <small>{series.source.name}</small>
            </label>
          ) : null}
          {displayUnit ? (
            <DisplayUnitControl
              sourceUnit={asset?.unit ?? series.unit}
              value={displayUnit}
              onChange={setRequestedDisplayUnit}
              additionalOptions={averageRateOption ? [averageRateOption] : undefined}
              helpText={unitHelpText}
            />
          ) : null}
          {monthlyRateView.assetError ? (
            <p className="unit-display-error" role="status">
              {monthlyRateView.assetError} Source-volume values remain visible.
            </p>
          ) : null}
        </div>

        {series.unsupported_levels.length ? (
          <details className="geography-boundary canada-geography-boundary">
            <summary>Why a smaller geography may not be available</summary>
            <ul>
              {series.unsupported_levels.map((level) => (
                <li key={level.level_id}><strong>{level.label}:</strong> {level.reason}</li>
              ))}
            </ul>
          </details>
        ) : null}

        <div className="products-selection-context canada-selection-context">
          <span className="component-role-badge">{selection.segmentId} · {series.frequency}</span>
          <p><strong>Geography boundary:</strong> {geographyBoundaryMessage(series)}</p>
          {series.description ? (
            <p><strong>Accounting note:</strong> {series.description}</p>
          ) : null}
          <div className="canada-context-links">
            <div className="products-reference-links">
              <strong>Official source</strong>
              {sourceLink ? (
                <a href={sourceLink} target="_blank" rel="noreferrer">
                  {series.source.name} ↗
                </a>
              ) : (
                <span>{series.source.name}</span>
              )}
            </div>
            <CanadaReferenceLinks series={series} />
          </div>
        </div>
      </CollapsibleToolbar>

      {assetState.status === "stale" ? <LastKnownGoodNotice error={assetState.error} /> : null}
      {!asset && assetState.status !== "error"
        && (!combined || customViewState.status !== "error") ? (
        <DashboardLoading
          label={`Loading ${series.title} for ${selectedGeographies.map((item) => item.label).join(" + ")}`}
        />
      ) : null}
      {assetState.status === "error" ? (
        <DashboardError
          title="This Canada chart asset is unavailable"
          message={assetState.error}
          onRetry={retryAsset}
        />
      ) : null}
      {combined && customViewState.status === "error" ? (
        <DashboardError
          title="These Canadian regions cannot be combined"
          message={customViewState.error}
          onRetry={retryAsset}
        />
      ) : null}
      {asset && displayAsset && displayGeography ? (
        <div className={assetState.status === "loading" ? "dashboard-refreshing" : ""}>
          {assetState.status === "loading" ? (
            <p className="refreshing-label" role="status">Checking for a newer asset…</p>
          ) : null}
          <LatestValueGrid asset={displayAsset} series={series} displayUnit={displayUnit ?? undefined} />
          <SeasonalChart
            asset={displayAsset}
            series={series}
            geographyId={geography.geography_id}
            onGeographyChange={chooseChartGeography}
            geographyIds={aggregationPolicy ? selection.geographyIds : undefined}
            regionMode={aggregationPolicy ? regionMode : undefined}
            onGeographiesChange={aggregationPolicy ? chooseGeographies : undefined}
            onRegionModeChange={aggregationPolicy ? chooseRegionMode : undefined}
            displayUnit={displayUnit ?? undefined}
            forecast={displayForecast}
            forecastDisplayPoints={averageRateActive ? monthlyRateView.forecastPoints : undefined}
            forecastNotice={displayForecastNotice}
          />
          <DistributionPanel
            asset={displayAsset}
            series={series}
            geographyId={geography.geography_id}
            onGeographyChange={chooseChartGeography}
            geographyIds={aggregationPolicy ? selection.geographyIds : undefined}
            regionMode={aggregationPolicy ? regionMode : undefined}
            onGeographiesChange={aggregationPolicy ? chooseGeographies : undefined}
            onRegionModeChange={aggregationPolicy ? chooseRegionMode : undefined}
            displayUnit={displayUnit ?? undefined}
          />
          <AssetDetails asset={asset} series={series} geography={displayGeography} />
        </div>
      ) : null}
    </>
  );
}

export function CanadaPage() {
  const { state, retry } = useCanadaManifest();
  const manifest = "data" in state ? state.data : undefined;

  return (
    <main id="main-content" className="page-shell usa-dashboard-shell canada-dashboard-shell">
      <h1 className="visually-hidden">Canada petroleum dashboard</h1>

      {state.status === "loading" && !state.data ? <DashboardLoading /> : null}
      {state.status === "error" ? (
        <DashboardError
          title="Canada data manifest could not be opened"
          message={state.error}
          onRetry={retry}
        />
      ) : null}
      {state.status === "stale" ? <LastKnownGoodNotice error={state.error} /> : null}
      {manifest ? <CanadaDashboard manifest={manifest} /> : null}
    </main>
  );
}

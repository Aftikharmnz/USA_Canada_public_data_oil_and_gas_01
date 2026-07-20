import { useEffect, useMemo, useState } from "react";
import { AssetDetails } from "../components/dashboard/AssetDetails";
import { BalanceWaterfall } from "../components/dashboard/BalanceWaterfall";
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
import { referenceGlossary } from "../data/referenceGlossary";
import {
  componentRoleLabel,
  productOverlapMessage,
  refinedProductSeries,
} from "../data/refinedProducts";
import {
  resolveUsaDashboardSelection,
  usaHasCompatibleCombination,
  type UsaDashboardSelectionRequest,
  type UsaEnergySegment,
} from "../data/usaDashboard";
import { customAggregationPolicy } from "../data/customAggregation";
import { overlappingSelection } from "../data/geographyContainment";
import {
  forecastIsRenderable,
  forecastMismatchReason,
} from "../data/forecastAssets";
import { useCountryChartAssets, useCountryForecastAssets } from "../hooks/useCountryAssets";
import { useCustomRegionView } from "../hooks/useCustomRegionView";
import { useUsaManifest } from "../hooks/useUsaAssets";
import { formatDateTime } from "../lib/formatters";
import { appPath } from "../lib/routes";
import { resolveDisplayUnit, type DisplayUnitId } from "../lib/units";
import type { UsaAssetManifest, UsaManifestSeries } from "../types/energyAssets";

interface UsaPageProps {
  initialSegment?: UsaEnergySegment;
}

function ReferenceLinks({ series }: { series: UsaManifestSeries }) {
  const entries = (series.classification?.reference_term_ids ?? [])
    .map((termId) => referenceGlossary.find((entry) => entry.id === termId))
    .filter((entry) => entry !== undefined);

  return (
    <div className="products-reference-links" aria-label="Related terminology">
      <strong>Understand this selection</strong>
      {entries.length ? entries.map((entry) => (
        <a key={entry.id} href={`${appPath("reference")}#${entry.id}`}>
          {entry.term}
        </a>
      )) : (
        <a href={appPath("reference")}>Browse the petroleum reference</a>
      )}
    </div>
  );
}

function UsaDashboard({
  manifest,
  initialSegment,
}: {
  manifest: UsaAssetManifest;
  initialSegment: UsaEnergySegment;
}) {
  const [requested, setRequested] = useState<UsaDashboardSelectionRequest>({
    segment: initialSegment,
  });
  const [filtersCollapsed, setFiltersCollapsed] = useState(false);
  const [regionMode, setRegionMode] = useState<RegionSelectionMode>("single");
  const [requestedDisplayUnit, setRequestedDisplayUnit] = useState<DisplayUnitId>();

  useEffect(() => {
    setRequested({ segment: initialSegment });
    setRegionMode("single");
  }, [initialSegment]);

  const selection = useMemo(
    () => resolveUsaDashboardSelection(manifest.series, requested),
    [manifest.series, requested],
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
    ? customAggregationPolicy("usa", series.view_id, selection.geographyLevelId)
    : undefined;
  const assetPaths = selectedGeographies.flatMap((candidate) => candidate.asset_path ? [candidate.asset_path] : []);
  const forecastPaths = selectedGeographies.length
    && selectedGeographies.every((candidate) => candidate.forecast_path)
    ? selectedGeographies.map((candidate) => candidate.forecast_path!)
    : [];
  const { state: assetState, retry: retryAsset } = useCountryChartAssets("usa", assetPaths);
  const { state: forecastState } = useCountryForecastAssets("usa", forecastPaths);
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
    country: "usa",
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
        title="No validated USA series is available"
        message="The manifest loaded, but the selected segment and official geography did not provide a compatible chart asset."
        onRetry={() => window.location.reload()}
      />
    );
  }

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
  const displayUnit = resolveDisplayUnit(asset?.unit ?? series.unit, requestedDisplayUnit);

  const selectedProduct = selection.products.find((item) => item.id === selection.productId);
  const selectedSegment = selection.segments.find((item) => item.id === selection.segment);
  const selectedMeasure = selection.measures.find((item) => item.id === selection.measureId);
  const classifiedRefinedSeries = refinedProductSeries(manifest.series);

  const chooseSegment = (segment: UsaEnergySegment) => {
    setRequested({ segment });
    setRegionMode("single");
  };

  const chooseGeographyLevel = (geographyLevelId: string) => {
    const nextGeography = selection.geographyLevels
      .find((level) => level.id === geographyLevelId)?.geographies[0];
    setRequested({
      segment: selection.segment,
      geographyLevelId,
      geographyIds: nextGeography ? [nextGeography.geography_id] : undefined,
    });
    setRegionMode("single");
  };

  const chooseGeography = (geographyId: string) => {
    const geographyLevelId = selection.geographyLevels.find((level) => (
      level.geographies.some((candidate) => candidate.geography_id === geographyId)
    ))?.id;
    setRequested((current) => ({
      ...current,
      segment: selection.segment,
      geographyLevelId,
      geographyId: undefined,
      geographyIds: [geographyId],
    }));
    setRegionMode("single");
  };

  const chooseGeographies = (geographyIds: string[]) => {
    const selected = new Set(geographyIds);
    const orderedIds = selection.geographies
      .filter((geography) => selected.has(geography.geography_id))
      .map((geography) => geography.geography_id);
    setRequested((current) => ({
      ...current,
      segment: selection.segment,
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
      candidate.geography_id !== first
      && usaHasCompatibleCombination(
        manifest.series,
        selection.segment,
        selection.geographyLevelId,
        [first, candidate.geography_id],
      )
    ));
    if (!second) return;
    setRegionMode("combined");
    chooseGeographies([first, second.geography_id]);
  };

  const chooseFamily = (familyId: string) => {
    setRequested((current) => ({
      ...current,
      segment: selection.segment,
      geographyLevelId: selection.geographyLevelId,
      geographyId: undefined,
      geographyIds: selection.geographyIds,
      familyId,
      productId: undefined,
      measureId: undefined,
    }));
  };

  const chooseProduct = (productId: string) => {
    setRequested((current) => ({
      ...current,
      segment: selection.segment,
      geographyLevelId: selection.geographyLevelId,
      geographyId: undefined,
      geographyIds: selection.geographyIds,
      familyId: selection.familyId,
      productId,
      measureId: undefined,
    }));
  };

  const chooseMeasure = (measureId: string) => {
    setRequested((current) => ({
      ...current,
      segment: selection.segment,
      geographyLevelId: selection.geographyLevelId,
      geographyId: undefined,
      geographyIds: selection.geographyIds,
      familyId: selection.familyId,
      productId: selection.productId,
      measureId,
    }));
  };

  return (
    <>
      <CollapsibleToolbar
        ariaLabel="USA market filters"
        className="products-toolbar usa-hierarchy-toolbar"
        collapsed={filtersCollapsed}
        contentId="usa-market-filter-content"
        onCollapsedChange={setFiltersCollapsed}
        summary={`${selectedSegment?.label ?? selection.segment} / ${selectedGeographies.map((item) => item.label).join(" + ")} / ${selectedProduct?.label ?? series.title} / ${selectedMeasure?.label ?? series.title}`}
      >
        <div className="products-toolbar-heading">
          <div>
            <p className="section-kicker">USA market view</p>
            <h2 id="usa-market-view-title">Start broad, then move from the finest official detail upward</h2>
            <p>{series.description ?? "Official EIA petroleum-market observations."}</p>
          </div>
          <div className="toolbar-freshness">
            <FreshnessBadge status={series.freshness.status} />
            <small>Manifest built {formatDateTime(manifest.generated_at)}</small>
          </div>
        </div>

        <div className="usa-segment-control" role="group" aria-label="Energy segment">
          {selection.segments.map((segment) => (
            <button
              key={segment.id}
              type="button"
              className="usa-segment-option"
              aria-pressed={segment.id === selection.segment}
              onClick={() => chooseSegment(segment.id)}
            >
              <strong>{segment.label}</strong>
              <span>{segment.description}</span>
            </button>
          ))}
        </div>

        <div className="products-filter-grid usa-hierarchy-filter-grid">
          <label className="series-field">
            <span>Geography level</span>
            <select
              value={selection.geographyLevelId}
              onChange={(event) => chooseGeographyLevel(event.target.value)}
            >
              {selection.geographyLevels.map((level, index) => (
                <option key={level.id} value={level.id}>
                  {level.label}{index === 0 ? " (finest)" : ""}
                </option>
              ))}
            </select>
            <small>Only official, asset-backed levels are offered.</small>
          </label>

          <RegionSelectionControl
            idPrefix="usa-market"
            label={selection.geography?.level_label ?? "Official region"}
            mode={regionMode}
            selectedIds={selection.geographyIds}
            onModeChange={chooseRegionMode}
            onSelectionChange={chooseGeographies}
            combinedDisabledReason={aggregationPolicy
              ? undefined
              : "This exact series and geography level is not registered as an additive quantity."}
            options={selection.geographies.map((candidate) => {
              const alreadySelected = selection.geographyIds.includes(candidate.geography_id);
              // A region that contains, or is contained by, an already-selected
              // region cannot be added: summing both would double-count the
              // shared territory (for example Alaska and Alaska South).
              const overlaps = alreadySelected
                ? undefined
                : overlappingSelection("usa", selection.geographyIds, candidate.geography_id);
              const overlapLabel = overlaps
                ? selection.geographies.find((item) => item.geography_id === overlaps)?.label ?? overlaps
                : undefined;
              const incompatible = !alreadySelected
                && !overlaps
                && !usaHasCompatibleCombination(
                  manifest.series,
                  selection.segment,
                  selection.geographyLevelId,
                  [...selection.geographyIds, candidate.geography_id],
                );
              return {
                id: candidate.geography_id,
                label: candidate.label,
                disabled: regionMode === "combined" && (Boolean(overlaps) || incompatible),
                disabledReason: overlapLabel
                  ? `${candidate.label} overlaps ${overlapLabel}; adding both would double-count the same production.`
                  : "No active series can combine this region with the current selection.",
              };
            })}
          />

          <label className="series-field">
            <span>Product family</span>
            <select value={selection.familyId} onChange={(event) => chooseFamily(event.target.value)}>
              {selection.families.map((family) => (
                <option key={family.id} value={family.id}>{family.label}</option>
              ))}
            </select>
          </label>

          <label className="series-field">
            <span>Product or activity</span>
            <select value={selection.productId} onChange={(event) => chooseProduct(event.target.value)}>
              {selection.products.map((product) => (
                <option key={product.id} value={product.id}>
                  {product.label} — {componentRoleLabel(product.componentRole)}
                </option>
              ))}
            </select>
            <small>Specific components appear before broader parent totals.</small>
          </label>

          {selection.measures.length > 1 ? (
            <label className="series-field">
              <span>Market measure</span>
              <select value={selection.measureId} onChange={(event) => chooseMeasure(event.target.value)}>
                {selection.measures.map((measure) => (
                  <option key={measure.id} value={measure.id}>{measure.label}</option>
                ))}
              </select>
              <small>Only measures published for this region and product are offered.</small>
            </label>
          ) : (
            <div className="series-field usa-fixed-selection" aria-label="Market measure">
              <span>Market measure</span>
              <strong>{selectedMeasure?.label ?? series.title}</strong>
              <small>This is the only published measure for the current selection.</small>
            </div>
          )}
          {displayUnit ? (
            <DisplayUnitControl
              sourceUnit={asset?.unit ?? series.unit}
              value={displayUnit}
              onChange={setRequestedDisplayUnit}
            />
          ) : null}
        </div>

        <div className="products-selection-context usa-selection-context">
          <span className="component-role-badge">
            {componentRoleLabel(selectedProduct?.componentRole ?? "source-defined-product")}
          </span>
          {series.classification?.dashboard_group === "refined_products" ? (
            <p><strong>Overlap warning:</strong> {productOverlapMessage(series, classifiedRefinedSeries)}</p>
          ) : (
            <p>
              <strong>{selectedSegment?.label} boundary:</strong> {selectedSegment?.description}
              {" "}The selected source geography is not allocated to unsupported local areas.
            </p>
          )}
          <ReferenceLinks series={series} />
        </div>

        {series.unsupported_levels.length ? (
          <details className="geography-boundary usa-geography-boundary">
            <summary>Why finer levels are not offered for this exact series</summary>
            <ul>
              {series.unsupported_levels.map((level) => (
                <li key={level.level_id}><strong>{level.label}:</strong> {level.reason}</li>
              ))}
            </ul>
          </details>
        ) : null}
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
          title="This USA chart asset is unavailable"
          message={assetState.error}
          onRetry={retryAsset}
        />
      ) : null}
      {combined && customViewState.status === "error" ? (
        <DashboardError
          title="These USA regions cannot be combined"
          message={customViewState.error}
          onRetry={retryAsset}
        />
      ) : null}
      {asset && displayGeography ? (
        <div className={assetState.status === "loading" ? "dashboard-refreshing" : ""}>
          {assetState.status === "loading" ? (
            <p className="refreshing-label" role="status">Checking for a newer asset…</p>
          ) : null}
          <LatestValueGrid asset={asset} series={series} displayUnit={displayUnit ?? undefined} />
          <SeasonalChart
            asset={asset}
            series={series}
            geographyId={geography.geography_id}
            onGeographyChange={chooseGeography}
            geographyIds={aggregationPolicy ? selection.geographyIds : undefined}
            regionMode={aggregationPolicy ? regionMode : undefined}
            onGeographiesChange={aggregationPolicy ? chooseGeographies : undefined}
            onRegionModeChange={aggregationPolicy ? chooseRegionMode : undefined}
            displayUnit={displayUnit ?? undefined}
            forecast={forecast}
            forecastNotice={forecastNotice}
          />
          {!combined && geography.geography_id === "us" ? (
            <BalanceWaterfall
              manifest={manifest}
              familyId={series.classification?.product_family_id}
              displayUnit={displayUnit ?? undefined}
            />
          ) : null}
          <DistributionPanel
            asset={asset}
            series={series}
            geographyId={geography.geography_id}
            onGeographyChange={chooseGeography}
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

export function UsaPage({ initialSegment = "crude" }: UsaPageProps) {
  const { state, retry } = useUsaManifest();
  const manifest = "data" in state ? state.data : undefined;

  return (
    <main id="main-content" className="page-shell usa-dashboard-shell products-dashboard-shell">
      <section className="usa-dashboard-hero" aria-labelledby="usa-dashboard-title">
        <div>
          <p className="eyebrow">United States petroleum intelligence</p>
          <h1 id="usa-dashboard-title">Crude or refined, from local detail to the national view.</h1>
          <p className="hero-summary">
            Choose the market segment first. Every next choice is limited to products, measures,
            and geographies the EIA actually publishes for that selection.
          </p>
        </div>
        <div className="hero-principles" aria-label="Dashboard principles">
          <span>Crude + refined</span>
          <span>Finest geography first</span>
          <span>Components before totals</span>
          <span>Source-defined availability</span>
        </div>
      </section>

      {state.status === "loading" && !state.data ? <DashboardLoading /> : null}
      {state.status === "error" ? (
        <DashboardError
          title="USA data manifest could not be opened"
          message={state.error}
          onRetry={retry}
        />
      ) : null}
      {state.status === "stale" ? <LastKnownGoodNotice error={state.error} /> : null}
      {manifest ? <UsaDashboard manifest={manifest} initialSegment={initialSegment} /> : null}
    </main>
  );
}

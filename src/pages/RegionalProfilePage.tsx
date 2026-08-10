import { useEffect, useMemo, useState } from "react";
import { ChartDetailsToggle } from "../components/dashboard/ChartDetailsToggle";
import { CollapsibleToolbar } from "../components/dashboard/CollapsibleToolbar";
import { CountrySectionNav } from "../components/dashboard/CountrySectionNav";
import {
  ProfileMetricCard,
  type ProfileFrequencyMode,
} from "../components/dashboard/ProfileMetricCard";
import { ProfileMovementCard } from "../components/dashboard/ProfileMovementCard";
import {
  DashboardError,
  DashboardLoading,
  LastKnownGoodNotice,
} from "../components/dashboard/DashboardStates";
import {
  regionalProfileGeographies,
  regionalProfileMeasuresForFrequency,
  resolveRegionalProfile,
  type RegionalProfileGeography,
  type RegionalProfileProduct,
  type RegionalProfileSeriesAvailability,
} from "../data/regionalProfile";
import { usaSeriesDescriptor, type UsaEnergySegment } from "../data/usaDashboard";
import { useCanadaManifest } from "../hooks/useCanadaAssets";
import { useUsaManifest } from "../hooks/useUsaAssets";
import { formatDateTime } from "../lib/formatters";
import type { CountryCode } from "../types/catalog";
import type {
  RemoteState,
  UsaAssetManifest,
  UsaManifestSeries,
} from "../types/energyAssets";

interface RegionalProfilePageProps {
  country: CountryCode;
}

interface GeographyLevel {
  id: string;
  label: string;
  rank: number;
  geographies: RegionalProfileGeography[];
}

function seriesSegment(country: CountryCode, series: UsaManifestSeries): UsaEnergySegment {
  if (country === "usa") return usaSeriesDescriptor(series)?.segment ?? "refined";
  return series.classification?.dashboard_group === "canada_refined_products"
    ? "refined"
    : "crude";
}

function geographySupportsSegment(
  country: CountryCode,
  manifest: UsaAssetManifest,
  geographyId: string,
  segment: UsaEnergySegment,
): boolean {
  return manifest.series.some((series) => (
    seriesSegment(country, series) === segment
    && series.geographies.some((geography) => (
      geography.geography_id === geographyId
      && !geography.level_id.endsWith("_route")
      && geography.status === "available"
      && geography.asset_path
    ))
  ));
}

function geographyLevels(
  country: CountryCode,
  manifest: UsaAssetManifest,
  segment: UsaEnergySegment,
): GeographyLevel[] {
  const supported = regionalProfileGeographies(manifest).filter((geography) => (
    geographySupportsSegment(country, manifest, geography.geographyId, segment)
  ));
  const byLevel = new Map<string, GeographyLevel>();
  for (const geography of supported) {
    const level = byLevel.get(geography.levelId) ?? {
      id: geography.levelId,
      label: geography.levelLabel,
      rank: geography.granularityRank,
      geographies: [],
    };
    level.rank = Math.min(level.rank, geography.granularityRank);
    level.geographies.push(geography);
    byLevel.set(level.id, level);
  }
  return [...byLevel.values()]
    .map((level) => ({
      ...level,
      geographies: level.geographies.sort((left, right) => left.label.localeCompare(right.label)),
    }))
    .sort((left, right) => left.rank - right.rank || left.label.localeCompare(right.label));
}

function defaultLevelId(country: CountryCode, levels: readonly GeographyLevel[]): string {
  const preferred = country === "usa" ? "padd" : "province_territory";
  return levels.some((level) => level.id === preferred) ? preferred : levels[0]?.id ?? "";
}

function productSegment(
  country: CountryCode,
  manifest: UsaAssetManifest,
  product: RegionalProfileProduct,
): UsaEnergySegment {
  const candidate = manifest.series.find((series) => {
    if (country === "usa") {
      const descriptor = usaSeriesDescriptor(series);
      return descriptor?.familyId === product.familyId && descriptor.productId === product.productId;
    }
    return series.classification?.product_family_id === product.familyId
      && series.classification.product_id === product.productId;
  });
  return candidate ? seriesSegment(country, candidate) : "refined";
}

function selectableProducts(
  country: CountryCode,
  manifest: UsaAssetManifest,
  products: readonly RegionalProfileProduct[],
  segment: UsaEnergySegment,
): RegionalProfileProduct[] {
  return products.filter((product) => (
    productSegment(country, manifest, product) === segment
    && product.familyId !== "crude-movements"
    && product.familyId !== "petroleum-movements"
  ));
}

const USA_RELATED_PRODUCT_CONTEXT: Readonly<Record<string, readonly string[]>> = {
  "crude-oil": ["commercial-crude-oil"],
  "commercial-crude-oil": ["crude-oil"],
  "finished-motor-gasoline": ["total-motor-gasoline"],
  "total-motor-gasoline": ["finished-motor-gasoline"],
  "propane-propylene": ["propane"],
  propane: ["propane-propylene"],
  "total-petroleum-products": [
    "total-crude-oil-and-petroleum-products",
    "total-crude-oil-and-petroleum-products-excluding-spr",
    "total-crude-oil-and-petroleum-products-including-spr",
  ],
  "total-crude-oil-and-petroleum-products": ["total-petroleum-products"],
};

const CANADA_RELATED_PRODUCT_CONTEXT: Readonly<Record<string, readonly string[]>> = {
  "crude-oil": ["crude-oil-and-equivalents"],
  "crude-oil-and-equivalents": ["crude-oil"],
  propane: ["hgl-rpp-transporter-inventory"],
  "residual-fuel-oil": ["hgl-rpp-transporter-inventory"],
  "finished-motor-gasoline": ["hgl-rpp-transporter-inventory"],
  "distillate-fuel-oil": ["hgl-rpp-transporter-inventory"],
  "kerosene-type-jet-fuel": ["hgl-rpp-transporter-inventory"],
};

function relatedProductMeasures(
  country: CountryCode,
  manifest: UsaAssetManifest,
  geographyId: string | undefined,
  product: RegionalProfileProduct | undefined,
): RegionalProfileSeriesAvailability[] {
  if (!geographyId || !product) return [];
  const relatedIds = (
    country === "usa" ? USA_RELATED_PRODUCT_CONTEXT : CANADA_RELATED_PRODUCT_CONTEXT
  )[product.productId] ?? [];
  const seen = new Set<string>();
  return relatedIds.flatMap((relatedId) => {
    const relatedProfile = resolveRegionalProfile(country, manifest, {
      geographyId,
      productId: relatedId,
    });
    if (relatedProfile.product?.productId !== relatedId) return [];
    return relatedProfile.productMeasures.filter((measure) => {
      if (seen.has(measure.series.view_id)) return false;
      seen.add(measure.series.view_id);
      return true;
    });
  });
}

function UnavailableMeasureCard({ measure }: { measure: RegionalProfileSeriesAvailability }) {
  return (
    <article className="profile-boundary-card">
      <p className="section-kicker">Not published at this region</p>
      <h3>{measure.measureLabel}</h3>
      <p>{measure.reason}</p>
      <small>{measure.productLabel} · {measure.series.source.name}</small>
    </article>
  );
}

function ProfileDashboard({
  country,
  manifest,
}: {
  country: CountryCode;
  manifest: UsaAssetManifest;
}) {
  const [segment, setSegment] = useState<UsaEnergySegment>("crude");
  const levels = useMemo(
    () => geographyLevels(country, manifest, segment),
    [country, manifest, segment],
  );
  const [levelId, setLevelId] = useState(() => defaultLevelId(country, levels));
  const activeLevel = levels.find((level) => level.id === levelId) ?? levels[0];
  const [geographyId, setGeographyId] = useState("");
  const geography = activeLevel?.geographies.find(
    (candidate) => candidate.geographyId === geographyId,
  ) ?? activeLevel?.geographies[0];
  const baseProfile = useMemo(
    () => resolveRegionalProfile(country, manifest, { geographyId: geography?.geographyId }),
    [country, geography?.geographyId, manifest],
  );
  const products = useMemo(
    () => selectableProducts(country, manifest, baseProfile.products, segment),
    [baseProfile.products, country, manifest, segment],
  );
  const [productId, setProductId] = useState("");
  const product = products.find(
    (candidate) => candidate.selectionId === productId || candidate.productId === productId,
  ) ?? products[0];
  const profile = useMemo(
    () => resolveRegionalProfile(country, manifest, {
      geographyId: geography?.geographyId,
      productId: product?.selectionId,
    }),
    [country, geography?.geographyId, manifest, product?.selectionId],
  );
  const [frequency, setFrequency] = useState<ProfileFrequencyMode>("monthly");
  const [controlsCollapsed, setControlsCollapsed] = useState(true);

  useEffect(() => {
    const nextLevel = levels.find((level) => level.id === levelId) ?? levels[0];
    if (!nextLevel) return;
    if (nextLevel.id !== levelId) setLevelId(nextLevel.id);
    if (!nextLevel.geographies.some((candidate) => candidate.geographyId === geographyId)) {
      setGeographyId(nextLevel.geographies[0]?.geographyId ?? "");
    }
  }, [geographyId, levelId, levels]);

  useEffect(() => {
    if (!products.some((candidate) => candidate.selectionId === productId)) {
      setProductId(products[0]?.selectionId ?? "");
    }
  }, [productId, products]);

  const frequencyProductMeasures = regionalProfileMeasuresForFrequency(
    profile.productMeasures,
    frequency,
  );
  const availableProductMeasures = frequencyProductMeasures.filter(
    (measure) => measure.availability === "available",
  );
  const unavailableProductMeasures = frequencyProductMeasures.filter(
    (measure) => measure.availability === "unavailable",
  );
  const frequencyRefineryContext = regionalProfileMeasuresForFrequency(
    profile.refineryContext,
    frequency,
  );
  const availableRefineryContext = frequencyRefineryContext.filter(
    (measure) => measure.availability === "available",
  );
  const unavailableRefineryContext = frequencyRefineryContext.filter(
    (measure) => measure.availability === "unavailable",
  );
  const relatedMeasures = useMemo(
    () => relatedProductMeasures(
      country,
      manifest,
      geography?.geographyId,
      profile.product,
    ),
    [country, geography?.geographyId, manifest, profile.product],
  );
  const availableRelatedMeasures = regionalProfileMeasuresForFrequency(
    relatedMeasures,
    frequency,
  ).filter((measure) => measure.availability === "available");
  const weeklyAvailable = [...profile.productMeasures, ...profile.refineryContext, ...relatedMeasures].some(
    (measure) => measure.availability === "available" && measure.series.frequency.toLowerCase().startsWith("week"),
  );

  useEffect(() => {
    if (frequency === "weekly" && !weeklyAvailable) setFrequency("monthly");
  }, [frequency, weeklyAvailable]);
  const selectedRegion = geography && profile.geography
    ? manifest.series.flatMap((series) => series.geographies).find((candidate) => (
        candidate.geography_id === geography.geographyId
        && candidate.level_id === geography.levelId
        && candidate.status === "available"
        && candidate.asset_path
      ))
    : undefined;
  const countryLabel = country === "usa" ? "USA" : "Canada";

  return (
    <>
      <CountrySectionNav country={country} activeView="profile" />

      <section className="profile-intro profile-intro-graph-first">
        <div>
          <p className="section-kicker">{countryLabel} regional profile</p>
          <h1>{profile.product?.label ?? "Regional market profile"} · {geography?.label ?? countryLabel}</h1>
        </div>
        <ChartDetailsToggle summary="About this workspace">
          <div className="profile-intro-details">
            <p>
              Compare source-published production, trade, inventories, demand, refinery activity,
              and logistics without substituting a national value for a missing regional series.
            </p>
            <div className="profile-vintage">
              <span>Validated asset generation</span>
              <strong>{formatDateTime(manifest.generated_at)}</strong>
            </div>
          </div>
        </ChartDetailsToggle>
      </section>

      <CollapsibleToolbar
        ariaLabel="Regional profile filters"
        className="profile-filter-toolbar"
        collapsed={controlsCollapsed}
        contentId={`${country}-profile-filter-content`}
        onCollapsedChange={setControlsCollapsed}
        summary={`${segment === "crude" ? "Crude" : "Refined"} / ${geography?.label ?? "Region"} / ${profile.product?.label ?? "Product"} / ${frequency}`}
      >
      <section className="profile-toolbar" aria-label="Regional profile controls">
        <fieldset className="profile-segment-control">
          <legend>Market segment</legend>
          <div>
            {(["crude", "refined"] as const).map((candidate) => (
              <button
                key={candidate}
                type="button"
                aria-pressed={segment === candidate}
                onClick={() => {
                  setSegment(candidate);
                  const nextLevels = geographyLevels(country, manifest, candidate);
                  setLevelId(defaultLevelId(country, nextLevels));
                  setGeographyId("");
                  setProductId("");
                }}
              >
                {candidate === "crude" ? "Crude" : "Refined"}
              </button>
            ))}
          </div>
        </fieldset>
        <label>
          <span>Geography level</span>
          <select value={activeLevel?.id ?? ""} onChange={(event) => {
            setLevelId(event.target.value);
            setGeographyId("");
            setProductId("");
          }}>
            {levels.map((level) => (
              <option key={level.id} value={level.id}>{level.label}</option>
            ))}
          </select>
        </label>
        <label>
          <span>Official region</span>
          <select value={geography?.geographyId ?? ""} onChange={(event) => {
            setGeographyId(event.target.value);
            setProductId("");
          }}>
            {activeLevel?.geographies.map((candidate) => (
              <option key={candidate.geographyId} value={candidate.geographyId}>
                {candidate.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>Product</span>
          <select
            value={product?.selectionId ?? ""}
            disabled={!products.length}
            onChange={(event) => setProductId(event.target.value)}
          >
            {products.map((candidate) => (
              <option key={candidate.selectionId} value={candidate.selectionId}>
                {candidate.familyLabel} · {candidate.label}
              </option>
            ))}
          </select>
        </label>
        <fieldset className="profile-frequency-control">
          <legend>Graph frequency</legend>
          <div>
            <button
              type="button"
              aria-pressed={frequency === "weekly"}
              disabled={!weeklyAvailable}
              onClick={() => setFrequency("weekly")}
            >
              Weekly
            </button>
            <button
              type="button"
              aria-pressed={frequency === "monthly"}
              onClick={() => setFrequency("monthly")}
            >
              Monthly
            </button>
          </div>
        </fieldset>
      </section>

      <div className="profile-frequency-note" role="note">
        {frequency === "monthly"
          ? "Native monthly series stay unchanged. Weekly rates use complete calendar-day-weighted months; stocks, days supply, and utilization use the final weekly reading in each completed month. Derived views are labelled and are not official monthly series."
          : "Weekly mode shows only source-weekly measures. Source-monthly balances and movements are never interpolated into weeks."}
      </div>
      </CollapsibleToolbar>

      {!profile.product && !availableRefineryContext.length ? (
        <section className="profile-empty-state">
          <h2>No product profile at this exact geography</h2>
          <p>
            The source publishes no compatible product balance here. Select a broader geography,
            or use the refinery context below where an exact source region exists.
          </p>
        </section>
      ) : null}

      {profile.product ? (
        <section className="profile-section" aria-labelledby="profile-balance-title">
          <div className="profile-section-heading">
            <div>
              <p className="section-kicker">Product balance</p>
              <h2 id="profile-balance-title">{profile.product.label} · {geography?.label}</h2>
            </div>
          </div>
          {availableProductMeasures.length ? (
            <div className="profile-chart-grid">
              {availableProductMeasures.map((measure) => (
                <ProfileMetricCard
                  key={`${measure.series.view_id}:${measure.geography!.asset_path}`}
                  country={country}
                  series={measure.series}
                  geography={measure.geography!}
                  frequencyMode={frequency}
                />
              ))}
            </div>
          ) : (
            <p className="profile-empty-copy">No compatible {frequency} product measures are published for this selection.</p>
          )}
        </section>
      ) : null}

      {availableRefineryContext.length || unavailableRefineryContext.length ? (
        <section className="profile-section" aria-labelledby="profile-refinery-title">
          <div className="profile-section-heading">
            <div>
              <p className="section-kicker">Regional system context</p>
              <h2 id="profile-refinery-title">Refinery activity at the same official geography</h2>
            </div>
          </div>
          <div className="profile-chart-grid">
            {availableRefineryContext.map((measure) => (
              <ProfileMetricCard
                key={`${measure.series.view_id}:${measure.geography!.asset_path}`}
                country={country}
                series={measure.series}
                geography={measure.geography!}
                frequencyMode={frequency}
                contextLabel="Refinery context"
              />
            ))}
          </div>
          {unavailableRefineryContext.length ? (
            <ChartDetailsToggle summary={`${unavailableRefineryContext.length} unavailable refinery measures`}>
              <div className="profile-chart-grid">
                {unavailableRefineryContext.map((measure) => (
                  <UnavailableMeasureCard key={measure.series.view_id} measure={measure} />
                ))}
              </div>
            </ChartDetailsToggle>
          ) : null}
        </section>
      ) : null}

      {availableRelatedMeasures.length ? (
        <section className="profile-section" aria-labelledby="profile-related-title">
          <div className="profile-section-heading">
            <div>
              <p className="section-kicker">Related source boundary</p>
              <h2 id="profile-related-title">Compatible broader or adjacent product context</h2>
            </div>
          </div>
          <ChartDetailsToggle summary="Why these charts are separate">
            <p className="profile-section-disclosure">
              These charts are kept separate because their published product boundary differs from
              {` ${profile.product?.label}`}; they are not added to or reconciled with the selected product.
            </p>
          </ChartDetailsToggle>
          <div className="profile-chart-grid">
            {availableRelatedMeasures.map((measure) => (
              <ProfileMetricCard
                key={`${measure.series.view_id}:${measure.geography!.asset_path}`}
                country={country}
                series={measure.series}
                geography={measure.geography!}
                frequencyMode={frequency}
                contextLabel="Related product context"
              />
            ))}
          </div>
        </section>
      ) : null}

      {selectedRegion ? (
        <section className="profile-section" aria-labelledby="profile-logistics-title">
          <div className="profile-section-heading">
            <div>
              <p className="section-kicker">Logistics context</p>
              <h2 id="profile-logistics-title">Published receipts and transfers touching {geography?.label}</h2>
            </div>
          </div>
          <div className="profile-chart-grid">
            <ProfileMovementCard
              country={country}
              manifest={manifest}
              region={selectedRegion}
              segment={segment}
              frequencyMode={frequency}
            />
          </div>
        </section>
      ) : null}

      {unavailableProductMeasures.length ? (
        <section className="profile-section profile-boundaries" aria-labelledby="profile-boundaries-title">
          <div className="profile-section-heading">
            <div>
              <p className="section-kicker">Source boundary</p>
              <h2 id="profile-boundaries-title">Measures that cannot be shown at this region</h2>
            </div>
          </div>
          <ChartDetailsToggle summary={`${unavailableProductMeasures.length} unavailable measures`}>
            <div className="profile-chart-grid">
              {unavailableProductMeasures.map((measure) => (
                <UnavailableMeasureCard key={measure.series.view_id} measure={measure} />
              ))}
            </div>
          </ChartDetailsToggle>
        </section>
      ) : null}
    </>
  );
}

function RegionalProfileManifestView({
  country,
  state,
  retry,
}: RegionalProfilePageProps & {
  state: RemoteState<UsaAssetManifest>;
  retry: () => void;
}) {
  return (
    <main id="main-content" className="page-shell usa-dashboard-shell regional-profile-shell">
      {state.status === "loading" && !state.data ? (
        <DashboardLoading label={`Loading ${country === "usa" ? "USA" : "Canada"} regional profile`} />
      ) : null}
      {state.status === "error" ? (
        <DashboardError
          title="The regional profile could not be loaded"
          message={state.error}
          onRetry={retry}
        />
      ) : null}
      {state.status === "stale" ? <LastKnownGoodNotice error={state.error} /> : null}
      {"data" in state && state.data
        ? <ProfileDashboard country={country} manifest={state.data} />
        : null}
    </main>
  );
}

function UsaRegionalProfilePage() {
  const { state, retry } = useUsaManifest();
  return <RegionalProfileManifestView country="usa" state={state} retry={retry} />;
}

function CanadaRegionalProfilePage() {
  const { state, retry } = useCanadaManifest();
  return <RegionalProfileManifestView country="canada" state={state} retry={retry} />;
}

export function RegionalProfilePage({ country }: RegionalProfilePageProps) {
  return country === "usa" ? <UsaRegionalProfilePage /> : <CanadaRegionalProfilePage />;
}

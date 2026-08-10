import type {
  GeographyOrigin,
  ManifestGeography,
  UsaAssetManifest,
  UsaManifestSeries,
} from "../types/energyAssets";
import {
  usaSeriesDescriptor,
  type UsaSeriesDescriptor,
} from "./usaDashboard";

export type RegionalProfileCountry = "usa" | "canada";
export type RegionalProfileAvailability = "available" | "unavailable";

export interface RegionalProfileRequest {
  geographyId?: string;
  /** Product IDs are source/registry identities, not display labels. */
  productId?: string;
}

export interface RegionalProfileGeography {
  geographyId: string;
  label: string;
  levelId: string;
  levelLabel: string;
  granularityRank: number;
  origins: GeographyOrigin[];
  sourceNames: string[];
}

export interface RegionalProfileProduct {
  /** Family-qualified ID keeps future same-named products unambiguous. */
  selectionId: string;
  productId: string;
  label: string;
  familyId: string;
  familyLabel: string;
  componentRole: string;
  parentProductId: string | null;
  displayOrder: number;
  hierarchyHeight: number;
  availableFrequencies: string[];
  availableMeasureCount: number;
}

export interface RegionalProfileSeriesAvailability {
  series: UsaManifestSeries;
  productId: string;
  productLabel: string;
  measureId: string;
  measureLabel: string;
  frequency: string;
  availability: RegionalProfileAvailability;
  geography?: ManifestGeography;
  /** Present whenever availability is unavailable. */
  reason?: string;
}

export type RegionalProfileFrequencyMode = "weekly" | "monthly";

export interface RegionalProfileModel {
  country: RegionalProfileCountry;
  geographies: RegionalProfileGeography[];
  geography?: RegionalProfileGeography;
  products: RegionalProfileProduct[];
  product?: RegionalProfileProduct;
  /** Exact registered measures for the selected product, including unavailable cards. */
  productMeasures: RegionalProfileSeriesAvailability[];
  /** General refinery activity is context, never silently part of a product balance. */
  refineryContext: RegionalProfileSeriesAvailability[];
  nativeFrequencies: string[];
  messages: string[];
}

/**
 * Resolve the profile's display-frequency contract without presenting a
 * browser-derived weekly summary beside an equivalent official monthly
 * observation. A source-monthly asset wins only for the same exact registered
 * measure at the selected geography; otherwise the authorized weekly-derived
 * monthly view remains available.
 */
export function regionalProfileMeasuresForFrequency(
  measures: readonly RegionalProfileSeriesAvailability[],
  frequency: RegionalProfileFrequencyMode,
): RegionalProfileSeriesAvailability[] {
  if (frequency === "weekly") {
    return measures.filter((measure) => (
      measure.series.frequency.toLowerCase().startsWith("week")
    ));
  }

  const nativeMonthlyMeasures = new Set(
    measures
      .filter((measure) => (
        measure.availability === "available"
        && measure.series.frequency.toLowerCase().startsWith("month")
      ))
      .map((measure) => measure.measureId),
  );
  return measures.filter((measure) => {
    const sourceFrequency = measure.series.frequency.toLowerCase();
    if (sourceFrequency.startsWith("month")) return true;
    if (!sourceFrequency.startsWith("week")) return false;
    return !nativeMonthlyMeasures.has(measure.measureId);
  });
}

interface ProfileDescriptor {
  familyId: string;
  familyLabel: string;
  productId: string;
  productLabel: string;
  measureId: string;
  measureLabel: string;
  componentRole: string;
  parentProductId: string | null;
  displayOrder: number;
  refineryContext: boolean;
}

const LEVEL_RANK: Record<string, number> = {
  city: 10,
  county: 20,
  census_metropolitan_area: 20,
  state_or_area: 30,
  province_territory: 30,
  padd_subdistrict: 40,
  source_region: 40,
  padd: 50,
  national: 100,
};

function isRouteGeography(geography: ManifestGeography): boolean {
  return geography.level_id.endsWith("_route")
    || geography.geography_id.includes(".route.");
}

function isAvailableGeography(geography: ManifestGeography): boolean {
  return geography.status === "available"
    && Boolean(geography.asset_path)
    && !isRouteGeography(geography);
}

function fromUsaDescriptor(descriptor: UsaSeriesDescriptor): ProfileDescriptor {
  return {
    familyId: descriptor.familyId,
    familyLabel: descriptor.familyLabel,
    productId: descriptor.productId,
    productLabel: descriptor.productLabel,
    measureId: descriptor.measureId,
    measureLabel: descriptor.measureLabel,
    componentRole: descriptor.componentRole,
    parentProductId: descriptor.parentProductId,
    displayOrder: descriptor.displayOrder,
    refineryContext: descriptor.familyId === "refinery-activity",
  };
}

function descriptorForSeries(
  country: RegionalProfileCountry,
  series: UsaManifestSeries,
): ProfileDescriptor | undefined {
  if (country === "usa") {
    const descriptor = usaSeriesDescriptor(series);
    return descriptor ? fromUsaDescriptor(descriptor) : undefined;
  }

  const classification = series.classification;
  if (!classification) return undefined;
  return {
    familyId: classification.product_family_id,
    familyLabel: classification.product_family_label,
    productId: classification.product_id,
    productLabel: classification.product_label,
    measureId: classification.measure_id,
    measureLabel: classification.measure_label,
    componentRole: classification.component_role,
    parentProductId: classification.parent_product_id,
    displayOrder: classification.display_order,
    // CER's broad refinery runs/utilization belong beside a product profile.
    // Grade-specific Statistics Canada refinery inputs retain their exact
    // crude-product identity and therefore remain product measures.
    refineryContext: classification.product_family_id === "refining",
  };
}

function productSelectionId(familyId: string, productId: string): string {
  return `${familyId}:${productId}`;
}

export function regionalProfileGeographies(
  manifest: UsaAssetManifest,
): RegionalProfileGeography[] {
  const byId = new Map<string, RegionalProfileGeography>();

  for (const series of manifest.series) {
    for (const geography of series.geographies) {
      if (!isAvailableGeography(geography)) continue;
      const existing = byId.get(geography.geography_id);
      const originSet = new Set(existing?.origins ?? []);
      originSet.add(geography.origin);
      const sourceSet = new Set(existing?.sourceNames ?? []);
      sourceSet.add(series.source.name);
      byId.set(geography.geography_id, {
        geographyId: geography.geography_id,
        label: geography.label,
        levelId: geography.level_id,
        levelLabel: geography.level_label,
        granularityRank: Math.min(
          existing?.granularityRank ?? Number.MAX_SAFE_INTEGER,
          geography.granularity_rank ?? LEVEL_RANK[geography.level_id] ?? 1_000,
        ),
        origins: [...originSet].sort(),
        sourceNames: [...sourceSet].sort(),
      });
    }
  }

  return [...byId.values()].sort((left, right) => (
    left.granularityRank - right.granularityRank
    || left.label.localeCompare(right.label)
    || left.geographyId.localeCompare(right.geographyId)
  ));
}

function exactGeography(
  series: UsaManifestSeries,
  geographyId: string,
): ManifestGeography | undefined {
  return series.geographies.find((candidate) => (
    candidate.geography_id === geographyId && !isRouteGeography(candidate)
  ));
}

function unavailableReason(
  series: UsaManifestSeries,
  geography: RegionalProfileGeography,
  exact: ManifestGeography | undefined,
  measureLabel: string,
): string {
  if (exact?.reason) return exact.reason;
  if (exact?.status === "available" && !exact.asset_path) {
    return `The ${series.source.name} manifest has no validated chart asset for ${measureLabel} at ${geography.label}.`;
  }
  const levelReason = series.unsupported_levels.find(
    (candidate) => candidate.level_id === geography.levelId,
  )?.reason;
  if (levelReason) return levelReason;
  return `${series.source.name} does not publish the registered ${measureLabel} series for ${geography.label}; no value is inferred.`;
}

function availabilityForSeries(
  country: RegionalProfileCountry,
  series: UsaManifestSeries,
  geography: RegionalProfileGeography,
): RegionalProfileSeriesAvailability | undefined {
  const descriptor = descriptorForSeries(country, series);
  if (!descriptor) return undefined;
  const exact = exactGeography(series, geography.geographyId);
  const available = Boolean(
    exact?.status === "available" && exact.asset_path,
  );
  return {
    series,
    productId: descriptor.productId,
    productLabel: descriptor.productLabel,
    measureId: descriptor.measureId,
    measureLabel: descriptor.measureLabel,
    frequency: series.frequency,
    availability: available ? "available" : "unavailable",
    geography: available ? exact : undefined,
    reason: available
      ? undefined
      : unavailableReason(series, geography, exact, descriptor.measureLabel),
  };
}

interface ProductAccumulator {
  familyId: string;
  familyLabel: string;
  productId: string;
  label: string;
  componentRole: string;
  parentProductId: string | null;
  displayOrder: number;
  availableFrequencies: Set<string>;
  availableMeasureCount: number;
}

function productOptions(
  country: RegionalProfileCountry,
  manifest: UsaAssetManifest,
  geography: RegionalProfileGeography,
): RegionalProfileProduct[] {
  const bySelectionId = new Map<string, ProductAccumulator>();

  for (const series of manifest.series) {
    const descriptor = descriptorForSeries(country, series);
    if (!descriptor || descriptor.refineryContext) continue;
    const exact = exactGeography(series, geography.geographyId);
    if (exact?.status !== "available" || !exact.asset_path) continue;
    const selectionId = productSelectionId(descriptor.familyId, descriptor.productId);
    const product = bySelectionId.get(selectionId) ?? {
      familyId: descriptor.familyId,
      familyLabel: descriptor.familyLabel,
      productId: descriptor.productId,
      label: descriptor.productLabel,
      componentRole: descriptor.componentRole,
      parentProductId: descriptor.parentProductId,
      displayOrder: descriptor.displayOrder,
      availableFrequencies: new Set<string>(),
      availableMeasureCount: 0,
    };
    product.displayOrder = Math.min(product.displayOrder, descriptor.displayOrder);
    product.availableFrequencies.add(series.frequency);
    product.availableMeasureCount += 1;
    bySelectionId.set(selectionId, product);
  }

  const products = [...bySelectionId.entries()];
  const childrenByParent = new Map<string, Set<string>>();
  for (const [selectionId, product] of products) {
    if (!product.parentProductId) continue;
    const parentSelectionId = productSelectionId(product.familyId, product.parentProductId);
    if (!bySelectionId.has(parentSelectionId)) continue;
    const children = childrenByParent.get(parentSelectionId) ?? new Set<string>();
    children.add(selectionId);
    childrenByParent.set(parentSelectionId, children);
  }
  const heightFor = (selectionId: string, visited = new Set<string>()): number => {
    if (visited.has(selectionId)) return 0;
    const children = [...(childrenByParent.get(selectionId) ?? [])];
    if (!children.length) return 0;
    const nextVisited = new Set(visited);
    nextVisited.add(selectionId);
    return 1 + Math.max(...children.map((child) => heightFor(child, nextVisited)));
  };

  return products.map(([selectionId, product]) => ({
    selectionId,
    productId: product.productId,
    label: product.label,
    familyId: product.familyId,
    familyLabel: product.familyLabel,
    componentRole: product.componentRole,
    parentProductId: product.parentProductId,
    displayOrder: product.displayOrder,
    hierarchyHeight: heightFor(selectionId),
    availableFrequencies: [...product.availableFrequencies].sort(),
    availableMeasureCount: product.availableMeasureCount,
  })).sort((left, right) => (
    left.familyLabel.localeCompare(right.familyLabel)
    || left.hierarchyHeight - right.hierarchyHeight
    || left.displayOrder - right.displayOrder
    || left.label.localeCompare(right.label)
  ));
}

function availabilityOrder(
  country: RegionalProfileCountry,
  left: RegionalProfileSeriesAvailability,
  right: RegionalProfileSeriesAvailability,
): number {
  const leftDescriptor = descriptorForSeries(country, left.series)!;
  const rightDescriptor = descriptorForSeries(country, right.series)!;
  return leftDescriptor.displayOrder - rightDescriptor.displayOrder
    || left.frequency.localeCompare(right.frequency)
    || left.series.view_id.localeCompare(right.series.view_id);
}

export function resolveRegionalProfile(
  country: RegionalProfileCountry,
  manifest: UsaAssetManifest,
  request: RegionalProfileRequest = {},
): RegionalProfileModel {
  const geographies = regionalProfileGeographies(manifest);
  const geography = geographies.find(
    (candidate) => candidate.geographyId === request.geographyId,
  ) ?? geographies[0];

  if (!geography) {
    return {
      country,
      geographies,
      products: [],
      productMeasures: [],
      refineryContext: [],
      nativeFrequencies: [],
      messages: ["No non-route geography has a validated public chart asset."],
    };
  }

  const products = productOptions(country, manifest, geography);
  const product = products.find((candidate) => (
    candidate.selectionId === request.productId || candidate.productId === request.productId
  )) ?? products[0];

  const productMeasures = product
    ? manifest.series.flatMap((series) => {
      const descriptor = descriptorForSeries(country, series);
      if (
        !descriptor
        || descriptor.refineryContext
        || descriptor.familyId !== product.familyId
        || descriptor.productId !== product.productId
      ) return [];
      const availability = availabilityForSeries(country, series, geography);
      return availability ? [availability] : [];
    }).sort((left, right) => availabilityOrder(country, left, right))
    : [];

  const refineryContext = manifest.series.flatMap((series) => {
    const descriptor = descriptorForSeries(country, series);
    if (!descriptor?.refineryContext) return [];
    const availability = availabilityForSeries(country, series, geography);
    return availability ? [availability] : [];
  }).sort((left, right) => availabilityOrder(country, left, right));

  const nativeFrequencies = [...new Set(
    productMeasures
      .filter((measure) => measure.availability === "available")
      .map((measure) => measure.frequency),
  )].sort();
  const messages: string[] = [];
  if (!products.length) {
    messages.push(
      `No registered non-refinery product has a validated public asset for ${geography.label}.`,
    );
  }
  if (refineryContext.length && refineryContext.every(
    (measure) => measure.availability === "unavailable",
  )) {
    messages.push(
      `Registered refinery context is unavailable at the exact ${geography.levelLabel.toLowerCase()} geography; broader source regions are not allocated downward.`,
    );
  }

  return {
    country,
    geographies,
    geography,
    products,
    product,
    productMeasures,
    refineryContext,
    nativeFrequencies,
    messages,
  };
}

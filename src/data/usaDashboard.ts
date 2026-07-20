import type {
  ManifestGeography,
  UsaChartAsset,
  UsaManifestSeries,
} from "../types/energyAssets";
import { seriesAllowsCustomAggregation } from "./customAggregation";

export type UsaEnergySegment = "crude" | "refined";

export interface UsaSegmentOption {
  id: UsaEnergySegment;
  label: string;
  description: string;
}

export interface UsaGeographyLevelOption {
  id: string;
  label: string;
  granularityRank: number;
  geographies: ManifestGeography[];
}

export interface UsaDashboardProductOption {
  id: string;
  label: string;
  familyLabel: string;
  componentRole: string;
  parentProductId: string | null;
  /** Registered product-DAG descendant height; leaves are 0 and broader parents are higher. */
  hierarchyHeight: number;
  displayOrder: number;
}

export interface UsaDashboardFamilyOption {
  id: string;
  label: string;
  displayOrder: number;
}

export interface UsaDashboardMeasureOption {
  id: string;
  label: string;
  displayOrder: number;
  series: UsaManifestSeries;
}

export interface UsaDashboardSelectionRequest {
  segment?: UsaEnergySegment;
  geographyLevelId?: string;
  geographyId?: string;
  geographyIds?: string[];
  familyId?: string;
  productId?: string;
  measureId?: string;
}

export interface ResolvedUsaDashboardSelection {
  segment: UsaEnergySegment;
  segments: UsaSegmentOption[];
  geographyLevelId: string;
  geographyId: string;
  geographyIds: string[];
  geographyLevels: UsaGeographyLevelOption[];
  geographies: ManifestGeography[];
  geography?: ManifestGeography;
  familyId: string;
  families: UsaDashboardFamilyOption[];
  productId: string;
  products: UsaDashboardProductOption[];
  measureId: string;
  measures: UsaDashboardMeasureOption[];
  series?: UsaManifestSeries;
}

interface SeriesDescriptor {
  segment: UsaEnergySegment;
  familyId: string;
  familyLabel: string;
  productId: string;
  productLabel: string;
  measureId: string;
  measureLabel: string;
  componentRole: string;
  parentProductId: string | null;
  displayOrder: number;
}

export const USA_SEGMENTS: UsaSegmentOption[] = [
  {
    id: "crude",
    label: "Crude",
    description: "Crude-oil production and refinery activity.",
  },
  {
    id: "refined",
    label: "Refined",
    description: "Gasoline, distillate, jet fuel, and petroleum-product demand.",
  },
];

const CORE_SERIES: Record<string, SeriesDescriptor> = {
  "usa.eia.crude.production.monthly": {
    segment: "crude",
    familyId: "crude-oil",
    familyLabel: "Crude oil",
    productId: "crude-oil",
    productLabel: "Crude oil",
    measureId: "production",
    measureLabel: "Production",
    componentRole: "source-defined-product",
    parentProductId: null,
    displayOrder: 1,
  },
  "usa.eia.refinery.utilization.weekly": {
    segment: "crude",
    familyId: "refinery-activity",
    familyLabel: "Refinery activity",
    productId: "refinery-activity",
    productLabel: "Refinery activity",
    measureId: "utilization",
    measureLabel: "Utilization",
    componentRole: "source-defined-product",
    parentProductId: null,
    displayOrder: 2,
  },
  "usa.eia.product_supplied.weekly": {
    segment: "refined",
    familyId: "all-petroleum-products",
    familyLabel: "All petroleum products",
    productId: "total-petroleum-products",
    productLabel: "Total petroleum products",
    measureId: "product-supplied",
    measureLabel: "Product supplied (implied demand)",
    componentRole: "headline-total",
    parentProductId: null,
    displayOrder: 20_000,
  },
};

const LEVEL_SPECIFICITY: Record<string, number> = {
  city: 0,
  local: 0,
  county: 10,
  state_or_area: 20,
  padd_subdistrict: 30,
  padd: 40,
  national: 50,
};

const ROLE_SPECIFICITY: Record<string, number> = {
  component: 0,
  blendstock: 1,
  biofuel: 2,
  "finished-product": 3,
  "source-defined-product": 4,
  "headline-total": 10,
};

function seriesHasAsset(series: UsaManifestSeries): boolean {
  return series.geographies.some(
    (geography) => geography.status === "available" && Boolean(geography.asset_path),
  );
}

function descriptorForSeries(series: UsaManifestSeries): SeriesDescriptor | undefined {
  const classification = series.classification;
  if (classification?.dashboard_group === "refined_products") {
    return {
      segment: "refined",
      familyId: classification.product_family_id,
      familyLabel: classification.product_family_label,
      productId: classification.product_id,
      productLabel: classification.product_label,
      measureId: classification.measure_id,
      measureLabel: classification.measure_label,
      componentRole: classification.component_role,
      parentProductId: classification.parent_product_id,
      displayOrder: classification.display_order,
    };
  }
  return CORE_SERIES[series.view_id];
}

function levelOrder(levelId: string): number {
  return LEVEL_SPECIFICITY[levelId] ?? 1_000;
}

function roleOrder(componentRole: string): number {
  return ROLE_SPECIFICITY[componentRole] ?? 5;
}

function availableGeographies(series: UsaManifestSeries): ManifestGeography[] {
  return series.geographies.filter(
    (geography) => geography.status === "available" && Boolean(geography.asset_path),
  );
}

function supportsGeography(series: UsaManifestSeries, geographyId: string): boolean {
  return availableGeographies(series).some(
    (geography) => geography.geography_id === geographyId,
  );
}

export function usaSeriesSupportsGeographies(
  series: UsaManifestSeries,
  geographyLevelId: string,
  geographyIds: readonly string[],
): boolean {
  return geographyIds.every((geographyId) => supportsGeography(series, geographyId))
    && (
      geographyIds.length < 2
      || seriesAllowsCustomAggregation("usa", series.view_id, geographyLevelId, geographyIds.length)
    );
}

export function usaHasCompatibleCombination(
  allSeries: UsaManifestSeries[],
  segment: UsaEnergySegment,
  geographyLevelId: string,
  geographyIds: readonly string[],
): boolean {
  return usaSegmentSeries(allSeries, segment).some(
    (series) => usaSeriesSupportsGeographies(series, geographyLevelId, geographyIds),
  );
}

export function usaSegmentSeries(
  allSeries: UsaManifestSeries[],
  segment: UsaEnergySegment,
): UsaManifestSeries[] {
  return allSeries.filter((series) => (
    seriesHasAsset(series) && descriptorForSeries(series)?.segment === segment
  ));
}

export function usaGeographyLevels(
  allSeries: UsaManifestSeries[],
  segment: UsaEnergySegment,
): UsaGeographyLevelOption[] {
  const byGeography = new Map<string, ManifestGeography>();
  for (const series of usaSegmentSeries(allSeries, segment)) {
    for (const geography of availableGeographies(series)) {
      if (!byGeography.has(geography.geography_id)) {
        byGeography.set(geography.geography_id, geography);
      }
    }
  }

  const byLevel = new Map<string, UsaGeographyLevelOption>();
  for (const geography of byGeography.values()) {
    const level = byLevel.get(geography.level_id) ?? {
      id: geography.level_id,
      label: geography.level_label,
      granularityRank: geography.granularity_rank ?? levelOrder(geography.level_id),
      geographies: [],
    };
    level.granularityRank = Math.min(
      level.granularityRank,
      geography.granularity_rank ?? levelOrder(geography.level_id),
    );
    level.geographies.push(geography);
    byLevel.set(level.id, level);
  }

  return [...byLevel.values()]
    .map((level) => ({
      ...level,
      geographies: level.geographies.sort((left, right) => left.label.localeCompare(right.label)),
    }))
    .sort((left, right) => (
      left.granularityRank - right.granularityRank || left.label.localeCompare(right.label)
    ));
}

function familyOptionsForGeography(
  allSeries: UsaManifestSeries[],
  segment: UsaEnergySegment,
  geographyLevelId: string,
  geographyIds: readonly string[],
): UsaDashboardFamilyOption[] {
  const byFamily = new Map<string, UsaDashboardFamilyOption>();
  for (const series of usaSegmentSeries(allSeries, segment)) {
    if (!usaSeriesSupportsGeographies(series, geographyLevelId, geographyIds)) continue;
    const descriptor = descriptorForSeries(series);
    if (!descriptor) continue;
    const existing = byFamily.get(descriptor.familyId);
    if (!existing || descriptor.displayOrder < existing.displayOrder) {
      byFamily.set(descriptor.familyId, {
        id: descriptor.familyId,
        label: descriptor.familyLabel,
        displayOrder: descriptor.displayOrder,
      });
    }
  }
  return [...byFamily.values()].sort((left, right) => (
    left.displayOrder - right.displayOrder || left.label.localeCompare(right.label)
  ));
}

function productOptionsForGeography(
  allSeries: UsaManifestSeries[],
  segment: UsaEnergySegment,
  geographyLevelId: string,
  geographyIds: readonly string[],
  familyId: string,
): UsaDashboardProductOption[] {
  const byProduct = new Map<string, UsaDashboardProductOption>();
  for (const series of usaSegmentSeries(allSeries, segment)) {
    if (!usaSeriesSupportsGeographies(series, geographyLevelId, geographyIds)) continue;
    const descriptor = descriptorForSeries(series);
    if (!descriptor || descriptor.familyId !== familyId) continue;
    const id = descriptor.productId;
    const existing = byProduct.get(id);
    if (!existing || descriptor.displayOrder < existing.displayOrder) {
      byProduct.set(id, {
        id,
        label: descriptor.productLabel,
        familyLabel: descriptor.familyLabel,
        componentRole: descriptor.componentRole,
        parentProductId: descriptor.parentProductId,
        hierarchyHeight: 0,
        displayOrder: descriptor.displayOrder,
      });
    }
  }

  const childrenByParent = new Map<string, Set<string>>();
  for (const series of usaSegmentSeries(allSeries, segment)) {
    const descriptor = descriptorForSeries(series);
    if (!descriptor || descriptor.familyId !== familyId || !descriptor.parentProductId) continue;
    const children = childrenByParent.get(descriptor.parentProductId) ?? new Set<string>();
    children.add(descriptor.productId);
    childrenByParent.set(descriptor.parentProductId, children);
  }

  const options = [...byProduct.values()];
  const heightFor = (productId: string, visited = new Set<string>()): number => {
    if (visited.has(productId)) return 0;
    const children = [...(childrenByParent.get(productId) ?? [])];
    if (!children.length) return 0;
    const nextVisited = new Set(visited);
    nextVisited.add(productId);
    return 1 + Math.max(...children.map((childId) => heightFor(childId, nextVisited)));
  };

  for (const option of options) option.hierarchyHeight = heightFor(option.id);
  return options.sort((left, right) => (
    left.hierarchyHeight - right.hierarchyHeight
    || roleOrder(left.componentRole) - roleOrder(right.componentRole)
    || left.familyLabel.localeCompare(right.familyLabel)
    || left.displayOrder - right.displayOrder
    || left.label.localeCompare(right.label)
  ));
}

function measureOptionsForProduct(
  allSeries: UsaManifestSeries[],
  segment: UsaEnergySegment,
  geographyLevelId: string,
  geographyIds: readonly string[],
  familyId: string,
  selectedProductId: string,
): UsaDashboardMeasureOption[] {
  const byMeasure = new Map<string, UsaDashboardMeasureOption>();
  for (const series of usaSegmentSeries(allSeries, segment)) {
    if (!usaSeriesSupportsGeographies(series, geographyLevelId, geographyIds)) continue;
    const descriptor = descriptorForSeries(series);
    if (
      !descriptor
      || descriptor.familyId !== familyId
      || descriptor.productId !== selectedProductId
    ) continue;
    const displayOrder = descriptor.displayOrder % 100;
    const existing = byMeasure.get(descriptor.measureId);
    if (!existing || displayOrder < existing.displayOrder) {
      byMeasure.set(descriptor.measureId, {
        id: descriptor.measureId,
        label: descriptor.measureLabel,
        displayOrder,
        series,
      });
    }
  }
  return [...byMeasure.values()].sort((left, right) => (
    left.displayOrder - right.displayOrder || left.label.localeCompare(right.label)
  ));
}

export function resolveUsaDashboardSelection(
  allSeries: UsaManifestSeries[],
  requested: UsaDashboardSelectionRequest = {},
): ResolvedUsaDashboardSelection {
  const segments = USA_SEGMENTS.filter((segment) => usaSegmentSeries(allSeries, segment.id).length);
  const segment = segments.some((option) => option.id === requested.segment)
    ? requested.segment!
    : segments[0]?.id ?? "crude";
  const geographyLevels = usaGeographyLevels(allSeries, segment);
  const requestedGeographyIds = requested.geographyIds?.length
    ? requested.geographyIds
    : requested.geographyId
      ? [requested.geographyId]
      : [];
  const requestedGeography = geographyLevels
    .flatMap((level) => level.geographies)
    .find((geography) => requestedGeographyIds.includes(geography.geography_id));
  const geographyLevelId = requestedGeography?.level_id
    ?? (geographyLevels.some((level) => level.id === requested.geographyLevelId)
      ? requested.geographyLevelId!
      : geographyLevels[0]?.id ?? "");
  const geographies = geographyLevels.find((level) => level.id === geographyLevelId)?.geographies ?? [];
  const geographyIds = requestedGeographyIds.filter((geographyId) => (
    geographies.some((candidate) => candidate.geography_id === geographyId)
  ));
  if (!geographyIds.length && geographies[0]) geographyIds.push(geographies[0].geography_id);
  const geography = geographies.find(
    (candidate) => candidate.geography_id === geographyIds[0],
  ) ?? geographies[0];
  const geographyId = geography?.geography_id ?? "";
  const families = familyOptionsForGeography(
    allSeries,
    segment,
    geographyLevelId,
    geographyIds,
  );
  const familyId = families.some((option) => option.id === requested.familyId)
    ? requested.familyId!
    : families[0]?.id ?? "";
  const products = productOptionsForGeography(
    allSeries,
    segment,
    geographyLevelId,
    geographyIds,
    familyId,
  );
  const productId = products.some((option) => option.id === requested.productId)
    ? requested.productId!
    : products[0]?.id ?? "";
  const measures = measureOptionsForProduct(
    allSeries,
    segment,
    geographyLevelId,
    geographyIds,
    familyId,
    productId,
  );
  const measureId = measures.some((option) => option.id === requested.measureId)
    ? requested.measureId!
    : measures[0]?.id ?? "";
  const series = measures.find((option) => option.id === measureId)?.series;

  return {
    segment,
    segments,
    geographyLevelId,
    geographyId,
    geographyIds,
    geographyLevels,
    geographies,
    geography,
    familyId,
    families,
    productId,
    products,
    measureId,
    measures,
    series,
  };
}

export function assetMatchesUsaSelection(
  asset: UsaChartAsset | undefined,
  series: UsaManifestSeries | undefined,
  geographyId: string | undefined,
): boolean {
  return Boolean(
    asset
    && series
    && geographyId
    && asset.series_id === series.series_id
    && asset.geography_id === geographyId,
  );
}

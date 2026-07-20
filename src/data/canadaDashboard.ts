import type {
  CanadaAssetManifest,
  CanadaManifestSeries,
  GeographyOrigin,
} from "../types/energyAssets";
import { referenceGlossary } from "./referenceGlossary";
import { seriesAllowsCustomAggregation } from "./customAggregation";

export interface CanadaFacetOption {
  id: string;
  label: string;
}

export interface CanadaSeriesSelection {
  datasetId?: string;
  segmentId?: CanadaMarketSegmentId;
  geographyLevelId?: string;
  geographyId?: string;
  geographyIds?: string[];
  familyId?: string;
  productId?: string;
  measureId?: string;
}

export type CanadaMarketSegmentId = "crude" | "refined";

export interface CanadaSegmentOption extends CanadaFacetOption {
  id: CanadaMarketSegmentId;
  description: string;
  seriesCount?: number;
}

export interface CanadaGeographyOption extends CanadaFacetOption {
  geographyId: string;
  levelId: string;
  levelLabel: string;
  origins: GeographyOrigin[];
  sourceNames: string[];
}

export interface CanadaGeographyLevelOption extends CanadaFacetOption {
  geographies: CanadaGeographyOption[];
}

export interface CanadaProductOption extends CanadaFacetOption {
  productId: string;
  componentRole?: string;
  familyLabel?: string;
  parentProductId?: string | null;
  displayOrder: number;
}

export interface CanadaDashboardSelectionRequest {
  segmentId?: CanadaMarketSegmentId;
  geographyLevelId?: string;
  geographyId?: string;
  geographyIds?: string[];
  familyId?: string;
  productId?: string;
  measureId?: string;
  seriesId?: string;
}

export interface CanadaDashboardSelection {
  segments: CanadaSegmentOption[];
  segmentId: CanadaMarketSegmentId;
  geographyLevels: CanadaGeographyLevelOption[];
  geographyLevelId: string;
  geographies: CanadaGeographyOption[];
  geographyId: string;
  geographyIds: string[];
  families: CanadaFacetOption[];
  familyId: string;
  products: CanadaProductOption[];
  productId: string;
  measures: CanadaFacetOption[];
  measureId: string;
  seriesOptions: CanadaManifestSeries[];
  series?: CanadaManifestSeries;
}

const CANADA_SEGMENTS: CanadaSegmentOption[] = [
  {
    id: "crude",
    label: "Crude",
    description: "Crude-oil balances and refinery activity",
  },
  {
    id: "refined",
    label: "Refined",
    description: "Finished products, blending components, and ethanol",
  },
];

// Mirrors config/geographies/canada.json. These ranks order controls only; they
// never authorize a rollup. Unknown future source levels remain available after
// the registered levels instead of being silently discarded.
const CANADA_GEOGRAPHY_LEVEL_RANK: Record<string, number> = {
  city: 10,
  census_metropolitan_area: 20,
  province_territory: 30,
  source_region: 40,
  national: 100,
};

function facetId(prefix: string, ...parts: string[]): string {
  return `${prefix}:${parts.map((part) => encodeURIComponent(part)).join(":")}`;
}

function hasChartAsset(series: CanadaManifestSeries): boolean {
  return series.geographies.some(
    (geography) => geography.status === "available" && Boolean(geography.asset_path),
  );
}

function seriesOrder(left: CanadaManifestSeries, right: CanadaManifestSeries): number {
  return (left.classification?.display_order ?? Number.MAX_SAFE_INTEGER)
      - (right.classification?.display_order ?? Number.MAX_SAFE_INTEGER)
    || left.source.name.localeCompare(right.source.name)
    || left.category.localeCompare(right.category)
    || left.title.localeCompare(right.title);
}

function uniqueOptions<T extends CanadaFacetOption>(options: T[]): T[] {
  const seen = new Set<string>();
  return options.filter((option) => {
    if (seen.has(option.id)) return false;
    seen.add(option.id);
    return true;
  });
}

function humanizeGroupId(groupId: string): string {
  return groupId
    .split(/[_-]+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

export function canadaDatasetFacet(series: CanadaManifestSeries): CanadaFacetOption {
  const groupId = series.classification?.dashboard_group;
  if (groupId) {
    const label = groupId === "canada_refined_products"
      ? "Refined product balances · Statistics Canada"
      : groupId === "canada_crude"
        ? "Crude oil balances · Statistics Canada"
        : groupId === "canada_refining"
          ? "Refinery activity · Statistics Canada & CER"
          : `${humanizeGroupId(groupId)} · ${series.source.name}`;
    return {
      id: facetId("dataset", groupId),
      label,
    };
  }
  return {
    id: facetId("dataset", series.source.name, series.category),
    label: `${series.category} · ${series.source.name}`,
  };
}

/**
 * Refinery activity belongs to Crude because the active series describe crude
 * inputs, crude runs, and utilization of crude-processing capacity. Refined is
 * reserved for published finished-product/component balances. This is a
 * navigation classification only and does not change provider semantics.
 */
export function canadaMarketSegmentFacet(
  series: CanadaManifestSeries,
): CanadaSegmentOption {
  const groupId = series.classification?.dashboard_group;
  if (groupId === "canada_crude" || groupId === "canada_refining") {
    return CANADA_SEGMENTS.find((option) => option.id === "crude")!;
  }
  return CANADA_SEGMENTS.find((option) => option.id === "refined")!;
}

export function canadaProductFacet(series: CanadaManifestSeries): CanadaFacetOption {
  const classification = series.classification;
  if (classification) {
    return {
      id: facetId(
        "product",
        classification.product_family_id,
        classification.product_id,
      ),
      label: classification.product_label,
    };
  }
  return {
    id: facetId("series-product", series.view_id),
    label: series.title,
  };
}

function canadaProductOption(series: CanadaManifestSeries): CanadaProductOption {
  const facet = canadaProductFacet(series);
  return {
    ...facet,
    productId: series.classification?.product_id ?? series.view_id,
    componentRole: series.classification?.component_role,
    familyLabel: series.classification?.product_family_label,
    parentProductId: series.classification?.parent_product_id,
    displayOrder: series.classification?.display_order ?? Number.MAX_SAFE_INTEGER,
  };
}

export function canadaProductFamilyFacet(series: CanadaManifestSeries): CanadaFacetOption {
  const classification = series.classification;
  if (classification) {
    return {
      id: facetId("family", classification.product_family_id),
      label: classification.product_family_label,
    };
  }
  return {
    id: facetId("family", series.category),
    label: series.category,
  };
}

export function canadaMeasureFacet(series: CanadaManifestSeries): CanadaFacetOption {
  const classification = series.classification;
  if (classification) {
    return {
      id: facetId("measure", classification.measure_id),
      label: classification.measure_label,
    };
  }
  return {
    id: facetId("series-measure", series.view_id),
    label: series.metric_id ? series.metric_id.replaceAll("_", " ") : "Published observation",
  };
}

export function availableCanadaSeries(manifest: CanadaAssetManifest): CanadaManifestSeries[] {
  return manifest.series.filter(hasChartAsset).sort(seriesOrder);
}

export function canadaReferenceEntries(series: CanadaManifestSeries) {
  const referenceTermIds = series.classification?.reference_term_ids ?? [];
  return referenceTermIds
    .map((termId) => referenceGlossary.find((entry) => entry.id === termId))
    .filter((entry) => entry !== undefined);
}

export function canadaDatasetOptions(
  series: CanadaManifestSeries[],
): CanadaFacetOption[] {
  return uniqueOptions(series.map(canadaDatasetFacet));
}

export function canadaSegmentOptions(
  series: CanadaManifestSeries[],
): CanadaSegmentOption[] {
  const availableIds = new Set(series.map((candidate) => canadaMarketSegmentFacet(candidate).id));
  return CANADA_SEGMENTS
    .filter((option) => availableIds.has(option.id))
    .map((option) => ({
      ...option,
      seriesCount: series.filter(
        (candidate) => canadaMarketSegmentFacet(candidate).id === option.id,
      ).length,
    }));
}

function supportsGeography(
  series: CanadaManifestSeries,
  geographyId: string,
  geographyLevelId?: string,
): boolean {
  return series.geographies.some((geography) => (
    geography.geography_id === geographyId
    && (!geographyLevelId || geography.level_id === geographyLevelId)
    && geography.status === "available"
    && Boolean(geography.asset_path)
  ));
}

export function canadaSeriesSupportsGeographies(
  series: CanadaManifestSeries,
  geographyLevelId: string,
  geographyIds: readonly string[],
): boolean {
  return geographyIds.every((geographyId) => (
    supportsGeography(series, geographyId, geographyLevelId)
  )) && (
    geographyIds.length < 2
    || seriesAllowsCustomAggregation(
      "canada",
      series.view_id,
      geographyLevelId,
      geographyIds.length,
    )
  );
}

export function canadaHasCompatibleCombination(
  series: CanadaManifestSeries[],
  segmentId: CanadaMarketSegmentId,
  geographyLevelId: string,
  geographyIds: readonly string[],
): boolean {
  return series.some((candidate) => (
    canadaMarketSegmentFacet(candidate).id === segmentId
    && canadaSeriesSupportsGeographies(candidate, geographyLevelId, geographyIds)
  ));
}

export function canadaGeographyLevelOptions(
  series: CanadaManifestSeries[],
  segmentId: CanadaMarketSegmentId,
): CanadaGeographyLevelOption[] {
  const segmentSeries = series.filter(
    (candidate) => canadaMarketSegmentFacet(candidate).id === segmentId,
  );
  const levels = new Map<string, CanadaGeographyLevelOption>();
  const geographyKeys = new Map<string, CanadaGeographyOption>();

  for (const candidate of segmentSeries) {
    for (const geography of candidate.geographies) {
      if (geography.status !== "available" || !geography.asset_path) continue;

      let level = levels.get(geography.level_id);
      if (!level) {
        level = {
          id: geography.level_id,
          label: geography.level_label,
          geographies: [],
        };
        levels.set(geography.level_id, level);
      }

      // Stable node identity and source level—not the human label—define a
      // choice. This keeps ca.on distinct from the CER Ontario region.
      const key = `${geography.level_id}\u0000${geography.geography_id}`;
      let option = geographyKeys.get(key);
      if (!option) {
        option = {
          id: facetId("geography", geography.level_id, geography.geography_id),
          label: geography.label,
          geographyId: geography.geography_id,
          levelId: geography.level_id,
          levelLabel: geography.level_label,
          origins: [],
          sourceNames: [],
        };
        geographyKeys.set(key, option);
        level.geographies.push(option);
      }
      if (!option.origins.includes(geography.origin)) option.origins.push(geography.origin);
      if (!option.sourceNames.includes(candidate.source.name)) {
        option.sourceNames.push(candidate.source.name);
      }
    }
  }

  return [...levels.values()]
    .sort((left, right) => (
      (CANADA_GEOGRAPHY_LEVEL_RANK[left.id] ?? Number.MAX_SAFE_INTEGER)
        - (CANADA_GEOGRAPHY_LEVEL_RANK[right.id] ?? Number.MAX_SAFE_INTEGER)
      || left.label.localeCompare(right.label)
    ))
    .map((level) => ({
      ...level,
      geographies: level.geographies.sort((left, right) => left.label.localeCompare(right.label)),
    }));
}

export function canadaProductOptions(
  series: CanadaManifestSeries[],
  datasetId: string,
): CanadaFacetOption[] {
  return uniqueOptions(
    series
      .filter((candidate) => canadaDatasetFacet(candidate).id === datasetId)
      .map(canadaProductFacet),
  );
}

export function canadaProductsForGeography(
  series: CanadaManifestSeries[],
  segmentId: CanadaMarketSegmentId,
  geographyLevelId: string,
  geographyId: string | readonly string[],
  familyId?: string,
): CanadaProductOption[] {
  const geographyIds = typeof geographyId === "string" ? [geographyId] : geographyId;
  const candidates = series
    .filter((candidate) => canadaMarketSegmentFacet(candidate).id === segmentId)
    .filter((candidate) => canadaSeriesSupportsGeographies(
      candidate,
      geographyLevelId,
      geographyIds,
    ))
    .filter((candidate) => !familyId || canadaProductFamilyFacet(candidate).id === familyId);
  const options = uniqueOptions(candidates.map(canadaProductOption));
  const byProductId = new Map(options.map((option) => [option.productId, option]));
  const childrenByParent = new Map<string, CanadaProductOption[]>();
  for (const option of options) {
    if (!option.parentProductId || !byProductId.has(option.parentProductId)) continue;
    const children = childrenByParent.get(option.parentProductId) ?? [];
    children.push(option);
    childrenByParent.set(option.parentProductId, children);
  }

  // Order the registered product DAG leaf-first. A parent ID that is not an
  // active option is lineage only and must not create a synthetic selector
  // choice (for example Canada's unregistered total-motor-gasoline parent).
  const hierarchyHeight = (
    option: CanadaProductOption,
    visited = new Set<string>(),
  ): number => {
    if (visited.has(option.productId)) return 0;
    const nextVisited = new Set(visited).add(option.productId);
    const children = childrenByParent.get(option.productId) ?? [];
    return children.length
      ? 1 + Math.max(...children.map((child) => hierarchyHeight(child, nextVisited)))
      : 0;
  };

  return options.sort((left, right) => (
    hierarchyHeight(left) - hierarchyHeight(right)
    || left.displayOrder - right.displayOrder
    || left.label.localeCompare(right.label)
  ));
}

export function canadaMeasureOptions(
  series: CanadaManifestSeries[],
  datasetId: string,
  productId: string,
): CanadaFacetOption[] {
  return uniqueOptions(
    series
      .filter((candidate) => canadaDatasetFacet(candidate).id === datasetId)
      .filter((candidate) => canadaProductFacet(candidate).id === productId)
      .map(canadaMeasureFacet),
  );
}

export function canadaSeriesForSelection(
  series: CanadaManifestSeries[],
  selection: CanadaSeriesSelection,
): CanadaManifestSeries[] {
  return series.filter((candidate) => {
    if (selection.datasetId && canadaDatasetFacet(candidate).id !== selection.datasetId) {
      return false;
    }
    if (selection.segmentId
      && canadaMarketSegmentFacet(candidate).id !== selection.segmentId) {
      return false;
    }
    if (selection.geographyId
      && !supportsGeography(
        candidate,
        selection.geographyId,
        selection.geographyLevelId,
      )) {
      return false;
    }
    if (selection.geographyIds?.length
      && !canadaSeriesSupportsGeographies(
        candidate,
        selection.geographyLevelId ?? "",
        selection.geographyIds,
      )) {
      return false;
    }
    if (selection.familyId
      && canadaProductFamilyFacet(candidate).id !== selection.familyId) {
      return false;
    }
    if (selection.productId && canadaProductFacet(candidate).id !== selection.productId) {
      return false;
    }
    if (selection.measureId && canadaMeasureFacet(candidate).id !== selection.measureId) {
      return false;
    }
    return true;
  });
}

export function resolveCanadaDashboardSelection(
  series: CanadaManifestSeries[],
  request: CanadaDashboardSelectionRequest,
): CanadaDashboardSelection {
  const segments = canadaSegmentOptions(series);
  const requestedSegment = segments.find((option) => option.id === request.segmentId);
  const segmentId = requestedSegment?.id ?? segments[0]?.id ?? "crude";
  const geographyLevels = canadaGeographyLevelOptions(series, segmentId);
  const selectedLevel = geographyLevels.find(
    (option) => option.id === request.geographyLevelId,
  ) ?? geographyLevels[0];
  const geographies = selectedLevel?.geographies ?? [];
  const requestedGeographyIds = request.geographyIds?.length
    ? request.geographyIds
    : request.geographyId
      ? [request.geographyId]
      : [];
  const geographyIds = requestedGeographyIds.filter((geographyId) => (
    geographies.some((option) => option.geographyId === geographyId)
  ));
  if (!geographyIds.length && geographies[0]) geographyIds.push(geographies[0].geographyId);
  const selectedGeography = geographies.find(
    (option) => option.geographyId === geographyIds[0],
  ) ?? geographies[0];
  const geographyLevelId = selectedLevel?.id ?? "";
  const geographyId = selectedGeography?.geographyId ?? "";
  const compatibleSeries = canadaSeriesForSelection(series, {
    segmentId,
    geographyLevelId,
    geographyIds,
  });
  const families = uniqueOptions(compatibleSeries.map(canadaProductFamilyFacet));
  const selectedFamily = families.find((option) => option.id === request.familyId)
    ?? families[0];
  const familyId = selectedFamily?.id ?? "";
  const products = canadaProductsForGeography(
    series,
    segmentId,
    geographyLevelId,
    geographyIds,
    familyId,
  );
  const selectedProduct = products.find((option) => option.id === request.productId)
    ?? products[0];
  const productId = selectedProduct?.id ?? "";
  const productSeries = compatibleSeries
    .filter((candidate) => canadaProductFamilyFacet(candidate).id === familyId)
    .filter((candidate) => canadaProductFacet(candidate).id === productId);
  const measures = uniqueOptions(productSeries.map(canadaMeasureFacet));
  const selectedMeasure = measures.find((option) => option.id === request.measureId)
    ?? measures[0];
  const measureId = selectedMeasure?.id ?? "";
  const seriesOptions = productSeries.filter(
    (candidate) => canadaMeasureFacet(candidate).id === measureId,
  );
  const selectedSeries = seriesOptions.find(
    (candidate) => candidate.view_id === request.seriesId,
  ) ?? seriesOptions[0];

  return {
    segments,
    segmentId,
    geographyLevels,
    geographyLevelId,
    geographies,
    geographyId,
    geographyIds,
    families,
    familyId,
    products,
    productId,
    measures,
    measureId,
    seriesOptions,
    series: selectedSeries,
  };
}

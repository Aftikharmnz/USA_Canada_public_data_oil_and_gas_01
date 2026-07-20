import type { UsaChartAsset, UsaManifestSeries } from "../types/energyAssets";

export const REFINED_PRODUCTS_DASHBOARD_GROUP = "refined_products";

export interface RefinedProductSelectionRequest {
  familyId?: string;
  productId?: string;
  measureId?: string;
}

export interface RefinedProductOption {
  id: string;
  label: string;
  displayOrder: number;
  componentRole?: string;
  parentProductId?: string | null;
}

export interface ResolvedRefinedProductSelection {
  familyId: string;
  productId: string;
  measureId: string;
  families: RefinedProductOption[];
  products: RefinedProductOption[];
  measures: RefinedProductOption[];
  series?: UsaManifestSeries;
}

function compareOptions(left: RefinedProductOption, right: RefinedProductOption): number {
  return left.displayOrder - right.displayOrder || left.label.localeCompare(right.label);
}

function compareSeries(left: UsaManifestSeries, right: UsaManifestSeries): number {
  const leftClassification = left.classification;
  const rightClassification = right.classification;
  return (leftClassification?.display_order ?? Number.MAX_SAFE_INTEGER)
    - (rightClassification?.display_order ?? Number.MAX_SAFE_INTEGER)
    || (leftClassification?.product_family_label ?? "").localeCompare(
      rightClassification?.product_family_label ?? "",
    )
    || (leftClassification?.product_label ?? "").localeCompare(
      rightClassification?.product_label ?? "",
    )
    || (leftClassification?.measure_label ?? "").localeCompare(
      rightClassification?.measure_label ?? "",
    )
    || left.view_id.localeCompare(right.view_id);
}

function uniqueOptions(options: RefinedProductOption[]): RefinedProductOption[] {
  const byId = new Map<string, RefinedProductOption>();
  for (const option of options) {
    const existing = byId.get(option.id);
    if (!existing || compareOptions(option, existing) < 0) byId.set(option.id, option);
  }
  return [...byId.values()].sort(compareOptions);
}

export function refinedProductSeries(series: UsaManifestSeries[]): UsaManifestSeries[] {
  return series
    .filter((item) => item.classification?.dashboard_group === REFINED_PRODUCTS_DASHBOARD_GROUP)
    .filter((item) => item.geographies.some(
      (geography) => geography.status === "available" && Boolean(geography.asset_path),
    ))
    .sort(compareSeries);
}

export function refinedProductFamilies(series: UsaManifestSeries[]): RefinedProductOption[] {
  return uniqueOptions(refinedProductSeries(series).map((item) => ({
    id: item.classification!.product_family_id,
    label: item.classification!.product_family_label,
    displayOrder: item.classification!.display_order,
  })));
}

export function refinedProductsForFamily(
  series: UsaManifestSeries[],
  familyId: string,
): RefinedProductOption[] {
  return uniqueOptions(refinedProductSeries(series)
    .filter((item) => item.classification!.product_family_id === familyId)
    .map((item) => ({
      id: item.classification!.product_id,
      label: item.classification!.product_label,
      displayOrder: item.classification!.display_order,
      componentRole: item.classification!.component_role,
      parentProductId: item.classification!.parent_product_id,
    })));
}

export function refinedMeasuresForProduct(
  series: UsaManifestSeries[],
  familyId: string,
  productId: string,
): RefinedProductOption[] {
  return uniqueOptions(refinedProductSeries(series)
    .filter((item) => item.classification!.product_family_id === familyId)
    .filter((item) => item.classification!.product_id === productId)
    .map((item) => ({
      id: item.classification!.measure_id,
      label: item.classification!.measure_label,
      displayOrder: item.classification!.display_order,
    })));
}

export function resolveRefinedProductSelection(
  allSeries: UsaManifestSeries[],
  requested: RefinedProductSelectionRequest = {},
): ResolvedRefinedProductSelection {
  const eligible = refinedProductSeries(allSeries);
  const families = refinedProductFamilies(eligible);
  const familyId = families.some((option) => option.id === requested.familyId)
    ? requested.familyId!
    : families[0]?.id ?? "";
  const products = refinedProductsForFamily(eligible, familyId);
  const productId = products.some((option) => option.id === requested.productId)
    ? requested.productId!
    : products[0]?.id ?? "";
  const measures = refinedMeasuresForProduct(eligible, familyId, productId);
  const measureId = measures.some((option) => option.id === requested.measureId)
    ? requested.measureId!
    : measures[0]?.id ?? "";
  const selectedSeries = eligible.find((item) => {
    const classification = item.classification!;
    return classification.product_family_id === familyId
      && classification.product_id === productId
      && classification.measure_id === measureId;
  });

  return {
    familyId,
    productId,
    measureId,
    families,
    products,
    measures,
    series: selectedSeries,
  };
}

export function assetMatchesRefinedSelection(
  asset: UsaChartAsset | undefined,
  series: UsaManifestSeries | undefined,
  geographyId: string | undefined,
): boolean {
  return Boolean(
    asset
    && series?.classification?.dashboard_group === REFINED_PRODUCTS_DASHBOARD_GROUP
    && geographyId
    && asset.series_id === series.series_id
    && asset.geography_id === geographyId,
  );
}

export function componentRoleLabel(componentRole: string): string {
  return componentRole
    .split(/[._-]+/)
    .filter(Boolean)
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

export function productOverlapMessage(
  selectedSeries: UsaManifestSeries,
  allSeries: UsaManifestSeries[],
): string {
  const classification = selectedSeries.classification;
  if (!classification) return "Product categories may overlap. Do not add parent and component series.";

  if (classification.parent_product_id) {
    const parent = refinedProductSeries(allSeries).find((candidate) =>
      candidate.classification?.product_family_id === classification.product_family_id
      && candidate.classification.product_id === classification.parent_product_id,
    );
    const parentLabel = parent?.classification?.product_label ?? classification.parent_product_id;
    return `${classification.product_label} is a reported component of ${parentLabel}. Parent and component observations overlap and must not be added together.`;
  }

  const childLabels = uniqueOptions(refinedProductSeries(allSeries)
    .filter((candidate) => candidate.classification?.parent_product_id === classification.product_id)
    .map((candidate) => ({
      id: candidate.classification!.product_id,
      label: candidate.classification!.product_label,
      displayOrder: candidate.classification!.display_order,
    })))
    .map((item) => item.label);
  if (childLabels.length) {
    return `${classification.product_label} overlaps its displayed components (${childLabels.join(", ")}). Treat them as alternate views, not additive series.`;
  }

  return "Product and component categories can overlap. Do not add a parent total to any of its components.";
}

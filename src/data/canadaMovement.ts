import type {
  ManifestGeography,
  UsaChartAsset,
  UsaManifestSeries,
} from "../types/energyAssets";

const MOVEMENT_PRODUCT_IDS = new Set([
  "crude-equivalents-pipeline-movements",
  "hgl-rpp-pipeline-movements",
]);

const SOURCE_PRODUCTS: Record<string, string> = {
  "crude-equivalents-pipeline-movements": "Crude oil and equivalents",
  "hgl-rpp-pipeline-movements":
    "Hydrocarbon Gas Liquids (HGLs) and Refined Petroleum Products (RPPs)",
};

const FIXED_DESTINATIONS: Record<string, string> = {
  "to-canada": "Canada",
  "to-alberta": "Alberta",
  "to-british-columbia": "British Columbia",
  "to-manitoba": "Manitoba",
  "to-ontario": "Ontario",
  "to-quebec": "Quebec",
  "to-saskatchewan": "Saskatchewan",
  "to-united-states": "United States",
};

export type CanadaMovementGeographyRole = "Shipping origin" | "Receiving destination";

export interface CanadaMovementContext {
  geographyRole: CanadaMovementGeographyRole;
  measureRole: CanadaMovementGeographyRole;
  fixedEndpoint: string;
  direction: "to-fixed-destination" | "from-united-states";
}

export interface CanadaMovementRoute {
  shippingRegion: string;
  receivingRegion: string;
  mode: string;
  product: string;
  label: string;
  classification:
    | "intraprovincial"
    | "interprovincial"
    | "pipeline-import"
    | "pipeline-export"
    | "source-published-aggregate";
}

function stripEndpointSuffix(value: string, suffix: string): string | null {
  return value.endsWith(suffix) ? value.slice(0, -suffix.length).trim() : null;
}

export function canadaMovementContext(
  series: UsaManifestSeries,
): CanadaMovementContext | null {
  const classification = series.classification;
  if (
    !classification
    || !MOVEMENT_PRODUCT_IDS.has(classification.product_id)
  ) {
    return null;
  }
  if (classification.measure_id === "from-united-states") {
    return {
      geographyRole: "Receiving destination",
      measureRole: "Shipping origin",
      fixedEndpoint: "United States",
      direction: "from-united-states",
    };
  }
  const fixedEndpoint = FIXED_DESTINATIONS[classification.measure_id];
  if (!fixedEndpoint) return null;
  return {
    geographyRole: "Shipping origin",
    measureRole: "Receiving destination",
    fixedEndpoint,
    direction: "to-fixed-destination",
  };
}

export function movementRouteLabelFromSelection(
  context: CanadaMovementContext,
  selectedGeographyLabel: string,
): string {
  return context.direction === "from-united-states"
    ? `${context.fixedEndpoint} → ${selectedGeographyLabel}`
    : `${selectedGeographyLabel} → ${context.fixedEndpoint}`;
}

/**
 * Builds an exact route only from the source dimensions carried by the loaded
 * asset. The selected manifest label is checked so a stale/mismatched asset
 * fails closed instead of silently swapping an endpoint.
 */
export function movementRouteFromAsset(
  series: UsaManifestSeries,
  asset: UsaChartAsset,
  selectedGeography: Pick<ManifestGeography, "geography_id" | "label">,
): CanadaMovementRoute | null {
  const context = canadaMovementContext(series);
  if (
    !context
    || asset.series_id !== series.series_id
    || asset.geography_id !== selectedGeography.geography_id
  ) {
    return null;
  }
  const shippingRegion = stripEndpointSuffix(
    asset.dimensions.shipping_region ?? "",
    ", shipping region",
  );
  const receivingRegion = stripEndpointSuffix(
    asset.dimensions.receiving_region ?? "",
    ", receiving region",
  );
  const mode = (asset.dimensions.mode_of_transport ?? "").trim();
  const product = (asset.dimensions.source_product ?? "").trim();
  const expectedProduct = SOURCE_PRODUCTS[series.classification!.product_id];
  if (
    !shippingRegion
    || !receivingRegion
    || mode !== "Pipeline"
    || !expectedProduct
    || product !== expectedProduct
  ) {
    return null;
  }

  const selectedEndpoint = context.geographyRole === "Shipping origin"
    ? shippingRegion
    : receivingRegion;
  if (selectedEndpoint !== selectedGeography.label) return null;
  if (context.direction === "from-united-states" && shippingRegion !== "United States") return null;
  if (
    context.direction === "to-fixed-destination"
    && receivingRegion !== context.fixedEndpoint
  ) {
    return null;
  }

  const classification = shippingRegion === "Canada" || receivingRegion === "Canada"
    ? "source-published-aggregate"
    : shippingRegion === receivingRegion
      ? "intraprovincial"
      : shippingRegion === "United States"
        ? "pipeline-import"
        : receivingRegion === "United States"
          ? "pipeline-export"
          : "interprovincial";
  return {
    shippingRegion,
    receivingRegion,
    mode,
    product,
    label: `${shippingRegion} → ${receivingRegion}`,
    classification,
  };
}

import {
  buildOriginDestinationModel,
  type OriginDestinationModel,
  type OriginDestinationNode,
  type OriginDestinationRouteInput,
} from "./originDestinationModel";
import type {
  ManifestGeography,
  UsaChartAsset,
  UsaManifestSeries,
} from "../types/energyAssets";

const ROUTE_ID = /^us\.padd\.route\.([1-5])-to-([1-5])$/;

const PADD_NODES: readonly OriginDestinationNode[] = [
  { id: "us.padd.1", label: "East Coast (PADD 1)", shortLabel: "PADD 1" },
  { id: "us.padd.2", label: "Midwest (PADD 2)", shortLabel: "PADD 2" },
  { id: "us.padd.3", label: "Gulf Coast (PADD 3)", shortLabel: "PADD 3" },
  { id: "us.padd.4", label: "Rocky Mountain (PADD 4)", shortLabel: "PADD 4" },
  { id: "us.padd.5", label: "West Coast (PADD 5)", shortLabel: "PADD 5" },
];

const PRODUCT_FACET_BY_PRODUCT_ID: Readonly<Record<string, string>> = {
  "crude-oil-padd-movements": "EPC0",
  "total-petroleum-products-padd-movements": "EPP0",
};

export interface UsaPaddOriginDestinationAssetPlanItem {
  geography: ManifestGeography;
  assetPath: string;
}

export interface LoadedUsaPaddOriginDestinationAsset
  extends UsaPaddOriginDestinationAssetPlanItem {
  asset: UsaChartAsset;
}

interface PaddRoute {
  originId: string;
  destinationId: string;
  duoarea: string;
}

export function isUsaPaddMovementSeries(
  series: UsaManifestSeries | undefined,
): series is UsaManifestSeries {
  return Boolean(
    series
    && series.classification?.measure_id === "inter-padd-movement"
    && series.frequency === "monthly"
    && series.unit === "thousand_barrels"
    && series.geographies.some((geography) => geography.level_id === "padd_route"),
  );
}

export function usaPaddOriginDestinationAssetPlan(
  series: UsaManifestSeries,
): UsaPaddOriginDestinationAssetPlanItem[] {
  if (!isUsaPaddMovementSeries(series)) return [];
  return series.geographies
    .filter(
      (geography): geography is ManifestGeography & { asset_path: string } => (
        geography.level_id === "padd_route"
        && geography.status === "available"
        && Boolean(geography.asset_path)
      ),
    )
    .map((geography) => ({
      geography,
      assetPath: geography.asset_path,
    }))
    .sort((left, right) => (
      left.geography.geography_id.localeCompare(right.geography.geography_id)
    ));
}

function parsePaddRoute(geographyId: string): PaddRoute {
  const match = ROUTE_ID.exec(geographyId);
  if (!match) {
    throw new Error(`USA PADD movement geography ${geographyId} is not an exact directional route.`);
  }
  const origin = match[1]!;
  const destination = match[2]!;
  if (origin === destination) {
    throw new Error(`USA PADD movement route ${geographyId} cannot begin and end in the same PADD.`);
  }
  return {
    originId: `us.padd.${origin}`,
    destinationId: `us.padd.${destination}`,
    // EIA duoarea encodes receiving PADD first and shipping PADD second.
    duoarea: `R${destination}0-R${origin}0`,
  };
}

function statusPreservingHistory(asset: UsaChartAsset) {
  if (!asset.history?.length) {
    throw new Error(
      `USA PADD movement asset ${asset.series_id}/${asset.geography_id} has no status-preserving history.`,
    );
  }
  return asset.history;
}

/**
 * Pivots exact EIA route assets into one directional matrix. This function
 * never sums, nets, allocates, or fills a route that EIA did not publish.
 */
export function buildUsaPaddOriginDestinationModel(
  series: UsaManifestSeries,
  loadedAssets: readonly LoadedUsaPaddOriginDestinationAsset[],
): OriginDestinationModel {
  if (!isUsaPaddMovementSeries(series)) {
    throw new Error("The active USA selection is not a registered monthly PADD movement product.");
  }
  const plan = usaPaddOriginDestinationAssetPlan(series);
  if (!plan.length) {
    throw new Error("No source-published USA PADD route assets are available.");
  }
  if (loadedAssets.length !== plan.length) {
    throw new Error("The complete set of available USA PADD route assets was not loaded.");
  }

  const expected = new Map(plan.map((item) => [
    item.geography.geography_id,
    item,
  ]));
  const reference = loadedAssets[0]?.asset;
  if (!reference) throw new Error("No USA PADD route asset was loaded.");

  const expectedProduct = PRODUCT_FACET_BY_PRODUCT_ID[
    series.classification!.product_id
  ];
  if (!expectedProduct) {
    throw new Error(
      `USA PADD movement product ${series.classification!.product_id} has no verified EIA product facet.`,
    );
  }

  const routePairs = new Set<string>();
  const routes: OriginDestinationRouteInput[] = [];
  for (const loaded of loadedAssets) {
    const planned = expected.get(loaded.geography.geography_id);
    if (
      !planned
      || loaded.assetPath !== planned.assetPath
      || loaded.asset.series_id !== series.series_id
      || loaded.asset.geography_id !== loaded.geography.geography_id
    ) {
      throw new Error("A loaded USA PADD movement asset escaped the validated manifest plan.");
    }
    expected.delete(loaded.geography.geography_id);
    if (
      loaded.asset.unit !== series.unit
      || loaded.asset.frequency !== series.frequency
      || loaded.asset.unit !== reference.unit
      || loaded.asset.frequency !== reference.frequency
      || loaded.asset.generated_at !== reference.generated_at
      || loaded.asset.methodology_version !== reference.methodology_version
    ) {
      throw new Error(
        `USA route ${loaded.geography.label} has incompatible units, frequency, methodology, or source vintage.`,
      );
    }

    const route = parsePaddRoute(loaded.geography.geography_id);
    if (
      loaded.asset.dimensions.duoarea !== route.duoarea
      || loaded.asset.dimensions.product !== expectedProduct
      || loaded.asset.dimensions.process !== "TNR"
      || !loaded.asset.dimensions.series
    ) {
      throw new Error(
        `USA route dimensions do not match ${loaded.geography.geography_id}.`,
      );
    }
    const pair = `${route.originId}\u0000${route.destinationId}`;
    if (routePairs.has(pair)) {
      throw new Error(`USA PADD movement assets repeat route ${loaded.geography.label}.`);
    }
    routePairs.add(pair);
    routes.push({
      id: loaded.geography.geography_id,
      originId: route.originId,
      destinationId: route.destinationId,
      history: statusPreservingHistory(loaded.asset),
    });
  }
  if (expected.size) {
    throw new Error("One or more available USA PADD movement assets were not loaded.");
  }

  const periods = [...new Set(routes.flatMap(
    (route) => route.history.map((observation) => observation.period),
  ))].sort();
  const latestPeriod = periods.at(-1);
  if (!latestPeriod) {
    throw new Error("USA PADD movement routes have no source periods.");
  }

  return buildOriginDestinationModel({
    id: `${series.view_id}.origin-destination`,
    title: "PADD-to-PADD petroleum movements",
    description:
      "Rows are EIA shipping PADDs and columns are receiving PADDs. Each populated cell is one exact directional corridor.",
    sourceUnit: series.unit,
    frequency: series.frequency,
    productLabel: series.classification!.product_label,
    modeLabel: "Pipeline, tanker, barge, and selected rail",
    sourceNote:
      "EIA Petroleum Supply Monthly combined movements. Gross directions are shown separately; absent routes are not inferred as zero.",
    origins: PADD_NODES,
    destinations: PADD_NODES,
    routes,
    periods,
    latestPeriod,
  });
}

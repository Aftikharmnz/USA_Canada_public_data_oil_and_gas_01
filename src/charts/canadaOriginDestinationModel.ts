import {
  buildOriginDestinationModel,
  type OriginDestinationModel,
  type OriginDestinationNode,
  type OriginDestinationRouteInput,
} from "./originDestinationModel";
import {
  canadaMovementContext,
  movementRouteFromAsset,
} from "../data/canadaMovement";
import type {
  ManifestGeography,
  UsaChartAsset,
  UsaManifestSeries,
} from "../types/energyAssets";

const MATRIX_MEASURE_IDS = new Set([
  "to-alberta",
  "to-british-columbia",
  "to-manitoba",
  "to-ontario",
  "to-quebec",
  "to-saskatchewan",
  "to-united-states",
  "from-united-states",
]);

const PROVINCE_SHORT_LABELS: Record<string, string> = {
  "ca.ab": "AB",
  "ca.bc": "BC",
  "ca.mb": "MB",
  "ca.nt": "NT",
  "ca.on": "ON",
  "ca.qc": "QC",
  "ca.sk": "SK",
  us: "US",
};

export interface CanadaOriginDestinationAssetPlanItem {
  series: UsaManifestSeries;
  geography: ManifestGeography;
  assetPath: string;
}

export interface LoadedCanadaOriginDestinationAsset
  extends CanadaOriginDestinationAssetPlanItem {
  asset: UsaChartAsset;
}

function movementProductId(series: UsaManifestSeries): string | null {
  return canadaMovementContext(series)
    ? series.classification?.product_id ?? null
    : null;
}

export function canadaOriginDestinationSiblingSeries(
  allSeries: readonly UsaManifestSeries[],
  activeSeries: UsaManifestSeries,
): UsaManifestSeries[] {
  const productId = movementProductId(activeSeries);
  if (!productId) return [];
  return allSeries
    .filter((candidate) => (
      movementProductId(candidate) === productId
      && MATRIX_MEASURE_IDS.has(candidate.classification?.measure_id ?? "")
      && candidate.frequency === activeSeries.frequency
      && candidate.unit === activeSeries.unit
    ))
    .sort((left, right) => (
      (left.classification?.display_order ?? 0)
      - (right.classification?.display_order ?? 0)
      || left.series_id.localeCompare(right.series_id)
    ));
}

export function canadaOriginDestinationAssetPlan(
  allSeries: readonly UsaManifestSeries[],
  activeSeries: UsaManifestSeries,
): CanadaOriginDestinationAssetPlanItem[] {
  return canadaOriginDestinationSiblingSeries(allSeries, activeSeries)
    .flatMap((series) => series.geographies
      .filter(
        (geography): geography is ManifestGeography & { asset_path: string } => (
          geography.level_id === "province_territory"
          && geography.status === "available"
          && Boolean(geography.asset_path)
        ),
      )
      .map((geography) => ({
        series,
        geography,
        assetPath: geography.asset_path,
      })));
}

function provinceNodes(
  siblingSeries: readonly UsaManifestSeries[],
): OriginDestinationNode[] {
  const nodes = new Map<string, OriginDestinationNode>();
  for (const series of siblingSeries) {
    for (const geography of series.geographies) {
      if (
        geography.level_id !== "province_territory"
        || geography.geography_id === "ca"
      ) {
        continue;
      }
      const existing = nodes.get(geography.geography_id);
      if (existing && existing.label !== geography.label) {
        throw new Error(
          `Canada movement geography ${geography.geography_id} changed label across sibling series.`,
        );
      }
      nodes.set(geography.geography_id, {
        id: geography.geography_id,
        label: geography.label,
        shortLabel: PROVINCE_SHORT_LABELS[geography.geography_id],
      });
    }
  }
  return [...nodes.values()].sort((left, right) => left.label.localeCompare(right.label));
}

function endpointId(
  label: string,
  provinces: readonly OriginDestinationNode[],
): string | null {
  if (label === "United States") return "us";
  return provinces.find((province) => province.label === label)?.id ?? null;
}

function statusPreservingHistory(asset: UsaChartAsset) {
  if (!asset.history?.length) {
    throw new Error(
      `Canada movement asset ${asset.series_id}/${asset.geography_id} has no status-preserving history.`,
    );
  }
  return asset.history;
}

/**
 * Joins only exact Statistics Canada route assets. It never adds, nets, or
 * stale-fills a corridor and deliberately excludes overlapping Canada rows.
 */
export function buildCanadaOriginDestinationModel(
  allSeries: readonly UsaManifestSeries[],
  activeSeries: UsaManifestSeries,
  loadedAssets: readonly LoadedCanadaOriginDestinationAsset[],
): OriginDestinationModel {
  const siblings = canadaOriginDestinationSiblingSeries(allSeries, activeSeries);
  if (!siblings.length) {
    throw new Error("The active Canada selection is not a registered movement product.");
  }
  const expectedPlan = canadaOriginDestinationAssetPlan(allSeries, activeSeries);
  if (!expectedPlan.length) {
    throw new Error("No source-published Canada movement route assets are available.");
  }
  if (loadedAssets.length !== expectedPlan.length) {
    throw new Error("The complete set of available Canada movement route assets was not loaded.");
  }

  const expectedByIdentity = new Map(expectedPlan.map((item) => [
    `${item.series.series_id}\u0000${item.geography.geography_id}`,
    item,
  ]));
  const reference = loadedAssets[0]?.asset;
  if (!reference) throw new Error("No Canada movement route asset was loaded.");

  const provinces = provinceNodes(siblings);
  const origins: OriginDestinationNode[] = [
    ...provinces,
    { id: "us", label: "United States", shortLabel: "US" },
  ];
  const destinations: OriginDestinationNode[] = [
    ...provinces,
    { id: "us", label: "United States", shortLabel: "US" },
  ];
  const routes: OriginDestinationRouteInput[] = [];
  const sourcePeriods = new Set<string>();
  const productLabels = new Set<string>();
  const modeLabels = new Set<string>();
  const routePairs = new Set<string>();

  for (const loaded of loadedAssets) {
    const identity = `${loaded.series.series_id}\u0000${loaded.geography.geography_id}`;
    const planned = expectedByIdentity.get(identity);
    if (
      !planned
      || loaded.assetPath !== planned.assetPath
      || loaded.asset.series_id !== loaded.series.series_id
      || loaded.asset.geography_id !== loaded.geography.geography_id
    ) {
      throw new Error("A loaded Canada movement asset escaped the validated sibling plan.");
    }
    expectedByIdentity.delete(identity);
    if (
      loaded.asset.unit !== activeSeries.unit
      || loaded.asset.frequency !== activeSeries.frequency
      || loaded.asset.unit !== reference.unit
      || loaded.asset.frequency !== reference.frequency
      || loaded.asset.generated_at !== reference.generated_at
      || loaded.asset.methodology_version !== reference.methodology_version
    ) {
      throw new Error(
        `Canada route ${loaded.geography.label} has incompatible units, frequency, methodology, or source vintage.`,
      );
    }
    const route = movementRouteFromAsset(
      loaded.series,
      loaded.asset,
      loaded.geography,
    );
    if (!route || route.classification === "source-published-aggregate") {
      throw new Error(
        `Canada route dimensions do not match ${loaded.series.series_id}/${loaded.geography.geography_id}.`,
      );
    }
    const originId = endpointId(route.shippingRegion, provinces);
    const destinationId = endpointId(route.receivingRegion, provinces);
    if (!originId || !destinationId) {
      throw new Error(`Canada route ${route.label} has an unregistered endpoint.`);
    }
    const pair = `${originId}\u0000${destinationId}`;
    if (routePairs.has(pair)) {
      throw new Error(`Canada movement siblings repeat route ${route.label}.`);
    }
    routePairs.add(pair);
    productLabels.add(route.product);
    modeLabels.add(route.mode);
    const latestSourcePeriod = loaded.asset.latest_source?.period;
    if (!latestSourcePeriod) {
      throw new Error(`Canada route ${route.label} has no latest source period.`);
    }
    sourcePeriods.add(latestSourcePeriod);
    routes.push({
      id: identity.replace("\u0000", "/"),
      originId,
      destinationId,
      history: statusPreservingHistory(loaded.asset),
    });
  }
  if (expectedByIdentity.size) {
    throw new Error("One or more available Canada movement assets were not loaded.");
  }
  if (sourcePeriods.size !== 1 || productLabels.size !== 1 || modeLabels.size !== 1) {
    throw new Error(
      "Canada movement siblings disagree on source period, product, or transport mode.",
    );
  }
  const latestPeriod = [...sourcePeriods][0]!;
  const periods = [...new Set(routes.flatMap(
    (route) => route.history.map((observation) => observation.period),
  ))].sort();

  return buildOriginDestinationModel({
    id: `canada.${activeSeries.classification!.product_id}.origin-destination`,
    title: "Province-to-province pipeline movements",
    description:
      "Rows are source-published shipping origins and columns are receiving destinations.",
    sourceUnit: activeSeries.unit,
    frequency: activeSeries.frequency,
    productLabel: activeSeries.classification!.product_label,
    modeLabel: "Pipeline",
    sourceNote:
      "Statistics Canada table 25-10-0077-01. Canada aggregate rows overlap provincial routes and are excluded.",
    origins,
    destinations,
    routes,
    periods,
    latestPeriod,
  });
}

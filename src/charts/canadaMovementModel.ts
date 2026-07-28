import {
  movementRouteFromAsset,
  movementRouteLabelFromSelection,
  type CanadaMovementContext,
  type CanadaMovementRoute,
} from "../data/canadaMovement";
import type {
  ManifestGeography,
  UsaChartAsset,
  UsaManifestSeries,
} from "../types/energyAssets";

export interface CanadaMovementAsset {
  geography: ManifestGeography;
  asset: UsaChartAsset;
}

export interface CanadaMovementRow {
  geographyId: string;
  geographyLabel: string;
  routeLabel: string;
  value: number | null;
  status: string;
  previousPeriod: string | null;
  previousValue: number | null;
  route: CanadaMovementRoute | null;
}

export interface CanadaMovementModel {
  period: string;
  rows: CanadaMovementRow[];
  numericRouteCount: number;
  declaredRouteCount: number;
  sourceUnit: string;
  frequency: string;
  mode: string;
  product: string;
}

function isNumeric(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

export function buildCanadaMovementModel(
  series: UsaManifestSeries,
  context: CanadaMovementContext,
  loadedAssets: readonly CanadaMovementAsset[],
): CanadaMovementModel {
  const declared = series.geographies.filter(
    (geography) => geography.level_id === "province_territory",
  );
  if (!declared.length) {
    throw new Error("This movement series declares no provincial route coordinates.");
  }
  const byGeography = new Map<string, CanadaMovementAsset>();
  const referenceAsset = loadedAssets[0]?.asset;
  if (!referenceAsset) {
    throw new Error("No source-published provincial movement asset was loaded.");
  }
  for (const item of loadedAssets) {
    if (byGeography.has(item.geography.geography_id)) {
      throw new Error(`Movement route repeats ${item.geography.label}.`);
    }
    if (
      item.asset.frequency !== series.frequency
      || item.asset.unit !== series.unit
      || item.asset.frequency !== referenceAsset.frequency
      || item.asset.unit !== referenceAsset.unit
      || item.asset.methodology_version !== referenceAsset.methodology_version
      || item.asset.generated_at !== referenceAsset.generated_at
    ) {
      throw new Error(`Movement route ${item.geography.label} has incompatible frequency, units, methodology, or generated vintage.`);
    }
    byGeography.set(item.geography.geography_id, item);
  }
  const sourcePeriods = new Set(loadedAssets.map((item) => (
    item.asset.latest_source?.period
    ?? item.asset.history?.at(-1)?.period
    ?? ""
  )));
  sourcePeriods.delete("");
  if (sourcePeriods.size !== 1) {
    throw new Error("Movement route assets do not share one exact loaded source period.");
  }
  const period = [...sourcePeriods][0];
  if (!period) throw new Error("The loaded movement assets have no source period.");

  const rows = declared.map((geography): CanadaMovementRow => {
    const loaded = byGeography.get(geography.geography_id);
    if (!loaded) {
      if (geography.status === "available" && geography.asset_path) {
        throw new Error(`The published route asset for ${geography.label} was not loaded.`);
      }
      return {
        geographyId: geography.geography_id,
        geographyLabel: geography.label,
        routeLabel: movementRouteLabelFromSelection(context, geography.label),
        value: null,
        status: "no_published_fact",
        previousPeriod: null,
        previousValue: null,
        route: null,
      };
    }
    const route = movementRouteFromAsset(series, loaded.asset, geography);
    if (!route) {
      throw new Error(`The source dimensions for ${geography.label} do not match the selected movement route.`);
    }
    const history = loaded.asset.history ?? [];
    const index = history.findIndex((observation) => observation.period === period);
    const observation = index >= 0 ? history[index]! : undefined;
    const previous = index > 0 ? history[index - 1]! : undefined;
    return {
      geographyId: geography.geography_id,
      geographyLabel: geography.label,
      routeLabel: route.label,
      value: observation && isNumeric(observation.value) ? observation.value : null,
      status: observation?.status ?? geography.reason ?? "no_published_fact",
      previousPeriod: previous?.period ?? null,
      previousValue: previous && isNumeric(previous.value) ? previous.value : null,
      route,
    };
  });

  const firstRoute = rows.find(
    (row): row is CanadaMovementRow & { route: CanadaMovementRoute } => row.route !== null,
  )?.route;
  if (!firstRoute) {
    throw new Error("No loaded movement asset carried a validated route.");
  }
  const routeProducts = new Set(rows.flatMap((row) => row.route ? [row.route.product] : []));
  const routeModes = new Set(rows.flatMap((row) => row.route ? [row.route.mode] : []));
  if (routeProducts.size !== 1 || routeModes.size !== 1) {
    throw new Error("Movement route assets disagree on product or transport mode.");
  }
  return {
    period,
    rows,
    numericRouteCount: rows.filter((row) => isNumeric(row.value)).length,
    declaredRouteCount: rows.length,
    sourceUnit: loadedAssets[0]?.asset.unit ?? series.unit,
    frequency: loadedAssets[0]?.asset.frequency ?? series.frequency,
    mode: firstRoute.mode,
    product: firstRoute.product,
  };
}

import type {
  HistoricalObservation,
  UsaChartAsset,
  UsaManifestSeries,
} from "../types/energyAssets";
import type {
  RegionalContributionGeography,
  RegionalContributionSpec,
} from "../data/regionalContributions";

export interface RegionalContributionAsset {
  geography: RegionalContributionGeography;
  asset: UsaChartAsset;
}

export interface RegionalContributionPoint {
  geographyId: string;
  label: string;
  value: number | null;
  status: string;
  previousPeriod: string | null;
  previousValue: number | null;
  shareOfNational: number | null;
}

export interface RegionalContributionPeriod {
  period: string;
  nationalValue: number | null;
  nationalStatus: string;
  components: RegionalContributionPoint[];
  numericComponentCount: number;
  expectedComponentCount: number;
  componentSum: number;
  complete: boolean;
  reconciliationDifference: number | null;
}

export interface RegionalContributionModel {
  periods: RegionalContributionPeriod[];
  latest: RegionalContributionPeriod;
  sourceUnit: string;
  frequency: string;
  methodologyVersion: string;
}

const NUMERIC_STATUSES = new Set([
  "observed",
  "preliminary",
  "revised",
  "computed",
  "use_with_caution",
]);
const NONNUMERIC_STATUSES = new Set([
  "missing",
  "not_available",
  "not_applicable",
  "suppressed_or_withheld",
  "no_published_fact",
]);

function canonicalDimensions(
  series: UsaManifestSeries,
  dimensions: Record<string, string>,
): string {
  let semanticDimensions = { ...dimensions };
  if (series.source.name === "Statistics Canada") {
    const hasCoordinate = Object.hasOwn(semanticDimensions, "coordinate");
    const hasVector = Object.hasOwn(semanticDimensions, "vector");
    if (hasCoordinate !== hasVector) {
      throw new Error("Statistics Canada contribution assets require both coordinate and vector lineage identifiers.");
    }
    if (hasCoordinate) {
      const { coordinate: _coordinate, vector: _vector, ...rest } = semanticDimensions;
      semanticDimensions = rest;
    }
  }
  return JSON.stringify(Object.fromEntries(
    Object.entries(semanticDimensions).sort(([left], [right]) => left.localeCompare(right)),
  ));
}

function observationMap(asset: UsaChartAsset): Map<string, HistoricalObservation> {
  if (!asset.history?.length) {
    throw new Error(`Regional contribution asset ${asset.geography_id} has no status-preserving history.`);
  }
  const result = new Map<string, HistoricalObservation>();
  for (const observation of asset.history) {
    if (result.has(observation.period)) {
      throw new Error(`Regional contribution asset ${asset.geography_id} repeats ${observation.period}.`);
    }
    const hasNumericValue = numeric(observation.value);
    if (
      (!hasNumericValue && observation.value !== null)
      || (!NUMERIC_STATUSES.has(observation.status) && !NONNUMERIC_STATUSES.has(observation.status))
      || NUMERIC_STATUSES.has(observation.status) !== hasNumericValue
    ) {
      throw new Error(
        `Regional contribution asset ${asset.geography_id} has an incompatible value/status pair at ${observation.period}.`,
      );
    }
    result.set(observation.period, observation);
  }
  return result;
}

function numeric(value: number | null): value is number {
  return value !== null && Number.isFinite(value);
}

function validateAsset(
  series: UsaManifestSeries,
  reference: UsaChartAsset,
  asset: UsaChartAsset,
  geographyId: string,
): void {
  if (asset.series_id !== series.series_id) {
    throw new Error(`Regional contribution asset ${geographyId} belongs to a different series.`);
  }
  if (asset.geography_id !== geographyId) {
    throw new Error(`Regional contribution asset path returned ${asset.geography_id}, expected ${geographyId}.`);
  }
  if (
    asset.frequency !== series.frequency
    || asset.unit !== series.unit
    || asset.frequency !== reference.frequency
    || asset.unit !== reference.unit
  ) {
    throw new Error(`Regional contribution asset ${geographyId} has incompatible frequency or units.`);
  }
  if (asset.methodology_version !== reference.methodology_version) {
    throw new Error(`Regional contribution asset ${geographyId} has incompatible methodology.`);
  }
  if (asset.generated_at !== reference.generated_at) {
    throw new Error(`Regional contribution asset ${geographyId} belongs to a different generated vintage.`);
  }
  if (canonicalDimensions(series, asset.dimensions) !== canonicalDimensions(series, reference.dimensions)) {
    throw new Error(`Regional contribution asset ${geographyId} has incompatible source dimensions.`);
  }
}

function statusAt(
  observations: Map<string, HistoricalObservation>,
  period: string,
): HistoricalObservation {
  return observations.get(period) ?? {
    period,
    year: Number(period.slice(0, 4)),
    slot: 0,
    value: null,
    status: "no_published_fact",
  };
}

/**
 * Aligns the official national series and every authorized component to the
 * exact same source periods. Missing values remain null and the national line
 * is never reconstructed from components.
 */
export function buildRegionalContributionModel(
  series: UsaManifestSeries,
  spec: RegionalContributionSpec,
  nationalAsset: UsaChartAsset,
  componentAssets: readonly RegionalContributionAsset[],
  periodLimit = series.frequency.toLowerCase().startsWith("week") ? 13 : 12,
): RegionalContributionModel {
  if (nationalAsset.geography_id !== spec.nationalGeographyId) {
    throw new Error("The regional contribution reference is not the registered national asset.");
  }
  validateAsset(series, nationalAsset, nationalAsset, spec.nationalGeographyId);
  if (componentAssets.length !== spec.components.length) {
    throw new Error("Not every registered regional contribution asset was loaded.");
  }

  const byGeography = new Map<string, RegionalContributionAsset>();
  for (const item of componentAssets) {
    if (byGeography.has(item.geography.geographyId)) {
      throw new Error(`Regional contribution repeats ${item.geography.geographyId}.`);
    }
    validateAsset(series, nationalAsset, item.asset, item.geography.geographyId);
    byGeography.set(item.geography.geographyId, item);
  }
  for (const geography of spec.components) {
    if (!byGeography.has(geography.geographyId)) {
      throw new Error(`Regional contribution is missing ${geography.label}.`);
    }
  }

  const nationalHistory = observationMap(nationalAsset);
  const orderedNationalPeriods = [...nationalHistory.keys()].sort();
  const latestSourcePeriod = nationalAsset.latest_source?.period
    ?? orderedNationalPeriods.at(-1);
  if (!latestSourcePeriod || !nationalHistory.has(latestSourcePeriod)) {
    throw new Error("The official national source period is absent from its history.");
  }
  const latestIndex = orderedNationalPeriods.indexOf(latestSourcePeriod);
  const periods = orderedNationalPeriods.slice(
    Math.max(0, latestIndex - Math.max(1, periodLimit) + 1),
    latestIndex + 1,
  );
  const componentHistories = new Map(
    [...byGeography.entries()].map(([geographyId, item]) => [
      geographyId,
      observationMap(item.asset),
    ]),
  );

  const models = periods.map((period, periodIndex): RegionalContributionPeriod => {
    const national = statusAt(nationalHistory, period);
    const previousPeriod = periodIndex > 0
      ? periods[periodIndex - 1]!
      : orderedNationalPeriods[orderedNationalPeriods.indexOf(period) - 1] ?? null;
    const components = spec.components.map((geography): RegionalContributionPoint => {
      const history = componentHistories.get(geography.geographyId)!;
      const current = statusAt(history, period);
      const previous = previousPeriod ? statusAt(history, previousPeriod) : null;
      return {
        geographyId: geography.geographyId,
        label: geography.label,
        value: numeric(current.value) ? current.value : null,
        status: current.status,
        previousPeriod,
        previousValue: previous && numeric(previous.value) ? previous.value : null,
        shareOfNational: null,
      };
    });
    const numericComponents = components.filter(
      (component): component is RegionalContributionPoint & { value: number } => numeric(component.value),
    );
    const componentSum = numericComponents.reduce((sum, component) => sum + component.value, 0);
    const nationalValue = numeric(national.value) ? national.value : null;
    const complete = nationalValue !== null && numericComponents.length === components.length;
    const shareEligible = complete && nationalValue !== 0;
    return {
      period,
      nationalValue,
      nationalStatus: national.status,
      components: components.map((component) => ({
        ...component,
        shareOfNational: shareEligible && component.value !== null
          ? (component.value / nationalValue) * 100
          : null,
      })),
      numericComponentCount: numericComponents.length,
      expectedComponentCount: components.length,
      componentSum,
      complete,
      reconciliationDifference: complete ? nationalValue - componentSum : null,
    };
  });

  const latest = models.at(-1);
  if (!latest) throw new Error("The official national series has no contribution periods.");
  return {
    periods: models,
    latest,
    sourceUnit: nationalAsset.unit,
    frequency: nationalAsset.frequency,
    methodologyVersion: nationalAsset.methodology_version,
  };
}

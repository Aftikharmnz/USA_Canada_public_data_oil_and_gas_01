import type { CustomAggregationPolicy } from "../data/customAggregation";
import { atomicMembershipIds } from "../data/geographyContainment";
import type {
  ForecastAsset,
  HistoricalObservation,
  ManifestGeography,
  UsaChartAsset,
  UsaManifestSeries,
} from "../types/energyAssets";
import { buildCustomChartAsset } from "./customChartAnalytics";
import {
  aggregateAdditiveRegionHistory,
  aggregateBottomUpPointForecasts,
  calibrateCombinedPredictionIntervals,
  type AdditiveRegionAggregationPolicy,
  type BottomUpForecastMember,
  type CanonicalObservationStatus,
  type RegionHistoryMember,
  type RegionalForecastResiduals,
} from "./regionAggregation";

const NUMERIC_STATUSES = new Set<CanonicalObservationStatus>([
  "observed",
  "preliminary",
  "revised",
  "computed",
  "use_with_caution",
]);
const ALL_STATUSES = new Set<CanonicalObservationStatus>([
  ...NUMERIC_STATUSES,
  "missing",
  "not_available",
  "not_applicable",
  "suppressed_or_withheld",
]);

export interface CustomRegionViewResult {
  asset: UsaChartAsset;
  geography: ManifestGeography;
  forecast?: ForecastAsset;
  forecastNotice?: string;
}

interface CustomRegionViewInput {
  country: "usa" | "canada";
  series: UsaManifestSeries;
  registryPolicy: CustomAggregationPolicy;
  geographies: ManifestGeography[];
  assets: UsaChartAsset[];
  forecasts?: ForecastAsset[];
}

function canonicalJson(value: Record<string, string>): string {
  return JSON.stringify(Object.fromEntries(Object.entries(value).sort(([left], [right]) => (
    left.localeCompare(right)
  ))));
}

function status(value: string, hasNumericValue: boolean): CanonicalObservationStatus {
  if (!ALL_STATUSES.has(value as CanonicalObservationStatus)) {
    throw new Error(`Custom aggregation cannot use unknown observation status ${value}.`);
  }
  const result = value as CanonicalObservationStatus;
  if (NUMERIC_STATUSES.has(result) !== hasNumericValue) {
    throw new Error(`Custom aggregation found an incompatible value/status pair (${value}).`);
  }
  return result;
}

function normalizedProviderDimensions(
  input: Pick<CustomRegionViewInput, "country" | "series">,
  dimensions: Record<string, string>,
): Record<string, string> {
  if (input.country !== "canada" || input.series.source.name !== "Statistics Canada") {
    return { ...dimensions };
  }
  const hasCoordinate = Object.hasOwn(dimensions, "coordinate");
  const hasVector = Object.hasOwn(dimensions, "vector");
  if (hasCoordinate !== hasVector) {
    throw new Error("Statistics Canada aggregation requires both coordinate and vector lineage identifiers.");
  }
  if (!hasCoordinate) return { ...dimensions };
  const { coordinate: _coordinate, vector: _vector, ...semanticDimensions } = dimensions;
  return semanticDimensions;
}

function compatibleDimensions(input: CustomRegionViewInput): Record<string, string> {
  const first = input.assets[0]?.dimensions;
  if (!first) throw new Error("Custom aggregation requires component dimensions.");
  const normalized = normalizedProviderDimensions(input, first);
  const canonical = canonicalJson(normalized);
  for (const asset of input.assets.slice(1)) {
    if (canonicalJson(normalizedProviderDimensions(input, asset.dimensions)) !== canonical) {
      throw new Error("Selected regions do not share the same source dimensions.");
    }
  }
  return normalized;
}

function buildPolicy(
  input: CustomRegionViewInput,
  dimensions: Record<string, string>,
): AdditiveRegionAggregationPolicy {
  const first = input.assets[0]!;
  const geographyLevel = input.geographies[0]!.level_id;
  if (input.geographies.some((geography) => geography.level_id !== geographyLevel)) {
    throw new Error("Selected regions must use one official geography level.");
  }
  return {
    policy_id: `${input.registryPolicy.membershipNamespace}:${input.series.series_id}:${geographyLevel}`,
    aggregation_kind: "sum",
    quantity_kind: "additive_quantity",
    country_code: input.country,
    series_id: input.series.series_id,
    geography_level_id: geographyLevel,
    frequency: first.frequency,
    unit: first.unit,
    scale_factor: 1,
    period_semantics: `${first.frequency}_source_period`,
    dimensions_hash: canonicalJson(dimensions),
    methodology_regime_id: first.methodology_version,
    membership_version: input.registryPolicy.membershipVersion,
    membership_effective_start: "1900-01-01",
    schema_versions: { history: "1.0.0", forecast: "1.0.0", residuals: "1.0.0" },
    forecast_horizon_periods: 3,
    allowed_members: [...input.geographies]
      .sort((left, right) => left.geography_id.localeCompare(right.geography_id))
      .map((geography) => ({
      geography_id: geography.geography_id,
      label: geography.label,
      // Atomic membership comes from the registered geography DAG, not from the
      // level label. EIA publishes Alaska South at the same state_or_area level
      // as its parent Alaska, so assuming "same level implies disjoint" would
      // silently double-count. See src/data/geographyContainment.ts.
      atomic_membership_ids: atomicMembershipIds(input.country, geography.geography_id),
      })),
  };
}

function historyMember(
  policy: AdditiveRegionAggregationPolicy,
  asset: UsaChartAsset,
): RegionHistoryMember {
  if (!asset.history?.length) {
    throw new Error("This published asset predates period-history support; refresh the data generation first.");
  }
  return {
    schema_version: asset.schema_version,
    series_id: asset.series_id,
    geography_id: asset.geography_id,
    geography_level_id: policy.geography_level_id,
    country_code: policy.country_code,
    frequency: asset.frequency,
    unit: asset.unit,
    scale_factor: policy.scale_factor,
    period_semantics: policy.period_semantics,
    dimensions_hash: policy.dimensions_hash,
    methodology_regime_id: asset.methodology_version,
    membership_version: policy.membership_version,
    source_checksum: asset.source_checksum,
    observations: asset.history.map((observation) => ({
      observation_key: `${asset.series_id}\u0000${asset.geography_id}\u0000${observation.period}`,
      period: observation.period,
      value: observation.value,
      status: status(observation.status, observation.value !== null),
    })),
  };
}

function coordinate(period: string, frequency: string): { year: number; slot: number } {
  if (frequency.toLowerCase().startsWith("month")) {
    const year = Number(period.slice(0, 4));
    const slot = Number(period.slice(5, 7));
    if (!Number.isInteger(year) || !Number.isInteger(slot) || slot < 1 || slot > 12) {
      throw new Error(`Invalid monthly period ${period}.`);
    }
    return { year, slot };
  }
  const date = new Date(`${period}T00:00:00Z`);
  if (!Number.isFinite(date.getTime())) throw new Error(`Invalid weekly period ${period}.`);
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const year = date.getUTCFullYear();
  const first = new Date(Date.UTC(year, 0, 1));
  const slot = Math.ceil((((date.getTime() - first.getTime()) / 86_400_000) + 1) / 7);
  return { year, slot };
}

function forecastMember(
  policy: AdditiveRegionAggregationPolicy,
  forecast: ForecastAsset,
): BottomUpForecastMember {
  if (!forecast.origin.period || forecast.points.length !== 3) {
    throw new Error(`Forecast for ${forecast.geography_id} does not contain the required three periods.`);
  }
  return {
    schema_version: forecast.schema_version,
    series_id: forecast.target_series_id,
    geography_id: forecast.geography_id,
    geography_level_id: policy.geography_level_id,
    country_code: policy.country_code,
    frequency: forecast.frequency,
    unit: forecast.unit,
    scale_factor: policy.scale_factor,
    period_semantics: policy.period_semantics,
    dimensions_hash: policy.dimensions_hash,
    methodology_regime_id: policy.methodology_regime_id,
    membership_version: policy.membership_version,
    methodology_version: forecast.methodology_version,
    origin_period: forecast.origin.period,
    training_source_checksum: forecast.training_source_checksum,
    points: forecast.points.map((point) => ({
      horizon: point.horizon,
      target_period: point.target_period,
      value: point.value,
    })),
  };
}

function residualMember(
  policy: AdditiveRegionAggregationPolicy,
  forecast: ForecastAsset,
): RegionalForecastResiduals {
  const residuals = forecast.aggregation_residuals;
  if (!residuals) throw new Error(`Aligned residuals are unavailable for ${forecast.geography_id}.`);
  return {
    ...forecastMember(policy, forecast),
    method: residuals.method,
    centered_on: residuals.centered_on,
    usage: residuals.usage,
    alignment_keys: residuals.alignment_keys,
    calibration_window: residuals.calibration_window,
    minimum_aligned_samples_per_horizon: residuals.minimum_aligned_samples_per_horizon,
    sample_count: residuals.sample_count,
    samples: residuals.samples,
  };
}

function combineForecast(
  policy: AdditiveRegionAggregationPolicy,
  series: UsaManifestSeries,
  forecasts: ForecastAsset[],
  asset: UsaChartAsset,
): ForecastAsset {
  for (const forecast of forecasts) {
    if (canonicalJson(normalizedProviderDimensions({ country: policy.country_code as "usa" | "canada", series }, forecast.dimensions))
        !== policy.dimensions_hash) {
      throw new Error(`Forecast for ${forecast.geography_id} has incompatible source dimensions.`);
    }
  }
  const pointForecast = aggregateBottomUpPointForecasts(
    policy,
    policy.allowed_members.map((member) => member.geography_id),
    forecasts.map((forecast) => forecastMember(policy, forecast)),
  );
  const calibrated = calibrateCombinedPredictionIntervals(
    policy,
    pointForecast,
    forecasts.map((forecast) => residualMember(policy, forecast)),
  );
  const alignedCounts = Object.values(calibrated.prediction_intervals.aligned_errors_by_horizon);
  return {
    schema_version: "1.0.0",
    target_view_id: series.view_id,
    target_series_id: series.series_id,
    geography_id: calibrated.combination.combination_id,
    dimensions: { ...asset.dimensions },
    frequency: calibrated.frequency,
    unit: calibrated.unit,
    generated_at: asset.generated_at,
    training_source_checksum: asset.source_checksum,
    status: "limited_history",
    methodology_version: calibrated.methodology_version,
    forecast_kind: calibrated.forecast_kind,
    origin: {
      period: calibrated.origin_period,
      value: asset.latest.value ?? undefined,
      generated_at: asset.generated_at,
      information_cutoff: calibrated.origin_period,
      training_observations: 0,
      data_vintage_id: asset.source_checksum,
      vintage_policy: "latest_revised_pseudo_out_of_sample",
    },
    horizon: { periods: 3, unit: calibrated.frequency },
    points: calibrated.points.map((point) => ({
      target_period: point.target_period,
      horizon: point.horizon,
      ...coordinate(point.target_period, calibrated.frequency),
      value: point.value,
      intervals: point.intervals,
      calibration_errors: point.calibration_errors,
    })),
    prediction_intervals: {
      method: calibrated.prediction_intervals.method,
      levels: calibrated.prediction_intervals.levels,
      calibration_window: {
        start: calibrated.prediction_intervals.calibration_period_start,
        end: calibrated.prediction_intervals.calibration_period_end,
      },
      calibration_errors: Math.min(...alignedCounts),
      minimum_errors_per_horizon: 40,
      coverage_guarantee: false,
    },
    backtest: {
      status: "not_available",
      evaluation_mode: "latest_revised_pseudo_out_of_sample",
      evaluation_window: null,
      forecast_errors: 0,
      mae: null,
      rmse: null,
      bias: null,
      directional_accuracy: null,
      interval_coverage: { "80": null, "90": null, "95": null },
      seasonal_naive_mae: null,
      skill_vs_seasonal_naive: null,
      by_horizon: [],
    },
    limitations: [
      "Bottom-up point forecasts add the selected regional projections.",
      "Combined empirical prediction intervals are recalibrated from exact cross-region residual matches; component interval bounds are never summed.",
      "This custom combination has no independent aggregate holdout evaluation.",
      "Latest-revised statistical projection for decision support; not a trading signal or guarantee.",
    ],
  };
}

export async function buildCustomRegionView(
  input: CustomRegionViewInput,
): Promise<CustomRegionViewResult> {
  if (input.geographies.length < input.registryPolicy.minimumMembers
      || input.geographies.length > input.registryPolicy.maximumMembers) {
    throw new Error(
      `Select ${input.registryPolicy.minimumMembers}-${input.registryPolicy.maximumMembers} compatible regions.`,
    );
  }
  if (input.assets.length !== input.geographies.length) {
    throw new Error("Every selected region must have a validated chart asset.");
  }
  const dimensions = compatibleDimensions(input);
  const policy = buildPolicy(input, dimensions);
  const selectedIds = policy.allowed_members.map((member) => member.geography_id);
  const aggregated = aggregateAdditiveRegionHistory(
    policy,
    selectedIds,
    input.assets.map((asset) => historyMember(policy, asset)),
  );
  const history: HistoricalObservation[] = aggregated.observations.map((observation) => ({
    period: observation.period,
    ...coordinate(observation.period, aggregated.frequency),
    value: observation.value,
    status: observation.status,
  }));
  const lastSource = history[history.length - 1];
  const lastNumeric = [...history].reverse().find((observation) => observation.value !== null);
  const freshnessStatuses = input.assets.map((asset) => asset.freshness?.status ?? "unknown");
  const freshnessStatus = freshnessStatuses.every((value) => value === "fresh") ? "fresh" : "unknown";
  const generatedAt = input.assets
    .map((asset) => asset.generated_at)
    .sort()
    .at(-1)!;
  const asset = await buildCustomChartAsset({
    seriesId: input.series.series_id,
    geographyId: aggregated.combination.combination_id,
    dimensions,
    frequency: aggregated.frequency,
    unit: aggregated.unit,
    generatedAt,
    history,
    componentChecksums: aggregated.component_source_checksums,
    freshness: {
      status: freshnessStatus,
      latest_period: lastSource?.period,
      latest_numeric_period: lastNumeric?.period,
      latest_observation_status: lastSource?.status,
      retrieved_at: generatedAt,
    },
    aggregationLineage: {
      aggregation_kind: "sum",
      policy_id: policy.policy_id,
      membership_version: policy.membership_version,
      expected_component_count: selectedIds.length,
      observed_component_count: selectedIds.length,
      coverage_ratio: 1,
      component_geography_ids: selectedIds,
      component_source_checksums: aggregated.component_source_checksums,
      period_lineage: aggregated.observations.map((observation) => ({
        period: observation.period,
        ...observation.lineage,
      })),
    },
  });
  const geography: ManifestGeography = {
    geography_id: aggregated.combination.combination_id,
    label: aggregated.combination.label,
    level_id: policy.geography_level_id,
    level_label: `${input.geographies[0]!.level_label} combination`,
    granularity_rank: input.geographies[0]!.granularity_rank,
    origin: "computed-rollup",
    status: "available",
  };

  if (!input.forecasts || input.forecasts.length !== input.geographies.length) {
    return {
      asset,
      geography,
      forecastNotice: "Observed regions were combined, but every matching component forecast is required for a bottom-up projection.",
    };
  }
  try {
    return { asset, geography, forecast: combineForecast(policy, input.series, input.forecasts, asset) };
  } catch (error) {
    return {
      asset,
      geography,
      forecastNotice: `${error instanceof Error ? error.message : "Combined forecast validation failed"} Observed combined data remain available.`,
    };
  }
}

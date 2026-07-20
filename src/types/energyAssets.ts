export const SUPPORTED_ASSET_SCHEMA = "1.0.0" as const;
export const SUPPORTED_FORECAST_SCHEMA = "1.0.0" as const;

export type FreshnessStatus = "fresh" | "due" | "late" | "stale" | "error" | "unknown";
export type GeographyOrigin = "source-published" | "computed-rollup";

export interface AssetSource {
  name: string;
  url?: string;
  notes?: string;
}

export interface AssetFreshness {
  status: FreshnessStatus;
  latest_period?: string;
  latest_numeric_period?: string;
  latest_observation_status?: string;
  expected_period?: string;
  checked_at?: string;
  retrieved_at?: string;
  source_release_at?: string;
  expected_next_release_at?: string;
  last_success_at?: string;
  error?: string;
}

export interface ManifestGeography {
  geography_id: string;
  label: string;
  level_id: string;
  level_label: string;
  /** Lower values are finer source-supported geographies. */
  granularity_rank?: number;
  origin: GeographyOrigin;
  status: "available" | "unavailable";
  asset_path?: string;
  /** Optional standalone forecast asset for this exact manifest view and geography. */
  forecast_path?: string;
  reason?: string;
}

export interface UnsupportedGeographyLevel {
  level_id: string;
  label: string;
  reason: string;
}

export interface SeriesClassification {
  dashboard_group: string;
  product_family_id: string;
  product_family_label: string;
  product_id: string;
  product_label: string;
  measure_id: string;
  measure_label: string;
  component_role: string;
  parent_product_id: string | null;
  reference_term_ids: string[];
  display_order: number;
}

export interface UsaManifestSeries {
  /** Unique manifest view; multiple dimension slices may share one canonical series_id. */
  view_id: string;
  series_id: string;
  metric_id?: string;
  title: string;
  category: string;
  description?: string;
  unit: string;
  frequency: string;
  source: AssetSource;
  freshness: AssetFreshness;
  classification?: SeriesClassification;
  geographies: ManifestGeography[];
  unsupported_levels: UnsupportedGeographyLevel[];
}

export interface UsaAssetManifest {
  schema_version: typeof SUPPORTED_ASSET_SCHEMA;
  generated_at: string;
  last_success_at?: string;
  status: FreshnessStatus;
  series: UsaManifestSeries[];
}

export interface SeasonalObservation {
  period: string;
  slot: number;
  value: number | null;
  status: string;
}

/** Status-preserving period history used only for validated custom geography aggregation. */
export interface HistoricalObservation extends SeasonalObservation {
  year: number;
}

export interface RecentSeasonalYear {
  year: number;
  points: SeasonalObservation[];
}

export interface BaselineSlot {
  slot: number;
  min: number;
  q1: number;
  median: number;
  mean: number;
  q3: number;
  max: number;
  count: number;
}

export interface SeasonalBaseline {
  status: string;
  baseline_start_year: number | null;
  baseline_end_year: number | null;
  eligible_years: number[];
  eligible_year_count: number;
  excluded_years: number[];
  slots: BaselineSlot[];
}

export interface LatestObservationSummary {
  period: string;
  value: number | null;
  previous_period: string | null;
  absolute_change: number | null;
  percent_change: number | null;
  year_ago_period: string | null;
  yoy_absolute_change: number | null;
  yoy_percent_change: number | null;
  seasonal_median: number | null;
  distance_from_seasonal_median: number | null;
  seasonal_percentile: number | null;
}

export interface LatestSourceObservation {
  period: string;
  value: number | null;
  status: string;
}

export interface HistogramBin {
  lower: number;
  upper: number;
  count: number;
  density?: number;
}

export interface CandidateFit {
  status?: string;
  label?: string;
  best_candidate_among_tested?: string | null;
  selection_note?: string;
  minimum_sample?: number;
  tested_candidates?: Array<{
    name: string;
    aic?: number | null;
  }>;
  reason?: string;
}

export interface DistributionSample {
  status?: string;
  period_start?: string;
  period_end?: string;
  count: number;
  mean: number | null;
  median: number | null;
  stddev: number | null;
  min: number | null;
  q1: number | null;
  q3: number | null;
  max: number | null;
  iqr: number | null;
  skewness: number | null;
  excess_kurtosis: number | null;
  histogram: HistogramBin[];
  fit: CandidateFit | null;
  window?: string;
  exclusions?: string[];
}

export interface AggregationLineage {
  aggregation_kind?: string;
  membership_version?: string;
  expected_component_count?: number;
  observed_component_count?: number;
  coverage_ratio?: number;
  [key: string]: unknown;
}

export interface UsaChartAsset {
  schema_version: typeof SUPPORTED_ASSET_SCHEMA;
  series_id: string;
  geography_id: string;
  dimensions: Record<string, string>;
  frequency: string;
  unit: string;
  generated_at: string;
  source_checksum: string;
  freshness?: AssetFreshness;
  /** Optional for backwards compatibility; current generated assets always publish it. */
  history?: HistoricalObservation[];
  recent_years: RecentSeasonalYear[];
  baseline: SeasonalBaseline;
  latest: LatestObservationSummary;
  latest_source?: LatestSourceObservation;
  distribution: {
    levels: DistributionSample;
    changes: DistributionSample;
  };
  methodology_version: string;
  aggregation_lineage: AggregationLineage | null;
}

export type ForecastStatus =
  | "ok"
  | "limited_history"
  | "insufficient_history"
  | "latest_source_non_numeric"
  | "unsupported_frequency";

export type PredictionIntervalLevel = 80 | 90 | 95;
export type PredictionIntervalKey = "80" | "90" | "95";

export interface ForecastIntervalBounds {
  lower: number;
  upper: number;
}

export interface ForecastPoint {
  target_period: string;
  horizon: number;
  year: number;
  slot: number;
  value: number;
  intervals: Record<PredictionIntervalKey, ForecastIntervalBounds>;
  calibration_errors: number;
}

export interface ForecastOrigin {
  period?: string;
  value?: number;
  /** First compatible observation period after any registered methodology break. */
  regime_start?: string;
  generated_at?: string;
  information_cutoff?: string;
  training_start?: string | null;
  training_end?: string | null;
  training_observations: number;
  data_vintage_id?: string;
  vintage_policy?: string;
}

export interface ForecastModelCandidate {
  model_id: string;
  label: string;
  mae: number;
  forecast_errors: number;
}

export interface ForecastModel {
  model_id: string;
  label: string;
  selection_method: string;
  selection_window: { start: string; end: string };
  candidates: ForecastModelCandidate[];
}

export interface ForecastEvaluationSummary {
  horizon?: number;
  forecast_errors: number;
  mae: number | null;
  rmse: number | null;
  bias: number | null;
  directional_accuracy: number | null;
  interval_coverage: Record<PredictionIntervalKey, number | null>;
}

export interface ForecastBacktest extends ForecastEvaluationSummary {
  status: "independent_holdout" | "not_available";
  evaluation_mode: "latest_revised_pseudo_out_of_sample";
  evaluation_window: { start: string; end: string } | null;
  seasonal_naive_mae: number | null;
  skill_vs_seasonal_naive: number | null;
  by_horizon: ForecastEvaluationSummary[];
}

export interface ForecastPredictionIntervals {
  method: string;
  levels: PredictionIntervalLevel[];
  calibration_window: { start: string; end: string };
  calibration_errors: number;
  minimum_errors_per_horizon: number;
  coverage_guarantee: boolean;
}

export interface ForecastAggregationResidualSample {
  horizon: number;
  target_period: string;
  residual: number;
}

export interface ForecastAggregationResiduals {
  method: "rolling_origin_actual_minus_calibrated_point";
  centered_on: "published_calibrated_point";
  usage: "additive_component_alignment_only";
  alignment_keys: ["horizon", "target_period"];
  calibration_window: { start: string; end: string };
  minimum_aligned_samples_per_horizon: 40;
  sample_count: number;
  samples: ForecastAggregationResidualSample[];
}

export interface ForecastFundamentalDriver {
  role: string;
  series_id: string;
  geography_id: string;
}

/**
 * Disclosure block for a registered accounting-identity candidate. Present only
 * when the target series has a registered fundamental driver set; absence means
 * the candidate set was purely univariate.
 */
export interface ForecastFundamentals {
  status: "candidate_included" | "drivers_incomplete";
  identity: string;
  flow_to_level_factor: number;
  drivers: ForecastFundamentalDriver[];
  notes: string;
  selected?: boolean;
  exclusion_reason?: string;
}

export interface ForecastAsset {
  schema_version: typeof SUPPORTED_FORECAST_SCHEMA;
  target_view_id: string;
  target_series_id: string;
  geography_id: string;
  dimensions: Record<string, string>;
  frequency: string;
  unit: string;
  generated_at: string;
  training_source_checksum: string;
  status: ForecastStatus;
  methodology_version: string;
  forecast_kind: string;
  fundamentals?: ForecastFundamentals;
  reason?: string;
  model?: ForecastModel;
  origin: ForecastOrigin;
  horizon?: { periods: number; unit: string };
  points: ForecastPoint[];
  prediction_intervals?: ForecastPredictionIntervals;
  aggregation_residuals?: ForecastAggregationResiduals;
  backtest?: ForecastBacktest;
  limitations: string[];
}

/**
 * Canada intentionally uses the same versioned public-asset contract as the USA.
 * These aliases keep country-specific frontend code readable without creating a
 * second schema that could drift from the shared contract.
 */
export type CanadaManifestSeries = UsaManifestSeries;
export type CanadaAssetManifest = UsaAssetManifest;
export type CanadaChartAsset = UsaChartAsset;

export type RemoteState<T> =
  | { status: "loading"; data?: T }
  | { status: "ready"; data: T; usingLastKnownGood: false }
  | { status: "stale"; data: T; usingLastKnownGood: true; error: string }
  | { status: "error"; error: string };

import type { CountryCode } from "../types/catalog";
import {
  SUPPORTED_FORECAST_SCHEMA,
  type ForecastAsset,
  type ForecastAggregationResiduals,
  type ForecastBacktest,
  type ForecastEvaluationSummary,
  type ForecastFundamentals,
  type ForecastIntervalBounds,
  type ForecastModel,
  type ForecastOrigin,
  type ForecastPoint,
  type ForecastPredictionIntervals,
  type ForecastStatus,
  type PredictionIntervalKey,
  type RemoteState,
  type UsaChartAsset,
  type UsaManifestSeries,
} from "../types/energyAssets";
import { publicDataUrl, resolveManifestAssetUrl } from "./usaAssets";

const INTERVAL_KEYS = ["80", "90", "95"] as const;
const ACTIVE_FORECAST_STATUSES = new Set<ForecastStatus>(["ok", "limited_history"]);
const forecastLastKnownGood = new Map<string, ForecastAsset>();

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function record(value: unknown, context: string): Record<string, unknown> {
  if (!isRecord(value)) throw new Error(`${context} must be an object.`);
  return value;
}

function array(value: unknown, context: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${context} must be an array.`);
  return value;
}

function string(value: unknown, context: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${context} must be a non-empty string.`);
  }
  return value;
}

function optionalString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function nullableString(value: unknown, context: string): string | null {
  if (value === null || value === undefined) return null;
  return string(value, context);
}

function number(value: unknown, context: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`${context} must be a finite number.`);
  }
  return value;
}

function nullableNumber(value: unknown, context: string): number | null {
  if (value === null || value === undefined) return null;
  return number(value, context);
}

function integer(value: unknown, context: string, minimum = 0): number {
  const parsed = number(value, context);
  if (!Number.isInteger(parsed) || parsed < minimum) {
    throw new Error(`${context} must be an integer greater than or equal to ${minimum}.`);
  }
  return parsed;
}

function boolean(value: unknown, context: string): boolean {
  if (typeof value !== "boolean") throw new Error(`${context} must be a boolean.`);
  return value;
}

function timestamp(value: unknown, context: string): string {
  const parsed = string(value, context);
  if (!/(?:Z|[+-]\d{2}:\d{2})$/i.test(parsed) || Number.isNaN(Date.parse(parsed))) {
    throw new Error(`${context} must be a timezone-aware timestamp.`);
  }
  return parsed;
}

function parseWindow(value: unknown, context: string): { start: string; end: string } {
  const input = record(value, context);
  const start = string(input.start, `${context}.start`);
  const end = string(input.end, `${context}.end`);
  if (start > end) throw new Error(`${context}.start must not be after end.`);
  return { start, end };
}

function parseDimensions(value: unknown): Record<string, string> {
  const input = record(value, "forecast.dimensions");
  return Object.fromEntries(Object.entries(input).map(([key, dimensionValue]) => [
    key,
    string(dimensionValue, `forecast.dimensions.${key}`),
  ]));
}

function exactIntervalRecord(value: unknown, context: string): Record<PredictionIntervalKey, unknown> {
  const input = record(value, context);
  const keys = Object.keys(input).sort();
  if (keys.join(",") !== [...INTERVAL_KEYS].sort().join(",")) {
    throw new Error(`${context} must contain exactly the 80, 90, and 95 levels.`);
  }
  return input as Record<PredictionIntervalKey, unknown>;
}

function parseIntervalBounds(value: unknown, context: string): ForecastIntervalBounds {
  const input = record(value, context);
  const lower = number(input.lower, `${context}.lower`);
  const upper = number(input.upper, `${context}.upper`);
  if (lower > upper) throw new Error(`${context}.lower must not exceed upper.`);
  return { lower, upper };
}

function isoWeekCoordinate(period: string): { year: number; slot: number } {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(period)) {
    throw new Error("Weekly forecast target_period must use YYYY-MM-DD.");
  }
  const parsed = new Date(`${period}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== period) {
    throw new Error(`Weekly forecast target_period ${period} is not a valid date.`);
  }
  const thursday = new Date(parsed);
  const day = (thursday.getUTCDay() + 6) % 7;
  thursday.setUTCDate(thursday.getUTCDate() - day + 3);
  const isoYear = thursday.getUTCFullYear();
  const firstThursday = new Date(Date.UTC(isoYear, 0, 4));
  const firstDay = (firstThursday.getUTCDay() + 6) % 7;
  firstThursday.setUTCDate(firstThursday.getUTCDate() - firstDay + 3);
  const slot = 1 + Math.round((thursday.getTime() - firstThursday.getTime()) / 604_800_000);
  return { year: isoYear, slot };
}

function seasonalCoordinate(period: string, frequency: string): { year: number; slot: number } {
  if (frequency === "monthly") {
    const match = /^(\d{4})-(\d{2})$/.exec(period);
    if (!match) throw new Error("Monthly forecast target_period must use YYYY-MM.");
    const year = Number(match[1]);
    const slot = Number(match[2]);
    if (slot < 1 || slot > 12) throw new Error(`Monthly forecast target_period ${period} is invalid.`);
    return { year, slot };
  }
  return isoWeekCoordinate(period);
}

function nextForecastPeriod(period: string, frequency: string): string {
  if (frequency === "monthly") {
    const coordinate = seasonalCoordinate(period, frequency);
    const nextMonth = coordinate.slot === 12 ? 1 : coordinate.slot + 1;
    const nextYear = coordinate.slot === 12 ? coordinate.year + 1 : coordinate.year;
    return `${nextYear.toString().padStart(4, "0")}-${nextMonth.toString().padStart(2, "0")}`;
  }
  seasonalCoordinate(period, frequency);
  const parsed = new Date(`${period}T00:00:00Z`);
  parsed.setUTCDate(parsed.getUTCDate() + 7);
  return parsed.toISOString().slice(0, 10);
}

function parseForecastPoint(value: unknown, index: number, frequency: string): ForecastPoint {
  const context = `forecast.points[${index}]`;
  const input = record(value, context);
  const targetPeriod = string(input.target_period, `${context}.target_period`);
  const horizon = integer(input.horizon, `${context}.horizon`, 1);
  const year = integer(input.year, `${context}.year`, 1);
  const slot = integer(input.slot, `${context}.slot`, 1);
  const pointValue = number(input.value, `${context}.value`);
  const rawIntervals = exactIntervalRecord(input.intervals, `${context}.intervals`);
  const intervals = Object.fromEntries(INTERVAL_KEYS.map((level) => [
    level,
    parseIntervalBounds(rawIntervals[level], `${context}.intervals.${level}`),
  ])) as Record<PredictionIntervalKey, ForecastIntervalBounds>;
  const coordinate = seasonalCoordinate(targetPeriod, frequency);
  if (coordinate.year !== year || coordinate.slot !== slot) {
    throw new Error(`${context} year/slot does not match target_period.`);
  }
  for (const level of INTERVAL_KEYS) {
    const bounds = intervals[level];
    if (pointValue < bounds.lower || pointValue > bounds.upper) {
      throw new Error(`${context}.value must lie inside its ${level}% prediction interval.`);
    }
  }
  if (
    intervals["95"].lower > intervals["90"].lower
    || intervals["90"].lower > intervals["80"].lower
    || intervals["80"].upper > intervals["90"].upper
    || intervals["90"].upper > intervals["95"].upper
  ) {
    throw new Error(`${context} prediction intervals must be nested from 80% through 95%.`);
  }
  return {
    target_period: targetPeriod,
    horizon,
    year,
    slot,
    value: pointValue,
    intervals,
    calibration_errors: integer(input.calibration_errors, `${context}.calibration_errors`, 1),
  };
}

function parseOrigin(value: unknown): ForecastOrigin {
  const input = record(value, "forecast.origin");
  const output: ForecastOrigin = {
    training_observations: integer(input.training_observations, "forecast.origin.training_observations"),
    training_start: nullableString(input.training_start, "forecast.origin.training_start"),
    training_end: nullableString(input.training_end, "forecast.origin.training_end"),
  };
  const period = optionalString(input.period);
  const regimeStart = optionalString(input.regime_start);
  const generatedAt = optionalString(input.generated_at);
  const informationCutoff = optionalString(input.information_cutoff);
  if (period) output.period = period;
  if (regimeStart) output.regime_start = regimeStart;
  if (input.value !== undefined && input.value !== null) output.value = number(input.value, "forecast.origin.value");
  if (generatedAt) output.generated_at = timestamp(generatedAt, "forecast.origin.generated_at");
  if (informationCutoff) output.information_cutoff = timestamp(informationCutoff, "forecast.origin.information_cutoff");
  const dataVintageId = optionalString(input.data_vintage_id);
  if (dataVintageId) output.data_vintage_id = dataVintageId;
  const vintagePolicy = optionalString(input.vintage_policy);
  if (vintagePolicy) output.vintage_policy = vintagePolicy;
  return output;
}

function parseModel(value: unknown): ForecastModel {
  const input = record(value, "forecast.model");
  return {
    model_id: string(input.model_id, "forecast.model.model_id"),
    label: string(input.label, "forecast.model.label"),
    selection_method: string(input.selection_method, "forecast.model.selection_method"),
    selection_window: parseWindow(input.selection_window, "forecast.model.selection_window"),
    candidates: array(input.candidates, "forecast.model.candidates").map((candidate, index) => {
      const detail = record(candidate, `forecast.model.candidates[${index}]`);
      return {
        model_id: string(detail.model_id, `forecast.model.candidates[${index}].model_id`),
        label: string(detail.label, `forecast.model.candidates[${index}].label`),
        mae: number(detail.mae, `forecast.model.candidates[${index}].mae`),
        forecast_errors: integer(
          detail.forecast_errors,
          `forecast.model.candidates[${index}].forecast_errors`,
          1,
        ),
      };
    }),
  };
}

function parseCoverage(value: unknown, context: string): Record<PredictionIntervalKey, number | null> {
  const input = exactIntervalRecord(value, context);
  return Object.fromEntries(INTERVAL_KEYS.map((level) => {
    const coverage = nullableNumber(input[level], `${context}.${level}`);
    if (coverage !== null && (coverage < 0 || coverage > 1)) {
      throw new Error(`${context}.${level} must be between 0 and 1.`);
    }
    return [level, coverage];
  })) as Record<PredictionIntervalKey, number | null>;
}

function parseEvaluation(value: unknown, context: string, requireHorizon: boolean): ForecastEvaluationSummary {
  const input = record(value, context);
  const summary: ForecastEvaluationSummary = {
    forecast_errors: integer(input.forecast_errors, `${context}.forecast_errors`),
    mae: nullableNumber(input.mae, `${context}.mae`),
    rmse: nullableNumber(input.rmse, `${context}.rmse`),
    bias: nullableNumber(input.bias, `${context}.bias`),
    directional_accuracy: nullableNumber(input.directional_accuracy, `${context}.directional_accuracy`),
    interval_coverage: parseCoverage(input.interval_coverage, `${context}.interval_coverage`),
  };
  if (summary.directional_accuracy !== null
    && (summary.directional_accuracy < 0 || summary.directional_accuracy > 1)) {
    throw new Error(`${context}.directional_accuracy must be between 0 and 1.`);
  }
  if (requireHorizon) summary.horizon = integer(input.horizon, `${context}.horizon`, 1);
  return summary;
}

function parseBacktest(value: unknown): ForecastBacktest {
  const input = record(value, "forecast.backtest");
  const status = string(input.status, "forecast.backtest.status");
  if (status !== "independent_holdout" && status !== "not_available") {
    throw new Error("forecast.backtest.status is unsupported.");
  }
  const evaluationMode = string(input.evaluation_mode, "forecast.backtest.evaluation_mode");
  if (evaluationMode !== "latest_revised_pseudo_out_of_sample") {
    throw new Error("forecast.backtest.evaluation_mode is unsupported.");
  }
  const evaluationWindow = input.evaluation_window === null
    ? null
    : parseWindow(input.evaluation_window, "forecast.backtest.evaluation_window");
  const summary = parseEvaluation(input, "forecast.backtest", false);
  return {
    ...summary,
    status,
    evaluation_mode: evaluationMode,
    evaluation_window: evaluationWindow,
    seasonal_naive_mae: nullableNumber(input.seasonal_naive_mae, "forecast.backtest.seasonal_naive_mae"),
    skill_vs_seasonal_naive: nullableNumber(
      input.skill_vs_seasonal_naive,
      "forecast.backtest.skill_vs_seasonal_naive",
    ),
    by_horizon: array(input.by_horizon, "forecast.backtest.by_horizon").map(
      (item, index) => parseEvaluation(item, `forecast.backtest.by_horizon[${index}]`, true),
    ),
  };
}

function parsePredictionIntervals(value: unknown): ForecastPredictionIntervals {
  const input = record(value, "forecast.prediction_intervals");
  const levels = array(input.levels, "forecast.prediction_intervals.levels").map(
    (level, index) => integer(level, `forecast.prediction_intervals.levels[${index}]`, 1),
  );
  if (levels.join(",") !== "80,90,95") {
    throw new Error("forecast.prediction_intervals.levels must be exactly 80, 90, and 95.");
  }
  return {
    method: string(input.method, "forecast.prediction_intervals.method"),
    levels: [80, 90, 95],
    calibration_window: parseWindow(
      input.calibration_window,
      "forecast.prediction_intervals.calibration_window",
    ),
    calibration_errors: integer(
      input.calibration_errors,
      "forecast.prediction_intervals.calibration_errors",
      1,
    ),
    minimum_errors_per_horizon: integer(
      input.minimum_errors_per_horizon,
      "forecast.prediction_intervals.minimum_errors_per_horizon",
      40,
    ),
    coverage_guarantee: boolean(
      input.coverage_guarantee,
      "forecast.prediction_intervals.coverage_guarantee",
    ),
  };
}

function parseAggregationResiduals(
  value: unknown,
  frequency: string,
): ForecastAggregationResiduals | undefined {
  if (value === undefined || value === null) return undefined;
  const input = record(value, "forecast.aggregation_residuals");
  if (
    input.method !== "rolling_origin_actual_minus_calibrated_point"
    || input.centered_on !== "published_calibrated_point"
    || input.usage !== "additive_component_alignment_only"
  ) {
    throw new Error("forecast.aggregation_residuals metadata is unsupported.");
  }
  const keys = array(input.alignment_keys, "forecast.aggregation_residuals.alignment_keys").map(String);
  if (keys.join(",") !== "horizon,target_period") {
    throw new Error("forecast.aggregation_residuals alignment keys must be horizon and target_period.");
  }
  const calibrationWindow = parseWindow(
    input.calibration_window,
    "forecast.aggregation_residuals.calibration_window",
  );
  const minimum = integer(
    input.minimum_aligned_samples_per_horizon,
    "forecast.aggregation_residuals.minimum_aligned_samples_per_horizon",
    40,
  );
  if (minimum !== 40) {
    throw new Error("forecast.aggregation_residuals requires 40 aligned samples per horizon.");
  }
  const samples = array(input.samples, "forecast.aggregation_residuals.samples").map(
    (value, index) => {
      const sample = record(value, `forecast.aggregation_residuals.samples[${index}]`);
      const targetPeriod = string(
        sample.target_period,
        `forecast.aggregation_residuals.samples[${index}].target_period`,
      );
      seasonalCoordinate(targetPeriod, frequency);
      if (targetPeriod < calibrationWindow.start || targetPeriod > calibrationWindow.end) {
        throw new Error("forecast.aggregation_residuals sample is outside the calibration window.");
      }
      return {
        horizon: integer(
          sample.horizon,
          `forecast.aggregation_residuals.samples[${index}].horizon`,
          1,
        ),
        target_period: targetPeriod,
        residual: number(
          sample.residual,
          `forecast.aggregation_residuals.samples[${index}].residual`,
        ),
      };
    },
  );
  if (integer(input.sample_count, "forecast.aggregation_residuals.sample_count") !== samples.length) {
    throw new Error("forecast.aggregation_residuals sample_count does not match samples.");
  }
  const orderedKeys = samples.map((sample) => `${sample.horizon}\u0000${sample.target_period}`);
  if (orderedKeys.join("\u0001") !== [...new Set(orderedKeys)].sort().join("\u0001")) {
    throw new Error("forecast.aggregation_residuals samples must be unique and ordered.");
  }
  return {
    method: "rolling_origin_actual_minus_calibrated_point",
    centered_on: "published_calibrated_point",
    usage: "additive_component_alignment_only",
    alignment_keys: ["horizon", "target_period"],
    calibration_window: calibrationWindow,
    minimum_aligned_samples_per_horizon: 40,
    sample_count: samples.length,
    samples,
  };
}

const FORECAST_KINDS = new Set([
  "univariate_statistical_projection",
  "fundamentals_augmented_statistical_projection",
]);

function parseFundamentals(value: unknown): ForecastFundamentals | undefined {
  if (value === undefined || value === null) return undefined;
  const input = record(value, "forecast.fundamentals");
  const status = string(input.status, "forecast.fundamentals.status");
  if (status !== "candidate_included" && status !== "drivers_incomplete") {
    throw new Error(`forecast.fundamentals.status is unsupported: ${status}.`);
  }
  const drivers = array(input.drivers, "forecast.fundamentals.drivers").map((driver, index) => {
    const detail = record(driver, `forecast.fundamentals.drivers[${index}]`);
    return {
      role: string(detail.role, `forecast.fundamentals.drivers[${index}].role`),
      series_id: string(detail.series_id, `forecast.fundamentals.drivers[${index}].series_id`),
      geography_id: string(
        detail.geography_id,
        `forecast.fundamentals.drivers[${index}].geography_id`,
      ),
    };
  });
  if (!drivers.length) throw new Error("forecast.fundamentals.drivers must not be empty.");
  const output: ForecastFundamentals = {
    status,
    identity: string(input.identity, "forecast.fundamentals.identity"),
    flow_to_level_factor: number(
      input.flow_to_level_factor,
      "forecast.fundamentals.flow_to_level_factor",
    ),
    drivers,
    notes: string(input.notes, "forecast.fundamentals.notes"),
  };
  if (input.selected !== undefined) {
    output.selected = boolean(input.selected, "forecast.fundamentals.selected");
  }
  const exclusionReason = optionalString(input.exclusion_reason);
  if (exclusionReason) output.exclusion_reason = exclusionReason;
  if (status === "drivers_incomplete" && !exclusionReason) {
    throw new Error("forecast.fundamentals.exclusion_reason is required when drivers are incomplete.");
  }
  return output;
}

export function parseForecastAsset(value: unknown): ForecastAsset {
  const input = record(value, "forecast asset");
  if (input.schema_version !== SUPPORTED_FORECAST_SCHEMA) {
    throw new Error(
      `Unsupported forecast asset schema: ${String(input.schema_version)}. Expected ${SUPPORTED_FORECAST_SCHEMA}.`,
    );
  }
  const status = string(input.status, "forecast.status") as ForecastStatus;
  if (!["ok", "limited_history", "insufficient_history", "latest_source_non_numeric", "unsupported_frequency"].includes(status)) {
    throw new Error(`Unsupported forecast status: ${status}.`);
  }
  const frequency = string(input.frequency, "forecast.frequency").toLowerCase();
  if (frequency !== "weekly" && frequency !== "monthly") {
    throw new Error("forecast.frequency must be weekly or monthly.");
  }
  const checksum = string(input.training_source_checksum, "forecast.training_source_checksum");
  if (!/^[a-f\d]{64}$/i.test(checksum)) {
    throw new Error("forecast.training_source_checksum must be a SHA-256 checksum.");
  }
  const origin = parseOrigin(input.origin);
  const aggregationResiduals = parseAggregationResiduals(input.aggregation_residuals, frequency);
  const points = array(input.points, "forecast.points").map(
    (point, index) => parseForecastPoint(point, index, frequency),
  );
  for (const [index, point] of points.entries()) {
    if (point.horizon !== index + 1) {
      throw new Error("forecast.points horizons must be consecutive and start at 1.");
    }
    if (index > 0 && points[index - 1]!.target_period >= point.target_period) {
      throw new Error("forecast.points target periods must be unique and chronological.");
    }
    if (index > 0
      && point.target_period !== nextForecastPeriod(points[index - 1]!.target_period, frequency)) {
      throw new Error("forecast.points must contain consecutive source periods.");
    }
  }
  const limitations = array(input.limitations, "forecast.limitations").map(
    (item, index) => string(item, `forecast.limitations[${index}]`),
  );
  const base: ForecastAsset = {
    schema_version: SUPPORTED_FORECAST_SCHEMA,
    target_view_id: string(input.target_view_id, "forecast.target_view_id"),
    target_series_id: string(input.target_series_id, "forecast.target_series_id"),
    geography_id: string(input.geography_id, "forecast.geography_id"),
    dimensions: parseDimensions(input.dimensions),
    frequency,
    unit: string(input.unit, "forecast.unit"),
    generated_at: timestamp(input.generated_at, "forecast.generated_at"),
    training_source_checksum: checksum,
    status,
    methodology_version: string(input.methodology_version, "forecast.methodology_version"),
    forecast_kind: string(input.forecast_kind, "forecast.forecast_kind"),
    origin,
    points,
    limitations,
    ...(aggregationResiduals ? { aggregation_residuals: aggregationResiduals } : {}),
  };
  if (!FORECAST_KINDS.has(base.forecast_kind)) {
    throw new Error(`Unsupported forecast kind: ${base.forecast_kind}.`);
  }
  const fundamentals = parseFundamentals(input.fundamentals);
  if (fundamentals) base.fundamentals = fundamentals;
  if (
    base.forecast_kind === "fundamentals_augmented_statistical_projection"
    && ACTIVE_FORECAST_STATUSES.has(status)
    && fundamentals?.status !== "candidate_included"
  ) {
    throw new Error(
      "A fundamentals-augmented forecast must disclose its included driver set.",
    );
  }
  if (!ACTIVE_FORECAST_STATUSES.has(status)) {
    if (points.length) throw new Error(`${status} forecast assets must not contain points.`);
    return { ...base, reason: string(input.reason, "forecast.reason") };
  }
  if (!origin.period || origin.value === undefined || !origin.generated_at
    || !origin.information_cutoff || !origin.data_vintage_id || !origin.vintage_policy) {
    throw new Error("Available forecasts require a complete origin record.");
  }
  seasonalCoordinate(origin.period, frequency);
  if (origin.regime_start) {
    seasonalCoordinate(origin.regime_start, frequency);
    if (origin.regime_start > origin.period) {
      throw new Error("forecast.origin.regime_start must not be after the forecast origin.");
    }
  }
  if (origin.data_vintage_id !== checksum) {
    throw new Error("forecast origin data_vintage_id must equal training_source_checksum.");
  }
  if (points.length === 0 || points[0]!.target_period <= origin.period) {
    throw new Error("Available forecasts require future target points after the origin.");
  }
  if (points[0]!.target_period !== nextForecastPeriod(origin.period, frequency)) {
    throw new Error("The first forecast point must be the next source period after the origin.");
  }
  const horizonInput = record(input.horizon, "forecast.horizon");
  const horizon = {
    periods: integer(horizonInput.periods, "forecast.horizon.periods", 1),
    unit: string(horizonInput.unit, "forecast.horizon.unit"),
  };
  if (horizon.periods !== 3 || points.length !== 3) {
    throw new Error("Active forecasts must contain exactly 3 source periods.");
  }
  if (horizon.unit.toLowerCase() !== frequency) {
    throw new Error("forecast.horizon unit must match the published frequency.");
  }
  return {
    ...base,
    model: parseModel(input.model),
    horizon,
    prediction_intervals: parsePredictionIntervals(input.prediction_intervals),
    backtest: parseBacktest(input.backtest),
  };
}

export function forecastIsRenderable(forecast: ForecastAsset | undefined): boolean {
  return Boolean(
    forecast
    && ACTIVE_FORECAST_STATUSES.has(forecast.status)
    && forecast.points.length
    && forecast.model
    && forecast.horizon
    && forecast.prediction_intervals
    && forecast.backtest,
  );
}

export function forecastMismatchReason(
  forecast: ForecastAsset,
  observed: UsaChartAsset,
  series: UsaManifestSeries,
  geographyId: string,
): string | null {
  if (forecast.target_view_id !== series.view_id) return "Forecast view does not match the selected product and measure.";
  if (forecast.target_series_id !== series.series_id || forecast.target_series_id !== observed.series_id) {
    return "Forecast series does not match the observed series.";
  }
  if (forecast.geography_id !== geographyId || forecast.geography_id !== observed.geography_id) {
    return "Forecast geography does not match the selected official region.";
  }
  if (forecast.frequency.toLowerCase() !== observed.frequency.toLowerCase()) {
    return "Forecast frequency does not match the observed asset.";
  }
  if (forecast.unit !== observed.unit) return "Forecast unit does not match the observed asset.";
  if (forecast.training_source_checksum !== observed.source_checksum) {
    return "Forecast training data no longer match the latest observed asset.";
  }
  if (forecast.origin.period && forecast.origin.period !== observed.latest.period) {
    return "Forecast origin is older than the latest numeric observation.";
  }
  return null;
}

export function forecastAssetUrl(country: CountryCode, forecastPath: string): string {
  return resolveManifestAssetUrl(
    forecastPath,
    publicDataUrl(`data/${country}/manifest.json`),
  );
}

export async function fetchForecastAsset(
  country: CountryCode,
  forecastPath: string,
  signal?: AbortSignal,
): Promise<RemoteState<ForecastAsset>> {
  let url: string;
  try {
    url = forecastAssetUrl(country, forecastPath);
  } catch (error) {
    return { status: "error", error: error instanceof Error ? error.message : "Invalid forecast path." };
  }
  try {
    const response = await fetch(url, {
      signal,
      cache: "no-cache",
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`Forecast request failed with HTTP ${response.status}.`);
    const parsed = parseForecastAsset(await response.json());
    forecastLastKnownGood.set(url, parsed);
    return { status: "ready", data: parsed, usingLastKnownGood: false };
  } catch (error) {
    if (signal?.aborted) throw error;
    const message = error instanceof Error ? error.message : "The forecast asset could not be loaded.";
    const cached = forecastLastKnownGood.get(url);
    return cached
      ? { status: "stale", data: cached, usingLastKnownGood: true, error: message }
      : { status: "error", error: message };
  }
}

export function clearForecastMemoryCache(): void {
  forecastLastKnownGood.clear();
}

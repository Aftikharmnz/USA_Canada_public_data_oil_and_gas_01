/**
 * Strict client-side primitives for custom geographic combinations.
 *
 * This module deliberately works from aligned canonical period observations.
 * It must not be used to add already-derived seasonal bands, histograms, or
 * component prediction-interval endpoints.
 */

export type CanonicalObservationStatus =
  | "observed"
  | "preliminary"
  | "revised"
  | "computed"
  | "use_with_caution"
  | "missing"
  | "not_available"
  | "not_applicable"
  | "suppressed_or_withheld";

export type RegionAggregationErrorCode =
  | "invalid_policy"
  | "selection_too_small"
  | "duplicate_member"
  | "unknown_member"
  | "overlapping_members"
  | "missing_member_history"
  | "metadata_mismatch"
  | "duplicate_observation"
  | "invalid_observation"
  | "membership_period_mismatch"
  | "incomplete_forecast"
  | "interval_residuals_required"
  | "insufficient_aligned_residuals";

export class RegionAggregationError extends Error {
  readonly code: RegionAggregationErrorCode;

  constructor(code: RegionAggregationErrorCode, message: string) {
    super(message);
    this.name = "RegionAggregationError";
    this.code = code;
  }
}

export interface AdditivePolicyMember {
  geography_id: string;
  label: string;
  /**
   * Stable, mutually exclusive atomic territories represented by this node.
   * Intersections between selected nodes make the combination invalid.
   */
  atomic_membership_ids: readonly string[];
}

export interface AdditiveRegionAggregationPolicy {
  policy_id: string;
  aggregation_kind: "sum";
  quantity_kind: "additive_quantity";
  country_code: string;
  series_id: string;
  geography_level_id: string;
  frequency: string;
  unit: string;
  scale_factor: number;
  period_semantics: string;
  dimensions_hash: string;
  methodology_regime_id: string;
  membership_version: string;
  membership_effective_start: string;
  membership_effective_end?: string;
  schema_versions: {
    history: string;
    forecast: string;
    residuals: string;
  };
  forecast_horizon_periods: 3;
  allowed_members: readonly AdditivePolicyMember[];
}

export interface RegionCombinationDescriptor {
  combination_id: string;
  label: string;
  origin: "computed-rollup";
  policy_id: string;
  country_code: string;
  geography_level_id: string;
  membership_version: string;
  component_geography_ids: string[];
}

export interface RegionPeriodObservation {
  observation_key: string;
  period: string;
  value: number | null;
  status: CanonicalObservationStatus;
}

interface CompatibleRegionMember {
  schema_version: string;
  series_id: string;
  geography_id: string;
  geography_level_id: string;
  country_code: string;
  frequency: string;
  unit: string;
  scale_factor: number;
  period_semantics: string;
  dimensions_hash: string;
  methodology_regime_id: string;
  membership_version: string;
}

export interface RegionHistoryMember extends CompatibleRegionMember {
  source_checksum: string;
  observations: readonly RegionPeriodObservation[];
}

export interface AggregationLineageComponent {
  geography_id: string;
  observation_key: string | null;
  present: boolean;
  value: number | null;
  status: CanonicalObservationStatus;
}

export interface AggregatedPeriodLineage {
  aggregation_kind: "sum";
  policy_id: string;
  input_series_ids: string[];
  membership_version: string;
  expected_component_count: number;
  observed_component_count: number;
  coverage_ratio: number;
  component_observation_keys: string[];
  component_statuses: CanonicalObservationStatus[];
  blocking_statuses: CanonicalObservationStatus[];
  validation_result: "passed" | "failed_complete_coverage";
  components: AggregationLineageComponent[];
}

export interface AggregatedRegionPeriod {
  period: string;
  value: number | null;
  status: "computed" | Exclude<CanonicalObservationStatus, "computed">;
  lineage: AggregatedPeriodLineage;
}

export interface AggregatedRegionHistory {
  combination: RegionCombinationDescriptor;
  series_id: string;
  frequency: string;
  unit: string;
  scale_factor: number;
  period_semantics: string;
  dimensions_hash: string;
  methodology_regime_id: string;
  component_source_checksums: Record<string, string>;
  observations: AggregatedRegionPeriod[];
}

export interface BottomUpForecastPointInput {
  horizon: number;
  target_period: string;
  value: number;
  /** Present on provider forecast assets, but never combined directly. */
  intervals?: unknown;
}

export interface BottomUpForecastMember extends CompatibleRegionMember {
  methodology_version: string;
  origin_period: string;
  training_source_checksum: string;
  points: readonly BottomUpForecastPointInput[];
}

export interface BottomUpForecastPoint {
  horizon: number;
  target_period: string;
  value: number;
  component_values: Array<{
    geography_id: string;
    value: number;
    training_source_checksum: string;
  }>;
}

export interface UnavailableCombinedIntervals {
  status: "unavailable";
  reason: string;
}

export interface BottomUpPointForecast {
  forecast_kind: "bottom_up_custom_geography_projection";
  combination: RegionCombinationDescriptor;
  series_id: string;
  frequency: string;
  unit: string;
  methodology_version: string;
  origin_period: string;
  points: BottomUpForecastPoint[];
  prediction_intervals: UnavailableCombinedIntervals;
}

export interface AlignedResidualSample {
  target_period: string;
  horizon: number;
  /** Actual minus forecast, in the canonical unit. */
  residual: number;
}

export interface RegionalForecastResiduals extends CompatibleRegionMember {
  methodology_version: string;
  method: "rolling_origin_actual_minus_calibrated_point";
  centered_on: "published_calibrated_point";
  usage: "additive_component_alignment_only";
  alignment_keys: readonly ["horizon", "target_period"];
  calibration_window: { start: string; end: string };
  minimum_aligned_samples_per_horizon: 40;
  sample_count: number;
  samples: readonly AlignedResidualSample[];
}

export type PredictionIntervalKey = "80" | "90" | "95";

export interface CombinedPredictionIntervalBounds {
  lower: number;
  upper: number;
}

export interface CalibratedBottomUpForecastPoint extends BottomUpForecastPoint {
  calibration_errors: number;
  intervals: Record<PredictionIntervalKey, CombinedPredictionIntervalBounds>;
}

export interface CalibratedBottomUpForecast extends Omit<BottomUpPointForecast, "points" | "prediction_intervals"> {
  points: CalibratedBottomUpForecastPoint[];
  prediction_intervals: {
    status: "calibrated";
    method: "aligned_component_residual_sum_empirical_quantiles";
    levels: [80, 90, 95];
    minimum_errors_per_horizon: 40;
    coverage_guarantee: false;
    aligned_errors_by_horizon: Record<string, number>;
    calibration_period_start: string;
    calibration_period_end: string;
  };
}

const NUMERIC_STATUSES = new Set<CanonicalObservationStatus>([
  "observed",
  "preliminary",
  "revised",
  "computed",
  "use_with_caution",
]);

const NONNUMERIC_STATUS_PRECEDENCE: readonly CanonicalObservationStatus[] = [
  "suppressed_or_withheld",
  "not_applicable",
  "not_available",
  "missing",
];

const ALL_STATUSES = new Set<CanonicalObservationStatus>([
  ...NUMERIC_STATUSES,
  ...NONNUMERIC_STATUS_PRECEDENCE,
]);

function fail(code: RegionAggregationErrorCode, message: string): never {
  throw new RegionAggregationError(code, message);
}

function requireNonEmpty(value: string, field: string): void {
  if (!value.trim()) fail("invalid_policy", `${field} must be a non-empty string.`);
}

function looksLikePercentageUnit(unit: string): boolean {
  return /(^|[_\s-])(percent|percentage|pct|percentage_points?)([_\s-]|$)|%/i.test(unit);
}

function validatePolicy(policy: AdditiveRegionAggregationPolicy): void {
  if (policy.aggregation_kind !== "sum" || policy.quantity_kind !== "additive_quantity") {
    fail("invalid_policy", "Custom region aggregation requires an explicitly additive sum policy.");
  }
  for (const [field, value] of Object.entries({
    policy_id: policy.policy_id,
    country_code: policy.country_code,
    series_id: policy.series_id,
    geography_level_id: policy.geography_level_id,
    frequency: policy.frequency,
    unit: policy.unit,
    period_semantics: policy.period_semantics,
    dimensions_hash: policy.dimensions_hash,
    methodology_regime_id: policy.methodology_regime_id,
    membership_version: policy.membership_version,
    membership_effective_start: policy.membership_effective_start,
    history_schema_version: policy.schema_versions.history,
    forecast_schema_version: policy.schema_versions.forecast,
    residual_schema_version: policy.schema_versions.residuals,
  })) {
    requireNonEmpty(value, field);
  }
  if (!Number.isFinite(policy.scale_factor) || policy.scale_factor <= 0) {
    fail("invalid_policy", "scale_factor must be a finite positive number.");
  }
  if (looksLikePercentageUnit(policy.unit)) {
    fail("invalid_policy", `Unit ${policy.unit} is not additive; percentages require a registered ratio-of-sums policy.`);
  }
  if (policy.forecast_horizon_periods !== 3) {
    fail("invalid_policy", "The current forecasting contract requires exactly 3 source periods.");
  }
  if (policy.membership_effective_end && policy.membership_effective_end < policy.membership_effective_start) {
    fail("invalid_policy", "membership_effective_end cannot precede membership_effective_start.");
  }
  if (policy.allowed_members.length < 2) {
    fail("invalid_policy", "An additive policy must register at least two members.");
  }
  const memberIds = new Set<string>();
  for (const member of policy.allowed_members) {
    requireNonEmpty(member.geography_id, "allowed_members.geography_id");
    requireNonEmpty(member.label, `allowed member ${member.geography_id} label`);
    if (memberIds.has(member.geography_id)) {
      fail("invalid_policy", `Policy contains duplicate member ${member.geography_id}.`);
    }
    memberIds.add(member.geography_id);
    if (!member.atomic_membership_ids.length) {
      fail("invalid_policy", `Policy member ${member.geography_id} has no atomic membership IDs.`);
    }
    const atoms = new Set<string>();
    for (const atom of member.atomic_membership_ids) {
      requireNonEmpty(atom, `atomic membership for ${member.geography_id}`);
      if (atoms.has(atom)) {
        fail("invalid_policy", `Policy member ${member.geography_id} repeats atomic membership ${atom}.`);
      }
      atoms.add(atom);
    }
  }
}

function canonicalMembers(
  policy: AdditiveRegionAggregationPolicy,
  selectedGeographyIds: readonly string[],
): AdditivePolicyMember[] {
  validatePolicy(policy);
  if (selectedGeographyIds.length < 2) {
    fail("selection_too_small", "Select at least two registered regions to create a combined view.");
  }
  const selected = new Set<string>();
  for (const geographyId of selectedGeographyIds) {
    if (selected.has(geographyId)) {
      fail("duplicate_member", `Region ${geographyId} was selected more than once.`);
    }
    selected.add(geographyId);
  }
  const allowed = new Set(policy.allowed_members.map((member) => member.geography_id));
  for (const geographyId of selected) {
    if (!allowed.has(geographyId)) {
      fail("unknown_member", `Region ${geographyId} is not authorized by policy ${policy.policy_id}.`);
    }
  }
  const members = policy.allowed_members.filter((member) => selected.has(member.geography_id));
  const atoms = new Map<string, string>();
  for (const member of members) {
    for (const atom of member.atomic_membership_ids) {
      const existing = atoms.get(atom);
      if (existing) {
        fail(
          "overlapping_members",
          `Regions ${existing} and ${member.geography_id} overlap at membership atom ${atom}.`,
        );
      }
      atoms.set(atom, member.geography_id);
    }
  }
  return members;
}

export function createRegionCombination(
  policy: AdditiveRegionAggregationPolicy,
  selectedGeographyIds: readonly string[],
): RegionCombinationDescriptor {
  const members = canonicalMembers(policy, selectedGeographyIds);
  const encodedIds = members.map((member) => encodeURIComponent(member.geography_id));
  return {
    combination_id: `computed:${policy.policy_id}:${encodedIds.join("+")}`,
    label: members.map((member) => member.label).join(" + "),
    origin: "computed-rollup",
    policy_id: policy.policy_id,
    country_code: policy.country_code,
    geography_level_id: policy.geography_level_id,
    membership_version: policy.membership_version,
    component_geography_ids: members.map((member) => member.geography_id),
  };
}

function mismatch(geographyId: string, field: string, actual: unknown, expected: unknown): never {
  return fail(
    "metadata_mismatch",
    `Region ${geographyId} has incompatible ${field}: ${String(actual)}; expected ${String(expected)}.`,
  );
}

function validateCompatibleMember(
  policy: AdditiveRegionAggregationPolicy,
  member: CompatibleRegionMember,
  expectedSchema: string,
): void {
  const expected: Record<string, unknown> = {
    schema_version: expectedSchema,
    series_id: policy.series_id,
    geography_level_id: policy.geography_level_id,
    country_code: policy.country_code,
    frequency: policy.frequency,
    unit: policy.unit,
    scale_factor: policy.scale_factor,
    period_semantics: policy.period_semantics,
    dimensions_hash: policy.dimensions_hash,
    methodology_regime_id: policy.methodology_regime_id,
    membership_version: policy.membership_version,
  };
  const actual = member as unknown as Record<string, unknown>;
  for (const [field, expectedValue] of Object.entries(expected)) {
    if (actual[field] !== expectedValue) mismatch(member.geography_id, field, actual[field], expectedValue);
  }
}

function orderAndValidateMembers<T extends CompatibleRegionMember>(
  policy: AdditiveRegionAggregationPolicy,
  selectedGeographyIds: readonly string[],
  inputs: readonly T[],
  expectedSchema: string,
): { combination: RegionCombinationDescriptor; members: T[] } {
  const combination = createRegionCombination(policy, selectedGeographyIds);
  const selected = new Set(combination.component_geography_ids);
  const byId = new Map<string, T>();
  for (const input of inputs) {
    if (byId.has(input.geography_id)) {
      fail("duplicate_member", `Region ${input.geography_id} was supplied more than once.`);
    }
    if (!selected.has(input.geography_id)) {
      fail(
        "unknown_member",
        `Region ${input.geography_id} was supplied but is not part of the selected combination.`,
      );
    }
    validateCompatibleMember(policy, input, expectedSchema);
    byId.set(input.geography_id, input);
  }
  const members = combination.component_geography_ids.map((geographyId) => {
    const member = byId.get(geographyId);
    if (!member) fail("missing_member_history", `Region ${geographyId} has no component data.`);
    return member;
  });
  return { combination, members };
}

function validateMembershipPeriod(policy: AdditiveRegionAggregationPolicy, period: string): void {
  if (period < policy.membership_effective_start
      || (policy.membership_effective_end !== undefined && period > policy.membership_effective_end)) {
    fail(
      "membership_period_mismatch",
      `Period ${period} is outside membership version ${policy.membership_version}.`,
    );
  }
}

function validateObservation(observation: RegionPeriodObservation, geographyId: string): void {
  if (!observation.period.trim() || !observation.observation_key.trim()) {
    fail("invalid_observation", `Region ${geographyId} contains an observation without a period or key.`);
  }
  if (!ALL_STATUSES.has(observation.status)) {
    fail("invalid_observation", `Region ${geographyId} has unknown status ${String(observation.status)}.`);
  }
  const numeric = observation.value !== null;
  if (numeric && !Number.isFinite(observation.value)) {
    fail("invalid_observation", `Region ${geographyId}, period ${observation.period} has a non-finite value.`);
  }
  if (numeric !== NUMERIC_STATUSES.has(observation.status)) {
    fail(
      "invalid_observation",
      `Region ${geographyId}, period ${observation.period} has incompatible value and status ${observation.status}.`,
    );
  }
}

function aggregateBlockingStatus(statuses: readonly CanonicalObservationStatus[]): Exclude<CanonicalObservationStatus, "computed"> {
  for (const status of NONNUMERIC_STATUS_PRECEDENCE) {
    if (statuses.includes(status)) return status as Exclude<CanonicalObservationStatus, "computed">;
  }
  return "missing";
}

export function aggregateAdditiveRegionHistory(
  policy: AdditiveRegionAggregationPolicy,
  selectedGeographyIds: readonly string[],
  inputs: readonly RegionHistoryMember[],
): AggregatedRegionHistory {
  const { combination, members } = orderAndValidateMembers(
    policy,
    selectedGeographyIds,
    inputs,
    policy.schema_versions.history,
  );
  const observationsByMember = new Map<string, Map<string, RegionPeriodObservation>>();
  const globalObservationKeys = new Set<string>();
  const allPeriods = new Set<string>();

  for (const member of members) {
    const byPeriod = new Map<string, RegionPeriodObservation>();
    for (const observation of member.observations) {
      validateObservation(observation, member.geography_id);
      validateMembershipPeriod(policy, observation.period);
      if (byPeriod.has(observation.period) || globalObservationKeys.has(observation.observation_key)) {
        fail(
          "duplicate_observation",
          `Duplicate observation identity for ${member.geography_id}, period ${observation.period}.`,
        );
      }
      byPeriod.set(observation.period, observation);
      globalObservationKeys.add(observation.observation_key);
      allPeriods.add(observation.period);
    }
    observationsByMember.set(member.geography_id, byPeriod);
  }

  const observations: AggregatedRegionPeriod[] = [...allPeriods].sort().map((period) => {
    const components: AggregationLineageComponent[] = members.map((member) => {
      const observation = observationsByMember.get(member.geography_id)!.get(period);
      return observation
        ? {
            geography_id: member.geography_id,
            observation_key: observation.observation_key,
            present: true,
            value: observation.value,
            status: observation.status,
          }
        : {
            geography_id: member.geography_id,
            observation_key: null,
            present: false,
            value: null,
            status: "missing",
          };
    });
    const usable = components.filter(
      (component): component is AggregationLineageComponent & { value: number } =>
        component.value !== null && NUMERIC_STATUSES.has(component.status),
    );
    const blockingStatuses = components
      .filter((component) => component.value === null)
      .map((component) => component.status);
    const complete = usable.length === members.length;
    const lineage: AggregatedPeriodLineage = {
      aggregation_kind: "sum",
      policy_id: policy.policy_id,
      input_series_ids: [policy.series_id],
      membership_version: policy.membership_version,
      expected_component_count: members.length,
      observed_component_count: usable.length,
      coverage_ratio: usable.length / members.length,
      component_observation_keys: components
        .flatMap((component) => component.observation_key ? [component.observation_key] : []),
      component_statuses: components.map((component) => component.status),
      blocking_statuses: [...new Set(blockingStatuses)],
      validation_result: complete ? "passed" : "failed_complete_coverage",
      components,
    };
    return complete
      ? {
          period,
          value: usable.reduce((sum, component) => sum + component.value, 0),
          status: "computed" as const,
          lineage,
        }
      : {
          period,
          value: null,
          status: aggregateBlockingStatus(blockingStatuses),
          lineage,
        };
  });

  return {
    combination,
    series_id: policy.series_id,
    frequency: policy.frequency,
    unit: policy.unit,
    scale_factor: policy.scale_factor,
    period_semantics: policy.period_semantics,
    dimensions_hash: policy.dimensions_hash,
    methodology_regime_id: policy.methodology_regime_id,
    component_source_checksums: Object.fromEntries(
      members.map((member) => [member.geography_id, member.source_checksum]),
    ),
    observations,
  };
}

function validateForecastPoint(point: BottomUpForecastPointInput, geographyId: string): void {
  if (!Number.isInteger(point.horizon) || point.horizon < 1 || !point.target_period.trim()
      || !Number.isFinite(point.value)) {
    fail("incomplete_forecast", `Region ${geographyId} contains an invalid forecast point.`);
  }
}

export function aggregateBottomUpPointForecasts(
  policy: AdditiveRegionAggregationPolicy,
  selectedGeographyIds: readonly string[],
  inputs: readonly BottomUpForecastMember[],
): BottomUpPointForecast {
  const { combination, members } = orderAndValidateMembers(
    policy,
    selectedGeographyIds,
    inputs,
    policy.schema_versions.forecast,
  );
  const methodologyVersion = members[0]!.methodology_version;
  const originPeriod = members[0]!.origin_period;
  requireNonEmpty(methodologyVersion, "forecast methodology_version");
  requireNonEmpty(originPeriod, "forecast origin_period");
  const pointsByMember = new Map<string, Map<number, BottomUpForecastPointInput>>();

  for (const member of members) {
    if (member.methodology_version !== methodologyVersion) {
      mismatch(member.geography_id, "methodology_version", member.methodology_version, methodologyVersion);
    }
    if (member.origin_period !== originPeriod) {
      mismatch(member.geography_id, "origin_period", member.origin_period, originPeriod);
    }
    const byHorizon = new Map<number, BottomUpForecastPointInput>();
    for (const point of member.points) {
      validateForecastPoint(point, member.geography_id);
      if (byHorizon.has(point.horizon)) {
        fail("incomplete_forecast", `Region ${member.geography_id} repeats forecast horizon ${point.horizon}.`);
      }
      byHorizon.set(point.horizon, point);
    }
    const expectedHorizons = Array.from({ length: policy.forecast_horizon_periods }, (_, index) => index + 1);
    if (byHorizon.size !== expectedHorizons.length
        || expectedHorizons.some((horizon) => !byHorizon.has(horizon))) {
      fail(
        "incomplete_forecast",
        `Region ${member.geography_id} must provide exactly horizons 1-${policy.forecast_horizon_periods}.`,
      );
    }
    pointsByMember.set(member.geography_id, byHorizon);
  }

  const points: BottomUpForecastPoint[] = Array.from(
    { length: policy.forecast_horizon_periods },
    (_, index) => index + 1,
  ).map((horizon) => {
    const componentPoints = members.map((member) => ({
      member,
      point: pointsByMember.get(member.geography_id)!.get(horizon)!,
    }));
    const targetPeriod = componentPoints[0]!.point.target_period;
    for (const { member, point } of componentPoints) {
      if (point.target_period !== targetPeriod) {
        mismatch(member.geography_id, `target_period for horizon ${horizon}`, point.target_period, targetPeriod);
      }
    }
    return {
      horizon,
      target_period: targetPeriod,
      value: componentPoints.reduce((sum, component) => sum + component.point.value, 0),
      component_values: componentPoints.map(({ member, point }) => ({
        geography_id: member.geography_id,
        value: point.value,
        training_source_checksum: member.training_source_checksum,
      })),
    };
  });

  return {
    forecast_kind: "bottom_up_custom_geography_projection",
    combination,
    series_id: policy.series_id,
    frequency: policy.frequency,
    unit: policy.unit,
    methodology_version: methodologyVersion,
    origin_period: originPeriod,
    points,
    prediction_intervals: {
      status: "unavailable",
      reason: "Component interval endpoints are not additive. Aligned component residual samples are required to calibrate combined empirical prediction intervals.",
    },
  };
}

function residualKey(sample: AlignedResidualSample): string {
  return `${sample.horizon}\u0000${sample.target_period}`;
}

function quantile(values: readonly number[], probability: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex]!;
  const upper = sorted[upperIndex]!;
  return lower + (upper - lower) * (position - lowerIndex);
}

function validateResidualSample(
  sample: AlignedResidualSample,
  member: RegionalForecastResiduals,
  forecastOrigin: string,
): void {
  if (!sample.target_period.trim() || !Number.isInteger(sample.horizon) || sample.horizon < 1
      || !Number.isFinite(sample.residual)) {
    fail("invalid_observation", `Region ${member.geography_id} contains an invalid residual sample.`);
  }
  if (sample.target_period < member.calibration_window.start
      || sample.target_period > member.calibration_window.end) {
    fail(
      "metadata_mismatch",
      `Region ${member.geography_id} residual target ${sample.target_period} is outside its calibration window.`,
    );
  }
  if (sample.target_period > forecastOrigin) {
    fail(
      "metadata_mismatch",
      `Region ${member.geography_id} residual target ${sample.target_period} exceeds forecast origin ${forecastOrigin}.`,
    );
  }
}

/**
 * Calibrate asymmetric empirical intervals from exact cross-region residual
 * matches. This function intentionally throws when residuals are absent or
 * fewer than 40 are aligned for any forecast horizon.
 */
export function calibrateCombinedPredictionIntervals(
  policy: AdditiveRegionAggregationPolicy,
  forecast: BottomUpPointForecast,
  residualInputs?: readonly RegionalForecastResiduals[],
): CalibratedBottomUpForecast {
  if (!residualInputs?.length) {
    fail(
      "interval_residuals_required",
      "Combined prediction intervals require aligned residual samples; component interval endpoints cannot be added.",
    );
  }
  const { combination, members } = orderAndValidateMembers(
    policy,
    forecast.combination.component_geography_ids,
    residualInputs,
    policy.schema_versions.residuals,
  );
  if (combination.combination_id !== forecast.combination.combination_id
      || forecast.series_id !== policy.series_id
      || forecast.frequency !== policy.frequency
      || forecast.unit !== policy.unit) {
    fail("metadata_mismatch", "Residual policy, selected combination, and point forecast do not match.");
  }
  const samplesByMember = new Map<string, Map<string, AlignedResidualSample>>();
  for (const member of members) {
    if (member.methodology_version !== forecast.methodology_version) {
      mismatch(
        member.geography_id,
        "methodology_version",
        member.methodology_version,
        forecast.methodology_version,
      );
    }
    if (member.method !== "rolling_origin_actual_minus_calibrated_point"
        || member.centered_on !== "published_calibrated_point"
        || member.usage !== "additive_component_alignment_only"
        || member.alignment_keys.length !== 2
        || member.alignment_keys[0] !== "horizon"
        || member.alignment_keys[1] !== "target_period"
        || member.minimum_aligned_samples_per_horizon !== 40) {
      fail(
        "metadata_mismatch",
        `Region ${member.geography_id} residual metadata is not authorized for additive alignment.`,
      );
    }
    if (!member.calibration_window.start || !member.calibration_window.end
        || member.calibration_window.start > member.calibration_window.end) {
      fail("metadata_mismatch", `Region ${member.geography_id} has an invalid calibration window.`);
    }
    if (member.sample_count !== member.samples.length) {
      mismatch(member.geography_id, "sample_count", member.sample_count, member.samples.length);
    }
    const samples = new Map<string, AlignedResidualSample>();
    for (const sample of member.samples) {
      validateResidualSample(sample, member, forecast.origin_period);
      const key = residualKey(sample);
      if (samples.has(key)) {
        fail(
          "duplicate_observation",
          `Region ${member.geography_id} repeats residual target ${sample.target_period}, horizon ${sample.horizon}.`,
        );
      }
      samples.set(key, sample);
    }
    samplesByMember.set(member.geography_id, samples);
  }

  const firstSamples = samplesByMember.get(members[0]!.geography_id)!;
  const combinedByHorizon = new Map<number, Array<{ target: string; residual: number }>>();
  for (const [key, firstSample] of firstSamples) {
    const matched = members.map((member) => samplesByMember.get(member.geography_id)!.get(key));
    if (matched.some((sample) => sample === undefined)) continue;
    const samples = matched as AlignedResidualSample[];
    const list = combinedByHorizon.get(firstSample.horizon) ?? [];
    list.push({
      target: firstSample.target_period,
      residual: samples.reduce((sum, sample) => sum + sample.residual, 0),
    });
    combinedByHorizon.set(firstSample.horizon, list);
  }

  const levels: Array<{ key: PredictionIntervalKey; lower: number; upper: number }> = [
    { key: "80", lower: 0.10, upper: 0.90 },
    { key: "90", lower: 0.05, upper: 0.95 },
    { key: "95", lower: 0.025, upper: 0.975 },
  ];
  const allTargets: string[] = [];
  const alignedErrorsByHorizon: Record<string, number> = {};
  const points: CalibratedBottomUpForecastPoint[] = forecast.points.map((point) => {
    const aligned = combinedByHorizon.get(point.horizon) ?? [];
    if (aligned.length < 40) {
      fail(
        "insufficient_aligned_residuals",
        `Horizon ${point.horizon} has ${aligned.length} aligned residuals; at least 40 are required.`,
      );
    }
    allTargets.push(...aligned.map((sample) => sample.target));
    alignedErrorsByHorizon[String(point.horizon)] = aligned.length;
    const residuals = aligned.map((sample) => sample.residual);
    const intervals = Object.fromEntries(levels.map((level) => [
      level.key,
      {
        lower: point.value + quantile(residuals, level.lower),
        upper: point.value + quantile(residuals, level.upper),
      },
    ])) as Record<PredictionIntervalKey, CombinedPredictionIntervalBounds>;
    return { ...point, calibration_errors: aligned.length, intervals };
  });
  allTargets.sort();

  return {
    ...forecast,
    points,
    prediction_intervals: {
      status: "calibrated",
      method: "aligned_component_residual_sum_empirical_quantiles",
      levels: [80, 90, 95],
      minimum_errors_per_horizon: 40,
      coverage_guarantee: false,
      aligned_errors_by_horizon: alignedErrorsByHorizon,
      calibration_period_start: allTargets[0]!,
      calibration_period_end: allTargets[allTargets.length - 1]!,
    },
  };
}

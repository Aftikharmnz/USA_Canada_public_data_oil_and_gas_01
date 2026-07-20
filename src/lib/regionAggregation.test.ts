import { describe, expect, it } from "vitest";
import {
  aggregateAdditiveRegionHistory,
  aggregateBottomUpPointForecasts,
  calibrateCombinedPredictionIntervals,
  createRegionCombination,
  RegionAggregationError,
  type AdditiveRegionAggregationPolicy,
  type BottomUpForecastMember,
  type RegionHistoryMember,
  type RegionalForecastResiduals,
} from "./regionAggregation";

const policy: AdditiveRegionAggregationPolicy = {
  policy_id: "can.statcan.test.province-sum.v1",
  aggregation_kind: "sum",
  quantity_kind: "additive_quantity",
  country_code: "CAN",
  series_id: "can.statcan.test.monthly",
  geography_level_id: "province",
  frequency: "monthly",
  unit: "cubic_metres",
  scale_factor: 1,
  period_semantics: "calendar_month_total",
  dimensions_hash: "product=crude|measure=volume",
  methodology_regime_id: "current",
  membership_version: "can-provinces-2026-v1",
  membership_effective_start: "2020-01",
  schema_versions: {
    history: "history-1.0.0",
    forecast: "forecast-1.0.0",
    residuals: "forecast-residuals-1.0.0",
  },
  forecast_horizon_periods: 3,
  allowed_members: [
    { geography_id: "can:ab", label: "Alberta", atomic_membership_ids: ["ca-ab"] },
    { geography_id: "can:sk", label: "Saskatchewan", atomic_membership_ids: ["ca-sk"] },
    { geography_id: "can:bc", label: "British Columbia", atomic_membership_ids: ["ca-bc"] },
  ],
};

const selectedRegions = ["can:ab", "can:sk"] as const;

function compatibleFields(geographyId: string) {
  return {
    series_id: policy.series_id,
    geography_id: geographyId,
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
}

function history(
  geographyId: string,
  observations: RegionHistoryMember["observations"],
  overrides: Partial<RegionHistoryMember> = {},
): RegionHistoryMember {
  return {
    schema_version: policy.schema_versions.history,
    ...compatibleFields(geographyId),
    source_checksum: `sha-${geographyId}`,
    observations,
    ...overrides,
  };
}

function observed(geographyId: string, period: string, value: number) {
  return {
    observation_key: `${policy.series_id}|${period}|${geographyId}|${policy.dimensions_hash}`,
    period,
    value,
    status: "observed" as const,
  };
}

function forecast(
  geographyId: string,
  values: readonly [number, number, number],
  overrides: Partial<BottomUpForecastMember> = {},
): BottomUpForecastMember {
  return {
    schema_version: policy.schema_versions.forecast,
    ...compatibleFields(geographyId),
    methodology_version: "2026-07-20.4",
    origin_period: "2026-04",
    training_source_checksum: `forecast-sha-${geographyId}`,
    points: values.map((value, index) => ({
      horizon: index + 1,
      target_period: `2026-${String(index + 5).padStart(2, "0")}`,
      value,
      // Component interval endpoints exist on provider forecasts but are not additive.
      intervals: { "90": { lower: value - 10, upper: value + 10 } },
    })),
    ...overrides,
  };
}

function monthlyPeriod(index: number): string {
  const year = 2019 + Math.floor(index / 12);
  const month = index % 12 + 1;
  return `${year}-${String(month).padStart(2, "0")}`;
}

function residuals(
  geographyId: string,
  multiplier: number,
  count = 40,
  overrides: Partial<RegionalForecastResiduals> = {},
): RegionalForecastResiduals {
  const samples = Array.from({ length: count }, (_, originIndex) =>
    Array.from({ length: 3 }, (_, horizonIndex) => ({
      target_period: monthlyPeriod(originIndex + horizonIndex + 1),
      horizon: horizonIndex + 1,
      residual: (originIndex - 19.5) * multiplier,
    }))).flat();
  return {
    schema_version: policy.schema_versions.residuals,
    ...compatibleFields(geographyId),
    methodology_version: "2026-07-20.4",
    method: "rolling_origin_actual_minus_calibrated_point",
    centered_on: "published_calibrated_point",
    usage: "additive_component_alignment_only",
    alignment_keys: ["horizon", "target_period"],
    calibration_window: { start: monthlyPeriod(1), end: monthlyPeriod(count + 2) },
    minimum_aligned_samples_per_horizon: 40,
    sample_count: samples.length,
    samples,
    ...overrides,
  };
}

function expectCode(callback: () => unknown, code: RegionAggregationError["code"]): void {
  try {
    callback();
  } catch (error) {
    expect(error).toBeInstanceOf(RegionAggregationError);
    expect((error as RegionAggregationError).code).toBe(code);
    return;
  }
  throw new Error(`Expected RegionAggregationError(${code}).`);
}

describe("createRegionCombination", () => {
  it("uses registry order to create a deterministic ID and label", () => {
    const first = createRegionCombination(policy, ["can:sk", "can:ab"]);
    const reversed = createRegionCombination(policy, ["can:ab", "can:sk"]);

    expect(first).toEqual(reversed);
    expect(first.combination_id).toBe(
      "computed:can.statcan.test.province-sum.v1:can%3Aab+can%3Ask",
    );
    expect(first.label).toBe("Alberta + Saskatchewan");
    expect(first.origin).toBe("computed-rollup");
  });

  it("rejects duplicate, unknown, and overlapping members", () => {
    expectCode(() => createRegionCombination(policy, ["can:ab", "can:ab"]), "duplicate_member");
    expectCode(() => createRegionCombination(policy, ["can:ab", "can:on"]), "unknown_member");

    const overlapping: AdditiveRegionAggregationPolicy = {
      ...policy,
      allowed_members: [
        policy.allowed_members[0]!,
        { geography_id: "can:west", label: "West", atomic_membership_ids: ["ca-ab", "ca-sk"] },
      ],
    };
    expectCode(
      () => createRegionCombination(overlapping, ["can:ab", "can:west"]),
      "overlapping_members",
    );
  });

  it("refuses percentages even when a caller labels them as additive", () => {
    const percentPolicy = { ...policy, unit: "percent" };
    expectCode(() => createRegionCombination(percentPolicy, ["can:ab", "can:sk"]), "invalid_policy");
  });
});

describe("aggregateAdditiveRegionHistory", () => {
  it("sums only complete aligned periods and retains exact blocking statuses in lineage", () => {
    const result = aggregateAdditiveRegionHistory(policy, selectedRegions, [
      history("can:sk", [
        observed("can:sk", "2026-01", 5),
        observed("can:sk", "2026-02", 6),
        observed("can:sk", "2026-03", 7),
      ]),
      history("can:ab", [
        observed("can:ab", "2026-01", 10),
        {
          observation_key: "ab-suppressed-2026-02",
          period: "2026-02",
          value: null,
          status: "suppressed_or_withheld",
        },
        // 2026-03 is absent rather than zero-filled.
      ]),
    ]);

    expect(result.combination.label).toBe("Alberta + Saskatchewan");
    expect(result.observations[0]).toMatchObject({
      period: "2026-01",
      value: 15,
      status: "computed",
      lineage: {
        expected_component_count: 2,
        observed_component_count: 2,
        coverage_ratio: 1,
        validation_result: "passed",
      },
    });
    expect(result.observations[1]).toMatchObject({
      period: "2026-02",
      value: null,
      status: "suppressed_or_withheld",
      lineage: {
        observed_component_count: 1,
        coverage_ratio: 0.5,
        blocking_statuses: ["suppressed_or_withheld"],
        validation_result: "failed_complete_coverage",
      },
    });
    expect(result.observations[2]).toMatchObject({
      period: "2026-03",
      value: null,
      status: "missing",
    });
    expect(result.observations[2]!.lineage.components).toContainEqual({
      geography_id: "can:ab",
      observation_key: null,
      present: false,
      value: null,
      status: "missing",
    });
  });

  it.each([
    ["schema_version", { schema_version: "history-2.0.0" }],
    ["unit", { unit: "thousand_cubic_metres" }],
    ["frequency", { frequency: "weekly" }],
    ["period_semantics", { period_semantics: "month_end" }],
    ["dimensions_hash", { dimensions_hash: "different" }],
    ["membership_version", { membership_version: "old-membership" }],
  ])("rejects incompatible member %s", (_field, overrides) => {
    const ab = history("can:ab", [observed("can:ab", "2026-01", 10)], overrides);
    const sk = history("can:sk", [observed("can:sk", "2026-01", 5)]);
    expectCode(
      () => aggregateAdditiveRegionHistory(policy, selectedRegions, [ab, sk]),
      "metadata_mismatch",
    );
  });

  it("rejects duplicate periods and incompatible null/status pairs", () => {
    const duplicate = observed("can:ab", "2026-01", 10);
    expectCode(
      () => aggregateAdditiveRegionHistory(policy, selectedRegions, [
        history("can:ab", [duplicate, { ...duplicate, observation_key: "another-key" }]),
        history("can:sk", [observed("can:sk", "2026-01", 5)]),
      ]),
      "duplicate_observation",
    );

    expectCode(
      () => aggregateAdditiveRegionHistory(policy, selectedRegions, [
        history("can:ab", [{ ...duplicate, value: null }]),
        history("can:sk", [observed("can:sk", "2026-01", 5)]),
      ]),
      "invalid_observation",
    );
  });

  it("fails closed when a selected region history did not load", () => {
    expectCode(
      () => aggregateAdditiveRegionHistory(policy, selectedRegions, [
        history("can:ab", [observed("can:ab", "2026-01", 10)]),
      ]),
      "missing_member_history",
    );
  });

  it("rejects observations outside the registered membership window", () => {
    expectCode(
      () => aggregateAdditiveRegionHistory(policy, selectedRegions, [
        history("can:ab", [observed("can:ab", "2019-12", 10)]),
        history("can:sk", [observed("can:sk", "2019-12", 5)]),
      ]),
      "membership_period_mismatch",
    );
  });
});

describe("bottom-up combined forecasts", () => {
  it("adds point forecasts while explicitly leaving component intervals unavailable", () => {
    const combined = aggregateBottomUpPointForecasts(policy, selectedRegions, [
      forecast("can:sk", [2, 3, 4]),
      forecast("can:ab", [10, 11, 12]),
    ]);

    expect(combined.points.map((point) => point.value)).toEqual([12, 14, 16]);
    expect(combined.points[0]!.component_values.map((component) => component.geography_id)).toEqual([
      "can:ab",
      "can:sk",
    ]);
    expect(combined.prediction_intervals).toMatchObject({
      status: "unavailable",
      reason: expect.stringMatching(/not additive.*aligned component residual/i),
    });
    expect(combined.points[0]).not.toHaveProperty("intervals");
  });

  it("rejects missing horizons and mismatched target periods", () => {
    const short = forecast("can:ab", [10, 11, 12], {
      points: forecast("can:ab", [10, 11, 12]).points.slice(0, 2),
    });
    expectCode(
      () => aggregateBottomUpPointForecasts(
        policy,
        selectedRegions,
        [short, forecast("can:sk", [2, 3, 4])],
      ),
      "incomplete_forecast",
    );

    const mismatched = forecast("can:ab", [10, 11, 12]);
    mismatched.points = mismatched.points.map((point, index) =>
      index === 1 ? { ...point, target_period: "2026-12" } : point);
    expectCode(
      () => aggregateBottomUpPointForecasts(
        policy,
        selectedRegions,
        [mismatched, forecast("can:sk", [2, 3, 4])],
      ),
      "metadata_mismatch",
    );
  });

  it("refuses interval calibration without at least 40 exactly aligned errors per horizon", () => {
    const combined = aggregateBottomUpPointForecasts(policy, selectedRegions, [
      forecast("can:ab", [10, 11, 12]),
      forecast("can:sk", [2, 3, 4]),
    ]);

    expectCode(
      () => calibrateCombinedPredictionIntervals(policy, combined),
      "interval_residuals_required",
    );
    expectCode(
      () => calibrateCombinedPredictionIntervals(policy, combined, [
        residuals("can:ab", 1, 39),
        residuals("can:sk", 1, 39),
      ]),
      "insufficient_aligned_residuals",
    );
  });

  it("calibrates asymmetric empirical intervals from aligned sums of component residuals", () => {
    const combined = aggregateBottomUpPointForecasts(policy, selectedRegions, [
      forecast("can:ab", [20, 21, 22]),
      forecast("can:sk", [10, 11, 12]),
    ]);
    const calibrated = calibrateCombinedPredictionIntervals(policy, combined, [
      residuals("can:sk", 1),
      residuals("can:ab", 1),
    ]);

    expect(calibrated.prediction_intervals).toMatchObject({
      status: "calibrated",
      levels: [80, 90, 95],
      minimum_errors_per_horizon: 40,
      coverage_guarantee: false,
      aligned_errors_by_horizon: { "1": 40, "2": 40, "3": 40 },
    });
    expect(calibrated.points[0]).toMatchObject({
      value: 30,
      calibration_errors: 40,
    });
    expect(calibrated.points[0]!.intervals["80"].lower).toBeCloseTo(-1.2);
    expect(calibrated.points[0]!.intervals["80"].upper).toBeCloseTo(61.2);
    expect(calibrated.points[0]!.intervals["90"].lower).toBeLessThan(
      calibrated.points[0]!.intervals["80"].lower,
    );
    expect(calibrated.points[0]!.intervals["95"].upper).toBeGreaterThan(
      calibrated.points[0]!.intervals["90"].upper,
    );
  });

  it("counts only exact cross-region horizon/target residual matches", () => {
    const combined = aggregateBottomUpPointForecasts(policy, selectedRegions, [
      forecast("can:ab", [20, 21, 22]),
      forecast("can:sk", [10, 11, 12]),
    ]);
    const sk = residuals("can:sk", 1);
    sk.samples = sk.samples.map((sample, index) =>
      index === 0 ? { ...sample, target_period: "2022-07" } : sample);

    expectCode(
      () => calibrateCombinedPredictionIntervals(policy, combined, [residuals("can:ab", 1), sk]),
      "insufficient_aligned_residuals",
    );
  });
});

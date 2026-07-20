import { describe, expect, it } from "vitest";
import type { CustomAggregationPolicy } from "../data/customAggregation";
import type {
  DistributionSample,
  ForecastAsset,
  HistoricalObservation,
  ManifestGeography,
  UsaChartAsset,
  UsaManifestSeries,
} from "../types/energyAssets";
import {
  CUSTOM_AGGREGATION_METHODOLOGY_VERSION,
} from "./customChartAnalytics";
import { buildCustomRegionView } from "./customRegionView";

const SERIES_ID = "can.statcan.test.monthly";
const DIMENSIONS = { product: "crude_oil", measure: "production" };

const alberta: ManifestGeography = {
  geography_id: "can:province:ab",
  label: "Alberta",
  level_id: "province_territory",
  level_label: "Province / territory",
  granularity_rank: 10,
  origin: "source-published",
  status: "available",
};

const saskatchewan: ManifestGeography = {
  geography_id: "can:province:sk",
  label: "Saskatchewan",
  level_id: "province_territory",
  level_label: "Province / territory",
  granularity_rank: 10,
  origin: "source-published",
  status: "available",
};

const series: UsaManifestSeries = {
  view_id: "can-test-monthly",
  series_id: SERIES_ID,
  title: "Test crude oil production",
  category: "Crude",
  unit: "cubic_metres",
  frequency: "monthly",
  source: { name: "Statistics Canada" },
  freshness: { status: "fresh", latest_period: "2026-04" },
  geographies: [alberta, saskatchewan],
  unsupported_levels: [],
};

const registryPolicy: CustomAggregationPolicy = {
  country: "canada",
  levelId: "province_territory",
  rule: "sum",
  membershipNamespace: "computed:canada:province-sum",
  membershipVersion: "2026-07-20.1",
  minimumMembers: 2,
  maximumMembers: 13,
  requiredCoverage: 1,
  seriesIds: [SERIES_ID],
};

function emptyDistribution(): DistributionSample {
  return {
    count: 0,
    mean: null,
    median: null,
    stddev: null,
    min: null,
    q1: null,
    q3: null,
    max: null,
    iqr: null,
    skewness: null,
    excess_kurtosis: null,
    histogram: [],
    fit: null,
  };
}

function chartAsset(
  geography: ManifestGeography,
  history: HistoricalObservation[],
  generatedAt = "2026-07-20T10:00:00Z",
): UsaChartAsset {
  const numeric = history.filter(
    (point): point is HistoricalObservation & { value: number } => point.value !== null,
  );
  const latest = numeric.at(-1)!;
  const latestSource = history.at(-1)!;
  return {
    schema_version: "1.0.0",
    series_id: SERIES_ID,
    geography_id: geography.geography_id,
    dimensions: { ...DIMENSIONS },
    frequency: "monthly",
    unit: "cubic_metres",
    generated_at: generatedAt,
    source_checksum: `sha-${geography.geography_id}`,
    freshness: {
      status: "fresh",
      latest_period: latestSource.period,
      latest_numeric_period: latest.period,
      latest_observation_status: latestSource.status,
      retrieved_at: generatedAt,
    },
    history,
    recent_years: [],
    baseline: {
      status: "fixture-only",
      baseline_start_year: null,
      baseline_end_year: null,
      eligible_years: [],
      eligible_year_count: 0,
      excluded_years: [],
      slots: [],
    },
    latest: {
      period: latest.period,
      value: latest.value,
      previous_period: null,
      absolute_change: null,
      percent_change: null,
      year_ago_period: null,
      yoy_absolute_change: null,
      yoy_percent_change: null,
      seasonal_median: null,
      distance_from_seasonal_median: null,
      seasonal_percentile: null,
    },
    latest_source: {
      period: latestSource.period,
      value: latestSource.value,
      status: latestSource.status,
    },
    distribution: { levels: emptyDistribution(), changes: emptyDistribution() },
    methodology_version: "2026-07-19.2",
    aggregation_lineage: null,
  };
}

function period(year: number, month: number): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

function completeHistory(component: "ab" | "sk"): HistoricalObservation[] {
  const result: HistoricalObservation[] = [];
  let index = 0;
  for (let year = 2014; year <= 2026; year += 1) {
    const finalMonth = year === 2026 ? 4 : 12;
    for (let month = 1; month <= finalMonth; month += 1) {
      result.push({
        period: period(year, month),
        year,
        slot: month,
        value: component === "ab" ? 100 + index : 50 + 2 * index,
        status: "observed",
      });
      index += 1;
    }
  }
  return result;
}

function periodFromIndex(index: number): string {
  const year = 2020 + Math.floor(index / 12);
  const month = index % 12 + 1;
  return period(year, month);
}

function componentForecast(
  geography: ManifestGeography,
  values: [number, number, number],
  residualMultiplier: number,
): ForecastAsset {
  const samples = Array.from({ length: 40 }, (_, index) => (
    Array.from({ length: 3 }, (_unused, horizonIndex) => ({
      horizon: horizonIndex + 1,
      target_period: periodFromIndex(index + horizonIndex + 1),
      residual: (index - 19.5) * residualMultiplier,
    }))
  )).flat();
  return {
    schema_version: "1.0.0",
    target_view_id: series.view_id,
    target_series_id: SERIES_ID,
    geography_id: geography.geography_id,
    dimensions: { ...DIMENSIONS },
    frequency: "monthly",
    unit: "cubic_metres",
    generated_at: "2026-07-20T10:00:00Z",
    training_source_checksum: `forecast-sha-${geography.geography_id}`,
    status: "ok",
    methodology_version: "2026-07-20.4",
    forecast_kind: "univariate_statistical_projection",
    origin: {
      period: "2026-04",
      value: 100,
      training_observations: 120,
      vintage_policy: "latest_revised_pseudo_out_of_sample",
    },
    horizon: { periods: 3, unit: "monthly" },
    points: values.map((value, index) => ({
      target_period: period(2026, index + 5),
      horizon: index + 1,
      year: 2026,
      slot: index + 5,
      value,
      // These intentionally narrow component bounds must not be summed.
      intervals: {
        "80": { lower: value - 0.25, upper: value + 0.25 },
        "90": { lower: value - 0.25, upper: value + 0.25 },
        "95": { lower: value - 0.25, upper: value + 0.25 },
      },
      calibration_errors: 40,
    })),
    prediction_intervals: {
      method: "component-only",
      levels: [80, 90, 95],
      calibration_window: { start: "2020-02", end: "2023-07" },
      calibration_errors: 40,
      minimum_errors_per_horizon: 40,
      coverage_guarantee: false,
    },
    aggregation_residuals: {
      method: "rolling_origin_actual_minus_calibrated_point",
      centered_on: "published_calibrated_point",
      usage: "additive_component_alignment_only",
      alignment_keys: ["horizon", "target_period"],
      calibration_window: { start: "2020-02", end: "2023-07" },
      minimum_aligned_samples_per_horizon: 40,
      sample_count: samples.length,
      samples,
    },
    limitations: [],
  };
}

describe("buildCustomRegionView", () => {
  it("sums complete aligned history and recomputes every chart diagnostic from that sum", async () => {
    const abHistory = completeHistory("ab");
    const skHistory = completeHistory("sk");
    const result = await buildCustomRegionView({
      country: "canada",
      series,
      registryPolicy,
      geographies: [alberta, saskatchewan],
      assets: [chartAsset(alberta, abHistory), chartAsset(saskatchewan, skHistory)],
    });

    expect(result.geography).toMatchObject({
      label: "Alberta + Saskatchewan",
      level_id: "province_territory",
      origin: "computed-rollup",
    });
    expect(result.asset.methodology_version).toBe(CUSTOM_AGGREGATION_METHODOLOGY_VERSION);
    expect(result.asset.history).toHaveLength(abHistory.length);
    expect(result.asset.history?.[0]).toMatchObject({
      period: "2014-01",
      value: 150,
      status: "computed",
    });
    expect(result.asset.history?.at(-1)?.value).toBe(
      abHistory.at(-1)!.value! + skHistory.at(-1)!.value!,
    );
    expect(result.asset.baseline).toMatchObject({
      status: "ok",
      baseline_start_year: 2014,
      baseline_end_year: 2023,
      eligible_year_count: 10,
    });
    expect(result.asset.recent_years.map(({ year }) => year)).toEqual([2024, 2025, 2026]);
    expect(result.asset.distribution.levels.count).toBe(abHistory.length);
    expect(result.asset.distribution.changes.count).toBe(abHistory.length - 1);
    expect(result.asset.aggregation_lineage).toMatchObject({
      aggregation_kind: "sum",
      membership_version: registryPolicy.membershipVersion,
      expected_component_count: 2,
      observed_component_count: 2,
      coverage_ratio: 1,
      component_geography_ids: [alberta.geography_id, saskatchewan.geography_id],
    });
    expect(result.forecast).toBeUndefined();
    expect(result.forecastNotice).toMatch(/every matching component forecast/i);
  });

  it("preserves suppressed and absent periods as nonnumeric instead of partially summing them", async () => {
    const result = await buildCustomRegionView({
      country: "canada",
      series,
      registryPolicy,
      geographies: [alberta, saskatchewan],
      assets: [
        chartAsset(alberta, [
          { period: "2026-01", year: 2026, slot: 1, value: 10, status: "observed" },
          {
            period: "2026-02",
            year: 2026,
            slot: 2,
            value: null,
            status: "suppressed_or_withheld",
          },
        ]),
        chartAsset(saskatchewan, [
          { period: "2026-01", year: 2026, slot: 1, value: 5, status: "observed" },
          { period: "2026-02", year: 2026, slot: 2, value: 6, status: "observed" },
          { period: "2026-03", year: 2026, slot: 3, value: 7, status: "observed" },
        ]),
      ],
    });

    expect(result.asset.history).toEqual([
      { period: "2026-01", year: 2026, slot: 1, value: 15, status: "computed" },
      {
        period: "2026-02",
        year: 2026,
        slot: 2,
        value: null,
        status: "suppressed_or_withheld",
      },
      { period: "2026-03", year: 2026, slot: 3, value: null, status: "missing" },
    ]);
    expect(result.asset.latest).toMatchObject({ period: "2026-01", value: 15 });
    expect(result.asset.latest_source).toEqual({
      period: "2026-03",
      value: null,
      status: "missing",
    });
    expect(result.asset.freshness).toMatchObject({
      latest_period: "2026-03",
      latest_numeric_period: "2026-01",
      latest_observation_status: "missing",
    });
    expect(result.asset.distribution.levels.count).toBe(1);
  });

  it("adds component point forecasts but recalibrates intervals from 40 aligned residual sums", async () => {
    const result = await buildCustomRegionView({
      country: "canada",
      series,
      registryPolicy,
      geographies: [alberta, saskatchewan],
      assets: [
        chartAsset(alberta, completeHistory("ab")),
        chartAsset(saskatchewan, completeHistory("sk")),
      ],
      forecasts: [
        componentForecast(alberta, [10, 11, 12], 1),
        componentForecast(saskatchewan, [20, 22, 24], 2),
      ],
    });

    expect(result.forecastNotice).toBeUndefined();
    expect(result.forecast).toMatchObject({
      status: "limited_history",
      forecast_kind: "bottom_up_custom_geography_projection",
      prediction_intervals: {
        method: "aligned_component_residual_sum_empirical_quantiles",
        calibration_errors: 40,
        minimum_errors_per_horizon: 40,
        coverage_guarantee: false,
      },
    });
    expect(result.forecast?.points.map(({ value }) => value)).toEqual([30, 33, 36]);
    expect(result.forecast?.points[0]?.calibration_errors).toBe(40);
    expect(result.forecast?.points[0]?.intervals["90"].lower).toBeCloseTo(-22.65, 8);
    expect(result.forecast?.points[0]?.intervals["90"].upper).toBeCloseTo(82.65, 8);
    // Summing the deliberately narrow component endpoints would produce [29.5, 30.5].
    expect(result.forecast?.points[0]?.intervals["90"]).not.toEqual({
      lower: 29.5,
      upper: 30.5,
    });
  });
});

describe("USA state-level producing-area combinations", () => {
  const STATE_SERIES_ID = "usa.eia.crude.production.monthly";

  function state(geographyId: string, label: string): ManifestGeography {
    return {
      geography_id: geographyId,
      label,
      level_id: "state_or_area",
      level_label: "State or producing area",
      granularity_rank: 30,
      origin: "source-published",
      status: "available",
    };
  }

  const texas = state("us.tx", "Texas");
  const northDakota = state("us.nd", "North Dakota");
  const alaska = state("us.ak", "Alaska");
  const alaskaSouth = state("us.ak.south", "Alaska South");

  const stateSeries: UsaManifestSeries = {
    view_id: STATE_SERIES_ID,
    series_id: STATE_SERIES_ID,
    title: "Crude oil production",
    category: "Supply",
    unit: "thousand_barrels_per_day",
    frequency: "monthly",
    source: { name: "U.S. Energy Information Administration" },
    freshness: { status: "fresh", latest_period: "2026-04" },
    geographies: [texas, northDakota, alaska, alaskaSouth],
    unsupported_levels: [],
  };

  const statePolicy: CustomAggregationPolicy = {
    country: "usa",
    levelId: "state_or_area",
    rule: "sum",
    membershipNamespace: "eia-state-producing-area-2026",
    membershipVersion: "2026-07-20.2",
    minimumMembers: 2,
    maximumMembers: 35,
    requiredCoverage: 1,
    seriesIds: [STATE_SERIES_ID],
  };

  function stateAsset(geography: ManifestGeography, base: number): UsaChartAsset {
    const history = completeHistory("ab").map((point, index) => ({
      ...point,
      value: base + index,
    }));
    const asset = chartAsset(geography, history);
    return {
      ...asset,
      series_id: STATE_SERIES_ID,
      unit: "thousand_barrels_per_day",
      dimensions: { product: "crude_oil", process: "field_production" },
    };
  }

  it("sums two disjoint producing areas", async () => {
    const result = await buildCustomRegionView({
      country: "usa",
      series: stateSeries,
      registryPolicy: statePolicy,
      geographies: [texas, northDakota],
      assets: [stateAsset(texas, 5000), stateAsset(northDakota, 1200)],
    });

    expect(result.geography).toMatchObject({
      label: "North Dakota + Texas",
      level_id: "state_or_area",
      origin: "computed-rollup",
    });
    expect(result.asset.unit).toBe("thousand_barrels_per_day");
    expect(result.asset.history?.[0]).toMatchObject({ value: 6200, status: "computed" });
  });

  it("refuses to add a state to the sub-area it already contains", async () => {
    await expect(buildCustomRegionView({
      country: "usa",
      series: stateSeries,
      registryPolicy: statePolicy,
      geographies: [alaska, alaskaSouth],
      assets: [stateAsset(alaska, 400), stateAsset(alaskaSouth, 7)],
    })).rejects.toThrow(/overlap/i);
  });

  it("still allows a sub-area to combine with an unrelated state", async () => {
    const result = await buildCustomRegionView({
      country: "usa",
      series: stateSeries,
      registryPolicy: statePolicy,
      geographies: [alaskaSouth, texas],
      assets: [stateAsset(alaskaSouth, 7), stateAsset(texas, 5000)],
    });

    expect(result.geography.label).toBe("Alaska South + Texas");
    expect(result.asset.history?.[0]).toMatchObject({ value: 5007, status: "computed" });
  });
});

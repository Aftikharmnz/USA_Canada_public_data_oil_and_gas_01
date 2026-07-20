"""Deterministic, leakage-aware statistical forecasts for public chart assets.

The forecasting layer is intentionally conservative: it compares a small set
of transparent univariate baselines with rolling-origin validation, calibrates
prediction intervals on a later time block, and reports performance on a final
untouched block when history permits.  It never mutates or replaces observed
values.
"""

from __future__ import annotations

import json
import math
from collections.abc import Callable, Iterable
from datetime import UTC, date, datetime, timedelta
from statistics import median
from typing import Any

from .contracts import Frequency, Observation
from .fundamentals import DAYS_PER_WEEK, FLOW_ROLE_SIGNS, ResolvedFundamentals


FORECAST_METHODOLOGY_VERSION = "2026-07-20.4"
FORECAST_SCHEMA_VERSION = "1.0.0"
PUBLIC_ASSET_BUILD_ID = "observed-2026-07-20.1_forecast-2026-07-20.4"
UNIVARIATE_FORECAST_KIND = "univariate_statistical_projection"
FUNDAMENTALS_FORECAST_KIND = "fundamentals_augmented_statistical_projection"
FORECAST_KINDS = (UNIVARIATE_FORECAST_KIND, FUNDAMENTALS_FORECAST_KIND)
FORECAST_INTERVAL_LEVELS = (80, 90, 95)
MINIMUM_CALIBRATION_ERRORS_PER_HORIZON = 40
MINIMUM_REPORTED_HORIZON_ERRORS = 5

# Statistics Canada documents a January 2020 redesign for this crude-trade
# table. Forecasts for these exact registered series must not learn across the
# incompatible pre/post-methodology regimes.
FORECAST_REGIME_STARTS = {
    "can.statcan.crude.imports.monthly": "2020-01",
    "can.statcan.crude.exports.monthly": "2020-01",
}


ForecastFunction = Callable[[list[float], int, int, int], float | None]
RollingError = tuple[int, int, float, float, float]


def forecast_regime_start(series_id: str) -> str | None:
    """Return the reviewed compatible-history boundary for a registered series."""

    return FORECAST_REGIME_STARTS.get(series_id)


def build_forecast_asset(
    observations: Iterable[Observation],
    *,
    frequency: Frequency,
    generated_at: datetime,
    source_checksum: str,
    target_view_id: str,
    training_start: str | None = None,
    fundamentals: ResolvedFundamentals | None = None,
) -> dict[str, Any]:
    """Build a standalone forecast record linked to one observed chart asset."""

    rows = tuple(sorted(observations, key=lambda item: item.period))
    if not rows:
        raise ValueError("Forecast assets require at least one observation")
    series_ids = {row.series_id for row in rows}
    geography_ids = {row.geography_id for row in rows}
    units = {row.unit for row in rows}
    dimensions = {tuple(sorted(row.dimensions)) for row in rows}
    if any(len(values) != 1 for values in (series_ids, geography_ids, units, dimensions)):
        raise ValueError(
            "Forecast asset rows must share series, geography, unit, and dimensions"
        )
    if fundamentals is not None:
        spec = fundamentals.spec
        if (
            spec.target_series_id != rows[0].series_id
            or spec.geography_id != rows[0].geography_id
            or spec.level_unit != rows[0].unit
            or spec.frequency is not frequency
        ):
            raise ValueError(
                "Resolved fundamental drivers do not match the forecast target "
                f"{rows[0].series_id}/{rows[0].geography_id}"
            )
    effective_training_start = training_start or forecast_regime_start(rows[0].series_id)
    payload = build_forecast(
        rows,
        frequency=frequency,
        generated_at=generated_at,
        data_vintage_id=source_checksum,
        training_start=effective_training_start,
        fundamentals=fundamentals,
    )
    asset = {
        "schema_version": FORECAST_SCHEMA_VERSION,
        "target_view_id": target_view_id,
        "target_series_id": rows[0].series_id,
        "geography_id": rows[0].geography_id,
        "dimensions": dict(sorted(rows[0].dimensions)),
        "frequency": frequency.value,
        "unit": rows[0].unit,
        "generated_at": generated_at.astimezone(UTC).isoformat(),
        "training_source_checksum": source_checksum,
        **payload,
    }
    _assert_json_safe(asset)
    return asset


def build_forecast(
    observations: Iterable[Observation],
    *,
    frequency: Frequency,
    generated_at: datetime,
    data_vintage_id: str,
    training_start: str | None = None,
    fundamentals: ResolvedFundamentals | None = None,
) -> dict[str, Any]:
    """Build one forecast payload from the latest contiguous numeric history.

    Candidate selection, interval calibration, and final evaluation use
    chronologically separate rolling-origin windows whenever enough history is
    available.  The forecast remains useful with shorter history, but its
    status and limitations explicitly disclose when an independent evaluation
    window was not possible.
    """

    if generated_at.tzinfo is None or generated_at.utcoffset() is None:
        raise ValueError("generated_at must be timezone-aware")
    if frequency not in {Frequency.WEEKLY, Frequency.MONTHLY}:
        return _unavailable("unsupported_frequency", "Forecasts support weekly and monthly data.")

    rows = tuple(sorted(observations, key=lambda item: item.period))
    if training_start is not None:
        rows = tuple(row for row in rows if row.period >= training_start)
    if not rows:
        return _unavailable(
            "insufficient_history",
            "No observations are available in the registered forecasting regime.",
            regime_start=training_start,
        )
    numeric = tuple(row for row in rows if row.value is not None)
    if not numeric:
        return _unavailable(
            "insufficient_history",
            "No numeric observations are available.",
            regime_start=training_start,
        )
    if numeric[-1].period != rows[-1].period:
        return _unavailable(
            "latest_source_non_numeric",
            (
                f"Latest source period {rows[-1].period} is non-numeric; forecasting from the "
                f"older numeric period {numeric[-1].period} would impute withheld or "
                "unavailable data."
            ),
            observations=len(numeric),
            training_start=numeric[0].period,
            training_end=numeric[-1].period,
            regime_start=training_start,
        )
    contiguous = _latest_contiguous_tail(numeric, frequency)
    values = [float(row.value) for row in contiguous if row.value is not None]
    profile = _profile(frequency)
    minimum_required = (
        profile["minimum_training"]
        + profile["minimum_selection"]
        + profile["minimum_calibration"]
    )
    if len(values) < minimum_required:
        return _unavailable(
            "insufficient_history",
            (
                f"Forecast requires at least {minimum_required} consecutive numeric "
                f"{frequency.value} observations; {len(values)} are available."
            ),
            observations=len(values),
            training_start=contiguous[0].period,
            training_end=contiguous[-1].period,
            regime_start=training_start,
        )

    partitions = _partition_history(len(values), profile)
    candidates = _candidate_functions()
    aligned_netflow, fundamentals_block = _align_fundamentals(fundamentals, contiguous)
    if aligned_netflow is not None:
        candidates = dict(candidates)
        candidates["fundamental_balance"] = _make_fundamental_balance(aligned_netflow)
    forecast_kind = (
        FUNDAMENTALS_FORECAST_KIND
        if "fundamental_balance" in candidates
        else UNIVARIATE_FORECAST_KIND
    )
    selection_errors: dict[str, list[RollingError]] = {}
    selection_start, selection_end = partitions["selection"]
    for model_id, function in candidates.items():
        selection_errors[model_id] = _rolling_errors(
            values,
            function,
            season=profile["season"],
            recent_window=profile["recent_window"],
            horizon=profile["horizon"],
            window_start=selection_start,
            window_end=selection_end,
            minimum_training=profile["minimum_training"],
        )
    scores = {
        model_id: _mean_absolute_error(errors)
        for model_id, errors in selection_errors.items()
        if errors
    }
    if not scores:
        return _unavailable(
            "insufficient_history",
            "No candidate model produced a complete rolling-origin validation sample.",
            observations=len(values),
            training_start=contiguous[0].period,
            training_end=contiguous[-1].period,
            regime_start=training_start,
        )
    selected_id = min(scores, key=lambda item: (scores[item], item))
    selected = candidates[selected_id]

    calibration_start, calibration_end = partitions["calibration"]
    calibration = _rolling_errors(
        values,
        selected,
        season=profile["season"],
        recent_window=profile["recent_window"],
        horizon=profile["horizon"],
        window_start=calibration_start,
        window_end=calibration_end,
        minimum_training=profile["minimum_training"],
    )
    residuals_by_horizon = _residuals_by_horizon(calibration, profile["horizon"])
    if any(
        len(residuals_by_horizon[horizon]) < MINIMUM_CALIBRATION_ERRORS_PER_HORIZON
        for horizon in range(1, profile["horizon"] + 1)
    ):
        return _unavailable(
            "insufficient_history",
            (
                "The rolling-origin calibration sample does not provide at least "
                f"{MINIMUM_CALIBRATION_ERRORS_PER_HORIZON} errors for every forecast horizon."
            ),
            observations=len(values),
            training_start=contiguous[0].period,
            training_end=contiguous[-1].period,
            regime_start=training_start,
        )

    offsets = {
        horizon: _interval_offsets(residuals_by_horizon[horizon])
        for horizon in range(1, profile["horizon"] + 1)
    }
    points = _future_points(
        values,
        selected,
        last_period=contiguous[-1].period,
        frequency=frequency,
        season=profile["season"],
        recent_window=profile["recent_window"],
        horizon=profile["horizon"],
        offsets=offsets,
    )
    if len(points) != profile["horizon"] or not _forecast_points_are_finite(points):
        return _unavailable(
            "insufficient_history",
            "The selected model did not produce a complete finite forecast path.",
            observations=len(values),
            training_start=contiguous[0].period,
            training_end=contiguous[-1].period,
            regime_start=training_start,
        )

    evaluation_start, evaluation_end = partitions["evaluation"]
    evaluation_raw = (
        _rolling_errors(
            values,
            selected,
            season=profile["season"],
            recent_window=profile["recent_window"],
            horizon=profile["horizon"],
            window_start=evaluation_start,
            window_end=evaluation_end,
            minimum_training=profile["minimum_training"],
        )
        if evaluation_start <= evaluation_end
        else []
    )
    evaluation = _evaluate(evaluation_raw, offsets)
    benchmark_calibration = _rolling_errors(
        values,
        candidates["seasonal_naive"],
        season=profile["season"],
        recent_window=profile["recent_window"],
        horizon=profile["horizon"],
        window_start=calibration_start,
        window_end=calibration_end,
        minimum_training=profile["minimum_training"],
    )
    benchmark_residuals = _residuals_by_horizon(
        benchmark_calibration, profile["horizon"]
    )
    benchmark_offsets = (
        {
            step: _interval_offsets(benchmark_residuals[step])
            for step in range(1, profile["horizon"] + 1)
        }
        if all(benchmark_residuals[step] for step in range(1, profile["horizon"] + 1))
        else None
    )
    benchmark_raw = (
        _rolling_errors(
            values,
            candidates["seasonal_naive"],
            season=profile["season"],
            recent_window=profile["recent_window"],
            horizon=profile["horizon"],
            window_start=evaluation_start,
            window_end=evaluation_end,
            minimum_training=profile["minimum_training"],
        )
        if evaluation_start <= evaluation_end
        else []
    )
    benchmark_evaluation = (
        _evaluate(benchmark_raw, benchmark_offsets)
        if benchmark_raw and benchmark_offsets is not None
        else None
    )
    benchmark_mae = (
        benchmark_evaluation.get("mae") if benchmark_evaluation is not None else None
    )
    model_mae = evaluation.get("mae")
    if (
        selected_id == "seasonal_naive"
        and isinstance(model_mae, (int, float))
        and model_mae == benchmark_mae
    ):
        skill = 0.0
    else:
        skill = (
            None
            if benchmark_mae in {None, 0} or not isinstance(model_mae, (int, float))
            else 1 - model_mae / benchmark_mae
        )

    model_labels = {
        "last_value": "Last observation",
        "recent_mean": "Recent mean",
        "damped_trend": "Robust damped trend",
        "harmonic_trend": "Additive harmonic trend",
        "seasonal_naive": "Seasonal naive",
        "seasonal_average": "Seasonal average",
        "fundamental_balance": "Fundamental net balance",
    }
    selection_rows = [
        {
            "model_id": model_id,
            "label": model_labels[model_id],
            "mae": _clean(score),
            "forecast_errors": len(selection_errors[model_id]),
        }
        for model_id, score in sorted(scores.items(), key=lambda item: (item[1], item[0]))
    ]
    information_cutoff = max(row.retrieved_at for row in contiguous).astimezone(UTC).isoformat()
    evaluation_status = "independent_holdout" if evaluation_raw else "not_available"
    if fundamentals_block is not None:
        fundamentals_block = dict(fundamentals_block)
        fundamentals_block["selected"] = selected_id == "fundamental_balance"
    return {
        "status": "ok" if evaluation_raw else "limited_history",
        "methodology_version": FORECAST_METHODOLOGY_VERSION,
        "forecast_kind": forecast_kind,
        **({"fundamentals": fundamentals_block} if fundamentals_block is not None else {}),
        "model": {
            "model_id": selected_id,
            "label": model_labels[selected_id],
            "selection_method": "rolling_origin_minimum_mae",
            "selection_window": _period_window(contiguous, selection_start, selection_end),
            "candidates": selection_rows,
        },
        "origin": {
            "period": contiguous[-1].period,
            "value": _clean(values[-1]),
            **({"regime_start": training_start} if training_start else {}),
            "generated_at": generated_at.astimezone(UTC).isoformat(),
            "information_cutoff": information_cutoff,
            "training_start": contiguous[0].period,
            "training_end": contiguous[-1].period,
            "training_observations": len(values),
            "data_vintage_id": data_vintage_id,
            "vintage_policy": "latest_stored_provider_values_at_generation_time",
        },
        "horizon": {
            "periods": profile["horizon"],
            "unit": frequency.value,
        },
        "points": points,
        "prediction_intervals": {
            "method": "empirical_rolling_origin_residual_quantiles",
            "levels": list(FORECAST_INTERVAL_LEVELS),
            "calibration_window": _period_window(
                contiguous, calibration_start, calibration_end
            ),
            "calibration_errors": len(calibration),
            "minimum_errors_per_horizon": min(
                len(residuals) for residuals in residuals_by_horizon.values()
            ),
            "coverage_guarantee": False,
        },
        "aggregation_residuals": _aggregation_residual_samples(
            calibration,
            offsets,
            contiguous,
            calibration_window=_period_window(
                contiguous, calibration_start, calibration_end
            ),
        ),
        "backtest": {
            "status": evaluation_status,
            "evaluation_mode": "latest_revised_pseudo_out_of_sample",
            "evaluation_window": (
                _period_window(contiguous, evaluation_start, evaluation_end)
                if evaluation_raw
                else None
            ),
            **evaluation,
            "seasonal_naive_mae": _clean(benchmark_mae),
            "skill_vs_seasonal_naive": _clean(skill),
        },
        "limitations": (
            ([
                f"Training excludes observations before {training_start} because the "
                "registered series has a known methodology break."
            ] if training_start else [])
            + [
            "Uses latest stored provider values, not reconstructed first-release vintages.",
            "Intervals are empirical rolling-origin error quantiles; nominal coverage is not "
            "guaranteed.",
            ]
            + ([
                "Registered fundamental drivers share the target's weekly source release; "
                "the balance identity does not close exactly, and the unaccounted term is "
                "estimated from recent history.",
                "Weather, outages, prices, forward curves, and analyst expectations remain "
                "excluded.",
            ] if forecast_kind == FUNDAMENTALS_FORECAST_KIND else [
                "Univariate baseline excludes weather, outages, prices, analyst expectations, "
                "and other external features.",
            ])
            + [
            "A methodology break or long missing-data gap can make the forecast unavailable.",
            ]
        ),
    }


def _profile(frequency: Frequency) -> dict[str, int]:
    if frequency is Frequency.WEEKLY:
        return {
            "season": 52,
            "horizon": 3,
            "recent_window": 13,
            "minimum_training": 104,
            "minimum_selection": 13,
            "selection_length": 52,
            "calibration_length": 104,
            "evaluation_length": 26,
            "minimum_calibration": 42,
        }
    return {
        "season": 12,
        "horizon": 3,
        "recent_window": 6,
        "minimum_training": 24,
        "minimum_selection": 9,
        "selection_length": 12,
        "calibration_length": 60,
        "evaluation_length": 12,
        "minimum_calibration": 42,
    }


def _partition_history(length: int, profile: dict[str, int]) -> dict[str, tuple[int, int]]:
    minimum_training = profile["minimum_training"]
    remaining = length - minimum_training
    desired_evaluation = profile["evaluation_length"]
    desired_calibration = profile["calibration_length"]
    desired_selection = profile["selection_length"]
    minimum_evaluated_required = (
        desired_evaluation
        + profile["minimum_calibration"]
        + profile["minimum_selection"]
    )
    evaluation_length = (
        desired_evaluation if remaining >= minimum_evaluated_required else 0
    )
    available_before_evaluation = remaining - evaluation_length
    calibration_length = min(
        desired_calibration,
        available_before_evaluation - profile["minimum_selection"],
    )
    selection_length = min(desired_selection, available_before_evaluation - calibration_length)
    evaluation_start = length - evaluation_length
    calibration_start = evaluation_start - calibration_length
    selection_start = calibration_start - selection_length
    selection_end = calibration_start - 1
    return {
        "selection": (selection_start, selection_end),
        "calibration": (calibration_start, evaluation_start - 1),
        "evaluation": (evaluation_start, length - 1) if evaluation_length else (1, 0),
    }


def _align_fundamentals(
    fundamentals: ResolvedFundamentals | None,
    contiguous: tuple[Observation, ...],
) -> tuple[list[float] | None, dict[str, Any] | None]:
    """Align registered driver flows to the target's contiguous numeric tail.

    Returns the signed net-flow list (same length and period order as the
    tail) plus a disclosure block.  Any period where any driver is missing or
    nonnumeric withholds the candidate entirely instead of imputing a flow.
    """

    if fundamentals is None:
        return None, None
    spec = fundamentals.spec
    base_block: dict[str, Any] = {
        "identity": spec.identity,
        "flow_to_level_factor": DAYS_PER_WEEK,
        "drivers": list(fundamentals.driver_lineage),
        "notes": spec.notes,
    }
    values_by_role: dict[str, dict[str, float]] = {}
    for role, rows in fundamentals.driver_rows:
        values_by_role[role] = {
            row.period: float(row.value) for row in rows if row.value is not None
        }
    netflow: list[float] = []
    for row in contiguous:
        total = 0.0
        for role, _series_id in spec.drivers:
            flow = values_by_role.get(role, {}).get(row.period)
            if flow is None:
                return None, base_block | {
                    "status": "drivers_incomplete",
                    "exclusion_reason": (
                        f"Driver role {role} has no numeric value for period "
                        f"{row.period}; the fundamental candidate is withheld "
                        "instead of imputing a flow."
                    ),
                }
            total += FLOW_ROLE_SIGNS[role] * flow
        netflow.append(total)
    return netflow, base_block | {"status": "candidate_included"}


def _make_fundamental_balance(netflow: list[float]) -> ForecastFunction:
    """Build the accounting-identity candidate over pre-aligned net flows.

    The closure only ever reads net-flow indices strictly below the training
    prefix length, so rolling-origin evaluation cannot leak future driver
    values: seasonal slots are sampled at ``index - k * season`` for the
    future target index, which is always below the prefix for season >= the
    3-period horizon, and the unaccounted-term estimate uses the latest
    consecutive observed changes only.
    """

    def fundamental_balance(
        values: list[float], horizon: int, season: int, window: int
    ) -> float | None:
        length = len(values)
        if length < season + 2 or length > len(netflow):
            return None
        flows = netflow[:length]
        adjustment_window = max(4, window)
        if length < adjustment_window + 1:
            return None
        residuals = [
            values[index] - values[index - 1] - DAYS_PER_WEEK * flows[index]
            for index in range(length - adjustment_window, length)
        ]
        adjustment = median(residuals)
        level = values[-1]
        for step in range(1, horizon + 1):
            future_index = length + step - 1
            seasonal: list[float] = []
            slot_index = future_index - season
            while slot_index >= 0 and len(seasonal) < 5:
                seasonal.append(flows[slot_index])
                slot_index -= season
            if len(seasonal) < 2:
                return None
            projected_flow = sum(seasonal) / len(seasonal)
            level += DAYS_PER_WEEK * projected_flow + adjustment
        return level

    return fundamental_balance


def _candidate_functions() -> dict[str, ForecastFunction]:
    return {
        "last_value": _last_value,
        "recent_mean": _recent_mean,
        "damped_trend": _damped_trend,
        "harmonic_trend": _harmonic_trend,
        "seasonal_naive": _seasonal_naive,
        "seasonal_average": _seasonal_average,
    }


def _last_value(values: list[float], _horizon: int, _season: int, _window: int) -> float | None:
    return values[-1] if values else None


def _recent_mean(values: list[float], _horizon: int, _season: int, window: int) -> float | None:
    sample = values[-window:]
    return sum(sample) / len(sample) if sample else None


def _damped_trend(values: list[float], horizon: int, _season: int, window: int) -> float | None:
    sample = values[-window:]
    if len(sample) < 3:
        return None
    changes = [right - left for left, right in zip(sample, sample[1:])]
    slope = median(changes)
    damping = 0.85
    cumulative = sum(damping**step for step in range(1, horizon + 1))
    return values[-1] + slope * cumulative


def _harmonic_trend(
    values: list[float], horizon: int, season: int, _window: int
) -> float | None:
    """Additive trend plus two deterministic Fourier harmonics."""

    sample_length = min(len(values), season * 5)
    if sample_length < season * 2:
        return None
    start = len(values) - sample_length
    rows = [_harmonic_features(index, season) for index in range(start, len(values))]
    response = values[-sample_length:]
    coefficients = _ridge_least_squares(rows, response)
    if coefficients is None:
        return None
    target_index = len(values) + horizon - 1
    features = _harmonic_features(target_index, season)
    return sum(coefficient * feature for coefficient, feature in zip(coefficients, features))


def _harmonic_features(index: int, season: int) -> list[float]:
    scaled = index / season
    angle = 2 * math.pi * index / season
    return [
        1.0,
        scaled,
        math.sin(angle),
        math.cos(angle),
        math.sin(2 * angle),
        math.cos(2 * angle),
    ]


def _ridge_least_squares(rows: list[list[float]], response: list[float]) -> list[float] | None:
    width = len(rows[0])
    matrix = [[0.0 for _ in range(width)] for _ in range(width)]
    vector = [0.0 for _ in range(width)]
    for features, target in zip(rows, response, strict=True):
        for left in range(width):
            vector[left] += features[left] * target
            for right in range(width):
                matrix[left][right] += features[left] * features[right]
    ridge = 1e-8
    for index in range(1, width):
        matrix[index][index] += ridge
    augmented = [matrix[index] + [vector[index]] for index in range(width)]
    for pivot in range(width):
        swap = max(range(pivot, width), key=lambda row: abs(augmented[row][pivot]))
        if abs(augmented[swap][pivot]) < 1e-12:
            return None
        augmented[pivot], augmented[swap] = augmented[swap], augmented[pivot]
        divisor = augmented[pivot][pivot]
        augmented[pivot] = [value / divisor for value in augmented[pivot]]
        for row in range(width):
            if row == pivot:
                continue
            factor = augmented[row][pivot]
            augmented[row] = [
                value - factor * pivot_value
                for value, pivot_value in zip(augmented[row], augmented[pivot], strict=True)
            ]
    return [augmented[index][-1] for index in range(width)]


def _seasonal_naive(values: list[float], horizon: int, season: int, _window: int) -> float | None:
    index = len(values) + horizon - 1 - season
    return values[index] if 0 <= index < len(values) else None


def _seasonal_average(values: list[float], horizon: int, season: int, _window: int) -> float | None:
    target_index = len(values) + horizon - 1
    seasonal: list[float] = []
    index = target_index - season
    while index >= 0 and len(seasonal) < 5:
        seasonal.append(values[index])
        index -= season
    return sum(seasonal) / len(seasonal) if len(seasonal) >= 2 else None


def _rolling_errors(
    values: list[float],
    function: ForecastFunction,
    *,
    season: int,
    recent_window: int,
    horizon: int,
    window_start: int,
    window_end: int,
    minimum_training: int,
) -> list[RollingError]:
    """Return horizon, target index, actual, raw forecast, and origin value."""

    output: list[RollingError] = []
    if window_start > window_end:
        return output
    first_origin = max(minimum_training - 1, window_start - 1)
    for origin in range(first_origin, window_end):
        training = values[: origin + 1]
        predictions = _forecast_many(
            function,
            training,
            horizon=horizon,
            season=season,
            recent_window=recent_window,
        )
        for step in range(1, horizon + 1):
            target = origin + step
            if target > window_end or target >= len(values):
                break
            prediction = predictions[step]
            if prediction is None or not math.isfinite(prediction):
                continue
            output.append(
                (step, target, values[target], prediction, values[origin])
            )
    return output


def _residuals_by_horizon(
    records: list[RollingError], horizon: int
) -> dict[int, list[float]]:
    output = {step: [] for step in range(1, horizon + 1)}
    for step, _target, actual, prediction, _origin in records:
        output[step].append(actual - prediction)
    return output


def _aggregation_residual_samples(
    records: list[RollingError],
    offsets: dict[int, dict[str, Any]],
    rows: tuple[Observation, ...],
    *,
    calibration_window: dict[str, str],
) -> dict[str, Any]:
    """Publish calibration errors that additive custom regions can align.

    Each residual is measured around the same median-calibrated point used by
    the published future path.  Consumers must intersect component samples on
    both ``horizon`` and ``target_period`` before summing residuals; unmatched
    samples must never be filled or treated as zero.
    """

    samples: list[dict[str, Any]] = []
    for step, target, actual, raw, _origin in records:
        residual = _clean(actual - (raw + offsets[step]["center"]))
        if residual is None:
            raise ValueError("Aggregation residual samples must be finite")
        samples.append(
            {
                "horizon": step,
                "target_period": rows[target].period,
                "residual": residual,
            }
        )
    samples.sort(key=lambda item: (int(item["horizon"]), str(item["target_period"])))
    return {
        "method": "rolling_origin_actual_minus_calibrated_point",
        "centered_on": "published_calibrated_point",
        "usage": "additive_component_alignment_only",
        "alignment_keys": ["horizon", "target_period"],
        "calibration_window": calibration_window,
        "minimum_aligned_samples_per_horizon": MINIMUM_CALIBRATION_ERRORS_PER_HORIZON,
        "sample_count": len(samples),
        "samples": samples,
    }


def _interval_offsets(residuals: list[float]) -> dict[str, Any]:
    ordered = sorted(residuals)
    center = _quantile(ordered, 0.5)
    intervals = {
        str(level): {
            "lower": _quantile(ordered, (1 - level / 100) / 2),
            "upper": _quantile(ordered, 1 - (1 - level / 100) / 2),
        }
        for level in FORECAST_INTERVAL_LEVELS
    }
    return {"center": center, "intervals": intervals, "count": len(ordered)}


def _future_points(
    values: list[float],
    function: ForecastFunction,
    *,
    last_period: str,
    frequency: Frequency,
    season: int,
    recent_window: int,
    horizon: int,
    offsets: dict[int, dict[str, Any]],
) -> list[dict[str, Any]]:
    points: list[dict[str, Any]] = []
    period = last_period
    predictions = _forecast_many(
        function,
        values,
        horizon=horizon,
        season=season,
        recent_window=recent_window,
    )
    for step in range(1, horizon + 1):
        period = _next_period(period, frequency)
        raw = predictions[step]
        if raw is None:
            continue
        calibration = offsets[step]
        year, slot = _coordinate(period, frequency)
        points.append(
            {
                "target_period": period,
                "horizon": step,
                "year": year,
                "slot": slot,
                "value": _clean(raw + calibration["center"]),
                "intervals": {
                    level: {
                        "lower": _clean(raw + bounds["lower"]),
                        "upper": _clean(raw + bounds["upper"]),
                    }
                    for level, bounds in calibration["intervals"].items()
                },
                "calibration_errors": calibration["count"],
            }
        )
    return points


def _forecast_points_are_finite(points: list[dict[str, Any]]) -> bool:
    for point in points:
        values = [point.get("value")]
        intervals = point.get("intervals")
        if not isinstance(intervals, dict):
            return False
        for level in ("80", "90", "95"):
            bounds = intervals.get(level)
            if not isinstance(bounds, dict):
                return False
            values.extend((bounds.get("lower"), bounds.get("upper")))
        if any(
            not isinstance(value, (int, float)) or not math.isfinite(float(value))
            for value in values
        ):
            return False
    return True


def _forecast_many(
    function: ForecastFunction,
    values: list[float],
    *,
    horizon: int,
    season: int,
    recent_window: int,
) -> dict[int, float | None]:
    if function is _harmonic_trend:
        sample_length = min(len(values), season * 5)
        if sample_length < season * 2:
            return {step: None for step in range(1, horizon + 1)}
        start = len(values) - sample_length
        rows = [_harmonic_features(index, season) for index in range(start, len(values))]
        coefficients = _ridge_least_squares(rows, values[-sample_length:])
        if coefficients is None:
            return {step: None for step in range(1, horizon + 1)}
        return {
            step: sum(
                coefficient * feature
                for coefficient, feature in zip(
                    coefficients,
                    _harmonic_features(len(values) + step - 1, season),
                    strict=True,
                )
            )
            for step in range(1, horizon + 1)
        }
    return {
        step: function(values, step, season, recent_window)
        for step in range(1, horizon + 1)
    }


def _evaluate(
    records: list[RollingError],
    offsets: dict[int, dict[str, Any]],
) -> dict[str, Any]:
    if not records:
        return {
            "forecast_errors": 0,
            "mae": None,
            "rmse": None,
            "bias": None,
            "directional_accuracy": None,
            "interval_coverage": {str(level): None for level in FORECAST_INTERVAL_LEVELS},
            "by_horizon": [],
        }
    evaluated: list[dict[str, Any]] = []
    for step, _target, actual, raw, origin in records:
        calibration = offsets[step]
        point = raw + calibration["center"]
        evaluated.append(
            {
                "horizon": step,
                "actual": actual,
                "point": point,
                "origin": origin,
                "intervals": {
                    level: (
                        raw + calibration["intervals"][str(level)]["lower"],
                        raw + calibration["intervals"][str(level)]["upper"],
                    )
                    for level in FORECAST_INTERVAL_LEVELS
                },
            }
        )
    by_horizon = [
        _evaluation_summary(
            [row for row in evaluated if row["horizon"] == step], horizon=step
        )
        for step in sorted({int(row["horizon"]) for row in evaluated})
    ]
    return _evaluation_summary(evaluated, horizon=None) | {"by_horizon": by_horizon}


def _evaluation_summary(rows: list[dict[str, Any]], *, horizon: int | None) -> dict[str, Any]:
    errors = [float(row["actual"]) - float(row["point"]) for row in rows]
    if horizon is not None and len(errors) < MINIMUM_REPORTED_HORIZON_ERRORS:
        return {
            "horizon": horizon,
            "forecast_errors": len(errors),
            "mae": None,
            "rmse": None,
            "bias": None,
            "directional_accuracy": None,
            "interval_coverage": {
                str(level): None for level in FORECAST_INTERVAL_LEVELS
            },
        }
    directions = [
        _sign(float(row["actual"]) - float(row["origin"]))
        == _sign(float(row["point"]) - float(row["origin"]))
        for row in rows
        if float(row["actual"]) != float(row["origin"])
        or float(row["point"]) != float(row["origin"])
    ]
    output: dict[str, Any] = {
        "forecast_errors": len(errors),
        "mae": _clean(sum(abs(error) for error in errors) / len(errors)),
        "rmse": _clean(math.sqrt(sum(error**2 for error in errors) / len(errors))),
        "bias": _clean(sum(errors) / len(errors)),
        "directional_accuracy": (
            _clean(sum(directions) / len(directions)) if directions else None
        ),
        "interval_coverage": {
            str(level): _clean(
                sum(
                    float(row["intervals"][level][0])
                    <= float(row["actual"])
                    <= float(row["intervals"][level][1])
                    for row in rows
                )
                / len(rows)
            )
            for level in FORECAST_INTERVAL_LEVELS
        },
    }
    if horizon is not None:
        output = {"horizon": horizon, **output}
    return output


def _latest_contiguous_tail(
    rows: tuple[Observation, ...], frequency: Frequency
) -> tuple[Observation, ...]:
    tail: list[Observation] = []
    for row in rows:
        if not tail or _next_period(tail[-1].period, frequency) == row.period:
            tail.append(row)
        else:
            tail = [row]
    return tuple(tail)


def _next_period(period: str, frequency: Frequency) -> str:
    if frequency is Frequency.WEEKLY:
        return (date.fromisoformat(period) + timedelta(days=7)).isoformat()
    year, month = (int(part) for part in period[:7].split("-"))
    month += 1
    if month == 13:
        year += 1
        month = 1
    return f"{year:04d}-{month:02d}"


def _coordinate(period: str, frequency: Frequency) -> tuple[int, int]:
    if frequency is Frequency.MONTHLY:
        year, month = (int(part) for part in period[:7].split("-"))
        return year, month
    parsed = date.fromisoformat(period)
    iso = parsed.isocalendar()
    return iso.year, iso.week


def _period_window(
    rows: tuple[Observation, ...], start: int, end: int
) -> dict[str, str]:
    return {"start": rows[start].period, "end": rows[end].period}


def _mean_absolute_error(records: list[RollingError]) -> float:
    return sum(
        abs(actual - prediction)
        for _horizon, _target, actual, prediction, _origin in records
    ) / len(records)


def _quantile(values: list[float], probability: float) -> float:
    if len(values) == 1:
        return values[0]
    position = (len(values) - 1) * probability
    lower = math.floor(position)
    upper = min(lower + 1, len(values) - 1)
    fraction = position - lower
    return values[lower] + (values[upper] - values[lower]) * fraction


def _sign(value: float) -> int:
    return 1 if value > 0 else -1 if value < 0 else 0


def _clean(value: float | int | None) -> float | int | None:
    if value is None:
        return None
    numeric = float(value)
    if not math.isfinite(numeric):
        return None
    rounded = round(numeric, 10)
    return int(rounded) if rounded.is_integer() else rounded


def _unavailable(
    status: str,
    reason: str,
    *,
    observations: int = 0,
    training_start: str | None = None,
    training_end: str | None = None,
    regime_start: str | None = None,
) -> dict[str, Any]:
    return {
        "status": status,
        "methodology_version": FORECAST_METHODOLOGY_VERSION,
        "forecast_kind": UNIVARIATE_FORECAST_KIND,
        "reason": reason,
        "origin": {
            **({"regime_start": regime_start} if regime_start else {}),
            "training_start": training_start,
            "training_end": training_end,
            "training_observations": observations,
        },
        "points": [],
        "limitations": [
            "Observed values are never imputed or replaced by a forecast.",
            "A longer consecutive history is required before uncertainty can be calibrated.",
        ],
    }


def _assert_json_safe(value: Any) -> None:
    json.dumps(value, allow_nan=False)

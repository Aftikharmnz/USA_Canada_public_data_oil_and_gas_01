"""Validated geography rollups with complete lineage."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from typing import Iterable

from .contracts import (
    AggregationRule,
    AggregationSpec,
    Observation,
    ObservationStatus,
    RollupDefinition,
)


@dataclass(frozen=True, slots=True)
class AggregationLineage:
    source_observation_keys: tuple[str, ...]
    member_geography_ids: tuple[str, ...]
    membership_version: str
    coverage: Decimal
    aggregation_rule: AggregationRule


@dataclass(frozen=True, slots=True)
class RollupResult:
    observation: Observation
    lineage: AggregationLineage


class AggregationError(ValueError):
    """Raised when an aggregation would be incomplete or statistically invalid."""


def _require_component(observation: Observation, field: str) -> Decimal:
    value = observation.component(field)
    if value is None:
        raise AggregationError(f"Observation {observation.key} is missing component {field!r}")
    return value


def _aligned_observations(
    observations: Iterable[Observation],
    rollup: RollupDefinition,
) -> tuple[Observation, ...]:
    rows = tuple(observations)
    expected = set(rollup.member_geography_ids)
    actual_ids = [row.geography_id for row in rows]
    if len(actual_ids) != len(set(actual_ids)):
        raise AggregationError("Rollup input contains duplicate member observations")
    actual = set(actual_ids)
    if actual != expected:
        missing = sorted(expected - actual)
        unexpected = sorted(actual - expected)
        raise AggregationError(
            f"Rollup membership mismatch; missing={missing}, unexpected={unexpected}"
        )
    if not rows:
        raise AggregationError("Rollup input is empty")

    periods = {row.period for row in rows}
    series_ids = {row.series_id for row in rows}
    units = {row.unit for row in rows}
    dimensions = {tuple(sorted(row.dimensions)) for row in rows}
    if len(periods) != 1 or len(series_ids) != 1 or len(units) != 1 or len(dimensions) != 1:
        raise AggregationError("Rollup members must share series, period, unit, and dimensions")
    return rows


def roll_up(
    observations: Iterable[Observation],
    rollup: RollupDefinition,
    specification: AggregationSpec,
) -> RollupResult:
    rows = _aligned_observations(observations, rollup)
    if specification.rule is AggregationRule.NOT_AGGREGATABLE:
        raise AggregationError("This series is explicitly not aggregatable")

    complete_count = 0
    if specification.rule is AggregationRule.SUM:
        values = []
        for row in rows:
            if row.value is not None:
                complete_count += 1
                values.append(row.value)
        value = sum(values, Decimal("0"))
    elif specification.rule is AggregationRule.RATIO_OF_SUMS:
        assert specification.numerator_series_id is not None
        assert specification.denominator_series_id is not None
        numerators = []
        denominators = []
        for row in rows:
            numerators.append(_require_component(row, specification.numerator_series_id))
            denominators.append(_require_component(row, specification.denominator_series_id))
            complete_count += 1
        denominator = sum(denominators, Decimal("0"))
        if denominator == 0:
            raise AggregationError("Ratio-of-sums denominator is zero")
        value = sum(numerators, Decimal("0")) / denominator * specification.scale
    elif specification.rule is AggregationRule.WEIGHTED_AVERAGE:
        assert specification.weight_series_id is not None
        weighted_values = []
        weights = []
        for row in rows:
            if row.value is None:
                continue
            weight = _require_component(row, specification.weight_series_id)
            if weight < 0:
                raise AggregationError("Weights cannot be negative")
            weighted_values.append(row.value * weight)
            weights.append(weight)
            complete_count += 1
        total_weight = sum(weights, Decimal("0"))
        if total_weight == 0:
            raise AggregationError("Weighted-average total weight is zero")
        value = sum(weighted_values, Decimal("0")) / total_weight
    else:  # pragma: no cover - the enum makes this defensive branch unreachable.
        raise AggregationError(f"Unsupported aggregation rule: {specification.rule}")

    coverage = Decimal(complete_count) / Decimal(len(rollup.member_geography_ids))
    if coverage < rollup.minimum_coverage:
        raise AggregationError(
            f"Rollup coverage {coverage} is below required {rollup.minimum_coverage}"
        )

    source_release_times = [row.source_released_at for row in rows if row.source_released_at]
    retrieved_at: datetime = max(row.retrieved_at for row in rows)
    observation = Observation(
        provider_id=rows[0].provider_id,
        series_id=rows[0].series_id,
        period=rows[0].period,
        geography_id=rollup.target_geography_id,
        value=value,
        unit=rows[0].unit,
        retrieved_at=retrieved_at,
        status=ObservationStatus.COMPUTED,
        source_released_at=max(source_release_times) if source_release_times else None,
        dimensions=rows[0].dimensions,
        flags=("derived_geography_rollup",),
    )
    lineage = AggregationLineage(
        source_observation_keys=tuple(sorted(row.key for row in rows)),
        member_geography_ids=tuple(sorted(rollup.member_geography_ids)),
        membership_version=rollup.membership_version,
        coverage=coverage,
        aggregation_rule=specification.rule,
    )
    return RollupResult(observation=observation, lineage=lineage)

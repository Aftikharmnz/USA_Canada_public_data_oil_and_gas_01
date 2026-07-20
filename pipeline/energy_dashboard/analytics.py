"""Deterministic, stdlib-only chart analytics for compact static JSON assets."""

from __future__ import annotations

import hashlib
import json
import math
import os
import tempfile
from collections import defaultdict
from collections.abc import Iterable, Mapping
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

from .contracts import Frequency, Observation
from .storage import replace_path_with_retry


ASSET_SCHEMA_VERSION = "1.0.0"
METHODOLOGY_VERSION = "2026-07-20.1"


def build_chart_asset(
    observations: Iterable[Observation],
    *,
    frequency: Frequency,
    generated_at: datetime,
    baseline_year_count: int = 10,
    minimum_complete_baseline_years: int = 5,
    aggregation_lineage: Mapping[str, Any] | None = None,
    freshness: Mapping[str, Any] | None = None,
) -> dict[str, Any]:
    if generated_at.tzinfo is None or generated_at.utcoffset() is None:
        raise ValueError("generated_at must be timezone-aware")
    rows = tuple(sorted(observations, key=lambda row: row.period))
    if not rows:
        raise ValueError("Chart assets require at least one observation")
    series_ids = {row.series_id for row in rows}
    geography_ids = {row.geography_id for row in rows}
    units = {row.unit for row in rows}
    dimensions = {tuple(sorted(row.dimensions)) for row in rows}
    if any(len(values) != 1 for values in (series_ids, geography_ids, units, dimensions)):
        raise ValueError("Chart asset rows must share series, geography, unit, and dimensions")
    coordinates = [_coordinate(row.period, frequency) for row in rows]
    if len(coordinates) != len(set(coordinates)):
        raise ValueError("Chart asset has duplicate seasonal coordinates")

    anchor_year = max(year for year, _ in coordinates)
    display_years = tuple(range(anchor_year - 2, anchor_year + 1))
    baseline_end = display_years[0] - 1
    baseline_start = baseline_end - baseline_year_count + 1
    by_year: dict[int, dict[int, Observation]] = defaultdict(dict)
    for row, (year, slot) in zip(rows, coordinates, strict=True):
        by_year[year][slot] = row

    eligible_years = tuple(
        year
        for year in range(baseline_start, baseline_end + 1)
        if _complete_year(by_year.get(year, {}), frequency)
    )
    baseline_status = (
        "ok" if len(eligible_years) >= minimum_complete_baseline_years else "insufficient_history"
    )
    baseline_slots = (
        _baseline_slots(by_year, eligible_years, minimum_complete_baseline_years)
        if baseline_status == "ok"
        else []
    )
    recent_years = [
        {
            "year": year,
            "points": [
                {
                    "period": row.period,
                    "slot": slot,
                    "value": _number(row.value),
                    "status": row.status.value,
                }
                for slot, row in sorted(by_year.get(year, {}).items())
            ],
        }
        for year in display_years
    ]
    numeric = [row for row in rows if row.value is not None]
    if not numeric:
        raise ValueError("Chart assets require at least one numeric observation")
    latest = _latest_diagnostics(
        numeric, frequency, by_year, baseline_slots, eligible_years
    )
    values = [float(row.value) for row in numeric if row.value is not None]
    changes = [
        float(right.value - left.value)
        for left, right in zip(numeric, numeric[1:])
        if left.value is not None
        and right.value is not None
        and _consecutive(left.period, right.period, frequency)
    ]
    source_canonical = json.dumps(
        [
            [row.key, None if row.value is None else str(row.value), row.status.value]
            for row in rows
        ],
        separators=(",", ":"),
        ensure_ascii=True,
    ).encode("utf-8")
    asset = {
        "schema_version": ASSET_SCHEMA_VERSION,
        "methodology_version": METHODOLOGY_VERSION,
        "series_id": rows[0].series_id,
        "geography_id": rows[0].geography_id,
        "dimensions": dict(sorted(rows[0].dimensions)),
        "frequency": frequency.value,
        "unit": rows[0].unit,
        "generated_at": generated_at.astimezone(UTC).isoformat(),
        "source_checksum": hashlib.sha256(source_canonical).hexdigest(),
        # Period-level history is intentionally compact and status preserving.  It
        # lets the static browser combine explicitly approved, mutually exclusive
        # geographies before recomputing bands and distributions.  Precomputed
        # statistics must never be added together.
        "history": [
            {
                "period": row.period,
                "year": year,
                "slot": slot,
                "value": _number(row.value),
                "status": row.status.value,
            }
            for row, (year, slot) in zip(rows, coordinates, strict=True)
        ],
        "recent_years": recent_years,
        "baseline": {
            "status": baseline_status,
            "start_year": baseline_start if baseline_status == "ok" else None,
            "end_year": baseline_end if baseline_status == "ok" else None,
            "eligible_years": len(eligible_years),
            "eligible_year_values": list(eligible_years),
            "excluded_years": [
                year for year in range(baseline_start, baseline_end + 1) if year not in eligible_years
            ],
            "slots": baseline_slots,
        },
        "latest": latest,
        "latest_source": {
            "period": rows[-1].period,
            "value": _number(rows[-1].value),
            "status": rows[-1].status.value,
        },
        "distribution": {
            "levels": _distribution(values, numeric[0].period, numeric[-1].period),
            "changes": _distribution(changes, numeric[0].period, numeric[-1].period),
        },
        "aggregation_lineage": aggregation_lineage,
        "freshness": freshness,
    }
    _assert_json_safe(asset)
    return asset


def write_chart_asset(path: Path, asset: Mapping[str, Any]) -> None:
    """Atomically replace one generated asset after strict JSON validation."""

    _assert_json_safe(asset)
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = (json.dumps(asset, sort_keys=True, separators=(",", ":"), allow_nan=False) + "\n").encode(
        "utf-8"
    )
    descriptor, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(descriptor, "wb") as output:
            output.write(payload)
            output.flush()
            os.fsync(output.fileno())
        replace_path_with_retry(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def _coordinate(period: str, frequency: Frequency) -> tuple[int, int]:
    if frequency is Frequency.MONTHLY:
        try:
            year, month = (int(part) for part in period[:7].split("-"))
        except (TypeError, ValueError):
            raise ValueError(f"Invalid monthly period: {period!r}") from None
        if not 1 <= month <= 12:
            raise ValueError(f"Invalid monthly period: {period!r}")
        return year, month
    if frequency is Frequency.WEEKLY:
        try:
            parsed = date.fromisoformat(period)
        except ValueError:
            raise ValueError(f"Weekly periods must be ISO dates: {period!r}") from None
        iso = parsed.isocalendar()
        return iso.year, iso.week
    raise ValueError("Seasonal assets currently support monthly and weekly series")


def _complete_year(rows: Mapping[int, Observation], frequency: Frequency) -> bool:
    numeric_slots = {slot for slot, row in rows.items() if row.value is not None}
    if frequency is Frequency.MONTHLY:
        return numeric_slots == set(range(1, 13))
    return set(range(1, 53)).issubset(numeric_slots)


def _baseline_slots(
    by_year: Mapping[int, Mapping[int, Observation]],
    eligible_years: tuple[int, ...],
    minimum_slot_samples: int,
) -> list[dict[str, Any]]:
    slots = sorted({slot for year in eligible_years for slot in by_year[year]})
    output: list[dict[str, Any]] = []
    for slot in slots:
        values = sorted(
            row.value
            for year in eligible_years
            if (row := by_year[year].get(slot)) is not None and row.value is not None
        )
        if len(values) < minimum_slot_samples:
            continue
        output.append(
            {
                "slot": slot,
                "min": _number(values[0]),
                "q1": _number(_quantile(values, Decimal("0.25"))),
                "median": _number(_quantile(values, Decimal("0.5"))),
                "mean": _number(sum(values, Decimal("0")) / Decimal(len(values))),
                "q3": _number(_quantile(values, Decimal("0.75"))),
                "max": _number(values[-1]),
                "count": len(values),
            }
        )
    return output


def _quantile(values: list[Decimal], probability: Decimal) -> Decimal:
    if len(values) == 1:
        return values[0]
    position = Decimal(len(values) - 1) * probability
    lower = int(position)
    upper = min(lower + 1, len(values) - 1)
    fraction = position - Decimal(lower)
    return values[lower] + (values[upper] - values[lower]) * fraction


def _latest_diagnostics(
    rows: list[Observation],
    frequency: Frequency,
    by_year: Mapping[int, Mapping[int, Observation]],
    baseline_slots: list[dict[str, Any]],
    eligible_years: tuple[int, ...],
) -> dict[str, Any]:
    latest = rows[-1]
    previous = rows[-2] if len(rows) >= 2 and _consecutive(rows[-2].period, latest.period, frequency) else None
    year, slot = _coordinate(latest.period, frequency)
    prior_year = by_year.get(year - 1, {}).get(slot)
    baseline = next((item for item in baseline_slots if item["slot"] == slot), None)
    slot_values = [
        row.value
        for candidate_year in eligible_years
        if (year_rows := by_year.get(candidate_year)) is not None
        and (row := year_rows.get(slot)) is not None
        and row.value is not None
    ]
    return {
        "period": latest.period,
        "value": _number(latest.value),
        "previous_period": None if previous is None else previous.period,
        "absolute_change": _difference(latest, previous),
        "percent_change": _percent_change(latest, previous),
        "year_ago_period": None if prior_year is None else prior_year.period,
        "yoy_absolute_change": _difference(latest, prior_year),
        "yoy_percent_change": _percent_change(latest, prior_year),
        "seasonal_median": None if baseline is None else baseline["median"],
        "distance_from_seasonal_median": (
            None
            if baseline is None or latest.value is None
            else _number(latest.value - Decimal(str(baseline["median"])))
        ),
        "seasonal_percentile": (
            None
            if not slot_values or latest.value is None
            else 100.0 * sum(value <= latest.value for value in slot_values) / len(slot_values)
        ),
    }


def _difference(left: Observation, right: Observation | None) -> float | int | None:
    if right is None or left.value is None or right.value is None:
        return None
    return _number(left.value - right.value)


def _percent_change(left: Observation, right: Observation | None) -> float | int | None:
    if right is None or left.value is None or right.value in {None, Decimal("0")}:
        return None
    return _number((left.value / right.value - Decimal("1")) * Decimal("100"))


def _consecutive(left: str, right: str, frequency: Frequency) -> bool:
    if frequency is Frequency.MONTHLY:
        left_year, left_month = _coordinate(left, frequency)
        right_year, right_month = _coordinate(right, frequency)
        return right_year * 12 + right_month == left_year * 12 + left_month + 1
    return (date.fromisoformat(right) - date.fromisoformat(left)).days == 7


def _distribution(values: list[float], period_start: str, period_end: str) -> dict[str, Any]:
    if not values:
        return {
            "status": "insufficient_sample",
            "count": 0,
            "period_start": period_start,
            "period_end": period_end,
            "mean": None,
            "median": None,
            "stddev": None,
            "min": None,
            "q1": None,
            "q3": None,
            "max": None,
            "iqr": None,
            "skewness": None,
            "excess_kurtosis": None,
            "histogram": [],
            "fit": _fit_diagnostic([], None, None, None),
        }
    ordered = sorted(values)
    count = len(ordered)
    mean = sum(ordered) / count
    median = _float_quantile(ordered, 0.5)
    q1 = _float_quantile(ordered, 0.25)
    q3 = _float_quantile(ordered, 0.75)
    sample_stddev = (
        math.sqrt(sum((value - mean) ** 2 for value in ordered) / (count - 1))
        if count > 1
        else 0.0
    )
    m2 = sum((value - mean) ** 2 for value in ordered) / count
    skewness = None if m2 == 0 else (sum((v - mean) ** 3 for v in ordered) / count) / m2**1.5
    kurtosis = None if m2 == 0 else (sum((v - mean) ** 4 for v in ordered) / count) / m2**2 - 3
    return {
        "status": "ok",
        "count": count,
        "period_start": period_start,
        "period_end": period_end,
        "mean": mean,
        "median": median,
        "stddev": sample_stddev,
        "min": ordered[0],
        "q1": q1,
        "q3": q3,
        "max": ordered[-1],
        "iqr": q3 - q1,
        "skewness": skewness,
        "excess_kurtosis": kurtosis,
        "histogram": _histogram(ordered, q3 - q1),
        "fit": _fit_diagnostic(ordered, mean, sample_stddev, (skewness, kurtosis)),
    }


def _float_quantile(values: list[float], probability: float) -> float:
    if len(values) == 1:
        return values[0]
    position = (len(values) - 1) * probability
    lower = math.floor(position)
    upper = min(lower + 1, len(values) - 1)
    return values[lower] + (values[upper] - values[lower]) * (position - lower)


def _histogram(values: list[float], iqr: float) -> list[dict[str, Any]]:
    if values[0] == values[-1]:
        return [{"lower": values[0], "upper": values[-1], "count": len(values)}]
    width = 2 * iqr / (len(values) ** (1 / 3)) if iqr > 0 else 0
    bins = math.ceil((values[-1] - values[0]) / width) if width > 0 else math.ceil(math.sqrt(len(values)))
    bins = max(1, min(40, bins))
    step = (values[-1] - values[0]) / bins
    edges = [values[0] + step * index for index in range(bins + 1)]
    counts = [0] * bins
    for value in values:
        index = min(int((value - values[0]) / step), bins - 1)
        counts[index] += 1
    return [
        {"lower": edges[index], "upper": edges[index + 1], "count": count}
        for index, count in enumerate(counts)
    ]


def _fit_diagnostic(
    values: list[float],
    mean: float | None,
    stddev: float | None,
    moments: tuple[float | None, float | None] | None,
) -> dict[str, Any]:
    if len(values) < 30 or mean is None or stddev in {None, 0} or moments is None:
        return {
            "status": "insufficient_sample",
            "best_candidate": None,
            "criterion": "AIC",
            "aic": None,
            "tested_candidates": [],
            "reason": "Insufficient sample for candidate distribution fitting (minimum 30).",
        }
    skewness, excess_kurtosis = moments
    assert skewness is not None and excess_kurtosis is not None and stddev is not None
    variance_mle = sum((value - mean) ** 2 for value in values) / len(values)
    log_likelihood = -0.5 * len(values) * (math.log(2 * math.pi * variance_mle) + 1)
    jarque_bera = len(values) / 6 * (skewness**2 + excess_kurtosis**2 / 4)
    return {
        "status": "candidate_diagnostic",
        "best_candidate": "Normal",
        "criterion": "AIC (single stdlib baseline candidate)",
        "aic": 4 - 2 * log_likelihood,
        "tested_candidates": ["Normal"],
        "reason": "Normal candidate diagnostic only; not a definitive distribution classification.",
        "diagnostics": {
            "parameters": {"mean": mean, "standard_deviation": math.sqrt(variance_mle)},
            "log_likelihood": log_likelihood,
            "jarque_bera_statistic": jarque_bera,
            "p_value": None,
        },
    }


def _number(value: Decimal | None) -> int | float | None:
    if value is None:
        return None
    integral = value.to_integral_value()
    return int(integral) if value == integral else float(value)


def _assert_json_safe(value: Any) -> None:
    json.dumps(value, allow_nan=False)

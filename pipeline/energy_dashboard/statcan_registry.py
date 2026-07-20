"""Strict registry loading and row normalization for Statistics Canada tables."""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from datetime import date, datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Mapping

from .contracts import Frequency, Observation, ObservationStatus
from .registry import (
    ProviderGeographyIndex,
    SeriesDisplayClassification,
)
from .statcan import StatCanTableSpec
from .validation import find_embedded_secrets


_MONTH = re.compile(r"^\d{4}-\d{2}$")


@dataclass(frozen=True, slots=True)
class RegistryStatCanSeries:
    id: str
    metric_id: str
    title: str
    description: str
    source_name: str
    source_url: str
    canonical_unit: str
    frequency: Frequency
    table: StatCanTableSpec
    row_filters: tuple[tuple[str, str], ...]
    expected_fields: tuple[tuple[str, str], ...]
    source_geography_ids: tuple[str, ...]
    source_geography_level_ids: tuple[str, ...]
    unsupported_levels: tuple[tuple[str, str], ...]
    display: SeriesDisplayClassification | None = None
    bootstrap_start: str | None = None


def load_statcan_registry(
    path: Path, *, activation_status: str = "active"
) -> tuple[RegistryStatCanSeries, ...]:
    document = _load_json(path)
    issues = find_embedded_secrets(document)
    if issues:
        raise ValueError(f"Registry contains forbidden credential values: {issues[0].path}")
    providers = document.get("providers")
    tables = document.get("tables")
    series_items = document.get("series")
    if not isinstance(providers, list) or not isinstance(tables, list) or not isinstance(
        series_items, list
    ):
        raise ValueError("Statistics Canada registry requires providers, tables, and series arrays")
    provider_names = {
        str(item["id"]): str(item["name"])
        for item in providers
        if isinstance(item, Mapping)
    }
    table_specs: dict[str, tuple[StatCanTableSpec, str, tuple[tuple[str, str], ...]]] = {}
    for raw in tables:
        table = _require_mapping(raw, "table")
        pid = str(table["pid"])
        if pid in table_specs:
            raise ValueError(f"Duplicate Statistics Canada table PID: {pid}")
        table_specs[pid] = (
            StatCanTableSpec(
                pid=pid,
                wds_url=str(table["wds_url"]),
                csv_member=str(table["csv_member"]),
                metadata_member=str(table["metadata_member"]),
                required_headers=tuple(
                    str(value) for value in _list(table["required_headers"], "required_headers")
                ),
                max_archive_bytes=int(table.get("max_archive_bytes", 32 * 1024 * 1024)),
                max_uncompressed_bytes=int(
                    table.get("max_uncompressed_bytes", 256 * 1024 * 1024)
                ),
            ),
            str(table["landing_page"]),
            _string_mapping(table.get("expected_fields"), "expected_fields"),
        )
    profiles_raw = document.get("geography_profiles")
    if not isinstance(profiles_raw, Mapping):
        raise ValueError("Statistics Canada registry requires geography_profiles")
    geography_profiles = {
        str(profile_id): _require_mapping(profile, f"geography profile {profile_id}")
        for profile_id, profile in profiles_raw.items()
    }
    bootstrap_raw = document.get("bootstrap_period_start_by_frequency", {})
    if not isinstance(bootstrap_raw, Mapping):
        raise ValueError("bootstrap_period_start_by_frequency must be an object")
    bootstrap = {str(key): str(value) for key, value in bootstrap_raw.items()}

    output: list[RegistryStatCanSeries] = []
    for raw in series_items:
        item = _require_mapping(raw, "series")
        if item.get("provider_id") != "statcan" or item.get("activation_status") != activation_status:
            continue
        pid = str(item["table_pid"])
        if pid not in table_specs:
            raise ValueError(f"Series references unknown Statistics Canada table PID {pid}")
        table, landing_page, table_expected = table_specs[pid]
        frequency = Frequency(str(item["frequency"]))
        if frequency is not Frequency.MONTHLY:
            raise ValueError("The Statistics Canada full-table adapter currently supports monthly series")
        filters = _string_mapping(item.get("row_filters"), "row_filters")
        expected = (
            table_expected
            if item.get("expected_fields") is None
            else _string_mapping(item.get("expected_fields"), "expected_fields")
        )
        filter_names = {key for key, _ in filters}
        if "REF_DATE" in filter_names or "GEO" in filter_names or "DGUID" in filter_names:
            raise ValueError("Statistics Canada semantic filters cannot include period or geography")
        if not filter_names or not {"UOM", "UOM_ID", "SCALAR_FACTOR", "SCALAR_ID"}.issubset(
            {key for key, _ in expected}
        ):
            raise ValueError("Statistics Canada series must pin semantic filters and unit/scalar fields")
        profile_id = str(item.get("geography_profile_id", ""))
        if profile_id and profile_id not in geography_profiles:
            raise ValueError(f"Unknown Statistics Canada geography profile {profile_id!r}")
        availability = (
            geography_profiles[profile_id]
            if profile_id
            else _mapping(item, "geography_availability")
        )
        geography_ids = tuple(
            str(value)
            for value in _list(availability.get("source_geography_ids"), "source_geography_ids")
        )
        if not geography_ids or len(geography_ids) != len(set(geography_ids)):
            raise ValueError("Statistics Canada source geography ids must be non-empty and unique")
        levels = tuple(
            str(value)
            for value in _list(
                availability.get("source_geography_level_ids"),
                "source_geography_level_ids",
            )
        )
        unsupported = tuple(
            (
                str(_require_mapping(value, "unsupported level")["level_id"]),
                str(_require_mapping(value, "unsupported level")["reason"]),
            )
            for value in _list(availability.get("unsupported_levels", []), "unsupported_levels")
        )
        display = _load_display(item.get("display"))
        caveats = tuple(str(value) for value in _list(item.get("caveats", []), "caveats"))
        output.append(
            RegistryStatCanSeries(
                id=str(item["id"]),
                metric_id=str(item["metric_id"]),
                title=str(item["name"]),
                description=" ".join(caveats),
                source_name=provider_names.get("statcan", "Statistics Canada"),
                source_url=landing_page,
                canonical_unit=str(item["unit"]),
                frequency=frequency,
                table=table,
                row_filters=filters,
                expected_fields=expected,
                source_geography_ids=geography_ids,
                source_geography_level_ids=levels,
                unsupported_levels=unsupported,
                display=display,
                bootstrap_start=(
                    bootstrap.get(frequency.value)
                    if item.get("bootstrap_period_start") is None
                    else str(item["bootstrap_period_start"])
                ),
            )
        )
    ids = [item.id for item in output]
    if len(ids) != len(set(ids)):
        raise ValueError("Active Statistics Canada series ids must be unique")
    return tuple(sorted(output, key=lambda value: value.id))


def normalize_statcan_records(
    series: RegistryStatCanSeries,
    records: tuple[Mapping[str, str], ...],
    geographies: ProviderGeographyIndex,
    *,
    retrieved_at: datetime,
    period_start: str | None = None,
    period_end: str | None = None,
) -> tuple[Observation, ...]:
    if retrieved_at.tzinfo is None or retrieved_at.utcoffset() is None:
        raise ValueError("retrieved_at must be timezone-aware")
    start = _month_bound(period_start, "period_start")
    end = _month_bound(period_end, "period_end")
    if start is not None and end is not None and start > end:
        raise ValueError("Statistics Canada period_start cannot follow period_end")
    filters = dict(series.row_filters)
    selected = tuple(
        (index, row)
        for index, row in enumerate(records)
        if all(str(row.get(field, "")) == expected for field, expected in filters.items())
    )
    if not selected:
        raise ValueError(f"Statistics Canada returned no rows for registered series {series.id}")

    expected_fields = dict(series.expected_fields)
    seen_geographies: set[str] = set()
    vector_by_geography: dict[str, set[str]] = {}
    coordinate_by_geography: dict[str, set[str]] = {}
    output: list[Observation] = []
    for index, row in selected:
        period = _required(row, "REF_DATE", index)
        _validate_month(period)
        if (start is not None and period < start) or (end is not None and period > end):
            continue
        dguid = _required(row, "DGUID", index)
        geography_id, level_id = geographies.resolve(dguid)
        if geography_id not in series.source_geography_ids:
            raise ValueError(
                f"Statistics Canada row geography {geography_id!r} escaped the registered set "
                f"for {series.id}"
            )
        if level_id not in series.source_geography_level_ids:
            raise ValueError(
                f"Statistics Canada row geography {geography_id!r} is at an unavailable level"
            )
        label = _required(row, "GEO", index)
        if label != geographies.label_by_geography_id[geography_id]:
            raise ValueError(
                f"Statistics Canada DGUID/label mismatch for {geography_id}: {label!r}"
            )
        for field, expected in expected_fields.items():
            if _required(row, field, index) != expected:
                raise ValueError(
                    f"Statistics Canada expected field {field!r} drifted for {series.id}"
                )
        vector = _required(row, "VECTOR", index)
        coordinate = _required(row, "COORDINATE", index)
        vector_by_geography.setdefault(geography_id, set()).add(vector)
        coordinate_by_geography.setdefault(geography_id, set()).add(coordinate)
        seen_geographies.add(geography_id)

        raw_value = str(row.get("VALUE", "")).strip()
        status_code = str(row.get("STATUS", "")).strip()
        symbol_code = str(row.get("SYMBOL", "")).strip()
        value, status = _value_and_status(raw_value, status_code, index)
        flags = tuple(
            value
            for value in (
                f"statcan_status:{status_code}" if status_code else None,
                f"statcan_symbol:{symbol_code}" if symbol_code else None,
                "statcan_terminated" if str(row.get("TERMINATED", "")).strip() else None,
            )
            if value is not None
        )
        output.append(
            Observation(
                provider_id="statcan",
                series_id=series.id,
                period=period,
                geography_id=geography_id,
                value=value,
                unit=series.canonical_unit,
                retrieved_at=retrieved_at,
                status=status,
                dimensions=(("coordinate", coordinate), ("vector", vector)),
                flags=flags,
                original_value=raw_value or None,
                original_unit=_required(row, "UOM", index),
            )
        )
    missing = set(series.source_geography_ids) - seen_geographies
    if missing:
        raise ValueError(
            f"Statistics Canada table omitted registered geographies for {series.id}: {sorted(missing)}"
        )
    for geography_id in seen_geographies:
        if len(vector_by_geography[geography_id]) != 1:
            raise ValueError(
                f"Statistics Canada vector identity drifted for {series.id}/{geography_id}"
            )
        if len(coordinate_by_geography[geography_id]) != 1:
            raise ValueError(
                f"Statistics Canada coordinate identity drifted for {series.id}/{geography_id}"
            )
    keys = [row.key for row in output]
    if len(keys) != len(set(keys)):
        raise ValueError(f"Normalized Statistics Canada batch contains duplicate keys for {series.id}")
    if not output:
        raise ValueError(f"Statistics Canada period window is empty for {series.id}")
    return tuple(sorted(output, key=lambda row: row.key))


def _value_and_status(
    raw_value: str, status_code: str, row_number: int
) -> tuple[Decimal | None, ObservationStatus]:
    missing_statuses = {
        "x": ObservationStatus.SUPPRESSED_OR_WITHHELD,
        "F": ObservationStatus.SUPPRESSED_OR_WITHHELD,
        "..": ObservationStatus.NOT_AVAILABLE,
        "...": ObservationStatus.NOT_APPLICABLE,
        "--": ObservationStatus.NOT_APPLICABLE,
    }
    numeric_statuses = {
        "": ObservationStatus.OBSERVED,
        "p": ObservationStatus.PRELIMINARY,
        "r": ObservationStatus.OBSERVED,
        "E": ObservationStatus.USE_WITH_CAUTION,
    }
    if status_code in missing_statuses:
        if raw_value:
            raise ValueError(
                f"Statistics Canada row {row_number} has a value with non-numeric status {status_code!r}"
            )
        return None, missing_statuses[status_code]
    if status_code not in numeric_statuses:
        raise ValueError(
            f"Statistics Canada row {row_number} has unreviewed status code {status_code!r}"
        )
    if not raw_value:
        raise ValueError(
            f"Statistics Canada row {row_number} has no value or reviewed missing-data status"
        )
    try:
        value = Decimal(raw_value)
    except (InvalidOperation, ValueError):
        raise ValueError(f"Statistics Canada row {row_number} has a non-numeric value") from None
    if not value.is_finite():
        raise ValueError(f"Statistics Canada row {row_number} has a non-finite value")
    return value, numeric_statuses[status_code]


def _load_display(value: object) -> SeriesDisplayClassification | None:
    if value is None:
        return None
    display = _require_mapping(value, "display")
    parent = display.get("parent_product_id")
    return SeriesDisplayClassification(
        dashboard_group=str(display["dashboard_group"]),
        product_family_id=str(display["product_family_id"]),
        product_family_label=str(display["product_family_label"]),
        product_id=str(display["product_id"]),
        product_label=str(display["product_label"]),
        measure_id=str(display["measure_id"]),
        measure_label=str(display["measure_label"]),
        component_role=str(display["component_role"]),
        parent_product_id=None if parent is None else str(parent),
        reference_term_ids=tuple(
            str(item)
            for item in _list(display.get("reference_term_ids", []), "reference_term_ids")
        ),
        display_order=int(display.get("display_order", 0)),
    )


def _month_bound(value: str | None, name: str) -> str | None:
    if value is None:
        return None
    month = value[:7]
    _validate_month(month, name)
    return month


def _validate_month(value: str, name: str = "REF_DATE") -> None:
    if not _MONTH.fullmatch(value):
        raise ValueError(f"Invalid monthly {name}: {value!r}")
    try:
        date.fromisoformat(f"{value}-01")
    except ValueError:
        raise ValueError(f"Invalid monthly {name}: {value!r}") from None


def _required(row: Mapping[str, Any], field: str, index: int) -> str:
    value = row.get(field)
    if value is None or str(value) == "":
        raise ValueError(f"Statistics Canada row {index} is missing required field {field!r}")
    return str(value)


def _load_json(path: Path) -> Mapping[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, Mapping):
        raise ValueError("Statistics Canada registry root must be an object")
    return value


def _mapping(value: Mapping[str, Any], name: str) -> Mapping[str, Any]:
    result = value.get(name)
    if not isinstance(result, Mapping):
        raise ValueError(f"{name} must be an object")
    return result


def _string_mapping(value: object, name: str) -> tuple[tuple[str, str], ...]:
    mapping = _require_mapping(value, name)
    return tuple(sorted((str(key), str(item)) for key, item in mapping.items()))


def _require_mapping(value: object, name: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{name} must be an object")
    return value


def _list(value: object, name: str) -> list[Any]:
    if not isinstance(value, list):
        raise ValueError(f"{name} must be an array")
    return value

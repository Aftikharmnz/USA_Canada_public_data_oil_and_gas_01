"""Strict loaders for verified, registry-defined EIA series and geography codes."""

from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Mapping

from .contracts import Frequency, Observation, ObservationStatus
from .eia import EIAQuerySpec, EIASort
from .validation import find_embedded_secrets


@dataclass(frozen=True, slots=True)
class SeriesDisplayClassification:
    dashboard_group: str
    product_family_id: str
    product_family_label: str
    product_id: str
    product_label: str
    measure_id: str
    measure_label: str
    component_role: str
    parent_product_id: str | None
    reference_term_ids: tuple[str, ...]
    display_order: int


@dataclass(frozen=True, slots=True)
class RegistryEIASeries:
    id: str
    metric_id: str
    title: str
    description: str
    source_name: str
    source_url: str
    canonical_unit: str
    frequency: Frequency
    route: str
    credential_environment_variable: str
    query: EIAQuerySpec
    expected_unit: str
    expected_facets: tuple[tuple[str, str], ...]
    dimensions: tuple[str, ...]
    source_geography_level_ids: tuple[str, ...]
    unsupported_levels: tuple[tuple[str, str], ...]
    source_geography_ids: tuple[str, ...] = ()
    display: SeriesDisplayClassification | None = None
    bootstrap_start: str | None = None


@dataclass(frozen=True, slots=True)
class ProviderGeographyIndex:
    provider_id: str
    provider_code_field: str
    code_to_geography_id: Mapping[str, str]
    level_by_geography_id: Mapping[str, str]
    label_by_geography_id: Mapping[str, str]
    level_label_by_id: Mapping[str, str]
    level_rank_by_id: Mapping[str, int]

    def resolve(self, provider_code: str) -> tuple[str, str]:
        geography_id = self.code_to_geography_id.get(provider_code)
        if geography_id is None:
            raise ValueError(
                f"Unverified {self.provider_id} geography code {provider_code!r}; registry update required"
            )
        return geography_id, self.level_by_geography_id[geography_id]

    def display_metadata(self, geography_id: str) -> tuple[str, str, str, int]:
        level_id = self.level_by_geography_id[geography_id]
        return (
            self.label_by_geography_id[geography_id],
            level_id,
            self.level_label_by_id[level_id],
            self.level_rank_by_id[level_id],
        )


def load_eia_registry(
    path: Path,
    *,
    activation_status: str = "active",
) -> tuple[RegistryEIASeries, ...]:
    document = _load_json(path)
    issues = find_embedded_secrets(document)
    if issues:
        raise ValueError(f"Registry contains forbidden credential values: {issues[0].path}")
    series_items = document.get("series")
    if not isinstance(series_items, list):
        raise ValueError("Series registry must contain a series array")
    output: list[RegistryEIASeries] = []
    providers_raw = document.get("providers", [])
    if not isinstance(providers_raw, list):
        raise ValueError("Series registry providers must be an array")
    registry_bootstrap_starts_raw = document.get(
        "bootstrap_period_start_by_frequency", {}
    )
    if not isinstance(registry_bootstrap_starts_raw, Mapping):
        raise ValueError("bootstrap_period_start_by_frequency must be an object")
    registry_bootstrap_starts = {
        str(frequency): str(start)
        for frequency, start in registry_bootstrap_starts_raw.items()
    }
    provider_names = {
        str(provider["id"]): str(provider["name"])
        for provider in providers_raw
        if isinstance(provider, Mapping)
    }
    for item in series_items:
        if not isinstance(item, Mapping) or item.get("activation_status") != activation_status:
            continue
        if item.get("provider_id") != "eia":
            continue
        source = _mapping(item, "source")
        api_query = _mapping(source, "api_query")
        facet_filters = _mapping(api_query, "facet_filters")
        facets = tuple(
            (str(name), tuple(str(value) for value in _list(values, f"facet_filters.{name}")))
            for name, values in sorted(facet_filters.items())
        )
        identity_fields_raw = api_query.get("identity_fields")
        identity_fields = (
            tuple(str(value) for value in _list(identity_fields_raw, "identity_fields"))
            if identity_fields_raw is not None
            else tuple(
                dict.fromkeys(("period", "duoarea", *(name for name, _ in facets), "units"))
            )
        )
        sort_items = api_query.get("sort")
        if sort_items is None:
            # EIA includes ``units`` in petroleum response rows, but rejects it
            # as an API sort column (HTTP 400).  Keep it in the local identity
            # key while sorting remotely by the remaining stable dimensions.
            sortable_identity_fields = tuple(
                field for field in identity_fields if field != "units"
            )
            sort = tuple(EIASort(field) for field in sortable_identity_fields)
        else:
            sort = tuple(
                EIASort(
                    str(_require_mapping(value, "sort item")["column"]),
                    str(_require_mapping(value, "sort item").get("direction", "asc")),
                )
                for value in _list(sort_items, "sort")
            )
        extra = api_query.get("extra_parameters", {})
        if not isinstance(extra, Mapping):
            raise ValueError("api_query.extra_parameters must be an object")
        query = EIAQuerySpec(
            route=str(source["route_template"]),
            frequency=str(api_query["frequency"]),
            data_fields=tuple(str(value) for value in _list(api_query["data_fields"], "data_fields")),
            facets=facets,
            start=None if api_query.get("start") is None else str(api_query["start"]),
            end=None if api_query.get("end") is None else str(api_query["end"]),
            sort=sort,
            extra_parameters=tuple(sorted((str(key), str(value)) for key, value in extra.items())),
            identity_fields=identity_fields,
        )
        availability = _mapping(item, "geography_availability")
        expected = api_query.get("expected_facets", {})
        if not isinstance(expected, Mapping):
            raise ValueError("api_query.expected_facets must be an object")
        unsupported_raw = _list(availability.get("unsupported_levels", []), "unsupported_levels")
        unsupported = tuple(
            (
                str(_require_mapping(value, "unsupported level")["level_id"]),
                str(_require_mapping(value, "unsupported level")["reason"]),
            )
            for value in unsupported_raw
        )
        source_geography_ids = tuple(
            str(value)
            for value in _list(
                availability.get("source_geography_ids", []),
                "source_geography_ids",
            )
        )
        if len(source_geography_ids) != len(set(source_geography_ids)):
            raise ValueError(f"Duplicate source geography id for {item.get('id')}")
        display_raw = item.get("display")
        display: SeriesDisplayClassification | None = None
        if display_raw is not None:
            display_mapping = _require_mapping(display_raw, "display")
            parent_product_id = display_mapping.get("parent_product_id")
            display = SeriesDisplayClassification(
                dashboard_group=str(display_mapping["dashboard_group"]),
                product_family_id=str(display_mapping["product_family_id"]),
                product_family_label=str(display_mapping["product_family_label"]),
                product_id=str(display_mapping["product_id"]),
                product_label=str(display_mapping["product_label"]),
                measure_id=str(display_mapping["measure_id"]),
                measure_label=str(display_mapping["measure_label"]),
                component_role=str(display_mapping["component_role"]),
                parent_product_id=(
                    None if parent_product_id is None else str(parent_product_id)
                ),
                reference_term_ids=tuple(
                    str(value)
                    for value in _list(
                        display_mapping.get("reference_term_ids", []),
                        "display.reference_term_ids",
                    )
                ),
                display_order=int(display_mapping.get("display_order", 0)),
            )
        caveats = tuple(str(value) for value in _list(item.get("caveats", []), "caveats"))
        output.append(
            RegistryEIASeries(
                id=str(item["id"]),
                metric_id=str(item["metric_id"]),
                title=str(item["name"]),
                description=" ".join(caveats),
                source_name=provider_names.get("eia", "U.S. Energy Information Administration"),
                source_url=str(source["landing_page"]),
                canonical_unit=str(item["unit"]),
                frequency=Frequency(str(item["frequency"])),
                route=str(source["route_template"]),
                credential_environment_variable=str(source["credential_environment_variable"]),
                query=query,
                expected_unit=str(api_query["expected_unit"]),
                expected_facets=tuple(sorted((str(key), str(value)) for key, value in expected.items())),
                dimensions=tuple(str(value) for value in _list(item.get("dimensions", []), "dimensions")),
                source_geography_level_ids=tuple(
                    str(value)
                    for value in _list(
                        availability["source_geography_level_ids"],
                        "source_geography_level_ids",
                    )
                ),
                unsupported_levels=unsupported,
                source_geography_ids=source_geography_ids,
                display=display,
                bootstrap_start=(
                    registry_bootstrap_starts.get(str(item["frequency"]))
                    if item.get("bootstrap_period_start") is None
                    else str(item["bootstrap_period_start"])
                ),
            )
        )
    ids = [item.id for item in output]
    if len(ids) != len(set(ids)):
        raise ValueError("Active EIA series ids must be unique")
    return tuple(sorted(output, key=lambda item: item.id))


def load_provider_geographies(
    path: Path,
    *,
    provider_id: str = "eia",
    provider_code_field: str = "eia_duoarea",
) -> ProviderGeographyIndex:
    document = _load_json(path)
    nodes = document.get("nodes")
    if not isinstance(nodes, list):
        raise ValueError("Geography registry must contain a nodes array")
    code_to_id: dict[str, str] = {}
    level_by_id: dict[str, str] = {}
    label_by_id: dict[str, str] = {}
    levels = document.get("levels")
    if not isinstance(levels, list):
        raise ValueError("Geography registry must contain a levels array")
    level_labels = {
        str(level["id"]): str(level["label"])
        for level in levels
        if isinstance(level, Mapping)
    }
    level_ranks = {
        str(level["id"]): int(level["granularity_rank"])
        for level in levels
        if isinstance(level, Mapping)
    }
    for node in nodes:
        if not isinstance(node, Mapping):
            raise ValueError("Geography nodes must be objects")
        geography_id = str(node["id"])
        level_by_id[geography_id] = str(node["level_id"])
        label_by_id[geography_id] = str(node["name"])
        codes = node.get("provider_codes", {})
        if not isinstance(codes, Mapping):
            raise ValueError(f"provider_codes must be an object for {geography_id}")
        provider_codes: list[str] = []
        code = codes.get(provider_code_field)
        if code is not None:
            provider_codes.append(str(code))
        aliases = node.get("provider_code_aliases", {})
        if not isinstance(aliases, Mapping):
            raise ValueError(f"provider_code_aliases must be an object for {geography_id}")
        alias_values = aliases.get(provider_code_field, [])
        provider_codes.extend(
            str(value)
            for value in _list(alias_values, f"provider_code_aliases.{provider_code_field}")
        )
        for provider_code in provider_codes:
            if provider_code in code_to_id:
                raise ValueError(
                    f"Duplicate {provider_code_field} code {provider_code!r}"
                )
            code_to_id[provider_code] = geography_id
    return ProviderGeographyIndex(
        provider_id,
        provider_code_field,
        code_to_id,
        level_by_id,
        label_by_id,
        level_labels,
        level_ranks,
    )


def normalize_eia_records(
    series: RegistryEIASeries,
    records: tuple[Mapping[str, Any], ...],
    geographies: ProviderGeographyIndex,
    *,
    retrieved_at: datetime,
) -> tuple[Observation, ...]:
    if retrieved_at.tzinfo is None or retrieved_at.utcoffset() is None:
        raise ValueError("retrieved_at must be timezone-aware")
    expected_facets = dict(series.expected_facets)
    query_facets = {name: set(values) for name, values in series.query.facets}
    selected_records = tuple(
        (index, record)
        for index, record in enumerate(records)
        if str(record.get("units", record.get("unit"))) == series.expected_unit
    )
    if not selected_records:
        returned_units = sorted(
            {str(record.get("units", record.get("unit"))) for record in records}
        )
        raise ValueError(
            f"EIA did not return expected unit {series.expected_unit!r} for {series.id}; "
            f"returned units={returned_units}"
        )
    output: list[Observation] = []
    symbol_statuses = {
        "NA": ObservationStatus.NOT_AVAILABLE,
        "W": ObservationStatus.SUPPRESSED_OR_WITHHELD,
        "--": ObservationStatus.NOT_APPLICABLE,
        "-": ObservationStatus.MISSING,
    }
    for index, record in selected_records:
        period = _required_text(record, "period", index)
        provider_geography = _required_text(record, "duoarea", index)
        geography_id, level_id = geographies.resolve(provider_geography)
        if level_id not in series.source_geography_level_ids:
            raise ValueError(
                f"EIA row geography {geography_id!r} is at unavailable level {level_id!r} for {series.id}"
            )
        if series.source_geography_ids and geography_id not in series.source_geography_ids:
            raise ValueError(
                f"EIA row geography {geography_id!r} escaped exact registered geography set "
                f"for {series.id}"
            )
        returned_unit = record.get("units", record.get("unit"))
        for facet_name, allowed_values in query_facets.items():
            if _required_text(record, facet_name, index) not in allowed_values:
                raise ValueError(f"EIA row escaped registered {facet_name!r} filter for {series.id}")
        for facet_name, expected_value in expected_facets.items():
            if _required_text(record, facet_name, index) != expected_value:
                raise ValueError(f"EIA expected facet {facet_name!r} drifted for {series.id}")
        dimensions = tuple(
            sorted((name, _required_text(record, name, index)) for name in series.dimensions)
        )
        raw_value = record.get("value")
        normalized_symbol = None if raw_value is None else str(raw_value).strip().upper()
        if raw_value is None:
            value = None
            status = ObservationStatus.NOT_AVAILABLE
        elif normalized_symbol in symbol_statuses:
            value = None
            status = symbol_statuses[normalized_symbol]
        else:
            try:
                value = Decimal(str(raw_value))
            except (InvalidOperation, ValueError):
                raise ValueError(
                    f"EIA row {index} has a non-numeric value; it was not coerced to zero"
                ) from None
            if not value.is_finite():
                raise ValueError(f"EIA row {index} has a non-finite value")
            status = ObservationStatus.OBSERVED
        output.append(
            Observation(
                provider_id="eia",
                series_id=series.id,
                period=period,
                geography_id=geography_id,
                value=value,
                unit=series.canonical_unit,
                retrieved_at=retrieved_at,
                status=status,
                dimensions=dimensions,
                original_value=None if raw_value is None else str(raw_value),
                original_unit=str(returned_unit),
            )
        )
    keys = [row.key for row in output]
    if len(keys) != len(set(keys)):
        raise ValueError(f"Normalized EIA batch contains duplicate observation keys for {series.id}")
    return tuple(sorted(output, key=lambda row: row.key))


def _load_json(path: Path) -> Mapping[str, Any]:
    value = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(value, Mapping):
        raise ValueError(f"Registry root must be an object: {path}")
    return value


def _mapping(value: Mapping[str, Any], name: str) -> Mapping[str, Any]:
    result = value.get(name)
    if not isinstance(result, Mapping):
        raise ValueError(f"{name} must be an object")
    return result


def _require_mapping(value: Any, name: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{name} must be an object")
    return value


def _list(value: Any, name: str) -> list[Any]:
    if not isinstance(value, list):
        raise ValueError(f"{name} must be an array")
    return value


def _required_text(record: Mapping[str, Any], field: str, index: int) -> str:
    value = record.get(field)
    if value is None or str(value) == "":
        raise ValueError(f"EIA row {index} is missing required field {field!r}")
    return str(value)

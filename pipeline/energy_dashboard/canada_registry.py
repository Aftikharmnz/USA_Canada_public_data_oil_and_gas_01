"""Registry contracts shared by non-Statistics-Canada Canadian providers."""

from __future__ import annotations

import json
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Mapping

from .contracts import Frequency
from .registry import SeriesDisplayClassification
from .validation import find_embedded_secrets


@dataclass(frozen=True, slots=True)
class RegistryCanadaSeries:
    id: str
    metric_id: str
    title: str
    description: str
    source_name: str
    source_url: str
    canonical_unit: str
    frequency: Frequency
    source_geography_ids: tuple[str, ...]
    source_geography_level_ids: tuple[str, ...]
    unsupported_levels: tuple[tuple[str, str], ...]
    display: SeriesDisplayClassification | None = None
    bootstrap_start: str | None = None


def load_cer_registry(
    path: Path, *, activation_status: str = "active"
) -> tuple[RegistryCanadaSeries, ...]:
    document = json.loads(path.read_text(encoding="utf-8"))
    if not isinstance(document, Mapping):
        raise ValueError("Canada registry root must be an object")
    issues = find_embedded_secrets(document)
    if issues:
        raise ValueError(f"Registry contains forbidden credential values: {issues[0].path}")
    providers = _list(document.get("providers"), "providers")
    provider_names = {
        str(provider["id"]): str(provider["name"])
        for provider in providers
        if isinstance(provider, Mapping)
    }
    profiles_raw = document.get("geography_profiles")
    if not isinstance(profiles_raw, Mapping):
        raise ValueError("Canada registry requires geography_profiles")
    profiles = {
        str(key): _mapping(value, f"geography profile {key}")
        for key, value in profiles_raw.items()
    }
    bootstrap_raw = document.get("bootstrap_period_start_by_frequency", {})
    if not isinstance(bootstrap_raw, Mapping):
        raise ValueError("bootstrap_period_start_by_frequency must be an object")
    output: list[RegistryCanadaSeries] = []
    for raw in _list(document.get("series"), "series"):
        item = _mapping(raw, "series")
        if item.get("provider_id") != "cer" or item.get("activation_status") != activation_status:
            continue
        profile_id = str(item.get("geography_profile_id", ""))
        if profile_id not in profiles:
            raise ValueError(f"CER series references unknown geography profile {profile_id!r}")
        profile = profiles[profile_id]
        ids = tuple(
            str(value)
            for value in _list(profile.get("source_geography_ids"), "source_geography_ids")
        )
        levels = tuple(
            str(value)
            for value in _list(
                profile.get("source_geography_level_ids"),
                "source_geography_level_ids",
            )
        )
        if not ids or len(ids) != len(set(ids)) or not levels:
            raise ValueError("CER geography profile must have unique ids and levels")
        unsupported = tuple(
            (
                str(_mapping(value, "unsupported level")["level_id"]),
                str(_mapping(value, "unsupported level")["reason"]),
            )
            for value in _list(profile.get("unsupported_levels", []), "unsupported_levels")
        )
        frequency = Frequency(str(item["frequency"]))
        caveats = tuple(str(value) for value in _list(item.get("caveats", []), "caveats"))
        output.append(
            RegistryCanadaSeries(
                id=str(item["id"]),
                metric_id=str(item["metric_id"]),
                title=str(item["name"]),
                description=" ".join(caveats),
                source_name=provider_names.get("cer", "Canada Energy Regulator"),
                source_url=str(item["source_url"]),
                canonical_unit=str(item["unit"]),
                frequency=frequency,
                source_geography_ids=ids,
                source_geography_level_ids=levels,
                unsupported_levels=unsupported,
                display=_display(item.get("display")),
                bootstrap_start=(
                    str(item["bootstrap_period_start"])
                    if item.get("bootstrap_period_start") is not None
                    else str(bootstrap_raw.get(frequency.value))
                    if bootstrap_raw.get(frequency.value) is not None
                    else None
                ),
            )
        )
    ids = [item.id for item in output]
    if len(ids) != len(set(ids)):
        raise ValueError("Active CER series ids must be unique")
    return tuple(sorted(output, key=lambda item: item.id))


def _display(value: object) -> SeriesDisplayClassification | None:
    if value is None:
        return None
    item = _mapping(value, "display")
    parent = item.get("parent_product_id")
    return SeriesDisplayClassification(
        dashboard_group=str(item["dashboard_group"]),
        product_family_id=str(item["product_family_id"]),
        product_family_label=str(item["product_family_label"]),
        product_id=str(item["product_id"]),
        product_label=str(item["product_label"]),
        measure_id=str(item["measure_id"]),
        measure_label=str(item["measure_label"]),
        component_role=str(item["component_role"]),
        parent_product_id=None if parent is None else str(parent),
        reference_term_ids=tuple(
            str(value)
            for value in _list(item.get("reference_term_ids", []), "reference_term_ids")
        ),
        display_order=int(item.get("display_order", 0)),
    )


def _mapping(value: object, name: str) -> Mapping[str, Any]:
    if not isinstance(value, Mapping):
        raise ValueError(f"{name} must be an object")
    return value


def _list(value: object, name: str) -> list[Any]:
    if not isinstance(value, list):
        raise ValueError(f"{name} must be an array")
    return value

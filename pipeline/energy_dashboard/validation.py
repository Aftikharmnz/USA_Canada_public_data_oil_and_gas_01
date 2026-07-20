"""Fail-closed validation helpers shared by provider adapters and CI."""

from __future__ import annotations

from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

from .contracts import Observation, SeriesDefinition


@dataclass(frozen=True, slots=True)
class ValidationIssue:
    code: str
    message: str
    path: str | None = None


class ContractValidationError(ValueError):
    def __init__(self, issues: Sequence[ValidationIssue]) -> None:
        self.issues = tuple(issues)
        super().__init__("; ".join(issue.message for issue in self.issues))


def validate_observation_batch(
    series: SeriesDefinition,
    observations: Iterable[Observation],
) -> tuple[Observation, ...]:
    rows = tuple(observations)
    issues: list[ValidationIssue] = []
    seen: set[str] = set()
    for index, row in enumerate(rows):
        path = f"observations[{index}]"
        if row.key in seen:
            issues.append(ValidationIssue("duplicate_key", f"Duplicate observation key {row.key}", path))
        seen.add(row.key)
        if row.series_id != series.id:
            issues.append(ValidationIssue("series_mismatch", "Observation series does not match", path))
        if row.provider_id != series.provider_id:
            issues.append(ValidationIssue("provider_mismatch", "Observation provider does not match", path))
        if row.unit != series.unit:
            issues.append(ValidationIssue("unit_mismatch", "Observation unit does not match", path))
    if issues:
        raise ContractValidationError(issues)
    return rows


_SENSITIVE_FIELD_NAMES = {
    "api_key",
    "apikey",
    "password",
    "secret",
    "token",
    "eia_api_key",
}


def find_embedded_secrets(value: Any, path: str = "$") -> tuple[ValidationIssue, ...]:
    """Find credential values in structured config without flagging env-var names."""

    issues: list[ValidationIssue] = []
    if isinstance(value, Mapping):
        for key, child in value.items():
            child_path = f"{path}.{key}"
            normalized_key = str(key).lower().replace("-", "_")
            if normalized_key in _SENSITIVE_FIELD_NAMES and isinstance(child, str) and child.strip():
                issues.append(
                    ValidationIssue(
                        "embedded_secret",
                        f"Credential value is not allowed at {child_path}",
                        child_path,
                    )
                )
            issues.extend(find_embedded_secrets(child, child_path))
    elif isinstance(value, Sequence) and not isinstance(value, (str, bytes, bytearray)):
        for index, child in enumerate(value):
            issues.extend(find_embedded_secrets(child, f"{path}[{index}]"))
    return tuple(issues)


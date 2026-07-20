"""Provider boundary and no-network Phase 1 refresh planning."""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass
from datetime import datetime

from .contracts import Observation, ProviderDefinition, SeriesDefinition


@dataclass(frozen=True, slots=True)
class RefreshRequest:
    series: SeriesDefinition
    overlap_start: str | None = None


@dataclass(frozen=True, slots=True)
class RefreshPlan:
    provider_id: str
    series_ids: tuple[str, ...]
    dry_run: bool
    requires_secret: bool
    planned_at: datetime


class ProviderAdapter(ABC):
    definition: ProviderDefinition

    @abstractmethod
    def discover(self) -> tuple[SeriesDefinition, ...]:
        """Return verified series metadata exposed by this adapter."""

    @abstractmethod
    def fetch(self, request: RefreshRequest) -> tuple[Observation, ...]:
        """Fetch observations. Implementations arrive in later phases."""


def build_dry_run_plan(
    provider: ProviderDefinition,
    series: tuple[SeriesDefinition, ...],
    planned_at: datetime,
) -> RefreshPlan:
    invalid = [definition.id for definition in series if definition.provider_id != provider.id]
    if invalid:
        raise ValueError(f"Series do not belong to provider {provider.id}: {invalid}")
    return RefreshPlan(
        provider_id=provider.id,
        series_ids=tuple(sorted(definition.id for definition in series)),
        dry_run=True,
        requires_secret=provider.requires_secret,
        planned_at=planned_at,
    )


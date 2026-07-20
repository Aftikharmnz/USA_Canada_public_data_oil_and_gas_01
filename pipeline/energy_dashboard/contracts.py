"""Stable, provider-neutral data contracts.

Phase 1 intentionally contains no network client. These contracts establish the
validation boundary that later EIA, Statistics Canada, and CER adapters must
satisfy before data can reach public assets.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from decimal import Decimal
from enum import StrEnum


class CountryCode(StrEnum):
    USA = "USA"
    CANADA = "CAN"


class Frequency(StrEnum):
    DAILY = "daily"
    WEEKLY = "weekly"
    MONTHLY = "monthly"
    QUARTERLY = "quarterly"
    ANNUAL = "annual"


class AggregationRule(StrEnum):
    SUM = "sum"
    RATIO_OF_SUMS = "ratio_of_sums"
    WEIGHTED_AVERAGE = "weighted_average"
    NOT_AGGREGATABLE = "not_aggregatable"


class FreshnessStatus(StrEnum):
    FRESH = "fresh"
    DUE = "due"
    LATE = "late"
    ERROR = "error"
    UNKNOWN = "unknown"


class ObservationStatus(StrEnum):
    OBSERVED = "observed"
    PRELIMINARY = "preliminary"
    MISSING = "missing"
    NOT_AVAILABLE = "not_available"
    NOT_APPLICABLE = "not_applicable"
    SUPPRESSED_OR_WITHHELD = "suppressed_or_withheld"
    USE_WITH_CAUTION = "use_with_caution"
    COMPUTED = "computed"


@dataclass(frozen=True, slots=True)
class ProviderDefinition:
    id: str
    name: str
    public_metadata_url: str
    countries: tuple[CountryCode, ...] = ()
    release_timezone: str = "UTC"
    requires_secret: bool = False

    def __post_init__(self) -> None:
        if not self.id or not self.name:
            raise ValueError("Provider id and name are required")
        if not self.public_metadata_url.startswith("https://"):
            raise ValueError("Provider metadata URL must use HTTPS")


@dataclass(frozen=True, slots=True)
class GeographyLevel:
    id: str
    country: CountryCode
    label: str
    granularity_rank: int
    parent_level_ids: tuple[str, ...] = ()

    def __post_init__(self) -> None:
        if self.granularity_rank < 0:
            raise ValueError("Geography granularity rank cannot be negative")


@dataclass(frozen=True, slots=True)
class GeographyNode:
    id: str
    country: CountryCode
    level_id: str
    label: str
    parent_ids: tuple[str, ...] = ()
    provider_codes: tuple[tuple[str, str], ...] = ()
    membership_version: str = "v1"

    def provider_code(self, provider_id: str) -> str | None:
        return dict(self.provider_codes).get(provider_id)


@dataclass(frozen=True, slots=True)
class AggregationSpec:
    rule: AggregationRule
    numerator_series_id: str | None = None
    denominator_series_id: str | None = None
    weight_series_id: str | None = None
    scale: Decimal = Decimal("1")

    def __post_init__(self) -> None:
        if self.rule is AggregationRule.RATIO_OF_SUMS:
            if not self.numerator_series_id or not self.denominator_series_id:
                raise ValueError("ratio_of_sums requires numerator and denominator series")
        if self.rule is AggregationRule.WEIGHTED_AVERAGE and not self.weight_series_id:
            raise ValueError("weighted_average requires a weight series")
        if self.scale <= 0:
            raise ValueError("Aggregation scale must be positive")


@dataclass(frozen=True, slots=True)
class RollupDefinition:
    target_geography_id: str
    member_geography_ids: tuple[str, ...]
    membership_version: str
    minimum_coverage: Decimal = Decimal("1")

    def __post_init__(self) -> None:
        if not self.member_geography_ids:
            raise ValueError("A rollup must declare at least one member")
        if len(set(self.member_geography_ids)) != len(self.member_geography_ids):
            raise ValueError("Rollup members must be unique")
        if not Decimal("0") < self.minimum_coverage <= Decimal("1"):
            raise ValueError("minimum_coverage must be in (0, 1]")


@dataclass(frozen=True, slots=True)
class GeographyAvailability:
    source_geography_ids: tuple[str, ...]
    rollups: tuple[RollupDefinition, ...] = ()
    unavailable_reasons: tuple[tuple[str, str], ...] = ()

    def __post_init__(self) -> None:
        if not self.source_geography_ids and not self.rollups:
            raise ValueError("A series must expose at least one source or validated rollup geography")
        targets = [rollup.target_geography_id for rollup in self.rollups]
        if len(set(targets)) != len(targets):
            raise ValueError("A series cannot define two rollups for the same target geography")

    def reason_for_level(self, level_id: str) -> str | None:
        return dict(self.unavailable_reasons).get(level_id)


@dataclass(frozen=True, slots=True)
class SeriesDefinition:
    id: str
    provider_id: str
    dataset_id: str
    metric_id: str
    title: str
    country: CountryCode
    frequency: Frequency
    unit: str
    availability: GeographyAvailability
    aggregation: AggregationSpec
    default_geography_level_id: str
    source_url: str

    def __post_init__(self) -> None:
        if not self.id or not self.dataset_id or not self.metric_id or not self.unit:
            raise ValueError("Series id, dataset id, metric id, and unit are required")
        if not self.source_url.startswith("https://"):
            raise ValueError("Series source URL must use HTTPS")


@dataclass(frozen=True, slots=True)
class Observation:
    provider_id: str
    series_id: str
    period: str
    geography_id: str
    value: Decimal | None
    unit: str
    retrieved_at: datetime
    status: ObservationStatus = ObservationStatus.OBSERVED
    source_released_at: datetime | None = None
    source_updated_at: datetime | None = None
    dimensions: tuple[tuple[str, str], ...] = ()
    components: tuple[tuple[str, Decimal], ...] = ()
    flags: tuple[str, ...] = ()
    original_value: str | None = None
    original_unit: str | None = None

    def __post_init__(self) -> None:
        numeric_statuses = {
            ObservationStatus.OBSERVED,
            ObservationStatus.PRELIMINARY,
            ObservationStatus.USE_WITH_CAUTION,
            ObservationStatus.COMPUTED,
        }
        if self.status in numeric_statuses and self.value is None:
            raise ValueError(f"Observation status {self.status} requires a numeric value")
        if self.status not in numeric_statuses and self.value is not None:
            raise ValueError(f"Observation status {self.status} cannot carry a numeric value")

    @property
    def key(self) -> str:
        dimension_key = "|".join(f"{key}={value}" for key, value in sorted(self.dimensions))
        return f"{self.series_id}|{self.period}|{self.geography_id}|{dimension_key}"

    def component(self, name: str) -> Decimal | None:
        return dict(self.components).get(name)


@dataclass(frozen=True, slots=True)
class RevisionRecord:
    observation_key: str
    old_value: Decimal | None
    new_value: Decimal | None
    old_status: ObservationStatus
    new_status: ObservationStatus
    detected_at: datetime
    retrieved_at: datetime
    provider_release_id: str | None = None
    payload_hash: str | None = None


@dataclass(frozen=True, slots=True)
class FreshnessManifest:
    series_id: str
    checked_at: datetime
    last_success_at: datetime
    latest_observation_period: str
    latest_value: Decimal | None
    previous_value: Decimal | None
    status: FreshnessStatus
    expected_next_release_at: datetime | None = None
    source_release_at: datetime | None = None
    source_updated_at: datetime | None = None
    generated_at: datetime | None = None
    deployed_at: datetime | None = None
    published_at: datetime | None = None
    last_revision_detected_at: datetime | None = None
    last_error_class: str | None = None
    metadata: tuple[tuple[str, str], ...] = field(default_factory=tuple)

    @property
    def period_delta(self) -> Decimal | None:
        if self.latest_value is None or self.previous_value is None:
            return None
        return self.latest_value - self.previous_value

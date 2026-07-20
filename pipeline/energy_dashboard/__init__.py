"""Core contracts for the North American Energy Market Monitor pipeline."""

from .contracts import (
    AggregationRule,
    AggregationSpec,
    CountryCode,
    FreshnessManifest,
    FreshnessStatus,
    Frequency,
    GeographyAvailability,
    GeographyLevel,
    GeographyNode,
    Observation,
    ObservationStatus,
    ProviderDefinition,
    RevisionRecord,
    RollupDefinition,
    SeriesDefinition,
)
from .eia import EIAClient, EIAFetchResult, EIAQuerySpec, EIASort, RetryPolicy
from .storage import CanonicalSnapshot, MergeResult, SnapshotStore, merge_canonical
from .registry import (
    ProviderGeographyIndex,
    RegistryEIASeries,
    SeriesDisplayClassification,
    load_eia_registry,
    load_provider_geographies,
    normalize_eia_records,
)
from .refresh import PeriodWindow, RefreshRunResult, default_overlap_start, run_eia_refresh
from .promotion import promote_current_public_generation, verify_public_generation
from .canada_registry import RegistryCanadaSeries, load_cer_registry
from .cer import CERClient, normalize_cer_records, roll_up_cer_national_runs
from .statcan import StatCanClient, StatCanFetchResult, StatCanTableSpec
from .statcan_refresh import AdditionalCanadaBatch, run_statcan_refresh
from .statcan_registry import (
    RegistryStatCanSeries,
    load_statcan_registry,
    normalize_statcan_records,
)

__all__ = [
    "AggregationRule",
    "AggregationSpec",
    "CountryCode",
    "FreshnessManifest",
    "FreshnessStatus",
    "Frequency",
    "GeographyAvailability",
    "GeographyLevel",
    "GeographyNode",
    "Observation",
    "ObservationStatus",
    "ProviderDefinition",
    "RevisionRecord",
    "RollupDefinition",
    "SeriesDefinition",
    "CanonicalSnapshot",
    "EIAClient",
    "EIAFetchResult",
    "EIAQuerySpec",
    "EIASort",
    "MergeResult",
    "RetryPolicy",
    "SnapshotStore",
    "merge_canonical",
    "PeriodWindow",
    "ProviderGeographyIndex",
    "RefreshRunResult",
    "RegistryEIASeries",
    "SeriesDisplayClassification",
    "load_eia_registry",
    "load_provider_geographies",
    "normalize_eia_records",
    "run_eia_refresh",
    "default_overlap_start",
    "promote_current_public_generation",
    "verify_public_generation",
    "AdditionalCanadaBatch",
    "CERClient",
    "RegistryCanadaSeries",
    "RegistryStatCanSeries",
    "StatCanClient",
    "StatCanFetchResult",
    "StatCanTableSpec",
    "load_cer_registry",
    "load_statcan_registry",
    "normalize_cer_records",
    "normalize_statcan_records",
    "roll_up_cer_national_runs",
    "run_statcan_refresh",
]

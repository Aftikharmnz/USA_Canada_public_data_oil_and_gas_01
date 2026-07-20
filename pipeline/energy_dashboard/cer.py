"""Strict, credential-free client for CER weekly refinery crude-run data.

The Canada Energy Regulator publishes one stable CSV containing weekly crude
runs and source-published utilization for three confidentiality regions.  This
module intentionally exposes only those two measures.  It never infers a
capacity series and never manufactures national utilization by averaging
regional percentages.
"""

from __future__ import annotations

import csv
import hashlib
import io
import re
import time
import urllib.error
import urllib.request
from collections import defaultdict
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal, InvalidOperation
from typing import Protocol

from .aggregation import AggregationLineage, RollupResult
from .contracts import AggregationRule, Observation, ObservationStatus


CER_CRUDE_RUNS_CSV_URL = (
    "https://www.cer-rec.gc.ca/open/imports-exports/crude-runs-weekly.csv"
)
CER_CRUDE_RUNS_DICTIONARY_URL = (
    "https://www.cer-rec.gc.ca/open/imports-exports/"
    "crude-runs-data-dictionary.csv"
)
CER_CRUDE_RUNS_DATASET_URL = (
    "https://open.canada.ca/data/en/dataset/5c0099e0-7081-404e-a95f-b0541de06630"
)

CER_CSV_HEADERS = (
    "Week End",
    "Week End Last Year",
    "Region",
    "Crude Volumes For The Week",
    "Percent Of Capacity",
    "4 Week Average",
    "4 Week Average Last Year",
    "YTD Average",
    "YTD Average Last Year",
    "Unit",
)
CER_REGIONS = (
    "Ontario",
    "Quebec & Eastern Canada",
    "Western Canada",
)
CER_SOURCE_RUNS_UNIT = "thousand cubic metres per day"
CER_RUNS_UNIT = "thousand_cubic_metres_per_day"
CER_UTILIZATION_UNIT = "percent"

_DATE_PATTERN = re.compile(r"\A\d{2}/\d{2}/\d{4}\Z")
_RETRYABLE_STATUSES = frozenset({408, 425, 429, 500, 502, 503, 504})


class CERClientError(RuntimeError):
    """Base error whose message is safe to emit in automation logs."""


class CERTransportError(CERClientError):
    pass


class CERResponseError(CERClientError):
    pass


@dataclass(frozen=True, slots=True)
class CERHTTPResponse:
    status: int
    headers: Mapping[str, str]
    body: bytes


class CERTransport(Protocol):
    def __call__(
        self, url: str, timeout_seconds: float, maximum_response_bytes: int
    ) -> CERHTTPResponse: ...


@dataclass(frozen=True, slots=True)
class CERRetryPolicy:
    delays_seconds: tuple[float, ...] = (1.0, 4.0, 16.0)
    timeout_seconds: float = 30.0
    maximum_retry_after_seconds: float = 60.0

    def __post_init__(self) -> None:
        if any(delay < 0 for delay in self.delays_seconds):
            raise ValueError("CER retry delays cannot be negative")
        if self.timeout_seconds <= 0:
            raise ValueError("CER timeout must be positive")
        if self.maximum_retry_after_seconds < 0:
            raise ValueError("CER Retry-After cap cannot be negative")

    @property
    def maximum_attempts(self) -> int:
        return len(self.delays_seconds) + 1


@dataclass(frozen=True, slots=True)
class CERFetchResult:
    source_url: str
    records: tuple[Mapping[str, str], ...]
    payload_sha256: str
    payload_bytes: int
    request_count: int


@dataclass(frozen=True, slots=True)
class CERObservationSet:
    runs: tuple[Observation, ...]
    utilization: tuple[Observation, ...]


def _stdlib_transport(
    url: str, timeout_seconds: float, maximum_response_bytes: int
) -> CERHTTPResponse:
    if url != CER_CRUDE_RUNS_CSV_URL:
        raise CERTransportError("CER transport rejected an unapproved source URL")
    request = urllib.request.Request(
        url,
        # CER serves this CSV as application/octet-stream and returns HTTP 406
        # when the client asks only for text/csv.
        headers={
            "Accept": "application/octet-stream",
            "User-Agent": "na-energy-monitor/1",
        },
    )
    try:
        with urllib.request.urlopen(  # noqa: S310 - URL is an exact official constant
            request, timeout=timeout_seconds
        ) as response:
            declared = response.headers.get("Content-Length")
            try:
                if declared is not None and int(declared) > maximum_response_bytes:
                    raise CERResponseError("CER response exceeds the configured size limit")
            except ValueError:
                raise CERResponseError("CER returned an invalid Content-Length header") from None
            body = response.read(maximum_response_bytes + 1)
            if len(body) > maximum_response_bytes:
                raise CERResponseError("CER response exceeds the configured size limit")
            return CERHTTPResponse(response.status, dict(response.headers.items()), body)
    except CERResponseError:
        raise
    except urllib.error.HTTPError as error:
        body = error.read(maximum_response_bytes + 1)
        if len(body) > maximum_response_bytes:
            body = b""
        return CERHTTPResponse(error.code, dict(error.headers.items()), body)
    except (urllib.error.URLError, TimeoutError, OSError):
        raise CERTransportError("CER transport failed; response details withheld") from None


class CERClient:
    """Fetch and validate the complete official CER weekly crude-runs CSV."""

    def __init__(
        self,
        *,
        transport: CERTransport | None = None,
        sleeper: Callable[[float], None] = time.sleep,
        retry_policy: CERRetryPolicy | None = None,
        maximum_response_bytes: int = 16 * 1024 * 1024,
    ) -> None:
        if maximum_response_bytes <= 0:
            raise ValueError("CER response limit must be positive")
        self._transport = transport or _stdlib_transport
        self._sleeper = sleeper
        self._retry_policy = retry_policy or CERRetryPolicy()
        self._maximum_response_bytes = maximum_response_bytes

    def fetch(self) -> CERFetchResult:
        response, request_count = self._request()
        records = _parse_csv(response.body)
        # Validate and deterministically deduplicate before data crosses the
        # provider boundary. Geography IDs remain a caller-owned registry concern.
        validated = _validate_and_dedupe_records(records)
        return CERFetchResult(
            source_url=CER_CRUDE_RUNS_CSV_URL,
            records=validated,
            payload_sha256=hashlib.sha256(response.body).hexdigest(),
            payload_bytes=len(response.body),
            request_count=request_count,
        )

    def _request(self) -> tuple[CERHTTPResponse, int]:
        for attempt in range(self._retry_policy.maximum_attempts):
            try:
                response = self._transport(
                    CER_CRUDE_RUNS_CSV_URL,
                    self._retry_policy.timeout_seconds,
                    self._maximum_response_bytes,
                )
            except (CERTransportError, urllib.error.URLError, TimeoutError, OSError):
                if attempt == self._retry_policy.maximum_attempts - 1:
                    raise CERTransportError("CER request failed after bounded retries") from None
                self._sleeper(self._retry_policy.delays_seconds[attempt])
                continue

            if len(response.body) > self._maximum_response_bytes:
                raise CERResponseError("CER response exceeds the configured size limit")
            if response.status == 200:
                return response, attempt + 1
            if response.status not in _RETRYABLE_STATUSES:
                raise CERResponseError(f"CER returned HTTP {response.status}")
            if attempt == self._retry_policy.maximum_attempts - 1:
                raise CERResponseError(
                    f"CER returned HTTP {response.status} after bounded retries"
                )
            self._sleeper(self._retry_delay(response.headers, attempt))
        raise AssertionError("unreachable")

    def _retry_delay(self, headers: Mapping[str, str], attempt: int) -> float:
        lowered = {str(key).lower(): str(value) for key, value in headers.items()}
        retry_after = lowered.get("retry-after")
        if retry_after is not None:
            try:
                return min(
                    max(float(retry_after), 0.0),
                    self._retry_policy.maximum_retry_after_seconds,
                )
            except ValueError:
                pass
        return self._retry_policy.delays_seconds[attempt]


def _parse_csv(payload: bytes) -> tuple[Mapping[str, str], ...]:
    try:
        text = payload.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise CERResponseError("CER CSV is not UTF-8") from None
    if "\x00" in text:
        raise CERResponseError("CER CSV contains a NUL byte")
    try:
        reader = csv.DictReader(io.StringIO(text, newline=""), strict=True)
        headers = tuple(reader.fieldnames or ())
        if headers != CER_CSV_HEADERS:
            raise CERResponseError(
                f"CER CSV header drifted: expected={CER_CSV_HEADERS!r}, returned={headers!r}"
            )
        records: list[Mapping[str, str]] = []
        for number, row in enumerate(reader, start=2):
            if None in row or any(value is None for value in row.values()):
                raise CERResponseError(f"CER CSV row {number} does not match its header")
            records.append(dict(row))
    except csv.Error:
        raise CERResponseError("CER CSV is malformed") from None
    if not records:
        raise CERResponseError("CER CSV contains no data rows")
    return tuple(records)


def _parse_period(raw: str) -> str:
    if not _DATE_PATTERN.fullmatch(raw):
        raise CERResponseError("CER week-ending date does not match MM/DD/YYYY")
    try:
        period = datetime.strptime(raw, "%m/%d/%Y")
    except ValueError:
        raise CERResponseError("CER week-ending date is invalid") from None
    if period.weekday() != 1:
        raise CERResponseError("CER week-ending date is not Tuesday")
    return period.date().isoformat()


def _parse_nonnegative_decimal(raw: str, field: str) -> Decimal:
    try:
        value = Decimal(raw)
    except InvalidOperation:
        raise CERResponseError(f"CER {field} value is not numeric") from None
    if not value.is_finite() or value < 0:
        raise CERResponseError(f"CER {field} value must be finite and non-negative")
    return value


def _validate_record(row: Mapping[str, str]) -> tuple[str, str]:
    if tuple(row) != CER_CSV_HEADERS:
        raise CERResponseError("CER record fields do not match the exact CSV contract")
    region = row["Region"]
    if region not in CER_REGIONS:
        raise CERResponseError(f"CER returned unknown region {region!r}")
    if row["Unit"] != CER_SOURCE_RUNS_UNIT:
        raise CERResponseError(
            f"CER unit drifted: expected {CER_SOURCE_RUNS_UNIT!r}, returned {row['Unit']!r}"
        )
    period = _parse_period(row["Week End"])
    _parse_nonnegative_decimal(row["Crude Volumes For The Week"], "crude-runs")
    _parse_nonnegative_decimal(row["Percent Of Capacity"], "percent-capacity")
    return period, region


def _validate_and_dedupe_records(
    records: Iterable[Mapping[str, str]],
) -> tuple[Mapping[str, str], ...]:
    by_key: dict[tuple[str, str], dict[str, str]] = {}
    for row in records:
        period, region = _validate_record(row)
        normalized_row = dict(row)
        key = (period, region)
        previous = by_key.get(key)
        if previous is None:
            by_key[key] = normalized_row
        elif previous != normalized_row:
            raise CERResponseError(
                f"CER returned conflicting duplicate for period={period}, region={region!r}"
            )
    if not by_key:
        raise CERResponseError("CER records contain no data rows")
    return tuple(by_key[key] for key in sorted(by_key))


def _validate_region_mapping(region_geography_ids: Mapping[str, str]) -> None:
    expected = set(CER_REGIONS)
    actual = set(region_geography_ids)
    if actual != expected:
        missing = sorted(expected - actual)
        unexpected = sorted(actual - expected)
        raise ValueError(
            f"CER region mapping mismatch; missing={missing}, unexpected={unexpected}"
        )
    geography_ids = tuple(region_geography_ids[region] for region in CER_REGIONS)
    if any(not geography_id for geography_id in geography_ids):
        raise ValueError("CER geography IDs cannot be empty")
    if len(set(geography_ids)) != len(geography_ids):
        raise ValueError("CER region mapping geography IDs must be unique")


def normalize_cer_records(
    records: Iterable[Mapping[str, str]],
    *,
    region_geography_ids: Mapping[str, str],
    retrieved_at: datetime,
    runs_series_id: str,
    utilization_series_id: str,
) -> CERObservationSet:
    """Create the two source-published regional observation series.

    The caller supplies stable geography and series IDs from the reviewed
    registry.  The function deliberately has no national-utilization path.
    """

    _validate_region_mapping(region_geography_ids)
    if not runs_series_id or not utilization_series_id:
        raise ValueError("CER runs and utilization series IDs are required")
    if runs_series_id == utilization_series_id:
        raise ValueError("CER runs and utilization series IDs must differ")

    validated = _validate_and_dedupe_records(records)
    runs: list[Observation] = []
    utilization: list[Observation] = []
    for row in validated:
        period = _parse_period(row["Week End"])
        geography_id = region_geography_ids[row["Region"]]
        raw_runs = row["Crude Volumes For The Week"]
        raw_utilization = row["Percent Of Capacity"]
        runs.append(
            Observation(
                provider_id="cer",
                series_id=runs_series_id,
                period=period,
                geography_id=geography_id,
                value=_parse_nonnegative_decimal(raw_runs, "crude-runs"),
                unit=CER_RUNS_UNIT,
                retrieved_at=retrieved_at,
                status=ObservationStatus.OBSERVED,
                dimensions=(("measure", "crude_runs"),),
                flags=("source_published",),
                original_value=raw_runs,
                original_unit=CER_SOURCE_RUNS_UNIT,
            )
        )
        utilization.append(
            Observation(
                provider_id="cer",
                series_id=utilization_series_id,
                period=period,
                geography_id=geography_id,
                value=_parse_nonnegative_decimal(raw_utilization, "percent-capacity"),
                unit=CER_UTILIZATION_UNIT,
                retrieved_at=retrieved_at,
                status=ObservationStatus.OBSERVED,
                dimensions=(("measure", "percent_of_capacity"),),
                flags=("source_published",),
                original_value=raw_utilization,
                original_unit="percent",
            )
        )
    return CERObservationSet(runs=tuple(runs), utilization=tuple(utilization))


def roll_up_cer_national_runs(
    observations: Iterable[Observation],
    *,
    region_geography_ids: Mapping[str, str],
    national_geography_id: str,
    membership_version: str,
) -> tuple[RollupResult, ...]:
    """Sum complete three-region crude runs for each period with full lineage.

    This helper is intentionally specific to crude runs.  Regional utilization
    cannot enter because its unit and measure dimension fail validation.
    """

    _validate_region_mapping(region_geography_ids)
    if not national_geography_id or not membership_version:
        raise ValueError("CER national geography and membership version are required")
    expected_geographies = frozenset(region_geography_ids.values())
    if national_geography_id in expected_geographies:
        raise ValueError("CER national geography must differ from source regions")

    rows = tuple(observations)
    if not rows:
        raise ValueError("CER national runs rollup input is empty")
    by_period: dict[str, list[Observation]] = defaultdict(list)
    for row in rows:
        if row.provider_id != "cer":
            raise ValueError("CER national runs rollup received another provider")
        if row.unit != CER_RUNS_UNIT or row.dimensions != (("measure", "crude_runs"),):
            raise ValueError("CER national rollup accepts crude-runs observations only")
        if row.status is not ObservationStatus.OBSERVED or row.value is None:
            raise ValueError("CER national runs rollup requires observed numeric members")
        by_period[row.period].append(row)

    results: list[RollupResult] = []
    for period in sorted(by_period):
        period_rows = by_period[period]
        series_ids = {row.series_id for row in period_rows}
        geography_ids = [row.geography_id for row in period_rows]
        if len(series_ids) != 1:
            raise ValueError("CER national runs members must share one series ID")
        if len(geography_ids) != len(set(geography_ids)):
            raise ValueError(f"CER national runs contain duplicate region for period={period}")
        actual_geographies = set(geography_ids)
        if actual_geographies != expected_geographies:
            missing = sorted(expected_geographies - actual_geographies)
            unexpected = sorted(actual_geographies - expected_geographies)
            raise ValueError(
                f"CER national runs coverage failed for period={period}; "
                f"missing={missing}, unexpected={unexpected}"
            )

        ordered = tuple(sorted(period_rows, key=lambda row: row.geography_id))
        source_release_times = [row.source_released_at for row in ordered if row.source_released_at]
        source_update_times = [row.source_updated_at for row in ordered if row.source_updated_at]
        observation = Observation(
            provider_id="cer",
            series_id=ordered[0].series_id,
            period=period,
            geography_id=national_geography_id,
            value=sum((row.value for row in ordered if row.value is not None), Decimal("0")),
            unit=CER_RUNS_UNIT,
            retrieved_at=max(row.retrieved_at for row in ordered),
            status=ObservationStatus.COMPUTED,
            source_released_at=max(source_release_times) if source_release_times else None,
            source_updated_at=max(source_update_times) if source_update_times else None,
            dimensions=(("measure", "crude_runs"),),
            components=tuple(
                (row.geography_id, row.value) for row in ordered if row.value is not None
            ),
            flags=("derived_geography_rollup", "complete_three_region_sum"),
        )
        lineage = AggregationLineage(
            source_observation_keys=tuple(sorted(row.key for row in ordered)),
            member_geography_ids=tuple(sorted(expected_geographies)),
            membership_version=membership_version,
            coverage=Decimal("1"),
            aggregation_rule=AggregationRule.SUM,
        )
        results.append(RollupResult(observation=observation, lineage=lineage))
    return tuple(results)

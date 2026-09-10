"""Reviewed CER Trans-Northern monthly pipeline-point throughput feed.

The published daily rates describe a broad refined-products transportation
boundary, not provincial supply, individual fuels, or origin/destination routes.
System and key-point readings overlap and are never rolled up here.
"""

from __future__ import annotations

import csv
import hashlib
import io
import math
import re
import time
import urllib.error
import urllib.request
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from datetime import UTC, date, datetime
from decimal import Decimal
from email.utils import parsedate_to_datetime

from .canada_registry import RegistryCanadaSeries
from .cer import CERHTTPResponse, CERResponseError, CERRetryPolicy, CERTransport, CERTransportError
from .contracts import Frequency, Observation, ObservationStatus


TRANS_NORTHERN_CSV_URL = (
    "https://www.cer-rec.gc.ca/open/energy/throughput-capacity/"
    "trans-northern-throughput-and-capacity.csv"
)
TRANS_NORTHERN_DATASET_ID = "trans_northern_throughput"
TRANS_NORTHERN_UNIT = "thousand_cubic_metres_per_day"
TRANS_NORTHERN_SOURCE_UNIT = "1000 m3/d"
TRANS_NORTHERN_HEADERS = (
    "Date", "Month", "Year", "Company", "Pipeline", "Key Point",
    "Latitude", "Longitude", "Direction Of Flow", "Trade Type", "Product",
    "Throughput (1000 m3/d)", "Nameplate Capacity (1000 m3/d)",
    "Available Capacity (1000 m3/d)", "Reason For Variance",
)
TRANS_NORTHERN_FILTERS = (
    ("Company", "Trans-Northern Pipelines Inc."),
    ("Pipeline", "Trans-Northern pipeline"),
    ("Direction Of Flow", "not available"),
    ("Trade Type", "intracanada"),
    ("Product", "refined petroleum products"),
)
TRANS_NORTHERN_GEOGRAPHIES = {
    "Montreal-West": "ca.cer.trans_northern.montreal_west",
    "Nanticoke-East": "ca.cer.trans_northern.nanticoke_east",
    "system": "ca.cer.trans_northern.system",
}
_EMPTY_FIELDS = (
    "Latitude", "Longitude", "Nameplate Capacity (1000 m3/d)",
    "Available Capacity (1000 m3/d)", "Reason For Variance",
)
_RETRYABLE_STATUSES = frozenset({408, 425, 429, 500, 502, 503, 504})
_NUMBER = re.compile(r"\A\d+(?:\.\d+)?\Z")
_MONTH_START = re.compile(r"\A\d{4}-\d{2}-01\Z")
_MAXIMUM_RECORDS = 10_000


@dataclass(frozen=True, slots=True)
class TransNorthernFetchResult:
    records: tuple[Mapping[str, str], ...]
    payload_sha256: str
    payload_bytes: int
    download_url: str
    attempts: int
    source_updated_at: datetime | None = None

    @property
    def source_url(self) -> str:
        return self.download_url

    @property
    def request_count(self) -> int:
        return self.attempts


def _transport(url: str, timeout_seconds: float, maximum_response_bytes: int) -> CERHTTPResponse:
    if url != TRANS_NORTHERN_CSV_URL:
        raise CERTransportError("CER pipeline transport rejected an unapproved URL")
    request = urllib.request.Request(
        url, headers={"Accept": "application/octet-stream", "User-Agent": "na-energy-monitor/1"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            # Reject redirects outside the reviewed official resource, including
            # login/HTML fallbacks; a changed URL requires registry review.
            if response.geturl() != TRANS_NORTHERN_CSV_URL:
                raise CERResponseError("CER pipeline response redirected from its registered URL")
            declared = response.headers.get("Content-Length")
            if declared is not None:
                try:
                    length = int(declared)
                except ValueError:
                    raise CERResponseError("CER pipeline Content-Length is invalid") from None
                if length < 0 or length > maximum_response_bytes:
                    raise CERResponseError("CER pipeline response exceeds the size limit")
            body = response.read(maximum_response_bytes + 1)
            if len(body) > maximum_response_bytes:
                raise CERResponseError("CER pipeline response exceeds the size limit")
            return CERHTTPResponse(response.status, dict(response.headers.items()), body)
    except CERResponseError:
        raise
    except urllib.error.HTTPError as error:
        # Never emit or retain a server's error body in automation logs.
        return CERHTTPResponse(error.code, dict(error.headers.items()), b"")
    except (urllib.error.URLError, TimeoutError, OSError):
        raise CERTransportError("CER pipeline transport failed; response details withheld") from None


class TransNorthernClient:
    def __init__(
        self, *, transport: CERTransport | None = None,
        sleeper: Callable[[float], None] = time.sleep,
        retry_policy: CERRetryPolicy | None = None,
        maximum_response_bytes: int = 2 * 1024 * 1024,
        maximum_records: int = _MAXIMUM_RECORDS,
    ) -> None:
        if maximum_response_bytes <= 0 or maximum_records <= 0:
            raise ValueError("CER pipeline response and record limits must be positive")
        self._transport = transport or _transport
        self._sleeper = sleeper
        self._policy = retry_policy or CERRetryPolicy()
        self._maximum_bytes = maximum_response_bytes
        self._maximum_records = maximum_records

    def fetch(self) -> TransNorthernFetchResult:
        for attempt in range(self._policy.maximum_attempts):
            try:
                response = self._transport(
                    TRANS_NORTHERN_CSV_URL, self._policy.timeout_seconds, self._maximum_bytes,
                )
            except (CERTransportError, urllib.error.URLError, TimeoutError, OSError):
                if attempt == self._policy.maximum_attempts - 1:
                    raise CERTransportError("CER pipeline request failed after bounded retries") from None
                self._sleeper(self._policy.delays_seconds[attempt])
                continue
            if len(response.body) > self._maximum_bytes:
                raise CERResponseError("CER pipeline response exceeds the size limit")
            if response.status == 200:
                records = _parse_csv(response.body, self._maximum_records)
                updated = _last_modified(response.headers)
                return TransNorthernFetchResult(
                    records=records, payload_sha256=hashlib.sha256(response.body).hexdigest(),
                    payload_bytes=len(response.body), download_url=TRANS_NORTHERN_CSV_URL,
                    attempts=attempt + 1, source_updated_at=updated,
                )
            if response.status not in _RETRYABLE_STATUSES:
                raise CERResponseError(f"CER pipeline returned HTTP {response.status}")
            if attempt == self._policy.maximum_attempts - 1:
                raise CERResponseError(f"CER pipeline returned HTTP {response.status} after bounded retries")
            delay = self._policy.delays_seconds[attempt]
            retry_after = next((str(v) for k, v in response.headers.items() if k.lower() == "retry-after"), None)
            if retry_after is not None:
                try:
                    seconds = float(retry_after)
                    if math.isfinite(seconds):
                        delay = min(max(seconds, 0.0), self._policy.maximum_retry_after_seconds)
                except ValueError:
                    pass
            self._sleeper(delay)
        raise AssertionError("unreachable")


def _last_modified(headers: Mapping[str, str]) -> datetime | None:
    raw = next((str(v) for k, v in headers.items() if k.lower() == "last-modified"), None)
    if raw is None:
        return None
    try:
        parsed = parsedate_to_datetime(raw)
        if parsed.tzinfo is None or parsed.utcoffset() is None:
            return None
        return parsed.astimezone(UTC)
    except (TypeError, ValueError, OverflowError):
        # This optional file timestamp is not an observation's release date.
        return None


def _parse_csv(payload: bytes, maximum_records: int) -> tuple[Mapping[str, str], ...]:
    try:
        text = payload.decode("utf-8-sig")
    except UnicodeDecodeError:
        raise CERResponseError("CER pipeline CSV is not UTF-8") from None
    if "\x00" in text:
        raise CERResponseError("CER pipeline CSV contains a NUL byte")
    try:
        reader = csv.DictReader(io.StringIO(text, newline=""), strict=True)
        if tuple(reader.fieldnames or ()) != TRANS_NORTHERN_HEADERS:
            raise CERResponseError("CER pipeline CSV header or unit drifted")
        rows: list[Mapping[str, str]] = []
        for row in reader:
            if len(rows) >= maximum_records:
                raise CERResponseError("CER pipeline CSV exceeds the record limit")
            rows.append(row)
    except csv.Error:
        raise CERResponseError("CER pipeline CSV is malformed") from None
    return _validate_records(rows, maximum_records)


def _validate_records(
    records: Iterable[Mapping[str, str]], maximum_records: int = _MAXIMUM_RECORDS,
) -> tuple[Mapping[str, str], ...]:
    by_key: dict[tuple[str, str], Mapping[str, str]] = {}
    point_names: set[str] = set()
    for count, row in enumerate(records, start=1):
        if count > maximum_records:
            raise CERResponseError("CER pipeline CSV exceeds the record limit")
        if set(row) != set(TRANS_NORTHERN_HEADERS) or any(not isinstance(v, str) for v in row.values()):
            raise CERResponseError("CER pipeline record does not match its exact fields")
        for field, expected in TRANS_NORTHERN_FILTERS:
            if row[field] != expected:
                raise CERResponseError(f"CER pipeline {field} metadata drifted")
        if any(row[field] != "" for field in _EMPTY_FIELDS):
            raise CERResponseError("CER pipeline unpublished capacity or ancillary metadata changed; review required")
        point = row["Key Point"]
        if point not in TRANS_NORTHERN_GEOGRAPHIES:
            raise CERResponseError("CER pipeline key-point geography drifted")
        raw_date = row["Date"]
        if not _MONTH_START.fullmatch(raw_date):
            raise CERResponseError("CER pipeline Date must be a monthly first-day date")
        try:
            parsed = date.fromisoformat(raw_date)
        except ValueError:
            raise CERResponseError("CER pipeline Date is invalid") from None
        if row["Month"] != str(parsed.month) or row["Year"] != str(parsed.year):
            raise CERResponseError("CER pipeline Date, Year and Month disagree")
        raw_value = row["Throughput (1000 m3/d)"]
        if raw_value and (len(raw_value) > 60 or not _NUMBER.fullmatch(raw_value)):
            raise CERResponseError("CER pipeline throughput must be a finite nonnegative number or empty")
        key = (raw_date, point)
        if key in by_key and dict(by_key[key]) != dict(row):
            raise CERResponseError("CER pipeline contains a conflicting duplicate identity")
        by_key[key] = dict(row)
        point_names.add(point)
    if not by_key:
        raise CERResponseError("CER pipeline CSV contains no data rows")
    if point_names != set(TRANS_NORTHERN_GEOGRAPHIES):
        raise CERResponseError("CER pipeline full file is missing a registered key point")
    return tuple(by_key[key] for key in sorted(by_key))


def normalize_trans_northern_records(
    records: Iterable[Mapping[str, str]], *, spec: RegistryCanadaSeries,
    retrieved_at: datetime, source_updated_at: datetime | None = None,
) -> tuple[Observation, ...]:
    if retrieved_at.tzinfo is None or retrieved_at.utcoffset() is None:
        raise ValueError("CER pipeline retrieved_at must be timezone-aware")
    if source_updated_at is not None and (source_updated_at.tzinfo is None or source_updated_at.utcoffset() is None):
        raise ValueError("CER pipeline source_updated_at must be timezone-aware")
    if spec.dataset_id != TRANS_NORTHERN_DATASET_ID:
        raise ValueError("CER pipeline spec has an unapproved dataset")
    if tuple(sorted(spec.source_filters)) != tuple(sorted(TRANS_NORTHERN_FILTERS)):
        raise ValueError("CER pipeline spec source filters do not match the reviewed boundary")
    if spec.frequency is not Frequency.MONTHLY or spec.canonical_unit != TRANS_NORTHERN_UNIT:
        raise ValueError("CER pipeline spec frequency or unit drifted")
    if set(spec.source_geography_ids) != set(TRANS_NORTHERN_GEOGRAPHIES.values()):
        raise ValueError("CER pipeline spec geography set drifted")
    output: list[Observation] = []
    for row in _validate_records(records):
        period = row["Date"][:7]
        if period > retrieved_at.astimezone(UTC).strftime("%Y-%m"):
            raise CERResponseError("CER pipeline observed period is in the future")
        raw_value = row["Throughput (1000 m3/d)"]
        output.append(Observation(
            provider_id="cer", series_id=spec.id, period=period,
            geography_id=TRANS_NORTHERN_GEOGRAPHIES[row["Key Point"]],
            value=Decimal(raw_value) if raw_value else None,
            unit=TRANS_NORTHERN_UNIT, retrieved_at=retrieved_at,
            source_updated_at=source_updated_at,
            status=ObservationStatus.OBSERVED if raw_value else ObservationStatus.NOT_AVAILABLE,
            dimensions=tuple(sorted({
                "company": row["Company"], "pipeline": row["Pipeline"],
                "key_point": row["Key Point"], "product": row["Product"],
                "direction_of_flow": row["Direction Of Flow"], "trade_type": row["Trade Type"],
                "measure": "throughput", "period_semantics": "monthly_average_daily_rate",
            }.items())),
            original_value=raw_value, original_unit=TRANS_NORTHERN_SOURCE_UNIT,
        ))
    return tuple(output)

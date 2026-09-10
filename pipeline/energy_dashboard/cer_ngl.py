"""Credential-free CER NGL export reporting, preserving every source boundary.

Only registered all-mode propane/butane export views are normalized. Source
``Total`` rows are authoritative published aggregates, not instructions to add
them to detail rows. ``Origin`` is the province of exportation, not production.
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
from dataclasses import replace
from datetime import datetime
from decimal import Decimal, InvalidOperation

from .canada_registry import RegistryCanadaSeries
from .cer import (
    CERFetchResult,
    CERHTTPResponse,
    CERResponseError,
    CERRetryPolicy,
    CERTransport,
    CERTransportError,
)
from .contracts import Frequency, Observation, ObservationStatus


CER_NGL_DATASET_ID = "ngl_exports_monthly"
CER_NGL_CSV_URL = (
    "https://www.cer-rec.gc.ca/open/imports-exports/"
    "natural-gas-liquids-exports-monthly.csv"
)
CER_NGL_DICTIONARY_URL = (
    "https://www.cer-rec.gc.ca/open/imports-exports/"
    "natural-gas-liquids-exports-data-dictionary.csv"
)
CER_NGL_DATASET_URL = (
    "https://open.canada.ca/data/en/dataset/8cb1d0d0-6ea7-4f6d-b01d-a38fafdcce77"
)
CER_NGL_HEADERS = (
    "Period", "Year", "Month", "Product", "Origin", "Destination / PADD",
    "Mode of Transportation", "Volume (m3)", "Volume (bbl)", "Value (CN$)",
    "Value (US$)", "Price (CN cents/L)", "Price (US cents/gallon)",
)
CER_NGL_PRODUCTS = ("Butane", "Propane")
CER_NGL_ORIGINS = (
    "Alberta", "British Columbia", "Manitoba", "New Brunswick",
    "Newfoundland and Labrador", "Northwest Territories", "Nova Scotia",
    "Ontario", "Prince Edward Island", "Québec", "Saskatchewan", "Yukon", "Total",
)
CER_NGL_DESTINATIONS = (
    "PADD I", "PADD II", "PADD III", "PADD IV", "PADD V", "Other", "Total",
)
CER_NGL_MODES = ("Marine", "Pipeline", "Railway", "Truck", "Total")
CER_NGL_UNIT = "cubic_metres"

_MONTHS = (
    "January", "February", "March", "April", "May", "June", "July", "August",
    "September", "October", "November", "December",
)
_DATE_PATTERN = re.compile(r"\A\d{2}/01/\d{4}\Z")
_MONTH_PATTERN = re.compile(r"\A\d{4}-(?:0[1-9]|1[0-2])\Z")
_NUMBER_PATTERN = re.compile(r"\A-?\d+(?:\.\d+)?\Z")
_RETRYABLE_STATUSES = frozenset({408, 425, 429, 500, 502, 503, 504})
_FILTER_FIELDS = frozenset({"Product", "Destination / PADD", "Mode of Transportation"})


def _stdlib_transport(
    url: str, timeout_seconds: float, maximum_response_bytes: int
) -> CERHTTPResponse:
    if url != CER_NGL_CSV_URL:
        raise CERTransportError("CER NGL transport rejected an unapproved source URL")
    request = urllib.request.Request(
        url,
        headers={"Accept": "application/octet-stream", "User-Agent": "na-energy-monitor/1"},
    )
    try:
        with urllib.request.urlopen(request, timeout=timeout_seconds) as response:
            if response.geturl() != CER_NGL_CSV_URL:
                raise CERResponseError("CER NGL response redirected away from its registered URL")
            declared = response.headers.get("Content-Length")
            try:
                if declared is not None and (
                    int(declared) < 0 or int(declared) > maximum_response_bytes
                ):
                    raise CERResponseError("CER NGL response exceeds the configured size limit")
            except ValueError:
                raise CERResponseError("CER NGL returned an invalid Content-Length header") from None
            body = response.read(maximum_response_bytes + 1)
            if len(body) > maximum_response_bytes:
                raise CERResponseError("CER NGL response exceeds the configured size limit")
            return CERHTTPResponse(response.status, dict(response.headers.items()), body)
    except CERResponseError:
        raise
    except urllib.error.HTTPError as error:
        # Error bodies are never retained or emitted in automation logs.
        return CERHTTPResponse(error.code, dict(error.headers.items()), b"")
    except (urllib.error.URLError, TimeoutError, OSError):
        raise CERTransportError("CER NGL transport failed; response details withheld") from None


class CERNGLClient:
    """Download and strictly validate one complete, reviewed monthly CSV."""

    def __init__(
        self,
        *,
        transport: CERTransport | None = None,
        sleeper: Callable[[float], None] = time.sleep,
        retry_policy: CERRetryPolicy | None = None,
        maximum_response_bytes: int = 32 * 1024 * 1024,
    ) -> None:
        if maximum_response_bytes <= 0:
            raise ValueError("CER NGL response limit must be positive")
        self._transport = transport or _stdlib_transport
        self._sleeper = sleeper
        self._retry_policy = retry_policy or CERRetryPolicy()
        self._maximum_response_bytes = maximum_response_bytes

    def fetch(self) -> CERFetchResult:
        response, request_count = self._request()
        return CERFetchResult(
            source_url=CER_NGL_CSV_URL,
            records=_validate_and_dedupe_records(_parse_csv(response.body)),
            payload_sha256=hashlib.sha256(response.body).hexdigest(),
            payload_bytes=len(response.body),
            request_count=request_count,
        )

    def _request(self) -> tuple[CERHTTPResponse, int]:
        policy = self._retry_policy
        for attempt in range(policy.maximum_attempts):
            try:
                response = self._transport(
                    CER_NGL_CSV_URL, policy.timeout_seconds, self._maximum_response_bytes
                )
            except (CERTransportError, urllib.error.URLError, TimeoutError, OSError):
                if attempt == policy.maximum_attempts - 1:
                    raise CERTransportError("CER NGL request failed after bounded retries") from None
                self._sleeper(policy.delays_seconds[attempt])
                continue
            if len(response.body) > self._maximum_response_bytes:
                raise CERResponseError("CER NGL response exceeds the configured size limit")
            if response.status == 200:
                return response, attempt + 1
            if response.status not in _RETRYABLE_STATUSES:
                raise CERResponseError(f"CER NGL returned HTTP {response.status}")
            if attempt == policy.maximum_attempts - 1:
                raise CERResponseError(
                    f"CER NGL returned HTTP {response.status} after bounded retries"
                )
            self._sleeper(self._retry_delay(response.headers, attempt))
        raise AssertionError("unreachable")

    def _retry_delay(self, headers: Mapping[str, str], attempt: int) -> float:
        lowered = {str(key).lower(): str(value) for key, value in headers.items()}
        raw = lowered.get("retry-after")
        if raw is not None:
            try:
                delay = float(raw)
                if math.isfinite(delay):
                    return min(max(delay, 0.0), self._retry_policy.maximum_retry_after_seconds)
            except ValueError:
                pass
        return self._retry_policy.delays_seconds[attempt]


def _parse_csv(payload: bytes) -> tuple[Mapping[str, str], ...]:
    try:
        # The reviewed official export file uses Windows-1252, including Québec.
        text = payload.decode("cp1252")
    except UnicodeDecodeError:
        raise CERResponseError("CER NGL CSV is not valid Windows-1252") from None
    if "\x00" in text:
        raise CERResponseError("CER NGL CSV contains a NUL byte")
    try:
        reader = csv.DictReader(io.StringIO(text, newline=""), strict=True)
        if tuple(reader.fieldnames or ()) != CER_NGL_HEADERS:
            raise CERResponseError("CER NGL CSV header drifted from its exact registered schema")
        rows: list[Mapping[str, str]] = []
        for number, row in enumerate(reader, start=2):
            if None in row or any(value is None for value in row.values()):
                raise CERResponseError(f"CER NGL CSV row {number} does not match its header")
            rows.append(dict(row))
    except csv.Error:
        raise CERResponseError("CER NGL CSV is malformed") from None
    if not rows:
        raise CERResponseError("CER NGL CSV contains no data rows")
    return tuple(rows)


def _parse_period(row: Mapping[str, str]) -> str:
    raw = row["Period"]
    if not _DATE_PATTERN.fullmatch(raw):
        raise CERResponseError("CER NGL period must be MM/01/YYYY")
    try:
        date = datetime.strptime(raw, "%m/%d/%Y")
    except ValueError:
        raise CERResponseError("CER NGL period is invalid") from None
    if date.year < 1990 or row["Year"] != str(date.year) or row["Month"] != _MONTHS[date.month - 1]:
        raise CERResponseError("CER NGL year/month fields disagree with the source period")
    return date.strftime("%Y-%m")


def _number(raw: str, field: str) -> Decimal:
    # Do not turn unexpected status text, blanks or nonfinite values into zero.
    if not _NUMBER_PATTERN.fullmatch(raw):
        raise CERResponseError(f"CER NGL {field} is not a reviewed numeric value")
    try:
        value = Decimal(raw)
    except InvalidOperation:
        raise CERResponseError(f"CER NGL {field} is not numeric") from None
    if not value.is_finite():
        raise CERResponseError(f"CER NGL {field} must be finite")
    return value


def _validate_and_dedupe_records(
    records: Iterable[Mapping[str, str]],
) -> tuple[Mapping[str, str], ...]:
    indexed: dict[tuple[str, ...], dict[str, str]] = {}
    for row in records:
        if tuple(row) != CER_NGL_HEADERS or any(not isinstance(value, str) for value in row.values()):
            raise CERResponseError("CER NGL record fields do not match its exact CSV contract")
        period = _parse_period(row)
        if row["Product"] not in CER_NGL_PRODUCTS:
            # Ethane is declared by the dictionary but has no reviewed facts.
            raise CERResponseError("CER NGL returned an unreviewed product")
        if row["Origin"] not in CER_NGL_ORIGINS:
            raise CERResponseError("CER NGL returned an unknown export origin")
        if row["Mode of Transportation"] not in CER_NGL_MODES:
            raise CERResponseError("CER NGL returned an unknown mode of transportation")
        destination = row["Destination / PADD"]
        reviewed_blank = (
            destination == "" and period == "2022-03" and row["Product"] == "Propane"
            and row["Origin"] in {"Alberta", "Total"}
            and row["Mode of Transportation"] in {"Railway", "Total"}
        )
        if destination not in CER_NGL_DESTINATIONS and not reviewed_blank:
            raise CERResponseError("CER NGL returned an unknown first export destination")
        for field in CER_NGL_HEADERS[7:]:
            _number(row[field], field)
        key = (period, row["Product"], row["Origin"], destination, row["Mode of Transportation"])
        previous = indexed.get(key)
        current = dict(row)
        if previous is not None and previous != current:
            raise CERResponseError("CER NGL returned conflicting duplicate source identities")
        indexed[key] = current
    if not indexed:
        raise CERResponseError("CER NGL records contain no data rows")
    return tuple(indexed[key] for key in sorted(indexed))


def _validate_origin_mapping(origin_geography_ids: Mapping[str, str]) -> None:
    if set(origin_geography_ids) != set(CER_NGL_ORIGINS):
        raise ValueError("CER NGL origin mapping must cover the exact reviewed source members")
    ids = tuple(origin_geography_ids.values())
    if any(not isinstance(value, str) or not value for value in ids) or len(set(ids)) != len(ids):
        raise ValueError("CER NGL origin geography IDs must be nonempty and unique")


def normalize_cer_ngl_records(
    records: Iterable[Mapping[str, str]],
    *,
    specs: Iterable[RegistryCanadaSeries],
    origin_geography_ids: Mapping[str, str],
    retrieved_at: datetime,
    previous_observations: Iterable[Observation] = (),
) -> tuple[Observation, ...]:
    """Normalize registered product/destination/all-mode views without sums.

    A registered origin with retained history but no row in the file's latest
    month receives an explicitly nonnumeric absence marker. This is not a
    source observation or an inferred zero: it keeps older numeric exports from
    appearing current and makes the latest-source-nonnumeric forecast guard
    effective. A geography with no retained facts stays manifest-unavailable.
    Previous adapter-created absence markers are retained while their source
    keys remain absent. A later real observation supersedes the marker through
    the normal revision ledger. Genuine source-row deletions are never masked.
    """

    _validate_origin_mapping(origin_geography_ids)
    if retrieved_at.tzinfo is None or retrieved_at.utcoffset() is None:
        raise ValueError("CER NGL retrieved_at must be timezone-aware")
    validated = _validate_and_dedupe_records(records)
    latest_period = max(_parse_period(row) for row in validated)
    if latest_period > retrieved_at.strftime("%Y-%m"):
        raise CERResponseError("CER NGL source period is later than retrieval month")
    series_specs = tuple(specs)
    previous = tuple(previous_observations)
    if not series_specs or len({spec.id for spec in series_specs}) != len(series_specs):
        raise ValueError("CER NGL normalization requires nonempty unique series IDs")
    source_origin_by_geography = {value: key for key, value in origin_geography_ids.items()}
    output: list[Observation] = []
    seen_filters: set[tuple[tuple[str, str], ...]] = set()
    for spec in series_specs:
        if spec.dataset_id != CER_NGL_DATASET_ID:
            raise ValueError("CER NGL series has an incompatible dataset ID")
        if spec.frequency is not Frequency.MONTHLY or spec.canonical_unit != CER_NGL_UNIT:
            raise ValueError("CER NGL series must be monthly cubic metres")
        filters = dict(spec.source_filters)
        if len(filters) != len(spec.source_filters) or set(filters) != _FILTER_FIELDS:
            raise ValueError("CER NGL series requires exact product/destination/mode filters")
        if (
            filters["Product"] not in CER_NGL_PRODUCTS
            or filters["Destination / PADD"] not in CER_NGL_DESTINATIONS
            or filters["Mode of Transportation"] != "Total"
        ):
            raise ValueError("CER NGL series has an unreviewed product/destination/mode filter")
        filter_key = tuple(sorted(filters.items()))
        if filter_key in seen_filters:
            raise ValueError("CER NGL series duplicate the same source view")
        seen_filters.add(filter_key)
        if (
            not spec.source_geography_ids
            or len(set(spec.source_geography_ids)) != len(spec.source_geography_ids)
            or not set(spec.source_geography_ids).issubset(source_origin_by_geography)
        ):
            raise ValueError("CER NGL series references incompatible export geographies")
        start = spec.bootstrap_start or "2014-01"
        if not _MONTH_PATTERN.fullmatch(start) or start > latest_period:
            raise ValueError("CER NGL series bootstrap start is not a valid retained source month")

        def dimensions(origin: str) -> tuple[tuple[str, str], ...]:
            return (
                ("dataset_id", CER_NGL_DATASET_ID),
                ("destination_padd", filters["Destination / PADD"]),
                ("export_origin", origin),
                ("mode_of_transport", "Total"),
                ("product", filters["Product"]),
            )

        latest_origins: set[str] = set()
        observed_origins: set[str] = set()
        for row in validated:
            if not all(row[field] == value for field, value in filters.items()):
                continue
            period = _parse_period(row)
            if period < start:
                continue
            geography_id = origin_geography_ids[row["Origin"]]
            if geography_id not in spec.source_geography_ids:
                # A new factual geography for an activated exact view needs
                # reviewed manifest/registry availability, never silent loss.
                raise CERResponseError("CER NGL source view gained an unregistered export geography")
            if period == latest_period:
                latest_origins.add(geography_id)
            observed_origins.add(geography_id)
            raw_value = row["Volume (m3)"]
            output.append(Observation(
                provider_id="cer", series_id=spec.id, period=period,
                geography_id=geography_id, value=_number(raw_value, "Volume (m3)"),
                unit=CER_NGL_UNIT, retrieved_at=retrieved_at,
                status=ObservationStatus.OBSERVED,
                dimensions=dimensions(row["Origin"]), flags=("source_published",),
                original_value=raw_value, original_unit="m3",
            ))
        for geography_id in spec.source_geography_ids:
            if geography_id in latest_origins or geography_id not in observed_origins:
                continue
            output.append(Observation(
                provider_id="cer", series_id=spec.id, period=latest_period,
                geography_id=geography_id, value=None, unit=CER_NGL_UNIT,
                retrieved_at=retrieved_at, status=ObservationStatus.MISSING,
                dimensions=dimensions(source_origin_by_geography[geography_id]),
                flags=("no_source_fact", "not_zero", "source_dataset_period"),
                original_value=None, original_unit="m3",
            ))
        incoming_keys = {row.key for row in output if row.series_id == spec.id}
        for old in previous:
            if old.series_id != spec.id or "no_source_fact" not in old.flags:
                continue
            origin = source_origin_by_geography.get(old.geography_id)
            if (
                old.provider_id != "cer" or old.unit != CER_NGL_UNIT
                or old.status is not ObservationStatus.MISSING or old.value is not None
                or old.geography_id not in spec.source_geography_ids or origin is None
                or tuple(sorted(old.dimensions)) != dimensions(origin)
                or set(old.flags) != {"no_source_fact", "not_zero", "source_dataset_period"}
                or old.original_value is not None or old.original_unit != "m3" or old.components
                or not _MONTH_PATTERN.fullmatch(old.period)
            ):
                raise ValueError("CER NGL previous absence marker has incompatible identity or status")
            if old.period > latest_period:
                raise CERResponseError("CER NGL latest source month regressed behind stored absence markers")
            if old.period < start or old.key in incoming_keys:
                continue
            # This is the only prior row retained by the adapter. Previously
            # numeric source facts still must arrive from the provider and are
            # checked by the orchestrator's unchanged removal guard.
            output.append(replace(old, retrieved_at=retrieved_at))
            incoming_keys.add(old.key)
    return tuple(sorted(output, key=lambda row: row.key))

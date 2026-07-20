"""Secure, deterministic client for registry-defined EIA API v2 queries.

The client deliberately knows nothing about petroleum geography or product codes.
Those exact facets belong in the verified registry/query specification supplied by
the caller. Credentials are read from the environment only and are never exposed
through results or exception messages.
"""

from __future__ import annotations

import hashlib
import json
import os
import time
from collections.abc import Callable, Mapping, MutableMapping
from dataclasses import dataclass
from typing import Any, Protocol
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit
from urllib.request import Request, urlopen


EIA_API_ORIGIN = "https://api.eia.gov"
_RETRYABLE_STATUSES = frozenset({408, 425, 429, 500, 502, 503, 504})


class EIAClientError(RuntimeError):
    """Base class whose messages are always safe to log."""


class EIACredentialError(EIAClientError):
    pass


class EIAResponseError(EIAClientError):
    pass


class EIATransportError(EIAClientError):
    pass


@dataclass(frozen=True, slots=True)
class EIASort:
    column: str
    direction: str = "asc"

    def __post_init__(self) -> None:
        if not self.column:
            raise ValueError("Sort column is required")
        if self.direction not in {"asc", "desc"}:
            raise ValueError("Sort direction must be 'asc' or 'desc'")


@dataclass(frozen=True, slots=True)
class EIAQuerySpec:
    """Exact query coordinates supplied by a verified series registry."""

    route: str
    frequency: str
    data_fields: tuple[str, ...]
    facets: tuple[tuple[str, tuple[str, ...]], ...] = ()
    start: str | None = None
    end: str | None = None
    sort: tuple[EIASort, ...] = (EIASort("period", "asc"),)
    extra_parameters: tuple[tuple[str, str], ...] = ()
    identity_fields: tuple[str, ...] = ("period",)

    def __post_init__(self) -> None:
        if not self.route.startswith("/v2/") or "?" in self.route or "://" in self.route:
            raise ValueError("EIA route must be a query-free /v2/ path")
        if not self.frequency or not self.data_fields:
            raise ValueError("EIA frequency and at least one data field are required")
        if len(set(self.data_fields)) != len(self.data_fields):
            raise ValueError("EIA data fields must be unique")
        facet_names = [name for name, _ in self.facets]
        if len(facet_names) != len(set(facet_names)):
            raise ValueError("Each EIA facet may be declared only once")
        if any(not name or not values for name, values in self.facets):
            raise ValueError("EIA facet names and values cannot be empty")
        forbidden = {"api_key", "offset", "length"}
        if any(name.lower() in forbidden for name, _ in self.extra_parameters):
            raise ValueError("Credentials and pagination are controlled by EIAClient")
        if not self.sort or not self.identity_fields:
            raise ValueError("Deterministic sort and identity fields are required")


@dataclass(frozen=True, slots=True)
class RetryPolicy:
    delays_seconds: tuple[float, ...] = (10.0, 30.0, 90.0)
    maximum_retry_after_seconds: float = 120.0

    def __post_init__(self) -> None:
        if any(delay < 0 for delay in self.delays_seconds):
            raise ValueError("Retry delays cannot be negative")
        if self.maximum_retry_after_seconds < 0:
            raise ValueError("Retry-After cap cannot be negative")

    @property
    def maximum_attempts(self) -> int:
        return len(self.delays_seconds) + 1


@dataclass(frozen=True, slots=True)
class HTTPResponse:
    status: int
    headers: Mapping[str, str]
    body: bytes


class Transport(Protocol):
    def __call__(self, url: str, timeout_seconds: float) -> HTTPResponse: ...


@dataclass(frozen=True, slots=True)
class EIAFetchResult:
    route: str
    records: tuple[Mapping[str, Any], ...]
    total: int
    request_count: int
    payload_sha256: str


def redact_url(url: str) -> str:
    """Remove credential values while retaining a useful route for diagnostics."""

    parts = urlsplit(url)
    redacted = [
        (name, "[REDACTED]" if name.lower() in {"api_key", "apikey"} else value)
        for name, value in parse_qsl(parts.query, keep_blank_values=True)
    ]
    return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(redacted), ""))


def _stdlib_transport(url: str, timeout_seconds: float) -> HTTPResponse:
    request = Request(url, headers={"Accept": "application/json", "User-Agent": "energy-dashboard/0.2"})
    try:
        with urlopen(request, timeout=timeout_seconds) as response:  # noqa: S310 - fixed EIA origin
            return HTTPResponse(
                status=response.status,
                headers=dict(response.headers.items()),
                body=response.read(),
            )
    except HTTPError as error:
        return HTTPResponse(error.code, dict(error.headers.items()), error.read())
    except (URLError, TimeoutError, OSError) as error:
        raise EIATransportError("EIA transport failed; request URL and credentials withheld") from None


class EIAClient:
    def __init__(
        self,
        *,
        api_key_environment_variable: str = "EIA_API_KEY",
        environment: Mapping[str, str] | None = None,
        transport: Transport | None = None,
        sleeper: Callable[[float], None] = time.sleep,
        retry_policy: RetryPolicy = RetryPolicy(),
        timeout_seconds: float = 30.0,
        page_size: int = 5000,
    ) -> None:
        if not 1 <= page_size <= 5000:
            raise ValueError("EIA page_size must be in [1, 5000]")
        if timeout_seconds <= 0:
            raise ValueError("EIA timeout must be positive")
        self._environment = os.environ if environment is None else environment
        self._api_key_environment_variable = api_key_environment_variable
        self._transport = transport or _stdlib_transport
        self._sleeper = sleeper
        self._retry_policy = retry_policy
        self._timeout_seconds = timeout_seconds
        self._page_size = page_size

    def fetch(self, spec: EIAQuerySpec) -> EIAFetchResult:
        api_key = self._environment.get(self._api_key_environment_variable, "").strip()
        if not api_key:
            raise EIACredentialError(
                f"Required EIA credential environment variable {self._api_key_environment_variable} is unset"
            )

        records: list[Mapping[str, Any]] = []
        offset = 0
        request_count = 0
        expected_total: int | None = None
        while expected_total is None or offset < expected_total:
            payload, attempts = self._request_page(spec, api_key, offset)
            request_count += attempts
            response = payload.get("response")
            if not isinstance(response, Mapping):
                raise EIAResponseError(f"EIA response for {spec.route} has no response object")
            page = response.get("data")
            if not isinstance(page, list) or any(not isinstance(row, Mapping) for row in page):
                raise EIAResponseError(f"EIA response for {spec.route} has invalid data rows")
            try:
                page_total = int(response["total"])
            except (KeyError, TypeError, ValueError):
                raise EIAResponseError(f"EIA response for {spec.route} has invalid total") from None
            if page_total < 0 or (expected_total is not None and page_total != expected_total):
                raise EIAResponseError(f"EIA pagination total changed for {spec.route}")
            expected_total = page_total
            if not page and offset < expected_total:
                raise EIAResponseError(f"EIA pagination ended before total for {spec.route}")
            records.extend(page)
            offset += len(page)
            if expected_total == 0:
                break

        if len(records) != (expected_total or 0):
            raise EIAResponseError(f"EIA pagination row count disagrees with total for {spec.route}")

        ordered = tuple(sorted(records, key=lambda row: self._identity_key(row, spec)))
        identities = [self._identity_key(row, spec) for row in ordered]
        if len(identities) != len(set(identities)):
            raise EIAResponseError(f"EIA response for {spec.route} has duplicate row identities")
        canonical = json.dumps(ordered, sort_keys=True, separators=(",", ":"), ensure_ascii=True)
        return EIAFetchResult(
            route=spec.route,
            records=ordered,
            total=expected_total or 0,
            request_count=request_count,
            payload_sha256=hashlib.sha256(canonical.encode("utf-8")).hexdigest(),
        )

    def _identity_key(self, row: Mapping[str, Any], spec: EIAQuerySpec) -> tuple[str, ...]:
        missing = [field for field in spec.identity_fields if field not in row]
        if missing:
            raise EIAResponseError(
                f"EIA response for {spec.route} lacks identity fields {sorted(missing)}"
            )
        return tuple(str(row[field]) for field in spec.identity_fields)

    def _request_page(
        self, spec: EIAQuerySpec, api_key: str, offset: int
    ) -> tuple[Mapping[str, Any], int]:
        url = self._build_url(spec, api_key, offset)
        for attempt in range(self._retry_policy.maximum_attempts):
            try:
                response = self._transport(url, self._timeout_seconds)
            except (EIATransportError, URLError, TimeoutError, OSError):
                if attempt == self._retry_policy.maximum_attempts - 1:
                    raise EIATransportError(
                        f"EIA request failed after bounded retries for {spec.route}; credentials withheld"
                    ) from None
                self._sleeper(self._retry_policy.delays_seconds[attempt])
                continue
            if response.status == 200:
                try:
                    payload = json.loads(response.body.decode("utf-8"))
                except (UnicodeDecodeError, json.JSONDecodeError):
                    raise EIAResponseError(f"EIA returned invalid JSON for {spec.route}") from None
                if not isinstance(payload, Mapping):
                    raise EIAResponseError(f"EIA returned a non-object payload for {spec.route}")
                return payload, attempt + 1
            if response.status in {401, 403}:
                raise EIACredentialError(
                    f"EIA rejected authentication for {spec.route}; credential value withheld"
                )
            if response.status not in _RETRYABLE_STATUSES:
                raise EIAResponseError(f"EIA returned HTTP {response.status} for {spec.route}")
            if attempt == self._retry_policy.maximum_attempts - 1:
                raise EIAResponseError(
                    f"EIA returned HTTP {response.status} after bounded retries for {spec.route}"
                )
            delay = self._retry_delay(response.headers, attempt)
            self._sleeper(delay)
        raise AssertionError("unreachable")

    def _retry_delay(self, headers: Mapping[str, str], attempt: int) -> float:
        lowered: MutableMapping[str, str] = {str(key).lower(): str(value) for key, value in headers.items()}
        retry_after = lowered.get("retry-after")
        if retry_after is not None:
            try:
                return min(max(float(retry_after), 0.0), self._retry_policy.maximum_retry_after_seconds)
            except ValueError:
                pass
        return self._retry_policy.delays_seconds[attempt]

    def _build_url(self, spec: EIAQuerySpec, api_key: str, offset: int) -> str:
        parameters: list[tuple[str, str]] = [("api_key", api_key), ("frequency", spec.frequency)]
        parameters.extend((f"data[{index}]", field) for index, field in enumerate(spec.data_fields))
        for facet_name, facet_values in sorted(spec.facets):
            parameters.extend(
                (f"facets[{facet_name}][]", value) for value in sorted(facet_values)
            )
        if spec.start is not None:
            parameters.append(("start", spec.start))
        if spec.end is not None:
            parameters.append(("end", spec.end))
        for index, order in enumerate(spec.sort):
            parameters.append((f"sort[{index}][column]", order.column))
            parameters.append((f"sort[{index}][direction]", order.direction))
        parameters.extend(sorted(spec.extra_parameters))
        parameters.extend((("offset", str(offset)), ("length", str(self._page_size))))
        return f"{EIA_API_ORIGIN}{spec.route}?{urlencode(parameters)}"

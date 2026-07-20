"""Credential-free Statistics Canada full-table CSV client.

The client deliberately treats the WDS response and ZIP archive as untrusted
input.  Only an HTTPS URL on Statistics Canada's official host is accepted,
archive members and sizes are bounded, and the CSV header must exactly match
the reviewed table contract before any rows reach normalization.
"""

from __future__ import annotations

import csv
import hashlib
import io
import json
import time
import urllib.error
import urllib.parse
import urllib.request
import zipfile
from dataclasses import dataclass
from typing import Mapping


_STATCAN_HOST = "www150.statcan.gc.ca"


@dataclass(frozen=True, slots=True)
class StatCanTableSpec:
    pid: str
    wds_url: str
    csv_member: str
    metadata_member: str
    required_headers: tuple[str, ...]
    max_archive_bytes: int = 32 * 1024 * 1024
    max_uncompressed_bytes: int = 256 * 1024 * 1024

    def __post_init__(self) -> None:
        if not self.pid.isdigit() or len(self.pid) != 8:
            raise ValueError("Statistics Canada PID must contain exactly eight digits")
        expected = f"https://{_STATCAN_HOST}/t1/wds/rest/getFullTableDownloadCSV/{self.pid}/en"
        if self.wds_url != expected:
            raise ValueError("Statistics Canada WDS URL does not match the registered PID")
        if self.csv_member != f"{self.pid}.csv":
            raise ValueError("Statistics Canada data member must match the registered PID")
        if self.metadata_member != f"{self.pid}_MetaData.csv":
            raise ValueError("Statistics Canada metadata member must match the registered PID")
        if len(self.required_headers) != len(set(self.required_headers)):
            raise ValueError("Statistics Canada required headers must be unique")
        if self.max_archive_bytes <= 0 or self.max_uncompressed_bytes <= 0:
            raise ValueError("Statistics Canada archive limits must be positive")


@dataclass(frozen=True, slots=True)
class StatCanFetchResult:
    pid: str
    download_url: str
    records: tuple[Mapping[str, str], ...]
    archive_sha256: str
    csv_sha256: str
    archive_bytes: int
    csv_bytes: int
    request_count: int


@dataclass(frozen=True, slots=True)
class StatCanRetryPolicy:
    attempts: int = 4
    timeout_seconds: float = 60.0
    backoff_seconds: float = 1.0

    def __post_init__(self) -> None:
        if self.attempts < 1:
            raise ValueError("Retry attempts must be at least one")
        if self.timeout_seconds <= 0 or self.backoff_seconds < 0:
            raise ValueError("Retry timing values are invalid")


class StatCanClient:
    """Retrieve and validate one complete Statistics Canada table archive."""

    def __init__(self, *, retry_policy: StatCanRetryPolicy | None = None) -> None:
        self.retry_policy = retry_policy or StatCanRetryPolicy()

    def fetch(self, spec: StatCanTableSpec) -> StatCanFetchResult:
        wds_payload, wds_requests = self._request(spec.wds_url, max_bytes=64 * 1024)
        try:
            wds = json.loads(wds_payload)
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ValueError("Statistics Canada WDS response is not valid JSON") from None
        if not isinstance(wds, Mapping) or wds.get("status") != "SUCCESS":
            raise ValueError("Statistics Canada WDS did not return SUCCESS")
        download_url = wds.get("object")
        if not isinstance(download_url, str):
            raise ValueError("Statistics Canada WDS response omitted the download URL")
        self._validate_download_url(download_url, spec.pid)

        archive, archive_requests = self._request(
            download_url, max_bytes=spec.max_archive_bytes
        )
        records, csv_payload = self._read_archive(spec, archive)
        return StatCanFetchResult(
            pid=spec.pid,
            download_url=download_url,
            records=records,
            archive_sha256=hashlib.sha256(archive).hexdigest(),
            csv_sha256=hashlib.sha256(csv_payload).hexdigest(),
            archive_bytes=len(archive),
            csv_bytes=len(csv_payload),
            request_count=wds_requests + archive_requests,
        )

    def _request(self, url: str, *, max_bytes: int) -> tuple[bytes, int]:
        request = urllib.request.Request(
            url,
            headers={"Accept": "application/json, application/zip", "User-Agent": "na-energy-monitor/1"},
        )
        last_error: Exception | None = None
        for attempt in range(self.retry_policy.attempts):
            try:
                with urllib.request.urlopen(  # noqa: S310 - URL is allowlisted before use
                    request, timeout=self.retry_policy.timeout_seconds
                ) as response:
                    declared = response.headers.get("Content-Length")
                    if declared is not None and int(declared) > max_bytes:
                        raise ValueError("Statistics Canada response exceeds the configured size limit")
                    payload = response.read(max_bytes + 1)
                    if len(payload) > max_bytes:
                        raise ValueError("Statistics Canada response exceeds the configured size limit")
                    return payload, attempt + 1
            except ValueError:
                raise
            except (OSError, urllib.error.HTTPError, urllib.error.URLError) as error:
                last_error = error
                if attempt + 1 < self.retry_policy.attempts:
                    time.sleep(self.retry_policy.backoff_seconds * (2**attempt))
        assert last_error is not None
        raise RuntimeError("Statistics Canada request failed after retries") from last_error

    @staticmethod
    def _validate_download_url(url: str, pid: str) -> None:
        parsed = urllib.parse.urlparse(url)
        expected_path = f"/n1/tbl/csv/{pid}-eng.zip"
        if (
            parsed.scheme != "https"
            or parsed.hostname != _STATCAN_HOST
            or parsed.path != expected_path
            or parsed.params
            or parsed.query
            or parsed.fragment
            or parsed.username
            or parsed.password
            or parsed.port not in {None, 443}
        ):
            raise ValueError("Statistics Canada WDS returned an unapproved download URL")

    @staticmethod
    def _read_archive(
        spec: StatCanTableSpec, archive: bytes
    ) -> tuple[tuple[Mapping[str, str], ...], bytes]:
        try:
            zipped = zipfile.ZipFile(io.BytesIO(archive))
        except (zipfile.BadZipFile, OSError):
            raise ValueError("Statistics Canada download is not a valid ZIP archive") from None
        with zipped:
            members = zipped.infolist()
            names = {member.filename for member in members}
            expected_names = {spec.csv_member, spec.metadata_member}
            if names != expected_names:
                raise ValueError(
                    "Statistics Canada archive members drifted; expected only data and metadata CSVs"
                )
            total_uncompressed = 0
            for member in members:
                path = member.filename.replace("\\", "/")
                if path.startswith("/") or ".." in path.split("/") or member.flag_bits & 0x1:
                    raise ValueError("Statistics Canada archive contains an unsafe member")
                total_uncompressed += member.file_size
            if total_uncompressed > spec.max_uncompressed_bytes:
                raise ValueError("Statistics Canada archive exceeds the uncompressed size limit")
            try:
                csv_payload = zipped.read(spec.csv_member)
                # Reading metadata forces CRC verification for both required members.
                zipped.read(spec.metadata_member)
            except (RuntimeError, zipfile.BadZipFile):
                raise ValueError("Statistics Canada archive failed CRC validation") from None

        try:
            text = csv_payload.decode("utf-8-sig")
        except UnicodeDecodeError:
            raise ValueError("Statistics Canada data CSV is not UTF-8") from None
        if "\x00" in text:
            raise ValueError("Statistics Canada data CSV contains a NUL byte")
        reader = csv.DictReader(io.StringIO(text, newline=""), strict=True)
        headers = tuple(reader.fieldnames or ())
        if headers != spec.required_headers:
            raise ValueError(
                "Statistics Canada CSV header drifted: "
                f"expected={spec.required_headers!r}, returned={headers!r}"
            )
        records: list[Mapping[str, str]] = []
        for number, row in enumerate(reader, start=2):
            if None in row or any(value is None for value in row.values()):
                raise ValueError(f"Statistics Canada CSV row {number} does not match its header")
            records.append(dict(row))
        if not records:
            raise ValueError("Statistics Canada data CSV contains no rows")
        return tuple(records), csv_payload

from __future__ import annotations

import csv
import hashlib
import io
import sys
import unittest
from dataclasses import replace
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "pipeline"))

from energy_dashboard.canada_registry import RegistryCanadaSeries
from energy_dashboard.cer import CERHTTPResponse, CERResponseError, CERRetryPolicy, CERTransportError
from energy_dashboard.cer_pipeline import (
    TRANS_NORTHERN_CSV_URL,
    TRANS_NORTHERN_DATASET_ID,
    TRANS_NORTHERN_FILTERS,
    TRANS_NORTHERN_GEOGRAPHIES,
    TRANS_NORTHERN_HEADERS,
    TRANS_NORTHERN_UNIT,
    TransNorthernClient,
    normalize_trans_northern_records,
)
from energy_dashboard.contracts import Frequency, ObservationStatus

RETRIEVED_AT = datetime(2026, 9, 10, 5, 0, tzinfo=UTC)


def spec() -> RegistryCanadaSeries:
    return RegistryCanadaSeries(
        id="can.cer.trans_northern.throughput.monthly", metric_id="pipeline_throughput",
        title="Trans-Northern refined products throughput", description="Exact pipeline points",
        source_name="Canada Energy Regulator", source_url=TRANS_NORTHERN_CSV_URL,
        canonical_unit=TRANS_NORTHERN_UNIT, frequency=Frequency.MONTHLY,
        source_geography_ids=tuple(TRANS_NORTHERN_GEOGRAPHIES.values()),
        source_geography_level_ids=("pipeline_key_point",), unsupported_levels=(),
        bootstrap_start="2014-01", dataset_id=TRANS_NORTHERN_DATASET_ID,
        source_filters=TRANS_NORTHERN_FILTERS,
    )


def row(point: str = "system", value: str = "20.8", **overrides: str) -> dict[str, str]:
    result = dict.fromkeys(TRANS_NORTHERN_HEADERS, "")
    result.update(dict(TRANS_NORTHERN_FILTERS))
    result.update({
        "Date": "2026-06-01", "Year": "2026", "Month": "6",
        "Key Point": point, "Throughput (1000 m3/d)": value,
    })
    result.update(overrides)
    return result


def cohort() -> list[dict[str, str]]:
    return [row("Montreal-West", "7.9"), row("Nanticoke-East", "12.9"), row()]


def payload(rows: list[dict[str, str]], headers: tuple[str, ...] = TRANS_NORTHERN_HEADERS) -> bytes:
    stream = io.StringIO(newline="")
    writer = csv.DictWriter(stream, fieldnames=headers, lineterminator="\n")
    writer.writeheader()
    for item in rows:
        writer.writerow({header: item.get(header, "") for header in headers})
    return stream.getvalue().encode("utf-8-sig")


class Transport:
    def __init__(self, responses: list[CERHTTPResponse | Exception]) -> None:
        self.responses = responses
        self.calls: list[tuple[str, float, int]] = []

    def __call__(self, url: str, timeout: float, maximum: int) -> CERHTTPResponse:
        self.calls.append((url, timeout, maximum))
        response = self.responses.pop(0)
        if isinstance(response, Exception):
            raise response
        return response


def client(rows: list[dict[str, str]]) -> TransNorthernClient:
    return TransNorthernClient(transport=Transport([CERHTTPResponse(200, {}, payload(rows))]))


class TransNorthernClientTests(unittest.TestCase):
    def test_exact_url_byte_checksum_and_file_timestamp(self) -> None:
        body = payload(cohort())
        transport = Transport([CERHTTPResponse(
            200, {"Last-Modified": "Thu, 27 Aug 2026 21:29:20 GMT"}, body,
        )])
        result = TransNorthernClient(transport=transport).fetch()
        self.assertEqual(result.download_url, TRANS_NORTHERN_CSV_URL)
        self.assertEqual(result.source_url, TRANS_NORTHERN_CSV_URL)
        self.assertEqual(transport.calls[0][0], TRANS_NORTHERN_CSV_URL)
        self.assertEqual(result.payload_sha256, hashlib.sha256(body).hexdigest())
        self.assertEqual(result.payload_bytes, len(body))
        self.assertEqual((result.attempts, result.request_count), (1, 1))
        self.assertEqual(result.source_updated_at, datetime(2026, 8, 27, 21, 29, 20, tzinfo=UTC))
        self.assertEqual(len(result.records), 3)

    def test_missing_or_bad_file_timestamp_is_not_retrieval_time(self) -> None:
        for headers in ({}, {"Last-Modified": "unavailable"}, {"Last-Modified": "27 Aug 2026 21:29:20"}):
            with self.subTest(headers=headers):
                fetched = TransNorthernClient(transport=Transport([
                    CERHTTPResponse(200, headers, payload(cohort())),
                ])).fetch()
                self.assertIsNone(fetched.source_updated_at)

    def test_bounded_retries_and_retry_after_cap(self) -> None:
        transport = Transport([
            CERTransportError("private transport detail"),
            CERHTTPResponse(429, {"Retry-After": "999"}, b"private error body"),
            CERHTTPResponse(200, {}, payload(cohort())),
        ])
        sleeps: list[float] = []
        fetched = TransNorthernClient(
            transport=transport, sleeper=sleeps.append,
            retry_policy=CERRetryPolicy((1, 4), maximum_retry_after_seconds=2),
        ).fetch()
        self.assertEqual(sleeps, [1, 2])
        self.assertEqual(fetched.attempts, 3)

    def test_nonfinite_retry_after_falls_back_to_finite_delay(self) -> None:
        for header in ("NaN", "Infinity", "not a number"):
            sleeps: list[float] = []
            TransNorthernClient(
                transport=Transport([
                    CERHTTPResponse(503, {"retry-after": header}, b""),
                    CERHTTPResponse(200, {}, payload(cohort())),
                ]), sleeper=sleeps.append, retry_policy=CERRetryPolicy((0.01,)),
            ).fetch()
            self.assertEqual(sleeps, [0.01])

    def test_failed_transport_exhausts_bounded_attempts_without_leaking_details(self) -> None:
        transport = Transport([OSError("private error"), OSError("private error")])
        with self.assertRaisesRegex(CERTransportError, "bounded retries") as error:
            TransNorthernClient(
                transport=transport, sleeper=lambda _: None, retry_policy=CERRetryPolicy((0,)),
            ).fetch()
        self.assertEqual(len(transport.calls), 2)
        self.assertNotIn("private", str(error.exception))

    def test_bad_http_and_data_contract_failures_are_not_retried(self) -> None:
        for response in (
            CERHTTPResponse(404, {}, b"private body"),
            CERHTTPResponse(200, {}, b"<html>not CSV</html>"),
            CERHTTPResponse(200, {}, b"\xff"),
            CERHTTPResponse(200, {}, b"\x00"),
        ):
            transport = Transport([response])
            with self.subTest(response=response.status), self.assertRaises(CERResponseError):
                TransNorthernClient(transport=transport).fetch()
            self.assertEqual(len(transport.calls), 1)

    def test_payload_and_record_limits(self) -> None:
        for options, message in (({"maximum_response_bytes": 10}, "size limit"),
                                 ({"maximum_records": 2}, "record limit")):
            with self.subTest(options=options), self.assertRaisesRegex(CERResponseError, message):
                TransNorthernClient(
                    transport=Transport([CERHTTPResponse(200, {}, payload(cohort()))]), **options,
                ).fetch()
        for options in ({"maximum_response_bytes": 0}, {"maximum_records": 0}):
            with self.assertRaises(ValueError):
                TransNorthernClient(**options)

    def test_headers_pin_units_and_empty_files_fail(self) -> None:
        wrong = tuple(h.replace("1000 m3/d", "bbl/d") for h in TRANS_NORTHERN_HEADERS)
        for body in (payload(cohort(), wrong), payload([])):
            with self.assertRaises(CERResponseError):
                TransNorthernClient(transport=Transport([CERHTTPResponse(200, {}, body)])).fetch()

    def test_all_metadata_and_geography_drift_is_rejected(self) -> None:
        variants = [
            {"Company": "Another company"}, {"Pipeline": "Another pipeline"},
            {"Direction Of Flow": "east"}, {"Trade Type": "export"},
            {"Product": "gasoline"}, {"Key Point": "Alberta"},
            {"Latitude": "45.5"}, {"Longitude": "-73.5"},
            {"Nameplate Capacity (1000 m3/d)": "30"},
            {"Available Capacity (1000 m3/d)": "25"}, {"Reason For Variance": "outage"},
        ]
        for variant in variants:
            rows = cohort()
            rows[0].update(variant)
            with self.subTest(variant=variant), self.assertRaises(CERResponseError):
                client(rows).fetch()

    def test_month_first_day_year_and_month_are_all_validated(self) -> None:
        variants = [
            {"Date": "2026-06-02"}, {"Date": "2026-13-01"},
            {"Date": "06/01/2026"}, {"Year": "2025"}, {"Month": "7"}, {"Month": "06"},
        ]
        for variant in variants:
            rows = cohort()
            rows[0].update(variant)
            with self.subTest(variant=variant), self.assertRaises(CERResponseError):
                client(rows).fetch()

    def test_no_negative_nonfinite_or_unknown_numeric_status(self) -> None:
        for value in ("-1", "NaN", "Infinity", "1e99999", "x", "..", "7,900", " " * 4):
            rows = cohort()
            rows[0]["Throughput (1000 m3/d)"] = value
            with self.subTest(value=value), self.assertRaisesRegex(CERResponseError, "nonnegative"):
                client(rows).fetch()

    def test_exact_duplicates_deduplicate_but_conflicts_fail(self) -> None:
        rows = cohort()
        self.assertEqual(len(client(rows + [dict(rows[0])]).fetch().records), 3)
        with self.assertRaisesRegex(CERResponseError, "conflicting duplicate"):
            client(rows + [row("Montreal-West", "8.0")]).fetch()

    def test_full_source_requires_registered_points_but_not_fake_complete_history(self) -> None:
        with self.assertRaisesRegex(CERResponseError, "missing a registered key point"):
            client(cohort()[:2]).fetch()
        older = row(**{"Date": "2006-01-01", "Year": "2006", "Month": "1"})
        result = client(cohort() + [older]).fetch()
        self.assertEqual(len(result.records), 4)
        self.assertEqual(result.records[0]["Key Point"], "system")


class TransNorthernNormalizationTests(unittest.TestCase):
    def test_source_rates_and_exact_three_points_without_rollup(self) -> None:
        observations = normalize_trans_northern_records(cohort(), spec=spec(), retrieved_at=RETRIEVED_AT)
        self.assertEqual(len(observations), 3)
        self.assertEqual({r.geography_id for r in observations}, set(TRANS_NORTHERN_GEOGRAPHIES.values()))
        self.assertNotIn("ca", {r.geography_id for r in observations})
        by_point = {dict(r.dimensions)["key_point"]: r for r in observations}
        self.assertEqual(by_point["Montreal-West"].value, Decimal("7.9"))
        self.assertEqual(by_point["Nanticoke-East"].value, Decimal("12.9"))
        self.assertEqual(by_point["system"].value, Decimal("20.8"))
        for item in observations:
            self.assertEqual(item.unit, TRANS_NORTHERN_UNIT)
            self.assertEqual(item.period, "2026-06")
            self.assertEqual(item.provider_id, "cer")
            self.assertEqual(dict(item.dimensions)["product"], "refined petroleum products")
            self.assertEqual(dict(item.dimensions)["direction_of_flow"], "not available")
            self.assertEqual(dict(item.dimensions)["trade_type"], "intracanada")
            self.assertFalse(item.components)
            self.assertNotIn("capacity", dict(item.dimensions))
            self.assertIsNone(item.source_released_at)
            self.assertIsNone(item.source_updated_at)

    def test_blank_throughput_is_not_zero_and_retains_source_month(self) -> None:
        rows = cohort()
        rows[0]["Throughput (1000 m3/d)"] = ""
        rows[1]["Throughput (1000 m3/d)"] = "0"
        observations = normalize_trans_northern_records(rows, spec=spec(), retrieved_at=RETRIEVED_AT)
        by_id = {r.geography_id: r for r in observations}
        absent = by_id[TRANS_NORTHERN_GEOGRAPHIES["Montreal-West"]]
        zero = by_id[TRANS_NORTHERN_GEOGRAPHIES["Nanticoke-East"]]
        self.assertIsNone(absent.value)
        self.assertEqual(absent.status, ObservationStatus.NOT_AVAILABLE)
        self.assertEqual(absent.period, "2026-06")
        self.assertEqual(zero.value, Decimal(0))
        self.assertEqual(zero.status, ObservationStatus.OBSERVED)

    def test_registry_identity_units_frequency_filters_and_geographies_fail_closed(self) -> None:
        wrong_specs = [
            replace(spec(), dataset_id="refinery_crude_runs_weekly"),
            replace(spec(), canonical_unit="cubic_metres"),
            replace(spec(), frequency=Frequency.WEEKLY),
            replace(spec(), source_filters=TRANS_NORTHERN_FILTERS[:-1]),
            replace(spec(), source_filters=TRANS_NORTHERN_FILTERS + (TRANS_NORTHERN_FILTERS[0],)),
            replace(spec(), source_geography_ids=("ca",)),
        ]
        for wrong in wrong_specs:
            with self.subTest(spec=wrong), self.assertRaises(ValueError):
                normalize_trans_northern_records(cohort(), spec=wrong, retrieved_at=RETRIEVED_AT)

    def test_direct_normalization_revalidates_records(self) -> None:
        rows = cohort()
        rows[0]["Product"] = "finished motor gasoline"
        with self.assertRaisesRegex(CERResponseError, "Product"):
            normalize_trans_northern_records(rows, spec=spec(), retrieved_at=RETRIEVED_AT)

    def test_missing_or_extra_csv_field_rejected_without_zero_padding(self) -> None:
        for extra in (False, True):
            rows = cohort()
            if extra:
                rows[0]["Unknown"] = ""
            else:
                del rows[0]["Product"]
            with self.assertRaisesRegex(CERResponseError, "exact fields"):
                normalize_trans_northern_records(rows, spec=spec(), retrieved_at=RETRIEVED_AT)

    def test_file_update_is_retained_separately_from_release_and_retrieval(self) -> None:
        updated = datetime(2026, 8, 27, 21, 29, 20, tzinfo=UTC)
        observations = normalize_trans_northern_records(
            cohort(), spec=spec(), retrieved_at=RETRIEVED_AT, source_updated_at=updated,
        )
        self.assertEqual(observations[0].source_updated_at, updated)
        self.assertEqual(observations[0].retrieved_at, RETRIEVED_AT)
        self.assertIsNone(observations[0].source_released_at)

    def test_timestamps_require_timezones_and_future_observations_fail(self) -> None:
        for timestamps in (
            {"retrieved_at": datetime(2026, 9, 10)},
            {"retrieved_at": RETRIEVED_AT, "source_updated_at": datetime(2026, 8, 27)},
        ):
            with self.assertRaises(ValueError):
                normalize_trans_northern_records(cohort(), spec=spec(), **timestamps)
        with self.assertRaisesRegex(CERResponseError, "future"):
            normalize_trans_northern_records(
                cohort(), spec=spec(), retrieved_at=datetime(2026, 5, 1, tzinfo=UTC),
            )


if __name__ == "__main__":
    unittest.main()

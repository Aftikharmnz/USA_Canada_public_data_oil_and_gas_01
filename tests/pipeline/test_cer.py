from __future__ import annotations

import csv
import io
import sys
import unittest
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "pipeline"))

from energy_dashboard.cer import (
    CER_CRUDE_RUNS_CSV_URL,
    CER_CRUDE_RUNS_DATASET_URL,
    CER_CRUDE_RUNS_DICTIONARY_URL,
    CER_CSV_HEADERS,
    CER_REGIONS,
    CER_RUNS_UNIT,
    CER_SOURCE_RUNS_UNIT,
    CER_UTILIZATION_UNIT,
    CERClient,
    CERHTTPResponse,
    CERResponseError,
    CERRetryPolicy,
    CERTransportError,
    normalize_cer_records,
    roll_up_cer_national_runs,
)
from energy_dashboard.contracts import AggregationRule, ObservationStatus


REGION_GEOGRAPHIES = {
    "Ontario": "ca.cer.ontario",
    "Quebec & Eastern Canada": "ca.cer.quebec_eastern",
    "Western Canada": "ca.cer.western",
}
RETRIEVED_AT = datetime(2026, 7, 19, 12, 0, tzinfo=UTC)


def row(
    *,
    period: str = "06/16/2026",
    region: str = "Ontario",
    runs: str = "65.570",
    utilization: str = "95.700",
    unit: str = CER_SOURCE_RUNS_UNIT,
) -> dict[str, str]:
    values = (
        period,
        "06/17/2025",
        region,
        runs,
        utilization,
        "65.630",
        "59.140",
        "59.290",
        "58.360",
        unit,
    )
    return dict(zip(CER_CSV_HEADERS, values, strict=True))


def complete_week(period: str = "06/16/2026") -> list[dict[str, str]]:
    return [
        row(period=period, region="Ontario", runs="65.570", utilization="95.700"),
        row(
            period=period,
            region="Quebec & Eastern Canada",
            runs="103.440",
            utilization="90.190",
        ),
        row(period=period, region="Western Canada", runs="97.220", utilization="86.750"),
    ]


def csv_payload(rows: list[dict[str, str]], headers: tuple[str, ...] = CER_CSV_HEADERS) -> bytes:
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=headers, lineterminator="\n")
    writer.writeheader()
    for item in rows:
        writer.writerow({header: item.get(header, "") for header in headers})
    return output.getvalue().encode("utf-8")


class FixtureTransport:
    def __init__(self, responses: list[CERHTTPResponse | Exception]) -> None:
        self.responses = list(responses)
        self.calls: list[tuple[str, float, int]] = []

    def __call__(
        self, url: str, timeout_seconds: float, maximum_response_bytes: int
    ) -> CERHTTPResponse:
        self.calls.append((url, timeout_seconds, maximum_response_bytes))
        result = self.responses.pop(0)
        if isinstance(result, Exception):
            raise result
        return result


class CERClientTests(unittest.TestCase):
    def test_official_urls_are_stable_and_credential_free(self) -> None:
        self.assertEqual(
            CER_CRUDE_RUNS_CSV_URL,
            "https://www.cer-rec.gc.ca/open/imports-exports/crude-runs-weekly.csv",
        )
        self.assertEqual(
            CER_CRUDE_RUNS_DICTIONARY_URL,
            "https://www.cer-rec.gc.ca/open/imports-exports/"
            "crude-runs-data-dictionary.csv",
        )
        self.assertEqual(
            CER_CRUDE_RUNS_DATASET_URL,
            "https://open.canada.ca/data/en/dataset/5c0099e0-7081-404e-a95f-b0541de06630",
        )
        self.assertNotIn("key=", CER_CRUDE_RUNS_CSV_URL.lower())

    def test_fetch_validates_and_deterministically_deduplicates_exact_rows(self) -> None:
        rows = complete_week()
        payload = csv_payload([rows[2], rows[0], rows[0], rows[1]])
        transport = FixtureTransport([CERHTTPResponse(200, {}, payload)])
        result = CERClient(transport=transport).fetch()

        self.assertEqual(result.source_url, CER_CRUDE_RUNS_CSV_URL)
        self.assertEqual(result.request_count, 1)
        self.assertEqual(result.payload_bytes, len(payload))
        self.assertEqual(len(result.payload_sha256), 64)
        self.assertEqual(len(result.records), 3)
        self.assertEqual([record["Region"] for record in result.records], list(CER_REGIONS))
        self.assertEqual(transport.calls[0][0], CER_CRUDE_RUNS_CSV_URL)

    def test_retry_after_is_bounded_and_transport_errors_are_safe(self) -> None:
        payload = csv_payload(complete_week())
        transport = FixtureTransport(
            [CERHTTPResponse(503, {"Retry-After": "999"}, b"private body"),
             CERHTTPResponse(200, {}, payload)]
        )
        sleeps: list[float] = []
        result = CERClient(
            transport=transport,
            sleeper=sleeps.append,
            retry_policy=CERRetryPolicy((0.01,), maximum_retry_after_seconds=2),
        ).fetch()
        self.assertEqual(result.request_count, 2)
        self.assertEqual(sleeps, [2])

        secret = "transport-secret-that-must-not-leak"
        failed = FixtureTransport([OSError(secret), OSError(secret)])
        with self.assertRaises(CERTransportError) as context:
            CERClient(
                transport=failed,
                sleeper=lambda _: None,
                retry_policy=CERRetryPolicy((0,), timeout_seconds=1),
            ).fetch()
        self.assertNotIn(secret, str(context.exception))
        self.assertNotIn(CER_CRUDE_RUNS_CSV_URL, str(context.exception))

    def test_non_retryable_http_and_response_size_fail_closed(self) -> None:
        rejected = FixtureTransport([CERHTTPResponse(404, {}, b"internal details")])
        with self.assertRaisesRegex(CERResponseError, "HTTP 404") as context:
            CERClient(transport=rejected).fetch()
        self.assertNotIn("internal details", str(context.exception))

        oversized = FixtureTransport([CERHTTPResponse(200, {}, b"12345")])
        with self.assertRaisesRegex(CERResponseError, "size limit"):
            CERClient(transport=oversized, maximum_response_bytes=4).fetch()

    def test_header_unit_region_and_weekday_drift_fail_closed(self) -> None:
        wrong_headers = tuple("Crude Runs" if item == "Crude Volumes For The Week" else item
                              for item in CER_CSV_HEADERS)
        with self.assertRaisesRegex(CERResponseError, "header drifted"):
            CERClient(
                transport=FixtureTransport(
                    [CERHTTPResponse(200, {}, csv_payload([row()], wrong_headers))]
                )
            ).fetch()

        invalid_rows = (
            (row(unit="barrels per day"), "unit drifted"),
            (row(region="Canada"), "unknown region"),
            (row(period="06/15/2026"), "not Tuesday"),
            (row(period="2026-06-16"), "MM/DD/YYYY"),
        )
        for invalid, message in invalid_rows:
            with self.subTest(message=message), self.assertRaisesRegex(CERResponseError, message):
                CERClient(
                    transport=FixtureTransport(
                        [CERHTTPResponse(200, {}, csv_payload([invalid]))]
                    )
                ).fetch()

    def test_conflicting_duplicate_fails_while_utilization_over_100_is_valid(self) -> None:
        first = row(utilization="102.120")
        conflict = row(runs="66.000", utilization="102.120")
        with self.assertRaisesRegex(CERResponseError, "conflicting duplicate"):
            CERClient(
                transport=FixtureTransport(
                    [CERHTTPResponse(200, {}, csv_payload([first, conflict]))]
                )
            ).fetch()

        result = CERClient(
            transport=FixtureTransport([CERHTTPResponse(200, {}, csv_payload([first]))])
        ).fetch()
        observations = normalize_cer_records(
            result.records,
            region_geography_ids=REGION_GEOGRAPHIES,
            retrieved_at=RETRIEVED_AT,
            runs_series_id="can.cer.refinery.crude_runs.weekly",
            utilization_series_id="can.cer.refinery.utilization.weekly",
        )
        self.assertEqual(observations.utilization[0].value, Decimal("102.120"))


class CERNormalizationTests(unittest.TestCase):
    def test_normalization_emits_only_source_runs_and_source_utilization(self) -> None:
        observations = normalize_cer_records(
            complete_week(),
            region_geography_ids=REGION_GEOGRAPHIES,
            retrieved_at=RETRIEVED_AT,
            runs_series_id="can.cer.refinery.crude_runs.weekly",
            utilization_series_id="can.cer.refinery.utilization.weekly",
        )

        self.assertEqual(len(observations.runs), 3)
        self.assertEqual(len(observations.utilization), 3)
        ontario_runs = observations.runs[0]
        self.assertEqual(ontario_runs.period, "2026-06-16")
        self.assertEqual(ontario_runs.geography_id, "ca.cer.ontario")
        self.assertEqual(ontario_runs.value, Decimal("65.570"))
        self.assertEqual(ontario_runs.unit, CER_RUNS_UNIT)
        self.assertEqual(ontario_runs.status, ObservationStatus.OBSERVED)
        self.assertEqual(ontario_runs.dimensions, (("measure", "crude_runs"),))
        self.assertEqual(ontario_runs.flags, ("source_published",))
        self.assertEqual(ontario_runs.original_value, "65.570")
        self.assertEqual(ontario_runs.original_unit, CER_SOURCE_RUNS_UNIT)

        ontario_utilization = observations.utilization[0]
        self.assertEqual(ontario_utilization.value, Decimal("95.700"))
        self.assertEqual(ontario_utilization.unit, CER_UTILIZATION_UNIT)
        self.assertEqual(
            ontario_utilization.dimensions, (("measure", "percent_of_capacity"),)
        )
        self.assertNotEqual(ontario_runs.series_id, ontario_utilization.series_id)

    def test_region_mapping_must_be_exact_nonempty_and_one_to_one(self) -> None:
        invalid_mappings = (
            {"Ontario": "ca.cer.ontario"},
            {**REGION_GEOGRAPHIES, "Canada": "ca"},
            {**REGION_GEOGRAPHIES, "Western Canada": "ca.cer.ontario"},
            {**REGION_GEOGRAPHIES, "Western Canada": ""},
        )
        for mapping in invalid_mappings:
            with self.subTest(mapping=mapping), self.assertRaises(ValueError):
                normalize_cer_records(
                    complete_week(),
                    region_geography_ids=mapping,
                    retrieved_at=RETRIEVED_AT,
                    runs_series_id="runs",
                    utilization_series_id="utilization",
                )

    def test_national_runs_rollup_has_complete_components_and_lineage(self) -> None:
        observations = normalize_cer_records(
            complete_week(),
            region_geography_ids=REGION_GEOGRAPHIES,
            retrieved_at=RETRIEVED_AT,
            runs_series_id="can.cer.refinery.crude_runs.weekly",
            utilization_series_id="can.cer.refinery.utilization.weekly",
        )
        result = roll_up_cer_national_runs(
            observations.runs,
            region_geography_ids=REGION_GEOGRAPHIES,
            national_geography_id="ca",
            membership_version="cer-regions-v1",
        )[0]

        self.assertEqual(result.observation.period, "2026-06-16")
        self.assertEqual(result.observation.geography_id, "ca")
        self.assertEqual(result.observation.value, Decimal("266.230"))
        self.assertEqual(result.observation.status, ObservationStatus.COMPUTED)
        self.assertEqual(
            dict(result.observation.components),
            {
                "ca.cer.ontario": Decimal("65.570"),
                "ca.cer.quebec_eastern": Decimal("103.440"),
                "ca.cer.western": Decimal("97.220"),
            },
        )
        self.assertEqual(
            result.observation.flags,
            ("derived_geography_rollup", "complete_three_region_sum"),
        )
        self.assertEqual(result.lineage.coverage, Decimal("1"))
        self.assertEqual(result.lineage.aggregation_rule, AggregationRule.SUM)
        self.assertEqual(result.lineage.membership_version, "cer-regions-v1")
        self.assertEqual(len(result.lineage.source_observation_keys), 3)

    def test_national_runs_rollup_rejects_incomplete_coverage_and_utilization(self) -> None:
        observations = normalize_cer_records(
            complete_week(),
            region_geography_ids=REGION_GEOGRAPHIES,
            retrieved_at=RETRIEVED_AT,
            runs_series_id="can.cer.refinery.crude_runs.weekly",
            utilization_series_id="can.cer.refinery.utilization.weekly",
        )
        with self.assertRaisesRegex(ValueError, "coverage failed"):
            roll_up_cer_national_runs(
                observations.runs[:-1],
                region_geography_ids=REGION_GEOGRAPHIES,
                national_geography_id="ca",
                membership_version="cer-regions-v1",
            )
        with self.assertRaisesRegex(ValueError, "crude-runs observations only"):
            roll_up_cer_national_runs(
                observations.utilization,
                region_geography_ids=REGION_GEOGRAPHIES,
                national_geography_id="ca",
                membership_version="cer-regions-v1",
            )


if __name__ == "__main__":
    unittest.main()

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
from energy_dashboard.cer import (
    CERHTTPResponse,
    CERResponseError,
    CERRetryPolicy,
    CERTransportError,
)
from energy_dashboard.cer_ngl import (
    CER_NGL_CSV_URL,
    CER_NGL_DATASET_ID,
    CER_NGL_DATASET_URL,
    CER_NGL_DESTINATIONS,
    CER_NGL_DICTIONARY_URL,
    CER_NGL_HEADERS,
    CER_NGL_ORIGINS,
    CERNGLClient,
    normalize_cer_ngl_records,
)
from energy_dashboard.contracts import Frequency, ObservationStatus
from energy_dashboard.forecasting import build_forecast_asset
from energy_dashboard.statcan_refresh import _reject_removed_overlap_rows
from energy_dashboard.storage import CanonicalSnapshot, merge_canonical


RETRIEVED_AT = datetime(2026, 9, 10, 12, 0, tzinfo=UTC)
ORIGIN_IDS = dict(zip(CER_NGL_ORIGINS, (
    "ca.ab", "ca.bc", "ca.mb", "ca.nb", "ca.nl", "ca.nt", "ca.ns", "ca.on",
    "ca.pe", "ca.qc", "ca.sk", "ca.yt", "ca",
), strict=True))


def source_row(
    *, period: str = "05/01/2026", product: str = "Propane", origin: str = "Total",
    destination: str = "Total", mode: str = "Total", value: str = "880994.764754",
) -> dict[str, str]:
    date = datetime.strptime(period, "%m/%d/%Y")
    return dict(zip(CER_NGL_HEADERS, (
        period, str(date.year), date.strftime("%B"), product, origin, destination,
        mode, value, str(Decimal(value) * Decimal("6.2898")), "100.000000",
        "73.000000", "12.000000", "33.000000",
    ), strict=True))


def csv_payload(
    records: list[dict[str, str]], headers: tuple[str, ...] = CER_NGL_HEADERS,
) -> bytes:
    output = io.StringIO(newline="")
    writer = csv.DictWriter(output, fieldnames=headers, lineterminator="\r\r\n")
    writer.writeheader()
    for record in records:
        writer.writerow({header: record.get(header, "") for header in headers})
    return output.getvalue().encode("cp1252")


def spec(
    *, product: str = "Propane", destination: str = "Total",
    geographies: tuple[str, ...] = tuple(ORIGIN_IDS.values()),
) -> RegistryCanadaSeries:
    return RegistryCanadaSeries(
        id=f"can.cer.{product.lower()}.exports.{destination.lower().replace(' ', '-')}.monthly",
        metric_id="exports", title="CER export reporting", description="Source export province",
        source_name="Canada Energy Regulator", source_url=CER_NGL_DATASET_URL,
        canonical_unit="cubic_metres", frequency=Frequency.MONTHLY,
        source_geography_ids=geographies,
        source_geography_level_ids=("province_territory", "national"),
        unsupported_levels=(), bootstrap_start="2016-01", dataset_id=CER_NGL_DATASET_ID,
        source_filters=(
            ("Product", product), ("Destination / PADD", destination),
            ("Mode of Transportation", "Total"),
        ),
    )


class FixtureTransport:
    def __init__(self, responses: list[CERHTTPResponse | Exception]) -> None:
        self.responses = list(responses)
        self.calls: list[tuple[str, float, int]] = []

    def __call__(self, url: str, timeout: float, maximum_bytes: int) -> CERHTTPResponse:
        self.calls.append((url, timeout, maximum_bytes))
        value = self.responses.pop(0)
        if isinstance(value, Exception):
            raise value
        return value


def fetch(records: list[dict[str, str]]):
    return CERNGLClient(transport=FixtureTransport([
        CERHTTPResponse(200, {}, csv_payload(records)),
    ])).fetch()


def normalize(records: list[dict[str, str]], definitions=None):
    return normalize_cer_ngl_records(
        records, specs=definitions or [spec()], origin_geography_ids=ORIGIN_IDS,
        retrieved_at=RETRIEVED_AT,
    )


class CERNGLClientTests(unittest.TestCase):
    def test_pinned_official_urls_and_checksum(self) -> None:
        self.assertEqual(CER_NGL_CSV_URL,
                         "https://www.cer-rec.gc.ca/open/imports-exports/"
                         "natural-gas-liquids-exports-monthly.csv")
        self.assertTrue(CER_NGL_DICTIONARY_URL.endswith("exports-data-dictionary.csv"))
        self.assertTrue(CER_NGL_DATASET_URL.endswith("8cb1d0d0-6ea7-4f6d-b01d-a38fafdcce77"))
        rows = [source_row(origin="Québec"), source_row()]
        payload = csv_payload(rows)
        result = CERNGLClient(transport=FixtureTransport([
            CERHTTPResponse(200, {}, payload),
        ])).fetch()
        self.assertEqual(result.payload_sha256, hashlib.sha256(payload).hexdigest())
        self.assertEqual(result.payload_bytes, len(payload))
        self.assertEqual(result.source_url, CER_NGL_CSV_URL)
        self.assertEqual(result.request_count, 1)
        self.assertEqual({row["Origin"] for row in result.records}, {"Québec", "Total"})

    def test_deduplicates_only_identical_full_source_identities(self) -> None:
        first = source_row()
        detail = source_row(mode="Railway")
        result = fetch([detail, first, first])
        self.assertEqual(len(result.records), 2)
        with self.assertRaisesRegex(CERResponseError, "conflicting duplicate"):
            fetch([first, source_row(value="1")])
        changed_price = {**first, "Price (CN cents/L)": "99"}
        with self.assertRaisesRegex(CERResponseError, "conflicting duplicate"):
            fetch([first, changed_price])

    def test_retry_after_is_bounded_and_network_failures_do_not_leak(self) -> None:
        transport = FixtureTransport([
            CERHTTPResponse(429, {"Retry-After": "999"}, b"private error"),
            CERHTTPResponse(200, {}, csv_payload([source_row()])),
        ])
        sleeps = []
        result = CERNGLClient(
            transport=transport, sleeper=sleeps.append,
            retry_policy=CERRetryPolicy((0.1,), maximum_retry_after_seconds=2),
        ).fetch()
        self.assertEqual(sleeps, [2])
        self.assertEqual(result.request_count, 2)
        secret = "do-not-log-server-details"
        with self.assertRaises(CERTransportError) as context:
            CERNGLClient(
                transport=FixtureTransport([OSError(secret), OSError(secret)]),
                sleeper=lambda _: None, retry_policy=CERRetryPolicy((0,)),
            ).fetch()
        self.assertNotIn(secret, str(context.exception))

    def test_retry_after_nan_falls_back_to_finite_delay(self) -> None:
        sleeps = []
        CERNGLClient(
            transport=FixtureTransport([
                CERHTTPResponse(503, {"retry-after": "NaN"}, b""),
                CERHTTPResponse(200, {}, csv_payload([source_row()])),
            ]), sleeper=sleeps.append, retry_policy=CERRetryPolicy((0.25,)),
        ).fetch()
        self.assertEqual(sleeps, [0.25])

    def test_permanent_errors_and_size_guard_fail_without_retry(self) -> None:
        transport = FixtureTransport([CERHTTPResponse(404, {}, b"private")])
        with self.assertRaisesRegex(CERResponseError, "HTTP 404") as context:
            CERNGLClient(transport=transport).fetch()
        self.assertEqual(len(transport.calls), 1)
        self.assertNotIn("private", str(context.exception))
        with self.assertRaisesRegex(CERResponseError, "size limit"):
            CERNGLClient(transport=FixtureTransport([
                CERHTTPResponse(200, {}, b"12345"),
            ]), maximum_response_bytes=4).fetch()

    def test_headers_encoding_and_row_width_are_strict(self) -> None:
        wrong_header = tuple("Volume (m3/d)" if key == "Volume (m3)" else key
                             for key in CER_NGL_HEADERS)
        payloads = (
            csv_payload([source_row()], wrong_header),
            csv_payload([source_row()]) + b"extra,columns\n",
            csv_payload([source_row()]) + b"\x00",
            csv_payload([source_row()]) + b"\x81",
            csv_payload([]),
        )
        for payload in payloads:
            with self.subTest(payload=payload[-20:]), self.assertRaises(CERResponseError):
                CERNGLClient(transport=FixtureTransport([
                    CERHTTPResponse(200, {}, payload),
                ])).fetch()

    def test_all_rows_validate_even_outside_active_product_or_mode(self) -> None:
        invalid = (
            {**source_row(), "Product": "Ethane"},
            {**source_row(), "Origin": "Alberta (new)"},
            {**source_row(), "Destination / PADD": "PADD VI"},
            {**source_row(), "Mode of Transportation": "Rail"},
            {**source_row(), "Period": "05/02/2026"},
            {**source_row(), "Year": "2025"},
            {**source_row(), "Month": "June"},
            {**source_row(product="Butane", mode="Truck"), "Value (US$)": "NaN"},
            {**source_row(), "Volume (m3)": "Confidential"},
        )
        for row in invalid:
            with self.subTest(row=row), self.assertRaises(CERResponseError):
                fetch([source_row(), row])

    def test_only_four_reviewed_blank_destination_identities_are_accepted(self) -> None:
        reviewed = [source_row(period="03/01/2022", origin=origin,
                               destination="", mode=mode, value="3105.000000")
                    for origin in ("Alberta", "Total") for mode in ("Railway", "Total")]
        self.assertEqual(len(fetch(reviewed).records), 4)
        self.assertEqual(normalize(reviewed + [source_row()])[0].period, "2026-05")
        for row in (
            source_row(destination=""),
            source_row(period="03/01/2022", origin="Ontario", destination=""),
            source_row(period="03/01/2022", product="Butane", destination=""),
        ):
            with self.assertRaisesRegex(CERResponseError, "unknown first export destination"):
                fetch([row])

    def test_negative_historical_corrections_are_not_coerced_to_zero(self) -> None:
        row = source_row(period="03/01/1999", origin="Ontario", destination="PADD IV",
                         mode="Truck", value="-55.000000")
        self.assertEqual(fetch([row]).records[0]["Volume (m3)"], "-55.000000")


class CERNGLNormalizationTests(unittest.TestCase):
    def test_exact_published_totals_never_added_to_detail(self) -> None:
        records = [
            source_row(value="880994.764754"),
            source_row(origin="Alberta", value="225079.608754"),
            source_row(origin="Alberta", destination="PADD II", value="100.123456"),
            source_row(origin="Alberta", destination="PADD II", mode="Railway", value="99"),
        ]
        result = normalize(records, [spec(), spec(destination="PADD II")])
        self.assertEqual(len(result), 3)
        national = next(row for row in result if row.geography_id == "ca")
        self.assertEqual(national.value, Decimal("880994.764754"))
        self.assertEqual(national.unit, "cubic_metres")
        self.assertEqual(national.original_value, "880994.764754")
        self.assertEqual(national.original_unit, "m3")
        self.assertEqual(national.components, ())
        self.assertEqual(national.flags, ("source_published",))
        self.assertIsNone(national.source_released_at)
        padd = next(row for row in result if dict(row.dimensions)["destination_padd"] == "PADD II")
        self.assertEqual(padd.value, Decimal("100.123456"))
        self.assertEqual(dict(padd.dimensions), {
            "dataset_id": CER_NGL_DATASET_ID, "destination_padd": "PADD II",
            "export_origin": "Alberta", "mode_of_transport": "Total", "product": "Propane",
        })

    def test_every_registered_destination_uses_its_own_identity(self) -> None:
        rows = [source_row(destination=destination, value=str(index))
                for index, destination in enumerate(CER_NGL_DESTINATIONS)]
        result = normalize(rows, [spec(destination=destination)
                                  for destination in CER_NGL_DESTINATIONS])
        self.assertEqual(len(result), 7)
        self.assertEqual(len({row.key for row in result}), 7)
        self.assertEqual({dict(row.dimensions)["destination_padd"] for row in result},
                         set(CER_NGL_DESTINATIONS))

    def test_absent_latest_row_marks_missing_without_stale_filling(self) -> None:
        result = normalize([
            source_row(period="04/01/2026", origin="Québec", value="25"),
            source_row(),
            source_row(origin="Alberta", value="0"),
        ])
        quebec = [row for row in result if row.geography_id == "ca.qc"]
        self.assertEqual([row.period for row in quebec], ["2026-04", "2026-05"])
        self.assertEqual(quebec[0].value, Decimal("25"))
        self.assertIsNone(quebec[1].value)
        self.assertEqual(quebec[1].status, ObservationStatus.MISSING)
        self.assertIn("no_source_fact", quebec[1].flags)
        self.assertNotIn("source_published", quebec[1].flags)
        self.assertIsNone(quebec[1].original_value)
        zero = next(row for row in result if row.geography_id == "ca.ab")
        self.assertEqual(zero.value, Decimal("0"))
        self.assertEqual(zero.status, ObservationStatus.OBSERVED)
        self.assertFalse(any(row.geography_id == "ca.nt" for row in result))

    def test_latest_file_month_not_stale_product_month_drives_missing_marker(self) -> None:
        result = normalize([
            source_row(product="Butane", period="04/01/2026", value="7"),
            source_row(product="Propane", period="05/01/2026", value="8"),
        ], [spec(product="Butane")])
        self.assertEqual(result[-1].period, "2026-05")
        self.assertEqual(result[-1].status, ObservationStatus.MISSING)

    def test_latest_absence_marker_blocks_forecasting_from_older_exports(self) -> None:
        result = normalize([
            source_row(period="04/01/2026", origin="Québec", value="25"),
            source_row(),
        ])
        quebec = tuple(row for row in result if row.geography_id == "ca.qc")
        forecast = build_forecast_asset(
            quebec, frequency=Frequency.MONTHLY, generated_at=RETRIEVED_AT,
            source_checksum="1" * 64, target_view_id=quebec[0].series_id,
        )
        self.assertEqual(forecast["status"], "latest_source_non_numeric")
        self.assertEqual(forecast["points"], [])

    def test_new_release_retains_prior_absence_markers_without_calendar_imputation(self) -> None:
        first_records = [
            source_row(period="04/01/2026", origin="Québec", value="25"), source_row(),
        ]
        first = normalize(first_records)
        second = normalize_cer_ngl_records(
            first_records + [source_row(period="06/01/2026")], specs=[spec()],
            origin_geography_ids=ORIGIN_IDS, retrieved_at=RETRIEVED_AT,
            previous_observations=first,
        )
        quebec = [row for row in second if row.geography_id == "ca.qc"]
        self.assertEqual([row.period for row in quebec], ["2026-04", "2026-05", "2026-06"])
        self.assertEqual([row.status for row in quebec], [ObservationStatus.OBSERVED,
                         ObservationStatus.MISSING, ObservationStatus.MISSING])
        _reject_removed_overlap_rows(CanonicalSnapshot(first), spec().id, second, None, None)
        self.assertFalse(any(row.period == "2026-03" for row in second))
        unchanged = normalize_cer_ngl_records(
            first_records, specs=[spec()], origin_geography_ids=ORIGIN_IDS,
            retrieved_at=RETRIEVED_AT, previous_observations=first,
        )
        self.assertEqual(unchanged, first)

    def test_late_numeric_fact_revises_absence_instead_of_being_overridden(self) -> None:
        first_records = [
            source_row(period="04/01/2026", origin="Québec", value="25"), source_row(),
        ]
        first = normalize(first_records)
        second = normalize_cer_ngl_records(
            first_records + [source_row(origin="Québec", value="27.5")], specs=[spec()],
            origin_geography_ids=ORIGIN_IDS, retrieved_at=RETRIEVED_AT,
            previous_observations=first,
        )
        latest_quebec = next(row for row in second
                             if row.geography_id == "ca.qc" and row.period == "2026-05")
        self.assertEqual(latest_quebec.value, Decimal("27.5"))
        self.assertEqual(latest_quebec.flags, ("source_published",))
        _reject_removed_overlap_rows(CanonicalSnapshot(first), spec().id, second, None, None)
        merged = merge_canonical(CanonicalSnapshot(first), second, detected_at=RETRIEVED_AT)
        self.assertEqual(len(merged.revised_keys), 1)
        self.assertEqual(merged.snapshot.revisions[0].old_status, ObservationStatus.MISSING)
        self.assertEqual(merged.snapshot.revisions[0].new_status, ObservationStatus.OBSERVED)

    def test_prior_numeric_rows_are_not_stale_retained_when_provider_deletes_them(self) -> None:
        first = normalize([
            source_row(period="04/01/2026", origin="Québec", value="25"), source_row(),
        ])
        second = normalize_cer_ngl_records(
            [source_row(), source_row(period="06/01/2026")], specs=[spec()],
            origin_geography_ids=ORIGIN_IDS, retrieved_at=RETRIEVED_AT,
            previous_observations=first,
        )
        self.assertFalse(any(row.geography_id == "ca.qc" and row.value is not None for row in second))
        with self.assertRaisesRegex(ValueError, "removed 1 existing overlap"):
            _reject_removed_overlap_rows(CanonicalSnapshot(first), spec().id, second, None, None)

    def test_previous_absence_marker_requires_exact_compatible_identity(self) -> None:
        first_records = [
            source_row(period="04/01/2026", origin="Québec", value="25"), source_row(),
        ]
        missing = next(row for row in normalize(first_records) if row.status is ObservationStatus.MISSING)
        for corrupt in (
            replace(missing, unit="barrels"),
            replace(missing, dimensions=(("product", "Butane"),)),
            replace(missing, flags=("no_source_fact",)),
        ):
            with self.assertRaisesRegex(ValueError, "previous absence marker"):
                normalize_cer_ngl_records(
                    first_records, specs=[spec()], origin_geography_ids=ORIGIN_IDS,
                    retrieved_at=RETRIEVED_AT, previous_observations=[corrupt],
                )

    def test_bootstrap_window_excludes_old_only_origins_without_inference(self) -> None:
        result = normalize([
            source_row(period="12/01/2015", origin="Newfoundland and Labrador", value="7"),
            source_row(period="01/01/2016", origin="Québec", value="8"),
            source_row(),
        ])
        self.assertFalse(any(row.geography_id == "ca.nl" for row in result))
        self.assertEqual(min(row.period for row in result), "2016-01")
        quebec = [row for row in result if row.geography_id == "ca.qc"]
        self.assertEqual(len(quebec), 2)

    def test_origin_mapping_and_registered_geography_availability_are_fail_closed(self) -> None:
        mappings = (
            {**ORIGIN_IDS, "Canada": "ca.new"},
            {key: value for key, value in ORIGIN_IDS.items() if key != "Total"},
            {**ORIGIN_IDS, "Total": ORIGIN_IDS["Alberta"]},
        )
        for mapping in mappings:
            with self.assertRaises(ValueError):
                normalize_cer_ngl_records([source_row()], specs=[spec()],
                                         origin_geography_ids=mapping, retrieved_at=RETRIEVED_AT)
        with self.assertRaisesRegex(CERResponseError, "unregistered export geography"):
            normalize([source_row(origin="Québec")], [spec(geographies=("ca",))])

    def test_registry_dimension_frequency_and_unit_mismatches_are_rejected(self) -> None:
        first = spec()
        invalid = (
            replace(first, dataset_id="some_other_dataset"),
            replace(first, canonical_unit="barrels"),
            replace(first, frequency=Frequency.WEEKLY),
            replace(first, bootstrap_start="2016-13"),
            replace(first, source_geography_ids=("ca.invalid",)),
            replace(first, source_filters=(("Product", "Propane"),)),
            replace(first, source_filters=first.source_filters + (("Product", "Propane"),)),
            replace(first, source_filters=(
                ("Product", "Propane"), ("Destination / PADD", "Total"),
                ("Mode of Transportation", "Railway"),
            )),
        )
        for definition in invalid:
            with self.subTest(definition=definition), self.assertRaises(ValueError):
                normalize([source_row()], [definition])
        with self.assertRaisesRegex(ValueError, "duplicate the same source view"):
            normalize([source_row()], [first, replace(first, id="duplicate")])

    def test_future_month_and_naive_retrieval_are_rejected(self) -> None:
        with self.assertRaisesRegex(CERResponseError, "later than retrieval"):
            normalize([source_row(period="10/01/2026")])
        with self.assertRaisesRegex(ValueError, "timezone-aware"):
            normalize_cer_ngl_records([source_row()], specs=[spec()],
                                     origin_geography_ids=ORIGIN_IDS,
                                     retrieved_at=RETRIEVED_AT.replace(tzinfo=None))


if __name__ == "__main__":
    unittest.main()

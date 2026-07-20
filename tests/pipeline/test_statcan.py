from __future__ import annotations

import csv
import io
import json
import sys
import unittest
import zipfile
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import patch

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "pipeline"))

from energy_dashboard.contracts import Frequency, ObservationStatus
from energy_dashboard.registry import load_provider_geographies
from energy_dashboard.statcan import StatCanClient, StatCanTableSpec
from energy_dashboard.statcan_registry import (
    RegistryStatCanSeries,
    load_statcan_registry,
    normalize_statcan_records,
)


HEADERS = (
    "REF_DATE", "GEO", "DGUID", "Measure", "Product", "UOM", "UOM_ID",
    "SCALAR_FACTOR", "SCALAR_ID", "VECTOR", "COORDINATE", "VALUE", "STATUS",
    "SYMBOL", "TERMINATED",
)


class FakeResponse:
    def __init__(self, payload: bytes) -> None:
        self.payload = io.BytesIO(payload)
        self.headers = {"Content-Length": str(len(payload))}

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *_args: object) -> None:
        return None

    def read(self, size: int = -1) -> bytes:
        return self.payload.read(size)


def table_spec() -> StatCanTableSpec:
    return StatCanTableSpec(
        pid="25100081",
        wds_url=(
            "https://www150.statcan.gc.ca/t1/wds/rest/"
            "getFullTableDownloadCSV/25100081/en"
        ),
        csv_member="25100081.csv",
        metadata_member="25100081_MetaData.csv",
        required_headers=HEADERS,
    )


def archive(rows: list[dict[str, str]], headers: tuple[str, ...] = HEADERS) -> bytes:
    csv_text = io.StringIO(newline="")
    writer = csv.DictWriter(
        csv_text, fieldnames=headers, lineterminator="\n", extrasaction="ignore"
    )
    writer.writeheader()
    writer.writerows(rows)
    output = io.BytesIO()
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as zipped:
        zipped.writestr("25100081.csv", csv_text.getvalue().encode())
        zipped.writestr("25100081_MetaData.csv", b"metadata\n")
    return output.getvalue()


def record(
    period: str,
    *,
    geography: str = "Canada",
    dguid: str = "2021A000011124",
    value: str = "12",
    status: str = "",
) -> dict[str, str]:
    values = (
        period, geography, dguid, "Production", "Gasoline", "Cubic metres", "72",
        "units", "0", "v1", "1.1.1", value, status, "", "",
    )
    return dict(zip(HEADERS, values, strict=True))


def registry_series(*, geography_ids: tuple[str, ...] = ("ca",)) -> RegistryStatCanSeries:
    return RegistryStatCanSeries(
        id="can.statcan.test.monthly",
        metric_id="test_production",
        title="Test production",
        description="",
        source_name="Statistics Canada",
        source_url="https://www150.statcan.gc.ca/t1/tbl1/en/",
        canonical_unit="cubic_metres",
        frequency=Frequency.MONTHLY,
        table=table_spec(),
        row_filters=(("Measure", "Production"), ("Product", "Gasoline")),
        expected_fields=(
            ("SCALAR_FACTOR", "units"), ("SCALAR_ID", "0"),
            ("UOM", "Cubic metres"), ("UOM_ID", "72"),
        ),
        source_geography_ids=geography_ids,
        source_geography_level_ids=("province_territory", "national"),
        unsupported_levels=(),
        bootstrap_start="2019-01",
    )


class StatCanClientTests(unittest.TestCase):
    def test_fetch_validates_wds_url_zip_members_header_and_hashes(self) -> None:
        wds = json.dumps(
            {
                "status": "SUCCESS",
                "object": "https://www150.statcan.gc.ca/n1/tbl/csv/25100081-eng.zip",
            }
        ).encode()
        zipped = archive([record("2026-04")])
        with patch(
            "energy_dashboard.statcan.urllib.request.urlopen",
            side_effect=[FakeResponse(wds), FakeResponse(zipped)],
        ):
            result = StatCanClient().fetch(table_spec())
        self.assertEqual(result.pid, "25100081")
        self.assertEqual(result.request_count, 2)
        self.assertEqual(len(result.records), 1)
        self.assertEqual(len(result.archive_sha256), 64)
        self.assertEqual(len(result.csv_sha256), 64)

    def test_unapproved_download_url_and_header_drift_fail_closed(self) -> None:
        hostile = json.dumps(
            {"status": "SUCCESS", "object": "https://example.com/25100081-eng.zip"}
        ).encode()
        with patch(
            "energy_dashboard.statcan.urllib.request.urlopen",
            return_value=FakeResponse(hostile),
        ), self.assertRaisesRegex(ValueError, "unapproved"):
            StatCanClient().fetch(table_spec())

        wds = json.dumps(
            {
                "status": "SUCCESS",
                "object": "https://www150.statcan.gc.ca/n1/tbl/csv/25100081-eng.zip",
            }
        ).encode()
        drifted = archive([record("2026-04")], headers=HEADERS[:-1])
        with patch(
            "energy_dashboard.statcan.urllib.request.urlopen",
            side_effect=[FakeResponse(wds), FakeResponse(drifted)],
        ), self.assertRaisesRegex(ValueError, "header drifted"):
            StatCanClient().fetch(table_spec())


class StatCanRegistryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.geographies = load_provider_geographies(
            PROJECT_ROOT / "config/geographies/canada.json",
            provider_id="statcan",
            provider_code_field="statcan_dguid",
        )

    def test_active_registry_has_both_verified_tables_and_carries_classification(self) -> None:
        specs = load_statcan_registry(PROJECT_ROOT / "config/series/canada.json")
        self.assertEqual(len(specs), 49)
        self.assertEqual({spec.table.pid for spec in specs}, {"25100063", "25100081"})
        self.assertTrue(all(spec.display is not None for spec in specs))

        by_id = {spec.id: spec for spec in specs}
        crude_detail_ids = {
            "can.statcan.crude.production.net_field.monthly",
            "can.statcan.crude.production.light_medium.monthly",
            "can.statcan.crude.production.heavy.monthly",
            "can.statcan.crude.production.non_upgraded_bitumen.monthly",
            "can.statcan.crude.production.in_situ_bitumen.monthly",
            "can.statcan.crude.production.mined_bitumen.monthly",
            "can.statcan.crude.production.bitumen_sent_for_processing.monthly",
            "can.statcan.crude.production.synthetic.monthly",
            "can.statcan.crude.equivalent.production.monthly",
            "can.statcan.crude.equivalent.condensate.monthly",
            "can.statcan.crude.equivalent.pentanes_plus.monthly",
            "can.statcan.crude.refinery_inputs.light_medium.monthly",
            "can.statcan.crude.refinery_inputs.heavy.monthly",
            "can.statcan.crude.refinery_inputs.bitumen.monthly",
            "can.statcan.crude.refinery_inputs.synthetic.monthly",
        }
        self.assertTrue(crude_detail_ids.issubset(by_id))
        self.assertTrue(
            all(
                by_id[series_id].table.pid == "25100063"
                and by_id[series_id].canonical_unit == "cubic_metres"
                and by_id[series_id].frequency is Frequency.MONTHLY
                for series_id in crude_detail_ids
            )
        )
        self.assertEqual(
            dict(by_id["can.statcan.crude.production.light_medium.monthly"].row_filters),
            {
                "Supply and disposition": "Light and medium crude oil",
                "Units of measure": "Cubic metres",
            },
        )
        self.assertEqual(
            by_id["can.statcan.crude.production.heavy.monthly"].source_geography_ids,
            ("ca", "ca.ab", "ca.sk"),
        )
        self.assertEqual(
            by_id[
                "can.statcan.crude.production.bitumen_sent_for_processing.monthly"
            ].display.component_role,
            "subtraction",
        )
        self.assertEqual(
            by_id[
                "can.statcan.crude.production.non_upgraded_bitumen.monthly"
            ].display.parent_product_id,
            "net-field-crude-oil",
        )
        self.assertEqual(
            by_id[
                "can.statcan.crude.production.in_situ_bitumen.monthly"
            ].display.parent_product_id,
            "non-upgraded-crude-bitumen",
        )
        self.assertEqual(
            by_id["can.statcan.crude.equivalent.production.monthly"].display.parent_product_id,
            None,
        )
        self.assertEqual(
            by_id[
                "can.statcan.crude.refinery_inputs.bitumen.monthly"
            ].source_geography_ids,
            ("ca", "ca.statcan.atlantic", "ca.ab", "ca.nb", "ca.on", "ca.qc"),
        )
        self.assertNotIn(
            "can.statcan.crude.refinery_inputs.condensate_pentanes.monthly",
            by_id,
        )

    def test_statuses_are_distinct_and_raw_codes_are_preserved(self) -> None:
        rows = (
            record("2026-01", value="10"),
            record("2026-02", value="", status="x"),
            record("2026-03", value="", status=".."),
            record("2026-04", value="11", status="p"),
            record("2026-05", value="12", status="E"),
        )
        normalized = normalize_statcan_records(
            registry_series(), rows, self.geographies,
            retrieved_at=datetime(2026, 7, 19, tzinfo=UTC),
        )
        self.assertEqual(
            [row.status for row in normalized],
            [
                ObservationStatus.OBSERVED,
                ObservationStatus.SUPPRESSED_OR_WITHHELD,
                ObservationStatus.NOT_AVAILABLE,
                ObservationStatus.PRELIMINARY,
                ObservationStatus.USE_WITH_CAUTION,
            ],
        )
        self.assertIn("statcan_status:x", normalized[1].flags)
        self.assertIsNone(normalized[1].value)

    def test_unknown_status_geography_and_coordinate_drift_fail_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "unreviewed status"):
            normalize_statcan_records(
                registry_series(), (record("2026-01", value="1", status="Z"),),
                self.geographies, retrieved_at=datetime(2026, 7, 19, tzinfo=UTC),
            )
        with self.assertRaisesRegex(ValueError, "Unverified"):
            normalize_statcan_records(
                registry_series(), (record("2026-01", dguid="FAKE"),),
                self.geographies, retrieved_at=datetime(2026, 7, 19, tzinfo=UTC),
            )
        drifted = record("2026-02")
        drifted["VECTOR"] = "v2"
        with self.assertRaisesRegex(ValueError, "vector identity drifted"):
            normalize_statcan_records(
                registry_series(), (record("2026-01"), drifted),
                self.geographies, retrieved_at=datetime(2026, 7, 19, tzinfo=UTC),
            )


if __name__ == "__main__":
    unittest.main()

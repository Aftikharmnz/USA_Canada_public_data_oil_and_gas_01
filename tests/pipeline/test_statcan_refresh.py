from __future__ import annotations

import json
import shutil
import sys
import unittest
import uuid
from dataclasses import replace
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "pipeline"))

from energy_dashboard.canada_registry import RegistryCanadaSeries
from energy_dashboard.contracts import Frequency, Observation, ObservationStatus
from energy_dashboard.forecasting import PUBLIC_ASSET_BUILD_ID
from energy_dashboard.promotion import verify_public_generation
from energy_dashboard.registry import load_provider_geographies
from energy_dashboard.statcan import StatCanFetchResult, StatCanTableSpec
from energy_dashboard.statcan_refresh import AdditionalCanadaBatch, run_statcan_refresh
from energy_dashboard.refresh import PeriodWindow
from energy_dashboard.statcan_registry import RegistryStatCanSeries
from energy_dashboard.storage import SnapshotStore


HEADERS = (
    "REF_DATE", "GEO", "DGUID", "Measure", "Product", "UOM", "UOM_ID",
    "SCALAR_FACTOR", "SCALAR_ID", "VECTOR", "COORDINATE", "VALUE", "STATUS",
    "SYMBOL", "TERMINATED",
)


def table() -> StatCanTableSpec:
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


def spec() -> RegistryStatCanSeries:
    return RegistryStatCanSeries(
        id="can.statcan.test.monthly",
        metric_id="test_stocks",
        title="Test stocks",
        description="Test",
        source_name="Statistics Canada",
        source_url="https://www150.statcan.gc.ca/t1/tbl1/en/",
        canonical_unit="cubic_metres",
        frequency=Frequency.MONTHLY,
        table=table(),
        row_filters=(("Measure", "Stocks"), ("Product", "Gasoline")),
        expected_fields=(
            ("SCALAR_FACTOR", "units"), ("SCALAR_ID", "0"),
            ("UOM", "Cubic metres"), ("UOM_ID", "72"),
        ),
        source_geography_ids=("ca", "ca.ab"),
        source_geography_level_ids=("province_territory", "national"),
        unsupported_levels=(("city", "No city data."),),
        bootstrap_start="2019-01",
    )


def record(period: str, geography_id: str) -> dict[str, str]:
    is_canada = geography_id == "ca"
    return {
        "REF_DATE": period,
        "GEO": "Canada" if is_canada else "Alberta",
        "DGUID": "2021A000011124" if is_canada else "2021A000248",
        "Measure": "Stocks",
        "Product": "Gasoline",
        "UOM": "Cubic metres",
        "UOM_ID": "72",
        "SCALAR_FACTOR": "units",
        "SCALAR_ID": "0",
        "VECTOR": "v-ca" if is_canada else "v-ab",
        "COORDINATE": "1.1.1" if is_canada else "2.1.1",
        "VALUE": str(100 + int(period[-2:])) if is_canada else "",
        "STATUS": "" if is_canada else "x",
        "SYMBOL": "",
        "TERMINATED": "",
    }


class FakeClient:
    def __init__(self, records: tuple[dict[str, str], ...]) -> None:
        self.records = records
        self.calls = 0

    def fetch(self, table_spec: StatCanTableSpec) -> StatCanFetchResult:
        self.calls += 1
        return StatCanFetchResult(
            pid=table_spec.pid,
            download_url="https://www150.statcan.gc.ca/n1/tbl/csv/25100081-eng.zip",
            records=self.records,
            archive_sha256="a" * 64,
            csv_sha256="b" * 64,
            archive_bytes=100,
            csv_bytes=1000,
            request_count=2,
        )


class StatCanRefreshTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.geographies = load_provider_geographies(
            PROJECT_ROOT / "config/geographies/canada.json",
            provider_id="statcan",
            provider_code_field="statcan_dguid",
        )

    def directory(self) -> Path:
        path = Path(__file__).parent / f"_runtime_{uuid.uuid4().hex}"
        path.mkdir()
        self.addCleanup(shutil.rmtree, path, True)
        return path

    def test_refresh_is_fresh_preserves_suppression_and_skips_unchanged(self) -> None:
        row_list = [
            record(f"{year}-{month:02d}", geography)
            for year in (2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026)
            for month in range(1, 13)
            for geography in ("ca", "ca.ab")
        ]
        latest_source = next(
            row
            for row in row_list
            if row["REF_DATE"] == "2026-12" and row["GEO"] == "Canada"
        )
        latest_source["VALUE"] = ""
        latest_source["STATUS"] = "x"
        rows = tuple(row_list)
        store = SnapshotStore(self.directory())
        first = run_statcan_refresh(
            (spec(),), self.geographies, FakeClient(rows), store,
            run_id="canada-001", generated_at=datetime(2026, 7, 19, tzinfo=UTC),
            period_windows={spec().id: PeriodWindow(expected_period="2026-12")},
        )
        self.assertTrue(first.changed)
        manifest = verify_public_generation(first.generation_path / "public")
        self.assertEqual(manifest["series"][0]["freshness"]["status"], "fresh")
        self.assertEqual(manifest["series"][0]["freshness"]["latest_period"], "2026-12")
        geographies = {item["geography_id"]: item for item in manifest["series"][0]["geographies"]}
        self.assertEqual(geographies["ca"]["status"], "available")
        self.assertEqual(geographies["ca.ab"]["status"], "unavailable")
        self.assertNotIn("asset_path", geographies["ca.ab"])
        asset = json.loads(
            (first.generation_path / "public" / geographies["ca"]["asset_path"]).read_text(
                encoding="utf-8"
            )
        )
        self.assertEqual(asset["freshness"]["latest_numeric_period"], "2026-11")
        self.assertEqual(asset["freshness"]["latest_observation_status"], "suppressed_or_withheld")
        self.assertEqual(
            asset["latest_source"],
            {"period": "2026-12", "status": "suppressed_or_withheld", "value": None},
        )

        second = run_statcan_refresh(
            (spec(),), self.geographies, FakeClient(rows), store,
            run_id="canada-002", generated_at=datetime(2026, 7, 20, tzinfo=UTC),
            period_windows={spec().id: PeriodWindow(expected_period="2026-12")},
        )
        self.assertFalse(second.changed)
        self.assertEqual(second.run_id, "canada-001")
        self.assertFalse((store.generations / "canada-002").exists())

    def test_failed_status_validation_keeps_last_known_good(self) -> None:
        valid = tuple(
            record(f"2025-{month:02d}", geography)
            for month in range(1, 13)
            for geography in ("ca", "ca.ab")
        )
        store = SnapshotStore(self.directory())
        run_statcan_refresh(
            (spec(),), self.geographies, FakeClient(valid), store,
            run_id="canada-001", generated_at=datetime(2026, 7, 19, tzinfo=UTC),
        )
        invalid = [dict(row) for row in valid]
        invalid[0]["STATUS"] = "Z"
        with self.assertRaisesRegex(ValueError, "unreviewed status"):
            run_statcan_refresh(
                (spec(),), self.geographies, FakeClient(tuple(invalid)), store,
                run_id="canada-002", generated_at=datetime(2026, 7, 20, tzinfo=UTC),
            )
        self.assertEqual(store.current_run_id(), "canada-001")

    def test_unchanged_values_rebuild_when_asset_methodology_changes(self) -> None:
        rows = tuple(
            record(f"{year}-{month:02d}", geography)
            for year in range(2019, 2027)
            for month in range(1, 13)
            for geography in ("ca", "ca.ab")
        )
        store = SnapshotStore(self.directory())
        first = run_statcan_refresh(
            (spec(),), self.geographies, FakeClient(rows), store,
            run_id="canada-001", generated_at=datetime(2026, 7, 19, tzinfo=UTC),
        )
        manifest = json.loads(first.public_manifest_path.read_text(encoding="utf-8"))
        manifest["asset_build_id"] = "legacy-build"
        first.public_manifest_path.write_text(json.dumps(manifest), encoding="utf-8")

        rebuilt = run_statcan_refresh(
            (spec(),), self.geographies, FakeClient(rows), store,
            run_id="canada-002", generated_at=datetime(2026, 7, 20, tzinfo=UTC),
        )

        self.assertTrue(rebuilt.changed)
        self.assertEqual(rebuilt.run_id, "canada-002")
        rebuilt_manifest = json.loads(rebuilt.public_manifest_path.read_text(encoding="utf-8"))
        self.assertEqual(rebuilt_manifest["asset_build_id"], PUBLIC_ASSET_BUILD_ID)

    def test_manifest_cannot_silently_drop_a_new_active_series(self) -> None:
        rows = tuple(
            record(f"2025-{month:02d}", geography)
            for month in range(1, 13)
            for geography in ("ca", "ca.ab")
        )
        store = SnapshotStore(self.directory())
        initial = run_statcan_refresh(
            (spec(),), self.geographies, FakeClient(rows), store,
            run_id="canada-001", generated_at=datetime(2026, 7, 19, tzinfo=UTC),
        )
        initial_manifest = json.loads(initial.public_manifest_path.read_text(encoding="utf-8"))
        self.assertEqual(initial_manifest["series"][0]["freshness"]["status"], "unknown")
        missing = replace(spec(), id="can.statcan.new.monthly")
        with self.assertRaisesRegex(ValueError, "cannot drop active"):
            run_statcan_refresh(
                (spec(),), self.geographies, FakeClient(rows), store,
                run_id="canada-002", generated_at=datetime(2026, 7, 20, tzinfo=UTC),
                manifest_series_specs=(spec(), missing),
            )
        self.assertEqual(store.current_run_id(), "canada-001")

    def test_one_atomic_manifest_carries_statcan_and_cer_computed_rollup(self) -> None:
        rows = tuple(
            record(f"2025-{month:02d}", geography)
            for month in range(1, 13)
            for geography in ("ca", "ca.ab")
        )
        cer_spec = RegistryCanadaSeries(
            id="can.cer.test.runs.weekly",
            metric_id="refinery_crude_runs",
            title="CER runs",
            description="",
            source_name="Canada Energy Regulator",
            source_url="https://open.canada.ca/data/en/dataset/test",
            canonical_unit="thousand_cubic_metres_per_day",
            frequency=Frequency.WEEKLY,
            source_geography_ids=("ca.cer.ontario", "ca"),
            source_geography_level_ids=("source_region", "national"),
            unsupported_levels=(("city", "No city data."),),
            bootstrap_start="2014-01-01",
        )
        cer_rows = (
            Observation(
                provider_id="cer", series_id=cer_spec.id, period="2026-06-09",
                geography_id="ca.cer.ontario", value=Decimal("10"),
                unit=cer_spec.canonical_unit, retrieved_at=datetime(2026, 7, 19, tzinfo=UTC),
                dimensions=(("measure", "crude_runs"),),
            ),
            Observation(
                provider_id="cer", series_id=cer_spec.id, period="2026-06-09",
                geography_id="ca", value=Decimal("30"), unit=cer_spec.canonical_unit,
                retrieved_at=datetime(2026, 7, 19, tzinfo=UTC),
                status=ObservationStatus.COMPUTED,
                dimensions=(("measure", "crude_runs"),),
                components=(("ca.cer.ontario", Decimal("10")),),
            ),
        )
        batch = AdditionalCanadaBatch(
            spec=cer_spec,
            observations=cer_rows,
            payload_hash="c" * 64,
            source_summary={"series_id": cer_spec.id, "rows": 2},
            aggregation_lineage_by_geography={
                "ca": {
                    "aggregation_kind": "sum",
                    "coverage_ratio": 1,
                    "expected_component_count": 1,
                    "observed_component_count": 1,
                }
            },
        )
        store = SnapshotStore(self.directory())
        result = run_statcan_refresh(
            (spec(),), self.geographies, FakeClient(rows), store,
            run_id="canada-combined", generated_at=datetime(2026, 7, 19, tzinfo=UTC),
            additional_batches=(batch,), additional_manifest_series_specs=(cer_spec,),
        )
        manifest = verify_public_generation(result.generation_path / "public")
        self.assertEqual({item["series_id"] for item in manifest["series"]}, {spec().id, cer_spec.id})
        cer_manifest = next(item for item in manifest["series"] if item["series_id"] == cer_spec.id)
        national = next(item for item in cer_manifest["geographies"] if item["geography_id"] == "ca")
        self.assertEqual(national["origin"], "computed-rollup")
        asset = json.loads(
            (result.generation_path / "public" / national["asset_path"]).read_text(encoding="utf-8")
        )
        self.assertEqual(asset["aggregation_lineage"]["aggregation_kind"], "sum")

    def test_cross_run_coordinate_replacement_and_row_removal_preserve_lkg(self) -> None:
        rows = tuple(
            record(f"2025-{month:02d}", geography)
            for month in range(1, 13)
            for geography in ("ca", "ca.ab")
        )
        store = SnapshotStore(self.directory())
        run_statcan_refresh(
            (spec(),), self.geographies, FakeClient(rows), store,
            run_id="canada-001", generated_at=datetime(2026, 7, 19, tzinfo=UTC),
        )

        replaced = [dict(row) for row in rows]
        for row in replaced:
            row["VECTOR"] = f"replacement-{row['GEO']}"
            row["COORDINATE"] = f"replacement-{row['GEO']}"
        with self.assertRaisesRegex(ValueError, "removed .* overlap rows"):
            run_statcan_refresh(
                (spec(),), self.geographies, FakeClient(tuple(replaced)), store,
                run_id="canada-vector-drift",
                generated_at=datetime(2026, 7, 20, tzinfo=UTC),
            )
        self.assertEqual(store.current_run_id(), "canada-001")

        removed = tuple(row for row in rows if row["REF_DATE"] != "2025-06")
        with self.assertRaisesRegex(ValueError, "removed .* overlap rows"):
            run_statcan_refresh(
                (spec(),), self.geographies, FakeClient(removed), store,
                run_id="canada-row-removal",
                generated_at=datetime(2026, 7, 21, tzinfo=UTC),
            )
        self.assertEqual(store.current_run_id(), "canada-001")

    def test_unchanged_values_publish_when_expected_period_changes_freshness(self) -> None:
        rows = tuple(
            record(f"2025-{month:02d}", geography)
            for month in range(1, 13)
            for geography in ("ca", "ca.ab")
        )
        store = SnapshotStore(self.directory())
        run_statcan_refresh(
            (spec(),), self.geographies, FakeClient(rows), store,
            run_id="canada-001", generated_at=datetime(2026, 7, 19, tzinfo=UTC),
        )
        due = run_statcan_refresh(
            (spec(),), self.geographies, FakeClient(rows), store,
            run_id="canada-due", generated_at=datetime(2026, 7, 20, tzinfo=UTC),
            period_windows={spec().id: PeriodWindow(expected_period="2026-01")},
        )
        self.assertTrue(due.changed)
        manifest = json.loads(due.public_manifest_path.read_text(encoding="utf-8"))
        self.assertEqual(manifest["series"][0]["freshness"]["status"], "due")

if __name__ == "__main__":
    unittest.main()

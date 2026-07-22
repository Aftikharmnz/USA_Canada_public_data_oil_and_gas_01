from __future__ import annotations

import hashlib
import json
import shutil
import sys
import unittest
import uuid
from dataclasses import replace
from datetime import UTC, datetime
from pathlib import Path
from unittest.mock import patch

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "pipeline"))

from energy_dashboard.eia import EIAFetchResult, EIAQuerySpec
from energy_dashboard.contracts import ObservationStatus
from energy_dashboard.promotion import (
    promote_current_public_generation,
    verify_public_generation,
)
from energy_dashboard.refresh import PeriodWindow, run_eia_refresh
from energy_dashboard.refresh import default_overlap_start
from energy_dashboard.rebuild import rebuild_current_analytics
from energy_dashboard.contracts import Frequency
from energy_dashboard.registry import (
    RegistryEIASeries,
    load_eia_registry,
    load_provider_geographies,
    normalize_eia_records,
)
from energy_dashboard.storage import SnapshotStore


NOW = datetime(2026, 7, 19, tzinfo=UTC)


class FakeFetcher:
    def __init__(self, route: str, records: tuple[dict[str, object], ...]) -> None:
        self.route = route
        self.records = records
        self.queries: list[EIAQuerySpec] = []

    def fetch(self, spec: EIAQuerySpec) -> EIAFetchResult:
        self.queries.append(spec)
        canonical = json.dumps(self.records, sort_keys=True, separators=(",", ":")).encode()
        return EIAFetchResult(
            route=self.route,
            records=self.records,
            total=len(self.records),
            request_count=1,
            payload_sha256=hashlib.sha256(canonical).hexdigest(),
        )


def monthly_record(period: str, value: str, duoarea: str = "NUS") -> dict[str, object]:
    return {
        "period": period,
        "duoarea": duoarea,
        "product": "EPC0",
        "process": "FPF",
        "value": value,
        "units": "MBBL/D",
    }


class RegistryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.series = load_eia_registry(PROJECT_ROOT / "config" / "series" / "usa.json")
        cls.geographies = load_provider_geographies(
            PROJECT_ROOT / "config" / "geographies" / "usa.json"
        )

    def test_exact_active_registry_queries_load_without_geography_hardcoding(self) -> None:
        active_ids = {item.id for item in self.series}
        core_ids = {
            "usa.eia.crude.production.monthly",
            "usa.eia.product_supplied.weekly",
            "usa.eia.refinery.utilization.weekly",
        }
        self.assertEqual(len(active_ids), 67)
        self.assertTrue(core_ids.issubset(active_ids))

        classified = [item for item in self.series if item.display is not None]
        self.assertEqual(len(classified), 64)
        self.assertTrue(
            all(
                item.display.dashboard_group in {"refined_products", "usa_crude"}
                for item in classified
            )
        )
        refined = [
            item
            for item in classified
            if item.display.dashboard_group == "refined_products"
        ]
        crude_weekly = [
            item for item in classified if item.display.dashboard_group == "usa_crude"
        ]
        self.assertEqual(len(refined), 55)
        self.assertEqual(len(crude_weekly), 9)
        self.assertEqual(
            {family: sum(item.display.product_family_id == family for item in refined)
             for family in (
                 "gasoline", "distillate", "jet-fuel", "propane",
                 "residual-fuel-oil",
             )},
            {
                "gasoline": 19,
                "distillate": 14,
                "jet-fuel": 6,
                "propane": 6,
                "residual-fuel-oil": 5,
            },
        )
        self.assertNotIn(
            "usa.eia.refined.gasoline.finished.exports.weekly",
            active_ids,
            "the gasoline export concept break is intentionally excluded",
        )
        self.assertTrue(all(item.source_geography_ids for item in self.series))
        self.assertTrue(
            all(
                item.bootstrap_start
                == ("2014-01" if item.frequency == Frequency.MONTHLY else "2014-01-01")
                for item in self.series
            )
        )
        crude = next(item for item in self.series if item.id.endswith("crude.production.monthly"))
        self.assertEqual(dict(crude.query.facets)["product"], ("EPC0",))
        self.assertEqual(dict(crude.query.facets)["process"], ("FPF",))
        self.assertIn("duoarea", crude.query.identity_fields)
        self.assertIn("units", crude.query.identity_fields)
        self.assertNotIn("units", {item.column for item in crude.query.sort})
        self.assertEqual(self.geographies.resolve("R30"), ("us.padd.3", "padd"))
        self.assertEqual(self.geographies.resolve("R30-Z00"), ("us.padd.3", "padd"))
        self.assertEqual(self.geographies.resolve("NUS-Z00"), ("us", "national"))
        self.assertEqual(self.geographies.resolve("STX"), ("us.tx", "state_or_area"))
        self.assertEqual(self.geographies.resolve("R48"), ("us.lower48", "state_or_area"))
        self.assertEqual(self.geographies.resolve("YCUOK"), ("us.ok.cushing", "city"))
        self.assertEqual(
            self.geographies.resolve("R45-Z00"), ("us.padd.4-and-5", "padd")
        )

        days = next(item for item in self.series if item.id.endswith("crude.days_supply.weekly"))
        self.assertEqual(days.canonical_unit, "days")
        self.assertEqual(days.expected_unit, "DAYS")
        self.assertEqual(days.source_geography_ids, ("us",))

        weekly_production = next(
            item for item in self.series if item.id.endswith("crude.production.weekly")
        )
        self.assertEqual(
            weekly_production.source_geography_ids,
            ("us.ak", "us.lower48", "us"),
        )

        propane_stocks = next(
            item for item in self.series if item.id.endswith("refined.propane.stocks.weekly")
        )
        self.assertEqual(propane_stocks.source_geography_level_ids[0], "padd_subdistrict")
        self.assertIn("us.padd.1a", propane_stocks.source_geography_ids)
        self.assertIn("us.padd.4-and-5", propane_stocks.source_geography_ids)

        residual_imports = next(
            item
            for item in self.series
            if item.id.endswith("refined.residual_fuel_oil.imports.weekly")
        )
        self.assertEqual(residual_imports.source_geography_level_ids[0], "padd")
        self.assertEqual(
            residual_imports.source_geography_ids,
            ("us.padd.1", "us.padd.2", "us.padd.3", "us.padd.4", "us.padd.5", "us"),
        )

    def test_normalizer_maps_provider_code_and_rejects_geo_unit_and_facet_drift(self) -> None:
        crude = next(item for item in self.series if item.id.endswith("crude.production.monthly"))
        rows = normalize_eia_records(
            crude, (monthly_record("2026-05", "13.25", "STX"),), self.geographies,
            retrieved_at=NOW,
        )
        self.assertEqual(rows[0].geography_id, "us.tx")
        self.assertEqual(str(rows[0].value), "13.25")
        self.assertEqual(rows[0].original_unit, "MBBL/D")

        with self.assertRaisesRegex(ValueError, "Unverified"):
            normalize_eia_records(
                crude, (monthly_record("2026-05", "1", "CITY-GUESS"),), self.geographies,
                retrieved_at=NOW,
            )
        exact_without_texas = replace(
            crude,
            source_geography_ids=tuple(
                geography_id
                for geography_id in crude.source_geography_ids
                if geography_id != "us.tx"
            ),
        )
        with self.assertRaisesRegex(ValueError, "escaped exact registered geography"):
            normalize_eia_records(
                exact_without_texas,
                (monthly_record("2026-05", "1", "STX"),),
                self.geographies,
                retrieved_at=NOW,
            )
        bad_unit = monthly_record("2026-05", "1", "STX")
        bad_unit["units"] = "BBL/D"
        with self.assertRaisesRegex(ValueError, "expected unit"):
            normalize_eia_records(crude, (bad_unit,), self.geographies, retrieved_at=NOW)
        bad_facet = monthly_record("2026-05", "1", "STX")
        bad_facet["product"] = "UNREGISTERED"
        with self.assertRaisesRegex(ValueError, "escaped registered"):
            normalize_eia_records(crude, (bad_facet,), self.geographies, retrieved_at=NOW)

    def test_unit_is_explicit_row_selection_and_petroleum_symbols_remain_distinct(self) -> None:
        crude = next(item for item in self.series if item.id.endswith("crude.production.monthly"))
        wrong_unit = monthly_record("2026-01", "100")
        wrong_unit["units"] = "MBBL"
        records = (
            wrong_unit,
            monthly_record("2026-01", "NA"),
            monthly_record("2026-02", "W"),
            monthly_record("2026-03", "-"),
            monthly_record("2026-04", "--"),
        )
        rows = normalize_eia_records(crude, records, self.geographies, retrieved_at=NOW)
        self.assertEqual(len(rows), 4, "MBBL level rows are filtered from the MBBL/D series")
        status_by_period = {row.period: row.status for row in rows}
        self.assertEqual(status_by_period["2026-01"], ObservationStatus.NOT_AVAILABLE)
        self.assertEqual(status_by_period["2026-02"], ObservationStatus.SUPPRESSED_OR_WITHHELD)
        self.assertEqual(status_by_period["2026-03"], ObservationStatus.MISSING)
        self.assertEqual(status_by_period["2026-04"], ObservationStatus.NOT_APPLICABLE)
        self.assertTrue(all(row.value is None for row in rows))


class RefreshRunnerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.crude: RegistryEIASeries = next(
            item
            for item in load_eia_registry(PROJECT_ROOT / "config" / "series" / "usa.json")
            if item.id.endswith("crude.production.monthly")
        )
        cls.geographies = load_provider_geographies(
            PROJECT_ROOT / "config" / "geographies" / "usa.json"
        )

    def store_directory(self) -> Path:
        directory = Path(__file__).parent / f"_runtime_{uuid.uuid4().hex}"
        directory.mkdir()
        self.addCleanup(shutil.rmtree, directory, True)
        return directory

    def history(self) -> tuple[dict[str, object], ...]:
        return tuple(
            monthly_record(f"{year:04d}-{month:02d}", str((year - 2000) * 10 + month))
            for year in range(2014, 2026)
            for month in range(1, 13)
        ) + tuple(monthly_record(f"2026-{month:02d}", str(300 + month)) for month in range(1, 4))

    def test_registry_to_revision_merge_to_public_manifest(self) -> None:
        directory = self.store_directory()
        store = SnapshotStore(directory)
        first_fetcher = FakeFetcher(self.crude.route, self.history())
        first = run_eia_refresh(
            (self.crude,),
            self.geographies,
            {"EIA_API_KEY": first_fetcher},
            store,
            run_id="run-001",
            generated_at=NOW,
            period_windows={self.crude.id: PeriodWindow(expected_period="2026-03")},
        )
        self.assertEqual(first.inserted_rows, len(self.history()))
        self.assertEqual(first.asset_count, 1)
        manifest = json.loads(first.public_manifest_path.read_text(encoding="utf-8"))
        self.assertEqual(manifest["run_id"], "run-001")
        self.assertEqual(manifest["status"], "fresh")
        self.assertEqual(manifest["series"][0]["freshness"]["latest_period"], "2026-03")
        geography = manifest["series"][0]["geographies"][0]
        self.assertEqual(geography["label"], "United States")
        self.assertEqual(geography["origin"], "source-published")
        self.assertTrue(manifest["series"][0]["unsupported_levels"])
        asset_path = first.generation_path / "public" / geography["asset_path"]
        asset = json.loads(asset_path.read_text(encoding="utf-8"))
        self.assertEqual(asset["freshness"]["status"], "fresh")
        verify_public_generation(first.generation_path / "public", expected_run_id="run-001")
        promoted_destination = directory / "promoted"
        promoted_first = promote_current_public_generation(
            store, promoted_destination, expected_run_id="run-001"
        )
        self.assertEqual(json.loads(promoted_first.read_text(encoding="utf-8"))["run_id"], "run-001")

        revised = monthly_record("2026-03", "999")
        second_fetcher = FakeFetcher(self.crude.route, (revised,))
        second = run_eia_refresh(
            (self.crude,),
            self.geographies,
            {"EIA_API_KEY": second_fetcher},
            store,
            run_id="run-002",
            generated_at=datetime(2026, 7, 20, tzinfo=UTC),
            period_windows={self.crude.id: PeriodWindow(expected_period="2026-04")},
        )
        self.assertEqual(second.revised_rows, 1)
        self.assertEqual(store.current_run_id(), "run-002")
        current = store.load_current()
        assert current is not None
        self.assertEqual(len(current.revisions), 1)
        second_manifest = json.loads(second.public_manifest_path.read_text(encoding="utf-8"))
        second_geography = second_manifest["series"][0]["geographies"][0]
        second_asset = json.loads(
            (second.generation_path / "public" / second_geography["asset_path"]).read_text(
                encoding="utf-8"
            )
        )
        self.assertEqual(second_asset["freshness"]["status"], "due")
        self.assertEqual(first_fetcher.queries[0].start, "2014-01")
        self.assertEqual(second_fetcher.queries[0].start, "2016-03")

        promoted = promote_current_public_generation(
            store, promoted_destination, expected_run_id="run-002"
        )
        promoted_manifest = json.loads(promoted.read_text(encoding="utf-8"))
        self.assertEqual(promoted_manifest["run_id"], "run-002")

        unchanged_fetcher = FakeFetcher(self.crude.route, (revised,))
        unchanged = run_eia_refresh(
            (self.crude,),
            self.geographies,
            {"EIA_API_KEY": unchanged_fetcher},
            store,
            run_id="run-003",
            generated_at=datetime(2026, 7, 21, tzinfo=UTC),
        )
        self.assertFalse(unchanged.changed)
        self.assertEqual(unchanged.run_id, "run-002")
        self.assertEqual(store.current_run_id(), "run-002")
        self.assertFalse((directory / "generations" / "run-003").exists())
        self.assertEqual(unchanged_fetcher.queries[0].start, "2016-03")

        explicit_fetcher = FakeFetcher(self.crude.route, (revised,))
        explicit = run_eia_refresh(
            (self.crude,), self.geographies, {"EIA_API_KEY": explicit_fetcher}, store,
            run_id="run-004", generated_at=datetime(2026, 7, 22, tzinfo=UTC),
            period_windows={self.crude.id: PeriodWindow(start="2025-01")},
        )
        self.assertFalse(explicit.changed)
        self.assertEqual(explicit_fetcher.queries[0].start, "2025-01")

    def test_offline_analytics_rebuild_adds_forecasts_without_provider_calls(self) -> None:
        directory = self.store_directory()
        store = SnapshotStore(directory)
        initial = run_eia_refresh(
            (self.crude,),
            self.geographies,
            {"EIA_API_KEY": FakeFetcher(self.crude.route, self.history())},
            store,
            run_id="source-run",
            generated_at=NOW,
        )
        source_manifest = json.loads(
            initial.public_manifest_path.read_text(encoding="utf-8")
        )
        source_geography = source_manifest["series"][0]["geographies"][0]
        source_asset = json.loads(
            (
                initial.generation_path
                / "public"
                / source_geography["asset_path"]
            ).read_text(encoding="utf-8")
        )

        rebuilt = rebuild_current_analytics(
            store,
            run_id="analytics-run",
            generated_at=datetime(2026, 7, 20, tzinfo=UTC),
        )
        self.assertEqual(rebuilt.previous_run_id, "source-run")
        self.assertEqual(store.current_run_id(), "analytics-run")
        manifest = json.loads(rebuilt.public_manifest_path.read_text(encoding="utf-8"))
        geography = manifest["series"][0]["geographies"][0]
        self.assertIn("forecast_path", geography)
        forecast = json.loads(
            (rebuilt.generation_path / "public" / geography["forecast_path"]).read_text(
                encoding="utf-8"
            )
        )
        rebuilt_asset = json.loads(
            (rebuilt.generation_path / "public" / geography["asset_path"]).read_text(
                encoding="utf-8"
            )
        )
        self.assertEqual(forecast["status"], "ok")
        self.assertEqual(len(forecast["points"]), 3)
        self.assertEqual(
            forecast["training_source_checksum"], rebuilt_asset["source_checksum"]
        )
        self.assertEqual(rebuilt_asset["source_checksum"], source_asset["source_checksum"])
        verify_public_generation(
            rebuilt.generation_path / "public", expected_run_id="analytics-run"
        )

    def test_overlap_policy_is_frequency_specific(self) -> None:
        self.assertEqual(
            default_overlap_start(Frequency.WEEKLY, "2026-07-17"), "2026-04-17"
        )
        self.assertEqual(default_overlap_start(Frequency.MONTHLY, "2026-06"), "2016-06")

    def test_unchanged_values_publish_when_expected_period_becomes_due(self) -> None:
        directory = self.store_directory()
        store = SnapshotStore(directory)
        history = self.history()
        first = run_eia_refresh(
            (self.crude,),
            self.geographies,
            {"EIA_API_KEY": FakeFetcher(self.crude.route, history)},
            store,
            run_id="run-fresh",
            generated_at=NOW,
            period_windows={self.crude.id: PeriodWindow(expected_period="2026-03")},
        )
        self.assertEqual(
            json.loads(first.public_manifest_path.read_text(encoding="utf-8"))["status"],
            "fresh",
        )

        due = run_eia_refresh(
            (self.crude,),
            self.geographies,
            {"EIA_API_KEY": FakeFetcher(self.crude.route, (monthly_record("2026-03", "303"),))},
            store,
            run_id="run-due",
            generated_at=datetime(2026, 7, 20, tzinfo=UTC),
            period_windows={self.crude.id: PeriodWindow(expected_period="2026-04")},
        )

        self.assertTrue(due.changed)
        due_manifest = json.loads(due.public_manifest_path.read_text(encoding="utf-8"))
        self.assertEqual(due_manifest["status"], "due")

    def test_failed_geography_validation_keeps_current_generation(self) -> None:
        directory = self.store_directory()
        store = SnapshotStore(directory)
        run_eia_refresh(
            (self.crude,), self.geographies,
            {"EIA_API_KEY": FakeFetcher(self.crude.route, self.history())},
            store, run_id="run-001", generated_at=NOW,
        )
        with self.assertRaisesRegex(ValueError, "Unverified"):
            run_eia_refresh(
                (self.crude,), self.geographies,
                {"EIA_API_KEY": FakeFetcher(self.crude.route, (monthly_record("2026-04", "1", "FAKE"),))},
                store, run_id="run-002", generated_at=datetime(2026, 7, 20, tzinfo=UTC),
            )
        self.assertEqual(store.current_run_id(), "run-001")

    def test_failed_public_semantic_validation_keeps_current_generation(self) -> None:
        directory = self.store_directory()
        store = SnapshotStore(directory)
        run_eia_refresh(
            (self.crude,),
            self.geographies,
            {"EIA_API_KEY": FakeFetcher(self.crude.route, self.history())},
            store,
            run_id="run-001",
            generated_at=NOW,
        )

        with patch(
            "energy_dashboard.refresh.verify_public_generation",
            side_effect=ValueError("synthetic semantic failure"),
        ):
            with self.assertRaisesRegex(ValueError, "synthetic semantic failure"):
                run_eia_refresh(
                    (self.crude,),
                    self.geographies,
                    {
                        "EIA_API_KEY": FakeFetcher(
                            self.crude.route,
                            (monthly_record("2026-04", "404"),),
                        )
                    },
                    store,
                    run_id="run-002",
                    generated_at=datetime(2026, 7, 20, tzinfo=UTC),
                )

        self.assertEqual(store.current_run_id(), "run-001")
        self.assertFalse((directory / "generations" / "run-002").exists())

    def test_unchanged_partial_refresh_cannot_hide_a_new_active_series(self) -> None:
        directory = self.store_directory()
        store = SnapshotStore(directory)
        history = self.history()
        run_eia_refresh(
            (self.crude,),
            self.geographies,
            {"EIA_API_KEY": FakeFetcher(self.crude.route, history)},
            store,
            run_id="run-001",
            generated_at=NOW,
        )
        newly_active = replace(
            self.crude,
            id="usa.eia.newly-active.monthly",
            metric_id="newly_active",
        )
        with self.assertRaisesRegex(ValueError, "cannot drop active series"):
            run_eia_refresh(
                (self.crude,),
                self.geographies,
                {"EIA_API_KEY": FakeFetcher(self.crude.route, history)},
                store,
                run_id="run-002",
                generated_at=NOW,
                manifest_series_specs=(self.crude, newly_active),
            )
        self.assertEqual(store.current_run_id(), "run-001")


if __name__ == "__main__":
    unittest.main()

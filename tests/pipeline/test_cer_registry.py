from __future__ import annotations

import contextlib
import io
import json
import shutil
import sys
import unittest
import uuid
from dataclasses import replace
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "pipeline"))

from energy_dashboard import cli
from energy_dashboard.canada_registry import RegistryCanadaSeries, load_cer_registry
from energy_dashboard.cer_pipeline import (
    TRANS_NORTHERN_CSV_URL,
    TRANS_NORTHERN_FILTERS,
    TRANS_NORTHERN_GEOGRAPHIES,
    TRANS_NORTHERN_HEADERS,
    TRANS_NORTHERN_UNIT,
    TransNorthernFetchResult,
)
from energy_dashboard.contracts import Frequency, Observation
from energy_dashboard.registry import load_provider_geographies
from energy_dashboard.statcan_refresh import AdditionalCanadaBatch, run_statcan_refresh
from energy_dashboard.storage import SnapshotStore

GENERATED_AT = datetime(2026, 9, 10, tzinfo=UTC)


def registry_document() -> dict:
    return {
        "providers": [{"id": "cer", "name": "Canada Energy Regulator"}],
        "bootstrap_period_start_by_frequency": {"weekly": "2014-01-01", "monthly": "2014-01"},
        "geography_profiles": {"test": {
            "source_geography_ids": ["ca.on"],
            "source_geography_level_ids": ["province_territory"], "unsupported_levels": [],
        }},
        "series": [{
            "id": "can.cer.test.monthly", "provider_id": "cer", "activation_status": "active",
            "metric_id": "pipeline_throughput", "name": "Test throughput",
            "unit": TRANS_NORTHERN_UNIT, "frequency": "monthly", "geography_profile_id": "test",
            "source_url": TRANS_NORTHERN_CSV_URL, "dataset_id": "trans_northern_throughput",
            "source_filters": dict(TRANS_NORTHERN_FILTERS),
        }],
    }


class NoNetworkClient:
    def fetch(self, _spec):
        raise AssertionError("A CER-only batch must not fetch a Statistics Canada table")


class CERRegistryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.root = Path(__file__).parent / f"_runtime_cer_{uuid.uuid4().hex}"
        self.root.mkdir()
        self.addCleanup(shutil.rmtree, self.root, True)

    def load(self, document: dict) -> tuple[RegistryCanadaSeries, ...]:
        path = self.root / "series.json"
        path.write_text(json.dumps(document), encoding="utf-8")
        return load_cer_registry(path)

    def test_monthly_dataset_and_filters_round_trip(self) -> None:
        actual, = self.load(registry_document())
        self.assertEqual(actual.dataset_id, "trans_northern_throughput")
        self.assertEqual(actual.frequency, Frequency.MONTHLY)
        self.assertEqual(dict(actual.source_filters), dict(TRANS_NORTHERN_FILTERS))
        self.assertEqual(actual.bootstrap_start, "2014-01")

    def test_unknown_dataset_rejected_before_any_provider_request(self) -> None:
        document = registry_document()
        document["series"][0]["dataset_id"] = "unreviewed_pipeline_feed"
        with self.assertRaisesRegex(ValueError, "Unreviewed CER dataset"):
            self.load(document)

    def test_each_dataset_has_exact_reviewed_frequency(self) -> None:
        for dataset, wrong_frequency in (
            ("trans_northern_throughput", "weekly"),
            ("ngl_exports_monthly", "weekly"),
            ("refinery_crude_runs_weekly", "monthly"),
        ):
            document = registry_document()
            document["series"][0].update(dataset_id=dataset, frequency=wrong_frequency)
            with self.subTest(dataset=dataset), self.assertRaisesRegex(ValueError, "frequency mismatch"):
                self.load(document)

    def test_legacy_weekly_registry_default_remains_compatible(self) -> None:
        document = registry_document()
        entry = document["series"][0]
        del entry["dataset_id"]
        del entry["source_filters"]
        entry["frequency"] = "weekly"
        actual, = self.load(document)
        self.assertEqual(actual.dataset_id, "refinery_crude_runs_weekly")
        self.assertEqual(actual.source_filters, ())
        self.assertEqual(actual.bootstrap_start, "2014-01-01")

    def test_nonstrings_cannot_be_silently_coerced_into_source_filters(self) -> None:
        for value in ({"Product": 123}, {"Product": ["gasoline"]}, ["Product"], None):
            document = registry_document()
            document["series"][0]["source_filters"] = value
            with self.subTest(value=value), self.assertRaises(ValueError):
                self.load(document)

    def test_unknown_geography_profile_and_duplicate_ids_are_rejected(self) -> None:
        document = registry_document()
        document["series"][0]["geography_profile_id"] = "unknown"
        with self.assertRaisesRegex(ValueError, "unknown geography profile"):
            self.load(document)
        document = registry_document()
        document["series"].append(dict(document["series"][0]))
        with self.assertRaisesRegex(ValueError, "unique"):
            self.load(document)

    def test_trans_northern_points_cannot_enter_provincial_rollups(self) -> None:
        document = json.loads((PROJECT_ROOT / "config/geographies/canada.json").read_text())
        nodes = {item["id"]: item for item in document["nodes"]}
        for geography_id in TRANS_NORTHERN_GEOGRAPHIES.values():
            self.assertEqual(nodes[geography_id]["parent_ids"], [])
            self.assertEqual(nodes[geography_id]["level_id"], "pipeline_key_point")
        active = load_cer_registry(PROJECT_ROOT / "config/series/canada.json")
        pipeline_ids = {item.id for item in active if item.dataset_id == "trans_northern_throughput"}
        self.assertEqual(len(pipeline_ids), 1)
        for filename in ("config/aggregation/custom-geography.json", "config/display/monthly-average-rate.json"):
            source_text = (PROJECT_ROOT / filename).read_text()
            for series_id in pipeline_ids:
                self.assertNotIn(series_id, source_text)

    def test_additional_batch_wrong_provider_or_unit_preserves_last_known_good(self) -> None:
        actual, = self.load(registry_document())
        geographies = load_provider_geographies(
            PROJECT_ROOT / "config/geographies/canada.json", provider_id="statcan",
            provider_code_field="statcan_dguid",
        )
        rows = tuple(Observation(
            provider_id="cer", series_id=actual.id, geography_id="ca.on",
            period=f"2025-{month:02d}", value=Decimal(month), unit=actual.canonical_unit,
            retrieved_at=GENERATED_AT,
        ) for month in range(1, 13))
        batch = AdditionalCanadaBatch(actual, rows, "a" * 64, {"series_id": actual.id})
        store = SnapshotStore(self.root / "cache")
        run_statcan_refresh(
            (), geographies, NoNetworkClient(), store,
            run_id="cer-before", generated_at=GENERATED_AT, additional_batches=(batch,),
        )
        old_pointer = (self.root / "cache/CURRENT").read_bytes()
        old_manifest = (self.root / "cache/generations/cer-before/public/manifest.json").read_bytes()
        for field, wrong in (("provider_id", "statcan"), ("unit", "cubic_metres")):
            invalid = replace(batch, observations=(replace(rows[0], **{field: wrong}), *rows[1:]))
            with self.subTest(field=field), self.assertRaisesRegex(ValueError, "provider or unit"):
                run_statcan_refresh(
                    (), geographies, NoNetworkClient(), store,
                    run_id=f"cer-invalid-{field}", generated_at=GENERATED_AT,
                    additional_batches=(invalid,),
                )
            self.assertEqual((self.root / "cache/CURRENT").read_bytes(), old_pointer)
            self.assertEqual(
                (self.root / "cache/generations/cer-before/public/manifest.json").read_bytes(),
                old_manifest,
            )
            self.assertFalse((self.root / f"cache/generations/cer-invalid-{field}").exists())

    def test_monthly_only_cli_dispatch_never_fetches_weekly_refinery_file(self) -> None:
        actual = RegistryCanadaSeries(
            id="can.cer.test.throughput.monthly", metric_id="pipeline_throughput",
            title="Test throughput", description="Pipeline points", source_name="CER",
            source_url=TRANS_NORTHERN_CSV_URL, canonical_unit=TRANS_NORTHERN_UNIT,
            frequency=Frequency.MONTHLY,
            source_geography_ids=tuple(TRANS_NORTHERN_GEOGRAPHIES.values()),
            source_geography_level_ids=("pipeline_key_point",), unsupported_levels=(),
            dataset_id="trans_northern_throughput", source_filters=TRANS_NORTHERN_FILTERS,
            bootstrap_start="2014-01",
        )
        records = []
        for key_point in TRANS_NORTHERN_GEOGRAPHIES:
            record = dict.fromkeys(TRANS_NORTHERN_HEADERS, "")
            record.update(dict(TRANS_NORTHERN_FILTERS))
            record.update({"Date": "2026-06-01", "Month": "6", "Year": "2026",
                           "Key Point": key_point, "Throughput (1000 m3/d)": "10"})
            records.append(record)
        fetched = TransNorthernFetchResult(tuple(records), "a" * 64, 1, TRANS_NORTHERN_CSV_URL, 1)
        no_change = SimpleNamespace(
            run_id="cer-existing", changed=False, generation_path=self.root / "cache",
            public_manifest_path=self.root / "manifest.json", inserted_rows=0,
            revised_rows=0, unchanged_rows=3, asset_count=3,
        )
        with patch.object(cli, "load_statcan_registry", return_value=()), \
             patch.object(cli, "load_cer_registry", return_value=(actual,)), \
             patch.object(cli, "CERClient") as weekly_client, \
             patch.object(cli, "TransNorthernClient") as pipeline_client, \
             patch.object(cli, "run_statcan_refresh", return_value=no_change) as refresh, \
             contextlib.redirect_stdout(io.StringIO()):
            pipeline_client.return_value.fetch.return_value = fetched
            outcome = cli.main([
                "refresh-canada", "--series-id", actual.id, "--store", str(self.root / "cache"),
            ])
        self.assertEqual(outcome, 0)
        weekly_client.assert_not_called()
        pipeline_client.return_value.fetch.assert_called_once_with()
        batches = refresh.call_args.kwargs["additional_batches"]
        self.assertEqual(len(batches), 1)
        self.assertEqual(batches[0].spec.id, actual.id)
        self.assertEqual(len(batches[0].observations), 3)

    def test_source_update_metadata_is_not_release_time_or_a_noop_trigger(self) -> None:
        actual, = self.load(registry_document())
        unrelated = replace(actual, id="can.cer.unselected.monthly")
        geographies = load_provider_geographies(
            PROJECT_ROOT / "config/geographies/canada.json", provider_id="statcan",
            provider_code_field="statcan_dguid",
        )
        initial_update = datetime(2026, 8, 27, 21, 29, 20, tzinfo=UTC)
        next_update = datetime(2026, 9, 1, 18, 0, tzinfo=UTC)
        next_retrieval = datetime(2026, 9, 11, 5, 0, tzinfo=UTC)
        rows = tuple(Observation(
            provider_id="cer", series_id=actual.id, geography_id="ca.on",
            period=f"2025-{month:02d}", value=Decimal(month), unit=actual.canonical_unit,
            retrieved_at=GENERATED_AT, source_updated_at=initial_update,
        ) for month in range(1, 13))
        selected = AdditionalCanadaBatch(actual, rows, "a" * 64, {"series_id": actual.id})
        untouched = AdditionalCanadaBatch(
            unrelated, tuple(replace(row, series_id=unrelated.id, source_updated_at=None) for row in rows),
            "b" * 64, {"series_id": unrelated.id},
        )
        store = SnapshotStore(self.root / "source-update-cache")

        def freshness(run_id: str, series_id: str) -> tuple[dict, dict]:
            public = store.generations / run_id / "public"
            manifest = json.loads((public / "manifest.json").read_text())
            series = next(item for item in manifest["series"] if item["series_id"] == series_id)
            asset = json.loads((public / series["geographies"][0]["asset_path"]).read_text())
            return series["freshness"], asset["freshness"]

        run_statcan_refresh(
            (), geographies, NoNetworkClient(), store, run_id="cer-source-initial",
            generated_at=GENERATED_AT, additional_batches=(selected, untouched),
        )
        for layer in freshness("cer-source-initial", actual.id):
            self.assertEqual(layer["source_updated_at"], initial_update.isoformat())
            self.assertIsNone(layer["source_release_at"])
            self.assertEqual(layer["latest_period"], "2025-12")
        for layer in freshness("cer-source-initial", unrelated.id):
            self.assertIsNone(layer["source_updated_at"])
            self.assertIsNone(layer["source_release_at"])

        # A newer HTTP file timestamp alone remains a source-value/status no-op.
        # It must not create a generation, revision, or fabricated release.
        updated_rows = tuple(replace(
            row, source_updated_at=next_update, retrieved_at=next_retrieval,
        ) for row in rows)
        updated_batch = replace(selected, observations=updated_rows)
        noop = run_statcan_refresh(
            (), geographies, NoNetworkClient(), store, run_id="cer-source-noop",
            generated_at=next_retrieval, additional_batches=(updated_batch,),
            additional_manifest_series_specs=(actual, unrelated),
        )
        self.assertFalse(noop.changed)
        self.assertEqual(store.current_run_id(), "cer-source-initial")
        self.assertFalse((store.generations / "cer-source-noop").exists())

        # A real historical revision carries its actual file-update metadata,
        # although the newest numeric/source month is still December 2025.
        changed_rows = (replace(updated_rows[0], value=Decimal("100")), *rows[1:])
        changed = run_statcan_refresh(
            (), geographies, NoNetworkClient(), store, run_id="cer-source-revised",
            generated_at=next_retrieval,
            additional_batches=(replace(selected, observations=changed_rows),),
            additional_manifest_series_specs=(actual, unrelated),
        )
        self.assertTrue(changed.changed)
        self.assertEqual(changed.revised_rows, 1)
        for layer in freshness("cer-source-revised", actual.id):
            self.assertEqual(layer["source_updated_at"], next_update.isoformat())
            self.assertIsNone(layer["source_release_at"])
            self.assertNotEqual(layer["source_updated_at"], layer["retrieved_at"])
            self.assertEqual(layer["latest_period"], "2025-12")
        for layer in freshness("cer-source-revised", unrelated.id):
            self.assertIsNone(layer["source_updated_at"])
            self.assertEqual(layer["last_success_at"], GENERATED_AT.isoformat())


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import hashlib
import json
import shutil
import sys
import unittest
import uuid
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from typing import Callable


PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "pipeline"))

from energy_dashboard.analytics import ASSET_SCHEMA_VERSION, build_chart_asset, write_chart_asset
from energy_dashboard.contracts import Frequency, Observation
from energy_dashboard.forecasting import (
    FORECAST_METHODOLOGY_VERSION,
    PUBLIC_ASSET_BUILD_ID,
    build_forecast_asset,
)
from energy_dashboard.promotion import verify_public_generation
from energy_dashboard.storage import replace_path_with_retry


NOW = datetime(2026, 7, 20, tzinfo=UTC)


def _monthly_rows(count: int = 144) -> tuple[Observation, ...]:
    rows: list[Observation] = []
    year, month = 2014, 1
    for index in range(count):
        rows.append(
            Observation(
                provider_id="test",
                series_id="test.energy.monthly",
                period=f"{year:04d}-{month:02d}",
                geography_id="test.region",
                value=Decimal("100") + Decimal(index) / Decimal("10"),
                unit="thousand_barrels_per_day",
                retrieved_at=NOW,
                dimensions=(("product", "test"),),
            )
        )
        month += 1
        if month == 13:
            year += 1
            month = 1
    return tuple(rows)


class PublicForecastVerificationTests(unittest.TestCase):
    def setUp(self) -> None:
        self.directory = Path(__file__).parent / f"_runtime_{uuid.uuid4().hex}"
        self.addCleanup(shutil.rmtree, self.directory, True)
        self.public_root = self.directory / "public"
        self.observed_path = "assets/test/monthly.json"
        self.forecast_path = "forecasts/test/monthly.json"

        rows = _monthly_rows()
        observed = build_chart_asset(
            rows,
            frequency=Frequency.MONTHLY,
            generated_at=NOW,
        )
        forecast = build_forecast_asset(
            rows,
            frequency=Frequency.MONTHLY,
            generated_at=NOW,
            source_checksum=str(observed["source_checksum"]),
            target_view_id="test.energy.monthly",
        )
        write_chart_asset(self.public_root / self.observed_path, observed)
        write_chart_asset(self.public_root / self.forecast_path, forecast)
        observed_bytes = (self.public_root / self.observed_path).read_bytes()
        forecast_bytes = (self.public_root / self.forecast_path).read_bytes()
        observed_digest = hashlib.sha256(observed_bytes).hexdigest()
        forecast_digest = hashlib.sha256(forecast_bytes).hexdigest()
        self.manifest = {
            "schema_version": ASSET_SCHEMA_VERSION,
            "asset_build_id": PUBLIC_ASSET_BUILD_ID,
            "forecast_methodology_version": FORECAST_METHODOLOGY_VERSION,
            "forecast_summary": {"ready": 1, "limited_history": 0, "unavailable": 0},
            "run_id": "test-run",
            "series": [
                {
                    "series_id": "test.energy.monthly",
                    "view_id": "test.energy.monthly",
                    "frequency": "monthly",
                    "unit": "thousand_barrels_per_day",
                    "geographies": [
                        {
                            "geography_id": "test.region",
                            "status": "available",
                            "asset_path": self.observed_path,
                            "asset_sha256": observed_digest,
                            "asset_bytes": len(observed_bytes),
                            "forecast_path": self.forecast_path,
                            "forecast_sha256": forecast_digest,
                            "forecast_bytes": len(forecast_bytes),
                        }
                    ],
                }
            ],
            "integrity": {
                self.observed_path: {
                    "sha256": observed_digest,
                    "bytes": len(observed_bytes),
                },
                self.forecast_path: {
                    "sha256": forecast_digest,
                    "bytes": len(forecast_bytes),
                },
            },
        }
        self._write_manifest()

    def _write_manifest(self) -> None:
        stage = self.public_root / f".manifest-stage-{uuid.uuid4().hex}.json"
        write_chart_asset(stage, self.manifest)
        replace_path_with_retry(stage, self.public_root / "manifest.json")

    def _mutate_forecast(self, mutate: Callable[[dict[str, object]], None]) -> None:
        path = self.public_root / self.forecast_path
        forecast = json.loads(path.read_text(encoding="utf-8"))
        mutate(forecast)
        write_chart_asset(path, forecast)
        payload = path.read_bytes()
        digest = hashlib.sha256(payload).hexdigest()
        geography = self.manifest["series"][0]["geographies"][0]
        geography["forecast_sha256"] = digest
        geography["forecast_bytes"] = len(payload)
        self.manifest["integrity"][self.forecast_path] = {
            "sha256": digest,
            "bytes": len(payload),
        }
        self._write_manifest()

    def test_valid_forecast_generation_passes_semantic_verification(self) -> None:
        manifest = verify_public_generation(
            self.public_root, expected_run_id="test-run"
        )
        self.assertEqual(manifest["forecast_summary"]["ready"], 1)

    def test_forecast_path_is_required_when_manifest_advertises_forecasting(self) -> None:
        geography = self.manifest["series"][0]["geographies"][0]
        geography.pop("forecast_path")
        geography.pop("forecast_sha256")
        geography.pop("forecast_bytes")
        self.manifest["integrity"].pop(self.forecast_path)
        self._write_manifest()
        with self.assertRaisesRegex(ValueError, "requires a forecast_path"):
            verify_public_generation(self.public_root)

    def test_rehashed_forecast_with_wrong_identity_is_rejected(self) -> None:
        self._mutate_forecast(
            lambda forecast: forecast.__setitem__("target_series_id", "wrong.series")
        )
        with self.assertRaisesRegex(ValueError, "identity or checksum"):
            verify_public_generation(self.public_root)

    def test_incomplete_forecast_path_is_rejected(self) -> None:
        self._mutate_forecast(lambda forecast: forecast["points"].pop())
        with self.assertRaisesRegex(ValueError, "path is incomplete"):
            verify_public_generation(self.public_root)

    def test_non_nested_forecast_intervals_are_rejected(self) -> None:
        def mutate(forecast: dict[str, object]) -> None:
            point = forecast["points"][0]
            point["intervals"]["80"]["lower"] = point["value"] + 1

        self._mutate_forecast(mutate)
        with self.assertRaisesRegex(ValueError, "not nested"):
            verify_public_generation(self.public_root)

    def test_current_forecast_requires_minimum_calibration_support(self) -> None:
        def mutate(forecast: dict[str, object]) -> None:
            for point in forecast["points"]:
                point["calibration_errors"] = 39
            forecast["prediction_intervals"]["minimum_errors_per_horizon"] = 39

        self._mutate_forecast(mutate)
        with self.assertRaisesRegex(ValueError, "below policy"):
            verify_public_generation(self.public_root)

    def test_current_forecast_requires_valid_aggregation_residuals(self) -> None:
        def mutate(forecast: dict[str, object]) -> None:
            residuals = forecast["aggregation_residuals"]
            residuals["samples"][1] = dict(residuals["samples"][0])

        self._mutate_forecast(mutate)
        with self.assertRaisesRegex(ValueError, "keys must be unique and ordered"):
            verify_public_generation(self.public_root)

    def test_previous_forecast_assets_remain_backwards_compatible(self) -> None:
        self.manifest["asset_build_id"] = (
            "observed-2026-07-19.2_forecast-2026-07-20.3"
        )
        self.manifest["forecast_methodology_version"] = "2026-07-20.3"

        def mutate(forecast: dict[str, object]) -> None:
            forecast["methodology_version"] = "2026-07-20.3"
            forecast.pop("aggregation_residuals")

        self._mutate_forecast(mutate)
        verified = verify_public_generation(self.public_root, expected_run_id="test-run")
        self.assertEqual(verified["forecast_summary"]["ready"], 1)

    def test_unavailable_status_cannot_retain_forecast_points(self) -> None:
        def mutate(forecast: dict[str, object]) -> None:
            forecast["status"] = "insufficient_history"
            forecast["reason"] = "Synthetic failure"

        self._mutate_forecast(mutate)
        with self.assertRaisesRegex(ValueError, "must not contain points"):
            verify_public_generation(self.public_root)


if __name__ == "__main__":
    unittest.main()

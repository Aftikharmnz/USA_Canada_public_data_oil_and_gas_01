from __future__ import annotations

import json
import sys
import unittest
from collections import Counter
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "pipeline"))

from energy_dashboard.forecasting import PUBLIC_ASSET_BUILD_ID
from energy_dashboard.promotion import verify_public_generation


class PromotedForecastAssetTests(unittest.TestCase):
    def test_every_promoted_observed_asset_has_a_matching_forecast_record(self) -> None:
        expected = {
            "usa": {"assets": 249, "ok": 248, "limited_history": 1},
            "canada": {
                "assets": 404,
                "ok": 360,
                "limited_history": 18,
                "latest_source_non_numeric": 25,
                "insufficient_history": 1,
            },
        }
        for country, expectation in expected.items():
            with self.subTest(country=country):
                root = PROJECT_ROOT / "public" / "data" / country
                manifest = verify_public_generation(root)
                self.assertEqual(manifest["asset_build_id"], PUBLIC_ASSET_BUILD_ID)
                statuses: Counter[str] = Counter()
                asset_count = 0
                for series in manifest["series"]:
                    for geography in series["geographies"]:
                        if geography["status"] != "available":
                            continue
                        asset_count += 1
                        self.assertIn("forecast_path", geography)
                        observed = json.loads(
                            (root / geography["asset_path"]).read_text(encoding="utf-8")
                        )
                        forecast = json.loads(
                            (root / geography["forecast_path"]).read_text(encoding="utf-8")
                        )
                        statuses[forecast["status"]] += 1
                        self.assertEqual(forecast["target_view_id"], series["view_id"])
                        self.assertEqual(forecast["target_series_id"], observed["series_id"])
                        self.assertEqual(forecast["geography_id"], geography["geography_id"])
                        self.assertEqual(forecast["frequency"], observed["frequency"])
                        self.assertEqual(forecast["unit"], observed["unit"])
                        self.assertEqual(
                            forecast["training_source_checksum"], observed["source_checksum"]
                        )
                        if forecast["status"] in {"ok", "limited_history"}:
                            expected_horizon = 3
                            self.assertEqual(len(forecast["points"]), expected_horizon)
                            self.assertEqual(
                                [point["horizon"] for point in forecast["points"]],
                                list(range(1, expected_horizon + 1)),
                            )
                            self.assertGreaterEqual(
                                forecast["prediction_intervals"][
                                    "minimum_errors_per_horizon"
                                ],
                                40,
                            )
                            for point in forecast["points"]:
                                intervals = point["intervals"]
                                self.assertLessEqual(
                                    intervals["95"]["lower"], intervals["90"]["lower"]
                                )
                                self.assertLessEqual(
                                    intervals["90"]["lower"], intervals["80"]["lower"]
                                )
                                self.assertLessEqual(intervals["80"]["lower"], point["value"])
                                self.assertLessEqual(point["value"], intervals["80"]["upper"])
                                self.assertLessEqual(
                                    intervals["80"]["upper"], intervals["90"]["upper"]
                                )
                                self.assertLessEqual(
                                    intervals["90"]["upper"], intervals["95"]["upper"]
                                )
                        else:
                            self.assertEqual(forecast["points"], [])
                            self.assertTrue(forecast.get("reason"))
                self.assertEqual(asset_count, expectation["assets"])
                expected_statuses = {
                    key: value for key, value in expectation.items() if key != "assets"
                }
                self.assertEqual(dict(statuses), expected_statuses)


if __name__ == "__main__":
    unittest.main()

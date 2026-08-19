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


REVIEWED_CANADA_LKG_RUN_ID = "canada-20260803T170245Z"
REVIEWED_CANADA_LKG_SERIES_COUNT = 69
FULL_CANADA_ACTIVE_SERIES_COUNT = 81


class PromotedForecastAssetTests(unittest.TestCase):
    def test_every_promoted_observed_asset_has_a_matching_forecast_record(self) -> None:
        canada_registry = json.loads(
            (PROJECT_ROOT / "config" / "series" / "canada.json").read_text(
                encoding="utf-8"
            )
        )
        active_canada_series_ids = {
            series["id"]
            for series in canada_registry["series"]
            if series.get("activation_status") == "active"
        }
        self.assertEqual(
            len(active_canada_series_ids), FULL_CANADA_ACTIVE_SERIES_COUNT
        )

        for country in ("usa", "canada"):
            with self.subTest(country=country):
                root = PROJECT_ROOT / "public" / "data" / country
                manifest = verify_public_generation(root)
                self.assertEqual(manifest["asset_build_id"], PUBLIC_ASSET_BUILD_ID)
                if country == "canada":
                    public_series_ids = {
                        series["series_id"] for series in manifest["series"]
                    }
                    public_series_count = len(manifest["series"])
                    self.assertIn(
                        public_series_count,
                        {
                            REVIEWED_CANADA_LKG_SERIES_COUNT,
                            FULL_CANADA_ACTIVE_SERIES_COUNT,
                        },
                        "Canada public data must be either the reviewed 69-series "
                        "last-known-good generation or the complete 81-series registry",
                    )
                    self.assertEqual(len(public_series_ids), public_series_count)
                    if public_series_count == REVIEWED_CANADA_LKG_SERIES_COUNT:
                        self.assertEqual(
                            manifest["run_id"], REVIEWED_CANADA_LKG_RUN_ID
                        )
                        self.assertLessEqual(
                            public_series_ids, active_canada_series_ids
                        )
                    else:
                        self.assertEqual(
                            public_series_ids, active_canada_series_ids
                        )

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
                expected_asset_count = sum(
                    1
                    for series in manifest["series"]
                    for geography in series["geographies"]
                    if geography["status"] == "available"
                )
                summary = manifest["forecast_summary"]
                self.assertEqual(statuses["ok"], int(summary["ready"]))
                self.assertEqual(
                    statuses["limited_history"], int(summary["limited_history"])
                )
                unavailable = sum(
                    count
                    for status, count in statuses.items()
                    if status not in {"ok", "limited_history"}
                )
                self.assertEqual(unavailable, int(summary["unavailable"]))
                self.assertEqual(asset_count, expected_asset_count)
                self.assertEqual(sum(statuses.values()), expected_asset_count)
                self.assertEqual(len(manifest["integrity"]), expected_asset_count * 2)


if __name__ == "__main__":
    unittest.main()

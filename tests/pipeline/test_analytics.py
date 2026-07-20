from __future__ import annotations

import json
import shutil
import sys
import unittest
import uuid
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "pipeline"))

from energy_dashboard.analytics import build_chart_asset, write_chart_asset
from energy_dashboard.contracts import Frequency, Observation


NOW = datetime(2026, 7, 19, tzinfo=UTC)


def row(period: str, value: Decimal) -> Observation:
    return Observation(
        provider_id="eia",
        series_id="usa.eia.monthly.test",
        period=period,
        geography_id="us.padd.3",
        value=value,
        unit="thousand_barrels_per_day",
        retrieved_at=NOW,
        dimensions=(("product", "crude"),),
    )


class MonthlyAnalyticsTests(unittest.TestCase):
    def setUp(self) -> None:
        rows = []
        for year in range(2014, 2026):
            for month in range(1, 13):
                rows.append(row(f"{year:04d}-{month:02d}", Decimal(year - 2000) + Decimal(month) / 10))
        for month in range(1, 4):
            rows.append(row(f"2026-{month:02d}", Decimal("30") + Decimal(month)))
        self.rows = tuple(rows)
        self.asset = build_chart_asset(self.rows, frequency=Frequency.MONTHLY, generated_at=NOW)

    def test_recent_three_years_and_baseline_exclude_displayed_years(self) -> None:
        self.assertEqual([item["year"] for item in self.asset["recent_years"]], [2024, 2025, 2026])
        baseline = self.asset["baseline"]
        self.assertEqual((baseline["start_year"], baseline["end_year"]), (2014, 2023))
        self.assertEqual(baseline["status"], "ok")
        self.assertEqual(baseline["eligible_years"], 10)
        self.assertEqual(len(baseline["eligible_year_values"]), 10)
        january = baseline["slots"][0]
        self.assertEqual(january["slot"], 1)
        self.assertEqual(january["count"], 10)

    def test_latest_deltas_distribution_and_honest_fit_label(self) -> None:
        latest = self.asset["latest"]
        self.assertEqual(latest["period"], "2026-03")
        self.assertEqual(latest["previous_period"], "2026-02")
        self.assertEqual(latest["absolute_change"], 1)
        self.assertEqual(latest["year_ago_period"], "2025-03")
        levels = self.asset["distribution"]["levels"]
        self.assertGreater(levels["count"], 30)
        self.assertEqual(levels["fit"]["status"], "candidate_diagnostic")
        self.assertIn("not a definitive", levels["fit"]["reason"])
        self.assertEqual(sum(item["count"] for item in levels["histogram"]), levels["count"])

    def test_asset_is_json_safe_and_atomic_writer_round_trips(self) -> None:
        directory = Path(__file__).parent / f"_runtime_{uuid.uuid4().hex}"
        directory.mkdir()
        self.addCleanup(shutil.rmtree, directory, True)
        path = directory / "nested" / "chart.json"
        write_chart_asset(path, self.asset)
        loaded = json.loads(path.read_text(encoding="utf-8"))
        self.assertEqual(loaded["schema_version"], "1.0.0")
        self.assertEqual(loaded["source_checksum"], self.asset["source_checksum"])


class WeeklyAnalyticsTests(unittest.TestCase):
    def test_iso_week_slots_remain_distinct_and_partial_recent_year_is_allowed(self) -> None:
        rows = []
        for year in range(2017, 2026):
            last_week = date(year, 12, 28).isocalendar().week
            for week in range(1, last_week + 1):
                period = date.fromisocalendar(year, week, 3).isoformat()
                rows.append(row(period, Decimal(year - 2000) + Decimal(week) / 100))
        for week in range(1, 11):
            rows.append(row(date.fromisocalendar(2026, week, 3).isoformat(), Decimal("40") + week))
        asset = build_chart_asset(
            rows,
            frequency=Frequency.WEEKLY,
            generated_at=NOW,
            baseline_year_count=7,
            minimum_complete_baseline_years=5,
        )
        self.assertEqual(asset["baseline"]["status"], "ok")
        slots = {item["slot"] for item in asset["baseline"]["slots"]}
        self.assertIn(52, slots)
        self.assertNotIn(53, slots, "Week 53 needs the configured minimum slot sample")
        permissive = build_chart_asset(
            rows,
            frequency=Frequency.WEEKLY,
            generated_at=NOW,
            baseline_year_count=7,
            minimum_complete_baseline_years=1,
        )
        self.assertIn(53, {item["slot"] for item in permissive["baseline"]["slots"]})
        self.assertEqual(asset["recent_years"][-1]["year"], 2026)
        self.assertEqual(len(asset["recent_years"][-1]["points"]), 10)

    def test_gaps_are_not_treated_as_period_changes(self) -> None:
        rows = (row("2025-01", Decimal("10")), row("2025-03", Decimal("30")))
        asset = build_chart_asset(
            rows,
            frequency=Frequency.MONTHLY,
            generated_at=NOW,
            minimum_complete_baseline_years=1,
        )
        self.assertEqual(asset["distribution"]["changes"]["count"], 0)
        self.assertIsNone(asset["latest"]["previous_period"])

    def test_naive_generation_timestamp_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "timezone-aware"):
            build_chart_asset(
                (row("2025-01", Decimal("10")),),
                frequency=Frequency.MONTHLY,
                generated_at=datetime(2026, 7, 19),
            )


if __name__ == "__main__":
    unittest.main()

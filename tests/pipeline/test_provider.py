from __future__ import annotations

import sys
import unittest
import io
import json
from contextlib import redirect_stdout
from datetime import UTC, datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "pipeline"))

from energy_dashboard.contracts import (
    AggregationRule,
    AggregationSpec,
    CountryCode,
    Frequency,
    GeographyAvailability,
    ProviderDefinition,
    SeriesDefinition,
)
from energy_dashboard.provider import build_dry_run_plan
from energy_dashboard.cli import main

PROJECT_ROOT = Path(__file__).resolve().parents[2]


class ProviderBoundaryTests(unittest.TestCase):
    def test_dry_run_plan_has_no_fetch_side_effect(self) -> None:
        provider = ProviderDefinition(
            id="eia",
            name="U.S. Energy Information Administration",
            public_metadata_url="https://www.eia.gov/opendata/",
            requires_secret=True,
        )
        series = SeriesDefinition(
            id="eia-weekly-utilization",
            provider_id="eia",
            dataset_id="petroleum/pnp/wiup",
            metric_id="refinery_utilization",
            title="Refinery utilization",
            country=CountryCode.USA,
            frequency=Frequency.WEEKLY,
            unit="percent",
            availability=GeographyAvailability(source_geography_ids=("padd-3",)),
            aggregation=AggregationSpec(
                AggregationRule.RATIO_OF_SUMS,
                numerator_series_id="runs",
                denominator_series_id="capacity",
            ),
            default_geography_level_id="padd",
            source_url="https://www.eia.gov/opendata/browser/petroleum/pnp/wiup",
        )
        plan = build_dry_run_plan(provider, (series,), datetime(2026, 7, 19, tzinfo=UTC))
        self.assertTrue(plan.dry_run)
        self.assertTrue(plan.requires_secret)
        self.assertEqual(plan.series_ids, (series.id,))

    def test_refresh_cli_dry_run_reads_registry_without_network_or_key(self) -> None:
        output = io.StringIO()
        with redirect_stdout(output):
            result = main(
                [
                    "refresh-eia",
                    "--dry-run",
                    "--series-registry",
                    str(Path(__file__).resolve().parents[2] / "config" / "series" / "usa.json"),
                    "--geography-registry",
                    str(Path(__file__).resolve().parents[2] / "config" / "geographies" / "usa.json"),
                ]
            )
        payload = json.loads(output.getvalue())
        self.assertEqual(result, 0)
        self.assertFalse(payload["network_calls"])
        self.assertEqual(len(payload["series"]), 39)
        planned_ids = {item["series_id"] for item in payload["series"]}
        self.assertIn("usa.eia.refined.gasoline.total.stocks.weekly", planned_ids)
        self.assertIn("usa.eia.refined.distillate.total.product_supplied.weekly", planned_ids)
        self.assertIn("usa.eia.refined.jet.kerosene_type.exports.weekly", planned_ids)

    def test_canada_cli_dry_run_plans_both_providers_without_credentials(self) -> None:
        output = io.StringIO()
        with redirect_stdout(output):
            result = main(
                [
                    "refresh-canada",
                    "--dry-run",
                    "--series-registry",
                    str(PROJECT_ROOT / "config/series/canada.json"),
                    "--geography-registry",
                    str(PROJECT_ROOT / "config/geographies/canada.json"),
                ]
            )
        payload = json.loads(output.getvalue())
        self.assertEqual(result, 0)
        self.assertFalse(payload["network_calls"])
        self.assertEqual(payload["providers"], ["statcan", "cer"])
        self.assertEqual({table["pid"] for table in payload["tables"]}, {"25100063", "25100081"})
        self.assertEqual(len(payload["series"]), 51)
        providers = {item["provider"] for item in payload["series"]}
        self.assertEqual(providers, {"statcan", "cer"})
        self.assertTrue(all(not table["credential_required"] for table in payload["tables"]))

    def test_canada_expected_periods_are_frequency_specific(self) -> None:
        with self.assertRaisesRegex(ValueError, "single selected frequency"):
            main(["refresh-canada", "--dry-run", "--expected-period", "2026-04"])

        output = io.StringIO()
        with redirect_stdout(output):
            result = main(
                [
                    "refresh-canada",
                    "--dry-run",
                    "--expected-monthly-period",
                    "2026-04",
                    "--expected-weekly-period",
                    "2026-06-16",
                ]
            )
        payload = json.loads(output.getvalue())
        self.assertEqual(result, 0)
        self.assertEqual(payload["expected_monthly_period"], "2026-04")
        self.assertEqual(payload["expected_weekly_period"], "2026-06-16")


if __name__ == "__main__":
    unittest.main()

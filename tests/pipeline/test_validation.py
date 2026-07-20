from __future__ import annotations

import json
import sys
import unittest
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "pipeline"))

from energy_dashboard.contracts import (
    AggregationRule,
    AggregationSpec,
    CountryCode,
    Frequency,
    GeographyAvailability,
    Observation,
    SeriesDefinition,
)
from energy_dashboard.validation import (
    ContractValidationError,
    find_embedded_secrets,
    validate_observation_batch,
)


def series_definition() -> SeriesDefinition:
    return SeriesDefinition(
        id="usa.eia.test",
        provider_id="eia",
        dataset_id="test",
        metric_id="test_metric",
        title="Test series",
        country=CountryCode.USA,
        frequency=Frequency.MONTHLY,
        unit="barrels",
        availability=GeographyAvailability(source_geography_ids=("usa",)),
        aggregation=AggregationSpec(AggregationRule.SUM),
        default_geography_level_id="national",
        source_url="https://www.eia.gov/opendata/",
    )


def row(value: str = "1") -> Observation:
    return Observation(
        provider_id="eia",
        series_id="usa.eia.test",
        period="2026-06",
        geography_id="usa",
        value=Decimal(value),
        unit="barrels",
        retrieved_at=datetime(2026, 7, 19, tzinfo=UTC),
    )


class ValidationTests(unittest.TestCase):
    def test_duplicate_observation_keys_fail_closed(self) -> None:
        with self.assertRaises(ContractValidationError) as context:
            validate_observation_batch(series_definition(), (row("1"), row("2")))
        self.assertEqual(context.exception.issues[0].code, "duplicate_key")

    def test_structured_secret_values_are_rejected_but_environment_names_are_allowed(self) -> None:
        self.assertEqual(find_embedded_secrets({"credential_environment_variable": "EIA_API_KEY"}), ())
        issues = find_embedded_secrets({"api_key": "replace-me-with-a-real-secret-value"})
        self.assertEqual(issues[0].code, "embedded_secret")

    def test_phase_one_registries_are_universal_and_secret_free(self) -> None:
        allowed_rules = {"sum", "ratio_of_sums", "weighted_average", "not_aggregatable"}
        geography_by_country = {}
        for geography_path in sorted((PROJECT_ROOT / "config" / "geographies").glob("*.json")):
            geography = json.loads(geography_path.read_text(encoding="utf-8"))
            self.assertEqual(find_embedded_secrets(geography), (), geography_path.name)
            levels = {item["id"]: item for item in geography["levels"]}
            nodes = {item["id"]: item for item in geography["nodes"]}
            self.assertEqual(len(levels), len(geography["levels"]))
            self.assertEqual(len(nodes), len(geography["nodes"]))
            for node in nodes.values():
                self.assertIn(node["level_id"], levels)
                self.assertTrue(set(node["parent_ids"]).issubset(nodes))
                self.assertEqual(node["country_code"], geography["country_code"])
            self.assertFalse(any(node["level_id"] == "city" for node in nodes.values()))
            geography_by_country[geography["country_code"]] = levels

        for registry_path in sorted((PROJECT_ROOT / "config" / "series").glob("*.json")):
            registry = json.loads(registry_path.read_text(encoding="utf-8"))
            self.assertEqual(find_embedded_secrets(registry), (), registry_path.name)
            known_levels = geography_by_country[registry["country_code"]]
            series_by_id = {item["id"]: item for item in registry["series"]}
            for definition in registry["series"]:
                profile_id = definition.get("geography_profile_id")
                availability = (
                    registry["geography_profiles"][profile_id]
                    if profile_id is not None
                    else definition["geography_availability"]
                )
                if profile_id is not None:
                    self.assertTrue(
                        set(availability["source_geography_level_ids"]).issubset(known_levels)
                    )
                    unsupported = {
                        item["level_id"]: item["reason"]
                        for item in availability["unsupported_levels"]
                    }
                    self.assertIn("city", unsupported)
                    self.assertTrue(unsupported["city"].strip())
                    self.assertEqual(
                        set(availability["source_geography_level_ids"]) | set(unsupported),
                        set(known_levels),
                        "Every geography level needs an available or unavailable decision: "
                        f"{definition['id']}",
                    )
                    continue
                self.assertTrue(availability["universal_control"])
                self.assertIn(definition["aggregation_rule"]["kind"], allowed_rules)
                self.assertIn(
                    definition["default_geography_level_id"],
                    availability["source_geography_level_ids"],
                )
                self.assertTrue(set(availability["source_geography_level_ids"]).issubset(known_levels))
                self.assertTrue(
                    set(availability["allowed_rollup_geography_level_ids"]).issubset(known_levels)
                )
                unsupported = {item["level_id"]: item["reason"] for item in availability["unsupported_levels"]}
                self.assertIn("city", unsupported)
                self.assertTrue(unsupported["city"].strip())
                accounted_levels = (
                    set(availability["source_geography_level_ids"])
                    | set(availability["allowed_rollup_geography_level_ids"])
                    | set(unsupported)
                )
                self.assertEqual(
                    accounted_levels,
                    set(known_levels),
                    f"Every geography level needs an available or unavailable decision: {definition['id']}",
                )
                rule = definition["aggregation_rule"]
                if rule["kind"] == "ratio_of_sums":
                    self.assertEqual(rule.get("scale"), 100)
                for reference_name in (
                    "numerator_series_id",
                    "denominator_series_id",
                    "weight_series_id",
                ):
                    if reference_name in rule:
                        self.assertIn(rule[reference_name], series_by_id)


if __name__ == "__main__":
    unittest.main()

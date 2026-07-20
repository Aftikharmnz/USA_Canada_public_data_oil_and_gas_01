from __future__ import annotations

import sys
import unittest
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "pipeline"))

from energy_dashboard.aggregation import AggregationError, roll_up
from energy_dashboard.contracts import (
    AggregationRule,
    AggregationSpec,
    CountryCode,
    GeographyAvailability,
    GeographyLevel,
    GeographyNode,
    Observation,
    ObservationStatus,
    RollupDefinition,
)
from energy_dashboard.geography import GeographyCatalog, GeographyOrigin


NOW = datetime(2026, 7, 19, tzinfo=UTC)


def observation(
    geography_id: str,
    value: str | None,
    *,
    components: tuple[tuple[str, Decimal], ...] = (),
) -> Observation:
    return Observation(
        provider_id="eia",
        series_id="refinery-utilization",
        period="2026-06",
        geography_id=geography_id,
        value=Decimal(value) if value is not None else None,
        unit="percent",
        retrieved_at=NOW,
        components=components,
    )


class GeographyContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.levels = (
            GeographyLevel("city", CountryCode.USA, "City", 0, ("state",)),
            GeographyLevel("state", CountryCode.USA, "State", 1, ("padd", "country")),
            GeographyLevel("padd", CountryCode.USA, "PADD", 2, ("country",)),
            GeographyLevel("country", CountryCode.USA, "Country", 3),
        )
        self.nodes = (
            GeographyNode("us", CountryCode.USA, "country", "United States"),
            GeographyNode("padd-3", CountryCode.USA, "padd", "PADD 3", ("us",)),
            GeographyNode("tx", CountryCode.USA, "state", "Texas", ("padd-3", "us")),
            GeographyNode("houston", CountryCode.USA, "city", "Houston", ("tx",)),
        )
        self.catalog = GeographyCatalog(self.levels, self.nodes)

    def test_filter_lists_supported_levels_and_explains_unavailable_city(self) -> None:
        rollup = RollupDefinition("us", ("padd-3",), "padd-membership-2026")
        availability = GeographyAvailability(
            source_geography_ids=("padd-3",),
            rollups=(rollup,),
            unavailable_reasons=(("city", "EIA publishes this weekly measure at PADD level."),),
        )
        decisions = {item.level_id: item for item in self.catalog.level_decisions(availability)}
        self.assertFalse(decisions["city"].supported)
        self.assertIn("PADD", decisions["city"].reason or "")
        self.assertTrue(decisions["padd"].options[0].is_finest_available)
        self.assertEqual(decisions["padd"].options[0].origin, GeographyOrigin.SOURCE)
        self.assertEqual(decisions["country"].options[0].origin, GeographyOrigin.DERIVED)

    def test_cycle_is_rejected(self) -> None:
        nodes = (
            GeographyNode("a", CountryCode.USA, "state", "A", ("b",)),
            GeographyNode("b", CountryCode.USA, "state", "B", ("a",)),
        )
        with self.assertRaisesRegex(ValueError, "cycle"):
            GeographyCatalog(self.levels, nodes)


class AggregationContractTests(unittest.TestCase):
    def setUp(self) -> None:
        self.rollup = RollupDefinition("us", ("padd-1", "padd-2"), "padd-membership-2026")

    def test_sum_requires_complete_membership_and_emits_lineage(self) -> None:
        result = roll_up(
            (observation("padd-1", "10"), observation("padd-2", "15")),
            self.rollup,
            AggregationSpec(AggregationRule.SUM),
        )
        self.assertEqual(result.observation.value, Decimal("25"))
        self.assertEqual(result.lineage.coverage, Decimal("1"))
        self.assertEqual(result.lineage.membership_version, "padd-membership-2026")

        with self.assertRaisesRegex(AggregationError, "membership mismatch"):
            roll_up(
                (observation("padd-1", "10"),),
                self.rollup,
                AggregationSpec(AggregationRule.SUM),
            )

    def test_missing_and_suppressed_values_are_not_coerced_to_zero(self) -> None:
        suppressed = Observation(
            provider_id="eia",
            series_id="refinery-utilization",
            period="2026-06",
            geography_id="padd-1",
            value=None,
            unit="percent",
            retrieved_at=NOW,
            status=ObservationStatus.SUPPRESSED_OR_WITHHELD,
        )
        self.assertIsNone(suppressed.value)
        with self.assertRaisesRegex(ValueError, "cannot carry a numeric value"):
            Observation(
                provider_id="eia",
                series_id="refinery-utilization",
                period="2026-06",
                geography_id="padd-1",
                value=Decimal("0"),
                unit="percent",
                retrieved_at=NOW,
                status=ObservationStatus.SUPPRESSED_OR_WITHHELD,
            )

    def test_utilization_is_ratio_of_sums_not_average_of_percentages(self) -> None:
        result = roll_up(
            (
                observation(
                    "padd-1",
                    "90",
                    components=(("runs", Decimal("90")), ("capacity", Decimal("100"))),
                ),
                observation(
                    "padd-2",
                    "50",
                    components=(("runs", Decimal("100")), ("capacity", Decimal("200"))),
                ),
            ),
            self.rollup,
            AggregationSpec(
                AggregationRule.RATIO_OF_SUMS,
                numerator_series_id="runs",
                denominator_series_id="capacity",
                scale=Decimal("100"),
            ),
        )
        self.assertEqual(result.observation.value, Decimal("19000") / Decimal("300"))
        self.assertNotEqual(result.observation.value, Decimal("70"))

    def test_weighted_average_and_not_aggregatable(self) -> None:
        result = roll_up(
            (
                observation("padd-1", "10", components=(("weight", Decimal("1")),)),
                observation("padd-2", "20", components=(("weight", Decimal("3")),)),
            ),
            self.rollup,
            AggregationSpec(AggregationRule.WEIGHTED_AVERAGE, weight_series_id="weight"),
        )
        self.assertEqual(result.observation.value, Decimal("17.5"))

        with self.assertRaisesRegex(AggregationError, "not aggregatable"):
            roll_up(
                (observation("padd-1", "10"), observation("padd-2", "20")),
                self.rollup,
                AggregationSpec(AggregationRule.NOT_AGGREGATABLE),
            )


if __name__ == "__main__":
    unittest.main()

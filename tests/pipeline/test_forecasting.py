from __future__ import annotations

import sys
import unittest
from dataclasses import replace
from datetime import UTC, date, datetime
from decimal import Decimal
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "pipeline"))

from energy_dashboard.contracts import Frequency, Observation, ObservationStatus
from energy_dashboard import forecasting, fundamentals
from energy_dashboard.forecasting import build_forecast_asset


NOW = datetime(2026, 7, 20, tzinfo=UTC)


def monthly_rows(count: int = 144) -> tuple[Observation, ...]:
    rows: list[Observation] = []
    year, month = 2014, 1
    for index in range(count):
        seasonal = Decimal((month % 6) - 3) / Decimal("2")
        value = Decimal("100") + Decimal(index) / Decimal("8") + seasonal
        rows.append(_row(f"{year:04d}-{month:02d}", value))
        month += 1
        if month == 13:
            year += 1
            month = 1
    return tuple(rows)


def weekly_rows(count: int = 420) -> tuple[Observation, ...]:
    start = date.fromisocalendar(2018, 1, 3)
    return tuple(
        _row(
            date.fromordinal(start.toordinal() + index * 7).isoformat(),
            Decimal("200") + Decimal(index % 52) / Decimal("5") + Decimal(index) / 100,
        )
        for index in range(count)
    )


def _row(period: str, value: Decimal) -> Observation:
    return Observation(
        provider_id="test",
        series_id="test.energy.series",
        period=period,
        geography_id="test.region",
        value=value,
        unit="thousand_barrels_per_day",
        retrieved_at=NOW,
        dimensions=(("product", "test_product"),),
    )


class ForecastAssetTests(unittest.TestCase):
    def test_monthly_forecast_has_nested_intervals_and_independent_backtest(self) -> None:
        asset = build_forecast_asset(
            monthly_rows(),
            frequency=Frequency.MONTHLY,
            generated_at=NOW,
            source_checksum="a" * 64,
            target_view_id="test.monthly.view",
        )

        self.assertEqual(asset["status"], "ok")
        self.assertEqual(asset["target_view_id"], "test.monthly.view")
        self.assertEqual(asset["training_source_checksum"], "a" * 64)
        self.assertEqual(len(asset["points"]), 3)
        self.assertGreaterEqual(
            asset["prediction_intervals"]["minimum_errors_per_horizon"], 40
        )
        self.assertEqual(asset["backtest"]["status"], "independent_holdout")
        self.assertGreater(asset["backtest"]["forecast_errors"], 0)
        for point in asset["points"]:
            intervals = point["intervals"]
            self.assertLessEqual(intervals["95"]["lower"], intervals["90"]["lower"])
            self.assertLessEqual(intervals["90"]["lower"], intervals["80"]["lower"])
            self.assertLessEqual(intervals["80"]["lower"], point["value"])
            self.assertLessEqual(point["value"], intervals["80"]["upper"])
            self.assertLessEqual(intervals["80"]["upper"], intervals["90"]["upper"])
            self.assertLessEqual(intervals["90"]["upper"], intervals["95"]["upper"])

    def test_aggregation_residuals_are_centered_aligned_and_complete(self) -> None:
        asset = build_forecast_asset(
            monthly_rows(),
            frequency=Frequency.MONTHLY,
            generated_at=NOW,
            source_checksum="7" * 64,
            target_view_id="test.monthly.view",
        )

        exported = asset["aggregation_residuals"]
        self.assertEqual(
            exported["method"], "rolling_origin_actual_minus_calibrated_point"
        )
        self.assertEqual(exported["centered_on"], "published_calibrated_point")
        self.assertEqual(
            exported["alignment_keys"], ["horizon", "target_period"]
        )
        self.assertEqual(
            exported["calibration_window"],
            asset["prediction_intervals"]["calibration_window"],
        )
        self.assertEqual(exported["sample_count"], len(exported["samples"]))
        keys = [
            (sample["horizon"], sample["target_period"])
            for sample in exported["samples"]
        ]
        self.assertEqual(keys, sorted(set(keys)))
        for point in asset["points"]:
            residuals = [
                sample["residual"]
                for sample in exported["samples"]
                if sample["horizon"] == point["horizon"]
            ]
            self.assertEqual(len(residuals), point["calibration_errors"])
            self.assertGreaterEqual(
                len(residuals),
                exported["minimum_aligned_samples_per_horizon"],
            )
            self.assertAlmostEqual(
                forecasting._quantile(sorted(residuals), 0.5), 0.0, places=9
            )

    def test_aggregation_residual_export_is_deterministic(self) -> None:
        arguments = {
            "frequency": Frequency.MONTHLY,
            "generated_at": NOW,
            "source_checksum": "8" * 64,
            "target_view_id": "test.monthly.view",
        }

        first = build_forecast_asset(monthly_rows(), **arguments)
        second = build_forecast_asset(monthly_rows(), **arguments)

        self.assertEqual(
            first["aggregation_residuals"], second["aggregation_residuals"]
        )
        self.assertEqual(first["points"], second["points"])
        self.assertEqual(first["prediction_intervals"], second["prediction_intervals"])
        self.assertEqual(first["backtest"], second["backtest"])

    def test_weekly_forecast_uses_three_horizons_and_preserves_week_coordinates(self) -> None:
        asset = build_forecast_asset(
            weekly_rows(),
            frequency=Frequency.WEEKLY,
            generated_at=NOW,
            source_checksum="b" * 64,
            target_view_id="test.weekly.view",
        )

        self.assertEqual(asset["horizon"], {"periods": 3, "unit": "weekly"})
        self.assertEqual([point["horizon"] for point in asset["points"]], [1, 2, 3])
        for point in asset["points"]:
            iso = date.fromisoformat(point["target_period"]).isocalendar()
            self.assertEqual((point["year"], point["slot"]), (iso.year, iso.week))

    def test_compact_weekly_history_can_publish_a_disclosed_limited_forecast(self) -> None:
        asset = build_forecast_asset(
            weekly_rows(164),
            frequency=Frequency.WEEKLY,
            generated_at=NOW,
            source_checksum="6" * 64,
            target_view_id="test.weekly.view",
        )

        self.assertEqual(asset["status"], "limited_history")
        self.assertEqual(len(asset["points"]), 3)
        self.assertGreaterEqual(
            asset["prediction_intervals"]["minimum_errors_per_horizon"], 40
        )
        self.assertLess(
            asset["model"]["selection_window"]["end"],
            asset["prediction_intervals"]["calibration_window"]["start"],
        )

    def test_future_holdout_does_not_change_model_selection_scores(self) -> None:
        original = monthly_rows()
        revised = (*original[:-1], _row(original[-1].period, Decimal("9999")))
        first = build_forecast_asset(
            original,
            frequency=Frequency.MONTHLY,
            generated_at=NOW,
            source_checksum="c" * 64,
            target_view_id="test.monthly.view",
        )
        second = build_forecast_asset(
            revised,
            frequency=Frequency.MONTHLY,
            generated_at=NOW,
            source_checksum="d" * 64,
            target_view_id="test.monthly.view",
        )

        self.assertEqual(first["model"], second["model"])
        self.assertNotEqual(first["backtest"]["mae"], second["backtest"]["mae"])

    def test_latest_gap_resets_training_and_fails_closed(self) -> None:
        rows = monthly_rows(100)
        short_tail = tuple(row for index, row in enumerate(rows) if index != 70)
        asset = build_forecast_asset(
            short_tail,
            frequency=Frequency.MONTHLY,
            generated_at=NOW,
            source_checksum="e" * 64,
            target_view_id="test.monthly.view",
        )
        self.assertEqual(asset["status"], "insufficient_history")
        self.assertEqual(asset["origin"]["training_observations"], 29)
        self.assertEqual(asset["points"], [])

    def test_latest_non_numeric_source_period_is_not_imputed(self) -> None:
        rows = monthly_rows()
        withheld = Observation(
            provider_id="test",
            series_id="test.energy.series",
            period="2026-01",
            geography_id="test.region",
            value=None,
            unit="thousand_barrels_per_day",
            retrieved_at=NOW,
            status=ObservationStatus.SUPPRESSED_OR_WITHHELD,
            dimensions=(("product", "test_product"),),
        )
        asset = build_forecast_asset(
            (*rows, withheld),
            frequency=Frequency.MONTHLY,
            generated_at=NOW,
            source_checksum="f" * 64,
            target_view_id="test.monthly.view",
        )
        self.assertEqual(asset["status"], "latest_source_non_numeric")
        self.assertEqual(asset["points"], [])

    def test_naive_generated_timestamp_is_rejected(self) -> None:
        with self.assertRaisesRegex(ValueError, "timezone-aware"):
            build_forecast_asset(
                monthly_rows(),
                frequency=Frequency.MONTHLY,
                generated_at=datetime(2026, 7, 20),
                source_checksum="0" * 64,
                target_view_id="test.monthly.view",
            )

    def test_selection_calibration_and_holdout_windows_are_disjoint(self) -> None:
        asset = build_forecast_asset(
            monthly_rows(),
            frequency=Frequency.MONTHLY,
            generated_at=NOW,
            source_checksum="1" * 64,
            target_view_id="test.monthly.view",
        )

        selection = asset["model"]["selection_window"]
        calibration = asset["prediction_intervals"]["calibration_window"]
        evaluation = asset["backtest"]["evaluation_window"]
        self.assertLess(selection["end"], calibration["start"])
        self.assertLess(calibration["end"], evaluation["start"])

    def test_compact_monthly_history_keeps_disjoint_evaluation_and_interval_support(self) -> None:
        asset = build_forecast_asset(
            monthly_rows(88),
            frequency=Frequency.MONTHLY,
            generated_at=NOW,
            source_checksum="5" * 64,
            target_view_id="test.monthly.view",
        )

        self.assertEqual(asset["status"], "ok")
        self.assertGreaterEqual(
            asset["prediction_intervals"]["minimum_errors_per_horizon"], 40
        )
        self.assertLess(
            asset["model"]["selection_window"]["end"],
            asset["prediction_intervals"]["calibration_window"]["start"],
        )
        self.assertLess(
            asset["prediction_intervals"]["calibration_window"]["end"],
            asset["backtest"]["evaluation_window"]["start"],
        )

    def test_seasonal_naive_skill_is_zero_against_its_calibrated_self(self) -> None:
        original_candidates = forecasting._candidate_functions
        self.addCleanup(setattr, forecasting, "_candidate_functions", original_candidates)
        forecasting._candidate_functions = lambda: {
            "seasonal_naive": forecasting._seasonal_naive
        }
        asset = build_forecast_asset(
            monthly_rows(),
            frequency=Frequency.MONTHLY,
            generated_at=NOW,
            source_checksum="2" * 64,
            target_view_id="test.monthly.view",
        )

        self.assertEqual(asset["model"]["model_id"], "seasonal_naive")
        self.assertEqual(asset["backtest"]["skill_vs_seasonal_naive"], 0)

    def test_registered_canada_trade_regime_excludes_pre_2020_values(self) -> None:
        rows = tuple(
            replace(row, series_id="can.statcan.crude.imports.monthly")
            for row in monthly_rows(180)
        )
        mutated = tuple(
            replace(row, value=Decimal("999999")) if row.period < "2020-01" else row
            for row in rows
        )
        first = build_forecast_asset(
            rows,
            frequency=Frequency.MONTHLY,
            generated_at=NOW,
            source_checksum="3" * 64,
            target_view_id="can.statcan.crude.imports.monthly",
        )
        second = build_forecast_asset(
            mutated,
            frequency=Frequency.MONTHLY,
            generated_at=NOW,
            source_checksum="4" * 64,
            target_view_id="can.statcan.crude.imports.monthly",
        )

        self.assertEqual(first["origin"]["regime_start"], "2020-01")
        self.assertEqual(first["origin"]["training_start"], "2020-01")
        self.assertEqual(first["model"], second["model"])
        self.assertEqual(first["points"], second["points"])


DISTILLATE_STOCKS = "usa.eia.refined.distillate.total.stocks.weekly"
DISTILLATE_DRIVERS = {
    "production": "usa.eia.refined.distillate.total.production.weekly",
    "imports": "usa.eia.refined.distillate.total.imports.weekly",
    "exports": "usa.eia.refined.distillate.total.exports.weekly",
    "product_supplied": "usa.eia.refined.distillate.total.product_supplied.weekly",
}
UNACCOUNTED = Decimal("5")


def _usa_row(
    series_id: str, period: str, value: Decimal | None, unit: str
) -> Observation:
    return Observation(
        provider_id="eia",
        series_id=series_id,
        period=period,
        geography_id="us",
        value=value,
        unit=unit,
        retrieved_at=NOW,
        dimensions=(("product", "test_product"),),
    )


def _weekly_periods(count: int) -> list[str]:
    start = date.fromisocalendar(2016, 1, 5)
    return [
        date.fromordinal(start.toordinal() + index * 7).isoformat()
        for index in range(count)
    ]


def _balance_fixture(count: int = 420) -> dict[
    tuple[str, str, tuple[tuple[str, str], ...]], list[Observation]
]:
    """Target stocks follow the registered identity with a constant unaccounted term."""

    periods = _weekly_periods(count)
    grouped: dict[
        tuple[str, str, tuple[tuple[str, str], ...]], list[Observation]
    ] = {}

    def seasonal_flow(role: str, index: int) -> Decimal:
        slot = index % 52
        base = {
            "production": Decimal("4800"),
            "imports": Decimal("120"),
            "exports": Decimal("1250"),
            "product_supplied": Decimal("3650"),
        }[role]
        swing = {
            "production": Decimal(slot % 13) * 4,
            "imports": Decimal(slot % 7) * 3,
            "exports": Decimal(slot % 5) * 6,
            "product_supplied": Decimal(slot % 11) * 8,
        }[role]
        return base + swing

    flows: dict[str, list[Decimal]] = {
        role: [seasonal_flow(role, index) for index in range(count)]
        for role in DISTILLATE_DRIVERS
    }
    stocks: list[Decimal] = []
    level = Decimal("120000")
    for index in range(count):
        net = (
            flows["production"][index]
            + flows["imports"][index]
            - flows["exports"][index]
            - flows["product_supplied"][index]
        )
        level = level + Decimal("7") * net + UNACCOUNTED
        stocks.append(level)

    key = (DISTILLATE_STOCKS, "us", (("product", "test_product"),))
    grouped[key] = [
        _usa_row(DISTILLATE_STOCKS, periods[index], stocks[index], "thousand_barrels")
        for index in range(count)
    ]
    for role, series_id in DISTILLATE_DRIVERS.items():
        grouped[(series_id, "us", (("product", "test_product"),))] = [
            _usa_row(series_id, periods[index], flows[role][index], "thousand_barrels_per_day")
            for index in range(count)
        ]
    return grouped


class FundamentalDriverTests(unittest.TestCase):
    def test_identity_driven_history_selects_the_fundamental_candidate(self) -> None:
        grouped = _balance_fixture()
        target_key = (DISTILLATE_STOCKS, "us", (("product", "test_product"),))
        resolved = fundamentals.resolve_fundamental_drivers(
            DISTILLATE_STOCKS, "us", grouped
        )
        self.assertIsNotNone(resolved)
        asset = build_forecast_asset(
            grouped[target_key],
            frequency=Frequency.WEEKLY,
            generated_at=NOW,
            source_checksum="a" * 64,
            target_view_id=DISTILLATE_STOCKS,
            fundamentals=resolved,
        )
        self.assertEqual(asset["status"], "ok")
        self.assertEqual(
            asset["forecast_kind"], "fundamentals_augmented_statistical_projection"
        )
        self.assertEqual(asset["model"]["model_id"], "fundamental_balance")
        self.assertEqual(asset["fundamentals"]["status"], "candidate_included")
        self.assertTrue(asset["fundamentals"]["selected"])
        self.assertEqual(len(asset["fundamentals"]["drivers"]), 4)
        self.assertEqual(len(asset["points"]), 3)
        candidate_ids = {row["model_id"] for row in asset["model"]["candidates"]}
        self.assertIn("fundamental_balance", candidate_ids)
        self.assertIn("seasonal_naive", candidate_ids)
        self.assertIn(
            "Registered fundamental drivers share the target's weekly source release; "
            "the balance identity does not close exactly, and the unaccounted term is "
            "estimated from recent history.",
            asset["limitations"],
        )
        # The identity holds exactly, so the projected path must follow it too.
        rows = grouped[target_key]
        latest = float(rows[-1].value)  # type: ignore[arg-type]
        level = latest
        for step, point in enumerate(asset["points"], start=1):
            index = len(rows) + step - 1
            slot_values = []
            probe = index - 52
            while probe >= 0 and len(slot_values) < 5:
                net = (
                    grouped[(DISTILLATE_DRIVERS["production"], "us", (("product", "test_product"),))][probe].value
                    + grouped[(DISTILLATE_DRIVERS["imports"], "us", (("product", "test_product"),))][probe].value
                    - grouped[(DISTILLATE_DRIVERS["exports"], "us", (("product", "test_product"),))][probe].value
                    - grouped[(DISTILLATE_DRIVERS["product_supplied"], "us", (("product", "test_product"),))][probe].value
                )
                slot_values.append(float(net))
                probe -= 52
            level += 7.0 * (sum(slot_values) / len(slot_values)) + float(UNACCOUNTED)
            self.assertAlmostEqual(point["value"], level, delta=1e-6)

    def test_incomplete_driver_history_withholds_the_candidate(self) -> None:
        grouped = _balance_fixture()
        exports_key = (
            DISTILLATE_DRIVERS["exports"], "us", (("product", "test_product"),)
        )
        withheld = grouped[exports_key][-1]
        grouped[exports_key][-1] = replace(
            withheld, value=None, status=ObservationStatus.SUPPRESSED_OR_WITHHELD
        )
        target_key = (DISTILLATE_STOCKS, "us", (("product", "test_product"),))
        resolved = fundamentals.resolve_fundamental_drivers(
            DISTILLATE_STOCKS, "us", grouped
        )
        self.assertIsNotNone(resolved)
        asset = build_forecast_asset(
            grouped[target_key],
            frequency=Frequency.WEEKLY,
            generated_at=NOW,
            source_checksum="b" * 64,
            target_view_id=DISTILLATE_STOCKS,
            fundamentals=resolved,
        )
        self.assertEqual(asset["status"], "ok")
        self.assertEqual(asset["forecast_kind"], "univariate_statistical_projection")
        self.assertEqual(asset["fundamentals"]["status"], "drivers_incomplete")
        self.assertIn("exports", asset["fundamentals"]["exclusion_reason"])
        candidate_ids = {row["model_id"] for row in asset["model"]["candidates"]}
        self.assertNotIn("fundamental_balance", candidate_ids)

    def test_candidate_never_reads_flows_at_or_after_the_training_cut(self) -> None:
        grouped = _balance_fixture()
        target_key = (DISTILLATE_STOCKS, "us", (("product", "test_product"),))
        values = [float(row.value) for row in grouped[target_key]]  # type: ignore[arg-type]
        clean_net = [
            float(
                grouped[(DISTILLATE_DRIVERS["production"], "us", (("product", "test_product"),))][i].value
                + grouped[(DISTILLATE_DRIVERS["imports"], "us", (("product", "test_product"),))][i].value
                - grouped[(DISTILLATE_DRIVERS["exports"], "us", (("product", "test_product"),))][i].value
                - grouped[(DISTILLATE_DRIVERS["product_supplied"], "us", (("product", "test_product"),))][i].value
            )
            for i in range(len(values))
        ]
        cut = 260
        corrupted = clean_net[:cut] + [1e15] * (len(clean_net) - cut)
        clean_function = forecasting._make_fundamental_balance(clean_net)
        corrupted_function = forecasting._make_fundamental_balance(corrupted)
        for horizon in (1, 2, 3):
            self.assertEqual(
                clean_function(values[:cut], horizon, 52, 13),
                corrupted_function(values[:cut], horizon, 52, 13),
            )

    def test_resolution_fails_closed_on_ambiguity_and_unit_drift(self) -> None:
        grouped = _balance_fixture()
        self.assertIsNone(
            fundamentals.resolve_fundamental_drivers(DISTILLATE_STOCKS, "us.padd.1", grouped)
        )
        self.assertIsNone(
            fundamentals.resolve_fundamental_drivers("test.energy.series", "us", grouped)
        )
        duplicated = dict(grouped)
        duplicated[(
            DISTILLATE_DRIVERS["imports"], "us", (("product", "other_slice"),)
        )] = grouped[(DISTILLATE_DRIVERS["imports"], "us", (("product", "test_product"),))]
        self.assertIsNone(
            fundamentals.resolve_fundamental_drivers(DISTILLATE_STOCKS, "us", duplicated)
        )
        drifted = _balance_fixture()
        exports_key = (
            DISTILLATE_DRIVERS["exports"], "us", (("product", "test_product"),)
        )
        drifted[exports_key] = [
            replace(row, unit="thousand_barrels") for row in drifted[exports_key]
        ]
        self.assertIsNone(
            fundamentals.resolve_fundamental_drivers(DISTILLATE_STOCKS, "us", drifted)
        )

    def test_mismatched_fundamentals_target_fails_closed(self) -> None:
        grouped = _balance_fixture()
        resolved = fundamentals.resolve_fundamental_drivers(
            DISTILLATE_STOCKS, "us", grouped
        )
        with self.assertRaises(ValueError):
            build_forecast_asset(
                weekly_rows(),
                frequency=Frequency.WEEKLY,
                generated_at=NOW,
                source_checksum="c" * 64,
                target_view_id="test.energy.series",
                fundamentals=resolved,
            )

    def test_gasoline_is_documented_as_excluded(self) -> None:
        self.assertIn(
            "usa.eia.refined.gasoline.total.stocks.weekly",
            fundamentals.EXCLUDED_FUNDAMENTAL_TARGETS,
        )
        self.assertNotIn(
            "usa.eia.refined.gasoline.total.stocks.weekly",
            fundamentals.REGISTERED_FUNDAMENTAL_DRIVERS,
        )


if __name__ == "__main__":
    unittest.main()

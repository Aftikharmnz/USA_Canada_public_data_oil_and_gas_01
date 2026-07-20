"""Verify and atomically promote one generated public asset directory."""

from __future__ import annotations

import hashlib
import json
import math
import shutil
import uuid
from collections import Counter
from datetime import date, datetime, timedelta
from pathlib import Path
from typing import Any, Mapping

from .analytics import ASSET_SCHEMA_VERSION
from .forecasting import (
    FORECAST_INTERVAL_LEVELS,
    FORECAST_KINDS,
    FORECAST_METHODOLOGY_VERSION,
    FORECAST_SCHEMA_VERSION,
    MINIMUM_CALIBRATION_ERRORS_PER_HORIZON,
    PUBLIC_ASSET_BUILD_ID,
)
from .storage import SnapshotStore, replace_path_with_retry


_READY_FORECAST_STATUSES = {"ok", "limited_history"}
_KNOWN_FORECAST_STATUSES = {
    *_READY_FORECAST_STATUSES,
    "latest_source_non_numeric",
    "insufficient_history",
    "unsupported_frequency",
}


def _move_directory_with_windows_fallback(source: Path, destination: Path) -> None:
    """Move a validated directory, with a recoverable Windows copy fallback."""

    try:
        replace_path_with_retry(source, destination)
        return
    except PermissionError:
        if destination.exists():
            raise
    try:
        shutil.copytree(source, destination)
        shutil.rmtree(source)
    except Exception:
        if destination.exists():
            shutil.rmtree(destination)
        raise


def verify_public_generation(
    public_root: Path,
    *,
    expected_run_id: str | None = None,
) -> Mapping[str, Any]:
    manifest_path = public_root / "manifest.json"
    manifest_bytes = manifest_path.read_bytes()
    _reject_public_secrets(manifest_bytes, manifest_path)
    manifest = json.loads(manifest_bytes)
    if not isinstance(manifest, Mapping):
        raise ValueError("Public manifest must be an object")
    if manifest.get("schema_version") != ASSET_SCHEMA_VERSION:
        raise ValueError("Public manifest schema version is unsupported")
    if expected_run_id is not None and manifest.get("run_id") != expected_run_id:
        raise ValueError("Public manifest run_id does not match the requested generation")
    series = manifest.get("series")
    integrity = manifest.get("integrity")
    if not isinstance(series, list) or not series:
        raise ValueError("Public manifest must contain at least one series")
    if not isinstance(integrity, Mapping):
        raise ValueError("Public manifest integrity map is required")
    forecast_methodology = manifest.get("forecast_methodology_version")
    forecast_summary = manifest.get("forecast_summary")
    asset_build_id = manifest.get("asset_build_id")
    forecast_advertised = (
        forecast_methodology is not None
        or forecast_summary is not None
        or (isinstance(asset_build_id, str) and "_forecast-" in asset_build_id)
    )
    if forecast_advertised:
        if not isinstance(forecast_methodology, str) or not forecast_methodology:
            raise ValueError("Forecast-enabled manifests require a methodology version")
        if not isinstance(forecast_summary, Mapping):
            raise ValueError("Forecast-enabled manifests require a forecast summary")
        if (
            forecast_methodology == FORECAST_METHODOLOGY_VERSION
            and asset_build_id != PUBLIC_ASSET_BUILD_ID
        ):
            raise ValueError("Current forecast methodology requires the current asset build id")
        if (
            asset_build_id == PUBLIC_ASSET_BUILD_ID
            and forecast_methodology != FORECAST_METHODOLOGY_VERSION
        ):
            raise ValueError("Current asset build id requires the current forecast methodology")
    referenced: set[str] = set()
    forecast_statuses: Counter[str] = Counter()
    root_resolved = public_root.resolve()
    for series_item in series:
        if not isinstance(series_item, Mapping) or not isinstance(series_item.get("geographies"), list):
            raise ValueError("Each public manifest series must contain geographies")
        series_id = series_item.get("series_id")
        view_id = series_item.get("view_id")
        if not isinstance(series_id, str) or not series_id:
            raise ValueError("Each public manifest series must have a series_id")
        if forecast_advertised and (not isinstance(view_id, str) or not view_id):
            raise ValueError("Forecast-enabled series must have a view_id")
        for geography in series_item["geographies"]:
            if not isinstance(geography, Mapping) or geography.get("status") != "available":
                continue
            asset_path = geography.get("asset_path")
            if not isinstance(asset_path, str) or not asset_path:
                raise ValueError("Every available geography must reference an asset_path")
            observed = _load_verified_json_asset(
                public_root,
                root_resolved,
                integrity,
                geography,
                public_path=asset_path,
                sha_field="asset_sha256",
                bytes_field="asset_bytes",
                referenced=referenced,
            )
            _validate_observed_asset(observed, series_item, geography, asset_path)
            forecast_path = geography.get("forecast_path")
            if forecast_advertised and forecast_path is None:
                raise ValueError("Every available geography requires a forecast_path")
            if forecast_path is None:
                continue
            if not isinstance(forecast_path, str) or not forecast_path:
                raise ValueError("forecast_path must be a non-empty local path")
            forecast = _load_verified_json_asset(
                public_root,
                root_resolved,
                integrity,
                geography,
                public_path=forecast_path,
                sha_field="forecast_sha256",
                bytes_field="forecast_bytes",
                referenced=referenced,
            )
            status = _validate_forecast_asset(
                forecast,
                observed,
                series_item,
                geography,
                methodology=forecast_methodology,
                public_path=forecast_path,
            )
            forecast_statuses[status] += 1
    if referenced != set(str(key) for key in integrity):
        raise ValueError("Public integrity map and referenced assets do not match")
    if forecast_advertised:
        expected_summary = {
            "ready": forecast_statuses["ok"],
            "limited_history": forecast_statuses["limited_history"],
            "unavailable": sum(
                count
                for status, count in forecast_statuses.items()
                if status not in _READY_FORECAST_STATUSES
            ),
        }
        if any(forecast_summary.get(key) != value for key, value in expected_summary.items()):
            raise ValueError("Forecast summary does not match referenced forecast statuses")
    return manifest


def _load_verified_json_asset(
    public_root: Path,
    root_resolved: Path,
    integrity: Mapping[str, Any],
    geography: Mapping[str, Any],
    *,
    public_path: str,
    sha_field: str,
    bytes_field: str,
    referenced: set[str],
) -> Mapping[str, Any]:
    if public_path in referenced:
        raise ValueError(f"Public asset is referenced more than once: {public_path!r}")
    relative = Path(public_path)
    if relative.is_absolute() or ".." in relative.parts or ":" in public_path:
        raise ValueError(f"Unsafe public asset path: {public_path!r}")
    asset = (public_root / relative).resolve(strict=True)
    if (
        not asset.is_relative_to(root_resolved)
        or not asset.is_file()
        or asset.is_symlink()
    ):
        raise ValueError(f"Public asset escapes generation root: {public_path!r}")
    evidence = integrity.get(public_path)
    if not isinstance(evidence, Mapping):
        raise ValueError(f"Missing integrity evidence for {public_path!r}")
    payload = asset.read_bytes()
    _reject_public_secrets(payload, asset)
    digest = hashlib.sha256(payload).hexdigest()
    if digest != evidence.get("sha256"):
        raise ValueError(f"Public asset checksum mismatch: {public_path!r}")
    if len(payload) != evidence.get("bytes"):
        raise ValueError(f"Public asset byte count mismatch: {public_path!r}")
    if geography.get(sha_field) != digest:
        raise ValueError(f"Manifest {sha_field} mismatch: {public_path!r}")
    if geography.get(bytes_field) != len(payload):
        raise ValueError(f"Manifest {bytes_field} mismatch: {public_path!r}")
    try:
        parsed = json.loads(payload)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"Public asset is not valid JSON: {public_path!r}") from exc
    if not isinstance(parsed, Mapping):
        raise ValueError(f"Public asset must be a JSON object: {public_path!r}")
    _reject_nonfinite_numbers(parsed, public_path)
    referenced.add(public_path)
    return parsed


def _validate_observed_asset(
    observed: Mapping[str, Any],
    series: Mapping[str, Any],
    geography: Mapping[str, Any],
    public_path: str,
) -> None:
    if observed.get("schema_version") != ASSET_SCHEMA_VERSION:
        raise ValueError(f"Observed asset schema version is unsupported: {public_path!r}")
    expected = {
        "series_id": series.get("series_id"),
        "geography_id": geography.get("geography_id"),
        "frequency": series.get("frequency"),
        "unit": series.get("unit"),
    }
    if any(observed.get(field) != value for field, value in expected.items()):
        raise ValueError(f"Observed asset identity does not match manifest: {public_path!r}")
    if not isinstance(observed.get("dimensions"), Mapping):
        raise ValueError(f"Observed asset dimensions must be an object: {public_path!r}")
    checksum = observed.get("source_checksum")
    if (
        not isinstance(checksum, str)
        or len(checksum) != 64
        or any(character not in "0123456789abcdef" for character in checksum.lower())
    ):
        raise ValueError(f"Observed asset source_checksum is invalid: {public_path!r}")


def _validate_forecast_asset(
    forecast: Mapping[str, Any],
    observed: Mapping[str, Any],
    series: Mapping[str, Any],
    geography: Mapping[str, Any],
    *,
    methodology: Any,
    public_path: str,
) -> str:
    if forecast.get("schema_version") != FORECAST_SCHEMA_VERSION:
        raise ValueError(f"Forecast asset schema version is unsupported: {public_path!r}")
    expected = {
        "target_view_id": series.get("view_id"),
        "target_series_id": observed.get("series_id"),
        "geography_id": geography.get("geography_id"),
        "frequency": observed.get("frequency"),
        "unit": observed.get("unit"),
        "training_source_checksum": observed.get("source_checksum"),
        "methodology_version": methodology,
    }
    if any(forecast.get(field) != value for field, value in expected.items()):
        raise ValueError(f"Forecast asset identity or checksum does not match: {public_path!r}")
    if forecast.get("dimensions") != observed.get("dimensions"):
        raise ValueError(f"Forecast dimensions do not match observed asset: {public_path!r}")
    if forecast.get("frequency") not in {"weekly", "monthly"}:
        raise ValueError(f"Forecast frequency is unsupported: {public_path!r}")
    if forecast.get("forecast_kind") not in FORECAST_KINDS:
        raise ValueError(f"Forecast kind is unsupported: {public_path!r}")
    _require_timestamp(forecast.get("generated_at"), public_path, "generated_at")
    limitations = forecast.get("limitations")
    if not isinstance(limitations, list) or any(
        not isinstance(item, str) or not item for item in limitations
    ):
        raise ValueError(f"Forecast limitations are invalid: {public_path!r}")
    status = forecast.get("status")
    if status not in _KNOWN_FORECAST_STATUSES:
        raise ValueError(f"Forecast status is unsupported: {public_path!r}")
    points = forecast.get("points")
    if not isinstance(points, list):
        raise ValueError(f"Forecast points must be an array: {public_path!r}")
    origin = forecast.get("origin")
    if not isinstance(origin, Mapping):
        raise ValueError(f"Forecast origin must be an object: {public_path!r}")
    training_observations = origin.get("training_observations")
    if (
        not isinstance(training_observations, int)
        or isinstance(training_observations, bool)
        or training_observations < 0
    ):
        raise ValueError(f"Forecast training count is invalid: {public_path!r}")
    if status not in _READY_FORECAST_STATUSES:
        if points:
            raise ValueError(f"Unavailable forecast must not contain points: {public_path!r}")
        if not isinstance(forecast.get("reason"), str) or not forecast.get("reason"):
            raise ValueError(f"Unavailable forecast requires reason text: {public_path!r}")
        return str(status)

    horizon = forecast.get("horizon")
    model = forecast.get("model")
    intervals = forecast.get("prediction_intervals")
    backtest = forecast.get("backtest")
    if not all(
        isinstance(item, Mapping)
        for item in (horizon, origin, model, intervals, backtest)
    ):
        raise ValueError(f"Ready forecast metadata is incomplete: {public_path!r}")
    periods = horizon.get("periods")
    if not isinstance(periods, int) or isinstance(periods, bool) or periods < 1:
        raise ValueError(f"Forecast horizon is invalid: {public_path!r}")
    if methodology == FORECAST_METHODOLOGY_VERSION and periods != 3:
        raise ValueError(f"Current forecast methodology requires three periods: {public_path!r}")
    if horizon.get("unit") != observed.get("frequency"):
        raise ValueError(f"Forecast horizon unit does not match frequency: {public_path!r}")
    origin_period = origin.get("period")
    if not _finite_number(origin.get("value")) or not isinstance(origin_period, str):
        raise ValueError(f"Forecast origin is invalid: {public_path!r}")
    _period_coordinate(origin_period, str(observed.get("frequency")), public_path)
    if origin.get("data_vintage_id") != forecast.get("training_source_checksum"):
        raise ValueError(f"Forecast origin vintage does not match checksum: {public_path!r}")
    if (
        not isinstance(origin.get("training_observations"), int)
        or isinstance(origin.get("training_observations"), bool)
        or origin.get("training_observations") < 1
    ):
        raise ValueError(f"Forecast training count is invalid: {public_path!r}")
    _require_timestamp(origin.get("generated_at"), public_path, "origin.generated_at")
    _require_timestamp(
        origin.get("information_cutoff"), public_path, "origin.information_cutoff"
    )
    regime_start = origin.get("regime_start")
    if regime_start is not None:
        if not isinstance(regime_start, str) or regime_start > origin_period:
            raise ValueError(f"Forecast regime start is invalid: {public_path!r}")
        _period_coordinate(regime_start, str(observed.get("frequency")), public_path)
    if (
        not isinstance(model.get("model_id"), str)
        or not model.get("model_id")
        or not isinstance(model.get("label"), str)
        or not model.get("label")
        or model.get("selection_method") != "rolling_origin_minimum_mae"
        or not isinstance(model.get("candidates"), list)
        or not model.get("candidates")
    ):
        raise ValueError(f"Forecast model metadata is invalid: {public_path!r}")
    if len(points) != periods or [point.get("horizon") for point in points] != list(
        range(1, periods + 1)
    ):
        raise ValueError(f"Forecast path is incomplete: {public_path!r}")

    expected_levels = [str(level) for level in FORECAST_INTERVAL_LEVELS]
    calibration_counts: list[int] = []
    calibration_support_by_horizon: dict[int, int] = {}
    target_periods: list[str] = []
    for point in points:
        if not isinstance(point, Mapping):
            raise ValueError(f"Forecast point must be an object: {public_path!r}")
        if not isinstance(point.get("target_period"), str) or not point.get("target_period"):
            raise ValueError(f"Forecast target period is invalid: {public_path!r}")
        target_periods.append(str(point["target_period"]))
        expected_year, expected_slot = _period_coordinate(
            str(point["target_period"]), str(observed.get("frequency")), public_path
        )
        if point.get("year") != expected_year or point.get("slot") != expected_slot:
            raise ValueError(f"Forecast seasonal coordinate is invalid: {public_path!r}")
        value = point.get("value")
        point_intervals = point.get("intervals")
        support = point.get("calibration_errors")
        if not _finite_number(value) or not isinstance(point_intervals, Mapping):
            raise ValueError(f"Forecast point is non-finite or incomplete: {public_path!r}")
        if set(str(key) for key in point_intervals) != set(expected_levels):
            raise ValueError(f"Forecast interval levels are incomplete: {public_path!r}")
        if not isinstance(support, int) or isinstance(support, bool) or support < 1:
            raise ValueError(f"Forecast calibration support is invalid: {public_path!r}")
        calibration_counts.append(support)
        calibration_support_by_horizon[int(point["horizon"])] = support
        bounds: dict[str, tuple[float, float]] = {}
        for level in expected_levels:
            interval = point_intervals.get(level)
            if not isinstance(interval, Mapping):
                raise ValueError(f"Forecast interval is invalid: {public_path!r}")
            lower, upper = interval.get("lower"), interval.get("upper")
            if not _finite_number(lower) or not _finite_number(upper):
                raise ValueError(f"Forecast interval is non-finite: {public_path!r}")
            bounds[level] = (float(lower), float(upper))
        numeric = float(value)
        if not (
            bounds["95"][0]
            <= bounds["90"][0]
            <= bounds["80"][0]
            <= numeric
            <= bounds["80"][1]
            <= bounds["90"][1]
            <= bounds["95"][1]
        ):
            raise ValueError(f"Forecast intervals are not nested around the point: {public_path!r}")
    if target_periods != sorted(set(target_periods)):
        raise ValueError(f"Forecast target periods must be unique and ordered: {public_path!r}")
    expected_period = _next_period(
        origin_period, str(observed.get("frequency")), public_path
    )
    for target_period in target_periods:
        if target_period != expected_period:
            raise ValueError(f"Forecast target periods are not consecutive: {public_path!r}")
        expected_period = _next_period(
            expected_period, str(observed.get("frequency")), public_path
        )

    if intervals.get("levels") != list(FORECAST_INTERVAL_LEVELS):
        raise ValueError(f"Forecast interval metadata levels are invalid: {public_path!r}")
    if (
        intervals.get("method") != "empirical_rolling_origin_residual_quantiles"
        or intervals.get("coverage_guarantee") is not False
        or not isinstance(intervals.get("calibration_window"), Mapping)
    ):
        raise ValueError(f"Forecast interval metadata is invalid: {public_path!r}")
    minimum_support = intervals.get("minimum_errors_per_horizon")
    if minimum_support != min(calibration_counts):
        raise ValueError(f"Forecast calibration metadata does not match points: {public_path!r}")
    if (
        methodology == FORECAST_METHODOLOGY_VERSION
        and minimum_support < MINIMUM_CALIBRATION_ERRORS_PER_HORIZON
    ):
        raise ValueError(f"Forecast calibration support is below policy: {public_path!r}")
    aggregation_residuals = forecast.get("aggregation_residuals")
    if methodology == FORECAST_METHODOLOGY_VERSION and not isinstance(
        aggregation_residuals, Mapping
    ):
        raise ValueError(
            f"Current forecast methodology requires aggregation residuals: {public_path!r}"
        )
    if isinstance(aggregation_residuals, Mapping):
        _validate_aggregation_residuals(
            aggregation_residuals,
            intervals=intervals,
            periods=periods,
            frequency=str(observed.get("frequency")),
            support_by_horizon=calibration_support_by_horizon,
            public_path=public_path,
        )
    expected_backtest = "independent_holdout" if status == "ok" else "not_available"
    if (
        backtest.get("status") != expected_backtest
        or backtest.get("evaluation_mode") != "latest_revised_pseudo_out_of_sample"
    ):
        raise ValueError(f"Forecast status and backtest status disagree: {public_path!r}")
    return str(status)


def _validate_aggregation_residuals(
    residuals: Mapping[str, Any],
    *,
    intervals: Mapping[str, Any],
    periods: int,
    frequency: str,
    support_by_horizon: Mapping[int, int],
    public_path: str,
) -> None:
    if (
        residuals.get("method")
        != "rolling_origin_actual_minus_calibrated_point"
        or residuals.get("centered_on") != "published_calibrated_point"
        or residuals.get("usage") != "additive_component_alignment_only"
        or residuals.get("alignment_keys") != ["horizon", "target_period"]
        or residuals.get("calibration_window") != intervals.get("calibration_window")
        or residuals.get("minimum_aligned_samples_per_horizon")
        != MINIMUM_CALIBRATION_ERRORS_PER_HORIZON
    ):
        raise ValueError(f"Forecast aggregation residual metadata is invalid: {public_path!r}")
    samples = residuals.get("samples")
    if not isinstance(samples, list) or residuals.get("sample_count") != len(samples):
        raise ValueError(f"Forecast aggregation residual samples are invalid: {public_path!r}")
    calibration_window = residuals.get("calibration_window")
    if not isinstance(calibration_window, Mapping):
        raise ValueError(f"Forecast aggregation residual window is invalid: {public_path!r}")
    start = calibration_window.get("start")
    end = calibration_window.get("end")
    if not isinstance(start, str) or not isinstance(end, str) or start > end:
        raise ValueError(f"Forecast aggregation residual window is invalid: {public_path!r}")
    _period_coordinate(start, frequency, public_path)
    _period_coordinate(end, frequency, public_path)

    keys: list[tuple[int, str]] = []
    counts: Counter[int] = Counter()
    for sample in samples:
        if not isinstance(sample, Mapping):
            raise ValueError(
                f"Forecast aggregation residual sample must be an object: {public_path!r}"
            )
        horizon = sample.get("horizon")
        target_period = sample.get("target_period")
        if (
            not isinstance(horizon, int)
            or isinstance(horizon, bool)
            or not 1 <= horizon <= periods
            or not isinstance(target_period, str)
            or not target_period
            or not _finite_number(sample.get("residual"))
        ):
            raise ValueError(f"Forecast aggregation residual sample is invalid: {public_path!r}")
        _period_coordinate(target_period, frequency, public_path)
        if not start <= target_period <= end:
            raise ValueError(
                f"Forecast aggregation residual target is outside calibration: {public_path!r}"
            )
        keys.append((horizon, target_period))
        counts[horizon] += 1
    if keys != sorted(set(keys)):
        raise ValueError(
            f"Forecast aggregation residual keys must be unique and ordered: {public_path!r}"
        )
    if any(counts[horizon] != support_by_horizon.get(horizon) for horizon in range(1, periods + 1)):
        raise ValueError(
            f"Forecast aggregation residual support does not match points: {public_path!r}"
        )


def _finite_number(value: Any) -> bool:
    return (
        isinstance(value, (int, float))
        and not isinstance(value, bool)
        and math.isfinite(float(value))
    )


def _reject_nonfinite_numbers(value: Any, public_path: str) -> None:
    if isinstance(value, float) and not math.isfinite(value):
        raise ValueError(f"Public asset contains a non-finite number: {public_path!r}")
    if isinstance(value, Mapping):
        for item in value.values():
            _reject_nonfinite_numbers(item, public_path)
    elif isinstance(value, list):
        for item in value:
            _reject_nonfinite_numbers(item, public_path)


def _require_timestamp(value: Any, public_path: str, field: str) -> None:
    if not isinstance(value, str) or not value:
        raise ValueError(f"Forecast {field} is invalid: {public_path!r}")
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError as exc:
        raise ValueError(f"Forecast {field} is invalid: {public_path!r}") from exc
    if parsed.tzinfo is None or parsed.utcoffset() is None:
        raise ValueError(f"Forecast {field} must be timezone-aware: {public_path!r}")


def _period_coordinate(
    period: str, frequency: str, public_path: str
) -> tuple[int, int]:
    try:
        if frequency == "monthly":
            if len(period) != 7 or period[4] != "-":
                raise ValueError
            year, month = (int(part) for part in period.split("-"))
            if not 1 <= month <= 12:
                raise ValueError
            return year, month
        if frequency == "weekly":
            if len(period) != 10 or period[4] != "-" or period[7] != "-":
                raise ValueError
            parsed = date.fromisoformat(period)
            iso = parsed.isocalendar()
            return iso.year, iso.week
    except ValueError:
        pass
    raise ValueError(f"Forecast period is invalid for its frequency: {public_path!r}")


def _next_period(period: str, frequency: str, public_path: str) -> str:
    year, slot = _period_coordinate(period, frequency, public_path)
    if frequency == "weekly":
        return (date.fromisoformat(period) + timedelta(days=7)).isoformat()
    month = slot + 1
    if month == 13:
        year += 1
        month = 1
    return f"{year:04d}-{month:02d}"


def promote_current_public_generation(
    store: SnapshotStore,
    destination: Path,
    *,
    expected_run_id: str | None = None,
) -> Path:
    """Copy, re-verify, then switch a destination directory with rollback on failure."""

    current_run_id = store.current_run_id()
    if current_run_id is None:
        raise ValueError("Snapshot store has no current generation")
    if expected_run_id is not None and expected_run_id != current_run_id:
        raise ValueError("Current generation does not match expected_run_id")
    source = store.generations / current_run_id / "public"
    verify_public_generation(source, expected_run_id=current_run_id)
    destination = destination.resolve()
    parent = destination.parent
    if destination == parent or not destination.name:
        raise ValueError("Promotion destination must be a specific directory")
    if destination.exists() and not destination.is_dir():
        raise ValueError("Promotion destination exists and is not a directory")
    parent.mkdir(parents=True, exist_ok=True)
    stage = parent / f".{destination.name}.staging-{uuid.uuid4().hex}"
    backup = parent / f".{destination.name}.backup-{uuid.uuid4().hex}"
    shutil.copytree(source, stage)
    replaced_existing = False
    try:
        verify_public_generation(stage, expected_run_id=current_run_id)
        if destination.exists():
            _move_directory_with_windows_fallback(destination, backup)
            replaced_existing = True
        try:
            _move_directory_with_windows_fallback(stage, destination)
            verify_public_generation(destination, expected_run_id=current_run_id)
        except Exception:
            if destination.exists():
                shutil.rmtree(destination)
            if replaced_existing and backup.exists():
                _move_directory_with_windows_fallback(backup, destination)
            raise
        if backup.exists():
            shutil.rmtree(backup)
        return destination / "manifest.json"
    finally:
        if stage.exists():
            shutil.rmtree(stage)


def _reject_public_secrets(payload: bytes, path: Path) -> None:
    lowered = payload.lower()
    forbidden = (b"api_key=", b'"api_key"', b'"eia_api_key"', b"authorization: bearer")
    if any(marker in lowered for marker in forbidden):
        raise ValueError(f"Credential-like material found in public asset {path.name!r}")

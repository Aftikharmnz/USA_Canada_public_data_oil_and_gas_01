"""Thin orchestration from verified EIA registries to one atomic public generation."""

from __future__ import annotations

import hashlib
import json
import re
from collections import defaultdict
from collections.abc import Iterable, Mapping
from dataclasses import dataclass, replace
from datetime import UTC, date, datetime, timedelta
from pathlib import Path
from typing import Any, Protocol

from .analytics import ASSET_SCHEMA_VERSION, build_chart_asset, write_chart_asset
from .contracts import Frequency, Observation
from .eia import EIAFetchResult, EIAQuerySpec
from .forecasting import (
    FORECAST_METHODOLOGY_VERSION,
    PUBLIC_ASSET_BUILD_ID,
    build_forecast_asset,
)
from .fundamentals import resolve_fundamental_drivers
from .promotion import verify_public_generation
from .registry import ProviderGeographyIndex, RegistryEIASeries, normalize_eia_records
from .storage import CanonicalSnapshot, MergeResult, SnapshotStore, merge_canonical


_SAFE_SEGMENT = re.compile(r"[^a-zA-Z0-9._-]+")


class EIAFetcher(Protocol):
    def fetch(self, spec: EIAQuerySpec) -> EIAFetchResult: ...


@dataclass(frozen=True, slots=True)
class PeriodWindow:
    start: str | None = None
    end: str | None = None
    expected_period: str | None = None


@dataclass(frozen=True, slots=True)
class RefreshRunResult:
    run_id: str
    generation_path: Path
    inserted_rows: int
    revised_rows: int
    unchanged_rows: int
    asset_count: int
    public_manifest_path: Path
    changed: bool = True


def run_eia_refresh(
    series_specs: tuple[RegistryEIASeries, ...],
    geographies: ProviderGeographyIndex,
    clients_by_environment_variable: Mapping[str, EIAFetcher],
    store: SnapshotStore,
    *,
    run_id: str,
    generated_at: datetime,
    period_windows: Mapping[str, PeriodWindow] | None = None,
    skip_unchanged: bool = True,
    manifest_series_specs: tuple[RegistryEIASeries, ...] | None = None,
) -> RefreshRunResult:
    """Fetch all selected series and publish only if every validation/build succeeds."""

    if generated_at.tzinfo is None or generated_at.utcoffset() is None:
        raise ValueError("generated_at must be timezone-aware")
    if not series_specs:
        raise ValueError("At least one EIA series is required")
    ids = [spec.id for spec in series_specs]
    if len(ids) != len(set(ids)):
        raise ValueError("Refresh series ids must be unique")
    windows = period_windows or {}
    unknown_windows = set(windows) - set(ids)
    if unknown_windows:
        raise ValueError(f"Period windows reference unknown series: {sorted(unknown_windows)}")

    manifest_specs = manifest_series_specs or series_specs
    manifest_ids = [spec.id for spec in manifest_specs]
    if len(manifest_ids) != len(set(manifest_ids)):
        raise ValueError("Manifest series ids must be unique")
    if not set(ids).issubset(manifest_ids):
        raise ValueError("Every fetched series must be included in manifest_series_specs")
    previous_run_id = store.current_run_id()
    previous = store.load_current() or CanonicalSnapshot(())
    previous_freshness: dict[str, Mapping[str, object]] = {}
    if previous_run_id is not None:
        previous_manifest_path = store.generations / previous_run_id / "public" / "manifest.json"
        if previous_manifest_path.is_file():
            previous_manifest = json.loads(previous_manifest_path.read_text(encoding="utf-8"))
            previous_freshness = {
                str(item["series_id"]): item.get("freshness", {})
                for item in previous_manifest.get("series", [])
                if isinstance(item, Mapping) and item.get("series_id")
            }
    candidate = previous
    inserted = revised = unchanged = 0
    fetch_summaries: list[dict[str, object]] = []
    for spec in sorted(series_specs, key=lambda item: item.id):
        client = clients_by_environment_variable.get(spec.credential_environment_variable)
        if client is None:
            raise ValueError(
                f"No EIA client configured for environment variable {spec.credential_environment_variable}"
            )
        window = windows.get(spec.id, PeriodWindow())
        start = window.start if window.start is not None else spec.query.start
        if start is None:
            existing_periods = [
                row.period for row in previous.observations if row.series_id == spec.id
            ]
            if existing_periods:
                start = default_overlap_start(spec.frequency, max(existing_periods))
            else:
                start = spec.bootstrap_start
        end = window.end if window.end is not None else spec.query.end
        query = replace(spec.query, start=start, end=end)
        fetched = client.fetch(query)
        if fetched.route != spec.route:
            raise ValueError(f"Fetcher route mismatch for {spec.id}")
        rows = normalize_eia_records(spec, fetched.records, geographies, retrieved_at=generated_at)
        merged: MergeResult = merge_canonical(
            candidate,
            rows,
            detected_at=generated_at,
            payload_hash=fetched.payload_sha256,
        )
        candidate = merged.snapshot
        inserted += len(merged.inserted_keys)
        revised += len(merged.revised_keys)
        unchanged += len(merged.unchanged_keys)
        fetch_summaries.append(
            {
                "series_id": spec.id,
                "route": spec.route,
                "rows": len(rows),
                "source_total": fetched.total,
                "request_count": fetched.request_count,
                "payload_sha256": fetched.payload_sha256,
            }
        )

    if skip_unchanged and inserted == 0 and revised == 0 and previous_run_id is not None:
        generation_path = store.generations / previous_run_id
        public_manifest_path = generation_path / "public" / "manifest.json"
        if not public_manifest_path.is_file():
            raise ValueError("Current last-known-good generation has no public manifest")
        current_manifest = json.loads(public_manifest_path.read_text(encoding="utf-8"))
        current_manifest_ids = {
            str(item.get("series_id"))
            for item in current_manifest.get("series", [])
            if isinstance(item, Mapping) and item.get("series_id")
        }
        expected_manifest_ids = {spec.id for spec in manifest_specs}
        if (
            current_manifest_ids == expected_manifest_ids
            and current_manifest.get("asset_build_id") == PUBLIC_ASSET_BUILD_ID
            and not _explicit_freshness_would_change(
                candidate, series_specs, windows, previous_freshness
            )
        ):
            asset_count = sum(
                1
                for series in current_manifest.get("series", [])
                for geography in series.get("geographies", [])
                if geography.get("status") == "available" and geography.get("asset_path")
            )
            return RefreshRunResult(
                run_id=previous_run_id,
                generation_path=generation_path,
                inserted_rows=0,
                revised_rows=0,
                unchanged_rows=unchanged,
                asset_count=asset_count,
                public_manifest_path=public_manifest_path,
                changed=False,
            )

    candidate = CanonicalSnapshot(
        observations=candidate.observations,
        revisions=candidate.revisions,
        metadata=(
            ("generated_at", generated_at.astimezone(UTC).isoformat()),
            ("run_id", run_id),
        ),
    )
    specs_by_id = {spec.id: spec for spec in manifest_specs}
    fetched_ids = set(ids)
    grouped: dict[tuple[str, str, tuple[tuple[str, str], ...]], list[Observation]] = defaultdict(list)
    for row in candidate.observations:
        if row.series_id in specs_by_id:
            grouped[(row.series_id, row.geography_id, tuple(sorted(row.dimensions)))].append(row)
    missing_manifest_series = set(specs_by_id) - {key[0] for key in grouped}
    if missing_manifest_series:
        raise ValueError(
            "Public manifest cannot drop active series without canonical history: "
            f"{sorted(missing_manifest_series)}. Run a full bootstrap first."
        )
    assets: list[
        tuple[str, dict[str, Any], dict[str, Any], RegistryEIASeries]
    ] = []
    seen_series_geographies: set[tuple[str, str]] = set()
    for (series_id, geography_id, dimensions), rows in sorted(grouped.items()):
        spec = specs_by_id[series_id]
        series_geography = (series_id, geography_id)
        if series_geography in seen_series_geographies:
            raise ValueError(
                f"Frontend manifest cannot select multiple dimension slices for {series_id}/{geography_id}"
            )
        seen_series_geographies.add(series_geography)
        latest_numeric = max((row for row in rows if row.value is not None), key=lambda row: row.period)
        expected_period = windows.get(series_id, PeriodWindow()).expected_period
        prior_freshness = previous_freshness.get(series_id, {})
        if series_id not in fetched_ids:
            freshness_status = str(prior_freshness.get("status", "unknown"))
        else:
            freshness_status = (
                "unknown"
                if expected_period is None
                else "fresh"
                if any(row.period == expected_period and row.value is not None for row in rows)
                else "due"
            )
        freshness = {
            "status": freshness_status,
            "latest_period": latest_numeric.period,
            "expected_period": expected_period,
            "retrieved_at": max(row.retrieved_at for row in rows).astimezone(UTC).isoformat(),
            "last_success_at": (
                generated_at.astimezone(UTC).isoformat()
                if series_id in fetched_ids
                else prior_freshness.get("last_success_at")
            ),
            "source_release_at": prior_freshness.get("source_release_at"),
            "source_updated_at": prior_freshness.get("source_updated_at"),
            "expected_next_release_at": prior_freshness.get("expected_next_release_at"),
        }
        asset = build_chart_asset(
            rows,
            frequency=spec.frequency,
            generated_at=generated_at,
            freshness=freshness,
        )
        dimension_hash = hashlib.sha256(
            json.dumps(dimensions, separators=(",", ":")).encode("utf-8")
        ).hexdigest()[:12]
        filename = (
            f"{_segment(series_id)}/{_segment(geography_id)}/{dimension_hash}.json"
        )
        forecast = build_forecast_asset(
            rows,
            frequency=spec.frequency,
            generated_at=generated_at,
            source_checksum=str(asset["source_checksum"]),
            target_view_id=spec.id,
            fundamentals=resolve_fundamental_drivers(series_id, geography_id, grouped),
        )
        assets.append((filename, asset, forecast, spec))

    manifest_holder: dict[str, Path] = {}

    def build_public_generation(stage: Path, _snapshot: CanonicalSnapshot) -> None:
        public_root = stage / "public"
        geographies_by_series: dict[str, list[dict[str, object]]] = defaultdict(list)
        freshness_by_series: dict[str, list[Mapping[str, object]]] = defaultdict(list)
        integrity: dict[str, dict[str, object]] = {}
        for relative, asset, forecast, spec in assets:
            target = public_root / "assets" / relative
            write_chart_asset(target, asset)
            payload = target.read_bytes()
            asset_path = f"assets/{relative}"
            digest = hashlib.sha256(payload).hexdigest()
            forecast_target = public_root / "forecasts" / relative
            write_chart_asset(forecast_target, forecast)
            forecast_payload = forecast_target.read_bytes()
            forecast_path = f"forecasts/{relative}"
            forecast_digest = hashlib.sha256(forecast_payload).hexdigest()
            label, level_id, level_label, rank = geographies.display_metadata(
                str(asset["geography_id"])
            )
            geographies_by_series[spec.id].append(
                {
                    "geography_id": asset["geography_id"],
                    "label": label,
                    "level_id": level_id,
                    "level_label": level_label,
                    "granularity_rank": rank,
                    "origin": "source-published",
                    "status": "available",
                    "asset_path": asset_path,
                    "asset_sha256": digest,
                    "asset_bytes": len(payload),
                    "forecast_path": forecast_path,
                    "forecast_sha256": forecast_digest,
                    "forecast_bytes": len(forecast_payload),
                }
            )
            freshness_by_series[spec.id].append(asset["freshness"])
            integrity[asset_path] = {"sha256": digest, "bytes": len(payload)}
            integrity[forecast_path] = {
                "sha256": forecast_digest,
                "bytes": len(forecast_payload),
            }

        manifest_series: list[dict[str, object]] = []
        series_statuses: list[str] = []
        for spec in sorted(manifest_specs, key=lambda item: item.id):
            geography_entries = sorted(
                geographies_by_series[spec.id],
                key=lambda item: (int(item["granularity_rank"]), str(item["label"])),
            )
            freshness_entries = freshness_by_series[spec.id]
            status = _combined_status(str(item["status"]) for item in freshness_entries)
            series_statuses.append(status)
            latest_periods = [str(item["latest_period"]) for item in freshness_entries]
            retrieval_times = [str(item["retrieved_at"]) for item in freshness_entries]
            last_success_times = [
                str(item["last_success_at"])
                for item in freshness_entries
                if item.get("last_success_at")
            ]
            source_release_times = [
                str(item["source_release_at"])
                for item in freshness_entries
                if item.get("source_release_at")
            ]
            expected_release_times = [
                str(item["expected_next_release_at"])
                for item in freshness_entries
                if item.get("expected_next_release_at")
            ]
            manifest_entry: dict[str, object] = {
                "view_id": spec.id,
                "series_id": spec.id,
                "metric_id": spec.metric_id,
                "title": spec.title,
                "category": _category(spec.metric_id),
                "description": spec.description or None,
                "unit": spec.canonical_unit,
                "frequency": spec.frequency.value,
                "source": {"name": spec.source_name, "url": spec.source_url},
                "freshness": {
                    "status": status,
                    # Conservative across geographies: never advertise a period that
                    # a finer available region has not reached.
                    "latest_period": min(latest_periods),
                    "retrieved_at": min(retrieval_times),
                    "source_release_at": min(source_release_times) if source_release_times else None,
                    "expected_next_release_at": (
                        min(expected_release_times) if expected_release_times else None
                    ),
                    "last_success_at": min(last_success_times) if last_success_times else None,
                },
                "geographies": geography_entries,
                "unsupported_levels": [
                    {
                        "level_id": level_id,
                        "label": geographies.level_label_by_id[level_id],
                        "reason": reason,
                    }
                    for level_id, reason in spec.unsupported_levels
                ],
            }
            if spec.display is not None:
                manifest_entry["classification"] = {
                    "dashboard_group": spec.display.dashboard_group,
                    "product_family_id": spec.display.product_family_id,
                    "product_family_label": spec.display.product_family_label,
                    "product_id": spec.display.product_id,
                    "product_label": spec.display.product_label,
                    "measure_id": spec.display.measure_id,
                    "measure_label": spec.display.measure_label,
                    "component_role": spec.display.component_role,
                    "parent_product_id": spec.display.parent_product_id,
                    "reference_term_ids": list(spec.display.reference_term_ids),
                    "display_order": spec.display.display_order,
                }
            manifest_series.append(manifest_entry)
        public_manifest = {
            "schema_version": ASSET_SCHEMA_VERSION,
            "asset_build_id": PUBLIC_ASSET_BUILD_ID,
            "forecast_methodology_version": FORECAST_METHODOLOGY_VERSION,
            "forecast_summary": {
                "ready": sum(1 for _r, _a, forecast, _s in assets if forecast["status"] == "ok"),
                "limited_history": sum(
                    1 for _r, _a, forecast, _s in assets if forecast["status"] == "limited_history"
                ),
                "unavailable": sum(
                    1
                    for _r, _a, forecast, _s in assets
                    if forecast["status"] not in {"ok", "limited_history"}
                ),
            },
            "run_id": run_id,
            "generated_at": generated_at.astimezone(UTC).isoformat(),
            "last_success_at": generated_at.astimezone(UTC).isoformat(),
            "status": _combined_status(series_statuses),
            "series": manifest_series,
            "previous_last_known_good_run_id": store.current_run_id(),
            "rows": {
                "canonical": len(candidate.observations),
                "inserted": inserted,
                "revised": revised,
                "unchanged": unchanged,
            },
            "sources": fetch_summaries,
            "integrity": integrity,
        }
        manifest_path = public_root / "manifest.json"
        write_chart_asset(manifest_path, public_manifest)
        verify_public_generation(public_root, expected_run_id=run_id)
        manifest_holder["path"] = manifest_path

    generation_path = store.publish(run_id, candidate, stage_validator=build_public_generation)
    public_manifest_path = generation_path / "public" / "manifest.json"
    if not public_manifest_path.is_file() or "path" not in manifest_holder:
        raise RuntimeError("Public manifest was not generated")
    return RefreshRunResult(
        run_id=run_id,
        generation_path=generation_path,
        inserted_rows=inserted,
        revised_rows=revised,
        unchanged_rows=unchanged,
        asset_count=len(assets),
        public_manifest_path=public_manifest_path,
        changed=True,
    )


def _segment(value: str) -> str:
    segment = _SAFE_SEGMENT.sub("_", value).strip("._-")
    if not segment:
        raise ValueError("Asset identifier cannot produce an empty path segment")
    return segment


def _combined_status(statuses: Iterable[str]) -> str:
    values = tuple(str(value) for value in statuses)
    if not values:
        return "unknown"
    priority = {"error": 5, "late": 4, "due": 3, "unknown": 2, "stale": 1, "fresh": 0}
    return max(values, key=lambda value: priority.get(value, 5))


def _explicit_freshness_would_change(
    candidate: CanonicalSnapshot,
    series_specs: tuple[RegistryEIASeries, ...],
    windows: Mapping[str, PeriodWindow],
    previous: Mapping[str, Mapping[str, object]],
) -> bool:
    """Detect due/fresh transitions requested by an explicit release window."""

    for spec in series_specs:
        expected = windows.get(spec.id, PeriodWindow()).expected_period
        if expected is None:
            continue
        rows = [row for row in candidate.observations if row.series_id == spec.id]
        grouped: dict[tuple[str, tuple[tuple[str, str], ...]], list[Observation]] = defaultdict(list)
        for row in rows:
            grouped[(row.geography_id, tuple(sorted(row.dimensions)))].append(row)
        statuses = (
            "fresh"
            if any(row.period == expected and row.value is not None for row in group_rows)
            else "due"
            for group_rows in grouped.values()
        )
        desired = _combined_status(statuses)
        if previous.get(spec.id, {}).get("status") != desired:
            return True
    return False


def _category(metric_id: str) -> str:
    if "refinery" in metric_id:
        return "Refining"
    if "stock" in metric_id:
        return "Inventories"
    if "import" in metric_id or "export" in metric_id:
        return "Trade"
    if "product_supplied" in metric_id:
        return "Implied demand"
    if "production" in metric_id:
        return "Supply"
    return "Energy market"


def default_overlap_start(frequency: Frequency, latest_period: str) -> str:
    """Return the safe scheduled overlap start for an existing canonical series."""

    if frequency is Frequency.WEEKLY:
        try:
            return (date.fromisoformat(latest_period) - timedelta(weeks=13)).isoformat()
        except ValueError:
            raise ValueError(f"Invalid weekly latest period {latest_period!r}") from None
    if frequency is Frequency.MONTHLY:
        try:
            year_text, month_text = latest_period[:7].split("-")
            year, month = int(year_text), int(month_text)
        except (TypeError, ValueError):
            raise ValueError(f"Invalid monthly latest period {latest_period!r}") from None
        if not 1 <= month <= 12:
            raise ValueError(f"Invalid monthly latest period {latest_period!r}")
        return f"{year - 10:04d}-{month:02d}"
    raise ValueError(f"No automatic overlap policy for frequency {frequency!r}")

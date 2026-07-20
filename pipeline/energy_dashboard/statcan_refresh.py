"""Revision-aware Statistics Canada refresh and static chart publication."""

from __future__ import annotations

import hashlib
import json
from collections import defaultdict
from collections.abc import Mapping
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Protocol

from .analytics import ASSET_SCHEMA_VERSION, build_chart_asset, write_chart_asset
from .canada_registry import RegistryCanadaSeries
from .contracts import Observation
from .forecasting import (
    FORECAST_METHODOLOGY_VERSION,
    PUBLIC_ASSET_BUILD_ID,
    build_forecast_asset,
)
from .promotion import verify_public_generation
from .refresh import (
    PeriodWindow,
    RefreshRunResult,
    _category,
    _combined_status,
    _segment,
    default_overlap_start,
)
from .registry import ProviderGeographyIndex
from .statcan import StatCanFetchResult, StatCanTableSpec
from .statcan_registry import RegistryStatCanSeries, normalize_statcan_records
from .storage import CanonicalSnapshot, MergeResult, SnapshotStore, merge_canonical


class StatCanFetcher(Protocol):
    def fetch(self, spec: StatCanTableSpec) -> StatCanFetchResult: ...


@dataclass(frozen=True, slots=True)
class _PreparedAsset:
    relative_path: str
    payload: dict[str, Any]
    forecast_payload: dict[str, Any]
    spec: RegistryStatCanSeries | RegistryCanadaSeries
    origin: str


@dataclass(frozen=True, slots=True)
class AdditionalCanadaBatch:
    spec: RegistryCanadaSeries
    observations: tuple[Observation, ...]
    payload_hash: str
    source_summary: Mapping[str, object]
    aggregation_lineage_by_geography: Mapping[str, Mapping[str, object]] | None = None


def run_statcan_refresh(
    series_specs: tuple[RegistryStatCanSeries, ...],
    geographies: ProviderGeographyIndex,
    client: StatCanFetcher,
    store: SnapshotStore,
    *,
    run_id: str,
    generated_at: datetime,
    period_windows: Mapping[str, PeriodWindow] | None = None,
    skip_unchanged: bool = True,
    manifest_series_specs: tuple[RegistryStatCanSeries, ...] | None = None,
    additional_batches: tuple[AdditionalCanadaBatch, ...] = (),
    additional_manifest_series_specs: tuple[RegistryCanadaSeries, ...] = (),
) -> RefreshRunResult:
    """Fetch each distinct table once and atomically publish a Canada generation."""

    if generated_at.tzinfo is None or generated_at.utcoffset() is None:
        raise ValueError("generated_at must be timezone-aware")
    if not series_specs and not additional_batches:
        raise ValueError("At least one active Canada series is required")
    ids = [spec.id for spec in series_specs] + [batch.spec.id for batch in additional_batches]
    if len(ids) != len(set(ids)):
        raise ValueError("Statistics Canada refresh series ids must be unique")
    windows = period_windows or {}
    if unknown := set(windows) - set(ids):
        raise ValueError(f"Period windows reference unknown series: {sorted(unknown)}")
    manifest_specs: tuple[RegistryStatCanSeries | RegistryCanadaSeries, ...] = (
        *(manifest_series_specs or series_specs),
        *(
            additional_manifest_series_specs
            or tuple(batch.spec for batch in additional_batches)
        ),
    )
    manifest_ids = [spec.id for spec in manifest_specs]
    if len(manifest_ids) != len(set(manifest_ids)):
        raise ValueError("Statistics Canada manifest series ids must be unique")
    if not set(ids).issubset(manifest_ids):
        raise ValueError("Every fetched series must be included in manifest_series_specs")

    previous_run_id = store.current_run_id()
    previous = store.load_current() or CanonicalSnapshot(())
    previous_freshness = _load_previous_freshness(store, previous_run_id)
    fetched_tables: dict[str, StatCanFetchResult] = {}
    for table in sorted({spec.table.pid: spec.table for spec in series_specs}.values(), key=lambda x: x.pid):
        fetched_tables[table.pid] = client.fetch(table)

    candidate = previous
    inserted = revised = unchanged = 0
    summaries: list[dict[str, object]] = []
    effective_windows: dict[str, PeriodWindow] = {}
    incoming_by_series: dict[str, tuple[Observation, ...]] = {}
    for spec in sorted(series_specs, key=lambda item: item.id):
        requested = windows.get(spec.id, PeriodWindow())
        start = requested.start
        if start is None:
            existing = [row.period for row in previous.observations if row.series_id == spec.id]
            start = (
                default_overlap_start(spec.frequency, max(existing))
                if existing
                else spec.bootstrap_start
            )
        effective_windows[spec.id] = PeriodWindow(start, requested.end, requested.expected_period)
        fetched = fetched_tables[spec.table.pid]
        rows = normalize_statcan_records(
            spec,
            fetched.records,
            geographies,
            retrieved_at=generated_at,
            period_start=start,
            period_end=requested.end,
        )
        _reject_removed_overlap_rows(previous, spec.id, rows, start, requested.end)
        incoming_by_series[spec.id] = rows
        merged: MergeResult = merge_canonical(
            candidate,
            rows,
            detected_at=generated_at,
            payload_hash=fetched.archive_sha256,
        )
        candidate = merged.snapshot
        inserted += len(merged.inserted_keys)
        revised += len(merged.revised_keys)
        unchanged += len(merged.unchanged_keys)
        summaries.append(
            {
                "series_id": spec.id,
                "table_pid": spec.table.pid,
                "rows": len(rows),
                "archive_sha256": fetched.archive_sha256,
                "csv_sha256": fetched.csv_sha256,
                "download_url": fetched.download_url,
            }
        )
    aggregation_lineage: dict[tuple[str, str], Mapping[str, object]] = {}
    for batch in sorted(additional_batches, key=lambda item: item.spec.id):
        spec = batch.spec
        requested = windows.get(spec.id, PeriodWindow())
        start = requested.start
        if start is None:
            existing = [row.period for row in previous.observations if row.series_id == spec.id]
            start = (
                default_overlap_start(spec.frequency, max(existing))
                if existing
                else spec.bootstrap_start
            )
        effective_windows[spec.id] = PeriodWindow(start, requested.end, requested.expected_period)
        rows = tuple(
            row
            for row in batch.observations
            if (start is None or row.period >= start)
            and (requested.end is None or row.period <= requested.end)
        )
        if not rows:
            raise ValueError(f"Additional Canada provider window is empty for {spec.id}")
        for row in rows:
            if row.series_id != spec.id:
                raise ValueError(f"Additional Canada batch contains another series for {spec.id}")
            if row.geography_id not in spec.source_geography_ids:
                raise ValueError(
                    f"Additional Canada row escaped registered geography set for {spec.id}"
                )
            try:
                _, level_id, _, _ = geographies.display_metadata(row.geography_id)
            except KeyError:
                raise ValueError(
                    f"Additional Canada row has unknown geography {row.geography_id!r}"
                ) from None
            if level_id not in spec.source_geography_level_ids:
                raise ValueError(f"Additional Canada row escaped registered geography level")
        _reject_removed_overlap_rows(previous, spec.id, rows, start, requested.end)
        incoming_by_series[spec.id] = rows
        merged = merge_canonical(
            candidate,
            rows,
            detected_at=generated_at,
            payload_hash=batch.payload_hash,
        )
        candidate = merged.snapshot
        inserted += len(merged.inserted_keys)
        revised += len(merged.revised_keys)
        unchanged += len(merged.unchanged_keys)
        summaries.append(dict(batch.source_summary))
        if batch.aggregation_lineage_by_geography:
            aggregation_lineage.update(
                ((spec.id, geography_id), value)
                for geography_id, value in batch.aggregation_lineage_by_geography.items()
            )

    if (
        skip_unchanged
        and inserted == 0
        and revised == 0
        and previous_run_id is not None
        and not _public_freshness_would_change(
            previous_freshness, effective_windows, incoming_by_series
        )
    ):
        unchanged_result = _unchanged_result_if_complete(
            store, previous_run_id, manifest_specs, unchanged
        )
        if unchanged_result is not None:
            return unchanged_result

    candidate = CanonicalSnapshot(
        observations=candidate.observations,
        revisions=candidate.revisions,
        metadata=(
            ("generated_at", generated_at.astimezone(UTC).isoformat()),
            ("run_id", run_id),
            ("provider", "canada"),
        ),
    )
    specs_by_id = {spec.id: spec for spec in manifest_specs}
    fetched_ids = set(ids)
    grouped: dict[tuple[str, str, tuple[tuple[str, str], ...]], list[Observation]] = defaultdict(list)
    for row in candidate.observations:
        if row.series_id in specs_by_id:
            grouped[(row.series_id, row.geography_id, tuple(sorted(row.dimensions)))].append(row)
    if missing := set(specs_by_id) - {key[0] for key in grouped}:
        raise ValueError(
            "Public manifest cannot drop active Statistics Canada series without history: "
            f"{sorted(missing)}"
        )

    assets: list[_PreparedAsset] = []
    unavailable: dict[str, list[str]] = defaultdict(list)
    seen_series_geographies: set[tuple[str, str]] = set()
    for (series_id, geography_id, dimensions), rows in sorted(grouped.items()):
        pair = (series_id, geography_id)
        if pair in seen_series_geographies:
            raise ValueError(
                f"Frontend manifest cannot select multiple slices for {series_id}/{geography_id}"
            )
        seen_series_geographies.add(pair)
        if not any(row.value is not None for row in rows):
            unavailable[series_id].append(geography_id)
            continue
        spec = specs_by_id[series_id]
        expected_period = effective_windows.get(series_id, PeriodWindow()).expected_period
        prior = previous_freshness.get(series_id, {})
        latest_source = max(rows, key=lambda row: row.period)
        latest_numeric = max(
            (row for row in rows if row.value is not None), key=lambda row: row.period
        )
        freshness = {
            "status": (
                str(prior.get("status", "unknown"))
                if series_id not in fetched_ids
                else "unknown"
                if expected_period is None
                else "fresh"
                if any(row.period == expected_period for row in rows)
                else "due"
            ),
            "latest_period": latest_source.period,
            "latest_numeric_period": latest_numeric.period,
            "latest_observation_status": latest_source.status.value,
            "expected_period": expected_period,
            "retrieved_at": max(row.retrieved_at for row in rows).astimezone(UTC).isoformat(),
            "last_success_at": (
                generated_at.astimezone(UTC).isoformat()
                if series_id in fetched_ids
                else prior.get("last_success_at")
            ),
            "source_release_at": prior.get("source_release_at"),
            "source_updated_at": prior.get("source_updated_at"),
            "expected_next_release_at": prior.get("expected_next_release_at"),
        }
        asset = build_chart_asset(
            rows,
            frequency=spec.frequency,
            generated_at=generated_at,
            freshness=freshness,
            aggregation_lineage=aggregation_lineage.get((series_id, geography_id)),
        )
        dimension_hash = hashlib.sha256(
            json.dumps(dimensions, separators=(",", ":")).encode("utf-8")
        ).hexdigest()[:12]
        forecast = build_forecast_asset(
            rows,
            frequency=spec.frequency,
            generated_at=generated_at,
            source_checksum=str(asset["source_checksum"]),
            target_view_id=spec.id,
        )
        assets.append(
            _PreparedAsset(
                f"{_segment(series_id)}/{_segment(geography_id)}/{dimension_hash}.json",
                asset,
                forecast,
                spec,
                "computed-rollup"
                if all(row.status.value == "computed" for row in rows)
                else "source-published",
            )
        )

    manifest_holder: dict[str, Path] = {}

    def build_public_generation(stage: Path, _snapshot: CanonicalSnapshot) -> None:
        public_root = stage / "public"
        geographies_by_series: dict[str, list[dict[str, object]]] = defaultdict(list)
        freshness_by_series: dict[str, list[Mapping[str, object]]] = defaultdict(list)
        integrity: dict[str, dict[str, object]] = {}
        for prepared in assets:
            target = public_root / "assets" / prepared.relative_path
            write_chart_asset(target, prepared.payload)
            payload = target.read_bytes()
            asset_path = f"assets/{prepared.relative_path}"
            digest = hashlib.sha256(payload).hexdigest()
            forecast_target = public_root / "forecasts" / prepared.relative_path
            write_chart_asset(forecast_target, prepared.forecast_payload)
            forecast_payload = forecast_target.read_bytes()
            forecast_path = f"forecasts/{prepared.relative_path}"
            forecast_digest = hashlib.sha256(forecast_payload).hexdigest()
            geography_id = str(prepared.payload["geography_id"])
            label, level_id, level_label, rank = geographies.display_metadata(geography_id)
            geographies_by_series[prepared.spec.id].append(
                {
                    "geography_id": geography_id,
                    "label": label,
                    "level_id": level_id,
                    "level_label": level_label,
                    "granularity_rank": rank,
                    "origin": prepared.origin,
                    "status": "available",
                    "asset_path": asset_path,
                    "asset_sha256": digest,
                    "asset_bytes": len(payload),
                    "forecast_path": forecast_path,
                    "forecast_sha256": forecast_digest,
                    "forecast_bytes": len(forecast_payload),
                }
            )
            freshness_by_series[prepared.spec.id].append(prepared.payload["freshness"])
            integrity[asset_path] = {"sha256": digest, "bytes": len(payload)}
            integrity[forecast_path] = {
                "sha256": forecast_digest,
                "bytes": len(forecast_payload),
            }
        for series_id, geography_ids in unavailable.items():
            for geography_id in geography_ids:
                label, level_id, level_label, rank = geographies.display_metadata(geography_id)
                geographies_by_series[series_id].append(
                    {
                        "geography_id": geography_id,
                        "label": label,
                        "level_id": level_id,
                        "level_label": level_label,
                        "granularity_rank": rank,
                        "origin": "source-published",
                        "status": "unavailable",
                        "reason": "All selected observations are suppressed or unavailable.",
                    }
                )

        manifest_series: list[dict[str, object]] = []
        series_statuses: list[str] = []
        for spec in sorted(manifest_specs, key=lambda item: item.id):
            fresh = freshness_by_series[spec.id]
            if not fresh:
                raise ValueError(f"Active Statistics Canada series has no numeric geography: {spec.id}")
            status = _combined_status(str(item["status"]) for item in fresh)
            series_statuses.append(status)
            entry: dict[str, object] = {
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
                    "latest_period": min(str(item["latest_period"]) for item in fresh),
                    "latest_numeric_period": min(
                        str(item["latest_numeric_period"]) for item in fresh
                    ),
                    "latest_observation_status": (
                        next(
                            iter(
                                {
                                    str(item["latest_observation_status"])
                                    for item in fresh
                                }
                            )
                        )
                        if len(
                            {
                                str(item["latest_observation_status"])
                                for item in fresh
                            }
                        )
                        == 1
                        else "mixed"
                    ),
                    "checked_at": generated_at.astimezone(UTC).isoformat(),
                    "retrieved_at": min(str(item["retrieved_at"]) for item in fresh),
                    "source_release_at": None,
                    "expected_next_release_at": None,
                    "last_success_at": min(str(item["last_success_at"]) for item in fresh),
                },
                "geographies": sorted(
                    geographies_by_series[spec.id],
                    key=lambda item: (int(item["granularity_rank"]), str(item["label"])),
                ),
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
                entry["classification"] = {
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
            manifest_series.append(entry)
        manifest = {
            "schema_version": ASSET_SCHEMA_VERSION,
            "asset_build_id": PUBLIC_ASSET_BUILD_ID,
            "forecast_methodology_version": FORECAST_METHODOLOGY_VERSION,
            "forecast_summary": {
                "ready": sum(
                    1 for prepared in assets if prepared.forecast_payload["status"] == "ok"
                ),
                "limited_history": sum(
                    1
                    for prepared in assets
                    if prepared.forecast_payload["status"] == "limited_history"
                ),
                "unavailable": sum(
                    1
                    for prepared in assets
                    if prepared.forecast_payload["status"] not in {"ok", "limited_history"}
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
            "sources": summaries,
            "integrity": integrity,
        }
        manifest_path = public_root / "manifest.json"
        write_chart_asset(manifest_path, manifest)
        verify_public_generation(public_root, expected_run_id=run_id)
        manifest_holder["path"] = manifest_path

    generation_path = store.publish(run_id, candidate, stage_validator=build_public_generation)
    public_manifest = generation_path / "public" / "manifest.json"
    if not public_manifest.is_file() or "path" not in manifest_holder:
        raise RuntimeError("Statistics Canada public manifest was not generated")
    return RefreshRunResult(
        run_id=run_id,
        generation_path=generation_path,
        inserted_rows=inserted,
        revised_rows=revised,
        unchanged_rows=unchanged,
        asset_count=len(assets),
        public_manifest_path=public_manifest,
        changed=True,
    )


def _load_previous_freshness(
    store: SnapshotStore, previous_run_id: str | None
) -> dict[str, Mapping[str, object]]:
    if previous_run_id is None:
        return {}
    path = store.generations / previous_run_id / "public" / "manifest.json"
    if not path.is_file():
        return {}
    manifest = json.loads(path.read_text(encoding="utf-8"))
    return {
        str(item["series_id"]): item.get("freshness", {})
        for item in manifest.get("series", [])
        if isinstance(item, Mapping) and item.get("series_id")
    }


def _reject_removed_overlap_rows(
    previous: CanonicalSnapshot,
    series_id: str,
    incoming: tuple[Observation, ...],
    period_start: str | None,
    period_end: str | None,
) -> None:
    """Fail closed when a full-source refresh silently drops prior coordinates."""

    prior_keys = {
        row.key
        for row in previous.observations
        if row.series_id == series_id
        and (period_start is None or row.period >= period_start)
        and (period_end is None or row.period <= period_end)
    }
    incoming_keys = {row.key for row in incoming}
    if removed := prior_keys - incoming_keys:
        sample = sorted(removed)[:3]
        raise ValueError(
            f"Canada provider removed {len(removed)} existing overlap rows for {series_id}; "
            f"sample={sample}. A reviewed removal migration is required."
        )


def _public_freshness_would_change(
    previous: Mapping[str, Mapping[str, object]],
    windows: Mapping[str, PeriodWindow],
    incoming: Mapping[str, tuple[Observation, ...]],
) -> bool:
    """Detect status/source-period changes without treating a poll time as data."""

    for series_id, rows in incoming.items():
        by_geography: dict[str, list[Observation]] = defaultdict(list)
        for row in rows:
            by_geography[row.geography_id].append(row)
        available = {
            geography_id: geography_rows
            for geography_id, geography_rows in by_geography.items()
            if any(row.value is not None for row in geography_rows)
        }
        if not available:
            return True
        latest_sources = [
            max(geography_rows, key=lambda row: row.period)
            for geography_rows in available.values()
        ]
        latest_numerics = [
            max(
                (row for row in geography_rows if row.value is not None),
                key=lambda row: row.period,
            )
            for geography_rows in available.values()
        ]
        expected = windows.get(series_id, PeriodWindow()).expected_period
        status = (
            "unknown"
            if expected is None
            else "fresh"
            if any(row.period == expected for row in rows)
            else "due"
        )
        prior = previous.get(series_id, {})
        source_statuses = {row.status.value for row in latest_sources}
        desired = {
            "status": status,
            "latest_period": min(row.period for row in latest_sources),
            "latest_numeric_period": min(row.period for row in latest_numerics),
            "latest_observation_status": (
                next(iter(source_statuses)) if len(source_statuses) == 1 else "mixed"
            ),
        }
        if any(prior.get(field) != value for field, value in desired.items()):
            return True
    return False


def _unchanged_result_if_complete(
    store: SnapshotStore,
    previous_run_id: str,
    manifest_specs: tuple[RegistryStatCanSeries | RegistryCanadaSeries, ...],
    unchanged_rows: int,
) -> RefreshRunResult | None:
    generation = store.generations / previous_run_id
    path = generation / "public" / "manifest.json"
    if not path.is_file():
        raise ValueError("Current Canada last-known-good generation has no public manifest")
    manifest = json.loads(path.read_text(encoding="utf-8"))
    if manifest.get("asset_build_id") != PUBLIC_ASSET_BUILD_ID:
        return None
    current = {
        str(item.get("series_id"))
        for item in manifest.get("series", [])
        if isinstance(item, Mapping) and item.get("series_id")
    }
    if current != {spec.id for spec in manifest_specs}:
        return None
    assets = sum(
        1
        for series in manifest.get("series", [])
        for geography in series.get("geographies", [])
        if geography.get("status") == "available" and geography.get("asset_path")
    )
    return RefreshRunResult(
        run_id=previous_run_id,
        generation_path=generation,
        inserted_rows=0,
        revised_rows=0,
        unchanged_rows=unchanged_rows,
        asset_count=assets,
        public_manifest_path=path,
        changed=False,
    )

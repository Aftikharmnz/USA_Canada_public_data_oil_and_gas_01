"""Offline rebuild of derived observed and forecast assets from CURRENT canonical data."""

from __future__ import annotations

import copy
import hashlib
import json
from collections import defaultdict
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Mapping

from .analytics import build_chart_asset, write_chart_asset
from .contracts import Frequency, Observation
from .forecasting import (
    FORECAST_METHODOLOGY_VERSION,
    PUBLIC_ASSET_BUILD_ID,
    build_forecast_asset,
)
from .fundamentals import resolve_fundamental_drivers
from .promotion import verify_public_generation
from .storage import CanonicalSnapshot, SnapshotStore


@dataclass(frozen=True, slots=True)
class AnalyticsRebuildResult:
    run_id: str
    previous_run_id: str
    generation_path: Path
    public_manifest_path: Path
    asset_count: int
    forecast_count: int


@dataclass(frozen=True, slots=True)
class _DerivedPair:
    observed_path: str
    forecast_path: str
    observed: dict[str, Any]
    forecast: dict[str, Any]
    view_id: str
    geography_id: str


def rebuild_current_analytics(
    store: SnapshotStore,
    *,
    run_id: str,
    generated_at: datetime,
) -> AnalyticsRebuildResult:
    """Create a new immutable generation without calling a data provider."""

    if generated_at.tzinfo is None or generated_at.utcoffset() is None:
        raise ValueError("generated_at must be timezone-aware")
    previous_run_id = store.current_run_id()
    if previous_run_id is None:
        raise ValueError("Snapshot store has no CURRENT generation")
    snapshot = store.load(previous_run_id)
    source_public = store.generations / previous_run_id / "public"
    source_manifest = verify_public_generation(
        source_public, expected_run_id=previous_run_id
    )
    grouped: dict[
        tuple[str, str, tuple[tuple[str, str], ...]], list[Observation]
    ] = defaultdict(list)
    for row in snapshot.observations:
        grouped[(row.series_id, row.geography_id, tuple(sorted(row.dimensions)))].append(row)

    pairs: list[_DerivedPair] = []
    for series_item in source_manifest["series"]:
        if not isinstance(series_item, Mapping):
            raise ValueError("Manifest series entries must be objects")
        view_id = str(series_item["view_id"])
        for geography in series_item["geographies"]:
            if not isinstance(geography, Mapping) or geography.get("status") != "available":
                continue
            observed_path = str(geography["asset_path"])
            relative = Path(observed_path)
            if not relative.parts or relative.parts[0] != "assets":
                raise ValueError(f"Observed asset path must begin with assets/: {observed_path}")
            source_asset = json.loads(
                (source_public / relative).read_text(encoding="utf-8")
            )
            dimensions_raw = source_asset.get("dimensions", {})
            if not isinstance(dimensions_raw, Mapping):
                raise ValueError(f"Observed asset dimensions must be an object: {observed_path}")
            key = (
                str(source_asset["series_id"]),
                str(source_asset["geography_id"]),
                tuple(sorted((str(name), str(value)) for name, value in dimensions_raw.items())),
            )
            rows = grouped.get(key)
            if not rows:
                raise ValueError(f"Canonical history is missing for public asset {observed_path}")
            frequency = Frequency(str(source_asset["frequency"]))
            observed = build_chart_asset(
                rows,
                frequency=frequency,
                generated_at=generated_at,
                aggregation_lineage=source_asset.get("aggregation_lineage"),
                freshness=source_asset.get("freshness"),
            )
            forecast_path = f"forecasts/{Path(*relative.parts[1:]).as_posix()}"
            forecast = build_forecast_asset(
                rows,
                frequency=frequency,
                generated_at=generated_at,
                source_checksum=str(observed["source_checksum"]),
                target_view_id=view_id,
                fundamentals=resolve_fundamental_drivers(
                    str(source_asset["series_id"]),
                    str(source_asset["geography_id"]),
                    grouped,
                ),
            )
            pairs.append(
                _DerivedPair(
                    observed_path=observed_path,
                    forecast_path=forecast_path,
                    observed=observed,
                    forecast=forecast,
                    view_id=view_id,
                    geography_id=str(source_asset["geography_id"]),
                )
            )

    pair_by_key = {(pair.view_id, pair.geography_id): pair for pair in pairs}

    def build_public_generation(stage: Path, _snapshot: CanonicalSnapshot) -> None:
        public_root = stage / "public"
        manifest = copy.deepcopy(source_manifest)
        integrity: dict[str, dict[str, object]] = {}
        for pair in pairs:
            observed_target = public_root / pair.observed_path
            write_chart_asset(observed_target, pair.observed)
            observed_payload = observed_target.read_bytes()
            integrity[pair.observed_path] = {
                "sha256": hashlib.sha256(observed_payload).hexdigest(),
                "bytes": len(observed_payload),
            }
            forecast_target = public_root / pair.forecast_path
            write_chart_asset(forecast_target, pair.forecast)
            forecast_payload = forecast_target.read_bytes()
            integrity[pair.forecast_path] = {
                "sha256": hashlib.sha256(forecast_payload).hexdigest(),
                "bytes": len(forecast_payload),
            }

        for series_item in manifest["series"]:
            view_id = str(series_item["view_id"])
            for geography in series_item["geographies"]:
                if geography.get("status") != "available":
                    continue
                pair = pair_by_key[(view_id, str(geography["geography_id"]))]
                observed_evidence = integrity[pair.observed_path]
                forecast_evidence = integrity[pair.forecast_path]
                geography["asset_path"] = pair.observed_path
                geography["asset_sha256"] = observed_evidence["sha256"]
                geography["asset_bytes"] = observed_evidence["bytes"]
                geography["forecast_path"] = pair.forecast_path
                geography["forecast_sha256"] = forecast_evidence["sha256"]
                geography["forecast_bytes"] = forecast_evidence["bytes"]

        manifest["run_id"] = run_id
        manifest["generated_at"] = generated_at.astimezone(UTC).isoformat()
        manifest["previous_last_known_good_run_id"] = previous_run_id
        manifest["asset_build_id"] = PUBLIC_ASSET_BUILD_ID
        manifest["forecast_methodology_version"] = FORECAST_METHODOLOGY_VERSION
        manifest["forecast_summary"] = {
            "ready": sum(1 for pair in pairs if pair.forecast["status"] == "ok"),
            "limited_history": sum(
                1 for pair in pairs if pair.forecast["status"] == "limited_history"
            ),
            "unavailable": sum(
                1
                for pair in pairs
                if pair.forecast["status"] not in {"ok", "limited_history"}
            ),
        }
        manifest["analytics_rebuild"] = {
            "source_run_id": previous_run_id,
            "provider_network_calls": 0,
        }
        manifest["integrity"] = integrity
        write_chart_asset(public_root / "manifest.json", manifest)
        verify_public_generation(public_root, expected_run_id=run_id)

    metadata = dict(snapshot.metadata)
    metadata.update(
        {
            "generated_at": generated_at.astimezone(UTC).isoformat(),
            "run_id": run_id,
            "analytics_rebuild_of": previous_run_id,
        }
    )
    rebuilt_snapshot = CanonicalSnapshot(
        observations=snapshot.observations,
        revisions=snapshot.revisions,
        metadata=tuple(sorted(metadata.items())),
    )
    generation_path = store.publish(
        run_id,
        rebuilt_snapshot,
        stage_validator=build_public_generation,
    )
    public_manifest_path = generation_path / "public" / "manifest.json"
    verify_public_generation(public_manifest_path.parent, expected_run_id=run_id)
    return AnalyticsRebuildResult(
        run_id=run_id,
        previous_run_id=previous_run_id,
        generation_path=generation_path,
        public_manifest_path=public_manifest_path,
        asset_count=len(pairs),
        forecast_count=len(pairs),
    )

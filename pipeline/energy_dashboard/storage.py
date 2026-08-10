"""Revision-aware canonical merge and generation-based last-known-good storage."""

from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import tempfile
import time
import uuid
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

from .contracts import Observation, ObservationStatus, RevisionRecord


_RUN_ID = re.compile(r"^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$")
_CANONICAL_SHARD_PATH = Path("canonical")
_CANONICAL_INDEX_NAME = "index.json"
_CANONICAL_SHARD_LAYOUT = "sharded-v1"

# The former 90 MiB total budget existed to keep canonical.json below GitHub's
# 100 MiB per-file limit. Canonical history is now partitioned by series and
# year, so the repository-safety boundary is enforced per stable shard. A
# deliberately modest aggregate ceiling and generation-over-generation gate
# still protect refreshes from unreviewed growth.
DEFAULT_MAX_CANONICAL_BYTES = 128 * 1024 * 1024
DEFAULT_MAX_CANONICAL_SHARD_BYTES = 16 * 1024 * 1024
DEFAULT_MAX_CANONICAL_GROWTH_RATIO = 0.10
DEFAULT_MIN_CANONICAL_GROWTH_BYTES = 8 * 1024 * 1024
DEFAULT_MAX_REVISION_BYTES = 16 * 1024 * 1024
_WINDOWS_REPLACE_RETRY_DELAYS = (0.1, 0.25, 0.5, 1.0, 2.0)


def replace_path_with_retry(
    source: str | Path,
    destination: str | Path,
    *,
    delays: tuple[float, ...] = _WINDOWS_REPLACE_RETRY_DELAYS,
) -> None:
    """Atomically replace a path, tolerating brief Windows file-scanner locks."""

    for attempt in range(len(delays) + 1):
        try:
            os.replace(source, destination)
            return
        except PermissionError:
            if attempt == len(delays):
                raise
            time.sleep(delays[attempt])


@dataclass(frozen=True, slots=True)
class CanonicalSnapshot:
    observations: tuple[Observation, ...]
    revisions: tuple[RevisionRecord, ...] = ()
    metadata: tuple[tuple[str, str], ...] = ()


@dataclass(frozen=True, slots=True)
class MergeResult:
    snapshot: CanonicalSnapshot
    inserted_keys: tuple[str, ...]
    revised_keys: tuple[str, ...]
    unchanged_keys: tuple[str, ...]

    @property
    def rows_inserted(self) -> int:
        return len(self.inserted_keys)

    @property
    def rows_revised(self) -> int:
        return len(self.revised_keys)


def merge_canonical(
    current: CanonicalSnapshot,
    incoming: Iterable[Observation],
    *,
    detected_at: datetime,
    payload_hash: str | None = None,
    provider_release_id: str | None = None,
) -> MergeResult:
    """Upsert an overlap window without treating unseen new periods as revisions."""

    latest = _unique_by_key(current.observations, "current canonical snapshot")
    incoming_by_key = _unique_by_key(tuple(incoming), "incoming observation batch")
    ledger = list(current.revisions)
    inserted: list[str] = []
    revised: list[str] = []
    unchanged: list[str] = []

    for key in sorted(incoming_by_key):
        new = incoming_by_key[key]
        old = latest.get(key)
        if old is None:
            latest[key] = new
            inserted.append(key)
            continue
        if old.provider_id != new.provider_id or old.series_id != new.series_id or old.unit != new.unit:
            raise ValueError(f"Canonical identity metadata changed for {key}")
        if (old.value, old.status) != (new.value, new.status):
            ledger.append(
                RevisionRecord(
                    observation_key=key,
                    old_value=old.value,
                    new_value=new.value,
                    old_status=old.status,
                    new_status=new.status,
                    detected_at=detected_at,
                    retrieved_at=new.retrieved_at,
                    provider_release_id=provider_release_id,
                    payload_hash=payload_hash,
                )
            )
            revised.append(key)
        else:
            unchanged.append(key)
        latest[key] = new

    return MergeResult(
        snapshot=CanonicalSnapshot(
            observations=tuple(latest[key] for key in sorted(latest)),
            revisions=tuple(ledger),
            metadata=current.metadata,
        ),
        inserted_keys=tuple(inserted),
        revised_keys=tuple(revised),
        unchanged_keys=tuple(unchanged),
    )


def _unique_by_key(rows: Iterable[Observation], label: str) -> dict[str, Observation]:
    output: dict[str, Observation] = {}
    for row in rows:
        if row.key in output:
            raise ValueError(f"Duplicate key in {label}: {row.key}")
        output[row.key] = row
    return output


class SnapshotStore:
    """Publish immutable generations and atomically switch a small CURRENT pointer."""

    def __init__(
        self,
        root: Path,
        *,
        max_canonical_bytes: int = DEFAULT_MAX_CANONICAL_BYTES,
        max_canonical_shard_bytes: int = DEFAULT_MAX_CANONICAL_SHARD_BYTES,
        max_canonical_growth_ratio: float = DEFAULT_MAX_CANONICAL_GROWTH_RATIO,
        min_canonical_growth_bytes: int = DEFAULT_MIN_CANONICAL_GROWTH_BYTES,
        max_revision_bytes: int = DEFAULT_MAX_REVISION_BYTES,
    ) -> None:
        if max_canonical_bytes < 1:
            raise ValueError("max_canonical_bytes must be positive")
        if max_canonical_shard_bytes < 1:
            raise ValueError("max_canonical_shard_bytes must be positive")
        if not 0 <= max_canonical_growth_ratio <= 1:
            raise ValueError("max_canonical_growth_ratio must be between zero and one")
        if min_canonical_growth_bytes < 0:
            raise ValueError("min_canonical_growth_bytes cannot be negative")
        if max_revision_bytes < 1:
            raise ValueError("max_revision_bytes must be positive")
        self.root = root
        self.generations = root / "generations"
        self.staging = root / ".staging"
        self.max_canonical_bytes = max_canonical_bytes
        self.max_canonical_shard_bytes = min(
            max_canonical_shard_bytes, max_canonical_bytes
        )
        self.max_canonical_growth_ratio = max_canonical_growth_ratio
        self.min_canonical_growth_bytes = min_canonical_growth_bytes
        self.max_revision_bytes = max_revision_bytes

    def current_run_id(self) -> str | None:
        pointer = self.root / "CURRENT"
        if not pointer.exists():
            return None
        run_id = pointer.read_text(encoding="utf-8").strip()
        self._validate_run_id(run_id)
        if not (self.generations / run_id).is_dir():
            raise ValueError("CURRENT points to a missing generation")
        return run_id

    def load_current(self) -> CanonicalSnapshot | None:
        run_id = self.current_run_id()
        return None if run_id is None else self.load(run_id)

    def load(self, run_id: str) -> CanonicalSnapshot:
        self._validate_run_id(run_id)
        directory = self.generations / run_id
        manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
        if not isinstance(manifest, Mapping) or manifest.get("run_id") != run_id:
            raise ValueError(f"Generation manifest identity mismatch for {run_id}")
        canonical_items = self._load_canonical_items(directory, manifest, run_id)
        canonical_bytes = _json_bytes(canonical_items)
        if len(canonical_bytes) > self.max_canonical_bytes:
            raise ValueError(f"Canonical generation exceeds the configured size budget for {run_id}")
        if len(canonical_bytes) != manifest.get("canonical_bytes"):
            raise ValueError(f"Canonical byte count mismatch for generation {run_id}")
        if hashlib.sha256(canonical_bytes).hexdigest() != manifest.get("canonical_sha256"):
            raise ValueError(f"Canonical checksum mismatch for generation {run_id}")
        revisions_bytes = (directory / "revisions.json").read_bytes()
        if len(revisions_bytes) > self.max_revision_bytes:
            raise ValueError(f"Revision ledger exceeds the configured file-size budget for {run_id}")
        if len(revisions_bytes) != manifest.get("revisions_bytes"):
            raise ValueError(f"Revision-ledger byte count mismatch for generation {run_id}")
        if hashlib.sha256(revisions_bytes).hexdigest() != manifest.get("revisions_sha256"):
            raise ValueError(f"Revision-ledger checksum mismatch for generation {run_id}")
        revisions = json.loads(revisions_bytes)
        if not isinstance(revisions, list) or len(revisions) != manifest.get("revision_count"):
            raise ValueError(f"Revision-ledger row count mismatch for generation {run_id}")
        metadata = manifest.get("metadata", {})
        if not isinstance(metadata, Mapping):
            raise ValueError(f"Generation metadata is invalid for {run_id}")
        observations = tuple(_observation_from_json(item) for item in canonical_items)
        _unique_by_key(observations, f"canonical generation {run_id}")
        return CanonicalSnapshot(
            observations=observations,
            revisions=tuple(_revision_from_json(item) for item in revisions),
            metadata=tuple(sorted((str(k), str(v)) for k, v in metadata.items())),
        )

    def _load_canonical_items(
        self,
        directory: Path,
        manifest: Mapping[str, Any],
        run_id: str,
    ) -> list[Mapping[str, Any]]:
        """Read legacy single-file or sharded canonical history."""

        legacy_path = directory / "canonical.json"
        if legacy_path.is_file():
            if manifest.get("schema_version") != "1.0.0" or any(
                field in manifest
                for field in (
                    "canonical_layout",
                    "canonical_index_path",
                    "canonical_index_sha256",
                    "canonical_shard_count",
                )
            ):
                raise ValueError(f"Legacy canonical manifest is invalid for generation {run_id}")
            if (directory / _CANONICAL_SHARD_PATH).exists():
                raise ValueError(f"Generation mixes canonical storage layouts for {run_id}")
            canonical_bytes = legacy_path.read_bytes()
            if hashlib.sha256(canonical_bytes).hexdigest() != manifest.get("canonical_sha256"):
                raise ValueError(f"Canonical checksum mismatch for generation {run_id}")
            payload = json.loads(canonical_bytes)
            if not isinstance(payload, list):
                raise ValueError(f"Canonical payload is not a list for generation {run_id}")
            return payload

        if manifest.get("schema_version") != "1.1.0":
            raise ValueError(f"Canonical manifest schema is invalid for generation {run_id}")
        if manifest.get("canonical_layout") != _CANONICAL_SHARD_LAYOUT:
            raise ValueError(f"Canonical payload is missing for generation {run_id}")
        index_relative = manifest.get("canonical_index_path")
        if index_relative != f"{_CANONICAL_SHARD_PATH.as_posix()}/{_CANONICAL_INDEX_NAME}":
            raise ValueError(f"Canonical index path is invalid for generation {run_id}")
        index_path = directory / _CANONICAL_SHARD_PATH / _CANONICAL_INDEX_NAME
        index_bytes = index_path.read_bytes()
        if hashlib.sha256(index_bytes).hexdigest() != manifest.get("canonical_index_sha256"):
            raise ValueError(f"Canonical index checksum mismatch for generation {run_id}")
        index = json.loads(index_bytes)
        if (
            not isinstance(index, Mapping)
            or index.get("schema_version") != "1.0.0"
            or index.get("layout") != _CANONICAL_SHARD_LAYOUT
        ):
            raise ValueError(f"Canonical index schema is invalid for generation {run_id}")
        if index.get("run_id") != run_id or manifest.get("run_id") != run_id:
            raise ValueError(f"Canonical run identity mismatch for generation {run_id}")
        if index.get("partition") != "series_id/year" or index.get("sort") != "observation_key":
            raise ValueError(f"Canonical partition contract is invalid for generation {run_id}")
        for field in ("row_count", "canonical_bytes", "canonical_sha256"):
            if index.get(field) != manifest.get(field):
                raise ValueError(
                    f"Canonical index/manifest {field} mismatch for generation {run_id}"
                )
        shards = index.get("shards")
        if not isinstance(shards, list) or len(shards) != manifest.get("canonical_shard_count"):
            raise ValueError(f"Canonical shard count mismatch for generation {run_id}")

        canonical_path = directory / _CANONICAL_SHARD_PATH
        canonical_root = canonical_path.resolve()
        if canonical_path.is_symlink() or canonical_root.parent != directory.resolve():
            raise ValueError(f"Canonical shard directory escaped generation {run_id}")
        expected_paths = {
            str(shard.get("path"))
            for shard in shards
            if isinstance(shard, Mapping)
        }
        if len(expected_paths) != len(shards):
            raise ValueError(f"Canonical shard paths are not unique for generation {run_id}")
        actual_paths = {
            path.name
            for path in canonical_root.iterdir()
            if path.name != _CANONICAL_INDEX_NAME
        }
        if actual_paths != expected_paths:
            raise ValueError(f"Canonical shard file set mismatch for generation {run_id}")

        items_by_key: dict[str, Mapping[str, Any]] = {}
        stored_bytes = 0
        prior_partition: tuple[str, str] | None = None
        for shard in shards:
            if not isinstance(shard, Mapping):
                raise ValueError(f"Canonical shard metadata is invalid for generation {run_id}")
            series_id = str(shard.get("series_id", ""))
            period_year = str(shard.get("period_year", ""))
            partition = (series_id, period_year)
            if not series_id or not re.fullmatch(r"\d{4}|other", period_year):
                raise ValueError(f"Canonical shard partition is invalid for generation {run_id}")
            if prior_partition is not None and partition <= prior_partition:
                raise ValueError(f"Canonical shard ordering is invalid for generation {run_id}")
            prior_partition = partition
            expected_name = _canonical_shard_name(series_id, period_year)
            if shard.get("path") != expected_name:
                raise ValueError(f"Canonical shard name is invalid for generation {run_id}")
            shard_path = (canonical_root / expected_name).resolve()
            if shard_path.parent != canonical_root:
                raise ValueError(f"Canonical shard path escaped generation {run_id}")
            shard_bytes = shard_path.read_bytes()
            stored_bytes += len(shard_bytes)
            if len(shard_bytes) > self.max_canonical_shard_bytes:
                raise ValueError(
                    f"Canonical shard exceeds the configured file-size budget for generation {run_id}"
                )
            if len(shard_bytes) != shard.get("bytes"):
                raise ValueError(f"Canonical shard byte count mismatch for generation {run_id}")
            if hashlib.sha256(shard_bytes).hexdigest() != shard.get("sha256"):
                raise ValueError(f"Canonical shard checksum mismatch for generation {run_id}")
            shard_items = json.loads(shard_bytes)
            if not isinstance(shard_items, list) or len(shard_items) != shard.get("row_count"):
                raise ValueError(f"Canonical shard row count mismatch for generation {run_id}")
            if not all(isinstance(item, Mapping) for item in shard_items):
                raise ValueError(f"Canonical shard contains an invalid row for generation {run_id}")
            shard_keys: list[str] = []
            for item in shard_items:
                observation = _observation_from_json(item)
                if observation.series_id != series_id:
                    raise ValueError(
                        f"Canonical row escaped its series shard for generation {run_id}"
                    )
                if _canonical_period_year(observation.period) != period_year:
                    raise ValueError(
                        f"Canonical row escaped its year shard for generation {run_id}"
                    )
                if observation.key in items_by_key:
                    raise ValueError(f"Duplicate canonical key in generation {run_id}")
                items_by_key[observation.key] = item
                shard_keys.append(observation.key)
            if shard_keys != sorted(shard_keys):
                raise ValueError(f"Canonical row order drifted for generation {run_id}")

        if stored_bytes != index.get("stored_bytes"):
            raise ValueError(f"Canonical stored-byte count mismatch for generation {run_id}")
        if len(items_by_key) != index.get("row_count") or len(items_by_key) != manifest.get("row_count"):
            raise ValueError(f"Canonical row count mismatch for generation {run_id}")
        return [items_by_key[key] for key in sorted(items_by_key)]

    def publish(
        self,
        run_id: str,
        snapshot: CanonicalSnapshot,
        *,
        validator: Callable[[CanonicalSnapshot], None] | None = None,
        stage_validator: Callable[[Path, CanonicalSnapshot], None] | None = None,
    ) -> Path:
        self._validate_run_id(run_id)
        final = self.generations / run_id
        if final.exists():
            raise FileExistsError(f"Generation already exists: {run_id}")
        _unique_by_key(snapshot.observations, "candidate canonical snapshot")
        if len(dict(snapshot.metadata)) != len(snapshot.metadata):
            raise ValueError("Snapshot metadata keys must be unique")
        if validator is not None:
            validator(snapshot)
        self.generations.mkdir(parents=True, exist_ok=True)
        self.staging.mkdir(parents=True, exist_ok=True)
        # tempfile.mkdtemp applies a restrictive Windows ACL that can exclude the
        # managed CI sandbox identity. A random, inherited-ACL directory is still
        # collision-safe and remains inside the already validated store root.
        stage = self.staging / f"{run_id}-{uuid.uuid4().hex}"
        stage.mkdir()
        try:
            canonical_rows = tuple(sorted(snapshot.observations, key=lambda row: row.key))
            canonical_items = [_observation_to_json(row) for row in canonical_rows]
            canonical_bytes = _json_bytes(canonical_items)
            revisions_bytes = _json_bytes([_revision_to_json(row) for row in snapshot.revisions])
            if len(canonical_bytes) > self.max_canonical_bytes:
                raise ValueError(
                    "Canonical generation exceeds the configured bounded total-size budget: "
                    f"{len(canonical_bytes)} bytes > {self.max_canonical_bytes} bytes"
                )
            if len(revisions_bytes) > self.max_revision_bytes:
                raise ValueError(
                    "Revision ledger exceeds the configured repository-safe file budget: "
                    f"{len(revisions_bytes)} bytes > {self.max_revision_bytes} bytes"
                )
            current_run_id = self.current_run_id()
            if current_run_id is not None:
                # Do not derive a growth allowance from an unchecked manifest.
                # This also guarantees that an already-corrupt CURRENT can never
                # be hidden by publishing a replacement over its pointer.
                self.load(current_run_id)
                current_manifest_path = self.generations / current_run_id / "manifest.json"
                current_manifest = json.loads(current_manifest_path.read_text(encoding="utf-8"))
                previous_bytes = current_manifest.get("canonical_bytes")
                if not isinstance(previous_bytes, int) or previous_bytes < 0:
                    raise ValueError("Current canonical byte count is invalid")
                allowed_growth = max(
                    int(previous_bytes * self.max_canonical_growth_ratio),
                    self.min_canonical_growth_bytes,
                )
                if len(canonical_bytes) > previous_bytes + allowed_growth:
                    raise ValueError(
                        "Canonical generation exceeds the reviewed growth budget: "
                        f"{len(canonical_bytes)} bytes > "
                        f"{previous_bytes + allowed_growth} bytes"
                    )
            shard_root = stage / _CANONICAL_SHARD_PATH
            shard_root.mkdir()
            shard_manifest: list[dict[str, Any]] = []
            stored_bytes = 0
            for series_id, period_year, shard_items in _canonical_partitions(canonical_items):
                shard_bytes = _json_bytes(shard_items)
                if len(shard_bytes) > self.max_canonical_shard_bytes:
                    raise ValueError(
                        "Canonical shard exceeds the configured repository-safe file budget: "
                        f"{len(shard_bytes)} bytes > {self.max_canonical_shard_bytes} bytes"
                    )
                shard_name = _canonical_shard_name(series_id, period_year)
                (shard_root / shard_name).write_bytes(shard_bytes)
                stored_bytes += len(shard_bytes)
                shard_manifest.append(
                    {
                        "path": shard_name,
                        "series_id": series_id,
                        "period_year": period_year,
                        "row_count": len(shard_items),
                        "bytes": len(shard_bytes),
                        "sha256": hashlib.sha256(shard_bytes).hexdigest(),
                    }
                )
            canonical_index = {
                "schema_version": "1.0.0",
                "layout": _CANONICAL_SHARD_LAYOUT,
                "run_id": run_id,
                "partition": "series_id/year",
                "sort": "observation_key",
                "row_count": len(canonical_items),
                "canonical_bytes": len(canonical_bytes),
                "canonical_sha256": hashlib.sha256(canonical_bytes).hexdigest(),
                "stored_bytes": stored_bytes,
                "shards": shard_manifest,
            }
            canonical_index_bytes = _json_bytes(canonical_index)
            (shard_root / _CANONICAL_INDEX_NAME).write_bytes(canonical_index_bytes)
            (stage / "revisions.json").write_bytes(revisions_bytes)
            manifest = {
                "schema_version": "1.1.0",
                "run_id": run_id,
                "row_count": len(snapshot.observations),
                "revision_count": len(snapshot.revisions),
                "canonical_layout": _CANONICAL_SHARD_LAYOUT,
                "canonical_index_path": (
                    f"{_CANONICAL_SHARD_PATH.as_posix()}/{_CANONICAL_INDEX_NAME}"
                ),
                "canonical_index_sha256": hashlib.sha256(canonical_index_bytes).hexdigest(),
                "canonical_shard_count": len(shard_manifest),
                "canonical_bytes": len(canonical_bytes),
                "revisions_bytes": len(revisions_bytes),
                "canonical_sha256": hashlib.sha256(canonical_bytes).hexdigest(),
                "revisions_sha256": hashlib.sha256(revisions_bytes).hexdigest(),
                "metadata": dict(snapshot.metadata),
            }
            (stage / "manifest.json").write_bytes(_json_bytes(manifest))
            if stage_validator is not None:
                stage_validator(stage, snapshot)
            try:
                replace_path_with_retry(stage, final)
            except PermissionError:
                # Windows file scanners can hold a newly built directory open
                # long enough to make an otherwise valid directory rename fail.
                # The generation is not active until CURRENT moves, so copying
                # into its unique final id and re-validating remains fail-closed.
                if final.exists():
                    raise
                try:
                    shutil.copytree(stage, final)
                except Exception:
                    if final.exists():
                        shutil.rmtree(final)
                    raise
                shutil.rmtree(stage)
            try:
                # Verify the exact physical candidate that CURRENT will point
                # to. The in-memory snapshot and staged public checks alone do
                # not prove shard/index/readback integrity.
                self.load(run_id)
            except Exception:
                if final.exists():
                    shutil.rmtree(final)
                raise
            self.root.mkdir(parents=True, exist_ok=True)
            pointer_fd, pointer_name = tempfile.mkstemp(prefix="CURRENT-", dir=self.root, text=True)
            try:
                with os.fdopen(pointer_fd, "w", encoding="utf-8", newline="\n") as pointer:
                    pointer.write(f"{run_id}\n")
                    pointer.flush()
                    os.fsync(pointer.fileno())
                replace_path_with_retry(pointer_name, self.root / "CURRENT")
            except Exception:
                # The validated generation is not active unless CURRENT moves.
                # Remove an orphaned candidate so an explicit run id can be
                # retried cleanly after a transient Windows pointer lock.
                if final.exists():
                    shutil.rmtree(final)
                raise
            finally:
                if os.path.exists(pointer_name):
                    os.unlink(pointer_name)
            return final
        except Exception:
            if stage.exists():
                shutil.rmtree(stage)
            raise

    def prune_generations(self, *, retain: int = 2) -> tuple[str, ...]:
        """Retain CURRENT plus the newest validated predecessors.

        Invalid, symlinked, or unrecognized directories fail closed and are never
        deletion targets. This method never touches the CURRENT pointer.
        """

        if retain < 1:
            raise ValueError("retain must be at least 1 so CURRENT is preserved")
        current = self.current_run_id()
        if current is None or not self.generations.exists():
            return ()
        root = self.generations.resolve()
        validated: list[tuple[str, str]] = []
        for child in self.generations.iterdir():
            if not child.is_dir() or child.is_symlink():
                continue
            resolved = child.resolve()
            if resolved.parent != root:
                continue
            try:
                self._validate_run_id(child.name)
                snapshot = self.load(child.name)
            except (OSError, ValueError, json.JSONDecodeError):
                continue
            generated_at = dict(snapshot.metadata).get("generated_at", "")
            validated.append((generated_at, child.name))
        predecessors = sorted(
            (item for item in validated if item[1] != current), reverse=True
        )
        keep = {current, *(run_id for _, run_id in predecessors[: retain - 1])}
        deleted: list[str] = []
        for _, run_id in validated:
            if run_id in keep:
                continue
            target = (self.generations / run_id).resolve()
            if target.parent != root or target == root:
                raise ValueError("Refusing generation cleanup outside exact store root")
            shutil.rmtree(target)
            deleted.append(run_id)
        return tuple(sorted(deleted))

    @staticmethod
    def _validate_run_id(run_id: str) -> None:
        if not _RUN_ID.fullmatch(run_id):
            raise ValueError("run_id must be a safe, bounded filesystem identifier")


def _json_bytes(value: Any) -> bytes:
    return (json.dumps(value, sort_keys=True, separators=(",", ":"), ensure_ascii=True) + "\n").encode(
        "utf-8"
    )


def _canonical_period_year(period: str) -> str:
    match = re.match(r"^(\d{4})(?:-|$)", period)
    return match.group(1) if match else "other"


def _canonical_shard_name(series_id: str, period_year: str) -> str:
    series_hash = hashlib.sha256(series_id.encode("utf-8")).hexdigest()[:20]
    return f"series-{series_hash}-{period_year}.json"


def _canonical_partitions(
    items: list[dict[str, Any]],
) -> tuple[tuple[str, str, list[dict[str, Any]]], ...]:
    """Return stable series/year partitions in canonical identity order."""

    grouped: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for item in items:
        series_id = str(item.get("series_id", ""))
        period = str(item.get("period", ""))
        if not series_id:
            raise ValueError("Canonical observation is missing series_id")
        grouped.setdefault((series_id, _canonical_period_year(period)), []).append(item)
    return tuple(
        (series_id, period_year, grouped[(series_id, period_year)])
        for series_id, period_year in sorted(grouped)
    )


def _timestamp(value: datetime | None) -> str | None:
    return None if value is None else value.isoformat()


def _observation_to_json(row: Observation) -> dict[str, Any]:
    return {
        "provider_id": row.provider_id,
        "series_id": row.series_id,
        "period": row.period,
        "geography_id": row.geography_id,
        "value": None if row.value is None else str(row.value),
        "unit": row.unit,
        "retrieved_at": _timestamp(row.retrieved_at),
        "status": row.status.value,
        "source_released_at": _timestamp(row.source_released_at),
        "source_updated_at": _timestamp(row.source_updated_at),
        "dimensions": list(row.dimensions),
        "components": [[key, str(value)] for key, value in row.components],
        "flags": list(row.flags),
        "original_value": row.original_value,
        "original_unit": row.original_unit,
    }


def _observation_from_json(item: Mapping[str, Any]) -> Observation:
    return Observation(
        provider_id=str(item["provider_id"]),
        series_id=str(item["series_id"]),
        period=str(item["period"]),
        geography_id=str(item["geography_id"]),
        value=None if item["value"] is None else Decimal(str(item["value"])),
        unit=str(item["unit"]),
        retrieved_at=datetime.fromisoformat(str(item["retrieved_at"])),
        status=ObservationStatus(str(item["status"])),
        source_released_at=(
            None if item.get("source_released_at") is None else datetime.fromisoformat(item["source_released_at"])
        ),
        source_updated_at=(
            None if item.get("source_updated_at") is None else datetime.fromisoformat(item["source_updated_at"])
        ),
        dimensions=tuple((str(k), str(v)) for k, v in item.get("dimensions", [])),
        components=tuple((str(k), Decimal(str(v))) for k, v in item.get("components", [])),
        flags=tuple(str(flag) for flag in item.get("flags", [])),
        original_value=item.get("original_value"),
        original_unit=item.get("original_unit"),
    )


def _revision_to_json(row: RevisionRecord) -> dict[str, Any]:
    return {
        "observation_key": row.observation_key,
        "old_value": None if row.old_value is None else str(row.old_value),
        "new_value": None if row.new_value is None else str(row.new_value),
        "old_status": row.old_status.value,
        "new_status": row.new_status.value,
        "detected_at": row.detected_at.isoformat(),
        "retrieved_at": row.retrieved_at.isoformat(),
        "provider_release_id": row.provider_release_id,
        "payload_hash": row.payload_hash,
    }


def _revision_from_json(item: Mapping[str, Any]) -> RevisionRecord:
    return RevisionRecord(
        observation_key=str(item["observation_key"]),
        old_value=None if item["old_value"] is None else Decimal(str(item["old_value"])),
        new_value=None if item["new_value"] is None else Decimal(str(item["new_value"])),
        old_status=ObservationStatus(str(item["old_status"])),
        new_status=ObservationStatus(str(item["new_status"])),
        detected_at=datetime.fromisoformat(str(item["detected_at"])),
        retrieved_at=datetime.fromisoformat(str(item["retrieved_at"])),
        provider_release_id=item.get("provider_release_id"),
        payload_hash=item.get("payload_hash"),
    )

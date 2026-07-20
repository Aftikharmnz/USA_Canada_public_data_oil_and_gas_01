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
DEFAULT_MAX_CANONICAL_BYTES = 90 * 1024 * 1024
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
    ) -> None:
        if max_canonical_bytes < 1:
            raise ValueError("max_canonical_bytes must be positive")
        self.root = root
        self.generations = root / "generations"
        self.staging = root / ".staging"
        self.max_canonical_bytes = max_canonical_bytes

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
        canonical_bytes = (directory / "canonical.json").read_bytes()
        revisions_bytes = (directory / "revisions.json").read_bytes()
        manifest = json.loads((directory / "manifest.json").read_text(encoding="utf-8"))
        if hashlib.sha256(canonical_bytes).hexdigest() != manifest.get("canonical_sha256"):
            raise ValueError(f"Canonical checksum mismatch for generation {run_id}")
        if hashlib.sha256(revisions_bytes).hexdigest() != manifest.get("revisions_sha256"):
            raise ValueError(f"Revision-ledger checksum mismatch for generation {run_id}")
        observations = json.loads(canonical_bytes)
        revisions = json.loads(revisions_bytes)
        return CanonicalSnapshot(
            observations=tuple(_observation_from_json(item) for item in observations),
            revisions=tuple(_revision_from_json(item) for item in revisions),
            metadata=tuple(sorted((str(k), str(v)) for k, v in manifest.get("metadata", {}).items())),
        )

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
            canonical_bytes = _json_bytes([_observation_to_json(row) for row in snapshot.observations])
            revisions_bytes = _json_bytes([_revision_to_json(row) for row in snapshot.revisions])
            if len(canonical_bytes) > self.max_canonical_bytes:
                raise ValueError(
                    "Canonical generation exceeds the configured repository-safe size budget: "
                    f"{len(canonical_bytes)} bytes > {self.max_canonical_bytes} bytes"
                )
            (stage / "canonical.json").write_bytes(canonical_bytes)
            (stage / "revisions.json").write_bytes(revisions_bytes)
            manifest = {
                "schema_version": "1.0.0",
                "run_id": run_id,
                "row_count": len(snapshot.observations),
                "revision_count": len(snapshot.revisions),
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
                    self.load(run_id)
                    if stage_validator is not None:
                        stage_validator(final, snapshot)
                except Exception:
                    if final.exists():
                        shutil.rmtree(final)
                    raise
                shutil.rmtree(stage)
            self.root.mkdir(parents=True, exist_ok=True)
            pointer_fd, pointer_name = tempfile.mkstemp(prefix="CURRENT-", dir=self.root, text=True)
            try:
                with os.fdopen(pointer_fd, "w", encoding="utf-8", newline="\n") as pointer:
                    pointer.write(f"{run_id}\n")
                    pointer.flush()
                    os.fsync(pointer.fileno())
                replace_path_with_retry(pointer_name, self.root / "CURRENT")
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

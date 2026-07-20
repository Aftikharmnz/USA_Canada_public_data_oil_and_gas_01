from __future__ import annotations

import shutil
import sys
import unittest
import uuid
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

PROJECT_ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(PROJECT_ROOT / "pipeline"))

from energy_dashboard.contracts import Observation, ObservationStatus
from energy_dashboard.storage import (
    CanonicalSnapshot,
    SnapshotStore,
    merge_canonical,
    replace_path_with_retry,
)


T0 = datetime(2026, 7, 1, tzinfo=UTC)
T1 = datetime(2026, 7, 19, tzinfo=UTC)


class AtomicReplaceTests(unittest.TestCase):
    def test_transient_windows_permission_error_is_retried(self) -> None:
        with (
            patch("energy_dashboard.storage.os.replace", side_effect=[PermissionError(), None]) as replace,
            patch("energy_dashboard.storage.time.sleep") as sleep,
        ):
            replace_path_with_retry("source", "destination", delays=(0.25,))

        self.assertEqual(replace.call_count, 2)
        sleep.assert_called_once_with(0.25)

    def test_exhausted_permission_retries_preserve_the_error(self) -> None:
        with (
            patch("energy_dashboard.storage.os.replace", side_effect=PermissionError()),
            patch("energy_dashboard.storage.time.sleep") as sleep,
            self.assertRaises(PermissionError),
        ):
            replace_path_with_retry("source", "destination", delays=(0.1, 0.2))

        self.assertEqual(sleep.call_count, 2)


def row(period: str, value: str | None, *, retrieved_at: datetime = T1,
        status: ObservationStatus = ObservationStatus.OBSERVED) -> Observation:
    return Observation(
        provider_id="eia",
        series_id="usa.eia.test",
        period=period,
        geography_id="us",
        value=None if value is None else Decimal(value),
        unit="thousand_barrels",
        retrieved_at=retrieved_at,
        status=status,
        dimensions=(("product", "crude"),),
    )


class CanonicalMergeTests(unittest.TestCase):
    def test_new_period_is_insert_not_revision_and_overlap_change_is_ledgered(self) -> None:
        current = CanonicalSnapshot((row("2026-05", "10", retrieved_at=T0),))
        result = merge_canonical(
            current,
            (row("2026-05", "11"), row("2026-06", "12")),
            detected_at=T1,
            payload_hash="abc123",
        )
        self.assertEqual(result.rows_inserted, 1)
        self.assertEqual(result.rows_revised, 1)
        self.assertEqual(len(result.snapshot.revisions), 1)
        revision = result.snapshot.revisions[0]
        self.assertEqual((revision.old_value, revision.new_value), (Decimal("10"), Decimal("11")))
        self.assertEqual(revision.payload_hash, "abc123")

    def test_identical_overlap_is_not_revision_and_unseen_history_is_retained(self) -> None:
        current = CanonicalSnapshot((row("2026-04", "9", retrieved_at=T0), row("2026-05", "10", retrieved_at=T0)))
        result = merge_canonical(current, (row("2026-05", "10"),), detected_at=T1)
        self.assertEqual(result.unchanged_keys, (row("2026-05", "10").key,))
        self.assertEqual(len(result.snapshot.observations), 2)
        self.assertEqual(result.snapshot.revisions, ())

    def test_status_change_to_suppressed_is_a_revision_not_zero(self) -> None:
        suppressed = row(
            "2026-05", None, status=ObservationStatus.SUPPRESSED_OR_WITHHELD
        )
        result = merge_canonical(
            CanonicalSnapshot((row("2026-05", "10", retrieved_at=T0),)),
            (suppressed,),
            detected_at=T1,
        )
        self.assertIsNone(result.snapshot.observations[0].value)
        self.assertEqual(result.snapshot.revisions[0].new_status, ObservationStatus.SUPPRESSED_OR_WITHHELD)

    def test_duplicate_incoming_keys_fail_closed(self) -> None:
        with self.assertRaisesRegex(ValueError, "Duplicate key"):
            merge_canonical(CanonicalSnapshot(()), (row("2026-05", "1"), row("2026-05", "2")), detected_at=T1)


class LastKnownGoodStoreTests(unittest.TestCase):
    def store_directory(self) -> Path:
        directory = Path(__file__).parent / f"_runtime_{uuid.uuid4().hex}"
        directory.mkdir()
        self.addCleanup(shutil.rmtree, directory, True)
        return directory

    def test_failed_candidate_does_not_move_current_pointer(self) -> None:
        directory = self.store_directory()
        store = SnapshotStore(directory)
        first = CanonicalSnapshot((row("2026-05", "10"),), metadata=(("registry", "v1"),))
        store.publish("run-001", first)

        def reject(_snapshot: CanonicalSnapshot) -> None:
            raise ValueError("validation failed")

        with self.assertRaisesRegex(ValueError, "validation failed"):
            store.publish("run-002", CanonicalSnapshot((row("2026-06", "20"),)), validator=reject)
        self.assertEqual(store.current_run_id(), "run-001")
        loaded = store.load_current()
        assert loaded is not None
        self.assertEqual(loaded.observations[0].value, Decimal("10"))
        self.assertFalse((directory / "generations" / "run-002").exists())

    def test_stage_failure_keeps_last_known_good_and_success_round_trips(self) -> None:
        directory = self.store_directory()
        store = SnapshotStore(directory)
        store.publish("run-001", CanonicalSnapshot((row("2026-05", "10"),)))

        def reject_stage(_path: Path, _snapshot: CanonicalSnapshot) -> None:
            raise RuntimeError("asset validation failed")

        with self.assertRaises(RuntimeError):
            store.publish(
                "run-002",
                CanonicalSnapshot((row("2026-06", "20"),)),
                stage_validator=reject_stage,
            )
        self.assertEqual(store.current_run_id(), "run-001")
        store.publish("run-003", CanonicalSnapshot((row("2026-06", "20"),)))
        self.assertEqual(store.current_run_id(), "run-003")
        self.assertEqual(store.load_current().observations[0].value, Decimal("20"))  # type: ignore[union-attr]

    def test_run_id_cannot_escape_store(self) -> None:
        directory = self.store_directory()
        with self.assertRaises(ValueError):
            SnapshotStore(directory).publish("../escape", CanonicalSnapshot(()))

    def test_checksum_tampering_is_detected(self) -> None:
        directory = self.store_directory()
        store = SnapshotStore(directory)
        store.publish("run-001", CanonicalSnapshot((row("2026-05", "10"),)))
        canonical = directory / "generations" / "run-001" / "canonical.json"
        canonical.write_text("[]\n", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "checksum mismatch"):
            store.load_current()

    def test_repository_safe_canonical_size_budget_fails_before_promotion(self) -> None:
        directory = self.store_directory()
        store = SnapshotStore(directory, max_canonical_bytes=16)
        with self.assertRaisesRegex(ValueError, "size budget"):
            store.publish("run-too-large", CanonicalSnapshot((row("2026-05", "10"),)))
        self.assertIsNone(store.current_run_id())
        self.assertFalse((directory / "generations" / "run-too-large").exists())

    def test_bounded_retention_preserves_current_and_newest_predecessor(self) -> None:
        directory = self.store_directory()
        store = SnapshotStore(directory)
        for index in range(1, 4):
            store.publish(
                f"run-00{index}",
                CanonicalSnapshot(
                    (row(f"2026-0{index}", str(index)),),
                    metadata=(("generated_at", f"2026-07-{index:02d}T00:00:00+00:00"),),
                ),
            )
        deleted = store.prune_generations(retain=2)
        self.assertEqual(deleted, ("run-001",))
        self.assertEqual(store.current_run_id(), "run-003")
        self.assertTrue((directory / "generations" / "run-002").is_dir())
        self.assertTrue((directory / "generations" / "run-003").is_dir())
        self.assertTrue((directory / "CURRENT").is_file())

        deleted = store.prune_generations(retain=1)
        self.assertEqual(deleted, ("run-002",))
        self.assertEqual(store.current_run_id(), "run-003")

    def test_retention_never_deletes_unvalidated_generation_directory(self) -> None:
        directory = self.store_directory()
        store = SnapshotStore(directory)
        store.publish("run-001", CanonicalSnapshot((row("2026-01", "1"),)))
        invalid = directory / "generations" / "unvalidated"
        invalid.mkdir()
        (invalid / "unexpected.txt").write_text("not a generation", encoding="utf-8")
        self.assertEqual(store.prune_generations(retain=1), ())
        self.assertTrue(invalid.is_dir())


if __name__ == "__main__":
    unittest.main()

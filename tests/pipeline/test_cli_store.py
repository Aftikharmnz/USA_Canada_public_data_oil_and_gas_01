from __future__ import annotations

import io
import json
import shutil
import sys
import unittest
import uuid
from contextlib import redirect_stdout
from datetime import UTC, datetime
from decimal import Decimal
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "pipeline"))

from energy_dashboard.cli import main
from energy_dashboard.contracts import Observation
from energy_dashboard.storage import CanonicalSnapshot, SnapshotStore

PROJECT_ROOT = Path(__file__).resolve().parents[2]


class VerifyStoreCommandTests(unittest.TestCase):
    def store_directory(self) -> Path:
        directory = PROJECT_ROOT / "tests" / "pipeline" / f"_runtime_cli_{uuid.uuid4().hex}"
        directory.mkdir()
        self.addCleanup(shutil.rmtree, directory, True)
        return directory

    def test_verify_store_loads_current_and_reports_safe_summary(self) -> None:
        root = self.store_directory()
        store = SnapshotStore(root)
        store.publish(
            "run-001",
            CanonicalSnapshot(
                observations=(
                    Observation(
                        provider_id="test",
                        series_id="test.energy.monthly",
                        period="2026-01",
                        geography_id="test-region",
                        value=Decimal("12.5"),
                        unit="thousand_barrels",
                        retrieved_at=datetime(2026, 2, 1, tzinfo=UTC),
                    ),
                ),
            ),
        )

        output = io.StringIO()
        with redirect_stdout(output):
            result = main(
                [
                    "verify-store",
                    "--store",
                    str(root),
                    "--expected-run-id",
                    "run-001",
                ]
            )

        payload = json.loads(output.getvalue())
        self.assertEqual(result, 0)
        self.assertTrue(payload["verified"])
        self.assertEqual(payload["network_calls"], 0)
        self.assertEqual(payload["current_run_id"], "run-001")
        self.assertEqual(payload["observation_count"], 1)
        self.assertEqual(payload["revision_count"], 0)
        self.assertEqual(payload["series_count"], 1)

    def test_verify_store_rejects_missing_or_unexpected_current(self) -> None:
        root = self.store_directory()
        with self.assertRaisesRegex(ValueError, "no CURRENT generation"):
            main(["verify-store", "--store", str(root)])

        SnapshotStore(root).publish("run-001", CanonicalSnapshot(()))
        with self.assertRaisesRegex(ValueError, "CURRENT run id mismatch"):
            main(
                [
                    "verify-store",
                    "--store",
                    str(root),
                    "--expected-run-id",
                    "run-002",
                ]
            )


if __name__ == "__main__":
    unittest.main()

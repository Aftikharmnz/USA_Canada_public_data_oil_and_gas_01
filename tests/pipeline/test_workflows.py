from __future__ import annotations

import unittest
from pathlib import Path


PROJECT_ROOT = Path(__file__).resolve().parents[2]


class RefreshWorkflowOrderingTests(unittest.TestCase):
    def test_pages_artifact_is_built_from_the_rebased_revision(self) -> None:
        for relative_path in (
            ".github/workflows/refresh-data.yml",
            ".github/workflows/refresh-canada.yml",
        ):
            with self.subTest(workflow=relative_path):
                workflow = (PROJECT_ROOT / relative_path).read_text(encoding="utf-8")

                precommit_scan = workflow.index("before commit")
                commit = workflow.index('git commit -m "data: refresh')
                rebase = workflow.index('git pull --rebase origin "${GITHUB_REF_NAME}"')
                rebased_contracts = workflow.index(
                    "- name: Validate rebased pipeline contracts"
                )
                post_rebase_scan = workflow.index("- name: Verify rebased")
                frontend_check = workflow.index("- name: Validate rebased frontend")
                build = workflow.index("run: pnpm run build")
                push = workflow.index('git push origin "HEAD:${GITHUB_REF_NAME}"')
                upload = workflow.index("uses: actions/upload-pages-artifact@v4")

                self.assertLess(precommit_scan, commit)
                self.assertLess(commit, rebase)
                self.assertLess(rebase, rebased_contracts)
                self.assertLess(rebased_contracts, post_rebase_scan)
                self.assertLess(post_rebase_scan, frontend_check)
                self.assertLess(frontend_check, build)
                self.assertLess(build, push)
                self.assertLess(push, upload)

    def test_unchanged_refresh_still_gates_all_publish_steps(self) -> None:
        for relative_path in (
            ".github/workflows/refresh-data.yml",
            ".github/workflows/refresh-canada.yml",
        ):
            with self.subTest(workflow=relative_path):
                workflow = (PROJECT_ROOT / relative_path).read_text(encoding="utf-8")
                publish_section = workflow[
                    workflow.index("      - uses: pnpm/action-setup@v4") :
                    workflow.index("\n  deploy:")
                ]

                guarded_steps = publish_section.count(
                    "if: steps.refresh.outputs.changed == 'true'"
                )
                step_count = publish_section.count("      - ")
                self.assertEqual(guarded_steps, step_count)


if __name__ == "__main__":
    unittest.main()

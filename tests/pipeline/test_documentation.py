from __future__ import annotations

import re
import unittest
from pathlib import Path
from urllib.parse import unquote


PROJECT_ROOT = Path(__file__).resolve().parents[2]
LINK = re.compile(r"(?<!!)\[[^\]]+\]\(([^)]+)\)")


class DocumentationTests(unittest.TestCase):
    def test_internal_markdown_links_resolve(self) -> None:
        markdown_files = [
            PROJECT_ROOT / "README.md",
            PROJECT_ROOT / "CLAUDE.md",
            PROJECT_ROOT / "AGENTS.md",
            *sorted((PROJECT_ROOT / "docs").rglob("*.md")),
            *sorted((PROJECT_ROOT / "config").rglob("*.md")),
        ]
        missing: list[str] = []
        for markdown_path in markdown_files:
            text = markdown_path.read_text(encoding="utf-8")
            for target in LINK.findall(text):
                clean_target = target.strip().split("#", 1)[0]
                if not clean_target or clean_target.startswith(("https://", "http://", "mailto:")):
                    continue
                resolved = (markdown_path.parent / unquote(clean_target)).resolve()
                if not resolved.exists():
                    missing.append(f"{markdown_path.relative_to(PROJECT_ROOT)} -> {target}")
        self.assertEqual(missing, [], "Broken internal links:\n" + "\n".join(missing))


if __name__ == "__main__":
    unittest.main()


from __future__ import annotations

import json
import unittest
from pathlib import Path

from llm_wiki.utils import directory_fingerprint, parse_frontmatter, traversable_fingerprint
from llm_wiki.binding import canonical_skill_root

from .common import PROJECT_ROOT


class SkillContractTests(unittest.TestCase):
    def test_visible_skill_matches_packaged_canonical_skill(self) -> None:
        visible = PROJECT_ROOT / "skills/llm-wiki"
        self.assertEqual(directory_fingerprint(visible), traversable_fingerprint(canonical_skill_root()))

    def test_skill_uses_common_frontmatter_only(self) -> None:
        skill = PROJECT_ROOT / "skills/llm-wiki/SKILL.md"
        metadata = parse_frontmatter(skill.read_text(encoding="utf-8"))
        self.assertEqual(set(metadata), {"name", "description"})
        self.assertEqual(metadata["name"], "llm-wiki")
        self.assertIn("Obsidian", metadata["description"])

    def test_skill_defines_agent_first_capabilities_and_boundaries(self) -> None:
        text = (PROJECT_ROOT / "skills/llm-wiki/SKILL.md").read_text(encoding="utf-8")
        for term in ("Orient", "Ingest", "Query / Explore", "Promote", "Reconcile / Maintain"):
            self.assertIn(term, text)
        self.assertIn("sources/library/", text)
        self.assertIn("Runtime Sidecar", text)
        self.assertIn("完成条件", text)

    def test_cross_harness_eval_cases_cover_all_capabilities(self) -> None:
        cases = json.loads((PROJECT_ROOT / "evals/cases.json").read_text(encoding="utf-8"))
        capabilities = {case["capability"] for case in cases}
        self.assertEqual(
            capabilities,
            {"orient", "ingest", "query", "promote", "reconcile", "boundary"},
        )
        for case in cases:
            self.assertTrue(case["observable_acceptance"])
            self.assertTrue(case["forbidden"])

    def test_no_mcp_or_database_is_required_by_skill(self) -> None:
        text = (PROJECT_ROOT / "skills/llm-wiki/SKILL.md").read_text(encoding="utf-8")
        self.assertNotIn("必须启动 MCP", text)
        self.assertNotIn("必须使用向量数据库", text)


if __name__ == "__main__":
    unittest.main()

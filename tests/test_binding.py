from __future__ import annotations

import shutil
import tempfile
import unittest
from pathlib import Path

from llm_wiki.binding import attach, detach, load_binding
from llm_wiki.doctor import validate_binding, validate_vault
from llm_wiki.utils import MANAGED_BEGIN, directory_fingerprint
from llm_wiki.vault import init_vault


def errors(findings):
    return [item for item in findings if item.level == "error"]


class BindingTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.vault = self.base / "vault"
        self.workspace = self.base / "binding"
        init_vault(self.vault, "Binding Vault")

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_attach_all_uses_official_project_locations(self) -> None:
        attach(self.vault, self.workspace, ["all"])
        self.assertTrue((self.workspace / ".agents/skills/llm-wiki/SKILL.md").is_file())
        self.assertTrue((self.workspace / ".claude/skills/llm-wiki/SKILL.md").is_file())
        self.assertTrue((self.workspace / "skills/llm-wiki/SKILL.md").is_file())
        self.assertTrue((self.workspace / "vault").is_symlink())
        self.assertEqual((self.workspace / "vault").resolve(), self.vault.resolve())
        self.assertEqual(errors(validate_binding(self.workspace)), [])
        self.assertEqual(errors(validate_vault(self.vault)), [])

    def test_attach_is_idempotent_and_managed_block_is_not_duplicated(self) -> None:
        attach(self.vault, self.workspace, ["all"])
        attach(self.vault, self.workspace, ["all"])
        self.assertEqual((self.workspace / "AGENTS.md").read_text().count(MANAGED_BEGIN), 1)
        self.assertEqual((self.workspace / "CLAUDE.md").read_text().count(MANAGED_BEGIN), 1)
        self.assertEqual(errors(validate_binding(self.workspace)), [])

    def test_managed_agents_rules_make_vault_intake_roots_read_only(self) -> None:
        attach(self.vault, self.workspace, ["codex"])

        agents = (self.workspace / "AGENTS.md").read_text(encoding="utf-8")

        self.assertIn("sources/inbox/", agents)
        self.assertIn("Clippings/", agents)
        self.assertIn("read-only, untrusted intake roots", agents)
        self.assertIn("never write generated content back into an intake root", agents)

    def test_existing_user_instructions_survive_attach_and_detach(self) -> None:
        self.workspace.mkdir()
        (self.workspace / "AGENTS.md").write_text("# User Agents\n\nKeep this.\n", encoding="utf-8")
        (self.workspace / "CLAUDE.md").write_text("# User Claude\n\nKeep this too.\n", encoding="utf-8")
        (self.workspace / "BINDING.md").write_text("# User Binding Notes\n\nKeep this binding note.\n", encoding="utf-8")
        attach(self.vault, self.workspace, ["all"])
        self.assertIn("Keep this.", (self.workspace / "AGENTS.md").read_text(encoding="utf-8"))
        detach(self.workspace, ["all"])
        self.assertEqual(
            (self.workspace / "AGENTS.md").read_text(encoding="utf-8"),
            "# User Agents\n\nKeep this.\n",
        )
        self.assertEqual(
            (self.workspace / "CLAUDE.md").read_text(encoding="utf-8"),
            "# User Claude\n\nKeep this too.\n",
        )
        self.assertEqual(
            (self.workspace / "BINDING.md").read_text(encoding="utf-8"),
            "# User Binding Notes\n\nKeep this binding note.\n",
        )
        self.assertFalse((self.workspace / ".llm-wiki-binding").exists())
        self.assertFalse((self.workspace / "vault").exists())

    def test_partial_detach_preserves_other_harnesses(self) -> None:
        attach(self.vault, self.workspace, ["all"])
        detach(self.workspace, ["claude"])
        binding = load_binding(self.workspace)
        self.assertEqual(binding["harnesses"], ["codex", "openclaw"])
        self.assertFalse((self.workspace / ".claude/skills/llm-wiki").exists())
        self.assertTrue((self.workspace / ".agents/skills/llm-wiki").exists())
        self.assertTrue((self.workspace / "skills/llm-wiki").exists())
        self.assertFalse((self.workspace / "CLAUDE.md").exists())
        self.assertTrue((self.workspace / "AGENTS.md").exists())
        self.assertEqual(errors(validate_binding(self.workspace)), [])

    def test_pointer_mode_has_no_vault_link(self) -> None:
        attach(self.vault, self.workspace, ["codex"], vault_mode="pointer")
        self.assertFalse((self.workspace / "vault").exists())
        binding = load_binding(self.workspace)
        self.assertEqual(binding["vault_reference"], str(self.vault.resolve()))
        self.assertIn(str(self.vault.resolve()), (self.workspace / "AGENTS.md").read_text())
        self.assertEqual(errors(validate_binding(self.workspace)), [])

    def test_vault_and_binding_must_be_independent_roots(self) -> None:
        nested = self.vault / "binding"
        with self.assertRaises(ValueError):
            attach(self.vault, nested, ["codex"])
        self.assertFalse(nested.exists())

    def test_unmanaged_skill_is_not_overwritten(self) -> None:
        target = self.workspace / ".agents/skills/llm-wiki"
        target.mkdir(parents=True)
        (target / "SKILL.md").write_text("user skill", encoding="utf-8")
        with self.assertRaises(FileExistsError):
            attach(self.vault, self.workspace, ["codex"])
        self.assertEqual((target / "SKILL.md").read_text(encoding="utf-8"), "user skill")
        self.assertFalse((self.workspace / "vault").exists())
        self.assertFalse((self.workspace / ".llm-wiki-binding").exists())

    def test_move_vault_and_rebind(self) -> None:
        attach(self.vault, self.workspace, ["all"])
        moved = self.base / "moved-vault"
        shutil.move(str(self.vault), moved)
        codes = {item.code for item in validate_binding(self.workspace) if item.level == "error"}
        self.assertIn("binding.vault-missing", codes)
        attach(moved, self.workspace, ["all"])
        self.assertEqual((self.workspace / "vault").resolve(), moved.resolve())
        self.assertEqual(errors(validate_binding(self.workspace)), [])

    def test_detach_does_not_change_vault(self) -> None:
        attach(self.vault, self.workspace, ["all"])
        before = directory_fingerprint(self.vault)
        detach(self.workspace, ["all"])
        after = directory_fingerprint(self.vault)
        self.assertEqual(before, after)
        self.assertEqual(errors(validate_vault(self.vault)), [])

    def test_skill_symlink_mode(self) -> None:
        attach(self.vault, self.workspace, ["all"], skill_mode="symlink")
        self.assertTrue((self.workspace / ".agents/skills/llm-wiki").is_symlink())
        self.assertTrue((self.workspace / ".claude/skills/llm-wiki").is_symlink())
        self.assertTrue((self.workspace / "skills/llm-wiki").is_symlink())
        self.assertEqual(errors(validate_binding(self.workspace)), [])


if __name__ == "__main__":
    unittest.main()

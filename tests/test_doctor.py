from __future__ import annotations

import json
import shutil
import tempfile
import unittest
from pathlib import Path

from llm_wiki.binding import attach
from llm_wiki.doctor import detect_kind, validate_binding, validate_kit, validate_vault
from llm_wiki.vault import init_vault, register_source

from .common import PROJECT_ROOT


class DoctorTests(unittest.TestCase):
    def test_kit_is_valid(self) -> None:
        findings = validate_kit(PROJECT_ROOT)
        self.assertFalse([item for item in findings if item.level == "error"], findings)

    def test_detect_kind(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            vault = base / "vault"
            binding = base / "binding"
            init_vault(vault, "Detect")
            attach(vault, binding, ["codex"])
            self.assertEqual(detect_kind(vault), "vault")
            self.assertEqual(detect_kind(binding), "binding")
            self.assertEqual(detect_kind(PROJECT_ROOT), "kit")

    def test_invalid_obsidian_json_is_detected(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            vault = Path(temp) / "vault"
            init_vault(vault, "Bad JSON")
            (vault / ".obsidian/app.json").write_text("{", encoding="utf-8")
            codes = {item.code for item in validate_vault(vault) if item.level == "error"}
            self.assertIn("vault.obsidian-json", codes)

    def test_required_vault_paths_must_have_the_declared_type(self) -> None:
        replacements = {
            "sources/inbox": "file",
            "logs/operations.md": "directory",
        }
        for relative, replacement in replacements.items():
            with self.subTest(relative=relative):
                with tempfile.TemporaryDirectory() as temp:
                    vault = Path(temp) / "vault"
                    init_vault(vault, "Wrong required type")
                    target = vault / relative
                    if target.is_dir():
                        shutil.rmtree(target)
                    else:
                        target.unlink()
                    if replacement == "file":
                        target.write_text("not a directory", encoding="utf-8")
                    else:
                        target.mkdir()

                    codes = {
                        item.code for item in validate_vault(vault) if item.level == "error"
                    }
                    self.assertIn("vault.required-type", codes)

    def test_source_path_escape_is_detected(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            vault = base / "vault"
            init_vault(vault, "Escape")
            record = vault / "wiki/sources/evil.md"
            record.write_text(
                "---\ntitle: Evil\ntype: source\nsource_path: ../outside.txt\nsha256: deadbeef\n---\n",
                encoding="utf-8",
            )
            codes = {item.code for item in validate_vault(vault) if item.level == "error"}
            self.assertIn("source.path-escape", codes)

    def test_installed_skill_drift_is_detected(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            vault = base / "vault"
            binding = base / "binding"
            init_vault(vault, "Drift")
            attach(vault, binding, ["codex"])
            skill = binding / ".agents/skills/llm-wiki/SKILL.md"
            skill.write_text(skill.read_text(encoding="utf-8") + "\nchanged\n", encoding="utf-8")
            codes = {item.code for item in validate_binding(binding) if item.level == "error"}
            self.assertIn("skill.drift", codes)

    def test_missing_registered_file_is_detected(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            vault = base / "vault"
            source = base / "source.txt"
            source.write_text("data", encoding="utf-8")
            init_vault(vault, "Missing")
            result = register_source(vault, source)
            Path(str(result.details["registered_file"])).unlink()
            codes = {item.code for item in validate_vault(vault) if item.level == "error"}
            self.assertIn("source.file-missing", codes)


if __name__ == "__main__":
    unittest.main()

from __future__ import annotations

import json
import os
import shutil
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from llm_wiki import __version__
from llm_wiki.binding import (
    BINDING_DIR,
    MARKER_FILE,
    SKILL_TARGETS,
    attach,
    canonical_skill_fingerprint,
    load_binding,
    update,
)
from llm_wiki.utils import directory_fingerprint
from llm_wiki.utils import MANAGED_BEGIN, MANAGED_END, render_managed_block
from llm_wiki.vault import init_vault


class WorkspaceUpdateTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.vault = self.base / "vault"
        self.workspace = self.base / "workspace"
        init_vault(self.vault, "Update Vault")

    def tearDown(self) -> None:
        self.temp.cleanup()

    def _write_json(self, path: Path, payload: object) -> None:
        path.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")

    def _make_legacy(self, harnesses: list[str]) -> None:
        binding_path = self.workspace / BINDING_DIR / "binding.json"
        binding = json.loads(binding_path.read_text(encoding="utf-8"))
        binding["kit_version"] = "0.0.9"
        binding.pop("skill_fingerprint", None)
        self._write_json(binding_path, binding)
        for harness in harnesses:
            marker_path = self.workspace / SKILL_TARGETS[harness] / MARKER_FILE
            marker = json.loads(marker_path.read_text(encoding="utf-8"))
            marker["kit_version"] = "0.0.9"
            marker.pop("skill_fingerprint", None)
            self._write_json(marker_path, marker)

    def test_current_workspace_is_idempotent_without_timestamp_or_backup(self) -> None:
        attach(self.vault, self.workspace, ["codex"])
        before = (self.workspace / BINDING_DIR / "binding.json").read_bytes()
        result = update(self.workspace)
        self.assertEqual(result.details["status"], "already-current")
        self.assertEqual(result.details["updated_targets"], [])
        self.assertEqual(result.details["backups"], [])
        self.assertEqual((self.workspace / BINDING_DIR / "binding.json").read_bytes(), before)
        self.assertFalse((self.workspace / BINDING_DIR / "runtime/update-backups").exists())

    def test_legacy_marker_is_backed_up_and_upgraded(self) -> None:
        attach(self.vault, self.workspace, ["codex"])
        self._make_legacy(["codex"])
        result = update(self.workspace)
        self.assertEqual(result.details["status"], "updated")
        self.assertEqual(result.details["from_kit_version"], "0.0.9")
        self.assertEqual(len(result.details["backups"]), 1)
        backup = Path(result.details["backups"][0])
        self.assertTrue((backup / "SKILL.md").is_file())
        marker = json.loads(
            (self.workspace / SKILL_TARGETS["codex"] / MARKER_FILE).read_text(encoding="utf-8")
        )
        self.assertEqual(marker["skill_fingerprint"], canonical_skill_fingerprint())
        binding = load_binding(self.workspace)
        self.assertEqual(binding["kit_version"], __version__)
        self.assertEqual(binding["skill_fingerprint"], canonical_skill_fingerprint())

    def test_local_copy_drift_is_backed_up(self) -> None:
        attach(self.vault, self.workspace, ["codex"])
        target = self.workspace / SKILL_TARGETS["codex"]
        (target / "local-note.txt").write_text("keep for recovery\n", encoding="utf-8")
        result = update(self.workspace)
        backup = Path(result.details["backups"][0])
        self.assertEqual((backup / "local-note.txt").read_text(), "keep for recovery\n")
        self.assertFalse((target / "local-note.txt").exists())

    def test_directory_symlink_drift_is_detected_and_backed_up(self) -> None:
        attach(self.vault, self.workspace, ["codex"])
        target = self.workspace / SKILL_TARGETS["codex"]
        external = self.base / "external-skill-data"
        external.mkdir()
        (target / "local-link").symlink_to(external, target_is_directory=True)
        result = update(self.workspace)
        backup = Path(result.details["backups"][0])
        self.assertTrue((backup / "local-link").is_symlink())
        self.assertFalse((target / "local-link").exists())
        self.assertEqual(list(external.iterdir()), [])

    def test_all_harnesses_are_staged_before_update(self) -> None:
        attach(self.vault, self.workspace, ["all"])
        self._make_legacy(["codex", "claude", "openclaw"])
        result = update(self.workspace)
        self.assertEqual(result.details["harnesses"], ["codex", "claude", "openclaw"])
        self.assertEqual(len(result.details["backups"]), 3)
        for harness in ("codex", "claude", "openclaw"):
            self.assertTrue((self.workspace / SKILL_TARGETS[harness] / "scripts/register_repository.py").is_file())

    def test_unmanaged_copy_is_rejected_before_other_writes(self) -> None:
        attach(self.vault, self.workspace, ["codex"])
        target = self.workspace / SKILL_TARGETS["codex"]
        (target / MARKER_FILE).unlink()
        binding_before = (self.workspace / BINDING_DIR / "binding.json").read_bytes()
        docs_before = (self.workspace / "AGENTS.md").read_bytes()
        with self.assertRaises(RuntimeError):
            update(self.workspace)
        self.assertEqual((self.workspace / BINDING_DIR / "binding.json").read_bytes(), binding_before)
        self.assertEqual((self.workspace / "AGENTS.md").read_bytes(), docs_before)
        self.assertFalse((self.workspace / BINDING_DIR / "runtime/update-backups").exists())

    def test_backup_directory_symlink_escape_is_rejected_before_writes(self) -> None:
        attach(self.vault, self.workspace, ["codex"])
        external = self.base / "external-backups"
        external.mkdir()
        backup_root = self.workspace / BINDING_DIR / "runtime/update-backups"
        backup_root.symlink_to(external, target_is_directory=True)
        binding_before = (self.workspace / BINDING_DIR / "binding.json").read_bytes()
        with self.assertRaises(ValueError):
            update(self.workspace)
        self.assertEqual((self.workspace / BINDING_DIR / "binding.json").read_bytes(), binding_before)
        self.assertEqual(list(external.iterdir()), [])
        self.assertTrue(backup_root.is_symlink())

    def test_symlink_mode_records_and_retargets_old_link(self) -> None:
        attach(self.vault, self.workspace, ["codex"], skill_mode="symlink")
        target = self.workspace / SKILL_TARGETS["codex"]
        alternate = self.base / "old-skill"
        shutil.copytree(target.resolve(), alternate)
        target.unlink()
        target.symlink_to(alternate, target_is_directory=True)
        result = update(self.workspace)
        self.assertEqual(result.details["status"], "updated")
        backup = Path(result.details["backups"][0])
        self.assertEqual((backup / "symlink-target.txt").read_text().strip(), str(alternate))
        self.assertNotEqual(target.resolve(), alternate.resolve())
        self.assertTrue((target / "scripts/register_repository.py").is_file())

    def test_managed_docs_preserve_user_text(self) -> None:
        attach(self.vault, self.workspace, ["codex"])
        agents = self.workspace / "AGENTS.md"
        agents.write_text("# User\n\nKeep this.\n\n" + agents.read_text(), encoding="utf-8")
        binding_path = self.workspace / BINDING_DIR / "binding.json"
        binding = json.loads(binding_path.read_text(encoding="utf-8"))
        binding["kit_version"] = "old"
        self._write_json(binding_path, binding)
        result = update(self.workspace)
        self.assertEqual(result.details["status"], "updated")
        self.assertIn("Keep this.", agents.read_text(encoding="utf-8"))

    def test_managed_block_replacement_preserves_surrounding_bytes_and_position(self) -> None:
        existing = (
            "prefix without normalization  \n"
            f"{MANAGED_BEGIN}\nold managed body\n{MANAGED_END}\n"
            "suffix stays after block  \n\n"
        )
        expected = existing.replace(
            f"{MANAGED_BEGIN}\nold managed body\n{MANAGED_END}",
            f"{MANAGED_BEGIN}\nnew managed body\n{MANAGED_END}",
        )
        self.assertEqual(render_managed_block(existing, "new managed body"), expected)

    def test_managed_block_removal_preserves_surrounding_newlines(self) -> None:
        block = f"{MANAGED_BEGIN}\nmanaged body\n{MANAGED_END}"
        existing = f"prefix\n{block}\nsuffix\n"
        self.assertEqual(render_managed_block(existing, None), "prefix\n\nsuffix\n")
        self.assertIsNone(render_managed_block(block + "\n", None))

    def test_binding_write_failure_rolls_back_every_workspace_artifact(self) -> None:
        attach(self.vault, self.workspace, ["codex"])
        target = self.workspace / SKILL_TARGETS["codex"]
        (target / "local-note.txt").write_text("restore me\n", encoding="utf-8")
        skill_before = directory_fingerprint(target)
        binding_path = self.workspace / BINDING_DIR / "binding.json"
        binding_before = binding_path.read_bytes()
        docs_before = {
            path: (self.workspace / path).read_bytes()
            for path in ("AGENTS.md", "BINDING.md", ".gitignore")
        }
        original = __import__("llm_wiki.binding", fromlist=["atomic_write_json"]).atomic_write_json

        def fail_binding_write(path, payload):
            if path == binding_path:
                raise OSError("injected binding failure")
            return original(path, payload)

        with mock.patch("llm_wiki.binding.atomic_write_json", side_effect=fail_binding_write):
            with self.assertRaises(OSError):
                update(self.workspace)
        self.assertEqual(directory_fingerprint(target), skill_before)
        self.assertEqual(binding_path.read_bytes(), binding_before)
        for path, content in docs_before.items():
            self.assertEqual((self.workspace / path).read_bytes(), content)
        self.assertFalse((self.workspace / BINDING_DIR / "runtime/update-backups").exists())

    def test_second_harness_swap_failure_rolls_back_all_harnesses(self) -> None:
        attach(self.vault, self.workspace, ["all"])
        self._make_legacy(["codex", "claude", "openclaw"])
        targets = {
            harness: self.workspace / SKILL_TARGETS[harness]
            for harness in ("codex", "claude", "openclaw")
        }
        before = {harness: directory_fingerprint(path) for harness, path in targets.items()}
        binding_before = (self.workspace / BINDING_DIR / "binding.json").read_bytes()
        original_replace = os.replace

        def fail_claude_stage(source, destination):
            if Path(destination) == targets["claude"] and "targets/claude" in str(source):
                raise OSError("injected second harness failure")
            return original_replace(source, destination)

        with mock.patch("llm_wiki.binding.os.replace", side_effect=fail_claude_stage):
            with self.assertRaises(OSError):
                update(self.workspace)
        self.assertEqual(
            {harness: directory_fingerprint(path) for harness, path in targets.items()},
            before,
        )
        self.assertEqual((self.workspace / BINDING_DIR / "binding.json").read_bytes(), binding_before)
        self.assertFalse((self.workspace / BINDING_DIR / "runtime/update-backups").exists())

    def test_unknown_harness_and_broken_vault_link_fail_before_writes(self) -> None:
        attach(self.vault, self.workspace, ["codex"])
        binding_path = self.workspace / BINDING_DIR / "binding.json"
        valid_binding = json.loads(binding_path.read_text(encoding="utf-8"))
        invalid_binding = dict(valid_binding)
        invalid_binding["harnesses"] = ["codex", "unknown"]
        self._write_json(binding_path, invalid_binding)
        before = directory_fingerprint(self.workspace)
        with self.assertRaises(ValueError):
            update(self.workspace)
        self.assertEqual(directory_fingerprint(self.workspace), before)

        self._write_json(binding_path, valid_binding)
        mount = self.workspace / "vault"
        mount.unlink()
        mount.symlink_to(self.base / "missing-vault", target_is_directory=True)
        before = directory_fingerprint(self.workspace)
        with self.assertRaises(ValueError):
            update(self.workspace)
        self.assertEqual(directory_fingerprint(self.workspace), before)

    def test_invalid_binding_and_missing_vault_fail_before_writes(self) -> None:
        self.workspace.mkdir()
        before = directory_fingerprint(self.workspace)
        with self.assertRaises(ValueError):
            update(self.workspace)
        self.assertEqual(directory_fingerprint(self.workspace), before)

        shutil.rmtree(self.workspace)
        self.workspace.mkdir()
        binding_dir = self.workspace / BINDING_DIR
        binding_dir.mkdir()
        binding_file = binding_dir / "binding.json"
        binding_file.write_text("{broken", encoding="utf-8")
        before = directory_fingerprint(self.workspace)
        with self.assertRaises(ValueError):
            update(self.workspace)
        self.assertEqual(directory_fingerprint(self.workspace), before)

        shutil.rmtree(self.workspace)
        attach(self.vault, self.workspace, ["codex"])
        shutil.rmtree(self.vault)
        before = directory_fingerprint(self.workspace)
        with self.assertRaises(ValueError):
            update(self.workspace)
        self.assertEqual(directory_fingerprint(self.workspace), before)


if __name__ == "__main__":
    unittest.main()

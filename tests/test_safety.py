from __future__ import annotations

import json
import shutil
import tempfile
import unittest
from pathlib import Path

from llm_wiki.binding import SKILL_TARGETS, attach, detach, expand_harnesses, load_binding
from llm_wiki.doctor import validate_binding, validate_vault
from llm_wiki.utils import MANAGED_BEGIN, MANAGED_END, directory_fingerprint
from llm_wiki.vault import init_vault, register_source


def error_codes(findings):
    return {item.code for item in findings if item.level == "error"}


class SafetyAndRecoveryTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.vault = self.base / "vault"
        self.workspace = self.base / "binding"
        init_vault(self.vault, "Safety Vault")

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_unmanaged_skill_symlink_is_not_overwritten(self) -> None:
        user_skill = self.base / "user-skill"
        user_skill.mkdir()
        (user_skill / "SKILL.md").write_text("user-owned", encoding="utf-8")
        target = self.workspace / ".agents/skills/llm-wiki"
        target.parent.mkdir(parents=True)
        target.symlink_to(user_skill, target_is_directory=True)

        with self.assertRaises(FileExistsError):
            attach(self.vault, self.workspace, ["codex"])

        self.assertTrue(target.is_symlink())
        self.assertEqual(target.resolve(), user_skill.resolve())
        self.assertFalse((self.workspace / "vault").exists())
        self.assertFalse((self.workspace / ".llm-wiki-binding").exists())

    def test_real_directory_replacing_managed_vault_link_is_never_deleted(self) -> None:
        attach(self.vault, self.workspace, ["codex"])
        mount = self.workspace / "vault"
        mount.unlink()
        mount.mkdir()
        sentinel = mount / "user-data.txt"
        sentinel.write_text("keep", encoding="utf-8")

        with self.assertRaises(FileExistsError):
            attach(self.vault, self.workspace, ["codex"])

        self.assertEqual(sentinel.read_text(encoding="utf-8"), "keep")
        self.assertTrue(mount.is_dir())
        self.assertFalse(mount.is_symlink())

    def test_pointer_mode_refuses_unmanaged_vault_alias(self) -> None:
        mount = self.workspace / "vault"
        mount.mkdir(parents=True)
        sentinel = mount / "user-data.txt"
        sentinel.write_text("keep", encoding="utf-8")

        with self.assertRaises(FileExistsError):
            attach(self.vault, self.workspace, ["codex"], vault_mode="pointer")

        self.assertEqual(sentinel.read_text(encoding="utf-8"), "keep")
        self.assertFalse((self.workspace / ".llm-wiki-binding").exists())

    def test_malformed_managed_block_fails_before_any_binding_mutation(self) -> None:
        self.workspace.mkdir()
        agents = self.workspace / "AGENTS.md"
        original = f"# User file\n\n{MANAGED_BEGIN}\nunterminated\n"
        agents.write_text(original, encoding="utf-8")

        with self.assertRaises(ValueError):
            attach(self.vault, self.workspace, ["all"])

        self.assertEqual(agents.read_text(encoding="utf-8"), original)
        self.assertFalse((self.workspace / "vault").exists())
        self.assertFalse((self.workspace / ".agents/skills/llm-wiki").exists())
        self.assertFalse((self.workspace / ".llm-wiki-binding").exists())

    def test_reordered_or_duplicate_managed_blocks_fail_before_binding_mutation(self) -> None:
        malformed = {
            "reordered": f"# User file\n\n{MANAGED_END}\nbody\n{MANAGED_BEGIN}\n",
            "duplicate": (
                f"{MANAGED_BEGIN}\nfirst\n{MANAGED_END}\n"
                f"{MANAGED_BEGIN}\nsecond\n{MANAGED_END}\n"
            ),
        }
        for name, original in malformed.items():
            with self.subTest(name=name):
                workspace = self.base / f"binding-{name}"
                workspace.mkdir()
                (workspace / "AGENTS.md").write_text(original, encoding="utf-8")
                before = directory_fingerprint(workspace)

                with self.assertRaises(ValueError):
                    attach(self.vault, workspace, ["all"])

                self.assertEqual(directory_fingerprint(workspace), before)
                self.assertFalse((workspace / "vault").exists())
                self.assertFalse((workspace / ".llm-wiki-binding").exists())

    def test_generated_file_symlink_escape_is_refused(self) -> None:
        self.workspace.mkdir()
        outside = self.base / "outside-agents.md"
        outside.write_text("outside", encoding="utf-8")
        (self.workspace / "AGENTS.md").symlink_to(outside)

        with self.assertRaises(ValueError):
            attach(self.vault, self.workspace, ["codex"])

        self.assertEqual(outside.read_text(encoding="utf-8"), "outside")
        self.assertFalse((self.workspace / "vault").exists())

    def test_detach_refuses_generated_file_symlink_escape_before_deleting_skills(self) -> None:
        attach(self.vault, self.workspace, ["codex"])
        agents = self.workspace / "AGENTS.md"
        agents.unlink()
        outside = self.base / "outside-detach.md"
        outside.write_text("outside", encoding="utf-8")
        agents.symlink_to(outside)

        with self.assertRaises(ValueError):
            detach(self.workspace, ["all"])

        self.assertEqual(outside.read_text(encoding="utf-8"), "outside")
        self.assertTrue((self.workspace / ".agents/skills/llm-wiki").is_dir())
        self.assertTrue((self.workspace / ".llm-wiki-binding/binding.json").is_file())

    def test_detach_removes_only_recorded_managed_skill_symlinks(self) -> None:
        attach(self.vault, self.workspace, ["all"], skill_mode="symlink")
        detach(self.workspace, ["all"])
        self.assertFalse((self.workspace / ".agents/skills/llm-wiki").exists())
        self.assertFalse((self.workspace / ".claude/skills/llm-wiki").exists())
        self.assertFalse((self.workspace / "skills/llm-wiki").exists())
        self.assertTrue(self.vault.exists())

    def test_detach_preflights_all_skill_targets_before_removing_any(self) -> None:
        attach(self.vault, self.workspace, ["all"])
        binding = load_binding(self.workspace)
        removing_order = list(
            set(expand_harnesses(["all"])) & set(binding["harnesses"])
        )
        unmanaged_harness = removing_order[-1]
        unmanaged_target = self.workspace / SKILL_TARGETS[unmanaged_harness]
        shutil.rmtree(unmanaged_target)
        unmanaged_target.mkdir()
        (unmanaged_target / "user-owned.txt").write_text("keep", encoding="utf-8")
        before = directory_fingerprint(self.workspace)

        with self.assertRaises(RuntimeError):
            detach(self.workspace, ["all"])

        self.assertEqual(directory_fingerprint(self.workspace), before)
        for harness in binding["harnesses"]:
            self.assertTrue((self.workspace / SKILL_TARGETS[harness]).exists())

    def test_binding_readme_contains_external_filesystem_permission_hints(self) -> None:
        attach(self.vault, self.workspace, ["all"])
        text = (self.workspace / "BINDING.md").read_text(encoding="utf-8")
        self.assertIn("codex --add-dir <vault-path>", text)
        self.assertIn("claude --add-dir <vault-path>", text)
        self.assertIn("OpenClaw", text)

    def test_doctor_reports_invalid_binding_json_without_crashing(self) -> None:
        metadata = self.workspace / ".llm-wiki-binding/binding.json"
        metadata.parent.mkdir(parents=True)
        metadata.write_text("{", encoding="utf-8")
        self.assertIn("binding.metadata-json", error_codes(validate_binding(self.workspace)))

    def test_doctor_reports_non_utf8_source_record_without_crashing(self) -> None:
        (self.vault / "wiki/sources/bad.md").write_bytes(b"\xff\xfe\x00")
        self.assertIn("vault.encoding", error_codes(validate_vault(self.vault)))

    def test_doctor_detects_skill_mode_mismatch(self) -> None:
        attach(self.vault, self.workspace, ["codex"])
        path = self.workspace / ".llm-wiki-binding/binding.json"
        metadata = json.loads(path.read_text(encoding="utf-8"))
        metadata["skill_mode"] = "symlink"
        path.write_text(json.dumps(metadata), encoding="utf-8")
        self.assertIn("binding.skill-mode-mismatch", error_codes(validate_binding(self.workspace)))

    def test_doctor_rejects_absolute_source_path(self) -> None:
        outside = self.base / "outside.txt"
        outside.write_text("outside", encoding="utf-8")
        record = self.vault / "wiki/sources/absolute.md"
        record.write_text(
            "---\n"
            "title: Absolute\n"
            "type: source\n"
            "source_id: src-absolute\n"
            f"source_path: {outside}\n"
            "sha256: " + "0" * 64 + "\n"
            "---\n",
            encoding="utf-8",
        )
        self.assertIn("source.path-absolute", error_codes(validate_vault(self.vault)))

    def test_doctor_rejects_required_path_symlink_escape(self) -> None:
        outside = self.base / "outside-evidence.md"
        outside.write_text("outside", encoding="utf-8")
        target = self.vault / "evidence/README.md"
        target.unlink()
        target.symlink_to(outside)
        self.assertIn("vault.required-escape", error_codes(validate_vault(self.vault)))

    def test_init_accepts_existing_empty_directory_atomically(self) -> None:
        target = self.base / "empty-target"
        target.mkdir()
        result = init_vault(target, "Empty Target")
        self.assertEqual(result.path, target)
        self.assertTrue((target / "VAULT.md").is_file())
        self.assertEqual(error_codes(validate_vault(target)), set())

    def test_init_rejects_symlink_target(self) -> None:
        real = self.base / "real-empty"
        real.mkdir()
        target = self.base / "target-link"
        target.symlink_to(real, target_is_directory=True)
        with self.assertRaises(FileExistsError):
            init_vault(target, "No Symlink")
        self.assertEqual(list(real.iterdir()), [])

    def test_register_source_refuses_library_symlink_escape(self) -> None:
        outside = self.base / "outside-library"
        outside.mkdir()
        library = self.vault / "sources/library"
        shutil.rmtree(library)
        library.symlink_to(outside, target_is_directory=True)
        source = self.base / "source.txt"
        source.write_text("data", encoding="utf-8")

        with self.assertRaises(RuntimeError):
            register_source(self.vault, source)

        self.assertEqual(list(outside.iterdir()), [])

    def test_reregister_refuses_inconsistent_missing_registered_file(self) -> None:
        source = self.base / "source.md"
        source.write_text("durable", encoding="utf-8")
        first = register_source(self.vault, source)
        Path(str(first.details["registered_file"])).unlink()
        with self.assertRaises(RuntimeError):
            register_source(self.vault, source)

    def test_windows_reserved_source_name_is_made_portable(self) -> None:
        source = self.base / "CON.txt"
        source.write_text("portable", encoding="utf-8")
        result = register_source(self.vault, source)
        registered = Path(str(result.details["registered_file"]))
        self.assertTrue(registered.name.startswith("_CON--"), registered.name)
        self.assertEqual(error_codes(validate_vault(self.vault)), set())


if __name__ == "__main__":
    unittest.main()

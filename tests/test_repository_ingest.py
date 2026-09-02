from __future__ import annotations

import importlib.util
import json
import os
import subprocess
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from llm_wiki.binding import SKILL_TARGETS, attach
from llm_wiki.doctor import validate_vault
from llm_wiki.utils import directory_fingerprint, parse_frontmatter
from llm_wiki.vault import init_vault

from .common import PROJECT_ROOT


SCRIPT = PROJECT_ROOT / "skills/llm-wiki/scripts/register_repository.py"
SPEC = importlib.util.spec_from_file_location("register_repository_skill", SCRIPT)
assert SPEC is not None and SPEC.loader is not None
repository_skill = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(repository_skill)


class RepositoryIngestTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.vault = self.base / "vault"
        self.repository = self.base / "repository"
        init_vault(self.vault, "Repository Vault")
        self.repository.mkdir()
        subprocess.run(["git", "init", "-q", "-b", "main"], cwd=self.repository, check=True)
        (self.repository / "README.rst").write_text("Fallback\n", encoding="utf-8")
        (self.repository / "README.md").write_text("# 中文 README\r\n\r\nEvidence.\r\n", encoding="utf-8")
        (self.repository / "secret.py").write_text("SECRET_SOURCE = True\n", encoding="utf-8")
        subprocess.run(["git", "add", "."], cwd=self.repository, check=True)
        subprocess.run(
            [
                "git",
                "-c",
                "user.name=Test",
                "-c",
                "user.email=test@example.com",
                "commit",
                "-qm",
                "initial",
            ],
            cwd=self.repository,
            check=True,
        )

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_url_forms_share_one_repository_identity(self) -> None:
        forms = (
            "https://github.com/Owner/Project",
            "https://github.com/Owner/Project.git/",
            "ssh://git@github.com/Owner/Project.git",
            "git@github.com:Owner/Project.git",
        )
        normalized = [repository_skill.normalize_repository_url(item) for item in forms]
        self.assertEqual({item[0] for item in normalized}, {"github.com/Owner/Project"})
        self.assertEqual({item[1] for item in normalized}, {"https://github.com/Owner/Project"})
        for unsafe in (
            "file:///tmp/repo",
            "/tmp/repo",
            "https://token@github.com/Owner/Project",
            "https://github.com/Owner/Project?token=x",
        ):
            with self.assertRaises(ValueError):
                repository_skill.normalize_repository_url(unsafe)

    def test_root_readme_priority_and_registration_contract(self) -> None:
        readme_path, readme = repository_skill.select_readme(self.repository)
        self.assertEqual(readme_path, "README.md")
        self.assertEqual(readme, "# 中文 README\n\nEvidence.\n")
        with mock.patch.object(
            repository_skill,
            "fetch_readme",
            return_value=(readme_path, readme + "\n[Repository docs](docs/guide.md)\n"),
        ):
            result = repository_skill.register_repository(
                self.vault, "git@github.com:Example/Repository.git", "示例项目"
            )
        self.assertEqual(result["details"]["status"], "registered")
        source = Path(result["details"]["registered_file"])
        source_text = source.read_text(encoding="utf-8")
        self.assertIn("示例项目", source_text)
        self.assertIn("https://github.com/Example/Repository", source_text)
        self.assertIn("# 中文 README", source_text)
        self.assertNotIn("SECRET_SOURCE", source_text)
        self.assertFalse(any(path.name == ".git" for path in self.vault.rglob("*")))
        self.assertFalse(any(path.suffix == ".py" for path in self.vault.rglob("*")))
        record = Path(result["details"]["record"])
        metadata = parse_frontmatter(record.read_text(encoding="utf-8"))
        self.assertEqual(metadata["source_kind"], "repository")
        self.assertEqual(metadata["repository_identity"], "github.com/Example/Repository")
        self.assertEqual(metadata["readme_path"], "README.md")
        self.assertIn("\n## Affected pages\n", record.read_text(encoding="utf-8"))
        self.assertIn("repository-register | 示例项目", (self.vault / "logs/operations.md").read_text())
        self.assertFalse([item for item in validate_vault(self.vault) if item.level == "error"])

    def test_repeat_registration_is_offline_and_vault_is_unchanged(self) -> None:
        with mock.patch.object(
            repository_skill, "fetch_readme", return_value=("README.md", "# First\n")
        ):
            repository_skill.register_repository(
                self.vault, "https://github.com/Example/Repository", None
            )
        before = directory_fingerprint(self.vault)
        with mock.patch.object(
            repository_skill, "fetch_readme", side_effect=AssertionError("network must not run")
        ):
            result = repository_skill.register_repository(
                self.vault, "ssh://git@github.com/Example/Repository.git", None
            )
        self.assertEqual(result["details"]["status"], "already-registered")
        self.assertEqual(directory_fingerprint(self.vault), before)

    def test_fetch_failure_and_write_failure_leave_no_partial_registration(self) -> None:
        before = directory_fingerprint(self.vault)
        with mock.patch.object(
            repository_skill, "fetch_readme", side_effect=RuntimeError("offline")
        ):
            with self.assertRaises(RuntimeError):
                repository_skill.register_repository(
                    self.vault, "https://github.com/Example/Failure", None
                )
        self.assertEqual(directory_fingerprint(self.vault), before)
        self.assertFalse((self.vault / "sources/library/2026").exists())

        original = repository_skill.atomic_write_text

        def fail_record(path, text):
            if path.parent.name == "sources" and path.name.startswith("src-"):
                raise OSError("injected record failure")
            return original(path, text)

        with mock.patch.object(
            repository_skill, "fetch_readme", return_value=("README.md", "# Content\n")
        ), mock.patch.object(repository_skill, "atomic_write_text", side_effect=fail_record):
            with self.assertRaises(OSError):
                repository_skill.register_repository(
                    self.vault, "https://github.com/Example/Failure", None
                )
        self.assertEqual(directory_fingerprint(self.vault), before)
        self.assertFalse((self.vault / "sources/library/2026").exists())

    def test_foreign_registration_lock_is_not_removed(self) -> None:
        lock = self.vault / "logs/.repository-register.lock"
        lock.write_text("owned by another process\n", encoding="utf-8")
        before = directory_fingerprint(self.vault)
        with mock.patch.object(
            repository_skill, "fetch_readme", return_value=("README.md", "# Content\n")
        ):
            with self.assertRaisesRegex(RuntimeError, "Another repository registration"):
                repository_skill.register_repository(
                    self.vault, "https://github.com/Example/Locked", None
                )
        self.assertEqual(lock.read_text(encoding="utf-8"), "owned by another process\n")
        self.assertEqual(directory_fingerprint(self.vault), before)

    def test_attached_script_runs_without_kit_pythonpath_on_python39(self) -> None:
        with mock.patch.object(
            repository_skill, "fetch_readme", return_value=("README.md", "# Attached\n")
        ):
            repository_skill.register_repository(
                self.vault, "https://github.com/Example/Attached", None
            )
        workspace = self.base / "workspace"
        attach(self.vault, workspace, ["codex"])
        attached_script = workspace / SKILL_TARGETS["codex"] / "scripts/register_repository.py"
        environment = os.environ.copy()
        environment.pop("PYTHONPATH", None)
        result = subprocess.run(
            [
                "/usr/bin/python3",
                str(attached_script),
                "git@github.com:Example/Attached.git",
                "--json",
            ],
            cwd=workspace,
            env=environment,
            text=True,
            capture_output=True,
            check=True,
        )
        payload = json.loads(result.stdout)
        self.assertEqual(payload["details"]["status"], "already-registered")


if __name__ == "__main__":
    unittest.main()

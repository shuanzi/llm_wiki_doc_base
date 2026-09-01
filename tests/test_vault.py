from __future__ import annotations

import json
import shutil
import tempfile
import unittest
from pathlib import Path

from llm_wiki.doctor import validate_vault
from llm_wiki.utils import directory_fingerprint
from llm_wiki.vault import init_vault, register_source


def errors(findings):
    return [item for item in findings if item.level == "error"]


class VaultTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.base = Path(self.temp.name)
        self.vault = self.base / "vault"
        init_vault(self.vault, "测试知识库", "zh-CN")

    def tearDown(self) -> None:
        self.temp.cleanup()

    def test_init_creates_standalone_valid_vault(self) -> None:
        self.assertTrue((self.vault / "VAULT.md").is_file())
        self.assertTrue((self.vault / "wiki" / "INDEX.md").is_file())
        self.assertTrue((self.vault / "sources" / "library").is_dir())
        self.assertFalse((self.vault / "AGENTS.md").exists())
        self.assertFalse((self.vault / ".agents").exists())
        self.assertFalse((self.vault / ".llm-wiki-binding").exists())
        self.assertEqual(errors(validate_vault(self.vault)), [])

    def test_init_rejects_nonempty_directory(self) -> None:
        target = self.base / "nonempty"
        target.mkdir()
        (target / "keep.txt").write_text("user data", encoding="utf-8")
        with self.assertRaises(FileExistsError):
            init_vault(target, "Should fail")
        self.assertEqual((target / "keep.txt").read_text(encoding="utf-8"), "user data")

    def test_obsidian_config_is_valid_and_plugin_free(self) -> None:
        app = json.loads((self.vault / ".obsidian" / "app.json").read_text(encoding="utf-8"))
        templates = json.loads(
            (self.vault / ".obsidian" / "templates.json").read_text(encoding="utf-8")
        )
        self.assertEqual(app["attachmentFolderPath"], "sources/assets")
        self.assertTrue(app["useMarkdownLinks"])
        self.assertEqual(templates["folder"], "wiki/_templates")
        self.assertFalse((self.vault / ".obsidian" / "plugins").exists())

    def test_register_source_is_hash_based_and_idempotent(self) -> None:
        source = self.base / "article.md"
        source.write_text("# Article\n\nA durable fact.\n", encoding="utf-8")
        first = register_source(self.vault, source, "Article")
        second = register_source(self.vault, source, "Different display title")
        self.assertEqual(first.details["status"], "registered")
        self.assertEqual(second.details["status"], "already-registered")
        self.assertEqual(first.path, second.path)
        registered = Path(str(first.details["registered_file"]))
        self.assertTrue(registered.is_file())
        self.assertIn(str(first.details["sha256"]), first.path.read_text(encoding="utf-8"))
        log = (self.vault / "logs" / "operations.md").read_text(encoding="utf-8")
        self.assertEqual(log.count("source-register | Article"), 1)
        self.assertEqual(errors(validate_vault(self.vault)), [])

    def test_register_source_sanitizes_multiline_title(self) -> None:
        source = self.base / "note.txt"
        source.write_text("content", encoding="utf-8")
        result = register_source(self.vault, source, "Line 1\nLine 2")
        text = result.path.read_text(encoding="utf-8")
        self.assertIn("# Line 1 Line 2", text)
        self.assertNotIn("# Line 1\nLine 2", text)

    def test_registered_source_tamper_is_detected(self) -> None:
        source = self.base / "paper.txt"
        source.write_text("original", encoding="utf-8")
        result = register_source(self.vault, source)
        registered = Path(str(result.details["registered_file"]))
        registered.write_text("tampered", encoding="utf-8")
        codes = {item.code for item in validate_vault(self.vault) if item.level == "error"}
        self.assertIn("source.hash-mismatch", codes)

    def test_vault_copy_is_independently_portable(self) -> None:
        source = self.base / "source.md"
        source.write_text("portable", encoding="utf-8")
        register_source(self.vault, source)
        copied = self.base / "copied-vault"
        shutil.copytree(self.vault, copied)
        self.assertEqual(errors(validate_vault(copied)), [])
        self.assertEqual(directory_fingerprint(self.vault), directory_fingerprint(copied))

    def test_harness_leak_is_rejected(self) -> None:
        (self.vault / "AGENTS.md").write_text("should be external", encoding="utf-8")
        codes = {item.code for item in validate_vault(self.vault) if item.level == "error"}
        self.assertIn("vault.harness-leak", codes)

    def test_register_source_uses_portable_filename(self) -> None:
        source = self.base / "note #1 [draft] (final).md"
        source.write_text("portable name", encoding="utf-8")
        result = register_source(self.vault, source)
        registered = Path(str(result.details["registered_file"]))
        self.assertNotIn("#", registered.name)
        self.assertNotIn("[", registered.name)
        self.assertNotIn("(", registered.name)
        self.assertEqual(errors(validate_vault(self.vault)), [])

    def test_broken_and_escaping_markdown_links_are_detected(self) -> None:
        page = self.vault / "wiki/concepts/Bad Links.md"
        page.write_text(
            "# Bad Links\n\n[missing](missing.md)\n\n[escape](../../../outside.md)\n",
            encoding="utf-8",
        )
        codes = {item.code for item in validate_vault(self.vault) if item.level == "error"}
        self.assertIn("vault.link-broken", codes)
        self.assertIn("vault.link-escape", codes)

    def test_shipped_demo_vault_is_valid_and_synthesized(self) -> None:
        demo = Path(__file__).resolve().parents[1] / "examples" / "demo-vault"
        self.assertEqual(errors(validate_vault(demo)), [])
        index = (demo / "wiki/INDEX.md").read_text(encoding="utf-8")
        self.assertIn("Persistent Wiki", index)
        self.assertIn("RAG and Persistent Wiki", index)
        self.assertIn("Knowledge Maintenance Quality", index)


if __name__ == "__main__":
    unittest.main()

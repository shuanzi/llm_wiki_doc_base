from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path

from .common import run_cli


class CliTests(unittest.TestCase):
    def test_help_and_version(self) -> None:
        help_result = run_cli("--help")
        self.assertIn("Agent-first", help_result.stdout)
        version_result = run_cli("--version")
        self.assertIn("0.1.0", version_result.stdout)

    def test_json_end_to_end(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            vault = base / "vault"
            binding = base / "binding"
            source = base / "source.md"
            source.write_text("# Source\n", encoding="utf-8")

            init_result = run_cli("init", str(vault), "--name", "CLI Vault", "--json")
            init_json = json.loads(init_result.stdout)
            self.assertEqual(init_json["action"], "init")

            source_result = run_cli(
                "register-source", "--vault", str(vault), str(source), "--json"
            )
            source_json = json.loads(source_result.stdout)
            self.assertEqual(source_json["details"]["status"], "registered")

            attach_result = run_cli(
                "attach",
                "--vault",
                str(vault),
                "--workspace",
                str(binding),
                "--harness",
                "all",
                "--json",
            )
            self.assertEqual(json.loads(attach_result.stdout)["action"], "attach")

            update_result = run_cli(
                "update", "--workspace", str(binding), "--json"
            )
            update_json = json.loads(update_result.stdout)
            self.assertEqual(update_json["action"], "update")
            self.assertEqual(update_json["details"]["status"], "already-current")

            doctor_result = run_cli("doctor", str(binding), "--strict", "--json")
            doctor_json = json.loads(doctor_result.stdout)
            self.assertEqual(doctor_json["errors"], 0)
            self.assertEqual(doctor_json["warnings"], 0)

            status_result = run_cli("status", "--workspace", str(binding), "--json")
            self.assertEqual(
                json.loads(status_result.stdout)["harnesses"],
                ["codex", "claude", "openclaw"],
            )

            run_cli("detach", "--workspace", str(binding), "--harness", "all")
            self.assertTrue(vault.exists())
            self.assertFalse((binding / ".llm-wiki-binding").exists())

    def test_cli_failure_does_not_overwrite_nonempty_init_target(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            target = Path(temp) / "target"
            target.mkdir()
            (target / "data.txt").write_text("keep", encoding="utf-8")
            result = run_cli("init", str(target), "--name", "Fail", check=False)
            self.assertEqual(result.returncode, 2)
            self.assertIn("not empty", result.stderr)
            self.assertEqual((target / "data.txt").read_text(encoding="utf-8"), "keep")


if __name__ == "__main__":
    unittest.main()

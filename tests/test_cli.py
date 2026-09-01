from __future__ import annotations

import contextlib
import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest import mock

from llm_wiki.cli import main
from llm_wiki.models import OperationResult
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

    def test_watch_json_empty_folder_does_not_require_agent_execution(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            vault = base / "vault"
            binding = base / "binding"
            drop = base / "drop"
            drop.mkdir()
            run_cli("init", str(vault), "--name", "Watch CLI Vault")
            run_cli(
                "attach",
                "--vault",
                str(vault),
                "--workspace",
                str(binding),
                "--harness",
                "codex",
            )

            watch_result = run_cli(
                "watch",
                str(drop),
                "--workspace",
                str(binding),
                "--harness",
                "codex",
                "--settle-seconds",
                "0",
                "--json",
            )

            watch_json = json.loads(watch_result.stdout)
            self.assertEqual(watch_json["action"], "watch")
            self.assertEqual(watch_json["details"]["status"], "completed")

    def test_watch_returns_one_when_scan_reports_registration_errors(self) -> None:
        result = OperationResult(
            action="watch",
            path=Path("/absolute/drop"),
            details={
                "status": "completed",
                "registered": 0,
                "ingested": 0,
                "deferred": 0,
                "errors": 1,
                "jobs": {},
                "events": [],
            },
        )
        stdout = io.StringIO()

        with mock.patch("llm_wiki.cli.run_watch", return_value=result), contextlib.redirect_stdout(
            stdout
        ):
            returncode = main(
                [
                    "watch",
                    "/absolute/drop",
                    "--workspace",
                    "/absolute/binding",
                    "--harness",
                    "codex",
                    "--json",
                ]
            )

        self.assertEqual(returncode, 1)
        self.assertEqual(json.loads(stdout.getvalue())["details"]["errors"], 1)

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

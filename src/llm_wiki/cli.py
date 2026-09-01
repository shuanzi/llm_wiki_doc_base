from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

from . import __version__
from .binding import attach, detach, load_binding, update
from .doctor import run_doctor
from .models import Finding, OperationResult
from .vault import init_vault, register_source
from .watch import run_watch


def _print_result(result: OperationResult, as_json: bool) -> None:
    if as_json:
        print(json.dumps(result.to_dict(), ensure_ascii=False, indent=2))
        return
    print(f"OK {result.action}: {result.path}")
    for key, value in result.details.items():
        print(f"  {key}: {value}")


def _print_findings(findings: list[Finding], as_json: bool) -> None:
    if as_json:
        payload = {
            "errors": sum(item.level == "error" for item in findings),
            "warnings": sum(item.level == "warning" for item in findings),
            "findings": [item.to_dict() for item in findings],
        }
        print(json.dumps(payload, ensure_ascii=False, indent=2))
        return
    for item in findings:
        location = f" [{item.path}]" if item.path else ""
        print(f"{item.level.upper():7} {item.code}: {item.message}{location}")
    print(
        f"Summary: {sum(i.level == 'error' for i in findings)} error(s), "
        f"{sum(i.level == 'warning' for i in findings)} warning(s)"
    )


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="llm-wiki",
        description="Agent-first local Markdown wiki kit and detachable harness binder",
    )
    parser.add_argument("--version", action="version", version=f"%(prog)s {__version__}")
    sub = parser.add_subparsers(dest="command", required=True)

    init_cmd = sub.add_parser("init", help="Create a standalone durable Markdown vault")
    init_cmd.add_argument("path", type=Path)
    init_cmd.add_argument("--name", required=True)
    init_cmd.add_argument("--language", default="zh-CN")
    init_cmd.add_argument("--json", action="store_true")

    source_cmd = sub.add_parser(
        "register-source",
        help="Copy and hash-register a source without performing semantic ingest",
    )
    source_cmd.add_argument("--vault", required=True, type=Path)
    source_cmd.add_argument("source", type=Path)
    source_cmd.add_argument("--title")
    source_cmd.add_argument("--json", action="store_true")

    watch_cmd = sub.add_parser(
        "watch",
        help="Run one full folder scan and ask Codex to ingest registered sources",
    )
    watch_cmd.add_argument("source_dir", type=Path)
    watch_cmd.add_argument("--workspace", required=True, type=Path)
    watch_cmd.add_argument("--harness", required=True, choices=["codex"])
    watch_cmd.add_argument("--recursive", action="store_true")
    watch_cmd.add_argument("--settle-seconds", type=float, default=60)
    watch_cmd.add_argument("--json", action="store_true")

    attach_cmd = sub.add_parser("attach", help="Create/update a detachable Agent binding workspace")
    attach_cmd.add_argument("--vault", required=True, type=Path)
    attach_cmd.add_argument("--workspace", required=True, type=Path)
    attach_cmd.add_argument(
        "--harness",
        action="append",
        required=True,
        choices=["codex", "claude", "openclaw", "all"],
    )
    attach_cmd.add_argument("--skill-mode", choices=["copy", "symlink"], default="copy")
    attach_cmd.add_argument("--vault-mode", choices=["symlink", "pointer"], default="symlink")
    attach_cmd.add_argument("--force", action="store_true")
    attach_cmd.add_argument("--json", action="store_true")

    detach_cmd = sub.add_parser("detach", help="Remove generated harness bindings without touching the vault")
    detach_cmd.add_argument("--workspace", required=True, type=Path)
    detach_cmd.add_argument(
        "--harness",
        action="append",
        required=True,
        choices=["codex", "claude", "openclaw", "all"],
    )
    detach_cmd.add_argument("--json", action="store_true")

    update_cmd = sub.add_parser(
        "update", help="Refresh an existing Binding Workspace from the current Kit"
    )
    update_cmd.add_argument("--workspace", required=True, type=Path)
    update_cmd.add_argument("--json", action="store_true")

    doctor_cmd = sub.add_parser("doctor", help="Check kit, vault, or binding invariants")
    doctor_cmd.add_argument("path", type=Path)
    doctor_cmd.add_argument("--kind", choices=["auto", "kit", "vault", "binding"], default="auto")
    doctor_cmd.add_argument("--strict", action="store_true", help="Treat warnings as a non-zero result")
    doctor_cmd.add_argument("--json", action="store_true")

    status_cmd = sub.add_parser("status", help="Show binding metadata")
    status_cmd.add_argument("--workspace", required=True, type=Path)
    status_cmd.add_argument("--json", action="store_true")
    return parser


def main(argv: list[str] | None = None) -> int:
    parser = build_parser()
    args = parser.parse_args(argv)
    try:
        if args.command == "init":
            _print_result(init_vault(args.path, args.name, args.language), args.json)
            return 0
        if args.command == "register-source":
            _print_result(register_source(args.vault, args.source, args.title), args.json)
            return 0
        if args.command == "watch":
            result = run_watch(
                args.workspace,
                args.source_dir,
                harness=args.harness,
                recursive=args.recursive,
                settle_seconds=args.settle_seconds,
            )
            _print_result(result, args.json)
            jobs = result.details.get("jobs", {})
            if result.details.get("errors", 0):
                return 1
            if isinstance(jobs, dict) and any(
                jobs.get(status, 0) for status in ("retry", "needs-review", "permanent-error")
            ):
                return 1
            return 0
        if args.command == "attach":
            _print_result(
                attach(
                    args.vault,
                    args.workspace,
                    args.harness,
                    skill_mode=args.skill_mode,
                    vault_mode=args.vault_mode,
                    force=args.force,
                ),
                args.json,
            )
            return 0
        if args.command == "detach":
            _print_result(detach(args.workspace, args.harness), args.json)
            return 0
        if args.command == "update":
            _print_result(update(args.workspace), args.json)
            return 0
        if args.command == "doctor":
            findings = run_doctor(args.path, args.kind)
            _print_findings(findings, args.json)
            errors = any(item.level == "error" for item in findings)
            warnings = any(item.level == "warning" for item in findings)
            return 1 if errors or (args.strict and warnings) else 0
        if args.command == "status":
            binding = load_binding(args.workspace.expanduser().resolve())
            if not binding:
                raise ValueError(f"No llm-wiki binding found: {args.workspace}")
            if args.json:
                print(json.dumps(binding, ensure_ascii=False, indent=2))
            else:
                for key, value in binding.items():
                    print(f"{key}: {value}")
            return 0
        parser.error(f"Unhandled command: {args.command}")
    except (FileExistsError, FileNotFoundError, ValueError, RuntimeError, OSError) as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        return 2
    return 0

from __future__ import annotations

import json
import os
import shutil
from importlib import resources
from pathlib import Path
from typing import Any

from . import __version__
from .models import OperationResult
from .utils import (
    MANAGED_BEGIN,
    MANAGED_END,
    atomic_write_json,
    copy_traversable,
    ensure_separate_roots,
    is_relative_to,
    remove_tree_or_link,
    update_managed_block,
    utc_timestamp,
)

BINDING_SCHEMA_VERSION = 1
BINDING_DIR = ".llm-wiki-binding"
BINDING_FILE = "binding.json"
MARKER_FILE = ".llm-wiki-managed.json"
ALL_HARNESSES = ("codex", "claude", "openclaw")
SKILL_TARGETS = {
    "codex": Path(".agents/skills/llm-wiki"),
    "claude": Path(".claude/skills/llm-wiki"),
    "openclaw": Path("skills/llm-wiki"),
}
INSTRUCTION_FILES = {
    "codex": Path("AGENTS.md"),
    "claude": Path("CLAUDE.md"),
    "openclaw": Path("AGENTS.md"),
}


def canonical_skill_root():
    return resources.files("llm_wiki.resources").joinpath("skill", "llm-wiki")


def expand_harnesses(values: list[str]) -> list[str]:
    expanded: set[str] = set()
    for value in values:
        if value == "all":
            expanded.update(ALL_HARNESSES)
        elif value in ALL_HARNESSES:
            expanded.add(value)
        else:
            raise ValueError(f"Unsupported harness: {value}")
    if not expanded:
        raise ValueError("At least one harness is required")
    return [name for name in ALL_HARNESSES if name in expanded]


def binding_path(workspace: Path) -> Path:
    return workspace / BINDING_DIR / BINDING_FILE


def load_binding(workspace: Path) -> dict[str, object] | None:
    path = binding_path(workspace)
    if not path.is_file():
        return None
    try:
        payload: Any = json.loads(path.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError, OSError) as exc:
        raise ValueError(f"Invalid llm-wiki binding metadata at {path}: {exc}") from exc
    if not isinstance(payload, dict):
        raise ValueError(f"Invalid llm-wiki binding metadata at {path}: root must be an object")
    return payload


def _copy_skill_is_managed(target: Path) -> bool:
    if target.is_symlink() or not target.is_dir():
        return False
    marker = target / MARKER_FILE
    if not marker.is_file():
        return False
    try:
        payload = json.loads(marker.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, UnicodeDecodeError, OSError):
        return False
    return isinstance(payload, dict) and payload.get("managed_by") == "llm-wiki"


def _symlink_skill_is_managed(
    target: Path,
    previous: dict[str, object] | None,
    harness: str,
) -> bool:
    if not target.is_symlink() or not previous:
        return False
    active = previous.get("harnesses")
    return (
        isinstance(active, list)
        and harness in active
        and previous.get("skill_mode") == "symlink"
    )


def _skill_is_managed(
    target: Path,
    previous: dict[str, object] | None,
    harness: str,
) -> bool:
    return _copy_skill_is_managed(target) or _symlink_skill_is_managed(
        target, previous, harness
    )


def _install_skill(target: Path, mode: str, force: bool, managed: bool) -> None:
    if target.exists() or target.is_symlink():
        if managed or force:
            remove_tree_or_link(target)
        else:
            raise FileExistsError(
                f"Skill target already exists and is not managed by llm-wiki: {target}"
            )
    target.parent.mkdir(parents=True, exist_ok=True)
    source = canonical_skill_root()
    if mode == "copy":
        copy_traversable(source, target)
        atomic_write_json(
            target / MARKER_FILE,
            {"managed_by": "llm-wiki", "kit_version": __version__},
        )
        return
    if mode == "symlink":
        try:
            source_path = Path(os.fspath(source)).resolve()
        except TypeError as exc:
            raise RuntimeError("Packaged skill is not available as a filesystem path") from exc
        target.symlink_to(source_path, target_is_directory=True)
        return
    raise ValueError(f"Unsupported skill mode: {mode}")


def _instruction_body(active: list[str], vault_reference: str) -> str:
    harness_list = ", ".join(active)
    return f"""## LLM Wiki binding

This is a detachable Agent harness workspace, not the knowledge store.

- Active harnesses: `{harness_list}`
- Vault entry point: `{vault_reference}/VAULT.md`
- Use the `llm-wiki` skill when orienting in the vault, registering or ingesting sources, answering from the wiki, promoting durable analysis, or running a knowledge-health review.
- Read the vault entry point and profile before editing knowledge.
- Keep runtime state, session state, caches, plans, and harness configuration outside `{vault_reference}`.
- Do not silently overwrite registered source files. Treat the Markdown vault as the durable source of truth and the installed skill as replaceable guidance.
"""


def _write_workspace_docs(workspace: Path, binding: dict[str, object]) -> None:
    active = list(binding["harnesses"])  # type: ignore[arg-type]
    vault_reference = str(binding["vault_reference"])
    body = _instruction_body(active, vault_reference)
    if "codex" in active or "openclaw" in active:
        update_managed_block(workspace / "AGENTS.md", body)
    else:
        update_managed_block(workspace / "AGENTS.md", None)
    if "claude" in active:
        update_managed_block(workspace / "CLAUDE.md", body)
    else:
        update_managed_block(workspace / "CLAUDE.md", None)

    readme = f"""# LLM Wiki Binding Workspace

This directory contains replaceable harness integration only. The durable wiki is located at:

`{binding['vault_path']}`

Active harnesses: {', '.join(active)}

## Use

Start the selected local Agent from this directory. Ask it to use the `llm-wiki` skill, or use natural language such as:

- “先了解这个知识库并说明最近状态。”
- “将 vault/sources/inbox 中的新资料摄取进 Wiki。”
- “基于 Wiki 回答问题，并标明证据和推断。”
- “检查知识库的冲突、陈旧结论、孤立页面和缺口。”

## Filesystem authorization

Skill discovery and Vault filesystem authorization are separate. If the Agent sandbox cannot follow the external `vault` link or absolute pointer, explicitly grant the real Vault path:

- Codex: start with `codex --add-dir <vault-path>` when the Vault is outside the writable workspace.
- Claude Code: start with `claude --add-dir <vault-path>` when the Vault is outside the allowed roots.
- OpenClaw: allow or mount the Vault path through its active workspace/sandbox configuration.

Do not copy Harness permission state into the Vault. Keep it in this Binding Workspace or the Agent's own configuration.

`{BINDING_DIR}/runtime/` is disposable runtime space. Removing this entire binding workspace must not remove or invalidate the vault.
"""
    update_managed_block(workspace / "BINDING.md", readme)

    gitignore_body = f"""# Disposable llm-wiki runtime sidecar
/{BINDING_DIR}/runtime/*
!/{BINDING_DIR}/runtime/.gitkeep
"""
    update_managed_block(workspace / ".gitignore", gitignore_body)


def _preflight_workspace_layout(workspace: Path) -> None:
    workspace_root = workspace.resolve()
    generated_files = (
        workspace / "AGENTS.md",
        workspace / "CLAUDE.md",
        workspace / "BINDING.md",
        workspace / ".gitignore",
    )
    for path in generated_files:
        resolved_parent = path.parent.resolve()
        if not is_relative_to(resolved_parent, workspace_root):
            raise ValueError(f"Generated file parent escapes the Binding Workspace: {path}")
        if path.is_symlink() and not is_relative_to(path.resolve(), workspace_root):
            raise ValueError(f"Generated file symlink escapes the Binding Workspace: {path}")
        if path.exists():
            try:
                text = path.read_text(encoding="utf-8")
            except (UnicodeDecodeError, OSError) as exc:
                raise ValueError(f"Generated file is unreadable as UTF-8: {path}: {exc}") from exc
            if text.count(MANAGED_BEGIN) != text.count(MANAGED_END):
                raise ValueError(f"Malformed llm-wiki managed block in {path}")

    for target in (workspace / path for path in SKILL_TARGETS.values()):
        probe = target.parent
        while not probe.exists() and probe != workspace:
            probe = probe.parent
        if not probe.is_dir():
            raise ValueError(f"Skill target parent is blocked by a non-directory path: {probe}")
        if not is_relative_to(target.parent.resolve(), workspace_root):
            raise ValueError(f"Skill target parent escapes the Binding Workspace: {target}")

    binding_dir = workspace / BINDING_DIR
    if binding_dir.exists() and not binding_dir.is_dir():
        raise ValueError(f"Binding metadata path is not a directory: {binding_dir}")
    if binding_dir.exists() and not is_relative_to(binding_dir.resolve(), workspace_root):
        raise ValueError(f"Binding metadata directory escapes the Binding Workspace: {binding_dir}")


def _previous_managed_vault_link(previous: dict[str, object] | None) -> bool:
    return bool(
        previous
        and previous.get("vault_mode") == "symlink"
        and previous.get("vault_reference") == "vault"
    )


def _prepare_vault_reference(
    workspace: Path,
    vault: Path,
    vault_mode: str,
    previous: dict[str, object] | None,
) -> str:
    mount = workspace / "vault"
    managed_previous_link = _previous_managed_vault_link(previous)

    if vault_mode == "symlink":
        if mount.is_symlink():
            if not managed_previous_link:
                raise FileExistsError(
                    f"Workspace vault link exists but is not managed by llm-wiki: {mount}"
                )
            mount.unlink()
        elif mount.exists():
            # Never recursively delete a real user directory merely because stale binding
            # metadata claims that it used to be a managed symlink.
            raise FileExistsError(
                f"Workspace path exists and is not a managed vault symlink: {mount}"
            )
        mount.symlink_to(vault, target_is_directory=True)
        return "vault"

    if vault_mode == "pointer":
        if mount.is_symlink():
            if not managed_previous_link:
                raise FileExistsError(
                    f"Workspace vault link exists but is not managed by llm-wiki: {mount}"
                )
            mount.unlink()
        elif mount.exists():
            raise FileExistsError(
                f"Workspace path would conflict with pointer-mode vault discovery: {mount}"
            )
        return str(vault)

    raise ValueError(f"Unsupported vault mode: {vault_mode}")


def attach(
    vault: Path,
    workspace: Path,
    harnesses: list[str],
    skill_mode: str = "copy",
    vault_mode: str = "symlink",
    force: bool = False,
) -> OperationResult:
    vault = vault.expanduser().resolve()
    workspace = workspace.expanduser().absolute()
    if not (vault / "profile" / "vault.json").is_file():
        raise ValueError(f"Not an llm-wiki vault: {vault}")
    ensure_separate_roots(vault, workspace)
    workspace.mkdir(parents=True, exist_ok=True)
    _preflight_workspace_layout(workspace)

    requested = expand_harnesses(harnesses)
    previous = load_binding(workspace)
    previous_active = previous.get("harnesses", []) if previous else []
    if previous_active and not isinstance(previous_active, list):
        raise ValueError("Existing binding has invalid harness metadata; run doctor or repair it")
    if isinstance(previous_active, list) and any(
        not isinstance(item, str) or item not in ALL_HARNESSES for item in previous_active
    ):
        raise ValueError("Existing binding contains unknown harness metadata; run doctor or repair it")
    active = set(previous_active)
    active.update(requested)
    ordered_active = [name for name in ALL_HARNESSES if name in active]

    managed_by_harness: dict[str, bool] = {}
    # Refuse unmanaged collisions before mutating links or generated files.
    for harness in ordered_active:
        target = workspace / SKILL_TARGETS[harness]
        managed = _skill_is_managed(target, previous, harness)
        managed_by_harness[harness] = managed
        if (target.exists() or target.is_symlink()) and not (managed or force):
            raise FileExistsError(
                f"Skill target already exists and is not managed by llm-wiki: {target}"
            )

    vault_reference = _prepare_vault_reference(workspace, vault, vault_mode, previous)
    # Keep all active harness copies on one canonical mode/version after each attach.
    for harness in ordered_active:
        _install_skill(
            workspace / SKILL_TARGETS[harness],
            skill_mode,
            force,
            managed_by_harness[harness],
        )

    timestamp = utc_timestamp()
    binding = {
        "schema_version": BINDING_SCHEMA_VERSION,
        "kit_version": __version__,
        "created_at": previous.get("created_at", timestamp) if previous else timestamp,
        "updated_at": timestamp,
        "vault_path": str(vault),
        "vault_mode": vault_mode,
        "vault_reference": vault_reference,
        "skill_mode": skill_mode,
        "harnesses": ordered_active,
    }
    binding_dir = workspace / BINDING_DIR
    (binding_dir / "runtime").mkdir(parents=True, exist_ok=True)
    (binding_dir / "runtime" / ".gitkeep").touch(exist_ok=True)
    atomic_write_json(binding_dir / BINDING_FILE, binding)
    _write_workspace_docs(workspace, binding)

    return OperationResult(
        action="attach",
        path=workspace,
        details={
            "vault": str(vault),
            "harnesses": ordered_active,
            "vault_reference": vault_reference,
            "skill_mode": skill_mode,
            "filesystem_access": "Grant the real Vault path in the Agent sandbox when it is outside the workspace",
        },
    )


def detach(workspace: Path, harnesses: list[str]) -> OperationResult:
    workspace = workspace.expanduser().resolve()
    binding = load_binding(workspace)
    if not binding:
        raise ValueError(f"No llm-wiki binding found: {workspace}")
    _preflight_workspace_layout(workspace)
    requested = set(expand_harnesses(harnesses))
    active_raw = binding.get("harnesses", [])
    if not isinstance(active_raw, list):
        raise ValueError("Binding has invalid harness metadata; run doctor or repair it")
    active = set(active_raw)
    removing = requested & active

    for harness in removing:
        target = workspace / SKILL_TARGETS[harness]
        if target.exists() or target.is_symlink():
            if not _skill_is_managed(target, binding, harness):
                raise RuntimeError(f"Refusing to remove unmanaged skill target: {target}")
            remove_tree_or_link(target)

    remaining = [name for name in ALL_HARNESSES if name in active - removing]
    binding["harnesses"] = remaining
    binding["updated_at"] = utc_timestamp()

    if remaining:
        atomic_write_json(binding_path(workspace), binding)
        _write_workspace_docs(workspace, binding)
    else:
        update_managed_block(workspace / "AGENTS.md", None)
        update_managed_block(workspace / "CLAUDE.md", None)
        update_managed_block(workspace / ".gitignore", None)
        mount = workspace / "vault"
        if mount.is_symlink() and _previous_managed_vault_link(binding):
            mount.unlink()
        binding_dir = workspace / BINDING_DIR
        if binding_dir.exists():
            shutil.rmtree(binding_dir)
        update_managed_block(workspace / "BINDING.md", None)

    return OperationResult(
        action="detach",
        path=workspace,
        details={"removed": sorted(removing), "remaining": remaining},
    )

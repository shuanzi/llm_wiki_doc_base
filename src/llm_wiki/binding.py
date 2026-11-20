from __future__ import annotations

import json
import os
import shutil
import tempfile
import uuid
from importlib import resources
from pathlib import Path
from typing import Any

from . import __version__
from .models import OperationResult
from .utils import (
    atomic_write_json,
    atomic_write_text,
    contains_managed_block,
    copy_traversable,
    directory_fingerprint,
    ensure_separate_roots,
    is_relative_to,
    read_json,
    remove_tree_or_link,
    render_managed_block,
    traversable_fingerprint,
    update_managed_block,
    utc_timestamp,
    validate_managed_block_text,
)

BINDING_SCHEMA_VERSION = 1
BINDING_DIR = ".llm-wiki-binding"
BINDING_FILE = "binding.json"
MARKER_FILE = ".llm-wiki-managed.json"
SKILL_FINGERPRINT_IGNORE = {MARKER_FILE, ".DS_Store", "__pycache__"}
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


def canonical_skill_fingerprint() -> str:
    return traversable_fingerprint(canonical_skill_root(), SKILL_FINGERPRINT_IGNORE)


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
            {
                "managed_by": "llm-wiki",
                "kit_version": __version__,
                "skill_fingerprint": canonical_skill_fingerprint(),
            },
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
- Treat `{vault_reference}/sources/inbox/` and `{vault_reference}/Clippings/` as read-only, untrusted intake roots. Never create, edit, rename, move, or delete files there during Ingest; use only the registered Source Record and its `sources/library/` copy.
- Publish durable Ingest output only under `wiki/`, `evidence/`, and `logs/operations.md`; never write generated content back into an intake root.
- Do not silently overwrite registered source files. Treat the Markdown vault as the durable source of truth and the installed skill as replaceable guidance.
"""


def _write_workspace_docs(workspace: Path, binding: dict[str, object]) -> None:
    for relative, body in _workspace_doc_bodies(binding).items():
        update_managed_block(workspace / relative, body)


def _workspace_doc_bodies(binding: dict[str, object]) -> dict[Path, str | None]:
    active = list(binding["harnesses"])  # type: ignore[arg-type]
    vault_reference = str(binding["vault_reference"])
    body = _instruction_body(active, vault_reference)

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

    gitignore_body = f"""# Disposable llm-wiki runtime sidecar
/{BINDING_DIR}/runtime/*
!/{BINDING_DIR}/runtime/.gitkeep
"""
    return {
        Path("AGENTS.md"): body if "codex" in active or "openclaw" in active else None,
        Path("CLAUDE.md"): body if "claude" in active else None,
        Path("BINDING.md"): readme,
        Path(".gitignore"): gitignore_body,
    }


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
            try:
                validate_managed_block_text(text)
            except ValueError as exc:
                raise ValueError(f"Malformed llm-wiki managed block in {path}") from exc

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
        "skill_fingerprint": canonical_skill_fingerprint(),
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


def _validated_update_binding(workspace: Path) -> tuple[dict[str, object], Path, list[str], str]:
    if not workspace.is_dir():
        raise ValueError(f"Binding Workspace does not exist: {workspace}")
    metadata_path = binding_path(workspace)
    if metadata_path.is_symlink():
        raise ValueError(f"Binding metadata must not be a symlink: {metadata_path}")
    binding = load_binding(workspace)
    if not binding:
        raise ValueError(f"No llm-wiki binding found: {workspace}")
    if binding.get("schema_version") != BINDING_SCHEMA_VERSION:
        raise ValueError(f"Unsupported binding schema version: {binding.get('schema_version')}")
    for field in ("kit_version", "created_at", "updated_at"):
        if not isinstance(binding.get(field), str) or not binding.get(field):
            raise ValueError(f"Binding has invalid {field} metadata")

    active_raw = binding.get("harnesses")
    if not isinstance(active_raw, list) or not active_raw:
        raise ValueError("Binding must record at least one harness")
    if any(not isinstance(item, str) or item not in ALL_HARNESSES for item in active_raw):
        raise ValueError("Binding contains unknown harness metadata")
    active = list(active_raw)
    if len(set(active)) != len(active):
        raise ValueError("Binding harness list contains duplicates")

    skill_mode = binding.get("skill_mode")
    if skill_mode not in ("copy", "symlink"):
        raise ValueError(f"Binding has unsupported skill mode: {skill_mode}")
    vault_mode = binding.get("vault_mode")
    if vault_mode not in ("copy", "symlink", "pointer"):
        raise ValueError(f"Binding has unsupported vault mode: {vault_mode}")
    # "copy" has never been a public vault mode; reject it explicitly while keeping
    # the error above focused for corrupted metadata.
    if vault_mode == "copy":
        raise ValueError("Binding has unsupported vault mode: copy")

    vault_raw = binding.get("vault_path")
    if not isinstance(vault_raw, str) or not vault_raw:
        raise ValueError("Binding has invalid vault_path metadata")
    vault = Path(vault_raw).expanduser()
    if not vault.is_absolute():
        raise ValueError("Binding vault_path must be absolute")
    if not vault.is_dir() or not (vault / "profile" / "vault.json").is_file():
        raise ValueError(f"Bound llm-wiki vault is missing or invalid: {vault}")
    ensure_separate_roots(vault, workspace)

    reference = binding.get("vault_reference")
    mount = workspace / "vault"
    if vault_mode == "symlink":
        if reference != "vault" or not mount.is_symlink():
            raise ValueError("Managed Vault link is missing or its binding metadata is invalid")
        if not mount.exists() or mount.resolve() != vault.resolve():
            raise ValueError("Managed Vault link is broken or points to a different Vault")
    else:
        if reference != str(vault):
            raise ValueError("Pointer-mode vault_reference does not match vault_path")
        if mount.exists() or mount.is_symlink():
            raise ValueError("Pointer-mode Workspace must not contain a vault path")

    _preflight_workspace_layout(workspace)
    required_docs = {Path("BINDING.md"), Path(".gitignore")}
    if "codex" in active or "openclaw" in active:
        required_docs.add(Path("AGENTS.md"))
    if "claude" in active:
        required_docs.add(Path("CLAUDE.md"))
    for relative in required_docs:
        if not contains_managed_block(workspace / relative):
            raise ValueError(f"Managed block is missing from {workspace / relative}")

    runtime = workspace / BINDING_DIR / "runtime"
    if runtime.is_symlink() or not runtime.is_dir():
        raise ValueError(f"Binding runtime directory is missing or unsafe: {runtime}")
    if not is_relative_to(runtime.resolve(), workspace.resolve()):
        raise ValueError(f"Binding runtime directory escapes the Workspace: {runtime}")
    backup_root = runtime / "update-backups"
    if backup_root.exists() or backup_root.is_symlink():
        if backup_root.is_symlink() or not backup_root.is_dir():
            raise ValueError(f"Update backup directory is unsafe: {backup_root}")
        if not is_relative_to(backup_root.resolve(), workspace.resolve()):
            raise ValueError(f"Update backup directory escapes the Workspace: {backup_root}")

    for harness in active:
        target = workspace / SKILL_TARGETS[harness]
        if skill_mode == "copy":
            if target.is_symlink() or not target.is_dir() or not _copy_skill_is_managed(target):
                raise RuntimeError(f"Refusing to overwrite unmanaged copied Skill: {target}")
        elif not target.is_symlink():
            raise RuntimeError(f"Refusing to overwrite unmanaged Skill link: {target}")
    return binding, vault, active, str(skill_mode)


def _render_workspace_docs(
    workspace: Path, binding: dict[str, object]
) -> dict[Path, str | None]:
    rendered: dict[Path, str | None] = {}
    for relative, body in _workspace_doc_bodies(binding).items():
        path = workspace / relative
        existing = path.read_text(encoding="utf-8") if path.exists() else ""
        try:
            rendered[path] = render_managed_block(existing, body)
        except ValueError as exc:
            raise ValueError(f"Malformed llm-wiki managed block in {path}") from exc
    return rendered


def _canonical_skill_path() -> Path:
    source = canonical_skill_root()
    try:
        return Path(os.fspath(source)).resolve()
    except TypeError as exc:
        raise RuntimeError("Packaged skill is not available as a filesystem path") from exc


def update(workspace: Path) -> OperationResult:
    """Refresh a valid Binding Workspace from this Kit without changing its binding."""

    workspace = workspace.expanduser().absolute()
    binding, _vault, active, skill_mode = _validated_update_binding(workspace)
    from_kit_version = str(binding["kit_version"])
    canonical_fingerprint = canonical_skill_fingerprint()
    source_path = _canonical_skill_path()
    desired_docs = _render_workspace_docs(workspace, binding)

    skill_changes: dict[str, Path] = {}
    backup_harnesses: set[str] = set()
    old_link_targets: dict[str, str] = {}
    for harness in active:
        target = workspace / SKILL_TARGETS[harness]
        if skill_mode == "copy":
            marker = read_json(target / MARKER_FILE)
            if not isinstance(marker, dict) or marker.get("managed_by") != "llm-wiki":
                raise RuntimeError(f"Refusing to overwrite unmanaged copied Skill: {target}")
            actual = directory_fingerprint(target, SKILL_FINGERPRINT_IGNORE)
            recorded = marker.get("skill_fingerprint")
            marker_current = (
                marker.get("kit_version") == __version__
                and recorded == canonical_fingerprint
            )
            if actual != canonical_fingerprint or not marker_current:
                skill_changes[harness] = target
            if not isinstance(recorded, str) or recorded != actual:
                backup_harnesses.add(harness)
        else:
            old_link = os.readlink(target)
            old_link_targets[harness] = old_link
            resolved = (target.parent / old_link).resolve(strict=False)
            if resolved != source_path or not target.exists():
                skill_changes[harness] = target
                backup_harnesses.add(harness)

    doc_changes = {
        path: content
        for path, content in desired_docs.items()
        if (path.read_text(encoding="utf-8") if path.exists() else None) != content
    }
    metadata_current = (
        binding.get("kit_version") == __version__
        and binding.get("skill_fingerprint") == canonical_fingerprint
    )
    if not skill_changes and not doc_changes and metadata_current:
        return OperationResult(
            action="update",
            path=workspace,
            details={
                "status": "already-current",
                "from_kit_version": from_kit_version,
                "to_kit_version": __version__,
                "harnesses": active,
                "skill_mode": skill_mode,
                "updated_targets": [],
                "backups": [],
            },
        )

    runtime = workspace / BINDING_DIR / "runtime"
    runtime.mkdir(parents=True, exist_ok=True)
    staging = Path(tempfile.mkdtemp(prefix="update-staging-", dir=runtime))
    staged_targets: dict[str, Path] = {}
    backup_stage = staging / "backups"
    preimages = staging / "preimages"
    changed_paths = [str(SKILL_TARGETS[name]) for name in skill_changes]
    changed_paths.extend(str(path.relative_to(workspace)) for path in doc_changes)
    changed_paths.append(str(Path(BINDING_DIR) / BINDING_FILE))
    timestamp = utc_timestamp()
    backup_stamp = timestamp.replace(":", "-")
    backup_container = runtime / "update-backups"
    final_backup_root = backup_container / backup_stamp
    if final_backup_root.exists() or final_backup_root.is_symlink():
        final_backup_root = final_backup_root.with_name(
            f"{final_backup_root.name}-{uuid.uuid4().hex[:8]}"
        )

    try:
        for harness in skill_changes:
            staged = staging / "targets" / harness
            staged.parent.mkdir(parents=True, exist_ok=True)
            if skill_mode == "copy":
                copy_traversable(canonical_skill_root(), staged)
                atomic_write_json(
                    staged / MARKER_FILE,
                    {
                        "managed_by": "llm-wiki",
                        "kit_version": __version__,
                        "skill_fingerprint": canonical_fingerprint,
                    },
                )
            else:
                staged.symlink_to(source_path, target_is_directory=True)
            staged_targets[harness] = staged

        for harness in backup_harnesses:
            destination = backup_stage / harness
            target = workspace / SKILL_TARGETS[harness]
            if skill_mode == "copy":
                shutil.copytree(target, destination, symlinks=True)
            else:
                destination.mkdir(parents=True, exist_ok=True)
                atomic_write_text(
                    destination / "symlink-target.txt",
                    old_link_targets[harness] + "\n",
                )

        binding_preimage = preimages / "binding.json"
        binding_preimage.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(binding_path(workspace), binding_preimage)
        doc_preimages: dict[Path, Path | None] = {}
        for index, path in enumerate(doc_changes):
            if path.is_symlink():
                raise ValueError(f"Managed generated file must not be a symlink during update: {path}")
            if path.exists():
                preimage = preimages / "docs" / str(index)
                preimage.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(path, preimage)
                doc_preimages[path] = preimage
            else:
                doc_preimages[path] = None

        swapped: list[tuple[Path, Path]] = []
        backups_installed = False
        try:
            for harness, target in skill_changes.items():
                old = preimages / "skills" / harness
                old.parent.mkdir(parents=True, exist_ok=True)
                os.replace(target, old)
                try:
                    os.replace(staged_targets[harness], target)
                except Exception:
                    os.replace(old, target)
                    raise
                swapped.append((target, old))

            for path, content in doc_changes.items():
                if content is None:
                    path.unlink(missing_ok=True)
                else:
                    atomic_write_text(path, content)

            backup_paths: list[str] = []
            if backup_harnesses:
                backup_container.mkdir(parents=True, exist_ok=True)
                if backup_container.is_symlink() or not backup_container.is_dir():
                    raise ValueError(f"Update backup directory is unsafe: {backup_container}")
                if not is_relative_to(backup_container.resolve(), workspace.resolve()):
                    raise ValueError(
                        f"Update backup directory escapes the Workspace: {backup_container}"
                    )
                os.replace(backup_stage, final_backup_root)
                backups_installed = True
                backup_paths = [
                    str(final_backup_root / harness) for harness in sorted(backup_harnesses)
                ]

            updated_binding = dict(binding)
            updated_binding["kit_version"] = __version__
            updated_binding["updated_at"] = timestamp
            updated_binding["skill_fingerprint"] = canonical_fingerprint
            atomic_write_json(binding_path(workspace), updated_binding)
        except Exception:
            if backups_installed and final_backup_root.exists():
                shutil.rmtree(final_backup_root)
                backup_parent = final_backup_root.parent
                if backup_parent.is_dir() and not any(backup_parent.iterdir()):
                    backup_parent.rmdir()
            for path, preimage in doc_preimages.items():
                if path.exists() or path.is_symlink():
                    remove_tree_or_link(path)
                if preimage is not None and preimage.exists():
                    os.replace(preimage, path)
            if binding_path(workspace).exists() or binding_path(workspace).is_symlink():
                remove_tree_or_link(binding_path(workspace))
            if binding_preimage.exists():
                os.replace(binding_preimage, binding_path(workspace))
            for target, old in reversed(swapped):
                if target.exists() or target.is_symlink():
                    remove_tree_or_link(target)
                if old.exists() or old.is_symlink():
                    os.replace(old, target)
            raise

        return OperationResult(
            action="update",
            path=workspace,
            details={
                "status": "updated",
                "from_kit_version": from_kit_version,
                "to_kit_version": __version__,
                "harnesses": active,
                "skill_mode": skill_mode,
                "updated_targets": changed_paths,
                "backups": backup_paths,
            },
        )
    finally:
        if staging.exists():
            shutil.rmtree(staging)


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
    removing_set = requested & active
    removing = [name for name in ALL_HARNESSES if name in removing_set]

    removal_targets: list[Path] = []
    for harness in removing:
        target = workspace / SKILL_TARGETS[harness]
        if target.exists() or target.is_symlink():
            if not _skill_is_managed(target, binding, harness):
                raise RuntimeError(f"Refusing to remove unmanaged skill target: {target}")
            removal_targets.append(target)

    for target in removal_targets:
        remove_tree_or_link(target)

    remaining = [name for name in ALL_HARNESSES if name in active - removing_set]
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

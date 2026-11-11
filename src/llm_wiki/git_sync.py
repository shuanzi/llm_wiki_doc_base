"""Synchronize a local Vault through a validated, recoverable Git worktree."""

from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
import time
import uuid
from pathlib import Path
from typing import Callable

from .binding import load_binding
from .doctor import validate_vault
from .models import OperationResult
from .utils import atomic_write_json, is_relative_to, read_json, utc_timestamp
from .vault import REQUIRED_VAULT_DIRECTORIES
from .watch import (
    RUNNER_LOCK_FILE, _ProcessLock, _is_link_or_reparse,
    _recover_publish_transactions, _watch_runtime,
)

BRANCH = "refs/heads/main"
UPSTREAM = "refs/remotes/origin/main"
PENDING = "refs/llm-wiki/pending"
LOG = "logs/operations.md"
_OBJECT = re.compile(r"[0-9a-f]{40}|[0-9a-f]{64}")
_SESSION_ID = re.compile(r"[0-9a-f]{32}")
_ENTRY = re.compile(rb"(?m)^## \[\d{4}-\d\d-\d\dT[^\]\r\n]+\] [^\r\n]+$")


class GitError(RuntimeError):
    pass


class ValidationError(RuntimeError):
    pass


def _git(
    path: Path, *args: str, check: bool = True, index: Path | None = None
) -> subprocess.CompletedProcess[bytes]:
    env = {key: value for key, value in os.environ.items() if not key.startswith("GIT_")}
    env["GIT_TERMINAL_PROMPT"] = "0"
    env["GIT_SSH_COMMAND"] = "ssh -oBatchMode=yes -oConnectTimeout=10"
    env["GIT_EDITOR"] = "true"
    env["GIT_MERGE_AUTOEDIT"] = "no"
    env["GIT_OPTIONAL_LOCKS"] = "0"
    if index is not None:
        env["GIT_INDEX_FILE"] = str(index)
    try:
        result = subprocess.run(
            ["git", "-C", str(path), "-c", f"core.hooksPath={os.devnull}",
             "-c", "core.autocrlf=false", "-c", "commit.gpgsign=false", *args],
            env=env, capture_output=True, timeout=45,
        )
    except subprocess.TimeoutExpired as exc:
        if not check:
            return subprocess.CompletedProcess(args, 124, b"", b"Git command timed out")
        raise GitError(f"Git {args[0]} timed out") from exc
    if check and result.returncode:
        raise GitError(f"Git {args[0]} failed: {_error(result)}")
    return result


def _error(result: subprocess.CompletedProcess[bytes]) -> str:
    return result.stderr.decode(errors="replace").strip()[:1500]


def _text(path: Path, *args: str, **kwargs) -> str:
    return _git(path, *args, **kwargs).stdout.decode(errors="replace").strip()


def _ref(path: Path, name: str) -> str:
    return _text(path, "rev-parse", "--verify", "--quiet", name, check=False)


def _is_ancestor(path: Path, left: str, right: str) -> bool:
    return _git(path, "merge-base", "--is-ancestor", left, right, check=False).returncode == 0


def _git_tree(path: Path, revision: str, prefix: str = "") -> dict[bytes, bytes]:
    args = ("--", prefix) if prefix else ()
    rows = _git(path, "ls-tree", "-rz", revision, *args).stdout.split(b"\0")
    return {row.split(b"\t", 1)[1]: row.split(b"\t", 1)[0] for row in rows if row}


def _materialize_empty_dirs(path: Path) -> None:
    # Git carries files, not empty directories. Refuse symlinks before mkdir.
    for relative in (*REQUIRED_VAULT_DIRECTORIES, "Clippings"):
        target = path
        for component in Path(relative).parts:
            target /= component
            if _is_link_or_reparse(target):
                raise ValidationError(f"Unsafe Vault directory: {relative}")
            target.mkdir(exist_ok=True)


def _append_tail(base: bytes, side: bytes) -> bytes | None:
    if not side.startswith(base):
        return None
    tail = side[len(base):].strip(b"\r\n")
    if not tail:
        return b""
    headings = list(_ENTRY.finditer(tail))
    if not headings or headings[0].start() != 0 or not side.endswith(b"\n"):
        return None
    ends = [entry.start() for entry in headings[1:]] + [len(tail)]
    if any(not tail[entry.end():end].strip() for entry, end in zip(headings, ends)):
        return None
    if len(re.findall(rb"(?m)^## ", tail)) != len(headings):
        return None
    return tail


def _merge_append_log(path: Path, base: bytes, ours: bytes, theirs: bytes) -> bool:
    ours_tail, theirs_tail = (_append_tail(base, side) for side in (ours, theirs))
    if ours_tail is None or theirs_tail is None:
        return False
    tails = list(dict.fromkeys(tail for tail in (ours_tail, theirs_tail) if tail))
    (path / LOG).write_bytes(base + b"".join(b"\n" + tail + b"\n" for tail in tails))
    _git(path, "add", "--", LOG)
    return True


class VaultSync:
    def __init__(self, workspace: Path) -> None:
        self.workspace = workspace.expanduser().resolve()
        binding = load_binding(self.workspace)
        vault_path = binding.get("vault_path") if binding else None
        if not isinstance(vault_path, str) or not Path(vault_path).is_absolute():
            raise ValueError("Git sync requires a bound Vault")
        self.vault = Path(vault_path).resolve(strict=True)
        self.git_dir = self.vault / ".git"
        if _is_link_or_reparse(self.git_dir) or not self.git_dir.is_dir():
            raise ValueError("Git sync requires a standalone Git checkout at the Vault root")
        self.state_dir = self.git_dir / "llm-wiki"
        if _is_link_or_reparse(self.state_dir):
            raise ValueError("Unsafe Git sync state directory")
        self.active = self.state_dir / "active.json"
        self.checkpoint = self.state_dir / "checkpoint.json"
        self.last = self.state_dir / "status.json"
        self.harnesses = list(binding["harnesses"])
        root = _text(self.vault, "config", "--local", "--get", "llmwiki.worktreeRoot", check=False)
        self.worktrees = (
            Path(root).expanduser() if root else Path.home() / "Documents/code/.worktree"
        ).resolve()
        if is_relative_to(self.worktrees, self.vault) or is_relative_to(self.worktrees, self.workspace):
            raise ValueError("Git sync worktrees must be outside the Vault and Binding")

    def _state(self, path: Path) -> dict:
        if _is_link_or_reparse(path):
            raise ValueError(f"Unsafe Git sync state file: {path}")
        payload = read_json(path) if path.exists() else {}
        if not isinstance(payload, dict):
            raise ValueError(f"Invalid Git sync state file: {path}")
        return payload

    def status(self) -> OperationResult:
        state = self._state(self.last)
        return OperationResult("sync-status", self.vault, {
            "status": "not-yet-synced",
            **state,
            "head": _ref(self.vault, "HEAD"),
            "upstream": _ref(self.vault, UPSTREAM),
            "candidate": _ref(self.vault, PENDING),
            "dirty": bool(_text(self.vault, "status", "--porcelain")),
            "active": self._state(self.active),
        })

    def _result(self, status: str, **details) -> OperationResult:
        payload = {
            "status": status, "updated_at": utc_timestamp(),
            "last_online_at": self._state(self.last).get("last_online_at"), **details,
        }
        atomic_write_json(self.last, payload)
        return OperationResult("sync", self.vault, payload)

    def _snapshot(self, head: str) -> str:
        # An independent index captures content without staging user files.
        with tempfile.TemporaryDirectory(prefix="index-", dir=self.state_dir) as directory:
            index = Path(directory) / "index"
            _git(self.vault, "read-tree", head, index=index)
            _git(self.vault, "add", "-A", "--", ".", index=index)
            return _text(self.vault, "write-tree", index=index)

    def _finish_checkpoint(self) -> str:
        state = self._state(self.checkpoint)
        head = _ref(self.vault, "HEAD")
        if not state:
            return head
        base, commit = state["base"], state["commit"]
        if not all(_OBJECT.fullmatch(value) for value in (base, commit)):
            raise ValueError("Invalid checkpoint journal")
        if head not in (base, commit):
            raise GitError("HEAD changed while recovering a captured local checkpoint")
        index = _text(self.vault, "write-tree")
        if index not in (_ref(self.vault, f"{base}^{{tree}}"), _ref(self.vault, f"{commit}^{{tree}}")):
            raise GitError("Git index changed while recovering a captured local checkpoint")
        if head == base:
            _git(self.vault, "update-ref", BRANCH, commit, base)
        _git(self.vault, "read-tree", commit)
        self.checkpoint.unlink()
        return commit

    def _capture(self, settle_seconds: float, sleeper: Callable[[float], None]) -> str | None:
        base = self._finish_checkpoint()
        tree = self._snapshot(base)
        if settle_seconds:
            sleeper(settle_seconds)
        if tree != self._snapshot(base) or _ref(self.vault, "HEAD") != base:
            return None
        base_tree = _ref(self.vault, f"{base}^{{tree}}")
        if _text(self.vault, "write-tree") != base_tree:
            raise GitError("Git index contains manually staged changes; finish that commit first")
        if tree == base_tree:
            return base
        self._validate_tree(self.vault, tree)
        self._validate_library(self.vault, tree, (base,))
        commit = _text(self.vault, "commit-tree", tree, "-p", base, "-m",
                       "wiki: checkpoint saved local edits")
        # Updating HEAD/index never checks out files. Later saves stay dirty.
        atomic_write_json(self.checkpoint, {"base": base, "commit": commit})
        return self._finish_checkpoint()

    def _validate_tree(self, path: Path, revision: str) -> None:
        for name, descriptor in _git_tree(path, revision).items():
            if not descriptor.startswith((b"100644 ", b"100755 ")):
                raise ValidationError(f"Unsupported Git path: {os.fsdecode(name)}")
            parts = name.split(b"/")
            if any(part in (b".llm-wiki-binding", b".codex", b".agents", b".claude", b".DS_Store")
                   for part in parts) or (
                parts[0] == b".obsidian"
                and (len(parts) != 2 or parts[1] not in (
                    b"app.json", b"appearance.json", b"core-plugins.json",
                    b"graph.json", b"templates.json",
                ))
            ):
                raise ValidationError(f"Machine-specific file must stay local: {os.fsdecode(name)}")

    def _validate(self, path: Path, tree: str, bases: tuple[str, ...]) -> None:
        self._validate_tree(path, tree)
        _materialize_empty_dirs(path)
        findings = [item for item in validate_vault(path) if item.level in ("error", "warning")]
        if findings:
            detail = "; ".join(f"{item.code}: {item.message} [{item.path}]" for item in findings[:10])
            raise ValidationError(detail)
        expected = read_json(self.vault / "profile/vault.json")["vault_id"]
        if read_json(path / "profile/vault.json")["vault_id"] != expected:
            raise ValidationError("Candidate changes the Vault identity")
        self._validate_library(path, tree, bases)

    @staticmethod
    def _validate_library(path: Path, tree: str, bases: tuple[str, ...]) -> None:
        library = _git_tree(path, tree, "sources/library/")
        for base in bases:
            for name, descriptor in _git_tree(path, base, "sources/library/").items():
                if library.get(name) != descriptor:
                    raise ValidationError(f"Registered source changed: {os.fsdecode(name)}")

    def _fetch(self) -> str:
        result = _git(self.vault, "fetch", "--no-tags", "origin", f"{BRANCH}:{UPSTREAM}", check=False)
        if result.returncode:
            return _error(result) or "Git fetch failed"
        return ""

    def _merge(self, path: Path, other: str) -> list[str]:
        left = _ref(path, "HEAD")
        if not other or _is_ancestor(path, other, left):
            return []
        self._validate_tree(path, other)
        if _is_ancestor(path, left, other):
            _git(path, "merge", "--ff-only", other)
        else:
            base = _text(path, "merge-base", left, other, check=False)
            if not base:
                raise GitError("Vault histories do not share a common ancestor")
            logs = [_git(path, "show", f"{revision}:{LOG}", check=False)
                    for revision in (base, left, other)]
            result = _git(path, "merge", "--no-ff", "--no-commit", other, check=False)
            conflicts = self._conflicts(path)
            if result.returncode and not _ref(path, "MERGE_HEAD"):
                raise GitError(f"Git merge failed: {_error(result)}")
            common, ours, theirs = (item.stdout for item in logs)
            if ours != common and theirs != common:
                merged_log = not any(item.returncode for item in logs) and _merge_append_log(
                    path, common, ours, theirs
                )
                conflicts = [name for name in conflicts if name != LOG]
                if not merged_log:
                    conflicts.append(LOG)
            if conflicts:
                return conflicts
            # A clean textual merge can still break provenance.
            self._validate(path, _text(path, "write-tree"), (left, other))
            _git(path, "commit", "--no-edit")
        self._validate(path, _ref(path, "HEAD"), (left, other))
        return []

    @staticmethod
    def _conflicts(path: Path) -> list[str]:
        names = _git(path, "diff", "--name-only", "--diff-filter=U", "-z").stdout
        return [os.fsdecode(name) for name in names.split(b"\0") if name]

    def _check_checkout(self) -> None:
        if _text(self.vault, "symbolic-ref", "HEAD", check=False) != BRANCH or not _ref(self.vault, "HEAD"):
            raise ValueError("Git sync requires an initialized main checkout")
        for name in ("MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "rebase-merge", "rebase-apply"):
            if (self.git_dir / name).exists():
                raise GitError("Finish the in-progress Git operation before synchronizing")
        fetch_url = _text(self.vault, "remote", "get-url", "origin")
        push_url = _text(self.vault, "remote", "get-url", "--push", "origin")
        pinned = _text(self.vault, "config", "--local", "--get", "llmwiki.origin", check=False)
        if fetch_url != push_url or (pinned and fetch_url != pinned):
            raise ValueError("Git origin does not match the configured Vault remote")

    def run(
        self, *, resume: str | None = None,
        operation: Callable[[Path, Path], OperationResult | None] | None = None,
        read_only: bool = False,
        settle_seconds: float = 0,
        sleeper: Callable[[float], None] = time.sleep,
        watch: bool = False,
    ) -> OperationResult:
        self.state_dir.mkdir(mode=0o700, exist_ok=True)
        lock = _ProcessLock(self.state_dir / "sync.lock")
        if not lock.acquire():
            return OperationResult("sync", self.vault, {"status": "busy"})
        try:
            self._check_checkout()
            return self._run(resume, operation, read_only, settle_seconds, sleeper, watch)
        finally:
            lock.release()

    def _run(self, resume, operation, read_only, settle_seconds, sleeper, watch) -> OperationResult:
        state = self._state(self.active)
        if state and not _SESSION_ID.fullmatch(state.get("id", "")):
            raise ValueError("Invalid Git sync recovery session")
        if state and not resume and state.get("status") == "publishing":
            staged = self.worktrees / f"llm-wiki-sync-{state['id']}" / "vault"
            if staged.is_dir():
                resume = state["id"]
                operation = None
            elif _ref(self.vault, PENDING) == state.get("candidate"):
                self.active.unlink()
                state = {}
        if state and not resume:
            return self._result(
                state.get("status", "interrupted"), session=state["id"],
                worktree=str(self.worktrees / f"llm-wiki-sync-{state['id']}" / "vault"),
                conflicts=state.get("conflicts", []), error=state.get("error", ""),
            )
        if resume and (not _SESSION_ID.fullmatch(resume) or state.get("id") != resume):
            raise ValueError("Unknown Git sync recovery session")
        try:
            base = self._capture(settle_seconds, sleeper)
        except ValidationError as exc:
            return self._result("validation-failed", error=str(exc))
        if base is None:
            return self._result("local-changed")

        session = resume or uuid.uuid4().hex
        root = self.worktrees / f"llm-wiki-sync-{session}"
        stage = root / "vault"
        binding = root / "binding"
        self.worktrees.mkdir(parents=True, exist_ok=True)
        if not resume:
            root.mkdir(mode=0o700)
            self._validate_tree(self.vault, base)
            _git(self.vault, "worktree", "add", "--detach", str(stage), base)
            state = {"id": session, "base": base, "watch": watch, "workspace": str(self.workspace)}
            atomic_write_json(self.active, state)
        elif (
            root.is_symlink() or stage.is_symlink()
            or _text(stage, "rev-parse", "--path-format=absolute", "--git-common-dir") != str(self.git_dir)
        ):
            raise ValueError("Unsafe recovery worktree")

        def blocked(status: str, **details) -> OperationResult:
            atomic_write_json(self.active, {**state, "status": status, **details})
            return self._result(status, session=session, worktree=str(stage), **details)

        report = None
        input_commit = None
        try:
            if resume:
                if state.get("watch") and state.get("status") != "publishing":
                    if state["workspace"] != str(self.workspace):
                        raise GitError("Resume the Watcher session from its original Binding")
                    watch_root = _watch_runtime(self.workspace)
                    watch_lock = _ProcessLock(watch_root / RUNNER_LOCK_FILE)
                    if not watch_lock.acquire():
                        return blocked("busy", error="Watcher is still using the recovery worktree")
                    try:
                        _recover_publish_transactions(watch_root, stage)
                    finally:
                        watch_lock.release()
                conflicts = self._conflicts(stage)
                if conflicts:
                    return blocked("conflict", conflicts=conflicts)
                parents = (_ref(stage, "HEAD"), _ref(stage, "MERGE_HEAD"))
                self._commit(stage, "wiki: recover validated changes", tuple(x for x in parents if x))

            offline = self._fetch()
            upstream = _ref(self.vault, UPSTREAM)
            pending = _ref(self.vault, PENDING)
            for other in (base, pending, upstream):
                conflicts = self._merge(stage, other)
                if conflicts:
                    return blocked("conflict", conflicts=conflicts)
            self._validate(stage, _ref(stage, "HEAD"), (base,))

            if operation is not None:
                from .binding import attach

                attach(stage, binding, self.harnesses)
                before = _ref(stage, "HEAD")
                input_commit = before
                report = operation(binding, stage)
                if _ref(stage, "HEAD") != before or _ref(stage, "MERGE_HEAD"):
                    return blocked("validation-failed", error="Managed task changed Git state")
                if read_only and _text(stage, "status", "--porcelain"):
                    return blocked("validation-failed", error="Read task modified the Vault")
                if report is not None and report.details.get("exit_code", 0):
                    return blocked("validation-failed", error="Managed command exited unsuccessfully",
                                   operation=report.details)
                self._commit(stage, "wiki: save managed Vault changes", (before,))

            candidate = _ref(stage, "HEAD")
            _git(self.vault, "update-ref", PENDING, candidate)
            atomic_write_json(self.active, {**state, "status": "publishing", "candidate": candidate})
            pushed = False
            if not offline:
                for _ in range(3):
                    offline = self._fetch()
                    if offline:
                        break
                    upstream = _ref(self.vault, UPSTREAM)
                    conflicts = self._merge(stage, upstream)
                    if conflicts:
                        return blocked("conflict", conflicts=conflicts)
                    candidate = _ref(stage, "HEAD")
                    _git(self.vault, "update-ref", PENDING, candidate)
                    atomic_write_json(self.active, {**state, "status": "publishing", "candidate": candidate})
                    if candidate == upstream:
                        pushed = True
                        break
                    result = _git(stage, "push", "origin", f"HEAD:{BRANCH}", check=False)
                    if not result.returncode:
                        pushed = True
                        break
                    offline = _error(result) or "Git push failed"
                    if "non-fast-forward" not in offline and "fetch first" not in offline:
                        break

            updated = (
                _ref(self.vault, "HEAD") == base
                and _text(self.vault, "write-tree") == _ref(self.vault, f"{base}^{{tree}}")
                and self._snapshot(base) == _ref(self.vault, f"{base}^{{tree}}")
            )
            if updated and candidate != base:
                updated = not _git(self.vault, "merge", "--ff-only", candidate, check=False).returncode
            if updated:
                _materialize_empty_dirs(self.vault)
            _git(self.vault, "worktree", "remove", str(stage))
            if binding.is_dir():
                shutil.rmtree(binding)
            root.rmdir()
            self.active.unlink()
            return self._result(
                "synced" if pushed and updated else "local-update-pending" if pushed else "offline-pending",
                pushed=pushed, local_updated=updated, candidate=candidate, error="" if pushed else offline,
                input_commit=input_commit,
                last_online_at=utc_timestamp() if pushed else self._state(self.last).get("last_online_at"),
                operation=report.details if report is not None else None,
            )
        except ValidationError as exc:
            return blocked("validation-failed", error=str(exc))

    def _commit(self, path: Path, message: str, bases: tuple[str, ...]) -> None:
        _git(path, "add", "-A", "--", ".")
        tree = _text(path, "write-tree")
        self._validate(path, tree, bases)
        if tree != _ref(path, "HEAD^{tree}") or _ref(path, "MERGE_HEAD"):
            _git(path, "commit", "-m", message)

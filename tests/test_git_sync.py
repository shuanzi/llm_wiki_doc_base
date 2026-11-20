from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
import time
import unittest
from pathlib import Path

from llm_wiki.binding import attach
from llm_wiki.cli import main
from llm_wiki.vault import init_vault, register_source
from llm_wiki.watch import run_watch
from tests.test_watch import FakeAgentRuntime


@unittest.skipUnless(shutil.which("git"), "Git is required for sync integration tests")
class GitSyncTests(unittest.TestCase):
    def git(self, repo: Path, *args: str) -> str:
        return subprocess.run(
            ["git", "-C", str(repo), *args], text=True, capture_output=True, check=True
        ).stdout.strip()

    def setUp(self) -> None:
        temporary = tempfile.TemporaryDirectory()
        self.addCleanup(temporary.cleanup)
        self.root = Path(temporary.name).resolve()
        self.remote = self.root / "remote.git"
        self.vault = self.root / "vault"
        self.workspace = self.root / "binding"
        self.peer = self.root / "peer"
        self.git(self.root, "init", "--bare", "-b", "main", str(self.remote))
        init_vault(self.vault, "Sync test")
        self.git(self.vault, "init", "-b", "main")
        self.git(self.vault, "remote", "add", "origin", str(self.remote))
        self.configure(self.vault)
        self.git(self.vault, "add", "-A")
        self.git(self.vault, "commit", "-m", "Initial Vault")
        self.git(self.vault, "push", "-u", "origin", "main")
        self.git(self.root, "clone", str(self.remote), str(self.peer))
        self.configure(self.peer)
        attach(self.vault, self.workspace, ["codex"])

    def configure(self, repo: Path) -> None:
        self.git(repo, "config", "user.name", "Wiki tests")
        self.git(repo, "config", "user.email", "wiki-test@example.invalid")
        self.git(repo, "config", "llmwiki.worktreeRoot", str(self.root / "worktrees"))

    def status(self) -> dict:
        result = subprocess.run(
            [sys.executable, "-m", "llm_wiki", "sync-status", "--workspace",
             str(self.workspace), "--json"], text=True, capture_output=True, check=True
        )
        return json.loads(result.stdout)["details"]

    def sync(self, *args: str) -> int:
        return main(["sync", "--workspace", str(self.workspace), *args])

    def push_peer(self, message: str) -> str:
        self.git(self.peer, "add", "-A")
        self.git(self.peer, "commit", "-m", message)
        self.git(self.peer, "push")
        return self.git(self.peer, "rev-parse", "HEAD")

    def test_sync_preserves_local_edit_and_fast_forwards_remote_edit(self) -> None:
        (self.peer / "evidence" / "peer.md").write_text("# Peer\n")
        self.push_peer("Peer change")
        (self.vault / "evidence" / "local.md").write_text("# Local\n")
        self.assertEqual(self.sync(), 0)
        self.assertEqual((self.vault / "evidence" / "peer.md").read_text(), "# Peer\n")
        self.assertEqual(self.git(self.remote, "show", "main:evidence/local.md"), "# Local")
        self.assertEqual(self.git(self.vault, "rev-parse", "HEAD"),
                         self.git(self.remote, "rev-parse", "main"))

    def test_conflict_preserves_both_commits_and_resumes_resolution(self) -> None:
        page = self.vault / "evidence" / "README.md"
        page.write_text("# Local change\n")
        (self.peer / "evidence" / page.name).write_text("# Peer change\n")
        peer_commit = self.push_peer("Peer change")
        self.assertEqual(self.sync(), 1)
        status = self.status()
        self.assertEqual(status["status"], "conflict")
        self.assertEqual(status["conflicts"], ["evidence/README.md"])
        local_commit = self.git(self.vault, "rev-parse", "HEAD")
        self.assertEqual(page.read_text(), "# Local change\n")
        self.assertEqual(self.git(self.remote, "rev-parse", "main"), peer_commit)
        stage = Path(status["worktree"])
        (stage / "evidence" / page.name).write_text("# Local and peer changes\n")
        self.git(stage, "add", "evidence/README.md")
        self.assertEqual(self.sync("--resume", status["session"]), 0)
        for commit in (local_commit, peer_commit):
            self.git(self.remote, "merge-base", "--is-ancestor", commit, "main")
        self.assertEqual(page.read_text(), "# Local and peer changes\n")

    def test_both_appended_log_entries_survive(self) -> None:
        relative = Path("logs/operations.md")
        for repo, label in ((self.vault, "Local"), (self.peer, "Peer")):
            with (repo / relative).open("a", encoding="utf-8") as handle:
                handle.write(f"\n## [2026-11-11T00:00:00Z] maintain | {label}\n\n- {label} entry\n")
        self.push_peer("Peer log")
        self.assertEqual(self.sync(), 0)
        log = (self.vault / relative).read_text()
        for label in ("Local", "Peer"):
            self.assertEqual(log.count(f"- {label} entry"), 1)

    def test_nonappend_log_edits_require_review_even_if_text_merges(self) -> None:
        relative = Path("logs/operations.md")
        with (self.vault / relative).open("a", encoding="utf-8") as handle:
            handle.write("\n## [2026-11-11T00:00:00Z] maintain | Local\n\n- Local entry\n")
        peer_log = self.peer / relative
        peer_log.write_text(peer_log.read_text().replace("# Operations Log", "# Edited log"))
        self.push_peer("Rewrite log heading")
        self.assertEqual(self.sync(), 1)
        self.assertEqual(self.status()["conflicts"], ["logs/operations.md"])

    def watch(self, agent: FakeAgentRuntime):
        return run_watch(
            self.workspace, self.vault / "Clippings", settle_seconds=0, agent_runtime=agent,
            git_sync=True,
        )

    def test_watch_preserves_save_during_agent_and_pushes_valid_candidate(self) -> None:
        inbox = self.vault / "Clippings"
        inbox.mkdir()
        (inbox / "new.md").write_text("# New clipping\n")
        live_note = self.vault / "evidence" / "saved-during-agent.md"
        test = self

        class ConcurrentSave(FakeAgentRuntime):
            def run(self, **kwargs):
                test.assertFalse((kwargs["vault"] / ".git").exists())
                test.assertEqual((kwargs["workspace"] / "vault").resolve(), kwargs["vault"])
                live_note.write_text("# Saved while the Agent was running\n")
                return super().run(**kwargs)

        agent = ConcurrentSave()
        result = self.watch(agent)
        self.assertEqual(result.details["sync"]["status"], "local-update-pending")
        self.assertEqual(result.details["ingested"], 1)
        self.assertEqual(live_note.read_text(), "# Saved while the Agent was running\n")
        self.assertEqual(list((self.vault / "wiki" / "sources").glob("*.md")), [])
        self.assertEqual(self.sync(), 0)
        self.assertEqual(len(list((self.vault / "wiki" / "sources").glob("*.md"))), 1)
        self.assertEqual(len(agent.calls), 1)
        self.assertTrue(live_note.is_file())

    def test_offline_ingest_is_not_repeated_when_remote_returns(self) -> None:
        inbox = self.vault / "Clippings"
        inbox.mkdir()
        (inbox / "new.md").write_text("# Offline clipping\n")
        offline = self.root / "offline.git"
        self.remote.rename(offline)
        agent = FakeAgentRuntime()
        result = self.watch(agent)
        self.assertEqual(result.details["sync"]["status"], "offline-pending")
        self.assertEqual(result.details["ingested"], 1)
        offline.rename(self.remote)
        self.assertEqual(self.watch(agent).details["sync"]["status"], "synced")
        self.assertEqual(len(agent.calls), 1)

    def test_failed_push_survives_a_new_watcher_process(self) -> None:
        inbox = self.vault / "Clippings"
        inbox.mkdir()
        (inbox / "new.md").write_text("# Push failure clipping\n")
        self.git(self.remote, "config", "receive.hideRefs", "refs/heads/main")
        agent = FakeAgentRuntime()
        first = self.watch(agent)
        self.assertEqual(first.details["sync"]["status"], "offline-pending")
        self.assertEqual(first.details["ingested"], 1)
        self.assertNotEqual(self.git(self.remote, "rev-parse", "main"),
                            self.git(self.vault, "rev-parse", "HEAD"))
        self.git(self.remote, "config", "--unset", "receive.hideRefs")
        second_agent = FakeAgentRuntime()
        self.assertEqual(self.watch(second_agent).details["sync"]["status"], "synced")
        self.assertEqual(second_agent.calls, [])

    def test_new_peer_commit_during_ingest_is_included(self) -> None:
        inbox = self.vault / "Clippings"
        inbox.mkdir()
        (inbox / "new.md").write_text("# New clipping\n")
        test = self

        class PeerPush(FakeAgentRuntime):
            def run(self, **kwargs):
                (test.peer / "evidence" / "peer.md").write_text("# Peer\n")
                test.push_peer("Peer edit during Ingest")
                return super().run(**kwargs)

        self.assertEqual(self.watch(PeerPush()).details["sync"]["status"], "synced")
        self.assertEqual(self.git(self.remote, "show", "main:evidence/peer.md"), "# Peer")
        self.assertEqual(len(list((self.vault / "wiki" / "sources").glob("*.md"))), 1)

    def test_unstable_clipping_defers_shared_snapshot(self) -> None:
        inbox = self.vault / "Clippings"
        inbox.mkdir()
        clipping = inbox / "new.md"
        clipping.write_text("partial")
        agent = FakeAgentRuntime()
        result = run_watch(
            self.workspace, inbox, settle_seconds=60, agent_runtime=agent,
            sleeper=lambda _: clipping.write_text("# Complete\n"), git_sync=True,
        )
        self.assertEqual(result.details["sync"]["status"], "local-changed")
        self.assertEqual(agent.calls, [])
        self.assertEqual(self.git(self.vault, "rev-parse", "HEAD"),
                         self.git(self.remote, "rev-parse", "main"))
        self.assertEqual(self.watch(agent).details["ingested"], 1)

    def test_read_command_cannot_publish_writes(self) -> None:
        code = "from pathlib import Path; Path('vault/evidence/unexpected.md').write_text('# Unexpected')"
        self.assertEqual(main([
            "run", "--workspace", str(self.workspace), "--mode", "read",
            "--", sys.executable, "-c", code,
        ]), 1)
        self.assertFalse((self.vault / "evidence" / "unexpected.md").exists())
        self.assertEqual(self.status()["status"], "validation-failed")

    def test_fast_forward_does_not_overwrite_locally_ignored_files(self) -> None:
        local_file = self.vault / "evidence" / "device-note.md"
        local_file.write_text("# Local ignored note\n")
        with (self.vault / ".git" / "info" / "exclude").open("a", encoding="utf-8") as handle:
            handle.write("\n/evidence/device-note.md\n")
        (self.peer / "evidence" / local_file.name).write_text("# Peer tracked note\n")
        self.push_peer("Peer tracked note")
        self.assertEqual(self.sync(), 1)
        self.assertEqual(self.status()["status"], "local-update-pending")
        self.assertEqual(local_file.read_text(), "# Local ignored note\n")

    def test_process_restart_recovers_saved_changes_from_interrupted_task(self) -> None:
        marker = self.root / "task-saved"
        child = (
            "import os,time; from pathlib import Path; "
            "parent=os.getppid(); "
            "Path('vault/evidence/interrupted.md').write_text('# Saved before restart\\n'); "
            f"Path({str(marker)!r}).touch(); "
            "exec('while os.getppid() == parent: time.sleep(0.05)')"
        )
        with subprocess.Popen([
            sys.executable, "-m", "llm_wiki", "run", "--workspace", str(self.workspace),
            "--mode", "write", "--", sys.executable, "-c", child,
        ], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL) as process:
            try:
                deadline = time.monotonic() + 10
                while not marker.exists() and process.poll() is None and time.monotonic() < deadline:
                    time.sleep(0.05)
                self.assertTrue(marker.exists())
            finally:
                if process.poll() is None:
                    process.kill()
                process.wait(timeout=5)
        self.assertEqual(self.sync(), 1)
        status = self.status()
        self.assertEqual(status["status"], "interrupted")
        self.assertFalse((self.vault / "evidence" / "interrupted.md").exists())
        self.assertEqual(self.sync("--resume", status["session"]), 0)
        self.assertEqual(self.git(self.remote, "show", "main:evidence/interrupted.md"),
                         "# Saved before restart")

    def test_valid_manual_commit_cannot_silently_drop_previously_published_source(self) -> None:
        input_file = self.root / "original.md"
        input_file.write_text("# Immutable source\n")
        registration = register_source(self.vault, input_file)
        self.assertEqual(self.sync(), 0)
        published = self.git(self.remote, "rev-parse", "main")
        registration.path.unlink()
        next((self.vault / "sources" / "library").rglob("*.md")).unlink()
        self.git(self.vault, "add", "-A")
        self.git(self.vault, "commit", "-m", "Remove previously published source")
        self.assertEqual(self.sync(), 1)
        self.assertEqual(self.status()["status"], "validation-failed")
        self.assertEqual(self.git(self.remote, "rev-parse", "main"), published)

    def test_ignored_registered_source_cannot_mask_incomplete_candidate_tree(self) -> None:
        (self.vault / ".gitignore").write_text("/sources/library/**\n")
        self.assertEqual(self.sync(), 0)
        published = self.git(self.remote, "rev-parse", "main")
        source = self.root / "ignored-source.md"
        source.write_text("# Source kept only in a working directory\n")
        code = (
            f"import sys; sys.path.insert(0, {str(Path(__file__).resolve().parents[1] / 'src')!r}); "
            "from pathlib import Path; from llm_wiki.vault import register_source; "
            f"register_source(Path('vault'), Path({str(source)!r}))"
        )

        self.assertEqual(main([
            "run", "--workspace", str(self.workspace), "--mode", "write",
            "--", sys.executable, "-c", code,
        ]), 1)
        status = self.status()
        self.assertEqual(status["status"], "validation-failed")
        self.assertIn("source.file-missing", status["error"])
        self.assertEqual(self.git(self.remote, "rev-parse", "main"), published)
        stage = Path(status["worktree"])
        self.assertEqual(len(list((stage / "sources/library").rglob("*.md"))), 1)
        # Explicitly admitting the evidence makes the same recoverable session publishable.
        self.git(stage, "add", "-f", "sources/library")
        self.assertEqual(self.sync("--resume", status["session"]), 0)
        self.git(self.peer, "pull", "--ff-only")
        self.assertEqual(len(list((self.peer / "sources/library").rglob("*.md"))), 1)

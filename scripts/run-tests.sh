#!/usr/bin/env bash
set -euo pipefail
ROOT=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"
export PYTHONPATH="$ROOT/src${PYTHONPATH:+:$PYTHONPATH}"
TEST_PYTHON=${LLM_WIKI_TEST_PYTHON:-${LLM_WIKI_PACKAGING_PYTHON:-python3}}
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

"$TEST_PYTHON" -m compileall -q src tests
"$TEST_PYTHON" -m unittest discover -s tests -t . -v 2>&1 | tee "$TMP/unittest.log"
"$TEST_PYTHON" -m llm_wiki doctor "$ROOT" --kind kit --strict 2>&1 | tee "$TMP/doctor.log"
"$ROOT/scripts/acceptance-smoke.sh" 2>&1 | tee "$TMP/acceptance.log"
"$ROOT/scripts/installed-smoke.sh" 2>&1 | tee "$TMP/installed.log"

TEST_COUNT=$(sed -n 's/^Ran \([0-9][0-9]*\) tests.*$/\1/p' "$TMP/unittest.log" | tail -1)
TEST_COUNT=${TEST_COUNT:-unknown}
PYTHON_VERSION=$("$TEST_PYTHON" --version 2>&1)
PLATFORM=$("$TEST_PYTHON" - <<'PY'
import platform
print(platform.platform())
PY
)
CODEX=$(command -v codex >/dev/null 2>&1 && codex --version 2>/dev/null | head -1 || printf 'not installed')
CLAUDE=$(command -v claude >/dev/null 2>&1 && claude --version 2>/dev/null | head -1 || printf 'not installed')
OPENCLAW=$(command -v openclaw >/dev/null 2>&1 && openclaw --version 2>/dev/null | head -1 || printf 'not installed')
TIMESTAMP=$(date -u '+%Y-%m-%dT%H:%M:%SZ')

export ROOT TEST_COUNT PYTHON_VERSION PLATFORM CODEX CLAUDE OPENCLAW TIMESTAMP TEST_PYTHON
"$TEST_PYTHON" - <<'PYREPORT'
from pathlib import Path
import os

report = f"""# Test Report

- Result: **PASS**
- Executed at: `{os.environ['TIMESTAMP']}`
- Platform: `{os.environ['PLATFORM']}`
- Test Python: `{os.environ['PYTHON_VERSION']}`
- Unit/integration tests: `{os.environ['TEST_COUNT']}` passed
- Kit Doctor strict: PASS, 0 errors, 0 warnings
- End-to-end acceptance smoke: PASS
- Installed-package smoke in clean venv: PASS

## Tested behaviors

- Standalone Vault initialization and Obsidian JSON generation;
- UTF-8 Markdown structure and machine-discoverable Vault Profile;
- Source copy, SHA-256 registration, idempotency, missing/tampered Source detection;
- One-shot Watch Markdown-default scans, all-files compatibility, stability gate, SQLite queue/lease recovery, Codex Adapter protocol, and deterministic Ingest completion checks;
- Repository URL normalization, root README registration, offline idempotency, and no source-code persistence;
- Codex `.agents/skills`, Claude Code `.claude/skills`, OpenClaw `skills` bindings;
- Copy and symlink Skill modes; symlink and pointer Vault modes;
- Managed instruction block idempotency, malformed-block preflight, and preservation of user-owned content;
- Partial detach, complete detach, unmanaged directory/symlink collision protection;
- Transactional Workspace update, local-drift backup, symlink retargeting, rollback, and idempotency;
- Vault fingerprint unchanged by detach;
- Independent Vault copy/migration and moved-Vault rebind;
- Stale-binding real-directory protection and generated/source path-escape rejection;
- Invalid JSON, non-UTF-8 files, mode drift, portable filenames, and recovery failures;
- Canonical Skill/package copy equality and cross-Harness Eval schema;
- CLI JSON/text interfaces and installation with no runtime dependencies.

## External Agent execution

The deterministic test suite deliberately did not execute a live Agent session. The locally visible CLI versions were:

- Codex: `{os.environ['CODEX']}`
- Claude Code: `{os.environ['CLAUDE']}`
- OpenClaw: `{os.environ['OPENCLAW']}`

Authentication availability is checked by the production Adapter at runtime and is not inferred from these version probes. The binding directories and common Agent Skill format were verified deterministically against the implemented compatibility contract. Semantic Agent behavior is specified as reusable cross-Harness scenarios in `evals/cases.json`; those scenarios require the corresponding local Agent, account, model, and filesystem permissions.

## Commands

```bash
python3 -m compileall -q src tests
python3 -m unittest discover -s tests -t . -v
python3 -m llm_wiki doctor . --kind kit --strict
./scripts/acceptance-smoke.sh
./scripts/installed-smoke.sh
```
"""
Path(os.environ["ROOT"], "docs", "TEST_REPORT.md").write_text(report, encoding="utf-8")
PYREPORT

rm -rf "$ROOT/build" "$ROOT/dist" "$ROOT/src/"*.egg-info
find "$ROOT" -type d -name __pycache__ -prune -exec rm -rf {} +

printf '\nALL TESTS PASSED (%s unittest cases)\n' "$TEST_COUNT"

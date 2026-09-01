# Test Report

- Result: **PASS**
- Executed at: `2026-09-01T07:34:30Z`
- Platform: `macOS-26.6.2-arm64-arm-64bit-Mach-O`
- Python: `Python 3.13.12`
- Unit/integration tests: `80` passed
- Kit Doctor strict: PASS, 0 errors, 0 warnings
- End-to-end acceptance smoke: PASS
- Installed-package smoke in clean venv: PASS

## Tested behaviors

- Standalone Vault initialization and Obsidian JSON generation;
- UTF-8 Markdown structure and machine-discoverable Vault Profile;
- Source copy, SHA-256 registration, idempotency, missing/tampered Source detection;
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

The test container did not contain authenticated local Agent CLIs:

- Codex: `codex-cli 0.152.0`
- Claude Code: `2.1.252 (Claude Code)`
- OpenClaw: `not installed`

Therefore no live model Session was executed. The binding directories and common Agent Skill format were verified deterministically against the implemented compatibility contract. Semantic Agent behavior is specified as reusable cross-Harness scenarios in `evals/cases.json`; those scenarios require the corresponding local Agent, account, model, and filesystem permissions.

## Commands

```bash
python3 -m compileall -q src tests
python3 -m unittest discover -s tests -t . -v
python3 -m llm_wiki doctor . --kind kit --strict
./scripts/acceptance-smoke.sh
./scripts/installed-smoke.sh
```

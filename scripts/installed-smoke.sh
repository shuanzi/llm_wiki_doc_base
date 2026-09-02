#!/usr/bin/env bash
set -euo pipefail
ROOT=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
PACKAGING_PYTHON_BIN=${LLM_WIKI_PACKAGING_PYTHON:-python3}
unset PYTHONPATH
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/dist"
cp -a "$ROOT" "$TMP/source"
rm -rf "$TMP/source/build" "$TMP/source/dist" "$TMP/source/src/"*.egg-info
find "$TMP/source" -type d -name __pycache__ -prune -exec rm -rf {} +
"$PACKAGING_PYTHON_BIN" -m pip wheel --no-deps --no-build-isolation --wheel-dir "$TMP/dist" "$TMP/source" >/dev/null
WHEEL=$(find "$TMP/dist" -maxdepth 1 -name 'llm_wiki_agent_first-*.whl' -print -quit)
[[ -n "$WHEEL" ]]
"$PACKAGING_PYTHON_BIN" -m venv "$TMP/venv"
"$TMP/venv/bin/python" -m pip install --no-deps "$WHEEL" >/dev/null
"$TMP/venv/bin/python" -m pip check >/dev/null
CLI="$TMP/venv/bin/llm-wiki"
"$CLI" --version | grep -q '0.1.0'
"$CLI" init "$TMP/vault" --name "Installed Vault" >/dev/null
"$CLI" attach --vault "$TMP/vault" --workspace "$TMP/binding" --harness all >/dev/null
"$CLI" update --workspace "$TMP/binding" --json | grep -q '"already-current"'
mkdir "$TMP/drop"
printf 'ignored by default\n' > "$TMP/drop/ignored.txt"
"$CLI" watch "$TMP/drop" --workspace "$TMP/binding" --harness codex --markdown-only --settle-seconds 0 --json | grep -q '"ignored": 1'
test -f "$TMP/binding/.agents/skills/llm-wiki/scripts/register_repository.py"
"$CLI" doctor "$TMP/vault" --strict >/dev/null
"$CLI" doctor "$TMP/binding" --strict >/dev/null
"$CLI" detach --workspace "$TMP/binding" --harness all >/dev/null
"$CLI" doctor "$TMP/vault" --strict >/dev/null
printf 'installed-smoke: PASS\n'

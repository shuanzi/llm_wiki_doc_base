#!/usr/bin/env bash
set -euo pipefail
ROOT=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
unset PYTHONPATH
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$TMP/dist"
cp -a "$ROOT" "$TMP/source"
rm -rf "$TMP/source/build" "$TMP/source/dist" "$TMP/source/src/"*.egg-info
find "$TMP/source" -type d -name __pycache__ -prune -exec rm -rf {} +
python3 -m pip wheel --no-deps --no-build-isolation --wheel-dir "$TMP/dist" "$TMP/source" >/dev/null
WHEEL=$(find "$TMP/dist" -maxdepth 1 -name 'llm_wiki_agent_first-*.whl' -print -quit)
[[ -n "$WHEEL" ]]
python3 -m venv "$TMP/venv"
"$TMP/venv/bin/python" -m pip install --no-deps "$WHEEL" >/dev/null
"$TMP/venv/bin/python" -m pip check >/dev/null
CLI="$TMP/venv/bin/llm-wiki"
"$CLI" --version | grep -q '0.1.0'
"$CLI" init "$TMP/vault" --name "Installed Vault" >/dev/null
"$CLI" attach --vault "$TMP/vault" --workspace "$TMP/binding" --harness all >/dev/null
"$CLI" doctor "$TMP/vault" --strict >/dev/null
"$CLI" doctor "$TMP/binding" --strict >/dev/null
"$CLI" detach --workspace "$TMP/binding" --harness all >/dev/null
"$CLI" doctor "$TMP/vault" --strict >/dev/null
printf 'installed-smoke: PASS\n'

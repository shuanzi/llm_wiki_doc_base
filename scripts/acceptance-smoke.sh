#!/usr/bin/env bash
set -euo pipefail
ROOT=$(CDPATH= cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
CLI="$ROOT/bin/llm-wiki"
TMP=$(mktemp -d)
trap 'rm -rf "$TMP"' EXIT

VAULT="$TMP/vault"
BINDING="$TMP/binding"
SOURCE="$TMP/source.md"
printf '# Local Agent Wiki\n\nA persistent wiki accumulates synthesis across sessions.\n' > "$SOURCE"

"$CLI" init "$VAULT" --name "Acceptance Vault" --language zh-CN >/dev/null
"$CLI" register-source --vault "$VAULT" "$SOURCE" --title "Local Agent Wiki" >/dev/null
"$CLI" attach --vault "$VAULT" --workspace "$BINDING" --harness all >/dev/null
"$CLI" doctor "$VAULT" --strict >/dev/null
"$CLI" doctor "$BINDING" --strict >/dev/null
"$CLI" status --workspace "$BINDING" --json | grep -q '"openclaw"'

BEFORE=$(PYTHONPATH="$ROOT/src" python3 - "$VAULT" <<'PY'
from pathlib import Path
import sys
from llm_wiki.utils import directory_fingerprint
print(directory_fingerprint(Path(sys.argv[1])))
PY
)
"$CLI" detach --workspace "$BINDING" --harness all >/dev/null
AFTER=$(PYTHONPATH="$ROOT/src" python3 - "$VAULT" <<'PY'
from pathlib import Path
import sys
from llm_wiki.utils import directory_fingerprint
print(directory_fingerprint(Path(sys.argv[1])))
PY
)

[[ "$BEFORE" == "$AFTER" ]]
[[ ! -e "$BINDING/.llm-wiki-binding" ]]
[[ ! -e "$BINDING/vault" ]]
"$CLI" doctor "$VAULT" --strict >/dev/null
printf 'acceptance-smoke: PASS\n'

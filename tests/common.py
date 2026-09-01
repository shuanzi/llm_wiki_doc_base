from __future__ import annotations

import os
import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = PROJECT_ROOT / "src"


def cli_env() -> dict[str, str]:
    env = os.environ.copy()
    existing = env.get("PYTHONPATH")
    env["PYTHONPATH"] = str(SRC_ROOT) + (os.pathsep + existing if existing else "")
    return env


def run_cli(*args: str, check: bool = True) -> subprocess.CompletedProcess[str]:
    return subprocess.run(
        [sys.executable, "-m", "llm_wiki", *args],
        cwd=PROJECT_ROOT,
        env=cli_env(),
        text=True,
        capture_output=True,
        check=check,
    )

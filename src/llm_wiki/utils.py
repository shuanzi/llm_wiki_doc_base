from __future__ import annotations

import hashlib
import json
import os
import re
import shutil
import tempfile
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING, Any, Iterable

if TYPE_CHECKING:
    from importlib.resources.abc import Traversable
else:
    Traversable = Any

MANAGED_BEGIN = "<!-- llm-wiki:begin -->"
MANAGED_END = "<!-- llm-wiki:end -->"
WINDOWS_RESERVED_NAMES = {
    "CON",
    "PRN",
    "AUX",
    "NUL",
    *(f"COM{number}" for number in range(1, 10)),
    *(f"LPT{number}" for number in range(1, 10)),
}


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def utc_timestamp() -> str:
    return utc_now().replace(microsecond=0).isoformat().replace("+00:00", "Z")


def utc_date() -> str:
    return utc_now().date().isoformat()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def safe_name(value: str, fallback: str = "item", max_length: int = 80) -> str:
    value = unicodedata.normalize("NFC", value).strip()
    value = re.sub(r"\s+", "-", value)
    value = re.sub(r"[\\/:*?\"<>|\x00-\x1f\x7f]", "-", value)
    value = re.sub(r"[^\w.-]+", "-", value, flags=re.UNICODE)
    value = re.sub(r"-+", "-", value).strip("-. ")
    result = (value or fallback)[:max_length].rstrip("-. ")
    if result and result.split(".", 1)[0].upper() in WINDOWS_RESERVED_NAMES:
        result = ("_" + result)[:max_length].rstrip("-. ")
    return result


def yaml_string(value: str) -> str:
    return json.dumps(value, ensure_ascii=False)


def atomic_write_text(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp_name = tempfile.mkstemp(prefix=f".{path.name}.", dir=str(path.parent))
    try:
        with os.fdopen(fd, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(text)
        os.replace(tmp_name, path)
    except Exception:
        try:
            os.unlink(tmp_name)
        except FileNotFoundError:
            pass
        raise


def atomic_write_json(path: Path, payload: Any) -> None:
    atomic_write_text(path, json.dumps(payload, ensure_ascii=False, indent=2) + "\n")


def read_json(path: Path) -> Any:
    return json.loads(path.read_text(encoding="utf-8"))


def is_empty_dir(path: Path) -> bool:
    return path.is_dir() and not any(path.iterdir())


def is_relative_to(path: Path, parent: Path) -> bool:
    try:
        path.relative_to(parent)
        return True
    except ValueError:
        return False


def ensure_separate_roots(vault: Path, workspace: Path) -> None:
    vault_r = vault.resolve()
    workspace_r = workspace.resolve()
    if vault_r == workspace_r:
        raise ValueError("Vault and binding workspace must be different directories")
    if is_relative_to(workspace_r, vault_r) or is_relative_to(vault_r, workspace_r):
        raise ValueError(
            "Vault and binding workspace must not contain one another; use sibling directories"
        )


def copy_traversable(source: Traversable, destination: Path) -> None:
    if source.is_dir():
        destination.mkdir(parents=True, exist_ok=True)
        for child in source.iterdir():
            copy_traversable(child, destination / child.name)
    else:
        destination.parent.mkdir(parents=True, exist_ok=True)
        destination.write_bytes(source.read_bytes())


def iter_traversable_files(root: Traversable, prefix: str = "") -> Iterable[tuple[str, bytes]]:
    for child in sorted(root.iterdir(), key=lambda item: item.name):
        rel = f"{prefix}/{child.name}" if prefix else child.name
        if child.is_dir():
            yield from iter_traversable_files(child, rel)
        else:
            yield rel, child.read_bytes()


def directory_fingerprint(path: Path, ignore_names: set[str] | None = None) -> str:
    ignore_names = ignore_names or set()
    digest = hashlib.sha256()
    entries: list[Path] = []
    for root, directories, files in os.walk(path, followlinks=False):
        root_path = Path(root)
        entries.extend(root_path / name for name in directories if (root_path / name).is_symlink())
        entries.extend(root_path / name for name in files)
    for file_path in sorted(entries):
        relative = file_path.relative_to(path)
        if any(part in ignore_names for part in relative.parts):
            continue
        rel = relative.as_posix()
        digest.update(rel.encode("utf-8"))
        digest.update(b"\0")
        if file_path.is_symlink():
            digest.update(b"SYMLINK\0")
            digest.update(os.readlink(file_path).encode("utf-8", "surrogateescape"))
        else:
            digest.update(file_path.read_bytes())
        digest.update(b"\0")
    return digest.hexdigest()


def traversable_fingerprint(root: Traversable, ignore_names: set[str] | None = None) -> str:
    ignore_names = ignore_names or set()
    digest = hashlib.sha256()
    for rel, content in iter_traversable_files(root):
        if any(part in ignore_names for part in Path(rel).parts):
            continue
        digest.update(rel.encode("utf-8"))
        digest.update(b"\0")
        digest.update(content)
        digest.update(b"\0")
    return digest.hexdigest()


def render_managed_block(existing: str, body: str | None) -> str | None:
    begin_count = existing.count(MANAGED_BEGIN)
    end_count = existing.count(MANAGED_END)
    if begin_count != end_count:
        raise ValueError("Malformed llm-wiki managed block")
    block_pattern = re.compile(
        rf"{re.escape(MANAGED_BEGIN)}.*?{re.escape(MANAGED_END)}",
        re.DOTALL,
    )
    if body is None:
        matches = list(block_pattern.finditer(existing))
        if len(matches) == 1:
            trailing = existing[matches[0].end() :]
            if trailing in {"", "\n", "\r\n"}:
                prefix = existing[: matches[0].start()]
                if prefix.endswith("\r\n"):
                    prefix = prefix[:-2]
                elif prefix.endswith("\n"):
                    prefix = prefix[:-1]
                return prefix or None
        rendered = block_pattern.sub("", existing)
        return rendered if rendered else None

    managed = f"{MANAGED_BEGIN}\n{body.rstrip()}\n{MANAGED_END}"
    if block_pattern.search(existing):
        return block_pattern.sub(managed, existing)
    return f"{existing}\n{managed}\n" if existing else managed + "\n"


def update_managed_block(path: Path, body: str | None) -> None:
    existing = path.read_text(encoding="utf-8") if path.exists() else ""
    try:
        rendered = render_managed_block(existing, body)
    except ValueError as exc:
        raise ValueError(f"Malformed llm-wiki managed block in {path}") from exc
    if rendered is None:
        if path.exists():
            path.unlink()
        return
    if rendered != existing:
        atomic_write_text(path, rendered)


def contains_managed_block(path: Path) -> bool:
    if not path.exists():
        return False
    try:
        text = path.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError):
        return False
    return (
        text.count(MANAGED_BEGIN) == 1
        and text.count(MANAGED_END) == 1
        and text.index(MANAGED_BEGIN) < text.index(MANAGED_END)
    )


def remove_tree_or_link(path: Path) -> None:
    if path.is_symlink() or path.is_file():
        path.unlink()
    elif path.is_dir():
        shutil.rmtree(path)


def parse_frontmatter(text: str) -> dict[str, str]:
    """Parse the intentionally simple scalar YAML frontmatter used by this kit."""
    lines = text.splitlines()
    if not lines or lines[0].strip() != "---":
        return {}
    result: dict[str, str] = {}
    for line in lines[1:]:
        if line.strip() == "---":
            return result
        if not line.strip() or line.lstrip().startswith("#") or ":" not in line:
            continue
        key, raw = line.split(":", 1)
        key = key.strip()
        raw = raw.strip()
        if raw.startswith('"') and raw.endswith('"'):
            try:
                value = json.loads(raw)
            except json.JSONDecodeError:
                value = raw[1:-1]
        else:
            value = raw
        result[key] = str(value)
    return {}

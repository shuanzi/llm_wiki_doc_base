from __future__ import annotations

import mimetypes
import os
import re
import shutil
import tempfile
import uuid
from importlib import resources
from pathlib import Path

from .models import OperationResult
from .utils import (
    atomic_write_json,
    atomic_write_text,
    copy_traversable,
    is_empty_dir,
    is_relative_to,
    parse_frontmatter,
    safe_name,
    sha256_file,
    utc_date,
    utc_timestamp,
    yaml_string,
)

VAULT_SCHEMA_VERSION = 1
REQUIRED_VAULT_PATHS = (
    "VAULT.md",
    "profile/vault.json",
    "profile/VAULT_PROFILE.md",
    "profile/CONVENTIONS.md",
    "profile/PERSISTENCE_POLICY.md",
    "sources/README.md",
    "sources/inbox",
    "sources/library",
    "sources/assets",
    "wiki/INDEX.md",
    "wiki/OVERVIEW.md",
    "wiki/maps/Knowledge Map.md",
    "wiki/sources",
    "wiki/concepts",
    "wiki/entities",
    "wiki/analyses",
    "wiki/questions",
    "wiki/decisions",
    "wiki/_templates",
    "evidence/README.md",
    "logs/operations.md",
)


def _vault_template_root():
    return resources.files("llm_wiki.resources").joinpath("vault")


def _render_tree(root: Path, substitutions: dict[str, str]) -> None:
    for path in root.rglob("*"):
        if not path.is_file():
            continue
        try:
            text = path.read_text(encoding="utf-8")
        except UnicodeDecodeError:
            continue
        for key, value in substitutions.items():
            text = text.replace("{{" + key + "}}", value)
        atomic_write_text(path, text)


def _populate_vault(path: Path, name: str, language: str) -> tuple[str, str]:
    copy_traversable(_vault_template_root(), path)
    # Package formats may omit empty/hidden paths, so create structural directories
    # and minimal Obsidian JSON deterministically after copying templates.
    for relative in REQUIRED_VAULT_PATHS:
        target = path / relative
        if Path(relative).suffix:
            continue
        target.mkdir(parents=True, exist_ok=True)
    obsidian = path / ".obsidian"
    obsidian.mkdir(parents=True, exist_ok=True)
    atomic_write_json(
        obsidian / "app.json",
        {
            "newFileLocation": "folder",
            "newFileFolderPath": "sources/inbox",
            "attachmentFolderPath": "sources/assets",
            "useMarkdownLinks": True,
            "alwaysUpdateLinks": True,
        },
    )
    atomic_write_json(obsidian / "templates.json", {"folder": "wiki/_templates"})
    atomic_write_json(
        obsidian / "core-plugins.json",
        [
            "file-explorer",
            "global-search",
            "backlink",
            "outgoing-link",
            "tag-pane",
            "page-preview",
            "templates",
            "graph",
        ],
    )
    vault_id = str(uuid.uuid4())
    created_at = utc_timestamp()
    substitutions = {
        "VAULT_NAME": name,
        "VAULT_NAME_YAML": yaml_string(name),
        "VAULT_ID": vault_id,
        "LANGUAGE": language,
        "CREATED_AT": created_at,
        "CREATED_DATE": utc_date(),
    }
    _render_tree(path, substitutions)
    atomic_write_json(
        path / "profile" / "vault.json",
        {
            "schema_version": VAULT_SCHEMA_VERSION,
            "vault_id": vault_id,
            "name": name,
            "language": language,
            "created_at": created_at,
            "knowledge_root": ".",
            "entrypoint": "VAULT.md",
        },
    )
    return vault_id, created_at


def init_vault(path: Path, name: str, language: str = "zh-CN") -> OperationResult:
    path = path.expanduser().absolute()
    if path.is_symlink():
        raise FileExistsError(f"Target directory must not be a symlink: {path}")
    if path.exists() and not is_empty_dir(path):
        raise FileExistsError(f"Target directory is not empty: {path}")
    if not name.strip():
        raise ValueError("Vault name must not be empty")
    if not language.strip():
        raise ValueError("Vault language must not be empty")

    path.parent.mkdir(parents=True, exist_ok=True)
    stage = Path(
        tempfile.mkdtemp(
            prefix=f".{safe_name(path.name, fallback='vault')}.llm-wiki-init-",
            dir=str(path.parent),
        )
    )
    target_was_empty = path.exists()
    try:
        vault_id, _ = _populate_vault(stage, name.strip(), language.strip())
        if path.exists():
            if path.is_symlink() or not is_empty_dir(path):
                raise FileExistsError(f"Target directory changed during initialization: {path}")
            path.rmdir()
        try:
            os.replace(stage, path)
        except Exception:
            if target_was_empty and not path.exists():
                path.mkdir(parents=False, exist_ok=True)
            raise
    finally:
        if stage.exists():
            shutil.rmtree(stage)

    return OperationResult(
        action="init",
        path=path,
        details={
            "vault_id": vault_id,
            "name": name.strip(),
            "language": language.strip(),
            "entrypoint": str(path / "VAULT.md"),
        },
    )


def _find_source_record_by_hash(vault: Path, digest: str) -> Path | None:
    records = vault / "wiki" / "sources"
    if not records.exists():
        return None
    for record in records.glob("*.md"):
        try:
            metadata = parse_frontmatter(record.read_text(encoding="utf-8"))
        except (UnicodeDecodeError, OSError):
            continue
        if metadata.get("type") == "source" and metadata.get("sha256") == digest:
            return record
    return None


def _validate_existing_registration(vault: Path, record: Path, digest: str) -> Path:
    try:
        metadata = parse_frontmatter(record.read_text(encoding="utf-8"))
    except (UnicodeDecodeError, OSError) as exc:
        raise RuntimeError(f"Existing Source Record is unreadable: {record}: {exc}") from exc
    relative = metadata.get("source_path")
    if not relative:
        raise RuntimeError(f"Existing Source Record lacks source_path: {record}")
    relative_path = Path(relative)
    if relative_path.is_absolute():
        raise RuntimeError(f"Existing Source Record is not portable (absolute path): {record}")
    registered_file = (vault / relative_path).resolve()
    if not is_relative_to(registered_file, vault):
        raise RuntimeError(f"Existing Source Record escapes the Vault: {record}")
    if not registered_file.is_file():
        raise RuntimeError(
            f"Existing Source Record points to a missing file; run doctor before retrying: {record}"
        )
    if sha256_file(registered_file) != digest:
        raise RuntimeError(
            f"Existing Source Record points to changed content; run doctor before retrying: {record}"
        )
    return registered_file


def _portable_extension(source: Path) -> str:
    suffix = safe_name(source.suffix.lstrip("."), fallback="", max_length=16).lower()
    return f".{suffix}" if suffix else ""


def register_source(
    vault: Path,
    source: Path,
    title: str | None = None,
) -> OperationResult:
    vault = vault.expanduser().resolve()
    source = source.expanduser().resolve()
    if not (vault / "profile" / "vault.json").is_file():
        raise ValueError(f"Not an llm-wiki vault: {vault}")
    if not source.is_file():
        raise FileNotFoundError(f"Source file not found: {source}")

    digest = sha256_file(source)
    existing_record = _find_source_record_by_hash(vault, digest)
    if existing_record:
        registered_file = _validate_existing_registration(vault, existing_record, digest)
        return OperationResult(
            action="register-source",
            path=existing_record,
            details={
                "status": "already-registered",
                "sha256": digest,
                "registered_file": str(registered_file),
                "record": str(existing_record),
            },
        )

    source_id = f"src-{digest[:12]}"
    raw_title = title if title is not None else source.stem
    display_title = re.sub(r"[\x00-\x1f\x7f]+", " ", raw_title).strip() or source.stem
    stem = safe_name(source.stem, fallback=source_id)
    extension = _portable_extension(source)
    relative_asset = (
        Path("sources")
        / "library"
        / utc_date()[:4]
        / f"{stem}--{digest[:8]}{extension}"
    )
    destination = vault / relative_asset
    resolved_destination = destination.resolve()
    if not is_relative_to(resolved_destination, vault):
        raise RuntimeError(f"Registered source destination escapes the Vault: {destination}")
    if destination.is_symlink():
        raise FileExistsError(f"Refusing to replace a source symlink: {destination}")
    if destination.exists() and sha256_file(destination) != digest:
        raise FileExistsError(f"Refusing to overwrite a different registered source: {destination}")

    media_type = mimetypes.guess_type(destination.name)[0] or "application/octet-stream"
    timestamp = utc_timestamp()
    record = vault / "wiki" / "sources" / f"{source_id}.md"
    resolved_record = record.resolve()
    if not is_relative_to(resolved_record, vault):
        raise RuntimeError(f"Source Record destination escapes the Vault: {record}")
    if record.exists():
        raise RuntimeError(
            f"Source ID collision or inconsistent existing Source Record; run doctor: {record}"
        )
    record_text = f"""---
title: {yaml_string(display_title)}
type: source
status: registered
source_id: {source_id}
created: {timestamp}
updated: {timestamp}
source_path: {relative_asset.as_posix()}
sha256: {digest}
media_type: {media_type}
---

# {display_title}

## Source

- Registered file: [`{relative_asset.as_posix()}`](../../{relative_asset.as_posix()})
- Source ID: `{source_id}`
- SHA-256: `{digest}`
- Media type: `{media_type}`

## Ingest status

Registered but not yet semantically ingested. An Agent should read the source, update relevant wiki pages, add provenance links, and change `status` only after the ingest closure conditions are met.

## Agent notes

_Add source-specific takeaways, limitations, and affected pages here._
"""
    log_path = vault / "logs" / "operations.md"
    resolved_log = log_path.resolve()
    if not is_relative_to(resolved_log, vault):
        raise RuntimeError(f"Operations log escapes the Vault: {log_path}")
    log_text = log_path.read_text(encoding="utf-8").rstrip()
    log_entry = f"""

## [{timestamp}] source-register | {display_title}

- Source ID: `{source_id}`
- Registered file: `{relative_asset.as_posix()}`
- SHA-256: `{digest}`
- Result: registered; semantic ingest pending
"""
    destination_parent_existed = destination.parent.exists()
    destination_created = False
    record_created = False
    try:
        destination.parent.mkdir(parents=True, exist_ok=True)
        if not destination.exists():
            temporary = destination.with_name(f".{destination.name}.{uuid.uuid4().hex}.tmp")
            try:
                shutil.copy2(source, temporary)
                if sha256_file(temporary) != digest:
                    raise RuntimeError(f"Source copy verification failed: {source}")
                os.replace(temporary, destination)
                destination_created = True
            finally:
                if temporary.exists():
                    temporary.unlink()

        atomic_write_text(record, record_text)
        record_created = True
        atomic_write_text(log_path, log_text + log_entry + "\n")
    except Exception:
        if record_created and record.exists():
            record.unlink()
        if destination_created and destination.exists():
            destination.unlink()
        if not destination_parent_existed and destination.parent.exists():
            try:
                destination.parent.rmdir()
            except OSError:
                pass
        raise

    return OperationResult(
        action="register-source",
        path=record,
        details={
            "status": "registered",
            "source_id": source_id,
            "sha256": digest,
            "registered_file": str(destination),
            "record": str(record),
        },
    )

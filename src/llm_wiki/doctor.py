from __future__ import annotations

import json
import re
from pathlib import Path
from typing import Iterator
from urllib.parse import unquote, urlsplit

from .binding import (
    ALL_HARNESSES,
    BINDING_DIR,
    BINDING_SCHEMA_VERSION,
    INSTRUCTION_FILES,
    MARKER_FILE,
    SKILL_FINGERPRINT_IGNORE,
    SKILL_TARGETS,
    canonical_skill_fingerprint,
    canonical_skill_root,
    load_binding,
)
from .models import Finding
from .utils import (
    contains_managed_block,
    directory_fingerprint,
    is_relative_to,
    parse_frontmatter,
    read_json,
    sha256_file,
)
from .vault import (
    REQUIRED_VAULT_FILES,
    REQUIRED_VAULT_PATHS,
    UNTRUSTED_VAULT_INTAKE_ROOTS,
    VAULT_SCHEMA_VERSION,
    is_untrusted_vault_intake_path,
)

FORBIDDEN_VAULT_ROOTS = (
    ".agents",
    ".claude",
    "skills",
    "AGENTS.md",
    "CLAUDE.md",
    BINDING_DIR,
    "runtime",
)
REQUIRED_SKILL_REFS = (
    "wiki-contract.md",
    "workflows.md",
    "page-model.md",
    "provenance.md",
    "change-policy.md",
    "harness-boundaries.md",
    "obsidian.md",
    "repository-ingest.md",
)
SHA256_PATTERN = re.compile(r"^[0-9a-f]{64}$")
LOCAL_LINK_START_PATTERN = re.compile(r"!?\[[^\]\n]*\]\(")


def _finding(level: str, code: str, message: str, path: Path | None = None) -> Finding:
    return Finding(level=level, code=code, message=message, path=str(path) if path else None)  # type: ignore[arg-type]


def validate_skill_dir(path: Path, compare_canonical: bool = False) -> list[Finding]:
    findings: list[Finding] = []
    skill_file = path / "SKILL.md"
    if not skill_file.is_file():
        return [_finding("error", "skill.missing", "SKILL.md is missing", skill_file)]
    try:
        text = skill_file.read_text(encoding="utf-8")
    except (UnicodeDecodeError, OSError) as exc:
        return [_finding("error", "skill.encoding", f"SKILL.md is unreadable as UTF-8: {exc}", skill_file)]
    frontmatter = parse_frontmatter(text)
    if frontmatter.get("name") != "llm-wiki":
        findings.append(
            _finding("error", "skill.name", "Skill frontmatter name must be llm-wiki", skill_file)
        )
    if not frontmatter.get("description"):
        findings.append(
            _finding("error", "skill.description", "Skill description is missing", skill_file)
        )
    for ref in REQUIRED_SKILL_REFS:
        ref_path = path / "references" / ref
        if not ref_path.is_file():
            findings.append(
                _finding("error", "skill.reference-missing", f"Missing reference: {ref}", ref_path)
            )
            continue
        try:
            ref_path.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError) as exc:
            findings.append(
                _finding(
                    "error",
                    "skill.reference-encoding",
                    f"Skill reference is unreadable as UTF-8: {exc}",
                    ref_path,
                )
            )
    repository_script = path / "scripts" / "register_repository.py"
    if not repository_script.is_file():
        findings.append(
            _finding(
                "error",
                "skill.script-missing",
                "Missing repository registration script",
                repository_script,
            )
        )
    if compare_canonical and not path.is_symlink() and path.is_dir():
        expected = canonical_skill_fingerprint()
        actual = directory_fingerprint(path, SKILL_FINGERPRINT_IGNORE)
        if expected != actual:
            findings.append(
                _finding(
                    "error",
                    "skill.drift",
                    "Installed skill differs from the canonical packaged skill; re-attach it",
                    path,
                )
            )
    if not findings:
        findings.append(_finding("info", "skill.ok", "Agent Skill structure is valid", path))
    return findings


def _validate_profile(vault: Path, findings: list[Finding]) -> None:
    profile_path = vault / "profile" / "vault.json"
    if not profile_path.is_file():
        return
    try:
        profile = read_json(profile_path)
    except (json.JSONDecodeError, UnicodeDecodeError, OSError) as exc:
        findings.append(
            _finding("error", "vault.profile-json", f"Invalid profile JSON: {exc}", profile_path)
        )
        return
    if not isinstance(profile, dict):
        findings.append(
            _finding("error", "vault.profile-json", "Vault profile root must be an object", profile_path)
        )
        return
    if profile.get("schema_version") != VAULT_SCHEMA_VERSION:
        findings.append(
            _finding(
                "error",
                "vault.schema-version",
                f"Unsupported vault schema version: {profile.get('schema_version')}",
                profile_path,
            )
        )
    for key in ("vault_id", "name", "language", "entrypoint"):
        if not profile.get(key):
            findings.append(
                _finding("error", "vault.profile-field", f"Missing profile field: {key}", profile_path)
            )

    entrypoint = profile.get("entrypoint")
    if isinstance(entrypoint, str) and entrypoint:
        relative = Path(entrypoint)
        if relative.is_absolute():
            findings.append(
                _finding(
                    "error",
                    "vault.entrypoint-absolute",
                    "Vault entrypoint must be a portable relative path",
                    profile_path,
                )
            )
        else:
            target = (vault / relative).resolve()
            if not is_relative_to(target, vault):
                findings.append(
                    _finding("error", "vault.entrypoint-escape", "Vault entrypoint escapes the Vault", profile_path)
                )
            elif not target.is_file():
                findings.append(
                    _finding("error", "vault.entrypoint-missing", "Vault entrypoint is missing", target)
                )


def _read_markdown(vault: Path, findings: list[Finding]) -> dict[Path, str]:
    markdown_texts: dict[Path, str] = {}
    for markdown in vault.rglob("*.md"):
        if not markdown.is_file():
            continue
        if is_untrusted_vault_intake_path(markdown.relative_to(vault)):
            # Intake files are untrusted input, not durable Wiki content. They
            # are validated after registration into sources/library.
            continue
        try:
            markdown_texts[markdown] = markdown.read_text(encoding="utf-8")
        except (UnicodeDecodeError, OSError) as exc:
            findings.append(
                _finding("error", "vault.encoding", f"Markdown file is unreadable as UTF-8: {exc}", markdown)
            )
    return markdown_texts


def _iter_markdown_link_targets(text: str) -> Iterator[str]:
    for match in LOCAL_LINK_START_PATTERN.finditer(text):
        start = match.end()
        depth = 0
        index = start
        while index < len(text):
            character = text[index]
            if character == "\\":
                index += 2
                continue
            if character == "(":
                depth += 1
            elif character == ")":
                if depth == 0:
                    yield text[start:index]
                    break
                depth -= 1
            index += 1


def _validate_markdown_links(
    vault: Path,
    markdown_texts: dict[Path, str],
    findings: list[Finding],
) -> None:
    # Check ordinary local Markdown links. Wikilinks remain Agent/Obsidian-managed
    # because their resolution can depend on aliases and Vault settings.
    for markdown, text in markdown_texts.items():
        relative = markdown.relative_to(vault)
        if relative.parts[:2] == ("sources", "library"):
            # Registered Markdown is immutable source evidence. Its relative links
            # belong to the source's original context (for example, a repository)
            # and are not Vault navigation links.
            continue
        for raw_target in _iter_markdown_link_targets(text):
            raw_target = raw_target.strip().strip("<>")
            if not raw_target or raw_target.startswith("#"):
                continue
            split = urlsplit(raw_target)
            if split.scheme or split.netloc:
                continue
            decoded = unquote(split.path)
            if not decoded:
                continue
            target = (markdown.parent / decoded).resolve()
            if not is_relative_to(target, vault):
                findings.append(
                    _finding(
                        "error",
                        "vault.link-escape",
                        f"Local link escapes the vault: {raw_target}",
                        markdown,
                    )
                )
            elif not target.exists():
                findings.append(
                    _finding(
                        "error",
                        "vault.link-broken",
                        f"Broken local Markdown link: {raw_target}",
                        markdown,
                    )
                )


def _validate_obsidian(vault: Path, findings: list[Finding]) -> None:
    obsidian = vault / ".obsidian"
    if not obsidian.exists():
        findings.append(
            _finding(
                "warning",
                "vault.obsidian-config-missing",
                "No .obsidian configuration found; Markdown remains compatible",
                obsidian,
            )
        )
        return
    for config in obsidian.glob("*.json"):
        try:
            read_json(config)
        except (json.JSONDecodeError, UnicodeDecodeError, OSError) as exc:
            findings.append(
                _finding("error", "vault.obsidian-json", f"Invalid Obsidian JSON: {exc}", config)
            )


def _validate_operation_log(
    vault: Path,
    markdown_texts: dict[Path, str],
    findings: list[Finding],
) -> None:
    log_path = vault / "logs" / "operations.md"
    text = markdown_texts.get(log_path)
    if text is None:
        return
    for number, line in enumerate(text.splitlines(), start=1):
        if line.startswith("## ") and not re.match(r"^## \[[^]]+\] [a-z0-9-]+ \| .+", line):
            findings.append(
                _finding(
                    "warning",
                    "vault.log-heading",
                    f"Non-standard operation log heading on line {number}",
                    log_path,
                )
            )


def _validate_source_records(
    vault: Path,
    markdown_texts: dict[Path, str],
    findings: list[Finding],
) -> None:
    records_dir = vault / "wiki" / "sources"
    if not records_dir.is_dir():
        return
    seen_hashes: dict[str, Path] = {}
    seen_ids: dict[str, Path] = {}
    seen_repository_identities: dict[str, Path] = {}
    for record in records_dir.glob("*.md"):
        text = markdown_texts.get(record)
        if text is None:
            continue
        metadata = parse_frontmatter(text)
        if metadata.get("type") != "source":
            findings.append(
                _finding("warning", "source.record-type", "Source record lacks type: source", record)
            )
            continue
        relative = metadata.get("source_path")
        digest = metadata.get("sha256")
        source_id = metadata.get("source_id")
        if metadata.get("source_kind") == "repository":
            required_repository = (
                "repository_identity",
                "repository_url",
                "repository_name",
                "readme_path",
            )
            missing_repository = [
                field for field in required_repository if not metadata.get(field)
            ]
            if missing_repository:
                findings.append(
                    _finding(
                        "error",
                        "source.repository-metadata",
                        "Repository Source Record lacks: " + ", ".join(missing_repository),
                        record,
                    )
                )
            identity = metadata.get("repository_identity")
            if identity:
                if identity in seen_repository_identities:
                    findings.append(
                        _finding(
                            "error",
                            "source.repository-identity-duplicate",
                            f"Repository identity also appears in {seen_repository_identities[identity]}",
                            record,
                        )
                    )
                else:
                    seen_repository_identities[identity] = record
        if not relative or not digest:
            findings.append(
                _finding("error", "source.metadata", "Source record lacks source_path or sha256", record)
            )
            continue
        digest_valid = bool(SHA256_PATTERN.fullmatch(digest))
        if not digest_valid:
            findings.append(
                _finding("error", "source.sha256-format", "Source sha256 must be 64 lowercase hex characters", record)
            )
        if digest in seen_hashes:
            findings.append(
                _finding(
                    "warning",
                    "source.duplicate-hash",
                    f"Duplicate Source Records share a hash with {seen_hashes[digest]}",
                    record,
                )
            )
        else:
            seen_hashes[digest] = record
        if source_id:
            if source_id in seen_ids:
                findings.append(
                    _finding(
                        "error",
                        "source.duplicate-id",
                        f"Duplicate source_id also appears in {seen_ids[source_id]}",
                        record,
                    )
                )
            else:
                seen_ids[source_id] = record

        relative_path = Path(relative)
        if relative_path.is_absolute():
            findings.append(
                _finding(
                    "error",
                    "source.path-absolute",
                    "Source path must be relative for Vault portability",
                    record,
                )
            )
            continue
        if relative_path.parts[:2] != ("sources", "library"):
            findings.append(
                _finding(
                    "error",
                    "source.path-location",
                    "Registered source must be stored under sources/library",
                    record,
                )
            )
        source_file = (vault / relative_path).resolve()
        if not is_relative_to(source_file, vault):
            findings.append(
                _finding("error", "source.path-escape", "Source path escapes the vault", record)
            )
            continue
        if not source_file.is_file():
            findings.append(
                _finding("error", "source.file-missing", "Registered source file is missing", source_file)
            )
            continue
        try:
            actual = sha256_file(source_file)
        except OSError as exc:
            findings.append(
                _finding("error", "source.file-unreadable", f"Registered source is unreadable: {exc}", source_file)
            )
            continue
        if digest_valid and actual != digest:
            findings.append(
                _finding(
                    "error",
                    "source.hash-mismatch",
                    "Registered source changed after registration",
                    source_file,
                )
            )


def validate_vault(vault: Path) -> list[Finding]:
    vault = vault.expanduser().resolve()
    findings: list[Finding] = []
    if not vault.is_dir():
        return [_finding("error", "vault.missing", "Vault directory does not exist", vault)]

    for relative in REQUIRED_VAULT_PATHS:
        target = vault / relative
        if not target.exists():
            findings.append(
                _finding("error", "vault.required-missing", f"Required path is missing: {relative}", target)
            )
            continue
        resolved = target.resolve()
        if not is_relative_to(resolved, vault):
            findings.append(
                _finding("error", "vault.required-escape", f"Required path escapes the Vault: {relative}", target)
            )
            continue
        expected = "file" if relative in REQUIRED_VAULT_FILES else "directory"
        valid_type = target.is_file() if relative in REQUIRED_VAULT_FILES else target.is_dir()
        if not valid_type:
            findings.append(
                _finding(
                    "error",
                    "vault.required-type",
                    f"Required path must be a {expected}: {relative}",
                    target,
                )
            )

    for relative in UNTRUSTED_VAULT_INTAKE_ROOTS:
        target = vault / relative
        if not target.exists() and not target.is_symlink():
            continue
        if target.is_symlink() or not target.is_dir():
            findings.append(
                _finding(
                    "error",
                    "vault.intake-root-type",
                    f"Intake root must be a real directory: {relative}",
                    target,
                )
            )

    _validate_profile(vault, findings)

    for name in FORBIDDEN_VAULT_ROOTS:
        target = vault / name
        if target.exists() or target.is_symlink():
            findings.append(
                _finding(
                    "error",
                    "vault.harness-leak",
                    f"Harness/runtime artifact must stay outside the durable vault: {name}",
                    target,
                )
            )

    markdown_texts = _read_markdown(vault, findings)
    for markdown, text in markdown_texts.items():
        if re.search(r"\{\{(?:VAULT_|LANGUAGE|CREATED_)[A-Z_]*\}\}", text):
            findings.append(
                _finding("error", "vault.template-placeholder", "Unresolved Vault template placeholder", markdown)
            )
    _validate_markdown_links(vault, markdown_texts, findings)
    _validate_obsidian(vault, findings)
    _validate_operation_log(vault, markdown_texts, findings)
    _validate_source_records(vault, markdown_texts, findings)

    if not any(item.level == "error" for item in findings):
        findings.append(_finding("info", "vault.ok", "Durable vault invariants are valid", vault))
    return findings


def _validate_copy_marker(target: Path, findings: list[Finding]) -> None:
    marker = target / MARKER_FILE
    if not marker.is_file():
        findings.append(
            _finding("error", "binding.skill-marker", "Managed copied Skill marker is missing", marker)
        )
        return
    try:
        payload = read_json(marker)
    except (json.JSONDecodeError, UnicodeDecodeError, OSError) as exc:
        findings.append(
            _finding("error", "binding.skill-marker", f"Managed Skill marker is invalid: {exc}", marker)
        )
        return
    if not isinstance(payload, dict) or payload.get("managed_by") != "llm-wiki":
        findings.append(
            _finding("error", "binding.skill-marker", "Skill marker is not owned by llm-wiki", marker)
        )
        return
    fingerprint = payload.get("skill_fingerprint")
    if fingerprint is not None:
        actual = directory_fingerprint(target, SKILL_FINGERPRINT_IGNORE)
        if not isinstance(fingerprint, str) or not SHA256_PATTERN.fullmatch(fingerprint):
            findings.append(
                _finding("error", "binding.skill-fingerprint", "Skill marker fingerprint is invalid", marker)
            )
        elif fingerprint != actual:
            findings.append(
                _finding(
                    "error",
                    "binding.skill-local-drift",
                    "Managed Skill differs from its recorded fingerprint",
                    target,
                )
            )


def validate_binding(workspace: Path) -> list[Finding]:
    workspace = workspace.expanduser().resolve()
    findings: list[Finding] = []
    try:
        binding = load_binding(workspace)
    except ValueError as exc:
        return [_finding("error", "binding.metadata-json", str(exc), workspace / BINDING_DIR / "binding.json")]
    if not binding:
        return [_finding("error", "binding.missing", "Binding metadata is missing", workspace)]

    if binding.get("schema_version") != BINDING_SCHEMA_VERSION:
        findings.append(
            _finding(
                "error",
                "binding.schema-version",
                f"Unsupported binding schema version: {binding.get('schema_version')}",
                workspace / BINDING_DIR / "binding.json",
            )
        )
    if not isinstance(binding.get("kit_version"), str) or not binding.get("kit_version"):
        findings.append(
            _finding("error", "binding.kit-version", "Binding kit_version is missing", workspace)
        )

    vault: Path | None = None
    vault_raw = binding.get("vault_path")
    if not isinstance(vault_raw, str) or not vault_raw:
        findings.append(
            _finding("error", "binding.vault-path", "Bound vault_path is missing", workspace)
        )
    else:
        candidate = Path(vault_raw).expanduser()
        if not candidate.is_absolute():
            findings.append(
                _finding("error", "binding.vault-path", "Bound vault_path must be absolute", workspace)
            )
        else:
            vault = candidate
            if not vault.is_dir():
                findings.append(
                    _finding("error", "binding.vault-missing", "Bound vault path does not exist", vault)
                )
            else:
                vault_r = vault.resolve()
                if vault_r == workspace or is_relative_to(vault_r, workspace) or is_relative_to(workspace, vault_r):
                    findings.append(
                        _finding(
                            "error",
                            "binding.separation",
                            "Vault and binding workspace are not independent sibling roots",
                            workspace,
                        )
                    )
                findings.extend(validate_vault(vault_r))

    active = binding.get("harnesses")
    if not isinstance(active, list) or not active:
        findings.append(
            _finding("error", "binding.harnesses", "No active harnesses are recorded", workspace)
        )
        active_list: list[str] = []
    else:
        active_list = [item for item in active if isinstance(item, str)]
        if len(active_list) != len(active):
            findings.append(
                _finding("error", "binding.harnesses", "Harness names must be strings", workspace)
            )
        if len(set(active_list)) != len(active_list):
            findings.append(
                _finding("error", "binding.harnesses", "Harness list contains duplicates", workspace)
            )

    skill_mode = binding.get("skill_mode")
    if skill_mode not in ("copy", "symlink"):
        findings.append(
            _finding("error", "binding.skill-mode", f"Unknown skill mode: {skill_mode}", workspace)
        )

    checked_instruction_paths: set[Path] = set()
    for harness in active_list:
        if harness not in ALL_HARNESSES:
            findings.append(
                _finding("error", "binding.harness-unknown", f"Unknown harness: {harness}", workspace)
            )
            continue
        target = workspace / SKILL_TARGETS[harness]
        if skill_mode == "copy":
            if target.is_symlink():
                findings.append(
                    _finding("error", "binding.skill-mode-mismatch", "Expected a copied Skill, found symlink", target)
                )
            else:
                _validate_copy_marker(target, findings)
        elif skill_mode == "symlink" and not target.is_symlink():
            findings.append(
                _finding("error", "binding.skill-mode-mismatch", "Expected a Skill symlink", target)
            )
        elif skill_mode == "symlink" and target.resolve(strict=False) != Path(canonical_skill_root()).resolve():
            findings.append(
                _finding(
                    "error",
                    "binding.skill-link-target",
                    "Managed Skill symlink does not point to this Kit's canonical Skill",
                    target,
                )
            )
        findings.extend(validate_skill_dir(target, compare_canonical=True))

        instructions = workspace / INSTRUCTION_FILES[harness]
        if instructions not in checked_instruction_paths:
            checked_instruction_paths.add(instructions)
            if not contains_managed_block(instructions):
                findings.append(
                    _finding(
                        "error",
                        "binding.instructions",
                        f"Managed instructions missing for {harness}",
                        instructions,
                    )
                )

    for generated in (workspace / "BINDING.md", workspace / ".gitignore"):
        if not contains_managed_block(generated):
            findings.append(
                _finding("error", "binding.generated-doc", "Managed Binding document block is missing", generated)
            )

    mode = binding.get("vault_mode")
    reference = binding.get("vault_reference")
    mount = workspace / "vault"
    if mode == "symlink":
        if not mount.is_symlink():
            findings.append(
                _finding("error", "binding.vault-link", "Managed vault symlink is missing", mount)
            )
        elif vault is not None and vault.is_dir() and mount.resolve() != vault.resolve():
            findings.append(
                _finding("error", "binding.vault-link-target", "Vault symlink points elsewhere", mount)
            )
        if reference != "vault":
            findings.append(
                _finding("error", "binding.reference", "Symlink mode must use vault reference", workspace)
            )
    elif mode == "pointer":
        if vault is not None and reference != str(vault):
            findings.append(
                _finding("error", "binding.reference", "Pointer reference differs from vault path", workspace)
            )
        if mount.exists() or mount.is_symlink():
            findings.append(
                _finding("error", "binding.pointer-conflict", "Pointer mode must not have a workspace vault alias", mount)
            )
    else:
        findings.append(
            _finding("error", "binding.vault-mode", f"Unknown vault mode: {mode}", workspace)
        )

    runtime = workspace / BINDING_DIR / "runtime"
    if not runtime.is_dir():
        findings.append(
            _finding("error", "binding.runtime", "Disposable runtime sidecar is missing", runtime)
        )

    if not any(item.level == "error" for item in findings):
        findings.append(_finding("info", "binding.ok", "Binding workspace is valid", workspace))
    return findings


def validate_kit(root: Path) -> list[Finding]:
    root = root.expanduser().resolve()
    findings = validate_skill_dir(root / "skills" / "llm-wiki")
    packaged = canonical_skill_fingerprint()
    visible_path = root / "skills" / "llm-wiki"
    if visible_path.is_dir():
        visible = directory_fingerprint(visible_path, SKILL_FINGERPRINT_IGNORE)
        if packaged != visible:
            findings.append(
                _finding(
                    "error",
                    "kit.skill-copy-drift",
                    "Top-level skill copy differs from packaged canonical skill",
                    visible_path,
                )
            )
    for path in (
        "README.md",
        "pyproject.toml",
        "docs/ARCHITECTURE.md",
        "docs/WATCHER.md",
        "scripts/run-tests.sh",
        "evals/cases.json",
    ):
        target = root / path
        if not target.exists():
            findings.append(_finding("error", "kit.required-missing", f"Missing kit file: {path}", target))

    eval_path = root / "evals" / "cases.json"
    if eval_path.is_file():
        try:
            cases = read_json(eval_path)
            if not isinstance(cases, list) or not cases:
                raise ValueError("root must be a non-empty list")
            for case in cases:
                if not isinstance(case, dict):
                    raise ValueError("each eval case must be an object")
                for key in ("id", "capability", "prompt", "observable_acceptance", "forbidden"):
                    if not case.get(key):
                        raise ValueError(f"eval case is missing {key}")
        except (json.JSONDecodeError, UnicodeDecodeError, OSError, ValueError) as exc:
            findings.append(
                _finding("error", "kit.eval-schema", f"Invalid cross-Harness Eval schema: {exc}", eval_path)
            )

    demo = root / "examples" / "demo-vault"
    if demo.is_dir():
        demo_errors = [item for item in validate_vault(demo) if item.level == "error"]
        for item in demo_errors:
            findings.append(
                _finding("error", "kit.demo-vault", f"Demo Vault: {item.message}", Path(item.path) if item.path else demo)
            )
    else:
        findings.append(_finding("error", "kit.demo-missing", "Demo Vault is missing", demo))

    if not any(item.level == "error" for item in findings):
        findings.append(_finding("info", "kit.ok", "Kit structure is valid", root))
    return findings


def detect_kind(path: Path) -> str:
    path = path.expanduser().resolve()
    if (path / BINDING_DIR / "binding.json").is_file():
        return "binding"
    if (path / "profile" / "vault.json").is_file():
        return "vault"
    if (path / "pyproject.toml").is_file() and (path / "skills" / "llm-wiki" / "SKILL.md").is_file():
        return "kit"
    return "unknown"


def run_doctor(path: Path, kind: str = "auto") -> list[Finding]:
    resolved_kind = detect_kind(path) if kind == "auto" else kind
    if resolved_kind == "vault":
        return validate_vault(path)
    if resolved_kind == "binding":
        return validate_binding(path)
    if resolved_kind == "kit":
        return validate_kit(path)
    return [_finding("error", "doctor.unknown", "Could not identify target as vault, binding, or kit", path)]

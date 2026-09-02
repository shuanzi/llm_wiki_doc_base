from __future__ import annotations

import json
import re
from dataclasses import dataclass
from pathlib import Path
from typing import Mapping
from urllib.parse import unquote, urlsplit

from .utils import is_relative_to, parse_frontmatter


@dataclass(frozen=True, order=True)
class SourceRelation:
    source_record: Path
    consumer_page: Path


@dataclass(frozen=True)
class RelationProblem:
    level: str
    code: str
    message: str
    path: Path


@dataclass(frozen=True)
class SourceRelationReport:
    forward: frozenset[SourceRelation]
    reverse: frozenset[SourceRelation]
    missing: frozenset[SourceRelation]
    stale: frozenset[SourceRelation]
    problems: tuple[RelationProblem, ...]


_AFFECTED_HEADING = "## Affected pages"
_AFFECTED_LINK = re.compile(r"^[ \t]*-[ \t]+\[[^\]\n]*\]\((.*)\)[ \t]*$")
_LOCAL_LINK_START = re.compile(r"!?\[[^\]\n]*\]\(")
_NAVIGATION_BODY_EXEMPT = (
    Path("wiki/INDEX.md"),
    Path("wiki/maps/Knowledge Map.md"),
)


def _relative_label(path: Path, vault: Path) -> str:
    try:
        return path.relative_to(vault).as_posix()
    except ValueError:
        return str(path)


def _frontmatter_parts(text: str) -> tuple[list[str], str]:
    lines = text.splitlines(keepends=True)
    if not lines or lines[0].strip() != "---":
        return [], text
    for index, line in enumerate(lines[1:], start=1):
        if line.strip() == "---":
            return [item.rstrip("\r\n") for item in lines[1:index]], "".join(
                lines[index + 1 :]
            )
    return [], text


def _decode_scalar(raw: str) -> str:
    value = raw.strip()
    if value.startswith('"') and value.endswith('"'):
        try:
            parsed = json.loads(value)
        except json.JSONDecodeError:
            return value[1:-1]
        return parsed if isinstance(parsed, str) else value
    if value.startswith("'") and value.endswith("'"):
        return value[1:-1].replace("''", "'")
    return value


def parse_sources_block(text: str) -> tuple[tuple[str, ...], tuple[str, ...]]:
    """Parse only a top-level YAML block-list named ``sources``.

    The general ``parse_frontmatter`` helper intentionally remains scalar-only.
    This parser accepts an absent or empty block and rejects inline/scalar forms
    and non-list content instead of attempting to implement YAML.
    """

    lines, _body = _frontmatter_parts(text)
    values: list[str] = []
    errors: list[str] = []
    sources_index: int | None = None
    for index, line in enumerate(lines):
        if line.startswith((" ", "\t")) or ":" not in line:
            continue
        key, raw = line.split(":", 1)
        if key.strip() != "sources":
            continue
        if sources_index is not None:
            errors.append("frontmatter contains more than one sources field")
            continue
        sources_index = index
        if raw.strip():
            errors.append("sources must use a block-list, not a scalar or inline list")

    if sources_index is None:
        return (), tuple(errors)

    for line in lines[sources_index + 1 :]:
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if line and not line.startswith((" ", "\t")):
            if ":" in line and not line.startswith("-"):
                break
            errors.append("sources block-list items must be indented")
            continue
        content = line.lstrip(" \t")
        if not content.startswith("-") or (
            len(content) > 1 and not content[1].isspace()
        ):
            errors.append("sources block may contain only list items")
            continue
        value = _decode_scalar(content[1:].strip())
        if not value:
            errors.append("sources list items must not be empty")
            continue
        values.append(value)
    return tuple(values), tuple(errors)


def _iter_markdown_link_targets(text: str):
    for match in _LOCAL_LINK_START.finditer(text):
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


def _parse_affected_pages(text: str) -> tuple[tuple[str, ...], tuple[str, ...]]:
    lines = text.splitlines()
    headings = [index for index, line in enumerate(lines) if line == _AFFECTED_HEADING]
    if not headings:
        return (), ()
    if len(headings) != 1:
        return (), ("Source Record must contain at most one exact ## Affected pages section",)
    start = headings[0] + 1
    end = len(lines)
    for index in range(start, len(lines)):
        if lines[index].startswith("## "):
            end = index
            break
    targets: list[str] = []
    errors: list[str] = []
    for line in lines[start:end]:
        if not line.strip() or line.lstrip().startswith("<!--"):
            continue
        match = _AFFECTED_LINK.fullmatch(line)
        if not match:
            errors.append("Affected pages may contain only Markdown-link list items")
            continue
        target = match.group(1).strip().strip("<>")
        if not target:
            errors.append("Affected pages links must not be empty")
            continue
        targets.append(target)
    return tuple(targets), tuple(errors)


def _resolve_local_reference(
    *,
    raw: str,
    owner: Path,
    vault: Path,
    kind: str,
    allow_url_suffix: bool = False,
) -> tuple[Path | None, RelationProblem | None]:
    split = urlsplit(raw.strip().strip("<>"))
    if split.scheme or split.netloc or (
        not allow_url_suffix and (split.query or split.fragment)
    ):
        return None, RelationProblem(
            "error",
            f"source.{kind}-invalid",
            f"Relationship reference must be a plain local path: {raw}",
            owner,
        )
    decoded = unquote(split.path)
    if not decoded or "\x00" in decoded:
        return None, RelationProblem(
            "error",
            f"source.{kind}-invalid",
            f"Relationship reference is empty or invalid: {raw}",
            owner,
        )
    relative = Path(decoded)
    if relative.is_absolute():
        return None, RelationProblem(
            "error",
            f"source.{kind}-invalid",
            f"Relationship reference must be relative: {raw}",
            owner,
        )
    target = (owner.parent / relative).resolve()
    if not is_relative_to(target, vault):
        return None, RelationProblem(
            "error",
            f"source.{kind}-escape",
            f"Relationship reference escapes the Vault: {raw}",
            owner,
        )
    return target, None


def validate_source_relations(
    vault: Path,
    markdown_texts: Mapping[Path, str] | None = None,
) -> SourceRelationReport:
    """Build canonical forward/reverse Source relationships and compare them."""

    vault = vault.expanduser().resolve()
    if markdown_texts is None:
        texts: dict[Path, str] = {}
        wiki = vault / "wiki"
        if wiki.is_dir():
            for path in sorted(wiki.rglob("*.md")):
                if path.is_file():
                    try:
                        texts[path] = path.read_text(encoding="utf-8")
                    except (OSError, UnicodeDecodeError):
                        # Doctor reports unreadable Markdown separately.
                        continue
    else:
        texts = {
            path: text
            for path, text in markdown_texts.items()
            if is_relative_to(path.resolve(), vault / "wiki")
        }

    source_records: dict[Path, Path] = {}
    ordinary_pages: dict[Path, Path] = {}
    for path, text in texts.items():
        resolved = path.resolve()
        try:
            relative = path.relative_to(vault)
        except ValueError:
            continue
        if relative.parts[:2] == ("wiki", "sources"):
            if len(relative.parts) == 3 and parse_frontmatter(text).get("type") == "source":
                source_records[resolved] = path
        elif (
            relative.parts
            and relative.parts[0] == "wiki"
            and "_templates" not in relative.parts
        ):
            ordinary_pages[resolved] = path

    forward: set[SourceRelation] = set()
    reverse: set[SourceRelation] = set()
    problems: list[RelationProblem] = []

    body_only: set[SourceRelation] = set()
    for page in sorted(ordinary_pages.values(), key=str):
        text = texts[page]
        raw_sources, parse_errors = parse_sources_block(text)
        problems.extend(
            RelationProblem("error", "source.sources-invalid", message, page)
            for message in parse_errors
        )
        for raw_source in raw_sources:
            target, problem = _resolve_local_reference(
                raw=raw_source,
                owner=page,
                vault=vault,
                kind="reference",
            )
            if problem is not None:
                problems.append(problem)
                continue
            assert target is not None
            record = source_records.get(target)
            if record is None:
                problems.append(
                    RelationProblem(
                        "error",
                        "source.reference-invalid",
                        f"sources item does not resolve to a Source Record: {raw_source}",
                        page,
                    )
                )
                continue
            forward.add(SourceRelation(record, page))

        try:
            relative_page = page.relative_to(vault)
        except ValueError:
            relative_page = Path()
        if relative_page not in _NAVIGATION_BODY_EXEMPT:
            _frontmatter, body = _frontmatter_parts(text)
            for raw_target in _iter_markdown_link_targets(body):
                target, problem = _resolve_local_reference(
                    raw=raw_target,
                    owner=page,
                    vault=vault,
                    kind="body-reference",
                    allow_url_suffix=True,
                )
                if problem is not None or target is None:
                    continue
                record = source_records.get(target)
                if record is None:
                    continue
                relation = SourceRelation(record, page)
                if relation not in forward and relation not in body_only:
                    body_only.add(relation)
                    problems.append(
                        RelationProblem(
                            "warning",
                            "source.body-only",
                            "Page links to a Source Record in its body but does not declare it "
                            f"in frontmatter.sources: {_relative_label(record, vault)}",
                            page,
                        )
                    )

    for record in sorted(source_records.values(), key=str):
        targets, parse_errors = _parse_affected_pages(texts[record])
        problems.extend(
            RelationProblem("error", "source.affected-invalid", message, record)
            for message in parse_errors
        )
        for raw_page in targets:
            target, problem = _resolve_local_reference(
                raw=raw_page,
                owner=record,
                vault=vault,
                kind="affected",
            )
            if problem is not None:
                problems.append(problem)
                continue
            assert target is not None
            page = ordinary_pages.get(target)
            if page is None:
                problems.append(
                    RelationProblem(
                        "error",
                        "source.affected-invalid",
                        f"Affected pages item does not resolve to an ordinary Wiki page: {raw_page}",
                        record,
                    )
                )
                continue
            reverse.add(SourceRelation(record, page))

    missing = forward - reverse
    stale = reverse - forward
    for relation in sorted(missing):
        problems.append(
            RelationProblem(
                "error",
                "source.reverse-missing",
                "Source Record is missing an Affected pages link for "
                f"{_relative_label(relation.consumer_page, vault)}",
                relation.consumer_page,
            )
        )
    for relation in sorted(stale):
        problems.append(
            RelationProblem(
                "error",
                "source.reverse-stale",
                "Source Record lists a page that no longer declares it in frontmatter.sources: "
                f"{_relative_label(relation.consumer_page, vault)}",
                relation.source_record,
            )
        )

    return SourceRelationReport(
        forward=frozenset(forward),
        reverse=frozenset(reverse),
        missing=frozenset(missing),
        stale=frozenset(stale),
        problems=tuple(problems),
    )


def _affected_section_span(content: bytes) -> tuple[int, int, int] | None:
    positions: list[tuple[int, int, int]] = []
    offset = 0
    lines = content.splitlines(keepends=True)
    for index, line in enumerate(lines):
        line_end = offset + len(line)
        if line.rstrip(b"\r\n") == _AFFECTED_HEADING.encode("ascii"):
            section_end = len(content)
            next_offset = line_end
            for following in lines[index + 1 :]:
                if following.rstrip(b"\r\n").startswith(b"## "):
                    section_end = next_offset
                    break
                next_offset += len(following)
            positions.append((offset, line_end, section_end))
        offset = line_end
    return positions[0] if len(positions) == 1 else None


def source_record_changed_only_in_affected_pages(before: bytes, after: bytes) -> bool:
    """Return true when all byte changes are confined to Affected pages.

    Adding or removing the exact section is supported so an older record with no
    consumers can later receive its first reverse relationship. Everything
    outside that section, including frontmatter and other body sections, must be
    byte-for-byte identical.
    """

    if before == after:
        return False
    before_span = _affected_section_span(before)
    after_span = _affected_section_span(after)
    if before_span is not None and after_span is not None:
        before_without_body = before[: before_span[1]] + before[before_span[2] :]
        after_without_body = after[: after_span[1]] + after[after_span[2] :]
        return before_without_body == after_without_body
    if before_span is None and after_span is not None:
        return after[: after_span[0]] + after[after_span[2] :] == before
    if before_span is not None and after_span is None:
        return before[: before_span[0]] + before[before_span[2] :] == after
    return False


def source_record_has_affected_pages_section(content: bytes) -> bool:
    """Return true for exactly one byte-exact Affected pages heading."""

    return _affected_section_span(content) is not None

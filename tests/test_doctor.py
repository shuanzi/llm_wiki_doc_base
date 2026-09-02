from __future__ import annotations

import json
import shutil
import tempfile
import unittest
from pathlib import Path

from llm_wiki.binding import attach
from llm_wiki.doctor import detect_kind, validate_binding, validate_kit, validate_vault
from llm_wiki.vault import init_vault, register_source

from .common import PROJECT_ROOT, run_cli


def _set_affected_pages(record: Path, links: tuple[str, ...]) -> None:
    text = record.read_text(encoding="utf-8")
    heading = "## Affected pages"
    if heading not in text:
        text = text.rstrip() + f"\n\n{heading}\n"
    before, separator, after = text.partition(heading)
    next_heading = after.find("\n## ")
    suffix = after[next_heading:] if next_heading >= 0 else "\n"
    bullets = "".join(f"- [consumer]({link})\n" for link in links)
    record.write_text(
        before + separator + "\n\n" + bullets + suffix.lstrip("\n") if next_heading >= 0
        else before + separator + "\n\n" + bullets,
        encoding="utf-8",
    )


def _write_page(
    vault: Path,
    relative: str,
    *,
    sources: tuple[str, ...] = (),
    body: str = "",
) -> Path:
    page = vault / relative
    page.parent.mkdir(parents=True, exist_ok=True)
    source_block = ""
    if sources:
        source_block = "sources:\n" + "".join(f"  - {item}\n" for item in sources)
    page.write_text(
        "---\n"
        f"title: {page.stem}\n"
        "type: concept\n"
        "status: active\n"
        f"{source_block}"
        "---\n\n"
        f"# {page.stem}\n\n"
        f"{body}",
        encoding="utf-8",
    )
    return page


class DoctorTests(unittest.TestCase):
    def test_original_13_missing_reverse_relations_are_all_reported(self) -> None:
        consumers = (
            ("analyses", "harness-agent-first-engineering"),
            ("analyses", "automation-delivery-software-value"),
            ("analyses", "agent-native-product-interaction"),
            ("analyses", "ai-native-sdlc"),
            ("concepts", "harness-engineering"),
            ("concepts", "agent-feedback-loop"),
            ("concepts", "ai-automation-delivery"),
            ("entities", "openclaw"),
            ("entities", "claude-code"),
            ("questions", "harness-long-term-boundary"),
            ("questions", "automation-commercial-evidence"),
            ("", "INDEX"),
            ("maps", "Knowledge Map"),
        )
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            vault = base / "vault"
            source = base / "openclaw-self-iterating-agent.md"
            source.write_text("original incident fixture\n", encoding="utf-8")
            init_vault(vault, "Original incident")
            result = register_source(vault, source)
            record = Path(str(result.details["record"]))

            for directory, stem in consumers:
                page = vault / "wiki" / directory / f"{stem}.md"
                page.parent.mkdir(parents=True, exist_ok=True)
                source_reference = (
                    f"sources/{record.name}"
                    if not directory
                    else f"../sources/{record.name}"
                )
                page.write_text(
                    "---\n"
                    f"title: {stem}\n"
                    "type: map\n"
                    "status: active\n"
                    "sources:\n"
                    f"  - {source_reference}\n"
                    "---\n\n"
                    f"# {stem}\n",
                    encoding="utf-8",
                )

            relation_findings = [
                item
                for item in validate_vault(vault)
                if item.code.startswith("source.")
            ]

            self.assertEqual(len(relation_findings), 13, relation_findings)
            self.assertTrue(
                all(item.code == "source.reverse-missing" for item in relation_findings),
                relation_findings,
            )

    def test_missing_and_stale_reverse_relations_are_errors(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            vault = base / "vault"
            init_vault(vault, "Mismatch")
            first_source = base / "first.md"
            second_source = base / "second.md"
            first_source.write_text("first", encoding="utf-8")
            second_source.write_text("second", encoding="utf-8")
            first = register_source(vault, first_source).path
            second = register_source(vault, second_source).path
            _write_page(
                vault,
                "wiki/concepts/consumer.md",
                sources=(f"../sources/{first.name}",),
            )
            _set_affected_pages(first, ())
            _set_affected_pages(second, ("../concepts/consumer.md",))

            findings = validate_vault(vault)

            self.assertEqual(
                len([item for item in findings if item.code == "source.reverse-missing"]),
                1,
            )
            self.assertEqual(
                len([item for item in findings if item.code == "source.reverse-stale"]),
                1,
            )

    def test_later_page_can_close_relation_to_an_existing_source(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            vault = base / "vault"
            init_vault(vault, "Later page")
            source = base / "old.md"
            source.write_text("old source", encoding="utf-8")
            record = register_source(vault, source).path
            _write_page(
                vault,
                "wiki/analyses/later.md",
                sources=(f"../sources/{record.name}",),
            )
            self.assertEqual(
                len(
                    [
                        item
                        for item in validate_vault(vault)
                        if item.code == "source.reverse-missing"
                    ]
                ),
                1,
            )

            _set_affected_pages(record, ("../analyses/later.md",))
            relation_findings = [
                item
                for item in validate_vault(vault)
                if item.code.startswith("source.reverse-")
            ]

            self.assertEqual(relation_findings, [])

    def test_existing_page_sources_are_checked_even_without_a_body_link(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            vault = base / "vault"
            init_vault(vault, "Existing consumer")
            source = base / "source.md"
            source.write_text("source", encoding="utf-8")
            record = register_source(vault, source).path
            _write_page(
                vault,
                "wiki/concepts/existing.md",
                sources=(f"../sources/{record.name}",),
                body="This page does not need a body link to preserve provenance.\n",
            )
            _set_affected_pages(record, ("../concepts/existing.md",))

            findings = [
                item
                for item in validate_vault(vault)
                if item.level in ("error", "warning")
            ]

            self.assertEqual(findings, [])

    def test_navigation_links_do_not_create_body_only_warnings(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            vault = base / "vault"
            init_vault(vault, "Navigation")
            source = base / "source.md"
            source.write_text("source", encoding="utf-8")
            record = register_source(vault, source).path
            other_source = base / "other.md"
            other_source.write_text("other", encoding="utf-8")
            other_record = register_source(vault, other_source).path
            index = vault / "wiki/INDEX.md"
            index.write_text(
                index.read_text(encoding="utf-8")
                + f"\n[Source](sources/{record.name})\n",
                encoding="utf-8",
            )
            knowledge_map = vault / "wiki/maps/Knowledge Map.md"
            knowledge_map.write_text(
                knowledge_map.read_text(encoding="utf-8")
                + f"\n[Source](../sources/{record.name})\n",
                encoding="utf-8",
            )
            record.write_text(
                record.read_text(encoding="utf-8")
                + f"\n## Related sources\n\n[Related Source Record]({other_record.name})\n",
                encoding="utf-8",
            )

            warnings = [
                item for item in validate_vault(vault) if item.code == "source.body-only"
            ]

            self.assertEqual(warnings, [])

    def test_index_is_a_consumer_only_when_sources_are_explicit(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            vault = base / "vault"
            init_vault(vault, "Explicit index")
            source = base / "source.md"
            source.write_text("source", encoding="utf-8")
            record = register_source(vault, source).path
            index = vault / "wiki/INDEX.md"
            index.write_text(
                index.read_text(encoding="utf-8").replace(
                    "---\n\n# Index",
                    f"sources:\n  - sources/{record.name}\n---\n\n# Index",
                    1,
                ),
                encoding="utf-8",
            )

            missing = [
                item
                for item in validate_vault(vault)
                if item.code == "source.reverse-missing"
            ]

            self.assertEqual(len(missing), 1, missing)

    def test_chinese_url_encoded_relationship_paths_are_supported(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            vault = base / "vault"
            init_vault(vault, "Encoded")
            source = base / "source.md"
            source.write_text("source", encoding="utf-8")
            original = register_source(vault, source).path
            record = original.with_name("中文 来源.md")
            original.rename(record)
            _write_page(
                vault,
                "wiki/concepts/中文 页面.md",
                sources=("../sources/%E4%B8%AD%E6%96%87%20%E6%9D%A5%E6%BA%90.md",),
            )
            _set_affected_pages(
                record,
                ("../concepts/%E4%B8%AD%E6%96%87%20%E9%A1%B5%E9%9D%A2.md",),
            )

            findings = [
                item
                for item in validate_vault(vault)
                if item.level in ("error", "warning")
            ]

            self.assertEqual(findings, [])

    def test_body_source_link_without_frontmatter_is_a_warning(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            vault = base / "vault"
            init_vault(vault, "Body warning")
            source = base / "source.md"
            source.write_text("source", encoding="utf-8")
            record = register_source(vault, source).path
            _write_page(
                vault,
                "wiki/concepts/body-only.md",
                body=(
                    f"[Source anchor](../sources/{record.name}#agent-notes)\n"
                    f"[Source query](../sources/{record.name}?view=compact)\n"
                ),
            )

            warnings = [
                item for item in validate_vault(vault) if item.code == "source.body-only"
            ]

            self.assertEqual(len(warnings), 1, warnings)
            self.assertEqual(warnings[0].level, "warning")

    def test_strict_doctor_blocks_body_only_warning(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            vault = base / "vault"
            init_vault(vault, "Strict warning")
            source = base / "source.md"
            source.write_text("source", encoding="utf-8")
            record = register_source(vault, source).path
            _write_page(
                vault,
                "wiki/concepts/body-only.md",
                body=f"[Source](../sources/{record.name})\n",
            )

            result = run_cli(
                "doctor", str(vault), "--kind", "vault", "--strict", check=False
            )

            self.assertEqual(result.returncode, 1)
            self.assertIn("source.body-only", result.stdout)

    def test_invalid_and_escaping_sources_are_errors(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            vault = Path(temp) / "vault"
            init_vault(vault, "Invalid sources")
            invalid = _write_page(vault, "wiki/concepts/invalid.md")
            invalid.write_text(
                invalid.read_text(encoding="utf-8").replace(
                    "status: active\n", "status: active\nsources: [not-a-block-list]\n"
                ),
                encoding="utf-8",
            )
            unindented = _write_page(vault, "wiki/concepts/unindented.md")
            unindented.write_text(
                unindented.read_text(encoding="utf-8").replace(
                    "status: active\n", "status: active\nsources:\n- invalid.md\n"
                ),
                encoding="utf-8",
            )
            _write_page(
                vault,
                "wiki/concepts/escape.md",
                sources=("../../../outside.md",),
            )

            errors = {
                item.code for item in validate_vault(vault) if item.level == "error"
            }

            self.assertGreaterEqual(
                len(
                    [
                        item
                        for item in validate_vault(vault)
                        if item.code == "source.sources-invalid"
                    ]
                ),
                2,
            )
            self.assertIn("source.reference-escape", errors)

    def test_kit_is_valid(self) -> None:
        findings = validate_kit(PROJECT_ROOT)
        self.assertFalse([item for item in findings if item.level == "error"], findings)

    def test_detect_kind(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            vault = base / "vault"
            binding = base / "binding"
            init_vault(vault, "Detect")
            attach(vault, binding, ["codex"])
            self.assertEqual(detect_kind(vault), "vault")
            self.assertEqual(detect_kind(binding), "binding")
            self.assertEqual(detect_kind(PROJECT_ROOT), "kit")

    def test_invalid_obsidian_json_is_detected(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            vault = Path(temp) / "vault"
            init_vault(vault, "Bad JSON")
            (vault / ".obsidian/app.json").write_text("{", encoding="utf-8")
            codes = {item.code for item in validate_vault(vault) if item.level == "error"}
            self.assertIn("vault.obsidian-json", codes)

    def test_untrusted_inbox_markdown_is_not_validated_as_durable_wiki_content(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            vault = Path(temp) / "vault"
            init_vault(vault, "Inbox")
            (vault / "sources/inbox/untrusted.md").write_text(
                "[source-context link](missing.md)", encoding="utf-8"
            )

            findings = [
                item for item in validate_vault(vault) if item.level in ("error", "warning")
            ]

            self.assertEqual(findings, [])

    def test_untrusted_clippings_markdown_is_not_validated_as_durable_wiki_content(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            vault = Path(temp) / "vault"
            init_vault(vault, "Clippings")
            clippings = vault / "Clippings"
            clippings.mkdir()
            (clippings / "untrusted.md").write_text(
                "[source-context link](missing.md)", encoding="utf-8"
            )

            findings = [
                item for item in validate_vault(vault) if item.level in ("error", "warning")
            ]

            self.assertEqual(findings, [])

    def test_clippings_intake_root_must_not_be_a_symlink(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            vault = base / "vault"
            outside = base / "outside"
            init_vault(vault, "Clippings symlink")
            outside.mkdir()
            (vault / "Clippings").symlink_to(outside, target_is_directory=True)

            codes = {item.code for item in validate_vault(vault) if item.level == "error"}

            self.assertIn("vault.intake-root-type", codes)

    def test_required_vault_paths_must_have_the_declared_type(self) -> None:
        replacements = {
            "sources/inbox": "file",
            "logs/operations.md": "directory",
        }
        for relative, replacement in replacements.items():
            with self.subTest(relative=relative):
                with tempfile.TemporaryDirectory() as temp:
                    vault = Path(temp) / "vault"
                    init_vault(vault, "Wrong required type")
                    target = vault / relative
                    if target.is_dir():
                        shutil.rmtree(target)
                    else:
                        target.unlink()
                    if replacement == "file":
                        target.write_text("not a directory", encoding="utf-8")
                    else:
                        target.mkdir()

                    codes = {
                        item.code for item in validate_vault(vault) if item.level == "error"
                    }
                    self.assertIn("vault.required-type", codes)

    def test_source_path_escape_is_detected(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            vault = base / "vault"
            init_vault(vault, "Escape")
            record = vault / "wiki/sources/evil.md"
            record.write_text(
                "---\ntitle: Evil\ntype: source\nsource_path: ../outside.txt\nsha256: deadbeef\n---\n",
                encoding="utf-8",
            )
            codes = {item.code for item in validate_vault(vault) if item.level == "error"}
            self.assertIn("source.path-escape", codes)

    def test_installed_skill_drift_is_detected(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            vault = base / "vault"
            binding = base / "binding"
            init_vault(vault, "Drift")
            attach(vault, binding, ["codex"])
            skill = binding / ".agents/skills/llm-wiki/SKILL.md"
            skill.write_text(skill.read_text(encoding="utf-8") + "\nchanged\n", encoding="utf-8")
            codes = {item.code for item in validate_binding(binding) if item.level == "error"}
            self.assertIn("skill.drift", codes)

    def test_missing_registered_file_is_detected(self) -> None:
        with tempfile.TemporaryDirectory() as temp:
            base = Path(temp)
            vault = base / "vault"
            source = base / "source.txt"
            source.write_text("data", encoding="utf-8")
            init_vault(vault, "Missing")
            result = register_source(vault, source)
            Path(str(result.details["registered_file"])).unlink()
            codes = {item.code for item in validate_vault(vault) if item.level == "error"}
            self.assertIn("source.file-missing", codes)


if __name__ == "__main__":
    unittest.main()

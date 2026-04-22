import test from "node:test";
import assert from "node:assert/strict";

import {
  parseFrontmatter,
  serializeFrontmatter,
  validateFrontmatter,
} from "../src/utils/frontmatter";

test("parseFrontmatter handles quoted commas, colons, and YAML comments", () => {
  const content = `---
id: quoted-inline
type: entity
title: "Foo: Bar"
updated_at: 2026-04-22
status: active
aliases: ["ACME, Inc.", "RISC-V"] # inline comment
tags: ["hardware", 'isa']
---

Body
`;

  const { frontmatter, body } = parseFrontmatter(content);
  assert.equal(frontmatter.title, "Foo: Bar");
  assert.deepEqual(frontmatter.aliases, ["ACME, Inc.", "RISC-V"]);
  assert.deepEqual(frontmatter.tags, ["hardware", "isa"]);
  assert.equal(body, "Body\n");
});

test("parseFrontmatter handles multiline arrays and block scalars", () => {
  const content = `---
id: quoted-multiline
type: analysis
title: Quoted Multiline
updated_at: 2026-04-22
status: active
aliases:
  - "RISC-V"
  - 'RISCV'
related:
  - wiki/concepts/foo.md
summary: |
  First line
  Second line
---

Body
`;

  const { frontmatter } = parseFrontmatter(content);
  assert.deepEqual(frontmatter.aliases, ["RISC-V", "RISCV"]);
  assert.deepEqual(frontmatter.related, ["wiki/concepts/foo.md"]);
  assert.equal((frontmatter as Record<string, unknown>).summary, "First line\nSecond line\n");
});

test("parseFrontmatter preserves unmatched trailing quote in YAML plain scalars", () => {
  const content = `---
id: unmatched-multiline
type: entity
title: Unmatched Multiline
updated_at: 2026-04-22
status: active
aliases:
  - James'
  - "RISC-V"
  - 'RISCV'
---

Body
`;

  const { frontmatter } = parseFrontmatter(content);
  assert.deepEqual(frontmatter.aliases, ["James'", "RISC-V", "RISCV"]);
});

test("parseFrontmatter only treats standalone delimiter lines as frontmatter boundaries", () => {
  const content = `---
id: delimiter-test
type: concept
title: Delimiter Test
updated_at: 2026-04-22
status: active
---

Body before

not-a-frontmatter --- delimiter

--- inside prose is not a closing frontmatter delimiter
`;

  const { frontmatter, body } = parseFrontmatter(content);
  assert.equal(frontmatter.id, "delimiter-test");
  assert.match(body, /not-a-frontmatter --- delimiter/u);
  assert.match(body, /--- inside prose/u);
});

test("parseFrontmatter throws on malformed YAML frontmatter", () => {
  const content = `---
id: bad
type: concept
aliases: [one, two
---

Body
`;

  assert.throws(() => parseFrontmatter(content), /Invalid YAML frontmatter/u);
});

test("serializeFrontmatter round-trips through YAML parser with stable core field order", () => {
  const serialized = serializeFrontmatter({
    title: "Foo: Bar",
    id: "foo",
    status: "active",
    updated_at: "2026-04-22",
    type: "concept",
    aliases: ["ACME, Inc.", "RISC-V"],
    z_extra: "last",
    a_extra: "first",
  });

  assert.match(serialized, /^---\nid: foo\ntype: concept\ntitle:/u);

  const { frontmatter } = parseFrontmatter(`${serialized}\n\nBody`);
  assert.equal(frontmatter.id, "foo");
  assert.equal(frontmatter.title, "Foo: Bar");
  assert.deepEqual(frontmatter.aliases, ["ACME, Inc.", "RISC-V"]);
  assert.equal((frontmatter as Record<string, unknown>).a_extra, "first");
  assert.equal((frontmatter as Record<string, unknown>).z_extra, "last");
});

test("validateFrontmatter checks field types, date format, status, and string arrays", () => {
  const validation = validateFrontmatter({
    id: "Bad ID",
    type: "concept",
    title: "Title",
    updated_at: "2026-13-40",
    status: "done" as "active",
    tags: ["ok", 42] as unknown as string[],
  });

  assert.equal(validation.valid, false);
  assert.match(validation.errors.join("\n"), /Invalid id format/u);
  assert.match(validation.errors.join("\n"), /Invalid updated_at/u);
  assert.match(validation.errors.join("\n"), /Invalid status/u);
  assert.match(validation.errors.join("\n"), /tags\[1\] must be a string/u);
});

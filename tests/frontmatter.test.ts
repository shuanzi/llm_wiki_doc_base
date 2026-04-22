import test from "node:test";
import assert from "node:assert/strict";

import { parseFrontmatter } from "../src/utils/frontmatter";

test("parseFrontmatter strips quotes from inline YAML array items", () => {
  const content = `---
id: quoted-inline
type: entity
title: Quoted Inline
updated_at: 2026-04-22
status: active
aliases: ["RISC-V", 'RISCV']
tags: ["hardware", 'isa']
---

Body
`;

  const { frontmatter } = parseFrontmatter(content);
  assert.deepEqual(frontmatter.aliases, ["RISC-V", "RISCV"]);
  assert.deepEqual(frontmatter.tags, ["hardware", "isa"]);
});

test("parseFrontmatter strips quotes from multiline YAML array items", () => {
  const content = `---
id: quoted-multiline
type: entity
title: Quoted Multiline
updated_at: 2026-04-22
status: active
aliases:
  - "RISC-V"
  - 'RISCV'
---

Body
`;

  const { frontmatter } = parseFrontmatter(content);
  assert.deepEqual(frontmatter.aliases, ["RISC-V", "RISCV"]);
});

test("parseFrontmatter preserves unmatched trailing quote in inline YAML array items", () => {
  const content = `---
id: unmatched-inline
type: entity
title: Unmatched Inline
updated_at: 2026-04-22
status: active
aliases: [James', "RISC-V", 'RISCV']
---

Body
`;

  const { frontmatter } = parseFrontmatter(content);
  assert.deepEqual(frontmatter.aliases, ["James'", "RISC-V", "RISCV"]);
});

test("parseFrontmatter preserves unmatched trailing quote in multiline YAML array items", () => {
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

import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { kbSearchWiki } from "../src/tools/kb_search_wiki";
import type { PageIndex, SearchResult, WorkspaceConfig } from "../src/types";

function assert(condition: boolean, message: string): void {
  if (!condition) {
    throw new Error(message);
  }
}

function buildFixtureIndex(): PageIndex {
  return {
    pages: [
      {
        page_id: "risc_v",
        path: "wiki/entities/risc_v.md",
        type: "entity",
        title: "RISC-V",
        aliases: ["RISC V"],
        tags: ["isa"],
        headings: ["Summary"],
        body_excerpt: "RISC-V entity page",
      },
      {
        page_id: "decoy_matrix_article",
        path: "wiki/concepts/decoy_matrix_article.md",
        type: "concept",
        title: "From Vector to Matrix: The Future of RISC-V Matrix Extensions",
        aliases: [],
        tags: ["decoy"],
        headings: ["Main"],
        body_excerpt: "Decoy page to ensure parser uses pipe-left target instead of display text",
      },
      {
        page_id: "src_sha256_08e04538",
        path: "wiki/sources/src_sha256_08e04538.md",
        type: "source",
        title: "From Vector to Matrix: The Future of RISC-V Matrix Extensions",
        aliases: [],
        tags: ["risc-v", "matrix"],
        headings: ["Main"],
        body_excerpt: "Source page",
      },
    ],
  };
}

async function resolve(config: WorkspaceConfig, resolve_link: string): Promise<SearchResult[]> {
  const result = await kbSearchWiki({ query: "", resolve_link }, config);
  assert(result.success, `resolve_link call failed for ${resolve_link}: ${result.error ?? "unknown error"}`);
  return result.data ?? [];
}

async function main(): Promise<void> {
  const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "kb-resolve-link-"));
  const kbRoot = path.join(tempRoot, "kb");
  const cacheDir = path.join(kbRoot, "state", "cache");
  fs.mkdirSync(cacheDir, { recursive: true });
  fs.writeFileSync(path.join(cacheDir, "page-index.json"), JSON.stringify(buildFixtureIndex(), null, 2), "utf8");

  const config: WorkspaceConfig = { kb_root: kbRoot };

  try {
    const byId = await resolve(config, "[[risc_v]]");
    assert(byId.length === 1 && byId[0].page_id === "risc_v", "Expected [[risc_v]] to resolve to risc_v");

    const byIdWithOuterWhitespace = await resolve(config, " [[risc_v]] ");
    assert(
      byIdWithOuterWhitespace.length === 1 && byIdWithOuterWhitespace[0].page_id === "risc_v",
      'Expected " [[risc_v]] " to resolve to risc_v'
    );

    const byTitle = await resolve(config, "[[RISC-V]]");
    assert(byTitle.length === 1 && byTitle[0].page_id === "risc_v", "Expected [[RISC-V]] to resolve to risc_v");

    const byPipeWithSpaces = await resolve(config, "[[ risc_v | Label ]]");
    assert(
      byPipeWithSpaces.length === 1 && byPipeWithSpaces[0].page_id === "risc_v",
      "Expected [[ risc_v | Label ]] to resolve using pipe-left target risc_v"
    );

    const byPipe = await resolve(
      config,
      "[[src_sha256_08e04538|From Vector to Matrix: The Future of RISC-V Matrix Extensions]]"
    );
    assert(
      byPipe.length === 1 && byPipe[0].page_id === "src_sha256_08e04538" && byPipe[0].type === "source",
      "Expected [[id|title]] to resolve by id to source page (not display text decoy)"
    );

    const miss = await resolve(config, "[[not_exists_page]]");
    assert(miss.length === 0, "Expected unresolved link to return empty results");

    console.log("PASS: kb_search_wiki resolve_link validation passed.");
  } finally {
    fs.rmSync(tempRoot, { recursive: true, force: true });
  }
}

main().catch((err: unknown) => {
  const message = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error(message);
  process.exit(1);
});

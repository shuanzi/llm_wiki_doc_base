import * as fs from "fs";
import type { PageIndex, SearchQuery, SearchResult, ToolResult, WorkspaceConfig } from "../types";
import { resolveKbPath } from "../utils/path_validator";

/**
 * kb_search_wiki — Search the wiki layer via page-index.json.
 *
 * Performs keyword matching against title, aliases, tags, headings,
 * and body_excerpt. Supports type and tag filtering.
 */
export async function kbSearchWiki(
  input: SearchQuery,
  config: WorkspaceConfig
): Promise<ToolResult<SearchResult[]>> {
  try {
    const indexPath = resolveKbPath("state/cache/page-index.json", config.kb_root);
    if (!fs.existsSync(indexPath)) {
      return { success: true, data: [] };
    }

    const index: PageIndex = JSON.parse(fs.readFileSync(indexPath, "utf8"));

    // --- resolve_link mode ---
    if (input.resolve_link !== undefined) {
      // Strip [[ and ]] if present
      const raw = input.resolve_link.replace(/^\[\[/, "").replace(/\]\]$/, "");
      const needle = raw.toLowerCase();

      for (const page of index.pages) {
        const titleMatch = page.title.toLowerCase() === needle;
        const idMatch = page.page_id.toLowerCase() === needle;
        const aliasMatch = page.aliases.some((a) => a.toLowerCase() === needle);

        if (titleMatch || idMatch || aliasMatch) {
          return {
            success: true,
            data: [
              {
                page_id: page.page_id,
                path: page.path,
                title: page.title,
                type: page.type,
                score: 1,
                excerpt: page.body_excerpt,
              },
            ],
          };
        }
      }

      // No match found
      return { success: true, data: [] };
    }

    // --- Keyword search mode ---
    const query = input.query.toLowerCase();
    const keywords = query.split(/\s+/).filter((k) => k.length > 0);
    const limit = input.limit ?? 10;

    const results: SearchResult[] = [];

    for (const page of index.pages) {
      // Type filter
      if (input.type_filter && page.type !== input.type_filter) {
        continue;
      }

      // Tag filter — page must have ALL requested tags
      if (input.tags && input.tags.length > 0) {
        const pageTags = new Set(page.tags.map((t) => t.toLowerCase()));
        if (!input.tags.every((t) => pageTags.has(t.toLowerCase()))) {
          continue;
        }
      }

      // Score by keyword matches across fields
      let score = 0;

      for (const kw of keywords) {
        // Title match is weighted higher
        if (page.title.toLowerCase().includes(kw)) {
          score += 3;
        }
        // Alias match
        if (page.aliases.some((a) => a.toLowerCase().includes(kw))) {
          score += 2;
        }
        // Tag exact match
        if (page.tags.some((t) => t.toLowerCase() === kw)) {
          score += 2;
        }
        // Heading match
        if (page.headings.some((h) => h.toLowerCase().includes(kw))) {
          score += 1;
        }
        // Body excerpt match
        if (page.body_excerpt.toLowerCase().includes(kw)) {
          score += 1;
        }
      }

      if (score > 0) {
        results.push({
          page_id: page.page_id,
          path: page.path,
          title: page.title,
          type: page.type,
          score,
          excerpt: page.body_excerpt,
        });
      }
    }

    // Sort by score descending, then by title
    results.sort((a, b) => b.score - a.score || a.title.localeCompare(b.title));

    return { success: true, data: results.slice(0, limit) };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}

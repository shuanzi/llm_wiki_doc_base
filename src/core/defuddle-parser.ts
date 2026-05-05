import * as path from "node:path";
import { pathToFileURL } from "node:url";

export interface ParseHtmlWithDefuddleInput {
  html: string;
  final_url: string;
  language?: string;
}

export interface DefuddleParseResult {
  title: string | null;
  description: string | null;
  site: string | null;
  author: string | null;
  published: string | null;
  language: string | null;
  image: string | null;
  favicon: string | null;
  word_count: number | null;
  parse_time_ms: number | null;
  content_html: string | null;
  content_markdown: string;
  defuddle_version: string;
}

interface DefuddleBridgeResult {
  title: string | null;
  description: string | null;
  site: string | null;
  author: string | null;
  published: string | null;
  language: string | null;
  image: string | null;
  favicon: string | null;
  wordCount: number | null;
  parseTime: number | null;
  contentHtml: string | null;
  contentMarkdown: string | null;
}

interface BridgeModule {
  getDefuddleVersion(): string;
  parseDefuddleHtml(
    html: string,
    finalUrl: string,
    options: { language?: string }
  ): Promise<DefuddleBridgeResult>;
}

let bridgePromise: Promise<BridgeModule> | undefined;

async function loadBridge(): Promise<BridgeModule> {
  bridgePromise ??= import(
    pathToFileURL(path.join(__dirname, "defuddle-parser-bridge.mjs")).href
  ) as Promise<BridgeModule>;
  return bridgePromise;
}

export function buildDefuddleParseResultForTesting(
  bridgeResult: DefuddleBridgeResult,
  defuddleVersion: string
): DefuddleParseResult {
  if (!bridgeResult.contentMarkdown || bridgeResult.contentMarkdown.trim().length === 0) {
    throw new Error("Defuddle returned empty Markdown.");
  }

  return {
    title: bridgeResult.title,
    description: bridgeResult.description,
    site: bridgeResult.site,
    author: bridgeResult.author,
    published: bridgeResult.published,
    language: bridgeResult.language,
    image: bridgeResult.image,
    favicon: bridgeResult.favicon,
    word_count: bridgeResult.wordCount,
    parse_time_ms: bridgeResult.parseTime,
    content_html: bridgeResult.contentHtml,
    content_markdown: bridgeResult.contentMarkdown,
    defuddle_version: defuddleVersion,
  };
}

export async function parseHtmlWithDefuddle(
  input: ParseHtmlWithDefuddleInput
): Promise<DefuddleParseResult> {
  const bridge = await loadBridge();
  const result = await bridge.parseDefuddleHtml(input.html, input.final_url, {
    language: input.language,
  });

  return buildDefuddleParseResultForTesting(result, bridge.getDefuddleVersion());
}

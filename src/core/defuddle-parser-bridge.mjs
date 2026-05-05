import { Defuddle } from "defuddle/node";
import { parseHTML } from "linkedom";

const DEFUDDLE_VERSION = "0.18.1";

export function getDefuddleVersion() {
  return DEFUDDLE_VERSION;
}

export async function parseDefuddleHtml(html, finalUrl, options = {}) {
  const { document } = parseHTML(html);
  const result = await Defuddle(document, finalUrl, {
    separateMarkdown: true,
    useAsync: false,
    language: options.language,
  });

  return {
    title: result.title ?? null,
    description: result.description ?? null,
    site: result.site ?? null,
    author: result.author ?? null,
    published: result.published ?? null,
    language: result.language ?? null,
    image: result.image ?? null,
    favicon: result.favicon ?? null,
    wordCount: typeof result.wordCount === "number" ? result.wordCount : null,
    parseTime: typeof result.parseTime === "number" ? result.parseTime : null,
    contentHtml: result.content ?? null,
    contentMarkdown: result.contentMarkdown ?? null,
  };
}

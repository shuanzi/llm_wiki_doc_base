import { spawnSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { SourceKind } from "../types";
import { sha256 } from "../utils";

export interface ConversionMetadata {
  required: boolean;
  converter: "none" | "plaintext" | "markitdown";
  converter_version?: string;
  disabled_features: string[];
  warnings?: string[];
}

export interface SourceConversionResult {
  source_kind: SourceKind;
  canonical_markdown: string;
  converted_content_hash: string;
  conversion: ConversionMetadata;
}

export interface ValidatedSourceFile {
  absolutePath: string;
  extension: string;
  fileName: string;
  originalBuffer: Buffer;
}

const MARKDOWN_EXTENSIONS = new Set([".md", ".markdown"]);
const PLAINTEXT_EXTENSIONS = new Set([".txt"]);
const MARKITDOWN_EXTENSIONS = new Set([
  ".html",
  ".htm",
  ".csv",
  ".json",
  ".xml",
  ".pdf",
  ".docx",
  ".pptx",
  ".xlsx",
  ".xls",
  ".epub",
]);

const EXPLICITLY_UNSUPPORTED_EXTENSIONS = new Map<string, string>([
  [".zip", "ZIP archives are intentionally not supported."],
  [".msg", "Outlook messages are intentionally not supported."],
  [".eml", "Email messages are intentionally not supported."],
  [".mp3", "Audio transcription is intentionally not supported."],
  [".wav", "Audio transcription is intentionally not supported."],
  [".m4a", "Audio transcription is intentionally not supported."],
  [".flac", "Audio transcription is intentionally not supported."],
  [".ogg", "Audio transcription is intentionally not supported."],
  [".aac", "Audio transcription is intentionally not supported."],
  [".wma", "Audio transcription is intentionally not supported."],
  [".aiff", "Audio transcription is intentionally not supported."],
  [".jpg", "Image OCR is intentionally not supported."],
  [".jpeg", "Image OCR is intentionally not supported."],
  [".png", "Image OCR is intentionally not supported."],
  [".gif", "Image OCR is intentionally not supported."],
  [".bmp", "Image OCR is intentionally not supported."],
  [".tif", "Image OCR is intentionally not supported."],
  [".tiff", "Image OCR is intentionally not supported."],
  [".webp", "Image OCR is intentionally not supported."],
  [".heic", "Image OCR is intentionally not supported."],
  [".svg", "Image/OCR conversion is intentionally not supported."],
]);

const DISABLED_MARKITDOWN_FEATURES = [
  "zip",
  "ocr",
  "audio-transcription",
  "outlook",
  "youtube-transcription",
  "plugins",
];

function isUrlLike(input: string): boolean {
  return /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(input.trim());
}

function supportedExtensionsList(): string {
  return [
    ...MARKDOWN_EXTENSIONS,
    ...PLAINTEXT_EXTENSIONS,
    ...MARKITDOWN_EXTENSIONS,
  ]
    .sort()
    .join(", ");
}

function parsePositiveIntegerEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) {
    return fallback;
  }

  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}

function pythonCandidates(): string[] {
  const fromEnv = process.env.MARKITDOWN_PYTHON;
  if (fromEnv && fromEnv.trim().length > 0) {
    return [fromEnv.trim()];
  }

  return process.platform === "win32" ? ["python", "py"] : ["python3", "python"];
}

function runMarkItDownPython(inputPath: string): { markdown: string; version?: string } {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "kb-markitdown-"));
  const outputPath = path.join(tempDir, "output.md");
  const versionPath = path.join(tempDir, "version.txt");
  const timeout = parsePositiveIntegerEnv("MARKITDOWN_TIMEOUT_MS", 120_000);
  const maxBuffer = parsePositiveIntegerEnv("MARKITDOWN_MAX_STDIO_BYTES", 10 * 1024 * 1024);

  const script = String.raw`
import importlib.metadata
import sys
from pathlib import Path

from markitdown import MarkItDown

input_path = sys.argv[1]
output_path = sys.argv[2]
version_path = sys.argv[3]

try:
    version = importlib.metadata.version("markitdown")
except Exception:
    version = "unknown"

md = MarkItDown(enable_plugins=False)
if hasattr(md, "convert_local"):
    result = md.convert_local(input_path)
else:
    result = md.convert(input_path)

text = getattr(result, "text_content", None)
if text is None:
    text = str(result)

Path(output_path).write_text(text, encoding="utf-8")
Path(version_path).write_text(version, encoding="utf-8")
`;

  const errors: string[] = [];
  try {
    for (const python of pythonCandidates()) {
      const run = spawnSync(python, ["-c", script, inputPath, outputPath, versionPath], {
        encoding: "utf8",
        maxBuffer,
        timeout,
      });

      if (run.error) {
        errors.push(`${python}: ${run.error.message}`);
        continue;
      }

      if (run.status !== 0) {
        errors.push(
          `${python}: MarkItDown exited with status ${run.status}. ${run.stderr.trim()}`.trim()
        );
        continue;
      }

      if (!fs.existsSync(outputPath)) {
        errors.push(`${python}: MarkItDown did not produce an output file.`);
        continue;
      }

      return {
        markdown: fs.readFileSync(outputPath, "utf8"),
        version: fs.existsSync(versionPath)
          ? fs.readFileSync(versionPath, "utf8").trim() || undefined
          : undefined,
      };
    }
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  throw new Error(
    "MarkItDown conversion failed. Install Python 3.10+ and the required optional extras " +
      "for this file type, e.g. `pip install 'markitdown[pdf,docx,pptx,xlsx,xls]'`. " +
      errors.join(" | ")
  );
}

export function validateSourceFile(filePath: string): ValidatedSourceFile {
  if (!filePath || filePath.trim().length === 0) {
    throw new Error("file_path is required.");
  }

  if (isUrlLike(filePath)) {
    throw new Error(
      "Remote URLs are not supported by kb_source_add. Provide a local file path instead."
    );
  }

  const absolutePath = path.resolve(filePath);
  if (!fs.existsSync(absolutePath)) {
    throw new Error(`Source file not found: ${absolutePath}`);
  }

  const stat = fs.lstatSync(absolutePath);
  if (stat.isSymbolicLink()) {
    throw new Error(`Source file must not be a symlink: ${absolutePath}`);
  }

  if (!stat.isFile()) {
    throw new Error(`Source path must be a regular file: ${absolutePath}`);
  }

  const extension = path.extname(absolutePath).toLowerCase();
  if (EXPLICITLY_UNSUPPORTED_EXTENSIONS.has(extension)) {
    throw new Error(
      `Unsupported file type "${extension}". ${EXPLICITLY_UNSUPPORTED_EXTENSIONS.get(extension)}`
    );
  }

  if (
    !MARKDOWN_EXTENSIONS.has(extension) &&
    !PLAINTEXT_EXTENSIONS.has(extension) &&
    !MARKITDOWN_EXTENSIONS.has(extension)
  ) {
    throw new Error(
      `Unsupported file type "${extension || "(none)"}". Supported extensions: ${supportedExtensionsList()}`
    );
  }

  return {
    absolutePath,
    extension,
    fileName: path.basename(filePath),
    originalBuffer: fs.readFileSync(absolutePath),
  };
}

export function convertSourceToMarkdown(source: ValidatedSourceFile): SourceConversionResult {
  if (MARKDOWN_EXTENSIONS.has(source.extension)) {
    const canonicalMarkdown = source.originalBuffer.toString("utf8");
    return {
      source_kind: "markdown",
      canonical_markdown: canonicalMarkdown,
      converted_content_hash: `sha256:${sha256(canonicalMarkdown)}`,
      conversion: {
        required: false,
        converter: "none",
        disabled_features: DISABLED_MARKITDOWN_FEATURES,
      },
    };
  }

  if (PLAINTEXT_EXTENSIONS.has(source.extension)) {
    const canonicalMarkdown = source.originalBuffer.toString("utf8");
    return {
      source_kind: "plaintext",
      canonical_markdown: canonicalMarkdown,
      converted_content_hash: `sha256:${sha256(canonicalMarkdown)}`,
      conversion: {
        required: true,
        converter: "plaintext",
        disabled_features: DISABLED_MARKITDOWN_FEATURES,
      },
    };
  }

  const converted = runMarkItDownPython(source.absolutePath);
  const canonicalMarkdown = converted.markdown.trim().length > 0 ? converted.markdown : "";
  if (canonicalMarkdown.length === 0) {
    throw new Error(
      `MarkItDown conversion produced empty Markdown for ${source.fileName}. ` +
        "The file may contain only scanned images or otherwise unsupported content. OCR is disabled."
    );
  }

  return {
    source_kind: "converted_markdown",
    canonical_markdown: canonicalMarkdown,
    converted_content_hash: `sha256:${sha256(canonicalMarkdown)}`,
    conversion: {
      required: true,
      converter: "markitdown",
      converter_version: converted.version,
      disabled_features: DISABLED_MARKITDOWN_FEATURES,
    },
  };
}

export function isMarkdownExtension(extension: string): boolean {
  return MARKDOWN_EXTENSIONS.has(extension);
}

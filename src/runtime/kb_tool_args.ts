import type { KbCanonicalToolName } from "./kb_tool_contract";

export type KbToolArgsValidation =
  | { ok: true; args: Record<string, unknown> }
  | { ok: false; error: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function requireString(
  args: Record<string, unknown>,
  key: string,
  errors: string[]
): void {
  const value = args[key];
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${key} must be a non-empty string`);
  }
}

function optionalString(
  args: Record<string, unknown>,
  key: string,
  errors: string[]
): void {
  const value = args[key];
  if (value !== undefined && typeof value !== "string") {
    errors.push(`${key} must be a string when provided`);
  }
}

function optionalStringOrNull(
  args: Record<string, unknown>,
  key: string,
  errors: string[]
): void {
  const value = args[key];
  if (value !== undefined && value !== null && typeof value !== "string") {
    errors.push(`${key} must be a string or null when provided`);
  }
}

function optionalBoolean(
  args: Record<string, unknown>,
  key: string,
  errors: string[]
): void {
  const value = args[key];
  if (value !== undefined && typeof value !== "boolean") {
    errors.push(`${key} must be a boolean when provided`);
  }
}

function optionalInteger(
  args: Record<string, unknown>,
  key: string,
  errors: string[],
  minInclusive: number
): void {
  const value = args[key];
  if (value === undefined) {
    return;
  }

  if (!Number.isInteger(value) || (value as number) < minInclusive) {
    errors.push(`${key} must be an integer >= ${minInclusive}`);
  }
}

function optionalPositiveInteger(
  args: Record<string, unknown>,
  key: string,
  errors: string[]
): void {
  const value = args[key];
  if (value === undefined) {
    return;
  }

  if (!Number.isInteger(value) || (value as number) <= 0) {
    errors.push(`${key} must be a positive integer`);
  }
}

function optionalStringArray(
  args: Record<string, unknown>,
  key: string,
  errors: string[]
): void {
  const value = args[key];
  if (value === undefined) {
    return;
  }

  if (!Array.isArray(value) || !value.every((item) => typeof item === "string")) {
    errors.push(`${key} must be an array of strings when provided`);
  }
}

function validateSearchArgs(args: Record<string, unknown>, errors: string[]): void {
  optionalString(args, "query", errors);
  optionalString(args, "type_filter", errors);
  optionalString(args, "resolve_link", errors);
  optionalStringArray(args, "tags", errors);
  optionalPositiveInteger(args, "limit", errors);

  const query = typeof args.query === "string" ? args.query.trim() : "";
  const resolveLink = typeof args.resolve_link === "string" ? args.resolve_link.trim() : "";
  if (!query && !resolveLink) {
    errors.push("query or resolve_link is required");
  }
}

export function validateKbToolArgs(
  name: KbCanonicalToolName,
  rawArgs: unknown
): KbToolArgsValidation {
  if (!isRecord(rawArgs)) {
    return { ok: false, error: "Tool arguments must be an object" };
  }

  const args = rawArgs;
  const errors: string[] = [];

  switch (name) {
    case "kb_source_add":
      requireString(args, "file_path", errors);
      break;
    case "kb_read_source":
      requireString(args, "source_id", errors);
      optionalInteger(args, "offset_bytes", errors, 0);
      optionalPositiveInteger(args, "max_bytes", errors);
      break;
    case "kb_write_page":
      requireString(args, "path", errors);
      requireString(args, "content", errors);
      optionalBoolean(args, "create_only", errors);
      break;
    case "kb_update_section":
      requireString(args, "path", errors);
      requireString(args, "heading", errors);
      requireString(args, "content", errors);
      optionalBoolean(args, "append", errors);
      optionalBoolean(args, "create_if_missing", errors);
      break;
    case "kb_ensure_entry":
      requireString(args, "path", errors);
      requireString(args, "entry", errors);
      if (!("anchor" in args)) {
        errors.push("anchor is required and must be a string or null");
      } else {
        optionalStringOrNull(args, "anchor", errors);
      }
      requireString(args, "dedup_key", errors);
      break;
    case "kb_search_wiki":
      validateSearchArgs(args, errors);
      break;
    case "kb_read_page":
      requireString(args, "path_or_id", errors);
      break;
    case "kb_commit":
      requireString(args, "message", errors);
      break;
    case "kb_rebuild_index":
      optionalBoolean(args, "allow_partial", errors);
      break;
    case "kb_run_lint":
      optionalBoolean(args, "include_semantic", errors);
      break;
    case "kb_repair":
      optionalBoolean(args, "dry_run", errors);
      optionalBoolean(args, "force", errors);
      break;
  }

  if (errors.length > 0) {
    return { ok: false, error: `Invalid ${name} arguments: ${errors.join("; ")}` };
  }

  return { ok: true, args };
}

import type { ToolResult, WorkspaceConfig } from "../types";

export interface KbUpdateSectionInput {
  path: string;
  heading: string;
  content: string;
  append?: boolean;
  create_if_missing?: boolean;
}

export interface KbUpdateSectionOutput {
  path: string;
  action: "replaced" | "appended" | "created_section";
}

/**
 * kb_update_section — Update a specific section in a wiki page.
 * Auto-updates frontmatter updated_at.
 */
export async function kbUpdateSection(
  input: KbUpdateSectionInput,
  config: WorkspaceConfig
): Promise<ToolResult<KbUpdateSectionOutput>> {
  // TODO: implement
  throw new Error("Not implemented");
}

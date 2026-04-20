import type { ToolResult, WorkspaceConfig } from "../types";
import { updateWikiSection } from "../core/wiki-pages";

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

export async function kbUpdateSection(
  input: KbUpdateSectionInput,
  config: WorkspaceConfig
): Promise<ToolResult<KbUpdateSectionOutput>> {
  try {
    const data = updateWikiSection(input, config);

    return {
      success: true,
      data: { path: input.path, action: data.action },
    };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    return { success: false, error: message };
  }
}
